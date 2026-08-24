/**
 * RELEASE V1 §7 — rota real de "melhorar foto" (Premium/admin). Mesma estrutura de entitlement/
 * idempotência/rate-limit de `server/product-cutout-photoroom.ts` (nenhum segundo mecanismo inventado,
 * só reaplicado a um asset derivado diferente). A imagem original NUNCA é sobrescrita — o resultado
 * (quando `improved=true`) é gravado em `product.enhancedPhoto`, um campo à parte.
 */
import { createHash } from "node:crypto";
import type { Express, NextFunction, Request, Response } from "express";
import { getFirebaseAdmin } from "./firebase-admin-init";
import { logError, logInfo, logWarn } from "./logger";
import { isAdminUid } from "./admin-auth";
import { isPremiumActive, type PlanData } from "../shared/monetization";
import { buildProductTruthFromProduct, type ProductRecordForTruth } from "../client/src/lib/product-truth-adapter";
import { resolveOwnedProductImageSource, loadStorageImage } from "./marketing-pro-product-understanding";
import { enhanceProductPhoto, type ProductPhotoQualityMetrics } from "./product-photo-enhancement";
import { decideMarketingProRateLimitWindow, dayBucketId, readWindowStateFromDocData } from "./marketing-pro-rate-limit-firestore";

const GENERATION_ID_PATTERN = /^[a-zA-Z0-9_-]{6,80}$/;
const PRODUCT_ID_PATTERN = /^[A-Za-z0-9_-]{1,200}$/;
/** §7 — número conservador para o V1, mesma filosofia de "quota futura preparada" do PhotoRoom. */
const ENHANCEMENT_RATE_LIMIT_PER_DAY = 20;
const ENHANCEMENT_GENERATIONS_COLLECTION = "productPhotoEnhancementGenerations";
const ENHANCEMENT_RATE_LIMIT_COLLECTION = "productPhotoEnhancementRateLimits";

function isValidGenerationId(value: unknown): value is string {
  return typeof value === "string" && GENERATION_ID_PATTERN.test(value);
}

function sendError(res: Response, status: number, error: string): void {
  res.status(status).json({ error });
}

async function isEnhancementEntitled(uid: string): Promise<boolean> {
  if (await isAdminUid(uid)) return true;
  const admin = getFirebaseAdmin();
  const snapshot = await admin.firestore().collection("users").doc(uid).collection("planData").doc("main").get();
  const planData = snapshot.exists ? (snapshot.data() as PlanData) : null;
  return isPremiumActive(planData);
}

export interface EnhancedProductPhoto {
  readonly sourceAssetId: string;
  readonly derivedAssetId: string;
  readonly storagePath: string;
  readonly downloadUrl?: string;
  readonly mimeType: "image/png";
  readonly width: number;
  readonly height: number;
  readonly operation: "normalize+sharpen";
  readonly metricsBefore: ProductPhotoQualityMetrics;
  readonly metricsAfter: ProductPhotoQualityMetrics;
  readonly createdAt: string;
}

interface EnhancementGenerationDoc {
  readonly status: "processing" | "ready" | "not-improved" | "failed";
  readonly createdAt: string;
  readonly errorCode?: string;
  readonly result?: EnhancedProductPhoto;
  readonly metricsBefore?: ProductPhotoQualityMetrics;
  readonly metricsAfter?: ProductPhotoQualityMetrics;
  readonly reason?: string;
}

async function reserveGeneration(db: FirebaseFirestore.Firestore, uid: string, generationId: string) {
  const ref = db.collection("users").doc(uid).collection(ENHANCEMENT_GENERATIONS_COLLECTION).doc(generationId);
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (snapshot.exists) return { created: false, existing: snapshot.data() as EnhancementGenerationDoc };
    transaction.create(ref, { status: "processing", createdAt: new Date().toISOString() } satisfies EnhancementGenerationDoc);
    return { created: true as const };
  });
}

async function finalizeGeneration(db: FirebaseFirestore.Firestore, uid: string, generationId: string, update: Partial<EnhancementGenerationDoc>): Promise<void> {
  await db.collection("users").doc(uid).collection(ENHANCEMENT_GENERATIONS_COLLECTION).doc(generationId).set(update, { merge: true });
}

async function checkDailyRateLimit(db: FirebaseFirestore.Firestore, uid: string): Promise<boolean> {
  const nowMs = Date.now();
  const ref = db.collection("users").doc(uid).collection(ENHANCEMENT_RATE_LIMIT_COLLECTION).doc(dayBucketId(nowMs));
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const decision = decideMarketingProRateLimitWindow(readWindowStateFromDocData(snapshot.exists ? (snapshot.data() ?? null) : null), ENHANCEMENT_RATE_LIMIT_PER_DAY);
    if (!decision.allowed) return false;
    transaction.set(ref, { count: decision.nextCount, updatedAt: new Date().toISOString() }, { merge: true });
    return true;
  });
}

export function registerProductPhotoEnhancementRoutes(app: Express, requireAuth: (req: Request, res: Response, next: NextFunction) => void): void {
  app.post("/api/products/:productId/enhance-photo", requireAuth, async (req: Request, res: Response) => {
    const uid = (req as Request & { firebaseUid?: string }).firebaseUid || "";
    const productId = String(req.params.productId || "");
    const generationRequestId = String((req.body ?? {}).generationRequestId || "");

    if (!uid || !PRODUCT_ID_PATTERN.test(productId)) return sendError(res, 400, "INVALID_PRODUCT_ID");
    if (!isValidGenerationId(generationRequestId)) return sendError(res, 400, "INVALID_GENERATION_REQUEST_ID");

    try {
      const entitled = await isEnhancementEntitled(uid);
      if (!entitled) {
        logWarn("product_photo_enhancement.entitlement_denied", { requestId: req.requestId });
        return sendError(res, 403, "PHOTO_ENHANCEMENT_PREMIUM_REQUIRED");
      }

      const admin = getFirebaseAdmin();
      const db = admin.firestore();

      const reservation = await reserveGeneration(db, uid, generationRequestId);
      if (!reservation.created) {
        const existing = reservation.existing!;
        if (existing.status === "ready" && existing.result) return res.status(200).json({ improved: true, result: existing.result });
        if (existing.status === "not-improved") return res.status(200).json({ improved: false, reason: existing.reason, metricsBefore: existing.metricsBefore, metricsAfter: existing.metricsAfter });
        if (existing.status === "processing") return sendError(res, 409, "GENERATION_IN_PROGRESS");
        return sendError(res, 502, existing.errorCode || "ENHANCEMENT_FAILED");
      }

      const rateLimitAllowed = await checkDailyRateLimit(db, uid);
      if (!rateLimitAllowed) {
        await finalizeGeneration(db, uid, generationRequestId, { status: "failed", errorCode: "RATE_LIMITED" });
        return sendError(res, 429, "RATE_LIMITED");
      }

      const productRef = db.collection("users").doc(uid).collection("products").doc(productId);
      const productSnapshot = await productRef.get();
      if (!productSnapshot.exists) {
        await finalizeGeneration(db, uid, generationRequestId, { status: "failed", errorCode: "PRODUCT_NOT_FOUND" });
        return sendError(res, 404, "PRODUCT_NOT_FOUND");
      }
      const truth = buildProductTruthFromProduct({ ...(productSnapshot.data() || {}), id: productId } as ProductRecordForTruth);
      const source = resolveOwnedProductImageSource(uid, productId, { ...truth, approvedCutout: undefined });
      if (!source) {
        await finalizeGeneration(db, uid, generationRequestId, { status: "failed", errorCode: "NO_PRODUCT_IMAGE" });
        return sendError(res, 400, "NO_PRODUCT_IMAGE");
      }

      const loaded = await loadStorageImage(source);
      const sourceAssetId = source.assetId;

      const enhancement = await enhanceProductPhoto(Buffer.from(loaded.bytes));

      logInfo("product_photo_enhancement.attempt", {
        requestId: req.requestId,
        generationId: generationRequestId,
        improved: enhancement.improved,
        reason: enhancement.reason,
      });

      if (!enhancement.improved || !enhancement.enhancedPngBytes) {
        await finalizeGeneration(db, uid, generationRequestId, {
          status: "not-improved",
          reason: enhancement.reason,
          metricsBefore: enhancement.metricsBefore,
          metricsAfter: enhancement.metricsAfter,
        });
        // §7.4: original NUNCA é tocado — fail-safe explícito, não um erro.
        return res.status(200).json({ improved: false, reason: enhancement.reason, metricsBefore: enhancement.metricsBefore, metricsAfter: enhancement.metricsAfter });
      }

      const storagePath = `users/${uid}/product-photo-enhancements/${productId}/enhanced-v1.png`;
      const bucket = admin.storage().bucket(process.env.FIREBASE_STORAGE_BUCKET?.trim() || undefined);
      const file = bucket.file(storagePath);
      await file.save(enhancement.enhancedPngBytes, { contentType: "image/png", resumable: false });
      const [downloadUrl] = await file.getSignedUrl({ action: "read", expires: "03-01-2500" }).catch(() => [undefined] as const);

      const derivedAssetId = `product-photo-enhanced:${productId}:sha256:${createHash("sha256").update(enhancement.enhancedPngBytes).digest("hex").slice(0, 32)}`;
      const result: EnhancedProductPhoto = {
        sourceAssetId,
        derivedAssetId,
        storagePath,
        downloadUrl,
        mimeType: "image/png",
        width: enhancement.metricsAfter.width,
        height: enhancement.metricsAfter.height,
        operation: "normalize+sharpen",
        metricsBefore: enhancement.metricsBefore,
        metricsAfter: enhancement.metricsAfter,
        createdAt: new Date().toISOString(),
      };

      // §7.5: derivado, nunca sobrescreve `product.imageUrl`/`product.imageId` — campo à parte, uso é
      // escolha explícita do usuário no client (nunca aplicado automaticamente aqui).
      await productRef.set({ enhancedPhoto: result }, { merge: true });
      await finalizeGeneration(db, uid, generationRequestId, { status: "ready", result });

      logInfo("product_photo_enhancement.ready", { requestId: req.requestId, generationId: generationRequestId, productId });
      return res.status(200).json({ improved: true, result });
    } catch (error) {
      logError("product_photo_enhancement.unhandled_error", error, { requestId: req.requestId, generationId: generationRequestId });
      try {
        const admin = getFirebaseAdmin();
        await finalizeGeneration(admin.firestore(), uid, generationRequestId, { status: "failed", errorCode: "UNHANDLED_ERROR" });
      } catch {
        // idem product-cutout-photoroom.ts: se nem isso funcionar, um retry manual com novo id resolve.
      }
      return sendError(res, 500, "PHOTO_ENHANCEMENT_FAILED");
    }
  });
}
