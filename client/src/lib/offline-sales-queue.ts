/**
 * RELEASE-QUALITY-04 §3/§4/§5 — fila de vendas offline. Escopo deliberadamente restrito a vendas
 * "avista" (à vista): venda a prazo já depende de uma segunda chamada (cobrança/parcelamento via
 * Mercado Pago, ver `createSaleCharge` em sell.tsx) que é inerentemente online-only — misturar isso
 * numa fila offline criaria exatamente o risco financeiro que o ticket pede pra evitar.
 *
 * Design: a fila em si É um documento Firestore comum (`users/{uid}/pendingSales/{saleId}`), escrito
 * via `setDoc` — como a persistência offline do Firestore já está ligada (`firebase.ts`), essa escrita
 * entra na fila offline do PRÓPRIO SDK e sobrevive a fechar o app sozinha, sem nenhum motor de
 * sincronização novo. Nenhuma baixa de estoque é decidida aqui — só o servidor (`POST
 * /api/sales/finalize`, `db.runTransaction`) decide e escreve estoque, exatamente como no fluxo online
 * já existente. Replay nunca duplica porque a própria rota já lança `SALE_ALREADY_EXISTS` quando o
 * mesmo `saleId` é reenviado — a fila só precisa tratar esse erro como sucesso.
 */
import { doc, setDoc, deleteField, getFirestore, runTransaction } from "firebase/firestore";
import { getApiUrl } from "./api-config";
import { classifyPendingSaleResponse, type PendingSaleResponse } from "./pending-sale-response";

export interface PendingSalePayload {
  saleId: string;
  clientId: string;
  products: { productId: string; quantity: number }[];
  discountType: "percent" | "fixed";
  discountValue: number;
  paymentType: "avista";
  paymentMethod: string | null;
}

/**
 * RELEASE-QUALITY-05 §9: motivos de conflito, restritos aos que a rota `/api/sales/finalize` já
 * distingue por código (`server/routes.ts`) — nenhum estado novo inventado além do que o servidor
 * já sabe dizer com precisão.
 */
export type PendingSaleConflictReason = "INSUFFICIENT_STOCK" | "PRODUCT_NOT_FOUND" | "PRODUCT_CHANGED";

export interface PendingSaleDoc {
  id: string;
  payload: PendingSalePayload;
  status: "pending" | "syncing" | "failed" | "conflict";
  createdAt: string;
  updatedAt: string;
  errorMessage?: string;
  conflictReason?: PendingSaleConflictReason;
  syncOwner?: string;
  syncStartedAt?: number;
  syncLeaseUntil?: number;
  syncAttempts?: number;
  nextSyncAt?: number;
}

/** Runtime guard for data restored from Firestore after a crash or manual corruption. */
export function isValidPendingSaleDoc(value: unknown): value is PendingSaleDoc {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const doc = value as Partial<PendingSaleDoc>;
  const payload = doc.payload;
  if (typeof doc.id !== "string" || !doc.id || typeof doc.createdAt !== "string" || typeof doc.updatedAt !== "string") return false;
  if (!['pending', 'syncing', 'failed', 'conflict'].includes(String(doc.status))) return false;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
  const sale = payload as Partial<PendingSalePayload>;
  return sale.saleId === doc.id
    && typeof sale.clientId === "string" && sale.clientId.length > 0
    && Array.isArray(sale.products) && sale.products.length <= 100
    && sale.products.every((item) => item && typeof item.productId === "string" && item.productId.length > 0
      && typeof item.quantity === "number" && Number.isSafeInteger(item.quantity) && item.quantity > 0)
    && (sale.discountType === "percent" || sale.discountType === "fixed")
    && typeof sale.discountValue === "number" && Number.isFinite(sale.discountValue) && sale.discountValue >= 0
    && sale.paymentType === "avista"
    && (sale.paymentMethod === null || typeof sale.paymentMethod === "string");
}

const PENDING_SALES_COLLECTION = "pendingSales";
export const SYNC_LEASE_MS = 120_000;
export const MAX_SYNC_ATTEMPTS = 5;
export const SYNC_REQUEST_TIMEOUT_MS = 30_000;

/** Only an online Firestore transaction can claim a sale, across tabs/devices/restarts. */
export async function claimPendingSale(uid: string, saleId: string, owner: string, clock?: number): Promise<PendingSaleDoc | null> {
  const ref = doc(getFirestore(), "users", uid, PENDING_SALES_COLLECTION, saleId);
  return runTransaction(getFirestore(), async (tx) => {
    const snap = await tx.get(ref);
    const now = clock ?? Date.now();
    if (!snap.exists()) return null;
    const sale = snap.data() as PendingSaleDoc;
    const legacyExpiry = Date.parse(sale.updatedAt) + SYNC_LEASE_MS;
    const expiry = sale.syncLeaseUntil ?? (Number.isFinite(legacyExpiry) ? legacyExpiry : 0);
    if (sale.status !== "pending" && !(sale.status === "syncing" && expiry <= now)) return null;
    if ((sale.nextSyncAt ?? 0) > now) return null;
    const attempts = sale.syncAttempts ?? 0;
    if (attempts >= MAX_SYNC_ATTEMPTS) {
      tx.update(ref, { status: "failed", errorMessage: "Limite de tentativas atingido. Revise a venda antes de tentar novamente.", updatedAt: new Date(now).toISOString(), syncOwner: deleteField(), syncLeaseUntil: deleteField() });
      return null;
    }
    const lease = { status: "syncing" as const, syncOwner: owner, syncStartedAt: now, syncLeaseUntil: now + SYNC_LEASE_MS, syncAttempts: attempts + 1, updatedAt: new Date(now).toISOString() };
    tx.update(ref, lease);
    return { ...sale, ...lease };
  });
}

export async function renewPendingSaleLease(uid: string, saleId: string, owner: string, clock?: number): Promise<boolean> {
  const ref = doc(getFirestore(), "users", uid, PENDING_SALES_COLLECTION, saleId);
  return runTransaction(getFirestore(), async (tx) => {
    const snap = await tx.get(ref);
    const now = clock ?? Date.now();
    const sale = snap.data() as PendingSaleDoc | undefined;
    if (!sale || sale.status !== "syncing" || sale.syncOwner !== owner || (sale.syncLeaseUntil ?? 0) <= now) return false;
    tx.update(ref, { syncLeaseUntil: now + SYNC_LEASE_MS });
    return true;
  });
}

/** A late worker can never delete/requeue an item now owned by another worker. */
export async function settlePendingSale(
  uid: string, saleId: string, owner: string, result: SyncPendingSaleResult | { outcome: "retry" }, clock?: number,
): Promise<boolean> {
  const ref = doc(getFirestore(), "users", uid, PENDING_SALES_COLLECTION, saleId);
  return runTransaction(getFirestore(), async (tx) => {
    const snap = await tx.get(ref);
    const now = clock ?? Date.now();
    if (!snap.exists()) return false;
    const sale = snap.data() as PendingSaleDoc;
    if (sale.status !== "syncing" || sale.syncOwner !== owner) return false;
    if (result.outcome === "synced" || result.outcome === "already-exists") { tx.delete(ref); return true; }
    const exhausted = (sale.syncAttempts ?? 0) >= MAX_SYNC_ATTEMPTS;
    const status = result.outcome === "conflict" ? "conflict" : result.outcome === "retry" && !exhausted ? "pending" : "failed";
    tx.update(ref, {
      status, updatedAt: new Date(now).toISOString(), syncOwner: deleteField(), syncLeaseUntil: deleteField(),
      nextSyncAt: result.outcome === "retry" && !exhausted ? now + Math.min(15_000 * 2 ** ((sale.syncAttempts ?? 1) - 1), 300_000) : deleteField(),
      errorMessage: result.outcome === "retry" ? (exhausted ? "Limite de tentativas atingido." : deleteField()) : result.message,
      conflictReason: result.outcome === "conflict" ? result.reason : deleteField(),
    });
    return true;
  });
}

/**
 * A queda de conexão NO MEIO de uma tentativa de venda não chega sempre como `TypeError` (falha crua
 * de `fetch`) — o `getIdToken(true)` que roda antes do fetch já bate na rede do Firebase Auth, e quando
 * ela cai, o SDK lança um `FirebaseError` com `code: "auth/network-request-failed"`, não um `TypeError`.
 * Sem checar isso também, esse erro "cru" do Firebase escapava direto pra tela do vendedor.
 */
export function isNetworkFailure(err: unknown): boolean {
  if (err instanceof TypeError) return true;
  if (err && typeof err === "object" && "code" in err) {
    const code = (err as { code?: unknown }).code;
    return typeof code === "string" && (code.includes("network") || code === "unavailable");
  }
  return false;
}

export async function queuePendingSale(uid: string, payload: PendingSalePayload): Promise<void> {
  const now = new Date().toISOString();
  const record: PendingSaleDoc = {
    id: payload.saleId,
    payload,
    status: "pending",
    createdAt: now,
    updatedAt: now,
  };
  await setDoc(doc(getFirestore(), "users", uid, PENDING_SALES_COLLECTION, payload.saleId), record);
}

export async function markPendingSaleSyncing(uid: string, saleId: string): Promise<void> {
  await setDoc(
    doc(getFirestore(), "users", uid, PENDING_SALES_COLLECTION, saleId),
    { status: "syncing", updatedAt: new Date().toISOString() },
    { merge: true },
  );
}

/** Retry manual de uma recusa: limpa o conflito e reinicia o orçamento de tentativas.
 * Nunca rouba um lease ativo; recovery/retry automático usa claim/settle com owner. */
export async function markPendingSalePending(uid: string, saleId: string): Promise<void> {
  const ref = doc(getFirestore(), "users", uid, PENDING_SALES_COLLECTION, saleId);
  await runTransaction(getFirestore(), async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists() || snap.data().status === "syncing") return;
    tx.update(ref, { status: "pending", updatedAt: new Date().toISOString(), syncAttempts: 0, syncOwner: deleteField(), syncLeaseUntil: deleteField(), nextSyncAt: deleteField(), errorMessage: deleteField(), conflictReason: deleteField() });
  });
}

export async function markPendingSaleFailed(uid: string, saleId: string, errorMessage: string): Promise<void> {
  await setDoc(
    doc(getFirestore(), "users", uid, PENDING_SALES_COLLECTION, saleId),
    { status: "failed", errorMessage, updatedAt: new Date().toISOString(), conflictReason: deleteField() },
    { merge: true },
  );
}

/**
 * RELEASE-QUALITY-05 §7/§9: falha de NEGÓCIO específica (estoque mudou, produto sumiu/mudou de preço)
 * — nunca some a venda pendente, só muda o status para algo que a UI consegue explicar em vez de um
 * erro genérico. Nunca decrementa estoque: a rota do servidor já recusou a escrita inteira.
 */
export async function markPendingSaleConflict(
  uid: string,
  saleId: string,
  conflictReason: PendingSaleConflictReason,
  errorMessage: string,
): Promise<void> {
  await setDoc(
    doc(getFirestore(), "users", uid, PENDING_SALES_COLLECTION, saleId),
    { status: "conflict", conflictReason, errorMessage, updatedAt: new Date().toISOString() },
    { merge: true },
  );
}

export async function removePendingSale(uid: string, saleId: string): Promise<void> {
  const ref = doc(getFirestore(), "users", uid, PENDING_SALES_COLLECTION, saleId);
  await runTransaction(getFirestore(), async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists() && snap.data().status !== "syncing") tx.delete(ref);
  });
}

export type SyncPendingSaleResult = PendingSaleResponse;

/**
 * Reenvia o MESMO payload para a rota que já existe — nenhuma lógica de negócio nova. `SALE_ALREADY_EXISTS`
 * (a própria rota já lança isso num saleId repetido) conta como sucesso: prova de que a venda já foi
 * processada antes, então a fila local só precisa se limpar, nunca tentar de novo.
 */
export async function syncPendingSaleToServer(token: string, payload: PendingSalePayload, signal?: AbortSignal): Promise<SyncPendingSaleResult> {
  // Erro de rede aqui (ex.: caiu de novo no meio do sync) propaga pro chamador sem tratamento
  // especial — não é falha definitiva, ele decide colocar de volta em "pending" pra tentar de novo.
  const response = await fetch(getApiUrl("/api/sales/finalize"), {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      saleId: payload.saleId,
      clientId: payload.clientId,
      products: payload.products,
      discountType: payload.discountType,
      discountValue: payload.discountValue,
      paymentType: "avista",
      paymentMethod: payload.paymentMethod,
      downPayment: 0,
      downPaymentMethod: null,
      installments: 0,
    }),
  });
  return classifyPendingSaleResponse(response, payload.saleId);
}
