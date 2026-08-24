/**
 * Agregador KPI read-only — PRO-06B4.
 *
 * Calcula `first_usable_background_rate` e o veredito final a partir dos sidecars
 * `human-evaluation.v1.json` já persistidos — nunca gera, infere ou "escolhe a melhor" avaliação. Só lê.
 *
 * Dividido em núcleo puro (`aggregateMarketingProHumanEvaluations`, testável com listas sintéticas, sem
 * disco) e um wrapper de I/O (`computeMarketingProHumanBenchmarkSummary`) que varre os 9 casos canônicos
 * em disco e opcionalmente grava `benchmark-human-summary.json`. Mesmo padrão de separação pura/I-O do
 * resto deste diretório.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { MARKETING_PRO_BENCHMARK_SCORE_DIMENSIONS, type MarketingProBenchmarkScore } from "../../shared/marketing-pro-benchmark";
import { VALID_BENCHMARK_CASE_IDS } from "./cli-args";
import {
  CURRENT_EVALUATION_FILE_NAME,
  FIRST_OFFICIAL_GENERATION_RUNS,
  HUMAN_EVALUATION_CRITICAL_VIOLATION_KEYS,
  type MarketingProHumanEvaluationCriticalViolationsV1,
  type MarketingProHumanEvaluationStatus,
  type MarketingProHumanEvaluationV1,
} from "./human-evaluation-types";

export type MarketingProBenchmarkSummaryStatus = "incomplete" | "completed";
export type MarketingProBenchmarkVerdict = "pending" | "approved" | "approved-with-caveats" | "rejected";

export interface MarketingProBenchmarkHumanSummaryCaseV1 {
  readonly caseId: string;
  readonly firstOfficialRunId: string | null;
  readonly evaluationPath: string | null;
  readonly evaluationStatus: MarketingProHumanEvaluationStatus | "missing";
  readonly firstUsableWithoutRegeneration: boolean | null;
  readonly hasCriticalViolation: boolean;
}

export interface MarketingProBenchmarkHumanSummaryV1 {
  readonly schemaVersion: 1;
  readonly generatedAt: string;
  readonly provider: string;
  readonly model: string;
  readonly totalCanonicalCases: number;
  readonly officialFirstGenerations: number;
  readonly evaluatedCases: number;
  readonly usableFirstGenerations: number;
  readonly unusableFirstGenerations: number;
  /** `null` quando `evaluatedCases === 0` — nunca 0/0 tratado como 0. */
  readonly firstUsableBackgroundRate: number | null;
  readonly criticalViolationCounts: Record<keyof MarketingProHumanEvaluationCriticalViolationsV1, number>;
  readonly casesWithAnyCriticalViolation: number;
  readonly averageScores: Partial<Record<keyof Omit<MarketingProBenchmarkScore, "notes">, number>>;
  readonly status: MarketingProBenchmarkSummaryStatus;
  readonly verdict: MarketingProBenchmarkVerdict;
  readonly cases: readonly MarketingProBenchmarkHumanSummaryCaseV1[];
}

export interface CaseEvaluationLookup {
  readonly caseId: string;
  /** `null` quando esse caso ainda não tem primeira geração oficial confirmada em disco. */
  readonly firstOfficialRunId: string | null;
  readonly evaluationPath: string | null;
  /** `null` quando não existe sidecar (ainda não avaliado) para essa primeira geração oficial. */
  readonly evaluation: MarketingProHumanEvaluationV1 | null;
}

function emptyCriticalViolationCounts(): Record<keyof MarketingProHumanEvaluationCriticalViolationsV1, number> {
  return {
    textDetected: 0,
    logoOrBrandDetected: 0,
    ctaOrButtonDetected: 0,
    fakeProductDetected: 0,
    packagingDetected: 0,
    personOrHandsDetected: 0,
    otherCriticalViolation: 0,
  };
}

function hasAnyCriticalViolation(violations: MarketingProHumanEvaluationCriticalViolationsV1): boolean {
  return HUMAN_EVALUATION_CRITICAL_VIOLATION_KEYS.some((key) => violations[key] === true);
}

/**
 * §7: a taxa NUNCA conta `null` como `false`, NUNCA conta regeneração (as lookups já excluem por
 * construção — só carregam `firstOfficialRunId`) e NUNCA usa o quality gate técnico como substituto —
 * só `evaluationStatus === "completed"` com decisão booleana válida entra nos totais numéricos.
 */
export function aggregateMarketingProHumanEvaluations(
  lookups: readonly CaseEvaluationLookup[],
  provider: string,
  model: string,
  generatedAt: string = new Date().toISOString(),
): MarketingProBenchmarkHumanSummaryV1 {
  const totalCanonicalCases = lookups.length;
  let officialFirstGenerations = 0;
  let evaluatedCases = 0;
  let usableFirstGenerations = 0;
  let unusableFirstGenerations = 0;
  const criticalViolationCounts = emptyCriticalViolationCounts();
  let casesWithAnyCriticalViolation = 0;
  const scoreSums: Partial<Record<keyof Omit<MarketingProBenchmarkScore, "notes">, number>> = {};
  let completedWithScoreCount = 0;

  const cases: MarketingProBenchmarkHumanSummaryCaseV1[] = lookups.map((lookup) => {
    if (lookup.firstOfficialRunId !== null) officialFirstGenerations += 1;

    const evaluation = lookup.evaluation;
    const isCompleted =
      evaluation !== null &&
      evaluation.evaluationStatus === "completed" &&
      typeof evaluation.firstUsableWithoutRegeneration === "boolean";
    if (isCompleted) {
      evaluatedCases += 1;
      if (evaluation.firstUsableWithoutRegeneration === true) usableFirstGenerations += 1;
      else unusableFirstGenerations += 1;

      for (const key of HUMAN_EVALUATION_CRITICAL_VIOLATION_KEYS) {
        if (evaluation.criticalViolations[key] === true) criticalViolationCounts[key] += 1;
      }
      if (hasAnyCriticalViolation(evaluation.criticalViolations)) casesWithAnyCriticalViolation += 1;
      if (evaluation.score) {
        completedWithScoreCount += 1;
        for (const dimension of MARKETING_PRO_BENCHMARK_SCORE_DIMENSIONS) {
          scoreSums[dimension] = (scoreSums[dimension] ?? 0) + evaluation.score[dimension];
        }
      }
    }

    return {
      caseId: lookup.caseId,
      firstOfficialRunId: lookup.firstOfficialRunId,
      evaluationPath: lookup.evaluationPath,
      evaluationStatus: evaluation?.evaluationStatus ?? "missing",
      firstUsableWithoutRegeneration: evaluation?.firstUsableWithoutRegeneration ?? null,
      hasCriticalViolation: evaluation !== null && hasAnyCriticalViolation(evaluation.criticalViolations),
    };
  });

  const decidedCount = usableFirstGenerations + unusableFirstGenerations;
  const firstUsableBackgroundRate = decidedCount === 0 ? null : usableFirstGenerations / decidedCount;

  const averageScores: Partial<Record<keyof Omit<MarketingProBenchmarkScore, "notes">, number>> = {};
  if (completedWithScoreCount > 0) {
    for (const dimension of MARKETING_PRO_BENCHMARK_SCORE_DIMENSIONS) {
      const sum = scoreSums[dimension];
      if (sum !== undefined) averageScores[dimension] = sum / completedWithScoreCount;
    }
  }

  const status: MarketingProBenchmarkSummaryStatus =
    evaluatedCases === totalCanonicalCases && officialFirstGenerations === totalCanonicalCases ? "completed" : "incomplete";

  const verdict = computeVerdict(status, usableFirstGenerations, totalCanonicalCases, criticalViolationCounts);

  return {
    schemaVersion: 1,
    generatedAt,
    provider,
    model,
    totalCanonicalCases,
    officialFirstGenerations,
    evaluatedCases,
    usableFirstGenerations,
    unusableFirstGenerations,
    firstUsableBackgroundRate,
    criticalViolationCounts,
    casesWithAnyCriticalViolation,
    averageScores,
    status,
    verdict,
    cases,
  };
}

/**
 * §8: 9/9 e 8/9 (total e total-1) -> approved; total-2 -> approved-with-caveats; <=total-3 -> rejected.
 * Recorrência (>=2) da MESMA violação crítica entre as gerações avaliadas rebaixa um "approved" base
 * para "approved-with-caveats" — nunca piora além disso, e nunca melhora um veredito já mais baixo.
 */
function computeVerdict(
  status: MarketingProBenchmarkSummaryStatus,
  usableFirstGenerations: number,
  totalCanonicalCases: number,
  criticalViolationCounts: Record<keyof MarketingProHumanEvaluationCriticalViolationsV1, number>,
): MarketingProBenchmarkVerdict {
  if (status === "incomplete") return "pending";

  let base: MarketingProBenchmarkVerdict;
  if (usableFirstGenerations >= totalCanonicalCases - 1) base = "approved";
  else if (usableFirstGenerations === totalCanonicalCases - 2) base = "approved-with-caveats";
  else base = "rejected";

  if (base === "approved") {
    const hasRecurringViolation = HUMAN_EVALUATION_CRITICAL_VIOLATION_KEYS.some((key) => criticalViolationCounts[key] >= 2);
    if (hasRecurringViolation) return "approved-with-caveats";
  }
  return base;
}

const DEFAULT_BASE_DIR = path.join(".tmp", "marketing-pro-benchmark");
const DEFAULT_SUMMARY_FILE_NAME = "benchmark-human-summary.json";

function readJsonIfExists<T>(filePath: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

export interface ComputeMarketingProHumanBenchmarkSummaryOptions {
  readonly baseDir?: string;
  readonly provider?: string;
  readonly model?: string;
  /** Quando `true`, grava `benchmark-human-summary.json` na raiz de `baseDir`. Default: não grava (read-only). */
  readonly writeSummaryFile?: boolean;
}

/**
 * Varre disco (read-only, exceto quando `writeSummaryFile: true`) para os 9 casos canônicos, monta as
 * lookups a partir de `FIRST_OFFICIAL_GENERATION_RUNS` + sidecar (se existir), e delega o cálculo ao
 * núcleo puro acima. NUNCA escreve em `background.jpg`, `result.json`, `benchmark-run.json` ou
 * `spend-ledger.json` — só em `benchmark-human-summary.json`, e só se explicitamente pedido.
 */
export function computeMarketingProHumanBenchmarkSummary(
  options: ComputeMarketingProHumanBenchmarkSummaryOptions = {},
): MarketingProBenchmarkHumanSummaryV1 {
  const baseDir = options.baseDir ?? DEFAULT_BASE_DIR;
  const provider = options.provider ?? "google";
  const model = options.model ?? "unknown";

  const lookups: CaseEvaluationLookup[] = VALID_BENCHMARK_CASE_IDS.map((caseId) => {
    const runId = FIRST_OFFICIAL_GENERATION_RUNS[caseId];
    if (!runId) return { caseId, firstOfficialRunId: null, evaluationPath: null, evaluation: null };

    const caseDir = path.join(baseDir, runId, provider, caseId);
    const resultExists = fs.existsSync(path.join(caseDir, "result.json"));
    if (!resultExists) return { caseId, firstOfficialRunId: null, evaluationPath: null, evaluation: null };

    const evaluationPath = path.join(caseDir, CURRENT_EVALUATION_FILE_NAME);
    const evaluation = readJsonIfExists<MarketingProHumanEvaluationV1>(evaluationPath);
    return { caseId, firstOfficialRunId: runId, evaluationPath: evaluation ? evaluationPath : null, evaluation };
  });

  const summary = aggregateMarketingProHumanEvaluations(lookups, provider, model);

  if (options.writeSummaryFile) {
    fs.mkdirSync(baseDir, { recursive: true });
    fs.writeFileSync(path.join(baseDir, DEFAULT_SUMMARY_FILE_NAME), JSON.stringify(summary, null, 2));
  }

  return summary;
}
