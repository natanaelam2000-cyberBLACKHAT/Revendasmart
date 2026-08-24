/**
 * Persistência auditável do sidecar de avaliação humana — PRO-06B4.
 *
 * Grava `human-evaluation.v1.json` ao lado de `result.json`/`background.jpg`, na pasta da primeira
 * geração oficial de cada caso (`FIRST_OFFICIAL_GENERATION_RUNS`). Nunca abre `background.jpg`,
 * `result.json`, `benchmark-run.json` ou `spend-ledger.json` em modo de escrita — só leitura, para
 * cross-validar o candidato contra o que realmente está em disco (technicalSuccess/qualityAccepted/
 * provider/model/caseId e os hashes SHA-256 dos dois arquivos técnicos).
 *
 * Validação em duas camadas: primeiro a forma pura do candidato (human-evaluation-validate.ts, sem
 * I/O — um candidato inválido nunca chega a abrir um arquivo), depois a validação cruzada com disco
 * feita aqui. Escrita sempre atômica (arquivo temporário + rename); revisão nunca sobrescreve o
 * histórico — a revisão anterior é preservada verbatim num arquivo `.rN.json` próprio antes da nova
 * revisão virar o arquivo "atual".
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { validateMarketingProHumanEvaluationShape } from "./human-evaluation-validate";
import { CURRENT_EVALUATION_FILE_NAME, historicalEvaluationFileName, type MarketingProHumanEvaluationV1 } from "./human-evaluation-types";

const DEFAULT_BASE_DIR = path.join(".tmp", "marketing-pro-benchmark");
const BACKGROUND_BASENAME_PATTERN = /^background\.(jpg|jpeg|png|webp)$/;

export interface PersistMarketingProHumanEvaluationOptions {
  /** Raiz onde os diretórios "run-<timestamp>/<provider>/<caseId>/" vivem. Default: o mesmo `.tmp/` de produção. */
  readonly baseDir?: string;
}

export type PersistMarketingProHumanEvaluationOutcome =
  | { readonly ok: true; readonly writtenPath: string; readonly archivedPreviousPath: string | null; readonly record: MarketingProHumanEvaluationV1 }
  | { readonly ok: false; readonly errors: readonly string[] };

interface ResultJsonSnapshot {
  readonly caseId: unknown;
  readonly provider: unknown;
  readonly model: unknown;
  readonly technicalSuccess: unknown;
  readonly qualityAccepted: unknown;
}

function sha256Hex(bytes: Buffer): string {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function readJsonIfExists<T>(filePath: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

function atomicWriteFile(targetPath: string, content: string): void {
  const dir = path.dirname(targetPath);
  fs.mkdirSync(dir, { recursive: true });
  const tmpPath = path.join(dir, `.tmp-${path.basename(targetPath)}-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  fs.writeFileSync(tmpPath, content, "utf8");
  fs.renameSync(tmpPath, targetPath);
}

/**
 * Camada 2 de validação: cruza o candidato contra o que está fisicamente em disco. Só é chamada depois
 * que `validateMarketingProHumanEvaluationShape` já passou sem erros (caseId/runId canônicos garantidos).
 */
function validateAgainstDisk(candidate: MarketingProHumanEvaluationV1, caseDir: string): string[] {
  const errors: string[] = [];

  const expectedResultPath = path.join(caseDir, "result.json");
  if (candidate.resultPath !== expectedResultPath) {
    errors.push(`resultPath precisa ser exatamente "${expectedResultPath}" (recebido "${candidate.resultPath}")`);
  }
  const backgroundDir = path.dirname(candidate.backgroundPath);
  const backgroundBasename = path.basename(candidate.backgroundPath);
  if (backgroundDir !== caseDir || !BACKGROUND_BASENAME_PATTERN.test(backgroundBasename)) {
    errors.push(`backgroundPath precisa apontar para "background.{jpg|jpeg|png|webp}" dentro de "${caseDir}" (recebido "${candidate.backgroundPath}")`);
  }
  if (errors.length > 0) return errors; // caminhos inválidos — não tenta ler nada

  let resultBytes: Buffer;
  let backgroundBytes: Buffer;
  try {
    resultBytes = fs.readFileSync(candidate.resultPath);
  } catch {
    return [`result.json não encontrado em "${candidate.resultPath}" — a primeira geração oficial não existe em disco`];
  }
  try {
    backgroundBytes = fs.readFileSync(candidate.backgroundPath);
  } catch {
    return [`background não encontrado em "${candidate.backgroundPath}" — a primeira geração oficial não existe em disco`];
  }

  const actualResultHash = sha256Hex(resultBytes);
  const actualBackgroundHash = sha256Hex(backgroundBytes);
  if (candidate.resultSha256.toLowerCase() !== actualResultHash) {
    errors.push(`resultSha256 divergente do arquivo real em disco (esperado "${actualResultHash}")`);
  }
  if (candidate.backgroundSha256.toLowerCase() !== actualBackgroundHash) {
    errors.push(`backgroundSha256 divergente do arquivo real em disco (esperado "${actualBackgroundHash}")`);
  }

  const result = readJsonIfExists<ResultJsonSnapshot>(candidate.resultPath);
  if (!result) {
    errors.push("result.json não pôde ser lido como JSON válido");
    return errors;
  }
  if (result.caseId !== candidate.caseId) errors.push(`result.json.caseId ("${String(result.caseId)}") diverge do candidato ("${candidate.caseId}")`);
  if (result.provider !== candidate.provider) errors.push(`result.json.provider ("${String(result.provider)}") diverge do candidato ("${candidate.provider}")`);
  if (result.model !== candidate.model) errors.push(`result.json.model ("${String(result.model)}") diverge do candidato ("${candidate.model}")`);
  if (result.technicalSuccess !== true) errors.push("result.json.technicalSuccess não é true — geração sem sucesso técnico não pode ser avaliada");
  if (result.qualityAccepted !== true) errors.push("result.json.qualityAccepted não é true — geração rejeitada pelo quality gate não pode ser avaliada");

  return errors;
}

/**
 * Valida a lógica de revisão/overwrite: primeira gravação exige revision=1 sem arquivo prévio; toda
 * gravação seguinte exige revision = anterior+1 e supersedes apontando exatamente para o snapshot da
 * anterior. Nunca sobrescreve silenciosamente.
 */
function validateRevisionSequence(candidate: MarketingProHumanEvaluationV1, existing: MarketingProHumanEvaluationV1 | null): string[] {
  if (existing === null) {
    return candidate.revision === 1
      ? []
      : [`nenhuma avaliação anterior encontrada, mas revision=${candidate.revision} (esperado 1 para a primeira gravação)`];
  }
  const expectedRevision = existing.revision + 1;
  const expectedSupersedes = historicalEvaluationFileName(existing.revision);
  const errors: string[] = [];
  if (candidate.revision !== expectedRevision) {
    errors.push(`já existe uma avaliação (revision=${existing.revision}) — a nova gravação precisa ter revision=${expectedRevision}, recebido ${candidate.revision}. Overwrite silencioso recusado.`);
  }
  if (candidate.supersedes !== expectedSupersedes) {
    errors.push(`supersedes precisa ser "${expectedSupersedes}" (recebido "${String(candidate.supersedes)}")`);
  }
  return errors;
}

/**
 * Ponto de entrada único de escrita. Retorna `{ ok: false, errors }` sem tocar em disco nenhum quando
 * qualquer validação falha — nunca grava parcialmente.
 */
export function persistMarketingProHumanEvaluation(
  candidate: MarketingProHumanEvaluationV1,
  options: PersistMarketingProHumanEvaluationOptions = {},
): PersistMarketingProHumanEvaluationOutcome {
  const shapeErrors = validateMarketingProHumanEvaluationShape(candidate);
  if (shapeErrors.length > 0) return { ok: false, errors: shapeErrors };

  const baseDir = options.baseDir ?? DEFAULT_BASE_DIR;
  const caseDir = path.join(baseDir, candidate.runId, candidate.provider, candidate.caseId);

  const diskErrors = validateAgainstDisk(candidate, caseDir);
  if (diskErrors.length > 0) return { ok: false, errors: diskErrors };

  const currentPath = path.join(caseDir, CURRENT_EVALUATION_FILE_NAME);
  const existing = readJsonIfExists<MarketingProHumanEvaluationV1>(currentPath);

  const revisionErrors = validateRevisionSequence(candidate, existing);
  if (revisionErrors.length > 0) return { ok: false, errors: revisionErrors };

  let archivedPreviousPath: string | null = null;
  if (existing !== null) {
    const historicalPath = path.join(caseDir, historicalEvaluationFileName(existing.revision));
    if (fs.existsSync(historicalPath)) {
      return { ok: false, errors: [`inconsistência de histórico: "${historicalPath}" já existe — abortando antes de tocar no arquivo atual`] };
    }
    const existingRaw = fs.readFileSync(currentPath, "utf8");
    atomicWriteFile(historicalPath, existingRaw);
    archivedPreviousPath = historicalPath;
  }

  atomicWriteFile(currentPath, JSON.stringify(candidate, null, 2));

  return { ok: true, writtenPath: currentPath, archivedPreviousPath, record: candidate };
}

export function readCurrentMarketingProHumanEvaluation(
  caseId: string,
  runId: string,
  provider: string,
  options: PersistMarketingProHumanEvaluationOptions = {},
): MarketingProHumanEvaluationV1 | null {
  const baseDir = options.baseDir ?? DEFAULT_BASE_DIR;
  const currentPath = path.join(baseDir, runId, provider, caseId, CURRENT_EVALUATION_FILE_NAME);
  return readJsonIfExists<MarketingProHumanEvaluationV1>(currentPath);
}
