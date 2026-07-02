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

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const CENTRAL_ACCESS_TOKEN = process.env.MERCADOPAGO_ACCESS_TOKEN?.trim() ?? "";
const WEBHOOK_SECRET = process.env.MERCADOPAGO_WEBHOOK_SECRET?.trim() ?? "";
const WEBHOOK_MAX_AGE_MS = 5 * 60 * 1000;
const APP_BASE_URL = process.env.APP_BASE_URL ?? "https://revendasmart-backend-164193806378.us-central1.run.app";
const FRONTEND_URL = process.env.FRONTEND_URL ?? "https://revendasmart.vercel.app";

// Premium subscription price in BRL (monthly)
const PREMIUM_PRICE_BRL = parseFloat(process.env.PREMIUM_PRICE_BRL ?? "19.90");
const PREMIUM_PLAN_NAME = "RevendaSmart Premium";

console.log("[subscriptions] Initializing module");
console.info(`[subscriptions] Payment credential configured: ${Boolean(CENTRAL_ACCESS_TOKEN)}`);
console.log(`[subscriptions] PREMIUM_PRICE_BRL: ${PREMIUM_PRICE_BRL}`);

const mpClient = new MercadoPagoConfig({
accessToken: CENTRAL_ACCESS_TOKEN,
options: { timeout: 15000 },
});

console.log(`[subscriptions] MercadoPagoConfig created successfully`);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function logSubError(op: string, _uid: string | null, msg: string, ctx?: Record<string, any>) {
const eid = Math.random().toString(36).substring(7);
console.error(`[subscriptions] ERROR-${eid} op=${op}`, {
  errorType: msg ? "operation_failed" : "unknown_error",
  contextKeys: ctx ? Object.keys(ctx) : [],
});
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
    console.error("[subscriptions/webhook] Webhook secret is not configured");
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

// 🥈 PRIORIDADE 2 — PAGAMENTO (MERCADO PAGO)
if (s === "authorized" || s === "active" || s === "approved") {
return { premiumActive: true, reason: "subscription_active" };
}

if (p === "approved") {
return { premiumActive: true, reason: "payment_approved" };
}

// 🥉 PRIORIDADE 3 — TRIAL AUTOMÁTICO
if (existingData?.trialActive && existingData?.trialEndsAt) {
const trialEnd = new Date(
existingData.trialEndsAt?.toDate?.() ?? existingData.trialEndsAt
);

if (!Number.isNaN(trialEnd.getTime()) && now < trialEnd) {  
  return { premiumActive: true, reason: "trial_active" };  
}

}

// 🔄 FALLBACK (evita perder premium por erro temporário)


// ❌ CANCELAMENTOS / EXPIRAÇÕES
if (s === "cancelled" || s === "paused" || s === "expired") {
return { premiumActive: false, reason: "subscription_inactive" };
}

if (s === "pending") {
return { premiumActive: false, reason: "subscription_pending" };
}

// ❌ DEFAULT
return { premiumActive: false, reason: "no_subscription" };
}
/**

Update user's planData in Firestore based on subscription and payment status.
*/


async function applyTrialIfEligible(uid: string, existingData: any) {
const admin = getFirebaseAdmin();
const db = admin.firestore();
const planRef = db.collection("users").doc(uid).collection("planData").doc("main");

// já tem trial → não aplica de novo
if (existingData?.trialUsed) return;

// já é premium → não aplica
if (existingData?.premiumActive) return;

const trialDays = 7;
const trialEndsAt = new Date();
trialEndsAt.setDate(trialEndsAt.getDate() + trialDays);

console.info("[trial] Applying eligible trial");

await planRef.set({
trialActive: true,
trialUsed: true, // 🔒 trava 1x por usuário
trialEndsAt,
premiumSource: "trial",
premiumActive: true,
currentPlan: "premium",
updatedAt: admin.firestore.FieldValue.serverTimestamp(),
}, { merge: true });
}
async function syncPlanDataFromSubscription(
uid: string,
subscriptionId: string,
subscriptionStatus: SubscriptionStatus,
paymentStatus?: string,
nextBillingDate?: string | null,
mercadoPagoPaymentId?: string | null
) {
const admin = getFirebaseAdmin();
const db = admin.firestore();
const planRef = db.collection("users").doc(uid).collection("planData").doc("main");

const existingSnap = await planRef.get();
const existingData = existingSnap.data();

const premiumReconciliation = reconcilePremiumStatus(
subscriptionStatus,
paymentStatus,
existingData
);

const premiumActive = premiumReconciliation.premiumActive;

const update: Record<string, any> = {
  subscriptionId,
  subscriptionStatus,
  paymentStatus: paymentStatus ?? null,
  mercadoPagoPaymentId: mercadoPagoPaymentId ?? null,
  premiumActive,
  currentPlan: premiumActive ? "premium" : "free",
  autoRenew: premiumActive,
  updatedAt: admin.firestore.FieldValue.serverTimestamp(),
};

// ✅ AGORA SIM — fora do objeto
if (premiumActive && !existingData?.premiumOverride && !existingData?.trialActive) {
  update.premiumSource = "subscription";
}
console.log(`[syncPlanDataFromSubscription] subscriptionStatus=${subscriptionStatus}`);
console.log(`[syncPlanDataFromSubscription] paymentStatus=${paymentStatus ?? "null"}`);
console.log(`[syncPlanDataFromSubscription] premiumActive=${premiumActive}`);
console.log(`[syncPlanDataFromSubscription] reason=${premiumReconciliation.reason}`);

if (premiumActive) {
update.premiumExpiresAt = null;

if (!existingData?.premiumStartedAt) {  
  update.premiumStartedAt = admin.firestore.FieldValue.serverTimestamp();  
}  

update.lastPaymentAt = admin.firestore.FieldValue.serverTimestamp();  
update.canceledAt = null;  

if (nextBillingDate) {  
  update.nextBillingAt = new Date(nextBillingDate);  
}

} else {
if (["cancelled", "paused"].includes(subscriptionStatus)) {
update.canceledAt = admin.firestore.FieldValue.serverTimestamp();
}
}

await planRef.set(update, { merge: true });
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
console.error("[getGlobalConfig] Error:", error);
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

console.info("[subscriptions/create] Request received");

    if (!CENTRAL_ACCESS_TOKEN) {
      return res.status(500).json({
        error: "MERCADOPAGO_NOT_CONFIGURED",
        message: "Serviço de assinatura não está configurado.",
      });
    }

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

      if (!planData?.subscriptionId) {
        return res.status(404).json({ error: "NO_SUBSCRIPTION" });
      }

      const preApproval = new PreApproval(mpClient);
      await preApproval.update({
        id: planData.subscriptionId,
        body: { status: "cancelled" },
      });

      await planRef.set({
        subscriptionStatus: "cancelled",
        premiumActive: false,
        currentPlan: "free",
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });

      return res.json({ success: true });

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
  await applyTrialIfEligible(uid, null);

  return res.json({
    premiumActive: false,
    currentPlan: "free",
    trialApplied: true,
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
      return res.json({
        subscriptionId: data?.subscriptionId ?? null,
        subscriptionStatus: data?.subscriptionStatus ?? null,
       premiumActive,
currentPlan: premiumActive ? "premium" : "free",
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
app.post("/api/app-subscription/webhook", subscriptionWebhookRateLimit, async (req: Request, res: Response) => {
  try {
    if (!WEBHOOK_SECRET) {
      console.error("[subscriptions/webhook] Rejected: webhook secret is not configured");
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
      console.warn("[subscriptions/webhook] Rejected notification", {
        code: signatureResult.code,
      });
      return res.status(signatureResult.status).json({ error: signatureResult.code });
    }

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

    await syncPlanDataFromSubscription(
      uid,
      subscriptionId,
      status,
      paymentStatus,
      nextBillingDate,
      mercadoPagoPaymentId
    );

    return res.status(200).json({ ok: true });

  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    logSubError("webhook_processing", null, msg);
    return res.status(500).json({ error: "WEBHOOK_PROCESSING_FAILED" });
  }
});
}
