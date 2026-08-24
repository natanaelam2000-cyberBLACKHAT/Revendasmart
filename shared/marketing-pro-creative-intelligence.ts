/**
 * PRO-09 — Creative Intelligence Foundation.
 *
 * Contratos puros, serializáveis e provider-agnostic. Este módulo não importa Firebase, rede,
 * SDKs de IA nem código do client/server. Ele decide a direção publicitária antes de qualquer
 * geração e nunca altera o asset original ou o cutout aprovado.
 */
import type { ApprovedProductCutout } from "./approved-product-cutout";

export const CREATIVE_INTELLIGENCE_CONTRACT_VERSION = 1 as const;

export const CREATIVE_DECISION_PRIORITY = [
  "product_truth",
  "commercial_coherence",
  "campaign_objective",
  "seller_preferences",
] as const;

export type CreativeDecisionSource = (typeof CREATIVE_DECISION_PRIORITY)[number];
export type CreativeInformationSource = "trusted" | "observed" | "inferred";

export const MARKETING_CAMPAIGN_INTENT_IDS = [
  "spotlight",
  "promo",
  "last",
  "new",
  "bestseller",
  "kit",
  "catalog",
  "whatsapp",
  "delivery",
  "preorder",
  "premium_spotlight",
  "elegant_offer",
  "luxury",
  "minimal_pro",
  "promo_impact",
] as const;

export type MarketingCampaignIntentId = (typeof MARKETING_CAMPAIGN_INTENT_IDS)[number];
export type CampaignObjective =
  | "product_highlight"
  | "special_offer"
  | "last_units"
  | "launch"
  | "bestseller"
  | "kit"
  | "catalog"
  | "conversation"
  | "delivery"
  | "preorder"
  | "premium_positioning";

const CAMPAIGN_OBJECTIVE_BY_INTENT: Record<MarketingCampaignIntentId, CampaignObjective> = {
  spotlight: "product_highlight",
  promo: "special_offer",
  last: "last_units",
  new: "launch",
  bestseller: "bestseller",
  kit: "kit",
  catalog: "catalog",
  whatsapp: "conversation",
  delivery: "delivery",
  preorder: "preorder",
  premium_spotlight: "premium_positioning",
  elegant_offer: "special_offer",
  luxury: "premium_positioning",
  minimal_pro: "premium_positioning",
  promo_impact: "special_offer",
};

export interface ProductImageAssetReference {
  readonly imageId?: string;
  readonly imageUrl?: string;
  readonly storagePath?: string;
}

/** Projeção dos dados já existentes no cadastro/backend; não é um segundo schema de produto. */
export interface ProductTruth {
  readonly productId: string;
  readonly name: string;
  readonly brand?: string;
  readonly category?: string;
  readonly subcategory?: string;
  readonly salePrice?: number;
  readonly promotionalPrice?: number;
  readonly volume?: string;
  readonly size?: string;
  readonly variant?: string;
  readonly color?: string;
  readonly availability?: string;
  readonly description?: string;
  readonly specifications?: Readonly<Record<string, string>>;
  readonly imageAsset?: ProductImageAssetReference;
  readonly approvedCutout?: ApprovedProductCutout;
}

export type PerceivedBrightness = "very_dark" | "dark" | "balanced" | "light" | "very_light";
export type RecommendedBackgroundContrast = "soft" | "medium" | "high";

/** OBSERVED: sinais descritivos medidos/observados na imagem, nunca claims comerciais. */
export interface ProductObservedVisualSignals {
  readonly dominantColors?: readonly string[];
  readonly secondaryColors?: readonly string[];
  readonly perceivedBrightness?: PerceivedBrightness;
  readonly visualWeight?: "light" | "balanced" | "heavy";
  readonly productShape?: string;
  readonly productOrientation?: "portrait" | "landscape" | "square" | "irregular";
  readonly visualComplexity?: "low" | "medium" | "high";
}

/** INFERRED: recomendações probabilísticas; orientam direção visual, nunca viram fatos do anúncio. */
export interface ProductInferredVisualDirection {
  readonly contrastNeeds?: readonly string[];
  readonly recommendedBackgroundContrast?: RecommendedBackgroundContrast;
  readonly visualMoodCandidates?: readonly string[];
  readonly commercialToneCandidates?: readonly string[];
  readonly recommendedCreativeFamilies?: readonly CreativeFamily[];
  readonly avoidCreativeFamilies?: readonly CreativeFamily[];
  readonly recommendedEnvironmentHints?: readonly string[];
  readonly avoidEnvironmentHints?: readonly string[];
}

export interface ProductVisualUnderstanding {
  readonly version: 1;
  readonly sourceImageAssetId: string;
  readonly observed: ProductObservedVisualSignals;
  readonly inferred: ProductInferredVisualDirection;
  readonly confidence: number;
}

/**
 * Contexto canônico consumido pelo Creative Director e pelo Composer V2. Os três campos finais
 * preservam compatibilidade com os hints já usados pelo Composer V2; não representam fatos novos.
 */
export interface ProductCreativeContext {
  readonly version?: 1;
  readonly productId?: string;
  readonly truth?: ProductTruth;
  readonly visualUnderstanding?: ProductVisualUnderstanding;
  readonly category?: string;
  readonly dominantColorFamily?: string;
  readonly accentColorFamily?: string;
}

export const CREATIVE_FAMILY_VALUES = [
  "luxury", "editorial", "modern", "minimal", "sensory",
  "fresh-premium", "fresh-sport", "fresh-commercial",
] as const;

export type CreativeFamily = (typeof CREATIVE_FAMILY_VALUES)[number];

export function isCreativeFamily(value: unknown): value is CreativeFamily {
  return typeof value === "string" && (CREATIVE_FAMILY_VALUES as readonly string[]).includes(value);
}

export interface SellerCreativePreferences {
  readonly visualStyles?: readonly CreativeFamily[];
  readonly informationDensity?: "low" | "balanced" | "high";
  readonly productEmphasis?: "subtle" | "balanced" | "hero";
  readonly priceEmphasis?: "subtle" | "standard" | "highlight";
  readonly promotionIntensity?: "low" | "balanced" | "high";
  readonly typographyPreference?: "clean" | "editorial" | "expressive";
  readonly compositionPreference?: "minimal" | "balanced" | "dynamic";
  readonly colorTendencies?: readonly string[];
  readonly preferredCreativeFamilies?: readonly CreativeFamily[];
  readonly dislikedCreativeFamilies?: readonly CreativeFamily[];
}

export interface SellerCreativeProfile {
  readonly version: 1;
  readonly globalPreferences: SellerCreativePreferences;
  readonly categoryPreferences?: Readonly<Record<string, SellerCreativePreferences>>;
  readonly confidence: number;
  readonly sampleCount: number;
  readonly updatedAt: string;
}

export interface CampaignCreativeIntent {
  readonly version: 1;
  /** Reutiliza diretamente os ids do catálogo MARKETING_TEMPLATES. */
  readonly id: MarketingCampaignIntentId;
  readonly objective: CampaignObjective;
  readonly requestedInformationDensity?: "low" | "balanced" | "high";
}

export interface CreativeDecisionTrace {
  readonly decision: string;
  readonly source: CreativeDecisionSource;
  readonly rule: string;
  readonly result: string;
}

export interface AllowedCreativeClaim {
  readonly field: string;
  readonly value: string | number;
  readonly source: "trusted";
}

export interface CreativeBrief {
  readonly version: 1;
  readonly id: string;
  readonly productId: string;
  readonly campaignIntentId: MarketingCampaignIntentId;
  readonly productPositioning: "protected_hero";
  readonly visualObjective: CampaignObjective;
  readonly creativeFamily: CreativeFamily;
  readonly paletteStrategy: "contrastive" | "complementary" | "neutral" | "category_led";
  readonly contrastStrategy: RecommendedBackgroundContrast;
  readonly environmentDirection: readonly string[];
  readonly lightingDirection: "soft" | "natural" | "dramatic" | "studio";
  readonly compositionDirection: "minimal" | "balanced" | "dynamic";
  readonly productProminence: "hero";
  readonly informationDensity: "low" | "balanced" | "high";
  readonly priceTreatment: "subtle" | "standard" | "highlight";
  readonly promotionTreatment: "none" | "subtle" | "balanced" | "strong";
  readonly typographyDirection: "clean" | "editorial" | "expressive";
  readonly decorativeElementDirection: "restrained" | "balanced" | "expressive";
  readonly allowedClaims: readonly AllowedCreativeClaim[];
  readonly forbiddenClaims: readonly string[];
  readonly constraints: readonly string[];
  readonly decisionTrace: readonly CreativeDecisionTrace[];
}

export interface CreativeConcept {
  readonly id: string;
  readonly label: string;
  readonly creativeFamily: CreativeFamily;
  readonly visualDirection: string;
  readonly palette: readonly string[];
  readonly environment: readonly string[];
  readonly lighting: string;
  readonly composition: string;
  readonly productPlacement: string;
  readonly priceTreatment: CreativeBrief["priceTreatment"];
  readonly promotionTreatment: CreativeBrief["promotionTreatment"];
  readonly informationHierarchy: readonly string[];
}

export type ContractValidationResult =
  | { readonly valid: true }
  | { readonly valid: false; readonly errors: readonly string[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isConfidence(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

export function isMarketingCampaignIntentId(value: unknown): value is MarketingCampaignIntentId {
  return typeof value === "string" && (MARKETING_CAMPAIGN_INTENT_IDS as readonly string[]).includes(value);
}

export function createCampaignCreativeIntent(id: MarketingCampaignIntentId): CampaignCreativeIntent {
  return { version: 1, id, objective: CAMPAIGN_OBJECTIVE_BY_INTENT[id] };
}

export function validateProductVisualUnderstanding(value: unknown): ContractValidationResult {
  const errors: string[] = [];
  if (!isRecord(value)) return { valid: false, errors: ["visualUnderstanding must be an object"] };
  if (value.version !== 1) errors.push("visualUnderstanding.version must be 1");
  if (!isNonEmptyString(value.sourceImageAssetId)) errors.push("sourceImageAssetId is required");
  if (!isRecord(value.observed)) errors.push("observed visual signals must be an object");
  if (!isRecord(value.inferred)) errors.push("inferred visual direction must be an object");
  if (!isConfidence(value.confidence)) errors.push("confidence must be between 0 and 1");
  return errors.length === 0 ? { valid: true } : { valid: false, errors };
}

export function validateProductCreativeContext(value: unknown): ContractValidationResult {
  const errors: string[] = [];
  if (!isRecord(value)) return { valid: false, errors: ["product context must be an object"] };
  if (value.version !== undefined && value.version !== 1) errors.push("context.version must be 1");
  if (value.truth !== undefined) {
    if (!isRecord(value.truth)) errors.push("truth must be an object");
    else {
      if (!isNonEmptyString(value.truth.productId)) errors.push("truth.productId is required");
      if (!isNonEmptyString(value.truth.name)) errors.push("truth.name is required");
      if (isNonEmptyString(value.productId) && value.productId !== value.truth.productId) errors.push("productId must match truth.productId");
    }
  }
  if (value.visualUnderstanding !== undefined) {
    const visual = validateProductVisualUnderstanding(value.visualUnderstanding);
    if (!visual.valid) errors.push(...visual.errors);
  }
  return errors.length === 0 ? { valid: true } : { valid: false, errors };
}

export function validateSellerCreativeProfile(value: unknown): ContractValidationResult {
  const errors: string[] = [];
  if (!isRecord(value)) return { valid: false, errors: ["seller profile must be an object"] };
  if (value.version !== 1) errors.push("seller profile version must be 1");
  if (!isRecord(value.globalPreferences)) errors.push("globalPreferences is required");
  if (!isConfidence(value.confidence)) errors.push("confidence must be between 0 and 1");
  if (typeof value.sampleCount !== "number" || !Number.isInteger(value.sampleCount) || value.sampleCount < 0) errors.push("sampleCount must be a non-negative integer");
  if (!isNonEmptyString(value.updatedAt) || !Number.isFinite(Date.parse(value.updatedAt))) errors.push("updatedAt must be an ISO timestamp");
  return errors.length === 0 ? { valid: true } : { valid: false, errors };
}

export function validateCampaignCreativeIntent(value: unknown): ContractValidationResult {
  const errors: string[] = [];
  if (!isRecord(value)) return { valid: false, errors: ["campaign intent must be an object"] };
  if (value.version !== 1) errors.push("campaign intent version must be 1");
  if (!isMarketingCampaignIntentId(value.id)) errors.push("campaign intent id is not supported");
  else if (value.objective !== CAMPAIGN_OBJECTIVE_BY_INTENT[value.id]) errors.push("campaign objective does not match its canonical intent");
  return errors.length === 0 ? { valid: true } : { valid: false, errors };
}

function normalizeCategory(value: string | undefined): string {
  return (value || "").trim().toLocaleLowerCase("pt-BR");
}

/** Category-specific values replace global values only for fields explicitly present. */
export function resolveSellerCreativePreferences(
  profile: SellerCreativeProfile | undefined,
  category: string | undefined,
): SellerCreativePreferences {
  if (!profile) return {};
  const normalized = normalizeCategory(category);
  const categoryEntry = Object.entries(profile.categoryPreferences || {}).find(([key]) => normalizeCategory(key) === normalized)?.[1];
  return categoryEntry ? { ...profile.globalPreferences, ...categoryEntry } : { ...profile.globalPreferences };
}

function normalizeColor(value: string): string {
  return value.trim().toLocaleLowerCase("en-US").replace(/[^a-z0-9#]+/g, "-");
}

function colorsOverlap(productColors: readonly string[], preferredColors: readonly string[]): boolean {
  const products = productColors.map(normalizeColor).filter(Boolean);
  return preferredColors.map(normalizeColor).filter(Boolean).some((preference) =>
    products.some((product) => product === preference || product.includes(preference) || preference.includes(product)),
  );
}

function trustedClaims(truth: ProductTruth): readonly AllowedCreativeClaim[] {
  const claims: AllowedCreativeClaim[] = [];
  const add = (field: string, value: string | number | undefined): void => {
    if ((typeof value === "string" && value.trim()) || (typeof value === "number" && Number.isFinite(value))) {
      claims.push({ field, value: typeof value === "string" ? value.trim() : value, source: "trusted" });
    }
  };
  add("name", truth.name);
  add("brand", truth.brand);
  add("category", truth.category);
  add("subcategory", truth.subcategory);
  add("salePrice", truth.salePrice);
  add("promotionalPrice", truth.promotionalPrice);
  add("volume", truth.volume);
  add("size", truth.size);
  add("variant", truth.variant);
  add("color", truth.color);
  add("availability", truth.availability);
  add("description", truth.description);
  for (const [key, value] of Object.entries(truth.specifications || {})) add(`specifications.${key}`, value);
  return claims;
}

function campaignPriceTreatment(intent: CampaignCreativeIntent, preferences: SellerCreativePreferences): CreativeBrief["priceTreatment"] {
  if (intent.objective === "special_offer") return "highlight";
  return preferences.priceEmphasis || "standard";
}

function campaignPromotionTreatment(intent: CampaignCreativeIntent, preferences: SellerCreativePreferences): CreativeBrief["promotionTreatment"] {
  if (intent.objective === "special_offer" || intent.objective === "last_units") return "strong";
  if (intent.objective === "launch" || intent.objective === "bestseller") return "balanced";
  if (preferences.promotionIntensity === "high") return "strong";
  if (preferences.promotionIntensity === "balanced") return "balanced";
  if (preferences.promotionIntensity === "low") return "subtle";
  return "none";
}

export interface BuildCreativeBriefInput {
  readonly product: ProductCreativeContext;
  readonly campaignIntent: CampaignCreativeIntent;
  readonly sellerProfile?: SellerCreativeProfile;
}

/**
 * Creative Director determinístico. A ordem do algoritmo espelha CREATIVE_DECISION_PRIORITY e o
 * trace contém apenas regras/resultados auditáveis, nunca raciocínio livre ou chain-of-thought.
 */
export function buildCreativeBrief(input: BuildCreativeBriefInput): CreativeBrief {
  const productValidation = validateProductCreativeContext(input.product);
  if (!productValidation.valid) throw new Error(`Invalid ProductCreativeContext: ${productValidation.errors.join(", ")}`);
  const campaignValidation = validateCampaignCreativeIntent(input.campaignIntent);
  if (!campaignValidation.valid) throw new Error(`Invalid CampaignCreativeIntent: ${campaignValidation.errors.join(", ")}`);
  if (!input.product.truth) throw new Error("Product truth is required to build a CreativeBrief");
  if (input.sellerProfile) {
    const profileValidation = validateSellerCreativeProfile(input.sellerProfile);
    if (!profileValidation.valid) throw new Error(`Invalid SellerCreativeProfile: ${profileValidation.errors.join(", ")}`);
  }

  const truth = input.product.truth;
  const visual = input.product.visualUnderstanding;
  const preferences = resolveSellerCreativePreferences(input.sellerProfile, truth.category || input.product.category);
  const trace: CreativeDecisionTrace[] = [
    { decision: "productProminence", source: "product_truth", rule: "protect_real_product_identity", result: "hero" },
  ];

  const productColors = [truth.color, input.product.dominantColorFamily, ...(visual?.observed.dominantColors || [])].filter((value): value is string => Boolean(value));
  const preferredColors = preferences.colorTendencies || [];
  const antiCamouflage = colorsOverlap(productColors, preferredColors);
  let paletteStrategy: CreativeBrief["paletteStrategy"] = truth.category ? "category_led" : "neutral";
  if (antiCamouflage) {
    paletteStrategy = "contrastive";
    trace.push({ decision: "paletteStrategy", source: "commercial_coherence", rule: "avoid_color_camouflage", result: "contrastive" });
  } else if (preferredColors.length > 0) {
    paletteStrategy = "complementary";
    trace.push({ decision: "paletteStrategy", source: "seller_preferences", rule: "adapt_non_conflicting_color_tendency", result: "complementary" });
  }

  let contrastStrategy: RecommendedBackgroundContrast = visual?.inferred.recommendedBackgroundContrast || "medium";
  if (visual?.observed.perceivedBrightness === "light" || visual?.observed.perceivedBrightness === "very_light") contrastStrategy = "high";
  if (antiCamouflage) contrastStrategy = "high";
  if (visual?.inferred.recommendedBackgroundContrast || visual?.observed.perceivedBrightness || antiCamouflage) {
    trace.push({ decision: "backgroundContrast", source: "commercial_coherence", rule: antiCamouflage ? "avoid_color_camouflage" : "preserve_product_separation", result: contrastStrategy });
  }

  const avoided = new Set([...(visual?.inferred.avoidCreativeFamilies || []), ...(preferences.dislikedCreativeFamilies || [])]);
  const coherentFamily = (visual?.inferred.recommendedCreativeFamilies || []).find((family) => !avoided.has(family));
  const preferredFamily = [...(preferences.preferredCreativeFamilies || []), ...(preferences.visualStyles || [])].find((family) => !avoided.has(family));
  const creativeFamily: CreativeFamily = coherentFamily || preferredFamily || "editorial";
  trace.push({
    decision: "creativeFamily",
    source: coherentFamily ? "commercial_coherence" : preferredFamily ? "seller_preferences" : "commercial_coherence",
    rule: coherentFamily ? "use_product_compatible_family" : preferredFamily ? "apply_non_conflicting_preference" : "use_neutral_fallback",
    result: creativeFamily,
  });

  const categoryKey = normalizeCategory(truth.category || input.product.category);
  if (categoryKey && input.sellerProfile && Object.keys(input.sellerProfile.categoryPreferences || {}).some((key) => normalizeCategory(key) === categoryKey)) {
    trace.push({ decision: "sellerPreferenceScope", source: "seller_preferences", rule: "category_overrides_global_when_safe", result: categoryKey });
  }

  trace.push({ decision: "visualObjective", source: "campaign_objective", rule: "honor_canonical_campaign_intent", result: input.campaignIntent.objective });

  const informationDensity = input.campaignIntent.requestedInformationDensity || preferences.informationDensity || "balanced";
  const compositionDirection = preferences.compositionPreference || "balanced";
  const typographyDirection = preferences.typographyPreference || "clean";
  const environmentDirection = visual?.inferred.recommendedEnvironmentHints?.length ? [...visual.inferred.recommendedEnvironmentHints] : truth.category ? [`category:${truth.category}`] : ["neutral-product-stage"];

  return {
    version: 1,
    id: `creative-brief-v1:${truth.productId}:${input.campaignIntent.id}`,
    productId: truth.productId,
    campaignIntentId: input.campaignIntent.id,
    productPositioning: "protected_hero",
    visualObjective: input.campaignIntent.objective,
    creativeFamily,
    paletteStrategy,
    contrastStrategy,
    environmentDirection,
    lightingDirection: visual?.observed.perceivedBrightness === "very_dark" ? "studio" : "natural",
    compositionDirection,
    productProminence: "hero",
    informationDensity,
    priceTreatment: campaignPriceTreatment(input.campaignIntent, preferences),
    promotionTreatment: campaignPromotionTreatment(input.campaignIntent, preferences),
    typographyDirection,
    decorativeElementDirection: compositionDirection === "minimal" ? "restrained" : compositionDirection === "dynamic" ? "expressive" : "balanced",
    allowedClaims: trustedClaims(truth),
    forbiddenClaims: [
      "facts derived only from observed image characteristics",
      "facts derived only from probabilistic inference",
      "invented product benefits, composition, specifications, origin, or availability",
    ],
    constraints: [
      "preserve original product identity",
      "use only the approved cutout as the protected product layer",
      "do not redraw, restyle, crop, stretch, rotate, or replace the product",
      "keep product/background separation and commercial legibility",
      ...(visual?.inferred.avoidEnvironmentHints || []).map((hint) => `avoid environment: ${hint}`),
    ],
    decisionTrace: trace,
  };
}

/** Três ou mais conceitos, com direções visuais distintas e não apenas variações de paleta. */
export function validateCreativeConceptSet(value: readonly CreativeConcept[]): ContractValidationResult {
  const errors: string[] = [];
  if (value.length < 3) errors.push("at least three concepts are required");
  const ids = new Set(value.map((concept) => concept.id.trim()));
  if (ids.size !== value.length || ids.has("")) errors.push("concept ids must be non-empty and unique");
  const directions = new Set(value.map((concept) => concept.visualDirection.trim().toLocaleLowerCase("pt-BR")));
  if (directions.size !== value.length || directions.has("")) errors.push("concept visual directions must be distinct");
  if (new Set(value.map((concept) => concept.creativeFamily)).size < Math.min(2, value.length)) errors.push("concepts must use more than one creative family");
  return errors.length === 0 ? { valid: true } : { valid: false, errors };
}
