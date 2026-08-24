/**
 * Quality Gate técnico — PRO-06B0.
 *
 * P0 do produto: uma chamada tecnicamente bem-sucedida ao provider (`status: "ready"`) NÃO significa
 * que a imagem está aprovada. Este módulo é o único responsável por decidir isso, e é deliberadamente
 * cego a quem gerou a imagem — recebe só `MarketingProProviderOutputMetadata` (o contrato de saída do
 * provider, não quem implementa a geração em si). Quem gera a imagem não importa nada deste módulo além
 * desse tipo de dado compartilhado — trocar de fornecedor de geração de imagem não muda uma linha aqui.
 *
 * Nesta sprint SÓ verificações técnicas e estruturais comprováveis (MIME, dimensão, proporção,
 * tamanho, forma da resposta). Nada de visão computacional, nada de "cenário parece bom" — isso é
 * trabalho de uma fase futura (AI-4 do roadmap), não desta.
 */

import type { MarketingProFormat } from "../shared/marketing-pro-contract";
import { MARKETING_PRO_FORMAT_DIMENSIONS } from "../shared/marketing-pro-contract";
import type { MarketingProProviderOutputMetadata } from "./marketing-pro-provider";

export type MarketingProQualityRejectionCode =
  | "INVALID_MIME"
  | "INVALID_DIMENSIONS"
  | "INVALID_ASPECT_RATIO"
  | "EMPTY_OUTPUT"
  | "OUTPUT_TOO_LARGE"
  | "INVALID_PROVIDER_RESPONSE";

export type MarketingProQualityCheckId = "responseShape" | "mime" | "dimensions" | "aspectRatio" | "byteSize";

export interface MarketingProQualityCheck {
  readonly id: MarketingProQualityCheckId;
  readonly passed: boolean;
}

export interface MarketingProQualityResult {
  readonly accepted: boolean;
  readonly checks: readonly MarketingProQualityCheck[];
  readonly rejectionCode?: MarketingProQualityRejectionCode;
}

/**
 * MIME allowlist e teto de bytes reaproveitam exatamente o que `storage.rules` já define para upload
 * de imagem de produto (`isValidImageUpload()`: jpeg/png/webp, <5MB) — não é um número novo inventado
 * para esta sprint, é o mesmo limite que o projeto já trata como "imagem razoável".
 */
export const MARKETING_PRO_QUALITY_LIMITS = {
  allowedMimeTypes: ["image/png", "image/jpeg", "image/webp"] as readonly string[],
  maxOutputBytes: 5 * 1024 * 1024,
  /**
   * Tolerância RELATIVA (não absoluta) — PRO-06B0.1 §19. A versão anterior (0.02 absoluto na razão)
   * dava rigor relativo diferente por formato: ~±2,5% no portrait (0.8), ~±2% no square (1.0), ~±3,5%
   * no story (0.5625), porque a mesma diferença absoluta pesa mais numa razão menor. Relativa mantém o
   * mesmo rigor percentual (~2%) para qualquer formato futuro, sem precisar recalibrar por formato.
   */
  aspectRatioTolerance: 0.02,
} as const;

/**
 * Forma bem-formada: MIME é string, e width/height/byteSize são INTEIROS finitos — PRO-06B0.1 §17/§18.
 * `Number.isInteger` já implica finito (`Number.isInteger(NaN|Infinity) === false`), então esta única
 * checagem cobre "não é número", "é NaN", "é Infinity" E "não é inteiro" (ex.: `1080.5`, `100.5` byte)
 * de uma vez. Zero/negativo passam aqui (são inteiros válidos) e são pegos depois, como
 * INVALID_DIMENSIONS/EMPTY_OUTPUT — a distinção é deliberada: "tipo de dado errado" vira
 * INVALID_PROVIDER_RESPONSE, "tipo certo mas valor fora da regra de negócio" vira o código específico.
 */
function hasValidResponseShape(output: MarketingProProviderOutputMetadata): boolean {
  return (
    typeof output === "object" && output !== null
    && typeof output.mimeType === "string"
    && Number.isInteger(output.width)
    && Number.isInteger(output.height)
    && Number.isInteger(output.byteSize)
  );
}

/** Trim + lowercase + descarta parâmetros MIME (`"image/png; charset=binary"` → `"image/png"`) — §16. */
function normalizeMimeType(value: string): string {
  return value.trim().toLowerCase().split(";")[0]?.trim() ?? "";
}

/**
 * Único ponto de decisão entre "o provider respondeu" e "a geração pode virar `ready`". Avalia TODAS
 * as checagens (para diagnóstico completo em `checks`), mas reporta um único `rejectionCode` — a
 * primeira falha, na ordem abaixo, é a que vai para o documento persistido.
 */
export function evaluateMarketingProOutputQuality(
  output: MarketingProProviderOutputMetadata,
  format: MarketingProFormat,
): MarketingProQualityResult {
  const responseShapeOk = hasValidResponseShape(output);
  if (!responseShapeOk) {
    return {
      accepted: false,
      checks: [{ id: "responseShape", passed: false }],
      rejectionCode: "INVALID_PROVIDER_RESPONSE",
    };
  }

  const dimensions = MARKETING_PRO_FORMAT_DIMENSIONS[format];
  const mimeOk = MARKETING_PRO_QUALITY_LIMITS.allowedMimeTypes.includes(normalizeMimeType(output.mimeType));
  const dimensionsOk = output.width > 0 && output.height > 0;
  const aspectRatio = dimensionsOk ? output.width / output.height : 0;
  const aspectRatioRelativeDiff = dimensionsOk ? Math.abs(aspectRatio - dimensions.aspectRatio) / dimensions.aspectRatio : Infinity;
  const aspectRatioOk = dimensionsOk && aspectRatioRelativeDiff <= MARKETING_PRO_QUALITY_LIMITS.aspectRatioTolerance;
  const notEmpty = output.byteSize > 0;
  const notTooLarge = output.byteSize <= MARKETING_PRO_QUALITY_LIMITS.maxOutputBytes;

  const checks: MarketingProQualityCheck[] = [
    { id: "responseShape", passed: true },
    { id: "mime", passed: mimeOk },
    { id: "dimensions", passed: dimensionsOk },
    { id: "aspectRatio", passed: aspectRatioOk },
    { id: "byteSize", passed: notEmpty && notTooLarge },
  ];

  let rejectionCode: MarketingProQualityRejectionCode | undefined;
  if (!mimeOk) rejectionCode = "INVALID_MIME";
  else if (!dimensionsOk) rejectionCode = "INVALID_DIMENSIONS";
  else if (!aspectRatioOk) rejectionCode = "INVALID_ASPECT_RATIO";
  else if (!notEmpty) rejectionCode = "EMPTY_OUTPUT";
  else if (!notTooLarge) rejectionCode = "OUTPUT_TOO_LARGE";

  return { accepted: rejectionCode === undefined, checks, rejectionCode };
}
