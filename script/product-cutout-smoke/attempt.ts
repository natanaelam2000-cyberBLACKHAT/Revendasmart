import { runPhotoroomCutoutAdapter, type PhotoroomCutoutAdapterDependencies, type PhotoroomCutoutAttemptResult, type RunPhotoroomCutoutInput } from "./photoroom";
import {
  PHOTOROOM_CONSERVATIVE_MAX_REQUEST_COST_USD,
  PHOTOROOM_ESTIMATED_REQUEST_COST_USD,
  appendProductCutoutLedgerEntry,
  canReserveProductCutoutAttempt,
  type ProductCutoutSmokeLedger,
} from "./ledger";

export type ReservedPhotoroomAttemptInput = RunPhotoroomCutoutInput & {
  readonly caseId: string;
  readonly file: string;
};

export type ReservedPhotoroomAttemptResult = {
  readonly blockedByHardStop: boolean;
  readonly adapter: PhotoroomCutoutAttemptResult | null;
  readonly ledger: ProductCutoutSmokeLedger;
};

export async function runReservedPhotoroomAttempt(
  input: ReservedPhotoroomAttemptInput,
  ledger: ProductCutoutSmokeLedger,
  dependencies: PhotoroomCutoutAdapterDependencies = {},
  now: () => Date = () => new Date(),
): Promise<ReservedPhotoroomAttemptResult> {
  if (!canReserveProductCutoutAttempt(ledger)) {
    return { blockedByHardStop: true, adapter: null, ledger };
  }

  const adapter = await runPhotoroomCutoutAdapter(input, dependencies);
  const nextLedger = appendProductCutoutLedgerEntry(ledger, {
    timestamp: now().toISOString(),
    provider: "photoroom",
    file: input.file,
    caseId: input.caseId,
    estimatedCostUsd: PHOTOROOM_ESTIMATED_REQUEST_COST_USD,
    conservativeMaxCostUsd: PHOTOROOM_CONSERVATIVE_MAX_REQUEST_COST_USD,
    actualBilledCostUsd: null,
    httpOutcome: adapter.httpOutcome,
    potentiallyBilled: adapter.potentiallyBilled,
    success: adapter.success,
    // PRO-07F.3B-RECONCILE-DIAG §6: aditivos — nunca a apiKey/headers, só metadados já presentes no
    // resultado do adapter (que por sua vez nunca ecoa o corpo da resposta, só status/contentType/tamanho).
    httpStatus: adapter.httpStatus,
    durationMs: adapter.durationMs ?? null,
    failureReason: adapter.success ? null : adapter.errorCode ?? null,
  });
  return { blockedByHardStop: false, adapter, ledger: nextLedger };
}
