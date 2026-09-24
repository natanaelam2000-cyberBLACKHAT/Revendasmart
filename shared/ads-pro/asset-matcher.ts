/**
 * ADS-PRO-02B — Matcher Determinístico e Lexicográfico de Assets do Anúncios Pro
 *
 * Mecanismo puro de seleção, filtragem e ordenação explicável de assets publicitários.
 *
 * Princípios Centrais:
 * - Determinismo Absoluto: Mesmo input -> Mesmo output -> Mesma ordem.
 * - Pureza Estrita: Sem funções de entropia, tempo ou aleatoriedade.
 * - Zero I/O: Não acessa rede, filesystem, banco de dados ou browser APIs.
 * - Ranking Lexicográfico Semântico: Prioridade hierárquica estrita (Category > Intent > Style > AssetId).
 *   Nenhuma dimensão inferior pode compensar ou suplantar uma dimensão superior.
 * - Total Order: Ordem estrita garantida; desempate final invariante por AssetId canônico ASCII.
 * - Imutabilidade: Nunca muta o manifesto, os assets ou o contexto de entrada.
 * - Independência da Ordem de Entrada: Permutações no manifesto produzem exatamente o mesmo resultado.
 */

import type {
  AssetCategory,
  AssetDNA,
  AssetEntityKind,
  AssetFormat,
  AssetIntent,
  AssetLibraryManifest,
  AssetStyle,
} from "./asset-dna";

/**
 * Contexto comercial de criação para seleção e ranking de assets no Anúncios Pro.
 */
export interface AssetMatchContext {
  /** Tipo de entidade anunciada (produto ou serviço). */
  readonly entityKind: AssetEntityKind;
  /** Formato de exibição do anúncio (ex: stories_portrait, feed_square). */
  readonly format: AssetFormat;
  /** Categoria normalizada do catálogo (opcional, aplicável a produtos). */
  readonly category?: AssetCategory;
  /** Intenção comercial da campanha (opcional). */
  readonly intent?: AssetIntent;
  /** Estilos visuais preferidos pelo vendedor em ordem de prioridade (opcional). */
  readonly preferredStyles?: readonly AssetStyle[];
}

/** Classificação discreta da afinidade categórica. */
export type CategoryAffinity = "exact" | "universal" | "neutral" | "mismatch";

/** Classificação discreta da afinidade com a intenção comercial. */
export type IntentAffinity = "exact" | "universal" | "neutral" | "mismatch";

/** Classificação discreta da afinidade de estilo visual. */
export type StyleAffinity = "primary" | "secondary" | "none";

/**
 * Explicação detalhada e auditável do posicionamento de cada asset no ranking.
 */
export interface AssetMatchBreakdown {
  /** Afinidade categórica: exact, universal, neutral ou mismatch. */
  readonly categoryAffinity: CategoryAffinity;
  /** Afinidade com a intenção: exact, universal, neutral ou mismatch. */
  readonly intentAffinity: IntentAffinity;
  /** Afinidade de estilo: primary (estilo #1), secondary (estilos #2+), ou none (sem correspondência). */
  readonly styleAffinity: StyleAffinity;
  /** Lista ordenada dos estilos preferidos que coincidem com os estilos do asset. */
  readonly matchedStyles: readonly AssetStyle[];
}

/**
 * Resultado individual de um asset avaliado e posicionado pelo Matcher.
 */
export interface AssetMatchResult {
  /** Asset elegível avaliado. */
  readonly asset: AssetDNA;
  /** Decomposição detalhada dos critérios semânticos de posicionamento. */
  readonly breakdown: AssetMatchBreakdown;
}

/**
 * Prioridades ordinais para ordenação lexicográfica determinística (menor número = maior relevância).
 */
const CATEGORY_PRIORITY: Record<CategoryAffinity, number> = {
  exact: 0,
  universal: 1,
  neutral: 2,
  mismatch: 3,
};

const INTENT_PRIORITY: Record<IntentAffinity, number> = {
  exact: 0,
  universal: 1,
  neutral: 2,
  mismatch: 3,
};

const STYLE_PRIORITY: Record<StyleAffinity, number> = {
  primary: 0,
  secondary: 1,
  none: 2,
};

/**
 * Avalia se um asset atende aos filtros rígidos (Hard Filters) de elegibilidade.
 *
 * Filtros Rígidos:
 * 1. Status: Apenas assets com status 'active' são elegíveis. Deprecated é estritamente inelegível.
 * 2. Entidade: asset.entityKinds precisa conter context.entityKind.
 * 3. Formato: asset.formats precisa conter context.format.
 * 4. Intenção: Se context.intent for fornecido e o asset possuir lista de intents específicos,
 *    ele DEVE conter context.intent. Assets com supportedIntents: [] são universais e passam sempre.
 */
export function isAssetEligible(asset: AssetDNA, context: AssetMatchContext): boolean {
  if (asset.status !== "active") {
    return false;
  }

  if (!asset.entityKinds.includes(context.entityKind)) {
    return false;
  }

  if (!asset.formats.includes(context.format)) {
    return false;
  }

  if (context.intent !== undefined && asset.supportedIntents.length > 0) {
    if (!asset.supportedIntents.includes(context.intent)) {
      return false;
    }
  }

  return true;
}

/**
 * Calcula a afinidade categórica semântica de um asset frente ao contexto comercial.
 *
 * Regras:
 * - Se context.category está definida:
 *   - asset contém a categoria -> exact
 *   - asset não declara categorias específicas (targetCategories: []) -> universal
 *   - asset declara categorias específicas mas nenhuma bate -> mismatch
 * - Se context.category NÃO está definida (ex: Services ou Produto genérico):
 *   - asset não declara categorias específicas -> universal
 *   - asset declara categorias específicas -> neutral (continua elegível, não é mismatch)
 */
export function resolveCategoryAffinity(asset: AssetDNA, context: AssetMatchContext): CategoryAffinity {
  if (context.category !== undefined) {
    if (asset.targetCategories.includes(context.category)) {
      return "exact";
    }
    if (asset.targetCategories.length === 0) {
      return "universal";
    }
    return "mismatch";
  }

  // context.category === undefined
  if (asset.targetCategories.length === 0) {
    return "universal";
  }
  return "neutral";
}

/**
 * Calcula a afinidade com a intenção comercial de um asset frente ao contexto.
 *
 * Regras:
 * - Se context.intent está definida:
 *   - asset declara a intenção -> exact
 *   - asset é universal (supportedIntents: []) -> universal
 *   - asset declara intenções específicas que não incluem o contexto -> mismatch (não é universal!)
 * - Se context.intent NÃO está definida:
 *   - Não há evidência para beneficiar ou penalizar -> neutral
 */
export function resolveIntentAffinity(asset: AssetDNA, context: AssetMatchContext): IntentAffinity {
  if (context.intent !== undefined) {
    if (asset.supportedIntents.includes(context.intent)) {
      return "exact";
    }
    if (asset.supportedIntents.length === 0) {
      return "universal";
    }
    return "mismatch";
  }

  return "neutral";
}

/**
 * Calcula a afinidade de estilo visual frente à lista ordenada de preferências do lojista.
 *
 * Trata preferredStyles semanticamente como lista ordenada de prioridade,
 * deduplicando internamente sem mutar o contexto de entrada.
 */
export function resolveStyleAffinity(
  asset: AssetDNA,
  context: AssetMatchContext
): { styleAffinity: StyleAffinity; matchedStyles: readonly AssetStyle[] } {
  if (!context.preferredStyles || context.preferredStyles.length === 0) {
    return { styleAffinity: "none", matchedStyles: [] };
  }

  // Deduplicação pura preservando a primeira ocorrência (ordem de prioridade)
  const seenStyles = new Set<AssetStyle>();
  const dedupedPreferredStyles: AssetStyle[] = [];
  for (let i = 0; i < context.preferredStyles.length; i += 1) {
    const style = context.preferredStyles[i];
    if (!seenStyles.has(style)) {
      seenStyles.add(style);
      dedupedPreferredStyles.push(style);
    }
  }

  if (dedupedPreferredStyles.length === 0) {
    return { styleAffinity: "none", matchedStyles: [] };
  }

  const assetStylesSet = new Set(asset.styles);
  const matchedStyles: AssetStyle[] = [];
  for (let i = 0; i < dedupedPreferredStyles.length; i += 1) {
    const style = dedupedPreferredStyles[i];
    if (assetStylesSet.has(style)) {
      matchedStyles.push(style);
    }
  }

  const primaryPreference = dedupedPreferredStyles[0];
  if (assetStylesSet.has(primaryPreference)) {
    return { styleAffinity: "primary", matchedStyles };
  }

  if (matchedStyles.length > 0) {
    return { styleAffinity: "secondary", matchedStyles };
  }

  return { styleAffinity: "none", matchedStyles: [] };
}

/**
 * Avalia e monta a decomposição semântica (breakdown) de um asset elegível.
 */
export function evaluateAsset(asset: AssetDNA, context: AssetMatchContext): AssetMatchResult {
  const categoryAffinity = resolveCategoryAffinity(asset, context);
  const intentAffinity = resolveIntentAffinity(asset, context);
  const { styleAffinity, matchedStyles } = resolveStyleAffinity(asset, context);

  return {
    asset,
    breakdown: {
      categoryAffinity,
      intentAffinity,
      styleAffinity,
      matchedStyles,
    },
  };
}

/** Alias para compatibilidade semântica com invocadores da etapa anterior. */
export const scoreAsset = evaluateAsset;

/** Comparador semântico para afinidade categórica. */
export function compareCategoryAffinity(a: CategoryAffinity, b: CategoryAffinity): number {
  return CATEGORY_PRIORITY[a] - CATEGORY_PRIORITY[b];
}

/** Comparador semântico para afinidade de intenção comercial. */
export function compareIntentAffinity(a: IntentAffinity, b: IntentAffinity): number {
  return INTENT_PRIORITY[a] - INTENT_PRIORITY[b];
}

/** Comparador semântico para afinidade de estilo visual. */
export function compareStyleAffinity(a: StyleAffinity, b: StyleAffinity): number {
  return STYLE_PRIORITY[a] - STYLE_PRIORITY[b];
}

/** Comparador canônico de AssetId por código de caractere ASCII estrito (locale-independent). */
export function compareAssetIdAscii(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/**
 * Comparador determinístico lexicográfico de resultados de matching.
 *
 * Ordem hierárquica estrita:
 * 1. categoryAffinity (exact > universal > neutral > mismatch)
 * 2. intentAffinity (exact > universal > neutral)
 * 3. styleAffinity (primary > secondary > none)
 * 4. AssetId ASCII (desempate total determinístico)
 */
export function compareMatchResults(a: AssetMatchResult, b: AssetMatchResult): number {
  const catDiff = compareCategoryAffinity(a.breakdown.categoryAffinity, b.breakdown.categoryAffinity);
  if (catDiff !== 0) return catDiff;

  const intentDiff = compareIntentAffinity(a.breakdown.intentAffinity, b.breakdown.intentAffinity);
  if (intentDiff !== 0) return intentDiff;

  const styleDiff = compareStyleAffinity(a.breakdown.styleAffinity, b.breakdown.styleAffinity);
  if (styleDiff !== 0) return styleDiff;

  return compareAssetIdAscii(a.asset.id, b.asset.id);
}

/**
 * Mecanismo principal do Matcher Lexicográfico do Anúncios Pro.
 *
 * Filtra os assets elegíveis, decompõe seus critérios semânticos explicáveis
 * e ordena a coleção por hierarquia estrita determinística.
 *
 * @param manifest Manifesto validado contendo os assets disponíveis.
 * @param context Contexto comercial de criação do anúncio.
 * @returns Lista ordenada de resultados de matching. Retorna [] se nenhum for elegível.
 */
export function rankAdsProAssets(
  manifest: AssetLibraryManifest,
  context: AssetMatchContext
): readonly AssetMatchResult[] {
  // 1. Filtragem com Hard Filters (sem mutação do manifesto de entrada)
  const eligibleAssets: AssetDNA[] = [];
  for (let i = 0; i < manifest.assets.length; i += 1) {
    const asset = manifest.assets[i];
    if (isAssetEligible(asset, context)) {
      eligibleAssets.push(asset);
    }
  }

  if (eligibleAssets.length === 0) {
    return [];
  }

  // 2. Avaliação e decomposição semântica
  const results: AssetMatchResult[] = [];
  for (let i = 0; i < eligibleAssets.length; i += 1) {
    results.push(evaluateAsset(eligibleAssets[i], context));
  }

  // 3. Ordenação determinística lexicográfica
  results.sort(compareMatchResults);

  return results;
}
