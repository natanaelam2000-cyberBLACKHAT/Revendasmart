/**
 * RELEASE-07 — verificação server-side de compras do Google Play Billing (Android) e concessão do
 * ÚNICO entitlement server-owned (`users/{uid}/planData/main`, o MESMO documento que o checkout
 * Mercado Pago já usa — `isPremiumActive()` em shared/monetization.ts continua sendo a autoridade
 * final, agnóstica de provider).
 *
 * Endpoints:
 *   POST /api/billing/google-play/verify   → valida UMA compra e concede/atualiza o entitlement
 *   POST /api/billing/google-play/restore  → valida uma LISTA de compras (reinstalação/troca de
 *                                             device/app morto após compra) — mesma lógica de verify,
 *                                             seguro de chamar repetidamente
 *   POST /api/billing/google-play/rtdn     → contrato do Real-time Developer Notifications (Pub/Sub
 *                                             push) — reage re-verificando a MESMA compra contra a
 *                                             Google Play Developer API, nunca concede/revoga a partir
 *                                             do conteúdo da notificação sozinho. O tópico Pub/Sub real
 *                                             não está configurado nesta tarefa (§10/§17) — o endpoint
 *                                             está pronto para quando estiver.
 *
 * ZERO chamada real à Google Play API em testes: `createGooglePlayDeveloperApiClient()` só devolve o
 * client real (`RuntimeGooglePlayDeveloperApiClient`) quando `isGooglePlayDeveloperApiConfigured()` é
 * true (ADC/service account presentes); caso contrário devolve um client "not configured" que sempre
 * lança. Testes injetam um mock via `setGooglePlayDeveloperApiClientForTests()`, que tem prioridade
 * sobre os dois.
 */
import type { Express, NextFunction, Request, Response } from "express";
import * as crypto from "crypto";
import { getFirebaseAdmin } from "./firebase-admin-init";
import { logError, logInfo, logWarn } from "./logger";
import type { SubscriptionStatus } from "../shared/monetization";
import {
  PLAY_BILLING_PACKAGE_NAME,
  isEntitledPlayState,
  isKnownPlayBillingBasePlanId,
  isKnownPlayBillingProductId,
  mapGooglePlaySubscriptionState,
  UnknownGooglePlaySubscriptionStateError,
  type PlayEntitlementState,
  type GooglePlayVerifyRequestBody,
} from "../shared/play-billing-contract";
import { createGooglePlayDeveloperApiClient, GooglePlayDeveloperApiNotConfiguredError } from "./google-play-developer-api";

function pbInfo(message: string, details?: Record<string, unknown>): void {
  logInfo("play_billing.log", { message, details });
}
function pbWarn(message: string, details?: Record<string, unknown>): void {
  logWarn("play_billing.log", { message, details });
}
function pbError(message: string, errorMsg: string, details?: Record<string, unknown>): void {
  logError("play_billing.log", errorMsg, { message, details });
}

function now(): string {
  return new Date().toISOString();
}

/** Nunca armazenamos o purchaseToken bruto — só este hash, usado como chave de idempotência/ownership. */
export function hashPurchaseToken(purchaseToken: string): string {
  return crypto.createHash("sha256").update(purchaseToken).digest("hex");
}

/**
 * RELEASE-30: mesma derivação que o client usa (`buildGooglePlayAccountToken`, client/src/lib/play-billing.ts)
 * para o `appAccountToken` enviado à Play no momento da compra. A Play devolve esse valor como
 * `externalAccountIdentifiers.obfuscatedExternalAccountId` na resposta AUTORITATIVA da Developer API —
 * recomputamos aqui a partir do uid JÁ AUTENTICADO e comparamos, nunca confiando em um uid vindo do body.
 */
export function hashGooglePlayAccountUid(uid: string): string {
  return crypto.createHash("sha256").update(`revendasmart-google-play-account:${uid.trim()}`).digest("hex");
}

/**
 * Deriva do MESMO `PlayEntitlementState` fechado (shared/play-billing-contract.ts) usado para decidir
 * `premiumActive` — nunca uma segunda leitura independente do `subscriptionState` cru. Isso evita que
 * `premiumActive`/`subscriptionStatus` divirjam (ex.: ACTIVE com expiry no passado precisa virar
 * "expired" nos dois, não só num deles).
 */
function mapEntitlementStateToSubscriptionStatus(state: PlayEntitlementState): SubscriptionStatus {
  switch (state) {
    case "ACTIVE":
    case "GRACE_PERIOD":
    case "CANCELLED_BUT_ACTIVE":
      return "authorized";
    case "ON_HOLD":
    case "PAUSED":
      return "paused";
    case "PENDING":
      return "pending";
    case "REVOKED":
      return "cancelled";
    case "EXPIRED":
      return "expired";
  }
}

export type VerifyPurchaseOutcome =
  | { readonly status: 200; readonly payload: Record<string, unknown> }
  | { readonly status: 400 | 401 | 403 | 409 | 502 | 503; readonly payload: { readonly error: string } };

/**
 * Núcleo puro-o-suficiente-para-testar: recebe o uid JÁ AUTENTICADO (nunca do body) e o corpo da
 * requisição, consulta o adapter injetável, e aplica o entitlement atomicamente. Reaproveitado por
 * `verify`, `restore` (chamado uma vez por compra) e `rtdn` (chamado com o purchaseToken da notificação).
 */
export async function verifyAndApplyGooglePlayPurchase(uid: string, body: GooglePlayVerifyRequestBody): Promise<VerifyPurchaseOutcome> {
  const { productId, purchaseToken } = body;
  const packageName = PLAY_BILLING_PACKAGE_NAME;

  if (typeof purchaseToken !== "string" || !purchaseToken.trim() || purchaseToken.length > 4096) {
    return { status: 400, payload: { error: "INVALID_PURCHASE_TOKEN" } };
  }
  if (body.packageName !== PLAY_BILLING_PACKAGE_NAME) {
    pbWarn("purchase_rejected", { reason: "package_name_mismatch" });
    return { status: 400, payload: { error: "PACKAGE_NAME_MISMATCH" } };
  }
  if (!isKnownPlayBillingProductId(productId)) {
    pbWarn("purchase_rejected", { reason: "unknown_product_id" });
    return { status: 400, payload: { error: "UNKNOWN_PRODUCT_ID" } };
  }

  const client = createGooglePlayDeveloperApiClient();
  let purchase;
  try {
    purchase = await client.getSubscriptionPurchase({ packageName, productId, purchaseToken });
  } catch (err) {
    if (err instanceof GooglePlayDeveloperApiNotConfiguredError) {
      pbWarn("purchase_verification_unavailable", { reason: "api_not_configured" });
      return { status: 503, payload: { error: "GOOGLE_PLAY_API_NOT_CONFIGURED" } };
    }
    const msg = err instanceof Error ? err.message : String(err);
    pbError("purchase_verification_failed", msg);
    return { status: 502, payload: { error: "GOOGLE_PLAY_VERIFICATION_FAILED" } };
  }

  if (purchase.lineItemProductId !== productId) {
    pbWarn("purchase_rejected", { reason: "product_id_mismatch" });
    return { status: 400, payload: { error: "PRODUCT_ID_MISMATCH" } };
  }
  if (!isKnownPlayBillingBasePlanId(productId, purchase.lineItemBasePlanId)) {
    pbWarn("purchase_rejected", { reason: "base_plan_mismatch" });
    return { status: 400, payload: { error: "BASE_PLAN_MISMATCH" } };
  }
  // RELEASE-30: um purchaseToken roubado/vazado não pode ser vinculado pela PRIMEIRA vez a uma conta
  // diferente daquela que o comprou — a Play só devolve obfuscatedExternalAccountId quando o client
  // realmente passou appAccountToken na compra (compras antigas, de antes desta hardening, não têm o
  // campo; por isso o check só age quando ele está presente).
  const expectedAccountToken = hashGooglePlayAccountUid(uid);
  if (purchase.obfuscatedExternalAccountId && purchase.obfuscatedExternalAccountId !== expectedAccountToken) {
    pbWarn("purchase_rejected", { reason: "obfuscated_account_mismatch" });
    return { status: 409, payload: { error: "PURCHASE_ACCOUNT_MISMATCH" } };
  }

  const tokenHash = hashPurchaseToken(purchaseToken);
  const db = getFirebaseAdmin().firestore();
  const tokenRef = db.collection("googlePlayPurchaseTokens").doc(tokenHash);
  const planRef = db.collection("users").doc(uid).collection("planData").doc("main");

  const expiresAt = purchase.expiryTimeMillis === null ? null : new Date(purchase.expiryTimeMillis).toISOString();
  let isActive: boolean;
  let subscriptionStatus: SubscriptionStatus;
  try {
    // §5 fail-closed: um subscriptionState desconhecido nunca vira ACTIVE — lança e a compra é rejeitada.
    const entitlementState = mapGooglePlaySubscriptionState(purchase);
    isActive = isEntitledPlayState(entitlementState);
    subscriptionStatus = mapEntitlementStateToSubscriptionStatus(entitlementState);
  } catch (err) {
    if (err instanceof UnknownGooglePlaySubscriptionStateError) {
      pbWarn("purchase_rejected", { reason: "unsupported_subscription_state", state: purchase.subscriptionState });
      return { status: 502, payload: { error: "GOOGLE_PLAY_VERIFICATION_FAILED" } };
    }
    throw err;
  }

  const transactionResult = await db.runTransaction(async (transaction) => {
    const tokenDoc = await transaction.get(tokenRef);
    // §14 ownership/replay: um purchaseToken só pode estar amarrado a UM uid — nunca ao "primeiro que
    // pediu", nunca a quem o body diz que é, sempre ao uid que a Google Play Developer API confirmou
    // (via a MESMA compra) da primeira vez que este token foi verificado.
    if (tokenDoc.exists && tokenDoc.data()?.uid !== uid) {
      return { outcome: "token_conflict" as const };
    }

    const planDoc = await transaction.get(planRef);
    const existing = planDoc.exists ? planDoc.data() : null;
    const deduplicated = existing?.playPurchaseTokenHash === tokenHash && (existing?.premiumExpiresAt ?? null) === expiresAt;

    transaction.set(tokenRef, { uid, productId, verifiedAt: now() }, { merge: true });
    transaction.set(planRef, {
      billingProvider: "google_play",
      playProductId: productId,
      playPurchaseTokenHash: tokenHash,
      playOrderId: purchase.orderId ?? null,
      playPackageName: packageName,
      currentPlan: isActive ? "premium" : "free",
      premiumActive: isActive,
      premiumExpiresAt: expiresAt,
      premiumSource: "subscription",
      subscriptionStatus,
      autoRenew: purchase.autoRenewing,
      ...(isActive && !existing?.premiumStartedAt ? { premiumStartedAt: now() } : {}),
      updatedAt: now(),
    }, { merge: true });

    return { outcome: "applied" as const, deduplicated };
  });

  if (transactionResult.outcome === "token_conflict") {
    pbWarn("purchase_rejected", { reason: "token_owned_by_another_account" });
    return { status: 409, payload: { error: "PURCHASE_TOKEN_OWNED_BY_ANOTHER_ACCOUNT" } };
  }

  // Acknowledgement (§9): só depois do entitlement já estar aplicado, só se ainda pendente, nunca
  // bloqueia a concessão — a compra já foi verificada como válida pela própria consulta acima.
  if (isActive && purchase.acknowledgementState === "ACKNOWLEDGEMENT_STATE_PENDING") {
    try {
      await client.acknowledgeSubscriptionPurchase({ packageName, productId, purchaseToken });
      pbInfo("purchase_acknowledged");
    } catch (err) {
      pbWarn("purchase_acknowledgement_failed", { message: err instanceof Error ? err.message : String(err) });
    }
  }

  pbInfo("purchase_verified", { premiumActive: isActive, deduplicated: transactionResult.deduplicated });
  return {
    status: 200,
    payload: {
      premiumActive: isActive,
      currentPlan: isActive ? "premium" : "free",
      premiumExpiresAt: expiresAt,
      autoRenew: purchase.autoRenewing,
      deduplicated: transactionResult.deduplicated,
    },
  };
}

function isValidVerifyBody(value: unknown): value is GooglePlayVerifyRequestBody {
  if (!value || typeof value !== "object") return false;
  const body = value as Record<string, unknown>;
  return typeof body.productId === "string" && typeof body.purchaseToken === "string" && typeof body.packageName === "string";
}

async function handleVerify(req: Request, res: Response) {
  const uid = (req as any).firebaseUid as string;
  if (!isValidVerifyBody(req.body)) {
    return res.status(400).json({ error: "INVALID_REQUEST_BODY" });
  }
  const result = await verifyAndApplyGooglePlayPurchase(uid, req.body);
  return res.status(result.status).json(result.payload);
}

async function handleRestore(req: Request, res: Response) {
  const uid = (req as any).firebaseUid as string;
  const purchases = (req.body as { purchases?: unknown })?.purchases;
  if (!Array.isArray(purchases) || purchases.length === 0 || purchases.length > 20) {
    return res.status(400).json({ error: "INVALID_REQUEST_BODY" });
  }
  if (!purchases.every(isValidVerifyBody)) {
    return res.status(400).json({ error: "INVALID_REQUEST_BODY" });
  }
  const results = [];
  for (const purchase of purchases as GooglePlayVerifyRequestBody[]) {
    results.push(await verifyAndApplyGooglePlayPurchase(uid, purchase));
  }
  return res.json({ results: results.map((r) => ({ status: r.status, ...r.payload })) });
}

/**
 * §10 RTDN: contrato pronto, NÃO ligado a um tópico Pub/Sub real (isso é configuração de Google Cloud
 * Console, fora do escopo desta tarefa — "não configurar cloud externo sem autorização"). Recebido com
 * segurança (nunca derruba, sempre 200 para não acionar retry infinito do Pub/Sub), mas só REAGE
 * re-verificando a compra contra a Google Play Developer API — nunca concede/revoga a partir do
 * conteúdo da notificação por si só.
 */
async function handleRtdn(req: Request, res: Response) {
  try {
    const messageData = (req.body as { message?: { data?: string } })?.message?.data;
    if (!messageData) {
      pbWarn("rtdn_received_without_data");
      return res.status(200).json({ ok: true });
    }
    const decoded = JSON.parse(Buffer.from(messageData, "base64").toString("utf8"));
    const notification = decoded?.subscriptionNotification;
    const packageName = decoded?.packageName;
    if (!notification?.purchaseToken || typeof packageName !== "string") {
      pbWarn("rtdn_received_without_purchase_token");
      return res.status(200).json({ ok: true });
    }

    const tokenHash = hashPurchaseToken(notification.purchaseToken);
    const db = getFirebaseAdmin().firestore();
    const tokenDoc = await db.collection("googlePlayPurchaseTokens").doc(tokenHash).get();
    if (!tokenDoc.exists) {
      // Nunca verificado antes por este servidor — nada para reconciliar ainda; o client vai chamar
      // /verify normalmente quando o usuário abrir o app.
      pbInfo("rtdn_received_for_unknown_token");
      return res.status(200).json({ ok: true });
    }

    const uid = tokenDoc.data()?.uid as string | undefined;
    const productId = tokenDoc.data()?.productId as string | undefined;
    if (!uid || !productId) {
      return res.status(200).json({ ok: true });
    }

    await verifyAndApplyGooglePlayPurchase(uid, { productId, purchaseToken: notification.purchaseToken, packageName });
    pbInfo("rtdn_reconciled");
    return res.status(200).json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    pbError("rtdn_processing_failed", msg);
    // Ainda 200: um erro nosso não deve virar retry infinito do Pub/Sub para uma notificação que talvez
    // nem seja processável; o próximo /verify do client corrige o estado de qualquer forma.
    return res.status(200).json({ ok: false });
  }
}

export function registerGooglePlayBillingRoutes(app: Express, requireAuth: (req: Request, res: Response, next: NextFunction) => void): void {
  app.post("/api/billing/google-play/verify", requireAuth, handleVerify);
  app.post("/api/billing/google-play/restore", requireAuth, handleRestore);
  // RTDN é o Google chamando — sem Bearer do usuário. A confiança real viria da verificação da
  // assinatura OIDC do Pub/Sub push (não implementada — o tópico real não existe nesta tarefa); por
  // isso o handler nunca decide nada sozinho, só re-verifica contra a própria Google Play Developer API.
  app.post("/api/billing/google-play/rtdn", handleRtdn);
  pbInfo("Routes registered: /api/billing/google-play/{verify,restore,rtdn}");
}
