/**
 * RevendaSmart — Payments Module
 *
 * Handles Mercado Pago payment integration.
 * Architecture designed for current one_time payments + future subscriptions.
 *
 * Endpoints:
 *   POST /api/payments/create-link
 *   POST /api/payments/webhook
 *   GET  /api/payments/status/:chargeId
 *   POST /api/payments/resync/:chargeId
 */

import type { Express, NextFunction, Request, Response } from "express";
import * as crypto from "crypto";
import { MercadoPagoConfig, Preference, Payment as MPPayment } from "mercadopago";
import { getFirebaseAdmin } from "./firebase-admin-init";
import {
  findMPConnectionByMerchantId,
  getMPAccessTokenForCharge,
  getValidMPAccessToken,
} from "./mercadopago-connections";
import { logError, logInfo, logWarn } from "./logger";
import {
  type Charge,
  type CreatePaymentLinkInput,
  type MPWebhookPayload,
  buildExternalReference,
  parseExternalReference,
  resolveChargeStatus,
  detectEnvironment,
} from "../shared/charges";

function normalizeDetails(details: unknown[]): unknown {
  if (details.length === 0) return undefined;
  return details.length === 1 ? details[0] : details;
}

function paymentInfo(message: string, ...details: unknown[]): void {
  logInfo("payments.log", { message, details: normalizeDetails(details) });
}

function paymentWarn(message: string, ...details: unknown[]): void {
  logWarn("payments.log", { message, details: normalizeDetails(details) });
}

function paymentLogError(message: string, ...details: unknown[]): void {
  logError("payments.log", undefined, { message, details: normalizeDetails(details) });
}

function logPaymentError(
  operationName: string,
  uid: string | null,
  errorMsg: string,
  context?: Record<string, any>
) {
  logError(`payments.${operationName}`, errorMsg, {
    uid,
    ...(context ?? {}),
  });
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const CENTRAL_ACCESS_TOKEN = process.env.MERCADOPAGO_ACCESS_TOKEN ?? "";
const WEBHOOK_SECRET = process.env.MERCADOPAGO_WEBHOOK_SECRET ?? "";
const APP_BASE_URL = process.env.APP_BASE_URL ?? "https://revendasmart-backend-164193806378.us-central1.run.app";
const FRONTEND_URL = process.env.FRONTEND_URL ?? "https://revendasmart.vercel.app";
const PAYMENT_WEBHOOK_MAX_AGE_MS = 5 * 60 * 1000;
const PAYMENT_RATE_LIMIT_WINDOW_MS = 60 * 1000;
const PAYMENT_RATE_LIMIT_MAX_KEYS = 10_000;

type RateLimitDecision = {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
};

const paymentRateLimitMap = new Map<string, { count: number; resetAt: number }>();

function getClientRateLimitKey(req: Request): string {
  const forwardedFor = req.headers["x-forwarded-for"];
  const firstForwardedFor = Array.isArray(forwardedFor)
    ? forwardedFor[0]
    : forwardedFor?.split(",")[0]?.trim();
  return req.ip ?? firstForwardedFor ?? "unknown";
}

function checkPaymentRateLimit(
  key: string,
  max: number,
  windowMs = PAYMENT_RATE_LIMIT_WINDOW_MS,
): RateLimitDecision {
  const nowMs = Date.now();
  const current = paymentRateLimitMap.get(key);

  if (!current || nowMs > current.resetAt) {
    if (paymentRateLimitMap.size >= PAYMENT_RATE_LIMIT_MAX_KEYS) {
      for (const [entryKey, entry] of Array.from(paymentRateLimitMap.entries())) {
        if (nowMs > entry.resetAt) paymentRateLimitMap.delete(entryKey);
      }
    }
    paymentRateLimitMap.set(key, { count: 1, resetAt: nowMs + windowMs });
    return {
      allowed: true,
      remaining: Math.max(0, max - 1),
      retryAfterSeconds: Math.ceil(windowMs / 1000),
    };
  }

  const retryAfterSeconds = Math.max(1, Math.ceil((current.resetAt - nowMs) / 1000));
  if (current.count >= max) {
    return { allowed: false, remaining: 0, retryAfterSeconds };
  }

  current.count += 1;
  return {
    allowed: true,
    remaining: Math.max(0, max - current.count),
    retryAfterSeconds,
  };
}

function paymentRateLimit(
  max: number,
  keyPrefix: string,
  getKey: (req: Request) => string,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    const key = `${keyPrefix}:${getKey(req)}`;
    const decision = checkPaymentRateLimit(key, max);
    res.setHeader("X-RateLimit-Remaining", String(decision.remaining));

    if (!decision.allowed) {
      res.setHeader("Retry-After", String(decision.retryAfterSeconds));
      return res.status(429).json({ error: "RATE_LIMITED" });
    }

    return next();
  };
}

const paymentWebhookRateLimit = paymentRateLimit(120, "payments:webhook", getClientRateLimitKey);
const paymentCreateLinkRateLimit = paymentRateLimit(
  30,
  "payments:create-link",
  (req) => (req as any).firebaseUid ?? getClientRateLimitKey(req),
);
const paymentStatusRateLimit = paymentRateLimit(
  120,
  "payments:status",
  (req) => (req as any).firebaseUid ?? getClientRateLimitKey(req),
);
const paymentResyncRateLimit = paymentRateLimit(
  30,
  "payments:resync",
  (req) => (req as any).firebaseUid ?? getClientRateLimitKey(req),
);
const paymentDeleteRateLimit = paymentRateLimit(
  30,
  "payments:delete",
  (req) => (req as any).firebaseUid ?? getClientRateLimitKey(req),
);

if (!CENTRAL_ACCESS_TOKEN) {
  paymentWarn("[payments] Central payment credential is not configured");
}

function createPaymentClient(accessToken: string): MPPayment {
  return new MPPayment(new MercadoPagoConfig({
    accessToken,
    options: { timeout: 10000 },
  }));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function now(): string {
  return new Date().toISOString();
}

async function getChargeRef(uid: string, chargeId: string) {
  const admin = getFirebaseAdmin();
  const db = admin.firestore();
  return db.collection("users").doc(uid).collection("charges").doc(chargeId);
}

async function resolveChargeClientSnapshot(
  db: FirebaseFirestore.Firestore,
  uid: string,
  clientId: string,
): Promise<{ clientName?: string; clientPhone?: string }> {
  try {
    const snapshot = await db.collection("users").doc(uid).collection("clients").doc(clientId).get();
    if (!snapshot.exists) return {};

    const data = snapshot.data() ?? {};
    const clientName = typeof data.name === "string" && data.name.trim() ? data.name.trim() : undefined;
    const clientPhone = typeof data.phone === "string" && data.phone.trim() ? data.phone.trim() : undefined;
    return { clientName, clientPhone };
  } catch (err) {
    paymentWarn("[payments/create-link] Could not resolve client snapshot", {
      code: err && typeof err === "object" && "code" in err ? (err as { code?: unknown }).code : "unknown",
    });
    return {};
  }
}

async function updateCharge(
  uid: string,
  chargeId: string,
  updates: Partial<Charge>
): Promise<void> {
  const ref = await getChargeRef(uid, chargeId);
  await ref.update({ ...updates, updatedAt: now() });
}

/** Fetch Charge from Firestore. Returns null if not found. */
async function fetchCharge(uid: string, chargeId: string): Promise<Charge | null> {
  const ref = await getChargeRef(uid, chargeId);
  const doc = await ref.get();
  if (!doc.exists) return null;
  return { id: doc.id, ...doc.data() } as Charge;
}

/**
 * Verify Mercado Pago webhook signature.
 * Header format: x-signature: ts=TIMESTAMP,v1=HMAC_SHA256_HEX
 * Signed payload: id:PAYMENT_ID;request-id:REQUEST_ID;ts:TIMESTAMP
 *
 * @see https://www.mercadopago.com.br/developers/pt/docs/your-integrations/notifications/webhooks
 */
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

function verifyWebhookSignature(req: Request, rawBody: Buffer): boolean {
  if (!WEBHOOK_SECRET) {
    paymentLogError("[payments/webhook] Webhook secret is not configured");
    return false;
  }

  try {
    const xSignature = getSingleHeader(req, "x-signature");
    const xRequestId = getSingleHeader(req, "x-request-id");

    if (!xSignature || !xRequestId) {
      paymentWarn("[payments/webhook] Missing webhook signature headers");
      return false;
    }

    let ts = "";
    let v1 = "";
    for (const rawPart of xSignature.split(",")) {
      const separatorIndex = rawPart.indexOf("=");
      if (separatorIndex < 0) continue;
      const key = rawPart.slice(0, separatorIndex).trim();
      const value = rawPart.slice(separatorIndex + 1).trim();
      if (key === "ts") ts = value;
      if (key === "v1") v1 = value;
    }

    if (!ts || !v1 || !/^\d{10,13}$/.test(ts)) {
      paymentWarn("[payments/webhook] Invalid x-signature format");
      return false;
    }

    const timestampMs = ts.length === 10 ? Number(ts) * 1000 : Number(ts);
    if (!Number.isFinite(timestampMs) || Math.abs(Date.now() - timestampMs) > PAYMENT_WEBHOOK_MAX_AGE_MS) {
      paymentWarn("[payments/webhook] Expired webhook signature timestamp");
      return false;
    }

    const body = JSON.parse(rawBody.toString());
    const rawDataId = body?.data?.id;
    const dataId = typeof rawDataId === "string" || typeof rawDataId === "number"
      ? String(rawDataId).trim()
      : "";

    if (!dataId) {
      paymentWarn("[payments/webhook] Missing data.id in signed payload");
      return false;
    }

    const manifest = `id:${dataId};request-id:${xRequestId};ts:${ts};`;

    const expectedHash = crypto
      .createHmac("sha256", WEBHOOK_SECRET)
      .update(manifest)
      .digest("hex");

    const isValid = safeHexEqual(v1, expectedHash);
    if (!isValid) {
      paymentWarn("[payments/webhook] Signature mismatch");
    }

    return isValid;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logPaymentError("verify_webhook_signature", null, msg, {
      errorName: err instanceof Error ? err.name : "UnknownError",
    });
    return false;
  }
}

/**
 * Fetch payment details from Mercado Pago and apply to charge in Firestore.
 * Idempotent: only writes if status actually changed or is newer.
 */
async function syncPaymentFromMP(
  uid: string,
  chargeId: string,
  mpPaymentId: string,
  webhookEventId?: string,
  prefetchedPayment?: any,
): Promise<Charge | null> {
  try {
    const charge = await fetchCharge(uid, chargeId);
    if (!charge) {
      paymentWarn("[payments/sync] Charge not found");
      return null;
    }

    let mpData = prefetchedPayment;
    if (!mpData) {
      const tokenSource = charge.tokenSource ?? "central";
      const { accessToken } = await getMPAccessTokenForCharge(
        uid,
        tokenSource,
        charge.mpConnectionId ?? null,
      );
      mpData = await createPaymentClient(accessToken).get({ id: mpPaymentId });
    }
    const paymentReference = parseExternalReference(
      String((mpData as any).external_reference ?? ""),
    );
    if (!paymentReference || paymentReference.uid !== uid || paymentReference.chargeId !== chargeId) {
      throw new Error("PAYMENT_REFERENCE_MISMATCH");
    }

    const rawStatus = (mpData as any).status ?? "pending";
    const newStatus = resolveChargeStatus(rawStatus);

    // Idempotency: skip if this exact event was already processed
    if (webhookEventId && charge.webhookLastEventId === webhookEventId) {
      paymentInfo("[payments/sync] Event already processed — skipping");
      return charge;
    }

    const updates: Partial<Charge> = {
      providerRawStatus: rawStatus,
      status: newStatus,
      mercadoPagoPaymentId: String(mpPaymentId),
      webhookLastEvent: (mpData as any).action ?? "payment.updated",
      webhookLastEventId: webhookEventId,
      webhookLastProcessedAt: now(),
      updatedAt: now(),
    };

    // Set timestamp when reaching terminal states
    if (newStatus === "paid" && !charge.paidAt) {
      updates.paidAt = (mpData as any).date_approved ?? now();
    }
    if (newStatus === "cancelled" && !charge.cancelledAt) {
      updates.cancelledAt = now();
    }
    if (newStatus === "refunded" && !charge.refundedAt) {
      updates.refundedAt = now();
    }

    await updateCharge(uid, chargeId, updates);
    paymentInfo(`[payments/sync] Charge status updated: ${charge.status} → ${newStatus}`);

    // §6: propaga para o pedido do catálogo público quando esta charge tem um. A Charge (fonte de
    // verdade financeira) já está persistida no passo acima — isto é side-effect best-effort.
    if (newStatus === "paid" && charge.orderId) {
      await syncOrderPaymentStatusFromCharge(uid, charge.orderId);
    }

    return { ...charge, ...updates } as Charge;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logPaymentError("sync_payment_from_mp", uid, msg, {
      chargeId,
      mpPaymentId,
      errorName: err instanceof Error ? err.name : "UnknownError",
    });
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Route: POST /api/payments/create-link
// ---------------------------------------------------------------------------
async function handleCreateLink(req: Request, res: Response) {
  let body: CreatePaymentLinkInput | undefined;
  let stage = "start";
  
  try {
    paymentInfo("[payments/create-link] Request received");
    paymentInfo("[payments/create-link] stage=", stage);
    
    stage = "validate_body";
    paymentInfo("[payments/create-link] stage=", stage);
    
    body = req.body as CreatePaymentLinkInput;
    const authenticatedUid = (req as any).firebaseUid as string;

    // Validate required fields without logging customer or payment payloads
    const missingFields: string[] = [];
    if (!body?.uid) missingFields.push("uid");
    if (!body?.clientId) missingFields.push("clientId");
    if (!body?.title) missingFields.push("title");
    if (body?.amount === undefined || body?.amount === null) missingFields.push("amount");

    if (missingFields.length > 0) {
      paymentLogError("[payments/create-link] Missing fields:", missingFields);
      return res.status(400).json({
        error: `Missing required fields: ${missingFields.join(", ")}`,
      });
    }

    if (body.uid !== authenticatedUid) {
      return res.status(403).json({ error: "Forbidden: uid mismatch" });
    }

    if (typeof body.amount !== "number" || body.amount <= 0) {
      return res.status(400).json({ error: "amount must be a positive number" });
    }

    const admin = getFirebaseAdmin();
    const db = admin.firestore();

    // RELEASE-QUALITY-02 §5: retry idempotente — uma venda que já registrou uma cobrança para este
    // saleId (link ainda válido) nunca deve gerar uma segunda cobrança só porque o cliente tocou em
    // "Tentar novamente" depois de uma falha anterior. Reaproveita a cobrança existente em vez de criar
    // uma nova preferência no Mercado Pago.
    if (body.saleId && String(body.saleId).trim() !== "") {
      stage = "check_existing_charge_for_sale";
      paymentInfo("[payments/create-link] stage=", stage);
      const existingForSale = await db
        .collection("users")
        .doc(body.uid)
        .collection("charges")
        .where("saleId", "==", body.saleId)
        .limit(5)
        .get();
      const reusable = existingForSale.docs.find((snapshot) => {
        const data = snapshot.data() as Partial<Charge>;
        return Boolean(data.paymentUrl) && data.status !== "cancelled" && data.status !== "expired" && data.status !== "failed";
      });
      if (reusable) {
        const data = reusable.data() as Charge;
        paymentInfo("[payments/create-link] Reusing existing charge for saleId (idempotent retry)");
        return res.status(200).json({
          chargeId: reusable.id,
          paymentUrl: data.paymentUrl,
          preferenceId: data.preferenceId ?? "",
          externalReference: data.externalReference ?? "",
          tokenSource: data.tokenSource ?? "central",
          status: data.status,
          environment: data.environment,
          reused: true,
        });
      }
    }

    // Generate stable chargeId (Firestore auto-ID)
    stage = "firestore_ref_creation";
    paymentInfo("[payments/create-link] stage=", stage);

    const chargeRef = db
      .collection("users")
      .doc(body.uid)
      .collection("charges")
      .doc(); // auto-ID

    const chargeId = chargeRef.id;
    const externalReference = buildExternalReference(body.uid, chargeId, body.saleId);
    const clientSnapshot = await resolveChargeClientSnapshot(db, body.uid, body.clientId);

    // ── Caminho B: Resolve which MP account to use ──────────────────────────
    stage = "resolve_token";
    paymentInfo("[payments/create-link] stage=", stage);
    paymentInfo("[payments/create-link] Resolving payment credential");
    
    const {
      accessToken,
      tokenSource,
      connectionId: resolvedConnectionId,
    } = await getValidMPAccessToken(
      body.uid,
      body.mpConnectionId ?? null
    );
    paymentInfo("[payments/create-link] Payment credential resolved");
    if (!accessToken || accessToken.trim().length < 20) {
      throw new Error("Mercado Pago indisponível: access token não configurado");
    }

    // Build per-request Mercado Pago client with the resolved token
    stage = "create_mp_client";
    paymentInfo("[payments/create-link] stage=", stage);
    paymentInfo("[payments/create-link] Creating Mercado Pago client");
    
    const mpClient = new MercadoPagoConfig({ accessToken, options: { timeout: 10000 } });
    const preferenceClient = new Preference(mpClient);
    const chargeEnvironment = detectEnvironment(accessToken);
    paymentInfo("[payments/create-link] Mercado Pago client created", {
      environment: chargeEnvironment,
    });

    // Build Mercado Pago preference
    stage = "build_preference_payload";
    paymentInfo("[payments/create-link] stage=", stage);
    paymentInfo("[payments/create-link] Preparing payment preference");
    
    // Validate critical fields before building payload
    const FRONTEND_URL_VALID = FRONTEND_URL && FRONTEND_URL.startsWith("http");
    const APP_BASE_URL_VALID = APP_BASE_URL && APP_BASE_URL.startsWith("http");
    
    if (!FRONTEND_URL_VALID || !APP_BASE_URL_VALID) {
      paymentLogError("[payments/create-link] Invalid payment redirect configuration");
      return res.status(500).json({
        error: "Configuration error: invalid URLs",
        details: "FRONTEND_URL ou APP_BASE_URL não configurados corretamente",
      });
    }

    // MINIMAL PAYLOAD TEST: Only required fields (removing potentially problematic ones)
    // Safe metadata handling with fallback — CRITICAL: body.metadata MUST be object or null
    const safeMetadata = (body && body.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata)) ? body.metadata : {};
    
    const preferencePayload: any = {
      items: [
        {
          id: chargeId,
          title: body.title,
          description: body.description ?? body.title,
          quantity: body.quantity ?? 1,
          unit_price: body.amount,
          currency_id: "BRL",
        },
      ],
      external_reference: externalReference ?? "",
      back_urls: {
        success: `${FRONTEND_URL}/catalog?payment=success`,
        pending: `${FRONTEND_URL}/catalog?payment=pending`,
        failure: `${FRONTEND_URL}/catalog?payment=failure`,
      },
      auto_return: "approved",
      notification_url: `${APP_BASE_URL}/api/payments/webhook?uid=${encodeURIComponent(body.uid)}&chargeId=${encodeURIComponent(chargeId)}`,
      metadata: {
        ...(safeMetadata ?? {}),
        uid: body.uid,
        chargeId,
        clientId: body.clientId,
        saleId: body.saleId ?? null,
        tokenSource,
        mpConnectionId: resolvedConnectionId,
      },
    };
    
    paymentInfo("[payments/create-link] Payment preference prepared");
    
    stage = "create_preference";
    paymentInfo("[payments/create-link] stage=", stage);
    paymentInfo("[payments/create-link] Creating payment preference");
    
    let preference: any = null;
    try {
      preference = await preferenceClient.create({ body: preferencePayload });
      
      paymentInfo("[payments/create-link] Preference created");
    } catch (mpError: any) {
      // Extract error details — ALWAYS provide fallbacks
      const mpErrorMessage = mpError?.message ?? "Unknown error";
      const mpErrorStatus = mpError?.status ?? null;
      const mpErrorCode = mpError?.code ?? null;
      
      paymentLogError("[payments/create-link] Mercado Pago request failed", {
        errorName: mpError?.name ?? "Unknown",
        status: mpErrorStatus,
        code: mpErrorCode,
      });

      // Determine specific error message based on error type
      let userMessage = "Erro ao comunicar com Mercado Pago";
      
      if (mpErrorMessage.includes("invalid_access_token") || mpErrorMessage.includes("Unauthorized")) {
        userMessage = "Token Mercado Pago inválido ou expirado. Reconecte em Ajustes > Mercado Pago";
      } else if (mpErrorMessage.includes("validation") || mpErrorMessage.includes("invalid")) {
        userMessage = "Algum dado do pagamento foi rejeitado. Revise as informações e tente novamente.";
      } else if (mpErrorMessage.includes("statement_descriptor")) {
        userMessage = "Algum dado do pagamento foi rejeitado. Revise as informações e tente novamente.";
      } else if (mpErrorMessage.includes("notification_url")) {
        userMessage = "Não foi possível configurar a notificação do pagamento.";
      } else if (mpErrorMessage.includes("back_url")) {
        userMessage = "Não foi possível configurar o retorno do pagamento.";
      } else if (mpErrorStatus === 429) {
        userMessage = "Limite de requisições atingido. Tente novamente em alguns segundos";
      } else if (mpErrorStatus === 401 || mpErrorStatus === 403) {
        userMessage = "Acesso negado ao Mercado Pago. Verifique credenciais";
      }

      return res.status(502).json({
        error: "PAYMENT_PREFERENCE_FAILED",
        userMessage,
      });
    }
    stage = "extract_preference_urls";
    paymentInfo("[payments/create-link] stage=", stage);
    
    const safePreference = preference ?? {};
    const paymentUrl = safePreference?.init_point ?? "";
    const sandboxUrl = safePreference?.sandbox_init_point ?? "";
    const preferenceId = safePreference?.id ?? "";

    if (!paymentUrl && !sandboxUrl) {
      paymentLogError("[payments/create-link] No init_point received from MP");
      return res.status(502).json({ error: "Failed to get payment URL from Mercado Pago" });
    }

    // Choose URL based on environment
    const finalPaymentUrl =
      chargeEnvironment === "sandbox" ? sandboxUrl || paymentUrl : paymentUrl;

    // Build charge document with ONLY non-undefined fields to prevent Firestore errors
    stage = "build_charge";
    paymentInfo("[payments/create-link] stage=", stage);
    paymentInfo("[payments/create-link] Building charge document");
    
    const charge: any = {
      id: chargeId,
      uid: body.uid,
      provider: "mercadopago",
      mode: "one_time",
      environment: chargeEnvironment,
      status: "pending",
      providerRawStatus: "pending",
      amount: body.amount,
      currency: "BRL",
      clientId: body.clientId,
      title: body.title,
      paymentUrl: finalPaymentUrl || "",
      externalReference: externalReference || "",
      tokenSource: tokenSource || "central",
      createdAt: now(),
      updatedAt: now(),
    };

    // Add optional fields only if they have valid values
    if (body && body.description && String(body.description).trim() !== "") {
      charge.description = body.description;
    }
    if (preferenceId && String(preferenceId).trim() !== "") {
      charge.preferenceId = preferenceId;
    }
    if (body && body.saleId && String(body.saleId).trim() !== "") {
      charge.saleId = body.saleId;
    }
    if (clientSnapshot.clientName) {
      charge.clientName = clientSnapshot.clientName;
    }
    if (clientSnapshot.clientPhone) {
      charge.clientPhone = clientSnapshot.clientPhone;
    }
    charge.mpConnectionId = resolvedConnectionId;
    
    // metadata: only add if body has it AND it's a valid object with content
    if (body && body.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata)) {
      const metadataKeys = Object.keys(body.metadata ?? {});
      if (metadataKeys && metadataKeys.length > 0) {
        charge.metadata = body.metadata;
      }
    }

    paymentInfo("[payments/create-link] Charge document built");
    try {
      paymentInfo("[payments/create-link] Charge keys", Object.keys(charge ?? {}));
    } catch (keyErr) {
      paymentWarn("[payments/create-link] Cannot get charge keys", String(keyErr));
    }
    
    // Persist to Firestore
    stage = "save_charge";
    paymentInfo("[payments/create-link] stage=", stage);
    
    await chargeRef.set(charge);
    paymentInfo("[payments/create-link] Charge saved to Firestore");
    
    stage = "send_response";
    paymentInfo("[payments/create-link] stage=", stage);

    paymentInfo("[payments/create-link] Charge created successfully");

    return res.status(201).json({
      chargeId,
      paymentUrl: finalPaymentUrl,
      preferenceId,
      externalReference,
      tokenSource,
      status: "pending",
      environment: chargeEnvironment,
    });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err ?? "Unknown error");
    const errorName = err instanceof Error ? err.name : "UnknownError";
    
    paymentLogError("[payments/create-link] Request failed at stage", stage);
    paymentLogError("[payments/create-link] Request failed", {
      stage,
      errorName,
    });

    if (errorMsg === "MP_CONNECTED_TOKEN_UNAVAILABLE") {
      paymentWarn("payment_create_blocked_connected_account", { uid: body?.uid ?? null });
      return res.status(409).json({
        error: "MP_CONNECTED_TOKEN_UNAVAILABLE",
        userMessage: "Reconecte sua conta Mercado Pago para gerar cobranças.",
      });
    }
    
    // Log to structured error tracking
    logPaymentError("create_link", body?.uid ?? null, errorMsg, {
      stage,
      errorName,
      clientId: body?.clientId ?? null,
      amount: body?.amount ?? null,
      isMPError: errorMsg.includes("Mercado Pago"),
    });
    
    const tokenAuthenticationFailure = /Unsupported state|unable to authenticate|decrypt|auth tag/i.test(errorMsg);
    return res.status(tokenAuthenticationFailure ? 503 : 500).json({
      error: "PAYMENT_LINK_FAILED",
      userMessage: tokenAuthenticationFailure
        ? "A conexão com o Mercado Pago precisa ser renovada. Reconecte sua conta em Ajustes."
        : "Não foi possível iniciar o pagamento agora. Tente novamente em instantes.",
    });
  }
}

// ---------------------------------------------------------------------------
// RELEASE-CHECKOUT-03 — cobrança Mercado Pago para um PEDIDO do catálogo público.
//
// Deliberadamente uma função separada de handleCreateLink, não uma variante dela: handleCreateLink é
// autenticada (o próprio vendedor chama, com seu token) e confia em `body.uid`/`body.clientId`/
// `body.amount` vindos do request porque quem está autenticado É o dono dos dados. Aqui o chamador é
// um visitante anônimo do catálogo — nada pode vir do corpo da requisição além de já ter sido validado
// pelo caller (routes.ts) contra o pedido persistido no servidor. Reaproveita as MESMAS peças (token
// resolution, cliente MP, buildExternalReference, persistência de Charge, mapeamento de erro) sem
// duplicar a lógica de negócio nem criar um segundo sistema de pagamento.
// ---------------------------------------------------------------------------
export class MercadoPagoOrderChargeError extends Error {
  readonly code: string;
  readonly userMessage: string;
  readonly httpStatus: number;

  constructor(code: string, userMessage: string, httpStatus = 502, cause?: unknown) {
    super(code, { cause });
    this.name = "MercadoPagoOrderChargeError";
    this.code = code;
    this.userMessage = userMessage;
    this.httpStatus = httpStatus;
  }
}

/** Nunca `/catalog` (rota interna autenticada do app do vendedor) — sempre a loja pública do próprio pedido. */
function buildPublicOrderBackUrls(storeSlug: string, orderId: string) {
  const base = `${FRONTEND_URL}/u/${encodeURIComponent(storeSlug)}`;
  const suffix = `order=${encodeURIComponent(orderId)}`;
  return {
    success: `${base}?${suffix}&payment=success`,
    pending: `${base}?${suffix}&payment=pending`,
    failure: `${base}?${suffix}&payment=failure`,
  };
}

export interface CreateOrderMercadoPagoChargeParams {
  uid: string;
  /** Pré-alocado pelo caller a partir da reserva atômica (reserveOrderCharge) — garante idempotência. */
  chargeId: string;
  orderId: string;
  /** SEMPRE `order.total` já persistido no servidor — nunca um valor vindo do corpo da requisição pública. */
  amount: number;
  title: string;
  storeSlug: string;
}

export interface CreateOrderMercadoPagoChargeResult {
  chargeId: string;
  paymentUrl: string;
  preferenceId: string;
  externalReference: string;
  environment: string;
}

export async function createOrderMercadoPagoCharge(
  params: CreateOrderMercadoPagoChargeParams,
): Promise<CreateOrderMercadoPagoChargeResult> {
  const { accessToken, tokenSource, connectionId } = await getValidMPAccessToken(params.uid, null);
  if (!accessToken || accessToken.trim().length < 20) {
    throw new MercadoPagoOrderChargeError(
      "MP_TOKEN_UNAVAILABLE",
      "Pagamento por cartão indisponível no momento. Escolha Pix ou combine pelo WhatsApp.",
      503,
    );
  }

  const mpClient = new MercadoPagoConfig({ accessToken, options: { timeout: 10000 } });
  const preferenceClient = new Preference(mpClient);
  const chargeEnvironment = detectEnvironment(accessToken);
  const externalReference = buildExternalReference(params.uid, params.chargeId, { kind: "order", id: params.orderId });
  const backUrls = buildPublicOrderBackUrls(params.storeSlug, params.orderId);

  let preference: any;
  try {
    preference = await preferenceClient.create({
      body: {
        items: [
          {
            id: params.chargeId,
            title: params.title,
            quantity: 1,
            unit_price: params.amount,
            currency_id: "BRL",
          },
        ],
        external_reference: externalReference,
        back_urls: backUrls,
        auto_return: "approved",
        notification_url: `${APP_BASE_URL}/api/payments/webhook?uid=${encodeURIComponent(params.uid)}&chargeId=${encodeURIComponent(params.chargeId)}`,
        metadata: {
          uid: params.uid,
          chargeId: params.chargeId,
          orderId: params.orderId,
          tokenSource,
          mpConnectionId: connectionId,
        },
      },
    });
  } catch (mpError) {
    paymentLogError("[payments/order-charge] Mercado Pago request failed", {
      message: mpError instanceof Error ? mpError.message : String(mpError),
    });
    throw new MercadoPagoOrderChargeError(
      "PAYMENT_PREFERENCE_FAILED",
      "Não foi possível iniciar o pagamento por cartão agora. Escolha Pix ou combine pelo WhatsApp.",
      502,
      mpError,
    );
  }

  const rawPaymentUrl = preference?.init_point ?? "";
  const sandboxUrl = preference?.sandbox_init_point ?? "";
  const preferenceId = preference?.id ?? "";
  const finalPaymentUrl = chargeEnvironment === "sandbox" ? (sandboxUrl || rawPaymentUrl) : rawPaymentUrl;
  if (!finalPaymentUrl) {
    paymentLogError("[payments/order-charge] No init_point received from MP");
    throw new MercadoPagoOrderChargeError(
      "PAYMENT_URL_MISSING",
      "Não foi possível iniciar o pagamento por cartão agora. Escolha Pix ou combine pelo WhatsApp.",
    );
  }

  const charge: Charge = {
    id: params.chargeId,
    uid: params.uid,
    provider: "mercadopago",
    mode: "one_time",
    environment: chargeEnvironment,
    status: "pending",
    providerRawStatus: "pending",
    amount: params.amount,
    currency: "BRL",
    clientId: "public-catalog",
    orderId: params.orderId,
    title: params.title,
    paymentUrl: finalPaymentUrl,
    externalReference,
    tokenSource: tokenSource || "central",
    createdAt: now(),
    updatedAt: now(),
    ...(preferenceId ? { preferenceId } : {}),
    mpConnectionId: connectionId,
  };

  await getFirebaseAdmin().firestore().collection("users").doc(params.uid).collection("charges").doc(params.chargeId).set(charge);

  return { chargeId: params.chargeId, paymentUrl: finalPaymentUrl, preferenceId, externalReference, environment: chargeEnvironment };
}

/**
 * §6 — quando o webhook (ou um resync manual) confirma pagamento de uma cobrança vinculada a um
 * pedido do catálogo, propaga o status para o PEDIDO. Nunca deixa uma falha aqui derrubar o
 * processamento do webhook — a Charge (fonte de verdade financeira) já foi atualizada com sucesso
 * antes desta função ser chamada; se o pedido não sincronizar, fica só para investigação manual, não
 * para reprocessar o pagamento.
 */
async function syncOrderPaymentStatusFromCharge(uid: string, orderId: string): Promise<void> {
  try {
    const db = getFirebaseAdmin().firestore();
    const orderRef = db.collection("users").doc(uid).collection("orders").doc(orderId);
    const snap = await orderRef.get();
    if (!snap.exists) return;
    if (snap.data()?.paymentStatus === "paid") return; // já sincronizado — replay do webhook é idempotente
    await orderRef.set({ paymentStatus: "paid", updatedAt: now() }, { merge: true });
    paymentInfo("[payments/sync] Order payment status synced to paid", { orderId });
  } catch (err) {
    logPaymentError("sync_order_from_charge", uid, err instanceof Error ? err.message : String(err), { orderId });
  }
}

// ---------------------------------------------------------------------------
// Route: POST /api/payments/webhook
// ---------------------------------------------------------------------------
async function handleWebhook(req: Request, res: Response) {
  // Always acknowledge quickly — MP retries if we don't respond fast
  const rawBody = (req as any).rawBody as Buffer | undefined;

  if (!WEBHOOK_SECRET) {
    paymentLogError("[payments/webhook] Rejected: webhook secret is not configured");
    return res.status(401).json({ error: "Invalid webhook signature" });
  }
  if (!rawBody || !verifyWebhookSignature(req, rawBody)) {
    paymentWarn("[payments/webhook] Rejected: invalid signature");
    return res.status(401).json({ error: "Invalid webhook signature" });
  }

  const payload = req.body as MPWebhookPayload;
  const eventId = getSingleHeader(req, "x-request-id");

  paymentInfo("[payments/webhook] Signed event received", {
    action: payload.action,
    type: payload.type,
    liveMode: payload.live_mode === true,
  });

  // Only handle payment events
  if (payload.type !== "payment" && payload.action?.split(".")?.[0] !== "payment") {
    return res.status(200).json({ received: true, skipped: "non-payment event" });
  }

  const mpPaymentId = String(payload.data?.id ?? "");
  let webhookUid: string | null = null;
  let webhookChargeId: string | null = null;
  if (!mpPaymentId) {
    return res.status(400).json({ received: false, error: "INVALID_WEBHOOK_PAYLOAD" });
  }

  try {
    const queryUid = typeof req.query.uid === "string" ? req.query.uid : "";
    const queryChargeId = typeof req.query.chargeId === "string" ? req.query.chargeId : "";
    let uid = queryUid;
    let chargeId = queryChargeId;
    let prefetchedPayment: any = null;

    if (uid && chargeId) {
      const identifiedCharge = await fetchCharge(uid, chargeId);
      if (!identifiedCharge) throw new Error("WEBHOOK_CHARGE_NOT_FOUND");
    } else {
      // Compatibility for preferences created before identified notification URLs.
      let legacyToken = CENTRAL_ACCESS_TOKEN;
      if (payload.user_id) {
        const legacyConnection = await findMPConnectionByMerchantId(String(payload.user_id));
        if (legacyConnection) {
          uid = legacyConnection.uid;
          const resolved = await getMPAccessTokenForCharge(
            legacyConnection.uid,
            "revendedor",
            legacyConnection.connectionId,
          );
          legacyToken = resolved.accessToken;
        }
      }
      if (!legacyToken) throw new Error("LEGACY_WEBHOOK_TOKEN_NOT_RESOLVED");
      prefetchedPayment = await createPaymentClient(legacyToken).get({ id: mpPaymentId });
      const parsed = parseExternalReference((prefetchedPayment as any).external_reference ?? "");
      if (!parsed) throw new Error("INVALID_EXTERNAL_REFERENCE");
      uid = parsed.uid;
      chargeId = parsed.chargeId;
    }

    webhookUid = uid;
    webhookChargeId = chargeId;
    await syncPaymentFromMP(uid, chargeId, mpPaymentId, eventId, prefetchedPayment);
    return res.status(200).json({ received: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logPaymentError("webhook_process", webhookUid, msg, {
      chargeId: webhookChargeId,
      mpPaymentId,
      errorName: err instanceof Error ? err.name : "UnknownError",
    });
    // Retryable response: Mercado Pago will deliver the event again.
    return res.status(500).json({ received: false, error: "PAYMENT_SYNC_FAILED" });
  }
}

// ---------------------------------------------------------------------------
// Route: GET /api/payments/status/:chargeId
// ---------------------------------------------------------------------------
async function handleGetStatus(req: Request, res: Response) {
  const chargeId = Array.isArray(req.params.chargeId) ? req.params.chargeId[0] : (req.params.chargeId as string);
  const uid = (req as any).firebaseUid as string;
  try {

    if (!chargeId) {
      return res.status(400).json({ error: "chargeId required" });
    }

    const charge = await fetchCharge(uid, chargeId);
    if (!charge) {
      return res.status(404).json({ error: "Charge not found" });
    }

    // Only owner can access
    if (charge.uid !== uid) {
      return res.status(403).json({ error: "Forbidden" });
    }

    return res.json({
      chargeId: charge.id,
      status: charge.status,
      providerRawStatus: charge.providerRawStatus,
      amount: charge.amount,
      currency: charge.currency,
      paymentUrl: charge.paymentUrl,
      clientId: charge.clientId,
      saleId: charge.saleId ?? null,
      paidAt: charge.paidAt ?? null,
      createdAt: charge.createdAt,
      updatedAt: charge.updatedAt,
      environment: charge.environment,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logPaymentError("get_status", uid, msg, {
      chargeId,
      errorName: err instanceof Error ? err.name : "UnknownError",
    });
    return res.status(500).json({ error: "PAYMENT_STATUS_FAILED" });
  }
}

// ---------------------------------------------------------------------------
// Route: POST /api/payments/resync/:chargeId
// Forces a re-fetch from Mercado Pago and updates Firestore.
// Useful if webhook was missed or arrived inconsistent.
// ---------------------------------------------------------------------------
async function handleResync(req: Request, res: Response) {
  const chargeId = Array.isArray(req.params.chargeId) ? req.params.chargeId[0] : (req.params.chargeId as string);
  const uid = (req as any).firebaseUid as string;
  try {

    if (!chargeId) {
      return res.status(400).json({ error: "chargeId required" });
    }

    const charge = await fetchCharge(uid, chargeId);
    if (!charge) {
      return res.status(404).json({ error: "Charge not found" });
    }

    if (charge.uid !== uid) {
      return res.status(403).json({ error: "Forbidden" });
    }

    if (!charge.mercadoPagoPaymentId) {
      return res.status(200).json({
        message: "No MP payment ID yet — payment may not have been initiated",
        status: charge.status,
        chargeId,
      });
    }

    const updated = await syncPaymentFromMP(uid, chargeId, charge.mercadoPagoPaymentId);

    return res.json({
      chargeId,
      status: updated?.status ?? charge.status,
      providerRawStatus: updated?.providerRawStatus ?? charge.providerRawStatus,
      updatedAt: updated?.updatedAt ?? charge.updatedAt,
      resynced: true,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logPaymentError("resync_charge", uid, msg, {
      chargeId,
      errorName: err instanceof Error ? err.name : "UnknownError",
    });
    return res.status(500).json({ error: "PAYMENT_RESYNC_FAILED" });
  }
}

// ---------------------------------------------------------------------------
// Register all payment routes
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Route: DELETE /api/payments/:chargeId
// Deletes a charge from Firestore
// ---------------------------------------------------------------------------
async function handleDeleteCharge(req: Request, res: Response) {
  try {
    const chargeId = Array.isArray(req.params.chargeId)
      ? req.params.chargeId[0]
      : (req.params.chargeId as string);
    const uid = (req as any).firebaseUid as string;

    if (!chargeId) {
      return res.status(400).json({ error: "chargeId required" });
    }

    const charge = await fetchCharge(uid, chargeId);
    if (!charge) {
      return res.status(404).json({ error: "Charge not found" });
    }

    if (charge.uid !== uid) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const admin = getFirebaseAdmin();
    const db = admin.firestore();
    await db.collection("users").doc(uid).collection("charges").doc(chargeId).delete();

    paymentInfo("[payments] Charge deleted");
    return res.json({ success: true, chargeId, message: "Charge deleted successfully" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logPaymentError("delete_charge", (req as any).firebaseUid, msg, {
      chargeId: req.params.chargeId,
      errorName: err instanceof Error ? err.name : "UnknownError",
    });
    return res.status(500).json({ error: "PAYMENT_DELETE_FAILED" });
  }
}

export function registerPaymentRoutes(
  app: Express,
  requireAuth: (req: Request, res: Response, next: any) => void
): void {
  // Public webhook — no auth (MP calls this, no user token)
  app.post("/api/payments/webhook", paymentWebhookRateLimit, handleWebhook);

  // Authenticated routes
  app.post("/api/payments/create-link", requireAuth, paymentCreateLinkRateLimit, handleCreateLink);
  app.get("/api/payments/status/:chargeId", requireAuth, paymentStatusRateLimit, handleGetStatus);
  app.post("/api/payments/resync/:chargeId", requireAuth, paymentResyncRateLimit, handleResync);
  app.delete("/api/payments/:chargeId", requireAuth, paymentDeleteRateLimit, handleDeleteCharge);

  // Subscription stubs — wired but not implemented (prevents 404 in future)
  // PLAN-IMPL-04B: /create agora tem uma implementação real em registerSubscriptionRoutes
  // (server/subscriptions.ts) — o stub aqui foi removido porque, sendo registrado antes
  // (registerPaymentRoutes roda antes de registerSubscriptionRoutes em routes.ts), ele
  // interceptava TODA requisição para essa rota e a implementação real nunca era alcançada.
  app.post("/api/subscriptions/cancel", requireAuth, (_req, res) => {
    res.status(501).json({ message: "Subscription billing coming soon", prepared: true });
  });
  app.post("/api/subscriptions/pause", requireAuth, (_req, res) => {
    res.status(501).json({ message: "Subscription billing coming soon", prepared: true });
  });
  app.post("/api/subscriptions/resume", requireAuth, (_req, res) => {
    res.status(501).json({ message: "Subscription billing coming soon", prepared: true });
  });

  paymentInfo("[payments] Routes registered: /api/payments/{create-link,webhook,status,resync,delete}");
}
