/**
 * Parser de argumentos CLI do benchmark — PRO-06B1.1 §10 / PRO-06B3.0 (`--case`).
 *
 * Extraído do orquestrador (`script/marketing-pro-provider-benchmark.ts`) para ser um módulo PURO,
 * sem efeito colateral algum ao ser importado — o orquestrador roda `main()` automaticamente ao ser
 * carregado (é um script, não uma biblioteca), então importar aquele arquivo diretamente nos testes
 * dispararia a execução real. Este módulo só faz parsing/validação; zero I/O, zero rede, zero fetch.
 */

import { MARKETING_PRO_BENCHMARK_CASES } from "../../shared/marketing-pro-benchmark";
import type { MarketingProBenchmarkProviderId } from "./types";

export const VALID_PROVIDER_IDS: readonly MarketingProBenchmarkProviderId[] = ["google", "openai", "bfl"];

/** IDs válidos derivados da fonte canônica — nunca duplicados manualmente (PRO-06B3.0 §1). */
export const VALID_BENCHMARK_CASE_IDS: readonly string[] = MARKETING_PRO_BENCHMARK_CASES.map((c) => c.id);

export interface CliArgs {
  readonly mode: "readiness-only" | "smoke" | "full-run";
  readonly smokeProvider?: MarketingProBenchmarkProviderId;
  /** PRO-06B3.0: só populado quando `--case <id>` foi passado e validado contra os IDs canônicos. */
  readonly caseId?: string;
}

/** Parser mínimo e explícito — nenhuma flag desconhecida vira execução real por acidente. */
export function parseCliArgs(argv: readonly string[]): CliArgs {
  const providerIndex = argv.indexOf("--provider");
  const requestedProvider = providerIndex >= 0 ? argv[providerIndex + 1] : undefined;
  const hasSmoke = argv.includes("--smoke");
  const hasFullRun = argv.includes("--full-run");

  // --case (PRO-06B3.0 §1/§2/§9 D/E/F): validado ANTES de qualquer decisão de modo — nenhum provider
  // pode ser tocado se o ID for inválido, vazio ou duplicado, em nenhum modo.
  const caseFlagIndices = argv.reduce<number[]>((acc, arg, i) => {
    if (arg === "--case") acc.push(i);
    return acc;
  }, []);
  if (caseFlagIndices.length > 1) {
    throw new Error("--case não pode ser passado mais de uma vez");
  }
  let caseId: string | undefined;
  if (caseFlagIndices.length === 1) {
    const value = argv[caseFlagIndices[0] + 1];
    if (!value || value.startsWith("--")) {
      throw new Error("--case exige um valor: --case <caseId>");
    }
    if (!VALID_BENCHMARK_CASE_IDS.includes(value)) {
      throw new Error(`Unknown benchmark case: ${value}\nValid cases: ${VALID_BENCHMARK_CASE_IDS.join(", ")}`);
    }
    caseId = value;
  }

  // §4: --case é exclusivo do smoke controlado de 1 chamada — nunca vira filtro silencioso de full-run.
  if (hasFullRun && caseId) {
    throw new Error("--full-run não aceita --case — --case é exclusivo do modo --smoke (1 chamada controlada). Use --smoke --provider <id> --case <caseId>, ou rode --full-run sem --case para a matriz completa.");
  }

  if (hasSmoke) {
    if (!requestedProvider || !VALID_PROVIDER_IDS.includes(requestedProvider as MarketingProBenchmarkProviderId)) {
      throw new Error(`--smoke exige --provider <${VALID_PROVIDER_IDS.join("|")}>`);
    }
    return { mode: "smoke", smokeProvider: requestedProvider as MarketingProBenchmarkProviderId, caseId };
  }
  if (hasFullRun) return { mode: "full-run" };
  // §5: --case sozinho (sem --smoke/--full-run) continua readiness-only — 0 chamadas.
  return { mode: "readiness-only", caseId };
}

/** PRO-06B3.0 §3: caso efetivamente usado em modo smoke — o pedido, ou o primeiro canônico por padrão. */
export function resolveSmokeCaseId(caseId: string | undefined): string {
  return caseId ?? MARKETING_PRO_BENCHMARK_CASES[0].id;
}
