import fs from "fs";
import path from "path";
import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { initializeFirebaseAdmin, getFirebaseAdmin } from "./firebase-admin-init";
import { registerPaymentRoutes } from "./payments";
import { registerConnectionRoutes } from "./mercadopago-connections";
import { registerSubscriptionRoutes } from "./subscriptions";
import { getGlobalConfig, setGlobalConfig } from "./subscriptions";
 import crypto from "crypto";

function normalizeCatalogSlug(value: unknown): string {
  return String(value ?? "").trim().toLowerCase().normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
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
  const errorId = Math.random().toString(36).substring(7);
  
  console.error(`[${timestamp}] ERROR-ID: ${errorId}`, {
    status: statusCode,
    errorType,
    message,
    context,
  });

  return res.status(statusCode).json({
    error: errorType,
    message,
    errorId,
    timestamp,
    ...(context && { context }),
  });
}

// Middleware: verify Firebase ID token and attach uid to request
async function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      console.warn("[auth] Missing Authorization header for:", req.path);
      return res.status(401).json({ error: "Unauthorized: missing token" });
    }
    const token = authHeader.slice(7);
    const admin = getFirebaseAdmin();
    const decoded = await admin.auth().verifyIdToken(token);
    (req as any).firebaseUid = decoded.uid;
    next();
  } catch (e) {
    console.warn("[auth] Token verification failed:", (e as any)?.message);
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
      console.log("[requireAdmin] Access granted via custom claim for:", firebaseUid);
      next();
      return;
    }
    
    // FALLBACK: Legacy email check (deprecated, for transition period only)
    if (ADMIN_UIDS_LEGACY.has(userRecord.email || "")) {
      console.warn("[requireAdmin] MIGRATION: Using legacy email check (deprecated) for:", userRecord.email, "— Set custom claim to remove fallback");
      next();
      return;
    }
    
    console.warn("[requireAdmin] Access denied for non-admin user:", firebaseUid, "email:", userRecord.email);
    return res.status(403).json({ error: "Forbidden: admin access required" });
  } catch (e) {
    console.error("[requireAdmin] Error checking admin status:", e);
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

  const loadPublicCatalog = async (rawSlug: string) => {
    const db = getFirebaseAdmin().firestore();
    const slug = normalizeCatalogSlug(rawSlug);
    if (!slug) return null;
    const ref = db.collection("user_settings");
    const candidates = Array.from(new Set([rawSlug, slug]));
    let settingsDoc: any = null;
    for (const field of ["catalogSlug", "catalog_slug", "userSlug", "slug"]) {
      for (const candidate of candidates) {
        const snapshot = await ref.where(field, "==", candidate).limit(1).get();
        if (!snapshot.empty) { settingsDoc = snapshot.docs[0]; break; }
      }
      if (settingsDoc) break;
    }
    if (!settingsDoc) {
      const snapshot = await ref.get();
      settingsDoc = snapshot.docs.find((doc: any) => {
        const data = doc.data();
        return [data.catalogSlug, data.catalog_slug, data.userSlug, data.slug, data.storeName]
          .some((value) => normalizeCatalogSlug(value) === slug);
      }) ?? null;
    }
    if (!settingsDoc) return null;
    const settings = settingsDoc.data() ?? {};
    const catalogEnabled = settings.enablePublicCatalog ?? settings.catalogEnabled ?? settings.catalog_enabled ?? true;
    if (catalogEnabled === false || settings.disablePublicCatalog === true) return null;
    const uid = settings.uid || settingsDoc.id;
    const productDocs = await db.collection("users").doc(uid).collection("products").get();
    const products = productDocs.docs.map((doc: any) => ({ id: doc.id, ...doc.data() }));
    return { uid, slug, settings: { ...settings, uid, catalogSlug: slug, catalog_slug: slug, userSlug: slug, enablePublicCatalog: catalogEnabled }, products };
  };

  app.get("/api/public/catalog/:storeSlug", async (req, res) => {
    try {
      const catalog = await loadPublicCatalog(req.params.storeSlug);
      if (!catalog) return res.status(404).json({ error: "CATALOG_NOT_FOUND" });
      res.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
      return res.json(catalog);
    } catch (error) {
      return errorResponse(res, 503, "CATALOG_TEMPORARILY_UNAVAILABLE", error instanceof Error ? error.message : "Unknown error");
    }
  });

  app.get("/u/:storeSlug", async (req, res, next) => {
    try {
      const catalog = await loadPublicCatalog(req.params.storeSlug);
      if (!catalog) return next();
      const indexPath = [path.resolve(__dirname || ".", "public/index.html"), path.resolve(process.cwd(), "dist/public/index.html"), path.resolve(".", "dist/public/index.html")]
        .find((candidate) => fs.existsSync(candidate));
      if (!indexPath) return next();
      const storeName = catalog.settings.storeName || "Minha Loja";
      const description = catalog.settings.catalogDescription || `Confira os produtos disponíveis no catálogo de ${storeName}.`;
      const featured: any = catalog.products.find((p: any) => p?.imageUrl || p?.image || p?.photoUrl);
      const image = featured?.imageUrl || featured?.image || featured?.photoUrl || "https://revendasmart.vercel.app/favicon.png";
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
      console.error("[catalog-meta] Failed:", error);
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

      console.log("[/api/user/settings POST] userId:", userId);
      console.log("[/api/user/settings POST] body keys:", Object.keys(body));

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
        console.log("[/api/user/settings POST] Validating referral_source:", referralSourceUid);

        // 0. Check if referral already exists (IMMUTABILITY - prevent overwrite)
        try {
          const existingSettings = await db.collection("user_settings").doc(userId).get();
          if (existingSettings.exists && existingSettings.data()?.referral_source) {
            console.warn("[/api/user/settings POST] Referral already set, blocking reaplication:", {
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
          console.warn("[/api/user/settings POST] Error checking existing referral:", (e as any)?.message);
          // Don't block on check failure, continue
        }

        // 1. Check format (basic UUID-like validation)
        const isValidFormat = /^[a-zA-Z0-9_-]{10,}$/.test(referralSourceUid);
        if (!isValidFormat) {
          console.warn("[/api/user/settings POST] Invalid referral format:", referralSourceUid);
          return res.status(400).json({ 
            error: "Invalid referral_source format",
            referralValidation: { result: "invalid_format", referralSourceUid }
          });
        }

        // 2. Check self-referral (prevent user from referring themselves)
        if (referralSourceUid === userId) {
          console.warn("[/api/user/settings POST] Self-referral attempt blocked:", userId);
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
            console.log("[/api/user/settings POST] Referrer validated: found in user_settings");
            referrerExists = true;
          } else {
            console.warn("[/api/user/settings POST] Referrer not found:", referralSourceUid);
            // Reject if referrer doesn't exist (stricter validation)
            return res.status(400).json({ 
              error: "Referrer not found",
              referralValidation: { result: "referrer_not_found", referralSourceUid }
            });
          }
        } catch (e) {
          console.warn("[/api/user/settings POST] Referrer existence check failed:", (e as any)?.message);
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
        console.log("[/api/user/settings POST] Referral validated and marked for persistence as immutable");
      }
      
      console.log(`[/api/user/settings POST] Saving to Firestore: user_settings/${userId}`);
      await db.collection("user_settings").doc(userId).set(body, { merge: true });
      console.log("[/api/user/settings POST] Successfully saved to Firestore");

      // ============ REFERRAL CONVERSION ATTRIBUTION (if new referral was applied) ============
      // Uses Firestore transaction to ensure atomically consistent counting (no race conditions)
      if (body.referral_source && referrerExists) {
        const referralSourceUid = body.referral_source;
        console.log("[/api/user/settings POST] Recording referral conversion for referrer:", referralSourceUid);
        
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
              console.warn("[/api/user/settings POST] User already in referrer's list (transaction check), skipping:", userId);
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
            
            console.log("[/api/user/settings POST] Referral conversion + reward eligibility recorded for:", referralSourceUid, { conversions: newConversions, eligible: newRewardEligible });
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
            console.log("[/api/user/settings POST] Telemetry: referral_conversion_counted");
            // Client will log: referral_conversion_counted event
          } else if (conversionResult.status === "duplicate") {
            console.log("[/api/user/settings POST] Telemetry: referral_conversion_skipped_duplicate");
            // Client will log: referral_conversion_skipped_duplicate event
          }
        } catch (e) {
          console.warn("[/api/user/settings POST] Failed to record referral conversion (transaction):", (e as any)?.message);
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
    try {
      const { userId } = req.params;
      
      // Import migration helpers
      const { 
        generateMigrationStatus,
        validateFirebaseStorageSetup 
      } = await import("./migration-helpers");
      const { 
        readProductsFromStorage,
        readClientsFromStorage,
        readSalesFromStorage,
        readInstallmentsFromStorage,
        readPostsFromStorage,
        listImagesFromIndexedDB
      } = await import("./migration-helpers");

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
    try {
      const { userId } = req.params;
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
    try {
      const { targetUserId } = req.params;
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
      
      console.log("[/api/rewards/grant] Admin:", adminUid, "granting", count, "rewards to", targetUserId);
      
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
        
        console.log("[/api/rewards/grant] Transaction completed:", {
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
        { targetUserId: req.params.targetUserId }
      );
    }
  });

  // POST /api/user/images/migrate/:userId - Placeholder for future image migration
  app.post("/api/user/images/migrate/:userId", requireAuth, requireOwnership, async (req, res) => {
    try {
      const { userId } = req.params;
      
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
    } catch (error) {
      res.status(404).json({ error: "Privacy Policy not found" });
    }
  });

  app.get("/api/legal/terms-of-service", (req, res) => {
   
    try {
      const filePath = path.resolve(process.cwd(), "dist/public/terms-of-service.md");
      const content = fs.readFileSync(filePath, "utf8");
      res.setHeader("Content-Type", "text/markdown; charset=utf-8");
      res.send(content);
    } catch (error) {
      res.status(404).json({ error: "Terms of Service not found" });
    }
  });

  // GET /api/plan/data/:userId - Get user plan data
  app.get("/api/plan/data/:userId", requireAuth, requireOwnership, async (req, res) => {
    try {
      const { userId } = req.params;
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
    try {
      const { userId } = req.params;
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


      console.log("[plan/initialize] Plan initialized for user:", userId);
      return res.status(200).json({ referralCode });
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Unknown error";
      return errorResponse(res, 500, "PLAN_INITIALIZE_ERROR", msg, { userId });
    }
  });

  // POST /api/referral/track-event - Track referral event (account creation, onboarding, etc)
  app.post("/api/referral/track-event", async (req, res) => {
    try {
      const { referredUID, referredEmail, referrerUID, referrerEmail, event } = req.body;

      if (!referredUID || !referrerUID || !event) {
        return res.status(400).json({ error: "Missing required fields" });
      }

      // Validate referral code if provided
      const { refCode } = req.body;
      if (refCode && typeof refCode === "string") {
        if (!refCode.startsWith("USER-")) {
          return res.status(400).json({ error: "Invalid referral code format" });
        }
      }

      const admin = getFirebaseAdmin();
      const db = admin.firestore();

      // Create referral event
      const eventId = db.collection("referralEvents").doc().id;
      const eventRef = db.collection("referralEvents").doc(eventId);

      await eventRef.set({
        referredUID,
        referredEmail,
        referrerUID,
        referrerEmail,
        events: [
          {
            timestamp: admin.firestore.Timestamp.now(),
            event,
            status: "success",
          },
        ],
        status: "pending",
        validatedAt: null,
        deviceId: req.body.deviceId || null,
        ipAddress: req.ip || null,
        accountAge: 0,
        createdAt: admin.firestore.Timestamp.now(),
        updatedAt: admin.firestore.Timestamp.now(),
      });

      console.log("[referral/track-event] Event tracked:", {
        eventId,
        referredUID,
        referrerUID,
        event,
      });

      return res.status(200).json({ eventId, status: "pending" });
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Unknown error";
      return errorResponse(res, 500, "REFERRAL_TRACK_ERROR", msg);
    }
  });

  // POST /api/referral/validate-referral - Validate referral after onboarding
  app.post("/api/referral/validate-referral", async (req, res) => {
    try {
      const { referredUID, referrerUID } = req.body;

      if (!referredUID || !referrerUID) {
        return res.status(400).json({ error: "Missing required fields" });
      }

      const admin = getFirebaseAdmin();
      const db = admin.firestore();

      // Find referral event for this pair
      const eventsQuery = await db
        .collection("referralEvents")
        .where("referredUID", "==", referredUID)
        .where("referrerUID", "==", referrerUID)
        .get();

      if (eventsQuery.empty) {
        return res.status(404).json({ error: "Referral event not found" });
      }

      const eventDoc = eventsQuery.docs[0];
      const eventData = eventDoc.data();

      // Verify referral is still pending
      if (eventData.status !== "pending") {
        return res.status(400).json({ error: "Referral already processed" });
      }

      // Mark as valid
      await eventDoc.ref.update({
        status: "valid",
        validatedAt: admin.firestore.Timestamp.now(),
        updatedAt: admin.firestore.Timestamp.now(),
      });

      // Update referrer's referral count
      const planDocRef = db.collection("users").doc(referrerUID).collection("planData").doc("main");
      const planSnap = await planDocRef.get();

      if (planSnap.exists) {
        const currentCount = planSnap.data()?.referralCount || 0;
        const newCount = currentCount + 1;

        await planDocRef.update({
          referralCount: newCount,
          updatedAt: admin.firestore.Timestamp.now(),
        });

        // If reached 3 valid referrals, grant premium
        if (newCount === 3) {
          const thirtyDaysFromNow = new Date();
          thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);

          await planDocRef.update({
            currentPlan: "premium",
            premiumActive: true,
            premiumExpiresAt: admin.firestore.Timestamp.fromDate(thirtyDaysFromNow),
            premiumStartedAt: admin.firestore.Timestamp.now(),
            premiumSource: "referral_reward",
          });

          console.log("[referral/validate] Premium granted via referral for user:", referrerUID);
          return res.status(200).json({
            status: "valid",
            premiumGranted: true,
            message: "Você ganhou 30 dias de Premium!",
          });
        }

        console.log("[referral/validate] Referral count updated:", {
          referrerUID,
          newCount,
        });
        return res.status(200).json({
          status: "valid",
          premiumGranted: false,
          referralCount: newCount,
          remaining: 3 - newCount,
        });
      }

      return res.status(200).json({ status: "valid", premiumGranted: false });
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Unknown error";
      return errorResponse(res, 500, "REFERRAL_VALIDATE_ERROR", msg);
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

      console.log("[admin/global-config] Updated successfully:", {
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
