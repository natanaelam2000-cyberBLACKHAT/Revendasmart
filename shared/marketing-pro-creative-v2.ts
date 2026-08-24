/**
 * PRO-07J — contrato REAL (client+server) do Premium Creative Composer V2. Mirrora deliberadamente a
 * lógica já validada em `script/product-cutout-smoke/marketing-pro-creative-v2-tokens.ts` (PRO-07I):
 * mesmas famílias, mesma função `buildPremiumCreativeTokens`, mesmo contrato `ProductCreativeContext`.
 *
 * A cópia é intencional, não descuido: `script/product-cutout-smoke/` é um sandbox isolado (rodado só
 * via `tsx`, nunca importado pelo bundle do client/server) usado para calibração/smoke com fixtures —
 * não deve virar dependência de runtime. Este arquivo é a fonte canônica para o app real; o sandbox
 * continua com sua própria cópia validada, intocada por esta tarefa.
 */
import {
  calculateProductContainTransform,
  evaluateProductPreservationGate,
  type ProductAssetOriginal,
  type ProductBoundingBox,
  type ProductPreservationError,
  type ProductTransform,
} from "./product-image-preservation";
import { PRODUCT_IMAGE_COORDINATE_SPACE_VERSION } from "./product-image-coordinate-space";
import { MARKETING_PRO_FORMAT_DIMENSIONS, MARKETING_PRO_PRODUCT_ZONE, type MarketingProFormat } from "./marketing-pro-contract";
import type { ProductCreativeContext } from "./marketing-pro-creative-intelligence";
export type { ProductCreativeContext } from "./marketing-pro-creative-intelligence";

// ---------------------------------------------------------------------------------------------
// Bridge: cutout JÁ APROVADO (Photoroom + Pixel Preservation Gate, fora desta tarefa) -> asset do
// compositor Premium. Nenhuma chamada a provider aqui — o cutout já existe antes deste módulo rodar.
// ---------------------------------------------------------------------------------------------

export class MarketingProCutoutPreservationError extends Error {
  readonly code = "marketing-pro-cutout-preservation-rejected";
  readonly errors: readonly ProductPreservationError[];

  constructor(errors: readonly ProductPreservationError[] = []) {
    super("O cutout aprovado não passou pela validação de preservação para o compositor Premium V2. Nenhuma arte foi gerada.");
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
  /** Referência opaca (ex.: storagePath) — nunca bytes/base64, nunca um caminho de fixture local. */
  readonly assetRef: string;
}

/** Prefixado para nunca colidir com um `marketing-session:` do fluxo Manual nem parecer um asset cru. */
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
 * REGRA P0: calcula o ProductTransform (contain, sem crop/stretch/rotate) e roda o Preservation Gate.
 * Fail-closed — qualquer divergência lança `MarketingProCutoutPreservationError`, nunca substitui o
 * produto silenciosamente.
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

/** Preview e Export chamam esta MESMA função — nunca duas preparações independentes (§8). */
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

// ---------------------------------------------------------------------------------------------
// ProductCreativeContext + família + PremiumCreativeTokens — determinístico, serializável, sem
// bitmap/base64/visão computacional (§4/§6 da tarefa).
// ---------------------------------------------------------------------------------------------

export type PremiumCreativeFamily = "luxury" | "editorial" | "modern";

export const PREMIUM_CREATIVE_FAMILIES: readonly PremiumCreativeFamily[] = ["luxury", "editorial", "modern"];

export function isPremiumCreativeFamily(value: unknown): value is PremiumCreativeFamily {
  return value === "luxury" || value === "editorial" || value === "modern";
}

/** Fallback determinístico e documentado quando nenhuma família explícita é informada (§5). Não é
 * escolhida por IA nem declarada "melhor" — é só o valor neutro padrão desta primeira integração. */
export const MARKETING_PRO_CREATIVE_V2_FALLBACK_FAMILY: PremiumCreativeFamily = "editorial";

/** Mesmo input (family explícita OU ausente) sempre resolve para a mesma família — nunca aleatório,
 * nunca depende de provider. */
export function resolvePremiumCreativeFamily(explicitFamily?: PremiumCreativeFamily | null): PremiumCreativeFamily {
  return isPremiumCreativeFamily(explicitFamily) ? explicitFamily : MARKETING_PRO_CREATIVE_V2_FALLBACK_FAMILY;
}

/** Contexto vazio — usado quando o produto não declara nenhum metadado; nunca inventa informação. */
export const MARKETING_PRO_CREATIVE_V2_EMPTY_CONTEXT: ProductCreativeContext = Object.freeze({});

interface GradientStop {
  readonly color: string;
  readonly offset: number;
}

interface DecorationTokenV2 {
  readonly kind: "line" | "arc" | "shape";
  readonly rect: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
  readonly color: string;
  readonly opacity: number;
}

export interface PremiumCreativeTokens {
  readonly family: PremiumCreativeFamily;
  readonly context: ProductCreativeContext;
  readonly background: {
    readonly strategy: string;
    readonly angleDeg: number;
    readonly stops: readonly GradientStop[];
  };
  readonly typography: {
    readonly foreground: string;
    readonly mutedForeground: string;
  };
  readonly cta: {
    readonly strategy: string;
    readonly background: string;
    readonly angleDeg: number;
    readonly stops: readonly GradientStop[];
    readonly textColor: string;
    readonly borderColor?: string;
  };
  readonly grounding: {
    readonly strategy: string;
    readonly glowColor: string;
    readonly glowIntensity: number;
    readonly shadowOpacity: number;
    readonly pedestalStyle: "soft-radial" | "hard-line" | "graphic-plate";
  };
  readonly decorations: readonly DecorationTokenV2[];
  readonly composition: {
    readonly variant: string;
    readonly glowDirection: "top" | "bottom" | "diagonal";
    readonly textAlign: "left" | "center";
    readonly negativeSpaceBias: "product-heavy" | "balanced" | "text-heavy";
  };
}

/**
 * Função pura e determinística — mesma `family` + mesmo `context` produzem sempre o mesmo
 * `PremiumCreativeTokens`. Idêntica em espírito à versão validada do sandbox (PRO-07I): cada família
 * diverge em fundo/CTA/grounding/decoração/composição, não só em cor.
 */
export function buildPremiumCreativeTokens(family: PremiumCreativeFamily, context: ProductCreativeContext = MARKETING_PRO_CREATIVE_V2_EMPTY_CONTEXT): PremiumCreativeTokens {
  const accent = context.accentColorFamily === "gold" ? "#d4af37" : "#8fb8c9";
  const dominant = context.dominantColorFamily === "amber/brown" ? "#5c3a1e" : "#1e2a3a";

  if (family === "luxury") {
    return {
      family,
      context,
      background: {
        strategy: "luxury-cinematic-radial-dark",
        angleDeg: 158,
        stops: [
          { color: "#0a0810", offset: 0 },
          { color: dominant, offset: 0.48 },
          { color: "#050308", offset: 1 },
        ],
      },
      typography: { foreground: "#f5ead0", mutedForeground: "#c9b088" },
      cta: {
        strategy: "champagne-outline-pill",
        background: `linear-gradient(120deg, ${accent} 0%, #f4e2a1 50%, ${accent} 100%)`,
        angleDeg: 120,
        stops: [
          { color: accent, offset: 0 },
          { color: "#f4e2a1", offset: 0.5 },
          { color: accent, offset: 1 },
        ],
        textColor: "#1a1206",
        borderColor: "#f4e2a1",
      },
      grounding: {
        strategy: "cinematic-spotlight",
        glowColor: accent,
        glowIntensity: 0.55,
        shadowOpacity: 0.5,
        pedestalStyle: "soft-radial",
      },
      decorations: [
        { kind: "line", rect: { x: 0.08, y: 0.06, width: 0.18, height: 0.002 }, color: accent, opacity: 0.65 },
        { kind: "line", rect: { x: 0.74, y: 0.06, width: 0.18, height: 0.002 }, color: accent, opacity: 0.65 },
        { kind: "arc", rect: { x: -0.15, y: 0.32, width: 0.55, height: 0.55 }, color: accent, opacity: 0.08 },
      ],
      composition: { variant: "top-frame-bottom-ground", glowDirection: "top", textAlign: "left", negativeSpaceBias: "product-heavy" },
    };
  }

  if (family === "editorial") {
    return {
      family,
      context,
      background: {
        strategy: "editorial-soft-daylight",
        angleDeg: 100,
        stops: [
          { color: "#faf5ec", offset: 0 },
          { color: "#f0e5d4", offset: 0.55 },
          { color: "#e4d2b8", offset: 1 },
        ],
      },
      typography: { foreground: "#241a10", mutedForeground: "#6b5843" },
      cta: {
        strategy: "terracotta-solid-block",
        background: "#8a4a2b",
        angleDeg: 0,
        stops: [
          { color: "#8a4a2b", offset: 0 },
          { color: "#6f3a20", offset: 1 },
        ],
        textColor: "#faf5ec",
      },
      grounding: {
        strategy: "natural-daylight-soft",
        glowColor: "#ffffff",
        glowIntensity: 0.3,
        shadowOpacity: 0.22,
        pedestalStyle: "graphic-plate",
      },
      decorations: [
        { kind: "shape", rect: { x: 0, y: 0, width: 0.42, height: 1 }, color: "#e4d2b8", opacity: 0.45 },
        { kind: "line", rect: { x: 0.06, y: 0.92, width: 0.3, height: 0.003 }, color: "#8a4a2b", opacity: 0.6 },
      ],
      composition: { variant: "left-mass-right-negative-space", glowDirection: "diagonal", textAlign: "left", negativeSpaceBias: "balanced" },
    };
  }

  return {
    family: "modern",
    context,
    background: {
      strategy: "modern-graphic-duotone",
      angleDeg: 128,
      stops: [
        { color: "#081820", offset: 0 },
        { color: "#0d4a56", offset: 0.5 },
        { color: "#0a2c36", offset: 1 },
      ],
    },
    typography: { foreground: "#eafcff", mutedForeground: "#8fd6df" },
    cta: {
      strategy: "cyan-graphic-block",
      background: "#26d0c9",
      angleDeg: 90,
      stops: [
        { color: "#26d0c9", offset: 0 },
        { color: "#12a6b8", offset: 1 },
      ],
      textColor: "#04181a",
    },
    grounding: {
      strategy: "graphic-contact-plate",
      glowColor: "#26d0c9",
      glowIntensity: 0.42,
      shadowOpacity: 0.34,
      pedestalStyle: "hard-line",
    },
    decorations: [
      { kind: "shape", rect: { x: 0.62, y: 0, width: 0.38, height: 0.34 }, color: "#26d0c9", opacity: 0.14 },
      { kind: "line", rect: { x: 0.06, y: 0.5, width: 0.16, height: 0.004 }, color: "#26d0c9", opacity: 0.7 },
      { kind: "shape", rect: { x: 0, y: 0.86, width: 1, height: 0.14 }, color: "#04181a", opacity: 0.3 },
    ],
    composition: { variant: "diagonal-graphic-split", glowDirection: "bottom", textAlign: "left", negativeSpaceBias: "text-heavy" },
  };
}
