/**
 * PRO-10B — mapper explícito entre as 5 etapas do onboarding "Vamos descobrir seu estilo" e o contrato
 * definitivo `SellerCreativeProfile` (`shared/marketing-pro-creative-intelligence.ts`, criado no PRO-09).
 *
 * Substitui `client/src/lib/creative-profile-adapter.ts` (PRO-10A), que foi criado explicitamente como
 * TEMPORÁRIO e foi removido nesta tarefa — não existem mais dois shapes em paralelo. Este arquivo NUNCA
 * declara um shape próprio de perfil: `mapCreativeProfileOnboardingToSellerProfile` sempre devolve um
 * `SellerCreativeProfile` de verdade, do contrato central, nunca importado/reescrito aqui.
 *
 * §7 da tarefa: o mapeamento só preenche campos onde a escolha da etapa REALMENTE sustenta aquele
 * campo — nunca inventa dado que a escolha não suporta. `categoryPreferences` nunca é preenchido aqui
 * (§6): o onboarding só alimenta `globalPreferences`.
 */
import {
  CREATIVE_INTELLIGENCE_CONTRACT_VERSION,
  type CreativeFamily,
  type SellerCreativePreferences,
  type SellerCreativeProfile,
} from "@shared/marketing-pro-creative-intelligence";

/** Ids da UI (Etapa 1) — vocabulário do onboarding, mapeado 1:1 para uma `CreativeFamily` do contrato. */
export type CreativeProfileVisualStyleUiId = "luxury" | "clean" | "modern" | "promotional";
export type CreativeProfileInformationDensityUiId = "minimal" | "balanced" | "detailed";
export type CreativeProfileEmphasisUiId = "product" | "price" | "promotion" | "balanced";
export type CreativeProfileColorTendencyUiId = "light" | "dark" | "vibrant" | "neutral";
export type CreativeProfileExampleUiId = "a" | "b" | "c";

export interface CreativeProfileWizardAnswers {
  readonly visualStyle: CreativeProfileVisualStyleUiId | null;
  readonly informationDensity: CreativeProfileInformationDensityUiId | null;
  readonly emphasis: CreativeProfileEmphasisUiId | null;
  readonly colorTendency: CreativeProfileColorTendencyUiId | null;
  readonly selectedExample: CreativeProfileExampleUiId | null;
}

export const EMPTY_CREATIVE_PROFILE_ANSWERS: CreativeProfileWizardAnswers = {
  visualStyle: null,
  informationDensity: null,
  emphasis: null,
  colorTendency: null,
  selectedExample: null,
};

/** ETAPA 1 → visualStyles / preferredCreativeFamilies (§7). "Clean" e "Comercial/Promocional" não são
 * literais de `CreativeFamily` — mapeados para o valor semanticamente mais próximo do contrato. */
const STYLE_TO_FAMILY: Record<CreativeProfileVisualStyleUiId, CreativeFamily> = {
  luxury: "luxury",
  clean: "minimal",
  modern: "modern",
  promotional: "fresh-commercial",
};
const FAMILY_TO_STYLE: Partial<Record<CreativeFamily, CreativeProfileVisualStyleUiId>> = Object.fromEntries(
  (Object.entries(STYLE_TO_FAMILY) as [CreativeProfileVisualStyleUiId, CreativeFamily][]).map(([ui, family]) => [family, ui]),
);

/** ETAPA 2 → informationDensity. */
const DENSITY_TO_CONTRACT: Record<CreativeProfileInformationDensityUiId, SellerCreativePreferences["informationDensity"]> = {
  minimal: "low",
  balanced: "balanced",
  detailed: "high",
};
const CONTRACT_TO_DENSITY: Partial<Record<string, CreativeProfileInformationDensityUiId>> = Object.fromEntries(
  Object.entries(DENSITY_TO_CONTRACT).map(([ui, contract]) => [contract as string, ui as CreativeProfileInformationDensityUiId]),
);

/** ETAPA 3 → productEmphasis / priceEmphasis / promotionIntensity (§7) — as 3 escalas do contrato para
 * a ÚNICA escolha "o que deve chamar mais atenção" (as 4 combinações abaixo são distintas entre si, o
 * que torna a leitura reversa em `reverseMapEmphasis` sempre não-ambígua). */
type EmphasisFields = Pick<SellerCreativePreferences, "productEmphasis" | "priceEmphasis" | "promotionIntensity">;
const EMPHASIS_TO_CONTRACT: Record<CreativeProfileEmphasisUiId, EmphasisFields> = {
  product: { productEmphasis: "hero", priceEmphasis: "subtle", promotionIntensity: "low" },
  price: { productEmphasis: "balanced", priceEmphasis: "highlight", promotionIntensity: "balanced" },
  promotion: { productEmphasis: "balanced", priceEmphasis: "standard", promotionIntensity: "high" },
  balanced: { productEmphasis: "balanced", priceEmphasis: "standard", promotionIntensity: "balanced" },
};

export function deriveEmphasisFields(choice: CreativeProfileEmphasisUiId): EmphasisFields {
  return EMPHASIS_TO_CONTRACT[choice];
}

function reverseMapEmphasis(fields: EmphasisFields): CreativeProfileEmphasisUiId | null {
  const entry = (Object.entries(EMPHASIS_TO_CONTRACT) as [CreativeProfileEmphasisUiId, EmphasisFields][]).find(
    ([, candidate]) => candidate.productEmphasis === fields.productEmphasis && candidate.priceEmphasis === fields.priceEmphasis && candidate.promotionIntensity === fields.promotionIntensity,
  );
  return entry ? entry[0] : null;
}

/** ETAPA 4 → colorTendencies. O contrato modela isso como `readonly string[]` livre (não um enum
 * fechado) — um único elemento com o id da UI já é uma tendência de cor descritiva legítima. */
function colorTendencyToContract(id: CreativeProfileColorTendencyUiId): readonly string[] {
  return [id];
}
const KNOWN_COLOR_TENDENCY_IDS: readonly CreativeProfileColorTendencyUiId[] = ["light", "dark", "vibrant", "neutral"];

/** ETAPA 5 → compositionPreference (sempre) + preferredCreativeFamilies (só reforça a Etapa 1, nunca
 * substitui — §7: "somente onde semanticamente correto"). */
const EXAMPLE_TO_COMPOSITION: Record<CreativeProfileExampleUiId, SellerCreativePreferences["compositionPreference"]> = {
  a: "minimal",
  b: "dynamic",
  c: "balanced",
};
const CONTRACT_TO_EXAMPLE: Partial<Record<string, CreativeProfileExampleUiId>> = Object.fromEntries(
  Object.entries(EXAMPLE_TO_COMPOSITION).map(([ui, contract]) => [contract as string, ui as CreativeProfileExampleUiId]),
);
const EXAMPLE_TO_FAMILY: Record<CreativeProfileExampleUiId, CreativeFamily> = {
  a: "minimal",
  b: "luxury",
  c: "fresh-commercial",
};

/** §5: confiança conservadora fixa para qualquer perfil originado do onboarding de 5 etapas — nunca
 * "alta", porque este perfil é só bootstrap (nenhum aprendizado real ainda existe). */
export const CREATIVE_PROFILE_BOOTSTRAP_CONFIDENCE = 0.35;
/** Onboarding tem exatamente 5 etapas — só monta o perfil quando as 5 foram respondidas (ver abaixo). */
export const CREATIVE_PROFILE_ONBOARDING_STEP_COUNT = 5;

/** Só monta o perfil quando as 5 respostas estão completas — `null` caso contrário (nunca um default inventado). */
export function mapCreativeProfileOnboardingToSellerProfile(answers: CreativeProfileWizardAnswers): SellerCreativeProfile | null {
  if (!answers.visualStyle || !answers.informationDensity || !answers.emphasis || !answers.colorTendency || !answers.selectedExample) {
    return null;
  }

  const preferredCreativeFamilies = Array.from(new Set<CreativeFamily>([
    STYLE_TO_FAMILY[answers.visualStyle],
    EXAMPLE_TO_FAMILY[answers.selectedExample],
  ]));

  const globalPreferences: SellerCreativePreferences = {
    visualStyles: [STYLE_TO_FAMILY[answers.visualStyle]],
    preferredCreativeFamilies,
    informationDensity: DENSITY_TO_CONTRACT[answers.informationDensity],
    ...deriveEmphasisFields(answers.emphasis),
    colorTendencies: colorTendencyToContract(answers.colorTendency),
    compositionPreference: EXAMPLE_TO_COMPOSITION[answers.selectedExample],
  };

  return {
    version: CREATIVE_INTELLIGENCE_CONTRACT_VERSION,
    globalPreferences,
    // categoryPreferences OMITIDO de propósito (§6) — o onboarding nunca inventa preferência por categoria.
    confidence: CREATIVE_PROFILE_BOOTSTRAP_CONFIDENCE,
    sampleCount: CREATIVE_PROFILE_ONBOARDING_STEP_COUNT,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Prefill real (§10 "Editar preferências") — reconstrói as respostas do wizard a partir de um perfil já
 * salvo. Best-effort: um perfil que não veio deste mapper (valor de `colorTendencies`/`compositionPreference`
 * não reconhecido, por exemplo) simplesmente deixa aquele campo como `null` — o usuário responde de
 * novo, nunca uma adivinhação errada é pré-selecionada.
 */
export function mapSellerProfileToOnboardingAnswers(profile: SellerCreativeProfile): CreativeProfileWizardAnswers {
  const preferences = profile.globalPreferences;
  const visualStyleFamily = preferences.visualStyles?.[0];
  const colorTendency = preferences.colorTendencies?.[0];

  return {
    visualStyle: visualStyleFamily && FAMILY_TO_STYLE[visualStyleFamily] ? FAMILY_TO_STYLE[visualStyleFamily]! : null,
    informationDensity: preferences.informationDensity ? CONTRACT_TO_DENSITY[preferences.informationDensity] ?? null : null,
    emphasis: preferences.productEmphasis && preferences.priceEmphasis && preferences.promotionIntensity
      ? reverseMapEmphasis({ productEmphasis: preferences.productEmphasis, priceEmphasis: preferences.priceEmphasis, promotionIntensity: preferences.promotionIntensity })
      : null,
    colorTendency: colorTendency && (KNOWN_COLOR_TENDENCY_IDS as readonly string[]).includes(colorTendency) ? (colorTendency as CreativeProfileColorTendencyUiId) : null,
    selectedExample: preferences.compositionPreference ? CONTRACT_TO_EXAMPLE[preferences.compositionPreference] ?? null : null,
  };
}
