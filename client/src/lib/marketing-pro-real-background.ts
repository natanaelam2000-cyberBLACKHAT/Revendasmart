/**
 * PRO-08 — cliente do endpoint real de geração de background (`POST/GET /api/marketing/pro/generate`,
 * já existente desde PRO-06A). Este módulo só fala com a rede — nunca decide entitlement (o backend já
 * bloqueia Free antes de qualquer chamada ao provider) nem compõe produto+fundo (isso é
 * `marketing-pro-real-background-composer.ts`, chamado só DEPOIS que este módulo devolve um background
 * pronto).
 */
import { apiRequest, ApiError } from "@/lib/api-client";
import type { MarketingProFormat, MarketingProStyle } from "@/lib/marketing-pro";
import type { MarketingProBackgroundAsset } from "@shared/approved-marketing-pro-background";
import type { CreativeFamily } from "@shared/marketing-pro-creative-intelligence";

/**
 * Espelha `MarketingProGenerationErrorCode` (server/marketing-pro.ts) — não importado de lá porque é
 * server-only (Admin SDK). `string` de fallback cobre qualquer código novo do backend sem quebrar o
 * client; os literais só existem para autocomplete/documentação dos casos conhecidos.
 */
export type MarketingProGenerationErrorCode =
  | "GENERATION_FAILED" | "GENERATION_TIMEOUT" | "PRODUCT_NOT_FOUND" | "BUDGET_EXCEEDED"
  | "INVALID_MIME" | "INVALID_DIMENSIONS" | "INVALID_ASPECT_RATIO" | "EMPTY_OUTPUT"
  | "OUTPUT_TOO_LARGE" | "INVALID_PROVIDER_RESPONSE"
  | (string & {});

export interface MarketingProGenerationDto {
  readonly generationId: string;
  readonly status: "accepted" | "processing" | "ready" | "failed";
  readonly style: MarketingProStyle;
  readonly format: MarketingProFormat;
  readonly productId: string;
  readonly creativeConceptId?: string;
  readonly creativeFamily?: CreativeFamily;
  readonly attemptCount: number;
  readonly errorCode?: MarketingProGenerationErrorCode;
  readonly background?: MarketingProBackgroundAsset;
}

export interface MarketingProCapabilityDto {
  readonly realBackgroundAvailable: boolean;
  readonly semanticGateReady: boolean;
  readonly provider: string;
  readonly model: string | null;
}

export async function getMarketingProCapability(): Promise<MarketingProCapabilityDto> {
  return apiRequest<MarketingProCapabilityDto>("/api/marketing/pro/capability", { auth: true });
}

/**
 * generationRequestId novo por CLIQUE explícito do usuário — nunca reaproveitado entre chamadas
 * distintas (§5 da tarefa: "nova tentativa explícita → novo requestId"). `crypto.randomUUID()` já
 * cumpre o padrão do backend (`/^[a-zA-Z0-9_-]{6,80}$/`, MARKETING_PRO_GENERATION_ID_PATTERN).
 */
export function createMarketingProGenerationRequestId(): string {
  return crypto.randomUUID();
}

export async function requestMarketingProBackgroundGeneration(input: {
  readonly generationRequestId: string;
  readonly productId: string;
  readonly style?: MarketingProStyle;
  readonly format: MarketingProFormat;
  readonly creativeConceptId?: string;
  readonly creativeFamily?: CreativeFamily;
}): Promise<MarketingProGenerationDto> {
  return apiRequest<MarketingProGenerationDto>("/api/marketing/pro/generate", {
    method: "POST",
    auth: true,
    body: {
      generationRequestId: input.generationRequestId,
      productId: input.productId,
      ...(input.style ? { style: input.style } : {}),
      format: input.format,
      ...(input.creativeConceptId ? { creativeConceptId: input.creativeConceptId } : {}),
      ...(input.creativeFamily ? { creativeFamily: input.creativeFamily } : {}),
    },
  });
}

export async function getMarketingProGeneration(generationId: string): Promise<MarketingProGenerationDto> {
  return apiRequest<MarketingProGenerationDto>(`/api/marketing/pro/generations/${encodeURIComponent(generationId)}`, { auth: true });
}

const POLL_INTERVAL_MS = 1500;
const POLL_MAX_ATTEMPTS = 20; // ~30s, bem abaixo do teto de 25s do próprio provider + margem de rede.

/**
 * Faz o POST inicial (aceita síncrono ou já resolve `ready`/`failed`, já que a rota atual roda o
 * provider dentro da própria request) e, se ainda não terminou, faz POLLING do MESMO generationId —
 * nunca reenvia o POST, nunca gera um requestId novo sozinho. Isso NÃO é retry automático de uma
 * geração que falhou: é só esperar uma que ainda está em voo.
 */
export async function generateMarketingProBackgroundAndWait(input: {
  readonly generationRequestId: string;
  readonly productId: string;
  readonly style?: MarketingProStyle;
  readonly format: MarketingProFormat;
  readonly creativeConceptId?: string;
  readonly creativeFamily?: CreativeFamily;
  readonly signal?: AbortSignal;
}): Promise<MarketingProGenerationDto> {
  let dto = await requestMarketingProBackgroundGeneration(input);
  let attempts = 0;
  while (dto.status !== "ready" && dto.status !== "failed" && attempts < POLL_MAX_ATTEMPTS) {
    if (input.signal?.aborted) throw new ApiError({ code: "REQUEST_ABORTED", message: "Cancelado." });
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    dto = await getMarketingProGeneration(dto.generationId);
    attempts += 1;
  }
  return dto;
}
