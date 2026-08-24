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
import { doc, setDoc, deleteDoc, deleteField, getFirestore } from "firebase/firestore";
import { getApiUrl } from "./api-config";

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
}

const PENDING_SALES_COLLECTION = "pendingSales";

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

/** Reverte uma tentativa interrompida por erro de rede de volta para "pending" — nunca fica presa em
 * "syncing" para sempre, e a próxima transição para online tenta de novo. Também é o que "Tentar
 * novamente" chama a partir de um estado "conflict" (§10) — limpa o motivo antigo, já que uma nova
 * tentativa pode ter um resultado diferente (ex.: o vendedor já repôs o estoque). */
export async function markPendingSalePending(uid: string, saleId: string): Promise<void> {
  await setDoc(
    doc(getFirestore(), "users", uid, PENDING_SALES_COLLECTION, saleId),
    { status: "pending", updatedAt: new Date().toISOString(), errorMessage: deleteField(), conflictReason: deleteField() },
    { merge: true },
  );
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
  await deleteDoc(doc(getFirestore(), "users", uid, PENDING_SALES_COLLECTION, saleId));
}

export type SyncPendingSaleResult =
  | { outcome: "synced" }
  | { outcome: "already-exists" }
  | { outcome: "conflict"; reason: PendingSaleConflictReason; message: string }
  | { outcome: "failed"; message: string };

// RELEASE-QUALITY-05 §9: mapeia os códigos que `/api/sales/finalize` já distingue (server/routes.ts)
// para um motivo de conflito — nunca um estado novo que o servidor não sabe justificar.
function resolveConflictReason(code: string): PendingSaleConflictReason | null {
  if (code === "INSUFFICIENT_STOCK") return "INSUFFICIENT_STOCK";
  if (code === "PRODUCT_NOT_FOUND") return "PRODUCT_NOT_FOUND";
  // Preço inválido normalmente significa que o produto mudou (promoção/desconto removido, preço
  // zerado etc.) entre a venda ser feita offline e a sincronização — mesma família de "o catálogo
  // mudou debaixo da venda pendente", só que via preço em vez de estoque.
  if (code === "INVALID_PRODUCT_PRICE") return "PRODUCT_CHANGED";
  return null;
}

/**
 * Reenvia o MESMO payload para a rota que já existe — nenhuma lógica de negócio nova. `SALE_ALREADY_EXISTS`
 * (a própria rota já lança isso num saleId repetido) conta como sucesso: prova de que a venda já foi
 * processada antes, então a fila local só precisa se limpar, nunca tentar de novo.
 */
export async function syncPendingSaleToServer(token: string, payload: PendingSalePayload): Promise<SyncPendingSaleResult> {
  // Erro de rede aqui (ex.: caiu de novo no meio do sync) propaga pro chamador sem tratamento
  // especial — não é falha definitiva, ele decide colocar de volta em "pending" pra tentar de novo.
  const response = await fetch(getApiUrl("/api/sales/finalize"), {
    method: "POST",
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
  if (response.ok) return { outcome: "synced" };
  const result = await response.json().catch(() => ({}) as Record<string, unknown>);
  const code = typeof result.code === "string" ? result.code : "";
  if (code === "SALE_ALREADY_EXISTS") return { outcome: "already-exists" };
  const message = typeof result.message === "string" ? result.message : (typeof result.error === "string" ? result.error : `HTTP ${response.status}`);
  const conflictReason = resolveConflictReason(code);
  if (conflictReason) return { outcome: "conflict", reason: conflictReason, message };
  return { outcome: "failed", message };
}
