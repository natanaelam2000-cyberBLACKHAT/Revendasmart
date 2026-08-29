import assert from "node:assert/strict";
import express, { type Request, type Response, type NextFunction } from "express";
import { AddressInfo } from "node:net";
import { initializeFirebaseAdmin } from "../server/firebase-admin-init";
import {
  recordServicePaymentCommand,
  refundServicePaymentCommand,
  registerServicePaymentRoutes,
} from "../server/service-payment-commands";
import {
  assertValidServicePaymentRecord,
  assertValidServiceRefundRecord,
  assertValidServiceWork,
  calculateCommercialTotals,
  createZeroServiceWorkFinancialSummary,
  deriveServiceWorkFinancials,
  normalizeServiceWorkDocument,
  type CommercialItem,
  type ServicePaymentRecord,
  type ServiceRefundRecord,
  type ServiceWork,
} from "../shared/services";

process.env.FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || "demo-revendasmart";
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || "127.0.0.1:9099";

function requireEmulatorEnv() {
  assert.equal(process.env.FIREBASE_PROJECT_ID, "demo-revendasmart");
  assert.equal(process.env.FIRESTORE_EMULATOR_HOST, "127.0.0.1:8080");
  assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, "127.0.0.1:9099");
}

function tenantUid(prefix = "services-pay"): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function omitUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, fieldValue]) => typeof fieldValue !== "undefined")) as T;
}

const defaultItems: readonly CommercialItem[] = [
  {
    kind: "additional",
    id: "line-base",
    label: "Serviço base",
    quantity: 1,
    unitPriceCents: 10000,
    lineTotalCents: 10000,
  },
];

function buildWork(uid: string, workId: string, overrides: Partial<ServiceWork> = {}): ServiceWork {
  const now = "2026-08-29T00:00:00.000Z";
  const items = overrides.items ?? defaultItems;
  return assertValidServiceWork({
    id: workId,
    tenantUid: uid,
    status: "planned",
    origin: "manual",
    items,
    totals: overrides.totals ?? calculateCommercialTotals(items),
    financialSummary: createZeroServiceWorkFinancialSummary(),
    cost: { kind: "unknown" },
    createdAt: now,
    updatedAt: now,
    ...overrides,
  });
}

async function seedWork(uid: string, workId: string, overrides: Partial<ServiceWork> = {}) {
  const db = initializeFirebaseAdmin().firestore();
  const work = buildWork(uid, workId, overrides);
  await db.doc(`users/${uid}/serviceWorks/${workId}`).set(omitUndefined(work as unknown as Record<string, unknown>));
  return work;
}

async function getWork(uid: string, workId: string): Promise<ServiceWork> {
  const db = initializeFirebaseAdmin().firestore();
  const snapshot = await db.doc(`users/${uid}/serviceWorks/${workId}`).get();
  assert.equal(snapshot.exists, true, `Work ${workId} deve existir`);
  return normalizeServiceWorkDocument(snapshot.data() as ServiceWork);
}

async function getPayment(uid: string, workId: string, paymentId: string): Promise<ServicePaymentRecord> {
  const db = initializeFirebaseAdmin().firestore();
  const snapshot = await db.doc(`users/${uid}/serviceWorks/${workId}/payments/${paymentId}`).get();
  assert.equal(snapshot.exists, true, `Payment ${paymentId} deve existir`);
  return assertValidServicePaymentRecord(snapshot.data() as ServicePaymentRecord);
}

async function listPayments(uid: string, workId: string): Promise<ServicePaymentRecord[]> {
  const db = initializeFirebaseAdmin().firestore();
  const snapshot = await db.collection(`users/${uid}/serviceWorks/${workId}/payments`).orderBy("recordedAt", "desc").get();
  return snapshot.docs.map((item) => assertValidServicePaymentRecord(item.data() as ServicePaymentRecord));
}

async function getRefund(uid: string, workId: string, paymentId: string, refundId: string): Promise<ServiceRefundRecord> {
  const db = initializeFirebaseAdmin().firestore();
  const snapshot = await db.doc(`users/${uid}/serviceWorks/${workId}/payments/${paymentId}/refunds/${refundId}`).get();
  assert.equal(snapshot.exists, true, `Refund ${refundId} deve existir`);
  return assertValidServiceRefundRecord(snapshot.data() as ServiceRefundRecord);
}

async function listRefunds(uid: string, workId: string, paymentId: string): Promise<ServiceRefundRecord[]> {
  const db = initializeFirebaseAdmin().firestore();
  const snapshot = await db.collection(`users/${uid}/serviceWorks/${workId}/payments/${paymentId}/refunds`).orderBy("refundedAt", "desc").get();
  return snapshot.docs.map((item) => assertValidServiceRefundRecord(item.data() as ServiceRefundRecord));
}

async function getIdempotencyDocs(uid: string) {
  const db = initializeFirebaseAdmin().firestore();
  return await db.collection(`users/${uid}/servicePaymentCommandIdempotency`).get();
}

async function createServer() {
  const app = express();
  app.use(express.json());
  app.use((req: Request & { requestId?: string }, _res: Response, next: NextFunction) => {
    req.requestId = `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    next();
  });
  const requireAuth = (req: Request & { firebaseUid?: string }, _res: Response, next: NextFunction) => {
    const uid = req.header("x-test-uid");
    if (uid) req.firebaseUid = uid;
    next();
  };
  registerServicePaymentRoutes(app, requireAuth);
  const server = await new Promise<import("node:http").Server>((resolve) => {
    const created = app.listen(0, () => resolve(created));
  });
  const { port } = server.address() as AddressInfo;
  return {
    server,
    baseUrl: `http://127.0.0.1:${port}`,
    async close() {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    },
  };
}

async function postJson(baseUrl: string, path: string, body: unknown, uid?: string) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(uid ? { "x-test-uid": uid } : {}),
    },
    body: JSON.stringify(body),
  });
  return {
    status: response.status,
    body: response.headers.get("content-type")?.includes("application/json") ? await response.json() : null,
  };
}

async function run() {
  requireEmulatorEnv();
  initializeFirebaseAdmin();
  const db = initializeFirebaseAdmin().firestore();
  const harness = await createServer();

  try {
    {
      const uid = tenantUid();
      await seedWork(uid, "work-http");
      const first = await postJson(harness.baseUrl, "/api/services/works/work-http/payments", {
        amountCents: 4000,
        method: "pix",
        idempotencyKey: "pay-http-1",
      }, uid);
      assert.equal(first.status, 200);
      assert.equal(first.body?.amountCents, 4000);

      const payment = await getPayment(uid, "work-http", first.body.paymentId);
      assert.equal(payment.refundedTotalCents, 0);
      const listed = await listPayments(uid, "work-http");
      assert.equal(listed.length, 1);

      const work = await getWork(uid, "work-http");
      assert.deepEqual(work.financialSummary, {
        grossReceivedCents: 4000,
        refundedTotalCents: 0,
        netReceivedCents: 4000,
      });
      assert.equal(deriveServiceWorkFinancials(work).balanceCents, 6000);

      const second = await postJson(harness.baseUrl, "/api/services/works/work-http/payments", {
        amountCents: 6000,
        method: "manual",
        idempotencyKey: "pay-http-2",
      }, uid);
      assert.equal(second.status, 200);
      const paidWork = await getWork(uid, "work-http");
      assert.equal(deriveServiceWorkFinancials(paidWork).financialStatus, "paid");
    }

    {
      const uid = tenantUid();
      await seedWork(uid, "work-overpay");
      const denied = await postJson(harness.baseUrl, "/api/services/works/work-overpay/payments", {
        amountCents: 10001,
        method: "pix",
        idempotencyKey: "pay-over-1",
      }, uid);
      assert.equal(denied.status, 400);
      assert.equal(denied.body?.code, "OVERPAYMENT_NOT_SUPPORTED");
    }

    {
      const uid = tenantUid();
      await seedWork(uid, "work-zero");
      const denied = await postJson(harness.baseUrl, "/api/services/works/work-zero/payments", {
        amountCents: 0,
        method: "pix",
        idempotencyKey: "pay-zero-1",
      }, uid);
      assert.equal(denied.status, 400);
      assert.equal(denied.body?.code, "INVALID_PAYMENT_AMOUNT");
      const idemDocs = await getIdempotencyDocs(uid);
      assert.equal(idemDocs.size, 0);
    }

    {
      const uid = tenantUid();
      await seedWork(uid, "work-planned", { status: "planned" });
      await seedWork(uid, "work-in-progress", { status: "in_progress", startedAt: "2026-08-29T00:01:00.000Z", updatedAt: "2026-08-29T00:01:00.000Z" });
      await seedWork(uid, "work-completed", { status: "completed", startedAt: "2026-08-29T00:01:00.000Z", completedAt: "2026-08-29T00:02:00.000Z", updatedAt: "2026-08-29T00:02:00.000Z" });
      await seedWork(uid, "work-cancelled", { status: "cancelled", cancelledAt: "2026-08-29T00:03:00.000Z", updatedAt: "2026-08-29T00:03:00.000Z" });

      for (const workId of ["work-planned", "work-in-progress", "work-completed", "work-cancelled"]) {
        const response = await postJson(harness.baseUrl, `/api/services/works/${workId}/payments`, {
          amountCents: 1000,
          method: "card",
          idempotencyKey: `idem-${workId}`,
        }, uid);
        assert.equal(response.status, 200, `${workId} deve aceitar payment`);
      }
    }

    {
      const uidA = tenantUid("uid-a");
      const uidB = tenantUid("uid-b");
      await seedWork(uidA, "work-tenant-a");
      const missingForOtherTenant = await postJson(harness.baseUrl, "/api/services/works/work-tenant-a/payments", {
        amountCents: 1000,
        method: "pix",
        idempotencyKey: "tenant-b",
      }, uidB);
      assert.equal(missingForOtherTenant.status, 404);

      const unauthenticated = await postJson(harness.baseUrl, "/api/services/works/work-tenant-a/payments", {
        amountCents: 1000,
        method: "pix",
        idempotencyKey: "no-auth",
      });
      assert.equal(unauthenticated.status, 401);
    }

    {
      const uid = tenantUid();
      await seedWork(uid, "work-idem");
      const first = await postJson(harness.baseUrl, "/api/services/works/work-idem/payments", {
        amountCents: 3000,
        method: "pix",
        idempotencyKey: "same-key",
      }, uid);
      const replay = await postJson(harness.baseUrl, "/api/services/works/work-idem/payments", {
        amountCents: 3000,
        method: "pix",
        idempotencyKey: "same-key",
      }, uid);
      assert.equal(replay.status, 200);
      assert.equal(replay.body?.paymentId, first.body?.paymentId);
      assert.equal(replay.body?.idempotentReplay, true);
      assert.equal((await listPayments(uid, "work-idem")).length, 1);

      const conflictAmount = await postJson(harness.baseUrl, "/api/services/works/work-idem/payments", {
        amountCents: 2000,
        method: "pix",
        idempotencyKey: "same-key",
      }, uid);
      assert.equal(conflictAmount.status, 409);

      const conflictMethod = await postJson(harness.baseUrl, "/api/services/works/work-idem/payments", {
        amountCents: 3000,
        method: "card",
        idempotencyKey: "same-key",
      }, uid);
      assert.equal(conflictMethod.status, 409);

      await seedWork(uid, "work-idem-other");
      const conflictWork = await postJson(harness.baseUrl, "/api/services/works/work-idem-other/payments", {
        amountCents: 3000,
        method: "pix",
        idempotencyKey: "same-key",
      }, uid);
      assert.equal(conflictWork.status, 409);
    }

    {
      const uid = tenantUid();
      await seedWork(uid, "work-refund");
      const paymentResult = await postJson(harness.baseUrl, "/api/services/works/work-refund/payments", {
        amountCents: 10000,
        method: "pix",
        idempotencyKey: "payment-r1",
      }, uid);
      assert.equal(paymentResult.status, 200);
      const paymentId = paymentResult.body.paymentId as string;

      const refundA = await postJson(harness.baseUrl, `/api/services/works/work-refund/payments/${paymentId}/refunds`, {
        amountCents: 2000,
        reason: "Ajuste 1",
        idempotencyKey: "refund-a",
      }, uid);
      assert.equal(refundA.status, 200);
      const refundB = await postJson(harness.baseUrl, `/api/services/works/work-refund/payments/${paymentId}/refunds`, {
        amountCents: 1000,
        reason: "Ajuste 2",
        idempotencyKey: "refund-b",
      }, uid);
      assert.equal(refundB.status, 200);

      const updatedPayment = await getPayment(uid, "work-refund", paymentId);
      assert.equal(updatedPayment.refundedTotalCents, 3000);
      const refunds = await listRefunds(uid, "work-refund", paymentId);
      assert.equal(refunds.length, 2);
      await getRefund(uid, "work-refund", paymentId, refundA.body.refundId);
      await getRefund(uid, "work-refund", paymentId, refundB.body.refundId);

      const work = await getWork(uid, "work-refund");
      assert.deepEqual(work.financialSummary, {
        grossReceivedCents: 10000,
        refundedTotalCents: 3000,
        netReceivedCents: 7000,
      });
    }

    {
      const uid = tenantUid();
      await seedWork(uid, "work-full-refund");
      const paymentResult = await postJson(harness.baseUrl, "/api/services/works/work-full-refund/payments", {
        amountCents: 10000,
        method: "pix",
        idempotencyKey: "payment-full",
      }, uid);
      const paymentId = paymentResult.body.paymentId as string;
      for (const [index, amount] of [2000, 3000, 5000].entries()) {
        const response = await postJson(harness.baseUrl, `/api/services/works/work-full-refund/payments/${paymentId}/refunds`, {
          amountCents: amount,
          idempotencyKey: `refund-full-${index}`,
        }, uid);
        assert.equal(response.status, 200);
      }
      const denied = await postJson(harness.baseUrl, `/api/services/works/work-full-refund/payments/${paymentId}/refunds`, {
        amountCents: 1,
        idempotencyKey: "refund-over",
      }, uid);
      assert.equal(denied.status, 400);
      assert.equal(denied.body?.code, "REFUND_EXCEEDS_PAYMENT");
    }

    {
      const uid = tenantUid();
      await seedWork(uid, "work-refund-zero");
      const paymentResult = await postJson(harness.baseUrl, "/api/services/works/work-refund-zero/payments", {
        amountCents: 1000,
        method: "pix",
        idempotencyKey: "payment-base",
      }, uid);
      const paymentId = paymentResult.body.paymentId as string;
      const denied = await postJson(harness.baseUrl, `/api/services/works/work-refund-zero/payments/${paymentId}/refunds`, {
        amountCents: 0,
        idempotencyKey: "refund-zero",
      }, uid);
      assert.equal(denied.status, 400);
      assert.equal(denied.body?.code, "INVALID_REFUND_AMOUNT");
    }

    {
      const uid = tenantUid();
      await seedWork(uid, "work-refund-idem");
      const paymentResult = await postJson(harness.baseUrl, "/api/services/works/work-refund-idem/payments", {
        amountCents: 1000,
        method: "pix",
        idempotencyKey: "payment-idem",
      }, uid);
      const paymentId = paymentResult.body.paymentId as string;
      const first = await postJson(harness.baseUrl, `/api/services/works/work-refund-idem/payments/${paymentId}/refunds`, {
        amountCents: 400,
        reason: "ajuste",
        idempotencyKey: "refund-same",
      }, uid);
      const replay = await postJson(harness.baseUrl, `/api/services/works/work-refund-idem/payments/${paymentId}/refunds`, {
        amountCents: 400,
        reason: "ajuste",
        idempotencyKey: "refund-same",
      }, uid);
      assert.equal(replay.status, 200);
      assert.equal(replay.body?.refundId, first.body?.refundId);
      assert.equal(replay.body?.idempotentReplay, true);
      assert.equal((await listRefunds(uid, "work-refund-idem", paymentId)).length, 1);

      const conflictAmount = await postJson(harness.baseUrl, `/api/services/works/work-refund-idem/payments/${paymentId}/refunds`, {
        amountCents: 300,
        reason: "ajuste",
        idempotencyKey: "refund-same",
      }, uid);
      assert.equal(conflictAmount.status, 409);

      const paymentResult2 = await postJson(harness.baseUrl, "/api/services/works/work-refund-idem/payments", {
        amountCents: 1000,
        method: "pix",
        idempotencyKey: "payment-idem-2",
      }, uid);
      const conflictPayment = await postJson(harness.baseUrl, `/api/services/works/work-refund-idem/payments/${paymentResult2.body.paymentId}/refunds`, {
        amountCents: 400,
        reason: "ajuste",
        idempotencyKey: "refund-same",
      }, uid);
      assert.equal(conflictPayment.status, 409);
    }

    {
      const uid = tenantUid();
      await seedWork(uid, "work-repay");
      const payment1 = await recordServicePaymentCommand(db, uid, "work-repay", 10000, "pix", "repay-p1");
      await refundServicePaymentCommand(db, uid, "work-repay", payment1.paymentId, 2000, undefined, "repay-r1");
      await recordServicePaymentCommand(db, uid, "work-repay", 2000, "cash", "repay-p2");
      const work = await getWork(uid, "work-repay");
      assert.deepEqual(work.financialSummary, {
        grossReceivedCents: 12000,
        refundedTotalCents: 2000,
        netReceivedCents: 10000,
      });
      const financials = deriveServiceWorkFinancials(work);
      assert.equal(financials.balanceCents, 0);
      assert.equal(financials.financialStatus, "paid");
    }

    {
      const uid = tenantUid();
      await seedWork(uid, "work-concurrency");
      const [a, b] = await Promise.allSettled([
        recordServicePaymentCommand(db, uid, "work-concurrency", 7000, "pix", "cc-a"),
        recordServicePaymentCommand(db, uid, "work-concurrency", 7000, "pix", "cc-b"),
      ]);
      const fulfilled = [a, b].filter((item): item is PromiseFulfilledResult<any> => item.status === "fulfilled");
      assert.notEqual(fulfilled.length, 2);
      const payments = await listPayments(uid, "work-concurrency");
      const work = await getWork(uid, "work-concurrency");
      assert.ok(payments.length <= 1);
      assert.ok(work.financialSummary.netReceivedCents === 0 || work.financialSummary.netReceivedCents === 7000);
    }

    {
      const uid = tenantUid();
      await seedWork(uid, "work-concurrency-refund");
      const payment = await recordServicePaymentCommand(db, uid, "work-concurrency-refund", 10000, "pix", "cr-payment");
      const [a, b] = await Promise.allSettled([
        refundServicePaymentCommand(db, uid, "work-concurrency-refund", payment.paymentId, 7000, undefined, "cr-a"),
        refundServicePaymentCommand(db, uid, "work-concurrency-refund", payment.paymentId, 7000, undefined, "cr-b"),
      ]);
      const fulfilled = [a, b].filter((item): item is PromiseFulfilledResult<any> => item.status === "fulfilled");
      assert.notEqual(fulfilled.length, 2);
      const refunds = await listRefunds(uid, "work-concurrency-refund", payment.paymentId);
      const updatedPayment = await getPayment(uid, "work-concurrency-refund", payment.paymentId);
      assert.ok(refunds.length <= 1);
      assert.ok(updatedPayment.refundedTotalCents === 0 || updatedPayment.refundedTotalCents === 7000);
    }

    console.log("Services pay tests passed.");
  } finally {
    await harness.close();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
