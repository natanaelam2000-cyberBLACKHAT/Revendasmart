/**
 * RELEASE V1 §7 — cliente do endpoint real de melhoria de foto. Substitui o `enhancePhoto()` anterior
 * (client/src/pages/add-product.tsx), que era um `setTimeout` sem processar nada.
 */
import { apiRequest } from "@/lib/api-client";

export interface ProductPhotoQualityMetrics {
  readonly width: number;
  readonly height: number;
  readonly sharpness: number;
  readonly exposureMean: number;
  readonly contrast: number;
  readonly clipping: number;
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

export type EnhancePhotoResponse =
  | { readonly improved: true; readonly result: EnhancedProductPhoto }
  | { readonly improved: false; readonly reason: string; readonly metricsBefore: ProductPhotoQualityMetrics; readonly metricsAfter: ProductPhotoQualityMetrics };

export function createPhotoEnhancementGenerationRequestId(): string {
  return crypto.randomUUID();
}

export async function requestPhotoEnhancement(productId: string, generationRequestId: string): Promise<EnhancePhotoResponse> {
  return apiRequest<EnhancePhotoResponse>(`/api/products/${encodeURIComponent(productId)}/enhance-photo`, {
    method: "POST",
    auth: true,
    body: { generationRequestId },
  });
}
