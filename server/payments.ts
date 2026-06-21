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

import type { Express, Request, Response } from "express";
import * as crypto from "crypto";
import { MercadoPagoConfig, Preference, Payment as MPPayment } from "mercadopago";
import { getFirebaseAdmin } from "./firebase-admin-init";
import {
  findMPConnectionByMerchantId,
  getMPAccessTokenForCharge,
  getValidMPAccessToken,
} from "./mercadopago-connections";
import {
  type Charge,
  type CreatePaymentLinkInput,
  type MPWebhookPayload,
  buildExternalReference,
  parseExternalReference,
  resolveChargeStatus,
  detectEnvironment,
} from "../shared/charges";

// Helper: Structured error logging for payment operations
function logPaymentError(
  operationName: string,
  _uid: string | null,
  errorMsg: string,
  context?: Record<string, any>
) {
  const errorId = Math.random().toString(36).substring(7);
  const timestamp = new Date().toISOString();
  
  console.error(`[${timestamp}] PAYMENT-ERROR-ID: ${errorId}`, {
    operation: operationName,
    errorType: errorMsg ? "operation_failed" : "unknown_error",
    contextKeys: context ? Object.keys(context) : [],
  });
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const CENTRAL_ACCESS_TOKEN = process.env.MERCADOPAGO_ACCESS_TOKEN ?? "";
const WEBHOOK_SECRET = process.env.MERCADOPAGO_WEBHOOK_SECRET ?? "";
const APP_BASE_URL = process.env.APP_BASE_URL ?? "https://revendasmart-backend-164193806378.us-central1.run.app";
const FRONTEND_URL = process.env.FRONTEND_URL ?? "https://revendasmart.vercel.app";

if (!CENTRAL_ACCESS_TOKEN) {
  console.warn("[payments] Central payment credential is not configured");
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
function verifyWebhookSignature(req: Request, rawBody: Buffer): boolean {
  if (!WEBHOOK_SECRET) {
    console.error("[payments/webhook] Webhook secret is not configured");
    return false;
  }

  try {
    const xSignature = req.headers["x-signature"] as string;
    const xRequestId = req.headers["x-request-id"] as string;

    if (!xSignature) {
      console.warn("[payments/webhook] Missing x-signature header");
      return false;
    }

    // Parse ts and v1 from x-signature
    const parts = xSignature.split(",");
    let ts = "";
    let v1 = "";
    for (const part of parts) {
      const [key, val] = part.split("=");
      if (key.trim() === "ts") ts = val.trim();
      if (key.trim() === "v1") v1 = val.trim();
    }

    if (!ts || !v1) {
      console.warn("[payments/webhook] Invalid x-signature format");
      return false;
    }

    // Extract data.id from body (Mercado Pago sends this as the payment id)
    const body = JSON.parse(rawBody.toString());
    const dataId = body?.data?.id ?? "";

    // Build the manifest string exactly as MP specifies
    const manifest = `id:${dataId};request-id:${xRequestId ?? ""};ts:${ts};`;

    const expectedHash = crypto
      .createHmac("sha256", WEBHOOK_SECRET)
      .update(manifest)
      .digest("hex");

    const isValid = crypto.timingSafeEqual(
      Buffer.from(v1, "hex"),
      Buffer.from(expectedHash, "hex")
    );

    if (!isValid) {
      console.warn("[payments/webhook] Signature mismatch — possible tampered request");
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
      console.warn("[payments/sync] Charge not found");
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
      console.info("[payments/sync] Event already processed — skipping");
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
    console.info(`[payments/sync] Charge status updated: ${charge.status} → ${newStatus}`);

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
    console.info("[payments/create-link] Request received");
    console.info("[payments/create-link] stage=", stage);
    
    stage = "validate_body";
    console.error("[payments/create-link] stage=", stage);
    
    body = req.body as CreatePaymentLinkInput;
    const authenticatedUid = (req as any).firebaseUid as string;

    // Validate required fields without logging customer or payment payloads
    const missingFields: string[] = [];
    if (!body?.uid) missingFields.push("uid");
    if (!body?.clientId) missingFields.push("clientId");
    if (!body?.title) missingFields.push("title");
    if (body?.amount === undefined || body?.amount === null) missingFields.push("amount");

    if (missingFields.length > 0) {
      console.error("[payments/create-link] Missing fields:", missingFields);
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

    // Generate stable chargeId (Firestore auto-ID)
    stage = "firestore_ref_creation";
    console.error("[payments/create-link] stage=", stage);
    
    const admin = getFirebaseAdmin();
    const db = admin.firestore();
    const chargeRef = db
      .collection("users")
      .doc(body.uid)
      .collection("charges")
      .doc(); // auto-ID

    const chargeId = chargeRef.id;
    const externalReference = buildExternalReference(body.uid, chargeId, body.saleId);

    // ── Caminho B: Resolve which MP account to use ──────────────────────────
    stage = "resolve_token";
    console.error("[payments/create-link] stage=", stage);
    console.error("[payments/create-link] Resolving payment credential");
    
    const {
      accessToken,
      tokenSource,
      connectionId: resolvedConnectionId,
    } = await getValidMPAccessToken(
      body.uid,
      body.mpConnectionId ?? null
    );
    console.info("[payments/create-link] Payment credential resolved");
    if (!accessToken || accessToken.trim().length < 20) {
      throw new Error("Mercado Pago indisponível: access token não configurado");
    }

    // Build per-request Mercado Pago client with the resolved token
    stage = "create_mp_client";
    console.error("[payments/create-link] stage=", stage);
    console.error("[payments/create-link] DEBUG: Step 2 — Creating MercadoPagoConfig");
    
    const mpClient = new MercadoPagoConfig({ accessToken, options: { timeout: 10000 } });
    const preferenceClient = new Preference(mpClient);
    const chargeEnvironment = detectEnvironment(accessToken);
    console.error("[payments/create-link] DEBUG: Step 2 SUCCESS — MPClient created", {
      environment: chargeEnvironment,
    });

    // Build Mercado Pago preference
    stage = "build_preference_payload";
    console.error("[payments/create-link] stage=", stage);
    console.error("[payments/create-link] Preparing payment preference");
    
    // Validate critical fields before building payload
    const FRONTEND_URL_VALID = FRONTEND_URL && FRONTEND_URL.startsWith("http");
    const APP_BASE_URL_VALID = APP_BASE_URL && APP_BASE_URL.startsWith("http");
    
    if (!FRONTEND_URL_VALID || !APP_BASE_URL_VALID) {
      console.error("[payments/create-link] Invalid payment redirect configuration");
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
    
    console.info("[payments/create-link] Payment preference prepared");
    
    stage = "create_preference";
    console.error("[payments/create-link] stage=", stage);
    console.error("[payments/create-link] DEBUG: Step 4 — Calling preferenceClient.create()");
    
    let preference: any = null;
    try {
      preference = await preferenceClient.create({ body: preferencePayload });
      
      console.info("[payments/create-link] Preference created");
    } catch (mpError: any) {
      // Extract error details — ALWAYS provide fallbacks
      const mpErrorMessage = mpError?.message ?? "Unknown error";
      const mpErrorStatus = mpError?.status ?? null;
      const mpErrorCode = mpError?.code ?? null;
      
      console.error("[payments/create-link] Mercado Pago request failed", {
        errorName: mpError?.name ?? "Unknown",
        status: mpErrorStatus,
        code: mpErrorCode,
      });

      // Determine specific error message based on error type
      let userMessage = "Erro ao comunicar com Mercado Pago";
      
      if (mpErrorMessage.includes("invalid_access_token") || mpErrorMessage.includes("Unauthorized")) {
        userMessage = "Token Mercado Pago inválido ou expirado. Reconecte em Ajustes > Mercado Pago";
      } else if (mpErrorMessage.includes("validation") || mpErrorMessage.includes("invalid")) {
        userMessage = `Campo inválido no pagamento: ${mpErrorMessage}`;
      } else if (mpErrorMessage.includes("statement_descriptor")) {
        userMessage = "Campo 'statement_descriptor' rejeitado pelo Mercado Pago";
      } else if (mpErrorMessage.includes("notification_url")) {
        userMessage = "URL de notificação inválida";
      } else if (mpErrorMessage.includes("back_url")) {
        userMessage = "URL de retorno inválida";
      } else if (mpErrorStatus === 429) {
        userMessage = "Limite de requisições atingido. Tente novamente em alguns segundos";
      } else if (mpErrorStatus === 401 || mpErrorStatus === 403) {
        userMessage = "Acesso negado ao Mercado Pago. Verifique credenciais";
      }

      return res.status(502).json({
        error: "Failed to create payment preference on Mercado Pago",
        userMessage,
        mpMessage: mpErrorMessage,
        mpCode: mpErrorCode,
        mpStatus: mpErrorStatus,
        details: userMessage,
      });
    }
    stage = "extract_preference_urls";
    console.error("[payments/create-link] stage=", stage);
    
    const safePreference = preference ?? {};
    const paymentUrl = safePreference?.init_point ?? "";
    const sandboxUrl = safePreference?.sandbox_init_point ?? "";
    const preferenceId = safePreference?.id ?? "";

    if (!paymentUrl && !sandboxUrl) {
      console.error("[payments/create-link] No init_point received from MP");
      return res.status(502).json({ error: "Failed to get payment URL from Mercado Pago" });
    }

    // Choose URL based on environment
    const finalPaymentUrl =
      chargeEnvironment === "sandbox" ? sandboxUrl || paymentUrl : paymentUrl;

    // Build charge document with ONLY non-undefined fields to prevent Firestore errors
    stage = "build_charge";
    console.error("[payments/create-link] stage=", stage);
    console.error("[payments/create-link] DEBUG: Step 5 — Building charge document for Firestore");
    
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
    charge.mpConnectionId = resolvedConnectionId;
    
    // metadata: only add if body has it AND it's a valid object with content
    if (body && body.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata)) {
      const metadataKeys = Object.keys(body.metadata ?? {});
      if (metadataKeys && metadataKeys.length > 0) {
        charge.metadata = body.metadata;
      }
    }

    console.error("[payments/create-link] DEBUG: Step 5 SUCCESS — Charge document built");
    try {
      console.error("[payments/create-link] Charge keys:", Object.keys(charge ?? {}));
    } catch (keyErr) {
      console.error("[payments/create-link] Cannot get charge keys:", String(keyErr));
    }
    
    // Persist to Firestore
    stage = "save_charge";
    console.error("[payments/create-link] stage=", stage);
    
    await chargeRef.set(charge);
    console.error("[payments/create-link] DEBUG: Step 6 SUCCESS — Charge saved to Firestore");
    
    stage = "send_response";
    console.error("[payments/create-link] stage=", stage);

    console.info("[payments/create-link] Charge created successfully");

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
    
    console.error("[payments/create-link] ❌ CAUGHT OUTER ERROR at stage:", stage);
    console.error("[payments/create-link] Request failed", {
      stage,
      errorName,
    });
    
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
      error: "Erro ao gerar link de pagamento",
      stage: stage ?? "unknown",
      userMessage: tokenAuthenticationFailure
        ? "A conexão com o Mercado Pago precisa ser renovada. Reconecte sua conta em Ajustes."
        : "Não foi possível iniciar o pagamento agora. Tente novamente em instantes.",
    });
  }
}

// ---------------------------------------------------------------------------
// Route: POST /api/payments/webhook
// ---------------------------------------------------------------------------
async function handleWebhook(req: Request, res: Response) {
  // Always acknowledge quickly — MP retries if we don't respond fast
  const rawBody = (req as any).rawBody as Buffer | undefined;

  if (!WEBHOOK_SECRET) {
    console.error("[payments/webhook] Rejected: webhook secret is not configured");
    return res.status(401).json({ error: "Invalid webhook signature" });
  }
  if (!rawBody || !verifyWebhookSignature(req, rawBody)) {
    console.warn("[payments/webhook] Rejected: invalid signature");
    return res.status(401).json({ error: "Invalid webhook signature" });
  }

  const payload = req.body as MPWebhookPayload;
  const eventId = (req.headers["x-request-id"] as string) ?? "";

  console.info("[payments/webhook] Signed event received", {
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
    return res.status(200).json({ received: true, skipped: "missing data.id" });
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
    return res.status(200).json({ received: true, chargeId, uid });
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
    return res.status(500).json({ error: "Failed to get charge status", message: msg });
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
    return res.status(500).json({ error: "Failed to resync charge", message: msg });
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

    console.info("[payments] Charge deleted");
    return res.json({ success: true, chargeId, message: "Charge deleted successfully" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logPaymentError("delete_charge", (req as any).firebaseUid, msg, {
      chargeId: req.params.chargeId,
      errorName: err instanceof Error ? err.name : "UnknownError",
    });
    return res.status(500).json({ error: "Failed to delete charge", message: msg });
  }
}

export function registerPaymentRoutes(
  app: Express,
  requireAuth: (req: Request, res: Response, next: any) => void
): void {
  // Public webhook — no auth (MP calls this, no user token)
  app.post("/api/payments/webhook", handleWebhook);

  // Authenticated routes
  app.post("/api/payments/create-link", requireAuth, handleCreateLink);
  app.get("/api/payments/status/:chargeId", requireAuth, handleGetStatus);
  app.post("/api/payments/resync/:chargeId", requireAuth, handleResync);
  app.delete("/api/payments/:chargeId", requireAuth, handleDeleteCharge);

  // Subscription stubs — wired but not implemented (prevents 404 in future)
  app.post("/api/subscriptions/create", requireAuth, (_req, res) => {
    res.status(501).json({ message: "Subscription billing coming soon", prepared: true });
  });
  app.post("/api/subscriptions/cancel", requireAuth, (_req, res) => {
    res.status(501).json({ message: "Subscription billing coming soon", prepared: true });
  });
  app.post("/api/subscriptions/pause", requireAuth, (_req, res) => {
    res.status(501).json({ message: "Subscription billing coming soon", prepared: true });
  });
  app.post("/api/subscriptions/resume", requireAuth, (_req, res) => {
    res.status(501).json({ message: "Subscription billing coming soon", prepared: true });
  });

  console.log("[payments] Routes registered: /api/payments/{create-link,webhook,status,resync,delete}");
}
