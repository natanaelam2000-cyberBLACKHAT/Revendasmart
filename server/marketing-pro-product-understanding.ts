/** PRO-11B — orquestração server-only, cache e fallback do Product Understanding. */
import { createHash } from "crypto";
import type { Express, NextFunction, Request, Response } from "express";
import type { ProductTruth, ProductVisualUnderstanding } from "../shared/marketing-pro-creative-intelligence";
import { applyAuthoritativeProductVisualRules, buildProductUnderstandingFallback, parseProductVisualUnderstandingOutput, type ProductUnderstandingResult, type ProductVisualAnalyzer } from "../shared/marketing-pro-product-understanding";
import { IMAGE_UPLOAD_MAX_BYTES, validateImageUploadBytes } from "../shared/image-validation";
import { buildProductTruthFromProduct, type ProductRecordForTruth } from "../client/src/lib/product-truth-adapter";
import { getFirebaseAdmin } from "./firebase-admin-init";
import { logError, logInfo, logWarn } from "./logger";
import { requireProAdsEntitlement } from "./marketing-pro";
import { isMarketingProProductUnderstandingEnabled } from "./marketing-pro-flags";
import { GeminiProductVisualAnalyzer, GEMINI_PRODUCT_VISUAL_ANALYZER_VERSION, GEMINI_PRODUCT_VISUAL_MODEL, isGeminiProductVisualCredentialConfigured } from "./marketing-pro-product-visual-analyzer-google";

export const PRODUCT_UNDERSTANDING_CACHE_COLLECTION = "marketingProProductUnderstanding";
export const PRODUCT_UNDERSTANDING_PRODUCT_ID_PATTERN = /^[A-Za-z0-9_-]{1,200}$/;

export interface ProductUnderstandingMetadata {
  readonly analysisSource: "gemini" | "fallback";
  readonly provider: "google" | "local";
  readonly model: string | null;
  readonly analyzerVersion: string;
  readonly latencyMs: number;
  readonly cached: boolean;
  readonly createdAt: string;
}
export interface ProductUnderstandingResponse extends ProductUnderstandingResult {
  readonly analysisSource: "gemini" | "fallback";
  readonly metadata: ProductUnderstandingMetadata;
}
export interface ProductImageSource { readonly assetId: string; readonly storagePath: string; readonly mimeType?: string }
export interface ProductUnderstandingCacheRecord {
  readonly visualUnderstanding: ProductVisualUnderstanding;
  readonly metadata: Omit<ProductUnderstandingMetadata, "cached">;
  readonly productId: string;
  readonly sourceAssetId: string;
}
interface ProductUnderstandingRuntimeInput {
  readonly enabled: boolean;
  readonly truth: ProductTruth;
  readonly source?: ProductImageSource;
  readonly analyzer?: ProductVisualAnalyzer & { readonly provider?: string; readonly model?: string };
  readonly readCache?: (key: string) => Promise<unknown | null>;
  readonly reserveAnalysis?: (key: string) => Promise<boolean>;
  readonly writeCache?: (key: string, value: ProductUnderstandingCacheRecord) => Promise<void>;
  readonly loadImage?: (source: ProductImageSource) => Promise<{ readonly bytes: Uint8Array; readonly mimeType: string }>;
  readonly now?: () => Date;
}

function cacheKey(productId: string, assetId: string, analyzerVersion: string): string {
  return createHash("sha256").update(`${productId}\0${assetId}\0${analyzerVersion}`).digest("hex");
}
function fallbackResponse(truth: ProductTruth, source: ProductImageSource | undefined, startedAt: number, now: () => Date): ProductUnderstandingResponse {
  return {
    ...buildProductUnderstandingFallback({ truth, sourceImageAssetId: source?.assetId }),
    analysisSource: "fallback",
    metadata: { analysisSource: "fallback", provider: "local", model: null, analyzerVersion: "local-product-understanding-v1", latencyMs: Math.max(0, Date.now() - startedAt), cached: false, createdAt: now().toISOString() },
  };
}
function requireRealProductUnderstandingForTest(): boolean {
  return process.env.REQUIRE_REAL_PRODUCT_UNDERSTANDING === "true"
    && (process.env.NODE_ENV !== "production" || Boolean(process.env.FIRESTORE_EMULATOR_HOST));
}
function failFallbackInStrictMode(reason: string): never {
  throw new Error(`REAL_PRODUCT_UNDERSTANDING_REQUIRED:${reason}`);
}
function parseCacheRecord(value: unknown, productId: string, sourceAssetId: string, analyzerVersion: string): ProductUnderstandingCacheRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Partial<ProductUnderstandingCacheRecord>;
  if (record.productId !== productId || record.sourceAssetId !== sourceAssetId || !record.metadata || record.metadata.analyzerVersion !== analyzerVersion || record.metadata.analysisSource !== "gemini") return null;
  const parsed = parseProductVisualUnderstandingOutput(record.visualUnderstanding);
  return parsed.accepted ? { ...record, visualUnderstanding: parsed.value } as ProductUnderstandingCacheRecord : null;
}

/** Fluxo testável sem Express/Firebase; qualquer falha externa termina no fallback local. */
export async function resolveProductUnderstanding(input: ProductUnderstandingRuntimeInput): Promise<ProductUnderstandingResponse> {
  const startedAt = Date.now();
  const now = input.now || (() => new Date());
  const strict = requireRealProductUnderstandingForTest();
  if (!input.enabled || !input.analyzer || !input.source || !input.loadImage) {
    if (strict) failFallbackInStrictMode("not-configured");
    return fallbackResponse(input.truth, input.source, startedAt, now);
  }
  try {
    const loaded = await input.loadImage(input.source);
    const imageHash = createHash("sha256").update(loaded.bytes).digest("hex");
    const effectiveAssetId = `${input.source.assetId}:sha256:${imageHash}`;
    const key = cacheKey(input.truth.productId, effectiveAssetId, input.analyzer.id);
    if (input.readCache) {
      try {
        const cached = parseCacheRecord(await input.readCache(key), input.truth.productId, effectiveAssetId, input.analyzer.id);
        if (cached) {
          const reconciled = applyAuthoritativeProductVisualRules({ truth: input.truth, visualUnderstanding: cached.visualUnderstanding });
          return { ...reconciled, analysisSource: "gemini", metadata: { ...cached.metadata, cached: true } };
        }
      } catch (error) {
        logWarn("marketing_pro.product_understanding_cache_read_failed", { reason: error instanceof Error ? error.name : "unknown" });
      }
    }
    if (input.reserveAnalysis && !(await input.reserveAnalysis(key))) {
      logInfo("marketing_pro.product_understanding_coalesced", { analyzerVersion: input.analyzer.id });
      if (strict) failFallbackInStrictMode("coalesced-without-cache");
      return fallbackResponse(input.truth, input.source, startedAt, now);
    }
    const analyzed = await input.analyzer.analyzeProductVisual({ image: { assetId: effectiveAssetId, mimeType: loaded.mimeType, bytes: loaded.bytes }, trustedContext: { category: input.truth.category, color: input.truth.color } });
    const reconciled = applyAuthoritativeProductVisualRules({ truth: input.truth, visualUnderstanding: analyzed });
    const metadata: Omit<ProductUnderstandingMetadata, "cached"> = { analysisSource: "gemini", provider: "google", model: input.analyzer.model || GEMINI_PRODUCT_VISUAL_MODEL, analyzerVersion: input.analyzer.id, latencyMs: Math.max(0, Date.now() - startedAt), createdAt: now().toISOString() };
    if (input.writeCache) {
      try {
        await input.writeCache(key, { visualUnderstanding: reconciled.visualUnderstanding, metadata, productId: input.truth.productId, sourceAssetId: effectiveAssetId });
      } catch (error) {
        logWarn("marketing_pro.product_understanding_cache_write_failed", { reason: error instanceof Error ? error.name : "unknown" });
      }
    }
    return { ...reconciled, analysisSource: "gemini", metadata: { ...metadata, cached: false } };
  } catch (error) {
    logWarn("marketing_pro.product_understanding_fallback", { analyzerVersion: input.analyzer.id, reason: error instanceof Error ? error.name : "unknown" });
    if (strict) throw error;
    return fallbackResponse(input.truth, input.source, startedAt, now);
  }
}

function escapeRegex(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
export function resolveOwnedProductImageSource(uid: string, productId: string, truth: ProductTruth): ProductImageSource | null {
  const cutout = truth.approvedCutout;
  if (cutout) {
    const expected = `users/${uid}/product-cutouts/${productId}/cutout-v1.png`;
    return cutout.storagePath === expected ? { assetId: cutout.cutoutAssetId, storagePath: expected, mimeType: "image/png" } : null;
  }
  const storagePath = truth.imageAsset?.storagePath;
  if (!storagePath) return null;
  const modernPattern = new RegExp(`^users/${escapeRegex(uid)}/products/${escapeRegex(productId)}/derived-upload\\.(?:jpe?g|png|webp)$`);
  const legacyPattern = new RegExp(`^users/${escapeRegex(uid)}/products/${escapeRegex(productId)}\\.(?:jpe?g|png|webp)$`);
  if (!modernPattern.test(storagePath) && !legacyPattern.test(storagePath)) return null;
  return { assetId: truth.imageAsset?.imageId || storagePath, storagePath };
}
export async function loadStorageImage(source: ProductImageSource): Promise<{ readonly bytes: Uint8Array; readonly mimeType: string }> {
  const admin = getFirebaseAdmin();
  const file = admin.storage().bucket(process.env.FIREBASE_STORAGE_BUCKET?.trim() || undefined).file(source.storagePath);
  const [metadata] = await file.getMetadata();
  const size = Number(metadata.size);
  if (!Number.isFinite(size) || size <= 0 || size > IMAGE_UPLOAD_MAX_BYTES) throw new Error("INVALID_IMAGE_SIZE");
  const mimeType = source.mimeType || String(metadata.contentType || "").toLowerCase();
  if (!["image/jpeg", "image/png", "image/webp"].includes(mimeType)) throw new Error("INVALID_IMAGE_MIME");
  const [buffer] = await file.download();
  const validation = validateImageUploadBytes(buffer, mimeType);
  if (!validation.accepted) throw new Error(`INVALID_IMAGE_${validation.reason}`);
  return { bytes: buffer, mimeType: validation.format };
}

export interface RegisterProductUnderstandingRoutesOptions { readonly analyzer?: ProductVisualAnalyzer & { readonly provider?: string; readonly model?: string } }
export function registerProductUnderstandingRoutes(app: Express, requireAuth: (req: Request, res: Response, next: NextFunction) => void, options: RegisterProductUnderstandingRoutesOptions = {}): void {
  app.post("/api/marketing/pro/products/:productId/visual-understanding", requireAuth, requireProAdsEntitlement, async (req, res) => {
    const uid = (req as Request & { firebaseUid?: string }).firebaseUid || "";
    const productId = String(req.params.productId || "");
    if (!uid || !PRODUCT_UNDERSTANDING_PRODUCT_ID_PATTERN.test(productId)) return res.status(400).json({ error: "INVALID_PRODUCT_ID" });
    try {
      const admin = getFirebaseAdmin();
      const db = admin.firestore();
      const productRef = db.collection("users").doc(uid).collection("products").doc(productId);
      const productSnapshot = await productRef.get();
      if (!productSnapshot.exists) return res.status(404).json({ error: "PRODUCT_NOT_FOUND" });
      const truth = buildProductTruthFromProduct({ ...(productSnapshot.data() || {}), id: productId } as ProductRecordForTruth);
      const source = resolveOwnedProductImageSource(uid, productId, truth) || undefined;
      const enabled = isMarketingProProductUnderstandingEnabled();
      const analyzer = options.analyzer || (enabled && isGeminiProductVisualCredentialConfigured() ? new GeminiProductVisualAnalyzer() : undefined);
      const cacheCollection = productRef.collection(PRODUCT_UNDERSTANDING_CACHE_COLLECTION);
      const result = await resolveProductUnderstanding({
        enabled, truth, source, analyzer, loadImage: loadStorageImage,
        readCache: async (key) => { const snapshot = await cacheCollection.doc(key).get(); return snapshot.exists ? snapshot.data() || null : null; },
        reserveAnalysis: async (key) => {
          const ref = cacheCollection.doc(key);
          return await db.runTransaction(async (transaction) => {
            const snapshot = await transaction.get(ref);
            const data = snapshot.exists ? snapshot.data() : undefined;
            const leaseExpiresAtMs = Number(data?.leaseExpiresAtMs);
            if (data?.status === "processing" && Number.isFinite(leaseExpiresAtMs) && leaseExpiresAtMs > Date.now()) return false;
            transaction.set(ref, { status: "processing", analyzerVersion: analyzer?.id || null, leaseExpiresAtMs: Date.now() + 30_000, createdAt: new Date().toISOString() });
            return true;
          });
        },
        writeCache: async (key, value) => { await cacheCollection.doc(key).set(value); },
      });
      logInfo("marketing_pro.product_understanding_completed", { requestId: req.requestId, provider: result.metadata.provider, model: result.metadata.model, latencyMs: result.metadata.latencyMs, cached: result.metadata.cached, createdAt: result.metadata.createdAt });
      return res.json(result);
    } catch (error) {
      logError("marketing_pro.product_understanding_failed", error, { requestId: req.requestId });
      return res.status(500).json({ error: "PRODUCT_UNDERSTANDING_FAILED" });
    }
  });
}
export const PRODUCT_UNDERSTANDING_ANALYZER_VERSION = GEMINI_PRODUCT_VISUAL_ANALYZER_VERSION;

export function createRuntimeProductVisualAnalyzer(): (ProductVisualAnalyzer & { readonly provider?: string; readonly model?: string }) | undefined {
  return isMarketingProProductUnderstandingEnabled() && isGeminiProductVisualCredentialConfigured()
    ? new GeminiProductVisualAnalyzer()
    : undefined;
}
