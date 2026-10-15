/**
 * ADS-PRO-FINAL — direção de arte DETERMINÍSTICA derivada do perfil de estilo do vendedor.
 *
 * Antes desta camada o perfil do quiz (`AdsProCreativeProfileV1`) era só uma preferência guardada:
 * nada na composição mudava por causa dele. Aqui o perfil (estilos preferidos em ordem de prioridade) +
 * o objetivo da campanha + a categoria viram um conjunto fechado de decisões de arte que o layout
 * consome: composição (arquétipo), hierarquia, tipografia, espaçamento, CTA, decoração, estilo do preço
 * e intensidade visual. Tabelas fixas — mesmo input, mesma saída, sempre. Sem IA, sem aleatoriedade.
 */
import type { MarketingProCategory, MarketingProStyle } from "../marketing-pro-contract";
import type { MarketingCampaignIntentId } from "../marketing-pro-creative-intelligence";

export type AdsProIntensity = 1 | 2 | 3;
export const ADS_PRO_INTENSITY_LABELS: Readonly<Record<AdsProIntensity, string>> = Object.freeze({ 1: "Suave", 2: "Equilibrada", 3: "Forte" });

export const ADS_PRO_LAYOUT_ARCHETYPES = ["hero-center", "split-side", "poster-top", "band-bottom", "price-burst"] as const;
export type AdsProLayoutArchetype = (typeof ADS_PRO_LAYOUT_ARCHETYPES)[number];
export const ADS_PRO_ARCHETYPE_LABELS: Readonly<Record<AdsProLayoutArchetype, string>> = Object.freeze({
  "hero-center": "Vitrine",
  "split-side": "Lateral",
  "poster-top": "Pôster",
  "band-bottom": "Faixa",
  "price-burst": "Oferta",
});

export const ADS_PRO_HIERARCHIES = ["product-first", "name-first", "price-first"] as const;
export type AdsProHierarchy = (typeof ADS_PRO_HIERARCHIES)[number];

export const ADS_PRO_SPACINGS = ["airy", "standard", "compact"] as const;
export type AdsProSpacing = (typeof ADS_PRO_SPACINGS)[number];

export const ADS_PRO_FONT_KINDS = ["serif", "sans", "display"] as const;
export type AdsProFontKind = (typeof ADS_PRO_FONT_KINDS)[number];

export const ADS_PRO_CTA_SHAPES = ["pill", "outline", "bar", "link", "soft"] as const;
export type AdsProCtaShape = (typeof ADS_PRO_CTA_SHAPES)[number];

export const ADS_PRO_DECORATIONS = ["none", "line", "frame", "circle", "corner"] as const;
export type AdsProDecoration = (typeof ADS_PRO_DECORATIONS)[number];

export const ADS_PRO_PRICE_STYLES = ["plain", "underline", "badge", "stamp", "burst"] as const;
export type AdsProPriceStyle = (typeof ADS_PRO_PRICE_STYLES)[number];

export interface AdsProTypography {
  readonly headlineFont: AdsProFontKind;
  readonly headlineWeight: number;
  readonly headlineUppercase: boolean;
  readonly headlineItalic: boolean;
  /** Multiplicador do tamanho-base do título. */
  readonly headlineScale: number;
  /** Espaçamento entre letras, em em. */
  readonly headlineTracking: number;
  readonly subtitleItalic: boolean;
  /** Tracking do kicker/loja em caixa alta, em em. */
  readonly kickerTracking: number;
  readonly priceFont: AdsProFontKind;
  readonly priceWeight: number;
  readonly priceScale: number;
}

export type AdsProCtaSize = "sm" | "md" | "lg";

interface StyleRecipe {
  readonly baseIntensity: AdsProIntensity;
  /** Ordem de preferência dos arquétipos de composição. */
  readonly archetypes: readonly AdsProLayoutArchetype[];
  readonly hierarchy: AdsProHierarchy;
  readonly spacing: AdsProSpacing;
  readonly typography: AdsProTypography;
  readonly cta: { readonly shape: AdsProCtaShape; readonly size: AdsProCtaSize; readonly uppercase: boolean };
  /** Decorações em ordem de preferência. */
  readonly decorations: readonly AdsProDecoration[];
  readonly priceStyle: AdsProPriceStyle;
  /** Cor de acento padrão do estilo (a cor da loja, quando válida, tem precedência). */
  readonly accent: string;
}

/** Tabela única de direção de arte por estilo. Cada linha difere das outras em TODOS os eixos relevantes. */
export const ADS_PRO_STYLE_RECIPES: Readonly<Record<MarketingProStyle, StyleRecipe>> = Object.freeze({
  luxury: {
    baseIntensity: 2,
    archetypes: ["hero-center", "split-side", "poster-top", "band-bottom", "price-burst"],
    hierarchy: "name-first",
    spacing: "airy",
    typography: { headlineFont: "serif", headlineWeight: 500, headlineUppercase: false, headlineItalic: false, headlineScale: 1, headlineTracking: 0.01, subtitleItalic: true, kickerTracking: 0.2, priceFont: "serif", priceWeight: 600, priceScale: 1 },
    cta: { shape: "outline", size: "md", uppercase: true },
    decorations: ["line", "frame", "none"],
    priceStyle: "plain",
    accent: "#C9A24B",
  },
  editorial: {
    baseIntensity: 2,
    archetypes: ["poster-top", "split-side", "hero-center", "band-bottom", "price-burst"],
    hierarchy: "name-first",
    spacing: "standard",
    typography: { headlineFont: "serif", headlineWeight: 700, headlineUppercase: false, headlineItalic: false, headlineScale: 1.12, headlineTracking: -0.01, subtitleItalic: true, kickerTracking: 0.14, priceFont: "sans", priceWeight: 800, priceScale: 1 },
    cta: { shape: "link", size: "md", uppercase: false },
    decorations: ["frame", "line", "corner"],
    priceStyle: "underline",
    accent: "#8C5A3C",
  },
  minimal: {
    baseIntensity: 1,
    // Faixa neutra embaixo: o produto domina o quadro e as informações ficam quietas (ver `bandBottom`).
    archetypes: ["band-bottom", "hero-center", "split-side", "poster-top", "price-burst"],
    hierarchy: "product-first",
    spacing: "airy",
    typography: { headlineFont: "sans", headlineWeight: 400, headlineUppercase: false, headlineItalic: false, headlineScale: 0.92, headlineTracking: 0, subtitleItalic: false, kickerTracking: 0.12, priceFont: "sans", priceWeight: 600, priceScale: 0.92 },
    cta: { shape: "soft", size: "sm", uppercase: false },
    decorations: ["none", "line", "circle"],
    priceStyle: "plain",
    accent: "#475569",
  },
  sensory: {
    baseIntensity: 2,
    archetypes: ["hero-center", "band-bottom", "poster-top", "split-side", "price-burst"],
    hierarchy: "product-first",
    spacing: "standard",
    typography: { headlineFont: "serif", headlineWeight: 600, headlineUppercase: false, headlineItalic: true, headlineScale: 1.04, headlineTracking: 0, subtitleItalic: true, kickerTracking: 0.1, priceFont: "sans", priceWeight: 700, priceScale: 1.02 },
    cta: { shape: "pill", size: "md", uppercase: false },
    decorations: ["circle", "corner", "none"],
    priceStyle: "badge",
    accent: "#C2576F",
  },
  modern: {
    baseIntensity: 3,
    archetypes: ["split-side", "price-burst", "band-bottom", "poster-top", "hero-center"],
    hierarchy: "price-first",
    spacing: "compact",
    typography: { headlineFont: "display", headlineWeight: 900, headlineUppercase: true, headlineItalic: false, headlineScale: 1.1, headlineTracking: -0.02, subtitleItalic: false, kickerTracking: 0.16, priceFont: "display", priceWeight: 900, priceScale: 1.12 },
    cta: { shape: "bar", size: "lg", uppercase: true },
    decorations: ["corner", "line", "frame"],
    priceStyle: "stamp",
    accent: "#0EA5A4",
  },
});

/** Estilos vizinhos (quando o perfil só tem 1 estilo, as variações exploram o entorno dele). */
export const ADS_PRO_ADJACENT_STYLES: Readonly<Record<MarketingProStyle, readonly MarketingProStyle[]>> = Object.freeze({
  luxury: ["editorial", "modern"],
  editorial: ["minimal", "luxury"],
  minimal: ["editorial", "modern"],
  sensory: ["editorial", "minimal"],
  modern: ["minimal", "luxury"],
});

/** Sugestão por categoria quando o vendedor ainda não definiu um perfil (nunca grava nada no perfil). */
export const ADS_PRO_DEFAULT_STYLE_BY_CATEGORY: Readonly<Record<MarketingProCategory, MarketingProStyle>> = Object.freeze({
  beauty: "editorial",
  electronics: "modern",
  fashion: "editorial",
  home: "minimal",
  food: "sensory",
  general: "minimal",
});

export interface AdsProStyleDirectionInput {
  /** Estilos preferidos do perfil, em ordem de prioridade ([0] é o principal). Vazio/ausente = sem perfil. */
  readonly preferredStyles?: readonly MarketingProStyle[];
  readonly intent: MarketingCampaignIntentId;
  readonly category: MarketingProCategory;
  /** Sobrescreve a intensidade calculada (controle "Intensidade" do estúdio). */
  readonly intensityOverride?: AdsProIntensity;
  /** Força o estilo principal (usado para gerar variações em torno do perfil). */
  readonly styleOverride?: MarketingProStyle;
}

export interface AdsProStyleDirection {
  readonly primaryStyle: MarketingProStyle;
  readonly secondaryStyles: readonly MarketingProStyle[];
  readonly styleSource: "profile" | "category-default";
  readonly intent: MarketingCampaignIntentId;
  readonly intensity: AdsProIntensity;
  readonly archetypes: readonly AdsProLayoutArchetype[];
  readonly hierarchy: AdsProHierarchy;
  readonly spacing: AdsProSpacing;
  readonly typography: AdsProTypography;
  readonly cta: { readonly shape: AdsProCtaShape; readonly size: AdsProCtaSize; readonly uppercase: boolean };
  readonly decorations: readonly AdsProDecoration[];
  readonly priceStyle: AdsProPriceStyle;
  readonly accent: string;
}

function clampIntensity(value: number): AdsProIntensity {
  return (Math.max(1, Math.min(3, Math.round(value))) as AdsProIntensity);
}

function dedupe<T>(values: readonly T[]): T[] {
  return values.filter((value, index) => values.indexOf(value) === index);
}

function moveToFront<T>(values: readonly T[], value: T): T[] {
  return [value, ...values.filter((item) => item !== value)];
}

/**
 * Perfil + objetivo + categoria -> direção de arte. O perfil manda: estilo principal e secundários vêm
 * dele; a categoria só sugere um estilo quando NÃO há perfil; o objetivo da campanha modula a
 * intensidade, a hierarquia, o CTA e o estilo do preço (ex.: promoção forte != minimalismo calmo).
 */
export function resolveAdsProStyleDirection(input: AdsProStyleDirectionInput): AdsProStyleDirection {
  const preferred = dedupe(input.preferredStyles ?? []);
  const hasProfile = preferred.length > 0;
  const primaryStyle = input.styleOverride ?? (hasProfile ? preferred[0] : ADS_PRO_DEFAULT_STYLE_BY_CATEGORY[input.category]);
  const secondaryStyles = dedupe([...preferred.filter((style) => style !== primaryStyle)]);
  const recipe = ADS_PRO_STYLE_RECIPES[primaryStyle];

  let intensity: number = recipe.baseIntensity;
  let archetypes: AdsProLayoutArchetype[] = [...recipe.archetypes];
  let hierarchy = recipe.hierarchy;
  let cta = recipe.cta;
  let priceStyle = recipe.priceStyle;
  let decorations: AdsProDecoration[] = [...recipe.decorations];

  // O objetivo da campanha ACRESCENTA ênfase à receita do estilo — nunca apaga a identidade dele: um perfil
  // minimalista com "últimas unidades" continua minimalista (só mais firme no preço e no botão).
  const calmPrice = priceStyle === "plain" || priceStyle === "underline";
  const loudCta = { shape: recipe.cta.shape === "link" || recipe.cta.shape === "soft" ? ("pill" as const) : recipe.cta.shape, size: "lg" as const, uppercase: recipe.cta.uppercase };
  switch (input.intent) {
    case "promo":
      intensity += 1;
      archetypes = moveToFront(archetypes, "price-burst");
      hierarchy = "price-first";
      if (calmPrice && primaryStyle !== "minimal") priceStyle = "badge";
      cta = loudCta;
      break;
    case "last":
      intensity += 1;
      archetypes = moveToFront(archetypes, "band-bottom");
      hierarchy = "price-first";
      if (calmPrice && primaryStyle === "luxury") priceStyle = "badge";
      else if (calmPrice && primaryStyle === "editorial") priceStyle = "stamp";
      cta = loudCta;
      break;
    case "new":
      archetypes = moveToFront(archetypes, "hero-center");
      decorations = moveToFront(decorations, "corner");
      break;
    default:
      break; // "spotlight" e demais objetivos: a receita do estilo vale como está.
  }

  return {
    primaryStyle,
    secondaryStyles,
    styleSource: hasProfile ? "profile" : "category-default",
    intent: input.intent,
    intensity: input.intensityOverride ?? clampIntensity(intensity),
    archetypes,
    hierarchy,
    spacing: recipe.spacing,
    typography: recipe.typography,
    cta,
    decorations,
    priceStyle,
    accent: recipe.accent,
  };
}

/** Escalas aplicadas pelo layout conforme a intensidade visual escolhida. */
export const ADS_PRO_INTENSITY_SCALE: Readonly<Record<AdsProIntensity, { headline: number; price: number; decoration: number; cta: number }>> = Object.freeze({
  1: { headline: 0.94, price: 0.9, decoration: 0.6, cta: 0.92 },
  2: { headline: 1, price: 1, decoration: 1, cta: 1 },
  3: { headline: 1.08, price: 1.22, decoration: 1.25, cta: 1.1 },
});

/** Distância entre duas direções: quantos eixos de arte diferem (usada para provar variações realmente distintas). */
export function countDirectionAxisDifferences(a: AdsProDirectionAxes, b: AdsProDirectionAxes): number {
  let differences = 0;
  if (a.archetype !== b.archetype) differences += 1;
  if (a.hierarchy !== b.hierarchy) differences += 1;
  if (a.headlineFont !== b.headlineFont || a.headlineWeight !== b.headlineWeight || a.headlineUppercase !== b.headlineUppercase) differences += 1;
  if (a.spacing !== b.spacing) differences += 1;
  if (a.ctaShape !== b.ctaShape) differences += 1;
  if (a.decoration !== b.decoration) differences += 1;
  if (a.priceStyle !== b.priceStyle) differences += 1;
  if (a.intensity !== b.intensity) differences += 1;
  if (a.backgroundId !== b.backgroundId) differences += 1;
  return differences;
}

export interface AdsProDirectionAxes {
  readonly archetype: AdsProLayoutArchetype;
  readonly hierarchy: AdsProHierarchy;
  readonly headlineFont: AdsProFontKind;
  readonly headlineWeight: number;
  readonly headlineUppercase: boolean;
  readonly spacing: AdsProSpacing;
  readonly ctaShape: AdsProCtaShape;
  readonly decoration: AdsProDecoration;
  readonly priceStyle: AdsProPriceStyle;
  readonly intensity: AdsProIntensity;
  readonly backgroundId: string;
}
