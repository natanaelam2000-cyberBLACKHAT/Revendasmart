import assert from "node:assert/strict";
import { initializeFirebaseAdmin } from "../server/firebase-admin-init";
import {
  acceptQuoteCommand,
  beginQuoteRevisionCommand,
  cancelQuoteCommand,
  convertAcceptedQuoteToWorkCommand,
  rejectQuoteCommand,
  sendQuoteCommand,
  type QuoteCommandResult,
} from "../server/service-quote-commands";
import { assertValidQuote, assertValidQuoteVersion, type Quote } from "../shared/service-quotes";
import {
  calculateCommercialTotals,
  createZeroServiceWorkFinancialSummary,
  normalizeServiceWorkDocument,
  type CommercialItem,
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
  return `services-quote-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function omitUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, fieldValue]) => typeof fieldValue !== "undefined")) as T;
}

const baseItems: readonly CommercialItem[] = [
  {
    kind: "service",
    id: "line-service",
    snapshot: {
      sourceId: "service-1",
      capturedAt: "2026-08-28T00:00:00.000Z",
      name: "Corte",
      priceMode: "fixed",
      priceCents: 6000,
    },
    quantity: 1,
    unitPriceCents: 6000,
    lineTotalCents: 6000,
  },
];

function buildDraftQuote(uid: string, quoteId: string, overrides: Partial<Quote> = {}): Quote {
  const now = "2026-08-28T00:00:00.000Z";
  const items = overrides.draftItems ?? baseItems;
  return assertValidQuote({
    id: quoteId,
    tenantUid: uid,
    status: "draft",
    customerId: overrides.customerId,
    draftItems: items,
    draftTotals: overrides.draftTotals ?? calculateCommercialTotals(items),
    draftCustomerMessage: overrides.draftCustomerMessage,
    draftValidUntil: overrides.draftValidUntil,
    currentVersionId: overrides.currentVersionId,
    currentVersionNumber: overrides.currentVersionNumber,
    acceptedVersionId: overrides.acceptedVersionId,
    convertedWorkId: overrides.convertedWorkId,
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
    lastSentAt: overrides.lastSentAt,
    acceptedAt: overrides.acceptedAt,
    rejectedAt: overrides.rejectedAt,
    cancelledAt: overrides.cancelledAt,
  });
}

async function seedQuote(uid: string, quoteId: string, overrides: Partial<Quote> = {}) {
  const db = initializeFirebaseAdmin().firestore();
  const quote = buildDraftQuote(uid, quoteId, overrides);
  await db.doc(`users/${uid}/quotes/${quoteId}`).set(omitUndefined(quote as unknown as Record<string, unknown>));
  return quote;
}

async function getQuote(uid: string, quoteId: string): Promise<Quote> {
  const db = initializeFirebaseAdmin().firestore();
  const snapshot = await db.doc(`users/${uid}/quotes/${quoteId}`).get();
  assert.equal(snapshot.exists, true, `Quote ${quoteId} deve existir`);
  return assertValidQuote(snapshot.data() as Quote);
}

async function getVersion(uid: string, quoteId: string, versionId: string) {
  const db = initializeFirebaseAdmin().firestore();
  const snapshot = await db.doc(`users/${uid}/quotes/${quoteId}/versions/${versionId}`).get();
  assert.equal(snapshot.exists, true, `QuoteVersion ${versionId} deve existir`);
  return assertValidQuoteVersion(snapshot.data() as any);
}

async function getVersions(uid: string, quoteId: string) {
  const db = initializeFirebaseAdmin().firestore();
  return await db.collection(`users/${uid}/quotes/${quoteId}/versions`).get();
}

async function getWork(uid: string, workId: string): Promise<ServiceWork> {
  const db = initializeFirebaseAdmin().firestore();
  const snapshot = await db.doc(`users/${uid}/serviceWorks/${workId}`).get();
  assert.equal(snapshot.exists, true, `Work ${workId} deve existir`);
  return normalizeServiceWorkDocument(snapshot.data() as ServiceWork);
}

async function getIdempotencyDocs(uid: string) {
  const db = initializeFirebaseAdmin().firestore();
  return await db.collection(`users/${uid}/quoteCommandIdempotency`).get();
}

function assertSameResult(actual: QuoteCommandResult, expected: QuoteCommandResult, replayExpected: boolean) {
  assert.equal(actual.quoteId, expected.quoteId);
  assert.equal(actual.action, expected.action);
  assert.equal(actual.resultingStatus, expected.resultingStatus);
  assert.equal(actual.transitionedAt, expected.transitionedAt);
  assert.equal(actual.currentVersionId, expected.currentVersionId);
  assert.equal(actual.currentVersionNumber, expected.currentVersionNumber);
  assert.equal(actual.acceptedVersionId, expected.acceptedVersionId);
  assert.equal(actual.convertedWorkId, expected.convertedWorkId);
  assert.equal(actual.idempotentReplay, replayExpected);
}

function hasCode(expectedCode: string) {
  return (error: unknown) =>
    typeof error === "object"
    && error !== null
    && "code" in error
    && (error as { code?: unknown }).code === expectedCode;
}

async function run() {
  requireEmulatorEnv();
  const db = initializeFirebaseAdmin().firestore();

  {
    const uid = tenantUid();
    const quoteId = "quote-send-replay";
    await seedQuote(uid, quoteId, { draftValidUntil: "2026-08-30T00:00:00.000Z" });
    const sent = await sendQuoteCommand(db, uid, quoteId, "send-k1");
    const replay = await sendQuoteCommand(db, uid, quoteId, "send-k1");
    assertSameResult(replay, sent, true);
    const version = await getVersion(uid, quoteId, "version-1");
    assert.equal(version.versionNumber, 1);
    const quote = await getQuote(uid, quoteId);
    assert.equal(quote.status, "sent");
    assert.equal(quote.currentVersionId, "version-1");
  }

  {
    const uid = tenantUid();
    const quoteId = "quote-versioning";
    await seedQuote(uid, quoteId, { draftValidUntil: "2026-08-30T00:00:00.000Z" });
    const sentV1 = await sendQuoteCommand(db, uid, quoteId, "send-v1");
    const version1 = await getVersion(uid, quoteId, "version-1");
    const revised = await beginQuoteRevisionCommand(db, uid, quoteId, "version-1", "revise-k1");
    assert.equal(revised.resultingStatus, "draft");

    const quoteAfterRevision = await getQuote(uid, quoteId);
    await db.doc(`users/${uid}/quotes/${quoteId}`).set(omitUndefined(assertValidQuote({
      ...quoteAfterRevision,
      draftItems: [
        ...baseItems,
        { kind: "additional", id: "extra-1", label: "Extra", quantity: 1, unitPriceCents: 2000, lineTotalCents: 2000 },
      ],
      draftTotals: calculateCommercialTotals([
        ...baseItems,
        { kind: "additional", id: "extra-1", label: "Extra", quantity: 1, unitPriceCents: 2000, lineTotalCents: 2000 },
      ]),
      updatedAt: "2026-08-28T00:00:01.000Z",
    }) as unknown as Record<string, unknown>));

    const sentV2 = await sendQuoteCommand(db, uid, quoteId, "send-v2");
    const version2 = await getVersion(uid, quoteId, "version-2");
    assert.equal(sentV1.currentVersionId, "version-1");
    assert.equal(sentV2.currentVersionId, "version-2");
    assert.equal(version1.totals.contractedTotalCents, 6000);
    assert.equal(version2.totals.contractedTotalCents, 8000);
    const quote = await getQuote(uid, quoteId);
    assert.equal(quote.currentVersionId, "version-2");
    assert.equal(quote.currentVersionNumber, 2);
  }

  {
    const uid = tenantUid();
    const quoteId = "quote-stale-accept";
    await seedQuote(uid, quoteId, { draftValidUntil: "2026-08-30T00:00:00.000Z" });
    await sendQuoteCommand(db, uid, quoteId, "send-v1");
    await beginQuoteRevisionCommand(db, uid, quoteId, "version-1", "revise-v1");
    const current = await getQuote(uid, quoteId);
    await db.doc(`users/${uid}/quotes/${quoteId}`).set(omitUndefined(assertValidQuote({
      ...current,
      draftCustomerMessage: "Nova versão",
      updatedAt: "2026-08-28T00:00:02.000Z",
    }) as unknown as Record<string, unknown>));
    await sendQuoteCommand(db, uid, quoteId, "send-v2");
    await assert.rejects(
      () => acceptQuoteCommand(db, uid, quoteId, "version-1", "accept-stale"),
      hasCode("STALE_QUOTE_VERSION"),
    );
  }

  {
    const uid = tenantUid();
    const quoteId = "quote-expired-accept";
    await seedQuote(uid, quoteId, { draftValidUntil: "2026-08-28T00:00:00.000Z" });
    await assert.rejects(
      () => sendQuoteCommand(db, uid, quoteId, "send-expired"),
      hasCode("INVALID_PAYLOAD"),
    );
  }

  {
    const uid = tenantUid();
    const quoteId = "quote-reject";
    await seedQuote(uid, quoteId, { draftValidUntil: "2026-08-30T00:00:00.000Z" });
    await sendQuoteCommand(db, uid, quoteId, "send-reject");
    const rejected = await rejectQuoteCommand(db, uid, quoteId, "version-1", "reject-k1");
    const replay = await rejectQuoteCommand(db, uid, quoteId, "version-1", "reject-k1");
    assertSameResult(replay, rejected, true);
    const quote = await getQuote(uid, quoteId);
    assert.equal(quote.status, "rejected");
    await assert.rejects(() => beginQuoteRevisionCommand(db, uid, quoteId, "version-1", "revise-after-reject"), hasCode("INVALID_TRANSITION"));
  }

  {
    const uid = tenantUid();
    const quoteId = "quote-cancel-draft";
    await seedQuote(uid, quoteId);
    const cancelled = await cancelQuoteCommand(db, uid, quoteId, "cancel-draft");
    const replay = await cancelQuoteCommand(db, uid, quoteId, "cancel-draft");
    assertSameResult(replay, cancelled, true);
    const quote = await getQuote(uid, quoteId);
    assert.equal(quote.status, "cancelled");
  }

  {
    const uid = tenantUid();
    const quoteId = "quote-cancel-sent";
    await seedQuote(uid, quoteId, { draftValidUntil: "2026-08-30T00:00:00.000Z" });
    await sendQuoteCommand(db, uid, quoteId, "send-cancel");
    const cancelled = await cancelQuoteCommand(db, uid, quoteId, "cancel-sent");
    assert.equal(cancelled.resultingStatus, "cancelled");
    const quote = await getQuote(uid, quoteId);
    assert.equal(quote.status, "cancelled");
  }

  {
    const uid = tenantUid();
    const quoteId = "quote-convert";
    await seedQuote(uid, quoteId, { draftValidUntil: "2026-08-30T00:00:00.000Z", customerId: "client-1" });
    await sendQuoteCommand(db, uid, quoteId, "send-convert");
    await acceptQuoteCommand(db, uid, quoteId, "version-1", "accept-convert");
    const converted = await convertAcceptedQuoteToWorkCommand(db, uid, quoteId, "convert-k1");
    const replay = await convertAcceptedQuoteToWorkCommand(db, uid, quoteId, "convert-k1");
    assertSameResult(replay, converted, true);
    const work = await getWork(uid, "quote-work-quote-convert");
    assert.equal(work.status, "planned");
    assert.equal(work.origin, "quote");
    assert.equal(work.sourceQuoteId, quoteId);
    assert.equal(work.sourceQuoteVersionId, "version-1");
    assert.equal(work.customerId, "client-1");
    assert.deepEqual(work.items, baseItems);
    assert.deepEqual(work.totals, calculateCommercialTotals(baseItems));
    assert.deepEqual(work.financialSummary, createZeroServiceWorkFinancialSummary());
    assert.deepEqual(work.cost, { kind: "unknown" });
    const quote = await getQuote(uid, quoteId);
    assert.equal(quote.convertedWorkId, "quote-work-quote-convert");
    const secondKey = await convertAcceptedQuoteToWorkCommand(db, uid, quoteId, "convert-k2");
    assert.equal(secondKey.convertedWorkId, "quote-work-quote-convert");
    const workDocs = await db.collection(`users/${uid}/serviceWorks`).get();
    assert.equal(workDocs.size, 1);
  }

  {
    const uid = tenantUid();
    const quoteId = "quote-replay-after-later-state";
    await seedQuote(uid, quoteId, { draftValidUntil: "2026-08-30T00:00:00.000Z" });
    const sendV1 = await sendQuoteCommand(db, uid, quoteId, "send-k1");
    await beginQuoteRevisionCommand(db, uid, quoteId, "version-1", "revise-k2");
    const current = await getQuote(uid, quoteId);
    await db.doc(`users/${uid}/quotes/${quoteId}`).set(omitUndefined(assertValidQuote({
      ...current,
      draftCustomerMessage: "v2",
      updatedAt: "2026-08-28T00:00:03.000Z",
    }) as unknown as Record<string, unknown>));
    await sendQuoteCommand(db, uid, quoteId, "send-k3");
    await acceptQuoteCommand(db, uid, quoteId, "version-2", "accept-k4");
    const replay = await sendQuoteCommand(db, uid, quoteId, "send-k1");
    assertSameResult(replay, sendV1, true);
    const versions = await getVersions(uid, quoteId);
    assert.equal(versions.size, 2);
  }

  {
    const uid = tenantUid();
    const quoteId = "quote-action-conflict";
    await seedQuote(uid, quoteId, { draftValidUntil: "2026-08-30T00:00:00.000Z" });
    await sendQuoteCommand(db, uid, quoteId, "same-key");
    await assert.rejects(() => cancelQuoteCommand(db, uid, quoteId, "same-key"), hasCode("IDEMPOTENCY_CONFLICT"));
  }

  {
    const uid = tenantUid();
    await seedQuote(uid, "quote-a", { draftValidUntil: "2026-08-30T00:00:00.000Z" });
    await seedQuote(uid, "quote-b", { draftValidUntil: "2026-08-30T00:00:00.000Z" });
    await sendQuoteCommand(db, uid, "quote-a", "same-key");
    await assert.rejects(() => sendQuoteCommand(db, uid, "quote-b", "same-key"), hasCode("IDEMPOTENCY_CONFLICT"));
  }

  {
    const uid = tenantUid();
    const quoteId = "quote-invalid-convert";
    await seedQuote(uid, quoteId);
    await assert.rejects(() => convertAcceptedQuoteToWorkCommand(db, uid, quoteId, "convert-draft"), hasCode("INVALID_TRANSITION"));
  }

  {
    const uid = tenantUid();
    const quoteId = "quote-idempotency-count";
    await seedQuote(uid, quoteId, { draftValidUntil: "2026-08-30T00:00:00.000Z" });
    await sendQuoteCommand(db, uid, quoteId, "count-send");
    await beginQuoteRevisionCommand(db, uid, quoteId, "version-1", "count-revise");
    const idemDocs = await getIdempotencyDocs(uid);
    assert.equal(idemDocs.size, 2);
  }

  console.log("Services quote tests passed.");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
