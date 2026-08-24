/**
 * PRO-08 — hard stop de custo do provider real de background, ANTES de qualquer chamada ao provider.
 *
 * `server/marketing-pro.ts` (PRO-06A) nunca implementou custo/crédito/ledger — era deliberadamente fora
 * de escopo, porque só existia o provider mock (custo zero de verdade). Agora que um provider real pode
 * ser ligado, uma reserva conservadora precisa existir ANTES da chamada, com hard stop se o orçamento
 * acumulado for excedido — mesmo espírito do `MarketingProBenchmarkSpendGuard` de
 * `script/marketing-pro-benchmark/pricing.ts`, mas persistido no Firestore (não em memória/disco local
 * de um processo de script) porque a rota de produção roda em múltiplas instâncias Cloud Run.
 *
 * A decisão pura (`decideMarketingProCostReservation`) é testável sem Firestore; `reserveMarketingProBackgroundBudget`
 * é a única casca que fala com o Firestore, dentro de uma `runTransaction` (mesmo primitivo que
 * `server/marketing-pro.ts` já usa para a idempotência do `generationRequestId`) — leitura e escrita do
 * ledger acontecem atomicamente, então duas reservas concorrentes nunca ultrapassam o teto por uma
 * corrida de leitura-depois-escrita.
 *
 * Reservado só uma vez por `generationId` vencedor (branch "create-new" da transação de idempotência em
 * marketing-pro.ts) — um retry idempotente (mesmo requestId) ou um double-click nunca chega a chamar
 * esta função de novo, porque nunca chega a ganhar o branch "create-new" pela segunda vez.
 */
export const MARKETING_PRO_BACKGROUND_LEDGER_COLLECTION = "marketingProBudget";
export const MARKETING_PRO_BACKGROUND_LEDGER_DOC_ID = "realBackgroundGlobal";

/**
 * US$0,067/imagem — Google Gemini 3.1 Flash Image ("Nano Banana 2"), bucket de resolução 1K. Mesma
 * fonte/data de revalidação que `script/marketing-pro-benchmark/pricing.ts` (ai.google.dev/gemini-api/
 * docs/pricing, consultado 2026-08-15) — número duplicado deliberadamente (não importado de `script/`,
 * que é um sandbox Node-only que nunca deve virar dependência de runtime do servidor, mesmo raciocínio
 * já aplicado a `shared/image-validation.ts` sobre `script/marketing-pro-benchmark/image-dimensions.ts`).
 */
export const MARKETING_PRO_BACKGROUND_CONSERVATIVE_COST_USD = 0.067;
/** Reserva conservadora da segunda chamada multimodal barata que inspeciona somente o background. */
export const MARKETING_PRO_SEMANTIC_INSPECTION_CONSERVATIVE_COST_USD = 0.001;
/** Uma operação aprovada envolve no máximo uma geração e uma inspeção, ambas sem retry automático. */
export const MARKETING_PRO_OPERATION_CONSERVATIVE_COST_USD =
  MARKETING_PRO_BACKGROUND_CONSERVATIVE_COST_USD + MARKETING_PRO_SEMANTIC_INSPECTION_CONSERVATIVE_COST_USD;

const DEFAULT_BUDGET_USD = 5;

/**
 * Teto configurável via `MARKETING_PRO_BACKGROUND_BUDGET_USD`. Sem a variável (ou com valor inválido),
 * o default é conservador (US$5 ~ 74 gerações ao custo unitário acima) — nunca "sem teto".
 */
export function resolveMarketingProBackgroundBudgetUsd(): number {
  const raw = process.env.MARKETING_PRO_BACKGROUND_BUDGET_USD;
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_BUDGET_USD;
}

export interface MarketingProCostReservationDecision {
  readonly allowed: boolean;
  readonly newReservedUsd: number;
}

/** Função pura — testável isoladamente, sem Firestore. */
export function decideMarketingProCostReservation(
  currentReservedUsd: number,
  conservativeCostUsd: number,
  budgetUsd: number,
): MarketingProCostReservationDecision {
  const newReservedUsd = currentReservedUsd + conservativeCostUsd;
  return { allowed: newReservedUsd <= budgetUsd, newReservedUsd };
}

interface FirestoreLike {
  collection(path: string): {
    doc(id: string): {
      get(): Promise<{ exists: boolean; data(): unknown }>;
    };
  };
  runTransaction<T>(fn: (tx: any) => Promise<T>): Promise<T>;
}

/**
 * Reserva atômica do custo conservador de UMA chamada real. Devolve `false` (nunca lança) quando o
 * orçamento seria excedido — o call site é responsável por marcar a geração como `failed` com
 * `errorCode: "BUDGET_EXCEEDED"` e nunca chamar o provider nesse caso.
 */
/**
 * §11 da tarefa PRO-09 (corrigido aqui): ANTES desta correção, um doc de ledger EXISTENTE mas com
 * `reservedUsd` corrompido (campo ausente, string, NaN) caía no fallback `?? 0` — ou seja, um estado
 * corrompido era tratado como "nada foi gasto ainda", o que é FAIL-OPEN (permite gastar de novo o
 * orçamento inteiro por cima de um valor que pode já estar certo, só ilegível). A distinção correta:
 * doc INEXISTENTE (nunca houve reserva) é legitimamente 0; doc EXISTENTE com campo corrompido é uma
 * anomalia e precisa BLOQUEAR (fail closed), nunca assumir um valor.
 */
export type MarketingProCostLedgerReadState =
  | { readonly kind: "absent" }
  | { readonly kind: "valid"; readonly reservedUsd: number }
  | { readonly kind: "corrupted" };

/** Função pura — testável sem Firestore. */
export function readMarketingProCostLedgerState(exists: boolean, data: { reservedUsd?: unknown } | null): MarketingProCostLedgerReadState {
  if (!exists) return { kind: "absent" };
  const value = data?.reservedUsd;
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return { kind: "valid", reservedUsd: value };
  return { kind: "corrupted" };
}

export async function reserveMarketingProBackgroundBudget(
  db: FirestoreLike,
  admin: { firestore: { FieldValue: { serverTimestamp(): unknown } } },
): Promise<boolean> {
  const budgetUsd = resolveMarketingProBackgroundBudgetUsd();
  const ledgerRef = db.collection(MARKETING_PRO_BACKGROUND_LEDGER_COLLECTION).doc(MARKETING_PRO_BACKGROUND_LEDGER_DOC_ID);
  return db.runTransaction(async (tx: any) => {
    const snap = await tx.get(ledgerRef);
    const state = readMarketingProCostLedgerState(snap.exists, snap.exists ? (snap.data() as { reservedUsd?: unknown }) : null);
    if (state.kind === "corrupted") return false;
    const currentReservedUsd = state.kind === "valid" ? state.reservedUsd : 0;
    const decision = decideMarketingProCostReservation(currentReservedUsd, MARKETING_PRO_OPERATION_CONSERVATIVE_COST_USD, budgetUsd);
    if (!decision.allowed) return false;
    tx.set(ledgerRef, { reservedUsd: decision.newReservedUsd, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    return true;
  });
}
