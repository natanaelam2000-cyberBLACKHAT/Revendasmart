/**
 * Benchmark contract — PRO-06B0.
 *
 * NENHUMA chamada de API acontece aqui. Este módulo só define o CASO de teste (o mesmo input,
 * byte-a-byte, enviado a diferentes providers no futuro) e o FORMATO do resultado — não a execução.
 * Quando o benchmark real existir (sprint futura), ele consome estes tipos; não os reimplementa.
 *
 * Os casos usam `MarketingProProviderArtDirection` — o MESMO tipo provider-safe que
 * server/marketing-pro-provider.ts já usa como input real. Isso é intencional: o benchmark não pode
 * testar um contrato diferente do que o provider realmente recebe em produção.
 */

import {
  MARKETING_PRO_PRODUCT_ZONE,
  type MarketingProCategory,
  type MarketingProFormat,
  type MarketingProProviderArtDirection,
  type MarketingProRect,
  type MarketingProStyle,
} from "./marketing-pro-contract";
import { buildMarketingProProviderArtDirection } from "./marketing-pro-art-direction";

export interface MarketingProBenchmarkCase {
  readonly id: string;
  readonly category: MarketingProCategory;
  readonly style: MarketingProStyle;
  readonly format: MarketingProFormat;
  readonly artDirection: MarketingProProviderArtDirection;
  readonly expectedProductZone: MarketingProRect;
}

/**
 * PRO-06B0.1 (P1-3): cada caso chama `buildMarketingProProviderArtDirection` — a MESMA função que o
 * backend real usa — em vez de digitar `lighting`/`surface`/`atmosphere`/`palette` à mão por caso.
 * Antes, esse texto hand-typed podia divergir silenciosamente do que a rota real enviaria; agora é
 * estruturalmente impossível: o benchmark testa exatamente o que produção envia, palavra por palavra.
 */
function buildCase(id: string, category: MarketingProCategory, style: MarketingProStyle): MarketingProBenchmarkCase {
  // PRO-05 validou o formato 4:5 (portrait, 1080x1350) como o formato principal do Pro — o benchmark
  // não deve voltar para o quadrado do Free só porque é o formato mais simples de descrever.
  const format: MarketingProFormat = "portrait";
  return {
    id,
    category,
    style,
    format,
    artDirection: buildMarketingProProviderArtDirection({ category, style, format }),
    expectedProductZone: MARKETING_PRO_PRODUCT_ZONE[format],
  };
}

/**
 * 9 casos determinísticos cobrindo as 6 categorias e os 5 estilos pelo menos uma vez cada — não as
 * 30 combinações possíveis, que seriam benchmark caro sem cobrir diferença relevante adicional.
 * Nenhum produto real, nenhum dado comercial: só direção de arte, a mesma forma que o provider real
 * vai receber.
 */
export const MARKETING_PRO_BENCHMARK_CASES: readonly MarketingProBenchmarkCase[] = [
  buildCase("beauty-luxury-01", "beauty", "luxury"),
  buildCase("beauty-sensory-01", "beauty", "sensory"),
  buildCase("fashion-editorial-01", "fashion", "editorial"),
  buildCase("fashion-modern-01", "fashion", "modern"),
  buildCase("food-sensory-01", "food", "sensory"),
  buildCase("electronics-minimal-01", "electronics", "minimal"),
  buildCase("electronics-modern-01", "electronics", "modern"),
  buildCase("general-editorial-01", "general", "editorial"),
  buildCase("home-minimal-01", "home", "minimal"),
];

/**
 * Score contract — SOMENTE o shape. Nenhuma nota é calculada aqui; o preenchimento é manual durante
 * o primeiro benchmark real, comparando as saídas reais dos providers lado a lado.
 *
 * Escala 0–10 (não 1–5): granularidade suficiente para diferenciar "quase bom" de "bom" sem forçar um
 * avaliador humano a arredondar demais. Escolha documentada aqui, não em outro lugar.
 *
 * `commercialOverlayReadability` (PRO-06B0.1 §22): dimensão nova, não redundante com
 * `usabilityWithProductOverlay`. A auditoria perguntou se uma dimensão já cobria "o fundo continua
 * legível sob o texto comercial" — não cobria: `usabilityWithProductOverlay` avalia o encaixe da FOTO
 * do produto (geometria da zona `product`), enquanto esta avalia se o fundo mantém contraste/calma
 * suficientes sob as zonas de TEXTO e CTA (`primaryText`/`secondaryText`/`callToAction`) que o overlay
 * comercial determinístico vai desenhar por cima. São preocupações distintas — produto vs. tipografia —
 * por isso uma dimensão nova, não um reaproveitamento da existente.
 */
export interface MarketingProBenchmarkScore {
  readonly visualQuality: number;
  readonly composition: number;
  readonly negativeSpace: number;
  readonly categoryFit: number;
  readonly styleFit: number;
  readonly clutter: number;
  readonly usabilityWithProductOverlay: number;
  readonly commercialOverlayReadability: number;
  readonly notes?: string;
}

/** As 8 dimensões numéricas do score — usado pelo validador abaixo e pelos testes. */
export const MARKETING_PRO_BENCHMARK_SCORE_DIMENSIONS = [
  "visualQuality",
  "composition",
  "negativeSpace",
  "categoryFit",
  "styleFit",
  "clutter",
  "usabilityWithProductOverlay",
  "commercialOverlayReadability",
] as const satisfies readonly (keyof Omit<MarketingProBenchmarkScore, "notes">)[];

export const MARKETING_PRO_BENCHMARK_SCORE_RANGE = { min: 0, max: 10 } as const;

/** PRO-06B0.1 §20: valida CADA dimensão (0 <= v <= 10, finito) — nunca calcula média/nota final. */
export function isValidMarketingProBenchmarkScoreValue(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value)
    && value >= MARKETING_PRO_BENCHMARK_SCORE_RANGE.min
    && value <= MARKETING_PRO_BENCHMARK_SCORE_RANGE.max;
}

export function validateMarketingProBenchmarkScore(score: MarketingProBenchmarkScore): boolean {
  return MARKETING_PRO_BENCHMARK_SCORE_DIMENSIONS.every((dimension) => isValidMarketingProBenchmarkScoreValue(score[dimension]));
}

/**
 * Resultado de UM provider em UM caso. Formaliza a distinção central desta sprint:
 * `technicalSuccess` (o provider respondeu "pronto") é uma coisa; `firstUsableWithoutRegeneration`
 * (um humano aproveitaria essa saída sem pedir de novo) é outra. O indicador principal do benchmark
 * real é a taxa da segunda, não da primeira — ver `MARKETING_PRO_BENCHMARK_PRIMARY_METRIC`.
 */
export interface MarketingProBenchmarkResult {
  readonly caseId: string;
  readonly provider: string;
  readonly costUsd: number;
  readonly durationMs: number;
  /** providerSuccess: a chamada técnica funcionou (equivalente a status "ready" do provider). */
  readonly technicalSuccess: boolean;
  /** usableGeneration: passou no quality gate técnico desta sprint. */
  readonly qualityAccepted: boolean;
  /** O indicador mais importante do benchmark real — ver §14/§15 do enunciado desta sprint. */
  readonly firstUsableWithoutRegeneration: boolean;
  readonly score?: MarketingProBenchmarkScore;
}

/**
 * Nome do indicador principal do benchmark real — "First Usable Background Rate", não
 * "API Success Rate". Um provider com 100% de sucesso técnico e 40% de fundo aproveitável perde para
 * um com 90% de sucesso técnico e 85% de fundo aproveitável.
 */
export const MARKETING_PRO_BENCHMARK_PRIMARY_METRIC = "first_usable_background_rate" as const;
