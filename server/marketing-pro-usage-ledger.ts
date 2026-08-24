/**
 * PRO-09 §9 — usage record server-owned por operação, em `marketingProUsage/{operationId}`. Evolui o
 * cost guard do PRO-08 (`marketing-pro-cost-guard.ts`, que só soma um total agregado para o hard stop)
 * sem redesenhá-lo: o ledger agregado continua sendo a matemática RÁPIDA do hard stop; este módulo
 * adiciona o registro POR OPERAÇÃO — auditável, com lifecycle de status — que o agregado não guarda.
 *
 * Micro-USD inteiro (não float): `0.067` USD como float acumula erro de ponto flutuante ao ser somado
 * milhares de vezes; `67_000` micro-USD inteiro não. `MARKETING_PRO_MICRO_USD_PER_USD` é a única
 * conversão entre as duas representações.
 *
 * REGRA DE OURO (§9): antes do dispatch ao provider, uma falha (rate limit, orçamento, validação de
 * input) é `failedPreDispatch` — zero custo possível, o request nunca saiu. DEPOIS do dispatch, uma
 * falha NUNCA volta a `failedPreDispatch`/"sem custo" — vira `potentiallyBilled`, porque o provider pode
 * ter processado a chamada mesmo sem produzir um resultado usável (mesmo raciocínio de
 * `script/marketing-pro-benchmark/providers/google.ts`, `potentiallyBilled: true` num 2xx sem imagem
 * válida). Só um resultado que passou por TODOS os gates e foi persistido vira `committed`.
 */
export const MARKETING_PRO_MICRO_USD_PER_USD = 1_000_000;

export function usdToMicroUsd(usd: number): number {
  return Math.round(usd * MARKETING_PRO_MICRO_USD_PER_USD);
}

export type MarketingProUsageStatus =
  | "reserved"
  | "dispatched"
  | "committed"
  | "rejected"
  | "failedPreDispatch"
  | "potentiallyBilled";

const USAGE_STATUS_TRANSITIONS: Record<MarketingProUsageStatus, readonly MarketingProUsageStatus[]> = {
  reserved: ["dispatched", "failedPreDispatch", "rejected"],
  dispatched: ["committed", "potentiallyBilled"],
  committed: [],
  rejected: [],
  failedPreDispatch: [],
  potentiallyBilled: [],
};

export function canTransitionMarketingProUsageStatus(from: MarketingProUsageStatus, to: MarketingProUsageStatus): boolean {
  return USAGE_STATUS_TRANSITIONS[from].includes(to);
}

export const MARKETING_PRO_USAGE_COLLECTION = "marketingProUsage";

export interface MarketingProUsageRecord {
  readonly operationId: string;
  readonly uid: string;
  readonly generationRequestId: string;
  readonly provider: string;
  readonly model: string;
  readonly inspectionProvider?: string;
  readonly inspectionModel?: string;
  readonly inspectionReservedCostMicroUsd?: number;
  readonly status: MarketingProUsageStatus;
  readonly reservedCostMicroUsd: number;
  readonly committedCostMicroUsd: number | null;
  readonly potentiallyBilled: boolean;
  readonly createdAt: unknown;
  readonly providerCallStartedAt: unknown | null;
  readonly completedAt: unknown | null;
}

interface FirestoreDocRefLike {
  set(data: Record<string, unknown>, options?: { merge?: boolean }): Promise<unknown>;
  update(data: Record<string, unknown>): Promise<unknown>;
}
interface FirestoreLike {
  collection(path: string): { doc(id: string): FirestoreDocRefLike };
}
interface AdminLike {
  firestore: { FieldValue: { serverTimestamp(): unknown } };
}

/** Criado dentro da MESMA transação que reserva idempotência/rate-limit/budget — ver server/marketing-pro.ts. */
export function buildMarketingProUsageReservationWrite(input: {
  readonly operationId: string;
  readonly uid: string;
  readonly generationRequestId: string;
  readonly provider: string;
  readonly model: string;
  readonly inspectionProvider?: string;
  readonly inspectionModel?: string;
  readonly inspectionReservedCostMicroUsd?: number;
  readonly reservedCostMicroUsd: number;
}, admin: AdminLike): Record<string, unknown> {
  return {
    operationId: input.operationId,
    uid: input.uid,
    generationRequestId: input.generationRequestId,
    provider: input.provider,
    model: input.model,
    ...(input.inspectionProvider ? { inspectionProvider: input.inspectionProvider } : {}),
    ...(input.inspectionModel ? { inspectionModel: input.inspectionModel } : {}),
    ...(input.inspectionReservedCostMicroUsd !== undefined ? { inspectionReservedCostMicroUsd: input.inspectionReservedCostMicroUsd } : {}),
    status: "reserved" satisfies MarketingProUsageStatus,
    reservedCostMicroUsd: input.reservedCostMicroUsd,
    committedCostMicroUsd: null,
    potentiallyBilled: false,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    providerCallStartedAt: null,
    completedAt: null,
  };
}

function usageRef(db: FirestoreLike, operationId: string): FirestoreDocRefLike {
  return db.collection(MARKETING_PRO_USAGE_COLLECTION).doc(operationId);
}

/** reserved -> dispatched, logo antes de chamar o provider de verdade. */
export async function markMarketingProUsageDispatched(db: FirestoreLike, admin: AdminLike, operationId: string): Promise<void> {
  await usageRef(db, operationId).update({ status: "dispatched" satisfies MarketingProUsageStatus, providerCallStartedAt: admin.firestore.FieldValue.serverTimestamp() });
}

/** dispatched -> committed, só depois de TODOS os gates aprovados e o asset persistido. */
export async function markMarketingProUsageCommitted(db: FirestoreLike, admin: AdminLike, operationId: string, committedCostMicroUsd: number): Promise<void> {
  await usageRef(db, operationId).update({
    status: "committed" satisfies MarketingProUsageStatus,
    committedCostMicroUsd,
    completedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

/** dispatched -> potentiallyBilled: timeout, erro pós-dispatch ou saída rejeitada por qualquer gate. */
export async function markMarketingProUsagePotentiallyBilled(db: FirestoreLike, admin: AdminLike, operationId: string): Promise<void> {
  await usageRef(db, operationId).update({
    status: "potentiallyBilled" satisfies MarketingProUsageStatus,
    potentiallyBilled: true,
    completedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

/** reserved -> failedPreDispatch: nunca chegou a sair uma chamada ao provider (ex.: erro interno antes do dispatch). */
export async function markMarketingProUsageFailedPreDispatch(db: FirestoreLike, admin: AdminLike, operationId: string): Promise<void> {
  await usageRef(db, operationId).update({ status: "failedPreDispatch" satisfies MarketingProUsageStatus, completedAt: admin.firestore.FieldValue.serverTimestamp() });
}

/** reserved -> rejected: bloqueado ANTES do dispatch por rate limit/orçamento (a própria reserva nunca chega a "existir" de fato como custo). */
export async function markMarketingProUsageRejected(db: FirestoreLike, admin: AdminLike, operationId: string): Promise<void> {
  await usageRef(db, operationId).update({ status: "rejected" satisfies MarketingProUsageStatus, completedAt: admin.firestore.FieldValue.serverTimestamp() });
}
