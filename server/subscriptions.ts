/**

RevendaSmart — App Subscription Module

Handles PREMIUM subscriptions for the RevendaSmart app itself.

Uses the CENTRAL Mercado Pago account (MERCADOPAGO_ACCESS_TOKEN).

⚠️ SEPARATION: This module is COMPLETELY ISOLATED from server/payments.ts

payments.ts → revendedoras' payment links to their clients (uses OAuth tokens)


subscriptions.ts → RevendaSmart app subscription billing (uses central token)


Endpoints:

POST /api/app-subscription/create      → Initiate subscription checkout

POST /api/app-subscription/cancel      → Cancel active subscription

GET  /api/app-subscription/status      → Get current subscription status

POST /api/app-subscription/webhook     → Receive MP preapproval events
*/


import type { Express, NextFunction, Request, Response } from "express";
import * as crypto from "crypto";
import { MercadoPagoConfig, PreApproval } from "mercadopago";
import { getFirebaseAdmin } from "./firebase-admin-init";
import type { SubscriptionStatus, GlobalConfig } from "../shared/monetization";
import { DEFAULT_GLOBAL_CONFIG } from "../shared/monetization";
import { logError, logInfo, logWarn } from "./logger";
import {
  maskMercadoPagoExternalId,
  normalizeMercadoPagoEnvironment,
  validateMercadoPagoAccessTokenForEnvironment,
} from "./mercadopago-environment";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const CENTRAL_ACCESS_TOKEN = process.env.MERCADOPAGO_ACCESS_TOKEN?.trim() ?? "";
const WEBHOOK_SECRET = process.env.MERCADOPAGO_WEBHOOK_SECRET?.trim() ?? "";
const WEBHOOK_MAX_AGE_MS = 5 * 60 * 1000;
const APP_BASE_URL = process.env.APP_BASE_URL ?? "https://revendasmart-backend-164193806378.us-central1.run.app";
const FRONTEND_URL = process.env.FRONTEND_URL ?? "https://revendasmart.vercel.app";
const MERCADO_PAGO_ENV = normalizeMercadoPagoEnvironment(process.env.MERCADO_PAGO_ENV);
const MP_CREDENTIAL_VALIDATION = validateMercadoPagoAccessTokenForEnvironment(
  CENTRAL_ACCESS_TOKEN,
  MERCADO_PAGO_ENV,
);

// Premium subscription price in BRL (monthly)
const PREMIUM_PRICE_BRL = parseFloat(process.env.PREMIUM_PRICE_BRL ?? "19.90");
const PREMIUM_PLAN_NAME = "RevendaSmart Premium";

logInfo("subscriptions.initialized", {
  credentialConfigured: Boolean(CENTRAL_ACCESS_TOKEN),
  credentialValid: MP_CREDENTIAL_VALIDATION.ok,
  credentialMode: MP_CREDENTIAL_VALIDATION.ok ? MP_CREDENTIAL_VALIDATION.mode : MP_CREDENTIAL_VALIDATION.code,
  mercadoPagoEnvironment: MERCADO_PAGO_ENV,
  premiumPriceConfigured: Number.isFinite(PREMIUM_PRICE_BRL),
});

const mpClient = new MercadoPagoConfig({
  accessToken: MP_CREDENTIAL_VALIDATION.ok ? CENTRAL_ACCESS_TOKEN : "",
  options: { timeout: 15000 },
});

function normalizeDetails(details: unknown[]): unknown {
  if (details.length === 0) return undefined;
  return details.length === 1 ? details[0] : details;
}

function subInfo(message: string, ...details: unknown[]): void {
  logInfo("subscriptions.log", { message, details: normalizeDetails(details) });
}

function subWarn(message: string, ...details: unknown[]): void {
  logWarn("subscriptions.log", { message, details: normalizeDetails(details) });
}

function subLogError(message: string, ...details: unknown[]): void {
  logError("subscriptions.log", undefined, { message, details: normalizeDetails(details) });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function logSubError(op: string, uid: string | null, msg: string, ctx?: Record<string, any>) {
  logError(`subscriptions.${op}`, msg, {
    uid,
    ...(ctx ?? {}),
  });
}

type SubscriptionCredentialProblem =
  | "MERCADOPAGO_NOT_CONFIGURED"
  | "PRODUCTION_TOKEN_IN_SANDBOX"
  | "SANDBOX_TOKEN_IN_PRODUCTION"
  | "UNKNOWN_SANDBOX_TOKEN";

function getSubscriptionCredentialProblem(): SubscriptionCredentialProblem | null {
  if (!CENTRAL_ACCESS_TOKEN) return "MERCADOPAGO_NOT_CONFIGURED";
  if (!MP_CREDENTIAL_VALIDATION.ok) return MP_CREDENTIAL_VALIDATION.code;
  return null;
}

function sendSubscriptionCredentialError(
  res: Response,
  operation: "create" | "cancel" | "sync-now" | "webhook",
  uid?: string | null,
): boolean {
  const credentialProblem = getSubscriptionCredentialProblem();
  if (!credentialProblem) return false;

  logWarn("subscriptions.credentials.blocked", {
    operation,
    uid: uid ?? null,
    errorCode: credentialProblem,
    mercadoPagoEnvironment: MERCADO_PAGO_ENV,
  });

  res.status(operation === "webhook" ? 503 : 500).json({
    error: credentialProblem,
    message: "Serviço de assinatura não está configurado para este ambiente.",
  });
  return true;
}

const SUBSCRIPTION_RATE_LIMIT_WINDOW_MS = 60 * 1000;
const SUBSCRIPTION_RATE_LIMIT_MAX_KEYS = 10_000;
const subscriptionRateLimitMap = new Map<string, { count: number; resetAt: number }>();

function getSubscriptionClientKey(req: Request): string {
  const forwardedFor = req.headers["x-forwarded-for"];
  const firstForwardedFor = Array.isArray(forwardedFor)
    ? forwardedFor[0]
    : forwardedFor?.split(",")[0]?.trim();
  return req.ip ?? firstForwardedFor ?? "unknown";
}

function subscriptionRateLimit(
  max: number,
  keyPrefix: string,
  getKey: (req: Request) => string,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    const key = `${keyPrefix}:${getKey(req)}`;
    const nowMs = Date.now();
    const current = subscriptionRateLimitMap.get(key);

    if (!current || nowMs > current.resetAt) {
      if (subscriptionRateLimitMap.size >= SUBSCRIPTION_RATE_LIMIT_MAX_KEYS) {
        for (const [entryKey, entry] of Array.from(subscriptionRateLimitMap.entries())) {
          if (nowMs > entry.resetAt) subscriptionRateLimitMap.delete(entryKey);
        }
      }
      subscriptionRateLimitMap.set(key, {
        count: 1,
        resetAt: nowMs + SUBSCRIPTION_RATE_LIMIT_WINDOW_MS,
      });
      return next();
    }

    if (current.count >= max) {
      const retryAfterSeconds = Math.max(1, Math.ceil((current.resetAt - nowMs) / 1000));
      res.setHeader("Retry-After", String(retryAfterSeconds));
      return res.status(429).json({ error: "RATE_LIMITED" });
    }

    current.count += 1;
    return next();
  };
}

const subscriptionWebhookRateLimit = subscriptionRateLimit(
  120,
  "subscriptions:webhook",
  getSubscriptionClientKey,
);
const subscriptionCreateRateLimit = subscriptionRateLimit(
  20,
  "subscriptions:create",
  (req) => (req as any).firebaseUid ?? getSubscriptionClientKey(req),
);
const subscriptionStatusRateLimit = subscriptionRateLimit(
  120,
  "subscriptions:status",
  (req) => (req as any).firebaseUid ?? getSubscriptionClientKey(req),
);
const subscriptionMutationRateLimit = subscriptionRateLimit(
  30,
  "subscriptions:mutation",
  (req) => (req as any).firebaseUid ?? getSubscriptionClientKey(req),
);

function normalizeStatus(status?: string | null): string {
return (status ?? "").toLowerCase().trim();
}

type WebhookSignatureResult =
  | { valid: true; mode: "signed" }
  | { valid: false; status: 401 | 503; code: string };

function getSingleHeader(req: Request, name: "x-signature" | "x-request-id"): string {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function safeHexEqual(received: string, expected: string): boolean {
  if (!/^[a-f0-9]{64}$/i.test(received) || !/^[a-f0-9]{64}$/i.test(expected)) {
    return false;
  }
  const receivedBuffer = Buffer.from(received, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  return receivedBuffer.length === expectedBuffer.length &&
    crypto.timingSafeEqual(receivedBuffer, expectedBuffer);
}

function validateSubscriptionWebhookSignature(
  req: Request,
  subscriptionId: string,
): WebhookSignatureResult {
  if (!WEBHOOK_SECRET) {
    subLogError("[subscriptions/webhook] Webhook secret is not configured");
    return { valid: false, status: 401, code: "WEBHOOK_SECRET_NOT_CONFIGURED" };
  }

  const signatureHeader = getSingleHeader(req, "x-signature");
  const requestId = getSingleHeader(req, "x-request-id").trim();
  if (!signatureHeader || !requestId) {
    return { valid: false, status: 401, code: "MISSING_WEBHOOK_SIGNATURE" };
  }

  const signatureParts = new Map(
    signatureHeader.split(",").map((part) => {
      const separator = part.indexOf("=");
      return separator < 0
        ? [part.trim(), ""]
        : [part.slice(0, separator).trim(), part.slice(separator + 1).trim()];
    }),
  );
  const timestamp = signatureParts.get("ts") ?? "";
  const receivedSignature = signatureParts.get("v1") ?? "";
  if (!/^\d{10,13}$/.test(timestamp) || !receivedSignature) {
    return { valid: false, status: 401, code: "INVALID_WEBHOOK_SIGNATURE_FORMAT" };
  }

  const numericTimestamp = Number(timestamp);
  const timestampMs = timestamp.length === 10 ? numericTimestamp * 1000 : numericTimestamp;
  if (!Number.isFinite(timestampMs) || Math.abs(Date.now() - timestampMs) > WEBHOOK_MAX_AGE_MS) {
    return { valid: false, status: 401, code: "EXPIRED_WEBHOOK_SIGNATURE" };
  }

  const normalizedId = subscriptionId.toLowerCase();
  const manifest = `id:${normalizedId};request-id:${requestId};ts:${timestamp};`;
  const expectedSignature = crypto
    .createHmac("sha256", WEBHOOK_SECRET)
    .update(manifest)
    .digest("hex");

  if (!safeHexEqual(receivedSignature, expectedSignature)) {
    return { valid: false, status: 401, code: "INVALID_WEBHOOK_SIGNATURE" };
  }

  return { valid: true, mode: "signed" };
}

function isSubscriptionValid(status?: string | null, paymentStatus?: string | null): boolean {
const s = normalizeStatus(status);
const p = normalizeStatus(paymentStatus);
return s === "authorized" || s === "active" || s === "approved" || p === "approved";
}

// ---------------------------------------------------------------------------
// RELEASE-09 — semântica de cancelamento
//
// "Cancelar" significa PARAR DE RENOVAR, nunca "perder agora o período já pago". O modelo de estados
// efetivo (derivado dos campos que já existiam, sem inventar um enum novo):
//
//   ACTIVE_AUTORENEW          subscriptionStatus=authorized/active/approved  + autoRenew=true
//   CANCELLED_UNTIL_PERIOD_END subscriptionStatus=cancelled + autoRenew=false + now < paid-through
//   EXPIRED                   subscriptionStatus=cancelled/expired + now >= paid-through
//   REFUNDED/REVOKED          paymentStatus=refunded/charged_back → revoga IMEDIATAMENTE
//   PENDING                   subscriptionStatus=pending → nunca concede Premium
//
// A propriedade central: `cancelled && now < paid-through` ⇒ Premium continua ativo.
// ---------------------------------------------------------------------------

/**
 * Fim do período JÁ PAGO, sempre server-owned. `premiumExpiresAt` é a fonte preferida (é o campo que
 * o cancelamento congela); `nextBillingAt` é o fallback enquanto a assinatura ainda renova — para o
 * Mercado Pago, a próxima cobrança é exatamente onde o período atual termina.
 *
 * Retorna `null` quando nenhuma das duas datas é utilizável. Esse `null` é um fallback deliberadamente
 * CONSERVADOR (§10 legacy): um documento antigo, já cancelado e sem nenhuma data, não ganha Premium
 * retroativo — permanece exatamente como estava antes do RELEASE-09.
 */
export function resolvePaidThroughDate(planData: any): Date | null {
  return toDateOrNull(planData?.premiumExpiresAt) ?? toDateOrNull(planData?.nextBillingAt);
}

/**
 * Estorno/chargeback: o dinheiro do período voltou para o usuário, então o acesso pode ser retirado
 * na hora, sem esperar o fim do período. `rejected` NÃO entra aqui — é uma tentativa de cobrança que
 * falhou (renovação futura), não um estorno do período corrente.
 */
export function isRevokingPaymentStatus(paymentStatus?: string | null): boolean {
  const p = normalizeStatus(paymentStatus);
  return p === "refunded" || p === "charged_back" || p === "chargeback";
}

/** Comparação sempre em instante absoluto (epoch), nunca em string local — o fuso do servidor não
 * pode mudar o veredito de quem ainda tem acesso. */
export function isWithinPaidPeriod(planData: any, now: Date = new Date()): boolean {
  const paidThrough = resolvePaidThroughDate(planData);
  return Boolean(paidThrough && now.getTime() < paidThrough.getTime());
}

/** A assinatura está em um estado que ainda gera cobranças futuras? É isto — e não `premiumActive` —
 * que define `autoRenew`: uma assinatura cancelada dentro do período pago mantém o Premium, mas nunca
 * volta a renovar. */
function isRenewingSubscriptionStatus(status?: string | null): boolean {
  const s = normalizeStatus(status);
  return s === "authorized" || s === "active" || s === "approved";
}

function isRecentPending(planData: any): boolean {
if (!planData?.subscriptionStatus || normalizeStatus(planData.subscriptionStatus) !== "pending") return false;
const updatedAt = planData?.updatedAt?.toDate?.() ?? planData?.updatedAt ?? null;
if (!updatedAt) return true;
const updated = new Date(updatedAt);
if (Number.isNaN(updated.getTime())) return true;
return Date.now() - updated.getTime() < 15 * 60 * 1000;
}

function shouldBlockNewSubscription(planData: any): { blocked: boolean; reason: string } {
if (!planData) return { blocked: false, reason: "no_plan_data" };
if (planData.premiumActive) return { blocked: true, reason: "premium_active_true" };
if (isSubscriptionValid(planData.subscriptionStatus, planData.paymentStatus)) {
return { blocked: true, reason: "existing_valid_subscription_or_payment" };
}
if (isRecentPending(planData)) return { blocked: true, reason: "recent_pending_subscription" };
return { blocked: false, reason: "no_block" };
}

function shouldPreserveExistingPremium(existingData: any, nextStatus: SubscriptionStatus) {
if (!existingData) return false;
if (existingData?.premiumOverride === true) return true;
if (isSubscriptionValid(existingData.subscriptionStatus, existingData.paymentStatus)) return true;
if (nextStatus === "pending" && (existingData.premiumActive || isSubscriptionValid(existingData.subscriptionStatus, existingData.paymentStatus))) return true;
return false;
}

function buildExistingSubscriptionResponse(planData: any, blockReason: string) {
return {
status: "existing",
message: "Você já possui uma assinatura válida ou em processamento.",
subscriptionId: planData?.subscriptionId ?? null,
subscriptionStatus: planData?.subscriptionStatus ?? null,
paymentStatus: planData?.paymentStatus ?? null,
premiumActive: !!planData?.premiumActive,
currentPlan: planData?.currentPlan ?? "free",
blockReason,
};
}
function isAdminUser(userData: any): boolean {
  return userData?.role === "admin";
}
/**

NOTE: Removed PreApprovalPlan creation — Mercado Pago SDK simplification.

PreApproval.create() with auto_recurring works without needing a separate plan.

This avoids conflicts between plan config and PreApproval config.
*/


/**

Reconcile premium activation status based on subscription and payment status.

Premium is active when subscription is authorized/active/approved OR payment is approved.
*/
function reconcilePremiumStatus(
subscriptionStatus: SubscriptionStatus | null,
paymentStatus: string | null | undefined,
existingData?: any
): { premiumActive: boolean; reason: string } {
// 🚫 PRIORIDADE MÁXIMA — ADMIN BLOQUEOU
if (existingData?.premiumBlocked === true) {
return { premiumActive: false, reason: "admin_blocked" };
}
const s = normalizeStatus(subscriptionStatus);
const p = normalizeStatus(paymentStatus);


const now = new Date();

// 🥇 PRIORIDADE 1 — ADMIN / RECOMPENSA (NUNCA SOBRESCREVE)
if (existingData?.premiumOverride === true) {
return { premiumActive: true, reason: "admin_override" };
}

// 🚫 RELEASE-09 — ESTORNO/CHARGEBACK REVOGA IMEDIATAMENTE
// Vem antes de qualquer ativação por status: se o pagamento do período foi devolvido, não existe
// período pago para preservar.
if (isRevokingPaymentStatus(paymentStatus)) {
return { premiumActive: false, reason: "payment_refunded" };
}

// 🥈 PRIORIDADE 2 — PAGAMENTO (MERCADO PAGO)
if (s === "authorized" || s === "active" || s === "approved") {
return { premiumActive: true, reason: "subscription_active" };
}

// RELEASE-09: uma assinatura cancelada/pausada/expirada é um estado TERMINAL — quem decide se ainda
// há acesso é o período pago (logo abaixo), nunca o `paymentStatus` do último ciclo. Sem esta
// ressalva, o "approved" da última cobrança bem-sucedida continuaria concedendo Premium para sempre,
// mesmo muito depois do período acabar.
const subscriptionTerminated = s === "cancelled" || s === "paused" || s === "expired";

if (p === "approved" && !subscriptionTerminated) {
return { premiumActive: true, reason: "payment_approved" };
}

// PLAN-IMPL-03 §4/§13 — trial NUNCA é considerado aqui: esta função reconcilia o plano BASE a partir
// de um evento de assinatura/pagamento real, e trial é puramente EFFECTIVE-only (nunca grava
// currentPlan/premiumActive/premiumSource — ver shared/monetization.ts `resolveCommercialPlan`, que já
// aplica o boost de trial por cima do resultado desta função, sempre, em todo o resto do app). O antigo
// branch de trial aqui (campos `trialActive`/`trialEndsAt`, nunca alcançável em produção — nenhuma
// chamada real jamais escreveu esses campos, ver PLAN-IMPL-03_REPORT) foi removido, não substituído.

// 🔄 FALLBACK (evita perder premium por erro temporário)


// ✅ RELEASE-09 — CANCELADA, MAS AINDA DENTRO DO PERÍODO JÁ PAGO
// Cancelar interrompe a renovação; não devolve o dinheiro do período corrente. Enquanto esse período
// não termina, o acesso continua. Só `cancelled` recebe essa carência: `paused`/`expired` descrevem
// uma assinatura que já não tem período válido em curso.
if (s === "cancelled" && isWithinPaidPeriod(existingData, now)) {
return { premiumActive: true, reason: "cancelled_within_paid_period" };
}

// ❌ CANCELAMENTOS / EXPIRAÇÕES
if (subscriptionTerminated) {
return { premiumActive: false, reason: "subscription_inactive" };
}

if (s === "pending") {
return { premiumActive: false, reason: "subscription_pending" };
}

// ❌ DEFAULT
return { premiumActive: false, reason: "no_subscription" };
}
/** Só para testes (script/subscription-cancel-tests.ts): expõe a reconciliação pura sem precisar de
 * Firestore, para cobrir fronteiras de data e documentos legados. */
export const reconcilePremiumStatusForTests = reconcilePremiumStatus;
/** PLAN-IMPL-03 — mesmo padrão de reconcilePremiumStatusForTests: expõe syncPlanDataFromSubscription
 * (privada) só para script/plan-impl-03-trial-lifecycle-tests.ts cobrir a marcação trialStatus="converted"
 * quando uma assinatura real ativa durante um trial em curso, sem duplicar a lógica em código de teste. */
export const syncPlanDataFromSubscriptionForTests = syncPlanDataFromSubscription;

/**

Update user's planData in Firestore based on subscription and payment status.
*/

// PLAN-IMPL-03 — `applyTrialIfEligible` (concedia trial escrevendo currentPlan/premiumActive/premiumSource
// diretamente, e só era chamada do branch `!planSnap.exists` da rota de status abaixo, nunca alcançável em
// produção — ver PLAN-IMPL-03_REPORT) foi removida. A concessão real agora vive em
// server/plan-lifecycle.ts `computeTrialGrantFields`, chamada de dentro da transação atômica de
// `/api/plan/initialize/:userId` (server/routes.ts) — o único caminho que o app realmente dispara no
// primeiro login — e nunca escreve nos campos de plano BASE (ver o comentário em reconcilePremiumStatus
// acima).

type SubscriptionSyncSource = "webhook" | "sync-now" | "manual";
type SubscriptionSyncContext = {
  eventId?: string | null;
  eventOccurredAt?: Date | string | number | null;
  source?: SubscriptionSyncSource;
};
type SubscriptionSyncResult = {
  applied: boolean;
  reason: "applied" | "duplicate_event" | "stale_event";
  premiumActive?: boolean;
};

function toDateOrNull(value: unknown): Date | null {
  if (!value) return null;
  const rawValue = typeof (value as any)?.toDate === "function" ? (value as any).toDate() : value;
  const date = rawValue instanceof Date ? rawValue : new Date(rawValue as any);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isDuplicateSubscriptionEvent(existingData: any, eventId?: string | null): boolean {
  return Boolean(eventId && existingData?.lastSubscriptionEventId === eventId);
}

function isOlderSubscriptionEvent(existingData: any, eventOccurredAt?: Date | null): boolean {
  const existingEventDate = toDateOrNull(existingData?.lastSubscriptionEventAt);
  if (!existingEventDate || !eventOccurredAt) return false;
  return eventOccurredAt.getTime() < existingEventDate.getTime();
}

function getSubscriptionWebhookTimestamp(req: Request): Date | null {
  const signatureHeader = getSingleHeader(req, "x-signature");
  const timestampPart = signatureHeader
    .split(",")
    .map((part) => part.trim())
    .find((part) => part.startsWith("ts="));
  const timestamp = timestampPart?.slice(3) ?? "";
  if (!/^\d{10,13}$/.test(timestamp)) return null;
  const numericTimestamp = Number(timestamp);
  const timestampMs = timestamp.length === 10 ? numericTimestamp * 1000 : numericTimestamp;
  return Number.isFinite(timestampMs) ? new Date(timestampMs) : null;
}

function extractMercadoPagoSubscriptionEventDate(mpSub: any, fallbackDate?: Date | null): Date | null {
  return (
    toDateOrNull(mpSub?.last_modified) ??
    toDateOrNull(mpSub?.date_last_updated) ??
    toDateOrNull(mpSub?.date_updated) ??
    toDateOrNull(mpSub?.date_created) ??
    fallbackDate ??
    null
  );
}

function buildSubscriptionEventId(req: Request, body: any, subscriptionId: string): string | null {
  const requestId = getSingleHeader(req, "x-request-id").trim();
  const rawNotificationId = body?.id;
  const notificationId = typeof rawNotificationId === "string" || typeof rawNotificationId === "number"
    ? String(rawNotificationId).trim()
    : "";
  const action = typeof body?.action === "string" ? body.action.trim() : "";
  const type = typeof body?.type === "string" ? body.type.trim() : "";
  const parts = [notificationId, action, type, requestId].filter(Boolean);
  if (parts.length > 0) return parts.join(":");
  return subscriptionId ? `preapproval:${subscriptionId}` : null;
}

async function syncPlanDataFromSubscription(
uid: string,
subscriptionId: string,
subscriptionStatus: SubscriptionStatus,
paymentStatus?: string,
nextBillingDate?: string | null,
mercadoPagoPaymentId?: string | null,
eventContext: SubscriptionSyncContext = {},
): Promise<SubscriptionSyncResult> {
const admin = getFirebaseAdmin();
const db = admin.firestore();
const planRef = db.collection("users").doc(uid).collection("planData").doc("main");

const existingSnap = await planRef.get();
const existingData = existingSnap.data();
const eventId = eventContext.eventId?.trim() || null;
const eventOccurredAt = toDateOrNull(eventContext.eventOccurredAt);

if (isDuplicateSubscriptionEvent(existingData, eventId)) {
  subInfo("[syncPlanDataFromSubscription] duplicate_event", {
    subscriptionId: maskMercadoPagoExternalId(subscriptionId),
    eventId: maskMercadoPagoExternalId(eventId),
    source: eventContext.source ?? "manual",
  });
  return { applied: false, reason: "duplicate_event" };
}

if (isOlderSubscriptionEvent(existingData, eventOccurredAt)) {
  subInfo("[syncPlanDataFromSubscription] stale_event", {
    subscriptionId: maskMercadoPagoExternalId(subscriptionId),
    eventId: maskMercadoPagoExternalId(eventId),
    source: eventContext.source ?? "manual",
  });
  return { applied: false, reason: "stale_event" };
}

const premiumReconciliation = reconcilePremiumStatus(
subscriptionStatus,
paymentStatus,
existingData
);

const premiumActive = premiumReconciliation.premiumActive;

// RELEASE-09: autoRenew descreve a RENOVAÇÃO FUTURA, e por isso deriva do status da assinatura —
// nunca de `premiumActive`. Uma assinatura cancelada dentro do período pago mantém o Premium com
// autoRenew=false; derivar de `premiumActive` religaria a renovação de uma assinatura já cancelada.
const subscriptionRenewing = isRenewingSubscriptionStatus(subscriptionStatus);

const update: Record<string, any> = {
  billingProvider: "mercado_pago",
  subscriptionId,
  subscriptionStatus,
  paymentStatus: paymentStatus ?? null,
  mercadoPagoPaymentId: mercadoPagoPaymentId ?? null,
  premiumActive,
  currentPlan: premiumActive ? "premium" : "free",
  autoRenew: subscriptionRenewing,
  updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  lastSubscriptionSyncSource: eventContext.source ?? "manual",
};

if (eventId) update.lastSubscriptionEventId = eventId;
if (eventOccurredAt) update.lastSubscriptionEventAt = eventOccurredAt;

// ✅ AGORA SIM — fora do objeto
// PLAN-IMPL-03: o antigo `&& !existingData?.trialActive` foi removido — trial nunca mais grava esse
// campo (ver reconcilePremiumStatus acima), então a condição era sempre verdadeira na prática; uma
// assinatura real que ativa DEVE poder marcar premiumSource="subscription" mesmo com um trial ainda em
// curso (o trial em si é rastreado à parte, marcado "converted" logo abaixo, nunca bloqueado por isto).
if (premiumActive && !existingData?.premiumOverride) {
  update.premiumSource = "subscription";
}
// PLAN-IMPL-03 §15 — assinatura paga real ativou enquanto o trial ainda contava como ativo: o trial
// nunca deve "reaparecer" depois (ex.: se a assinatura for cancelada mais tarde dentro do período pago
// e o trial, coincidentemente, ainda não tivesse expirado) — marcado "converted" uma vez, permanece
// assim para sempre (isTrialCurrentlyActive em shared/monetization.ts só considera 'active', nunca
// 'converted', então isto já é suficiente para nunca mais contribuir para o plano efetivo).
if (premiumActive && existingData?.trialStatus === "active") {
  update.trialStatus = "converted";
}
subInfo(`[syncPlanDataFromSubscription] subscriptionStatus=${subscriptionStatus}`);
subInfo(`[syncPlanDataFromSubscription] paymentStatus=${paymentStatus ?? "null"}`);
subInfo(`[syncPlanDataFromSubscription] premiumActive=${premiumActive}`);
subInfo(`[syncPlanDataFromSubscription] reason=${premiumReconciliation.reason}`);

if (premiumActive) {
if (!existingData?.premiumStartedAt) {
  update.premiumStartedAt = admin.firestore.FieldValue.serverTimestamp();
}

if (subscriptionRenewing) {
  // Renovando: o período é aberto (não há data de término conhecida) e o fim do ciclo atual é
  // sempre a próxima cobrança. Uma renovação bem-sucedida cai aqui e estende o acesso.
  update.premiumExpiresAt = null;
  update.canceledAt = null;
  update.lastPaymentAt = admin.firestore.FieldValue.serverTimestamp();

  if (nextBillingDate) {
    update.nextBillingAt = new Date(nextBillingDate);
  }
} else {
  // RELEASE-09: cancelada no provider, mas ainda dentro do período pago. Congela o fim do período
  // em `premiumExpiresAt` para que ele não dependa mais de `nextBillingAt` (que o Mercado Pago para
  // de atualizar depois do cancelamento) e nunca reabre a renovação.
  const paidThrough = resolvePaidThroughDate(existingData);
  if (paidThrough) update.premiumExpiresAt = paidThrough;
  if (!existingData?.canceledAt) {
    update.canceledAt = admin.firestore.FieldValue.serverTimestamp();
  }
}

} else {
if (["cancelled", "paused"].includes(normalizeStatus(subscriptionStatus))) {
if (!existingData?.canceledAt) {
  update.canceledAt = admin.firestore.FieldValue.serverTimestamp();
}
}

// RELEASE-09: o acesso terminou (estorno, expiração ou pausa). Materializa um `premiumExpiresAt`
// no passado para que os leitores baseados em data — `isPremiumActive()` em shared/monetization.ts,
// consumido por server/marketing-pro.ts e pela UI — também vejam o fim, em vez de dependerem só do
// booleano `premiumActive`. Uma data que JÁ é passada é preservada (auditoria fiel do fim real).
const existingPaidThrough = resolvePaidThroughDate(existingData);
const hadSubscriptionEntitlement =
  existingData?.premiumActive === true ||
  existingData?.currentPlan === "premium" ||
  existingData?.premiumSource === "subscription";

if (hadSubscriptionEntitlement && (!existingPaidThrough || existingPaidThrough.getTime() > Date.now())) {
  update.premiumExpiresAt = new Date();
}
}

await planRef.set(update, { merge: true });
return { applied: true, reason: "applied", premiumActive };
}

// ---------------------------------------------------------------------------
// Global Config Management (system/config)
// ---------------------------------------------------------------------------

export async function getGlobalConfig(): Promise<GlobalConfig> {
try {
const admin = getFirebaseAdmin();
const db = admin.firestore();
const configRef = db.collection("system").doc("config");
const configSnap = await configRef.get();

if (!configSnap.exists) {
  return DEFAULT_GLOBAL_CONFIG;
}

const data = configSnap.data();
return {
  premiumOpenAccess: data?.premiumOpenAccess ?? false,
  premiumOpenAccessUntil: data?.premiumOpenAccessUntil?.toDate() ?? null,
  premiumOpenAccessMessage: data?.premiumOpenAccessMessage ?? null,
};

} catch (error) {
subLogError("[getGlobalConfig] Error:", error);
return DEFAULT_GLOBAL_CONFIG;
}
}

export async function setGlobalConfig(config: GlobalConfig): Promise<void> {
const admin = getFirebaseAdmin();
const db = admin.firestore();
const configRef = db.collection("system").doc("config");

await configRef.set({
premiumOpenAccess: config.premiumOpenAccess,
premiumOpenAccessUntil: config.premiumOpenAccessUntil ? new Date(config.premiumOpenAccessUntil) : null,
premiumOpenAccessMessage: config.premiumOpenAccessMessage,
updatedAt: admin.firestore.FieldValue.serverTimestamp(),
}, { merge: true });
}

// ---------------------------------------------------------------------------
// Route Registration
// ---------------------------------------------------------------------------

export function registerSubscriptionRoutes(
  app: Express,
  requireAuth: (req: Request, res: Response, next: any) => void
) {

  // ✅ ADMIN ROUTE (AGORA NO LUGAR CERTO)
  app.post("/api/admin/premium/grant", requireAuth, subscriptionMutationRateLimit, async (req: Request, res: Response) => {
    const uid = req.body.uid;

    if ((req as any).userRole !== "admin") {
      return res.status(403).json({ error: "NOT_AUTHORIZED" });
    }

    const admin = getFirebaseAdmin();
    const db = admin.firestore();

    await db.collection("users").doc(uid).collection("planData").doc("main").set({
      premiumOverride: true,
      premiumBlocked: false,
      premiumActive: true,
      currentPlan: "premium",
      premiumSource: "admin",
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    return res.json({ success: true });
  });


  // ✅ CREATE SUBSCRIPTION
  app.post("/api/app-subscription/create", requireAuth, subscriptionCreateRateLimit, async (req: Request, res: Response) => {
    const uid = (req as any).firebaseUid as string;

subInfo("[subscriptions/create] Request received");

    if (sendSubscriptionCredentialError(res, "create", uid)) return;

    try {
      const admin = getFirebaseAdmin();
      const db = admin.firestore();
      const planRef = db.collection("users").doc(uid).collection("planData").doc("main");
      const planSnap = await planRef.get();
      const existingData = planSnap.data();

      const block = shouldBlockNewSubscription(existingData);

      if (block.blocked) {
        return res.status(200).json(buildExistingSubscriptionResponse(existingData, block.reason));
      }

      const userRecord = await admin.auth().getUser(uid);
      const userEmail = userRecord.email ?? "";

      const preApproval = new PreApproval(mpClient);
    const response = await preApproval.create({
  body: {
    reason: PREMIUM_PLAN_NAME,

    external_reference: uid,

    payer_email: userEmail,

    auto_recurring: {
      frequency: 1,
      frequency_type: "months",
      transaction_amount: PREMIUM_PRICE_BRL,
      currency_id: "BRL",
    },

    back_url: `${FRONTEND_URL}/subscribe`,
    status: "pending",
  }
});

      await planRef.set({
  billingProvider: "mercado_pago",
  subscriptionId: response.id,
  subscriptionStatus: "pending",
  updatedAt: admin.firestore.FieldValue.serverTimestamp(),
}, { merge: true });

     return res.json({
  subscriptionId: response.id,
  initPoint: response.init_point,
  status: "pending",
});

    } catch (error) {
  const msg = error instanceof Error ? error.message : String(error);
  logSubError("create_subscription", uid, msg, {
    errorName: error instanceof Error ? error.name : "UnknownError",
  });

  return res.status(500).json({
    error: "SUBSCRIPTION_CREATE_ERROR",
    message: "Não foi possível iniciar a assinatura agora. Tente novamente em instantes.",
  });
}
});

  // ✅ CANCEL
  app.post("/api/app-subscription/cancel", requireAuth, subscriptionMutationRateLimit, async (req: Request, res: Response) => {
    const uid = (req as any).firebaseUid as string;

    try {
      const admin = getFirebaseAdmin();
      const db = admin.firestore();
      const planRef = db.collection("users").doc(uid).collection("planData").doc("main");
      const planSnap = await planRef.get();
      const planData = planSnap.data();

      // RELEASE-16 §6: isolamento de provider — este endpoint só cancela assinaturas do Mercado Pago.
      // Uma assinatura cuja evidência authoritative é Google Play nunca deve ser tocada por aqui, mesmo
      // que (por bug futuro) `subscriptionId` também esteja presente.
      if (planData?.billingProvider === "google_play") {
        return res.status(409).json({ error: "SUBSCRIPTION_MANAGED_BY_GOOGLE_PLAY" });
      }

      if (!planData?.subscriptionId) {
        return res.status(404).json({ error: "NO_SUBSCRIPTION" });
      }

      // RELEASE-09: cancelar = parar de renovar, preservando o período JÁ PAGO. O fim desse período é
      // resolvido ANTES de qualquer escrita, e nunca é encurtado por este endpoint.
      const paidThrough = resolvePaidThroughDate(planData);
      const stillWithinPaidPeriod = Boolean(paidThrough && Date.now() < paidThrough.getTime());

      const buildCancelResponse = (idempotent: boolean) => ({
        success: true,
        status: "cancelled" as const,
        ...(idempotent ? { idempotent: true } : {}),
        premiumActive: stillWithinPaidPeriod,
        currentPlan: stillWithinPaidPeriod ? "premium" : "free",
        premiumExpiresAt: paidThrough ? paidThrough.toISOString() : null,
        autoRenew: false,
      });

      // Idempotente: repetir o cancelamento devolve o mesmo estado e nunca reduz o período pago.
      if (normalizeStatus(planData.subscriptionStatus) === "cancelled") {
        return res.json(buildCancelResponse(true));
      }

      if (sendSubscriptionCredentialError(res, "cancel", uid)) return;

      const preApproval = new PreApproval(mpClient);
      await preApproval.update({
        id: planData.subscriptionId,
        body: { status: "cancelled" },
      });

      const cancelUpdate: Record<string, any> = {
        billingProvider: "mercado_pago",
        subscriptionStatus: "cancelled",
        // A renovação futura para imediatamente — este é o efeito real de "cancelar".
        autoRenew: false,
        canceledAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      if (stillWithinPaidPeriod) {
        // O acesso continua até o fim do período pago; a data fica congelada em `premiumExpiresAt`
        // para não depender mais de `nextBillingAt` (que o provider deixa de atualizar).
        cancelUpdate.premiumActive = true;
        cancelUpdate.currentPlan = "premium";
        cancelUpdate.premiumExpiresAt = paidThrough;
      } else {
        // Sem período pago em curso (ou legado sem nenhuma data conhecida): comportamento conservador,
        // idêntico ao anterior — vira Free na hora.
        cancelUpdate.premiumActive = false;
        cancelUpdate.currentPlan = "free";
        if (paidThrough) cancelUpdate.premiumExpiresAt = paidThrough;
      }

      await planRef.set(cancelUpdate, { merge: true });

      subInfo("[subscriptions/cancel] cancelled", {
        uid,
        stillWithinPaidPeriod,
        premiumExpiresAt: paidThrough ? paidThrough.toISOString() : null,
      });

      return res.json(buildCancelResponse(false));

    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logSubError("cancel_subscription", uid, msg, {
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
      return res.status(500).json({
        error: "SUBSCRIPTION_CANCEL_ERROR",
        message: "Não foi possível cancelar a assinatura agora. Tente novamente em instantes.",
      });
    }
  });


  // ✅ STATUS
  app.get("/api/app-subscription/status", requireAuth, subscriptionStatusRateLimit, async (req: Request, res: Response) => {
    const uid = (req as any).firebaseUid as string;

    try {
      const admin = getFirebaseAdmin();
      const db = admin.firestore();
      const planRef = db.collection("users").doc(uid).collection("planData").doc("main");
      const planSnap = await planRef.get();

     if (!planSnap.exists) {
  // PLAN-IMPL-03 — concessão de trial não vive mais aqui (§10/§11: "planData ausente" sozinho nunca
  // foi um sinal confiável de "conta nova"; ver server/routes.ts `/api/plan/initialize`, que já roda no
  // primeiro login real e é quem de fato concede). Esta rota não tem nenhum chamador no client hoje
  // (confirmado em auditoria) — mantida honesta: sem doc, sem trial, só o estado Free padrão.
  return res.json({
    premiumActive: false,
    currentPlan: "free",
  });
}

      const data = planSnap.data();
const premiumReconciliation = reconcilePremiumStatus(
  data?.subscriptionStatus ?? null,
  data?.paymentStatus ?? null,
  data
)

const premiumActive = premiumReconciliation.premiumActive;
const needsSync =
  data?.subscriptionId &&
  (
    premiumActive !== !!data?.premiumActive ||
    data?.currentPlan !== (premiumActive ? "premium" : "free")
  );
      const paidThrough = resolvePaidThroughDate(data);
      return res.json({
        subscriptionId: data?.subscriptionId ?? null,
        subscriptionStatus: data?.subscriptionStatus ?? null,
       premiumActive,
currentPlan: premiumActive ? "premium" : "free",
        // RELEASE-09: a UI precisa distinguir "cancelada mas ativa até DD/MM" de "Free".
        autoRenew: isRenewingSubscriptionStatus(data?.subscriptionStatus),
        premiumExpiresAt: paidThrough ? paidThrough.toISOString() : null,
      });

    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logSubError("subscription_status", uid, msg, {
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
      return res.status(500).json({
        error: "SUBSCRIPTION_STATUS_ERROR",
        message: "Não foi possível carregar a assinatura agora. Tente novamente em instantes.",
      });
    }
  });

  // ✅ SYNC NOW
  app.post("/api/app-subscription/sync-now", requireAuth, subscriptionMutationRateLimit, async (req: Request, res: Response) => {
    const uid = (req as any).firebaseUid as string;

    try {
      const admin = getFirebaseAdmin();
      const db = admin.firestore();
      const planRef = db.collection("users").doc(uid).collection("planData").doc("main");
      const planSnap = await planRef.get();
      const planData = planSnap.data();

      if (!planData?.subscriptionId) {
        return res.status(404).json({ error: "NO_SUBSCRIPTION" });
      }

      if (sendSubscriptionCredentialError(res, "sync-now", uid)) return;

      const preApproval = new PreApproval(mpClient);
      const mpSub = await preApproval.get({ id: planData.subscriptionId });
      const externalReference = (mpSub as any).external_reference ?? null;

      if (externalReference && String(externalReference) !== uid) {
        subWarn("[subscriptions/sync-now] Rejected ownership mismatch", {
          uid,
          subscriptionId: maskMercadoPagoExternalId(planData.subscriptionId),
        });
        return res.status(403).json({ error: "SUBSCRIPTION_OWNERSHIP_MISMATCH" });
      }

      const status = (mpSub.status ?? planData.subscriptionStatus ?? "pending") as SubscriptionStatus;
      const paymentStatus =
        (mpSub as any).first_payment_status ||
        ((mpSub as any).payer_id ? "approved" : undefined);
      const nextBillingDate = (mpSub as any).next_payment_date ?? null;
      const mercadoPagoPaymentId = (mpSub as any).payment_id ?? null;

      const syncResult = await syncPlanDataFromSubscription(
        uid,
        planData.subscriptionId,
        status,
        paymentStatus,
        nextBillingDate,
        mercadoPagoPaymentId,
        { source: "sync-now" },
      );

      return res.json({
        success: true,
        subscriptionId: planData.subscriptionId,
        subscriptionStatus: status,
        paymentStatus: paymentStatus ?? null,
        applied: syncResult.applied,
        reason: syncResult.reason,
        premiumActive: syncResult.premiumActive ?? null,
      });

    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logSubError("subscription_sync_now", uid, msg, {
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
      return res.status(500).json({
        error: "SUBSCRIPTION_SYNC_ERROR",
        message: "Não foi possível sincronizar a assinatura agora. Tente novamente em instantes.",
      });
    }
  });
app.post("/api/app-subscription/webhook", subscriptionWebhookRateLimit, async (req: Request, res: Response) => {
  try {
    if (!WEBHOOK_SECRET) {
      subLogError("[subscriptions/webhook] Rejected: webhook secret is not configured");
      return res.status(401).json({ error: "INVALID_WEBHOOK_SIGNATURE" });
    }

    const body = req.body || {};
    const rawSubscriptionId = body?.data?.id || body?.id || null;
    const subscriptionId =
      typeof rawSubscriptionId === "string" || typeof rawSubscriptionId === "number"
        ? String(rawSubscriptionId).trim()
        : "";

    if (!subscriptionId) {
      return res.status(400).json({ error: "MISSING_ID" });
    }

    const signatureResult = validateSubscriptionWebhookSignature(req, subscriptionId);
    if (!signatureResult.valid) {
      subWarn("[subscriptions/webhook] Rejected notification", {
        code: signatureResult.code,
      });
      return res.status(signatureResult.status).json({ error: signatureResult.code });
    }

    if (sendSubscriptionCredentialError(res, "webhook", null)) return;

    const signatureTimestamp = getSubscriptionWebhookTimestamp(req);
    const eventId = buildSubscriptionEventId(req, body, subscriptionId);
    const preApproval = new PreApproval(mpClient);
    const mpSub = await preApproval.get({ id: subscriptionId });

    const uid = (mpSub as any).external_reference ?? null;

    if (!uid) {
      return res.status(200).json({ ok: true, skipped: true });
    }

    const status = mpSub.status as SubscriptionStatus;
    const paymentStatus =
      (mpSub as any).first_payment_status ||
      ((mpSub as any).payer_id ? "approved" : undefined);

    const nextBillingDate = (mpSub as any).next_payment_date ?? null;
    const mercadoPagoPaymentId = (mpSub as any).payment_id ?? null;
    const eventOccurredAt = extractMercadoPagoSubscriptionEventDate(mpSub, signatureTimestamp);

    const syncResult = await syncPlanDataFromSubscription(
      uid,
      subscriptionId,
      status,
      paymentStatus,
      nextBillingDate,
      mercadoPagoPaymentId,
      { eventId, eventOccurredAt, source: "webhook" },
    );

    return res.status(200).json({ ok: true, applied: syncResult.applied, reason: syncResult.reason });

  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    logSubError("webhook_processing", null, msg);
    return res.status(500).json({ error: "WEBHOOK_PROCESSING_FAILED" });
  }
});
}
