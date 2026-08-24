/**
 * Fonte canônica única da direção de arte provider-safe — PRO-06B0.1 (P1-3 / §6 / §11).
 *
 * Antes desta sprint, o texto de "como cada estilo soa" existia em 3 lugares independentes e
 * divergentes: `client/src/lib/marketing-pro.ts` (`MARKETING_PRO_STYLE_VISUAL_INTENTS`, frases livres),
 * `shared/marketing-pro-benchmark.ts` (strings digitadas à mão por caso) e
 * `server/marketing-pro.ts` (`buildPlaceholderProviderArtDirection`, templates genéricos). Nenhum dos
 * três importava do outro — atualizar um não atualizava os demais.
 *
 * Este módulo é a ÚNICA fonte: `MARKETING_PRO_STYLE_METADATA` mapeia cada estilo a IDs fechados
 * (não texto livre — ver `MarketingProLightingId`/`SurfaceId`/`AtmosphereId` em marketing-pro-contract),
 * e `buildMarketingProProviderArtDirection` é a única função que constrói um
 * `MarketingProProviderArtDirection` de verdade. Client (conversão local), server (rota real) e
 * benchmark (casos de teste) chamam esta mesma função — o mesmo caso nunca produz direções diferentes
 * dependendo de quem pediu.
 */

import {
  MARKETING_PRO_PRODUCT_ZONE,
  MARKETING_PRO_TEXT_ZONE,
  resolveMarketingProProductPlacement,
  type MarketingProAtmosphereId,
  type MarketingProCategory,
  type MarketingProFormat,
  type MarketingProLightingId,
  type MarketingProProviderArtDirection,
  type MarketingProStyle,
  type MarketingProSurfaceId,
} from "./marketing-pro-contract";
import type { CreativeFamily, ProductVisualUnderstanding } from "./marketing-pro-creative-intelligence";

export interface MarketingProStyleMetadata {
  readonly lighting: MarketingProLightingId;
  readonly surface: MarketingProSurfaceId;
  readonly atmosphere: MarketingProAtmosphereId;
  /** Cores-base (hex #RRGGBB) que evocam o estilo — ponto de partida da palette, não a palette final. */
  readonly paletteTendency: readonly string[];
}

/**
 * Mapeamento determinístico estilo → atributos. Cada um dos 5 valores de lighting/surface/atmosphere
 * é usado exatamente uma vez (testado) — não há colisão nem lacuna. As cores de `paletteTendency`
 * reaproveitam os hex já usados nos casos de benchmark originais (mesma intenção visual, agora com
 * fonte única) em vez de inventar uma paleta nova.
 */
export const MARKETING_PRO_STYLE_METADATA: Record<MarketingProStyle, MarketingProStyleMetadata> = {
  luxury: { lighting: "dramatic", surface: "reflective", atmosphere: "refined", paletteTendency: ["#C026D3", "#1A0E1F"] },
  editorial: { lighting: "studio", surface: "clean", atmosphere: "structured", paletteTendency: ["#DB2777", "#211D2B"] },
  minimal: { lighting: "natural", surface: "matte", atmosphere: "quiet", paletteTendency: ["#6B879E", "#18212B"] },
  sensory: { lighting: "soft", surface: "textured", atmosphere: "tactile", paletteTendency: ["#F6A6BB", "#B79BE8"] },
  modern: { lighting: "cinematic", surface: "pedestal", atmosphere: "energetic", paletteTendency: ["#2563EB", "#5EEAD4"] },
};

/** Neutro sempre presente na palette final — mesmo tom já usado em toda a paleta padrão do projeto. */
const MARKETING_PRO_NEUTRAL_PALETTE_COLOR = "#F8FAFC";

export const MARKETING_PRO_PALETTE_LIMITS = { maxColors: 4 } as const;

const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

/**
 * Só `#RRGGBB` (6 dígitos) — PRO-06B0.1 §8. Deliberadamente mais estrito que `cleanColor` de
 * `server/public-catalog.ts` (que aceita 3–8 dígitos para uso em CSS/UI): o provider-safe boundary
 * quer um formato canônico único, não a flexibilidade que a UI precisa. `"#FFF"` (3 dígitos) é
 * rejeitado por design, não por descuido.
 */
export function sanitizeMarketingProProviderPaletteColor(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return HEX_COLOR_PATTERN.test(trimmed) ? trimmed.toUpperCase() : null;
}

/**
 * Constrói a palette final: candidatos validados primeiro (tipicamente `primaryColor` da loja), depois
 * o fallback (tendência do estilo) até `maxColors`. Nenhuma string arbitrária sobrevive — cor inválida
 * em `candidates` é descartada silenciosamente, nunca lançada como erro (entrada não confiável, mesmo
 * padrão de sanitização usada no resto do projeto).
 */
export function buildMarketingProProviderPalette(
  candidates: readonly unknown[],
  fallback: readonly string[],
): readonly string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  const push = (color: string | null) => {
    if (!color || seen.has(color) || result.length >= MARKETING_PRO_PALETTE_LIMITS.maxColors) return;
    seen.add(color);
    result.push(color);
  };
  for (const candidate of candidates) push(sanitizeMarketingProProviderPaletteColor(candidate));
  if (result.length === 0) {
    for (const color of fallback) push(sanitizeMarketingProProviderPaletteColor(color));
  }
  push(sanitizeMarketingProProviderPaletteColor(MARKETING_PRO_NEUTRAL_PALETTE_COLOR));
  return result;
}

export interface MarketingProProviderArtDirectionInput {
  readonly category: MarketingProCategory;
  readonly style: MarketingProStyle;
  readonly format: MarketingProFormat;
  /** Candidato não confiável (ex.: settings.primaryColor lido do Firestore) — validado internamente. */
  readonly primaryColor?: unknown;
}

/**
 * Função pura central — PRO-06B0.1 §11. Único lugar que monta um `MarketingProProviderArtDirection`
 * de verdade. As safe zones vêm sempre preenchidas com a geometria canônica do formato (nunca `[]`
 * quando existe geometria válida — §9); a palette é sempre validada (§8); lighting/surface/atmosphere
 * vêm do mapeamento determinístico por estilo (§6/§7), nunca de texto livre.
 */
export function buildMarketingProProviderArtDirection(
  input: MarketingProProviderArtDirectionInput,
): MarketingProProviderArtDirection {
  const metadata = MARKETING_PRO_STYLE_METADATA[input.style];
  const textZones = MARKETING_PRO_TEXT_ZONE[input.format];
  return {
    category: input.category,
    style: input.style,
    format: input.format,
    palette: buildMarketingProProviderPalette([input.primaryColor], metadata.paletteTendency),
    lighting: metadata.lighting,
    surface: metadata.surface,
    atmosphere: metadata.atmosphere,
    requestedSafeZones: [
      { region: "product", rect: MARKETING_PRO_PRODUCT_ZONE[input.format], guarantee: "requested-only" },
      { region: "primaryText", rect: textZones.primaryText, guarantee: "requested-only" },
      { region: "secondaryText", rect: textZones.secondaryText, guarantee: "requested-only" },
      { region: "callToAction", rect: textZones.callToAction, guarantee: "requested-only" },
    ],
  };
}

/** Alias explícito do PRO-13: a spec de cenário É o contrato provider-safe existente. */
export type MarketingProBackgroundSpec = MarketingProProviderArtDirection;

const CONCEPT_FAMILY_PROVIDER_PROFILE: Record<CreativeFamily, {
  readonly style: MarketingProStyle;
  readonly lighting: MarketingProLightingId;
  readonly surface: MarketingProSurfaceId;
  readonly atmosphere: MarketingProAtmosphereId;
}> = {
  luxury: { style: "luxury", lighting: "dramatic", surface: "reflective", atmosphere: "refined" },
  editorial: { style: "editorial", lighting: "studio", surface: "clean", atmosphere: "structured" },
  modern: { style: "modern", lighting: "cinematic", surface: "pedestal", atmosphere: "energetic" },
  minimal: { style: "minimal", lighting: "natural", surface: "matte", atmosphere: "quiet" },
  sensory: { style: "sensory", lighting: "soft", surface: "textured", atmosphere: "tactile" },
  "fresh-premium": { style: "minimal", lighting: "natural", surface: "clean", atmosphere: "refined" },
  "fresh-sport": { style: "modern", lighting: "cinematic", surface: "pedestal", atmosphere: "energetic" },
  "fresh-commercial": { style: "editorial", lighting: "studio", surface: "clean", atmosphere: "energetic" },
};

/** Estilo legado derivado server-side; o client nunca escolhe esse valor no fluxo por conceito. */
export function resolveMarketingProStyleForCreativeFamily(family: CreativeFamily): MarketingProStyle {
  return CONCEPT_FAMILY_PROVIDER_PROFILE[family].style;
}

function normalizedColorSignal(value: unknown): string {
  return typeof value === "string"
    ? value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase()
    : "";
}

/** Paletas complementares fechadas; o texto/cor arbitrária do produto nunca vira prompt. */
function complementaryPaletteForUnderstanding(understanding: ProductVisualUnderstanding): readonly string[] {
  const colorSignals = [
    ...(understanding.observed.dominantColors || []),
    ...(understanding.observed.secondaryColors || []),
  ].map(normalizedColorSignal).join(" ");
  if (/red|vermelh|crimson|bordo|orange|laranj/.test(colorSignals)) return ["#0F766E", "#E0F2FE"];
  if (/blue|azul|cyan|ciano|turquoise|turquesa/.test(colorSignals)) return ["#F59E0B", "#FFF7ED"];
  if (/green|verde/.test(colorSignals)) return ["#7C3AED", "#F5F3FF"];
  if (/yellow|amarel|gold|dourad/.test(colorSignals)) return ["#3730A3", "#EEF2FF"];
  if (/black|preto|dark|escuro|navy|marinho/.test(colorSignals)) return ["#F8FAFC", "#D4AF37"];
  if (/white|branc|ivory|marfim|light|claro|beige|bege/.test(colorSignals)) return ["#1E293B", "#CBD5E1"];
  return [];
}

function heroZoneContrastForUnderstanding(
  understanding: ProductVisualUnderstanding,
): NonNullable<MarketingProBackgroundSpec["visualProductHints"]>["heroZoneContrast"] {
  const brightness = understanding.observed.perceivedBrightness;
  if (brightness === "light" || brightness === "very_light") return "darker-than-product";
  if (brightness === "dark" || brightness === "very_dark") return "lighter-than-product";
  return "neutral-separated";
}

function shouldAvoidSimilarHeroHue(understanding: ProductVisualUnderstanding): boolean {
  const colorSignals = [
    ...(understanding.observed.dominantColors || []),
    ...(understanding.observed.secondaryColors || []),
  ].map(normalizedColorSignal).join(" ");
  return /red|vermelh|crimson|bordo|orange|laranj|blue|azul|cyan|ciano|turquoise|turquesa|green|verde|yellow|amarel|gold|dourad|purple|roxo|violet|violeta|pink|rosa/.test(colorSignals);
}

export interface MarketingProConceptSelectionSpecInput {
  readonly creativeConceptId: string;
  readonly creativeFamily: CreativeFamily;
  readonly category: MarketingProCategory;
  readonly format: MarketingProFormat;
  readonly productUnderstanding: ProductVisualUnderstanding;
  readonly primaryColor?: unknown;
}

/**
 * CreativeConcept escolhido → spec fechada. O id é usado só para auditoria/idempotência no caller;
 * o provider recebe exclusivamente enums, hex válidos e safe zones canônicas.
 */
export function buildMarketingProBackgroundSpecFromConceptSelection(input: MarketingProConceptSelectionSpecInput): MarketingProBackgroundSpec {
  if (!input.creativeConceptId.trim() || input.creativeConceptId.length > 120) throw new Error("invalid creativeConceptId");
  const profile = CONCEPT_FAMILY_PROVIDER_PROFILE[input.creativeFamily];
  const base = buildMarketingProProviderArtDirection({ category: input.category, style: profile.style, format: input.format, primaryColor: input.primaryColor });
  const complementary = complementaryPaletteForUnderstanding(input.productUnderstanding);
  const palette = buildMarketingProProviderPalette(
    complementary.length > 0 ? complementary : [input.primaryColor],
    MARKETING_PRO_STYLE_METADATA[profile.style].paletteTendency,
  );
  return {
    ...base,
    creativeFamily: input.creativeFamily,
    requestedSafeZones: [
      { region: "product", rect: resolveMarketingProProductPlacement({ format: input.format, creativeFamily: input.creativeFamily, productUnderstanding: input.productUnderstanding }).rect, guarantee: "requested-only" },
      ...base.requestedSafeZones.filter((zone) => zone.region !== "product"),
    ],
    palette,
    lighting: profile.lighting,
    surface: profile.surface,
    atmosphere: profile.atmosphere,
    visualProductHints: {
      orientation: input.productUnderstanding.observed.productOrientation,
      brightness: input.productUnderstanding.observed.perceivedBrightness,
      contrast: input.productUnderstanding.inferred.recommendedBackgroundContrast,
      heroZoneContrast: heroZoneContrastForUnderstanding(input.productUnderstanding),
      avoidSimilarHue: shouldAvoidSimilarHeroHue(input.productUnderstanding),
      silhouette: input.productUnderstanding.observed.productOrientation === "landscape"
        ? "wide-horizontal"
        : input.productUnderstanding.observed.productOrientation === "portrait"
          ? "tall-vertical"
          : input.productUnderstanding.observed.productOrientation === "square"
            ? "compact-square"
            : input.productUnderstanding.observed.productOrientation === "irregular"
              ? "irregular"
              : undefined,
    },
  };
}
