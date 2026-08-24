/**
 * PRO-07I — contrato determinístico e serializável do Premium Creative Composer V2.
 *
 * Não contém bitmap/base64, não lê pixels e não chama provider. O contexto explícito do produto
 * seleciona apenas direção de arte. O produto continua vindo do payload aprovado do PRO-07H, com
 * o mesmo assetId, ProductTransform, Preservation Gate e safe zones.
 */
import {
  buildMarketingProCreativePayload,
  type MarketingProCreativePayload,
} from "./marketing-pro-creative-tokens";

export type PremiumCreativeFamily = "luxury" | "editorial" | "modern";

export interface ProductCreativeContext {
  readonly category?: string;
  readonly dominantColorFamily?: string;
  readonly accentColorFamily?: string;
}

export interface PremiumColorStop {
  readonly offset: number;
  readonly color: string;
}

export interface PremiumCreativeTokens {
  readonly family: PremiumCreativeFamily;
  readonly background: {
    readonly strategy: string;
    readonly angleDeg: number;
    readonly stops: readonly PremiumColorStop[];
  };
  readonly typography: {
    readonly strategy: string;
    readonly foreground: string;
    readonly muted: string;
    readonly nameWeight: number;
    readonly priceWeight: number;
    readonly letterSpacing: number;
  };
  readonly cta: {
    readonly strategy: string;
    readonly fill: string;
    readonly foreground: string;
    readonly border: string;
    readonly borderWidth: number;
    readonly radius: number;
    readonly widthRatio: number;
    readonly horizontalAlign: "start" | "center" | "end";
  };
  readonly grounding: {
    readonly strategy: string;
    readonly glowColor: string;
    readonly glowOpacity: number;
    readonly glowOffsetX: number;
    readonly glowOffsetY: number;
    readonly glowRadiusRatio: number;
    readonly shadowColor: string;
    readonly shadowOpacity: number;
    readonly shadowWidthRatio: number;
    readonly shadowHeight: number;
    readonly pedestalTop: string;
    readonly pedestalSide: string;
  };
  readonly decorations: {
    readonly strategy: string;
    readonly accent: string;
    readonly secondary: string;
    readonly line: string;
  };
  readonly composition: {
    readonly strategy: string;
    readonly textAlign: "left" | "right";
    readonly storeAlign: "left" | "right";
    readonly ctaYOffset: number;
    readonly productNameYOffset: number;
    readonly priceXOffset: number;
  };
}

export interface MarketingProCreativeV2Payload extends MarketingProCreativePayload {
  readonly family: PremiumCreativeFamily;
  readonly productCreativeContext: ProductCreativeContext;
  readonly creativeTokens: PremiumCreativeTokens;
}

/** Metadados conhecidos e declarados do Case B. Nenhuma inferência por computer vision. */
export const COFFEE_UNIQUE_CREATIVE_CONTEXT: ProductCreativeContext = Object.freeze({
  category: "perfumery",
  dominantColorFamily: "amber-brown",
  accentColorFamily: "gold",
});

type Harmony = {
  readonly amber: string;
  readonly deepAmber: string;
  readonly gold: string;
  readonly champagne: string;
};

function resolveKnownProductHarmony(context: ProductCreativeContext): Harmony {
  const isAmberPerfume = context.category === "perfumery"
    && context.dominantColorFamily === "amber-brown"
    && context.accentColorFamily === "gold";
  return isAmberPerfume
    ? { amber: "#a85f32", deepAmber: "#4a2017", gold: "#d6b56d", champagne: "#f2dfb0" }
    : { amber: "#a36b4f", deepAmber: "#493129", gold: "#c9ad73", champagne: "#eadab9" };
}

/** Função pura: mesmo contexto + mesma família sempre produz os mesmos tokens JSON. */
export function buildPremiumCreativeTokens(
  context: ProductCreativeContext,
  family: PremiumCreativeFamily,
): PremiumCreativeTokens {
  const harmony = resolveKnownProductHarmony(context);

  if (family === "luxury") {
    return {
      family,
      background: {
        strategy: "cinematic-amber-vignette",
        angleDeg: 148,
        stops: [
          { offset: 0, color: "#08090f" },
          { offset: 0.44, color: "#241512" },
          { offset: 0.72, color: harmony.deepAmber },
          { offset: 1, color: "#08090d" },
        ],
      },
      typography: {
        strategy: "high-contrast-luxury",
        foreground: "#fffaf0",
        muted: "#d9cdb8",
        nameWeight: 700,
        priceWeight: 800,
        letterSpacing: 0.5,
      },
      cta: {
        strategy: "champagne-plaque",
        fill: harmony.gold,
        foreground: "#1d160d",
        border: harmony.champagne,
        borderWidth: 2,
        radius: 8,
        widthRatio: 0.88,
        horizontalAlign: "end",
      },
      grounding: {
        strategy: "cinematic-tiered-pedestal",
        glowColor: harmony.amber,
        glowOpacity: 0.42,
        glowOffsetX: -52,
        glowOffsetY: -35,
        glowRadiusRatio: 0.92,
        shadowColor: "#000000",
        shadowOpacity: 0.62,
        shadowWidthRatio: 0.46,
        shadowHeight: 18,
        pedestalTop: "#6d4b30",
        pedestalSide: "#241713",
      },
      decorations: {
        strategy: "cinematic-rings-and-light-rays",
        accent: harmony.gold,
        secondary: harmony.amber,
        line: "#f0dca7",
      },
      composition: {
        strategy: "luxury-asymmetric-left-copy",
        textAlign: "left",
        storeAlign: "right",
        ctaYOffset: 0,
        productNameYOffset: 6,
        priceXOffset: 0,
      },
    };
  }

  if (family === "editorial") {
    return {
      family,
      background: {
        strategy: "warm-paper-daylight",
        angleDeg: 132,
        stops: [
          { offset: 0, color: "#fbf5eb" },
          { offset: 0.55, color: "#e8d9c4" },
          { offset: 1, color: "#cbb79d" },
        ],
      },
      typography: {
        strategy: "quiet-editorial-serif-pairing",
        foreground: "#241c18",
        muted: "#66564a",
        nameWeight: 700,
        priceWeight: 700,
        letterSpacing: -0.3,
      },
      cta: {
        strategy: "ink-editorial-block",
        fill: "#30251f",
        foreground: "#fffaf2",
        border: harmony.gold,
        borderWidth: 1,
        radius: 0,
        widthRatio: 0.76,
        horizontalAlign: "start",
      },
      grounding: {
        strategy: "soft-daylight-ground-plane",
        glowColor: harmony.champagne,
        glowOpacity: 0.56,
        glowOffsetX: 74,
        glowOffsetY: -22,
        glowRadiusRatio: 1.05,
        shadowColor: "#59463b",
        shadowOpacity: 0.28,
        shadowWidthRatio: 0.54,
        shadowHeight: 14,
        pedestalTop: "#eadfce",
        pedestalSide: "#bda78c",
      },
      decorations: {
        strategy: "editorial-arch-and-hairlines",
        accent: "#b98761",
        secondary: harmony.champagne,
        line: "#7d6654",
      },
      composition: {
        strategy: "editorial-measured-grid",
        textAlign: "left",
        storeAlign: "left",
        ctaYOffset: -8,
        productNameYOffset: -2,
        priceXOffset: 34,
      },
    };
  }

  return {
    family,
    background: {
      strategy: "teal-graphic-depth",
      angleDeg: 118,
      stops: [
        { offset: 0, color: "#071b20" },
        { offset: 0.48, color: "#0b4650" },
        { offset: 1, color: "#0f252d" },
      ],
    },
    typography: {
      strategy: "graphic-modern-grotesk",
      foreground: "#f3fffd",
      muted: "#b8d8d5",
      nameWeight: 800,
      priceWeight: 900,
      letterSpacing: -0.6,
    },
    cta: {
      strategy: "mint-cut-corner",
      fill: "#5eead4",
      foreground: "#062428",
      border: "#a7f3e8",
      borderWidth: 1,
      radius: 3,
      widthRatio: 0.82,
      horizontalAlign: "center",
    },
    grounding: {
      strategy: "graphic-faceted-platform",
      glowColor: "#38d6c5",
      glowOpacity: 0.38,
      glowOffsetX: 86,
      glowOffsetY: -18,
      glowRadiusRatio: 0.82,
      shadowColor: "#020b0e",
      shadowOpacity: 0.7,
      shadowWidthRatio: 0.4,
      shadowHeight: 13,
      pedestalTop: "#217d7e",
      pedestalSide: "#0a353d",
    },
    decorations: {
      strategy: "modern-orbit-and-faceted-masses",
      accent: "#5eead4",
      secondary: harmony.gold,
      line: "#80fff0",
    },
    composition: {
      strategy: "modern-right-weighted-copy",
      textAlign: "right",
      storeAlign: "left",
      ctaYOffset: 7,
      productNameYOffset: 8,
      priceXOffset: 52,
    },
  };
}

export function buildMarketingProCreativeV2Payload(
  family: PremiumCreativeFamily,
  context: ProductCreativeContext = COFFEE_UNIQUE_CREATIVE_CONTEXT,
): MarketingProCreativeV2Payload {
  const base = buildMarketingProCreativePayload(family);
  return {
    ...base,
    family,
    productCreativeContext: { ...context },
    creativeTokens: buildPremiumCreativeTokens(context, family),
  };
}
