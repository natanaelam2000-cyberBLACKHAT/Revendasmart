/**
 * RELEASE-CHECKOUT-02 §1 — reserva atômica de criação de pedido do catálogo público.
 *
 * Extraído da rota (`server/routes.ts`) para ser testável de forma isolada contra o emulador do
 * Firestore, sem precisar subir o Express inteiro — mesma motivação da extração de `admin-auth.ts`.
 *
 * Garantia: `db.runTransaction` só permite UM commit vencedor quando duas chamadas concorrentes leem
 * "documento não existe" e tentam `tx.create()` no mesmo caminho — a segunda falha na fase de commit
 * (optimistic concurrency control do Firestore) e o SDK a repete automaticamente, momento em que ela
 * enxerga o documento já criado pela vencedora e devolve `alreadyExisted: true`. Isso elimina a janela
 * de corrida do padrão anterior (query → write), onde duas leituras concorrentes podiam ambas ver
 * "vazio" antes de qualquer escrita acontecer.
 */
import type { Firestore } from "firebase-admin/firestore";

export interface OrderReservationPending {
  alreadyExisted: boolean;
  status: "pending" | "ready";
  orderId: string;
}

/**
 * `clientOrderId` precisa já estar validado pelo chamador (charset seguro para ID de documento) —
 * esta função não sanitiza, só reserva.
 */
export async function reserveOrderCreation(
  db: Firestore,
  uid: string,
  clientOrderId: string,
): Promise<OrderReservationPending> {
  const idempotencyRef = db.collection("users").doc(uid).collection("orderIdempotency").doc(clientOrderId);
  const orderRef = db.collection("users").doc(uid).collection("orders").doc();
  const nowIso = new Date().toISOString();

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(idempotencyRef);
    if (snap.exists) {
      const data = snap.data() as { status: "pending" | "ready"; orderId: string };
      return { alreadyExisted: true, status: data.status, orderId: data.orderId };
    }
    tx.create(idempotencyRef, { status: "pending", orderId: orderRef.id, createdAt: nowIso });
    return { alreadyExisted: false, status: "pending", orderId: orderRef.id };
  });
}

export async function releaseOrderReservation(db: Firestore, uid: string, clientOrderId: string): Promise<void> {
  await db.collection("users").doc(uid).collection("orderIdempotency").doc(clientOrderId).delete().catch(() => {});
}

export async function finalizeOrderReservation(db: Firestore, uid: string, clientOrderId: string, orderId: string): Promise<void> {
  await db.collection("users").doc(uid).collection("orderIdempotency").doc(clientOrderId)
    .set({ status: "ready", orderId, updatedAt: new Date().toISOString() }, { merge: true });
}
