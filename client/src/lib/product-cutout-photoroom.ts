/**
 * RELEASE V1 §6 — cliente do endpoint real de recorte PhotoRoom (`POST /api/products/:productId/
 * photoroom-cutout`). Só fala com a rede — nunca decide entitlement (o backend já bloqueia Free/sem
 * Premium antes de chamar o provider) nem compõe nada localmente (a composição roda no servidor, que é
 * o único lugar com a API key). Devolve o MESMO `ApprovedProductCutout` já usado pelo recorte
 * local-heuristic — nenhum schema novo.
 */
import { apiRequest } from "@/lib/api-client";
import type { ApprovedProductCutout } from "@shared/approved-product-cutout";

export function createPhotoroomCutoutGenerationRequestId(): string {
  return crypto.randomUUID();
}

export async function requestPhotoroomCutout(productId: string, generationRequestId: string): Promise<ApprovedProductCutout> {
  return apiRequest<ApprovedProductCutout>(`/api/products/${encodeURIComponent(productId)}/photoroom-cutout`, {
    method: "POST",
    auth: true,
    body: { generationRequestId },
  });
}

export interface PhotoroomCutoutStaleness {
  readonly hasCutout: boolean;
  readonly stale: boolean;
}

export async function getPhotoroomCutoutStaleness(productId: string): Promise<PhotoroomCutoutStaleness> {
  return apiRequest<PhotoroomCutoutStaleness>(`/api/products/${encodeURIComponent(productId)}/photoroom-cutout/staleness`, { auth: true });
}
