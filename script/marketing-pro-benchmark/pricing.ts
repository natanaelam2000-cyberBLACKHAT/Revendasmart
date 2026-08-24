/**
 * Modelo de custo central — PRO-06B1.1 / PRO-06B1.2. Um número por provider, usado por TODOS os
 * adapters (nunca reimplementado dentro deles) e pelo hard stop do orquestrador.
 *
 * Consultado em documentação oficial em 2026-08-15 (revalidado no PRO-06B1.1 e no PRO-06B1.2 — não
 * reaproveita nenhum número de sessão anterior sem reconfirmar):
 *
 *   Google — https://ai.google.dev/gemini-api/docs/pricing +
 *            https://ai.google.dev/gemini-api/docs/image-generation (Gemini 3.1 Flash Image)
 *   OpenAI — https://developers.openai.com/api/docs/models/gpt-image-2 (tamanho customizado) +
 *            https://developers.openai.com/api/docs/pricing (preço por tamanho "popular")
 *   BFL    — https://docs.bfl.ml/quick_start/pricing (FLUX.2 [pro], "from $0.03", pricing baseado em
 *            resolução, calculadora oficial como referência de custo exato)
 *
 * PRO-06B1.2: removida a fórmula de custo do BFL que vinha de um revendedor terceiro do modelo, não da
 * BFL. Nenhuma fórmula própria foi inventada para substituí-la — quando a documentação oficial não
 * publica número/fórmula estável para a configuração exata usada, `estimatedRequestCostUsd` é `null`
 * em vez de uma estimativa não rastreável a uma fonte oficial.
 */

import type { MarketingProBenchmarkProviderCostEstimate, MarketingProBenchmarkProviderId } from "./types";

export const MARKETING_PRO_BENCHMARK_PRICING_SOURCE_DATE = "2026-08-15";

/** 1 USD em BRL — TradingEconomics, cotação de 2026-08-14 (a mais recente disponível em 2026-08-15). */
export const MARKETING_PRO_BENCHMARK_USD_TO_BRL = 5.2136;
export const MARKETING_PRO_BENCHMARK_EXCHANGE_RATE_SOURCE = "TradingEconomics — Brazilian Real quote, 2026-08-14";

/**
 * Teto financeiro autorizado do benchmark — R$30,00 (PRO-06B2, atualizado de R$10,00). É um LIMITE
 * MÁXIMO acumulado de todas as execuções de benchmark, não uma meta de gasto: se a qualidade/
 * consistência do provider já estiver evidenciada com menos, não há obrigação de gastar o resto.
 * O hard stop (`MarketingProBenchmarkSpendGuard`) continua reservando o teto conservador de CADA
 * chamada ANTES de executá-la — se a próxima reserva ultrapassar este valor, a chamada é bloqueada
 * antes de chegar ao provider.
 */
export const MARKETING_PRO_BENCHMARK_COST_CEILING_BRL = 30;

/**
 * Google — Gemini 3.1 Flash Image ("Nano Banana 2"), bucket de resolução "1K" (que cobre 4:5 dentro
 * do mesmo bucket, sem custo adicional por aspect ratio — a doc preça por bucket de resolução, não por
 * proporção). US$0.067/imagem é o número literal publicado para este bucket exato.
 */
const GOOGLE_COST: MarketingProBenchmarkProviderCostEstimate = {
  provider: "google",
  model: "gemini-3.1-flash-image",
  documentedPricingBasis: "ai.google.dev/gemini-api/docs/pricing: Gemini 3.1 Flash Image, bucket 1K = US$0.067/imagem (preço por bucket de resolução, aspect ratio 4:5 incluso no mesmo bucket que 1:1)",
  estimatedRequestCostUsd: 0.067,
  conservativeMaxRequestCostUsd: 0.067,
  confidence: "documented",
};

/**
 * OpenAI — gpt-image-2. O TAMANHO 1024×1280 (4:5 exato) é explicitamente documentado como válido:
 * "gpt-image-2 accepts any resolution in the size parameter when it satisfies the constraints"
 * (múltiplo de 16px, razão longo:curto <= 3:1, pixels entre 655.360 e 8.294.400 — 1024×1280 cumpre as
 * três). O PREÇO exato para esse tamanho custom NÃO é publicado — só para os 3 "popular sizes"
 * (1024x1024/1024x1536/1536x1024) em low/medium/high. Por isso o custo aqui é "estimated", não
 * "documented": estimatedRequestCostUsd usa o preço "medium" de 1024x1536 (portrait, o tamanho listado
 * mais parecido em orientação/proporção com 1024x1280); conservativeMaxRequestCostUsd usa o maior
 * preço "medium" entre os 3 tamanhos listados (1024x1024 = US$0.053) como teto.
 */
const OPENAI_COST: MarketingProBenchmarkProviderCostEstimate = {
  provider: "openai",
  model: "gpt-image-2",
  documentedPricingBasis: "developers.openai.com/api/docs/models/gpt-image-2: tamanho 1024x1280 (4:5) é custom size documentado como válido; preço exato não publicado para custom sizes — só para 1024x1024/1024x1536/1536x1024 (medium: $0.053/$0.041/$0.041)",
  estimatedRequestCostUsd: 0.041,
  conservativeMaxRequestCostUsd: 0.053,
  confidence: "estimated",
};

/**
 * BFL — FLUX.2 [pro]. Fonte: SOMENTE docs.bfl.ml/quick_start/pricing (documentação oficial BFL) — a
 * doc confirma que "FLUX.2 usa pricing baseado em resolução", que "FLUX.2 [pro] text-to-image começa
 * em US$0.03" e que o custo varia por resolução, mas NÃO publica uma fórmula/tabela textual estável
 * que permita calcular o preço exato de 1080x1350 — a própria doc direciona para a "pricing calculator"
 * oficial (bfl.ai/pricing) para custo exato, que é uma ferramenta interativa, não um número citável
 * aqui de forma estável.
 *
 * PRO-06B1.2: nenhuma fórmula de terceiro é usada para preencher essa lacuna. `estimatedRequestCostUsd`
 * é `null` — não computável honestamente a partir de documentação oficial estável.
 * `conservativeMaxRequestCostUsd` = US$0.05 é um TETO INTERNO DE SEGURANÇA (acima do "from $0.03"
 * citado oficialmente, com margem), não um preço oficial — é só o que o hard stop usa para nunca deixar
 * uma chamada real estourar o orçamento da run, mesmo sem saber o preço exato de antemão.
 */
const BFL_COST: MarketingProBenchmarkProviderCostEstimate = {
  provider: "bfl",
  model: "flux-2-pro",
  documentedPricingBasis: "Official BFL pricing: FLUX.2 [pro] text-to-image from US$0.03; exact cost depends on output resolution.",
  estimatedRequestCostUsd: null,
  conservativeMaxRequestCostUsd: 0.05,
  confidence: "estimated",
};

export const MARKETING_PRO_BENCHMARK_PROVIDER_COST: Record<MarketingProBenchmarkProviderId, MarketingProBenchmarkProviderCostEstimate> = {
  google: GOOGLE_COST,
  openai: OPENAI_COST,
  bfl: BFL_COST,
};

export interface MarketingProBenchmarkCostSummary {
  readonly totalCallsPlanned: number;
  /** `null` quando ao menos um provider com chamadas planejadas não tem estimativa honesta (ex.: BFL). */
  readonly estimatedTotalCostUsd: number | null;
  readonly estimatedTotalCostBrl: number | null;
  readonly conservativeMaxTotalCostUsd: number;
  readonly conservativeMaxTotalCostBrl: number;
  readonly ceilingBrl: number;
  /** §7: o hard stop SEMPRE usa o teto conservador, nunca a melhor estimativa (que pode nem existir). */
  readonly withinCeiling: boolean;
}

/**
 * PRO-06B1.2 §3: `estimatedTotalCostUsd/Brl` só é somado quando TODOS os providers com chamadas
 * planejadas têm `estimatedRequestCostUsd` não-nulo — caso contrário vira `null` (não é honesto somar
 * "estimativa conhecida + desconhecida" e apresentar como se fosse um total confiável).
 * `conservativeMaxTotalCostUsd/Brl` é sempre computável, porque `conservativeMaxRequestCostUsd` nunca
 * é `null` — é esse valor, não o estimado, que o hard stop usa.
 *
 * `previouslyReservedUsd` (PRO-06B2.2, P1): soma das reservas conservadoras de execuções ANTERIORES do
 * script (lida do ledger persistente) — sem isso, `withinCeiling` só enxergaria as chamadas desta
 * execução, e uma sequência de execuções separadas do processo poderia ultrapassar o teto sem que o
 * pré-flight de nenhuma delas individualmente detectasse isso.
 */
export function summarizeMarketingProBenchmarkCost(
  callsByProvider: Record<MarketingProBenchmarkProviderId, number>,
  previouslyReservedUsd = 0,
): MarketingProBenchmarkCostSummary {
  const providers: MarketingProBenchmarkProviderId[] = ["google", "openai", "bfl"];
  let totalCallsPlanned = 0;
  let estimatedTotalCostUsd = 0;
  let estimatedIsFullyKnown = true;
  let conservativeMaxTotalCostUsd = 0;
  for (const provider of providers) {
    const calls = callsByProvider[provider];
    const cost = MARKETING_PRO_BENCHMARK_PROVIDER_COST[provider];
    totalCallsPlanned += calls;
    if (calls > 0) {
      if (cost.estimatedRequestCostUsd === null) {
        estimatedIsFullyKnown = false;
      } else {
        estimatedTotalCostUsd += calls * cost.estimatedRequestCostUsd;
      }
    }
    conservativeMaxTotalCostUsd += calls * cost.conservativeMaxRequestCostUsd;
  }
  const conservativeMaxTotalCostBrl = conservativeMaxTotalCostUsd * MARKETING_PRO_BENCHMARK_USD_TO_BRL;
  const previouslyReservedBrl = previouslyReservedUsd * MARKETING_PRO_BENCHMARK_USD_TO_BRL;
  return {
    totalCallsPlanned,
    estimatedTotalCostUsd: estimatedIsFullyKnown ? estimatedTotalCostUsd : null,
    estimatedTotalCostBrl: estimatedIsFullyKnown ? estimatedTotalCostUsd * MARKETING_PRO_BENCHMARK_USD_TO_BRL : null,
    conservativeMaxTotalCostUsd,
    conservativeMaxTotalCostBrl,
    ceilingBrl: MARKETING_PRO_BENCHMARK_COST_CEILING_BRL,
    // Hard stop de PLANEJAMENTO (antes da 1a chamada) também usa o teto conservador — mesma regra do
    // hard stop em runtime (§7), não a melhor estimativa (que pode nem estar disponível) — e agora
    // soma o que já foi reservado em execuções anteriores (PRO-06B2.2), não só as chamadas desta run.
    withinCeiling: previouslyReservedBrl + conservativeMaxTotalCostBrl <= MARKETING_PRO_BENCHMARK_COST_CEILING_BRL,
  };
}

/**
 * Hard stop em runtime (§7): acumula SEMPRE `conservativeMaxRequestCostUsd` (nunca a melhor
 * estimativa) e recusa qualquer próxima chamada cujo teto conservador ultrapasse o orçamento total.
 * `recordActual` guarda separadamente o custo real cobrado — hoje sempre `null`, porque nenhum
 * provider devolve billing real síncrono; existe só para não perder o dado quando isso mudar (§8/§9).
 *
 * `initialAccumulatedUsd` (PRO-06B2.2, P1): semeia o guard com o que já foi reservado em execuções
 * ANTERIORES do script (ledger persistente, ver spend-ledger.ts). Sem isso, o hard stop só protegeria
 * DENTRO de um processo — cada execução separada do script começaria contando do zero, e uma sequência
 * de execuções (cada uma respeitando o teto isoladamente) poderia ultrapassar o orçamento acumulado
 * real sem que nenhuma delas individualmente detectasse isso.
 */
export class MarketingProBenchmarkSpendGuard {
  private accumulatedConservativeUsd: number;
  private readonly runBudgetBrl: number;

  constructor(runBudgetBrl: number = MARKETING_PRO_BENCHMARK_COST_CEILING_BRL, initialAccumulatedUsd = 0) {
    this.runBudgetBrl = runBudgetBrl;
    this.accumulatedConservativeUsd = initialAccumulatedUsd;
  }

  get accumulatedConservativeCostUsd(): number {
    return this.accumulatedConservativeUsd;
  }

  get accumulatedConservativeCostBrl(): number {
    return this.accumulatedConservativeUsd * MARKETING_PRO_BENCHMARK_USD_TO_BRL;
  }

  canSpend(nextRequestConservativeMaxUsd: number): boolean {
    const nextBrl = nextRequestConservativeMaxUsd * MARKETING_PRO_BENCHMARK_USD_TO_BRL;
    return this.accumulatedConservativeCostBrl + nextBrl <= this.runBudgetBrl;
  }

  /** Chamado ANTES da requisição, com o teto conservador — é o valor que efetivamente trava o hard stop. */
  recordConservativeReservation(conservativeMaxUsd: number): void {
    this.accumulatedConservativeUsd += conservativeMaxUsd;
  }
}
