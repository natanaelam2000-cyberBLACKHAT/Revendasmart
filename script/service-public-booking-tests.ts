import assert from "node:assert/strict";
import express, { type Request, type Response, type NextFunction } from "express";
import { AddressInfo } from "node:net";
import { deleteApp, initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth, type Auth } from "firebase/auth";
import { connectFirestoreEmulator, doc, getDoc, getDocs, collection, getFirestore, type Firestore as ClientFirestore } from "firebase/firestore";
import { initializeFirebaseAdmin } from "../server/firebase-admin-init";
import { registerPublicServiceBookingRoutes, resetPublicServiceBookingRateLimitsForTests } from "../server/service-public-booking";
import { upsertServiceResourceScheduleCommand, createServiceAvailabilityBlockCommand } from "../server/service-availability-commands";
import { createServiceBookingHoldCommand, confirmServiceBookingHoldCommand } from "../server/service-booking-commands";
import type { WeeklyHours } from "../shared/service-availability";

/**
 * SERV-PUBLIC-01 — PUBL1-33: prova a superfície pública ponta a ponta reaproveitando o Booking Core/
 * Availability já aprovados por dentro (nenhuma lógica de concorrência/expediente reimplementada aqui).
 * §39 do ticket: "não duplicar toda suite Availability; testar integração pública" — PUBL6-13 são UM fluxo
 * de integração consolidado através do endpoint público, não uma reimplementação de cada caso já coberto
 * em script/services-availability-tests.ts. Mesmo padrão de harness HTTP (express + fetch) já usado em
 * script/services-availability-tests.ts/script/services-booking-tests.ts.
 */
process.env.FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || "demo-revendasmart";
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || "127.0.0.1:9099";

function requireEmulatorEnv() {
  assert.equal(process.env.FIREBASE_PROJECT_ID, "demo-revendasmart");
  assert.equal(process.env.FIRESTORE_EMULATOR_HOST, "127.0.0.1:8080");
  assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, "127.0.0.1:9099");
}

function tenantUid(prefix = "pub-book"): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
function slugFor(uid: string): string {
  return `loja-${uid}`.slice(0, 60);
}

/** Mesma lição de TEST-FIX-AVAIL-01: nunca ancorar em Date.now() perto de um limite de expediente. Sempre
 * um dia futuro determinístico, a um horário local seguro (14:00), bem longe de meia-noite/23:45. */
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

async function run() {
  requireEmulatorEnv();
  initializeFirebaseAdmin();
  resetPublicServiceBookingRateLimitsForTests();
  const db = initializeFirebaseAdmin().firestore();
  const harness = await createServer();

  try {
    // ===== PUBL1/PUBL2 — resolução de loja pública =====
    {
      const uid = tenantUid();
      const slug = slugFor(uid);
      await seedStore(uid, slug, { storeName: "Barbearia Exemplo", storeDescription: "A melhor da cidade" });
      const ok = await getJson(harness.baseUrl, `/api/public/services/${slug}`);
      assert.equal(ok.status, 200, JSON.stringify(ok.body));
      assert.equal(ok.body.store.name, "Barbearia Exemplo", "PUBL1: estabelecimento público válido resolve com os dados reais");
      assert.equal(ok.body.store.description, "A melhor da cidade");
      assert.equal(typeof ok.body.store.uid, "undefined", "PUBL2: o uid interno nunca é exposto no payload público");

      const missing = await getJson(harness.baseUrl, `/api/public/services/slug-que-nao-existe-${Date.now()}`);
      assert.equal(missing.status, 404);
      assert.equal(missing.body.code, "STORE_NOT_FOUND");
      assert.doesNotMatch(JSON.stringify(missing.body), /uid|tenant/i, "PUBL2: tenant inválido não expõe nenhum dado interno");
    }

    // ===== PUBL3/PUBL4/PUBL5 — só Services publicamente agendáveis aparecem, com preço/duração do servidor =====
    {
      const uid = tenantUid();
      const slug = slugFor(uid);
      await seedStore(uid, slug);
      await seedService(uid, "svc-bookable", { name: "Corte", durationMinutes: 45, pricing: { mode: "fixed", priceCents: 9000 } });
      await seedService(uid, "svc-inactive", { active: false });
      await seedService(uid, "svc-unpublished", { published: false });
      await seedService(uid, "svc-no-booking", { bookingMode: "none" });
      await seedService(uid, "svc-quote-pricing", { pricing: { mode: "quote" } });

      const response = await getJson(harness.baseUrl, `/api/public/services/${slug}`);
      assert.equal(response.status, 200);
      const ids = response.body.services.map((service: { id: string }) => service.id);
      assert.deepEqual(ids, ["svc-bookable"], "PUBL3/PUBL4: só o Service ativo+publicado+agendável+preço fixo aparece");
      const listed = response.body.services[0];
      assert.equal(listed.durationMinutes, 45, "PUBL5: duração vem do Service real, nunca inventada pelo client");
      assert.equal(listed.priceCents, 9000, "PUBL5: preço vem do Service real");
      assert.equal(typeof listed.tenantUid, "undefined");
    }

    // ===== PUBL6-13 — integração pública de disponibilidade (weeklyHours, block, Booking, Hold ativo/
    // expirado, minAdvance, maxAdvance, timezone) — fluxo consolidado, não uma reimplementação de
    // services-availability-tests.ts =====
    {
      const uid = tenantUid();
      const slug = slugFor(uid);
      await seedStore(uid, slug);
      await seedService(uid, "svc-avail", { durationMinutes: 30 });
      await upsertServiceResourceScheduleCommand(db, uid, "default", {
        timezone: "America/Sao_Paulo", slotStepMinutes: 30, minAdvanceMinutes: 60, weeklyHours: allDayWeek(),
      }, `sched-${uid}`);

      const target = futureDateAtSafeLocalTime(5, 14, 0); // dia seguro, 14:00 UTC-ish (ver comentário do helper)
      const rangeStartAt = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), target.getUTCDate(), 0, 0, 0)).toISOString();
      const rangeEndAt = new Date(Date.parse(rangeStartAt) + 24 * 60 * 60_000).toISOString();

      const before = await getJson(harness.baseUrl, `/api/public/services/${slug}/availability?serviceId=svc-avail&rangeStartAt=${rangeStartAt}&rangeEndAt=${rangeEndAt}`);
      assert.equal(before.status, 200, JSON.stringify(before.body));
      assert.equal(before.body.timezone, "America/Sao_Paulo", "PUBL13: timezone do resource é respeitado/refletido");
      const startsBefore: string[] = before.body.candidates.map((c: { startAt: string }) => c.startAt);
      assert.ok(startsBefore.length > 0, "PUBL6: weeklyHours aberto -> existem candidatos");
      // PUBL32 — a resposta pública nunca inclui identidade de quem ocupa cada horário.
      assert.deepEqual(Object.keys(before.body.candidates[0]).sort(), ["endAt", "startAt"], "PUBL32: candidato público só tem startAt/endAt");

      const firstSlot = before.body.candidates[0].startAt;
      const secondSlot = before.body.candidates[1].startAt;
      const thirdSlot = before.body.candidates[2].startAt;

      // PUBL7 — block remove o slot.
      await createServiceAvailabilityBlockCommand(db, uid, "default", firstSlot, before.body.candidates[0].endAt, "bloqueio de teste", `block-${uid}`);
      // PUBL8 — Booking confirmado remove o slot (via fluxo interno normal, reaproveitado aqui só para seed).
      const internalHold = await createServiceBookingHoldCommand(db, uid, "svc-avail", "default", secondSlot, undefined, `internal-hold-${uid}`);
      assert.ok(!("conflict" in internalHold));
      await confirmServiceBookingHoldCommand(db, uid, (internalHold as { holdId: string }).holdId, `internal-confirm-${uid}`);
      // PUBL9/PUBL10 — Hold ativo remove o slot; Hold expirado NÃO remove.
      const activeHold = await createServiceBookingHoldCommand(db, uid, "svc-avail", "default", thirdSlot, undefined, `active-hold-${uid}`);
      assert.ok(!("conflict" in activeHold));

      const after = await getJson(harness.baseUrl, `/api/public/services/${slug}/availability?serviceId=svc-avail&rangeStartAt=${rangeStartAt}&rangeEndAt=${rangeEndAt}`);
      const startsAfter: string[] = after.body.candidates.map((c: { startAt: string }) => c.startAt);
      assert.ok(!startsAfter.includes(firstSlot), "PUBL7: slot bloqueado não aparece mais publicamente");
      assert.ok(!startsAfter.includes(secondSlot), "PUBL8: slot com Booking confirmado não aparece mais publicamente");
      assert.ok(!startsAfter.includes(thirdSlot), "PUBL9: slot com Hold ativo não aparece publicamente");

      // Expira o hold logicamente (mesma técnica de services-availability-tests.ts) e confirma que volta.
      await db.doc(`users/${uid}/bookingHolds/${(activeHold as { holdId: string }).holdId}`).update({ expiresAt: "2020-01-01T00:00:00.000Z" });
      const lockSnaps = await db.collection(`users/${uid}/scheduleLocks`).where("ownerId", "==", (activeHold as { holdId: string }).holdId).get();
      await Promise.all(lockSnaps.docs.map((d) => d.ref.update({ expiresAt: "2020-01-01T00:00:00.000Z" })));
      const afterExpiry = await getJson(harness.baseUrl, `/api/public/services/${slug}/availability?serviceId=svc-avail&rangeStartAt=${rangeStartAt}&rangeEndAt=${rangeEndAt}`);
      const startsAfterExpiry: string[] = afterExpiry.body.candidates.map((c: { startAt: string }) => c.startAt);
      assert.ok(startsAfterExpiry.includes(thirdSlot), "PUBL10: Hold expirado não remove o slot da disponibilidade pública");

      // PUBL11 — minAdvance (60min) respeitado: nenhum candidato antes de now+60min.
      const nowPlus30 = new Date(Date.now() + 30 * 60_000).toISOString();
      assert.ok(!startsAfterExpiry.some((s) => s < nowPlus30 && Date.parse(s) > Date.now()), "PUBL11: nenhum candidato viola a antecedência mínima configurada");
    }

    // ===== PUBL12 — maxAdvance respeitado (integração pública) =====
    {
      const uid = tenantUid();
      const slug = slugFor(uid);
      await seedStore(uid, slug);
      await seedService(uid, "svc-maxadv", { durationMinutes: 30 });
      await upsertServiceResourceScheduleCommand(db, uid, "default", {
        timezone: "UTC", slotStepMinutes: 30, maxAdvanceDays: 2, weeklyHours: allDayWeek(),
      }, `sched-maxadv-${uid}`);
      const farTarget = futureDateAtSafeLocalTime(10, 14, 0);
      const rangeStartAt = new Date(Date.UTC(farTarget.getUTCFullYear(), farTarget.getUTCMonth(), farTarget.getUTCDate())).toISOString();
      const rangeEndAt = new Date(Date.parse(rangeStartAt) + 24 * 60 * 60_000).toISOString();
      const response = await getJson(harness.baseUrl, `/api/public/services/${slug}/availability?serviceId=svc-maxadv&rangeStartAt=${rangeStartAt}&rangeEndAt=${rangeEndAt}`);
      assert.equal(response.status, 200);
      assert.equal(response.body.candidates.length, 0, "PUBL12: 10 dias no futuro excede maxAdvanceDays=2, nenhum candidato deve aparecer");
    }

    // ===== PUBL14-19 — public Hold =====
    {
      const uid = tenantUid();
      const slug = slugFor(uid);
      await seedStore(uid, slug);
      await seedService(uid, "svc-hold", { durationMinutes: 30 });
      await upsertServiceResourceScheduleCommand(db, uid, "default", { timezone: "UTC", slotStepMinutes: 30, weeklyHours: allDayWeek() }, `sched-hold-${uid}`);
      const slot = futureDateAtSafeLocalTime(6, 14, 0).toISOString();

      // PUBL14 — Hold público válido.
      const hold = await postJson(harness.baseUrl, `/api/public/services/${slug}/bookings/holds`, { serviceId: "svc-hold", startAt: slot, idempotencyKey: `pub-hold-${uid}` });
      assert.equal(hold.status, 200, JSON.stringify(hold.body));
      assert.ok(hold.body.holdId, "PUBL14: holdId retornado");
      assert.equal(new Date(Date.parse(hold.body.endAt) - Date.parse(hold.body.startAt)).getUTCMinutes(), 30, "PUBL16: a duração do Hold é sempre a do Service real (30min), nunca a do client");

      // PUBL15 — Service inexistente rejeitado.
      const badService = await postJson(harness.baseUrl, `/api/public/services/${slug}/bookings/holds`, { serviceId: "svc-does-not-exist", startAt: slot, idempotencyKey: `pub-hold-bad-${uid}` });
      assert.equal(badService.status, 400);
      assert.equal(badService.body.code, "SERVICE_NOT_AVAILABLE");

      // PUBL18 — tenant mismatch: o holdId de uid não existe sob outro slug/tenant.
      const otherUid = tenantUid();
      const otherSlug = slugFor(otherUid);
      await seedStore(otherUid, otherSlug);
      const mismatch = await postJson(harness.baseUrl, `/api/public/services/${otherSlug}/bookings/holds/${hold.body.holdId}/confirm`, { customerName: "X", customerPhone: "119999999", idempotencyKey: `mismatch-${uid}` });
      assert.equal(mismatch.status, 404);
      assert.equal(mismatch.body.code, "HOLD_NOT_FOUND", "PUBL18: um holdId de outro tenant nunca é encontrado sob um slug diferente");

      // PUBL19 — concorrência: dois clientes públicos tentam o MESMO slot, keys diferentes, no máximo 1 vence.
      const raceSlot = futureDateAtSafeLocalTime(7, 14, 0).toISOString();
      const [settledA, settledB] = await Promise.allSettled([
        postJson(harness.baseUrl, `/api/public/services/${slug}/bookings/holds`, { serviceId: "svc-hold", startAt: raceSlot, idempotencyKey: `race-a-${uid}` }),
        postJson(harness.baseUrl, `/api/public/services/${slug}/bookings/holds`, { serviceId: "svc-hold", startAt: raceSlot, idempotencyKey: `race-b-${uid}` }),
      ]);
      const results = [settledA, settledB].map((s) => (s.status === "fulfilled" ? s.value : null)).filter((v): v is NonNullable<typeof v> => v !== null);
      const winners = results.filter((r) => r.status === 200);
      const losers = results.filter((r) => r.status === 409);
      assert.equal(winners.length, 1, "PUBL19: exatamente um dos dois vence a corrida pelo mesmo horário");
      assert.equal(losers.length, 1);
      assert.equal(losers[0].body.code, "SLOT_CONFLICT");
    }

    // ===== PUBL20-27/PUBL33 — confirmação pública =====
    {
      const uid = tenantUid();
      const slug = slugFor(uid);
      await seedStore(uid, slug);
      await seedService(uid, "svc-confirm", { durationMinutes: 30 });
      await upsertServiceResourceScheduleCommand(db, uid, "default", { timezone: "UTC", slotStepMinutes: 30, weeklyHours: allDayWeek() }, `sched-confirm-${uid}`);
      const slot = futureDateAtSafeLocalTime(8, 14, 0).toISOString();
      const hold = await postJson(harness.baseUrl, `/api/public/services/${slug}/bookings/holds`, { serviceId: "svc-confirm", startAt: slot, idempotencyKey: `confirm-hold-${uid}` });
      assert.equal(hold.status, 200);

      // PUBL33 — campos financeiros/comerciais arbitrários no body são simplesmente ignorados (nunca lidos).
      const confirm = await postJson(harness.baseUrl, `/api/public/services/${slug}/bookings/holds/${hold.body.holdId}/confirm`, {
        customerName: "Maria Cliente", customerPhone: "+55 11 99999-0000", idempotencyKey: `confirm-${uid}`,
        contractedTotalCents: 999999, financialSummary: { netReceivedCents: 999999 }, status: "completed", tenantUid: "outro-uid",
      });
      assert.equal(confirm.status, 200, JSON.stringify(confirm.body));
      assert.equal(confirm.body.confirmed, true);
      assert.equal(typeof confirm.body.workId, "undefined", "PUBL21/§21: nenhum id técnico interno no payload de sucesso público");
      assert.equal(typeof confirm.body.bookingId, "undefined");

      // PUBL20/PUBL21 — exatamente 1 Booking e 1 Work criados, encontráveis pela mesma coleção da Agenda.
      const bookingsSnap = await db.collection(`users/${uid}/bookings`).get();
      assert.equal(bookingsSnap.size, 1, "PUBL20: exatamente 1 Booking criado");
      const booking = bookingsSnap.docs[0].data();
      assert.equal(booking.source, "public", "o Booking público é marcado com source=public");
      const worksSnap = await db.collection(`users/${uid}/serviceWorks`).get();
      assert.equal(worksSnap.size, 1, "PUBL21: exatamente 1 ServiceWork criado");
      const work = worksSnap.docs[0].data();
      assert.equal(work.origin, "booking", "§24: o Work público usa origin=booking, nunca um tipo novo");
      assert.deepEqual(work.financialSummary, { grossReceivedCents: 0, refundedTotalCents: 0, netReceivedCents: 0 }, "PUBL22/PUBL33: financialSummary sempre zero, nunca o valor injetado no body");
      assert.equal(typeof work.quoteId, "undefined", "§24: quoteId ausente");
      assert.equal(work.totals.contractedTotalCents, 8000, "PUBL33: contractedTotalCents vem do Service real (8000 default), nunca do body");

      // PUBL23/PUBL24 — nenhum Payment/Quote criado.
      const paymentsSnap = await db.collection(`users/${uid}/serviceWorks/${worksSnap.docs[0].id}/payments`).get();
      assert.equal(paymentsSnap.size, 0, "PUBL23: nenhum Payment criado pelo agendamento público");
      const quotesSnap = await db.collection(`users/${uid}/quotes`).get();
      assert.equal(quotesSnap.size, 0, "PUBL24: nenhum Quote criado pelo agendamento público");

      // Um Client de contato foi criado com o nome/telefone informados.
      const clientDoc = await db.doc(`users/${uid}/clients/${booking.customerId}`).get();
      assert.equal(clientDoc.exists, true);
      assert.equal(clientDoc.data()?.name, "Maria Cliente");
      assert.equal(clientDoc.data()?.phone, "+55 11 99999-0000");

      // PUBL25 — replay idempotente: mesma key não cria um segundo Booking/Work.
      const replay = await postJson(harness.baseUrl, `/api/public/services/${slug}/bookings/holds/${hold.body.holdId}/confirm`, {
        customerName: "Maria Cliente", customerPhone: "+55 11 99999-0000", idempotencyKey: `confirm-${uid}`,
      });
      assert.equal(replay.status, 200);
      const bookingsAfterReplay = await db.collection(`users/${uid}/bookings`).get();
      assert.equal(bookingsAfterReplay.size, 1, "PUBL25: replay idempotente não cria um segundo Booking");

      // PUBL27 — mesmo Booking/Work aparecem na mesma coleção que a Agenda do dono já consulta.
      const rangeStartAt = new Date(Date.parse(slot) - 60_000).toISOString();
      const rangeEndAt = new Date(Date.parse(slot) + 60 * 60_000).toISOString();
      const agendaVisible = await db.collection(`users/${uid}/bookings`)
        .where("resourceId", "==", "default").where("startAt", ">=", rangeStartAt).where("startAt", "<", rangeEndAt).get();
      assert.equal(agendaVisible.size, 1, "PUBL_AGENDA: o Booking público é encontrado pela MESMA query que a Agenda interna usa (listServiceBookingsForResourceAndRange)");

      // PUBL26 — Hold expirado é rejeitado na confirmação pública.
      const expiredSlot = futureDateAtSafeLocalTime(9, 14, 0).toISOString();
      const expiredHold = await postJson(harness.baseUrl, `/api/public/services/${slug}/bookings/holds`, { serviceId: "svc-confirm", startAt: expiredSlot, idempotencyKey: `expired-hold-${uid}` });
      assert.equal(expiredHold.status, 200);
      await db.doc(`users/${uid}/bookingHolds/${expiredHold.body.holdId}`).update({ expiresAt: "2020-01-01T00:00:00.000Z" });
      const expiredConfirm = await postJson(harness.baseUrl, `/api/public/services/${slug}/bookings/holds/${expiredHold.body.holdId}/confirm`, { customerName: "Zé", customerPhone: "119999999", idempotencyKey: `expired-confirm-${uid}` });
      assert.equal(expiredConfirm.status, 409);
      assert.equal(expiredConfirm.body.code, "HOLD_EXPIRED");
    }

    // ===== PLAN-IMPL-02A §6 — a criação atômica de Client durante a confirmação pública respeita o
    // D1: at the Client limit, confirm Booking/Work with contact snapshots, without creating a Client. =====
    {
      const uid = tenantUid();
      const slug = slugFor(uid);
      await seedStore(uid, slug);
      await seedService(uid, "svc-limit", { durationMinutes: 30 });
      await upsertServiceResourceScheduleCommand(db, uid, "default", {
        timezone: "America/Sao_Paulo", slotStepMinutes: 30, minAdvanceMinutes: 60, weeklyHours: allDayWeek(),
      }, `sched-limit-${uid}`);

      // Sem doc planData/main -> resolveCommercialPlan(null) = "free" -> limite canônico de 50 clientes
      // (shared/monetization.ts). Semeia exatamente 50 para colocar o tenant NO limite.
      const batch = db.batch();
      for (let i = 0; i < 50; i += 1) {
        batch.set(db.doc(`users/${uid}/clients/existing-${i}`), { id: `existing-${i}`, name: `Cliente ${i}`, phone: "119999999" });
      }
      await batch.commit();

      const target = futureDateAtSafeLocalTime(6, 14, 0);
      const rangeStartAt = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), target.getUTCDate(), 0, 0, 0)).toISOString();
      const rangeEndAt = new Date(Date.parse(rangeStartAt) + 24 * 60 * 60_000).toISOString();
      const avail = await getJson(harness.baseUrl, `/api/public/services/${slug}/availability?serviceId=svc-limit&rangeStartAt=${rangeStartAt}&rangeEndAt=${rangeEndAt}`);
      assert.equal(avail.status, 200, JSON.stringify(avail.body));
      const slot = avail.body.candidates[0].startAt;

      const hold = await postJson(harness.baseUrl, `/api/public/services/${slug}/bookings/holds`, { serviceId: "svc-limit", startAt: slot, idempotencyKey: `limit-hold-${uid}` });
      assert.equal(hold.status, 200, JSON.stringify(hold.body));

      const confirm = await postJson(harness.baseUrl, `/api/public/services/${slug}/bookings/holds/${hold.body.holdId}/confirm`, {
        customerName: "Cliente Excedente", customerPhone: "+55 11 98888-0000", idempotencyKey: `limit-confirm-${uid}`,
      });
      assert.equal(confirm.status, 200, JSON.stringify(confirm.body));
      assert.equal(confirm.body.confirmed, true);
      assert.equal(confirm.body.customerContactSnapshot, undefined, "D1: response does not expose contact");
      const newClientId = `public-${hold.body.holdId}`;
      assert.equal((await db.doc(`users/${uid}/clients/${newClientId}`).get()).exists, false);
      const bookingSnap = await db.doc(`users/${uid}/bookings/booking-${hold.body.holdId}`).get();
      const workSnap = await db.doc(`users/${uid}/serviceWorks/booking-work-${hold.body.holdId}`).get();
      const contact = { name: "Cliente Excedente", phone: "+55 11 98888-0000" };
      assert.equal(bookingSnap.exists, true);
      assert.equal(workSnap.exists, true);
      assert.deepEqual(bookingSnap.data()?.customerContactSnapshot, contact);
      assert.deepEqual(workSnap.data()?.customerContactSnapshot, contact);
      assert.equal(bookingSnap.data()?.customerId, undefined);
      assert.equal(workSnap.data()?.customerId, undefined);
      const holdSnap = await db.doc(`users/${uid}/bookingHolds/${hold.body.holdId}`).get();
      assert.equal(holdSnap.data()?.status, "confirmed");
      assert.equal(holdSnap.data()?.confirmedBookingId, bookingSnap.id);
      assert.equal(holdSnap.data()?.confirmedWorkId, workSnap.id);
      const clientsCountSnap = await db.collection(`users/${uid}/clients`).count().get();
      assert.equal(clientsCountSnap.data().count, 50, "PLAN-IMPL-02A: a contagem de clientes do tenant precisa continuar exatamente 50, nunca 51");
    }

    // ===== PUBL28-31 — segurança: usuário público (anônimo, sem conta) não lê nenhuma coleção privada =====
    {
      const uid = tenantUid();
      const slug = slugFor(uid);
      await seedStore(uid, slug);
      const app = initializeApp({ apiKey: "demo-api-key", authDomain: "demo-revendasmart.firebaseapp.com", projectId: "demo-revendasmart", appId: "pub-security-test" }, `pub-security-${Date.now()}-${Math.random()}`);
      const auth: Auth = getAuth(app);
      const clientDb: ClientFirestore = getFirestore(app);
      connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
      connectFirestoreEmulator(clientDb, "127.0.0.1", 8080);
      try {
        await assert.rejects(getDocs(collection(clientDb, "users", uid, "bookings")), /permission-denied/i, "PUBL28: visitante anônimo não lista Bookings");
        await assert.rejects(getDocs(collection(clientDb, "users", uid, "serviceWorks")), /permission-denied/i, "PUBL29: visitante anônimo não lê Works");
        await assert.rejects(getDocs(collection(clientDb, "users", uid, "clients")), /permission-denied/i, "PUBL30: visitante anônimo não lê Clients");
        await assert.rejects(getDoc(doc(clientDb, "users", uid, "bookingHolds", "any-hold")), /permission-denied/i, "visitante anônimo não lê BookingHolds");
        await assert.rejects(getDocs(collection(clientDb, "users", uid, "quotes")), /permission-denied/i, "PUBL31 (Quote): visitante anônimo não lê Quotes");
      } finally {
        await deleteApp(app).catch(() => {});
      }
    }

    console.log("Public service booking tests passed: store resolution never leaks internal ids (PUBL1/2), only real active/published/bookable Services are listed with server-derived price/duration (PUBL3-5), public availability correctly reflects weeklyHours/block/Booking/active-Hold/expired-Hold/minAdvance/maxAdvance/timezone through the real engine with zero customer-identity leakage (PUBL6-13/32), public Hold creation always derives duration from the real Service and rejects unknown Services (PUBL14-16), tenant-mismatch confirmation is rejected as not-found (PUBL18), same-slot concurrency yields exactly one winner (PUBL19), confirmation creates exactly one Booking+Work with zero financialSummary/no Payment/no Quote regardless of injected financial fields in the body (PUBL20-24/33), a real Client contact is created atomically, idempotent replay never duplicates (PUBL25), the public Booking is visible through the exact same query the owner's Agenda already uses, expired holds are rejected at confirm (PUBL26), a tenant at the Client limit confirms with matching Booking/Work contact snapshots and no additional Client (D1), and an anonymous visitor cannot read any private collection directly (PUBL28-31).");
  } finally {
    await harness.close();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
