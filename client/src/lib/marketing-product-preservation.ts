import { ART_LAYOUT, getArtPhotoInnerBox, toArtPx } from "@/lib/marketing-art-layout";
import type { ResolvedMarketingImage } from "@/lib/marketing-image";
import {
  calculateProductContainTransform,
  evaluateProductPreservationGate,
  type ProductAssetOriginal,
  type ProductAssetSnapshot,
  type ProductPreservationError,
  type ProductTransform,
} from "../../../shared/product-image-preservation";
import {
  PRODUCT_IMAGE_COORDINATE_SPACE_VERSION,
  assertMatchingCoordinateSpace,
} from "../../../shared/product-image-coordinate-space";

export const MARKETING_PRODUCT_PRESERVATION_ERROR_MESSAGE =
  "A foto do produto não passou pela validação de preservação. Nenhuma arte foi gerada.";
export const MARKETING_HISTORY_ASSET_ERROR_MESSAGE =
  "A imagem original usada neste anúncio não está mais disponível. Selecione novamente o produto ou crie um novo anúncio.";

export class MarketingProductPreservationError extends Error {
  readonly code = "marketing-product-preservation-rejected";
  readonly errors: readonly ProductPreservationError[];

  constructor(errors: readonly ProductPreservationError[] = []) {
    super(MARKETING_PRODUCT_PRESERVATION_ERROR_MESSAGE);
    this.name = "MarketingProductPreservationError";
    this.errors = errors;
  }
}

export class MarketingHistoryAssetError extends Error {
  readonly code = "marketing-history-asset-unavailable";

  constructor() {
    super(MARKETING_HISTORY_ASSET_ERROR_MESSAGE);
    this.name = "MarketingHistoryAssetError";
  }
}

export type PreparedMarketingProductImage = {
  readonly asset: ProductAssetOriginal;
  readonly transform: ProductTransform;
  readonly resolvedImage: ResolvedMarketingImage;
};

export type MarketingProductRenderGeometry = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

export type MarketingProductRenderIdentity = {
  readonly productId: string;
  readonly assetId: string;
  readonly sourceUrl: string;
};

function hashSessionAssetIdentity(value: string): string {
  // Dois acumuladores FNV-1a independentes formam 64 bits de identidade de sessão. Isto não é hash
  // persistente de conteúdo; serve para não guardar base64 e ainda distinguir resoluções concorrentes.
  let forward = 0x811c9dc5;
  let reverse = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    forward ^= value.charCodeAt(index);
    forward = Math.imul(forward, 0x01000193);
    reverse ^= value.charCodeAt(value.length - index - 1);
    reverse = Math.imul(reverse, 0x85ebca6b);
  }
  return `${(forward >>> 0).toString(16).padStart(8, "0")}${(reverse >>> 0).toString(16).padStart(8, "0")}`;
}

function resolvedImageIdentity(productId: string, resolvedImage: ResolvedMarketingImage): string {
  return [
    productId,
    resolvedImage.sourceUrl,
    // safeSrc participa somente do hash opaco: diferencia bytes/Blob resolvidos sem persistir base64 no contrato.
    resolvedImage.safeSrc,
    resolvedImage.width,
    resolvedImage.height,
    resolvedImage.mimeType,
    resolvedImage.candidateIndex,
    resolvedImage.transport,
  ].join("\u001f");
}

export function createProductAssetOriginal(
  productId: string,
  resolvedImage: ResolvedMarketingImage,
): ProductAssetOriginal {
  const normalizedProductId = String(productId || "").trim();
  const opaqueId = hashSessionAssetIdentity(resolvedImageIdentity(normalizedProductId, resolvedImage));
  const assetId = `marketing-session:${normalizedProductId}:${opaqueId}`;
  const sourceUrl = /^data:image\//i.test(resolvedImage.sourceUrl) ? undefined : resolvedImage.sourceUrl;
  return {
    productId: normalizedProductId,
    assetId,
    assetRef: `marketing-session-asset:${opaqueId}`,
    sourceUrl,
    width: resolvedImage.width,
    height: resolvedImage.height,
    mimeType: resolvedImage.mimeType,
    // PRO-07F.2A: passthrough direto do resolver — nunca recalculado, nunca uma segunda origem de verdade.
    ...(resolvedImage.coordinateSpaceVersion ? { coordinateSpaceVersion: resolvedImage.coordinateSpaceVersion } : {}),
  };
}

/**
 * PRO-07F.2A: Preview (via getMarketingProductPreviewGeometry) e Export (via
 * getMarketingProductRenderGeometry, chamada diretamente em marketing-card.ts) passam pelo MESMO ponto
 * de checagem abaixo, lendo o MESMO `prepared.asset.coordinateSpaceVersion` — por construção não podem
 * concordar em um valor e divergir no outro. Um asset sem este campo (histórico anterior à sua
 * existência, ou snapshot que ainda não o carrega) é tratado como pré-migração e passa sem garantia
 * formal; só uma versão DECLARADA e divergente é recusada, fail-closed.
 */
export function assertMarketingProductCoordinateSpace(prepared: PreparedMarketingProductImage): void {
  const version = prepared.asset.coordinateSpaceVersion;
  if (version === undefined) return;
  assertMatchingCoordinateSpace(
    { coordinateSpaceVersion: version },
    { coordinateSpaceVersion: PRODUCT_IMAGE_COORDINATE_SPACE_VERSION },
  );
}

export function getMarketingProductBounds() {
  const box = getArtPhotoInnerBox();
  return {
    x: toArtPx(box.x),
    y: toArtPx(box.y),
    width: toArtPx(box.width),
    height: toArtPx(box.height),
  };
}

export function prepareMarketingProductImage(input: {
  productId: string;
  resolvedImage: ResolvedMarketingImage;
}): PreparedMarketingProductImage {
  const asset = createProductAssetOriginal(input.productId, input.resolvedImage);
  const contain = calculateProductContainTransform({
    sourceAssetId: asset.assetId,
    source: asset,
    bounds: getMarketingProductBounds(),
    // getArtPhotoInnerBox() já desconta insetX/insetY da moldura; aplicar padding aqui duplicaria a margem.
    padding: 0,
  });
  if (!contain.accepted) throw new MarketingProductPreservationError(contain.errors);

  const preservation = evaluateProductPreservationGate({
    expectedProductId: input.productId,
    expectedAssetId: asset.assetId,
    asset,
    transform: contain.transform,
  });
  if (!preservation.accepted) throw new MarketingProductPreservationError(preservation.errors);

  return { asset, transform: contain.transform, resolvedImage: input.resolvedImage };
}

export function createProductAssetSnapshot(
  prepared: PreparedMarketingProductImage,
): ProductAssetSnapshot {
  const { productId, assetId, assetRef, sourceUrl, width, height, mimeType } = prepared.asset;
  return {
    productId,
    assetId,
    assetRef,
    width,
    height,
    ...(sourceUrl ? { sourceUrl } : {}),
    ...(mimeType ? { mimeType } : {}),
  };
}

export function assertProductAssetSnapshotMatches(input: {
  snapshot: ProductAssetSnapshot;
  prepared: PreparedMarketingProductImage;
}): PreparedMarketingProductImage {
  const current = createProductAssetSnapshot(input.prepared);
  const matches = input.snapshot.productId === current.productId
    && input.snapshot.assetId === current.assetId
    && input.snapshot.assetRef === current.assetRef
    && input.snapshot.width === current.width
    && input.snapshot.height === current.height
    && input.snapshot.sourceUrl === current.sourceUrl
    && input.snapshot.mimeType === current.mimeType;
  if (!matches) throw new MarketingHistoryAssetError();
  return input.prepared;
}

export function assertPreparedMarketingProductImage(input: {
  expectedProductId: string;
  prepared: PreparedMarketingProductImage;
  resolvedImage?: ResolvedMarketingImage | null;
}): PreparedMarketingProductImage {
  const { expectedProductId, prepared } = input;
  const expectedAsset = createProductAssetOriginal(expectedProductId, input.resolvedImage || prepared.resolvedImage);
  const sourceMatches = prepared.resolvedImage.sourceUrl === (input.resolvedImage || prepared.resolvedImage).sourceUrl
    && prepared.resolvedImage.safeSrc === (input.resolvedImage || prepared.resolvedImage).safeSrc
    && prepared.resolvedImage.width === (input.resolvedImage || prepared.resolvedImage).width
    && prepared.resolvedImage.height === (input.resolvedImage || prepared.resolvedImage).height
    && prepared.resolvedImage.mimeType === (input.resolvedImage || prepared.resolvedImage).mimeType;
  const preservation = evaluateProductPreservationGate({
    expectedProductId,
    expectedAssetId: expectedAsset.assetId,
    asset: prepared.asset,
    transform: prepared.transform,
  });
  const expectedBounds = getMarketingProductBounds();
  const boundsMatch = prepared.transform.padding === 0
    && prepared.transform.bounds.x === expectedBounds.x
    && prepared.transform.bounds.y === expectedBounds.y
    && prepared.transform.bounds.width === expectedBounds.width
    && prepared.transform.bounds.height === expectedBounds.height;
  if (!sourceMatches || !boundsMatch || !preservation.accepted) {
    throw new MarketingProductPreservationError(preservation.errors);
  }
  return prepared;
}

export function getMarketingProductRenderGeometry(
  prepared: PreparedMarketingProductImage,
): MarketingProductRenderGeometry {
  assertMarketingProductCoordinateSpace(prepared);
  return {
    x: prepared.transform.translateX,
    y: prepared.transform.translateY,
    width: prepared.transform.targetWidth,
    height: prepared.transform.targetHeight,
  };
}

export function getMarketingProductPreviewGeometry(
  prepared: PreparedMarketingProductImage,
): MarketingProductRenderGeometry {
  const geometry = getMarketingProductRenderGeometry(prepared);
  return {
    x: geometry.x - toArtPx(ART_LAYOUT.photo.x),
    y: geometry.y - toArtPx(ART_LAYOUT.photo.y),
    width: geometry.width,
    height: geometry.height,
  };
}

export function captureMarketingProductRenderIdentity(
  prepared: PreparedMarketingProductImage,
): MarketingProductRenderIdentity {
  return {
    productId: prepared.asset.productId,
    assetId: prepared.asset.assetId,
    sourceUrl: prepared.resolvedImage.sourceUrl,
  };
}

export function isMarketingProductRenderIdentityCurrent(
  captured: MarketingProductRenderIdentity,
  currentProductId: string,
  currentPrepared: PreparedMarketingProductImage | null,
): boolean {
  return Boolean(
    currentPrepared
    && captured.productId === currentProductId
    && captured.productId === currentPrepared.asset.productId
    && captured.assetId === currentPrepared.asset.assetId
    && captured.sourceUrl === currentPrepared.resolvedImage.sourceUrl,
  );
}
