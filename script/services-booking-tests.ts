import assert from "node:assert/strict";
import express, { type Request, type Response, type NextFunction } from "express";
import { AddressInfo } from "node:net";
import { deleteApp, initializeApp, type FirebaseApp } from "firebase/app";
import { connectAuthEmulator, createUserWithEmailAndPassword, getAuth, type Auth } from "firebase/auth";
import { deleteApp as deleteAdminApp, initializeApp as initializeAdminApp } from "firebase-admin/app";
import { getFirestore as getAdminFirestore } from "firebase-admin/firestore";
import {
  connectFirestoreEmulator,
  deleteDoc,
  doc,
  getDoc,
  getFirestore,
  setDoc,
  updateDoc,
  type Firestore,
} from "firebase/firestore";
import { initializeFirebaseAdmin } from "../server/firebase-admin-init";
import { registerServiceBookingRoutes } from "../server/service-booking-commands";
import { recordServicePaymentCommand } from "../server/service-payment-commands";
import {
  BOOKING_HOLD_TTL_MINUTES,
  SCHEDULE_LOCK_GRANULARITY_MINUTES,
  assertValidBooking,
  assertValidBookingHold,
  assertValidBookingInterval,
  assertValidScheduleLock,
  computeScheduleSegments,
  diffScheduleSegments,
  isAlignedToLockGrid,
  isExpired,
  isSegmentAvailableForHold,
  ServiceBookingsDomainError,
} from "../shared/service-bookings";

process.env.FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || "demo-revendasmart";
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || "127.0.0.1:9099";

function requireEmulatorEnv() {
  assert.equal(process.env.FIREBASE_PROJECT_ID, "demo-revendasmart");
  assert.equal(process.env.FIRESTORE_EMULATOR_HOST, "127.0.0.1:8080");
  assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, "127.0.0.1:9099");
}

function tenantUid(prefix = "services-booking"): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function omitUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => typeof v !== "undefined")) as T;
}

// ====================================================================================================
// §23 — testes de domínio puro (sem emulador): segmentação, intervalos, alinhamento, expiração lógica.
// ====================================================================================================
function runDomainTests() {
  // Segmentação — 10:00-10:30 => exatamente 6 segmentos de 5 minutos; 10:30 não pertence a este intervalo.
  {
    const segments = computeScheduleSegments("2026-08-29T10:00:00.000Z", "2026-08-29T10:30:00.000Z");
    assert.deepEqual(segments, [
      "2026-08-29T10:00:00.000Z", "2026-08-29T10:05:00.000Z", "2026-08-29T10:10:00.000Z",
      "2026-08-29T10:15:00.000Z", "2026-08-29T10:20:00.000Z", "2026-08-29T10:25:00.000Z",
    ]);
    assert.ok(!segments.includes("2026-08-29T10:30:00.000Z"), "10:30 nunca pertence ao intervalo [10:00,10:30)");
  }

  // Intervalos — start >= end é rejeitado.
  assert.throws(() => assertValidBookingInterval("2026-08-29T10:00:00.000Z", "2026-08-29T10:00:00.000Z"), ServiceBookingsDomainError);
  assert.throws(() => assertValidBookingInterval("2026-08-29T10:30:00.000Z", "2026-08-29T10:00:00.000Z"), ServiceBookingsDomainError);

  // Alinhamento — startAt/endAt precisam cair na grade de 5 minutos.
  assert.equal(isAlignedToLockGrid(Date.parse("2026-08-29T10:00:00.000Z")), true);
  assert.equal(isAlignedToLockGrid(Date.parse("2026-08-29T10:03:00.000Z")), false);
  assert.throws(() => computeScheduleSegments("2026-08-29T10:03:00.000Z", "2026-08-29T10:30:00.000Z"), ServiceBookingsDomainError);

  // Hold TTL constante.
  assert.equal(BOOKING_HOLD_TTL_MINUTES, 5);
  assert.equal(SCHEDULE_LOCK_GRANULARITY_MINUTES, 5);

  // Expiração — expiresAt <= now => logicamente expirado, SEM depender de deleção física.
  assert.equal(isExpired("2026-08-29T10:00:00.000Z", "2026-08-29T10:00:00.000Z"), true, "expiresAt == now conta como expirado");
  assert.equal(isExpired("2026-08-29T10:00:00.000Z", "2026-08-29T10:00:01.000Z"), true);
  assert.equal(isExpired("2026-08-29T10:00:01.000Z", "2026-08-29T10:00:00.000Z"), false);

  // Disponibilidade de segmento: sem lock => disponível; lock de hold expirado => disponível; lock de
  // booking confirmado (nunca expira) => sempre indisponível; lock de hold ainda ativo => indisponível.
  const now = "2026-08-29T10:00:00.000Z";
  assert.equal(isSegmentAvailableForHold(undefined, now), true);
  assert.equal(isSegmentAvailableForHold({ ownerType: "hold", expiresAt: "2026-08-29T09:59:00.000Z" }, now), true);
  assert.equal(isSegmentAvailableForHold({ ownerType: "hold", expiresAt: "2026-08-29T10:01:00.000Z" }, now), false);
  assert.equal(isSegmentAvailableForHold({ ownerType: "booking", expiresAt: undefined }, now), false);

  // Validators puros — shapes válidos passam, inválidos rejeitam.
  const validHold = {
    id: "hold-1", tenantUid: "uid-1", serviceId: "svc-1", resourceId: "res-1",
    startAt: "2026-08-29T10:00:00.000Z", endAt: "2026-08-29T10:30:00.000Z",
    status: "active" as const, expiresAt: "2026-08-29T10:05:00.000Z", createdAt: "2026-08-29T10:00:00.000Z",
    idempotencyKey: "idem-key-123456",
  };
  assertValidBookingHold(validHold);
  assert.throws(() => assertValidBookingHold({ ...validHold, status: "confirmed" }), ServiceBookingsDomainError, "confirmed sem confirmedBookingId/confirmedWorkId deve falhar");
  assertValidBookingHold({ ...validHold, status: "confirmed", confirmedBookingId: "booking-1", confirmedWorkId: "work-1" });

  const validBooking = {
    id: "booking-1", tenantUid: "uid-1", serviceId: "svc-1", resourceId: "res-1", workId: "work-1",
    startAt: "2026-08-29T10:00:00.000Z", endAt: "2026-08-29T10:30:00.000Z",
    status: "confirmed" as const, source: "manual" as const, createdAt: "2026-08-29T10:00:00.000Z",
    updatedAt: "2026-08-29T10:00:00.000Z",
  };
  assertValidBooking(validBooking);
  assert.throws(() => assertValidBooking({ ...validBooking, status: "cancelled" }), ServiceBookingsDomainError, "cancelled sem cancelledAt deve falhar");
  assertValidBooking({ ...validBooking, status: "cancelled", cancelledAt: "2026-08-29T11:00:00.000Z" });
  assert.throws(() => assertValidBooking({ ...validBooking, cancelledAt: "2026-08-29T11:00:00.000Z" }), ServiceBookingsDomainError, "confirmed com cancelledAt deve falhar");

  // SERV-BOOK-02 — Hold "released": exige releasedAt, proíbe confirmedBookingId/confirmedWorkId.
  assert.throws(() => assertValidBookingHold({ ...validHold, status: "released" }), ServiceBookingsDomainError, "released sem releasedAt deve falhar");
  assertValidBookingHold({ ...validHold, status: "released", releasedAt: "2026-08-29T10:04:00.000Z" });
  assert.throws(
    () => assertValidBookingHold({ ...validHold, status: "released", releasedAt: "2026-08-29T10:04:00.000Z", confirmedBookingId: "booking-1" }),
    ServiceBookingsDomainError,
    "released não pode carregar confirmedBookingId",
  );

  // SERV-BOOK-02 — diffScheduleSegments: caso do §16 (10:00-10:30 => 10:15-10:45).
  {
    const oldSegments = computeScheduleSegments("2026-08-29T10:00:00.000Z", "2026-08-29T10:30:00.000Z");
    const newSegments = computeScheduleSegments("2026-08-29T10:15:00.000Z", "2026-08-29T10:45:00.000Z");
    const diff = diffScheduleSegments(oldSegments, newSegments);
    assert.deepEqual(diff.sharedSegments, ["2026-08-29T10:15:00.000Z", "2026-08-29T10:20:00.000Z", "2026-08-29T10:25:00.000Z"]);
    assert.deepEqual(diff.releasedSegments, ["2026-08-29T10:00:00.000Z", "2026-08-29T10:05:00.000Z", "2026-08-29T10:10:00.000Z"]);
    assert.deepEqual(diff.acquiredSegments, ["2026-08-29T10:30:00.000Z", "2026-08-29T10:35:00.000Z", "2026-08-29T10:40:00.000Z"]);
  }

  const validLock = { tenantUid: "uid-1", resourceId: "res-1", segmentStartAt: "2026-08-29T10:00:00.000Z", ownerType: "hold" as const, ownerId: "hold-1", expiresAt: "2026-08-29T10:05:00.000Z" };
  assertValidScheduleLock(validLock);
  assert.throws(() => assertValidScheduleLock({ ...validLock, ownerType: "booking" }), ServiceBookingsDomainError, "booking-owned lock não pode carregar expiresAt");

  console.log("Services booking pure-function tests passed: segmentation (6 segments, boundary exclusive), interval rejection (start>=end), 5-minute grid alignment, HOLD_TTL/lock granularity constants, logical expiration (expiresAt<=now, never physical deletion), segment availability (free/hold-expired => available, booking/hold-active => unavailable), hold/booking/lock validators, SERV-BOOK-02 cancelled-Booking/released-Hold shape validation, and diffScheduleSegments for the §16 shared/released/acquired worked example.");
}

// ====================================================================================================
// Harness HTTP (mesmo padrão de script/services-pay-tests.ts): comandos reais via Express + Admin SDK
// contra o emulador, sem depender de Firebase Auth para os testes de COMANDO (tenant vem de x-test-uid,
// só a seção de Security Rules abaixo usa Auth real, porque é isso que as Rules exigem).
// ====================================================================================================
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
  registerServiceBookingRoutes(app, requireAuth);
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
    headers: { "content-type": "application/json", ...(uid ? { "x-test-uid": uid } : {}) },
    body: JSON.stringify(body),
  });
  return {
    status: response.status,
    body: response.headers.get("content-type")?.includes("application/json") ? await response.json() : null,
  };
}

function validService(id: string, tenantUid: string, overrides: Record<string, unknown> = {}) {
  return omitUndefined({
    id, tenantUid, name: "Corte de cabelo", active: true, published: true,
    pricing: { mode: "fixed", priceCents: 8000 }, cost: { kind: "unknown" },
    durationMinutes: 30, bookingMode: "instant",
    createdAt: "2026-08-29T00:00:00.000Z", updatedAt: "2026-08-29T00:00:00.000Z",
    ...overrides,
  });
}

async function seedService(uid: string, id: string, overrides: Record<string, unknown> = {}) {
  const db = initializeFirebaseAdmin().firestore();
  await db.doc(`users/${uid}/services/${id}`).set(validService(id, uid, overrides));
}

// SERV-BOOK-02 — atalho para fixtures de cancel/reschedule: cria Service + Hold + confirm via HTTP real
// (nunca escreve Booking/Work diretamente), devolvendo os ids necessários para os testes seguintes.
async function seedConfirmedBooking(
  baseUrl: string, uid: string, serviceId: string, resourceId: string, startAt: string, keyPrefix: string,
) {
  await seedService(uid, serviceId, { durationMinutes: 30 });
  const hold = await postJson(baseUrl, "/api/services/bookings/holds", {
    serviceId, resourceId, startAt, idempotencyKey: `${keyPrefix}-hold`,
  }, uid);
  assert.equal(hold.status, 200, `seedConfirmedBooking(${keyPrefix}): hold falhou — ${JSON.stringify(hold.body)}`);
  const confirm = await postJson(baseUrl, `/api/services/bookings/holds/${hold.body.holdId}/confirm`, { idempotencyKey: `${keyPrefix}-confirm` }, uid);
  assert.equal(confirm.status, 200, `seedConfirmedBooking(${keyPrefix}): confirm falhou — ${JSON.stringify(confirm.body)}`);
  return {
    bookingId: confirm.body.bookingId as string,
    workId: confirm.body.workId as string,
    holdId: hold.body.holdId as string,
    startAt: hold.body.startAt as string,
    endAt: hold.body.endAt as string,
  };
}

// SERV-BOOK-02 §34 — invariante global: por resource, cada segmento tem no máximo 1 owner, e todo
// Booking confirmado tem o conjunto completo de locks correspondente ao seu intervalo persistido.
async function auditNoOverlapInvariant(db: FirebaseFirestore.Firestore, uid: string, resourceId: string) {
  const lockSnaps = await db.collection(`users/${uid}/scheduleLocks`).where("resourceId", "==", resourceId).get();
  const bySegment = new Map<string, Set<string>>();
  for (const lockDoc of lockSnaps.docs) {
    const data = lockDoc.data();
    if (!bySegment.has(data.segmentStartAt)) bySegment.set(data.segmentStartAt, new Set());
    bySegment.get(data.segmentStartAt)!.add(`${data.ownerType}:${data.ownerId}`);
  }
  for (const [segment, owners] of bySegment) {
    assert.equal(owners.size, 1, `DUPLICATE_ACTIVE_SEGMENT_OWNERS: ${uid}/${resourceId}/${segment} tem ${owners.size} owners`);
  }
  const bookingsSnap = await db.collection(`users/${uid}/bookings`).where("resourceId", "==", resourceId).where("status", "==", "confirmed").get();
  for (const bookingDoc of bookingsSnap.docs) {
    const booking = bookingDoc.data();
    const segments = computeScheduleSegments(booking.startAt, booking.endAt);
    for (const segment of segments) {
      const owners = bySegment.get(segment);
      assert.ok(
        owners && owners.has(`booking:${bookingDoc.id}`),
        `ACTIVE_BOOKING_WITHOUT_COMPLETE_LOCK_SET: booking ${bookingDoc.id} não tem lock para o segmento ${segment}`,
      );
    }
  }
}

async function runCommandTests() {
  const harness = await createServer();
  const db = initializeFirebaseAdmin().firestore();

  try {
    // ===== Caso 1 (§24.1) — Hold válido cria Hold + todos os locks =====
    {
      const uid = tenantUid();
      await seedService(uid, "svc-a");
      const result = await postJson(harness.baseUrl, "/api/services/bookings/holds", {
        serviceId: "svc-a", resourceId: "res-a", startAt: "2026-08-29T10:00:00.000Z", idempotencyKey: "hold-case1",
      }, uid);
      assert.equal(result.status, 200, JSON.stringify(result.body));
      assert.equal(result.body.action, "create_hold");
      assert.equal(result.body.startAt, "2026-08-29T10:00:00.000Z");
      assert.equal(result.body.endAt, "2026-08-29T10:30:00.000Z", "endAt derivado de durationMinutes=30, nunca do client");
      const holdSnap = await db.doc(`users/${uid}/bookingHolds/${result.body.holdId}`).get();
      assert.equal(holdSnap.exists, true);
      const lockSnaps = await db.collection(`users/${uid}/scheduleLocks`).where("ownerId", "==", result.body.holdId).get();
      assert.equal(lockSnaps.size, 6, "10:00-10:30 deve adquirir exatamente 6 locks de 5 minutos");
    }

    // ===== Caso 2 (§24.2/§12) — mesmo resource+horário concorrente: 1 success, 1 conflict =====
    {
      const uid = tenantUid();
      await seedService(uid, "svc-b");
      const [a, b] = await Promise.all([
        postJson(harness.baseUrl, "/api/services/bookings/holds", { serviceId: "svc-b", resourceId: "res-b", startAt: "2026-08-29T11:00:00.000Z", idempotencyKey: "hold-race-a" }, uid),
        postJson(harness.baseUrl, "/api/services/bookings/holds", { serviceId: "svc-b", resourceId: "res-b", startAt: "2026-08-29T11:00:00.000Z", idempotencyKey: "hold-race-b" }, uid),
      ]);
      const statuses = [a.status, b.status].sort();
      assert.deepEqual(statuses, [200, 409], "exatamente 1 sucesso e 1 conflito, nunca 2 sucessos");
      const successCount = [a, b].filter((r) => r.status === 200).length;
      assert.equal(successCount, 1);
    }

    // ===== Caso 3 (§13/§24.3) — overlap parcial não coexiste =====
    {
      const uid = tenantUid();
      await seedService(uid, "svc-c", { durationMinutes: 30 });
      const first = await postJson(harness.baseUrl, "/api/services/bookings/holds", { serviceId: "svc-c", resourceId: "res-c", startAt: "2026-08-29T10:00:00.000Z", idempotencyKey: "hold-overlap-1" }, uid);
      assert.equal(first.status, 200);
      // segundo serviço com duração 30min começando 10:15 => [10:15,10:45) — sobrepõe [10:00,10:30).
      await seedService(uid, "svc-c2", { durationMinutes: 30 });
      const second = await postJson(harness.baseUrl, "/api/services/bookings/holds", { serviceId: "svc-c2", resourceId: "res-c", startAt: "2026-08-29T10:15:00.000Z", idempotencyKey: "hold-overlap-2" }, uid);
      assert.equal(second.status, 409, "10:00-10:30 e 10:15-10:45 no mesmo resource devem conflitar");
      assert.equal(second.body?.code, "SEGMENT_UNAVAILABLE");
    }

    // ===== Caso 4 (§13/§24.4) — boundary adjacency: 10:00-10:30 e 10:30-11:00 coexistem =====
    {
      const uid = tenantUid();
      await seedService(uid, "svc-d");
      const first = await postJson(harness.baseUrl, "/api/services/bookings/holds", { serviceId: "svc-d", resourceId: "res-d", startAt: "2026-08-29T10:00:00.000Z", idempotencyKey: "hold-boundary-1" }, uid);
      assert.equal(first.status, 200);
      const second = await postJson(harness.baseUrl, "/api/services/bookings/holds", { serviceId: "svc-d", resourceId: "res-d", startAt: "2026-08-29T10:30:00.000Z", idempotencyKey: "hold-boundary-2" }, uid);
      assert.equal(second.status, 200, "10:30-11:00 deve ser permitido logo após 10:00-10:30 no mesmo resource");
    }

    // ===== Caso 5 (§13/§24.5) — recursos diferentes, mesmo horário: permitido =====
    {
      const uid = tenantUid();
      await seedService(uid, "svc-e");
      const a = await postJson(harness.baseUrl, "/api/services/bookings/holds", { serviceId: "svc-e", resourceId: "res-e1", startAt: "2026-08-29T12:00:00.000Z", idempotencyKey: "hold-diffres-a" }, uid);
      const b = await postJson(harness.baseUrl, "/api/services/bookings/holds", { serviceId: "svc-e", resourceId: "res-e2", startAt: "2026-08-29T12:00:00.000Z", idempotencyKey: "hold-diffres-b" }, uid);
      assert.equal(a.status, 200);
      assert.equal(b.status, 200, "mesmo horário em resource diferente nunca conflita");
    }

    // ===== Caso 6 (§15/§24.6) — hold expirado libera os segmentos SEM esperar TTL delete =====
    {
      const uid = tenantUid();
      await seedService(uid, "svc-f");
      const first = await postJson(harness.baseUrl, "/api/services/bookings/holds", { serviceId: "svc-f", resourceId: "res-f", startAt: "2026-08-29T13:00:00.000Z", idempotencyKey: "hold-expire-1" }, uid);
      assert.equal(first.status, 200);
      // Simula o relógio avançando 6 minutos (> HOLD_TTL=5): sobrescreve expiresAt do hold E de cada lock
      // diretamente no Firestore — o documento físico continua existindo, só logicamente expirado (§10).
      const pastExpiry = "2026-08-29T12:00:00.000Z";
      await db.doc(`users/${uid}/bookingHolds/${first.body.holdId}`).update({ expiresAt: pastExpiry });
      const lockSnaps = await db.collection(`users/${uid}/scheduleLocks`).where("ownerId", "==", first.body.holdId).get();
      await Promise.all(lockSnaps.docs.map((d) => d.ref.update({ expiresAt: pastExpiry })));

      const second = await postJson(harness.baseUrl, "/api/services/bookings/holds", { serviceId: "svc-f", resourceId: "res-f", startAt: "2026-08-29T13:00:00.000Z", idempotencyKey: "hold-expire-2" }, uid);
      assert.equal(second.status, 200, "um novo hold deve reaproveitar segmentos de um hold logicamente expirado imediatamente, sem esperar deleção física");
    }

    // ===== Caso 7/8 (§24.7/§24.8/§27) — confirm válido gera exatamente 1 Booking + 1 Work zerado, sem Payment =====
    let confirmedWorkPath = "";
    {
      const uid = tenantUid();
      await seedService(uid, "svc-g", { name: "Manicure", pricing: { mode: "fixed", priceCents: 5000 } });
      const hold = await postJson(harness.baseUrl, "/api/services/bookings/holds", { serviceId: "svc-g", resourceId: "res-g", startAt: "2026-08-29T14:00:00.000Z", customerId: "cust-g", idempotencyKey: "hold-confirm-1" }, uid);
      assert.equal(hold.status, 200);
      const confirm = await postJson(harness.baseUrl, `/api/services/bookings/holds/${hold.body.holdId}/confirm`, { idempotencyKey: "confirm-1" }, uid);
      assert.equal(confirm.status, 200, JSON.stringify(confirm.body));
      assert.equal(confirm.body.action, "confirm_hold");

      const bookingSnap = await db.doc(`users/${uid}/bookings/${confirm.body.bookingId}`).get();
      assert.equal(bookingSnap.exists, true);
      assert.equal(bookingSnap.data()?.workId, confirm.body.workId);
      assert.equal(bookingSnap.data()?.status, "confirmed");

      const workSnap = await db.doc(`users/${uid}/serviceWorks/${confirm.body.workId}`).get();
      assert.equal(workSnap.exists, true);
      const work = workSnap.data()!;
      assert.equal(work.origin, "booking");
      assert.deepEqual(work.financialSummary, { grossReceivedCents: 0, refundedTotalCents: 0, netReceivedCents: 0 });
      assert.equal(work.items[0].unitPriceCents, 5000);
      assert.equal(work.totals.contractedTotalCents, 5000);

      const paymentsSnap = await db.collection(`users/${uid}/serviceWorks/${confirm.body.workId}/payments`).get();
      assert.equal(paymentsSnap.size, 0, "confirmar Booking NUNCA cria Payment");

      const holdAfter = await db.doc(`users/${uid}/bookingHolds/${hold.body.holdId}`).get();
      assert.equal(holdAfter.data()?.status, "confirmed");

      const lockSnaps = await db.collection(`users/${uid}/scheduleLocks`).where("ownerId", "==", confirm.body.bookingId).get();
      assert.equal(lockSnaps.size, 6, "todos os locks convertidos para ownerType=booking/ownerId=bookingId");
      for (const lockDoc of lockSnaps.docs) {
        assert.equal(lockDoc.data().ownerType, "booking");
        assert.equal(typeof lockDoc.data().expiresAt, "undefined", "lock de booking confirmado nunca carrega expiresAt");
      }
      confirmedWorkPath = `users/${uid}/serviceWorks/${confirm.body.workId}`;
    }
    assert.ok(confirmedWorkPath.length > 0);

    // ===== Caso 9 (§15/§24.9) — confirm de hold expirado é rejeitado =====
    {
      const uid = tenantUid();
      await seedService(uid, "svc-h");
      const hold = await postJson(harness.baseUrl, "/api/services/bookings/holds", { serviceId: "svc-h", resourceId: "res-h", startAt: "2026-08-29T15:00:00.000Z", idempotencyKey: "hold-expconfirm-1" }, uid);
      assert.equal(hold.status, 200);
      await db.doc(`users/${uid}/bookingHolds/${hold.body.holdId}`).update({ expiresAt: "2026-08-29T14:00:00.000Z" });
      const confirm = await postJson(harness.baseUrl, `/api/services/bookings/holds/${hold.body.holdId}/confirm`, { idempotencyKey: "confirm-exp-1" }, uid);
      assert.equal(confirm.status, 409);
      assert.equal(confirm.body?.code, "HOLD_EXPIRED");
    }

    // ===== Caso 10 (§24.10) — lock ownership perdido bloqueia confirm =====
    {
      const uid = tenantUid();
      await seedService(uid, "svc-i");
      const hold = await postJson(harness.baseUrl, "/api/services/bookings/holds", { serviceId: "svc-i", resourceId: "res-i", startAt: "2026-08-29T16:00:00.000Z", idempotencyKey: "hold-lockloss-1" }, uid);
      assert.equal(hold.status, 200);
      const lockSnaps = await db.collection(`users/${uid}/scheduleLocks`).where("ownerId", "==", hold.body.holdId).limit(1).get();
      // Simula outro hold roubando um dos segmentos (só é fisicamente possível se o hold original já
      // tivesse expirado — aqui forçamos o estado diretamente para testar a defesa em profundidade do
      // confirm, que relê ownership em vez de confiar que o holdId ainda é dono).
      await lockSnaps.docs[0].ref.update({ ownerId: "hold-outro" });
      const confirm = await postJson(harness.baseUrl, `/api/services/bookings/holds/${hold.body.holdId}/confirm`, { idempotencyKey: "confirm-lockloss-1" }, uid);
      assert.equal(confirm.status, 409);
      assert.equal(confirm.body?.code, "LOCK_OWNERSHIP_LOST");
    }

    // ===== Caso 11 (§16/§24.11) — confirmações concorrentes do mesmo hold => 1 Booking, 1 Work =====
    {
      const uid = tenantUid();
      await seedService(uid, "svc-j");
      const hold = await postJson(harness.baseUrl, "/api/services/bookings/holds", { serviceId: "svc-j", resourceId: "res-j", startAt: "2026-08-29T17:00:00.000Z", idempotencyKey: "hold-confrace-1" }, uid);
      assert.equal(hold.status, 200);
      const [a, b] = await Promise.all([
        postJson(harness.baseUrl, `/api/services/bookings/holds/${hold.body.holdId}/confirm`, { idempotencyKey: "confirm-race-a" }, uid),
        postJson(harness.baseUrl, `/api/services/bookings/holds/${hold.body.holdId}/confirm`, { idempotencyKey: "confirm-race-b" }, uid),
      ]);
      assert.equal(a.status, 200);
      assert.equal(b.status, 200);
      assert.equal(a.body.bookingId, b.body.bookingId, "duas confirmações concorrentes do mesmo hold nunca geram Bookings diferentes");
      assert.equal(a.body.workId, b.body.workId);
      const bookingsSnap = await db.collection(`users/${uid}/bookings`).where("workId", "==", a.body.workId).get();
      assert.equal(bookingsSnap.size, 1, "CONCURRENT_CONFIRM_BOOKING_COUNT deve ser exatamente 1");
      const worksSnap = await db.doc(`users/${uid}/serviceWorks/${a.body.workId}`).get();
      assert.equal(worksSnap.exists, true);
    }

    // ===== Caso 12 (§17/§24.12) — create hold idempotente: retry devolve o mesmo Hold =====
    {
      const uid = tenantUid();
      await seedService(uid, "svc-k");
      const first = await postJson(harness.baseUrl, "/api/services/bookings/holds", { serviceId: "svc-k", resourceId: "res-k", startAt: "2026-08-29T18:00:00.000Z", idempotencyKey: "hold-idem-1" }, uid);
      const retry = await postJson(harness.baseUrl, "/api/services/bookings/holds", { serviceId: "svc-k", resourceId: "res-k", startAt: "2026-08-29T18:00:00.000Z", idempotencyKey: "hold-idem-1" }, uid);
      assert.equal(first.status, 200);
      assert.equal(retry.status, 200);
      assert.equal(retry.body.holdId, first.body.holdId);
      assert.equal(retry.body.idempotentReplay, true);
      const holdsSnap = await db.collection(`users/${uid}/bookingHolds`).get();
      assert.equal(holdsSnap.size, 1, "replay nunca cria um segundo Hold");
    }

    // ===== Caso 13 (§17/§24.13) — confirm idempotente: retry devolve o mesmo Booking/Work =====
    {
      const uid = tenantUid();
      await seedService(uid, "svc-l");
      const hold = await postJson(harness.baseUrl, "/api/services/bookings/holds", { serviceId: "svc-l", resourceId: "res-l", startAt: "2026-08-29T19:00:00.000Z", idempotencyKey: "hold-idemconf-1" }, uid);
      const first = await postJson(harness.baseUrl, `/api/services/bookings/holds/${hold.body.holdId}/confirm`, { idempotencyKey: "confirm-idem-1" }, uid);
      const retry = await postJson(harness.baseUrl, `/api/services/bookings/holds/${hold.body.holdId}/confirm`, { idempotencyKey: "confirm-idem-1" }, uid);
      assert.equal(first.status, 200);
      assert.equal(retry.status, 200);
      assert.equal(retry.body.bookingId, first.body.bookingId);
      assert.equal(retry.body.workId, first.body.workId);
      assert.equal(retry.body.idempotentReplay, true);
    }

    // ===== Caso 14 (§17/§24.14) — mesma key + payload incompatível => IDEMPOTENCY_CONFLICT =====
    {
      const uid = tenantUid();
      await seedService(uid, "svc-m1");
      await seedService(uid, "svc-m2");
      const first = await postJson(harness.baseUrl, "/api/services/bookings/holds", { serviceId: "svc-m1", resourceId: "res-m", startAt: "2026-08-29T20:00:00.000Z", idempotencyKey: "hold-conflict-1" }, uid);
      assert.equal(first.status, 200);
      const otherService = await postJson(harness.baseUrl, "/api/services/bookings/holds", { serviceId: "svc-m2", resourceId: "res-m", startAt: "2026-08-29T20:00:00.000Z", idempotencyKey: "hold-conflict-1" }, uid);
      assert.equal(otherService.status, 409);
      assert.equal(otherService.body?.code, "IDEMPOTENCY_CONFLICT");
      const otherTime = await postJson(harness.baseUrl, "/api/services/bookings/holds", { serviceId: "svc-m1", resourceId: "res-m", startAt: "2026-08-29T21:00:00.000Z", idempotencyKey: "hold-conflict-1" }, uid);
      assert.equal(otherTime.status, 409);
      assert.equal(otherTime.body?.code, "IDEMPOTENCY_CONFLICT");
    }

    // ===== §25 — race mais forte: 10 tentativas concorrentes no mesmo resource+intervalo =====
    {
      const uid = tenantUid();
      await seedService(uid, "svc-n");
      const attempts = await Promise.all(
        Array.from({ length: 10 }, (_, i) =>
          postJson(harness.baseUrl, "/api/services/bookings/holds", { serviceId: "svc-n", resourceId: "res-n", startAt: "2026-08-29T22:00:00.000Z", idempotencyKey: `hold-strongrace-${i}` }, uid)),
      );
      const successes = attempts.filter((r) => r.status === 200);
      const conflicts = attempts.filter((r) => r.status === 409);
      assert.equal(successes.length, 1, "no máximo 1 hold ativo pode adquirir o intervalo entre 10 tentativas concorrentes");
      assert.equal(conflicts.length, 9);
      const holdsSnap = await db.collection(`users/${uid}/bookingHolds`).get();
      assert.equal(holdsSnap.size, 1, "estado final: exatamente 1 Hold persistido, zero sobreposição inválida");
      const lockSnaps = await db.collection(`users/${uid}/scheduleLocks`).where("resourceId", "==", "res-n").get();
      const owners = new Set(lockSnaps.docs.map((d) => d.data().ownerId));
      assert.equal(owners.size, 1, "todos os locks do intervalo pertencem ao mesmo único owner vencedor");
    }

    // ===== §26 — invariante central: nenhum estado persistido tem 2 Bookings ocupando o mesmo segmento =====
    {
      const uid = tenantUid();
      await seedService(uid, "svc-o");
      const hold = await postJson(harness.baseUrl, "/api/services/bookings/holds", { serviceId: "svc-o", resourceId: "res-o", startAt: "2026-08-29T23:00:00.000Z", idempotencyKey: "hold-invariant-1" }, uid);
      await postJson(harness.baseUrl, `/api/services/bookings/holds/${hold.body.holdId}/confirm`, { idempotencyKey: "confirm-invariant-1" }, uid);
      const lockSnaps = await db.collection(`users/${uid}/scheduleLocks`).where("resourceId", "==", "res-o").get();
      const bySegment = new Map<string, Set<string>>();
      for (const lockDoc of lockSnaps.docs) {
        const data = lockDoc.data();
        const key = `${data.tenantUid}|${data.resourceId}|${data.segmentStartAt}`;
        if (!bySegment.has(key)) bySegment.set(key, new Set());
        bySegment.get(key)!.add(`${data.ownerType}:${data.ownerId}`);
      }
      for (const [segmentKey, owners] of bySegment) {
        assert.equal(owners.size, 1, `segmento ${segmentKey} não pode ter mais de um owner (capacity=1)`);
      }
    }

    console.log("Services booking command tests (HTTP + emulator) passed: valid hold creates hold+6 locks, same-slot concurrency (1 success/1 conflict), partial overlap conflict, boundary adjacency allowed, different resources same time allowed, expired hold segments reusable without waiting for physical TTL delete, confirm creates exactly 1 Booking + 1 zero-financial Work with no Payment (origin=booking, locks converted to booking ownership without expiresAt), confirm rejected when hold expired, confirm rejected when lock ownership was lost, concurrent confirms of the same hold converge to 1 Booking/1 Work, create-hold and confirm-hold are idempotent (stable replay), incompatible payload under the same idempotency key is rejected, a 10-way concurrent race for the same interval yields exactly 1 winner, and the final persisted state never has two owners on the same tenant+resource+segment (the central capacity=1 invariant).");

    // ====================================================================================================
    // SERV-BOOK-02 §31 — RELEASE HOLD (R1-R5).
    // ====================================================================================================

    // R1 — release válido libera TODOS os locks do hold e marca status=released.
    {
      const uid = tenantUid();
      await seedService(uid, "svc-r1");
      const hold = await postJson(harness.baseUrl, "/api/services/bookings/holds", { serviceId: "svc-r1", resourceId: "res-r1", startAt: "2026-08-30T09:00:00.000Z", idempotencyKey: "r1-hold" }, uid);
      assert.equal(hold.status, 200);
      const release = await postJson(harness.baseUrl, `/api/services/bookings/holds/${hold.body.holdId}/release`, { idempotencyKey: "r1-release" }, uid);
      assert.equal(release.status, 200, JSON.stringify(release.body));
      assert.equal(release.body.action, "release_hold");
      const lockSnaps = await db.collection(`users/${uid}/scheduleLocks`).where("ownerId", "==", hold.body.holdId).get();
      assert.equal(lockSnaps.size, 0, "R1: release deve liberar todos os locks do hold");
      const holdAfter = await db.doc(`users/${uid}/bookingHolds/${hold.body.holdId}`).get();
      assert.equal(holdAfter.data()?.status, "released");
      assert.equal(typeof holdAfter.data()?.releasedAt, "string");
    }

    // R2 — release repetido (key nova) é seguro, nunca um erro estrutural.
    {
      const uid = tenantUid();
      await seedService(uid, "svc-r2");
      const hold = await postJson(harness.baseUrl, "/api/services/bookings/holds", { serviceId: "svc-r2", resourceId: "res-r2", startAt: "2026-08-30T09:00:00.000Z", idempotencyKey: "r2-hold" }, uid);
      const first = await postJson(harness.baseUrl, `/api/services/bookings/holds/${hold.body.holdId}/release`, { idempotencyKey: "r2-release-1" }, uid);
      const second = await postJson(harness.baseUrl, `/api/services/bookings/holds/${hold.body.holdId}/release`, { idempotencyKey: "r2-release-2" }, uid);
      assert.equal(first.status, 200);
      assert.equal(second.status, 200, "R2: release repetido (key diferente) deve ser idempotente, não um erro");
    }

    // R3 — release de hold já confirmado NUNCA libera os locks do booking correspondente.
    {
      const uid = tenantUid();
      const booking = await seedConfirmedBooking(harness.baseUrl, uid, "svc-r3", "res-r3", "2026-08-30T09:00:00.000Z", "r3");
      const release = await postJson(harness.baseUrl, `/api/services/bookings/holds/${booking.holdId}/release`, { idempotencyKey: "r3-release" }, uid);
      assert.equal(release.status, 409);
      assert.equal(release.body?.code, "HOLD_ALREADY_CONFIRMED");
      const lockSnaps = await db.collection(`users/${uid}/scheduleLocks`).where("ownerId", "==", booking.bookingId).get();
      assert.equal(lockSnaps.size, 6, "R3: locks do booking devem permanecer intactos");
    }

    // R4 — release de hold logicamente expirado continua seguro e não deixa lock permanente.
    {
      const uid = tenantUid();
      await seedService(uid, "svc-r4");
      const hold = await postJson(harness.baseUrl, "/api/services/bookings/holds", { serviceId: "svc-r4", resourceId: "res-r4", startAt: "2026-08-30T09:00:00.000Z", idempotencyKey: "r4-hold" }, uid);
      await db.doc(`users/${uid}/bookingHolds/${hold.body.holdId}`).update({ expiresAt: "2020-01-01T00:00:00.000Z" });
      const release = await postJson(harness.baseUrl, `/api/services/bookings/holds/${hold.body.holdId}/release`, { idempotencyKey: "r4-release" }, uid);
      assert.equal(release.status, 200, "R4: release de hold expirado deve permanecer seguro");
      const lockSnaps = await db.collection(`users/${uid}/scheduleLocks`).where("ownerId", "==", hold.body.holdId).get();
      assert.equal(lockSnaps.size, 0);
    }

    // R5 — release vs confirm concorrentes: estado final coerente (nunca Booking sem locks, nunca lock órfão).
    {
      const uid = tenantUid();
      await seedService(uid, "svc-r5");
      const hold = await postJson(harness.baseUrl, "/api/services/bookings/holds", { serviceId: "svc-r5", resourceId: "res-r5", startAt: "2026-08-30T09:00:00.000Z", idempotencyKey: "r5-hold" }, uid);
      const [release, confirm] = await Promise.all([
        postJson(harness.baseUrl, `/api/services/bookings/holds/${hold.body.holdId}/release`, { idempotencyKey: "r5-release" }, uid),
        postJson(harness.baseUrl, `/api/services/bookings/holds/${hold.body.holdId}/confirm`, { idempotencyKey: "r5-confirm" }, uid),
      ]);
      const holdAfter = await db.doc(`users/${uid}/bookingHolds/${hold.body.holdId}`).get();
      const finalStatus = holdAfter.data()?.status;
      assert.ok(finalStatus === "released" || finalStatus === "confirmed", `R5: estado final deve ser released ou confirmed, obtido ${finalStatus}`);
      const lockSnaps = await db.collection(`users/${uid}/scheduleLocks`).where("resourceId", "==", "res-r5").get();
      if (finalStatus === "confirmed") {
        assert.equal(confirm.status, 200);
        assert.equal(lockSnaps.size, 6, "R5: confirm venceu — booking deve ter todos os locks");
        for (const l of lockSnaps.docs) assert.equal(l.data().ownerType, "booking");
      } else {
        assert.equal(release.status, 200);
        assert.equal(lockSnaps.size, 0, "R5: release venceu — nenhum lock deve sobrar");
      }
      await auditNoOverlapInvariant(db, uid, "res-r5");
    }

    // ====================================================================================================
    // SERV-BOOK-02 §32 — CANCEL BOOKING (C1-C7).
    // ====================================================================================================

    // C1 — cancel de Booking confirmado + Work planned => Booking cancelled + Work cancelled + 0 locks.
    {
      const uid = tenantUid();
      const booking = await seedConfirmedBooking(harness.baseUrl, uid, "svc-c1", "res-c1", "2026-08-30T10:00:00.000Z", "c1");
      const cancel = await postJson(harness.baseUrl, `/api/services/bookings/${booking.bookingId}/cancel`, { idempotencyKey: "c1-cancel" }, uid);
      assert.equal(cancel.status, 200, JSON.stringify(cancel.body));
      const bookingAfter = await db.doc(`users/${uid}/bookings/${booking.bookingId}`).get();
      assert.equal(bookingAfter.data()?.status, "cancelled");
      assert.equal(typeof bookingAfter.data()?.cancelledAt, "string");
      const workAfter = await db.doc(`users/${uid}/serviceWorks/${booking.workId}`).get();
      assert.equal(workAfter.data()?.status, "cancelled");
      const lockSnaps = await db.collection(`users/${uid}/scheduleLocks`).where("ownerId", "==", booking.bookingId).get();
      assert.equal(lockSnaps.size, 0);
    }

    // C2 — cancel idempotente: replay (mesma key) devolve o mesmo cancelledAt; key nova sobre já cancelado é segura e determinística.
    {
      const uid = tenantUid();
      const booking = await seedConfirmedBooking(harness.baseUrl, uid, "svc-c2", "res-c2", "2026-08-30T10:00:00.000Z", "c2");
      const first = await postJson(harness.baseUrl, `/api/services/bookings/${booking.bookingId}/cancel`, { idempotencyKey: "c2-cancel-1" }, uid);
      const retry = await postJson(harness.baseUrl, `/api/services/bookings/${booking.bookingId}/cancel`, { idempotencyKey: "c2-cancel-1" }, uid);
      assert.equal(first.status, 200);
      assert.equal(retry.status, 200);
      assert.equal(retry.body.cancelledAt, first.body.cancelledAt);
      const differentKey = await postJson(harness.baseUrl, `/api/services/bookings/${booking.bookingId}/cancel`, { idempotencyKey: "c2-cancel-2" }, uid);
      assert.equal(differentKey.status, 200, "C2: key nova sobre booking já cancelado deve ser determinística, não recriar nada");
      assert.equal(differentKey.body.cancelledAt, first.body.cancelledAt);
    }

    // C3/C4 — cancel NUNCA cria Refund e NUNCA altera os fatos financeiros já registrados (Payment/financialSummary).
    {
      const uid = tenantUid();
      const booking = await seedConfirmedBooking(harness.baseUrl, uid, "svc-c34", "res-c34", "2026-08-30T10:00:00.000Z", "c34");
      const payment = await recordServicePaymentCommand(db, uid, booking.workId, 5000, "pix", "c34-payment-key");
      const cancel = await postJson(harness.baseUrl, `/api/services/bookings/${booking.bookingId}/cancel`, { idempotencyKey: "c34-cancel" }, uid);
      assert.equal(cancel.status, 200, JSON.stringify(cancel.body));
      const paymentAfter = await db.doc(`users/${uid}/serviceWorks/${booking.workId}/payments/${payment.paymentId}`).get();
      assert.equal(paymentAfter.data()?.amountCents, 5000);
      assert.equal(paymentAfter.data()?.refundedTotalCents, 0, "C4: cancel não altera o fato de Payment");
      const refundsSnap = await db.collection(`users/${uid}/serviceWorks/${booking.workId}/payments/${payment.paymentId}/refunds`).get();
      assert.equal(refundsSnap.size, 0, "C3: cancel nunca cria Refund");
      const workAfter = await db.doc(`users/${uid}/serviceWorks/${booking.workId}`).get();
      assert.deepEqual(workAfter.data()?.financialSummary, { grossReceivedCents: 5000, refundedTotalCents: 0, netReceivedCents: 5000 }, "financialSummary preservado — cancel não mexe no domínio financeiro");
    }

    // C5 — cancel de Work in_progress é rejeitado (nunca cancelamento silencioso de serviço já iniciado).
    {
      const uid = tenantUid();
      const booking = await seedConfirmedBooking(harness.baseUrl, uid, "svc-c5", "res-c5", "2026-08-30T10:00:00.000Z", "c5");
      await db.doc(`users/${uid}/serviceWorks/${booking.workId}`).update({ status: "in_progress", startedAt: "2026-08-30T10:00:00.000Z", updatedAt: "2026-08-30T10:00:00.000Z" });
      const cancel = await postJson(harness.baseUrl, `/api/services/bookings/${booking.bookingId}/cancel`, { idempotencyKey: "c5-cancel" }, uid);
      assert.equal(cancel.status, 409);
      assert.equal(cancel.body?.code, "WORK_NOT_CANCELABLE");
    }

    // C6 — cancel de Work completed é rejeitado.
    {
      const uid = tenantUid();
      const booking = await seedConfirmedBooking(harness.baseUrl, uid, "svc-c6", "res-c6", "2026-08-30T10:00:00.000Z", "c6");
      await db.doc(`users/${uid}/serviceWorks/${booking.workId}`).update({ status: "completed", startedAt: "2026-08-30T10:00:00.000Z", completedAt: "2026-08-30T10:05:00.000Z", updatedAt: "2026-08-30T10:05:00.000Z" });
      const cancel = await postJson(harness.baseUrl, `/api/services/bookings/${booking.bookingId}/cancel`, { idempotencyKey: "c6-cancel" }, uid);
      assert.equal(cancel.status, 409);
      assert.equal(cancel.body?.code, "WORK_NOT_CANCELABLE");
    }

    // C7 — double cancel concorrente: 1 cancelamento lógico, sem erro estrutural, sem duplicar efeito.
    {
      const uid = tenantUid();
      const booking = await seedConfirmedBooking(harness.baseUrl, uid, "svc-c7", "res-c7", "2026-08-30T10:00:00.000Z", "c7");
      const [a, b] = await Promise.all([
        postJson(harness.baseUrl, `/api/services/bookings/${booking.bookingId}/cancel`, { idempotencyKey: "c7-cancel-a" }, uid),
        postJson(harness.baseUrl, `/api/services/bookings/${booking.bookingId}/cancel`, { idempotencyKey: "c7-cancel-b" }, uid),
      ]);
      assert.equal(a.status, 200);
      assert.equal(b.status, 200);
      const lockSnaps = await db.collection(`users/${uid}/scheduleLocks`).where("resourceId", "==", "res-c7").get();
      assert.equal(lockSnaps.size, 0, "C7: locks liberados exatamente uma vez, nunca efeito duplicado");
    }

    console.log("Services booking release/cancel tests (R1-R5, C1-C7) passed: hold release frees all locks and marks released, repeated release is idempotent, release of an already-confirmed hold is rejected and leaves booking locks untouched, release of an expired hold stays safe with zero leaked locks, release-vs-confirm race converges to one coherent final state, booking cancel produces cancelled Booking + cancelled Work + zero locks, cancel is idempotent (same key replay and a fresh key over an already-cancelled booking both return the existing cancelledAt without recreating anything), cancel never creates a Refund and never alters existing Payment facts or financialSummary, cancel of in_progress/completed Work is rejected (never a silent cancellation of already-executed work), and concurrent double-cancel never duplicates the effect.");

    // ====================================================================================================
    // SERV-BOOK-02 §33 — RESCHEDULE BOOKING (S1-S12) + §22-24 concorrência adicional.
    // ====================================================================================================

    // S1 — reagendamento simples: novo intervalo persistido, endAt recalculado, locks antigos liberados/novos adquiridos.
    {
      const uid = tenantUid();
      const booking = await seedConfirmedBooking(harness.baseUrl, uid, "svc-s1", "res-s1", "2026-08-30T10:00:00.000Z", "s1");
      const reschedule = await postJson(harness.baseUrl, `/api/services/bookings/${booking.bookingId}/reschedule`, { startAt: "2026-08-30T11:00:00.000Z", idempotencyKey: "s1-resched" }, uid);
      assert.equal(reschedule.status, 200, JSON.stringify(reschedule.body));
      assert.equal(reschedule.body.bookingId, booking.bookingId, "S1: bookingId preservado");
      assert.equal(reschedule.body.workId, booking.workId, "S1: workId preservado");
      assert.equal(reschedule.body.startAt, "2026-08-30T11:00:00.000Z");
      assert.equal(reschedule.body.endAt, "2026-08-30T11:30:00.000Z", "S1: endAt recalculado pelo servidor a partir do Service");
      const oldLocks = await db.collection(`users/${uid}/scheduleLocks`).where("resourceId", "==", "res-s1").where("segmentStartAt", "==", "2026-08-30T10:00:00.000Z").get();
      assert.equal(oldLocks.size, 0, "S1: segmento antigo totalmente liberado");
      const newLock = await db.doc(`users/${uid}/scheduleLocks/res-s1__2026-08-30T11-00-00-000Z`).get();
      assert.equal(newLock.data()?.ownerId, booking.bookingId);
      await auditNoOverlapInvariant(db, uid, "res-s1");
    }

    // S2 — self-overlap (§16 worked example): segmentos compartilhados com o próprio Booking nunca são conflito.
    {
      const uid = tenantUid();
      const booking = await seedConfirmedBooking(harness.baseUrl, uid, "svc-s2", "res-s2", "2026-08-30T10:00:00.000Z", "s2");
      const reschedule = await postJson(harness.baseUrl, `/api/services/bookings/${booking.bookingId}/reschedule`, { startAt: "2026-08-30T10:15:00.000Z", idempotencyKey: "s2-resched" }, uid);
      assert.equal(reschedule.status, 200, JSON.stringify(reschedule.body));
      const sharedLock = await db.doc(`users/${uid}/scheduleLocks/res-s2__2026-08-30T10-15-00-000Z`).get();
      assert.equal(sharedLock.data()?.ownerId, booking.bookingId, "S2: segmento compartilhado (10:15) mantido sob o mesmo booking");
      const releasedLock = await db.doc(`users/${uid}/scheduleLocks/res-s2__2026-08-30T10-00-00-000Z`).get();
      assert.equal(releasedLock.exists, false, "S2: segmento old-only (10:00) liberado");
      const acquiredLock = await db.doc(`users/${uid}/scheduleLocks/res-s2__2026-08-30T10-30-00-000Z`).get();
      assert.equal(acquiredLock.data()?.ownerId, booking.bookingId, "S2: segmento new-only (10:30) adquirido");
      await auditNoOverlapInvariant(db, uid, "res-s2");
    }

    // S3 — target ocupado por outro Booking: reject, horário antigo e locks antigos preservados (§18 all-or-nothing).
    {
      const uid = tenantUid();
      const bookingA = await seedConfirmedBooking(harness.baseUrl, uid, "svc-s3a", "res-s3", "2026-08-30T09:00:00.000Z", "s3a");
      const bookingB = await seedConfirmedBooking(harness.baseUrl, uid, "svc-s3b", "res-s3", "2026-08-30T11:00:00.000Z", "s3b");
      const reschedule = await postJson(harness.baseUrl, `/api/services/bookings/${bookingB.bookingId}/reschedule`, { startAt: "2026-08-30T09:00:00.000Z", idempotencyKey: "s3-resched" }, uid);
      assert.equal(reschedule.status, 409);
      assert.equal(reschedule.body?.code, "SEGMENT_UNAVAILABLE");
      const bookingBAfter = await db.doc(`users/${uid}/bookings/${bookingB.bookingId}`).get();
      assert.equal(bookingBAfter.data()?.startAt, "2026-08-30T11:00:00.000Z", "S3: horário antigo preservado após falha");
      const oldLocks = await db.collection(`users/${uid}/scheduleLocks`).where("ownerId", "==", bookingB.bookingId).get();
      assert.equal(oldLocks.size, 6, "S3: locks antigos nunca liberados antes de garantir o novo horário");
      void bookingA;
    }

    // S4 — target ocupado por Hold ativo de outro owner: reject.
    {
      const uid = tenantUid();
      const booking = await seedConfirmedBooking(harness.baseUrl, uid, "svc-s4", "res-s4", "2026-08-30T09:00:00.000Z", "s4");
      await seedService(uid, "svc-s4b");
      const activeHold = await postJson(harness.baseUrl, "/api/services/bookings/holds", { serviceId: "svc-s4b", resourceId: "res-s4", startAt: "2026-08-30T11:00:00.000Z", idempotencyKey: "s4-active-hold" }, uid);
      assert.equal(activeHold.status, 200);
      const reschedule = await postJson(harness.baseUrl, `/api/services/bookings/${booking.bookingId}/reschedule`, { startAt: "2026-08-30T11:00:00.000Z", idempotencyKey: "s4-resched" }, uid);
      assert.equal(reschedule.status, 409);
      assert.equal(reschedule.body?.code, "SEGMENT_UNAVAILABLE");
    }

    // S5 — target ocupado por Hold logicamente expirado: pode ser reaproveitado com sucesso.
    {
      const uid = tenantUid();
      const booking = await seedConfirmedBooking(harness.baseUrl, uid, "svc-s5", "res-s5", "2026-08-30T09:00:00.000Z", "s5");
      await seedService(uid, "svc-s5b");
      const expiredHold = await postJson(harness.baseUrl, "/api/services/bookings/holds", { serviceId: "svc-s5b", resourceId: "res-s5", startAt: "2026-08-30T11:00:00.000Z", idempotencyKey: "s5-active-hold" }, uid);
      assert.equal(expiredHold.status, 200);
      await db.doc(`users/${uid}/bookingHolds/${expiredHold.body.holdId}`).update({ expiresAt: "2020-01-01T00:00:00.000Z" });
      const staleLocks = await db.collection(`users/${uid}/scheduleLocks`).where("ownerId", "==", expiredHold.body.holdId).get();
      await Promise.all(staleLocks.docs.map((d) => d.ref.update({ expiresAt: "2020-01-01T00:00:00.000Z" })));
      const reschedule = await postJson(harness.baseUrl, `/api/services/bookings/${booking.bookingId}/reschedule`, { startAt: "2026-08-30T11:00:00.000Z", idempotencyKey: "s5-resched" }, uid);
      assert.equal(reschedule.status, 200, "S5: target ocupado só por hold expirado deve ser reaproveitável");
    }

    // S6 — boundary adjacency: novo início exatamente onde outro Booking termina é permitido.
    {
      const uid = tenantUid();
      const bookingOther = await seedConfirmedBooking(harness.baseUrl, uid, "svc-s6a", "res-s6", "2026-08-30T09:00:00.000Z", "s6a");
      const bookingMine = await seedConfirmedBooking(harness.baseUrl, uid, "svc-s6b", "res-s6", "2026-08-30T13:00:00.000Z", "s6b");
      const reschedule = await postJson(harness.baseUrl, `/api/services/bookings/${bookingMine.bookingId}/reschedule`, { startAt: bookingOther.endAt, idempotencyKey: "s6-resched" }, uid);
      assert.equal(reschedule.status, 200, "S6: início exatamente no fim do outro booking deve ser permitido");
    }

    // S7 — Booking já cancelado nunca é reagendável.
    {
      const uid = tenantUid();
      const booking = await seedConfirmedBooking(harness.baseUrl, uid, "svc-s7", "res-s7", "2026-08-30T10:00:00.000Z", "s7");
      await postJson(harness.baseUrl, `/api/services/bookings/${booking.bookingId}/cancel`, { idempotencyKey: "s7-cancel" }, uid);
      const reschedule = await postJson(harness.baseUrl, `/api/services/bookings/${booking.bookingId}/reschedule`, { startAt: "2026-08-30T12:00:00.000Z", idempotencyKey: "s7-resched" }, uid);
      assert.equal(reschedule.status, 409);
      assert.equal(reschedule.body?.code, "BOOKING_NOT_RESCHEDULABLE");
    }

    // S8 — Work in_progress: reject.
    {
      const uid = tenantUid();
      const booking = await seedConfirmedBooking(harness.baseUrl, uid, "svc-s8", "res-s8", "2026-08-30T10:00:00.000Z", "s8");
      await db.doc(`users/${uid}/serviceWorks/${booking.workId}`).update({ status: "in_progress", startedAt: "2026-08-30T10:00:00.000Z", updatedAt: "2026-08-30T10:00:00.000Z" });
      const reschedule = await postJson(harness.baseUrl, `/api/services/bookings/${booking.bookingId}/reschedule`, { startAt: "2026-08-30T12:00:00.000Z", idempotencyKey: "s8-resched" }, uid);
      assert.equal(reschedule.status, 409);
      assert.equal(reschedule.body?.code, "BOOKING_NOT_RESCHEDULABLE");
    }

    // S9 — Work completed: reject.
    {
      const uid = tenantUid();
      const booking = await seedConfirmedBooking(harness.baseUrl, uid, "svc-s9", "res-s9", "2026-08-30T10:00:00.000Z", "s9");
      await db.doc(`users/${uid}/serviceWorks/${booking.workId}`).update({ status: "completed", startedAt: "2026-08-30T10:00:00.000Z", completedAt: "2026-08-30T10:05:00.000Z", updatedAt: "2026-08-30T10:05:00.000Z" });
      const reschedule = await postJson(harness.baseUrl, `/api/services/bookings/${booking.bookingId}/reschedule`, { startAt: "2026-08-30T12:00:00.000Z", idempotencyKey: "s9-resched" }, uid);
      assert.equal(reschedule.status, 409);
      assert.equal(reschedule.body?.code, "BOOKING_NOT_RESCHEDULABLE");
    }

    // S10 — replay (mesma key + mesmo target) devolve exatamente o mesmo resultado, sem duplicar.
    {
      const uid = tenantUid();
      const booking = await seedConfirmedBooking(harness.baseUrl, uid, "svc-s10", "res-s10", "2026-08-30T10:00:00.000Z", "s10");
      const first = await postJson(harness.baseUrl, `/api/services/bookings/${booking.bookingId}/reschedule`, { startAt: "2026-08-30T14:00:00.000Z", idempotencyKey: "s10-resched" }, uid);
      const retry = await postJson(harness.baseUrl, `/api/services/bookings/${booking.bookingId}/reschedule`, { startAt: "2026-08-30T14:00:00.000Z", idempotencyKey: "s10-resched" }, uid);
      assert.equal(first.status, 200);
      assert.equal(retry.status, 200);
      assert.equal(retry.body.bookingId, first.body.bookingId);
      assert.equal(retry.body.workId, first.body.workId);
      assert.equal(retry.body.startAt, first.body.startAt);
      assert.equal(retry.body.endAt, first.body.endAt);
      assert.equal(retry.body.idempotentReplay, true, "S10: retry deve ser sinalizado como replay idempotente");
    }

    // S11 — mesma key + target diferente => IDEMPOTENCY_CONFLICT.
    {
      const uid = tenantUid();
      const booking = await seedConfirmedBooking(harness.baseUrl, uid, "svc-s11", "res-s11", "2026-08-30T10:00:00.000Z", "s11");
      const first = await postJson(harness.baseUrl, `/api/services/bookings/${booking.bookingId}/reschedule`, { startAt: "2026-08-30T15:00:00.000Z", idempotencyKey: "s11-resched" }, uid);
      assert.equal(first.status, 200);
      const different = await postJson(harness.baseUrl, `/api/services/bookings/${booking.bookingId}/reschedule`, { startAt: "2026-08-30T16:00:00.000Z", idempotencyKey: "s11-resched" }, uid);
      assert.equal(different.status, 409);
      assert.equal(different.body?.code, "IDEMPOTENCY_CONFLICT");
    }

    // S12 (§22) — 2 Bookings tentando reagendar para o mesmo target simultaneamente: success<=1, perdedor mantém slot original.
    {
      const uid = tenantUid();
      const bookingA = await seedConfirmedBooking(harness.baseUrl, uid, "svc-s12a", "res-s12", "2026-08-30T09:00:00.000Z", "s12a");
      const bookingB = await seedConfirmedBooking(harness.baseUrl, uid, "svc-s12b", "res-s12", "2026-08-30T11:00:00.000Z", "s12b");
      const [a, b] = await Promise.all([
        postJson(harness.baseUrl, `/api/services/bookings/${bookingA.bookingId}/reschedule`, { startAt: "2026-08-30T15:00:00.000Z", idempotencyKey: "s12-resched-a" }, uid),
        postJson(harness.baseUrl, `/api/services/bookings/${bookingB.bookingId}/reschedule`, { startAt: "2026-08-30T15:00:00.000Z", idempotencyKey: "s12-resched-b" }, uid),
      ]);
      const successCount = [a, b].filter((r) => r.status === 200).length;
      assert.ok(successCount <= 1, "S12: no máximo 1 sucesso para o mesmo target");
      if (a.status !== 200) {
        const doc = await db.doc(`users/${uid}/bookings/${bookingA.bookingId}`).get();
        assert.equal(doc.data()?.startAt, "2026-08-30T09:00:00.000Z", "S12: perdedor A mantém slot original integralmente");
      }
      if (b.status !== 200) {
        const doc = await db.doc(`users/${uid}/bookings/${bookingB.bookingId}`).get();
        assert.equal(doc.data()?.startAt, "2026-08-30T11:00:00.000Z", "S12: perdedor B mantém slot original integralmente");
      }
      await auditNoOverlapInvariant(db, uid, "res-s12");
    }

    // §23 — Hold vs reschedule para o mesmo target: exatamente um dos dois vence o segmento.
    {
      const uid = tenantUid();
      const booking = await seedConfirmedBooking(harness.baseUrl, uid, "svc-hvr", "res-hvr", "2026-08-30T09:00:00.000Z", "hvr");
      await seedService(uid, "svc-hvr2");
      const [reschedule, hold] = await Promise.all([
        postJson(harness.baseUrl, `/api/services/bookings/${booking.bookingId}/reschedule`, { startAt: "2026-08-30T17:00:00.000Z", idempotencyKey: "hvr-resched" }, uid),
        postJson(harness.baseUrl, "/api/services/bookings/holds", { serviceId: "svc-hvr2", resourceId: "res-hvr", startAt: "2026-08-30T17:00:00.000Z", idempotencyKey: "hvr-race-hold" }, uid),
      ]);
      const rescheduleWon = reschedule.status === 200;
      const holdWon = hold.status === 200;
      assert.notEqual(rescheduleWon, holdWon, "§23: exatamente um dos dois deve vencer o segmento 17:00 em res-hvr, nunca ambos ou nenhum");
      await auditNoOverlapInvariant(db, uid, "res-hvr");
    }

    // §24 — cancel vs reschedule concorrentes sobre o MESMO Booking: estado final único e coerente.
    {
      const uid = tenantUid();
      const booking = await seedConfirmedBooking(harness.baseUrl, uid, "svc-cvr", "res-cvr", "2026-08-30T09:00:00.000Z", "cvr");
      await Promise.all([
        postJson(harness.baseUrl, `/api/services/bookings/${booking.bookingId}/cancel`, { idempotencyKey: "cvr-cancel" }, uid),
        postJson(harness.baseUrl, `/api/services/bookings/${booking.bookingId}/reschedule`, { startAt: "2026-08-30T18:00:00.000Z", idempotencyKey: "cvr-resched" }, uid),
      ]);
      const bookingAfter = await db.doc(`users/${uid}/bookings/${booking.bookingId}`).get();
      const finalStatus = bookingAfter.data()?.status;
      const lockSnaps = await db.collection(`users/${uid}/scheduleLocks`).where("resourceId", "==", "res-cvr").get();
      if (finalStatus === "cancelled") {
        assert.equal(lockSnaps.size, 0, "§24: booking cancelled nunca pode ter locks em target");
      } else {
        assert.equal(finalStatus, "confirmed");
        assert.ok(lockSnaps.size > 0, "§24: booking ativo nunca pode ter zero locks");
      }
    }

    console.log("Services booking reschedule tests (S1-S12) + extra concurrency (§22-24) passed: simple move recalculates endAt from Service and migrates locks, self-overlap treats shared segments as never-conflicting (§16 worked example), target occupied by another Booking rejects with the old slot and its locks fully preserved (all-or-nothing), target occupied by an active Hold rejects, target occupied only by an expired Hold is reusable, boundary-adjacent reschedule is allowed, a cancelled Booking is never reschedulable, in_progress/completed Work reject reschedule, replay under the same key+target returns the identical result, the same key against a different target is an IDEMPOTENCY_CONFLICT, two Bookings racing for the same target yield at most 1 success with the loser's original slot fully intact, a concurrent Hold-vs-reschedule race for the same segment has exactly one winner, and a concurrent cancel-vs-reschedule race on the same Booking converges to one coherent final state (never cancelled-with-locks, never active-with-zero-locks) — all verified against the DUPLICATE_ACTIVE_SEGMENT_OWNERS=0 / ACTIVE_BOOKING_WITHOUT_COMPLETE_LOCK_SET=0 global invariant.");
  } finally {
    await harness.close();
  }
}

// ====================================================================================================
// §18/§24.15/§24.16 — Firestore Security Rules: autoridade é sempre o servidor; client nunca escreve
// Hold/Booking/Lock/Idempotency, mesmo padrão de script/services-security-tests.ts.
// ====================================================================================================
const PROJECT_ID = "demo-revendasmart";

type Context = { app: FirebaseApp; auth: Auth; db: Firestore; uid?: string };

function createContext(label: string): Context {
  const app = initializeApp(
    { apiKey: "demo-api-key", authDomain: `${PROJECT_ID}.firebaseapp.com`, projectId: PROJECT_ID, appId: `services-booking-${label}` },
    `services-booking-${label}-${Date.now()}-${Math.random()}`,
  );
  const auth = getAuth(app);
  const db = getFirestore(app);
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  return { app, auth, db };
}

async function signIn(context: Context, label: string) {
  const credential = await createUserWithEmailAndPassword(
    context.auth, `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`, "LocalTestPassword!123",
  );
  context.uid = credential.user.uid;
  return credential.user.uid;
}

async function expectFails(label: string, fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (error) {
    const code = (error as { code?: string }).code ?? "unknown";
    assert.notEqual(code, "unavailable", `${label}: emulador indisponível`);
    console.log(`PASS ${label} bloqueado com ${code}`);
    return;
  }
  throw new Error(`${label}: esperava bloqueio pelas rules`);
}

async function expectSucceeds(label: string, fn: () => Promise<unknown>) {
  try {
    await fn();
    console.log(`PASS ${label}`);
  } catch (error) {
    const code = (error as { code?: string }).code ?? "unknown";
    throw new Error(`${label}: esperava sucesso, recebeu ${code}`);
  }
}

async function runSecurityRulesTests() {
  const admin = initializeAdminApp({ projectId: PROJECT_ID }, `services-booking-admin-${Date.now()}`);
  const adminDb = getAdminFirestore(admin);

  const owner = createContext("owner");
  const other = createContext("other");
  try {
    const ownerUid = await signIn(owner, "owner");
    await signIn(other, "other");

    const holdId = "hold-sec-1";
    const bookingId = "booking-sec-1";
    const now = "2026-08-29T00:00:00.000Z";
    await adminDb.doc(`users/${ownerUid}/bookingHolds/${holdId}`).set({
      id: holdId, tenantUid: ownerUid, serviceId: "svc-sec", resourceId: "res-sec",
      startAt: now, endAt: "2026-08-29T00:30:00.000Z", status: "active",
      expiresAt: "2026-08-29T00:05:00.000Z", createdAt: now, idempotencyKey: "sec-idem-key-1",
    });
    await adminDb.doc(`users/${ownerUid}/bookings/${bookingId}`).set({
      id: bookingId, tenantUid: ownerUid, serviceId: "svc-sec", resourceId: "res-sec", workId: "work-sec",
      startAt: now, endAt: "2026-08-29T00:30:00.000Z", status: "confirmed", source: "manual", createdAt: now,
    });
    await adminDb.doc(`users/${ownerUid}/scheduleLocks/res-sec__2026-08-29T00-00-00-000Z`).set({
      tenantUid: ownerUid, resourceId: "res-sec", segmentStartAt: now, ownerType: "hold", ownerId: holdId, expiresAt: "2026-08-29T00:05:00.000Z",
    });
    await adminDb.doc(`users/${ownerUid}/serviceBookingCommandIdempotency/sec-idem-key-1`).set({
      key: "sec-idem-key-1", tenantUid: ownerUid, action: "create_hold", serviceId: "svc-sec", resourceId: "res-sec", startAt: now, holdId, createdAt: now,
    });

    // owner lê Hold/Booking normalmente.
    await expectSucceeds("owner lê BookingHold", () => getDoc(doc(owner.db, `users/${ownerUid}/bookingHolds/${holdId}`)));
    await expectSucceeds("owner lê Booking", () => getDoc(doc(owner.db, `users/${ownerUid}/bookings/${bookingId}`)));

    // tenant B nunca lê internals de tenant A.
    await expectFails("tenant B não lê BookingHold de outro tenant", () => getDoc(doc(other.db, `users/${ownerUid}/bookingHolds/${holdId}`)));
    await expectFails("tenant B não lê Booking de outro tenant", () => getDoc(doc(other.db, `users/${ownerUid}/bookings/${bookingId}`)));
    await expectFails("tenant B não lê ScheduleLock de outro tenant", () => getDoc(doc(other.db, `users/${ownerUid}/scheduleLocks/res-sec__2026-08-29T00-00-00-000Z`)));

    // client (mesmo dono) nunca cria/atualiza/apaga Hold diretamente.
    await expectFails("client não cria BookingHold", () => setDoc(doc(owner.db, `users/${ownerUid}/bookingHolds/hold-client-1`), {
      id: "hold-client-1", tenantUid: ownerUid, serviceId: "svc-sec", resourceId: "res-sec",
      startAt: now, endAt: "2026-08-29T00:30:00.000Z", status: "active", expiresAt: "2026-08-29T00:05:00.000Z", createdAt: now, idempotencyKey: "client-forged-key",
    }));
    await expectFails("client não atualiza BookingHold", () => updateDoc(doc(owner.db, `users/${ownerUid}/bookingHolds/${holdId}`), { status: "confirmed" }));
    await expectFails("client não deleta BookingHold", () => deleteDoc(doc(owner.db, `users/${ownerUid}/bookingHolds/${holdId}`)));

    // client nunca cria/atualiza/apaga Booking diretamente.
    await expectFails("client não cria Booking", () => setDoc(doc(owner.db, `users/${ownerUid}/bookings/booking-client-1`), {
      id: "booking-client-1", tenantUid: ownerUid, serviceId: "svc-sec", resourceId: "res-sec", workId: "work-forged",
      startAt: now, endAt: "2026-08-29T00:30:00.000Z", status: "confirmed", source: "manual", createdAt: now,
    }));
    await expectFails("client não atualiza Booking", () => updateDoc(doc(owner.db, `users/${ownerUid}/bookings/${bookingId}`), { status: "cancelled" }));
    await expectFails("client não deleta Booking", () => deleteDoc(doc(owner.db, `users/${ownerUid}/bookings/${bookingId}`)));

    // ScheduleLock: negado até para o próprio owner — internals nunca expostos ao client (§18/§9).
    await expectFails("client (mesmo owner) não lê ScheduleLock", () => getDoc(doc(owner.db, `users/${ownerUid}/scheduleLocks/res-sec__2026-08-29T00-00-00-000Z`)));
    await expectFails("client não cria ScheduleLock", () => setDoc(doc(owner.db, `users/${ownerUid}/scheduleLocks/res-sec__forged`), {
      tenantUid: ownerUid, resourceId: "res-sec", segmentStartAt: now, ownerType: "hold", ownerId: "hold-forged",
    }));
    await expectFails("client não atualiza ScheduleLock", () => updateDoc(doc(owner.db, `users/${ownerUid}/scheduleLocks/res-sec__2026-08-29T00-00-00-000Z`), { ownerId: "hold-hijack" }));
    await expectFails("client não deleta ScheduleLock", () => deleteDoc(doc(owner.db, `users/${ownerUid}/scheduleLocks/res-sec__2026-08-29T00-00-00-000Z`)));

    // idempotency collection invisível, mesmo para o próprio owner.
    await expectFails("idempotency collection invisível (read)", () => getDoc(doc(owner.db, `users/${ownerUid}/serviceBookingCommandIdempotency/sec-idem-key-1`)));
    await expectFails("client não escreve idempotency collection", () => setDoc(doc(owner.db, `users/${ownerUid}/serviceBookingCommandIdempotency/forged-key`), { key: "forged-key" }));

    console.log("Services booking security rules tests passed: owner reads BookingHold/Booking normally, cross-tenant read denied for BookingHold/Booking/ScheduleLock, client create/update/delete denied for BookingHold and Booking, ScheduleLock read/write denied even to the owning tenant (internals never exposed), serviceBookingCommandIdempotency read/write denied to the client.");
  } finally {
    await deleteApp(owner.app).catch(() => {});
    await deleteApp(other.app).catch(() => {});
    await deleteAdminApp(admin).catch(() => {});
  }
}

async function run() {
  runDomainTests();
  requireEmulatorEnv();
  initializeFirebaseAdmin();
  await runCommandTests();
  await runSecurityRulesTests();
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
