/**
 * Tipos e mapa oficial de "primeira geração" — PRO-06B4.
 *
 * Este módulo só define FORMATO e o MAPA fixo de quais runIds contam como a primeira geração oficial
 * de cada caso canônico. Nenhuma leitura/escrita de disco acontece aqui — isso vive em
 * human-evaluation-persist.ts / human-evaluation-aggregate.ts, seguindo o mesmo isolamento tipo/I-O já
 * usado em types.ts / spend-ledger.ts deste diretório.
 *
 * `FIRST_OFFICIAL_GENERATION_RUNS` é a fonte de verdade sobre qual execução real, entre várias
 * tentativas possíveis do mesmo caso, é a que conta para o KPI humano
 * (`first_usable_background_rate`). Confirmado manualmente pelo usuário ao final da matriz PRO-06B3 —
 * cada valor aqui corresponde a exatamente 1 chamada real bem-sucedida ao Gemini, a primeira desse caso.
 * Regenerações do mesmo caso (ex.: as 3 tentativas extras de beauty-luxury-01) são deliberadamente
 * excluídas deste mapa — ver `PRIOR_NON_EVALUABLE_ATTEMPTS` para a única tentativa anterior relevante
 * (2xx, potencialmente cobrada, sem imagem avaliável).
 */

import type { MarketingProBenchmarkScore } from "../../shared/marketing-pro-benchmark";
import type { MarketingProBenchmarkProviderId } from "./types";

export const HUMAN_EVALUATION_SCHEMA_VERSION = 1 as const;
export const HUMAN_EVALUATION_PROTOCOL_VERSION = "marketing-pro-human-evaluation-v1" as const;

/** caseId canônico -> runId da PRIMEIRA geração oficial (a única que pode ser avaliada para o KPI). */
export const FIRST_OFFICIAL_GENERATION_RUNS: Readonly<Record<string, string>> = {
  "beauty-luxury-01": "run-2026-08-16T15-11-37-879Z",
  "beauty-sensory-01": "run-2026-08-16T17-03-02-802Z",
  "fashion-editorial-01": "run-2026-08-16T16-35-06-959Z",
  "fashion-modern-01": "run-2026-08-16T16-56-25-957Z",
  "food-sensory-01": "run-2026-08-16T16-10-57-047Z",
  "electronics-minimal-01": "run-2026-08-16T16-06-08-746Z",
  "electronics-modern-01": "run-2026-08-16T16-47-18-322Z",
  "general-editorial-01": "run-2026-08-16T16-51-11-020Z",
  "home-minimal-01": "run-2026-08-16T16-43-37-214Z",
};

/**
 * caseId -> quantidade de tentativas anteriores à primeira geração oficial que tiveram HTTP 2xx
 * (potencialmente cobradas) mas não produziram imagem avaliável — nunca contam para o KPI visual, mas
 * ficam registradas aqui para auditoria financeira/histórica. Ausente ou 0 = nenhuma tentativa assim.
 */
export const PRIOR_NON_EVALUABLE_ATTEMPTS: Readonly<Record<string, number>> = {
  "beauty-luxury-01": 1,
};

export function resolvePriorNonEvaluableAttempts(caseId: string): number {
  return PRIOR_NON_EVALUABLE_ATTEMPTS[caseId] ?? 0;
}

export type MarketingProHumanEvaluationStatus = "draft" | "completed" | "superseded";

/** As mesmas 8 dimensões/faixa 0–10 do contrato de benchmark já existente — nunca redefinidas aqui. */
export type MarketingProHumanEvaluationScoreV1 = Omit<MarketingProBenchmarkScore, "notes">;

export interface MarketingProHumanEvaluationCriticalViolationsV1 {
  readonly textDetected: boolean;
  readonly logoOrBrandDetected: boolean;
  readonly ctaOrButtonDetected: boolean;
  readonly fakeProductDetected: boolean;
  readonly packagingDetected: boolean;
  readonly personOrHandsDetected: boolean;
  readonly otherCriticalViolation: boolean;
}

export const HUMAN_EVALUATION_CRITICAL_VIOLATION_KEYS: readonly (keyof MarketingProHumanEvaluationCriticalViolationsV1)[] = [
  "textDetected",
  "logoOrBrandDetected",
  "ctaOrButtonDetected",
  "fakeProductDetected",
  "packagingDetected",
  "personOrHandsDetected",
  "otherCriticalViolation",
];

export interface MarketingProHumanEvaluationEvaluatorV1 {
  readonly id: string;
  readonly displayName?: string;
}

export interface MarketingProHumanEvaluationSourceContextV1 {
  readonly technicalSuccess: boolean;
  readonly qualityAccepted: boolean;
  readonly priorNonEvaluableAttempts: number;
}

/**
 * O sidecar completo — persistido em `human-evaluation.v1.json`, ao lado de `result.json` e
 * `background.jpg`, dentro do diretório da primeira geração oficial de cada caso. NUNCA sobrescreve
 * nem lê o conteúdo desses dois arquivos técnicos como parte do próprio tipo — só referencia caminhos e
 * hashes (ver human-evaluation-persist.ts para a validação cruzada contra o disco).
 */
export interface MarketingProHumanEvaluationV1 {
  readonly schemaVersion: 1;
  readonly protocolVersion: "marketing-pro-human-evaluation-v1";

  readonly runId: string;
  readonly provider: MarketingProBenchmarkProviderId;
  readonly model: string;
  readonly caseId: string;

  /** Sempre `true` neste schema — o sidecar só existe para primeiras gerações oficiais, nunca regenerações. */
  readonly isFirstOfficialGeneration: true;

  readonly resultPath: string;
  readonly backgroundPath: string;
  readonly resultSha256: string;
  readonly backgroundSha256: string;

  readonly evaluatedAt: string;
  readonly evaluationStatus: MarketingProHumanEvaluationStatus;

  /** `null` só é válido em `draft` — `completed` exige um boolean real (ver validador). */
  readonly firstUsableWithoutRegeneration: boolean | null;

  /** Opcional também em `completed`: o KPI primário é booleano; notas são informação complementar. */
  readonly score: MarketingProHumanEvaluationScoreV1 | null;

  readonly criticalViolations: MarketingProHumanEvaluationCriticalViolationsV1;

  /** Texto livre do avaliador — obrigatório e não-vazio quando `otherCriticalViolation === true`. */
  readonly notes: string;

  readonly evaluator: MarketingProHumanEvaluationEvaluatorV1;

  /** Sempre 1 na primeira gravação; cada revisão subsequente incrementa e referencia `supersedes`. */
  readonly revision: number;
  /** Nome do arquivo histórico que esta revisão substitui (ex.: "human-evaluation.v1.r1.json"). Ausente na revisão 1. */
  readonly supersedes?: string;

  readonly sourceContext: MarketingProHumanEvaluationSourceContextV1;
}

/** Nome de arquivo do snapshot histórico de uma revisão já substituída — nunca reescrito depois de criado. */
export function historicalEvaluationFileName(supersededRevision: number): string {
  return `human-evaluation.v1.r${supersededRevision}.json`;
}

export const CURRENT_EVALUATION_FILE_NAME = "human-evaluation.v1.json";
