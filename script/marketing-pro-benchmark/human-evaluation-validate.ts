/**
 * Validação estrutural PURA do sidecar de avaliação humana — PRO-06B4.
 *
 * Zero I/O aqui de propósito: recebe o candidato inteiro (já montado em memória) e devolve a lista de
 * erros, sem tocar em disco. A validação cruzada contra o `result.json`/hashes reais no disco e a lógica
 * de revisão/overwrite vivem em human-evaluation-persist.ts, que chama este módulo como primeiro passo.
 * Mesmo padrão de extração pura já usado neste diretório (cli-args.ts, pricing.ts) para permitir testar
 * cada regra isoladamente, sem precisar de arquivos reais nem de um provider real.
 */

import { isValidMarketingProBenchmarkScoreValue, MARKETING_PRO_BENCHMARK_SCORE_DIMENSIONS } from "../../shared/marketing-pro-benchmark";
import { VALID_BENCHMARK_CASE_IDS, VALID_PROVIDER_IDS } from "./cli-args";
import {
  FIRST_OFFICIAL_GENERATION_RUNS,
  HUMAN_EVALUATION_CRITICAL_VIOLATION_KEYS,
  HUMAN_EVALUATION_PROTOCOL_VERSION,
  HUMAN_EVALUATION_SCHEMA_VERSION,
  resolvePriorNonEvaluableAttempts,
  type MarketingProHumanEvaluationV1,
} from "./human-evaluation-types";

const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/i;

/**
 * Só a forma do candidato — nunca lê disco. Retorna a lista de erros (vazia = válido). Chamado por
 * `persistMarketingProHumanEvaluation` ANTES de qualquer leitura de arquivo: um candidato estruturalmente
 * inválido (ex.: caseId desconhecido, regeneração) nunca chega a abrir `result.json`.
 */
export function validateMarketingProHumanEvaluationShape(candidate: MarketingProHumanEvaluationV1): string[] {
  const errors: string[] = [];

  if (candidate.schemaVersion !== HUMAN_EVALUATION_SCHEMA_VERSION) {
    errors.push(`schemaVersion precisa ser ${HUMAN_EVALUATION_SCHEMA_VERSION}`);
  }
  if (candidate.protocolVersion !== HUMAN_EVALUATION_PROTOCOL_VERSION) {
    errors.push(`protocolVersion precisa ser "${HUMAN_EVALUATION_PROTOCOL_VERSION}"`);
  }
  if (candidate.isFirstOfficialGeneration !== true) {
    errors.push("isFirstOfficialGeneration precisa ser true — este schema só existe para primeiras gerações oficiais");
  }
  if (!VALID_PROVIDER_IDS.includes(candidate.provider)) {
    errors.push(`provider desconhecido: ${candidate.provider}`);
  }

  if (!VALID_BENCHMARK_CASE_IDS.includes(candidate.caseId)) {
    errors.push(`caseId não canônico: "${candidate.caseId}" — precisa ser um dos 9 casos do benchmark`);
  } else {
    const canonicalRunId = FIRST_OFFICIAL_GENERATION_RUNS[candidate.caseId];
    if (!canonicalRunId) {
      errors.push(`caseId "${candidate.caseId}" ainda não tem primeira geração oficial registrada em FIRST_OFFICIAL_GENERATION_RUNS`);
    } else if (candidate.runId !== canonicalRunId) {
      errors.push(
        `runId "${candidate.runId}" não é a primeira geração oficial de "${candidate.caseId}" (esperado "${canonicalRunId}") — regenerações não podem ser avaliadas para o KPI`,
      );
    }
  }

  for (const key of HUMAN_EVALUATION_CRITICAL_VIOLATION_KEYS) {
    if (typeof candidate.criticalViolations[key] !== "boolean") {
      errors.push(`criticalViolations.${key} precisa ser boolean`);
    }
  }
  if (candidate.criticalViolations.otherCriticalViolation === true && candidate.notes.trim() === "") {
    errors.push("otherCriticalViolation=true exige notes não vazio explicando a violação");
  }

  if (candidate.score !== null) {
    for (const dimension of MARKETING_PRO_BENCHMARK_SCORE_DIMENSIONS) {
      const value = candidate.score[dimension];
      if (!isValidMarketingProBenchmarkScoreValue(value)) {
        errors.push(`score.${dimension} inválido: precisa ser um número finito entre 0 e 10 (recebido: ${String(value)})`);
      }
    }
  }

  if (candidate.evaluationStatus === "completed") {
    if (typeof candidate.firstUsableWithoutRegeneration !== "boolean") {
      errors.push("evaluationStatus=completed exige firstUsableWithoutRegeneration boolean (não null)");
    }
  }

  if (!Number.isInteger(candidate.revision) || candidate.revision < 1) {
    errors.push("revision precisa ser um inteiro >= 1");
  }
  if (candidate.revision === 1 && candidate.supersedes !== undefined) {
    errors.push("revision 1 não pode ter supersedes — só revisões subsequentes substituem uma anterior");
  }
  if (candidate.revision > 1 && candidate.supersedes === undefined) {
    errors.push("revision > 1 exige supersedes apontando para o arquivo histórico substituído");
  }

  if (!candidate.evaluator || candidate.evaluator.id.trim() === "") {
    errors.push("evaluator.id é obrigatório e não pode ser vazio");
  }

  if (!SHA256_HEX_PATTERN.test(candidate.resultSha256)) {
    errors.push("resultSha256 precisa ser um hash SHA-256 hexadecimal válido (64 caracteres)");
  }
  if (!SHA256_HEX_PATTERN.test(candidate.backgroundSha256)) {
    errors.push("backgroundSha256 precisa ser um hash SHA-256 hexadecimal válido (64 caracteres)");
  }

  if (candidate.sourceContext.technicalSuccess !== true) {
    errors.push("sourceContext.technicalSuccess precisa ser true — só gerações tecnicamente bem-sucedidas podem ser avaliadas");
  }
  if (candidate.sourceContext.qualityAccepted !== true) {
    errors.push("sourceContext.qualityAccepted precisa ser true — só gerações aceitas pelo quality gate podem ser avaliadas");
  }
  const expectedPriorAttempts = resolvePriorNonEvaluableAttempts(candidate.caseId);
  if (candidate.sourceContext.priorNonEvaluableAttempts !== expectedPriorAttempts) {
    errors.push(
      `sourceContext.priorNonEvaluableAttempts (${candidate.sourceContext.priorNonEvaluableAttempts}) diverge do valor conhecido para "${candidate.caseId}" (${expectedPriorAttempts})`,
    );
  }

  return errors;
}
