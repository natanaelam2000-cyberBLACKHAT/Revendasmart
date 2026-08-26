/**
 * PROMOTIONAL-CAMPAIGNS-01 — módulo "Sorteios Promocionais" (admin-only, MVP). Mesmo padrão de
 * `server/admin-grants.ts`: um módulo dedicado com `registerPromotionalCampaignRoutes(app, requireAuth)`,
 * atrás do MESMO `requireAdmin` (server/admin-auth.ts) usado por todas as outras rotas de admin — não
 * existe um segundo mecanismo de autorização aqui.
 *
 * Fonte de verdade de "quanto o cliente comprou": as vendas já existentes em `users/{ownerId}/sales`
 * (nunca um banco de compras novo). O servidor recalcula `qualifyingSpend` a partir dessas vendas TODA
 * vez que resolve direitos — o cliente nunca envia esse valor, nem `entriesEarned`/`entriesAvailable`,
 * como verdade (§9 do ticket).
 *
 * `promotionalCampaigns/{campaignId}` e suas subcoleções (`numbers`, `participants`, `accessTokens`) são
 * um caminho NOVO e top-level (diferente do padrão `users/{uid}/...` do resto do app), mas seguem o
 * mesmo raciocínio já usado para `internalGrants`/`charges`/`installments`: nenhuma rule própria em
 * firestore.rules porque não existe caminho de leitura/escrita direta pelo client SDK — tudo passa por
 * estas rotas (Admin SDK ignora Rules), e o default-deny no fim de firestore.rules bloqueia qualquer
 * tentativa de acesso direto. "Ocultar botão não é segurança" — a autoridade real é `requireAdmin` +
 * comparação de `ownerId` em cada rota, nunca a ausência de um link na UI.
 */
import type { Express, NextFunction, Request, Response } from "express";
import crypto from "node:crypto";
import { getFirebaseAdmin } from "./firebase-admin-init";
import { requireAdmin } from "./admin-auth";
import { logInfo, logWarn } from "./logger";
import {
  calculateEntitlement,
  DEFAULT_NUMBER_COUNT,
  DEFAULT_NUMBER_START,
  generateCampaignSlug,
  isCampaignPubliclyClaimable,
  isPromotionalAllocationMode,
  isPromotionalCampaignStatus,
  validateClaimPayloadShape,
  validateNumberCount,
  type PromotionalCampaignStatus,
} from "../shared/promotional-campaigns";

const SORTEIO_ERROR_MESSAGES = {
  UNAUTHORIZED: "Sessão inválida. Faça login novamente.",
  FORBIDDEN: "Você não tem permissão para acessar esta campanha.",
  VALIDATION_ERROR: "Dados inválidos.",
  CAMPAIGN_NOT_FOUND: "Sorteio não encontrado.",
  CLIENT_NOT_FOUND: "Cliente não encontrado.",
  TOKEN_CREATE_FAILED: "Não foi possível gerar o link. Tente novamente.",
  SERVER_ERROR: "Ocorreu um erro temporário. Tente novamente.",
} as const;
type SorteioErrorCode = keyof typeof SORTEIO_ERROR_MESSAGES;

function sendSorteioError(res: Response, status: number, code: SorteioErrorCode, extra?: Record<string, unknown>): void {
  res.status(status).json({ code, message: SORTEIO_ERROR_MESSAGES[code], ...extra });
}

function db() {
  return getFirebaseAdmin().firestore();
}
function campaignsRef() {
  return db().collection("promotionalCampaigns");
}
function numbersRef(campaignId: string) {
  return campaignsRef().doc(campaignId).collection("numbers");
}
function participantsRef(campaignId: string) {
  return campaignsRef().doc(campaignId).collection("participants");
}
function tokensRef(campaignId: string) {
  return campaignsRef().doc(campaignId).collection("accessTokens");
}

function hashToken(rawToken: string): string {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}

/** Rate limit em memória, mesmo padrão já usado em `server/uploads.ts`/`routes.ts` — sem dependência nova. */
function makeRateLimiter(windowMs: number, max: number) {
  const hits = new Map<string, { count: number; resetAt: number }>();
  return (key: string): boolean => {
    const now = Date.now();
    const current = hits.get(key);
    if (!current || now > current.resetAt) {
      hits.set(key, { count: 1, resetAt: now + windowMs });
      return true;
    }
    if (current.count >= max) return false;
    current.count += 1;
    return true;
  };
}
const publicSorteioRateLimit = makeRateLimiter(60_000, 30);

async function computeQualifyingSpend(ownerId: string, customerId: string, startsAt: string, endsAt: string): Promise<number> {
  const snapshot = await db().collection("users").doc(ownerId).collection("sales")
    .where("clientId", "==", customerId)
    .where("date", ">=", startsAt)
    .where("date", "<=", endsAt)
    .get();
  let totalCents = 0;
  for (const doc of snapshot.docs) {
    const data = doc.data();
    const value = Number(data.total ?? data.totalPrice ?? 0);
    if (Number.isFinite(value)) totalCents += Math.round(value * 100);
  }
  return totalCents / 100;
}

function sanitizePositiveNumber(value: unknown): number | null {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : null;
}
function sanitizeIsoDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}
function sanitizeText(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

export function registerPromotionalCampaignRoutes(
  app: Express,
  requireAuth: (req: Request, res: Response, next: NextFunction) => void,
): void {
  // ===== POST /api/admin/sorteios/campaigns — criar campanha (sempre draft, ownerId = actorUid) =====
  app.post("/api/admin/sorteios/campaigns", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    const actorUid = (req as Request & { firebaseUid?: string }).firebaseUid;
    if (!actorUid) return sendSorteioError(res, 401, "UNAUTHORIZED");
    const body = req.body ?? {};

    const title = sanitizeText(body.title, 120);
    const description = sanitizeText(body.description, 2000);
    const prizeName = sanitizeText(body.prizeName, 120);
    const prizeImageUrl = typeof body.prizeImageUrl === "string" && body.prizeImageUrl.trim() ? body.prizeImageUrl.trim() : null;
    const startsAt = sanitizeIsoDate(body.startsAt);
    const endsAt = sanitizeIsoDate(body.endsAt);
    const drawAt = body.drawAt ? sanitizeIsoDate(body.drawAt) : null;
    const spendPerEntry = sanitizePositiveNumber(body.spendPerEntry ?? 100) ?? 100;
    // PROMOTIONAL-CAMPAIGNS-02: campanhas novas sempre nascem em numberStart=1 — o admin só escolhe a
    // quantidade (`numberCount`); o servidor deriva a faixa. Nunca confia num numberStart/numberEnd vindo
    // do cliente (campanhas ANTIGAS que já tenham numberStart=0 continuam intactas no Firestore, só não
    // é mais possível criar uma NOVA campanha começando em 0).
    const numberCount = validateNumberCount(body.numberCount ?? DEFAULT_NUMBER_COUNT);
    const allocationMode = isPromotionalAllocationMode(body.allocationMode) ? body.allocationMode : "customer_choice";

    if (!title || !prizeName || !startsAt || !endsAt) return sendSorteioError(res, 400, "VALIDATION_ERROR", { field: "title/prizeName/startsAt/endsAt" });
    if (numberCount === null) return sendSorteioError(res, 400, "VALIDATION_ERROR", { field: "numberCount" });
    if (spendPerEntry <= 0) return sendSorteioError(res, 400, "VALIDATION_ERROR", { field: "spendPerEntry" });
    if (Date.parse(endsAt) < Date.parse(startsAt)) return sendSorteioError(res, 400, "VALIDATION_ERROR", { field: "endsAt" });
    // §25: sorteio automático nunca é implementado nesta fase — a rota nem aceita ativar esse modo.
    if (allocationMode !== "customer_choice") return sendSorteioError(res, 400, "VALIDATION_ERROR", { field: "allocationMode" });

    try {
      const ref = campaignsRef().doc();
      const now = new Date().toISOString();
      const slug = generateCampaignSlug(title, ref.id.slice(0, 8));
      const campaign = {
        id: ref.id,
        ownerId: actorUid,
        slug,
        title,
        description,
        prizeName,
        prizeImageUrl,
        status: "draft" as PromotionalCampaignStatus,
        startsAt,
        endsAt,
        drawAt,
        spendPerEntry,
        numberStart: DEFAULT_NUMBER_START,
        numberEnd: DEFAULT_NUMBER_START + numberCount - 1,
        allocationMode,
        winningNumber: null,
        resultSource: null,
        finishedAt: null,
        createdAt: now,
        updatedAt: now,
      };
      await ref.set(campaign);
      logInfo("promotional_campaigns.created", { campaignId: ref.id, actorUid });
      return res.status(201).json(campaign);
    } catch (error) {
      logWarn("promotional_campaigns.create_failed", { message: error instanceof Error ? error.message : String(error) });
      return sendSorteioError(res, 500, "SERVER_ERROR");
    }
  });

  // ===== GET /api/admin/sorteios/campaigns — listar campanhas do próprio admin, com métricas =====
  app.get("/api/admin/sorteios/campaigns", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    const actorUid = (req as Request & { firebaseUid?: string }).firebaseUid;
    if (!actorUid) return sendSorteioError(res, 401, "UNAUTHORIZED");
    try {
      const snapshot = await campaignsRef().where("ownerId", "==", actorUid).orderBy("createdAt", "desc").get();
      const campaigns = await Promise.all(snapshot.docs.map(async (doc) => {
        const campaign = doc.data();
        const [numbersClaimedCount, participantsCount] = await Promise.all([
          numbersRef(doc.id).where("status", "==", "claimed").count().get(),
          participantsRef(doc.id).count().get(),
        ]);
        const numbersTotal = campaign.numberEnd - campaign.numberStart + 1;
        return {
          ...campaign,
          numbersTotal,
          numbersClaimed: numbersClaimedCount.data().count,
          numbersAvailable: numbersTotal - numbersClaimedCount.data().count,
          participantsCount: participantsCount.data().count,
        };
      }));
      return res.status(200).json({ campaigns });
    } catch (error) {
      logWarn("promotional_campaigns.list_failed", { message: error instanceof Error ? error.message : String(error) });
      return sendSorteioError(res, 500, "SERVER_ERROR");
    }
  });

  // ===== GET /api/admin/sorteios/campaigns/:campaignId — detalhe + participantes (com telefone) =====
  app.get("/api/admin/sorteios/campaigns/:campaignId", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    const actorUid = (req as Request & { firebaseUid?: string }).firebaseUid;
    if (!actorUid) return sendSorteioError(res, 401, "UNAUTHORIZED");
    const campaignId = String(req.params.campaignId);
    try {
      const campaignSnap = await campaignsRef().doc(campaignId).get();
      if (!campaignSnap.exists) return sendSorteioError(res, 404, "CAMPAIGN_NOT_FOUND");
      const campaign = campaignSnap.data()!;
      // §27: owner isolation — mesmo admin, uma campanha de outro owner é invisível, não só "sem botão".
      if (campaign.ownerId !== actorUid) return sendSorteioError(res, 403, "FORBIDDEN");

      const [participantsSnap, qualifiedSalesTotal] = await Promise.all([
        participantsRef(campaignId).get(),
        (async () => {
          const salesSnap = await db().collection("users").doc(actorUid).collection("sales")
            .where("date", ">=", campaign.startsAt).where("date", "<=", campaign.endsAt).get();
          return salesSnap.docs.reduce((sum, doc) => {
            const value = Number(doc.data().total ?? doc.data().totalPrice ?? 0);
            return Number.isFinite(value) ? sum + value : sum;
          }, 0);
        })(),
      ]);

      const clientRefs = participantsSnap.docs.map((doc) => db().collection("users").doc(actorUid).collection("clients").doc(doc.id));
      const clientSnaps = clientRefs.length ? await db().getAll(...clientRefs) : [];
      const participants = await Promise.all(participantsSnap.docs.map(async (doc, index) => {
        const participant = doc.data();
        const client = clientSnaps[index]?.data();
        const qualifyingSpend = await computeQualifyingSpend(actorUid, doc.id, campaign.startsAt, campaign.endsAt);
        const entitlement = calculateEntitlement(qualifyingSpend, campaign.spendPerEntry, participant.entriesClaimed ?? 0);
        return {
          customerId: doc.id,
          clientName: client?.name ?? "Cliente removido",
          clientPhone: client?.phone ?? null,
          qualifyingSpend,
          entriesClaimed: participant.entriesClaimed ?? 0,
          claimedNumbers: participant.claimedNumbers ?? [],
          entriesAvailable: entitlement.entriesAvailable,
          updatedAt: participant.updatedAt ?? null,
        };
      }));

      const numbersTotal = campaign.numberEnd - campaign.numberStart + 1;
      const numbersClaimedCount = (await numbersRef(campaignId).where("status", "==", "claimed").count().get()).data().count;

      return res.status(200).json({
        campaign,
        metrics: {
          numbersTotal,
          numbersClaimed: numbersClaimedCount,
          numbersAvailable: numbersTotal - numbersClaimedCount,
          participantsCount: participants.length,
          qualifiedSalesTotal: Math.round(qualifiedSalesTotal * 100) / 100,
          utilizationRate: numbersTotal > 0 ? Math.round((numbersClaimedCount / numbersTotal) * 1000) / 10 : 0,
        },
        participants,
      });
    } catch (error) {
      logWarn("promotional_campaigns.detail_failed", { message: error instanceof Error ? error.message : String(error) });
      return sendSorteioError(res, 500, "SERVER_ERROR");
    }
  });

  // ===== PATCH /api/admin/sorteios/campaigns/:campaignId/status — draft/active/paused/finished =====
  app.patch("/api/admin/sorteios/campaigns/:campaignId/status", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    const actorUid = (req as Request & { firebaseUid?: string }).firebaseUid;
    if (!actorUid) return sendSorteioError(res, 401, "UNAUTHORIZED");
    const campaignId = String(req.params.campaignId);
    const { status } = req.body ?? {};
    if (!isPromotionalCampaignStatus(status)) return sendSorteioError(res, 400, "VALIDATION_ERROR", { field: "status" });
    try {
      const ref = campaignsRef().doc(campaignId);
      const snap = await ref.get();
      if (!snap.exists) return sendSorteioError(res, 404, "CAMPAIGN_NOT_FOUND");
      if (snap.data()!.ownerId !== actorUid) return sendSorteioError(res, 403, "FORBIDDEN");
      const now = new Date().toISOString();
      await ref.update({
        status,
        updatedAt: now,
        finishedAt: status === "finished" ? now : snap.data()!.finishedAt ?? null,
      });
      logInfo("promotional_campaigns.status_changed", { campaignId, status, actorUid });
      return res.status(200).json({ success: true, status });
    } catch (error) {
      logWarn("promotional_campaigns.status_change_failed", { message: error instanceof Error ? error.message : String(error) });
      return sendSorteioError(res, 500, "SERVER_ERROR");
    }
  });

  // ===== POST /api/admin/sorteios/campaigns/:campaignId/links — gera link individual (campanha + cliente) =====
  app.post("/api/admin/sorteios/campaigns/:campaignId/links", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    const actorUid = (req as Request & { firebaseUid?: string }).firebaseUid;
    if (!actorUid) return sendSorteioError(res, 401, "UNAUTHORIZED");
    const campaignId = String(req.params.campaignId);
    const customerId = typeof req.body?.customerId === "string" ? req.body.customerId : "";
    if (!customerId) return sendSorteioError(res, 400, "VALIDATION_ERROR", { field: "customerId" });
    try {
      const campaignSnap = await campaignsRef().doc(campaignId).get();
      if (!campaignSnap.exists) return sendSorteioError(res, 404, "CAMPAIGN_NOT_FOUND");
      const campaign = campaignSnap.data()!;
      if (campaign.ownerId !== actorUid) return sendSorteioError(res, 403, "FORBIDDEN");

      const clientSnap = await db().collection("users").doc(actorUid).collection("clients").doc(customerId).get();
      if (!clientSnap.exists) return sendSorteioError(res, 404, "CLIENT_NOT_FOUND");

      const rawToken = crypto.randomBytes(32).toString("base64url");
      const tokenRef = tokensRef(campaignId).doc();
      const now = new Date().toISOString();
      await tokenRef.set({
        customerId,
        tokenHash: hashToken(rawToken),
        createdAt: now,
        expiresAt: null,
        revokedAt: null,
      });
      logInfo("promotional_campaigns.link_created", { campaignId, actorUid, tokenId: tokenRef.id });
      return res.status(201).json({
        tokenId: tokenRef.id,
        slug: campaign.slug,
        token: rawToken,
        path: `/sorteio/${campaign.slug}?t=${rawToken}`,
      });
    } catch (error) {
      logWarn("promotional_campaigns.link_create_failed", { message: error instanceof Error ? error.message : String(error) });
      return sendSorteioError(res, 500, "TOKEN_CREATE_FAILED");
    }
  });

  // ===== POST /api/admin/sorteios/campaigns/:campaignId/links/:tokenId/revoke =====
  app.post("/api/admin/sorteios/campaigns/:campaignId/links/:tokenId/revoke", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    const actorUid = (req as Request & { firebaseUid?: string }).firebaseUid;
    if (!actorUid) return sendSorteioError(res, 401, "UNAUTHORIZED");
    const campaignId = String(req.params.campaignId);
    const tokenId = String(req.params.tokenId);
    try {
      const campaignSnap = await campaignsRef().doc(campaignId).get();
      if (!campaignSnap.exists) return sendSorteioError(res, 404, "CAMPAIGN_NOT_FOUND");
      if (campaignSnap.data()!.ownerId !== actorUid) return sendSorteioError(res, 403, "FORBIDDEN");
      await tokensRef(campaignId).doc(tokenId).update({ revokedAt: new Date().toISOString() });
      return res.status(200).json({ success: true });
    } catch (error) {
      logWarn("promotional_campaigns.link_revoke_failed", { message: error instanceof Error ? error.message : String(error) });
      return sendSorteioError(res, 500, "SERVER_ERROR");
    }
  });

  // ===== GET /api/public/sorteios/:slug — página pública, sem login, dados mínimos sanitizados =====
  app.get("/api/public/sorteios/:slug", async (req: Request, res: Response) => {
    if (!publicSorteioRateLimit(req.ip ?? "unknown")) return res.status(429).json({ error: "RATE_LIMITED" });
    const slug = String(req.params.slug);
    const token = typeof req.query.t === "string" ? req.query.t : "";
    if (!token) return sendSorteioError(res, 401, "FORBIDDEN");
    try {
      const campaignSnap = await campaignsRef().where("slug", "==", slug).limit(1).get();
      if (campaignSnap.empty) return sendSorteioError(res, 404, "CAMPAIGN_NOT_FOUND");
      const campaignDoc = campaignSnap.docs[0];
      const campaign = campaignDoc.data();
      const campaignId = campaignDoc.id;

      const tokenSnap = await tokensRef(campaignId).where("tokenHash", "==", hashToken(token)).limit(1).get();
      if (tokenSnap.empty) return sendSorteioError(res, 403, "FORBIDDEN");
      const tokenData = tokenSnap.docs[0].data();
      if (tokenData.revokedAt) return sendSorteioError(res, 403, "FORBIDDEN");
      const customerId = tokenData.customerId as string;

      const [participantSnap, numbersSnap, qualifyingSpend] = await Promise.all([
        participantsRef(campaignId).doc(customerId).get(),
        numbersRef(campaignId).get(),
        computeQualifyingSpend(campaign.ownerId, customerId, campaign.startsAt, campaign.endsAt),
      ]);
      const entriesAlreadyClaimed = participantSnap.exists ? Number(participantSnap.data()?.entriesClaimed ?? 0) : 0;
      const entitlement = calculateEntitlement(qualifyingSpend, campaign.spendPerEntry, entriesAlreadyClaimed);

      // §16/§26: público nunca sabe QUEM escolheu — só se o número está livre, ou "claimed" (bloqueado),
      // ou é um dos SEUS PRÓPRIOS números (mine: true), nunca customerId/telefone de terceiros.
      const claimedByOthers = new Map<number, boolean>();
      for (const doc of numbersSnap.docs) {
        const data = doc.data();
        claimedByOthers.set(Number(doc.id), data.status === "claimed" && data.customerId !== customerId);
      }
      const myNumbers = new Set<number>(participantSnap.exists ? (participantSnap.data()?.claimedNumbers ?? []) : []);
      const numbers: { number: number; status: "available" | "claimed" }[] = [];
      for (let n = campaign.numberStart; n <= campaign.numberEnd; n += 1) {
        numbers.push({ number: n, status: (claimedByOthers.get(n) || myNumbers.has(n)) ? "claimed" : "available" });
      }

      return res.status(200).json({
        campaign: {
          title: campaign.title,
          description: campaign.description,
          prizeName: campaign.prizeName,
          prizeImageUrl: campaign.prizeImageUrl,
          startsAt: campaign.startsAt,
          endsAt: campaign.endsAt,
          numberStart: campaign.numberStart,
          numberEnd: campaign.numberEnd,
        },
        claimable: isCampaignPubliclyClaimable({ status: campaign.status, startsAt: campaign.startsAt, endsAt: campaign.endsAt }),
        entriesAvailable: entitlement.entriesAvailable,
        myNumbers: Array.from(myNumbers).sort((a, b) => a - b),
        numbers,
      });
    } catch (error) {
      logWarn("promotional_campaigns.public_view_failed", { message: error instanceof Error ? error.message : String(error) });
      return sendSorteioError(res, 500, "SERVER_ERROR");
    }
  });

  // ===== POST /api/public/sorteios/:slug/claim — CRÍTICO: transação atômica, servidor é autoridade =====
  app.post("/api/public/sorteios/:slug/claim", async (req: Request, res: Response) => {
    if (!publicSorteioRateLimit(req.ip ?? "unknown")) return res.status(429).json({ error: "RATE_LIMITED" });
    const slug = String(req.params.slug);
    const token = typeof req.body?.token === "string" ? req.body.token : "";
    const rawNumbers = Array.isArray(req.body?.numbers) ? req.body.numbers : [];
    const numbers = rawNumbers.every((value: unknown) => typeof value === "number") ? (rawNumbers as number[]).map((n) => Math.trunc(n)) : null;
    if (!token || !numbers) return res.status(200).json({ ok: false, denyReason: "NO_NUMBERS_SELECTED" });

    try {
      const campaignSnap = await campaignsRef().where("slug", "==", slug).limit(1).get();
      if (campaignSnap.empty) return res.status(200).json({ ok: false, denyReason: "CAMPAIGN_NOT_FOUND" });
      const campaignId = campaignSnap.docs[0].id;
      const campaignRef = campaignsRef().doc(campaignId);
      const tokenHash = hashToken(token);

      const result = await db().runTransaction(async (transaction) => {
        // ---- LEITURAS (todas antes de qualquer escrita) ----
        const campaignFreshSnap = await transaction.get(campaignRef);
        if (!campaignFreshSnap.exists) return { ok: false as const, denyReason: "CAMPAIGN_NOT_FOUND" as const };
        const campaign = campaignFreshSnap.data()!;

        const tokenQuerySnap = await transaction.get(tokensRef(campaignId).where("tokenHash", "==", tokenHash).limit(1));
        if (tokenQuerySnap.empty) return { ok: false as const, denyReason: "INVALID_TOKEN" as const };
        const tokenData = tokenQuerySnap.docs[0].data();
        if (tokenData.revokedAt) return { ok: false as const, denyReason: "REVOKED_TOKEN" as const };
        if (tokenData.expiresAt && Date.now() > Date.parse(tokenData.expiresAt)) return { ok: false as const, denyReason: "EXPIRED_TOKEN" as const };
        const customerId = tokenData.customerId as string;

        if (!isCampaignPubliclyClaimable({ status: campaign.status, startsAt: campaign.startsAt, endsAt: campaign.endsAt })) {
          return { ok: false as const, denyReason: campaign.status !== "active" ? "CAMPAIGN_NOT_ACTIVE" as const : "OUTSIDE_CAMPAIGN_PERIOD" as const };
        }

        const participantRef = participantsRef(campaignId).doc(customerId);
        const numberRefs = numbers.map((n) => numbersRef(campaignId).doc(String(n)));
        const [participantSnap, ...numberSnaps] = await transaction.getAll(participantRef, ...numberRefs);

        const salesQuerySnap = await transaction.get(
          db().collection("users").doc(campaign.ownerId).collection("sales")
            .where("clientId", "==", customerId)
            .where("date", ">=", campaign.startsAt)
            .where("date", "<=", campaign.endsAt),
        );
        let qualifyingSpendCents = 0;
        for (const doc of salesQuerySnap.docs) {
          const value = Number(doc.data().total ?? doc.data().totalPrice ?? 0);
          if (Number.isFinite(value)) qualifyingSpendCents += Math.round(value * 100);
        }
        const qualifyingSpend = qualifyingSpendCents / 100;
        const entriesAlreadyClaimed = participantSnap.exists ? Number(participantSnap.data()?.entriesClaimed ?? 0) : 0;
        const entitlement = calculateEntitlement(qualifyingSpend, campaign.spendPerEntry, entriesAlreadyClaimed);

        const shapeError = validateClaimPayloadShape({
          numbers,
          numberStart: campaign.numberStart,
          numberEnd: campaign.numberEnd,
          entriesAvailable: entitlement.entriesAvailable,
        });
        if (shapeError) return { ok: false as const, denyReason: shapeError };

        for (let i = 0; i < numberSnaps.length; i += 1) {
          const snap = numberSnaps[i];
          if (snap.exists && snap.data()?.status === "claimed") {
            return { ok: false as const, denyReason: "NUMBER_ALREADY_CLAIMED" as const, conflictingNumber: numbers[i] };
          }
        }

        // ---- ESCRITAS (só depois de TODAS as leituras acima) ----
        const now = new Date().toISOString();
        const previousClaimed: number[] = participantSnap.exists ? (participantSnap.data()?.claimedNumbers ?? []) : [];
        for (let i = 0; i < numberRefs.length; i += 1) {
          transaction.set(numberRefs[i], { number: numbers[i], status: "claimed", customerId, claimedAt: now });
        }
        transaction.set(participantRef, {
          customerId,
          entriesClaimed: entriesAlreadyClaimed + numbers.length,
          claimedNumbers: [...previousClaimed, ...numbers],
          updatedAt: now,
        }, { merge: true });

        return { ok: true as const, claimedNumbers: numbers };
      });

      if (!result.ok) logInfo("promotional_campaigns.claim_denied", { slug, denyReason: result.denyReason });
      else logInfo("promotional_campaigns.claim_confirmed", { slug, count: result.claimedNumbers.length });
      return res.status(200).json(result);
    } catch (error) {
      logWarn("promotional_campaigns.claim_failed", { message: error instanceof Error ? error.message : String(error) });
      return res.status(500).json({ ok: false, denyReason: "SERVER_ERROR" });
    }
  });
}
