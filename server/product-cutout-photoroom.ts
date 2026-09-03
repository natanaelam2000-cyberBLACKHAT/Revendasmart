/**
 * RELEASE V1 §6 — recorte PhotoRoom REAL para Premium/admin no fluxo de produto. Reaproveita:
 *   - `server/photoroom-cutout-adapter.ts` (Fase 1: chamada ao provider + validação da mask) — movido
 *     de `script/product-cutout-smoke/photoroom.ts`, comportamento idêntico, nenhuma lógica duplicada;
 *   - `shared/product-cutout.ts` (`composeProductCutoutRgba`, Fase 2: Pixel Preservation Gate);
 *   - `shared/approved-product-cutout.ts` (contrato de persistência já usado pelo recorte local-heuristic
 *     hoje — só muda `method`/`provider`, nunca um segundo schema);
 *   - `server/marketing-pro-product-understanding.ts` (`resolveOwnedProductImageSource`/`loadStorageImage`,
 *     já testados para localizar e baixar a imagem original do produto com segurança).
 *
 * A ÚNICA peça nova de decodificação é `decodeOriginalToRgba` (via `sharp`, já dependência do projeto) —
 * o harness de smoke-test só sabia decodificar PNG local; agora qualquer formato de origem (JPEG/PNG/
 * WebP) pode ter RGBA disponível para a Fase 2, sem tocar no adapter em si.
 *
 * Chave do provider: só lida via `process.env.PHOTOROOM_API_KEY` — nunca no client, nunca em Firestore
 * público, nunca no bundle. Sem a env var, a rota falha fechado com um erro claro (§17 do ticket).
 */
import { createHash } from "node:crypto";
import type { Express, NextFunction, Request, Response } from "express";
import sharp from "sharp";
import { getFirebaseAdmin } from "./firebase-admin-init";
import { logError, logInfo, logWarn } from "./logger";
import { isAdminUid } from "./admin-auth";
import { resolveServerPlan } from "./plan-authoritative-mutations";
import { buildProductTruthFromProduct, type ProductRecordForTruth } from "../client/src/lib/product-truth-adapter";
import { resolveOwnedProductImageSource, loadStorageImage } from "./marketing-pro-product-understanding";
import { runPhotoroomCutoutAdapter, type ProductCutoutSourceDimensions } from "./photoroom-cutout-adapter";
import {
  buildApprovedProductCutoutForPersistence,
  buildApprovedProductCutoutStoragePath,
  isApprovedProductCutoutStale,
  shouldReuseExistingProductCutout,
  type ApprovedProductCutout,
} from "../shared/approved-product-cutout";
import { PRODUCT_IMAGE_COORDINATE_SPACE_VERSION } from "../shared/product-image-coordinate-space";
import type { ProductCutoutOriginalRgbaBuffer } from "../shared/product-cutout";
import { decideMarketingProRateLimitWindow, dayBucketId, readWindowStateFromDocData } from "./marketing-pro-rate-limit-firestore";
import { PLAN_CONFIG, type PlanType } from "../shared/monetization";
import { reservePreparationSlot, completePreparationSlot, releasePreparationSlot } from "./ads-pro-preparation-quota";

const GENERATION_ID_PATTERN = /^[a-zA-Z0-9_-]{6,80}$/;
const PRODUCT_ID_PATTERN = /^[A-Za-z0-9_-]{1,200}$/;
/** §6.8: número conservador para o V1 — "quota futura preparada", não uma regra comercial definitiva. */
const PHOTOROOM_RATE_LIMIT_PER_DAY = 20;
const PHOTOROOM_CUTOUT_GENERATIONS_COLLECTION = "productCutoutPhotoroomGenerations";
const PHOTOROOM_RATE_LIMIT_COLLECTION = "productCutoutPhotoroomRateLimits";

function isValidGenerationId(value: unknown): value is string {
  return typeof value === "string" && GENERATION_ID_PATTERN.test(value);
}

function sendError(res: Response, status: number, error: string): void {
  res.status(status).json({ error });
}

/** PLAN-IMPL-05 — admin/dev testa sem cota (mesma regra de `requireProAdsEntitlement`, §4.2), plan=null
 * sinaliza "sem teto comercial" ao chamador. Para os demais, `resolveServerPlan` (já usado por
 * server/booking-quota.ts) é a MESMA autoridade grant-aware/trial-aware de todo o resto do app — Tester
 * e Premium+ "recebem todos os benefícios do Premium atual" automaticamente, sem lógica paralela aqui.
 * Free (proAdPreparationsMonthly=0) nunca passa daqui — zero chamadas ao provider. Pro e Premium têm
 * cotas distintas (3/100, PLAN_CONFIG — nunca hardcoded), Free continua bloqueado como antes. */
async function resolvePhotoroomEntitlement(db: FirebaseFirestore.Firestore, uid: string): Promise<{ readonly allowed: boolean; readonly plan: PlanType | null }> {
  if (await isAdminUid(uid)) return { allowed: true, plan: null };
  const plan = await resolveServerPlan(db, uid);
  return { allowed: PLAN_CONFIG[plan].limits.proAdPreparationsMonthly > 0, plan };
}

/**
 * §6.4: decodifica a imagem ORIGINAL (qualquer formato aceito por `loadStorageImage`) para RGBA puro
 * via `sharp` — nunca redesenha/recompõe nada, só descompacta pixels. `null` em qualquer falha (fail
 * closed): quando isso acontece, a Fase 2 simplesmente não roda (mesmo comportamento já usado pelo
 * adapter para fontes sem RGBA disponível), nunca finge um resultado.
 */
async function decodeOriginalToRgba(bytes: Uint8Array, sourceAssetId: string): Promise<ProductCutoutOriginalRgbaBuffer | null> {
  try {
    const { data, info } = await sharp(Buffer.from(bytes), { failOn: "error", limitInputPixels: 25_000_000 })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    if (info.channels !== 4 || !info.width || !info.height) return null;
    return { width: info.width, height: info.height, data: new Uint8Array(data), sourceAssetId, coordinateSpaceVersion: PRODUCT_IMAGE_COORDINATE_SPACE_VERSION };
  } catch (error) {
    logWarn("product_cutout_photoroom.original_decode_failed", { reason: error instanceof Error ? error.name : "unknown" });
    return null;
  }
}

interface PhotoroomCutoutGenerationDoc {
  readonly status: "processing" | "ready" | "failed";
  readonly createdAt: string;
  readonly errorCode?: string;
  readonly cutout?: ApprovedProductCutout;
}

/** §6.8: idempotência real via transação — a MESMA `generationRequestId` nunca chama o provider duas
 * vezes; um double-click cai sempre no branch "processing"/"ready" já existente. */
async function reserveGeneration(
  db: FirebaseFirestore.Firestore,
  uid: string,
  generationId: string,
): Promise<{ readonly created: boolean; readonly existing?: PhotoroomCutoutGenerationDoc }> {
  const ref = db.collection("users").doc(uid).collection(PHOTOROOM_CUTOUT_GENERATIONS_COLLECTION).doc(generationId);
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (snapshot.exists) {
      return { created: false, existing: snapshot.data() as PhotoroomCutoutGenerationDoc };
    }
    transaction.create(ref, { status: "processing", createdAt: new Date().toISOString() } satisfies PhotoroomCutoutGenerationDoc);
    return { created: true };
  });
}

async function finalizeGeneration(
  db: FirebaseFirestore.Firestore,
  uid: string,
  generationId: string,
  update: Partial<PhotoroomCutoutGenerationDoc>,
): Promise<void> {
  await db.collection("users").doc(uid).collection(PHOTOROOM_CUTOUT_GENERATIONS_COLLECTION).doc(generationId).set(update, { merge: true });
}

/** §6.8 — mesmo par puro (`decideMarketingProRateLimitWindow`/`dayBucketId`) já usado e testado pelo
 * rate limit do Anúncios Pro (PRO-09), aplicado a uma coleção própria do PhotoRoom — nenhum segundo
 * mecanismo de rate limit inventado, só uma janela nova reaproveitando a mesma lógica. */
async function checkDailyRateLimit(db: FirebaseFirestore.Firestore, uid: string): Promise<boolean> {
  const nowMs = Date.now();
  const ref = db.collection("users").doc(uid).collection(PHOTOROOM_RATE_LIMIT_COLLECTION).doc(dayBucketId(nowMs));
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const decision = decideMarketingProRateLimitWindow(readWindowStateFromDocData(snapshot.exists ? (snapshot.data() ?? null) : null), PHOTOROOM_RATE_LIMIT_PER_DAY);
    if (!decision.allowed) return false;
    transaction.set(ref, { count: decision.nextCount, updatedAt: new Date().toISOString() }, { merge: true });
    return true;
  });
}

export function registerProductCutoutPhotoroomRoutes(app: Express, requireAuth: (req: Request, res: Response, next: NextFunction) => void): void {
  app.post("/api/products/:productId/photoroom-cutout", requireAuth, async (req: Request, res: Response) => {
    const uid = (req as Request & { firebaseUid?: string }).firebaseUid || "";
    const productId = String(req.params.productId || "");
    const generationRequestId = String((req.body ?? {}).generationRequestId || "");

    if (!uid || !PRODUCT_ID_PATTERN.test(productId)) return sendError(res, 400, "INVALID_PRODUCT_ID");
    if (!isValidGenerationId(generationRequestId)) return sendError(res, 400, "INVALID_GENERATION_REQUEST_ID");

    // PLAN-IMPL-05 — rastreado fora do try para o catch-all também conseguir liberar uma vaga já
    // reservada se algo inesperado explodir depois de reservePreparationSlot ter sucedido (§23).
    let reservedMonthKey: string | null = null;
    let quotaPlan: PlanType | null = null;

    try {
      const admin = getFirebaseAdmin();
      const db = admin.firestore();

      const entitlement = await resolvePhotoroomEntitlement(db, uid);
      if (!entitlement.allowed) {
        logWarn("product_cutout_photoroom.entitlement_denied", { requestId: req.requestId });
        return sendError(res, 403, "PHOTOROOM_PLAN_REQUIRED");
      }
      quotaPlan = entitlement.plan;

      const apiKey = process.env.PHOTOROOM_API_KEY?.trim() || "";
      if (!apiKey) {
        // §17: credencial inexistente — fail closed com erro claro, nunca finge um recorte com
        // heurística local no lugar (isso seria "fingir PhotoRoom", proibido em §2).
        logWarn("product_cutout_photoroom.api_key_missing", { requestId: req.requestId });
        return sendError(res, 503, "PHOTOROOM_NOT_CONFIGURED");
      }

      const reservation = await reserveGeneration(db, uid, generationRequestId);
      if (!reservation.created) {
        const existing = reservation.existing!;
        if (existing.status === "ready" && existing.cutout) {
          logInfo("product_cutout_photoroom.idempotent_replay", { requestId: req.requestId, generationId: generationRequestId });
          return res.status(200).json(existing.cutout);
        }
        if (existing.status === "processing") {
          return sendError(res, 409, "GENERATION_IN_PROGRESS");
        }
        return sendError(res, 502, existing.errorCode || "GENERATION_FAILED");
      }

      const productRef = db.collection("users").doc(uid).collection("products").doc(productId);
      const productSnapshot = await productRef.get();
      if (!productSnapshot.exists) {
        await finalizeGeneration(db, uid, generationRequestId, { status: "failed", errorCode: "PRODUCT_NOT_FOUND" });
        return sendError(res, 404, "PRODUCT_NOT_FOUND");
      }
      const truth = buildProductTruthFromProduct({ ...(productSnapshot.data() || {}), id: productId } as ProductRecordForTruth);
      // PLAN-IMPL-05 §10/§11 — SEMPRE a identidade da foto ORIGINAL (nunca de um approvedCutout
      // pré-existente): sem tirar approvedCutout daqui, resolveOwnedProductImageSource prefere o cutout
      // já aprovado quando ele existe (correto para composição de anúncios, errado para decidir o que
      // enviar ao provider numa nova preparação — enviaria o cutout já recortado de volta ao PhotoRoom
      // como se fosse a foto original). Mesmo padrão já usado pelo endpoint de staleness abaixo.
      const source = resolveOwnedProductImageSource(uid, productId, { ...truth, approvedCutout: undefined });
      if (!source) {
        await finalizeGeneration(db, uid, generationRequestId, { status: "failed", errorCode: "NO_PRODUCT_IMAGE" });
        return sendError(res, 400, "NO_PRODUCT_IMAGE");
      }

      // PLAN-IMPL-05 §9/§12/§36 — reuso: um cutout PhotoRoom já aprovado e não-stale para a foto ATUAL
      // nunca gera uma nova preparação (nunca chama o provider, nunca consome cota, nunca consome o rate
      // limit diário abaixo) — mesmo com a cota do mês zerada, o produto já preparado continua disponível.
      const existingCutout = truth.approvedCutout;
      if (shouldReuseExistingProductCutout(existingCutout, source.assetId)) {
        await finalizeGeneration(db, uid, generationRequestId, { status: "ready", cutout: existingCutout! });
        logInfo("product_cutout_photoroom.reused_existing", { requestId: req.requestId, generationId: generationRequestId, productId });
        return res.status(200).json(existingCutout!);
      }

      const rateLimitAllowed = await checkDailyRateLimit(db, uid);
      if (!rateLimitAllowed) {
        await finalizeGeneration(db, uid, generationRequestId, { status: "failed", errorCode: "RATE_LIMITED" });
        return sendError(res, 429, "RATE_LIMITED");
      }

      // PLAN-IMPL-05 §18/§19/§20/§21 — admin (quotaPlan === null) nunca reserva vaga, testa sem teto
      // comercial (mesmo espírito de sempre). Pro/Premium precisam de uma vaga mensal ANTES do provider.
      if (quotaPlan !== null) {
        const reservedSlot = await reservePreparationSlot(db, uid, productId, quotaPlan);
        if (!reservedSlot.reserved) {
          const errorCode = reservedSlot.reason === "in_progress" ? "ADS_PRO_PREPARATION_IN_PROGRESS" : "ADS_PRO_PREPARATION_LIMIT_REACHED";
          await finalizeGeneration(db, uid, generationRequestId, { status: "failed", errorCode });
          return sendError(res, 409, errorCode);
        }
        reservedMonthKey = reservedSlot.monthKey;
      }

      const loaded = await loadStorageImage(source);
      const sourceAssetId = source.assetId;
      const originalRgba = await decodeOriginalToRgba(loaded.bytes, sourceAssetId);
      const dimensions = originalRgba
        ? { width: originalRgba.width, height: originalRgba.height }
        : await sharp(Buffer.from(loaded.bytes)).metadata().then((meta) => ({ width: meta.width || 0, height: meta.height || 0 })).catch(() => ({ width: 0, height: 0 }));
      if (!dimensions.width || !dimensions.height) {
        // PLAN-IMPL-05 §23 — falha depois de reservar: devolve a vaga, nunca perde cota permanentemente.
        if (reservedMonthKey) await releasePreparationSlot(db, uid, productId, reservedMonthKey);
        await finalizeGeneration(db, uid, generationRequestId, { status: "failed", errorCode: "INVALID_IMAGE_DIMENSIONS" });
        return sendError(res, 400, "INVALID_IMAGE_DIMENSIONS");
      }

      const sourceDimensions: ProductCutoutSourceDimensions = {
        width: dimensions.width,
        height: dimensions.height,
        sourceAssetId,
        coordinateSpaceVersion: PRODUCT_IMAGE_COORDINATE_SPACE_VERSION,
      };

      const attempt = await runPhotoroomCutoutAdapter({
        apiKey,
        sourceImageBytes: loaded.bytes,
        fileName: `${productId}.${loaded.mimeType === "image/png" ? "png" : loaded.mimeType === "image/webp" ? "webp" : "jpg"}`,
        mimeType: loaded.mimeType,
        sourceDimensions,
        originalRgba: originalRgba ?? undefined,
      });

      logInfo("product_cutout_photoroom.attempt", {
        requestId: req.requestId,
        generationId: generationRequestId,
        providerMaskAccepted: attempt.providerMaskAccepted,
        localCompositionStatus: attempt.localCompositionStatus,
        httpStatus: attempt.httpStatus,
        durationMs: attempt.durationMs ?? null,
      });

      if (!attempt.success || !attempt.composition || attempt.composition.accepted !== true) {
        const errorCode = attempt.errorCode
          || (attempt.localCompositionStatus === "pending-source-rgba" ? "ORIGINAL_DECODE_UNAVAILABLE" : "CUTOUT_FAILED");
        // PLAN-IMPL-05 §23 — provider falhou (ou Pixel Preservation Gate rejeitou): +0 na cota, sempre.
        if (reservedMonthKey) await releasePreparationSlot(db, uid, productId, reservedMonthKey);
        await finalizeGeneration(db, uid, generationRequestId, { status: "failed", errorCode });
        return sendError(res, 502, errorCode);
      }

      const storagePath = buildApprovedProductCutoutStoragePath(uid, productId);
      const pngBytes = Buffer.from(await sharp(Buffer.from(attempt.composition.cutout.data), {
        raw: { width: attempt.composition.cutout.width, height: attempt.composition.cutout.height, channels: 4 },
      }).png().toBuffer());

      const bucket = admin.storage().bucket(process.env.FIREBASE_STORAGE_BUCKET?.trim() || undefined);
      const file = bucket.file(storagePath);
      await file.save(pngBytes, { contentType: "image/png", resumable: false });
      const [downloadUrl] = await file.getSignedUrl({ action: "read", expires: "03-01-2500" }).catch(() => [undefined] as const);

      const cutoutAssetId = `product-cutout-approved:${productId}:sha256:${createHash("sha256").update(pngBytes).digest("hex").slice(0, 32)}`;
      const cutout = buildApprovedProductCutoutForPersistence({
        composed: attempt.composition,
        sourceAssetId,
        cutoutAssetId,
        storagePath,
        downloadUrl,
        method: "specialized-api",
        provider: "photoroom",
      });

      await productRef.set({ approvedCutout: cutout }, { merge: true });
      // PLAN-IMPL-05 — sucesso: a cota reservada em reservePreparationSlot fica consumida de verdade,
      // só libera o lock (nunca decrementa o usado aqui — isso é exclusivo do caminho de falha).
      if (reservedMonthKey) { await completePreparationSlot(db, uid, productId); reservedMonthKey = null; }
      await finalizeGeneration(db, uid, generationRequestId, { status: "ready", cutout });

      logInfo("product_cutout_photoroom.ready", { requestId: req.requestId, generationId: generationRequestId, productId });
      return res.status(200).json(cutout);
    } catch (error) {
      logError("product_cutout_photoroom.unhandled_error", error, { requestId: req.requestId, generationId: generationRequestId });
      try {
        const admin = getFirebaseAdmin();
        const db = admin.firestore();
        // PLAN-IMPL-05 §23 — crash inesperado depois de reservar (ex.: Storage fora do ar no file.save):
        // ainda assim devolve a vaga, nunca deixa uma cota permanentemente presa por um erro imprevisto.
        if (reservedMonthKey) await releasePreparationSlot(db, uid, productId, reservedMonthKey);
        await finalizeGeneration(db, uid, generationRequestId, { status: "failed", errorCode: "UNHANDLED_ERROR" });
      } catch {
        // se nem isso funcionar, o próximo retry manual do usuário simplesmente tenta de novo — nunca
        // trava o usuário numa reserva "processing" morta para sempre além do que a UI já trata.
      }
      return sendError(res, 500, "PHOTOROOM_CUTOUT_FAILED");
    }
  });

  // §6.6: stale detection explícita, consumível pelo client antes de mostrar um cutout antigo como
  // se ainda fosse válido — nunca reutilizado silenciosamente quando a foto original mudou.
  app.get("/api/products/:productId/photoroom-cutout/staleness", requireAuth, async (req: Request, res: Response) => {
    const uid = (req as Request & { firebaseUid?: string }).firebaseUid || "";
    const productId = String(req.params.productId || "");
    if (!uid || !PRODUCT_ID_PATTERN.test(productId)) return sendError(res, 400, "INVALID_PRODUCT_ID");
    try {
      const admin = getFirebaseAdmin();
      const productSnapshot = await admin.firestore().collection("users").doc(uid).collection("products").doc(productId).get();
      if (!productSnapshot.exists) return sendError(res, 404, "PRODUCT_NOT_FOUND");
      const truth = buildProductTruthFromProduct({ ...(productSnapshot.data() || {}), id: productId } as ProductRecordForTruth);
      const approvedCutout = truth.approvedCutout;
      if (!approvedCutout) return res.status(200).json({ hasCutout: false, stale: false });
      const source = resolveOwnedProductImageSource(uid, productId, { ...truth, approvedCutout: undefined });
      const currentSourceAssetId = source?.assetId || "";
      const stale = !currentSourceAssetId || isApprovedProductCutoutStale(approvedCutout, currentSourceAssetId);
      return res.status(200).json({ hasCutout: true, stale });
    } catch (error) {
      logError("product_cutout_photoroom.staleness_check_failed", error, { requestId: req.requestId });
      return sendError(res, 500, "STALENESS_CHECK_FAILED");
    }
  });
}
