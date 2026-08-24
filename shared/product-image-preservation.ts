/**
 * PRO-07B — fundação geométrica, local e determinística para preservar a imagem real do produto.
 *
 * Este módulo não decodifica imagens, não remove fundo, não chama providers e não compõe o anúncio.
 * Ele prova somente que um asset identificado foi transformado com contain, escala uniforme e sem crop.
 */

import type { ProductImageCoordinateSpaceVersion } from "./product-image-coordinate-space";

/**
 * Margem relativa usada apenas para absorver arredondamento IEEE-754 nas operações desta unidade.
 * Number.EPSILON * 32 equivale a ~7.1e-15 do maior operando; não é tolerância visual nem autoriza
 * alteração perceptível de proporção.
 */
export const PRODUCT_PRESERVATION_FLOAT_TOLERANCE = Number.EPSILON * 32;

export interface ProductImageDimensions {
  readonly width: number;
  readonly height: number;
}

export interface ProductAssetOriginal extends ProductImageDimensions {
  readonly productId: string;
  /** Identidade imutável da versão do asset; não deve ser reutilizada para bytes diferentes. */
  readonly assetId: string;
  /** Referência opaca ao asset (por exemplo, storagePath ou URL). Nunca base64 grande. */
  readonly assetRef: string;
  readonly sourceUrl?: string;
  readonly mimeType?: string;
  /**
   * PRO-07F.2A: opcional para não quebrar snapshots/fixtures anteriores a este campo (ex.: Histórico
   * já persistido). Sempre populado quando o asset nasce do resolver real da Marketing atual — um
   * asset sem este campo é tratado como pré-migração, nunca como divergência.
   */
  readonly coordinateSpaceVersion?: ProductImageCoordinateSpaceVersion;
}

/** Snapshot serializável da identidade, sem bytes/safeSrc. Opcional apenas no documento histórico. */
export type ProductAssetSnapshot = ProductAssetOriginal;

export interface ProductImageMetadata extends ProductImageDimensions {
  readonly originalAspectRatio: number;
}

export interface ProductBoundingBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Não existem scaleX/scaleY, crop, rotação, skew, perspectiva, matriz ou filtros neste contrato.
 * Um único `scale` torna stretch impossível em código corretamente tipado.
 */
export interface ProductTransform {
  readonly kind: "uniform-contain";
  readonly sourceAssetId: string;
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  readonly targetWidth: number;
  readonly targetHeight: number;
  readonly scale: number;
  readonly translateX: number;
  readonly translateY: number;
  readonly bounds: ProductBoundingBox;
  readonly padding: number;
  readonly allowCrop: false;
}

export type ProductPreservationErrorCode =
  | "invalid-product-id"
  | "invalid-asset-id"
  | "asset-id-mismatch"
  | "invalid-asset-ref"
  | "inline-image-not-allowed"
  | "invalid-mime-type"
  | "invalid-source-width"
  | "invalid-source-height"
  | "invalid-original-aspect-ratio"
  | "invalid-target-width"
  | "invalid-target-height"
  | "invalid-scale"
  | "invalid-coordinate"
  | "invalid-bounds-width"
  | "invalid-bounds-height"
  | "invalid-padding"
  | "padding-exhausts-bounds"
  | "source-dimensions-mismatch"
  | "target-dimensions-mismatch"
  | "aspect-ratio-not-preserved"
  | "product-outside-bounds"
  | "contain-transform-mismatch"
  | "forbidden-transform-field"
  | "invalid-transform-kind"
  | "crop-not-allowed";

export interface ProductPreservationError {
  readonly code: ProductPreservationErrorCode;
  readonly field: string;
  readonly message: string;
}

export type ProductImageMetadataValidationResult =
  | { readonly accepted: true; readonly metadata: ProductImageMetadata; readonly errors: readonly [] }
  | { readonly accepted: false; readonly metadata: null; readonly errors: readonly ProductPreservationError[] };

export interface CalculateProductContainInput {
  readonly sourceAssetId: string;
  readonly source: ProductImageDimensions;
  readonly bounds: ProductBoundingBox;
  /** Padding uniforme, nas mesmas unidades da bounding box. */
  readonly padding?: number;
}

export type ProductContainResult =
  | { readonly accepted: true; readonly transform: ProductTransform; readonly errors: readonly [] }
  | { readonly accepted: false; readonly transform: null; readonly errors: readonly ProductPreservationError[] };

export interface ProductPreservationGateInput {
  readonly expectedProductId: string;
  readonly expectedAssetId: string;
  readonly asset: ProductAssetOriginal;
  readonly transform: ProductTransform;
}

export interface ProductPreservationGateResult {
  readonly accepted: boolean;
  readonly errors: readonly ProductPreservationError[];
}

const FORBIDDEN_TRANSFORM_FIELDS = [
  "scaleX",
  "scaleY",
  "crop",
  "cropX",
  "cropY",
  "cropWidth",
  "cropHeight",
  "rotation",
  "rotate",
  "skewX",
  "skewY",
  "perspective",
  "matrix",
  "flipX",
  "flipY",
  "filter",
  "colorAdjustment",
] as const;

function issue(code: ProductPreservationErrorCode, field: string, message: string): ProductPreservationError {
  return { code, field, message };
}

function isFinitePositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function nearlyEqual(first: number, second: number): boolean {
  const scale = Math.max(1, Math.abs(first), Math.abs(second));
  return Math.abs(first - second) <= PRODUCT_PRESERVATION_FLOAT_TOLERANCE * scale;
}

export function validateProductImageMetadata(dimensions: ProductImageDimensions): ProductImageMetadataValidationResult {
  const errors: ProductPreservationError[] = [];
  if (!isFinitePositive(dimensions?.width)) {
    errors.push(issue("invalid-source-width", "width", "width precisa ser um número finito maior que zero"));
  }
  if (!isFinitePositive(dimensions?.height)) {
    errors.push(issue("invalid-source-height", "height", "height precisa ser um número finito maior que zero"));
  }
  if (errors.length > 0) return { accepted: false, metadata: null, errors };

  const originalAspectRatio = dimensions.width / dimensions.height;
  if (!isFinitePositive(originalAspectRatio)) {
    return {
      accepted: false,
      metadata: null,
      errors: [issue("invalid-original-aspect-ratio", "originalAspectRatio", "aspect ratio original precisa ser finito e maior que zero")],
    };
  }
  return {
    accepted: true,
    metadata: { width: dimensions.width, height: dimensions.height, originalAspectRatio },
    errors: [],
  };
}

function validateBounds(bounds: ProductBoundingBox, padding: number): ProductPreservationError[] {
  const errors: ProductPreservationError[] = [];
  if (!isFiniteNumber(bounds?.x)) errors.push(issue("invalid-coordinate", "bounds.x", "bounds.x precisa ser finito"));
  if (!isFiniteNumber(bounds?.y)) errors.push(issue("invalid-coordinate", "bounds.y", "bounds.y precisa ser finito"));
  if (!isFinitePositive(bounds?.width)) errors.push(issue("invalid-bounds-width", "bounds.width", "bounds.width precisa ser finito e maior que zero"));
  if (!isFinitePositive(bounds?.height)) errors.push(issue("invalid-bounds-height", "bounds.height", "bounds.height precisa ser finito e maior que zero"));
  if (!isFiniteNumber(padding) || padding < 0) errors.push(issue("invalid-padding", "padding", "padding precisa ser finito e não negativo"));
  if (errors.length === 0 && (bounds.width - padding * 2 <= 0 || bounds.height - padding * 2 <= 0)) {
    errors.push(issue("padding-exhausts-bounds", "padding", "padding não pode consumir toda a bounding box"));
  }
  return errors;
}

export function calculateProductContainTransform(input: CalculateProductContainInput): ProductContainResult {
  const metadata = validateProductImageMetadata(input.source);
  const padding = input.padding ?? 0;
  const errors = [
    ...metadata.errors,
    ...validateBounds(input.bounds, padding),
  ];
  if (!String(input.sourceAssetId || "").trim()) {
    errors.push(issue("invalid-asset-id", "sourceAssetId", "sourceAssetId é obrigatório"));
  }
  if (errors.length > 0 || !metadata.accepted) return { accepted: false, transform: null, errors };

  const availableWidth = input.bounds.width - padding * 2;
  const availableHeight = input.bounds.height - padding * 2;
  const scale = Math.min(availableWidth / metadata.metadata.width, availableHeight / metadata.metadata.height);
  const targetWidth = metadata.metadata.width * scale;
  const targetHeight = metadata.metadata.height * scale;
  const translateX = input.bounds.x + (input.bounds.width - targetWidth) / 2;
  const translateY = input.bounds.y + (input.bounds.height - targetHeight) / 2;

  return {
    accepted: true,
    errors: [],
    transform: {
      kind: "uniform-contain",
      sourceAssetId: input.sourceAssetId.trim(),
      sourceWidth: metadata.metadata.width,
      sourceHeight: metadata.metadata.height,
      targetWidth,
      targetHeight,
      scale,
      translateX,
      translateY,
      bounds: { ...input.bounds },
      padding,
      allowCrop: false,
    },
  };
}

/**
 * Gate de falha fechada para rejeições normais. Objetos vindos de JSON continuam sendo inspecionados
 * em runtime: campos proibidos são recusados mesmo que alguém contorne o tipo TypeScript com cast.
 */
export function evaluateProductPreservationGate(input: ProductPreservationGateInput): ProductPreservationGateResult {
  const errors: ProductPreservationError[] = [];
  const asset = input.asset;
  const transform = input.transform;

  if (!String(input.expectedProductId || "").trim() || asset.productId !== input.expectedProductId) {
    errors.push(issue("invalid-product-id", "asset.productId", "asset.productId precisa corresponder ao produto esperado"));
  }
  if (!String(input.expectedAssetId || "").trim() || asset.assetId !== input.expectedAssetId) {
    errors.push(issue("asset-id-mismatch", "asset.assetId", "asset.assetId precisa corresponder ao asset esperado"));
  }
  if (!String(asset.assetId || "").trim()) errors.push(issue("invalid-asset-id", "asset.assetId", "assetId é obrigatório"));
  if (!String(asset.assetRef || "").trim()) errors.push(issue("invalid-asset-ref", "asset.assetRef", "assetRef é obrigatório"));
  if (/^data:image\//i.test(String(asset.assetRef || "").trim())) {
    errors.push(issue("inline-image-not-allowed", "asset.assetRef", "assetRef não pode armazenar uma imagem base64 inline"));
  }
  if (/^data:image\//i.test(String(asset.sourceUrl || "").trim())) {
    errors.push(issue("inline-image-not-allowed", "asset.sourceUrl", "sourceUrl não pode armazenar uma imagem base64 inline"));
  }
  if (asset.mimeType !== undefined && !/^image\/[a-z0-9.+-]+$/i.test(asset.mimeType.trim())) {
    errors.push(issue("invalid-mime-type", "asset.mimeType", "mimeType informado precisa ser um MIME de imagem válido"));
  }

  const metadata = validateProductImageMetadata(asset);
  errors.push(...metadata.errors);

  const rawTransform = transform as unknown as Record<string, unknown>;
  for (const field of FORBIDDEN_TRANSFORM_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(rawTransform, field)) {
      errors.push(issue("forbidden-transform-field", `transform.${field}`, `${field} não é permitido no contrato de transformação`));
    }
  }
  if (transform.kind !== "uniform-contain") {
    errors.push(issue("invalid-transform-kind", "transform.kind", "somente uniform-contain é permitido"));
  }
  if (transform.allowCrop !== false) {
    errors.push(issue("crop-not-allowed", "transform.allowCrop", "crop nunca é permitido para a camada do produto"));
  }
  if (transform.sourceAssetId !== asset.assetId) {
    errors.push(issue("asset-id-mismatch", "transform.sourceAssetId", "a transformação precisa estar vinculada ao asset avaliado"));
  }

  if (!isFinitePositive(transform.sourceWidth)) errors.push(issue("invalid-source-width", "transform.sourceWidth", "sourceWidth precisa ser finito e maior que zero"));
  if (!isFinitePositive(transform.sourceHeight)) errors.push(issue("invalid-source-height", "transform.sourceHeight", "sourceHeight precisa ser finito e maior que zero"));
  if (!isFinitePositive(transform.targetWidth)) errors.push(issue("invalid-target-width", "transform.targetWidth", "targetWidth precisa ser finito e maior que zero"));
  if (!isFinitePositive(transform.targetHeight)) errors.push(issue("invalid-target-height", "transform.targetHeight", "targetHeight precisa ser finito e maior que zero"));
  if (!isFinitePositive(transform.scale)) errors.push(issue("invalid-scale", "transform.scale", "scale precisa ser finito e maior que zero"));
  if (!isFiniteNumber(transform.translateX)) errors.push(issue("invalid-coordinate", "transform.translateX", "translateX precisa ser finito"));
  if (!isFiniteNumber(transform.translateY)) errors.push(issue("invalid-coordinate", "transform.translateY", "translateY precisa ser finito"));
  errors.push(...validateBounds(transform.bounds, transform.padding));

  const numericTransformIsValid = [
    transform.sourceWidth,
    transform.sourceHeight,
    transform.targetWidth,
    transform.targetHeight,
    transform.scale,
    transform.translateX,
    transform.translateY,
    transform.bounds?.x,
    transform.bounds?.y,
    transform.bounds?.width,
    transform.bounds?.height,
    transform.padding,
  ].every(isFiniteNumber);

  if (metadata.accepted && numericTransformIsValid) {
    if (!nearlyEqual(transform.sourceWidth, metadata.metadata.width) || !nearlyEqual(transform.sourceHeight, metadata.metadata.height)) {
      errors.push(issue("source-dimensions-mismatch", "transform.sourceWidth", "dimensões de origem da transformação divergem do asset"));
    }

    const expectedTargetWidth = transform.sourceWidth * transform.scale;
    const expectedTargetHeight = transform.sourceHeight * transform.scale;
    if (!nearlyEqual(transform.targetWidth, expectedTargetWidth) || !nearlyEqual(transform.targetHeight, expectedTargetHeight)) {
      errors.push(issue("target-dimensions-mismatch", "transform.targetWidth", "dimensões finais precisam resultar da mesma escala uniforme"));
    }

    const sourceAspectRatio = transform.sourceWidth / transform.sourceHeight;
    const targetAspectRatio = transform.targetWidth / transform.targetHeight;
    if (!isFinitePositive(sourceAspectRatio) || !isFinitePositive(targetAspectRatio) || !nearlyEqual(sourceAspectRatio, targetAspectRatio)) {
      errors.push(issue("aspect-ratio-not-preserved", "transform.targetWidth", "aspect ratio final precisa ser igual ao original"));
    }

    const minX = transform.bounds.x + transform.padding;
    const minY = transform.bounds.y + transform.padding;
    const maxX = transform.bounds.x + transform.bounds.width - transform.padding;
    const maxY = transform.bounds.y + transform.bounds.height - transform.padding;
    const insideBounds = transform.translateX >= minX - PRODUCT_PRESERVATION_FLOAT_TOLERANCE
      && transform.translateY >= minY - PRODUCT_PRESERVATION_FLOAT_TOLERANCE
      && transform.translateX + transform.targetWidth <= maxX + PRODUCT_PRESERVATION_FLOAT_TOLERANCE
      && transform.translateY + transform.targetHeight <= maxY + PRODUCT_PRESERVATION_FLOAT_TOLERANCE;
    if (!insideBounds) {
      errors.push(issue("product-outside-bounds", "transform.bounds", "o produto inteiro precisa permanecer dentro da bounding box e do padding"));
    }

    const canonical = calculateProductContainTransform({
      sourceAssetId: transform.sourceAssetId,
      source: metadata.metadata,
      bounds: transform.bounds,
      padding: transform.padding,
    });
    if (canonical.accepted) {
      const expected = canonical.transform;
      const isCanonicalContain = nearlyEqual(transform.scale, expected.scale)
        && nearlyEqual(transform.targetWidth, expected.targetWidth)
        && nearlyEqual(transform.targetHeight, expected.targetHeight)
        && nearlyEqual(transform.translateX, expected.translateX)
        && nearlyEqual(transform.translateY, expected.translateY);
      if (!isCanonicalContain) {
        errors.push(issue("contain-transform-mismatch", "transform", "a transformação precisa ser o contain canônico, proporcional e centralizado"));
      }
    }
  }

  return { accepted: errors.length === 0, errors };
}
