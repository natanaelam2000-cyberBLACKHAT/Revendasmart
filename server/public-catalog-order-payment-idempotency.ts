/**
 * RELEASE-CHECKOUT-03 §11-F — reserva atômica de UMA cobrança Mercado Pago por pedido, mesmo padrão
 * de `public-catalog-order-idempotency.ts` (Firestore transaction: só uma requisição concorrente
 * consegue reservar). Chave é o `orderId` (não o clientOrderId) — o pedido já existe e é único; o que
 * precisa de proteção agora é "nunca duas cobranças para o mesmo pedido".
 */
import type { Firestore } from "firebase-admin/firestore";

export interface OrderChargeReservation {
  alreadyExisted: boolean;
  status: "pending" | "ready";
  chargeId: string;
}

export async function reserveOrderCharge(db: Firestore, uid: string, orderId: string): Promise<OrderChargeReservation> {
  const idempotencyRef = db.collection("users").doc(uid).collection("orderChargeIdempotency").doc(orderId);
  const chargeRef = db.collection("users").doc(uid).collection("charges").doc();
  const nowIso = new Date().toISOString();

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(idempotencyRef);
    if (snap.exists) {
      const data = snap.data() as { status: "pending" | "ready"; chargeId: string };
      return { alreadyExisted: true, status: data.status, chargeId: data.chargeId };
    }
    tx.create(idempotencyRef, { status: "pending", chargeId: chargeRef.id, createdAt: nowIso });
    return { alreadyExisted: false, status: "pending", chargeId: chargeRef.id };
  });
}

export async function releaseOrderChargeReservation(db: Firestore, uid: string, orderId: string): Promise<void> {
  await db.collection("users").doc(uid).collection("orderChargeIdempotency").doc(orderId).delete().catch(() => {});
}

export async function finalizeOrderChargeReservation(db: Firestore, uid: string, orderId: string, chargeId: string): Promise<void> {
  await db.collection("users").doc(uid).collection("orderChargeIdempotency").doc(orderId)
    .set({ status: "ready", chargeId, updatedAt: new Date().toISOString() }, { merge: true });
}
