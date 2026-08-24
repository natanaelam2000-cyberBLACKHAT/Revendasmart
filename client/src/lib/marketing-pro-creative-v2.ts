/**
 * PRO-07J/PRO-07K — ponte entre um cutout JÁ APROVADO e PERSISTIDO de um produto e o Premium Creative
 * Composer V2.
 *
 * Isto NÃO gera cutout, NÃO chama Photoroom/Gemini/OpenAI/BFL e NÃO lê nada de disco local — recebe o
 * `ApprovedProductCutout` real do produto (`product.approvedCutout`, shape definido e persistido em
 * `shared/approved-product-cutout.ts`, PRO-07K) e prepara o payload único que Preview e Export do
 * runtime consomem via a MESMA função de desenho (`renderPremiumCreativeV2`,
 * ./marketing-pro-creative-v2-renderer).
 *
 * Nenhum produto real do catálogo tem `approvedCutout` hoje — o pipeline que gera e valida o cutout
 * (Photoroom + Pixel Preservation Gate + write helper) só existe, nesta data, como sandbox isolado em
 * `script/product-cutout-smoke/` (PRO-07B..PRO-07I) e como infraestrutura pronta-mas-não-ligada em
 * `shared/approved-product-cutout.ts` (PRO-07K). Este módulo deixa o composer V2 pronto e testado para
 * o primeiro cutout real, sem inventar um agora (decisão explícita do usuário, PRO-07J/PRO-07K).
 */
import {
  MARKETING_PRO_FORMATS,
  sanitizeMarketingProInput,
  buildMarketingProComposition,
  type MarketingProInputDraft,
} from "./marketing-pro";
import {
  prepareMarketingProCutoutProductImage,
  buildPremiumCreativeTokens,
  resolvePremiumCreativeFamily,
  MARKETING_PRO_CREATIVE_V2_EMPTY_CONTEXT,
  type PremiumCreativeFamily,
  type PremiumCreativeTokens,
} from "@shared/marketing-pro-creative-v2";
import { validateApprovedProductCutoutShape, isApprovedProductCutoutStale, type ApprovedProductCutout } from "@shared/approved-product-cutout";
import type { ProductAssetOriginal, ProductTransform } from "@shared/product-image-preservation";

/**
 * Lê e valida `product.approvedCutout` (nunca `product.extras` — `extras` é um bag de STRINGS de
 * formulário, coagido por `sanitizeProductExtras`, e não sobrevive a um objeto aninhado). Fail-closed:
 * campo ausente ou malformado -> `undefined`, nunca uma reconstrução parcial/fabricada.
 */
export function readApprovedProductCutoutSource(product: { readonly approvedCutout?: unknown } | undefined): ApprovedProductCutout | undefined {
  if (!product || product.approvedCutout === undefined) return undefined;
  const validation = validateApprovedProductCutoutShape(product.approvedCutout);
  return validation.accepted ? (product.approvedCutout as ApprovedProductCutout) : undefined;
}

export interface MarketingProCreativeV2CommercialInput {
  readonly store: MarketingProInputDraft["store"];
  readonly product: { readonly id: string; readonly name: string; readonly category?: string; readonly brand?: string };
  readonly offer: MarketingProInputDraft["offer"];
  readonly benefits: readonly string[];
  readonly cta: MarketingProInputDraft["cta"];
}

export interface MarketingProCreativeV2Payload {
  readonly family: PremiumCreativeFamily;
  readonly asset: ProductAssetOriginal;
  readonly transform: ProductTransform;
  readonly safeZones: (typeof MARKETING_PRO_FORMATS)["portrait"]["safeZones"];
  readonly tokens: PremiumCreativeTokens;
  readonly overlay: {
    readonly storeName: string;
    readonly productName: string;
    readonly brand?: string;
    readonly priceText: string;
    readonly benefits: readonly string[];
    readonly ctaLabel: string;
  };
}

export class MarketingProCreativeV2StaleCutoutError extends Error {
  readonly code = "marketing-pro-creative-v2-stale-cutout";
  constructor() {
    super("O cutout aprovado deste produto está desatualizado (a foto original mudou) — recusado (fail-closed), nunca usado silenciosamente.");
    this.name = "MarketingProCreativeV2StaleCutoutError";
  }
}

/**
 * §8 (Preview = Export): chamar esta função UMA VEZ por produto/família e reusar o `payload` resultante
 * para os dois canvases — nunca recalcular separadamente. Fail-closed: uma rejeição do Preservation
 * Gate (`MarketingProCutoutPreservationError`, de `@shared/marketing-pro-creative-v2`) ou de staleness
 * (`MarketingProCreativeV2StaleCutoutError`, quando `currentSourceAssetId` é informado e diverge) sobe
 * para o chamador, nunca é mascarada.
 *
 * `currentSourceAssetId` é OPCIONAL nesta integração: o runtime ainda não recalcula a identidade da foto
 * original de forma síncrona (isso pertence a uma sprint de UX futura, PRO-07K §9) — quando omitido, a
 * checagem de staleness simplesmente não roda, e isso é uma limitação conhecida, não um bug silencioso.
 */
export function prepareMarketingProCreativeV2(input: {
  readonly cutout: ApprovedProductCutout;
  readonly commercial: MarketingProCreativeV2CommercialInput;
  readonly explicitFamily?: PremiumCreativeFamily;
  readonly currentSourceAssetId?: string;
}): MarketingProCreativeV2Payload {
  if (input.currentSourceAssetId !== undefined && isApprovedProductCutoutStale(input.cutout, input.currentSourceAssetId)) {
    throw new MarketingProCreativeV2StaleCutoutError();
  }

  const asset: ProductAssetOriginal = {
    productId: input.commercial.product.id,
    assetId: input.cutout.cutoutAssetId,
    assetRef: input.cutout.downloadUrl || input.cutout.storagePath,
    width: input.cutout.width,
    height: input.cutout.height,
    mimeType: input.cutout.mimeType,
    coordinateSpaceVersion: input.cutout.coordinateSpaceVersion,
  };
  const prepared = prepareMarketingProCutoutProductImage({ asset, format: "portrait" });

  const family = resolvePremiumCreativeFamily(input.explicitFamily ?? input.cutout.family);
  const context = input.cutout.context ?? MARKETING_PRO_CREATIVE_V2_EMPTY_CONTEXT;
  const tokens = buildPremiumCreativeTokens(family, context);

  const commercialInput = sanitizeMarketingProInput({
    store: input.commercial.store,
    product: input.commercial.product,
    offer: input.commercial.offer,
    benefits: input.commercial.benefits,
    cta: input.commercial.cta,
    format: "portrait",
    style: family,
  });
  const composition = buildMarketingProComposition(commercialInput);

  return {
    family,
    asset: prepared.asset,
    transform: prepared.transform,
    safeZones: MARKETING_PRO_FORMATS.portrait.safeZones,
    tokens,
    overlay: {
      storeName: composition.commercialOverlay.storeName,
      productName: composition.commercialOverlay.productName,
      brand: composition.commercialOverlay.brand,
      priceText: composition.commercialOverlay.currentPriceText,
      benefits: composition.commercialOverlay.benefits,
      ctaLabel: composition.commercialOverlay.cta.label,
    },
  };
}
