import fs from "fs";
import path from "path";
import type { Express, Request, Response, NextFunction } from "express";
import type { Server } from "http";
import { initializeFirebaseAdmin, getFirebaseAdmin } from "./firebase-admin-init";
import { registerPaymentRoutes, createOrderMercadoPagoCharge, findOrderMercadoPagoCharge, MercadoPagoOrderChargeError } from "./payments";
import { OrderChargeReservationError, startOrderMercadoPagoCharge, type StartOrderChargeResult } from "./public-catalog-order-payment-idempotency";
import { registerConnectionRoutes } from "./mercadopago-connections";
import { registerUploadRoutes } from "./uploads";
import { registerGooglePlayBillingRoutes } from "./google-play-billing";
import { registerSubscriptionRoutes } from "./subscriptions";
import { registerMarketingProRoutes, MARKETING_PRO_DEFAULT_PROVIDER_TIMEOUT_MS } from "./marketing-pro";
import { registerCreativeProfileRoutes } from "./marketing-pro-creative-profile";
import { registerProductUnderstandingRoutes } from "./marketing-pro-product-understanding";
import { registerProductCutoutPhotoroomRoutes } from "./product-cutout-photoroom";
import { registerAdsProPreparationQuotaRoutes } from "./ads-pro-preparation-quota";
import { registerOpportunityRoutes } from "./opportunity-engine";
import { registerReportStrategicSummaryRoutes } from "./report-strategic-summary";
import { registerProductPhotoEnhancementRoutes } from "./product-photo-enhancement-routes";
import { registerCatalogSearchRoutes } from "./catalog-search";
import { registerServiceQuoteRoutes } from "./service-quote-commands";
import { registerServicePaymentRoutes } from "./service-payment-commands";
import { registerServiceWorkRoutes } from "./service-work-commands";
import { registerServiceBookingRoutes } from "./service-booking-commands";
import { registerServiceAvailabilityRoutes } from "./service-availability-commands";
import { registerPublicServiceBookingRoutes } from "./service-public-booking";
import { registerOrderEditRoutes } from "./order-edit-command";
import { registerPlanAuthoritativeMutationRoutes, resolveServerPlan } from "./plan-authoritative-mutations";
import { registerPlanAccessSelectionRoutes } from "./plan-access-selection";
import { registerBookingQuotaRoutes } from "./booking-quota";
import { ensurePlanLifecycleCurrent, initializePlanCommand } from "./plan-lifecycle";
import { getPlanPurchaseAvailability } from "./plan-purchase-availability";
import { isMarketingProRealBackgroundEnabled } from "./marketing-pro-flags";
import { createGoogleMarketingProBackgroundProvider, isGoogleMarketingProCredentialConfigured } from "./marketing-pro-provider-google";
import { registerAccountDeletionRoutes } from "./account-deletion";
import { requireAdmin } from "./admin-auth";
import { registerAdminGrantRoutes, resolveUserEntitlements } from "./admin-grants";
import { registerPromotionalCampaignRoutes } from "./promotional-campaigns";
import { getGlobalConfig, setGlobalConfig } from "./subscriptions";
import { validateFirebaseStorageSetup } from "./firebase-storage-migration";
import { logError, logInfo, logWarn } from "./logger";
import {
  buildPublicCatalogPayload,
  buildPublicCatalogProductPage,
  buildPublicCatalogStore,
  resolvePublicCatalogPixKey,
  toPublicCatalogProduct,
  type PublicCatalogSourceProduct,
} from "./public-catalog";
import { checkDistributedRateLimit } from "./public-rate-limit-firestore";
import { finalizeSaleTransaction } from "./sale-finalize-transaction";
import {
  calculateOrderTotal,
  normalizeOrderPhone,
  resolveOrderPaymentMethod,
  type Order,
  type OrderItem,
  type OrderPaymentProvider,
  type OrderPaymentStatus,
} from "../client/src/lib/orders";
import { finalizeOrderReservation, releaseOrderReservation, reserveOrderCreation } from "./public-catalog-order-idempotency";
import type {
  PublicCatalogPageResponse,
  PublicCatalogPagination,
  PublicCatalogProduct,
  PublicCatalogResponse,
} from "../shared/public-catalog";
import { resolveEffectiveProductPrice } from "../shared/product-pricing";
import { REFERRAL_REWARD_LIMIT, isReferralCodeFormat } from "../shared/monetization";
import {
  CatalogSlugConflictError,
  InvalidCatalogSlugError,
  PublicCatalogDeactivatedError,
  ensurePublicCatalogSlug,
  normalizeCatalogSlug,
  persistUserSettingsWithCatalogOwnership,
  resolvePublicCatalogSettingsDoc,
  sanitizePublicSettingsPayload,
} from "./public-catalog-ownership";
 import crypto from "crypto";

const LEGACY_REFERRAL_UID_FORMAT = /^[a-zA-Z0-9_-]{10,128}$/;

function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}
function getRouteParam(req: Request, name: string): string {
  const value = req.params[name];
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function normalizeRouteDetails(details: unknown[]): unknown {
  if (details.length === 0) return undefined;
  return details.length === 1 ? details[0] : details;
}

function routeInfo(message: string, ...details: unknown[]): void {
  logInfo("routes.log", { message, details: normalizeRouteDetails(details) });
}

function routeWarn(message: string, ...details: unknown[]): void {
  logWarn("routes.log", { message, details: normalizeRouteDetails(details) });
}

function routeLogError(message: string, ...details: unknown[]): void {
  logError("routes.log", undefined, { message, details: normalizeRouteDetails(details) });
}

function isValidReferralUid(value: unknown): value is string {
  return typeof value === "string" && LEGACY_REFERRAL_UID_FORMAT.test(value);
}

type ResolvedReferralSource = {
  referrerUid: string;
  via: "code";
};

async function resolveReferralSource(
  db: FirebaseFirestore.Firestore,
  referralSource: unknown,
  currentUserId: string,
): Promise<ResolvedReferralSource | { error: "invalid_format" | "self_referral" | "referrer_not_found" }> {
  if (!isReferralCodeFormat(referralSource)) {
    return { error: "invalid_format" };
  }

  const codeDoc = await db.collection("referralCodes").doc(referralSource).get();
  const referrerUid = codeDoc.exists ? codeDoc.data()?.uid : null;
  if (!isValidReferralUid(referrerUid)) {
    return { error: "referrer_not_found" };
  }
  if (referrerUid === currentUserId) {
    return { error: "self_referral" };
  }

  const [settingsDoc, authUser] = await Promise.allSettled([
    db.collection("user_settings").doc(referrerUid).get(),
    getFirebaseAdmin().auth().getUser(referrerUid),
  ]);
  const settingsExists = settingsDoc.status === "fulfilled" && settingsDoc.value.exists;
  const authExists = authUser.status === "fulfilled" && authUser.value.uid === referrerUid;
  if (!settingsExists && !authExists) {
    return { error: "referrer_not_found" };
  }

  return { referrerUid, via: "code" };
}

const PUBLIC_CATALOG_DEFAULT_LIMIT = 24;
const PUBLIC_CATALOG_MAX_LIMIT = 48;
const PUBLIC_CATALOG_PRESENTATION_BATCH_SIZE = 250;

type PublicCatalogCursor = {
  stock: number;
  id: string;
};

function parsePublicCatalogLimit(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return PUBLIC_CATALOG_DEFAULT_LIMIT;
  return Math.min(Math.floor(parsed), PUBLIC_CATALOG_MAX_LIMIT);
}

function normalizePublicCatalogGender(value: unknown): string | undefined {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized || normalized === "todos" || normalized === "all") return undefined;
  return normalized;
}

function encodePublicCatalogCursor(cursor: PublicCatalogCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodePublicCatalogCursor(value: unknown): PublicCatalogCursor | null {
  if (!value || Array.isArray(value)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(String(value), "base64url").toString("utf8"));
    if (!parsed || typeof parsed.id !== "string" || !Number.isFinite(Number(parsed.stock))) return null;
    return { id: parsed.id, stock: Number(parsed.stock) };
  } catch {
    return null;
  }
}

function getPublicCatalogProductImage(product: Record<string, any> | null | undefined): string | undefined {
  const image = product?.imageUrl || product?.photoUrl || product?.image;
  return typeof image === "string" && image.trim() ? image : undefined;
}

const PUBLIC_CATALOG_RATE_LIMIT_WINDOW_MS = 60_000;
const PUBLIC_CATALOG_RATE_LIMIT_MAX = 60;
const PUBLIC_CATALOG_IP_RATE_LIMIT_MAX = 240;
const PUBLIC_CATALOG_RATE_LIMIT_MAX_KEYS = 10_000;
const publicCatalogRateLimitMap = new Map<string, { count: number; resetAt: number }>();
const publicCatalogIpRateLimitMap = new Map<string, { count: number; resetAt: number }>();

export function resetPublicCatalogRateLimitsForTests(): void {
  publicCatalogRateLimitMap.clear();
  publicCatalogIpRateLimitMap.clear();
}

function checkPublicCatalogIpRateLimit(
  clientKey: string,
  now = Date.now(),
): { allowed: boolean; remaining: number; retryAfterSeconds: number } {
  const key = clientKey || "unknown";
  const current = publicCatalogIpRateLimitMap.get(key);

  if (!current || now >= current.resetAt) {
    if (publicCatalogIpRateLimitMap.size >= PUBLIC_CATALOG_RATE_LIMIT_MAX_KEYS) {
      publicCatalogIpRateLimitMap.forEach((entry, storedKey) => {
        if (now >= entry.resetAt) publicCatalogIpRateLimitMap.delete(storedKey);
      });
      if (publicCatalogIpRateLimitMap.size >= PUBLIC_CATALOG_RATE_LIMIT_MAX_KEYS) {
        const oldestKey = publicCatalogIpRateLimitMap.keys().next().value;
        if (oldestKey) publicCatalogIpRateLimitMap.delete(oldestKey);
      }
    }
    publicCatalogIpRateLimitMap.set(key, {
      count: 1,
      resetAt: now + PUBLIC_CATALOG_RATE_LIMIT_WINDOW_MS,
    });
    return {
      allowed: true,
      remaining: PUBLIC_CATALOG_IP_RATE_LIMIT_MAX - 1,
      retryAfterSeconds: Math.ceil(PUBLIC_CATALOG_RATE_LIMIT_WINDOW_MS / 1000),
    };
  }

  const retryAfterSeconds = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
  if (current.count >= PUBLIC_CATALOG_IP_RATE_LIMIT_MAX) {
    return { allowed: false, remaining: 0, retryAfterSeconds };
  }

  current.count += 1;
  return {
    allowed: true,
    remaining: PUBLIC_CATALOG_IP_RATE_LIMIT_MAX - current.count,
    retryAfterSeconds,
  };
}

export function checkPublicCatalogRateLimit(
  clientKey: string,
  rawSlug: string,
  now = Date.now(),
): { allowed: boolean; remaining: number; retryAfterSeconds: number } {
  const slug = normalizeCatalogSlug(rawSlug) || "invalid";
  const key = `${clientKey}:${slug}`;
  const current = publicCatalogRateLimitMap.get(key);

  if (!current || now >= current.resetAt) {
    if (publicCatalogRateLimitMap.size >= PUBLIC_CATALOG_RATE_LIMIT_MAX_KEYS) {
      publicCatalogRateLimitMap.forEach((entry, storedKey) => {
        if (now >= entry.resetAt) publicCatalogRateLimitMap.delete(storedKey);
      });
      if (publicCatalogRateLimitMap.size >= PUBLIC_CATALOG_RATE_LIMIT_MAX_KEYS) {
        const oldestKey = publicCatalogRateLimitMap.keys().next().value;
        if (oldestKey) publicCatalogRateLimitMap.delete(oldestKey);
      }
    }
    publicCatalogRateLimitMap.set(key, {
      count: 1,
      resetAt: now + PUBLIC_CATALOG_RATE_LIMIT_WINDOW_MS,
    });
    return {
      allowed: true,
      remaining: PUBLIC_CATALOG_RATE_LIMIT_MAX - 1,
      retryAfterSeconds: Math.ceil(PUBLIC_CATALOG_RATE_LIMIT_WINDOW_MS / 1000),
    };
  }

  const retryAfterSeconds = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
  if (current.count >= PUBLIC_CATALOG_RATE_LIMIT_MAX) {
    return { allowed: false, remaining: 0, retryAfterSeconds };
  }

  current.count += 1;
  return {
    allowed: true,
    remaining: PUBLIC_CATALOG_RATE_LIMIT_MAX - current.count,
    retryAfterSeconds,
  };
}

function getPublicCatalogClientKey(req: Request): string {
  const forwardedFor = req.headers["x-forwarded-for"];
  const forwardedValue = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor;
  return String(forwardedValue?.split(",")[0]?.trim() || req.ip || req.socket.remoteAddress || "unknown")
    .slice(0, 128);
}

export function publicCatalogRateLimit(req: Request, res: Response, next: NextFunction) {
  const clientKey = getPublicCatalogClientKey(req);
  const ipDecision = checkPublicCatalogIpRateLimit(clientKey);
  const decision = checkPublicCatalogRateLimit(
    clientKey,
    getRouteParam(req, "storeSlug"),
  );
  res.setHeader("X-RateLimit-Limit", String(PUBLIC_CATALOG_RATE_LIMIT_MAX));
  res.setHeader("X-RateLimit-Remaining", String(decision.remaining));
  res.setHeader("X-RateLimit-IP-Limit", String(PUBLIC_CATALOG_IP_RATE_LIMIT_MAX));
  res.setHeader("X-RateLimit-IP-Remaining", String(ipDecision.remaining));
  if (!ipDecision.allowed || !decision.allowed) {
    res.setHeader("Retry-After", String(Math.max(ipDecision.retryAfterSeconds, decision.retryAfterSeconds)));
    return res.status(429).json({ error: "CATALOG_RATE_LIMITED" });
  }
  return next();
}

export async function findPublicCatalogSettingsDoc(ref: any, rawSlug: string) {
  const slug = normalizeCatalogSlug(rawSlug);
  if (!slug) return null;
  const matches = new Map<string, any>();
  const candidates = Array.from(new Set([rawSlug.trim(), slug].filter(Boolean)));
  for (const field of ["catalogSlug", "catalog_slug", "userSlug", "slug"]) {
    for (const candidate of candidates) {
      const snapshot = await ref.where(field, "==", candidate).limit(2).get();
      for (const doc of snapshot.docs) matches.set(doc.id, doc);
      if (matches.size > 1) return null;
    }
  }
  return matches.size === 1 ? matches.values().next().value : null;
}

// Helper: Structured error response with audit context
function errorResponse(
  res: Response,
  statusCode: number,
  errorType: string,
  message: string,
  context?: Record<string, any>
) {
  const timestamp = new Date().toISOString();
  const errorId = crypto.randomBytes(6).toString("hex");
  const publicMessage = statusCode >= 500 ? "Ocorreu um erro temporário." : message;

  logError("routes.error_response", undefined, {
    errorId,
    status: statusCode,
    errorType,
    message,
    context,
  });

  return res.status(statusCode).json({
    error: errorType,
    message: publicMessage,
    errorId,
    timestamp,
  });
}

// Middleware: verify Firebase ID token and attach uid to request
async function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      routeWarn("[auth] Missing Authorization header for:", req.path);
      return res.status(401).json({ error: "Unauthorized: missing token" });
    }
    const token = authHeader.slice(7);
    const admin = getFirebaseAdmin();
    // checkRevoked=true makes disabled/deleted account tokens fail immediately on server APIs.
    // Firestore/Storage Rules independently consult the deletion tombstone for direct SDK access.
    const decoded = await admin.auth().verifyIdToken(token, true);
    const deletionRequest = await admin.firestore().collection("account_deletion_requests").doc(decoded.uid).get();
    const isDeletionRetry = req.method === "DELETE" && req.path === "/api/account";
    if (deletionRequest.exists && !isDeletionRetry) {
      return res.status(403).json({ error: "Forbidden: account deletion is in progress" });
    }
    (req as any).firebaseUid = decoded.uid;
    next();
  } catch (e) {
    routeWarn("[auth] Token verification failed:", (e as any)?.message);
    return res.status(401).json({ error: "Unauthorized: invalid token" });
  }
}

// Middleware: verify the authenticated user owns the resource
function requireOwnership(req: Request, res: Response, next: NextFunction) {
  const firebaseUid = (req as any).firebaseUid;
  const { userId } = req.params;

  // If we have a verified token, enforce ownership
  if (firebaseUid && userId && firebaseUid !== userId) {
    return res.status(403).json({ error: "Forbidden: you can only access your own data" });
  }

  next();
}

// RELEASE V1 §4.1: `requireAdmin` foi extraído para server/admin-auth.ts — reaproveitado também por
// marketing-pro.ts (gate de Anúncios Pro) sem criar um segundo mecanismo de admin nem import circular.

// Rate limit map: tracks grant requests per admin (simple in-memory, for production use Redis)
const grantRateLimitMap = new Map<string, { count: number; resetAt: number }>();
function checkGrantRateLimit(adminUid: string): boolean {
  const now = Date.now();
  const limit = grantRateLimitMap.get(adminUid);
  
  if (!limit || now > limit.resetAt) {
    // Reset window
    grantRateLimitMap.set(adminUid, { count: 1, resetAt: now + 60000 }); // 1-per-minute limit
    return true;
  }
  
  if (limit.count >= 5) {
    // Max 5 grants per minute
    return false;
  }
  
  limit.count++;
  return true;
}


const REFERRAL_RATE_LIMIT_WINDOW_MS = 60_000;
const REFERRAL_RATE_LIMIT_MAX = 10;
const referralRateLimitMap = new Map<string, { count: number; resetAt: number }>();

function checkReferralRateLimit(uid: string, action: "track" | "validate"): boolean {
  const key = `${uid}:${action}`;
  const now = Date.now();
  const current = referralRateLimitMap.get(key);
  if (!current || now > current.resetAt) {
    referralRateLimitMap.set(key, { count: 1, resetAt: now + REFERRAL_RATE_LIMIT_WINDOW_MS });
    return true;
  }
  if (current.count >= REFERRAL_RATE_LIMIT_MAX) return false;
  current.count += 1;
  return true;
}

function referralEventId(referrerUid: string, referredUid: string): string {
  return crypto.createHash("sha256").update(`${referrerUid}:${referredUid}`).digest("hex");
}

// RELEASE-02 — `user_settings.onboarding_completed` continua um booleano que o PRÓPRIO usuário grava
// (é estado de UX legítimo: qual tela mostrar), e por isso não pode ser, sozinho, o critério que decide
// se um referral concede Premium — qualquer um pode criar uma conta descartável e fazer um POST direto
// setando esse campo, sem nunca ter usado o app de verdade ("três UIDs descartáveis podem conceder
// Premium por referral"). `admin.auth().getUser(uid).metadata.creationTime` é a peça que falta: vem
// inteiramente do Firebase Auth (o servidor), nunca do body do cliente, e só cresce com o tempo — não
// tem como um script forjar uma conta "já antiga" na hora em que a cria. Exigir uma idade mínima aqui
// fecha o cenário determinístico do exploit (farm de N contas descartáveis, tudo em uma única execução
// de script) sem inventar heurística/anti-fraude: nenhuma pontuação, nenhum sinal comportamental — só
// uma comparação de timestamp que o cliente não controla. Um atacante paciente disposto a esperar entre
// cada conta ainda poderia insistir; isso é fricção deliberadamente mínima, não uma solução completa.
export const MIN_REFERRAL_ACCOUNT_AGE_MS = 30_000;

export function isReferralAccountOldEnough(creationTime: string | undefined | null, now: () => Date = () => new Date()): boolean {
  if (!creationTime) return false;
  const createdAtMs = new Date(creationTime).getTime();
  if (!Number.isFinite(createdAtMs)) return false;
  return now().getTime() - createdAtMs >= MIN_REFERRAL_ACCOUNT_AGE_MS;
}

// Catálogo público mostra "Cartão" só quando o lojista tem Mercado Pago realmente ativo — nunca
// expõe qual/quantas conexões existem, só o booleano derivado (mesmo padrão de
// settings-mercadopago.tsx: connections.filter(c => c.status === "active")).
async function hasActiveMercadoPagoConnection(db: FirebaseFirestore.Firestore, uid: string): Promise<boolean> {
  const snapshot = await db
    .collection("users").doc(uid)
    .collection("mercadopago_connections")
    .where("status", "==", "active")
    .limit(1)
    .get();
  return !snapshot.empty;
}

/**
 * PLAN-IMPL-03-VERIFY §5 — hasteada para escopo de módulo e exportada (antes um closure dentro de
 * `registerRoutes`, comportamento idêntico: nunca fechava sobre nada do escopo de `registerRoutes`, só
 * chamava `getFirebaseAdmin()` diretamente) para F1 poder chamá-la diretamente com um `db` quebrado de
 * propósito e provar que a superfície pública realmente falha fechado, não só por inspeção de código.
 */
export async function loadPublicCatalogSettings(rawSlug: string, db: FirebaseFirestore.Firestore = getFirebaseAdmin().firestore()) {
  const slug = normalizeCatalogSlug(rawSlug);
  if (!slug) return null;
  const settingsDoc = await resolvePublicCatalogSettingsDoc(db, rawSlug);
  if (!settingsDoc) return null;
  const settings = settingsDoc.data() ?? {};
  const catalogEnabled = settings.enablePublicCatalog ?? settings.catalogEnabled ?? settings.catalog_enabled ?? true;
  if (catalogEnabled === false || settings.disablePublicCatalog === true) {
    throw new PublicCatalogDeactivatedError();
  }
  const cardAvailable = await hasActiveMercadoPagoConnection(db, settingsDoc.id);
  // PLAN-IMPL-03 §3/§4/F1 — superfície pública é fail-closed: lifecycle/reconciliation precisa terminar
  // antes de qualquer resposta de catálogo, ou o handler externo devolve 503 temporário em vez de
  // servir Products Premium stale. Não expõe detalhes de plano/billing/trial ao visitante anônimo.
  await ensurePlanLifecycleCurrent(db, settingsDoc.id);
  return {
    uid: settingsDoc.id,
    slug,
    settings,
    store: buildPublicCatalogStore(settings, slug, cardAvailable),
  };
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // Initialize firebase-admin once when routes are registered
  await initializeFirebaseAdmin();

  // Register payment routes (Mercado Pago)
  registerPaymentRoutes(app, requireAuth);

  // Register Mercado Pago connection routes (Caminho B: per-revendedor OAuth)
  registerConnectionRoutes(app, requireAuth);
  registerUploadRoutes(app, requireAuth);

  // Register App Subscription routes (Premium plan billing — isolated from revendedor payments)
  registerSubscriptionRoutes(app, requireAuth);

  // RELEASE-07: Google Play Billing (Android) — entitlement server-owned, mesmo planData/main
  registerGooglePlayBillingRoutes(app, requireAuth);

  // Register Anúncios Pro routes (PRO-06A: contract + entitlement + idempotência; PRO-08: provider real
  // de background atrás de flag+credencial; PRO-09: flag também trava em código enquanto o gate
  // semântico não existir — ver isMarketingProRealBackgroundEnabled). Flag OFF, credencial ausente, ou
  // gate semântico indisponível mantêm o mock local/seguro.
  const marketingProRealBackgroundEnabled = isMarketingProRealBackgroundEnabled() && isGoogleMarketingProCredentialConfigured();
  registerMarketingProRoutes(app, requireAuth, marketingProRealBackgroundEnabled
    ? { provider: createGoogleMarketingProBackgroundProvider(MARKETING_PRO_DEFAULT_PROVIDER_TIMEOUT_MS), requireCostReservation: true }
    : {});

  // PRO-10B — Perfil Criativo (SellerCreativeProfile), item 4/4 (o mais fraco) da hierarquia de decisão
  // do Creative Intelligence — nunca autoridade final, só um insumo a mais para o Creative Director.
  registerCreativeProfileRoutes(app, requireAuth);

  // PRO-11B — análise visual Gemini opt-in; entitlement e ownership são revalidados na própria rota.
  registerProductUnderstandingRoutes(app, requireAuth);

  // RELEASE V1 §6 — recorte PhotoRoom real (Pro/Premium/admin, cota mensal PLAN-IMPL-05); entitlement e
  // ownership revalidados na rota.
  registerProductCutoutPhotoroomRoutes(app, requireAuth);
  // PLAN-IMPL-05 §31 — leitura de uso mensal para a UI (Plano e uso), mesmo padrão de registerBookingQuotaRoutes.
  registerAdsProPreparationQuotaRoutes(app, requireAuth, resolveServerPlan);
  // PLAN-IMPL-07A §22 — opportunity engine determinística (cliente inativo/produto parado/agenda ociosa);
  // entitlement Premium/trial revalidado na rota, nunca só ocultação no client.
  registerOpportunityRoutes(app, requireAuth, resolveServerPlan);
  // PLAN-IMPL-07B §11/§22 — resumo estratégico de Relatórios (Premium), reaproveita computeOpportunities
  // acima sem duplicar nenhuma regra de detecção; mesmo gate de entitlement.
  registerReportStrategicSummaryRoutes(app, requireAuth, resolveServerPlan);

  // REVENDASMART-OWNER-ACCESS-02 — concessões internas (Tester/Premium+), sempre atrás de requireAdmin.
  registerAdminGrantRoutes(app, requireAuth);

  // PROMOTIONAL-CAMPAIGNS-01 — Sorteios Promocionais (admin-only); rotas públicas do módulo (leitura da
  // grade + claim) não usam requireAuth — autorização vem do token da campanha, não de login.
  registerPromotionalCampaignRoutes(app, requireAuth);

  // RELEASE V1 §7 — melhoria real de foto (Premium/admin); entitlement e ownership revalidados na rota.
  registerProductPhotoEnhancementRoutes(app, requireAuth);
  registerCatalogSearchRoutes(app, requireAuth);
  registerServiceWorkRoutes(app, requireAuth);
  registerServiceQuoteRoutes(app, requireAuth);
  registerServicePaymentRoutes(app, requireAuth);
  registerServiceBookingRoutes(app, requireAuth);
  registerServiceAvailabilityRoutes(app, requireAuth);
  // PEDIDOS EDITÁVEIS Etapa 2A — edição de itens sempre pelo servidor (as Rules seguem bloqueando o cliente).
  registerOrderEditRoutes(app, requireAuth);
  registerPlanAuthoritativeMutationRoutes(app, requireAuth);
  registerPlanAccessSelectionRoutes(app, requireAuth);
  registerBookingQuotaRoutes(app, requireAuth, resolveServerPlan);
  // SERV-PUBLIC-01 — superfície pública dedicada, sem requireAuth (§5/§26): reaproveita o mesmo Booking
  // Core/Availability acima por dentro, nunca os expõe diretamente ao visitante anônimo.
  registerPublicServiceBookingRoutes(app);

  // RELEASE-03: UID is derived exclusively by requireAuth; request bodies never control ownership.
  registerAccountDeletionRoutes(app, requireAuth);
  // Finalize a manual sale atomically: sale + stock + installment schedule.
  app.post("/api/sales/finalize", requireAuth, async (req, res) => {
    const uid = (req as any).firebaseUid as string;
    const body = req.body ?? {};

    try {
      const saleId = typeof body.saleId === "string" && /^[a-zA-Z0-9_-]{6,80}$/.test(body.saleId)
        ? body.saleId
        : crypto.randomUUID();
      const clientId = typeof body.clientId === "string" ? body.clientId.trim() : "";
      const rawProducts = Array.isArray(body.products) ? body.products : [];
      const paymentType = body.paymentType === "prazo" ? "prazo" : body.paymentType === "avista" ? "avista" : null;
      const discountType = body.discountType === "percent" ? "percent" : "fixed";
      const discountValue = Number(body.discountValue ?? 0);
      const downPayment = Number(body.downPayment ?? 0);
      const installmentCount = Number(body.installments ?? 0);

      if (!clientId || !paymentType || rawProducts.length === 0 || rawProducts.length > 100) {
        return res.status(400).json({ code: "INVALID_SALE", message: "Dados da venda inválidos." });
      }
      if (!Number.isFinite(discountValue) || discountValue < 0 ||
          (discountType === "percent" && discountValue > 100) ||
          !Number.isFinite(downPayment) || downPayment < 0) {
        return res.status(400).json({ code: "INVALID_TOTALS", message: "Valores da venda inválidos." });
      }
      if (paymentType === "prazo" && (!Number.isInteger(installmentCount) || installmentCount < 1 || installmentCount > 12)) {
        return res.status(400).json({ code: "INVALID_INSTALLMENTS", message: "Quantidade de parcelas inválida." });
      }

      const requestedProducts = new Map<string, number>();
      for (const item of rawProducts) {
        const productId = typeof item?.productId === "string" ? item.productId.trim() : "";
        const quantity = Number(item?.quantity);
        if (!productId || !Number.isInteger(quantity) || quantity <= 0 || quantity > 9999) {
          return res.status(400).json({ code: "INVALID_PRODUCT", message: "Produto ou quantidade inválida." });
        }
        requestedProducts.set(productId, (requestedProducts.get(productId) ?? 0) + quantity);
      }

      const admin = getFirebaseAdmin();
      const db = admin.firestore();

      const result = await finalizeSaleTransaction(db, {
        uid,
        saleId,
        clientId,
        products: Array.from(requestedProducts.entries()).map(([productId, quantity]) => ({ productId, quantity })),
        paymentType,
        discountType,
        discountValue,
        downPayment,
        installmentCount,
        paymentMethod: body.paymentMethod,
        downPaymentMethod: body.downPaymentMethod,
      });

      return res.status(201).json(result);
    } catch (error) {
      const code = error instanceof Error ? error.message : "SALE_TRANSACTION_FAILED";
      if (code === "SALE_ALREADY_EXISTS") {
        return res.status(409).json({ code, message: "Esta venda já foi finalizada." });
      }
      if (code === "CLIENT_NOT_FOUND") {
        return res.status(400).json({ code, message: "Cliente não encontrado." });
      }
      if (code === "DOWN_PAYMENT_EXCEEDS_TOTAL") {
        return res.status(400).json({ code, message: "A entrada não pode ser maior que o total." });
      }
      if (code.startsWith("INSUFFICIENT_STOCK:")) {
        return res.status(409).json({ code: "INSUFFICIENT_STOCK", message: `Estoque insuficiente para ${code.slice(19)}.` });
      }
      if (code.startsWith("PRODUCT_NOT_FOUND:") || code.startsWith("INVALID_PRODUCT_PRICE:") || code.startsWith("PRODUCT_NOT_AVAILABLE:")) {
        return res.status(400).json({ code: code.split(":")[0], message: "Um produto da venda não está mais disponível." });
      }
      return errorResponse(res, 500, "SALE_TRANSACTION_FAILED", "Não foi possível finalizar a venda.", { uid });
    }
  });

  const loadPublicCatalogPresentationInputs = async (uid: string) => {
    const admin = getFirebaseAdmin();
    const db = admin.firestore();
    const documentId = admin.firestore.FieldPath.documentId();
    const products: PublicCatalogSourceProduct[] = [];
    const sales: Record<string, unknown>[] = [];

    let lastProductDoc: any = null;
    do {
      let query: any = db.collection("users").doc(uid).collection("products")
        .orderBy(documentId)
        .limit(PUBLIC_CATALOG_PRESENTATION_BATCH_SIZE);
      if (lastProductDoc) query = query.startAfter(lastProductDoc.id);
      const snapshot = await query.get();
      for (const doc of snapshot.docs) products.push({ id: doc.id, data: doc.data() ?? {} });
      lastProductDoc = snapshot.docs.length === PUBLIC_CATALOG_PRESENTATION_BATCH_SIZE
        ? snapshot.docs[snapshot.docs.length - 1]
        : null;
    } while (lastProductDoc);

    let lastSaleDoc: any = null;
    do {
      let query: any = db.collection("users").doc(uid).collection("sales")
        .select("products")
        .orderBy(documentId)
        .limit(PUBLIC_CATALOG_PRESENTATION_BATCH_SIZE);
      if (lastSaleDoc) query = query.startAfter(lastSaleDoc.id);
      const snapshot = await query.get();
      for (const doc of snapshot.docs) sales.push(doc.data() ?? {});
      lastSaleDoc = snapshot.docs.length === PUBLIC_CATALOG_PRESENTATION_BATCH_SIZE
        ? snapshot.docs[snapshot.docs.length - 1]
        : null;
    } while (lastSaleDoc);

    return { products, sales };
  };

  const paginatePublicCatalogProducts = ({
    products,
    limit,
    gender,
  }: {
    products: readonly PublicCatalogProduct[];
    limit: number;
    gender?: string;
  }): { products: PublicCatalogProduct[]; pagination: PublicCatalogPagination } => {
    const sorted = [...products].sort((left, right) =>
      right.availableQuantity - left.availableQuantity
      || left.id.localeCompare(right.id),
    );
    const filtered = gender
      ? sorted.filter((product) => String(product.gender || "").trim().toLowerCase() === gender)
      : sorted;
    const pageProducts = filtered.slice(0, limit);
    const lastProduct = pageProducts[pageProducts.length - 1];
    const hasMore = filtered.length > limit;
    return {
      products: pageProducts,
      pagination: {
        nextCursor: hasMore && lastProduct
          ? encodePublicCatalogCursor({ stock: lastProduct.availableQuantity, id: lastProduct.id })
          : null,
        hasMore,
        limit,
      },
    };
  };

  const loadPublicCatalogProductsPage = async ({
    uid,
    settings,
    cursor,
    gender,
    limit,
  }: {
    uid: string;
    settings: Record<string, unknown>;
    cursor?: PublicCatalogCursor | null;
    gender?: string;
    limit: number;
  }) => {
    const admin = getFirebaseAdmin();
    const db = admin.firestore();
    const documentId = admin.firestore.FieldPath.documentId();
    let productsQuery: any = db.collection("users").doc(uid).collection("products");
    if (gender) productsQuery = productsQuery.where("gender", "==", gender);
    productsQuery = productsQuery.orderBy("stock", "desc").orderBy(documentId).limit(limit + 1);
    if (cursor) productsQuery = productsQuery.startAfter(cursor.stock, cursor.id);

    const snapshot = await productsQuery.get();
    const docs = snapshot.docs.slice(0, limit);
    const products = buildPublicCatalogProductPage({
      slug: "",
      settings,
      products: docs.map((doc: any) => ({ id: doc.id, data: doc.data() ?? {} })),
      now: new Date(),
    });
    const lastDoc = docs[docs.length - 1];
    const hasMore = snapshot.docs.length > limit;
    const nextCursor = hasMore && lastDoc
      ? encodePublicCatalogCursor({ stock: Number(lastDoc.get("stock") || 0), id: lastDoc.id })
      : null;

    return {
      products,
      pagination: { nextCursor, hasMore, limit },
    } satisfies PublicCatalogPageResponse;
  };

  const loadPublicCatalogOgImage = async (uid: string) => {
    const db = getFirebaseAdmin().firestore();
    const snapshot = await db.collection("users").doc(uid).collection("products").orderBy("imageUrl").limit(1).get();
    const product = snapshot.docs[0]?.data();
    return getPublicCatalogProductImage(product) || "https://revendasmart.vercel.app/favicon.png";
  };

  const loadPublicCatalog = async (rawSlug: string, options: { gender?: string; limit?: number } = {}) => {
    const catalogSettings = await loadPublicCatalogSettings(rawSlug);
    if (!catalogSettings) return null;
    const input = await loadPublicCatalogPresentationInputs(catalogSettings.uid);
    const payload = buildPublicCatalogPayload({
      slug: catalogSettings.slug,
      settings: catalogSettings.settings,
      products: input.products,
      sales: input.sales,
      now: new Date(),
      cardAvailable: catalogSettings.store.cardAvailable,
    });
    const page = paginatePublicCatalogProducts({
      products: payload.products,
      gender: options.gender,
      limit: options.limit ?? PUBLIC_CATALOG_DEFAULT_LIMIT,
    });
    return {
      store: payload.store,
      presentation: payload.presentation,
      products: page.products,
      pagination: page.pagination,
    } satisfies PublicCatalogResponse;
  };

  app.get("/api/public/catalog/:storeSlug", publicCatalogRateLimit, async (req, res) => {
    try {
      const limit = parsePublicCatalogLimit(req.query.limit);
      const gender = normalizePublicCatalogGender(req.query.gender);
      const catalog = await loadPublicCatalog(getRouteParam(req, "storeSlug"), { gender, limit });
      if (!catalog) return res.status(404).json({ error: "CATALOG_NOT_FOUND" });
      res.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
      return res.json(catalog);
    } catch (error) {
      if (error instanceof PublicCatalogDeactivatedError) return res.status(404).json({ error: "CATALOG_DEACTIVATED" });
      return errorResponse(res, 503, "CATALOG_TEMPORARILY_UNAVAILABLE", error instanceof Error ? error.message : "Unknown error");
    }
  });

  app.get("/api/public/catalog/:storeSlug/products", publicCatalogRateLimit, async (req, res) => {
    try {
      const catalogSettings = await loadPublicCatalogSettings(getRouteParam(req, "storeSlug"));
      if (!catalogSettings) return res.status(404).json({ error: "CATALOG_NOT_FOUND" });
      const limit = parsePublicCatalogLimit(req.query.limit);
      const cursor = decodePublicCatalogCursor(req.query.cursor);
      const gender = normalizePublicCatalogGender(req.query.gender);
      const page = await loadPublicCatalogProductsPage({
        uid: catalogSettings.uid,
        settings: catalogSettings.settings,
        cursor,
        gender,
        limit,
      });
      res.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
      return res.json(page);
    } catch (error) {
      if (error instanceof PublicCatalogDeactivatedError) return res.status(404).json({ error: "CATALOG_NOT_FOUND" });
      return errorResponse(res, 503, "CATALOG_PRODUCTS_TEMPORARILY_UNAVAILABLE", error instanceof Error ? error.message : "Unknown error");
    }
  });

  // LGPD §7 (REVENDASMART-LGPD-ANPD-REMEDIATION-01): a chave Pix do lojista (frequentemente um
  // CPF/telefone/e-mail) não vai mais na carga inicial do catálogo, que qualquer visitante recebe só
  // de abrir a URL. Fica atrás deste endpoint dedicado, chamado pelo cliente só quando o comprador
  // efetivamente abre a etapa de pagamento por Pix — reduz a exposição sem remover a funcionalidade.
  app.get("/api/public/catalog/:storeSlug/pix-key", publicCatalogRateLimit, async (req, res) => {
    try {
      const catalogSettings = await loadPublicCatalogSettings(getRouteParam(req, "storeSlug"));
      if (!catalogSettings) return res.status(404).json({ error: "CATALOG_NOT_FOUND" });
      const pixKey = resolvePublicCatalogPixKey(catalogSettings.settings);
      if (!pixKey) return res.status(404).json({ error: "PIX_KEY_NOT_CONFIGURED" });
      res.setHeader("Cache-Control", "no-store");
      return res.json({ pixKey });
    } catch (error) {
      if (error instanceof PublicCatalogDeactivatedError) return res.status(404).json({ error: "CATALOG_NOT_FOUND" });
      return errorResponse(res, 503, "CATALOG_PIX_KEY_TEMPORARILY_UNAVAILABLE", error instanceof Error ? error.message : "Unknown error");
    }
  });

  const PUBLIC_ORDER_MAX_ITEMS = 50;
  const PUBLIC_ORDER_MAX_QUANTITY_PER_ITEM = 999;
  // Só o charset seguro para virar ID de documento Firestore — o cliente gera este valor
  // (crypto.randomUUID() ou um fallback com timestamp), nunca deve ser confiado sem validar.
  const PUBLIC_ORDER_CLIENT_ORDER_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

  interface CreatePublicOrderBody {
    clientOrderId?: unknown;
    clientName?: unknown;
    clientPhone?: unknown;
    paymentMethod?: unknown;
    items?: unknown;
  }

  // POST /api/public/catalog/:storeSlug/orders — cria o pedido no servidor a partir do fechamento do
  // carrinho público. Não autenticado (o visitante não tem conta), mas toda escrita usa o Admin SDK —
  // nenhum dado do carrinho é gravado direto pelo cliente, e preço/estoque são sempre recalculados
  // aqui a partir do catálogo real, nunca aceitos do corpo da requisição.
  app.post("/api/public/catalog/:storeSlug/orders", publicCatalogRateLimit, async (req, res) => {
    try {
      // LGPD/segurança (REVENDASMART-LGPD-ANPD-REMEDIATION-01, Fase 10): camada extra Firestore-backed,
      // distribuída de verdade entre instâncias do Cloud Run — não substitui o middleware acima (que
      // continua barato/rápido para o caso comum), mas garante um teto real de abuso financeiro mesmo
      // sob escala horizontal, já que criar pedido é uma escrita com efeito de negócio, não uma leitura
      // cacheada pela CDN.
      const distributedKey = `order:${getPublicCatalogClientKey(req)}:${getRouteParam(req, "storeSlug")}`;
      const distributedDecision = await checkDistributedRateLimit(
        getFirebaseAdmin().firestore(),
        distributedKey,
        { windowMs: 60_000, max: 20 },
      );
      if (!distributedDecision.allowed) {
        res.setHeader("Retry-After", String(distributedDecision.retryAfterSeconds));
        return res.status(429).json({ error: "CATALOG_RATE_LIMITED" });
      }

      const catalogSettings = await loadPublicCatalogSettings(getRouteParam(req, "storeSlug"));
      if (!catalogSettings) return res.status(404).json({ error: "CATALOG_NOT_FOUND" });
      if (catalogSettings.store.allowWhatsappOrders === false) {
        return errorResponse(res, 403, "ORDERS_DISABLED", "Esta loja não está recebendo pedidos no momento.");
      }

      const body = (req.body ?? {}) as CreatePublicOrderBody;
      const clientOrderId = typeof body.clientOrderId === "string" ? body.clientOrderId.trim().slice(0, 128) : "";
      if (!clientOrderId || !PUBLIC_ORDER_CLIENT_ORDER_ID_PATTERN.test(clientOrderId)) {
        return errorResponse(res, 400, "INVALID_CLIENT_ORDER_ID", "clientOrderId é obrigatório e precisa ser um identificador simples (letras, números, - e _).");
      }

      const paymentMethod = resolveOrderPaymentMethod(body.paymentMethod);
      if (!paymentMethod) return errorResponse(res, 400, "INVALID_PAYMENT_METHOD", "Forma de pagamento inválida.");
      if (paymentMethod === "pix" && !catalogSettings.store.pixAvailable) {
        return errorResponse(res, 400, "PIX_NOT_CONFIGURED", "Esta loja não tem chave Pix cadastrada.");
      }
      if (paymentMethod === "card" && !catalogSettings.store.cardAvailable) {
        return errorResponse(res, 400, "CARD_NOT_AVAILABLE", "Pagamento por cartão indisponível para esta loja.");
      }

      const rawItems = Array.isArray(body.items) ? body.items : [];
      if (rawItems.length === 0 || rawItems.length > PUBLIC_ORDER_MAX_ITEMS) {
        return errorResponse(res, 400, "INVALID_ITEMS", "O pedido precisa ter entre 1 e 50 itens.");
      }
      const requestedItems: { productId: string; quantity: number }[] = [];
      for (const raw of rawItems) {
        const item = (raw ?? {}) as { productId?: unknown; quantity?: unknown };
        const productId = typeof item.productId === "string" ? item.productId.trim() : "";
        const quantity = Number(item.quantity);
        if (!productId || !Number.isInteger(quantity) || quantity <= 0 || quantity > PUBLIC_ORDER_MAX_QUANTITY_PER_ITEM) {
          return errorResponse(res, 400, "INVALID_ITEM", "Um item do pedido é inválido.");
        }
        requestedItems.push({ productId, quantity });
      }

      const uid = catalogSettings.uid;
      const db = getFirebaseAdmin().firestore();
      const ordersRef = db.collection("users").doc(uid).collection("orders");
      // RELEASE-CHECKOUT-02 §1: query→write tinha uma janela de corrida (duas requisições concorrentes
      // podiam ambas ver "não existe" e criar dois pedidos). `reserveOrderCreation` usa uma Firestore
      // transaction (mesmo padrão de `reserveGeneration` em product-cutout-photoroom.ts): só uma das
      // requisições concorrentes consegue criar o documento de reserva; a outra vê `alreadyExisted` e
      // devolve o pedido já reservado/criado em vez de duplicar.
      const reservation = await reserveOrderCreation(db, uid, clientOrderId);
      const orderRef = ordersRef.doc(reservation.orderId);
      const nowIso = new Date().toISOString();

      if (reservation.alreadyExisted) {
        if (reservation.status === "pending") {
          // Concorrência real: outra requisição com o MESMO clientOrderId está no meio do processamento
          // agora — nunca cria uma segunda tentativa em paralelo, o cliente deve tentar de novo.
          return errorResponse(res, 409, "ORDER_CREATE_IN_PROGRESS", "Este pedido já está sendo processado. Tente novamente em instantes.");
        }
        const existingSnap = await orderRef.get();
        if (existingSnap.exists) {
          return res.status(200).json({ order: existingSnap.data() as Order, reused: true });
        }
        return errorResponse(res, 500, "ORDER_STATE_INCONSISTENT", "Não foi possível recuperar o pedido já criado.");
      }

      // A partir daqui, a reserva atômica já existe (status "pending"). Qualquer saída — sucesso ou
      // erro — precisa passar por releaseReservation() para nunca deixar um clientOrderId travado
      // permanentemente em "pending" (o que faria um retry legítimo receber 409 para sempre).
      const releaseReservation = () => releaseOrderReservation(db, uid, clientOrderId);

      const productDocs = await Promise.all(
        requestedItems.map((item) => db.collection("users").doc(uid).collection("products").doc(item.productId).get())
      );

      const orderItems: OrderItem[] = [];
      for (let i = 0; i < requestedItems.length; i++) {
        const doc = productDocs[i];
        const requested = requestedItems[i];
        if (!doc.exists) {
          await releaseReservation();
          return errorResponse(res, 409, "ORDER_ITEM_UNAVAILABLE", "Um produto do pedido não está mais disponível.", { productId: requested.productId });
        }
        const product = toPublicCatalogProduct(doc.id, doc.data() ?? {});
        if (!product || product.available === false || product.availableQuantity <= 0) {
          await releaseReservation();
          return errorResponse(res, 409, "ORDER_ITEM_UNAVAILABLE", "Um produto do pedido não está mais disponível.", { productId: requested.productId });
        }
        if (requested.quantity > product.availableQuantity) {
          await releaseReservation();
          return errorResponse(res, 409, "ORDER_ITEM_INSUFFICIENT_STOCK", "Estoque insuficiente para um item do pedido.", { productId: requested.productId, available: product.availableQuantity });
        }
        let unitPrice: number;
        try {
          unitPrice = resolveEffectiveProductPrice(product).effectivePrice;
        } catch {
          await releaseReservation();
          return errorResponse(res, 409, "ORDER_ITEM_UNAVAILABLE", "Um produto do pedido está com preço inválido.", { productId: requested.productId });
        }
        orderItems.push({
          productId: product.id,
          name: product.name,
          quantity: requested.quantity,
          unitPrice,
          ...(product.imageUrl ? { imageUrl: product.imageUrl } : {}),
        });
      }

      const total = calculateOrderTotal(orderItems);
      const clientName = typeof body.clientName === "string" ? body.clientName.trim().slice(0, 140) : "";
      const clientPhone = normalizeOrderPhone(body.clientPhone);

      const paymentProvider: OrderPaymentProvider = paymentMethod === "pix" ? "manual_pix" : paymentMethod === "card" ? "mercadopago" : "manual_whatsapp";
      const paymentStatus: OrderPaymentStatus = paymentMethod === "whatsapp" ? "not_started" : "awaiting_customer_payment";

      const order: Order = {
        id: orderRef.id,
        clientId: "public-catalog",
        clientName: clientName || "Cliente do catálogo",
        status: "new",
        items: orderItems,
        total,
        createdAt: nowIso,
        updatedAt: nowIso,
        ...(clientPhone ? { clientPhone } : {}),
        ...(catalogSettings.store.name ? { storeName: catalogSettings.store.name } : {}),
        paymentMethod,
        paymentProvider,
        paymentStatus,
        clientOrderId,
      };

      try {
        // create() (não set()): defesa extra — se por algum motivo o orderId já existisse (não deveria,
        // já que orderRef.id veio de um auto-ID novo dentro da transaction), falha em vez de sobrescrever.
        await orderRef.create(order);
      } catch (writeError) {
        await releaseReservation();
        throw writeError;
      }
      await finalizeOrderReservation(db, uid, clientOrderId, orderRef.id);
      return res.status(201).json({ order, reused: false });
    } catch (error) {
      return errorResponse(res, 500, "ORDER_CREATE_FAILED", error instanceof Error ? error.message : "Unknown error");
    }
  });

  // PATCH /api/public/catalog/:storeSlug/orders/:orderId/mark-paid-by-customer — o cliente relata que
  // já pagou (Pix manual). NUNCA vira "paid" aqui — isso é uma alegação, só o lojista (ou um webhook
  // real do Mercado Pago, fora deste endpoint) confirma o recebimento de fato (doc §4.4).
  app.patch("/api/public/catalog/:storeSlug/orders/:orderId/mark-paid-by-customer", publicCatalogRateLimit, async (req, res) => {
    try {
      const catalogSettings = await loadPublicCatalogSettings(getRouteParam(req, "storeSlug"));
      if (!catalogSettings) return res.status(404).json({ error: "CATALOG_NOT_FOUND" });

      const orderId = getRouteParam(req, "orderId");
      const body = (req.body ?? {}) as { clientOrderId?: unknown };
      const clientOrderId = typeof body.clientOrderId === "string" ? body.clientOrderId.trim() : "";
      if (!orderId || !clientOrderId) return errorResponse(res, 400, "MISSING_FIELDS", "orderId e clientOrderId são obrigatórios.");

      const db = getFirebaseAdmin().firestore();
      const orderRef = db.collection("users").doc(catalogSettings.uid).collection("orders").doc(orderId);
      const snapshot = await orderRef.get();
      if (!snapshot.exists) return errorResponse(res, 404, "ORDER_NOT_FOUND", "Pedido não encontrado.");

      const order = snapshot.data() as Order;
      // clientOrderId funciona como o "bearer" de quem criou o pedido — só quem recebeu esse valor na
      // criação (o próprio navegador do cliente) consegue reportar pagamento para ele.
      if (order.clientOrderId !== clientOrderId) {
        return errorResponse(res, 403, "ORDER_TOKEN_MISMATCH", "Não foi possível identificar este pedido.");
      }

      if (order.paymentStatus === "customer_reported_paid" || order.paymentStatus === "paid") {
        return res.status(200).json({ order, alreadyReported: true });
      }
      if (order.paymentStatus !== "awaiting_customer_payment") {
        return errorResponse(res, 409, "INVALID_PAYMENT_TRANSITION", "Este pedido não está aguardando pagamento.");
      }

      const updatedAt = new Date().toISOString();
      await orderRef.set({ paymentStatus: "customer_reported_paid", updatedAt }, { merge: true });
      return res.status(200).json({ order: { ...order, paymentStatus: "customer_reported_paid", updatedAt }, alreadyReported: false });
    } catch (error) {
      return errorResponse(res, 500, "ORDER_MARK_PAID_FAILED", error instanceof Error ? error.message : "Unknown error");
    }
  });

  // POST /api/orders/:orderId/confirm-payment — o LOJISTA (autenticado, dono do pedido) confirma que o
  // pagamento realmente caiu. É a única rota que transiciona paymentStatus para "paid" fora de um
  // webhook real do Mercado Pago.
  app.post("/api/orders/:orderId/confirm-payment", requireAuth, async (req: Request, res: Response) => {
    try {
      const uid = (req as any).firebaseUid as string;
      const orderId = getRouteParam(req, "orderId");
      if (!orderId) return errorResponse(res, 400, "MISSING_ORDER_ID", "orderId é obrigatório.");

      const db = getFirebaseAdmin().firestore();
      const orderRef = db.collection("users").doc(uid).collection("orders").doc(orderId);
      const snapshot = await orderRef.get();
      if (!snapshot.exists) return errorResponse(res, 404, "ORDER_NOT_FOUND", "Pedido não encontrado.");

      const order = snapshot.data() as Order;
      if (order.paymentStatus === "paid") {
        return res.status(200).json({ order, alreadyConfirmed: true });
      }
      if (order.paymentStatus !== "customer_reported_paid" && order.paymentStatus !== "awaiting_customer_payment") {
        return errorResponse(res, 409, "INVALID_PAYMENT_TRANSITION", "Este pedido não pode ser confirmado neste estado.");
      }

      const updatedAt = new Date().toISOString();
      await orderRef.set({ paymentStatus: "paid", updatedAt }, { merge: true });
      return res.status(200).json({ order: { ...order, paymentStatus: "paid", updatedAt }, alreadyConfirmed: false });
    } catch (error) {
      return errorResponse(res, 500, "ORDER_CONFIRM_PAYMENT_FAILED", error instanceof Error ? error.message : "Unknown error");
    }
  });

  // POST /api/public/catalog/:storeSlug/orders/:orderId/payment/mercadopago — RELEASE-CHECKOUT-03 §3.
  // Cria (ou devolve, se já existir) uma cobrança Mercado Pago real vinculada ao pedido. Não autenticado
  // (o comprador não tem conta) — toda decisão de segurança é resolvida aqui, nunca aceita do corpo:
  // vendedor vem do storeSlug, total vem do pedido já persistido, token MP nunca sai do servidor.
  app.post("/api/public/catalog/:storeSlug/orders/:orderId/payment/mercadopago", publicCatalogRateLimit, async (req, res) => {
    try {
      // LGPD/segurança (REVENDASMART-LGPD-ANPD-REMEDIATION-01, Fase 10): mesma camada distribuída da
      // criação de pedido — este endpoint cria uma cobrança real no Mercado Pago, o alvo de maior valor
      // para abuso entre os endpoints públicos.
      const distributedKey = `mp-charge:${getPublicCatalogClientKey(req)}:${getRouteParam(req, "storeSlug")}`;
      const distributedDecision = await checkDistributedRateLimit(
        getFirebaseAdmin().firestore(),
        distributedKey,
        { windowMs: 60_000, max: 20 },
      );
      if (!distributedDecision.allowed) {
        res.setHeader("Retry-After", String(distributedDecision.retryAfterSeconds));
        return res.status(429).json({ error: "CATALOG_RATE_LIMITED" });
      }

      const catalogSettings = await loadPublicCatalogSettings(getRouteParam(req, "storeSlug"));
      if (!catalogSettings) return res.status(404).json({ error: "CATALOG_NOT_FOUND" });
      if (!catalogSettings.store.cardAvailable) {
        return errorResponse(res, 403, "CARD_NOT_AVAILABLE", "Pagamento por cartão indisponível para esta loja.");
      }

      const orderId = getRouteParam(req, "orderId");
      if (!orderId) return errorResponse(res, 400, "MISSING_ORDER_ID", "orderId é obrigatório.");

      const uid = catalogSettings.uid;
      const db = getFirebaseAdmin().firestore();

      // Mesma reserva atômica de §1 (RELEASE-CHECKOUT-02), chaveada por orderId: UMA cobrança por pedido
      // mesmo sob duplo clique/retry concorrente (§11-F). PEDIDOS EDITÁVEIS Etapa 2B: o pedido não é mais
      // lido aqui fora — estado, reserva e o valor cobrado saem da MESMA transação (reserveOrderCharge),
      // serializada com a edição de itens, e o provedor recebe só o valor congelado nela. Etapa 2C: uma
      // intenção chama o provedor no máximo uma vez; retry só finaliza a partir da cobrança local ou reconcilia
      // (busca por external_reference, nunca cria) — sem prova, ORDER_CHARGE_RECONCILIATION_REQUIRED.
      let started: StartOrderChargeResult;
      try {
        started = await startOrderMercadoPagoCharge(
          db,
          { uid, orderId, storeName: catalogSettings.store.name, storeSlug: catalogSettings.slug },
          { createCharge: createOrderMercadoPagoCharge, findCharge: findOrderMercadoPagoCharge },
        );
      } catch (error) {
        if (error instanceof OrderChargeReservationError) {
          if (error.code === "ORDER_NOT_FOUND") return errorResponse(res, 404, "ORDER_NOT_FOUND", "Pedido não encontrado.");
          if (error.code === "ORDER_ALREADY_PAID") return errorResponse(res, 409, "ORDER_ALREADY_PAID", "Este pedido já foi pago.");
          return errorResponse(res, 409, "ORDER_NOT_PAYABLE", "Este pedido não pode mais ser pago.");
        }
        if (error instanceof MercadoPagoOrderChargeError) {
          return errorResponse(res, error.httpStatus, error.code, error.userMessage);
        }
        throw error;
      }

      if (started.outcome === "in_progress") {
        return errorResponse(res, 409, "CHARGE_CREATE_IN_PROGRESS", "Uma cobrança para este pedido já está sendo criada. Tente novamente em instantes.");
      }
      if (started.outcome === "inconsistent") {
        return errorResponse(res, 500, "CHARGE_STATE_INCONSISTENT", "Não foi possível recuperar a cobrança já criada.");
      }
      if (started.outcome === "reconciliation_required") {
        return errorResponse(res, 409, "ORDER_CHARGE_RECONCILIATION_REQUIRED", "Estamos confirmando a cobrança deste pedido com o Mercado Pago. Não pague de novo; tente abrir o pagamento em alguns minutos.");
      }
      if (started.outcome === "reused") {
        return res.status(200).json({ chargeId: started.chargeId, paymentUrl: started.paymentUrl, preferenceId: started.preferenceId, reused: true });
      }
      return res.status(201).json({ chargeId: started.chargeId, paymentUrl: started.paymentUrl, preferenceId: started.preferenceId, reused: false });
    } catch (error) {
      return errorResponse(res, 500, "ORDER_PAYMENT_FAILED", error instanceof Error ? error.message : "Unknown error");
    }
  });

  // GET /api/public/catalog/:storeSlug/orders/:orderId/status — §7. A tela pós-redirect do Mercado
  // Pago nunca confia no query param `payment=success/pending/failure` (o browser não é autoridade) —
  // só neste status vindo do servidor. Payload mínimo: sem clientPhone/clientOrderId/itens, só o
  // necessário para a UI decidir o que mostrar.
  app.get("/api/public/catalog/:storeSlug/orders/:orderId/status", publicCatalogRateLimit, async (req, res) => {
    try {
      const catalogSettings = await loadPublicCatalogSettings(getRouteParam(req, "storeSlug"));
      if (!catalogSettings) return res.status(404).json({ error: "CATALOG_NOT_FOUND" });

      const orderId = getRouteParam(req, "orderId");
      if (!orderId) return errorResponse(res, 400, "MISSING_ORDER_ID", "orderId é obrigatório.");

      const db = getFirebaseAdmin().firestore();
      const snapshot = await db.collection("users").doc(catalogSettings.uid).collection("orders").doc(orderId).get();
      if (!snapshot.exists) return errorResponse(res, 404, "ORDER_NOT_FOUND", "Pedido não encontrado.");

      const order = snapshot.data() as Order;
      return res.status(200).json({
        orderStatus: order.status,
        paymentStatus: order.paymentStatus ?? null,
        total: order.total,
      });
    } catch (error) {
      return errorResponse(res, 500, "ORDER_STATUS_FAILED", error instanceof Error ? error.message : "Unknown error");
    }
  });

  app.get("/u/:storeSlug", publicCatalogRateLimit, async (req, res, next) => {
    try {
      const catalog = await loadPublicCatalogSettings(getRouteParam(req, "storeSlug"));
      if (!catalog) return next();
      const indexPath = [path.resolve(process.cwd(), "dist/public/index.html"), path.resolve(".", "dist/public/index.html"), path.resolve(process.cwd(), "public/index.html")]
        .find((candidate) => fs.existsSync(candidate));
      if (!indexPath) return next();
      const storeName = catalog.store.name;
      const description = catalog.store.description || `Confira os produtos disponíveis no catálogo de ${storeName}.`;
      const image = await loadPublicCatalogOgImage(catalog.uid);
      const url = `https://revendasmart.vercel.app/u/${catalog.slug}`;
      const meta = `<title>${escapeHtml(storeName)} | Catálogo</title>
<meta name="description" content="${escapeHtml(description)}" />
<meta property="og:title" content="${escapeHtml(storeName)}" />
<meta property="og:description" content="${escapeHtml(description)}" />
<meta property="og:type" content="website" /><meta property="og:url" content="${escapeHtml(url)}" />
<meta property="og:image" content="${escapeHtml(image)}" />
<meta name="twitter:card" content="summary_large_image" /><meta name="twitter:title" content="${escapeHtml(storeName)}" />
<meta name="twitter:description" content="${escapeHtml(description)}" /><meta name="twitter:image" content="${escapeHtml(image)}" />`;
      let html = fs.readFileSync(indexPath, "utf8");
      html = html.replace(/<title>[\s\S]*?<\/title>/i, "")
        .replace(/<meta\s+(?:property|name)="(?:og:|twitter:|description)[^"]*"[^>]*>/gi, "")
        .replace("</head>", `${meta}\n</head>`);
      res.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
      return res.type("html").send(html);
    } catch (error) {
      routeLogError("[catalog-meta] Failed:", error);
      return next();
    }
  });
  // GET /api/user/settings/:userId - Load user settings from Firestore
  app.get("/api/user/settings/:userId", requireAuth, requireOwnership, async (req, res) => {
    const userId = Array.isArray(req.params.userId) ? req.params.userId[0] : req.params.userId;
    try {
      if (!userId) {
        return res.status(400).json({ error: "userId required" });
      }

      // Load from Firestore via firebase-admin
      const admin = getFirebaseAdmin();
      const db = admin.firestore();
      
      const settingsDoc = await db.collection("user_settings").doc(userId).get();
      const settings = settingsDoc.exists ? settingsDoc.data() : {};

      return res.json({
        onboarding_completed: settings?.onboarding_completed === true,
        settings: settings
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Unknown error";
      return errorResponse(
        res,
        500,
        "SETTINGS_LOAD_FAILED",
        msg,
        { userId, errorName: error instanceof Error ? error.name : "UnknownError" }
      );
    }
  });

  // POST /api/public-catalog/ensure/:userId — autoridade server-side para o link público.
  // O frontend nunca deve prometer `/u/:slug` sem esta confirmação: aqui o servidor lê o estado atual,
  // preserva slug real existente, troca placeholders como "minha-revenda" por um slug derivado do nome
  // real da loja e reserva `public_catalog_slugs/{slug}` de forma transacional.
  app.post("/api/public-catalog/ensure/:userId", requireAuth, requireOwnership, async (req, res) => {
    const userId = Array.isArray(req.params.userId) ? req.params.userId[0] : req.params.userId;
    try {
      if (!userId) return res.status(400).json({ error: "userId required" });

      const admin = getFirebaseAdmin();
      const db = admin.firestore();
      const ensureResult = await ensurePublicCatalogSlug({ db, ownerUid: userId });
      const updatedDoc = await db.collection("user_settings").doc(userId).get();
      const settings = updatedDoc.exists ? updatedDoc.data() : {};

      return res.json({
        success: true,
        slug: ensureResult.slug,
        url: `https://revendasmart.vercel.app/u/${encodeURIComponent(ensureResult.slug)}`,
        settings,
      });
    } catch (error) {
      if (error instanceof CatalogSlugConflictError) {
        return res.status(409).json({ error: error.message });
      }
      if (error instanceof InvalidCatalogSlugError) {
        return res.status(400).json({ error: error.message });
      }
      const msg = error instanceof Error ? error.message : "Unknown error";
      return errorResponse(res, 500, "PUBLIC_CATALOG_SLUG_ENSURE_FAILED", msg, { userId });
    }
  });

  // POST /api/user/settings/:userId - Save user settings to Firestore
  app.post("/api/user/settings/:userId", requireAuth, requireOwnership, async (req, res) => {
    const userId = Array.isArray(req.params.userId) ? req.params.userId[0] : req.params.userId;
    const rawBody = req.body;
    let body: Record<string, any> = {};
    try {

      routeInfo("[/api/user/settings POST] userId:", userId);
      routeInfo("[/api/user/settings POST] body keys:", Object.keys(rawBody || {}));

      if (!userId) {
        return res.status(400).json({ error: "userId required" });
      }

      if (!rawBody || typeof rawBody !== "object" || Array.isArray(rawBody)) {
        return res.status(400).json({ error: "body must be an object" });
      }

      // Ownership, plan and privilege fields are server-owned. Legacy payloads can still include
      // them, but they are discarded and deleted from the stored document on the next successful
      // save; no client value can influence catalog ownership.
      body = sanitizePublicSettingsPayload(rawBody);

      // PLAN-IMPL-09-FINAL §6/§58 — businessMode é um enum fechado (orientação, nunca entitlement); o
      // blocklist acima não valida FORMATO, só remove campos perigosos. Um valor malformado nunca pode
      // virar canônico só porque o TypeScript do client não o enviaria — descartado (nunca rejeita a
      // request inteira), igual ao resto deste payload tolerante a campos desconhecidos/antigos.
      if (typeof body.businessMode !== "undefined" && !["products", "services", "both"].includes(body.businessMode)) {
        delete body.businessMode;
      }

      const admin = getFirebaseAdmin();
      const db = admin.firestore();
      
      // ============ REFERRAL VALIDATION (if present in body) ============
      let referrerExists = false;
      if (body.referral_source) {
        const referralSourceToken = body.referral_source;
        routeInfo("[/api/user/settings POST] Validating referral_source token");

        // 0. Check if referral already exists (IMMUTABILITY - prevent overwrite)
        try {
          const existingSettings = await db.collection("user_settings").doc(userId).get();
          if (existingSettings.exists && existingSettings.data()?.referral_source) {
            routeWarn("[/api/user/settings POST] Referral already set, blocking reaplication:", {
              existing: existingSettings.data()?.referral_source,
              attempted: "[redacted]"
            });
            return res.status(409).json({ 
              error: "Referral source already set and cannot be changed",
              referralValidation: { 
                result: "already_set", 
                existingReferralSource: existingSettings.data()?.referral_source
              }
            });
          }
        } catch (e) {
          routeWarn("[/api/user/settings POST] Error checking existing referral:", (e as any)?.message);
          // Don't block on check failure, continue
        }

        const resolution = await resolveReferralSource(db, referralSourceToken, userId);
        if ("error" in resolution) {
          routeWarn("[/api/user/settings POST] Referral rejected:", resolution.error);
          return res.status(400).json({
            error: resolution.error === "self_referral"
              ? "Cannot refer yourself"
              : resolution.error === "referrer_not_found"
                ? "Referrer not found"
                : "Invalid referral_source format",
            referralValidation: { result: resolution.error },
          });
        }
        referrerExists = true;

        // Mark referral as applied by backend with timestamp
        body.referral_source = resolution.referrerUid;
        body.referral_applied_at = body.referral_applied_at || new Date().toISOString();
        body.referral_applied_by = "backend";
        body.referral_immutable = true; // Mark as immutable
        routeInfo("[/api/user/settings POST] Referral validated and marked for persistence as immutable");
      }
      
      routeInfo(`[/api/user/settings POST] Saving to Firestore: user_settings/${userId}`);
      await persistUserSettingsWithCatalogOwnership({ db, ownerUid: userId, payload: body });
      const catalogEnabled = body.enablePublicCatalog ?? body.catalogEnabled ?? body.catalog_enabled;
      // PLAN-IMPL-06 §12 — `created` já distingue "slug provisionado agora pela primeira vez" de "já
      // existia, só confirmado de novo" — o client usa isto para disparar catalog_published só na
      // transição real, nunca a cada salvamento de configurações.
      let catalogSlugJustCreated = false;
      if (catalogEnabled === true) {
        const slugResult = await ensurePublicCatalogSlug({ db, ownerUid: userId });
        catalogSlugJustCreated = slugResult.created;
      }
      routeInfo("[/api/user/settings POST] Successfully saved to Firestore");

      // ============ REFERRAL CONVERSION ATTRIBUTION (if new referral was applied) ============
      // Uses Firestore transaction to ensure atomically consistent counting (no race conditions)
      if (body.referral_source && referrerExists) {
        const referralSourceUid = body.referral_source;
        routeInfo("[/api/user/settings POST] Recording referral conversion for referrer:", referralSourceUid);
        
        try {
          // Use Firestore transaction for atomic read + check + write
          const conversionResult = await db.runTransaction(async (transaction) => {
            const referrerRef = db.collection("user_settings").doc(referralSourceUid);
            const referrerDoc = await transaction.get(referrerRef);
            
            // Get current state
            const currentConversions = referrerDoc.exists ? (referrerDoc.data()?.referral_conversions || 0) : 0;
            const currentReferredUsers = referrerDoc.exists ? (referrerDoc.data()?.referred_users || []) : [];
            
            // Check idempotency: is this user already counted?
            if (currentReferredUsers.includes(userId)) {
              routeWarn("[/api/user/settings POST] User already in referrer's list (transaction check), skipping:", userId);
              return { status: "duplicate", userId, referralSourceUid };
            }
            
            // New conversion: increment and add to list (atomic operation within transaction)
            const newConversions = currentConversions + 1;
            const newReferredUsers = [...currentReferredUsers, userId];
            const conversionTimestamp = new Date().toISOString();
            
            // REWARD BASE: Each valid conversion is eligible for 1 reward (not paid yet)
            const currentRewardEligible = referrerDoc.exists ? (referrerDoc.data()?.reward_eligible_conversions || 0) : 0;
            const newRewardEligible = currentRewardEligible + 1;
            
            transaction.update(referrerRef, {
              referral_conversions: newConversions,
              referred_users: newReferredUsers,
              last_referral_conversion_at: conversionTimestamp,
              // Reward base: Track eligible but not yet granted
              reward_eligible_conversions: newRewardEligible,
              reward_granted_count: referrerDoc.exists ? (referrerDoc.data()?.reward_granted_count || 0) : 0
            });
            
            routeInfo("[/api/user/settings POST] Referral conversion + reward eligibility recorded for:", referralSourceUid, { conversions: newConversions, eligible: newRewardEligible });
            return { 
              status: "counted", 
              userId, 
              referralSourceUid, 
              newConversions, 
              rewardEligible: newRewardEligible,
              timestamp: conversionTimestamp 
            };
          });
          
          // Log result for telemetry (after transaction commits)
          if (conversionResult.status === "counted") {
            routeInfo("[/api/user/settings POST] Telemetry: referral_conversion_counted");
            // Client will log: referral_conversion_counted event
          } else if (conversionResult.status === "duplicate") {
            routeInfo("[/api/user/settings POST] Telemetry: referral_conversion_skipped_duplicate");
            // Client will log: referral_conversion_skipped_duplicate event
          }
        } catch (e) {
          routeWarn("[/api/user/settings POST] Failed to record referral conversion (transaction):", (e as any)?.message);
          // Don't block the response - signup continues even if conversion counting fails
          // This is intentional: user data is safe, only growth metrics might be inconsistent
          // Telemetry: conversion failed (will be logged after response)
        }
      }

      const updatedDoc = await db.collection("user_settings").doc(userId).get();
      const updatedSettings = updatedDoc.exists ? updatedDoc.data() : body;

      return res.json({
        success: true,
        onboarding_completed: updatedSettings?.onboarding_completed === true,
        settings: updatedSettings,
        referralValidation: body.referral_source ? { result: "success", referralSourceUid: body.referral_source } : undefined,
        catalogSlugJustCreated,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Unknown error";
      if (error instanceof CatalogSlugConflictError) {
        return res.status(409).json({ error: "CATALOG_SLUG_TAKEN", message: "Este link de catálogo já está em uso." });
      }
      if (error instanceof InvalidCatalogSlugError) {
        return res.status(400).json({ error: "INVALID_CATALOG_SLUG", message: "O link do catálogo é inválido." });
      }
      return errorResponse(
        res,
        500,
        "SETTINGS_SAVE_FAILED",
        msg,
        { userId, bodyKeys: Object.keys(body || {}), errorName: error instanceof Error ? error.name : "UnknownError" }
      );
    }
  });

  // ============ FASE 3: MIGRATION ENDPOINTS (Preparation Mode) ============
  
  // GET /api/user/migration-status/:userId - Get migration readiness status
  app.get("/api/user/migration-status/:userId", requireAuth, requireOwnership, async (req, res) => {
    const userId = getRouteParam(req, "userId");
    try {

      // This is a dry-run endpoint - we cannot read from client localStorage directly
      // Instead, return what we know from Firestore
      const admin = getFirebaseAdmin();
      const db = admin.firestore();
      
      const settings = await db.collection("user_settings").doc(userId).get();
      const hasSettings = settings.exists;
      
      const storageSetup = await validateFirebaseStorageSetup();
      
      return res.json({
        ready: storageSetup.valid,
        firebaseSetup: {
          projectId: storageSetup.projectId,
          bucket: storageSetup.bucket,
          valid: storageSetup.valid,
        },
        firestore: {
          hasSettings,
        },
        message: "Migration preparation status. Use dry-run endpoints to validate data.",
        dryRunAvailable: true,
        nextStep: "POST /api/user/data/validate (dry-run to check data integrity)",
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Unknown error";
      return errorResponse(
        res,
        500,
        "MIGRATION_STATUS_FAILED",
        msg,
        { userId, errorName: error instanceof Error ? error.name : "UnknownError" }
      );
    }
  });

  // POST /api/user/data/validate/:userId - DRY RUN: Validate data integrity (no changes)
  app.post("/api/user/data/validate/:userId", requireAuth, requireOwnership, async (req, res) => {
    const userId = getRouteParam(req, "userId");
    try {
      const { data } = req.body;
      
      if (!data) {
        return res.status(400).json({ error: "Missing data in request body" });
      }

      const {
        generateMigrationStatus,
      } = await import("./migration-helpers");

      const status = generateMigrationStatus(
        data.products || [],
        data.clients || [],
        data.sales || [],
        data.installments || [],
        data.posts || [],
        data.imageIds || []
      );

      return res.json({
        success: true,
        validation: status,
        message: "Data validation completed (DRY RUN - no changes made)",
        dryRun: true,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Unknown error";
      return errorResponse(
        res,
        500,
        "DATA_VALIDATION_FAILED",
        msg,
        { userId, errorName: error instanceof Error ? error.name : "UnknownError" }
      );
    }
  });

  // ============ REWARD GRANTING (Admin Action) ============
  // POST /api/rewards/grant/:targetUserId - Grant rewards to a user (admin only, no payout yet)
  app.post("/api/rewards/grant/:targetUserId", requireAuth, requireAdmin, async (req, res) => {
    const targetUserId = getRouteParam(req, "targetUserId");
    try {
      const { count, reason } = req.body;
      const adminUid = (req as any).firebaseUid;
      
      // Check rate limit
      if (!checkGrantRateLimit(adminUid)) {
        return errorResponse(res, 429, "RATE_LIMITED", "Too many grant requests. Maximum 5 per minute.");
      }
      
      // Validate input
      if (!targetUserId || !count || typeof count !== 'number' || count <= 0) {
        return errorResponse(res, 400, "INVALID_GRANT_REQUEST", "count must be a positive number");
      }
      
      if (!reason || typeof reason !== 'string' || reason.trim().length === 0) {
        return errorResponse(res, 400, "INVALID_GRANT_REQUEST", "reason must be non-empty string");
      }
      
      routeInfo("[/api/rewards/grant] Admin:", adminUid, "granting", count, "rewards to", targetUserId);
      
      const admin = getFirebaseAdmin();
      const db = admin.firestore();
      
      // Use transaction to safely grant rewards
      const grantResult = await db.runTransaction(async (transaction) => {
        const userRef = db.collection("user_settings").doc(targetUserId);
        const userDoc = await transaction.get(userRef);
        
        if (!userDoc.exists) {
          throw new Error("User not found");
        }
        
        // Get current state
        const currentEligible = userDoc.data()?.reward_eligible_conversions || 0;
        const currentGranted = userDoc.data()?.reward_granted_count || 0;
        
        // Validation: cannot grant more than eligible
        if (count > currentEligible) {
          throw new Error(`Cannot grant ${count} rewards. Only ${currentEligible} eligible.`);
        }
        
        // Calculate new state (reduce eligible, increase granted)
        const newEligible = currentEligible - count;
        const newGranted = currentGranted + count;
        const grantTimestamp = new Date().toISOString();
        
        // Update user settings with audit metadata
        transaction.update(userRef, {
          reward_eligible_conversions: newEligible,
          reward_granted_count: newGranted,
          reward_last_granted_at: grantTimestamp,
          reward_last_granted_count: count,
          reward_last_granted_reason: reason,
          reward_last_granted_by: adminUid
        });
        
        routeInfo("[/api/rewards/grant] Transaction completed:", {
          targetUserId,
          grantedCount: count,
          newEligible,
          newGranted
        });
        
        return {
          status: "granted",
          targetUserId,
          grantedCount: count,
          newEligible,
          newGranted,
          timestamp: grantTimestamp
        };
      });
      
      return res.json({
        success: true,
        reward: grantResult,
        message: `${count} recompensas concedidas com sucesso`
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Unknown error";
      return errorResponse(
        res,
        error instanceof Error && error.message.includes("Cannot grant") ? 400 : 500,
        "REWARD_GRANT_FAILED",
        msg,
        { targetUserId }
      );
    }
  });

  // POST /api/user/images/migrate/:userId - Placeholder for future image migration
  app.post("/api/user/images/migrate/:userId", requireAuth, requireOwnership, async (req, res) => {
    const userId = getRouteParam(req, "userId");
    try {
      
      // For now, this is a preparation endpoint - no actual migration
      return res.status(202).json({
        message: "Image migration endpoint prepared but not yet enabled",
        status: "preparation",
        instructions: {
          step1: "Ensure Firebase Storage is configured",
          step2: "Call POST /api/user/data/validate to check data integrity",
          step3: "When ready, image migration will be executed here",
        },
        note: "This endpoint is safe to call - it performs no actual changes yet",
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Unknown error";
      return errorResponse(
        res,
        500,
        "IMAGE_MIGRATION_ENDPOINT_ERROR",
        msg,
        { userId, errorName: error instanceof Error ? error.name : "UnknownError" }
      );
    }
  });

  // POST /api/user/products/migrate/:userId - Placeholder for future product migration
  app.post("/api/user/products/migrate/:userId", requireAuth, requireOwnership, async (req, res) => {
    return res.status(202).json({
      message: "Product migration endpoint prepared but not yet enabled",
      status: "preparation",
    });
  });

  // POST /api/user/clients/migrate/:userId - Placeholder for future client migration
  app.post("/api/user/clients/migrate/:userId", requireAuth, requireOwnership, async (req, res) => {
    return res.status(202).json({
      message: "Client migration endpoint prepared but not yet enabled",
      status: "preparation",
    });
  });

  // POST /api/user/sales/migrate/:userId - Placeholder for future sales migration
  app.post("/api/user/sales/migrate/:userId", requireAuth, requireOwnership, async (req, res) => {
    return res.status(202).json({
      message: "Sales migration endpoint prepared but not yet enabled",
      status: "preparation",
    });
  });

  // POST /api/user/installments/migrate/:userId - Placeholder for future installments migration
  app.post("/api/user/installments/migrate/:userId", requireAuth, requireOwnership, async (req, res) => {
    return res.status(202).json({
      message: "Installments migration endpoint prepared but not yet enabled",
      status: "preparation",
    });
  });

  // POST /api/user/posts/migrate/:userId - Placeholder for future posts migration
  app.post("/api/user/posts/migrate/:userId", requireAuth, requireOwnership, async (req, res) => {
    return res.status(202).json({
      message: "Posts migration endpoint prepared but not yet enabled",
      status: "preparation",
    });
  });

  // Public Legal Documents Routes
  app.get(["/privacy-policy", "/api/legal/privacy-policy"], (req, res) => {

    try {
      const filePath = path.resolve(process.cwd(), "dist/public/privacy-policy.md");
      const content = fs.readFileSync(filePath, "utf8");
      res.setHeader("Content-Type", "text/markdown; charset=utf-8");
      res.send(content);
    } catch {
      res.status(404).json({ error: "Privacy Policy not found" });
    }
  });

  app.get(["/terms-of-service", "/api/legal/terms-of-service"], (req, res) => {
   
    try {
      const filePath = path.resolve(process.cwd(), "dist/public/terms-of-service.md");
      const content = fs.readFileSync(filePath, "utf8");
      res.setHeader("Content-Type", "text/markdown; charset=utf-8");
      res.send(content);
    } catch {
      res.status(404).json({ error: "Terms of Service not found" });
    }
  });

  // GET /api/plans/purchase-availability — PLAN-IMPL-04A §49: sem parâmetro de usuário, mesma resposta
  // para qualquer chamador (nenhum dado pessoal/secret) — nunca requer autenticação, para a página de
  // planos poder decidir CTA antes mesmo do plano do usuário terminar de carregar.
  app.get("/api/plans/purchase-availability", (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json(getPlanPurchaseAvailability(req.query.channel === "android" ? "android" : "web"));
  });

  // GET /api/plan/data/:userId - Get user plan data
  app.get("/api/plan/data/:userId", requireAuth, requireOwnership, async (req, res) => {
    const userId = getRouteParam(req, "userId");
    try {
      const admin = getFirebaseAdmin();
      const db = admin.firestore();

      const planDocRef = db.collection("users").doc(userId).collection("planData").doc("main");
      const [planDocSnap, { entitlements }, lifecycle] = await Promise.all([
        planDocRef.get(),
        resolveUserEntitlements(db, userId),
        // PLAN-IMPL-03 §18/§24/§25 — reconcilia Products/Services ANTES de responder se o plano efetivo
        // acabou de transicionar (trial expirou, etc.), e devolve basePlan/effectivePlan/trial explícitos
        // para o client nunca precisar recalcular nada localmente (§17 — client não computa entitlement).
        ensurePlanLifecycleCurrent(db, userId),
      ]);

      // REVENDASMART-OWNER-ACCESS-02 — os campos comerciais abaixo continuam vindo de `planData`
      // exatamente como antes (nunca sobrescritos por uma concessão interna); `hasPremiumAccess`/
      // `isTester`/`isPremiumPlus` são a ÚNICA adição, computados por `resolveEntitlements`
      // (shared/monetization.ts) — o mesmo resolver que o client usa sobre este mesmo payload, para os
      // dois lados nunca divergirem sobre "quem tem acesso Premium". PLAN-IMPL-03: basePlan/effectivePlan/
      // trial vêm de ensurePlanLifecycleCurrent — hasPremiumAccess já reflete trial também (resolveEntitlements
      // agora passa por resolveCommercialPlan), estes 3 campos são só para a UI distinguir base de efetivo.
      const composed = {
        hasPremiumAccess: entitlements.hasPremiumAccess,
        isTester: entitlements.isTester,
        isPremiumPlus: entitlements.isPremiumPlus,
        entitlementSource: entitlements.source,
        basePlan: lifecycle.basePlan,
        effectivePlan: lifecycle.effectivePlan,
        trial: lifecycle.trial,
      };

      if (planDocSnap.exists) {
        return res.status(200).json({ ...planDocSnap.data(), ...composed });
      }

      // Plan data doesn't exist, return default free plan
      return res.status(200).json({
        currentPlan: "free",
        premiumActive: false,
        premiumExpiresAt: null,
        premiumStartedAt: null,
        premiumSource: null,
        referralCode: null,
        referralCount: 0,
        ...composed,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Unknown error";
      return errorResponse(res, 500, "PLAN_DATA_FETCH_ERROR", msg, { userId });
    }
  });

  // POST /api/plan/initialize/:userId - Initialize user plan (called on first login)
  app.post("/api/plan/initialize/:userId", requireAuth, requireOwnership, async (req, res) => {
    const userId = getRouteParam(req, "userId");
    try {
      const admin = getFirebaseAdmin();
      const db = admin.firestore();

      // PLAN-IMPL-03 §10 — a autoridade de "conta nova" é o Firebase Auth (nunca "planData ausente"
      // sozinho, que também é verdade para uma conta legada sem doc), lida FORA de qualquer transação
      // (Auth não participa de transações do Firestore). Uma falha aqui (uid não encontrado etc.) só
      // significa "sem trial" — nunca bloqueia a inicialização do plano em si.
      let authUserCreationTime: string | undefined;
      try {
        authUserCreationTime = (await admin.auth().getUser(userId)).metadata.creationTime;
      } catch {
        authUserCreationTime = undefined;
      }

      const { referralCode } = await initializePlanCommand(db, userId, authUserCreationTime);

      routeInfo("[plan/initialize] Plan initialized for user:", userId);
      return res.status(200).json({ referralCode });
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Unknown error";
      return errorResponse(res, 500, "PLAN_INITIALIZE_ERROR", msg, { userId });
    }
  });

  // RELEASE-28: checagem pública de existência do código. Não devolve o UID; a resolução real para
  // ownership acontece apenas no backend autenticado (/api/user/settings POST).
  app.get("/api/referral/resolve-code/:code", async (req, res) => {
    const code = getRouteParam(req, "code");
    if (!isReferralCodeFormat(code)) {
      return res.status(400).json({ error: "INVALID_REFERRAL_CODE_FORMAT" });
    }
    try {
      const admin = getFirebaseAdmin();
      const db = admin.firestore();
      const codeDoc = await db.collection("referralCodes").doc(code).get();
      const uid = codeDoc.exists ? codeDoc.data()?.uid : null;
      if (typeof uid !== "string" || !uid) {
        return res.status(404).json({ error: "REFERRAL_CODE_NOT_FOUND" });
      }
      return res.status(200).json({ ok: true });
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Unknown error";
      return errorResponse(res, 500, "REFERRAL_CODE_RESOLVE_ERROR", msg, { code });
    }
  });

  // Referral events are security-sensitive because they can grant Premium.
  // The referred UID always comes from the verified Firebase token.
  app.post("/api/referral/track-event", requireAuth, async (req, res) => {
    const referredUid = (req as any).firebaseUid as string;
    const body = req.body ?? {};
    const suppliedReferredUid = body.referredUID;
    const referrerUid = body.referrerUID;

    if (suppliedReferredUid != null && suppliedReferredUid !== referredUid) {
      return res.status(403).json({ error: "REFERRAL_OWNERSHIP_MISMATCH" });
    }
    if (!isValidReferralUid(referrerUid) || body.event !== "onboarding_completed") {
      return res.status(400).json({ error: "INVALID_REFERRAL_PAYLOAD" });
    }
    if (referrerUid === referredUid) {
      return res.status(400).json({ error: "SELF_REFERRAL_NOT_ALLOWED" });
    }
    if (!checkReferralRateLimit(referredUid, "track")) {
      return res.status(429).json({ error: "REFERRAL_RATE_LIMITED" });
    }

    try {
      const admin = getFirebaseAdmin();
      const db = admin.firestore();
      const [referredUserRecord] = await Promise.all([
        admin.auth().getUser(referredUid),
        admin.auth().getUser(referrerUid),
      ]);

      // RELEASE-02: `onboarding_completed` sozinho não basta — ver isReferralAccountOldEnough acima.
      if (!isReferralAccountOldEnough(referredUserRecord.metadata.creationTime)) {
        return res.status(400).json({ error: "REFERRAL_ACCOUNT_TOO_NEW" });
      }

      const eventId = referralEventId(referrerUid, referredUid);
      const eventRef = db.collection("referralEvents").doc(eventId);
      const referredSettingsRef = db.collection("user_settings").doc(referredUid);

      await db.runTransaction(async (transaction) => {
        const referredSettings = await transaction.get(referredSettingsRef);
        const existingEvent = await transaction.get(eventRef);
        if (!referredSettings.exists || referredSettings.data()?.onboarding_completed !== true) {
          throw new Error("ONBOARDING_NOT_COMPLETED");
        }
        if (existingEvent.exists) throw new Error("DUPLICATE_REFERRAL");

        transaction.create(eventRef, {
          referredUID: referredUid,
          referrerUID: referrerUid,
          events: [{
            timestamp: admin.firestore.Timestamp.now(),
            event: "onboarding_completed",
            status: "success",
          }],
          status: "pending",
          ownershipVerified: true,
          securityVersion: 2,
          validatedAt: null,
          createdAt: admin.firestore.Timestamp.now(),
          updatedAt: admin.firestore.Timestamp.now(),
        });
      });

      return res.status(200).json({ eventId, status: "pending" });
    } catch (error) {
      const code = error instanceof Error ? error.message : "REFERRAL_TRACK_ERROR";
      if (code === "ONBOARDING_NOT_COMPLETED") {
        return res.status(400).json({ error: code });
      }
      if (code === "DUPLICATE_REFERRAL") {
        return res.status(409).json({ error: code });
      }
      if ((error as { code?: string })?.code === "auth/user-not-found") {
        return res.status(400).json({ error: "REFERRAL_USER_NOT_FOUND" });
      }
      return errorResponse(res, 500, "REFERRAL_TRACK_ERROR", "Não foi possível registrar a indicação.");
    }
  });

  app.post("/api/referral/validate-referral", requireAuth, async (req, res) => {
    const referredUid = (req as any).firebaseUid as string;
    const body = req.body ?? {};
    const suppliedReferredUid = body.referredUID;
    const referrerUid = body.referrerUID;

    if (suppliedReferredUid != null && suppliedReferredUid !== referredUid) {
      return res.status(403).json({ error: "REFERRAL_OWNERSHIP_MISMATCH" });
    }
    if (!isValidReferralUid(referrerUid)) {
      return res.status(400).json({ error: "INVALID_REFERRAL_PAYLOAD" });
    }
    if (referrerUid === referredUid) {
      return res.status(400).json({ error: "SELF_REFERRAL_NOT_ALLOWED" });
    }
    if (!checkReferralRateLimit(referredUid, "validate")) {
      return res.status(429).json({ error: "REFERRAL_RATE_LIMITED" });
    }

    try {
      const admin = getFirebaseAdmin();
      const db = admin.firestore();
      await Promise.all([
        admin.auth().getUser(referredUid),
        admin.auth().getUser(referrerUid),
      ]);

      const eventId = referralEventId(referrerUid, referredUid);
      const eventRef = db.collection("referralEvents").doc(eventId);
      const referredSettingsRef = db.collection("user_settings").doc(referredUid);
      const planRef = db.collection("users").doc(referrerUid).collection("planData").doc("main");
      const validationRef = planRef.collection("validatedReferrals").doc(referredUid);

      const result = await db.runTransaction(async (transaction) => {
        const eventDoc = await transaction.get(eventRef);
        const referredSettings = await transaction.get(referredSettingsRef);
        const validationDoc = await transaction.get(validationRef);
        const validatedReferrals = await transaction.get(planRef.collection("validatedReferrals"));

        if (!eventDoc.exists ||
            eventDoc.data()?.referredUID !== referredUid ||
            eventDoc.data()?.referrerUID !== referrerUid ||
            eventDoc.data()?.ownershipVerified !== true) {
          throw new Error("INVALID_REFERRAL_EVENT");
        }
        if (!referredSettings.exists || referredSettings.data()?.onboarding_completed !== true) {
          throw new Error("ONBOARDING_NOT_COMPLETED");
        }
        if (eventDoc.data()?.status !== "pending" || validationDoc.exists) {
          throw new Error("DUPLICATE_REFERRAL");
        }

        const newCount = validatedReferrals.size + 1;
        const premiumGranted = newCount === REFERRAL_REWARD_LIMIT;
        const now = admin.firestore.Timestamp.now();

        transaction.update(eventRef, {
          status: "valid",
          validatedAt: now,
          updatedAt: now,
        });
        transaction.create(validationRef, {
          referredUID: referredUid,
          referrerUID: referrerUid,
          eventId,
          validatedAt: now,
        });

        const planUpdate: Record<string, unknown> = {
          referralCount: newCount,
          updatedAt: now,
        };
        if (premiumGranted) {
          const premiumExpiresAt = new Date();
          premiumExpiresAt.setDate(premiumExpiresAt.getDate() + 30);
          Object.assign(planUpdate, {
            currentPlan: "premium",
            premiumActive: true,
            premiumExpiresAt: admin.firestore.Timestamp.fromDate(premiumExpiresAt),
            premiumStartedAt: now,
            premiumSource: "referral_reward",
          });
        }
        transaction.set(planRef, planUpdate, { merge: true });

        return { newCount, premiumGranted };
      });

      return res.status(200).json({
        status: "valid",
        premiumGranted: result.premiumGranted,
        referralCount: result.newCount,
        remaining: Math.max(0, REFERRAL_REWARD_LIMIT - result.newCount),
      });
    } catch (error) {
      const code = error instanceof Error ? error.message : "REFERRAL_VALIDATE_ERROR";
      if (code === "DUPLICATE_REFERRAL") {
        return res.status(409).json({ error: code });
      }
      if (code === "INVALID_REFERRAL_EVENT" || code === "ONBOARDING_NOT_COMPLETED") {
        return res.status(400).json({ error: code });
      }
      if ((error as { code?: string })?.code === "auth/user-not-found") {
        return res.status(400).json({ error: "REFERRAL_USER_NOT_FOUND" });
      }
      return errorResponse(res, 500, "REFERRAL_VALIDATE_ERROR", "Não foi possível validar a indicação.");
    }
  });

  // ---------------------------------------------------------------------------
  // GET /api/admin/status — RELEASE V1 §4.1: único jeito seguro do client saber se o usuário logado é
  // admin/dev, para esconder (não só bloquear no backend) Anúncios Pro e o scanner de código de barras.
  // Reaproveita o MESMO `requireAdmin` de todas as outras rotas admin — 200 = admin, 403 = não-admin.
  // ---------------------------------------------------------------------------
  app.get("/api/admin/status", requireAuth, requireAdmin, async (_req: Request, res: Response) => {
    res.status(200).json({ isAdmin: true });
  });

  // ---------------------------------------------------------------------------
  // GET /api/admin/global-config — Get current global premium access config
  // ---------------------------------------------------------------------------
  app.get("/api/admin/global-config", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const config = await getGlobalConfig();
      return res.json({
        premiumOpenAccess: config.premiumOpenAccess,
        premiumOpenAccessUntil: config.premiumOpenAccessUntil ? new Date(config.premiumOpenAccessUntil).toISOString() : null,
        premiumOpenAccessMessage: config.premiumOpenAccessMessage,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Unknown error";
      return errorResponse(res, 500, "CONFIG_ERROR", msg);
    }
  });

  // ---------------------------------------------------------------------------
  // POST /api/admin/global-config — Update global premium access config
  // Body: { premiumOpenAccess: boolean, premiumOpenAccessUntil?: ISO-string, premiumOpenAccessMessage?: string }
  // ---------------------------------------------------------------------------
  app.post("/api/admin/global-config", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const { premiumOpenAccess, premiumOpenAccessUntil, premiumOpenAccessMessage } = req.body;
      
      if (typeof premiumOpenAccess !== 'boolean') {
        return errorResponse(res, 400, "INVALID_REQUEST", "premiumOpenAccess must be boolean");
      }

      const config = {
        premiumOpenAccess,
        premiumOpenAccessUntil: premiumOpenAccessUntil ? new Date(premiumOpenAccessUntil) : null,
        premiumOpenAccessMessage: premiumOpenAccessMessage || null,
      };

      await setGlobalConfig(config);

      routeInfo("[admin/global-config] Updated successfully:", {
        premiumOpenAccess: config.premiumOpenAccess,
        expiresAt: config.premiumOpenAccessUntil?.toISOString() ?? null,
      });

      return res.json({
        success: true,
        message: premiumOpenAccess ? "Premium liberado globalmente!" : "Premium global desligado",
        config: {
          premiumOpenAccess: config.premiumOpenAccess,
          premiumOpenAccessUntil: config.premiumOpenAccessUntil?.toISOString() ?? null,
          premiumOpenAccessMessage: config.premiumOpenAccessMessage,
        },
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Unknown error";
      return errorResponse(res, 500, "CONFIG_UPDATE_ERROR", msg);
    }
  });

  app.post("/api/admin/premium-grant", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const { targetUserEmail, premiumExpiresAt, reason } = req.body ?? {};
      if (!targetUserEmail || typeof targetUserEmail !== "string") {
        return errorResponse(res, 400, "INVALID_REQUEST", "targetUserEmail is required");
      }

      const admin = getFirebaseAdmin();
      const db = admin.firestore();
      const authUser = await admin.auth().getUserByEmail(targetUserEmail.trim());
      const targetUserId = authUser.uid;
      const planRef = db.collection("users").doc(targetUserId).collection("planData").doc("main");
      const expiresAt = premiumExpiresAt ? new Date(premiumExpiresAt) : null;
      if (expiresAt && Number.isNaN(expiresAt.getTime())) {
        return errorResponse(res, 400, "INVALID_REQUEST", "premiumExpiresAt must be a valid date");
      }

      await planRef.set({
        currentPlan: "premium",
        premiumActive: true,
        premiumExpiresAt: expiresAt,
        premiumStartedAt: admin.firestore.FieldValue.serverTimestamp(),
        premiumSource: "admin",
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        adminGrantReason: typeof reason === "string" ? reason : null,
      }, { merge: true });

      return res.json({
        success: true,
        targetUserId,
        targetUserEmail,
        premiumExpiresAt: expiresAt ? expiresAt.toISOString() : null,
        premiumSource: "admin",
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Unknown error";
      return errorResponse(res, 500, "PREMIUM_GRANT_FAILED", msg, { targetUserEmail: req.body?.targetUserEmail });
    }
  });

  app.post("/api/admin/premium-revoke", requireAuth, requireAdmin, async (req: Request, res: Response) => {
    try {
      const { targetUserEmail } = req.body ?? {};
      if (!targetUserEmail || typeof targetUserEmail !== "string") {
        return errorResponse(res, 400, "INVALID_REQUEST", "targetUserEmail is required");
      }

      const admin = getFirebaseAdmin();
      const db = admin.firestore();
      const authUser = await admin.auth().getUserByEmail(targetUserEmail.trim());
      const targetUserId = authUser.uid;
      const planRef = db.collection("users").doc(targetUserId).collection("planData").doc("main");

      await planRef.set({
        currentPlan: "free",
        premiumActive: false,
        premiumExpiresAt: null,
        premiumSource: null,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });

      return res.json({
        success: true,
        targetUserId,
        targetUserEmail,
        premiumSource: null,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Unknown error";
      return errorResponse(res, 500, "PREMIUM_REVOKE_FAILED", msg, { targetUserEmail: req.body?.targetUserEmail });
    }
  });

 

return httpServer;
}
