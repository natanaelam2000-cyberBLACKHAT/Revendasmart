/**
 * Tipos do harness de benchmark real — PRO-06B1.
 *
 * Este módulo (e tudo em script/marketing-pro-benchmark/) só é usado por
 * script/marketing-pro-provider-benchmark.ts, rodado manualmente via `tsx`/`npm run`. Nada aqui é
 * importado por client/ ou server/ em runtime — é ferramenta isolada, do mesmo jeito que
 * script/smoke-tests.ts já é.
 */

import type { MarketingProProviderArtDirection } from "../../shared/marketing-pro-contract";

export type MarketingProBenchmarkProviderId = "google" | "openai" | "bfl";

/**
 * "documented": o preço exato usado é literalmente o número publicado pelo provider para a
 * configuração exata (tamanho/qualidade) que este benchmark pede.
 * "estimated": a configuração exata não tem preço publicado (ex.: tamanho customizado sem tabela
 * própria) — o valor é derivado/interpolado de números documentados de configurações próximas, nunca
 * inventado do zero. PRO-06B1.1 §3/§4/§5: nunca tratar "estimated" como se fosse "documented".
 */
export type MarketingProBenchmarkCostConfidence = "documented" | "estimated";

/**
 * Modelo de custo central — PRO-06B1.1 §6 / PRO-06B1.2 §2. Um único lugar por provider, consumido
 * pelos adapters (nunca duplicado dentro deles) e pelo hard stop do orquestrador.
 *
 * `estimatedRequestCostUsd` é `number | null` (PRO-06B1.2): quando nenhuma fonte OFICIAL publica
 * fórmula ou número estável para a configuração exata usada, o campo é `null` — em vez de inventar uma
 * fórmula própria ou emprestar uma de fonte secundária (ex.: revendedor terceiro). `null` aqui significa
 * "não computável honestamente a partir de documentação oficial", nunca "zero custo".
 *
 * `conservativeMaxRequestCostUsd` NUNCA é `null` — é sempre um número, e é o único valor que o hard
 * stop (§7 do PRO-06B1.1) usa. Quando não há preço oficial estável, este campo vira um TETO INTERNO DE
 * SEGURANÇA (não um preço oficial) — documentado como tal em `documentedPricingBasis`.
 */
export interface MarketingProBenchmarkProviderCostEstimate {
  readonly provider: MarketingProBenchmarkProviderId;
  readonly model: string;
  /** Texto curto citando a fonte oficial e o raciocínio — não só um número solto. */
  readonly documentedPricingBasis: string;
  /** Melhor estimativa pontual para ESTA configuração exata, OU `null` se não há base oficial estável. */
  readonly estimatedRequestCostUsd: number | null;
  /** Teto conservador — usado pelo hard stop (§7), sempre um número, sempre >= estimatedRequestCostUsd (quando este não é null). */
  readonly conservativeMaxRequestCostUsd: number;
  readonly confidence: MarketingProBenchmarkCostConfidence;
}

export interface GenerateBenchmarkBackgroundInput {
  readonly artDirection: MarketingProProviderArtDirection;
  readonly caseId: string;
  readonly requestedWidth: number;
  readonly requestedHeight: number;
  readonly promptText: string;
}

export type GenerateBenchmarkBackgroundResult =
  | {
      readonly success: true;
      readonly mimeType: string;
      readonly width: number;
      readonly height: number;
      readonly byteSize: number;
      readonly durationMs: number;
      /** `null` quando o provider (ex.: BFL) não tem preço oficial estável para esta configuração. */
      readonly estimatedRequestCostUsd: number | null;
      readonly conservativeMaxRequestCostUsd: number;
      /** Sempre `null` até existir dado real de billing do provider — nunca preenchido com estimativa (§9). */
      readonly actualBilledCostUsd: null;
      readonly outputBytes: Buffer;
      /** Metadado seguro para log/manifesto — NUNCA um segredo, token ou payload bruto do provider. */
      readonly providerMetadataSafe: Record<string, string | number | boolean>;
    }
  | {
      readonly success: false;
      readonly durationMs: number;
      readonly estimatedRequestCostUsd: 0;
      readonly conservativeMaxRequestCostUsd: 0;
      readonly actualBilledCostUsd: null;
      readonly errorCode: string;
      readonly errorMessageSafe: string;
      /**
       * PRO-06B2.2 (P1, proteção financeira): `true` quando esta falha aconteceu DEPOIS de uma
       * resposta HTTP 2xx do provider — ou seja, o request chegou a ser processado (possivelmente
       * cobrado como inferência) e só falhou aqui, localmente, na hora de extrair o resultado (parser,
       * download do asset, etc.). `false` para falhas que nunca chegaram a esse ponto (credencial
       * ausente, erro de rede, HTTP não-2xx — presumidamente recusado antes de qualquer inferência).
       * O orquestrador usa isto para decidir se a reserva conservadora desta tentativa deve continuar
       * contando contra o orçamento (mesmo com `estimatedRequestCostUsd/conservativeMaxRequestCostUsd`
       * zerados aqui) — nunca para inventar um `actualBilledCostUsd`, que continua `null`.
       */
      readonly potentiallyBilled: boolean;
    };

export interface MarketingProBenchmarkProviderAdapter {
  readonly id: MarketingProBenchmarkProviderId;
  readonly displayName: string;
  readonly model: string;
  generateBenchmarkBackground(input: GenerateBenchmarkBackgroundInput): Promise<GenerateBenchmarkBackgroundResult>;
}
