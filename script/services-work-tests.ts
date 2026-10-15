import assert from "node:assert/strict";
import { initializeFirebaseAdmin } from "../server/firebase-admin-init";
import {
  cancelServiceWorkCommand,
  completeServiceWorkCommand,
  startServiceWorkCommand,
  type ServiceWorkCommandResult,
} from "../server/service-work-commands";
import {
  assertValidServiceWork,
  createZeroServiceWorkFinancialSummary,
  normalizeServiceWorkDocument,
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

function tenantUid(): string {
  return `services-work-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function validPlannedWork(uid: string, workId: string): ServiceWork {
  const now = "2026-08-28T00:00:00.000Z";
  return assertValidServiceWork({
    id: workId,
    tenantUid: uid,
    status: "planned",
    origin: "manual",
    items: [],
    totals: {
      serviceRevenueCents: 0,
      productRevenueCents: 0,
      additionalRevenueCents: 0,
      discountTotalCents: 0,
      contractedTotalCents: 0,
    },
    financialSummary: createZeroServiceWorkFinancialSummary(),
    cost: { kind: "unknown" },
    createdAt: now,
    updatedAt: now,
  });
}

async function seedWork(uid: string, workId: string) {
  const db = initializeFirebaseAdmin().firestore();
  const work = validPlannedWork(uid, workId);
  await db.doc(`users/${uid}/serviceWorks/${workId}`).set(work);
  return db;
}

async function getWork(uid: string, workId: string): Promise<ServiceWork> {
  const db = initializeFirebaseAdmin().firestore();
  const snapshot = await db.doc(`users/${uid}/serviceWorks/${workId}`).get();
  assert.equal(snapshot.exists, true, `ServiceWork ${workId} deve existir`);
  return normalizeServiceWorkDocument(snapshot.data() as ServiceWork);
}

async function getIdempotencyDocs(uid: string) {
  const db = initializeFirebaseAdmin().firestore();
  return await db.collection(`users/${uid}/serviceCommandIdempotency`).get();
}

function isIdempotencyConflict(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && (error as { code?: unknown }).code === "IDEMPOTENCY_CONFLICT";
}

function assertSameLogicalResult(
  actual: ServiceWorkCommandResult,
  expected: ServiceWorkCommandResult,
  replayExpected: boolean,
) {
  assert.equal(actual.workId, expected.workId);
  assert.equal(actual.action, expected.action);
  assert.equal(actual.resultingStatus, expected.resultingStatus);
  assert.equal(actual.transitionedAt, expected.transitionedAt);
  assert.equal(actual.idempotentReplay, replayExpected);
}

async function run() {
  requireEmulatorEnv();
  const db = initializeFirebaseAdmin().firestore();

  {
    const uid = tenantUid();
    const workId = "work-start-replay";
    await seedWork(uid, workId);

    const first = await startServiceWorkCommand(db, uid, workId, "start-k1");
    const replay = await startServiceWorkCommand(db, uid, workId, "start-k1");
    assertSameLogicalResult(replay, first, true);

    const work = await getWork(uid, workId);
    assert.equal(work.status, "in_progress");
    assert.equal(work.startedAt, first.transitionedAt);
    assert.equal(work.updatedAt, first.transitionedAt);

    const idemDocs = await getIdempotencyDocs(uid);
    assert.equal(idemDocs.size, 1);
  }

  {
    const uid = tenantUid();
    const workId = "work-start-complete-replay";
    await seedWork(uid, workId);

    const started = await startServiceWorkCommand(db, uid, workId, "k1-start");
    const afterStart = await getWork(uid, workId);
    const completed = await completeServiceWorkCommand(db, uid, workId, "k2-complete");
    const afterComplete = await getWork(uid, workId);
    const replayStart = await startServiceWorkCommand(db, uid, workId, "k1-start");
    const afterReplay = await getWork(uid, workId);

    assertSameLogicalResult(replayStart, started, true);
    assert.equal(completed.resultingStatus, "completed");
    assert.equal(afterStart.status, "in_progress");
    assert.equal(afterComplete.status, "completed");
    assert.equal(afterReplay.status, "completed");
    assert.equal(afterReplay.startedAt, started.transitionedAt);
    assert.equal(afterReplay.completedAt, completed.transitionedAt);
    assert.equal(afterReplay.completedAt, afterComplete.completedAt);
    assert.equal(afterReplay.updatedAt, afterComplete.updatedAt);

    const idemDocs = await getIdempotencyDocs(uid);
    assert.equal(idemDocs.size, 2);
  }

  {
    const uid = tenantUid();
    const workId = "work-complete-replay";
    await seedWork(uid, workId);

    await startServiceWorkCommand(db, uid, workId, "k1-start");
    const firstComplete = await completeServiceWorkCommand(db, uid, workId, "k2-complete");
    const replayComplete = await completeServiceWorkCommand(db, uid, workId, "k2-complete");

    assertSameLogicalResult(replayComplete, firstComplete, true);
    const work = await getWork(uid, workId);
    assert.equal(work.completedAt, firstComplete.transitionedAt);
  }

  {
    const uid = tenantUid();
    const workId = "work-cancel-replay";
    await seedWork(uid, workId);

    const firstCancel = await cancelServiceWorkCommand(db, uid, workId, "k3-cancel");
    const replayCancel = await cancelServiceWorkCommand(db, uid, workId, "k3-cancel");

    assertSameLogicalResult(replayCancel, firstCancel, true);
    const work = await getWork(uid, workId);
    assert.equal(work.status, "cancelled");
    assert.equal(work.cancelledAt, firstCancel.transitionedAt);
  }

  {
    const uid = tenantUid();
    await seedWork(uid, "work-a");
    await seedWork(uid, "work-b");

    await startServiceWorkCommand(db, uid, "work-a", "same-key");
    await assert.rejects(
      () => startServiceWorkCommand(db, uid, "work-b", "same-key"),
      isIdempotencyConflict,
    );
  }

  {
    const uid = tenantUid();
    const workId = "work-action-conflict";
    await seedWork(uid, workId);

    await startServiceWorkCommand(db, uid, workId, "same-key");
    await assert.rejects(
      () => cancelServiceWorkCommand(db, uid, workId, "same-key"),
      isIdempotencyConflict,
    );
  }

  {
    const uid = tenantUid();
    const workId = "work-concurrent-replay";
    await seedWork(uid, workId);

    const [a, b] = await Promise.all([
      startServiceWorkCommand(db, uid, workId, "same-concurrent-key"),
      startServiceWorkCommand(db, uid, workId, "same-concurrent-key"),
    ]);

    const winner = a.idempotentReplay ? b : a;
    const replay = a.idempotentReplay ? a : b;
    assert.equal(winner.idempotentReplay, false);
    assertSameLogicalResult(replay, winner, true);

    const idemDocs = await getIdempotencyDocs(uid);
    assert.equal(idemDocs.size, 1);
  }

  console.log("Services work tests passed.");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
