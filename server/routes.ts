import fs from "fs";
import path from "path";
import type { Express, Request, Response, NextFunction } from "express";
import type { Server } from "http";
import { initializeFirebaseAdmin, getFirebaseAdmin } from "./firebase-admin-init";
import { registerPaymentRoutes } from "./payments";
import { registerConnectionRoutes } from "./mercadopago-connections";
import { registerSubscriptionRoutes } from "./subscriptions";
import { getGlobalConfig, setGlobalConfig } from "./subscriptions";
import { validateFirebaseStorageSetup } from "./firebase-storage-migration";
import { logError, logInfo, logWarn } from "./logger";
 import crypto from "crypto";

function normalizeCatalogSlug(value: unknown): string {
  return String(value ?? "").trim().toLowerCase().normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
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

const PUBLIC_CATALOG_DEFAULT_LIMIT = 24;
const PUBLIC_CATALOG_MAX_LIMIT = 48;

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
  const candidates = Array.from(new Set([rawSlug.trim(), slug].filter(Boolean)));
  for (const field of ["catalogSlug", "catalog_slug", "userSlug", "slug"]) {
    for (const candidate of candidates) {
      const snapshot = await ref.where(field, "==", candidate).limit(1).get();
      if (!snapshot.empty) return snapshot.docs[0];
    }
  }
  return null;
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
    const decoded = await admin.auth().verifyIdToken(token);
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

// Middleware: verify admin role via Firebase custom claims (primary) + fallback for migration
async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const firebaseUid = (req as any).firebaseUid;
  
  // MIGRATION: Temporary fallback list (will be removed once all admins have custom claims set)
  // Set via: firebase auth:set:custom-claims uid --custom-claims '{"admin": true}'
  const ADMIN_UIDS_LEGACY = new Set([
    "natanaelam2000@gmail.com",
  ]);
  
  try {
    const admin = getFirebaseAdmin();
    
    // PRIMARY: Check Firebase custom claim (source of truth)
    const userRecord = await admin.auth().getUser(firebaseUid);
    const isAdminClaim = userRecord.customClaims?.['admin'] === true;
    
    if (isAdminClaim) {
      routeInfo("[requireAdmin] Access granted via custom claim");
      next();
      return;
    }
    
    // FALLBACK: Legacy email check (deprecated, for transition period only)
    if (ADMIN_UIDS_LEGACY.has(userRecord.email || "")) {
      routeWarn("[requireAdmin] MIGRATION: Using legacy email check (deprecated) — set custom claim to remove fallback");
      next();
      return;
    }
    
    routeWarn("[requireAdmin] Access denied for non-admin user");
    return res.status(403).json({ error: "Forbidden: admin access required" });
  } catch (e) {
    routeLogError("[requireAdmin] Error checking admin status:", e);
    return res.status(401).json({ error: "Unauthorized: could not verify admin status" });
  }
}

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


const REFERRAL_REWARD_LIMIT = 3;
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

function isValidReferralUid(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{10,128}$/.test(value);
}

function referralEventId(referrerUid: string, referredUid: string): string {
  return crypto.createHash("sha256").update(`${referrerUid}:${referredUid}`).digest("hex");
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

  // Register App Subscription routes (Premium plan billing — isolated from revendedor payments)
  registerSubscriptionRoutes(app, requireAuth);
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
      const userRef = db.collection("users").doc(uid);
      const saleRef = userRef.collection("sales").doc(saleId);
      const clientRef = userRef.collection("clients").doc(clientId);
      const productEntries = Array.from(requestedProducts.entries()).map(([productId, quantity]) => ({
        productId,
        quantity,
        ref: userRef.collection("products").doc(productId),
      }));

      const result = await db.runTransaction(async (transaction) => {
        const snapshots = await transaction.getAll(saleRef, clientRef, ...productEntries.map((item) => item.ref));
        const saleSnapshot = snapshots[0];
        const clientSnapshot = snapshots[1];
        const productSnapshots = snapshots.slice(2);

        if (saleSnapshot.exists) throw new Error("SALE_ALREADY_EXISTS");
        if (!clientSnapshot.exists) throw new Error("CLIENT_NOT_FOUND");

        let subtotalCents = 0;
        const saleProducts = productEntries.map((item, index) => {
          const snapshot = productSnapshots[index];
          if (!snapshot.exists) throw new Error(`PRODUCT_NOT_FOUND:${item.productId}`);
          const product = snapshot.data() ?? {};
          const stock = Number(product.stock);
          const price = Number(product.salePrice);
          if (!Number.isFinite(stock) || stock < item.quantity) {
            throw new Error(`INSUFFICIENT_STOCK:${String(product.name ?? item.productId)}`);
          }
          if (!Number.isFinite(price) || price < 0) throw new Error(`INVALID_PRODUCT_PRICE:${item.productId}`);
          const priceCents = Math.round(price * 100);
          subtotalCents += priceCents * item.quantity;
          return { productId: item.productId, quantity: item.quantity, price: priceCents / 100, stock };
        });

        const requestedDiscountCents = discountType === "percent"
          ? Math.round(subtotalCents * discountValue / 100)
          : Math.round(discountValue * 100);
        const discountCents = Math.min(subtotalCents, requestedDiscountCents);
        const totalCents = subtotalCents - discountCents;
        const downPaymentCents = Math.round(downPayment * 100);
        if (downPaymentCents > totalCents) throw new Error("DOWN_PAYMENT_EXCEEDS_TOTAL");
        const remainingCents = paymentType === "prazo" ? totalCents - downPaymentCents : 0;
        const now = new Date();
        const date = now.toISOString();

        const sale = {
          id: saleId,
          clientId,
          products: saleProducts.map((product) => ({
            productId: product.productId,
            quantity: product.quantity,
            price: product.price,
          })),
          subtotal: subtotalCents / 100,
          discountType,
          discountValue,
          discountAmount: discountCents / 100,
          total: totalCents / 100,
          totalPrice: totalCents / 100,
          paymentType,
          legacyPaymentType: paymentType === "avista" ? "cash" : "installments",
          paymentMethod: paymentType === "avista" ? body.paymentMethod ?? null : null,
          downPayment: paymentType === "prazo" ? downPaymentCents / 100 : 0,
          downPaymentMethod: paymentType === "prazo" && downPaymentCents > 0 ? body.downPaymentMethod ?? null : null,
          installments: paymentType === "prazo" ? installmentCount : 0,
          date,
        };
        transaction.create(saleRef, sale);

        for (let index = 0; index < productEntries.length; index += 1) {
          const item = productEntries[index];
          const saleProduct = saleProducts[index];
          transaction.update(item.ref, {
            stock: saleProduct.stock - item.quantity,
            lastSoldDate: date,
          });
        }

        const installmentIds = [];
        if (remainingCents > 0) {
          const baseAmountCents = Math.floor(remainingCents / installmentCount);
          let allocatedCents = 0;
          for (let index = 0; index < installmentCount; index += 1) {
            const amountCents = index === installmentCount - 1
              ? remainingCents - allocatedCents
              : baseAmountCents;
            allocatedCents += amountCents;
            const installmentId = `${saleId}-${String(index + 1).padStart(2, "0")}`;
            const dueDate = new Date(now);
            const dueDay = dueDate.getUTCDate();
            dueDate.setUTCDate(1);
            dueDate.setUTCMonth(dueDate.getUTCMonth() + index + 1);
            const lastDayOfMonth = new Date(Date.UTC(
              dueDate.getUTCFullYear(), dueDate.getUTCMonth() + 1, 0,
            )).getUTCDate();
            dueDate.setUTCDate(Math.min(dueDay, lastDayOfMonth));
            transaction.create(userRef.collection("installments").doc(installmentId), {
              id: installmentId,
              saleId,
              clientId,
              amount: amountCents / 100,
              dueDate: dueDate.toISOString(),
              status: "pending",
              paidAmount: 0,
              installmentNumber: index + 1,
              totalInstallments: installmentCount,
              createdAt: date,
            });
            installmentIds.push(installmentId);
          }
        }

        return {
          saleId,
          subtotal: subtotalCents / 100,
          total: totalCents / 100,
          remainingBalance: remainingCents / 100,
          installmentIds,
          depletedProductIds: saleProducts
            .filter((product, index) => product.stock - productEntries[index].quantity === 0)
            .map((product) => product.productId),
        };
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
      if (code.startsWith("PRODUCT_NOT_FOUND:") || code.startsWith("INVALID_PRODUCT_PRICE:")) {
        return res.status(400).json({ code: code.split(":")[0], message: "Um produto da venda não está mais disponível." });
      }
      return errorResponse(res, 500, "SALE_TRANSACTION_FAILED", "Não foi possível finalizar a venda.", { uid });
    }
  });

  const loadPublicCatalogSettings = async (rawSlug: string) => {
    const db = getFirebaseAdmin().firestore();
    const slug = normalizeCatalogSlug(rawSlug);
    if (!slug) return null;
    const settingsDoc = await findPublicCatalogSettingsDoc(db.collection("user_settings"), rawSlug);
    if (!settingsDoc) return null;
    const settings = settingsDoc.data() ?? {};
    const catalogEnabled = settings.enablePublicCatalog ?? settings.catalogEnabled ?? settings.catalog_enabled ?? true;
    if (catalogEnabled === false || settings.disablePublicCatalog === true) return null;
    const uid = settings.uid || settingsDoc.id;
    return {
      uid,
      slug,
      settings: { ...settings, uid, catalogSlug: slug, catalog_slug: slug, userSlug: slug, enablePublicCatalog: catalogEnabled },
    };
  };

  const loadPublicCatalogProductsPage = async ({
    uid,
    cursor,
    gender,
    limit,
  }: {
    uid: string;
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
    const products = docs.map((doc: any) => ({ id: doc.id, ...doc.data() }));
    const lastDoc = docs[docs.length - 1];
    const hasMore = snapshot.docs.length > limit;
    const nextCursor = hasMore && lastDoc
      ? encodePublicCatalogCursor({ stock: Number(lastDoc.get("stock") || 0), id: lastDoc.id })
      : null;

    return { products, nextCursor, hasMore };
  };

  const loadPublicCatalogOgImage = async (uid: string) => {
    const db = getFirebaseAdmin().firestore();
    const snapshot = await db.collection("users").doc(uid).collection("products").orderBy("imageUrl").limit(1).get();
    const product = snapshot.docs[0]?.data();
    return getPublicCatalogProductImage(product) || "https://revendasmart.vercel.app/favicon.png";
  };

  const loadPublicCatalog = async (rawSlug: string, options: { cursor?: PublicCatalogCursor | null; gender?: string; limit?: number } = {}) => {
    const catalogSettings = await loadPublicCatalogSettings(rawSlug);
    if (!catalogSettings) return null;
    const page = await loadPublicCatalogProductsPage({
      uid: catalogSettings.uid,
      cursor: options.cursor,
      gender: options.gender,
      limit: options.limit ?? PUBLIC_CATALOG_DEFAULT_LIMIT,
    });
    return { ...catalogSettings, ...page };
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
      const page = await loadPublicCatalogProductsPage({ uid: catalogSettings.uid, cursor, gender, limit });
      res.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
      return res.json(page);
    } catch (error) {
      return errorResponse(res, 503, "CATALOG_PRODUCTS_TEMPORARILY_UNAVAILABLE", error instanceof Error ? error.message : "Unknown error");
    }
  });

  app.get("/u/:storeSlug", publicCatalogRateLimit, async (req, res, next) => {
    try {
      const catalog = await loadPublicCatalogSettings(getRouteParam(req, "storeSlug"));
      if (!catalog) return next();
      const indexPath = [path.resolve(__dirname || ".", "public/index.html"), path.resolve(process.cwd(), "dist/public/index.html"), path.resolve(".", "dist/public/index.html")]
        .find((candidate) => fs.existsSync(candidate));
      if (!indexPath) return next();
      const storeName = catalog.settings.storeName || "Minha Loja";
      const description = catalog.settings.catalogDescription || `Confira os produtos disponíveis no catálogo de ${storeName}.`;
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

  // POST /api/user/settings/:userId - Save user settings to Firestore
  app.post("/api/user/settings/:userId", requireAuth, requireOwnership, async (req, res) => {
    const userId = Array.isArray(req.params.userId) ? req.params.userId[0] : req.params.userId;
    const body = req.body;
    try {

      routeInfo("[/api/user/settings POST] userId:", userId);
      routeInfo("[/api/user/settings POST] body keys:", Object.keys(body));

      if (!userId) {
        return res.status(400).json({ error: "userId required" });
      }

      if (!body || typeof body !== "object") {
        return res.status(400).json({ error: "body must be an object" });
      }

      const admin = getFirebaseAdmin();
      const db = admin.firestore();
      
      // ============ REFERRAL VALIDATION (if present in body) ============
      let referrerExists = false;
      if (body.referral_source) {
        const referralSourceUid = body.referral_source;
        routeInfo("[/api/user/settings POST] Validating referral_source:", referralSourceUid);

        // 0. Check if referral already exists (IMMUTABILITY - prevent overwrite)
        try {
          const existingSettings = await db.collection("user_settings").doc(userId).get();
          if (existingSettings.exists && existingSettings.data()?.referral_source) {
            routeWarn("[/api/user/settings POST] Referral already set, blocking reaplication:", {
              existing: existingSettings.data()?.referral_source,
              attempted: referralSourceUid
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

        // 1. Check format (basic UUID-like validation)
        const isValidFormat = /^[a-zA-Z0-9_-]{10,}$/.test(referralSourceUid);
        if (!isValidFormat) {
          routeWarn("[/api/user/settings POST] Invalid referral format:", referralSourceUid);
          return res.status(400).json({ 
            error: "Invalid referral_source format",
            referralValidation: { result: "invalid_format", referralSourceUid }
          });
        }

        // 2. Check self-referral (prevent user from referring themselves)
        if (referralSourceUid === userId) {
          routeWarn("[/api/user/settings POST] Self-referral attempt blocked:", userId);
          return res.status(400).json({ 
            error: "Cannot refer yourself",
            referralValidation: { result: "self_referral", userId }
          });
        }

        // 3. Check if referrer exists (CHANGED: now REQUIRED, not soft check)
         referrerExists = false;
        try {
          const referrerSettings = await db.collection("user_settings").doc(referralSourceUid).get();
          if (referrerSettings.exists) {
            routeInfo("[/api/user/settings POST] Referrer validated: found in user_settings");
            referrerExists = true;
          } else {
            routeWarn("[/api/user/settings POST] Referrer not found:", referralSourceUid);
            // Reject if referrer doesn't exist (stricter validation)
            return res.status(400).json({ 
              error: "Referrer not found",
              referralValidation: { result: "referrer_not_found", referralSourceUid }
            });
          }
        } catch (e) {
          routeWarn("[/api/user/settings POST] Referrer existence check failed:", (e as any)?.message);
          // On error, reject to be safe
          return res.status(500).json({ 
            error: "Failed to validate referrer",
            referralValidation: { result: "validation_error" }
          });
        }

        // Mark referral as applied by backend with timestamp
        body.referral_source = referralSourceUid;
        body.referral_applied_at = body.referral_applied_at || new Date().toISOString();
        body.referral_applied_by = "backend";
        body.referral_immutable = true; // Mark as immutable
        routeInfo("[/api/user/settings POST] Referral validated and marked for persistence as immutable");
      }
      
      routeInfo(`[/api/user/settings POST] Saving to Firestore: user_settings/${userId}`);
      await db.collection("user_settings").doc(userId).set(body, { merge: true });
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
        referralValidation: body.referral_source ? { result: "success", referralSourceUid: body.referral_source } : undefined
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Unknown error";
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
  app.get("/api/legal/privacy-policy", (req, res) => {

    try {
      const filePath = path.resolve(process.cwd(), "dist/public/privacy-policy.md");
      const content = fs.readFileSync(filePath, "utf8");
      res.setHeader("Content-Type", "text/markdown; charset=utf-8");
      res.send(content);
    } catch {
      res.status(404).json({ error: "Privacy Policy not found" });
    }
  });

  app.get("/api/legal/terms-of-service", (req, res) => {
   
    try {
      const filePath = path.resolve(process.cwd(), "dist/public/terms-of-service.md");
      const content = fs.readFileSync(filePath, "utf8");
      res.setHeader("Content-Type", "text/markdown; charset=utf-8");
      res.send(content);
    } catch {
      res.status(404).json({ error: "Terms of Service not found" });
    }
  });

  // GET /api/plan/data/:userId - Get user plan data
  app.get("/api/plan/data/:userId", requireAuth, requireOwnership, async (req, res) => {
    const userId = getRouteParam(req, "userId");
    try {
      const admin = getFirebaseAdmin();
      const db = admin.firestore();

      const planDocRef = db.collection("users").doc(userId).collection("planData").doc("main");
      const planDocSnap = await planDocRef.get();

      if (planDocSnap.exists) {
        return res.status(200).json(planDocSnap.data());
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
     

      // Generate referral code from UID
      const hash = crypto.createHash("md5").update(userId).digest("hex").substring(0, 9).toUpperCase();
      const referralCode = `USER-${hash}`;

      const planDocRef = db.collection("users").doc(userId).collection("planData").doc("main");

      // Set plan data with initial values
      const existingPlan = await planDocRef.get();

if (!existingPlan.exists) {
  await planDocRef.set({
        currentPlan: "free",
        premiumActive: false,
        premiumExpiresAt: null,
        premiumStartedAt: null,
        premiumSource: null,
        referralCode,
        referralCount: 0,
        updatedAt: admin.firestore.Timestamp.now(),
      }); 
      }


      routeInfo("[plan/initialize] Plan initialized for user:", userId);
      return res.status(200).json({ referralCode });
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Unknown error";
      return errorResponse(res, 500, "PLAN_INITIALIZE_ERROR", msg, { userId });
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
      await Promise.all([
        admin.auth().getUser(referredUid),
        admin.auth().getUser(referrerUid),
      ]);

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
