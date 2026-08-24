/**
 * AVISO: este arquivo foi RECONSTRUÍDO em 2026-08-17 depois de uma colisão de escrita concorrente —
 * ver o mesmo aviso em ./cases.ts para o contexto completo. O contrato abaixo (nomes, assinaturas,
 * tipos) foi inferido dos call sites reais em ./attempt.ts, ./cli.ts e ./tests.ts, e faz o teste
 * de hard-stop de ./tests.ts passar exatamente como escrito. O que NÃO é 100% certo, por não
 * aparecer em nenhum call site observável, é o valor exato de
 * PHOTOROOM_CONSERVATIVE_MAX_REQUEST_COST_USD — usei 0,10 (5x o preço documentado de US$0,02) como
 * margem conservadora razoável; confirmar com a sessão original antes de usar para decisão real de
 * orçamento.
 */
import fs from "node:fs/promises";
import path from "node:path";

export const PHOTOROOM_ESTIMATED_REQUEST_COST_USD = 0.02;
export const PHOTOROOM_CONSERVATIVE_MAX_REQUEST_COST_USD = 0.1;
export const PRODUCT_CUTOUT_SMOKE_HARD_STOP_USD = 1;

export interface ProductCutoutLedgerEntry {
  readonly timestamp: string;
  readonly provider: string;
  readonly file: string;
  readonly caseId: string;
  readonly estimatedCostUsd: number;
  readonly conservativeMaxCostUsd: number;
  readonly actualBilledCostUsd: number | null;
  readonly httpOutcome: string;
  readonly potentiallyBilled: boolean;
  readonly success: boolean;
  /**
   * PRO-07F.3B-RECONCILE-DIAG §6: aditivos — opcionais para preservar compatibilidade com entradas já
   * persistidas (spend-ledger.json atual não tem nenhuma, mas o tipo aceita ambos os formatos).
   * `failureReason` é sempre um código curto (ex.: "HTTP_429", "mask-decode-failed") — nunca corpo de
   * resposta, nunca segredo. `httpStatus` fica separado de `httpOutcome` (que continua sendo a string
   * descritiva já usada, ex.: "http-429") para permitir filtrar/agrupar numericamente sem parsear texto.
   */
  readonly httpStatus?: number | null;
  readonly durationMs?: number | null;
  readonly failureReason?: string | null;
}

export interface ProductCutoutSmokeLedger {
  readonly schemaVersion: 1;
  readonly currency: "USD";
  readonly hardStopUsd: number;
  readonly entries: readonly ProductCutoutLedgerEntry[];
}

export function emptyProductCutoutSmokeLedger(): ProductCutoutSmokeLedger {
  return { schemaVersion: 1, currency: "USD", hardStopUsd: PRODUCT_CUTOUT_SMOKE_HARD_STOP_USD, entries: [] };
}

/** Soma conservadora: qualquer tentativa que possa ter sido cobrada (potentiallyBilled) reserva seu teto, não a estimativa otimista. */
export function getProductCutoutCommittedSpendUsd(ledger: ProductCutoutSmokeLedger): number {
  return ledger.entries.reduce((sum, entry) => sum + (entry.potentiallyBilled ? entry.conservativeMaxCostUsd : 0), 0);
}

export function canReserveProductCutoutAttempt(ledger: ProductCutoutSmokeLedger): boolean {
  return getProductCutoutCommittedSpendUsd(ledger) + PHOTOROOM_CONSERVATIVE_MAX_REQUEST_COST_USD <= ledger.hardStopUsd;
}

export function appendProductCutoutLedgerEntry(ledger: ProductCutoutSmokeLedger, entry: ProductCutoutLedgerEntry): ProductCutoutSmokeLedger {
  return { ...ledger, entries: [...ledger.entries, entry] };
}

export async function readProductCutoutSmokeLedger(ledgerPath: string): Promise<ProductCutoutSmokeLedger> {
  try {
    const raw = await fs.readFile(ledgerPath, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.entries)) return parsed as ProductCutoutSmokeLedger;
    return emptyProductCutoutSmokeLedger();
  } catch {
    return emptyProductCutoutSmokeLedger();
  }
}

export async function writeProductCutoutSmokeLedger(ledgerPath: string, ledger: ProductCutoutSmokeLedger): Promise<void> {
  await fs.mkdir(path.dirname(ledgerPath), { recursive: true });
  await fs.writeFile(ledgerPath, JSON.stringify(ledger, null, 2));
}
