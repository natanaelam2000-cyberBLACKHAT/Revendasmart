/**
 * PRO-06B1 — Benchmark real controlado de providers de geração de imagem.
 * Hardening PRO-06B1.1: modelo de custo documented/estimated/conservativeMax, hard stop sempre pelo
 * teto conservador, execução por flag explícita (nunca dispara 27 chamadas sem pedir), zero retry pago.
 *
 * Isolado de propósito: não é importado por client/ nem por server/ em runtime (mesmo padrão de
 * isolamento que script/smoke-tests.ts já usa). server/marketing-pro-provider.ts continua o mock
 * determinístico — este script NUNCA é conectado à rota real.
 *
 * Modos de execução (§10 do PRO-06B1.1 — nenhum deles roda nada sem flag explícita):
 *   npm run marketing-pro:benchmark                              -> só relatório de prontidão, 0 chamadas
 *   npm run marketing-pro:benchmark -- --provider google --smoke -> 1 chamada, caso padrão (1º canônico)
 *   npm run marketing-pro:benchmark -- --provider google --smoke --case electronics-minimal-01
 *                                                                 -> 1 chamada, SOMENTE esse caso (PRO-06B3.0)
 *   npm run marketing-pro:benchmark -- --provider openai --smoke -> idem, OpenAI
 *   npm run marketing-pro:benchmark -- --provider bfl --smoke    -> idem, BFL
 *   npm run marketing-pro:benchmark -- --full-run                -> os 9 casos, só nos providers com
 *                                                                    credencial configurada, até 27
 *                                                                    chamadas, sempre sob o hard stop
 *
 * `--case <id>` (PRO-06B3.0): exclusivo do modo `--smoke` — seleciona explicitamente 1 dos 9 casos
 * canônicos de `MARKETING_PRO_BENCHMARK_CASES` em vez do primeiro (`beauty-luxury-01`) por padrão. ID
 * precisa bater exatamente com um caso existente; `--full-run --case <id>` é rejeitado com erro (não
 * vira filtro silencioso da matriz completa — `--case` é especificamente para smoke de 1 chamada).
 *
 * Sem credencial configurada, TODOS os modos acima terminam sem nenhuma chamada de rede a provider —
 * a checagem de credencial acontece antes de qualquer flag ser interpretada como "pode gastar".
 */

import { config as loadDotenv } from "dotenv";

loadDotenv({ path: ".env.local" });
loadDotenv();

import * as fs from "node:fs";
import * as path from "node:path";
import { MARKETING_PRO_BENCHMARK_CASES, MARKETING_PRO_BENCHMARK_SCORE_DIMENSIONS } from "../shared/marketing-pro-benchmark";
import { evaluateMarketingProOutputQuality } from "../server/marketing-pro-quality";
import { checkMarketingProBenchmarkCredentials } from "./marketing-pro-benchmark/env";
import {
  MARKETING_PRO_BENCHMARK_COST_CEILING_BRL,
  MARKETING_PRO_BENCHMARK_EXCHANGE_RATE_SOURCE,
  MARKETING_PRO_BENCHMARK_PRICING_SOURCE_DATE,
  MARKETING_PRO_BENCHMARK_PROVIDER_COST,
  MARKETING_PRO_BENCHMARK_USD_TO_BRL,
  MarketingProBenchmarkSpendGuard,
  summarizeMarketingProBenchmarkCost,
} from "./marketing-pro-benchmark/pricing";
import { MARKETING_PRO_BENCHMARK_PROMPT_VERSION, buildMarketingProBenchmarkPromptText } from "./marketing-pro-benchmark/prompt";
import { createBflBenchmarkProvider } from "./marketing-pro-benchmark/providers/bfl";
import { createGoogleBenchmarkProvider } from "./marketing-pro-benchmark/providers/google";
import { createOpenAiBenchmarkProvider } from "./marketing-pro-benchmark/providers/openai";
import { appendSpendLedgerEntry, getSpendLedgerPath, readAccumulatedConservativeSpendUsd } from "./marketing-pro-benchmark/spend-ledger";
import { VALID_PROVIDER_IDS, parseCliArgs, resolveSmokeCaseId, type CliArgs } from "./marketing-pro-benchmark/cli-args";
import type { MarketingProBenchmarkProviderAdapter, MarketingProBenchmarkProviderId } from "./marketing-pro-benchmark/types";

const MAX_STRUCTURAL_CALLS = 27;
const TARGET_WIDTH = 1080;
const TARGET_HEIGHT = 1350;

interface CaseRunOutcome {
  readonly caseId: string;
  readonly provider: MarketingProBenchmarkProviderId;
  readonly model: string;
  readonly technicalSuccess: boolean;
  readonly qualityAccepted: boolean | null;
  readonly qualityErrorCode?: string;
  readonly requestedWidth: number;
  readonly requestedHeight: number;
  readonly actualWidth?: number;
  readonly actualHeight?: number;
  readonly durationMs: number;
  readonly estimatedRequestCostUsd: number | null;
  readonly conservativeMaxRequestCostUsd: number;
  readonly actualBilledCostUsd: null;
  readonly errorCode?: string;
  /** PRO-06B2.2: true quando a falha aconteceu depois de um 2xx do provider (ver types.ts). */
  readonly potentiallyBilled?: boolean;
  readonly outputPath?: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

/** PRO-06B1.2: formata custo nullable sem fingir um número — "unknown" é visível, nunca vira "0.0000". */
function formatNullableUsd(value: number | null, decimals = 4): string {
  return value === null ? "unknown (no stable official price)" : `US$${value.toFixed(decimals)}`;
}

function formatNullableBrl(value: number | null): string {
  return value === null ? "unknown" : `R$${value.toFixed(2)}`;
}

/**
 * Soma `estimatedRequestCostUsd` de um conjunto de outcomes — `null` se QUALQUER outcome relevante do
 * conjunto não tiver estimativa honesta (ex.: BFL). Mesma regra de "não computável" usada em
 * pricing.ts, aplicada aqui aos resultados REAIS (não ao planejamento).
 *
 * "Relevante" (PRO-06B2.2) = tecnicamente bem-sucedido OU uma falha `potentiallyBilled` — uma falha
 * comum (nunca chegou a processar) fica de fora da soma porque seu custo é honestamente 0, não porque
 * a soma ignora falhas por padrão.
 */
function sumEstimatedCostUsd(items: readonly CaseRunOutcome[]): number | null {
  const relevant = items.filter((item) => item.technicalSuccess || item.potentiallyBilled);
  if (relevant.some((item) => item.estimatedRequestCostUsd === null)) return null;
  return relevant.reduce((sum, item) => sum + (item.estimatedRequestCostUsd ?? 0), 0);
}

function buildReadinessManifest(runId: string, mode: CliArgs["mode"]) {
  return {
    runId,
    startedAt: nowIso(),
    finishedAt: nowIso(),
    status: "no-credentials-configured-or-readiness-only",
    mode,
    promptVersion: MARKETING_PRO_BENCHMARK_PROMPT_VERSION,
    providers: [],
    models: [],
    caseCount: MARKETING_PRO_BENCHMARK_CASES.length,
    maxCalls: MAX_STRUCTURAL_CALLS,
    actualCalls: 0,
    estimatedTotalCostUsd: 0,
    estimatedTotalCostBrl: 0,
    conservativeMaxTotalCostUsd: 0,
    conservativeMaxTotalCostBrl: 0,
    actualBilledCostUsd: null,
    actualBilledCostBrl: null,
    exchangeRateUsed: MARKETING_PRO_BENCHMARK_USD_TO_BRL,
    cases: [],
    failures: [],
  };
}

async function main(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2));
  const runId = `run-${nowIso().replace(/[:.]/g, "-")}`;
  const outDir = path.join(".tmp", "marketing-pro-benchmark", runId);

  console.log("=== PRO-06B1 — Benchmark real controlado de providers ===");
  console.log(`runId: ${runId}`);
  console.log(`modo: ${args.mode}${args.smokeProvider ? ` (${args.smokeProvider})` : ""}`);
  if (args.mode === "smoke") {
    console.log(`case selecionado: ${resolveSmokeCaseId(args.caseId)}${args.caseId ? "" : " (padrão — nenhum --case informado)"}`);
  }
  console.log(`Fonte de preço: consultada em ${MARKETING_PRO_BENCHMARK_PRICING_SOURCE_DATE}. Câmbio: ${MARKETING_PRO_BENCHMARK_USD_TO_BRL} BRL/USD (${MARKETING_PRO_BENCHMARK_EXCHANGE_RATE_SOURCE}).`);

  // --- PRO-06B2.2 (P1): reserva acumulada de execuções ANTERIORES do script, lida do ledger
  // persistente — sem isso o hard stop só protegeria dentro de UM processo, não entre execuções.
  const previouslyReservedUsd = readAccumulatedConservativeSpendUsd();
  const previouslyReservedBrl = previouslyReservedUsd * MARKETING_PRO_BENCHMARK_USD_TO_BRL;
  console.log(`\n--- Ledger persistente (execuções anteriores) ---`);
  console.log(`Reserva conservadora já acumulada: US$${previouslyReservedUsd.toFixed(4)} ~= R$${previouslyReservedBrl.toFixed(2)} (teto R$${MARKETING_PRO_BENCHMARK_COST_CEILING_BRL})`);
  console.log(`Ledger: ${getSpendLedgerPath()}`);

  console.log("\n--- Modelo de custo por provider ---");
  for (const provider of VALID_PROVIDER_IDS) {
    const cost = MARKETING_PRO_BENCHMARK_PROVIDER_COST[provider];
    console.log(`${provider}: estimated=${formatNullableUsd(cost.estimatedRequestCostUsd)} conservativeMax=US$${cost.conservativeMaxRequestCostUsd.toFixed(4)} confidence=${cost.confidence}`);
  }

  // --- §4: credenciais — só existência, nunca valor ---
  const credentials = checkMarketingProBenchmarkCredentials();
  console.log("\n--- Credenciais ---");
  for (const cred of credentials) {
    console.log(`${cred.provider.toUpperCase()}: ${cred.configured ? "configured" : "missing"} (variável: ${cred.envVarName})`);
  }
  const configuredProviders = credentials.filter((c) => c.configured);
  const missingProviders = credentials.filter((c) => !c.configured);
  for (const missing of missingProviders) {
    console.log(`PARE antes de chamar ${missing.displayName}: configure ${missing.envVarName} em .env.local (nunca no repositório) para incluir esse provider numa rodada futura.`);
  }

  if (args.mode === "readiness-only") {
    console.log("\nModo padrão (sem --smoke/--full-run): só relatório de prontidão, ZERO chamadas de rede a provider.");
    console.log("Para 1 chamada de teste: npm run marketing-pro:benchmark -- --provider <google|openai|bfl> --smoke");
    console.log("Para a rodada completa (até 27 chamadas, só nos providers configurados): npm run marketing-pro:benchmark -- --full-run");
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, "benchmark-run.json"), JSON.stringify(buildReadinessManifest(runId, args.mode), null, 2));
    console.log(`Manifesto de prontidão salvo em ${path.join(outDir, "benchmark-run.json")}`);
    return;
  }

  if (configuredProviders.length === 0) {
    console.log("\nNenhuma credencial configurada. Nenhuma chamada paga será feita nesta execução, mesmo com --smoke/--full-run.");
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, "benchmark-run.json"), JSON.stringify(buildReadinessManifest(runId, args.mode), null, 2));
    return;
  }

  if (args.mode === "smoke" && args.smokeProvider) {
    const smokeCred = credentials.find((c) => c.provider === args.smokeProvider);
    if (!smokeCred?.configured) {
      console.log(`\nPARE: ${args.smokeProvider} não tem credencial configurada — configure ${smokeCred?.envVarName} antes de rodar --smoke para esse provider.`);
      return;
    }
  }

  const providersToRun = args.mode === "smoke" ? configuredProviders.filter((c) => c.provider === args.smokeProvider) : configuredProviders;
  // PRO-06B3.0 §3: --smoke sem --case preserva compatibilidade (primeiro caso canônico); com --case,
  // executa SOMENTE o caso pedido — nunca mais de 1 caso em modo smoke, nos dois casos. `caseId` já foi
  // validado em parseCliArgs contra os IDs canônicos, então o filter abaixo sempre encontra exatamente 1.
  const smokeCaseId = resolveSmokeCaseId(args.caseId);
  const casesToRun = args.mode === "smoke" ? MARKETING_PRO_BENCHMARK_CASES.filter((c) => c.id === smokeCaseId) : MARKETING_PRO_BENCHMARK_CASES;

  // --- §17/§7: estimativa de custo ANTES da primeira chamada — SEMPRE pelo teto conservador ---
  const callsByProvider: Record<MarketingProBenchmarkProviderId, number> = { google: 0, openai: 0, bfl: 0 };
  for (const cred of providersToRun) callsByProvider[cred.provider] = casesToRun.length;
  const summary = summarizeMarketingProBenchmarkCost(callsByProvider, previouslyReservedUsd);
  console.log(`\n--- Estimativa de custo (hard stop usa sempre o teto conservador + reserva já acumulada) ---`);
  console.log(`${summary.totalCallsPlanned} chamadas planejadas`);
  console.log(`estimated:        ${formatNullableUsd(summary.estimatedTotalCostUsd)} ~= ${formatNullableBrl(summary.estimatedTotalCostBrl)}`);
  console.log(`conservativeMax desta run:  US$${summary.conservativeMaxTotalCostUsd.toFixed(4)} ~= R$${summary.conservativeMaxTotalCostBrl.toFixed(2)}`);
  console.log(`conservativeMax total (ledger + esta run):  R$${(previouslyReservedBrl + summary.conservativeMaxTotalCostBrl).toFixed(2)} (teto R$${summary.ceilingBrl})`);
  if (!summary.withinCeiling) {
    console.log(`conservativeMax ULTRAPASSA o teto de R$${summary.ceilingBrl} (considerando o já reservado em execuções anteriores) — abortando ANTES de qualquer chamada.`);
    return;
  }
  if (summary.totalCallsPlanned > MAX_STRUCTURAL_CALLS) {
    console.log(`Chamadas planejadas (${summary.totalCallsPlanned}) ultrapassam o máximo estrutural de ${MAX_STRUCTURAL_CALLS} — abortando.`);
    return;
  }

  const adaptersByProvider: Record<MarketingProBenchmarkProviderId, MarketingProBenchmarkProviderAdapter> = {
    google: createGoogleBenchmarkProvider(),
    openai: createOpenAiBenchmarkProvider(),
    bfl: createBflBenchmarkProvider(),
  };

  fs.mkdirSync(outDir, { recursive: true });
  // PRO-06B2.2: guard semeado com o que já foi reservado em execuções anteriores (ledger).
  const guard = new MarketingProBenchmarkSpendGuard(MARKETING_PRO_BENCHMARK_COST_CEILING_BRL, previouslyReservedUsd);
  const outcomes: CaseRunOutcome[] = [];
  const failures: Array<{ provider: string; caseId: string; errorCode: string; errorMessageSafe: string }> = [];
  let actualCalls = 0;

  // §18/§10: provider por provider, caso por caso — sequencial, sem concorrência. §11: cada
  // combinação (provider, caso) é tentada NO MÁXIMO 1 vez nesta run — não há loop de retry em lugar
  // nenhum abaixo, por construção (um `for` simples, sem `while`/reintento em caso de falha).
  outer: for (const cred of providersToRun) {
    const adapter = adaptersByProvider[cred.provider];
    for (const benchmarkCase of casesToRun) {
      if (actualCalls >= MAX_STRUCTURAL_CALLS) {
        console.log("Máximo estrutural de 27 chamadas atingido — parando.");
        break outer;
      }
      const cost = MARKETING_PRO_BENCHMARK_PROVIDER_COST[cred.provider];
      // §7: a condição do hard stop usa SEMPRE conservativeMaxRequestCostUsd, nunca a estimativa.
      if (!guard.canSpend(cost.conservativeMaxRequestCostUsd)) {
        console.log(`Hard stop: a próxima chamada (${cred.displayName}/${benchmarkCase.id}) ultrapassaria o teto de R$${summary.ceilingBrl} usando o teto conservador — parando aqui.`);
        break outer;
      }
      guard.recordConservativeReservation(cost.conservativeMaxRequestCostUsd);

      const promptText = buildMarketingProBenchmarkPromptText(benchmarkCase.artDirection);
      console.log(`\n-> [${actualCalls + 1}/${summary.totalCallsPlanned}] ${adapter.displayName} / ${benchmarkCase.id}${args.mode === "smoke" ? "  (SMOKE — 1 chamada máxima)" : ""}`);

      // 1 tentativa. Sem retry em caso de 401/403/invalid size/model error/billing error/timeout/
      // unexpected response — qualquer falha aqui só é registrada, nunca reenviada automaticamente.
      const result = await adapter.generateBenchmarkBackground({
        artDirection: benchmarkCase.artDirection,
        caseId: benchmarkCase.id,
        requestedWidth: TARGET_WIDTH,
        requestedHeight: TARGET_HEIGHT,
        promptText,
      });
      actualCalls += 1;

      // PRO-06B2.2 (P1): todo attempt real — sucesso ou falha — grava no ledger persistente, sempre
      // com o teto conservador ESTÁTICO da tabela de preços (nunca 0), para que uma sequência de
      // execuções separadas do processo não consiga "resetar" a proteção do hard stop.
      appendSpendLedgerEntry({
        timestamp: nowIso(),
        provider: cred.provider,
        caseId: benchmarkCase.id,
        conservativeMaxUsd: cost.conservativeMaxRequestCostUsd,
        outcome: result.success ? "success" : "failed",
        potentiallyBilled: result.success ? false : result.potentiallyBilled,
      });

      if (!result.success) {
        console.log(`   FALHA (${result.errorCode}): ${result.errorMessageSafe}`);
        console.log("   Sem retry automático — combinação encerrada, seguindo para a próxima (se houver).");
        if (result.potentiallyBilled) {
          console.log(`   ATENÇÃO: esta falha aconteceu DEPOIS de uma resposta 2xx do provider — o request pode ter consumido inferência paga mesmo sem produzir resultado usável. A reserva conservadora (US$${cost.conservativeMaxRequestCostUsd.toFixed(4)}) NÃO foi zerada no outcome — continua contando contra o orçamento.`);
        }
        failures.push({ provider: cred.provider, caseId: benchmarkCase.id, errorCode: result.errorCode, errorMessageSafe: result.errorMessageSafe });
        // PRO-06B2.2 (P1): falha "comum" (nunca chegou a processar) reporta custo 0, de verdade. Mas
        // uma falha `potentiallyBilled` reporta a reserva ESTÁTICA da tabela de preços — nunca 0 —
        // porque zerar aqui seria tratar uma tentativa que pode ter sido cobrada como se nunca tivesse
        // acontecido, exatamente o comportamento perigoso que esta correção existe para eliminar.
        outcomes.push({
          caseId: benchmarkCase.id, provider: cred.provider, model: adapter.model,
          technicalSuccess: false, qualityAccepted: null,
          requestedWidth: TARGET_WIDTH, requestedHeight: TARGET_HEIGHT,
          durationMs: result.durationMs,
          estimatedRequestCostUsd: result.potentiallyBilled ? cost.estimatedRequestCostUsd : 0,
          conservativeMaxRequestCostUsd: result.potentiallyBilled ? cost.conservativeMaxRequestCostUsd : 0,
          actualBilledCostUsd: null,
          errorCode: result.errorCode, potentiallyBilled: result.potentiallyBilled,
        });
        if (args.mode === "smoke") {
          console.log("   Smoke falhou — parando (§10: 1 chamada máxima por smoke).");
          break outer;
        }
        continue;
      }

      const caseDir = path.join(outDir, cred.provider, benchmarkCase.id);
      fs.mkdirSync(caseDir, { recursive: true });
      const ext = result.mimeType.includes("png") ? "png" : result.mimeType.includes("webp") ? "webp" : "jpg";
      const outputPath = path.join(caseDir, `background.${ext}`);
      fs.writeFileSync(outputPath, result.outputBytes);

      const quality = evaluateMarketingProOutputQuality(
        { mimeType: result.mimeType, width: result.width, height: result.height, byteSize: result.byteSize },
        "portrait",
      );

      outcomes.push({
        caseId: benchmarkCase.id, provider: cred.provider, model: adapter.model,
        technicalSuccess: true, qualityAccepted: quality.accepted, qualityErrorCode: quality.rejectionCode,
        requestedWidth: TARGET_WIDTH, requestedHeight: TARGET_HEIGHT,
        actualWidth: result.width, actualHeight: result.height,
        durationMs: result.durationMs,
        estimatedRequestCostUsd: result.estimatedRequestCostUsd,
        conservativeMaxRequestCostUsd: result.conservativeMaxRequestCostUsd,
        actualBilledCostUsd: null,
        outputPath,
      });

      fs.writeFileSync(path.join(caseDir, "result.json"), JSON.stringify({
        caseId: benchmarkCase.id,
        provider: cred.provider,
        model: adapter.model,
        promptVersion: MARKETING_PRO_BENCHMARK_PROMPT_VERSION,
        requestedWidth: TARGET_WIDTH,
        requestedHeight: TARGET_HEIGHT,
        actualWidth: result.width,
        actualHeight: result.height,
        mimeType: result.mimeType,
        byteSize: result.byteSize,
        durationMs: result.durationMs,
        technicalSuccess: true,
        qualityAccepted: quality.accepted,
        qualityErrorCode: quality.rejectionCode ?? null,
        firstUsableWithoutRegeneration: null,
        estimatedRequestCostUsd: result.estimatedRequestCostUsd,
        conservativeMaxRequestCostUsd: result.conservativeMaxRequestCostUsd,
        // §9: sempre null nesta fase — nenhum provider devolve billing real síncrono; nunca preencher
        // com estimativa.
        actualBilledCostUsd: null,
        providerMetadataSafe: result.providerMetadataSafe,
        score: null,
      }, null, 2));

      console.log(`   OK — technicalSuccess=true qualityAccepted=${quality.accepted} (${quality.rejectionCode ?? "sem rejeição"}) ${result.width}x${result.height} ${(result.byteSize / 1024).toFixed(0)}KB ${result.durationMs}ms`);

      if (args.mode === "smoke") {
        console.log("   Smoke concluído (1 chamada). Conferir o arquivo antes de rodar outro provider ou --full-run.");
        break outer;
      }
    }
  }

  // --- §8/§16: manifesto da run — documented/estimated/conservativeMax/actualBilled separados ---
  const estimatedTotalCostUsd = sumEstimatedCostUsd(outcomes);
  const conservativeMaxTotalCostUsd = outcomes.reduce((sum, o) => sum + o.conservativeMaxRequestCostUsd, 0);
  const manifest = {
    runId,
    startedAt: nowIso(),
    finishedAt: nowIso(),
    status: "completed",
    mode: args.mode,
    promptVersion: MARKETING_PRO_BENCHMARK_PROMPT_VERSION,
    providers: providersToRun.map((c) => c.provider),
    models: providersToRun.map((c) => adaptersByProvider[c.provider].model),
    caseCount: casesToRun.length,
    maxCalls: MAX_STRUCTURAL_CALLS,
    actualCalls,
    estimatedTotalCostUsd,
    // §3: total em BRL só é computável quando o total em USD também é (não null).
    estimatedTotalCostBrl: estimatedTotalCostUsd === null ? null : estimatedTotalCostUsd * MARKETING_PRO_BENCHMARK_USD_TO_BRL,
    conservativeMaxTotalCostUsd,
    conservativeMaxTotalCostBrl: conservativeMaxTotalCostUsd * MARKETING_PRO_BENCHMARK_USD_TO_BRL,
    // §8: null até existir dado real de billing — nunca preenchido com estimativa.
    actualBilledCostUsd: null,
    actualBilledCostBrl: null,
    exchangeRateUsed: MARKETING_PRO_BENCHMARK_USD_TO_BRL,
    cases: outcomes,
    failures,
  };
  fs.writeFileSync(path.join(outDir, "benchmark-run.json"), JSON.stringify(manifest, null, 2));

  // --- Resultado comparável ---
  console.log("\n--- Resultado comparável ---");
  for (const cred of providersToRun) {
    const providerOutcomes = outcomes.filter((o) => o.provider === cred.provider);
    const technicalSuccessCount = providerOutcomes.filter((o) => o.technicalSuccess).length;
    const qualityAcceptedCount = providerOutcomes.filter((o) => o.qualityAccepted).length;
    const avgLatency = providerOutcomes.length ? providerOutcomes.reduce((s, o) => s + o.durationMs, 0) / providerOutcomes.length : 0;
    const totalCost = sumEstimatedCostUsd(providerOutcomes);
    const costPerRequest = totalCost === null || !providerOutcomes.length ? null : totalCost / providerOutcomes.length;
    const costPerQualityAccepted = totalCost === null || !qualityAcceptedCount ? null : totalCost / qualityAcceptedCount;
    console.log(`${cred.displayName}: calls=${providerOutcomes.length} technicalSuccess=${technicalSuccessCount} qualityAccepted=${qualityAcceptedCount} manualUsable=PENDENTE avgLatencyMs=${avgLatency.toFixed(0)} estimatedCostUsd=${formatNullableUsd(totalCost)} costPerRequest=${formatNullableUsd(costPerRequest)} costPerQualityAccepted=${formatNullableUsd(costPerQualityAccepted)} costPerManualUsable=PENDENTE actualBilledCost=null`);
  }

  const evaluationTemplate = outcomes
    .filter((o) => o.technicalSuccess)
    .map((o) => ({
      provider: o.provider,
      caseId: o.caseId,
      outputPath: o.outputPath,
      score: Object.fromEntries(MARKETING_PRO_BENCHMARK_SCORE_DIMENSIONS.map((dimension) => [dimension, null])),
      firstUsableWithoutRegeneration: null,
      notes: "",
    }));
  fs.writeFileSync(path.join(outDir, "manual-evaluation-template.json"), JSON.stringify(evaluationTemplate, null, 2));

  console.log(`\nChamadas reais nesta execução: ${actualCalls}. Reserva conservadora acumulada TOTAL (ledger + esta execução): R$${guard.accumulatedConservativeCostBrl.toFixed(2)} (teto R$${summary.ceilingBrl}). actualBilledCost ainda não existe (null).`);
  console.log(`Ledger persistente: ${getSpendLedgerPath()}`);
  console.log(`Imagens e manifesto em: ${outDir}`);
  console.log(`Template de avaliação manual (${evaluationTemplate.length} itens, score vazio) em: ${path.join(outDir, "manual-evaluation-template.json")}`);
  console.log("\nPARANDO aqui — inspeção manual das imagens antes de qualquer segunda rodada, novo provider ou escolha de vencedor.");
}

main().catch((error) => {
  console.error("Erro não tratado no benchmark:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
