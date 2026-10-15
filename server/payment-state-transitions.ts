import type { Firestore } from "firebase-admin/firestore";
import type { Order } from "../client/src/lib/orders";
import type { Charge } from "../shared/charges";

export class PaymentTransitionError extends Error {
  constructor(public readonly code: string, public readonly statusCode: number) { super(code); }
}

// Manual: awaiting -> reported -> paid (confirmation may skip reported).
// Provider: unpaid states -> paid; paid -> refunded only with explicit refund evidence.
// Refunded is terminal: a delayed success must not erase the refund/chargeback audit state.
export async function transitionOrderPayment(
  db: Firestore, uid: string, orderId: string, action: "report" | "confirm", clientOrderId?: string,
  hooks: { afterRead?: (attempt: number) => Promise<void> } = {},
): Promise<{ order: Order; alreadyApplied: boolean }> {
  const ref = db.collection("users").doc(uid).collection("orders").doc(orderId);
  let attempt = 0;
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    await hooks.afterRead?.(++attempt);
    if (!snap.exists) throw new PaymentTransitionError("ORDER_NOT_FOUND", 404);
    const order = snap.data() as Order;
    if (action === "report" && order.clientOrderId !== clientOrderId) throw new PaymentTransitionError("ORDER_TOKEN_MISMATCH", 403);
    if (order.paymentStatus === "paid" || (action === "report" && order.paymentStatus === "customer_reported_paid")) {
      return { order, alreadyApplied: true };
    }
    if (order.paymentStatus !== "awaiting_customer_payment" && !(action === "confirm" && order.paymentStatus === "customer_reported_paid")) {
      throw new PaymentTransitionError("INVALID_PAYMENT_TRANSITION", 409);
    }
    const paymentStatus = action === "report" ? "customer_reported_paid" : "paid";
    const updatedAt = new Date().toISOString();
    tx.update(ref, { paymentStatus, updatedAt });
    return { order: { ...order, paymentStatus, updatedAt }, alreadyApplied: false };
  });
}

export async function applyChargePaymentUpdate(db: Firestore, uid: string, chargeId: string, updates: Partial<Charge>, hooks: { afterRead?: (attempt: number) => Promise<void> } = {}): Promise<Charge> {
  const ref = db.collection("users").doc(uid).collection("charges").doc(chargeId);
  let attempt = 0;
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    await hooks.afterRead?.(++attempt);
    if (!snap.exists) throw new PaymentTransitionError("CHARGE_NOT_FOUND", 404);
    const charge = { ...snap.data(), id: snap.id } as Charge;
    if (charge.uid !== uid) throw new PaymentTransitionError("CHARGE_OWNER_MISMATCH", 403);
    const explicitRefund = updates.status === "refunded" && !!updates.refundedAt &&
      (updates.providerRawStatus === "refunded" || updates.providerRawStatus === "charged_back");
    const protectedState = charge.status === "refunded" ||
      (charge.status === "paid" && updates.status !== "paid" && !explicitRefund);
    const duplicate = !!updates.webhookLastEventId && updates.webhookLastEventId === charge.webhookLastEventId;
    const next = protectedState || duplicate ? charge : { ...charge, ...updates };
    const orderRef = next.status === "paid" && charge.orderId
      ? db.collection("users").doc(uid).collection("orders").doc(charge.orderId) : null;
    const orderSnap = orderRef ? await tx.get(orderRef) : null;
    if (!protectedState && !duplicate) {
      const clean = Object.fromEntries(Object.entries(updates).filter(([, value]) => value !== undefined));
      // Preserve the original confirmation timestamp across duplicate/stale success callbacks.
      if (charge.paidAt) clean.paidAt = charge.paidAt;
      tx.update(ref, clean);
      Object.assign(next, clean);
    }
    if (orderRef && orderSnap?.exists && orderSnap.data()?.paymentStatus !== "paid") {
      tx.update(orderRef, { paymentStatus: "paid", updatedAt: new Date().toISOString() });
    }
    return next;
  });
}
