import assert from "node:assert/strict";
import { initializeFirebaseAdmin, getFirebaseAdmin } from "../server/firebase-admin-init";
import { applyChargePaymentUpdate, transitionOrderPayment } from "../server/payment-state-transitions";
import type { Charge } from "../shared/charges";

assert.equal(process.env.FIRESTORE_EMULATOR_HOST, "127.0.0.1:8080");
assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, "127.0.0.1:9099");
process.env.FIREBASE_PROJECT_ID = "demo-revendasmart";
initializeFirebaseAdmin();
const db = getFirebaseAdmin().firestore();
const uid = `hardening-payment-${Date.now()}`;
const orderRef = db.doc(`users/${uid}/orders/order`);
const chargeRef = db.doc(`users/${uid}/charges/charge`);
const success: Partial<Charge> = { status: "paid", providerRawStatus: "approved", paidAt: "2026-10-08T00:00:00Z", webhookLastEventId: "success" };
const failure: Partial<Charge> = { status: "failed", providerRawStatus: "rejected", webhookLastEventId: "failure" };
function barrier() {
  let release!: () => void; let signal!: () => void;
  const paused = new Promise<void>((resolve) => { signal = resolve; });
  const resume = new Promise<void>((resolve) => { release = resolve; });
  return { paused, release: () => release(), afterRead: async (attempt: number) => { if (attempt === 1) { signal(); await resume; } } };
}
async function seed() {
  await orderRef.set({ id: "order", clientOrderId: "buyer-token", paymentStatus: "awaiting_customer_payment", total: 10 });
  await chargeRef.set({ id: "charge", uid, orderId: "order", status: "pending", amount: 10 });
}
async function paid() {
  assert.equal((await chargeRef.get()).data()?.status, "paid");
  assert.equal((await orderRef.get()).data()?.paymentStatus, "paid");
}
try {
  await seed();
  // The customer transaction reads first; owner confirmation contends on the same real document.
  const gate = barrier();
  const report = transitionOrderPayment(db, uid, "order", "report", "buyer-token", gate);
  await gate.paused;
  const confirm = transitionOrderPayment(db, uid, "order", "confirm");
  gate.release();
  await Promise.all([report, confirm]);
  await transitionOrderPayment(db, uid, "order", "report", "buyer-token");
  assert.equal((await orderRef.get()).data()?.paymentStatus, "paid");
  console.log("PASS PAYMENT_CONFIRMED_CANNOT_DOWNGRADE");
  await assert.rejects(transitionOrderPayment(db, uid, "order", "report", "spoofed"), /ORDER_TOKEN_MISMATCH/);
  await assert.rejects(transitionOrderPayment(db, `${uid}-other`, "order", "confirm"), /ORDER_NOT_FOUND/);

  await seed();
  await applyChargePaymentUpdate(db, uid, "charge", success);
  await applyChargePaymentUpdate(db, uid, "charge", failure);
  await paid();
  console.log("PASS PAYMENT_STALE_FAILED_RESULT_CANNOT_OVERRIDE_SUCCESS");
  const before = (await chargeRef.get()).data();
  await applyChargePaymentUpdate(db, uid, "charge", success);
  assert.deepEqual((await chargeRef.get()).data(), before);
  await paid();
  console.log("PASS PAYMENT_DUPLICATE_FINALIZE_IDEMPOTENT");
  for (const status of ["pending", "in_process", "failed", "cancelled", "expired"] as const) {
    await applyChargePaymentUpdate(db, uid, "charge", { status, providerRawStatus: status });
  }
  await paid();
  console.log("PASS PAYMENT_RETRY_AFTER_SUCCESS_IDEMPOTENT");

  for (const first of [success, failure]) {
    await seed();
    const race = barrier();
    const a = applyChargePaymentUpdate(db, uid, "charge", first, race);
    await race.paused;
    const b = applyChargePaymentUpdate(db, uid, "charge", first === success ? failure : success);
    race.release();
    await Promise.all([a, b]);
    await paid();
  }
  console.log("PASS PAYMENT_CONCURRENT_SUCCESS_FAILURE_SUCCESS_WINS");
  await applyChargePaymentUpdate(db, uid, "charge", { status: "refunded", providerRawStatus: "charged_back", refundedAt: "2026-10-09T00:00:00Z" });
  await applyChargePaymentUpdate(db, uid, "charge", success);
  assert.equal((await chargeRef.get()).data()?.status, "refunded");
  console.log("PASS PAYMENT_REFUND_AUDIT_STATE_PRESERVED");
} finally { await db.recursiveDelete(db.doc(`users/${uid}`)); }
