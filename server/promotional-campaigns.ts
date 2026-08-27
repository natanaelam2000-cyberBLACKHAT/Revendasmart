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
  calculateEntitlementWithManualGrants,
  calculateMaxSelectable,
  calculateTokenRemaining,
  DEFAULT_NUMBER_COUNT,
  DEFAULT_NUMBER_START,
  generateCampaignSlug,
  isCampaignPubliclyClaimable,
  isEntitlementPolicy,
  isManualGrantReason,
  isPromotionalAllocationMode,
  isPromotionalCampaignStatus,
  validateClaimPayloadShape,
  validateManualGrantQuantity,
  validateNumberCount,
  validateSelectionLimit,
  type EntitlementPolicy,
  type PromotionalCampaignStatus,
} from "../shared/promotional-campaigns";

const SORTEIO_ERROR_MESSAGES = {
  UNAUTHORIZED: "Sessão inválida. Faça login novamente.",
  FORBIDDEN: "Você não tem permissão para acessar esta campanha.",
  VALIDATION_ERROR: "Dados inválidos.",
  CAMPAIGN_NOT_FOUND: "Sorteio não encontrado.",
  CLIENT_NOT_FOUND: "Cliente não encontrado.",
  TOKEN_CREATE_FAILED: "Não foi possível gerar o link. Tente novamente.",
  NO_ENTRIES_AVAILABLE: "Este cliente não possui participações disponíveis.",
  MANUAL_GRANT_NOT_ALLOWED: "Este sorteio não permite concessão manual de participações.",
  MANUAL_GRANT_FAILED: "Não foi possível conceder as participações. Tente novamente.",
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
/**
 * PROMOTIONAL-CAMPAIGNS-MANUAL-INTERNAL-05 — ledger IMUTÁVEL por participante: nunca editado/apagado,
 * só recebe novos eventos (uma correção soma um evento compensatório). Aninhado sob o participante
 * (não top-level) porque toda leitura já acontece no escopo de um customerId conhecido.
 */
function entitlementEventsRef(campaignId: string, customerId: string) {
  return participantsRef(campaignId).doc(customerId).collection("entitlementEvents");
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

/** Campanhas criadas antes desta feature não têm o campo — INTERNAL_ADMIN era o único modo existente. */
function resolveEntitlementPolicy(campaign: FirebaseFirestore.DocumentData): EntitlementPolicy {
  return isEntitlementPolicy(campaign.entitlementPolicy) ? campaign.entitlementPolicy : "INTERNAL_ADMIN";
}

async function computeManualInternalEntries(campaignId: string, customerId: string): Promise<number> {
  const snapshot = await entitlementEventsRef(campaignId, customerId).get();
  let total = 0;
  for (const doc of snapshot.docs) {
    const amount = Number(doc.data().amount ?? 0);
    if (Number.isFinite(amount)) total += amount;
  }
  return total;
}

/** Entitlement GLOBAL atual do cliente (não escopado a nenhum token/link específico). */
async function computeCustomerEntitlement(
  ownerId: string,
  campaignId: string,
  customerId: string,
  campaign: FirebaseFirestore.DocumentData,
) {
  const [participantSnap, qualifyingSpend, manualInternalEntries] = await Promise.all([
    participantsRef(campaignId).doc(customerId).get(),
    computeQualifyingSpend(ownerId, customerId, campaign.startsAt, campaign.endsAt),
    computeManualInternalEntries(campaignId, customerId),
  ]);
  const entriesAlreadyClaimed = participantSnap.exists ? Number(participantSnap.data()?.entriesClaimed ?? 0) : 0;
  return calculateEntitlementWithManualGrants({
    qualifyingSpend,
    spendPerEntry: campaign.spendPerEntry,
    manualInternalEntries,
    entriesAlreadyClaimed,
    policy: resolveEntitlementPolicy(campaign),
  });
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
        // PROMOTIONAL-CAMPAIGNS-MANUAL-INTERNAL-05 — Sorteios é 100% admin-only hoje; toda campanha nasce
        // INTERNAL_ADMIN. Uma futura versão pública criaria campanhas com REGISTERED_SALES_ONLY aqui.
        entitlementPolicy: "INTERNAL_ADMIN" as EntitlementPolicy,
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
      const policy = resolveEntitlementPolicy(campaign);
      const participants = await Promise.all(participantsSnap.docs.map(async (doc, index) => {
        const participant = doc.data();
        const client = clientSnaps[index]?.data();
        const [qualifyingSpend, eventsSnap] = await Promise.all([
          computeQualifyingSpend(actorUid, doc.id, campaign.startsAt, campaign.endsAt),
          entitlementEventsRef(campaignId, doc.id).orderBy("createdAt", "asc").get(),
        ]);
        // §11 — histórico expansível: cada evento manual fica visível individualmente (nunca só a soma),
        // preservado mesmo depois de um ajuste compensatório futuro.
        const manualEvents = eventsSnap.docs.map((eventDoc) => {
          const data = eventDoc.data();
          return {
            id: eventDoc.id,
            type: data.type as string,
            amount: Number(data.amount ?? 0),
            reason: (data.reason as string | null) ?? null,
            note: (data.note as string | null) ?? null,
            createdAt: data.createdAt as string,
          };
        });
        const manualInternalEntries = manualEvents.reduce((sum, event) => sum + event.amount, 0);
        const entitlement = calculateEntitlementWithManualGrants({
          qualifyingSpend,
          spendPerEntry: campaign.spendPerEntry,
          manualInternalEntries,
          entriesAlreadyClaimed: participant.entriesClaimed ?? 0,
          policy,
        });
        return {
          customerId: doc.id,
          clientName: client?.name ?? "Cliente removido",
          clientPhone: client?.phone ?? null,
          qualifyingSpend,
          automaticEntries: entitlement.automaticEntries,
          manualInternalEntries: entitlement.manualInternalEntries,
          manualEvents,
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

  // ===== GET .../clients/:customerId/entitlement — direitos ATUAIS do cliente, para o admin ver antes
  // de decidir quanto liberar num link (não cria nem reserva nada — só leitura). =====
  app.get("/api/admin/sorteios/campaigns/:campaignId/clients/:customerId/entitlement", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    const actorUid = (req as Request & { firebaseUid?: string }).firebaseUid;
    if (!actorUid) return sendSorteioError(res, 401, "UNAUTHORIZED");
    const campaignId = String(req.params.campaignId);
    const customerId = String(req.params.customerId);
    try {
      const campaignSnap = await campaignsRef().doc(campaignId).get();
      if (!campaignSnap.exists) return sendSorteioError(res, 404, "CAMPAIGN_NOT_FOUND");
      const campaign = campaignSnap.data()!;
      if (campaign.ownerId !== actorUid) return sendSorteioError(res, 403, "FORBIDDEN");

      const clientSnap = await db().collection("users").doc(actorUid).collection("clients").doc(customerId).get();
      if (!clientSnap.exists) return sendSorteioError(res, 404, "CLIENT_NOT_FOUND");

      const entitlement = await computeCustomerEntitlement(actorUid, campaignId, customerId, campaign);
      return res.status(200).json(entitlement);
    } catch (error) {
      logWarn("promotional_campaigns.entitlement_failed", { message: error instanceof Error ? error.message : String(error) });
      return sendSorteioError(res, 500, "SERVER_ERROR");
    }
  });

  // ===== POST .../clients/:customerId/manual-entries — concessão manual interna (INTERNAL_ADMIN only) =====
  // PROMOTIONAL-CAMPAIGNS-MANUAL-INTERNAL-05 — cobre o caso real de venda externa/revista nunca
  // registrada no RevendaSmart: o admin libera participações sem precisar cadastrar uma venda fictícia.
  // NUNCA toca qualifyingSpend/sales/estoque — é um evento de auditoria à parte, somado ao entitlement
  // só sob a policy INTERNAL_ADMIN (nunca sob REGISTERED_SALES_ONLY, mesmo que o request tente).
  app.post("/api/admin/sorteios/campaigns/:campaignId/clients/:customerId/manual-entries", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    const actorUid = (req as Request & { firebaseUid?: string }).firebaseUid;
    if (!actorUid) return sendSorteioError(res, 401, "UNAUTHORIZED");
    const campaignId = String(req.params.campaignId);
    const customerId = String(req.params.customerId);
    const body = req.body ?? {};

    const quantity = validateManualGrantQuantity(body.quantity);
    if (quantity === null) return sendSorteioError(res, 400, "VALIDATION_ERROR", { field: "quantity" });
    const reason = isManualGrantReason(body.reason) ? body.reason : null;
    const note = typeof body.note === "string" ? body.note.trim().slice(0, 500) : null;
    // Idempotência no mesmo padrão já usado em server/sale-finalize-transaction.ts: o CLIENTE gera o id
    // (não o servidor), reenviar o mesmo id nunca duplica o evento — só devolve o resultado já gravado.
    const idempotencyKey = typeof body.idempotencyKey === "string" ? body.idempotencyKey.trim() : "";
    if (!idempotencyKey) return sendSorteioError(res, 400, "VALIDATION_ERROR", { field: "idempotencyKey" });

    try {
      const campaignSnap = await campaignsRef().doc(campaignId).get();
      if (!campaignSnap.exists) return sendSorteioError(res, 404, "CAMPAIGN_NOT_FOUND");
      const campaign = campaignSnap.data()!;
      if (campaign.ownerId !== actorUid) return sendSorteioError(res, 403, "FORBIDDEN");

      // §2/§7: a policy vem SOMENTE do documento da campanha (server-authoritative) — nada no corpo da
      // requisição pode fingir ser INTERNAL_ADMIN. Sob REGISTERED_SALES_ONLY, concessão manual é negada
      // mesmo para um admin, porque essa policy representa "só vendas reais contam" por definição.
      if (resolveEntitlementPolicy(campaign) !== "INTERNAL_ADMIN") {
        return sendSorteioError(res, 403, "MANUAL_GRANT_NOT_ALLOWED");
      }

      const clientSnap = await db().collection("users").doc(actorUid).collection("clients").doc(customerId).get();
      if (!clientSnap.exists) return sendSorteioError(res, 404, "CLIENT_NOT_FOUND");

      const eventRef = entitlementEventsRef(campaignId, customerId).doc(idempotencyKey);
      const participantRef = participantsRef(campaignId).doc(customerId);
      await db().runTransaction(async (transaction) => {
        const existing = await transaction.get(eventRef);
        if (existing.exists) return; // replay do mesmo idempotencyKey — não duplica
        transaction.set(eventRef, {
          customerId,
          type: "MANUAL_INTERNAL_GRANT",
          amount: quantity,
          reason,
          note,
          createdAt: new Date().toISOString(),
          createdBy: actorUid,
        });
        // Sem isto, um cliente que só recebeu concessão manual (nunca fez claim) não aparece na lista de
        // PARTICIPANTES — subcoleções não materializam o documento pai sozinhas no Firestore. `merge`
        // nunca sobrescreve entriesClaimed/claimedNumbers se o participante já existir por ter escolhido
        // números antes.
        transaction.set(participantRef, { customerId, updatedAt: new Date().toISOString() }, { merge: true });
      });

      const entitlement = await computeCustomerEntitlement(actorUid, campaignId, customerId, campaign);
      logInfo("promotional_campaigns.manual_entries_granted", { campaignId, customerId, actorUid, quantity, reason });
      return res.status(201).json({ eventId: idempotencyKey, quantity, entitlement });
    } catch (error) {
      logWarn("promotional_campaigns.manual_entries_failed", { message: error instanceof Error ? error.message : String(error) });
      return sendSorteioError(res, 500, "MANUAL_GRANT_FAILED");
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

      // PROMOTIONAL-CAMPAIGNS-LINK-SELECTION-LIMIT-04 — o link NUNCA cria ou reserva direitos: só decide
      // um teto (selectionLimit) para quantos dos direitos JÁ EXISTENTES este link específico libera.
      // Sem valor enviado, o default é o saldo atual inteiro (comportamento idêntico ao anterior à esta
      // feature). Recalcular aqui é deliberado — o admin pode ter aberto a tela há um tempo.
      const entitlement = await computeCustomerEntitlement(actorUid, campaignId, customerId, campaign);
      if (entitlement.entriesAvailable <= 0) return sendSorteioError(res, 400, "NO_ENTRIES_AVAILABLE");

      const rawSelectionLimit = req.body?.selectionLimit;
      const selectionLimit = rawSelectionLimit === undefined || rawSelectionLimit === null
        ? entitlement.entriesAvailable
        : validateSelectionLimit(rawSelectionLimit, entitlement.entriesAvailable);
      if (selectionLimit === null) return sendSorteioError(res, 400, "VALIDATION_ERROR", { field: "selectionLimit" });

      const rawToken = crypto.randomBytes(32).toString("base64url");
      const tokenRef = tokensRef(campaignId).doc();
      const now = new Date().toISOString();
      await tokenRef.set({
        customerId,
        tokenHash: hashToken(rawToken),
        createdAt: now,
        expiresAt: null,
        revokedAt: null,
        selectionLimit,
        claimedThroughToken: 0,
      });
      logInfo("promotional_campaigns.link_created", { campaignId, actorUid, tokenId: tokenRef.id, selectionLimit });
      return res.status(201).json({
        tokenId: tokenRef.id,
        slug: campaign.slug,
        token: rawToken,
        path: `/sorteio/${campaign.slug}?t=${rawToken}`,
        selectionLimit,
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

      const [participantSnap, numbersSnap, qualifyingSpend, manualInternalEntries] = await Promise.all([
        participantsRef(campaignId).doc(customerId).get(),
        numbersRef(campaignId).get(),
        computeQualifyingSpend(campaign.ownerId, customerId, campaign.startsAt, campaign.endsAt),
        computeManualInternalEntries(campaignId, customerId),
      ]);
      const entriesAlreadyClaimed = participantSnap.exists ? Number(participantSnap.data()?.entriesClaimed ?? 0) : 0;
      const entitlement = calculateEntitlementWithManualGrants({
        qualifyingSpend,
        spendPerEntry: campaign.spendPerEntry,
        manualInternalEntries,
        entriesAlreadyClaimed,
        policy: resolveEntitlementPolicy(campaign),
      });

      // PROMOTIONAL-CAMPAIGNS-LINK-SELECTION-LIMIT-04 — o que este link específico ainda libera pode ser
      // MENOR que o saldo global do cliente (o admin pode ter limitado o link, ou o cliente pode ter
      // outro link com saldo já consumido). `selectionLimit` ausente no documento (link legado, criado
      // antes desta feature) normaliza para `null` = sem teto próprio, capado só pelo saldo global.
      const tokenSelectionLimit = typeof tokenData.selectionLimit === "number" ? tokenData.selectionLimit : null;
      const tokenClaimedThroughToken = Number(tokenData.claimedThroughToken ?? 0);
      const tokenRemaining = calculateTokenRemaining(tokenSelectionLimit, tokenClaimedThroughToken);
      const maxSelectable = calculateMaxSelectable(entitlement.entriesAvailable, tokenRemaining);

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
        // Escopado a ESTE link/token — nunca o saldo global bruto (que pode incluir direitos reservados
        // a outros links do mesmo cliente). Ver comentário acima sobre maxSelectable.
        entriesAvailable: maxSelectable,
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
        const tokenDoc = tokenQuerySnap.docs[0];
        const tokenData = tokenDoc.data();
        if (tokenData.revokedAt) return { ok: false as const, denyReason: "REVOKED_TOKEN" as const };
        if (tokenData.expiresAt && Date.now() > Date.parse(tokenData.expiresAt)) return { ok: false as const, denyReason: "EXPIRED_TOKEN" as const };
        const customerId = tokenData.customerId as string;
        // PROMOTIONAL-CAMPAIGNS-LINK-SELECTION-LIMIT-04 — `selectionLimit` ausente (link legado) normaliza
        // para null = sem teto próprio, comportamento idêntico ao anterior a esta feature.
        const tokenSelectionLimit = typeof tokenData.selectionLimit === "number" ? tokenData.selectionLimit : null;
        const tokenClaimedThroughToken = Number(tokenData.claimedThroughToken ?? 0);

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

        // PROMOTIONAL-CAMPAIGNS-MANUAL-INTERNAL-05 — lido DENTRO da mesma transação (não antes dela) para
        // que uma concessão manual concorrente nunca fique fora da leitura que decide o teto desta claim.
        const manualEventsQuerySnap = await transaction.get(entitlementEventsRef(campaignId, customerId));
        let manualInternalEntries = 0;
        for (const doc of manualEventsQuerySnap.docs) {
          const amount = Number(doc.data().amount ?? 0);
          if (Number.isFinite(amount)) manualInternalEntries += amount;
        }
        const entitlement = calculateEntitlementWithManualGrants({
          qualifyingSpend,
          spendPerEntry: campaign.spendPerEntry,
          manualInternalEntries,
          entriesAlreadyClaimed,
          policy: resolveEntitlementPolicy(campaign),
        });

        // O teto real desta claim é o MENOR entre o saldo global (recalculado fresco, nunca confiado do
        // client) e o que resta do teto próprio deste token — nunca um dos dois isoladamente. Protege
        // contra múltiplos links do mesmo cliente juntos excederem o saldo real (concorrência incluída,
        // já que toda esta leitura acontece dentro da mesma transação Firestore).
        const tokenRemaining = calculateTokenRemaining(tokenSelectionLimit, tokenClaimedThroughToken);
        const maxSelectable = calculateMaxSelectable(entitlement.entriesAvailable, tokenRemaining);

        const shapeError = validateClaimPayloadShape({
          numbers,
          numberStart: campaign.numberStart,
          numberEnd: campaign.numberEnd,
          entriesAvailable: maxSelectable,
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
        // Consumo específico DESTE token — nunca reseta, mesmo que o cliente tenha outros links.
        transaction.update(tokenDoc.ref, { claimedThroughToken: tokenClaimedThroughToken + numbers.length });

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
