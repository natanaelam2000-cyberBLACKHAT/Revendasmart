import assert from "node:assert/strict";
import crypto from "node:crypto";
import express, { type Request, type Response, type NextFunction } from "express";
import { AddressInfo } from "node:net";
import { deleteApp, initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth, type Auth } from "firebase/auth";
import { connectFirestoreEmulator, doc, getDocs, updateDoc, collection, getFirestore, type Firestore as ClientFirestore } from "firebase/firestore";
import { initializeFirebaseAdmin } from "../server/firebase-admin-init";
import { registerPublicServiceBookingRoutes, resetPublicServiceBookingRateLimitsForTests } from "../server/service-public-booking";
import { upsertServiceResourceScheduleCommand } from "../server/service-availability-commands";
import { createServiceBookingHoldCommand, confirmServiceBookingHoldCommand, rescheduleServiceBookingCommand } from "../server/service-booking-commands";
import type { WeeklyHours } from "../shared/service-availability";

/**
 * SERV-PUBLIC-02 — MG1-40: token de gerenciamento público (geração/hash/persistência), leitura por token
 * (projeção mínima, sem vazamento de dado privado), cancelamento/reagendamento públicos (reaproveitando o
 * Booking Core sem nenhuma mudança de regra), concorrência real, e segurança (Firestore anônimo, cross-
 * tenant, token-of-A-cannot-touch-B). Mesmo padrão de harness HTTP de script/service-public-booking-tests.ts
 * (express + fetch), harness próprio aqui para manter os dois arquivos focados e independentes.
 */
process.env.FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || "demo-revendasmart";
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || "127.0.0.1:9099";

function requireEmulatorEnv() {
  assert.equal(process.env.FIREBASE_PROJECT_ID, "demo-revendasmart");
  assert.equal(process.env.FIRESTORE_EMULATOR_HOST, "127.0.0.1:8080");
  assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, "127.0.0.1:9099");
}

function tenantUid(prefix = "pub-mg"): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
function slugFor(uid: string): string {
  return `loja-${uid}`.slice(0, 60);
}
function futureDateAtSafeLocalTime(daysAhead: number, hour = 14, minute = 0): Date {
  const base = new Date(Date.now() + daysAhead * 24 * 60 * 60_000);
  return new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate(), hour, minute, 0, 0));
}
function allDayWeek(): WeeklyHours {
  const period = [{ start: "00:00", end: "23:45" }];
  return { sunday: period, monday: period, tuesday: period, wednesday: period, thursday: period, friday: period, saturday: period };
}
function omitUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => typeof v !== "undefined")) as T;
}
function validService(id: string, uid: string, overrides: Record<string, unknown> = {}) {
  return omitUndefined({
    id, tenantUid: uid, name: "Corte de cabelo", active: true, published: true,
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
async function seedStore(uid: string, slug: string, overrides: Record<string, unknown> = {}) {
  const db = initializeFirebaseAdmin().firestore();
  await db.doc(`user_settings/${uid}`).set({ slug, storeName: "Loja de Teste", ...overrides });
}

async function createServer() {
  const app = express();
  app.use(express.json());
  app.use((req: Request & { requestId?: string }, _res: Response, next: NextFunction) => {
    req.requestId = `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    next();
  });
  registerPublicServiceBookingRoutes(app);
  const server = await new Promise<import("node:http").Server>((resolve) => {
    const created = app.listen(0, () => resolve(created));
  });
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    async close() { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); },
  };
}
async function getJson(baseUrl: string, path: string) {
  const response = await fetch(`${baseUrl}${path}`);
  return { status: response.status, body: response.headers.get("content-type")?.includes("application/json") ? await response.json() : null };
}
async function postJson(baseUrl: string, path: string, body: unknown) {
  const response = await fetch(`${baseUrl}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: response.status, body: response.headers.get("content-type")?.includes("application/json") ? await response.json() : null };
}

/** Fluxo completo de criação pública até confirmação, devolvendo o manageToken + storeUid/slug/bookingId
 * para os testes de gerenciamento montarem em cima. */
async function seedConfirmedPublicBooking(
  harness: { baseUrl: string },
  db: FirebaseFirestore.Firestore,
  overrides: { hour?: number; daysAhead?: number } = {},
) {
  const uid = tenantUid();
  const slug = slugFor(uid);
  await seedStore(uid, slug);
  await seedService(uid, "svc", { durationMinutes: 30 });
  await upsertServiceResourceScheduleCommand(db, uid, "default", { timezone: "UTC", slotStepMinutes: 30, weeklyHours: allDayWeek() }, `sched-${uid}`);
  const slot = futureDateAtSafeLocalTime(overrides.daysAhead ?? 6, overrides.hour ?? 14, 0).toISOString();
  const hold = await postJson(harness.baseUrl, `/api/public/services/${slug}/bookings/holds`, { serviceId: "svc", startAt: slot, idempotencyKey: `hold-${uid}` });
  assert.equal(hold.status, 200, JSON.stringify(hold.body));
  const confirm = await postJson(harness.baseUrl, `/api/public/services/${slug}/bookings/holds/${hold.body.holdId}/confirm`, {
    customerName: "Cliente Teste", customerPhone: "+55 11 90000-0000", idempotencyKey: `confirm-${uid}`,
  });
  assert.equal(confirm.status, 200, JSON.stringify(confirm.body));
  assert.ok(confirm.body.manageToken, "seed: confirmação pública deve gerar manageToken");
  const bookingsSnap = await db.collection(`users/${uid}/bookings`).get();
  assert.equal(bookingsSnap.size, 1);
  return { uid, slug, token: confirm.body.manageToken as string, bookingId: bookingsSnap.docs[0].id, slot };
}

async function run() {
  requireEmulatorEnv();
  initializeFirebaseAdmin();
  resetPublicServiceBookingRateLimitsForTests();
  const db = initializeFirebaseAdmin().firestore();
  const harness = await createServer();

  try {
    // ===== MG1/MG2/MG3 — token forte gerado, plaintext nunca persistido, hash persistido =====
    {
      const { uid, bookingId, token } = await seedConfirmedPublicBooking(harness, db);
      assert.match(token, /^[A-Za-z0-9_-]{40,50}$/, "MG1: token URL-safe com entropia consistente com 32 bytes (base64url)");
      const bookingDoc = await db.doc(`users/${uid}/bookings/${bookingId}`).get();
      const raw = JSON.stringify(bookingDoc.data());
      assert.doesNotMatch(raw, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), "MG2: o token puro NUNCA aparece em nenhum campo do Booking persistido");
      const expectedHash = crypto.createHash("sha256").update(token).digest("hex");
      assert.equal(bookingDoc.data()?.publicManageTokenHash, expectedHash, "MG3: o hash sha256 do token é o valor persistido");
    }

    // ===== MG4 — replay da MESMA confirmação (mesma idempotencyKey) devolve o MESMO manageToken =====
    {
      const uid = tenantUid();
      const slug = slugFor(uid);
      await seedStore(uid, slug);
      await seedService(uid, "svc", { durationMinutes: 30 });
      await upsertServiceResourceScheduleCommand(db, uid, "default", { timezone: "UTC", slotStepMinutes: 30, weeklyHours: allDayWeek() }, `sched-${uid}`);
      const slot = futureDateAtSafeLocalTime(6, 14, 0).toISOString();
      const hold = await postJson(harness.baseUrl, `/api/public/services/${slug}/bookings/holds`, { serviceId: "svc", startAt: slot, idempotencyKey: `hold-${uid}` });
      const body = { customerName: "Ana", customerPhone: "119999999", idempotencyKey: `confirm-${uid}` };
      const first = await postJson(harness.baseUrl, `/api/public/services/${slug}/bookings/holds/${hold.body.holdId}/confirm`, body);
      const replay = await postJson(harness.baseUrl, `/api/public/services/${slug}/bookings/holds/${hold.body.holdId}/confirm`, body);
      assert.equal(first.status, 200);
      assert.equal(replay.status, 200);
      assert.equal(replay.body.manageToken, first.body.manageToken, "MG4: replay da mesma key devolve o MESMO manageToken");
    }

    // ===== MG5 — Booking interno (fluxo do dono) nunca recebe token público =====
    {
      const uid = tenantUid();
      await seedService(uid, "svc-internal", { durationMinutes: 30 });
      await upsertServiceResourceScheduleCommand(db, uid, "default", { timezone: "UTC", slotStepMinutes: 30, weeklyHours: allDayWeek() }, `sched-internal-${uid}`);
      const slot = futureDateAtSafeLocalTime(6, 14, 0).toISOString();
      const hold = await createServiceBookingHoldCommand(db, uid, "svc-internal", "default", slot, undefined, `internal-hold-${uid}`);
      assert.ok(!("conflict" in hold));
      const confirmed = await confirmServiceBookingHoldCommand(db, uid, (hold as { holdId: string }).holdId, `internal-confirm-${uid}`);
      assert.equal(typeof confirmed.publicManageToken, "undefined", "MG5: confirmação interna nunca gera manageToken");
      const bookingDoc = await db.doc(`users/${uid}/bookings/${confirmed.bookingId}`).get();
      assert.equal(typeof bookingDoc.data()?.publicManageTokenHash, "undefined", "MG5: Booking interno nunca recebe publicManageTokenHash");
    }

    // ===== MG6 — token inexistente: erro genérico =====
    {
      const uid = tenantUid();
      const slug = slugFor(uid);
      await seedStore(uid, slug);
      const response = await getJson(harness.baseUrl, `/api/public/services/${slug}/bookings/manage/${crypto.randomBytes(32).toString("base64url")}`);
      assert.equal(response.status, 404);
      assert.equal(response.body.code, "BOOKING_NOT_FOUND");
      assert.equal(response.body.message, "Não foi possível localizar este agendamento.");
    }

    // ===== MG7 — token válido de A usado com o slug de B: rejeitado (mesma mensagem genérica) =====
    {
      const { token } = await seedConfirmedPublicBooking(harness, db);
      const otherUid = tenantUid();
      const otherSlug = slugFor(otherUid);
      await seedStore(otherUid, otherSlug);
      const response = await getJson(harness.baseUrl, `/api/public/services/${otherSlug}/bookings/manage/${token}`);
      assert.equal(response.status, 404, "MG7: cross-tenant slug+token deve ser rejeitado como se o token não existisse");
      assert.equal(response.body.code, "BOOKING_NOT_FOUND");
    }

    // ===== MG8/MG9 — token só acessa o PRÓPRIO Booking, nunca outro do mesmo tenant =====
    {
      const uid = tenantUid();
      const slug = slugFor(uid);
      await seedStore(uid, slug);
      await seedService(uid, "svc-a", { name: "Serviço A", durationMinutes: 30 });
      await seedService(uid, "svc-b", { name: "Serviço B", durationMinutes: 30 });
      await upsertServiceResourceScheduleCommand(db, uid, "default", { timezone: "UTC", slotStepMinutes: 30, weeklyHours: allDayWeek() }, `sched-${uid}`);
      const slotA = futureDateAtSafeLocalTime(6, 14, 0).toISOString();
      const slotB = futureDateAtSafeLocalTime(6, 16, 0).toISOString();
      const holdA = await postJson(harness.baseUrl, `/api/public/services/${slug}/bookings/holds`, { serviceId: "svc-a", startAt: slotA, idempotencyKey: `a-${uid}` });
      const holdB = await postJson(harness.baseUrl, `/api/public/services/${slug}/bookings/holds`, { serviceId: "svc-b", startAt: slotB, idempotencyKey: `b-${uid}` });
      const confirmA = await postJson(harness.baseUrl, `/api/public/services/${slug}/bookings/holds/${holdA.body.holdId}/confirm`, { customerName: "A", customerPhone: "1", idempotencyKey: `ca-${uid}` });
      const confirmB = await postJson(harness.baseUrl, `/api/public/services/${slug}/bookings/holds/${holdB.body.holdId}/confirm`, { customerName: "B", customerPhone: "2", idempotencyKey: `cb-${uid}` });
      const readWithA = await getJson(harness.baseUrl, `/api/public/services/${slug}/bookings/manage/${confirmA.body.manageToken}`);
      assert.equal(readWithA.status, 200);
      assert.equal(readWithA.body.serviceName, "Serviço A", "MG8/MG9: token A só resolve o Booking A, nunca o B");
      const readWithB = await getJson(harness.baseUrl, `/api/public/services/${slug}/bookings/manage/${confirmB.body.manageToken}`);
      assert.equal(readWithB.body.serviceName, "Serviço B");
    }

    // ===== MG10-14 — a projeção pública NUNCA inclui campos privados =====
    {
      const { slug, token } = await seedConfirmedPublicBooking(harness, db);
      const response = await getJson(harness.baseUrl, `/api/public/services/${slug}/bookings/manage/${token}`);
      assert.equal(response.status, 200);
      const keys = Object.keys(response.body);
      for (const forbidden of ["tenantUid", "customerId", "workId", "resourceId", "financialSummary", "quoteId", "payments", "refunds", "publicManageTokenHash", "bookingId"]) {
        assert.ok(!keys.includes(forbidden), `MG10-14: a projeção pública nunca deve conter "${forbidden}"`);
      }
      assert.deepEqual(
        keys.sort(),
        ["canCancel", "canReschedule", "customerFirstName", "endAt", "serviceName", "startAt", "status", "storeName", "timezone"].sort(),
        "MG10-14: shape exato da projeção pública mínima",
      );
    }

    // ===== MG15-19 — cancelamento público =====
    {
      const { uid, slug, token, bookingId } = await seedConfirmedPublicBooking(harness, db);
      const bookingBefore = await db.doc(`users/${uid}/bookings/${bookingId}`).get();
      const workId = bookingBefore.data()?.workId as string;
      const lockSnapBefore = await db.collection(`users/${uid}/scheduleLocks`).where("ownerId", "==", bookingId).get();
      assert.ok(lockSnapBefore.size > 0, "seed: locks do Booking devem existir antes do cancelamento");

      const cancel = await postJson(harness.baseUrl, `/api/public/services/${slug}/bookings/manage/${token}/cancel`, { idempotencyKey: `cancel-${uid}` });
      assert.equal(cancel.status, 200, JSON.stringify(cancel.body));
      assert.equal(cancel.body.cancelled, true, "MG15: cancelamento público bem-sucedido");

      const lockSnapAfter = await db.collection(`users/${uid}/scheduleLocks`).where("ownerId", "==", bookingId).get();
      assert.equal(lockSnapAfter.size, 0, "MG16: locks liberados após o cancelamento");

      const workAfter = await db.doc(`users/${uid}/serviceWorks/${workId}`).get();
      assert.equal(workAfter.data()?.status, "cancelled", "MG17: Work cancelado consistentemente");

      const paymentsSnap = await db.collection(`users/${uid}/serviceWorks/${workId}/payments`).get();
      assert.equal(paymentsSnap.size, 0, "MG18: nenhum Refund/Payment criado pelo cancelamento público");

      const replayCancel = await postJson(harness.baseUrl, `/api/public/services/${slug}/bookings/manage/${token}/cancel`, { idempotencyKey: `cancel-replay-${uid}` });
      assert.equal(replayCancel.status, 200, "MG19: replay do cancelamento (key nova, Booking já cancelado) continua seguro");

      const rescheduleAfterCancel = await postJson(harness.baseUrl, `/api/public/services/${slug}/bookings/manage/${token}/reschedule`, { startAt: futureDateAtSafeLocalTime(7, 14, 0).toISOString(), idempotencyKey: `resched-after-cancel-${uid}` });
      assert.equal(rescheduleAfterCancel.status, 409, "MG20: Booking cancelado não pode ser reagendado");
      assert.equal(rescheduleAfterCancel.body.code, "BOOKING_NOT_RESCHEDULABLE");

      const readAfterCancel = await getJson(harness.baseUrl, `/api/public/services/${slug}/bookings/manage/${token}`);
      assert.equal(readAfterCancel.body.status, "cancelled", "§20: o token continua resolvendo o Booking só para mostrar 'cancelado'");
      assert.equal(readAfterCancel.body.canCancel, false);
      assert.equal(readAfterCancel.body.canReschedule, false);
    }

    // ===== MG21-26/MG29/MG30 — reagendamento público =====
    {
      const { uid, slug, token, bookingId } = await seedConfirmedPublicBooking(harness, db, { daysAhead: 8, hour: 10 });
      const before = await db.doc(`users/${uid}/bookings/${bookingId}`).get();
      const oldStartAt = before.data()?.startAt as string;

      const newSlot = futureDateAtSafeLocalTime(8, 12, 0).toISOString();
      const reschedule = await postJson(harness.baseUrl, `/api/public/services/${slug}/bookings/manage/${token}/reschedule`, { startAt: newSlot, idempotencyKey: `resched-${uid}` });
      assert.equal(reschedule.status, 200, JSON.stringify(reschedule.body));
      assert.equal(reschedule.body.startAt, newSlot, "MG21: reagendamento aplicado");

      const after = await db.doc(`users/${uid}/bookings/${bookingId}`).get();
      assert.equal(after.id, bookingId, "MG22: MESMO Booking id preservado (nunca cancel+create)");
      assert.equal(after.data()?.startAt, newSlot);

      const oldLock = await db.doc(`users/${uid}/scheduleLocks/default__${oldStartAt.replace(/[:.]/g, "-")}`).get();
      assert.equal(oldLock.exists, false, "MG23: lock do horário antigo liberado");
      const newLock = await db.doc(`users/${uid}/scheduleLocks/default__${newSlot.replace(/[:.]/g, "-")}`).get();
      assert.equal(newLock.exists, true, "MG24: lock do novo horário adquirido");

      // MG25/MG26 — alvo já ocupado é rejeitado, e o horário atual (agora newSlot) permanece intacto.
      const occupantUid = tenantUid();
      // Ocupa deliberadamente o MESMO slot que será tentado a seguir, usando outro Booking no mesmo recurso.
      const conflictSlot = futureDateAtSafeLocalTime(8, 15, 0).toISOString();
      await seedService(uid, "svc-conflict", { durationMinutes: 30 });
      const conflictHold = await postJson(harness.baseUrl, `/api/public/services/${slug}/bookings/holds`, { serviceId: "svc", startAt: conflictSlot, idempotencyKey: `conflict-hold-${occupantUid}` });
      await postJson(harness.baseUrl, `/api/public/services/${slug}/bookings/holds/${conflictHold.body.holdId}/confirm`, { customerName: "Outro", customerPhone: "2", idempotencyKey: `conflict-confirm-${occupantUid}` });

      const rejected = await postJson(harness.baseUrl, `/api/public/services/${slug}/bookings/manage/${token}/reschedule`, { startAt: conflictSlot, idempotencyKey: `resched-conflict-${uid}` });
      assert.equal(rejected.status, 409, "MG25: alvo ocupado é rejeitado");
      assert.equal(rejected.body.code, "SLOT_CONFLICT");

      const stillAtNewSlot = await db.doc(`users/${uid}/bookings/${bookingId}`).get();
      assert.equal(stillAtNewSlot.data()?.startAt, newSlot, "MG26: reagendamento falho preserva o horário anterior (o segundo, não o originalíssimo)");

      // MG29 — adjacência de boundary: reagendar para exatamente o fim do bloco ocupado (10:00, já usado
      // antes do primeiro reschedule) deve funcionar, já que [start,end) nunca conflita no boundary.
      const boundarySlot = futureDateAtSafeLocalTime(8, 10, 30).toISOString();
      const boundaryReschedule = await postJson(harness.baseUrl, `/api/public/services/${slug}/bookings/manage/${token}/reschedule`, { startAt: boundarySlot, idempotencyKey: `resched-boundary-${uid}` });
      assert.equal(boundaryReschedule.status, 200, `MG29: ${JSON.stringify(boundaryReschedule.body)}`);

      // MG30 — o token continua válido/resolvendo o mesmo Booking depois de reagendar.
      const readAfter = await getJson(harness.baseUrl, `/api/public/services/${slug}/bookings/manage/${token}`);
      assert.equal(readAfter.status, 200, "MG30: token continua válido após reagendamento");
      assert.equal(readAfter.body.startAt, boundarySlot);
    }

    // ===== MG27/MG28 — alvo com Hold ativo rejeitado; Hold expirado reutilizável =====
    {
      const { uid, slug, token } = await seedConfirmedPublicBooking(harness, db, { daysAhead: 9, hour: 9 });
      const targetSlot = futureDateAtSafeLocalTime(9, 11, 0).toISOString();
      const activeHold = await createServiceBookingHoldCommand(db, uid, "svc", "default", targetSlot, undefined, `active-hold-${uid}`);
      assert.ok(!("conflict" in activeHold));

      const rejectedByHold = await postJson(harness.baseUrl, `/api/public/services/${slug}/bookings/manage/${token}/reschedule`, { startAt: targetSlot, idempotencyKey: `resched-hold-${uid}` });
      assert.equal(rejectedByHold.status, 409, "MG27: alvo com Hold ativo de outro dono é rejeitado");
      assert.equal(rejectedByHold.body.code, "SLOT_CONFLICT");

      await db.doc(`users/${uid}/bookingHolds/${(activeHold as { holdId: string }).holdId}`).update({ expiresAt: "2020-01-01T00:00:00.000Z" });
      const lockSnaps = await db.collection(`users/${uid}/scheduleLocks`).where("ownerId", "==", (activeHold as { holdId: string }).holdId).get();
      await Promise.all(lockSnaps.docs.map((d) => d.ref.update({ expiresAt: "2020-01-01T00:00:00.000Z" })));
      const allowedAfterExpiry = await postJson(harness.baseUrl, `/api/public/services/${slug}/bookings/manage/${token}/reschedule`, { startAt: targetSlot, idempotencyKey: `resched-hold-expired-${uid}` });
      assert.equal(allowedAfterExpiry.status, 200, `MG28: ${JSON.stringify(allowedAfterExpiry.body)}`);
    }

    // ===== MG31 — dois Bookings DIFERENTES, cada um reagendando publicamente para o MESMO alvo, ao mesmo
    // tempo: no máximo 1 vence. (Reagendar o MESMO Booking duas vezes para o mesmo alvo concorrentemente não
    // testaria conflito real — a segunda tentativa, ao reler o estado já movido pela primeira, veria
    // acquiredSegments vazio e "sucederia" trivialmente por já estar lá; por isso dois Bookings distintos.) =====
    {
      const uid = tenantUid();
      const slug = slugFor(uid);
      await seedStore(uid, slug);
      await seedService(uid, "svc", { durationMinutes: 30 });
      await upsertServiceResourceScheduleCommand(db, uid, "default", { timezone: "UTC", slotStepMinutes: 30, weeklyHours: allDayWeek() }, `sched-${uid}`);
      const slot1 = futureDateAtSafeLocalTime(10, 9, 0).toISOString();
      const slot2 = futureDateAtSafeLocalTime(10, 11, 0).toISOString();
      const hold1 = await postJson(harness.baseUrl, `/api/public/services/${slug}/bookings/holds`, { serviceId: "svc", startAt: slot1, idempotencyKey: `h1-${uid}` });
      const hold2 = await postJson(harness.baseUrl, `/api/public/services/${slug}/bookings/holds`, { serviceId: "svc", startAt: slot2, idempotencyKey: `h2-${uid}` });
      const confirm1 = await postJson(harness.baseUrl, `/api/public/services/${slug}/bookings/holds/${hold1.body.holdId}/confirm`, { customerName: "1", customerPhone: "1", idempotencyKey: `c1-${uid}` });
      const confirm2 = await postJson(harness.baseUrl, `/api/public/services/${slug}/bookings/holds/${hold2.body.holdId}/confirm`, { customerName: "2", customerPhone: "2", idempotencyKey: `c2-${uid}` });

      const raceTarget = futureDateAtSafeLocalTime(10, 13, 0).toISOString();
      const [settledA, settledB] = await Promise.allSettled([
        postJson(harness.baseUrl, `/api/public/services/${slug}/bookings/manage/${confirm1.body.manageToken}/reschedule`, { startAt: raceTarget, idempotencyKey: "race-a" }),
        postJson(harness.baseUrl, `/api/public/services/${slug}/bookings/manage/${confirm2.body.manageToken}/reschedule`, { startAt: raceTarget, idempotencyKey: "race-b" }),
      ]);
      const results = [settledA, settledB].map((s) => (s.status === "fulfilled" ? s.value : null)).filter((v): v is NonNullable<typeof v> => v !== null);
      const winners = results.filter((r) => r.status === 200);
      const losers = results.filter((r) => r.status === 409);
      assert.equal(winners.length, 1, "MG31: exatamente um dos dois Bookings vence a corrida pelo mesmo alvo");
      assert.equal(losers.length, 1);
      assert.equal(losers[0].body.code, "SLOT_CONFLICT");
    }

    // ===== MG32 — cancelar vs reagendar simultâneos para o MESMO Booking: nunca estado híbrido =====
    {
      const { uid, slug, token, bookingId } = await seedConfirmedPublicBooking(harness, db, { daysAhead: 11, hour: 9 });
      const newTarget = futureDateAtSafeLocalTime(11, 15, 0).toISOString();
      const [cancelSettled, rescheduleSettled] = await Promise.allSettled([
        postJson(harness.baseUrl, `/api/public/services/${slug}/bookings/manage/${token}/cancel`, { idempotencyKey: "race-cancel" }),
        postJson(harness.baseUrl, `/api/public/services/${slug}/bookings/manage/${token}/reschedule`, { startAt: newTarget, idempotencyKey: "race-reschedule" }),
      ]);
      const cancelResult = cancelSettled.status === "fulfilled" ? cancelSettled.value : null;
      const rescheduleResult = rescheduleSettled.status === "fulfilled" ? rescheduleSettled.value : null;
      const finalBooking = await db.doc(`users/${uid}/bookings/${bookingId}`).get();
      const finalStatus = finalBooking.data()?.status;
      // MG32 — nunca um estado híbrido: ou terminou cancelled, ou terminou confirmed com um startAt válido
      // (o reschedule pode ter vencido antes do cancel, ou o cancel pode ter vencido e o reschedule então
      // rejeitado por BOOKING_NOT_RESCHEDULABLE — ambos são finais coerentes, nunca os dois aplicados "meio a meio").
      assert.ok(finalStatus === "cancelled" || finalStatus === "confirmed", "MG32: estado final sempre um dos dois válidos, nunca híbrido");
      if (finalStatus === "cancelled") {
        assert.ok(cancelResult?.status === 200, "MG32: se terminou cancelled, o cancel realmente teve sucesso");
      }
      void rescheduleResult;
    }

    // ===== MG33 — reagendamento público vs reagendamento do DONO (interno) para o mesmo Booking: seguro =====
    {
      const { uid, slug, token, bookingId } = await seedConfirmedPublicBooking(harness, db, { daysAhead: 12, hour: 9 });
      const publicTarget = futureDateAtSafeLocalTime(12, 15, 0).toISOString();
      const ownerTarget = futureDateAtSafeLocalTime(12, 17, 0).toISOString();
      const [publicSettled, ownerSettled] = await Promise.allSettled([
        postJson(harness.baseUrl, `/api/public/services/${slug}/bookings/manage/${token}/reschedule`, { startAt: publicTarget, idempotencyKey: "race-public-resched" }),
        rescheduleServiceBookingCommand(db, uid, bookingId, ownerTarget, "race-owner-resched"),
      ]);
      const finalBooking = await db.doc(`users/${uid}/bookings/${bookingId}`).get();
      const finalStartAt = finalBooking.data()?.startAt;
      assert.ok(finalStartAt === publicTarget || finalStartAt === ownerTarget, "MG33: o Booking termina EXATAMENTE num dos dois alvos, nunca um terceiro estado corrompido");
      void publicSettled;
      void ownerSettled;
    }

    // ===== MG34-37 — segurança: visitante anônimo não lê/escreve nenhuma coleção privada =====
    {
      const { uid } = await seedConfirmedPublicBooking(harness, db);
      const app = initializeApp({ apiKey: "demo-api-key", authDomain: "demo-revendasmart.firebaseapp.com", projectId: "demo-revendasmart", appId: "pub-mg-security-test" }, `pub-mg-security-${Date.now()}-${Math.random()}`);
      const auth: Auth = getAuth(app);
      const clientDb: ClientFirestore = getFirestore(app);
      connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
      connectFirestoreEmulator(clientDb, "127.0.0.1", 8080);
      try {
        await assert.rejects(getDocs(collection(clientDb, "users", uid, "bookings")), /permission-denied/i, "MG34: visitante anônimo não lista Bookings");
        await assert.rejects(getDocs(collection(clientDb, "users", uid, "serviceWorks")), /permission-denied/i, "MG35: visitante anônimo não lê Works");
        await assert.rejects(getDocs(collection(clientDb, "users", uid, "clients")), /permission-denied/i, "MG36: visitante anônimo não lê Clients");
        const bookingsSnap = await db.collection(`users/${uid}/bookings`).limit(1).get();
        const anyBookingId = bookingsSnap.docs[0].id;
        await assert.rejects(
          updateDoc(doc(clientDb, "users", uid, "bookings", anyBookingId), { publicManageTokenHash: "forged" }),
          /permission-denied/i,
          "MG37: visitante anônimo não escreve publicManageTokenHash (Bookings são create/update/delete:false)",
        );
      } finally {
        await deleteApp(app).catch(() => {});
      }
    }

    // ===== MG38 — token nunca aparece em nenhuma chamada de log do módulo público =====
    {
      const fs = await import("node:fs");
      const source = fs.readFileSync(new URL("../server/service-public-booking.ts", import.meta.url), "utf8");
      const logCalls = source.match(/log(Info|Warn|Error)\([^;]*?\);/gs) ?? [];
      for (const call of logCalls) {
        assert.doesNotMatch(call, /\btoken\b(?!Hash)|rawToken|manageToken|candidateToken/i, `MG38: nenhuma chamada de log deve referenciar o token puro — encontrado em: ${call.slice(0, 120)}`);
      }
    }

    // ===== MG39 — bookingId arbitrário sem token é inútil (nenhuma rota aceita bookingId como autoridade) =====
    {
      const fs = await import("node:fs");
      const source = fs.readFileSync(new URL("../server/service-public-booking.ts", import.meta.url), "utf8");
      assert.doesNotMatch(source, /req\.(params|body|query)\.bookingId/, "MG39: nenhuma rota pública lê bookingId do request — só :token");
    }

    // ===== MG40 — token da Booking A nunca consegue MUTAR a Booking B (mesmo tenant, tokens diferentes) =====
    {
      const uid = tenantUid();
      const slug = slugFor(uid);
      await seedStore(uid, slug);
      await seedService(uid, "svc", { durationMinutes: 30 });
      await upsertServiceResourceScheduleCommand(db, uid, "default", { timezone: "UTC", slotStepMinutes: 30, weeklyHours: allDayWeek() }, `sched-${uid}`);
      const slotA = futureDateAtSafeLocalTime(13, 9, 0).toISOString();
      const slotB = futureDateAtSafeLocalTime(13, 11, 0).toISOString();
      const holdA = await postJson(harness.baseUrl, `/api/public/services/${slug}/bookings/holds`, { serviceId: "svc", startAt: slotA, idempotencyKey: `a-${uid}` });
      const holdB = await postJson(harness.baseUrl, `/api/public/services/${slug}/bookings/holds`, { serviceId: "svc", startAt: slotB, idempotencyKey: `b-${uid}` });
      const confirmA = await postJson(harness.baseUrl, `/api/public/services/${slug}/bookings/holds/${holdA.body.holdId}/confirm`, { customerName: "A", customerPhone: "1", idempotencyKey: `ca-${uid}` });
      const confirmB = await postJson(harness.baseUrl, `/api/public/services/${slug}/bookings/holds/${holdB.body.holdId}/confirm`, { customerName: "B", customerPhone: "2", idempotencyKey: `cb-${uid}` });

      // Cancela usando o token de A — B precisa permanecer intacto.
      await postJson(harness.baseUrl, `/api/public/services/${slug}/bookings/manage/${confirmA.body.manageToken}/cancel`, { idempotencyKey: `cancel-a-${uid}` });
      const readB = await getJson(harness.baseUrl, `/api/public/services/${slug}/bookings/manage/${confirmB.body.manageToken}`);
      assert.equal(readB.body.status, "confirmed", "MG40: cancelar com o token de A nunca afeta o Booking B");
    }

    console.log("Public booking management tests passed: a 256-bit token is generated only on public confirm, never persisted in plaintext, only its sha256 hash is stored (MG1-3), same-key replay returns the identical token while internal (owner) confirmations never receive one (MG4-5), an unknown/cross-tenant token is rejected with the same generic not-found message (MG6-7), a token only ever resolves its own Booking within the tenant (MG8-9), the public projection contains none of the forbidden private fields with an exact minimal shape (MG10-14), public cancel reuses the real Booking Core with locks released, Work cancelled, zero Payment/Refund, safe replay, and blocks further reschedule (MG15-20), public reschedule preserves the same Booking id with old locks released/new locks acquired, rejects occupied/active-Hold targets while allowing expired-Hold and boundary-adjacent targets, never loses the prior slot on failure, and keeps the token valid afterward (MG21-30), true concurrent reschedules/cancel-vs-reschedule/public-vs-owner races all resolve to a single coherent final state (MG31-33), an anonymous Firestore session cannot read Bookings/Works/Clients or write the token hash (MG34-37), the token is never referenced in any log call, no route reads bookingId as an authority, and a token can never mutate a different Booking (MG38-40).");
  } finally {
    await harness.close();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
