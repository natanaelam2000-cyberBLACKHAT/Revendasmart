/**
 * Ledger persistente de reserva conservadora — PRO-06B2.2 (P1, proteção financeira entre execuções).
 *
 * Antes desta correção, `MarketingProBenchmarkSpendGuard` começava zerado a CADA execução do script.
 * O hard stop só protegia DENTRO de um processo — cada `npm run marketing-pro:benchmark -- --smoke` é
 * um processo novo, então rodar o comando várias vezes em sequência (como aconteceu nesta própria
 * sprint: 3 tentativas reais separadas) não tinha proteção acumulada nenhuma entre elas. O teto
 * autorizado podia ser ultrapassado só por rodar o comando de novo, mesmo que cada chamada isolada
 * respeitasse o teto sozinha.
 *
 * Este ledger persiste em disco (fora do git, mesma pasta `.tmp/` já usada para os manifestos) a soma
 * de TODAS as reservas conservadoras já feitas, de qualquer execução anterior, sucesso ou falha —
 * inclusive falhas que aconteceram depois de um HTTP 2xx (`potentiallyBilled: true`), que podem ter
 * consumido inferência paga mesmo sem produzir uma imagem usável aqui. `MarketingProBenchmarkSpendGuard`
 * é semeado com este total ao iniciar cada execução.
 *
 * Todas as funções aceitam um `ledgerPath` opcional (default: o ledger real de produção) — os testes
 * usam um caminho próprio, nunca o ledger real, para não poluir o histórico de gasto de verdade com
 * dados sintéticos.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { MarketingProBenchmarkProviderId } from "./types";

const DEFAULT_LEDGER_PATH = path.join(".tmp", "marketing-pro-benchmark", "spend-ledger.json");

export interface SpendLedgerEntry {
  readonly timestamp: string;
  readonly provider: MarketingProBenchmarkProviderId;
  readonly caseId: string;
  readonly conservativeMaxUsd: number;
  readonly outcome: "success" | "failed";
  /** Só relevante para outcome "failed" — ver GenerateBenchmarkBackgroundResult.potentiallyBilled. */
  readonly potentiallyBilled: boolean;
}

interface SpendLedgerFile {
  readonly entries: readonly SpendLedgerEntry[];
}

function readLedgerFile(ledgerPath: string): SpendLedgerFile {
  try {
    const raw = fs.readFileSync(ledgerPath, "utf8");
    const parsed = JSON.parse(raw) as SpendLedgerFile;
    return Array.isArray(parsed.entries) ? parsed : { entries: [] };
  } catch {
    return { entries: [] }; // sem ledger ainda = nenhuma reserva registrada até agora
  }
}

/** Soma de TODAS as reservas conservadoras já feitas em execuções anteriores (qualquer resultado). */
export function readAccumulatedConservativeSpendUsd(ledgerPath: string = DEFAULT_LEDGER_PATH): number {
  return readLedgerFile(ledgerPath).entries.reduce((sum, entry) => sum + entry.conservativeMaxUsd, 0);
}

export function readSpendLedgerEntries(ledgerPath: string = DEFAULT_LEDGER_PATH): readonly SpendLedgerEntry[] {
  return readLedgerFile(ledgerPath).entries;
}

/**
 * Acrescenta uma reserva ao ledger persistente. Chamado para TODA tentativa real (sucesso ou falha),
 * exatamente no mesmo momento em que `MarketingProBenchmarkSpendGuard.recordConservativeReservation`
 * é chamado em memória — os dois precisam ficar sempre em sincronia.
 */
export function appendSpendLedgerEntry(entry: SpendLedgerEntry, ledgerPath: string = DEFAULT_LEDGER_PATH): void {
  const current = readLedgerFile(ledgerPath);
  fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
  fs.writeFileSync(ledgerPath, JSON.stringify({ entries: [...current.entries, entry] }, null, 2));
}

export function getSpendLedgerPath(): string {
  return DEFAULT_LEDGER_PATH;
}
