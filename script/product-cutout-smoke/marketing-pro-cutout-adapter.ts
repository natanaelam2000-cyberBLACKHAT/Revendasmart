/**
 * PRO-07G — adapter controlado: aceita um ProductCutout JÁ APROVADO (Pixel Preservation Gate aceito
 * na Fase 2, PRO-07F.4) como source visual do produto no compositor Premium ("Anúncios Pro"). Isolado
 * de client/src e server/ — não altera o fluxo real do app, não altera History/Repeat.
 *
 * Reaproveita INTEGRALMENTE o contrato geométrico já existente (shared/product-image-preservation.ts,
 * PRO-07B) — o mesmo usado pelo fluxo Manual (client/src/lib/marketing-product-preservation.ts) — em
 * vez de reimplementar contain/gate para o Premium. Nenhuma chamada a provider aqui: o cutout já foi
 * gerado e aprovado antes desta tarefa.
 */
import {
  calculateProductContainTransform,
  evaluateProductPreservationGate,
  type ProductAssetOriginal,
  type ProductBoundingBox,
  type ProductPreservationError,
  type ProductTransform,
} from "../../shared/product-image-preservation";
import { PRODUCT_IMAGE_COORDINATE_SPACE_VERSION } from "../../shared/product-image-coordinate-space";
import { MARKETING_PRO_FORMAT_DIMENSIONS, MARKETING_PRO_PRODUCT_ZONE, type MarketingProFormat } from "../../shared/marketing-pro-contract";

export class MarketingProCutoutPreservationError extends Error {
  readonly code = "marketing-pro-cutout-preservation-rejected";
  readonly errors: readonly ProductPreservationError[];

  constructor(errors: readonly ProductPreservationError[] = []) {
    super("O cutout aprovado não passou pela validação de preservação para o compositor Premium. Nenhuma arte foi gerada.");
    this.name = "MarketingProCutoutPreservationError";
    this.errors = errors;
  }
}

export interface ApprovedProductCutoutInput {
  readonly productId: string;
  /** Identidade estável e determinística do cutout aprovado — ex.: `sha256:<hash do cutout.png>`. */
  readonly cutoutContentHash: string;
  readonly width: number;
  readonly height: number;
  /** Referência opaca (ex.: caminho local do artefato aprovado) — nunca bytes/base64. */
  readonly assetRef: string;
}

/**
 * §1/§2: constrói o `ProductAssetOriginal` a partir de um cutout JÁ aprovado — nunca deriva de uma
 * URL resolvida ao vivo (isso é o caminho Manual). `assetId` é prefixado `product-cutout-approved:`
 * para nunca poder colidir por acidente com um `marketing-session:` do fluxo Manual (PRO-07D) nem
 * ser confundido com um asset ainda não passado pelo Pixel Preservation Gate.
 */
export function buildApprovedProductCutoutAsset(input: ApprovedProductCutoutInput): ProductAssetOriginal {
  return {
    productId: input.productId,
    assetId: `product-cutout-approved:${input.productId}:${input.cutoutContentHash}`,
    assetRef: input.assetRef,
    width: input.width,
    height: input.height,
    mimeType: "image/png",
    coordinateSpaceVersion: PRODUCT_IMAGE_COORDINATE_SPACE_VERSION,
  };
}

export function getMarketingProProductBoundsPx(format: MarketingProFormat): ProductBoundingBox {
  const zone = MARKETING_PRO_PRODUCT_ZONE[format];
  const dimensions = MARKETING_PRO_FORMAT_DIMENSIONS[format];
  return {
    x: zone.x * dimensions.width,
    y: zone.y * dimensions.height,
    width: zone.width * dimensions.width,
    height: zone.height * dimensions.height,
  };
}

export interface PreparedMarketingProCutoutImage {
  readonly asset: ProductAssetOriginal;
  readonly transform: ProductTransform;
}

/**
 * §2/REGRAS P0: calcula o ProductTransform (contain, sem crop/stretch/rotate — mesma garantia de tipo
 * do PRO-07B) para a zona do produto Premium e roda o Preservation Gate. Fail-closed: qualquer
 * divergência (asset/produto/coordinate space/geometria) lança `MarketingProCutoutPreservationError`,
 * nunca corrige ou substitui o asset silenciosamente (nenhum fallback que troque o produto).
 */
export function prepareMarketingProCutoutProductImage(input: {
  readonly asset: ProductAssetOriginal;
  readonly format: MarketingProFormat;
}): PreparedMarketingProCutoutImage {
  const bounds = getMarketingProProductBoundsPx(input.format);
  const contain = calculateProductContainTransform({
    sourceAssetId: input.asset.assetId,
    source: input.asset,
    bounds,
    padding: 0,
  });
  if (!contain.accepted) throw new MarketingProCutoutPreservationError(contain.errors);

  const preservation = evaluateProductPreservationGate({
    expectedProductId: input.asset.productId,
    expectedAssetId: input.asset.assetId,
    asset: input.asset,
    transform: contain.transform,
  });
  if (!preservation.accepted) throw new MarketingProCutoutPreservationError(preservation.errors);

  return { asset: input.asset, transform: contain.transform };
}

/**
 * §3/REGRAS P0: Preview e PNG chamam esta MESMA função — nunca duas preparações independentes. Um
 * `expectedAsset` divergente (assetId, dimensões, coordinate space) é recusado aqui, antes de
 * qualquer desenho — fail-closed, idêntico ao padrão já usado no fluxo Manual (PRO-07C/D).
 */
export function assertMarketingProCutoutMatches(input: {
  readonly expectedAsset: ProductAssetOriginal;
  readonly prepared: PreparedMarketingProCutoutImage;
}): PreparedMarketingProCutoutImage {
  const matches = input.expectedAsset.assetId === input.prepared.asset.assetId
    && input.expectedAsset.productId === input.prepared.asset.productId
    && input.expectedAsset.width === input.prepared.asset.width
    && input.expectedAsset.height === input.prepared.asset.height
    && input.expectedAsset.coordinateSpaceVersion === input.prepared.asset.coordinateSpaceVersion;
  if (!matches) throw new MarketingProCutoutPreservationError();
  return input.prepared;
}
