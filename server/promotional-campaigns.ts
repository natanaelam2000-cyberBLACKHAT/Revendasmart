/**
 * PROMOTIONAL-CAMPAIGNS-01 — módulo "Sorteios Promocionais" (admin-only, MVP). Mesmo padrão de
 * `server/admin-grants.ts`: um módulo dedicado com `registerPromotionalCampaignRoutes(app, requireAuth)`,
 * atrás do MESMO `requireAdmin` (server/admin-auth.ts) usado por todas as outras rotas de admin — não
 * existe um segundo mecanismo de autorização aqui.
 *
 * Autorizações explícitas usam participants/{customerId}.assignedNumberCount.
 * Participantes legados sem autorização mantêm o cálculo por vendas.
 * Fonte de verdade de "quanto o cliente comprou": as vendas já existentes em `users/{ownerId}/sales`
 * (nunca um banco de compras novo). O servidor recalcula `qualifyingSpend` a partir dessas vendas TODA
 * vez que resolve direitos legados — o cliente nunca envia esse valor, nem `entriesEarned`/`entriesAvailable`,
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
  QUANTITY_REQUIRED: "Defina a quantidade autorizada para este cliente.",
  QUANTITY_INVALID: "Quantidade de números inválida.",
  QUANTITY_BEYOND_CAMPAIGN: "A quantidade não pode exceder os números da campanha.",
  QUANTITY_BELOW_CLAIMED: "A quantidade não pode ser menor que os números já escolhidos.",
  CAMPAIGN_FINISHED: "Campanha encerrada não pode ter a quantidade alterada.",
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

function campaignNumberCount(campaign: { numberStart?: unknown; numberEnd?: unknown }): number {
  const start = Number(campaign.numberStart);
  const end = Number(campaign.numberEnd);
  return Number.isInteger(start) && Number.isInteger(end) && end >= start ? end - start + 1 : 0;
}

function entriesClaimedFromParticipant(data: Record<string, unknown> | undefined): number {
  const value = Number(data?.entriesClaimed ?? 0);
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

function assignedNumberCountFromParticipant(data: Record<string, unknown> | undefined): number | null {
  if (data?.assignedNumberCount === undefined || data?.assignedNumberCount === null) return null;
  // Campo inválido não pode conceder direitos pela regra de gasto.
  return typeof data.assignedNumberCount === "number" ? validateNumberCount(data.assignedNumberCount) ?? 0 : 0;
}

type AssignmentResult =
  | { ok: true; claimedCount: number }
  | { ok: false; reason: "CAMPAIGN_NOT_FOUND" | "FORBIDDEN" | "CLIENT_NOT_FOUND" | "CAMPAIGN_FINISHED" | "QUANTITY_BEYOND_CAMPAIGN" | "QUANTITY_BELOW_CLAIMED"; claimedCount?: number };

/** Atualiza a concessão dentro de uma transação para serializar edição administrativa e claim público. */
async function assignNumberCount(
  campaignId: string,
  customerId: string,
  numberCount: number,
  actorUid: string,
): Promise<AssignmentResult> {
  const campaignRef = campaignsRef().doc(campaignId);
  const participantRef = participantsRef(campaignId).doc(customerId);
  return db().runTransaction(async (transaction) => {
    const [campaignSnap, participantSnap, clientSnap] = await transaction.getAll(campaignRef, participantRef, db().collection("users").doc(actorUid).collection("clients").doc(customerId));
    if (!campaignSnap.exists) return { ok: false as const, reason: "CAMPAIGN_NOT_FOUND" as const };
    const campaign = campaignSnap.data()!;
    if (campaign.ownerId !== actorUid) return { ok: false as const, reason: "FORBIDDEN" as const };
    if (!clientSnap.exists) return { ok: false as const, reason: "CLIENT_NOT_FOUND" as const };
    if (campaign.status === "finished") return { ok: false as const, reason: "CAMPAIGN_FINISHED" as const };
    if (numberCount > campaignNumberCount(campaign)) return { ok: false as const, reason: "QUANTITY_BEYOND_CAMPAIGN" as const };

    const participant = participantSnap.exists ? participantSnap.data() : undefined;
    const claimedCount = entriesClaimedFromParticipant(participant);
    if (numberCount < claimedCount) return { ok: false as const, reason: "QUANTITY_BELOW_CLAIMED" as const, claimedCount };

    transaction.set(participantRef, {
      customerId,
      assignedNumberCount: numberCount,
      entriesClaimed: claimedCount,
      claimedNumbers: Array.isArray(participant?.claimedNumbers) ? participant.claimedNumbers : [],
      updatedAt: new Date().toISOString(),
    }, { merge: true });
    return { ok: true as const, claimedCount };
  });
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
          id: doc.id,
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
        const assignedNumberCount = assignedNumberCountFromParticipant(participant);
        const entitlement = calculateEntitlement(qualifyingSpend, campaign.spendPerEntry, participant.entriesClaimed ?? 0, assignedNumberCount);
        return {
          customerId: doc.id,
          clientName: client?.name ?? "Cliente removido",
          clientPhone: client?.phone ?? null,
          qualifyingSpend,
          assignedNumberCount,
          entriesAuthorized: entitlement.entriesEarned,
          entriesClaimed: participant.entriesClaimed ?? 0,
          claimedNumbers: participant.claimedNumbers ?? [],
          entriesAvailable: entitlement.entriesAvailable,
          updatedAt: participant.updatedAt ?? null,
        };
      }));

      const numbersTotal = campaign.numberEnd - campaign.numberStart + 1;
      const numbersClaimedCount = (await numbersRef(campaignId).where("status", "==", "claimed").count().get()).data().count;

      return res.status(200).json({
        campaign: { ...campaign, id: campaignId },
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

  // ===== PATCH /api/admin/sorteios/campaigns/:campaignId/participants/:customerId/quantity =====
  // A quantidade é uma concessão por campanha/cliente, não uma propriedade do link. Repetir o mesmo
  // PATCH é idempotente; reduzir abaixo do já escolhido é recusado para não invalidar participação.
  app.patch("/api/admin/sorteios/campaigns/:campaignId/participants/:customerId/quantity", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    const actorUid = (req as Request & { firebaseUid?: string }).firebaseUid;
    if (!actorUid) return sendSorteioError(res, 401, "UNAUTHORIZED");
    const campaignId = String(req.params.campaignId);
    const customerId = String(req.params.customerId);
    const numberCount = typeof req.body?.numberCount === "number" ? validateNumberCount(req.body.numberCount) : null;
    if (numberCount === null) return sendSorteioError(res, 400, "QUANTITY_INVALID", { field: "numberCount" });

    try {
      const campaignSnap = await campaignsRef().doc(campaignId).get();
      if (!campaignSnap.exists) return sendSorteioError(res, 404, "CAMPAIGN_NOT_FOUND");
      const campaign = campaignSnap.data()!;
      if (campaign.ownerId !== actorUid) return sendSorteioError(res, 403, "FORBIDDEN");

      const clientSnap = await db().collection("users").doc(actorUid).collection("clients").doc(customerId).get();
      if (!clientSnap.exists) return sendSorteioError(res, 404, "CLIENT_NOT_FOUND");
      if (numberCount > campaignNumberCount(campaign)) return sendSorteioError(res, 400, "QUANTITY_BEYOND_CAMPAIGN", { field: "numberCount" });

      const result = await assignNumberCount(campaignId, customerId, numberCount, actorUid);
      if (!result.ok) {
        if (result.reason === "CAMPAIGN_NOT_FOUND" || result.reason === "CLIENT_NOT_FOUND") return sendSorteioError(res, 404, result.reason);
        if (result.reason === "FORBIDDEN") return sendSorteioError(res, 403, "FORBIDDEN");
        if (result.reason === "CAMPAIGN_FINISHED") return sendSorteioError(res, 409, "CAMPAIGN_FINISHED");
        if (result.reason === "QUANTITY_BELOW_CLAIMED") return sendSorteioError(res, 409, "QUANTITY_BELOW_CLAIMED", { claimedCount: result.claimedCount });
        return sendSorteioError(res, 400, "QUANTITY_BEYOND_CAMPAIGN", { field: "numberCount" });
      }
      logInfo("promotional_campaigns.quantity_assigned", { campaignId, customerId, numberCount, actorUid });
      return res.status(200).json({ success: true, customerId, assignedNumberCount: numberCount, entriesClaimed: result.claimedCount });
    } catch (error) {
      logWarn("promotional_campaigns.quantity_assign_failed", { message: error instanceof Error ? error.message : String(error) });
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
    const hasNumberCount = Object.prototype.hasOwnProperty.call(req.body ?? {}, "numberCount");
    const numberCount = hasNumberCount && typeof req.body?.numberCount === "number" ? validateNumberCount(req.body.numberCount) : null;
    if (!customerId) return sendSorteioError(res, 400, "VALIDATION_ERROR", { field: "customerId" });
    if (hasNumberCount && numberCount === null) return sendSorteioError(res, 400, "QUANTITY_INVALID", { field: "numberCount" });
    try {
      const campaignSnap = await campaignsRef().doc(campaignId).get();
      if (!campaignSnap.exists) return sendSorteioError(res, 404, "CAMPAIGN_NOT_FOUND");
      const campaign = campaignSnap.data()!;
      if (campaign.ownerId !== actorUid) return sendSorteioError(res, 403, "FORBIDDEN");
      if (campaign.status === "finished") return sendSorteioError(res, 409, "CAMPAIGN_FINISHED");

      const clientSnap = await db().collection("users").doc(actorUid).collection("clients").doc(customerId).get();
      if (!clientSnap.exists) return sendSorteioError(res, 404, "CLIENT_NOT_FOUND");

      const rawToken = crypto.randomBytes(32).toString("base64url");
      const tokenRef = tokensRef(campaignId).doc();
      const now = new Date().toISOString();
      // Autorização e token são persistidos juntos; edições e claims disputam o mesmo participante.
      const error = await db().runTransaction(async (transaction) => {
        const participantRef = participantsRef(campaignId).doc(customerId);
        const [freshCampaign, participantSnap, freshClient] = await transaction.getAll(
          campaignsRef().doc(campaignId), participantRef,
          db().collection("users").doc(actorUid).collection("clients").doc(customerId),
        );
        if (!freshCampaign.exists) return "CAMPAIGN_NOT_FOUND" as const;
        const currentCampaign = freshCampaign.data()!;
        if (currentCampaign.ownerId !== actorUid) return "FORBIDDEN" as const;
        if (currentCampaign.status === "finished") return "CAMPAIGN_FINISHED" as const;
        if (!freshClient.exists) return "CLIENT_NOT_FOUND" as const;
        const participant = participantSnap.data();
        if (!hasNumberCount && assignedNumberCountFromParticipant(participant) === null) return "QUANTITY_REQUIRED" as const;
        if (numberCount !== null) {
          if (numberCount > campaignNumberCount(currentCampaign)) return "QUANTITY_BEYOND_CAMPAIGN" as const;
          const claimedCount = entriesClaimedFromParticipant(participant);
          if (numberCount < claimedCount) return "QUANTITY_BELOW_CLAIMED" as const;
          transaction.set(participantRef, {
            customerId, assignedNumberCount: numberCount, entriesClaimed: claimedCount,
            claimedNumbers: Array.isArray(participant?.claimedNumbers) ? participant.claimedNumbers : [], updatedAt: now,
          }, { merge: true });
        }
        transaction.set(tokenRef, { customerId, tokenHash: hashToken(rawToken), createdAt: now, expiresAt: null, revokedAt: null });
        return null;
      });
      if (error) return sendSorteioError(res, error === "FORBIDDEN" ? 403 : error.endsWith("NOT_FOUND") ? 404 : error === "CAMPAIGN_FINISHED" || error === "QUANTITY_BELOW_CLAIMED" ? 409 : 400, error);
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
      if (tokenData.revokedAt || (tokenData.expiresAt && Date.now() > Date.parse(tokenData.expiresAt))) return sendSorteioError(res, 403, "FORBIDDEN");
      const customerId = tokenData.customerId as string;

      const [participantSnap, numbersSnap] = await Promise.all([
        participantsRef(campaignId).doc(customerId).get(), numbersRef(campaignId).get(),
      ]);
      const qualifyingSpend = assignedNumberCountFromParticipant(participantSnap.data()) === null
        ? await computeQualifyingSpend(campaign.ownerId, customerId, campaign.startsAt, campaign.endsAt) : 0;
      const participant = participantSnap.exists ? participantSnap.data() : undefined;
      const entriesAlreadyClaimed = entriesClaimedFromParticipant(participant);
      const assignedNumberCount = assignedNumberCountFromParticipant(participant);
      const entitlement = calculateEntitlement(qualifyingSpend, campaign.spendPerEntry, entriesAlreadyClaimed, assignedNumberCount);

      // §16/§26: público nunca sabe QUEM escolheu — só se o número está livre, ou "claimed" (bloqueado),
      // ou é um dos SEUS PRÓPRIOS números (mine: true), nunca customerId/telefone de terceiros.
      const claimedByOthers = new Map<number, boolean>();
      for (const doc of numbersSnap.docs) {
        const data = doc.data();
        claimedByOthers.set(Number(doc.id), data.status === "claimed" && data.customerId !== customerId);
      }
      const myNumbers = new Set<number>(participantSnap.exists && Array.isArray(participant?.claimedNumbers) ? participant.claimedNumbers : []);
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
        entriesAuthorized: entitlement.entriesEarned,
        entriesClaimed: entriesAlreadyClaimed,
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
    const numbers = rawNumbers.every((value: unknown) => typeof value === "number") ? (rawNumbers as number[]) : null;
    if (numbers && numbers.some((number) => !Number.isSafeInteger(number))) return res.status(200).json({ ok: false, denyReason: "NUMBER_OUT_OF_RANGE" });
    if (numbers && numbers.length > 2000) return res.status(200).json({ ok: false, denyReason: "EXCEEDS_AVAILABLE_ENTRIES" });
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

        const participant = participantSnap.exists ? participantSnap.data() : undefined;
        const entriesAlreadyClaimed = entriesClaimedFromParticipant(participant);
        const assignedNumberCount = assignedNumberCountFromParticipant(participant);
        let qualifyingSpendCents = 0;
        // Autorizações explícitas não dependem de vendas nem de índices de vendas.
        if (assignedNumberCount === null) {
          const salesQuerySnap = await transaction.get(
            db().collection("users").doc(campaign.ownerId).collection("sales")
              .where("clientId", "==", customerId).where("date", ">=", campaign.startsAt).where("date", "<=", campaign.endsAt),
          );
          for (const doc of salesQuerySnap.docs) {
            const value = Number(doc.data().total ?? doc.data().totalPrice ?? 0);
            if (Number.isFinite(value)) qualifyingSpendCents += Math.round(value * 100);
          }
        }
        const qualifyingSpend = qualifyingSpendCents / 100;
        const entitlement = calculateEntitlement(qualifyingSpend, campaign.spendPerEntry, entriesAlreadyClaimed, assignedNumberCount);

        // A validação estrutural sempre usa o payload original para manter duplicidade/range inválidos
        // como erro, mesmo quando o cliente está repetindo uma requisição já concluída.
        const shapeError = validateClaimPayloadShape({
          numbers,
          numberStart: campaign.numberStart,
          numberEnd: campaign.numberEnd,
          entriesAvailable: Number.MAX_SAFE_INTEGER,
        });
        if (shapeError) return { ok: false as const, denyReason: shapeError };

        const alreadyOwned = numberSnaps.map((snap) => snap.exists && snap.data()?.status === "claimed" && snap.data()?.customerId === customerId);
        const newNumbers = numbers.filter((_number, index) => !alreadyOwned[index]);
        if (newNumbers.length > entitlement.entriesAvailable) {
          return { ok: false as const, denyReason: "EXCEEDS_AVAILABLE_ENTRIES" as const };
        }

        for (let i = 0; i < numberSnaps.length; i += 1) {
          const snap = numberSnaps[i];
          if (snap.exists && snap.data()?.status === "claimed" && !alreadyOwned[i]) {
            return { ok: false as const, denyReason: "NUMBER_ALREADY_CLAIMED" as const, conflictingNumber: numbers[i] };
          }
        }

        // Retry do mesmo payload já persistido é sucesso sem nova concessão/escrita. Isso também torna
        // um retry parcial seguro: somente números ainda livres consomem o saldo restante.
        if (newNumbers.length === 0) return { ok: true as const, claimedNumbers: numbers };

        // ---- ESCRITAS (só depois de TODAS as leituras acima) ----
        const now = new Date().toISOString();
        const previousClaimed: number[] = participantSnap.exists && Array.isArray(participant?.claimedNumbers)
          ? participant.claimedNumbers.filter((value: unknown): value is number => typeof value === "number")
          : [];
        for (let i = 0; i < numberRefs.length; i += 1) {
          if (!alreadyOwned[i]) transaction.set(numberRefs[i], { number: numbers[i], status: "claimed", customerId, claimedAt: now });
        }
        transaction.set(participantRef, {
          customerId,
          entriesClaimed: entriesAlreadyClaimed + newNumbers.length,
          claimedNumbers: Array.from(new Set([...previousClaimed, ...newNumbers])),
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
