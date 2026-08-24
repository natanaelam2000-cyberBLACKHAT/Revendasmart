/**
 * PRO-11A — Product Understanding provider-agnostic e sem I/O.
 *
 * ProductTruth é TRUSTED. `observed` contém apenas sinais da imagem. `inferred` contém direção
 * probabilística e nunca claims. Este módulo não importa SDK, Firebase, client ou server.
 */
import {
  validateProductVisualUnderstanding,
  type CreativeDecisionTrace,
  type CreativeFamily,
  type ProductObservedVisualSignals,
  type ProductTruth,
  type ProductVisualUnderstanding,
  type RecommendedBackgroundContrast,
} from "./marketing-pro-creative-intelligence";

const CREATIVE_FAMILY_VALUES: readonly CreativeFamily[] = [
  "luxury",
  "editorial",
  "modern",
  "minimal",
  "sensory",
  "fresh-premium",
  "fresh-sport",
  "fresh-commercial",
];

const OBSERVED_KEYS = new Set([
  "dominantColors",
  "secondaryColors",
  "perceivedBrightness",
  "visualWeight",
  "productShape",
  "productOrientation",
  "visualComplexity",
]);
const INFERRED_KEYS = new Set([
  "contrastNeeds",
  "recommendedBackgroundContrast",
  "visualMoodCandidates",
  "commercialToneCandidates",
  "recommendedCreativeFamilies",
  "avoidCreativeFamilies",
  "recommendedEnvironmentHints",
  "avoidEnvironmentHints",
]);
const ROOT_KEYS = new Set(["version", "sourceImageAssetId", "observed", "inferred", "confidence"]);

export interface ProductVisualAnalysisImageInput {
  readonly assetId: string;
  readonly mimeType: string;
  readonly bytes: Uint8Array;
}

/** Input mínimo permitido a qualquer implementação futura, sem UID, cliente, telefone ou finanças. */
export interface ProductVisualAnalysisInput {
  readonly image: ProductVisualAnalysisImageInput;
  readonly trustedContext: Pick<ProductTruth, "category" | "color">;
}

/** Implementações concretas futuras pertencem ao server; o contrato compartilhado não conhece fornecedor. */
export interface ProductVisualAnalyzer {
  readonly id: string;
  analyzeProductVisual(input: ProductVisualAnalysisInput): Promise<ProductVisualUnderstanding>;
}

export type ProductVisualUnderstandingParseResult =
  | { readonly accepted: true; readonly value: ProductVisualUnderstanding }
  | { readonly accepted: false; readonly errors: readonly string[] };

export interface ProductUnderstandingResult {
  readonly visualUnderstanding: ProductVisualUnderstanding;
  readonly decisionTrace: readonly CreativeDecisionTrace[];
}

export interface ProductUnderstandingFallbackInput {
  readonly truth: ProductTruth;
  readonly sourceImageAssetId?: string;
  readonly observed?: ProductObservedVisualSignals;
}

export interface AuthoritativeProductVisualRulesInput {
  readonly truth: ProductTruth;
  readonly visualUnderstanding: ProductVisualUnderstanding;
}

export interface CategoryCreativeHints {
  readonly visualMoodCandidates: readonly string[];
  readonly commercialToneCandidates: readonly string[];
  readonly recommendedCreativeFamilies: readonly CreativeFamily[];
  readonly recommendedEnvironmentHints: readonly string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.length <= 24 && value.every((item) => typeof item === "string" && item.trim().length > 0 && item.length <= 120);
}

function optionalStringArray(value: unknown): boolean {
  return value === undefined || isStringArray(value);
}

function isCreativeFamilyArray(value: unknown): value is readonly CreativeFamily[] {
  return Array.isArray(value) && value.length <= CREATIVE_FAMILY_VALUES.length
    && value.every((item) => CREATIVE_FAMILY_VALUES.includes(item as CreativeFamily));
}

/** Parser fechado para output de analyzer futuro: campos extras falham, nunca são ignorados. */
export function parseProductVisualUnderstandingOutput(value: unknown): ProductVisualUnderstandingParseResult {
  const errors: string[] = [];
  if (!isRecord(value)) return { accepted: false, errors: ["output must be an object"] };
  if (!hasOnlyKeys(value, ROOT_KEYS)) errors.push("output contains unknown root fields");
  if (!isRecord(value.observed)) errors.push("observed must be an object");
  else {
    if (!hasOnlyKeys(value.observed, OBSERVED_KEYS)) errors.push("observed contains unknown fields");
    if (!optionalStringArray(value.observed.dominantColors)) errors.push("dominantColors must be a bounded string array");
    if (!optionalStringArray(value.observed.secondaryColors)) errors.push("secondaryColors must be a bounded string array");
    if (value.observed.perceivedBrightness !== undefined && !["very_dark", "dark", "balanced", "light", "very_light"].includes(String(value.observed.perceivedBrightness))) errors.push("invalid perceivedBrightness");
    if (value.observed.visualWeight !== undefined && !["light", "balanced", "heavy"].includes(String(value.observed.visualWeight))) errors.push("invalid visualWeight");
    if (value.observed.productOrientation !== undefined && !["portrait", "landscape", "square", "irregular"].includes(String(value.observed.productOrientation))) errors.push("invalid productOrientation");
    if (value.observed.visualComplexity !== undefined && !["low", "medium", "high"].includes(String(value.observed.visualComplexity))) errors.push("invalid visualComplexity");
    if (value.observed.productShape !== undefined && (typeof value.observed.productShape !== "string" || value.observed.productShape.trim().length === 0 || value.observed.productShape.length > 120)) errors.push("invalid productShape");
  }
  if (!isRecord(value.inferred)) errors.push("inferred must be an object");
  else {
    if (!hasOnlyKeys(value.inferred, INFERRED_KEYS)) errors.push("inferred contains unknown fields");
    for (const key of ["contrastNeeds", "visualMoodCandidates", "commercialToneCandidates", "recommendedEnvironmentHints", "avoidEnvironmentHints"] as const) {
      if (!optionalStringArray(value.inferred[key])) errors.push(`${key} must be a bounded string array`);
    }
    if (value.inferred.recommendedBackgroundContrast !== undefined && !["soft", "medium", "high"].includes(String(value.inferred.recommendedBackgroundContrast))) errors.push("invalid recommendedBackgroundContrast");
    if (value.inferred.recommendedCreativeFamilies !== undefined && !isCreativeFamilyArray(value.inferred.recommendedCreativeFamilies)) errors.push("invalid recommendedCreativeFamilies");
    if (value.inferred.avoidCreativeFamilies !== undefined && !isCreativeFamilyArray(value.inferred.avoidCreativeFamilies)) errors.push("invalid avoidCreativeFamilies");
  }
  const canonical = validateProductVisualUnderstanding(value);
  if (!canonical.valid) errors.push(...canonical.errors);
  return errors.length === 0
    ? { accepted: true, value: value as unknown as ProductVisualUnderstanding }
    : { accepted: false, errors: Array.from(new Set(errors)) };
}

function normalizedText(value: unknown): string {
  return typeof value === "string" ? value.trim().toLocaleLowerCase("pt-BR").normalize("NFD").replace(/[\u0300-\u036f]/g, "") : "";
}

function unique<T>(values: readonly T[]): readonly T[] {
  return Array.from(new Set(values));
}

function productDescriptor(truth: ProductTruth): string {
  return [truth.name, truth.category, truth.subcategory, truth.specifications?.niche].map(normalizedText).filter(Boolean).join(" ");
}

/** Hints criativos genéricos; nunca especificações, ingredientes, benefícios ou claims. */
export function resolveCategoryCreativeHints(truth: ProductTruth): CategoryCreativeHints {
  const descriptor = productDescriptor(truth);
  if (/perfume|fragrancia|cosmetic|beleza|skincare|hidratante|maquiagem/.test(descriptor)) {
    return {
      visualMoodCandidates: ["clean", "fresh", "refined"],
      commercialToneCandidates: ["premium", "soft", "sensory"],
      recommendedCreativeFamilies: ["editorial", "sensory", "fresh-premium"],
      recommendedEnvironmentHints: ["clean beauty stage", "subtle material surface"],
    };
  }
  if (/eletronic|celular|informatica|audio|game|fone|controle/.test(descriptor)) {
    return {
      visualMoodCandidates: ["clean-tech", "precise", "dynamic"],
      commercialToneCandidates: ["performance", "modern"],
      recommendedCreativeFamilies: ["modern", "minimal", "fresh-sport"],
      recommendedEnvironmentHints: ["clean technology stage", "controlled geometric accents"],
    };
  }
  if (/casa|decoracao|moveis|movel|sala|quarto|conforto/.test(descriptor)) {
    return {
      visualMoodCandidates: ["comfortable", "spacious", "lifestyle"],
      commercialToneCandidates: ["welcoming", "editorial"],
      recommendedCreativeFamilies: ["editorial", "modern"],
      recommendedEnvironmentHints: ["contextual interior suggestion", "spacious product stage"],
    };
  }
  if (/doce|alimento|bolo|brigadeiro|trufa|bebida|marmita/.test(descriptor)) {
    return {
      visualMoodCandidates: ["warm", "appetizing", "celebratory"],
      commercialToneCandidates: ["artisanal", "inviting"],
      recommendedCreativeFamilies: ["sensory", "editorial", "fresh-commercial"],
      recommendedEnvironmentHints: ["warm food stage", "subtle artisanal texture"],
    };
  }
  if (/roupa|moda|acessorio|bolsa|relogio|joia|calcado/.test(descriptor)) {
    return {
      visualMoodCandidates: ["styled", "editorial", "confident"],
      commercialToneCandidates: ["fashion-forward", "premium"],
      recommendedCreativeFamilies: ["editorial", "luxury", "modern"],
      recommendedEnvironmentHints: ["editorial fashion stage", "clean material backdrop"],
    };
  }
  return {
    visualMoodCandidates: ["clear", "product-led"],
    commercialToneCandidates: ["commercial", "accessible"],
    recommendedCreativeFamilies: ["editorial", "modern"],
    recommendedEnvironmentHints: ["neutral product stage"],
  };
}

const RED_TOKENS = ["red", "vermelho", "vermelha", "bordo", "carmesim"];
const LIGHT_TOKENS = ["white", "branco", "branca", "ivory", "marfim", "claro", "clara", "beige", "bege"];
const DARK_TOKENS = ["black", "preto", "preta", "dark", "escuro", "escura", "navy", "marinho"];
const LOW_SATURATION_TOKENS = ["gray", "grey", "cinza", "beige", "bege", "neutral", "neutro", "branco", "white", "preto", "black"];

function hasColorToken(colors: readonly string[], tokens: readonly string[]): boolean {
  const normalized = colors.map(normalizedText);
  return normalized.some((color) => tokens.some((token) => color.includes(token)));
}

function resolveSourceAssetId(truth: ProductTruth, explicit: string | undefined): string {
  const candidates: readonly (string | undefined)[] = [
    explicit,
    truth.approvedCutout?.sourceAssetId,
    truth.imageAsset?.imageId,
    truth.imageAsset?.storagePath,
    truth.imageAsset?.imageUrl,
  ];
  return candidates.find((value) => typeof value === "string" && value.trim().length > 0)?.trim()
    || `product:${truth.productId}:registered-data-only`;
}

function resolveContrast(
  truth: ProductTruth,
  observed: ProductObservedVisualSignals,
): {
  readonly contrast: RecommendedBackgroundContrast;
  readonly contrastNeeds: readonly string[];
  readonly avoidEnvironmentHints: readonly string[];
  readonly paletteTrace?: CreativeDecisionTrace;
} {
  const colors = [truth.color, ...(observed.dominantColors || [])].filter((value): value is string => Boolean(value));
  const isRed = hasColorToken(colors, RED_TOKENS);
  const isLight = observed.perceivedBrightness === "light" || observed.perceivedBrightness === "very_light" || hasColorToken(colors, LIGHT_TOKENS);
  const isDark = observed.perceivedBrightness === "dark" || observed.perceivedBrightness === "very_dark" || hasColorToken(colors, DARK_TOKENS);
  const needs = ["keep product as the visual protagonist"];
  const avoids: string[] = [];
  if (isRed) {
    needs.push("use complementary or clearly separated background color");
    avoids.push("monochrome red background close to product color");
  }
  if (isLight) {
    needs.push("separate light product from background");
    avoids.push("very light low-separation background");
  }
  if (isDark) {
    needs.push("separate dark product from background");
    avoids.push("very dark low-separation background");
  }
  return {
    contrast: isRed || isLight || isDark ? "high" : "medium",
    contrastNeeds: needs,
    avoidEnvironmentHints: avoids,
    ...(isRed ? { paletteTrace: { decision: "paletteStrategy", source: "commercial_coherence", rule: "avoid_color_camouflage", result: "complementary_contrast" } } : {}),
  };
}

/**
 * Reaplica as regras locais determinísticas DEPOIS de qualquer analyzer externo. O analyzer pode
 * sugerir direção visual, mas nunca pode enfraquecer separação de fundo/produto nem camuflar cores.
 */
export function applyAuthoritativeProductVisualRules(input: AuthoritativeProductVisualRulesInput): ProductUnderstandingResult {
  const parsedInput = parseProductVisualUnderstandingOutput(input.visualUnderstanding);
  if (!parsedInput.accepted) throw new Error(`Invalid ProductVisualUnderstanding: ${parsedInput.errors.join(", ")}`);
  const current = parsedInput.value;
  const contrast = resolveContrast(input.truth, current.observed);
  const categoryHints = resolveCategoryCreativeHints(input.truth);
  const inferred = current.inferred;
  const blocksRedCamouflage = contrast.avoidEnvironmentHints.includes("monochrome red background close to product color");
  const externallyRecommendedEnvironments = (inferred.recommendedEnvironmentHints || []).filter((hint) => (
    !blocksRedCamouflage || !RED_TOKENS.some((token) => normalizedText(hint).includes(token))
  ));
  const recommendedCreativeFamilies = unique([
    ...(inferred.recommendedCreativeFamilies || []),
    ...categoryHints.recommendedCreativeFamilies,
  ]).filter((family) => !(inferred.avoidCreativeFamilies || []).includes(family));
  const visualUnderstanding: ProductVisualUnderstanding = {
    ...current,
    inferred: {
      ...inferred,
      contrastNeeds: unique([...(inferred.contrastNeeds || []), ...contrast.contrastNeeds]).slice(0, 24),
      recommendedBackgroundContrast: contrast.contrast === "high"
        ? "high"
        : inferred.recommendedBackgroundContrast || contrast.contrast,
      recommendedCreativeFamilies: recommendedCreativeFamilies.slice(0, CREATIVE_FAMILY_VALUES.length),
      recommendedEnvironmentHints: unique([
        ...externallyRecommendedEnvironments,
        ...categoryHints.recommendedEnvironmentHints,
      ]).slice(0, 24),
      avoidEnvironmentHints: unique([
        ...(inferred.avoidEnvironmentHints || []),
        ...contrast.avoidEnvironmentHints,
      ]).slice(0, 24),
    },
  };
  const parsed = parseProductVisualUnderstandingOutput(visualUnderstanding);
  if (!parsed.accepted) throw new Error(`Invalid locally reconciled ProductVisualUnderstanding: ${parsed.errors.join(", ")}`);
  const decisionTrace: CreativeDecisionTrace[] = [
    { decision: "backgroundContrast", source: "commercial_coherence", rule: "local_rules_override_external_inference", result: contrast.contrast },
  ];
  if (contrast.paletteTrace) decisionTrace.push(contrast.paletteTrace);
  return { visualUnderstanding: parsed.value, decisionTrace };
}

export function buildProductUnderstandingFallback(input: ProductUnderstandingFallbackInput): ProductUnderstandingResult {
  const observed: ProductObservedVisualSignals = { ...(input.observed || {}) };
  const categoryHints = resolveCategoryCreativeHints(input.truth);
  const contrast = resolveContrast(input.truth, observed);
  const colors = [input.truth.color, ...(observed.dominantColors || [])].filter((value): value is string => Boolean(value));
  const lowSaturation = colors.length > 0 && colors.every((color) => hasColorToken([color], LOW_SATURATION_TOKENS));
  const recommended = [...categoryHints.recommendedCreativeFamilies];
  const avoided: CreativeFamily[] = [];
  const trace: CreativeDecisionTrace[] = [
    { decision: "categoryCreativeHints", source: "product_truth", rule: "category_is_direction_not_claim", result: categoryHints.visualMoodCandidates.join(",") },
    { decision: "backgroundContrast", source: "commercial_coherence", rule: "preserve_product_separation", result: contrast.contrast },
  ];
  if (contrast.paletteTrace) trace.push(contrast.paletteTrace);
  if (lowSaturation) {
    recommended.unshift("modern", "sensory");
    trace.push({ decision: "creativeFamily", source: "commercial_coherence", rule: "allow_expressive_stage_for_low_saturation_product", result: "modern,sensory" });
  }
  if (observed.visualComplexity === "high") {
    avoided.push("sensory");
    trace.push({ decision: "avoidCreativeFamily", source: "commercial_coherence", rule: "avoid_competing_visual_complexity", result: "sensory" });
  }
  if ((observed.perceivedBrightness === "light" || observed.perceivedBrightness === "very_light") && categoryHints.visualMoodCandidates.includes("fresh")) {
    avoided.push("luxury");
    trace.push({ decision: "avoidCreativeFamily", source: "commercial_coherence", rule: "avoid_heavy_dark_treatment_for_strong_fresh_direction", result: "luxury" });
  }
  const safeRecommended = unique(recommended).filter((family) => !avoided.includes(family));
  const evidenceCount = Number(Boolean(input.truth.category)) + Number(colors.length > 0) + Number(Boolean(observed.perceivedBrightness)) + Number(Boolean(observed.visualComplexity));
  const confidence = Math.min(0.55, 0.2 + evidenceCount * 0.1);
  const visualUnderstanding: ProductVisualUnderstanding = {
    version: 1,
    sourceImageAssetId: resolveSourceAssetId(input.truth, input.sourceImageAssetId),
    observed,
    inferred: {
      contrastNeeds: contrast.contrastNeeds,
      recommendedBackgroundContrast: contrast.contrast,
      visualMoodCandidates: categoryHints.visualMoodCandidates,
      commercialToneCandidates: categoryHints.commercialToneCandidates,
      recommendedCreativeFamilies: safeRecommended,
      avoidCreativeFamilies: unique(avoided),
      recommendedEnvironmentHints: categoryHints.recommendedEnvironmentHints,
      avoidEnvironmentHints: contrast.avoidEnvironmentHints,
    },
    confidence,
  };
  const parsed = parseProductVisualUnderstandingOutput(visualUnderstanding);
  if (!parsed.accepted) throw new Error(`Invalid fallback ProductVisualUnderstanding: ${parsed.errors.join(", ")}`);
  return { visualUnderstanding: parsed.value, decisionTrace: trace };
}
