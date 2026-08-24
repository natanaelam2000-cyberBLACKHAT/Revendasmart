/**
 * PRO-12A — Creative Director local: transforma produto + perfil + campanha em um `CreativeBrief` +
 * 3 `CreativeConcept`s realmente diferentes. Ainda SEM gerar imagem nenhuma.
 *
 * Puro, provider-agnostic, sem I/O — reaproveita `shared/marketing-pro-creative-intelligence.ts`
 * (contrato central, PRO-09) para o brief individual (`buildCreativeBrief`) e para a validação do
 * conjunto de conceitos (`validateCreativeConceptSet`); nunca reimplementa essas decisões. Este arquivo
 * NÃO é um segundo contrato — é quem CONSOME o contrato central para produzir múltiplas direções.
 *
 * Hierarquia obrigatória (idêntica à do contrato central, nunca invertida aqui):
 *   1. product_truth  2. commercial_coherence  3. campaign_objective  4. seller_preferences.
 * O "gosto do vendedor" só escolhe ENTRE as opções que as camadas acima já aprovaram como seguras —
 * nunca adiciona uma opção nova nem descarta uma restrição herdada delas.
 */
import {
  buildCreativeBrief,
  resolveSellerCreativePreferences,
  validateCreativeConceptSet,
  type CampaignCreativeIntent,
  type CreativeBrief,
  type CreativeConcept,
  type CreativeDecisionTrace,
  type CreativeFamily,
  type ProductCreativeContext,
  type ProductTruth,
  type ProductVisualUnderstanding,
  type SellerCreativeProfile,
} from "./marketing-pro-creative-intelligence";

// --- Perfil por família — só direção visual, nunca dado comercial/factual ---
//
// Cada família tem uma assinatura fixa e determinística (composição/iluminação/ambiente/linguagem
// decorativa). `commercialIntensity` é usada só para NUNCA deixar um conceito "quieto" parecer mais
// urgente que o que a campanha decidiu (ver `nudgeTreatmentDown` abaixo) — nunca para inventar uma
// urgência maior que a campanha permite.
interface CreativeFamilyProfile {
  readonly label: string;
  readonly lightingDirection: CreativeBrief["lightingDirection"];
  readonly compositionDirection: CreativeBrief["compositionDirection"];
  readonly lighting: string;
  readonly composition: string;
  readonly environment: readonly string[];
  readonly decorativeLanguage: string;
  readonly commercialIntensity: "assertive" | "balanced" | "quiet";
}

const FAMILY_PROFILES: Record<CreativeFamily, CreativeFamilyProfile> = {
  luxury: {
    label: "Luxury Spotlight",
    lightingDirection: "dramatic", compositionDirection: "dynamic",
    lighting: "dramatic rim lighting with deep shadow falloff", composition: "dynamic asymmetric hero framing",
    environment: ["reflective pedestal stage", "subtle metallic surface"], decorativeLanguage: "expressive metallic accents",
    commercialIntensity: "assertive",
  },
  editorial: {
    label: "Editorial Clean",
    lightingDirection: "studio", compositionDirection: "balanced",
    lighting: "clean even studio lighting", composition: "balanced editorial grid",
    environment: ["clean editorial backdrop", "neutral material surface"], decorativeLanguage: "balanced typographic accents",
    commercialIntensity: "balanced",
  },
  modern: {
    label: "Modern Performance",
    lightingDirection: "studio", compositionDirection: "dynamic",
    lighting: "crisp directional studio lighting", composition: "dynamic geometric layout",
    environment: ["geometric technology stage", "controlled accent lines"], decorativeLanguage: "structured graphic accents",
    commercialIntensity: "balanced",
  },
  minimal: {
    label: "Minimal Calm",
    lightingDirection: "natural", compositionDirection: "minimal",
    lighting: "soft natural daylight", composition: "minimal composition with generous negative space",
    environment: ["neutral clean stage"], decorativeLanguage: "restrained negative space",
    commercialIntensity: "quiet",
  },
  sensory: {
    label: "Sensory Warmth",
    lightingDirection: "soft", compositionDirection: "balanced",
    lighting: "soft diffused lighting", composition: "balanced tactile arrangement",
    environment: ["tactile textured stage", "organic material surface"], decorativeLanguage: "organic soft accents",
    commercialIntensity: "quiet",
  },
  "fresh-premium": {
    label: "Fresh Premium",
    lightingDirection: "natural", compositionDirection: "balanced",
    lighting: "bright natural daylight with cool undertone", composition: "balanced airy layout",
    environment: ["airy clean stage", "cool-toned material surface"], decorativeLanguage: "refined minimal accents",
    commercialIntensity: "balanced",
  },
  "fresh-sport": {
    label: "Fresh Sport",
    lightingDirection: "dramatic", compositionDirection: "dynamic",
    lighting: "dynamic directional lighting", composition: "dynamic energetic angle",
    environment: ["energetic motion-suggested stage"], decorativeLanguage: "bold graphic accents",
    commercialIntensity: "assertive",
  },
  "fresh-commercial": {
    label: "Fresh Commercial",
    lightingDirection: "studio", compositionDirection: "dynamic",
    lighting: "bright commercial studio lighting", composition: "dynamic promotional layout",
    environment: ["bright commercial stage"], decorativeLanguage: "promotional accent shapes",
    commercialIntensity: "assertive",
  },
};

/** Ordem fixa de preferência quando o pool de famílias seguras precisa ser completado — nunca aleatória. */
const FAMILY_FALLBACK_ORDER: readonly CreativeFamily[] = ["editorial", "modern", "minimal", "sensory", "fresh-premium", "fresh-sport", "fresh-commercial", "luxury"];
/** §14: famílias seguras/neutras quando a compreensão visual tem confiança baixa. */
const LOW_CONFIDENCE_SAFE_FAMILIES: readonly CreativeFamily[] = ["editorial", "modern", "minimal"];
const LOW_CONFIDENCE_THRESHOLD = 0.35;

const PRICE_TREATMENT_RANK: readonly CreativeBrief["priceTreatment"][] = ["subtle", "standard", "highlight"];
const PROMOTION_TREATMENT_RANK: readonly CreativeBrief["promotionTreatment"][] = ["none", "subtle", "balanced", "strong"];
const INTENSITY_STEPS: Record<CreativeFamilyProfile["commercialIntensity"], number> = { assertive: 0, balanced: 1, quiet: 2 };

/** Só desce na escala (nunca sobe) — a campanha (item 3 da hierarquia) já decidiu o TETO em `buildCreativeBrief`. */
function nudgeTreatmentDown<T>(rank: readonly T[], value: T, steps: number): T {
  const index = rank.indexOf(value);
  if (index < 0) return value;
  return rank[Math.max(0, index - steps)];
}

function unique<T>(values: readonly T[]): readonly T[] {
  return Array.from(new Set(values));
}

export interface BuildCreativeDirectionInput {
  readonly productTruth: ProductTruth;
  readonly productUnderstanding: ProductVisualUnderstanding;
  readonly sellerProfile?: SellerCreativeProfile;
  readonly campaignIntent: CampaignCreativeIntent;
}

export interface ConceptScores {
  readonly commercialFitScore: number;
  readonly productCoherenceScore: number;
  readonly sellerPreferenceFitScore: number;
  readonly contrastScore: number;
  readonly overallScore: number;
}

/** Envelope do conceito — o `concept` em si é um `CreativeConcept` legítimo do contrato central (passa
 * em `validateCreativeConceptSet`); score e "why it fits" são metadado deste módulo, não do contrato. */
export interface CreativeConceptWithScore {
  readonly concept: CreativeConcept;
  readonly scores: ConceptScores;
  /** Resumo estruturado curto (fatos da decisão, nunca chain-of-thought em prosa longa). */
  readonly whyItFits: readonly string[];
}

export interface CreativeDirectionResult {
  readonly brief: CreativeBrief;
  readonly concepts: readonly CreativeConceptWithScore[];
  readonly decisionTrace: readonly CreativeDecisionTrace[];
}

function resolveDominantColorFamily(truth: ProductTruth, understanding: ProductVisualUnderstanding): string | undefined {
  return truth.color || understanding.observed.dominantColors?.[0];
}

/** Monta o `ProductCreativeContext` que `buildCreativeBrief` espera — nunca um schema novo de produto. */
function buildProductContext(truth: ProductTruth, understanding: ProductVisualUnderstanding): ProductCreativeContext {
  return {
    version: 1,
    productId: truth.productId,
    truth,
    visualUnderstanding: understanding,
    category: truth.category,
    dominantColorFamily: resolveDominantColorFamily(truth, understanding),
    accentColorFamily: understanding.observed.secondaryColors?.[0],
  };
}

/**
 * Pool de famílias SEGURAS para os 3 conceitos — nunca a família toda, sempre já filtrada por
 * commercial_coherence (avoidCreativeFamilies do entendimento visual) e por preferência do vendedor
 * (dislikedCreativeFamilies), NESSA ORDEM. §14: confiança baixa restringe para famílias neutras antes
 * mesmo de aplicar preferência — "aumentar neutralidade" é uma decisão de coerência, não de gosto.
 */
function resolveSafeFamilyPool(
  understanding: ProductVisualUnderstanding,
  preferences: ReturnType<typeof resolveSellerCreativePreferences>,
  trace: CreativeDecisionTrace[],
): readonly CreativeFamily[] {
  const lowConfidence = understanding.confidence < LOW_CONFIDENCE_THRESHOLD;
  const baseRecommended = lowConfidence ? LOW_CONFIDENCE_SAFE_FAMILIES : (understanding.inferred.recommendedCreativeFamilies?.length ? understanding.inferred.recommendedCreativeFamilies : FAMILY_FALLBACK_ORDER);
  if (lowConfidence) {
    trace.push({ decision: "conceptFamilyPool", source: "product_truth", rule: "low_confidence_prefers_safe_neutral_families", result: LOW_CONFIDENCE_SAFE_FAMILIES.join(",") });
  }

  const avoided = new Set<CreativeFamily>(understanding.inferred.avoidCreativeFamilies || []);
  const disliked = new Set<CreativeFamily>(preferences.dislikedCreativeFamilies || []);

  const afterCoherence = baseRecommended.filter((family) => !avoided.has(family));
  if (afterCoherence.length < baseRecommended.length) {
    trace.push({ decision: "conceptFamilyPool", source: "commercial_coherence", rule: "remove_families_conflicting_with_product_visual", result: afterCoherence.join(",") });
  }

  const afterSellerTaste = afterCoherence.filter((family) => !disliked.has(family));
  if (afterSellerTaste.length < afterCoherence.length) {
    trace.push({ decision: "conceptFamilyPool", source: "seller_preferences", rule: "remove_disliked_families_when_safe", result: afterSellerTaste.join(",") });
  }

  // Completa até ter pelo menos 3 opções, na ordem fixa, nunca reintroduzindo uma família evitada por
  // coerência (a preferência do vendedor SOZINHA nunca é motivo para esvaziar o pool abaixo de 3 —
  // "personaliza sem prejudicar", §1 da tarefa: sempre existe direção viável mesmo que não seja a
  // favorita declarada do vendedor).
  const pool = afterSellerTaste.length >= 3 ? afterSellerTaste : afterCoherence.length >= 3 ? afterCoherence : FAMILY_FALLBACK_ORDER.filter((family) => !avoided.has(family));
  return unique(pool);
}

/** Ordena o pool colocando primeiro a família preferida do vendedor (se estiver disponível e segura) — a
 * ORDEM de apresentação pode refletir gosto; a DISPONIBILIDADE das opções nunca pode (§7). */
function orderPoolBySellerPreference(pool: readonly CreativeFamily[], preferences: ReturnType<typeof resolveSellerCreativePreferences>, trace: CreativeDecisionTrace[]): readonly CreativeFamily[] {
  const preferred = [...(preferences.preferredCreativeFamilies || []), ...(preferences.visualStyles || [])];
  const preferredAvailable = preferred.find((family) => pool.includes(family));
  if (!preferredAvailable) return pool;
  trace.push({ decision: "sellerPreferenceAdaptation", source: "seller_preferences", rule: "personalize_without_conflict", result: `prioritize:${preferredAvailable}` });
  return [preferredAvailable, ...pool.filter((family) => family !== preferredAvailable)];
}

function buildWhyItFits(family: CreativeFamily, profile: CreativeFamilyProfile, brief: CreativeBrief, isPreferred: boolean, understanding: ProductVisualUnderstanding): readonly string[] {
  const reasons: string[] = [];
  if ((understanding.inferred.recommendedCreativeFamilies || []).includes(family)) {
    reasons.push("Matches the product's own visual signals");
  }
  if (brief.contrastStrategy === "high") {
    reasons.push("Preserves product/background separation");
  }
  reasons.push(`Aligned with campaign objective: ${brief.visualObjective}`);
  if (isPreferred) {
    reasons.push("Reflects the seller's declared style preference");
  }
  reasons.push(`Creative family: ${profile.label}`);
  return reasons;
}

function scoreConcept(family: CreativeFamily, profile: CreativeFamilyProfile, brief: CreativeBrief, priceSteps: number, understanding: ProductVisualUnderstanding, preferences: ReturnType<typeof resolveSellerCreativePreferences>): ConceptScores {
  const productCoherenceScore = (understanding.inferred.recommendedCreativeFamilies || []).includes(family) ? 1 : 0.6;
  const commercialFitScore = Math.max(0, 1 - priceSteps * 0.15);
  const contrastScore = brief.contrastStrategy === "high" ? 1 : brief.contrastStrategy === "medium" ? 0.75 : 0.6;
  const preferredFamilies = [...(preferences.preferredCreativeFamilies || []), ...(preferences.visualStyles || [])];
  const sellerPreferenceFitScore = preferredFamilies.includes(family) ? 1 : 0.5;
  // §12: produto/comercial pesam mais que gosto do vendedor no score geral.
  const overallScore = productCoherenceScore * 0.4 + commercialFitScore * 0.3 + contrastScore * 0.2 + sellerPreferenceFitScore * 0.1;
  return {
    commercialFitScore: Number(commercialFitScore.toFixed(2)),
    productCoherenceScore: Number(productCoherenceScore.toFixed(2)),
    sellerPreferenceFitScore: Number(sellerPreferenceFitScore.toFixed(2)),
    contrastScore: Number(contrastScore.toFixed(2)),
    overallScore: Number(overallScore.toFixed(2)),
  };
}

function buildConceptForFamily(
  family: CreativeFamily,
  index: number,
  brief: CreativeBrief,
  truth: ProductTruth,
  understanding: ProductVisualUnderstanding,
  preferences: ReturnType<typeof resolveSellerCreativePreferences>,
  isPreferred: boolean,
): CreativeConceptWithScore {
  const profile = FAMILY_PROFILES[family];
  const steps = INTENSITY_STEPS[profile.commercialIntensity];
  const priceTreatment = nudgeTreatmentDown(PRICE_TREATMENT_RANK, brief.priceTreatment, steps);
  const promotionTreatment = nudgeTreatmentDown(PROMOTION_TREATMENT_RANK, brief.promotionTreatment, steps);
  // §5: o AMBIENTE precisa vir do PRODUTO (categoria/entendimento visual — commercial_coherence),
  // nunca da família de estilo — senão um móvel herdaria "geometric technology stage" só porque a
  // família escolhida foi "modern". A família só contribui um qualificador estilístico (linguagem
  // decorativa), nunca a cena inteira, quando já existe um hint de ambiente vindo do produto.
  const categoryEnvironment = understanding.inferred.recommendedEnvironmentHints || [];
  const environment = categoryEnvironment.length > 0
    ? unique([...categoryEnvironment, `${profile.decorativeLanguage} styling`])
    : profile.environment;

  const concept: CreativeConcept = {
    id: `creative-concept-v1:${truth.productId}:${family}:${index}`,
    label: profile.label,
    creativeFamily: family,
    visualDirection: `${profile.label.toLowerCase()} — ${profile.composition}, ${profile.lighting}`,
    palette: brief.paletteStrategy === "contrastive" ? ["high-contrast-complementary"] : brief.paletteStrategy === "complementary" ? ["seller-tendency-complementary"] : brief.paletteStrategy === "category_led" ? ["category-led-neutral"] : ["neutral-balanced"],
    environment,
    lighting: profile.lighting,
    composition: profile.composition,
    productPlacement: "hero, unaltered, fully separated from background",
    priceTreatment,
    promotionTreatment,
    informationHierarchy: brief.informationDensity === "high"
      ? ["product", "headline", "price", "benefits", "cta"]
      : brief.informationDensity === "low"
        ? ["product", "price"]
        : ["product", "headline", "price"],
  };

  return {
    concept,
    scores: scoreConcept(family, profile, brief, steps, understanding, preferences),
    whyItFits: buildWhyItFits(family, profile, brief, isPreferred, understanding),
  };
}

/**
 * §13 Diversity gate — os 3 conceitos precisam diferir em pelo menos 3 dos eixos abaixo, par a par.
 * Como cada conceito já vem de uma família DIFERENTE (garantido por `resolveSafeFamilyPool` devolver >=3
 * famílias distintas antes de chegar aqui), isso já é estruturalmente forte; esta função é a PROVA
 * explícita, não uma esperança implícita — se falhar, quem chama decide o que fazer (aqui: nunca deveria
 * falhar dado o design acima, mas a checagem existe para nunca silenciar uma regressão futura).
 */
export function evaluateConceptDiversity(concepts: readonly CreativeConcept[]): { readonly diverse: boolean; readonly minDistinctAxes: number } {
  const axes: (keyof Pick<CreativeConcept, "creativeFamily" | "composition" | "lighting" | "priceTreatment" | "promotionTreatment">)[] = [
    "creativeFamily", "composition", "lighting", "priceTreatment", "promotionTreatment",
  ];
  let minDistinctAxes = Infinity;
  for (let i = 0; i < concepts.length; i += 1) {
    for (let j = i + 1; j < concepts.length; j += 1) {
      const distinctAxes = axes.filter((axis) => concepts[i][axis] !== concepts[j][axis]).length;
      minDistinctAxes = Math.min(minDistinctAxes, distinctAxes);
    }
  }
  if (!Number.isFinite(minDistinctAxes)) minDistinctAxes = axes.length;
  return { diverse: minDistinctAxes >= 3, minDistinctAxes };
}

/**
 * Função central da tarefa PRO-12A. Determinística: o mesmo input sempre produz o mesmo output (nenhum
 * `Math.random`, nenhum relógio, nenhuma chamada de rede) — ver testes "R" no smoke suite.
 */
export function buildCreativeDirection(input: BuildCreativeDirectionInput): CreativeDirectionResult {
  const product = buildProductContext(input.productTruth, input.productUnderstanding);
  const brief = buildCreativeBrief({ product, campaignIntent: input.campaignIntent, sellerProfile: input.sellerProfile });

  const trace: CreativeDecisionTrace[] = [];
  const preferences = resolveSellerCreativePreferences(input.sellerProfile, input.productTruth.category);
  const safePool = resolveSafeFamilyPool(input.productUnderstanding, preferences, trace);
  const orderedPool = orderPoolBySellerPreference(safePool, preferences, trace);

  // Garante o próprio `brief.creativeFamily` como um dos 3 quando ele está no pool seguro (o brief já é
  // a direção "oficial" — os outros 2 são variações genuinamente distintas, não substitutos dela).
  const chosenFamilies: CreativeFamily[] = [];
  if (orderedPool.includes(brief.creativeFamily)) chosenFamilies.push(brief.creativeFamily);
  for (const family of orderedPool) {
    if (chosenFamilies.length >= 3) break;
    if (!chosenFamilies.includes(family)) chosenFamilies.push(family);
  }
  // Pool com menos de 3 entradas distintas (caso extremo) — completa reciclando a ordem fixa inteira,
  // nunca chamando um provider para "inventar" uma quarta família.
  for (const family of FAMILY_FALLBACK_ORDER) {
    if (chosenFamilies.length >= 3) break;
    if (!chosenFamilies.includes(family)) chosenFamilies.push(family);
  }

  const preferredFamilies = [...(preferences.preferredCreativeFamilies || []), ...(preferences.visualStyles || [])];
  const concepts = chosenFamilies.map((family, index) =>
    buildConceptForFamily(family, index, brief, input.productTruth, input.productUnderstanding, preferences, preferredFamilies.includes(family)),
  );

  const diversity = evaluateConceptDiversity(concepts.map((c) => c.concept));
  trace.push({ decision: "conceptDiversityGate", source: "commercial_coherence", rule: "concepts_must_differ_on_at_least_three_axes", result: diversity.diverse ? "passed" : "failed" });

  const conceptSetValidation = validateCreativeConceptSet(concepts.map((c) => c.concept));
  if (!conceptSetValidation.valid) {
    throw new Error(`buildCreativeDirection produced an invalid concept set: ${conceptSetValidation.errors.join(", ")}`);
  }

  return { brief, concepts, decisionTrace: [...brief.decisionTrace, ...trace] };
}
