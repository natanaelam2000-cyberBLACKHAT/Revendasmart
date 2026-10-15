import assert from "node:assert/strict";
import express, { type Request, type Response, type NextFunction } from "express";
import { AddressInfo } from "node:net";
import { deleteApp, initializeApp, type FirebaseApp } from "firebase/app";
import { connectAuthEmulator, createUserWithEmailAndPassword, getAuth, type Auth } from "firebase/auth";
import { deleteApp as deleteAdminApp, initializeApp as initializeAdminApp } from "firebase-admin/app";
import { getFirestore as getAdminFirestore } from "firebase-admin/firestore";
import { connectFirestoreEmulator, deleteDoc, doc, getDoc, getFirestore, setDoc, updateDoc, type Firestore } from "firebase/firestore";
import { initializeFirebaseAdmin } from "../server/firebase-admin-init";
import { registerServiceBookingRoutes } from "../server/service-booking-commands";
import { registerServiceAvailabilityRoutes } from "../server/service-availability-commands";
import {
  assertValidAdvanceWindow,
  assertValidAvailabilityQueryRange,
  assertValidSlotStepMinutes,
  assertValidTimezone,
  assertValidWeeklyHours,
  generateCandidateStartMinutes,
  intervalsOverlap,
  isIntervalWithinPeriods,
  parseTimeToMinutes,
  ServiceAvailabilityDomainError,
  type WeeklyHours,
} from "../shared/service-availability";

process.env.FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || "demo-revendasmart";
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || "127.0.0.1:9099";

function requireEmulatorEnv() {
  assert.equal(process.env.FIREBASE_PROJECT_ID, "demo-revendasmart");
  assert.equal(process.env.FIRESTORE_EMULATOR_HOST, "127.0.0.1:8080");
  assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, "127.0.0.1:9099");
}

function tenantUid(prefix = "services-availability"): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function closedWeek(): WeeklyHours {
  return { sunday: [], monday: [], tuesday: [], wednesday: [], thursday: [], friday: [], saturday: [] };
}
/** Agenda auxiliar para testes que não dependem de dia da semana específico (advance windows, slot step). */
function allDayWeek(): WeeklyHours {
  const period = [{ start: "00:00", end: "23:45" }];
  return { sunday: period, monday: period, tuesday: period, wednesday: period, thursday: period, friday: period, saturday: period };
}

// ====================================================================================================
// §31/§32 (parte pura, sem emulador) — expediente semanal, slot step/duração, range de consulta.
// ====================================================================================================
function runDomainTests() {
  // A6 — períodos sobrepostos no mesmo dia devem ser rejeitados.
  assert.throws(
    () => assertValidWeeklyHours({ ...closedWeek(), monday: [{ start: "08:00", end: "12:00" }, { start: "11:00", end: "14:00" }] }),
    ServiceAvailabilityDomainError,
    "A6: 08:00-12:00 + 11:00-14:00 no mesmo dia devem conflitar",
  );
  // Períodos não sobrepostos e adjacentes (boundary) são válidos.
  assertValidWeeklyHours({ ...closedWeek(), monday: [{ start: "08:00", end: "12:00" }, { start: "12:00", end: "18:00" }] });

  // B1/B2 — candidatos alinhados ao slotStep, cabendo inteiramente no período.
  const period = [{ start: "08:00", end: "12:00" }];
  assert.deepEqual(
    generateCandidateStartMinutes(period, 15, 45).slice(0, 4).map((m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`),
    ["08:00", "08:15", "08:30", "08:45"],
    "B1: step=15 gera candidatos a cada 15 minutos",
  );
  assert.deepEqual(
    generateCandidateStartMinutes(period, 30, 30).map((m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`),
    ["08:00", "08:30", "09:00", "09:30", "10:00", "10:30", "11:00", "11:30"],
    "B2: step=30 gera candidatos a cada 30 minutos",
  );
  // B3 — duração precisa caber inteiramente: último candidato de 45min em 08:00-12:00 é 11:15, nunca 11:30+.
  const candidates45 = generateCandidateStartMinutes(period, 15, 45);
  assert.equal(candidates45[candidates45.length - 1], parseTimeToMinutes("11:15"), "B3: último candidato de 45min deve ser 11:15 (11:15+45=12:00)");
  assert.equal(isIntervalWithinPeriods(parseTimeToMinutes("11:30"), 45, period), false, "B3: 11:30+45min ultrapassa o fim do período (12:15 > 12:00)");

  // A5 — slot cruzando o intervalo entre dois períodos (pausa) é rejeitado.
  const withBreak = [{ start: "08:00", end: "12:00" }, { start: "13:00", end: "18:00" }];
  assert.equal(isIntervalWithinPeriods(parseTimeToMinutes("11:45"), 30, withBreak), false, "A5: 11:45-12:15 cruza a pausa 12:00-13:00");
  assert.equal(isIntervalWithinPeriods(parseTimeToMinutes("13:00"), 30, withBreak), true, "A5: 13:00-13:30 já está no segundo período");

  // Timezone/slotStep/advance window — validação pura.
  assertValidTimezone("America/Sao_Paulo");
  assertValidTimezone("America/New_York");
  assertValidTimezone("UTC");
  assert.throws(() => assertValidTimezone("Not/A_Real_Zone"), ServiceAvailabilityDomainError);
  assertValidSlotStepMinutes(15);
  assertValidSlotStepMinutes(30);
  assert.throws(() => assertValidSlotStepMinutes(5), ServiceAvailabilityDomainError, "5 não é uma opção de slotStep pública");
  assertValidAdvanceWindow(0, undefined);
  assertValidAdvanceWindow(120, 30);
  assert.throws(() => assertValidAdvanceWindow(-1, undefined), ServiceAvailabilityDomainError);
  assert.throws(() => assertValidAdvanceWindow(0, 0), ServiceAvailabilityDomainError, "maxAdvanceDays deve ser positivo quando presente");

  // §9 — overlap de intervalos [start,end).
  assert.equal(intervalsOverlap("2026-08-31T10:00:00.000Z", "2026-08-31T10:30:00.000Z", "2026-08-31T10:30:00.000Z", "2026-08-31T11:00:00.000Z"), false, "boundary adjacente nunca é overlap");
  assert.equal(intervalsOverlap("2026-08-31T10:00:00.000Z", "2026-08-31T10:30:00.000Z", "2026-08-31T10:15:00.000Z", "2026-08-31T10:45:00.000Z"), true);

  // §40/§41 — range de consulta validado e limitado.
  assertValidAvailabilityQueryRange("2026-08-31T00:00:00.000Z", "2026-09-01T00:00:00.000Z");
  assert.throws(() => assertValidAvailabilityQueryRange("2026-09-01T00:00:00.000Z", "2026-08-31T00:00:00.000Z"), ServiceAvailabilityDomainError, "start>end deve ser rejeitado");
  assert.throws(() => assertValidAvailabilityQueryRange("2026-08-01T00:00:00.000Z", "2026-10-01T00:00:00.000Z"), ServiceAvailabilityDomainError, "range > 31 dias deve ser rejeitado");

  console.log("Services availability pure-function tests passed: overlapping/adjacent daily periods, slot-step candidate generation (15/30min), duration-must-fit-entirely (B3), break-crossing rejection (A5), timezone/slot-step/advance-window validators, interval overlap semantics, and the 31-day query range cap.");
}

// ====================================================================================================
// Harness HTTP — mesmo padrão de script/services-booking-tests.ts, agora registrando AMBOS os grupos de
// rotas (booking + availability) no mesmo app, porque createHold/confirm/reschedule agora dependem da
// camada de disponibilidade.
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
  registerServiceAvailabilityRoutes(app, requireAuth);
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
async function getJson(baseUrl: string, path: string, uid?: string) {
  const response = await fetch(`${baseUrl}${path}`, { headers: uid ? { "x-test-uid": uid } : {} });
  return {
    status: response.status,
    body: response.headers.get("content-type")?.includes("application/json") ? await response.json() : null,
  };
}

function omitUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => typeof v !== "undefined")) as T;
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

async function upsertSchedule(
  baseUrl: string, uid: string, resourceId: string,
  input: { timezone: string; slotStepMinutes: number; minAdvanceMinutes?: number; maxAdvanceDays?: number; weeklyHours: WeeklyHours },
  key: string,
) {
  return await postJson(baseUrl, `/api/services/availability/schedules/${resourceId}`, { ...input, idempotencyKey: key }, uid);
}

function alignToStepUtc(date: Date, stepMinutes: number): Date {
  const ms = stepMinutes * 60_000;
  return new Date(Math.ceil(date.getTime() / ms) * ms);
}
/**
 * TEST-FIX-AVAIL-01 — horário seguro num dia futuro, sempre em UTC, para fixtures que só precisam de
 * "algum horário no futuro" dentro do expediente configurado (allDayWeek = 00:00-23:45). Nunca usar
 * `Date.now() + offset` sozinho para isso: dependendo de QUANDO o teste roda, o horário resultante pode
 * cair perto de 00:00/23:45 e ser rejeitado como OUTSIDE_WORKING_HOURS de forma intermitente. Fixando a
 * hora do dia (ex.: 10:00) e variando só o número de dias à frente, o resultado nunca se aproxima de um
 * boundary de expediente, independente da hora real em que a suíte é executada.
 */
function futureUtcAtSafeHour(daysAhead: number, hour: number, minute = 0): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + daysAhead, hour, minute, 0, 0));
}

/**
 * PLAN-IMPL-02A — same TEST-FIX-AVAIL-01 lesson, extended to the blocks that need a SPECIFIC day of the
 * week (A1-A5/F1-F7/G1-G4/H1 need a Monday matching their `monday: [...]` schedules; §39 needs a Tuesday
 * matching its `tuesday: [...]` schedules), which is why those blocks were left with a hardcoded literal
 * date ("2026-08-31"/"2026-09-01") instead of futureUtcAtSafeHour alone — that helper picks a safe HOUR
 * but not a specific weekday. The hardcoded date was a Monday/Tuesday when written, but a fixed calendar
 * date inevitably becomes "the past" as real time moves on (confirmed: it started failing on 2026-09-01,
 * the day after "2026-08-31" — the exact TEST-FIX-AVAIL-01 failure mode, just not caught for these blocks
 * at the time). Returns a YYYY-MM-DD key, at least `daysAhead` out, on the next date whose UTC calendar
 * weekday is `targetUtcDay` (0=Sunday..6=Saturday). Safe to treat as the SP-local weekday too: every
 * startAt in the affected blocks is between 10:00-23:00 UTC (07:00-20:00 local, SP=UTC-3), so none of
 * them cross the UTC midnight boundary where the UTC and SP-local calendar dates could disagree.
 */
function futureUtcDateKeyOnWeekday(daysAhead: number, targetUtcDay: number): string {
  const base = new Date(Date.now() + daysAhead * 24 * 60 * 60_000);
  const cursor = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate()));
  while (cursor.getUTCDay() !== targetUtcDay) cursor.setUTCDate(cursor.getUTCDate() + 1);
  return cursor.toISOString().slice(0, 10);
}
function addDaysToDateKey(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}
/** At least 6 days out — comfortably clears any minAdvanceMinutes used elsewhere in this file (max 3 days)
 * and, being a fixed weekday search, is never actually exactly 6: this is just the search floor. */
const SAFE_MONDAY_KEY = futureUtcDateKeyOnWeekday(6, 1);
const SAFE_SUNDAY_AFTER_MONDAY_KEY = addDaysToDateKey(SAFE_MONDAY_KEY, 6);
const SAFE_TUESDAY_KEY = futureUtcDateKeyOnWeekday(6, 2);

async function runCommandTests() {
  const harness = await createServer();
  const db = initializeFirebaseAdmin().firestore();

  try {
    // ===== upsertServiceResourceSchedule — válido, e overlap/timezone inválidos rejeitados (§22) =====
    {
      const uid = tenantUid();
      const valid = await upsertSchedule(harness.baseUrl, uid, "res-sched-a", {
        timezone: "America/Sao_Paulo", slotStepMinutes: 15,
        weeklyHours: { ...closedWeek(), monday: [{ start: "08:00", end: "12:00" }, { start: "13:00", end: "18:00" }], tuesday: [{ start: "08:00", end: "18:00" }] },
      }, "sched-a-1");
      assert.equal(valid.status, 200, JSON.stringify(valid.body));
      const scheduleDoc = await db.doc(`users/${uid}/serviceResourceSchedules/res-sched-a`).get();
      assert.equal(scheduleDoc.exists, true);
      assert.equal(scheduleDoc.data()?.timezone, "America/Sao_Paulo");

      const overlapping = await upsertSchedule(harness.baseUrl, uid, "res-sched-b", {
        timezone: "America/Sao_Paulo", slotStepMinutes: 15,
        weeklyHours: { ...closedWeek(), monday: [{ start: "08:00", end: "12:00" }, { start: "11:00", end: "14:00" }] },
      }, "sched-b-1");
      assert.equal(overlapping.status, 400, "A6: upsert com períodos sobrepostos deve ser rejeitado");

      const badTimezone = await upsertSchedule(harness.baseUrl, uid, "res-sched-c", {
        timezone: "Not/A_Real_Zone", slotStepMinutes: 15, weeklyHours: closedWeek(),
      }, "sched-c-1");
      assert.equal(badTimezone.status, 400, "timezone inválida deve ser rejeitada");

      // Idempotência: replay com a mesma key devolve sucesso idempotente; key igual com payload diferente conflita.
      const replay = await upsertSchedule(harness.baseUrl, uid, "res-sched-a", {
        timezone: "America/Sao_Paulo", slotStepMinutes: 15,
        weeklyHours: { ...closedWeek(), monday: [{ start: "08:00", end: "12:00" }, { start: "13:00", end: "18:00" }], tuesday: [{ start: "08:00", end: "18:00" }] },
      }, "sched-a-1");
      assert.equal(replay.status, 200);
      assert.equal(replay.body.idempotentReplay, true);
      const conflicting = await upsertSchedule(harness.baseUrl, uid, "res-sched-a", {
        timezone: "America/Sao_Paulo", slotStepMinutes: 30,
        weeklyHours: closedWeek(),
      }, "sched-a-1");
      assert.equal(conflicting.status, 409);
      assert.equal(conflicting.body?.code, "IDEMPOTENCY_CONFLICT");
    }

    // ===== A1-A4/A5/F1-F3/F7 — createHold hardening contra o expediente configurado =====
    {
      const uid = tenantUid();
      await seedService(uid, "svc-hours", { durationMinutes: 30 });
      await upsertSchedule(harness.baseUrl, uid, "res-hours", {
        timezone: "America/Sao_Paulo", slotStepMinutes: 15,
        weeklyHours: { ...closedWeek(), monday: [{ start: "08:00", end: "12:00" }, { start: "13:00", end: "18:00" }], tuesday: [{ start: "08:00", end: "18:00" }], sunday: [] },
      }, "hours-1");

      // A1/F7 — SAFE_MONDAY_KEY é sempre uma segunda-feira futura; 10:00 local SP = 13:00 UTC (SP=UTC-3), dentro de 08:00-12:00.
      const a1 = await postJson(harness.baseUrl, "/api/services/bookings/holds", { serviceId: "svc-hours", resourceId: "res-hours", startAt: `${SAFE_MONDAY_KEY}T13:00:00.000Z`, idempotencyKey: "a1-hold" }, uid);
      assert.equal(a1.status, 200, `A1: ${JSON.stringify(a1.body)}`);

      // A2/F1 — 07:00 local SP (10:00 UTC) é antes do expediente.
      const a2 = await postJson(harness.baseUrl, "/api/services/bookings/holds", { serviceId: "svc-hours", resourceId: "res-hours", startAt: `${SAFE_MONDAY_KEY}T10:00:00.000Z`, idempotencyKey: "a2-hold" }, uid);
      assert.equal(a2.status, 409);
      assert.equal(a2.body?.code, "OUTSIDE_WORKING_HOURS");

      // A3 — 19:00 local SP (22:00 UTC) é depois do expediente.
      const a3 = await postJson(harness.baseUrl, "/api/services/bookings/holds", { serviceId: "svc-hours", resourceId: "res-hours", startAt: `${SAFE_MONDAY_KEY}T22:00:00.000Z`, idempotencyKey: "a3-hold" }, uid);
      assert.equal(a3.status, 409);
      assert.equal(a3.body?.code, "OUTSIDE_WORKING_HOURS");

      // A4 — o domingo que fecha a mesma semana do SAFE_MONDAY_KEY (Monday+6), fechado: qualquer horário deve ser rejeitado.
      const a4 = await postJson(harness.baseUrl, "/api/services/bookings/holds", { serviceId: "svc-hours", resourceId: "res-hours", startAt: `${SAFE_SUNDAY_AFTER_MONDAY_KEY}T13:00:00.000Z`, idempotencyKey: "a4-hold" }, uid);
      assert.equal(a4.status, 409);
      assert.equal(a4.body?.code, "OUTSIDE_WORKING_HOURS");

      // A5/F2 — 11:45 local SP (14:45 UTC) cruzaria a pausa 12:00-13:00 com 30min de duração.
      const a5 = await postJson(harness.baseUrl, "/api/services/bookings/holds", { serviceId: "svc-hours", resourceId: "res-hours", startAt: `${SAFE_MONDAY_KEY}T14:45:00.000Z`, idempotencyKey: "a5-hold" }, uid);
      assert.equal(a5.status, 409);
      assert.equal(a5.body?.code, "OUTSIDE_WORKING_HOURS");
    }

    // ===== B4/F4 — slot desalinhado ao slotStep é rejeitado; B5 — endAt do client é sempre ignorado =====
    {
      const uid = tenantUid();
      await seedService(uid, "svc-step", { durationMinutes: 30 });
      await upsertSchedule(harness.baseUrl, uid, "res-step", {
        timezone: "UTC", slotStepMinutes: 30, weeklyHours: allDayWeek(),
      }, "step-1");
      // TEST-FIX-AVAIL-01: base fixada num horário seguro (10:00 UTC de amanhã) em vez de "Date.now() + 3h",
      // que podia cair perto do fim do expediente (allDayWeek = 00:00-23:45) dependendo de quando a suíte roda.
      const base = alignToStepUtc(futureUtcAtSafeHour(1, 10, 0), 30);
      const misalignedStart = new Date(base.getTime() + 15 * 60_000).toISOString();
      const b4 = await postJson(harness.baseUrl, "/api/services/bookings/holds", { serviceId: "svc-step", resourceId: "res-step", startAt: misalignedStart, idempotencyKey: "b4-hold" }, uid);
      assert.equal(b4.status, 409, JSON.stringify(b4.body));
      assert.equal(b4.body?.code, "MISALIGNED_SLOT");

      // B5 — client envia um endAt arbitrário junto do payload; servidor sempre ignora e deriva do Service.
      const alignedStart = base.toISOString();
      const b5 = await postJson(harness.baseUrl, "/api/services/bookings/holds", { serviceId: "svc-step", resourceId: "res-step", startAt: alignedStart, endAt: "2099-01-01T00:00:00.000Z", idempotencyKey: "b5-hold" }, uid);
      assert.equal(b5.status, 200, JSON.stringify(b5.body));
      assert.equal(b5.body.endAt, new Date(Date.parse(alignedStart) + 30 * 60_000).toISOString(), "B5: endAt sempre derivado do Service, nunca do client");
    }

    // ===== E1-E3/F5-F6 — janelas de antecedência mínima/máxima =====
    {
      const uid = tenantUid();
      await seedService(uid, "svc-advance", { durationMinutes: 30 });
      // TEST-FIX-AVAIL-01: minAdvance/maxAdvance recalibrados para dias (em vez de minutos) para que os 3
      // cenários abaixo possam usar futureUtcAtSafeHour (hora do dia fixa, sempre longe do boundary de
      // expediente 00:00-23:45) em vez de "Date.now() + N minutos", que testava a mesma regra mas com um
      // horário de relógio dependente de quando a suíte roda.
      await upsertSchedule(harness.baseUrl, uid, "res-advance", {
        timezone: "UTC", slotStepMinutes: 15, minAdvanceMinutes: 3 * 24 * 60, maxAdvanceDays: 10, weeklyHours: allDayWeek(),
      }, "advance-1");

      // E1/F5 — ~1 dia de antecedência, menor que os 3 dias exigidos.
      const tooSoon = alignToStepUtc(futureUtcAtSafeHour(1, 10, 0), 15).toISOString();
      const e1 = await postJson(harness.baseUrl, "/api/services/bookings/holds", { serviceId: "svc-advance", resourceId: "res-advance", startAt: tooSoon, idempotencyKey: "e1-hold" }, uid);
      assert.equal(e1.status, 409);
      assert.equal(e1.body?.code, "MIN_ADVANCE_VIOLATION");

      // E2 — confortavelmente entre o mínimo (3 dias) e o máximo (10 dias): ~5 dias à frente (semântica
      // documentada: startAt >= now+minAdvance é permitido).
      const comfortablyAfter = alignToStepUtc(futureUtcAtSafeHour(5, 10, 0), 15).toISOString();
      const e2 = await postJson(harness.baseUrl, "/api/services/bookings/holds", { serviceId: "svc-advance", resourceId: "res-advance", startAt: comfortablyAfter, idempotencyKey: "e2-hold" }, uid);
      assert.equal(e2.status, 200, JSON.stringify(e2.body));

      // E3/F6 — ~15 dias no futuro, além dos 10 dias permitidos.
      const tooFar = alignToStepUtc(futureUtcAtSafeHour(15, 10, 0), 15).toISOString();
      const e3 = await postJson(harness.baseUrl, "/api/services/bookings/holds", { serviceId: "svc-advance", resourceId: "res-advance", startAt: tooFar, idempotencyKey: "e3-hold" }, uid);
      assert.equal(e3.status, 409);
      assert.equal(e3.body?.code, "MAX_ADVANCE_VIOLATION");
    }

    // ===== C1-C6 — bloqueios extraordinários =====
    {
      const uid = tenantUid();
      await seedService(uid, "svc-block", { durationMinutes: 30 });
      // Sem ServiceResourceSchedule configurado para "res-block" — blocks continuam valendo mesmo assim (§19/§20).
      const blockStart = alignToStepUtc(new Date(Date.now() + 6 * 60 * 60_000), 30).toISOString();
      const blockEnd = new Date(Date.parse(blockStart) + 60 * 60_000).toISOString();
      const createBlock = await postJson(harness.baseUrl, "/api/services/availability/blocks", { resourceId: "res-block", startAt: blockStart, endAt: blockEnd, reason: "Consulta médica", idempotencyKey: "c1-block" }, uid);
      assert.equal(createBlock.status, 200, JSON.stringify(createBlock.body));
      const blockId = createBlock.body.blockId as string;

      // C1 — hold sobreposto ao block é rejeitado.
      const overlapping = await postJson(harness.baseUrl, "/api/services/bookings/holds", { serviceId: "svc-block", resourceId: "res-block", startAt: blockStart, idempotencyKey: "c1-hold" }, uid);
      assert.equal(overlapping.status, 409);
      assert.equal(overlapping.body?.code, "BLOCKED_INTERVAL");

      // C2 — hold começando exatamente onde o block termina é permitido (boundary [start,end)).
      const boundary = await postJson(harness.baseUrl, "/api/services/bookings/holds", { serviceId: "svc-block", resourceId: "res-block", startAt: blockEnd, idempotencyKey: "c2-hold" }, uid);
      assert.equal(boundary.status, 200, `C2: ${JSON.stringify(boundary.body)}`);

      // C3 — novo block sobre um Booking já confirmado deve ser rejeitado.
      const bookedStart = alignToStepUtc(new Date(Date.now() + 8 * 60 * 60_000), 30).toISOString();
      const hold3 = await postJson(harness.baseUrl, "/api/services/bookings/holds", { serviceId: "svc-block", resourceId: "res-block", startAt: bookedStart, idempotencyKey: "c3-hold" }, uid);
      assert.equal(hold3.status, 200);
      const confirm3 = await postJson(harness.baseUrl, `/api/services/bookings/holds/${hold3.body.holdId}/confirm`, { idempotencyKey: "c3-confirm" }, uid);
      assert.equal(confirm3.status, 200);
      const blockOverBooking = await postJson(harness.baseUrl, "/api/services/availability/blocks", { resourceId: "res-block", startAt: bookedStart, endAt: hold3.body.endAt, idempotencyKey: "c3-block" }, uid);
      assert.equal(blockOverBooking.status, 409);
      assert.equal(blockOverBooking.body?.code, "BLOCK_CONFLICT_WITH_BOOKING");

      // C4 — novo block sobre um Hold ativo (não confirmado) deve ser rejeitado.
      const activeHoldStart = alignToStepUtc(new Date(Date.now() + 9 * 60 * 60_000), 30).toISOString();
      const hold4 = await postJson(harness.baseUrl, "/api/services/bookings/holds", { serviceId: "svc-block", resourceId: "res-block", startAt: activeHoldStart, idempotencyKey: "c4-hold" }, uid);
      assert.equal(hold4.status, 200);
      const blockOverActiveHold = await postJson(harness.baseUrl, "/api/services/availability/blocks", { resourceId: "res-block", startAt: activeHoldStart, endAt: hold4.body.endAt, idempotencyKey: "c4-block" }, uid);
      assert.equal(blockOverActiveHold.status, 409);
      assert.equal(blockOverActiveHold.body?.code, "BLOCK_CONFLICT_WITH_ACTIVE_HOLD");

      // C5 — mesmo intervalo, mas o Hold expirou logicamente: o block agora pode ser criado.
      await db.doc(`users/${uid}/bookingHolds/${hold4.body.holdId}`).update({ expiresAt: "2020-01-01T00:00:00.000Z" });
      const lockSnaps = await db.collection(`users/${uid}/scheduleLocks`).where("ownerId", "==", hold4.body.holdId).get();
      await Promise.all(lockSnaps.docs.map((d) => d.ref.update({ expiresAt: "2020-01-01T00:00:00.000Z" })));
      const blockOverExpiredHold = await postJson(harness.baseUrl, "/api/services/availability/blocks", { resourceId: "res-block", startAt: activeHoldStart, endAt: hold4.body.endAt, idempotencyKey: "c5-block" }, uid);
      assert.equal(blockOverExpiredHold.status, 200, `C5: ${JSON.stringify(blockOverExpiredHold.body)}`);

      // C6 — remover o block original (C1) libera o horário imediatamente para um novo hold.
      const deleteResult = await postJson(harness.baseUrl, `/api/services/availability/blocks/${blockId}/delete`, { idempotencyKey: "c6-delete" }, uid);
      assert.equal(deleteResult.status, 200);
      const afterDelete = await postJson(harness.baseUrl, "/api/services/bookings/holds", { serviceId: "svc-block", resourceId: "res-block", startAt: blockStart, idempotencyKey: "c6-hold" }, uid);
      assert.equal(afterDelete.status, 200, `C6: ${JSON.stringify(afterDelete.body)}`);
      // Delete idempotente: repetir com key nova sobre block já removido continua seguro.
      const deleteAgain = await postJson(harness.baseUrl, `/api/services/availability/blocks/${blockId}/delete`, { idempotencyKey: "c6-delete-again" }, uid);
      assert.equal(deleteAgain.status, 200);
    }

    // ===== D1-D5 — integração com locks via getServiceAvailability =====
    {
      const uid = tenantUid();
      await seedService(uid, "svc-avail", { durationMinutes: 30 });
      await upsertSchedule(harness.baseUrl, uid, "res-avail-d", { timezone: "UTC", slotStepMinutes: 30, weeklyHours: allDayWeek() }, "d-sched-1");
      await upsertSchedule(harness.baseUrl, uid, "res-avail-d2", { timezone: "UTC", slotStepMinutes: 30, weeklyHours: allDayWeek() }, "d-sched-2");

      // TEST-FIX-AVAIL-01 (D2): rangeStart fixado às 10:00 UTC de amanhã em vez de "Date.now() + 24h" — o
      // valor antigo podia cair perto do fim do expediente (allDayWeek = 00:00-23:45) e fazer o Hold do D2
      // (rangeStart + 30min, +30min de duração) ultrapassar 23:45, gerando OUTSIDE_WORKING_HOURS de forma
      // intermitente dependendo da hora real em que a suíte roda. A invariante testada (D0-D5) é a mesma.
      const rangeStart = alignToStepUtc(futureUtcAtSafeHour(1, 10, 0), 30).toISOString();
      const rangeEnd = new Date(Date.parse(rangeStart) + 4 * 60 * 60_000).toISOString();

      const before = await getJson(harness.baseUrl, `/api/services/availability?serviceId=svc-avail&resourceId=res-avail-d&rangeStartAt=${rangeStart}&rangeEndAt=${rangeEnd}`, uid);
      assert.equal(before.status, 200, JSON.stringify(before.body));
      const startsBefore: string[] = before.body.candidates.map((c: { startAt: string }) => c.startAt);
      assert.ok(startsBefore.includes(rangeStart), "D0: sem nada ocupado, o primeiro candidato deve aparecer");

      // D1 — Booking confirmado remove o slot.
      const hold1 = await postJson(harness.baseUrl, "/api/services/bookings/holds", { serviceId: "svc-avail", resourceId: "res-avail-d", startAt: rangeStart, idempotencyKey: "d1-hold" }, uid);
      assert.equal(hold1.status, 200);
      await postJson(harness.baseUrl, `/api/services/bookings/holds/${hold1.body.holdId}/confirm`, { idempotencyKey: "d1-confirm" }, uid);
      const afterBooking = await getJson(harness.baseUrl, `/api/services/availability?serviceId=svc-avail&resourceId=res-avail-d&rangeStartAt=${rangeStart}&rangeEndAt=${rangeEnd}`, uid);
      const startsAfterBooking: string[] = afterBooking.body.candidates.map((c: { startAt: string }) => c.startAt);
      assert.ok(!startsAfterBooking.includes(rangeStart), "D1: slot ocupado por Booking confirmado não aparece mais");

      // D2 — active Hold (não confirmado) também remove o slot seguinte.
      const secondSlot = new Date(Date.parse(rangeStart) + 30 * 60_000).toISOString();
      const hold2 = await postJson(harness.baseUrl, "/api/services/bookings/holds", { serviceId: "svc-avail", resourceId: "res-avail-d", startAt: secondSlot, idempotencyKey: "d2-hold" }, uid);
      assert.equal(hold2.status, 200);
      const afterHold = await getJson(harness.baseUrl, `/api/services/availability?serviceId=svc-avail&resourceId=res-avail-d&rangeStartAt=${rangeStart}&rangeEndAt=${rangeEnd}`, uid);
      const startsAfterHold: string[] = afterHold.body.candidates.map((c: { startAt: string }) => c.startAt);
      assert.ok(!startsAfterHold.includes(secondSlot), "D2: slot com Hold ativo não aparece");

      // D3 — Hold expirado NÃO remove o slot (volta a aparecer).
      await db.doc(`users/${uid}/bookingHolds/${hold2.body.holdId}`).update({ expiresAt: "2020-01-01T00:00:00.000Z" });
      const lockSnaps2 = await db.collection(`users/${uid}/scheduleLocks`).where("ownerId", "==", hold2.body.holdId).get();
      await Promise.all(lockSnaps2.docs.map((d) => d.ref.update({ expiresAt: "2020-01-01T00:00:00.000Z" })));
      const afterExpiry = await getJson(harness.baseUrl, `/api/services/availability?serviceId=svc-avail&resourceId=res-avail-d&rangeStartAt=${rangeStart}&rangeEndAt=${rangeEnd}`, uid);
      const startsAfterExpiry: string[] = afterExpiry.body.candidates.map((c: { startAt: string }) => c.startAt);
      assert.ok(startsAfterExpiry.includes(secondSlot), "D3: Hold expirado não deve remover o slot da disponibilidade");

      // D4 — overlap parcial: um Booking de 30min bloqueia exatamente o candidato que o sobrepõe (já coberto por D1
      // no mesmo recurso — reafirma aqui que o slot seguinte ao Booking do D1 permanece livre, prova de que só o
      // candidato realmente sobreposto é removido, não a vizinhança inteira).
      assert.ok(startsAfterExpiry.includes(secondSlot), "D4: candidato adjacente ao Booking do D1 não é afetado");

      // D5 — outro resource não é afetado pelo Booking/Hold do primeiro.
      const otherResource = await getJson(harness.baseUrl, `/api/services/availability?serviceId=svc-avail&resourceId=res-avail-d2&rangeStartAt=${rangeStart}&rangeEndAt=${rangeEnd}`, uid);
      const startsOtherResource: string[] = otherResource.body.candidates.map((c: { startAt: string }) => c.startAt);
      assert.ok(startsOtherResource.includes(rangeStart), "D5: resource diferente nunca é afetado");
    }

    // ===== G1-G4 — reschedule hardening contra a agenda atual =====
    {
      const uid = tenantUid();
      await seedService(uid, "svc-resched", { durationMinutes: 30 });
      await upsertSchedule(harness.baseUrl, uid, "res-resched", {
        timezone: "America/Sao_Paulo", slotStepMinutes: 15,
        weeklyHours: { ...closedWeek(), monday: [{ start: "08:00", end: "12:00" }] },
      }, "resched-sched-1");
      const hold = await postJson(harness.baseUrl, "/api/services/bookings/holds", { serviceId: "svc-resched", resourceId: "res-resched", startAt: `${SAFE_MONDAY_KEY}T13:00:00.000Z`, idempotencyKey: "g-hold" }, uid);
      assert.equal(hold.status, 200, JSON.stringify(hold.body));
      const confirm = await postJson(harness.baseUrl, `/api/services/bookings/holds/${hold.body.holdId}/confirm`, { idempotencyKey: "g-confirm" }, uid);
      assert.equal(confirm.status, 200);
      const bookingId = confirm.body.bookingId as string;

      // G1 — reagendar para fora do expediente (Monday 20:00 local = 23:00 UTC): reject, slot antigo preservado.
      const g1 = await postJson(harness.baseUrl, `/api/services/bookings/${bookingId}/reschedule`, { startAt: `${SAFE_MONDAY_KEY}T23:00:00.000Z`, idempotencyKey: "g1-resched" }, uid);
      assert.equal(g1.status, 409);
      assert.equal(g1.body?.code, "OUTSIDE_WORKING_HOURS");
      const bookingAfterG1 = await db.doc(`users/${uid}/bookings/${bookingId}`).get();
      assert.equal(bookingAfterG1.data()?.startAt, `${SAFE_MONDAY_KEY}T13:00:00.000Z`, "G1: slot antigo deve permanecer intacto após rejeição");

      // G2 — reagendar para dentro de um block: reject, slot antigo preservado.
      const blockTarget = `${SAFE_MONDAY_KEY}T14:00:00.000Z`; // 11:00 local SP, ainda dentro do expediente das 08-12
      await postJson(harness.baseUrl, "/api/services/availability/blocks", { resourceId: "res-resched", startAt: blockTarget, endAt: `${SAFE_MONDAY_KEY}T14:30:00.000Z`, idempotencyKey: "g2-block" }, uid);
      const g2 = await postJson(harness.baseUrl, `/api/services/bookings/${bookingId}/reschedule`, { startAt: blockTarget, idempotencyKey: "g2-resched" }, uid);
      assert.equal(g2.status, 409);
      assert.equal(g2.body?.code, "BLOCKED_INTERVAL");
      const bookingAfterG2 = await db.doc(`users/${uid}/bookings/${bookingId}`).get();
      assert.equal(bookingAfterG2.data()?.startAt, `${SAFE_MONDAY_KEY}T13:00:00.000Z`, "G2: slot antigo deve permanecer intacto após rejeição");

      // G3 — reagendar para horário desalinhado ao slotStep (15min): 10:05 local não é múltiplo de 15.
      const g3 = await postJson(harness.baseUrl, `/api/services/bookings/${bookingId}/reschedule`, { startAt: `${SAFE_MONDAY_KEY}T13:05:00.000Z`, idempotencyKey: "g3-resched" }, uid);
      assert.equal(g3.status, 409);
      assert.equal(g3.body?.code, "MISALIGNED_SLOT");

      // G4 — reagendar para um novo horário válido: sucesso.
      const g4 = await postJson(harness.baseUrl, `/api/services/bookings/${bookingId}/reschedule`, { startAt: `${SAFE_MONDAY_KEY}T13:30:00.000Z`, idempotencyKey: "g4-resched" }, uid);
      assert.equal(g4.status, 200, `G4: ${JSON.stringify(g4.body)}`);
    }

    // ===== H1 — confirm revalida a agenda ATUAL antes de converter o Hold em Booking =====
    {
      const uid = tenantUid();
      await seedService(uid, "svc-confirm-revalidate", { durationMinutes: 30 });
      await upsertSchedule(harness.baseUrl, uid, "res-confirm-revalidate", {
        timezone: "America/Sao_Paulo", slotStepMinutes: 15,
        weeklyHours: { ...closedWeek(), monday: [{ start: "08:00", end: "18:00" }] },
      }, "h1-sched-1");
      const hold = await postJson(harness.baseUrl, "/api/services/bookings/holds", { serviceId: "svc-confirm-revalidate", resourceId: "res-confirm-revalidate", startAt: `${SAFE_MONDAY_KEY}T13:00:00.000Z`, idempotencyKey: "h1-hold" }, uid);
      assert.equal(hold.status, 200, JSON.stringify(hold.body));

      // Expediente muda ENQUANTO o Hold está ativo — encolhe para 08:00-09:00 local, o Hold (10:00 local) fica órfão.
      await upsertSchedule(harness.baseUrl, uid, "res-confirm-revalidate", {
        timezone: "America/Sao_Paulo", slotStepMinutes: 15,
        weeklyHours: { ...closedWeek(), monday: [{ start: "08:00", end: "09:00" }] },
      }, "h1-sched-2");

      const confirm = await postJson(harness.baseUrl, `/api/services/bookings/holds/${hold.body.holdId}/confirm`, { idempotencyKey: "h1-confirm" }, uid);
      assert.equal(confirm.status, 409, "H1: confirm deve revalidar a agenda ATUAL e rejeitar");
      assert.equal(confirm.body?.code, "OUTSIDE_WORKING_HOURS");

      const holdAfter = await db.doc(`users/${uid}/bookingHolds/${hold.body.holdId}`).get();
      assert.equal(holdAfter.data()?.status, "active", "H1: hold rejeitado na confirmação continua active, nunca consumido");
      assert.equal(typeof holdAfter.data()?.confirmedBookingId, "undefined");
      const bookingsSnap = await db.collection(`users/${uid}/bookings`).where("workId", "!=", "").get().catch(() => null);
      void bookingsSnap;
      const allBookings = await db.collection(`users/${uid}/bookings`).get();
      assert.equal(allBookings.size, 0, "H1: nenhum Booking deve ter sido criado");
      const allWorks = await db.collection(`users/${uid}/serviceWorks`).get();
      assert.equal(allWorks.size, 0, "H1: nenhum ServiceWork deve ter sido criado");
    }

    // ===== §39 — timezones distintos tratados corretamente (não simplificado para offset fixo) =====
    {
      const uid = tenantUid();
      await seedService(uid, "svc-tz-sp", { durationMinutes: 30 });
      await seedService(uid, "svc-tz-ny", { durationMinutes: 30 });
      await upsertSchedule(harness.baseUrl, uid, "res-tz-sp", {
        timezone: "America/Sao_Paulo", slotStepMinutes: 30,
        weeklyHours: { ...closedWeek(), tuesday: [{ start: "08:00", end: "18:00" }] },
      }, "tz-sp-1");
      await upsertSchedule(harness.baseUrl, uid, "res-tz-ny", {
        timezone: "America/New_York", slotStepMinutes: 30,
        weeklyHours: { ...closedWeek(), tuesday: [{ start: "08:00", end: "18:00" }] },
      }, "tz-ny-1");

      // SAFE_TUESDAY_KEY às 21:00 UTC: SP (UTC-3) => 18:00 local (30min não cabe mais, expediente termina 18:00) => reject.
      //                                NY (UTC-4, EDT em setembro) => 17:00 local (17:00-17:30 cabe) => allowed.
      // Mesmo instante UTC, mesmo weeklyHours configurado, resultado OPOSTO — prova de que a conversão usa a
      // timezone real de CADA agenda, nunca um offset fixo aplicado globalmente.
      const spResult = await postJson(harness.baseUrl, "/api/services/bookings/holds", { serviceId: "svc-tz-sp", resourceId: "res-tz-sp", startAt: `${SAFE_TUESDAY_KEY}T21:00:00.000Z`, idempotencyKey: "tz-sp-hold" }, uid);
      assert.equal(spResult.status, 409, `SP deveria rejeitar 18:00 local: ${JSON.stringify(spResult.body)}`);
      assert.equal(spResult.body?.code, "OUTSIDE_WORKING_HOURS");

      const nyResult = await postJson(harness.baseUrl, "/api/services/bookings/holds", { serviceId: "svc-tz-ny", resourceId: "res-tz-ny", startAt: `${SAFE_TUESDAY_KEY}T21:00:00.000Z`, idempotencyKey: "tz-ny-hold" }, uid);
      assert.equal(nyResult.status, 200, `NY deveria aceitar 17:00 local: ${JSON.stringify(nyResult.body)}`);
    }

    console.log("Services availability command tests (HTTP + emulator) passed: schedule upsert (valid, overlapping-periods rejected, invalid timezone rejected, idempotent replay, conflicting replay rejected), createHold hardened against working hours/breaks/closed days/misaligned slots/client-supplied endAt/min-advance/max-advance (A1-A6, B4-B5, E1-E3, F1-F7), exceptional blocks (create/boundary-adjacency/conflict-with-booking/conflict-with-active-hold/expired-hold-allowed/delete-restores-availability, C1-C6), getServiceAvailability correctly reflects confirmed Booking/active Hold/expired Hold/different-resource (D1-D5), reschedule hardened the same way with the old slot preserved on rejection (G1-G4), confirm revalidates the CURRENT schedule before converting a Hold into a Booking and creates neither Booking nor Work when it no longer fits (H1), and the same UTC instant is accepted or rejected differently depending on each schedule's real IANA timezone (§39, never a fixed offset).");
  } finally {
    await harness.close();
  }
}

// ====================================================================================================
// §27 — Firestore Security Rules: ServiceResourceSchedule/ServiceAvailabilityBlock são legíveis pelo dono,
// nunca graváveis pelo client; a coleção de idempotência é invisível, mesmo padrão de
// script/services-booking-tests.ts.
// ====================================================================================================
const PROJECT_ID = "demo-revendasmart";

type Context = { app: FirebaseApp; auth: Auth; db: Firestore; uid?: string };

function createContext(label: string): Context {
  const app = initializeApp(
    { apiKey: "demo-api-key", authDomain: `${PROJECT_ID}.firebaseapp.com`, projectId: PROJECT_ID, appId: `services-availability-${label}` },
    `services-availability-${label}-${Date.now()}-${Math.random()}`,
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
  const admin = initializeAdminApp({ projectId: PROJECT_ID }, `services-availability-admin-${Date.now()}`);
  const adminDb = getAdminFirestore(admin);

  const owner = createContext("owner");
  const other = createContext("other");
  try {
    const ownerUid = await signIn(owner, "owner");
    await signIn(other, "other");

    const now = "2026-08-29T00:00:00.000Z";
    await adminDb.doc(`users/${ownerUid}/serviceResourceSchedules/res-sec`).set({
      id: "res-sec", tenantUid: ownerUid, resourceId: "res-sec", timezone: "America/Sao_Paulo", slotStepMinutes: 15,
      minAdvanceMinutes: 0, weeklyHours: { sunday: [], monday: [], tuesday: [], wednesday: [], thursday: [], friday: [], saturday: [] },
      createdAt: now, updatedAt: now,
    });
    await adminDb.doc(`users/${ownerUid}/serviceAvailabilityBlocks/block-sec`).set({
      id: "block-sec", tenantUid: ownerUid, resourceId: "res-sec", startAt: now, endAt: "2026-08-29T01:00:00.000Z", createdAt: now,
    });
    await adminDb.doc(`users/${ownerUid}/serviceAvailabilityCommandIdempotency/sec-idem-key-1`).set({
      key: "sec-idem-key-1", tenantUid: ownerUid, action: "upsert_schedule", resourceId: "res-sec", createdAt: now,
    });

    await expectSucceeds("owner lê ServiceResourceSchedule", () => getDoc(doc(owner.db, `users/${ownerUid}/serviceResourceSchedules/res-sec`)));
    await expectSucceeds("owner lê ServiceAvailabilityBlock", () => getDoc(doc(owner.db, `users/${ownerUid}/serviceAvailabilityBlocks/block-sec`)));

    await expectFails("tenant B não lê ServiceResourceSchedule de outro tenant", () => getDoc(doc(other.db, `users/${ownerUid}/serviceResourceSchedules/res-sec`)));
    await expectFails("tenant B não lê ServiceAvailabilityBlock de outro tenant", () => getDoc(doc(other.db, `users/${ownerUid}/serviceAvailabilityBlocks/block-sec`)));

    await expectFails("client não cria ServiceResourceSchedule", () => setDoc(doc(owner.db, `users/${ownerUid}/serviceResourceSchedules/res-forged`), {
      id: "res-forged", tenantUid: ownerUid, resourceId: "res-forged", timezone: "UTC", slotStepMinutes: 15,
      minAdvanceMinutes: 0, weeklyHours: { sunday: [], monday: [], tuesday: [], wednesday: [], thursday: [], friday: [], saturday: [] },
      createdAt: now, updatedAt: now,
    }));
    await expectFails("client não atualiza ServiceResourceSchedule", () => updateDoc(doc(owner.db, `users/${ownerUid}/serviceResourceSchedules/res-sec`), { slotStepMinutes: 30 }));
    await expectFails("client não deleta ServiceResourceSchedule", () => deleteDoc(doc(owner.db, `users/${ownerUid}/serviceResourceSchedules/res-sec`)));

    await expectFails("client não cria ServiceAvailabilityBlock", () => setDoc(doc(owner.db, `users/${ownerUid}/serviceAvailabilityBlocks/block-forged`), {
      id: "block-forged", tenantUid: ownerUid, resourceId: "res-sec", startAt: now, endAt: "2026-08-29T01:00:00.000Z", createdAt: now,
    }));
    await expectFails("client não atualiza ServiceAvailabilityBlock", () => updateDoc(doc(owner.db, `users/${ownerUid}/serviceAvailabilityBlocks/block-sec`), { reason: "hackeado" }));
    await expectFails("client não deleta ServiceAvailabilityBlock", () => deleteDoc(doc(owner.db, `users/${ownerUid}/serviceAvailabilityBlocks/block-sec`)));

    await expectFails("idempotency collection invisível (read)", () => getDoc(doc(owner.db, `users/${ownerUid}/serviceAvailabilityCommandIdempotency/sec-idem-key-1`)));
    await expectFails("client não escreve idempotency collection", () => setDoc(doc(owner.db, `users/${ownerUid}/serviceAvailabilityCommandIdempotency/forged-key`), { key: "forged-key" }));

    console.log("Services availability security rules tests passed: owner reads ServiceResourceSchedule/ServiceAvailabilityBlock normally, cross-tenant read denied for both, client create/update/delete denied for both, serviceAvailabilityCommandIdempotency read/write denied to the client.");
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
