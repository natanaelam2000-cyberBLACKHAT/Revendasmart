/**
 * PRO-08 — grava o asset de background gerado pelo provider real no Storage e monta o metadado
 * persistível (`shared/approved-marketing-pro-background.ts`). Só chamado depois que
 * `resolveMarketingProGenerationFinalState` já decidiu `status: "ready"` (quality gate técnico
 * aprovado) — nunca persiste um resultado rejeitado.
 *
 * Reaproveita `validateImageUploadBytes` (`shared/image-validation.ts`) para confirmar magic bytes reais
 * antes de gravar — o mesmo padrão que `server/uploads.ts` já usa para upload vindo do client, aplicado
 * aqui a bytes vindos do provider (fonte externa, não confiável por padrão, mesmo raciocínio).
 */
import { getFirebaseAdmin } from "./firebase-admin-init";
import { logError, logInfo } from "./logger";
import { validateImageUploadBytes, DEFAULT_IMAGE_UPLOAD_LIMITS } from "../shared/image-validation";
import {
  buildMarketingProBackgroundStoragePath,
  validateMarketingProBackgroundAssetShape,
  type MarketingProBackgroundAsset,
} from "../shared/approved-marketing-pro-background";
import type { MarketingProProviderGeneratedAsset } from "./marketing-pro-provider";

export interface PersistMarketingProBackgroundInput {
  readonly uid: string;
  readonly generationId: string;
  readonly asset: MarketingProProviderGeneratedAsset;
  readonly provider: string;
  readonly model: string;
  readonly style: string;
  readonly format: string;
  readonly sourceProductId: string;
  readonly sourceAssetId?: string;
  readonly costReservationUsd: number;
}

export type PersistMarketingProBackgroundResult =
  | { readonly ok: true; readonly background: MarketingProBackgroundAsset }
  | { readonly ok: false; readonly reason: "invalid-bytes" | "storage-write-failed" | "invalid-shape" };

function extensionFor(mimeType: "image/jpeg" | "image/png"): "jpg" | "png" {
  return mimeType === "image/png" ? "png" : "jpg";
}

/** URL pública no mesmo formato que `getDownloadURL()`/`server/uploads.ts` já produzem. */
function buildPublicDownloadUrl(bucketName: string, storagePath: string): string {
  return `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(storagePath)}?alt=media`;
}

export async function persistMarketingProBackgroundAsset(
  input: PersistMarketingProBackgroundInput,
): Promise<PersistMarketingProBackgroundResult> {
  const validation = validateImageUploadBytes(input.asset.bytes, input.asset.mimeType, DEFAULT_IMAGE_UPLOAD_LIMITS);
  if (!validation.accepted) {
    logError("marketing_pro.background_bytes_rejected", validation.reason, { generationId: input.generationId });
    return { ok: false, reason: "invalid-bytes" };
  }
  if (validation.format !== "image/jpeg" && validation.format !== "image/png") {
    return { ok: false, reason: "invalid-bytes" };
  }

  const admin = getFirebaseAdmin();
  const bucketName = process.env.FIREBASE_STORAGE_BUCKET?.trim();
  const bucket = admin.storage().bucket(bucketName || undefined);
  const storagePath = buildMarketingProBackgroundStoragePath(input.uid, input.generationId, extensionFor(validation.format));

  try {
    await bucket.file(storagePath).save(input.asset.bytes, {
      contentType: validation.format,
      metadata: { cacheControl: "public, max-age=31536000, immutable" },
      resumable: false,
    });
  } catch (error) {
    logError("marketing_pro.background_storage_write_failed", error, { generationId: input.generationId });
    return { ok: false, reason: "storage-write-failed" };
  }

  const background: MarketingProBackgroundAsset = {
    operationId: input.generationId,
    generationRequestId: input.generationId,
    provider: input.provider,
    model: input.model,
    style: input.style,
    format: input.format,
    createdAt: new Date().toISOString(),
    sourceProductId: input.sourceProductId,
    ...(input.sourceAssetId ? { sourceAssetId: input.sourceAssetId } : {}),
    backgroundAssetPath: storagePath,
    backgroundDownloadUrl: buildPublicDownloadUrl(bucket.name, storagePath),
    width: validation.width,
    height: validation.height,
    mimeType: validation.format,
    costReservationUsd: input.costReservationUsd,
  };

  const shapeCheck = validateMarketingProBackgroundAssetShape(background);
  if (!shapeCheck.accepted) {
    logError("marketing_pro.background_shape_invalid", shapeCheck.errors.map((e) => e.code).join(","), { generationId: input.generationId });
    return { ok: false, reason: "invalid-shape" };
  }

  logInfo("marketing_pro.background_persisted", { generationId: input.generationId, storagePath, width: validation.width, height: validation.height });
  return { ok: true, background };
}
