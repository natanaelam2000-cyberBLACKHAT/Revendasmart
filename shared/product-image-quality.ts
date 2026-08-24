/**
 * PRO-07E.1 — Product Image Quality Assessment objetivo, local e determinístico.
 *
 * Este módulo não decodifica imagens, não chama IA, não faz busca externa e não julga blur/iluminação
 * (isso fica para uma fase futura — ver PRO-07E.2). Ele só classifica métricas JÁ extraídas
 * (width/height/byteSize/mimeType/aspectRatio) contra uma policy explícita, com critérios comprováveis
 * matematicamente. A extração real (decode via `Image`/canvas) é responsabilidade do client, em
 * `client/src/lib/product-image-metadata.ts` — este módulo nunca toca DOM/rede/disco.
 *
 * `assessProductImageQuality` NÃO tem valores-padrão de policy embutidos: quem chama precisa fornecer
 * a policy explicitamente. Isso mantém o motor de classificação estável mesmo quando os números de
 * negócio (`MARKETING_PRODUCT_IMAGE_QUALITY_POLICY_V0`, abaixo) forem recalibrados — recalibrar é
 * trocar a constante, nunca editar esta função.
 */

export type ProductImageQualityStatus = "good" | "acceptable" | "poor" | "unusable";

/**
 * Todo motivo que pode aparecer em `reasons`. Alguns só são produzidos pela camada de extração do
 * client (`empty-file`/`decode-failed` — ela sabe se o arquivo nem chegou a decodificar), os demais são
 * produzidos por este módulo a partir de métricas já numéricas.
 */
export type ProductImageQualityReasonId =
  | "empty-file"
  | "decode-failed"
  | "invalid-width"
  | "invalid-height"
  | "invalid-mime"
  | "below-absolute-minimum"
  | "below-recommended-minimum"
  | "aspect-ratio-out-of-range"
  | "byte-size-exceeds-maximum"
  | "below-preferred-minimum";

/**
 * Métricas objetivas de UM asset (original OU derivado — este tipo não distingue; quem distingue é o
 * nome da variável/campo no chamador, ver `ProductImageQualityAssessment` abaixo). `width`/`height`
 * podem ser `NaN` quando a extração não conseguiu decodificar a imagem — nunca 0 como sentinela
 * silenciosa, porque 0 é um valor numérico válido para os testes de `<= 0` já cobrirem.
 */
export interface ProductImageQualityMetrics {
  readonly width: number;
  readonly height: number;
  readonly megapixels: number;
  readonly byteSize: number;
  readonly aspectRatio: number;
  readonly mimeType: string;
}

/**
 * Piso/recomendado/preferencial: três degraus progressivos, não dois. `absolute` é o corte de
 * UNUSABLE (abaixo disso a imagem não é útil de jeito nenhum); `recommended` é o corte de POOR;
 * `preferred` é o corte entre ACCEPTABLE e GOOD. Nenhum destes números é definitivo — ver o comentário
 * de `MARKETING_PRODUCT_IMAGE_QUALITY_POLICY_V0`.
 */
export interface ProductImageQualityPolicy {
  readonly allowedMimeTypes: readonly string[];
  readonly absoluteMinWidth: number;
  readonly absoluteMinHeight: number;
  readonly recommendedMinWidth: number;
  readonly recommendedMinHeight: number;
  readonly preferredMinWidth: number;
  readonly preferredMinHeight: number;
  readonly minAspectRatio: number;
  readonly maxAspectRatio: number;
  /** Opcional — só aplicado se a policy definir um teto. */
  readonly maxByteSize?: number;
}

export interface ProductImageQualityAssessment {
  readonly status: ProductImageQualityStatus;
  readonly reasons: readonly ProductImageQualityReasonId[];
  readonly metrics: ProductImageQualityMetrics;
  readonly assessorVersion: string;
}

export const PRODUCT_IMAGE_QUALITY_ASSESSOR_VERSION = "product-image-quality-v0" as const;

/**
 * Policy PROVISÓRIA — valores sujeitos à calibração com fotos reais do catálogo (PRO-07E.2). Não é uma
 * regra comercial definitiva, é só o que permite o motor ter algo determinístico para rodar/testar
 * enquanto os números de negócio não são decididos. `allowedMimeTypes` reaproveita o mesmo allowlist já
 * usado em `storage.rules` (`isValidImageUpload()`) e em `server/marketing-pro-quality.ts` — esse valor
 * específico não é provisório, é o padrão já estabelecido no projeto para "MIME de imagem razoável".
 */
export const MARKETING_PRODUCT_IMAGE_QUALITY_POLICY_V0: ProductImageQualityPolicy = {
  allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"],
  absoluteMinWidth: 200,
  absoluteMinHeight: 200,
  recommendedMinWidth: 600,
  recommendedMinHeight: 600,
  preferredMinWidth: 900,
  preferredMinHeight: 900,
  minAspectRatio: 0.4,
  maxAspectRatio: 2.5,
};

function normalizeMimeType(value: string): string {
  return String(value || "").trim().toLowerCase().split(";")[0]?.trim() ?? "";
}

/**
 * Único ponto de classificação. Determinístico: mesma `metrics`+`policy` sempre produz o mesmo
 * resultado (nenhum `Date.now()`/aleatoriedade/estado externo). Critérios só matematicamente
 * comprováveis — nenhum julgamento visual (blur/iluminação/oclusão ficam para fases futuras).
 */
export function assessProductImageQuality(
  metrics: ProductImageQualityMetrics,
  policy: ProductImageQualityPolicy,
): ProductImageQualityAssessment {
  const unusableReasons: ProductImageQualityReasonId[] = [];

  if (!Number.isFinite(metrics.byteSize) || metrics.byteSize <= 0) unusableReasons.push("empty-file");
  const widthValid = Number.isFinite(metrics.width) && metrics.width > 0;
  const heightValid = Number.isFinite(metrics.height) && metrics.height > 0;
  if (!widthValid) unusableReasons.push("invalid-width");
  if (!heightValid) unusableReasons.push("invalid-height");

  const normalizedMime = normalizeMimeType(metrics.mimeType);
  const allowedMimeTypes = policy.allowedMimeTypes.map(normalizeMimeType);
  if (!allowedMimeTypes.includes(normalizedMime)) unusableReasons.push("invalid-mime");

  if (unusableReasons.length > 0) {
    return { status: "unusable", reasons: unusableReasons, metrics, assessorVersion: PRODUCT_IMAGE_QUALITY_ASSESSOR_VERSION };
  }

  // A partir daqui: width/height finitos e > 0, mime permitido — comparações numéricas são seguras.
  if (metrics.width < policy.absoluteMinWidth || metrics.height < policy.absoluteMinHeight) {
    return {
      status: "unusable",
      reasons: ["below-absolute-minimum"],
      metrics,
      assessorVersion: PRODUCT_IMAGE_QUALITY_ASSESSOR_VERSION,
    };
  }

  const poorReasons: ProductImageQualityReasonId[] = [];
  if (metrics.width < policy.recommendedMinWidth || metrics.height < policy.recommendedMinHeight) {
    poorReasons.push("below-recommended-minimum");
  }
  if (metrics.aspectRatio < policy.minAspectRatio || metrics.aspectRatio > policy.maxAspectRatio) {
    poorReasons.push("aspect-ratio-out-of-range");
  }
  if (policy.maxByteSize !== undefined && metrics.byteSize > policy.maxByteSize) {
    poorReasons.push("byte-size-exceeds-maximum");
  }
  if (poorReasons.length > 0) {
    return { status: "poor", reasons: poorReasons, metrics, assessorVersion: PRODUCT_IMAGE_QUALITY_ASSESSOR_VERSION };
  }

  if (metrics.width < policy.preferredMinWidth || metrics.height < policy.preferredMinHeight) {
    return {
      status: "acceptable",
      reasons: ["below-preferred-minimum"],
      metrics,
      assessorVersion: PRODUCT_IMAGE_QUALITY_ASSESSOR_VERSION,
    };
  }

  return { status: "good", reasons: [], metrics, assessorVersion: PRODUCT_IMAGE_QUALITY_ASSESSOR_VERSION };
}
