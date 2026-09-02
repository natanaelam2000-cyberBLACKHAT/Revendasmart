import assert from "node:assert/strict";
import { initializeApp, deleteApp } from "firebase/app";
import { getAuth, connectAuthEmulator, createUserWithEmailAndPassword } from "firebase/auth";
import { connectFirestoreEmulator, doc, getFirestore, updateDoc } from "firebase/firestore";
import { initializeFirebaseAdmin } from "../server/firebase-admin-init";
import {
  createServiceBookingHoldCommand,
  confirmServiceBookingHoldCommand,
  cancelServiceBookingCommand,
  rescheduleServiceBookingCommand,
  ServiceBookingCommandError,
} from "../server/service-booking-commands";
import {
  DEFAULT_BUSINESS_TIMEZONE,
  recountBookingMonthUsage,
  resolveBookingQuotaMonthKey,
} from "../server/booking-quota";
import type { Firestore as AdminFirestore } from "firebase-admin/firestore";

/**
 * PLAN-IMPL-02C — TZ1-TZ7 (autoridade de timezone mensal por tenant), BQ1-BQ20 (cota mensal), mais
 * bootstrap de dados legados (§53/§54) e o diagnóstico de recontagem (§55). Segue as convenções já
 * estabelecidas por script/plan-impl-02b1-downgrade-access-tests.ts e
 * script/plan-impl-02b2-active-selection-tests.ts: pure tests primeiro (sem Firestore), depois
 * integração real contra o emulador — sempre contra as funções REAIS deste ticket, nunca uma
 * reimplementação da lógica em código de teste.
 *
 * Nenhum ServiceResourceSchedule é seedado a menos que o teste precise dele especificamente (TZ5): a
 * própria assertIntervalAllowedByScheduleCommand (server/service-availability-commands.ts) já pula todas
 * as checagens de expediente quando nenhum schedule existe (`if (scheduleSnap.exists) {...}`) — auditado
 * antes de escrever este arquivo, para não inventar setup que a produção também não exige.
 */

process.env.FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || "demo-revendasmart";
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || "127.0.0.1:9099";

function requireEmulatorEnv() {
  assert.equal(process.env.FIREBASE_PROJECT_ID, "demo-revendasmart");
  assert.equal(process.env.FIRESTORE_EMULATOR_HOST, "127.0.0.1:8080");
  assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, "127.0.0.1:9099");
}

function tenantUid(prefix = "bq"): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
let seq = 0;
function nextSeq(): number {
  seq += 1;
  return seq;
}

/** §11/§12 — TZ3/TZ4 rodam sem Firestore: resolveBookingQuotaMonthKey é pura. */
function runPureTests(): void {
  // TZ3 — um instante perto da meia-noite UTC do dia 1 pode pertencer a um mês local diferente do
  // prefixo UTC ("2026-09-01T02:00:00Z" em America/Sao_Paulo, UTC-3, é 2026-08-31 23:00 local).
  assert.equal(resolveBookingQuotaMonthKey("2026-09-01T02:00:00.000Z", "America/Sao_Paulo"), "2026-08", "TZ3: instante logo após a meia-noite UTC do dia 1 ainda pertence ao mês local anterior em UTC-3");
  // TZ4 — exemplo exato do ticket (§12): 2026-10-01T01:30:00Z em America/Sao_Paulo é 2026-09-30 22:30
  // local, então o monthKey correto é "2026-09", nunca "2026-10".
  assert.equal(resolveBookingQuotaMonthKey("2026-10-01T01:30:00.000Z", "America/Sao_Paulo"), "2026-09", "TZ4: o helper deve classificar pelo relógio de parede local, não pelo prefixo UTC");
  // Instante bem dentro do mês local: sem ambiguidade, mesmo mês em qualquer timezone razoável.
  assert.equal(resolveBookingQuotaMonthKey("2026-09-15T12:00:00.000Z", "America/Sao_Paulo"), "2026-09");
  assert.equal(resolveBookingQuotaMonthKey("2026-09-15T12:00:00.000Z", "America/Manaus"), "2026-09");
  // Fronteira de ano: dezembro -> janeiro.
  assert.equal(resolveBookingQuotaMonthKey("2027-01-01T01:00:00.000Z", "America/Sao_Paulo"), "2026-12", "virada de ano também respeita o relógio local");

  console.log("PLAN-IMPL-02C pure month-key tests passed: TZ3, TZ4, + year-boundary sanity.");
}

async function seedPlan(db: AdminFirestore, uid: string, plan: "free" | "pro" | "premium"): Promise<void> {
  await db.collection("users").doc(uid).collection("planData").doc("main").set({
    currentPlan: plan, premiumActive: plan === "premium", premiumExpiresAt: null, premiumStartedAt: null,
    premiumSource: plan === "premium" ? "admin" : null, referralCode: "", referralCount: 0, updatedAt: new Date().toISOString(),
    subscriptionId: null, subscriptionStatus: null, subscriptionPlanId: null, autoRenew: false,
    lastPaymentAt: null, nextBillingAt: null, canceledAt: null, paymentStatus: null,
  });
}

async function seedService(db: AdminFirestore, uid: string, serviceId = "service-1"): Promise<string> {
  const nowIso = new Date().toISOString();
  await db.collection("users").doc(uid).collection("services").doc(serviceId).set({
    id: serviceId, tenantUid: uid, name: "Corte", active: true, published: true,
    pricing: { mode: "fixed", priceCents: 5000 }, cost: { kind: "unknown" }, bookingMode: "instant",
    durationMinutes: 30, createdAt: nowIso, updatedAt: nowIso,
  });
  return serviceId;
}

function monthlyUsageDocRef(db: AdminFirestore, uid: string, monthKey: string) {
  return db.collection("users").doc(uid).collection("planUsage").doc(`bookings-${monthKey}`);
}
async function readConfirmedCount(db: AdminFirestore, uid: string, monthKey: string): Promise<number> {
  const snap = await monthlyUsageDocRef(db, uid, monthKey).get();
  return snap.exists ? Number(snap.data()?.confirmedCount ?? 0) : 0;
}

/** Cria e confirma UM Booking real através dos comandos reais (nunca um Booking hand-seeded para o
 * caminho feliz) — createServiceBookingHoldCommand funciona sem ServiceResourceSchedule (auditado no
 * cabeçalho do arquivo), então nenhum setup de expediente é necessário aqui. */
async function createAndConfirm(db: AdminFirestore, uid: string, serviceId: string, resourceId: string, startAtIso: string) {
  const n = nextSeq();
  const holdOutcome = await createServiceBookingHoldCommand(db, uid, serviceId, resourceId, startAtIso, undefined, `hold-${uid}-${n}`);
  if ("conflict" in holdOutcome) throw new Error(`unexpected hold conflict (seq ${n})`);
  return await confirmServiceBookingHoldCommand(db, uid, holdOutcome.holdId, `confirm-${uid}-${n}`);
}

/** Datas espaçadas por 3h a partir de uma base, todas dentro do MESMO mês/dia, evitando qualquer conflito
 * de segmento entre confirmações sucessivas do mesmo teste. */
function hoursAfter(baseIso: string, hours: number): string {
  return new Date(Date.parse(baseIso) + hours * 3_600_000).toISOString();
}

async function run(): Promise<void> {
  runPureTests();

  requireEmulatorEnv();
  initializeFirebaseAdmin();
  const db = initializeFirebaseAdmin().firestore();

  const SEPT_BASE = "2026-09-10T13:00:00.000Z"; // bem dentro de setembro em qualquer timezone razoável
  const OCT_BASE = "2026-10-10T13:00:00.000Z";

  // ===== TZ1/TZ7 — bootstrap da timezone para um tenant totalmente novo (sem planData, sem schedules,
  // sem user_settings): default_brazil, nunca UTC. =====
  {
    const uid = tenantUid("tz1-7");
    await seedPlan(db, uid, "free");
    const serviceId = await seedService(db, uid);
    const result = await createAndConfirm(db, uid, serviceId, "default", SEPT_BASE);
    const summarySnap = await db.collection("users").doc(uid).collection("planUsage").doc("summary").get();
    assert.equal(summarySnap.data()?.bookingQuotaTimezone, DEFAULT_BUSINESS_TIMEZONE, "TZ1/TZ7: tenant legado/novo sem nenhum sinal prévio deve bootstrapar para DEFAULT_BUSINESS_TIMEZONE");
    assert.equal(summarySnap.data()?.bookingQuotaTimezoneSource, "default_brazil");
    assert.notEqual(summarySnap.data()?.bookingQuotaTimezone, "UTC", "TZ1/TZ7: nunca UTC como fallback silencioso");
    const monthKey = resolveBookingQuotaMonthKey(SEPT_BASE, DEFAULT_BUSINESS_TIMEZONE);
    assert.equal(await readConfirmedCount(db, uid, monthKey), 1, "TZ1: a própria confirmação já grava o doc mensal corretamente");
    void result;
    console.log("PASS TZ1/TZ7 fresh tenant bootstraps to DEFAULT_BUSINESS_TIMEZONE, never UTC");
  }

  // ===== TZ2 — timezone IANA válida é aceita (America/Manaus, diferente do default) via uniformidade de
  // ServiceResourceSchedule (§8 passo 2) =====
  {
    const uid = tenantUid("tz2");
    await seedPlan(db, uid, "free");
    const serviceId = await seedService(db, uid);
    const nowIso = new Date().toISOString();
    await db.collection("users").doc(uid).collection("serviceResourceSchedules").doc("default").set({
      id: "default", tenantUid: uid, resourceId: "default", timezone: "America/Manaus",
      slotStepMinutes: 30, minAdvanceMinutes: 0,
      weeklyHours: { sunday: [], monday: [{ start: "00:00", end: "23:59" }], tuesday: [{ start: "00:00", end: "23:59" }], wednesday: [{ start: "00:00", end: "23:59" }], thursday: [{ start: "00:00", end: "23:59" }], friday: [{ start: "00:00", end: "23:59" }], saturday: [] },
      createdAt: nowIso, updatedAt: nowIso,
    });
    await createAndConfirm(db, uid, serviceId, "default", SEPT_BASE);
    const summarySnap = await db.collection("users").doc(uid).collection("planUsage").doc("summary").get();
    assert.equal(summarySnap.data()?.bookingQuotaTimezone, "America/Manaus", "TZ2: uma timezone IANA válida vinda do único resource cadastrado deve ser aceita e usada");
    assert.equal(summarySnap.data()?.bookingQuotaTimezoneSource, "single_resource_timezone");
    console.log("PASS TZ2 valid IANA timezone (America/Manaus) accepted via single-resource bootstrap");
  }

  // ===== TZ5 — múltiplas timezones de recurso NÃO criam múltiplos meses de cota; tudo cai na MESMA
  // timezone de cota do tenant (o default, já que os 2 recursos discordam entre si) =====
  {
    const uid = tenantUid("tz5");
    await seedPlan(db, uid, "free");
    const serviceId = await seedService(db, uid);
    const nowIso = new Date().toISOString();
    const fullWeek = { sunday: [{ start: "00:00", end: "23:59" }], monday: [{ start: "00:00", end: "23:59" }], tuesday: [{ start: "00:00", end: "23:59" }], wednesday: [{ start: "00:00", end: "23:59" }], thursday: [{ start: "00:00", end: "23:59" }], friday: [{ start: "00:00", end: "23:59" }], saturday: [{ start: "00:00", end: "23:59" }] };
    await db.collection("users").doc(uid).collection("serviceResourceSchedules").doc("resource-a").set({
      id: "resource-a", tenantUid: uid, resourceId: "resource-a", timezone: "America/Sao_Paulo", slotStepMinutes: 30, minAdvanceMinutes: 0, weeklyHours: fullWeek, createdAt: nowIso, updatedAt: nowIso,
    });
    await db.collection("users").doc(uid).collection("serviceResourceSchedules").doc("resource-b").set({
      id: "resource-b", tenantUid: uid, resourceId: "resource-b", timezone: "America/Manaus", slotStepMinutes: 30, minAdvanceMinutes: 0, weeklyHours: fullWeek, createdAt: nowIso, updatedAt: nowIso,
    });
    // 2 timezones diferentes entre os recursos => bootstrap cai no passo 3 (default), não no passo 2.
    await createAndConfirm(db, uid, serviceId, "resource-a", SEPT_BASE);
    await createAndConfirm(db, uid, serviceId, "resource-b", hoursAfter(SEPT_BASE, 3));
    const summarySnap = await db.collection("users").doc(uid).collection("planUsage").doc("summary").get();
    assert.equal(summarySnap.data()?.bookingQuotaTimezoneSource, "default_brazil", "TZ5: recursos discordando em timezone não é erro, só significa que a uniformidade (passo 2) não se aplica");
    const monthKey = resolveBookingQuotaMonthKey(SEPT_BASE, DEFAULT_BUSINESS_TIMEZONE);
    assert.equal(await readConfirmedCount(db, uid, monthKey), 2, "TZ5: Bookings de AMBOS os recursos contam para o MESMO mês de cota do tenant");
    // Availability continua por recurso: confirma que os 2 schedules em si não foram alterados.
    const scheduleASnap = await db.collection("users").doc(uid).collection("serviceResourceSchedules").doc("resource-a").get();
    const scheduleBSnap = await db.collection("users").doc(uid).collection("serviceResourceSchedules").doc("resource-b").get();
    assert.equal(scheduleASnap.data()?.timezone, "America/Sao_Paulo", "TZ5: ServiceResourceSchedule.timezone do recurso A nunca é alterado pela cota");
    assert.equal(scheduleBSnap.data()?.timezone, "America/Manaus", "TZ5: ServiceResourceSchedule.timezone do recurso B nunca é alterado pela cota");
    console.log("PASS TZ5 multiple resource timezones share one tenant quota month; resource timezones themselves stay untouched");
  }

  // ===== TZ6 — client não pode alterar bookingQuotaTimezone diretamente (planUsage já é
  // allow read,write: if false desde PLAN-IMPL-02A2 — provado aqui com o client SDK real, não só lendo a
  // regra) =====
  {
    const appName = `tz6-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const clientApp = initializeApp({ apiKey: "demo-api-key", authDomain: "demo-revendasmart.firebaseapp.com", projectId: "demo-revendasmart", appId: `demo-${appName}` }, appName);
    try {
      const auth = getAuth(clientApp);
      const clientDb = getFirestore(clientApp);
      connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
      connectFirestoreEmulator(clientDb, "127.0.0.1", 8080);
      const credential = await createUserWithEmailAndPassword(auth, `${appName}@example.test`, "LocalTestPassword!123");
      const uid = credential.user.uid;
      await db.collection("users").doc(uid).collection("planUsage").doc("summary").set({ bookingQuotaTimezone: "America/Sao_Paulo", bookingQuotaTimezoneSource: "default_brazil", updatedAt: new Date().toISOString() });
      const ref = doc(clientDb, "users", uid, "planUsage", "summary");
      await assert.rejects(
        () => updateDoc(ref, { bookingQuotaTimezone: "Pacific/Kiritimati" }),
        (error: unknown) => { assert.equal((error as { code?: string }).code, "permission-denied"); return true; },
        "TZ6: owner não pode alterar bookingQuotaTimezone via updateDoc direto",
      );
      const monthRef = doc(clientDb, "users", uid, "planUsage", "bookings-2026-09");
      await assert.rejects(
        () => updateDoc(monthRef, { confirmedCount: 0 }),
        (error: unknown) => { assert.equal((error as { code?: string }).code, "permission-denied"); return true; },
        "TZ6/§44: owner não pode zerar confirmedCount de um doc mensal via updateDoc direto",
      );
      await deleteApp(clientApp);
    } catch (error) {
      await deleteApp(clientApp).catch(() => {});
      throw error;
    }
    console.log("PASS TZ6 client cannot mutate bookingQuotaTimezone or confirmedCount directly");
  }

  // ===== BQ1/BQ2 — Hold sozinho e Hold expirado nunca contam =====
  {
    const uid = tenantUid("bq1-2");
    await seedPlan(db, uid, "free");
    const serviceId = await seedService(db, uid);
    const holdOutcome = await createServiceBookingHoldCommand(db, uid, serviceId, "default", SEPT_BASE, undefined, `hold-${uid}-only`);
    if ("conflict" in holdOutcome) throw new Error("unexpected conflict");
    const monthKey = resolveBookingQuotaMonthKey(SEPT_BASE, DEFAULT_BUSINESS_TIMEZONE);
    assert.equal(await readConfirmedCount(db, uid, monthKey), 0, "BQ1: criar um Hold, sozinho, nunca consome cota");
    const monthDocSnap = await monthlyUsageDocRef(db, uid, monthKey).get();
    assert.equal(monthDocSnap.exists, false, "BQ1: nenhum doc mensal é sequer criado só por um Hold");

    // BQ2 — Hold já expirado (seedado diretamente, sem passar por createServiceBookingHoldCommand, já
    // que a checagem de expiração acontece ANTES de qualquer leitura de lock — nenhum lock precisa
    // existir para este caso especificamente).
    const expiredHoldId = `expired-${uid}`;
    const past = new Date(Date.now() - 3_600_000).toISOString();
    await db.collection("users").doc(uid).collection("bookingHolds").doc(expiredHoldId).set({
      id: expiredHoldId, tenantUid: uid, serviceId, resourceId: "default", startAt: SEPT_BASE, endAt: hoursAfter(SEPT_BASE, 1),
      status: "active", expiresAt: past, createdAt: past, idempotencyKey: `seed-hold-${expiredHoldId}`,
    });
    await assert.rejects(
      () => confirmServiceBookingHoldCommand(db, uid, expiredHoldId, `confirm-expired-${uid}`),
      (error: unknown) => { assert.ok(error instanceof ServiceBookingCommandError); assert.equal(error.code, "HOLD_EXPIRED"); return true; },
      "BQ2: confirmar um Hold expirado deve rejeitar",
    );
    assert.equal(await readConfirmedCount(db, uid, monthKey), 0, "BQ2: um Hold expirado nunca incrementa a cota, mesmo tentando confirmar");
    console.log("PASS BQ1/BQ2 Hold alone and expired Hold never count");
  }

  // ===== BQ3/BQ4 — Free: bookings #1..#20 confirmam, #21 é rejeitado =====
  const bq3uid = tenantUid("bq3-4");
  {
    await seedPlan(db, bq3uid, "free");
    const serviceId = await seedService(db, bq3uid);
    for (let i = 0; i < 20; i += 1) {
      await createAndConfirm(db, bq3uid, serviceId, "default", hoursAfter(SEPT_BASE, i * 3));
    }
    const monthKey = resolveBookingQuotaMonthKey(SEPT_BASE, DEFAULT_BUSINESS_TIMEZONE);
    assert.equal(await readConfirmedCount(db, bq3uid, monthKey), 20, "BQ3: 20 confirmações sucessivas no Free devem todas suceder");
    console.log("PASS BQ3 Free booking #1..#20 all confirm");

    await assert.rejects(
      () => createAndConfirm(db, bq3uid, serviceId, "default", hoursAfter(SEPT_BASE, 20 * 3)),
      (error: unknown) => { assert.ok(error instanceof ServiceBookingCommandError); assert.equal(error.code, "PLAN_BOOKING_LIMIT_REACHED"); return true; },
      "BQ4: a 21ª confirmação no Free deve ser rejeitada",
    );
    assert.equal(await readConfirmedCount(db, bq3uid, monthKey), 20, "BQ4: a contagem nunca ultrapassa 20 após a rejeição");
    console.log("PASS BQ4 Free booking #21 rejected, count stays 20");
  }

  // ===== BQ5/BQ6 — Pro/Premium não bloqueiam em 20, mas ainda contam =====
  for (const plan of ["pro", "premium"] as const) {
    const uid = tenantUid(`bq-${plan}`);
    await seedPlan(db, uid, plan);
    const serviceId = await seedService(db, uid);
    for (let i = 0; i < 21; i += 1) {
      await createAndConfirm(db, uid, serviceId, "default", hoursAfter(SEPT_BASE, i * 3));
    }
    const monthKey = resolveBookingQuotaMonthKey(SEPT_BASE, DEFAULT_BUSINESS_TIMEZONE);
    assert.equal(await readConfirmedCount(db, uid, monthKey), 21, `BQ5/BQ6 (${plan}): 21 confirmações devem todas suceder e a contagem real deve refletir 21 (fair use, nunca bloqueado, mas contado)`);
    console.log(`PASS BQ5/BQ6 ${plan} not blocked at 20, count still tracked accurately`);
  }

  // ===== BQ7 — cancelamento libera exatamente uma vaga =====
  {
    const monthKey = resolveBookingQuotaMonthKey(SEPT_BASE, DEFAULT_BUSINESS_TIMEZONE);
    // Pega o primeiro Booking confirmado de bq3uid para cancelar (id determinístico: booking-hold-bq3-4-...-1).
    const bookingsSnap = await db.collection("users").doc(bq3uid).collection("bookings").where("status", "==", "confirmed").limit(1).get();
    assert.equal(bookingsSnap.empty, false, "BQ7 setup: deve haver ao menos 1 Booking confirmado para cancelar");
    const bookingId = bookingsSnap.docs[0]!.id;
    await cancelServiceBookingCommand(db, bq3uid, bookingId, `cancel-bq7-${bq3uid}`);
    assert.equal(await readConfirmedCount(db, bq3uid, monthKey), 19, "BQ7: cancelar 1 Booking válido deve resultar em 19/20");
    await createAndConfirm(db, bq3uid, await seedService(db, bq3uid, "service-bq7"), "default", hoursAfter(SEPT_BASE, 30 * 3));
    assert.equal(await readConfirmedCount(db, bq3uid, monthKey), 20, "BQ7/§34: uma nova confirmação no mesmo mês deve ser permitida depois do cancelamento, voltando a 20/20");
    console.log("PASS BQ7 cancellation frees exactly one slot, allowing a new booking in the same month");
  }

  // ===== BQ8 — confirmação que falha por outro motivo nunca consome cota =====
  {
    const uid = tenantUid("bq8");
    await seedPlan(db, uid, "free");
    const monthKey = resolveBookingQuotaMonthKey(SEPT_BASE, DEFAULT_BUSINESS_TIMEZONE);
    await assert.rejects(
      () => confirmServiceBookingHoldCommand(db, uid, "hold-que-nao-existe", `confirm-bq8-${uid}`),
      (error: unknown) => { assert.ok(error instanceof ServiceBookingCommandError); assert.equal(error.code, "NOT_FOUND"); return true; },
      "BQ8 setup: confirmar um holdId inexistente deve falhar",
    );
    assert.equal(await readConfirmedCount(db, uid, monthKey), 0, "BQ8: uma falha de confirmação (por qualquer motivo) nunca incrementa a cota — transação inteira aborta");
    const monthDocSnap = await monthlyUsageDocRef(db, uid, monthKey).get();
    assert.equal(monthDocSnap.exists, false, "BQ8: nenhum doc mensal chega a ser criado por uma tentativa que falha");
    console.log("PASS BQ8 failed confirmation consumes zero quota");
  }

  // ===== BQ9/BQ10/BQ11/BQ12 — reschedule same-month / cross-month / target-full / atomic-fail =====
  {
    const uid = tenantUid("bq9-12");
    await seedPlan(db, uid, "free");
    const serviceId = await seedService(db, uid);
    const septMonthKey = resolveBookingQuotaMonthKey(SEPT_BASE, DEFAULT_BUSINESS_TIMEZONE);
    const octMonthKey = resolveBookingQuotaMonthKey(OCT_BASE, DEFAULT_BUSINESS_TIMEZONE);

    // BQ9 — reagendar dentro do MESMO mês não altera a contagem.
    const confirmed = await createAndConfirm(db, uid, serviceId, "default", SEPT_BASE);
    assert.equal(await readConfirmedCount(db, uid, septMonthKey), 1);
    await rescheduleServiceBookingCommand(db, uid, confirmed.bookingId, hoursAfter(SEPT_BASE, 5), `reschedule-bq9-${uid}`);
    assert.equal(await readConfirmedCount(db, uid, septMonthKey), 1, "BQ9: reagendar dentro do mesmo mês não deve alterar a contagem mensal");
    console.log("PASS BQ9 same-month reschedule keeps monthly count stable");

    // BQ10 — reagendar para OUTRO mês: setembro -1, outubro +1.
    await rescheduleServiceBookingCommand(db, uid, confirmed.bookingId, OCT_BASE, `reschedule-bq10-${uid}`);
    assert.equal(await readConfirmedCount(db, uid, septMonthKey), 0, "BQ10: setembro deve decrementar quando o Booking sai dele");
    assert.equal(await readConfirmedCount(db, uid, octMonthKey), 1, "BQ10: outubro deve incrementar quando o Booking chega nele");
    console.log("PASS BQ10 cross-month reschedule moves quota (old -1, new +1)");

    // BQ11/BQ12 — mês alvo cheio: preenche outubro até 20 (diretamente, só precisamos de Bookings
    // confirmados reais para o bootstrap contar — nenhum lock/schedule é necessário para ESTE fim
    // específico, já que não vamos tentar reservar esses horários via hold real).
    const octDocs = Array.from({ length: 20 }, (_, i) => ({
      id: `oct-filler-${i}`, tenantUid: uid, serviceId, resourceId: "filler",
      workId: `oct-filler-work-${i}`, startAt: hoursAfter(OCT_BASE, (i + 1) * 3), endAt: hoursAfter(OCT_BASE, (i + 1) * 3 + 1),
      status: "confirmed", source: "manual", createdAt: OCT_BASE, updatedAt: OCT_BASE,
    }));
    // O Booking já movido para outubro (BQ10) ocupa 1; +19 fillers = 20 no total, sem duplicar o doc já existente.
    await Promise.all(octDocs.slice(0, 19).map((entry) => db.collection("users").doc(uid).collection("bookings").doc(entry.id).set(entry)));
    // Força o doc mensal de outubro a refletir os 20 reais (o doc já existe desde BQ10 com count=1; deletar
    // para deixar o próximo acesso re-bootstrapar do zero a partir dos Bookings reais agora existentes).
    await monthlyUsageDocRef(db, uid, octMonthKey).delete();
    assert.equal(await recountBookingMonthUsage(db, uid, octMonthKey, DEFAULT_BUSINESS_TIMEZONE), 20, "BQ11 setup: outubro deve ter exatamente 20 Bookings confirmados reais");

    // Um segundo Booking, ainda em setembro, tentando mover PARA outubro (que já está cheio).
    const secondBooking = await createAndConfirm(db, uid, serviceId, "default", hoursAfter(SEPT_BASE, 50));
    const secondBookingSnapBefore = await db.collection("users").doc(uid).collection("bookings").doc(secondBooking.bookingId).get();
    await assert.rejects(
      () => rescheduleServiceBookingCommand(db, uid, secondBooking.bookingId, hoursAfter(OCT_BASE, 200), `reschedule-bq11-${uid}`),
      (error: unknown) => { assert.ok(error instanceof ServiceBookingCommandError); assert.equal(error.code, "PLAN_BOOKING_LIMIT_REACHED"); return true; },
      "BQ11: reagendar para um mês-alvo já cheio deve ser rejeitado",
    );
    // §22/§27 — uma transação REJEITADA nunca persiste nada (nem o bootstrap do mês outubro, que só
    // teria sido gravado na fase de escrita, nunca alcançada) — por isso a verificação real é sobre os
    // Bookings de outubro em si (recountBookingMonthUsage), não sobre um doc de cache que a própria
    // rejeição legitimamente nunca chega a criar/atualizar.
    assert.equal(await recountBookingMonthUsage(db, uid, octMonthKey, DEFAULT_BUSINESS_TIMEZONE), 20, "BQ11: outubro permanece exatamente em 20 Bookings reais confirmados, nunca 21");
    const secondBookingSnapAfter = await db.collection("users").doc(uid).collection("bookings").doc(secondBooking.bookingId).get();
    assert.deepEqual(secondBookingSnapAfter.data()?.startAt, secondBookingSnapBefore.data()?.startAt, "BQ12: o Booking original permanece INTOCADO (mesmo startAt) após a falha atômica");
    console.log("PASS BQ11/BQ12 full target month rejects reschedule atomically, original booking untouched");
  }

  // ===== BQ13 — confirmações concorrentes nunca ultrapassam 20 =====
  {
    const uid = tenantUid("bq13");
    await seedPlan(db, uid, "free");
    const serviceId = await seedService(db, uid);
    for (let i = 0; i < 19; i += 1) {
      await createAndConfirm(db, uid, serviceId, "default", hoursAfter(SEPT_BASE, i * 3));
    }
    const monthKey = resolveBookingQuotaMonthKey(SEPT_BASE, DEFAULT_BUSINESS_TIMEZONE);
    assert.equal(await readConfirmedCount(db, uid, monthKey), 19);

    const holdA = await createServiceBookingHoldCommand(db, uid, serviceId, "resource-a", hoursAfter(SEPT_BASE, 100), undefined, `hold-bq13-a-${uid}`);
    const holdB = await createServiceBookingHoldCommand(db, uid, serviceId, "resource-b", hoursAfter(SEPT_BASE, 100), undefined, `hold-bq13-b-${uid}`);
    if ("conflict" in holdA || "conflict" in holdB) throw new Error("unexpected hold conflict in BQ13 setup");
    const results = await Promise.allSettled([
      confirmServiceBookingHoldCommand(db, uid, holdA.holdId, `confirm-bq13-a-${uid}`),
      confirmServiceBookingHoldCommand(db, uid, holdB.holdId, `confirm-bq13-b-${uid}`),
    ]);
    const succeeded = results.filter((r) => r.status === "fulfilled").length;
    const limitRejected = results.filter((r) => r.status === "rejected" && r.reason instanceof ServiceBookingCommandError && r.reason.code === "PLAN_BOOKING_LIMIT_REACHED").length;
    assert.equal(succeeded, 1, "BQ13: exatamente 1 confirmação concorrente deve suceder");
    assert.equal(limitRejected, 1, "BQ13: exatamente 1 deve ser rejeitada por PLAN_BOOKING_LIMIT_REACHED");
    assert.equal(await readConfirmedCount(db, uid, monthKey), 20, "BQ13: a contagem final deve ser exatamente 20, nunca 21");
    console.log("PASS BQ13 concurrent Free confirmations cannot exceed 20");
  }

  // ===== BQ14 — replay idempotente não conta duas vezes =====
  {
    const uid = tenantUid("bq14");
    await seedPlan(db, uid, "free");
    const serviceId = await seedService(db, uid);
    const holdOutcome = await createServiceBookingHoldCommand(db, uid, serviceId, "default", SEPT_BASE, undefined, `hold-bq14-${uid}`);
    if ("conflict" in holdOutcome) throw new Error("unexpected conflict");
    const key = `confirm-bq14-${uid}`;
    const first = await confirmServiceBookingHoldCommand(db, uid, holdOutcome.holdId, key);
    const replay = await confirmServiceBookingHoldCommand(db, uid, holdOutcome.holdId, key);
    assert.equal(first.idempotentReplay, false);
    assert.equal(replay.idempotentReplay, true);
    assert.equal(replay.bookingId, first.bookingId);
    const monthKey = resolveBookingQuotaMonthKey(SEPT_BASE, DEFAULT_BUSINESS_TIMEZONE);
    assert.equal(await readConfirmedCount(db, uid, monthKey), 1, "BQ14: replay da mesma idempotencyKey nunca incrementa a cota uma segunda vez");
    console.log("PASS BQ14 idempotent confirmation replay does not double count");
  }

  // ===== BQ15 — Booking completado continua contado (por construção: Booking.status só tem
  // "confirmed"|"cancelled" — completar o Work nunca toca Booking.status nem a cota) =====
  {
    const uid = tenantUid("bq15");
    await seedPlan(db, uid, "free");
    const serviceId = await seedService(db, uid);
    const confirmed = await createAndConfirm(db, uid, serviceId, "default", SEPT_BASE);
    const monthKey = resolveBookingQuotaMonthKey(SEPT_BASE, DEFAULT_BUSINESS_TIMEZONE);
    assert.equal(await readConfirmedCount(db, uid, monthKey), 1);
    // "Completar" o atendimento é uma transição de ServiceWork.status, nunca de Booking.status — nenhum
    // comando deste domínio precisa ser chamado aqui para provar isso; a própria ausência de qualquer
    // caminho de código que decremente ao completar já é a garantia estrutural.
    await db.collection("users").doc(uid).collection("serviceWorks").doc(confirmed.workId).update({ status: "completed", startedAt: SEPT_BASE, completedAt: hoursAfter(SEPT_BASE, 1), updatedAt: hoursAfter(SEPT_BASE, 1) });
    assert.equal(await readConfirmedCount(db, uid, monthKey), 1, "BQ15: completar o Work correspondente nunca decrementa a cota — Booking.status nunca muda para 'completed' (só existe 'confirmed'|'cancelled')");
    console.log("PASS BQ15 completed booking stays counted (structural — no code path touches quota on completion)");
  }

  // ===== BQ16/BQ17 — downgrade no meio do mês preserva a contagem e bloqueia o próximo =====
  {
    const uid = tenantUid("bq16-17");
    await seedPlan(db, uid, "pro");
    const serviceId = await seedService(db, uid);
    for (let i = 0; i < 27; i += 1) {
      await createAndConfirm(db, uid, serviceId, "default", hoursAfter(SEPT_BASE, i * 3));
    }
    const monthKey = resolveBookingQuotaMonthKey(SEPT_BASE, DEFAULT_BUSINESS_TIMEZONE);
    assert.equal(await readConfirmedCount(db, uid, monthKey), 27, "BQ16 setup: 27 confirmados no Pro");

    await seedPlan(db, uid, "free"); // downgrade no meio do mês
    assert.equal(await readConfirmedCount(db, uid, monthKey), 27, "BQ16: downgrade sozinho nunca altera a contagem existente — 0 cancelados, 0 alterados");

    await assert.rejects(
      () => createAndConfirm(db, uid, serviceId, "default", hoursAfter(SEPT_BASE, 100)),
      (error: unknown) => { assert.ok(error instanceof ServiceBookingCommandError); assert.equal(error.code, "PLAN_BOOKING_LIMIT_REACHED"); return true; },
      "BQ17: com 27 >= 20 depois do downgrade, a próxima confirmação no mesmo mês deve ser bloqueada",
    );
    assert.equal(await readConfirmedCount(db, uid, monthKey), 27, "BQ17: a tentativa rejeitada não altera a contagem");
    console.log("PASS BQ16/BQ17 downgrade mid-month preserves existing count and blocks the next create");
  }

  // ===== BQ18 — upgrade libera criação imediatamente, sem resetar a contagem =====
  {
    const uid = tenantUid("bq18");
    await seedPlan(db, uid, "free");
    const serviceId = await seedService(db, uid);
    for (let i = 0; i < 20; i += 1) {
      await createAndConfirm(db, uid, serviceId, "default", hoursAfter(SEPT_BASE, i * 3));
    }
    const monthKey = resolveBookingQuotaMonthKey(SEPT_BASE, DEFAULT_BUSINESS_TIMEZONE);
    assert.equal(await readConfirmedCount(db, uid, monthKey), 20);
    await seedPlan(db, uid, "pro"); // upgrade
    await createAndConfirm(db, uid, serviceId, "default", hoursAfter(SEPT_BASE, 100));
    assert.equal(await readConfirmedCount(db, uid, monthKey), 21, "BQ18: upgrade deve permitir a próxima confirmação IMEDIATAMENTE, contagem continua de onde estava (nunca reseta a 1)");
    console.log("PASS BQ18 upgrade immediately unlocks creation, count never resets");
  }

  // ===== BQ19 — um novo mês começa com uso independente =====
  {
    const uid = tenantUid("bq19");
    await seedPlan(db, uid, "free");
    const serviceId = await seedService(db, uid);
    await createAndConfirm(db, uid, serviceId, "default", SEPT_BASE);
    const septMonthKey = resolveBookingQuotaMonthKey(SEPT_BASE, DEFAULT_BUSINESS_TIMEZONE);
    const octMonthKey = resolveBookingQuotaMonthKey(OCT_BASE, DEFAULT_BUSINESS_TIMEZONE);
    assert.equal(await readConfirmedCount(db, uid, septMonthKey), 1);
    assert.equal(await readConfirmedCount(db, uid, octMonthKey), 0, "BQ19: outubro começa em 0, mesmo com setembro em uso — nenhum cron/reset job, só um doc por mês naturalmente");
    await createAndConfirm(db, uid, serviceId, "default", OCT_BASE);
    assert.equal(await readConfirmedCount(db, uid, septMonthKey), 1, "BQ19: confirmar em outubro nunca afeta setembro");
    assert.equal(await readConfirmedCount(db, uid, octMonthKey), 1);
    console.log("PASS BQ19 new calendar month starts with independent usage");
  }

  // ===== BQ20 — isolamento entre tenants =====
  {
    const uidA = tenantUid("bq20-a");
    const uidB = tenantUid("bq20-b");
    await seedPlan(db, uidA, "free");
    await seedPlan(db, uidB, "free");
    const serviceA = await seedService(db, uidA);
    const serviceB = await seedService(db, uidB);
    for (let i = 0; i < 20; i += 1) {
      await createAndConfirm(db, uidA, serviceA, "default", hoursAfter(SEPT_BASE, i * 3));
    }
    for (let i = 0; i < 5; i += 1) {
      await createAndConfirm(db, uidB, serviceB, "default", hoursAfter(SEPT_BASE, i * 3));
    }
    const monthKey = resolveBookingQuotaMonthKey(SEPT_BASE, DEFAULT_BUSINESS_TIMEZONE);
    assert.equal(await readConfirmedCount(db, uidA, monthKey), 20, "BQ20: tenant A no limite");
    assert.equal(await readConfirmedCount(db, uidB, monthKey), 5, "BQ20: tenant B com uso totalmente independente");
    // A confirmação seguinte de B nunca é afetada pelo esgotamento de A.
    await createAndConfirm(db, uidB, serviceB, "default", hoursAfter(SEPT_BASE, 100));
    assert.equal(await readConfirmedCount(db, uidB, monthKey), 6, "BQ20: tenant A esgotado nunca bloqueia tenant B");
    console.log("PASS BQ20 tenant isolation holds under real confirmations");
  }

  // ===== §53 — bootstrap de dados legados: 18 Bookings confirmados pré-existentes, SEM doc mensal,
  // confirmar mais um deve bootstrapar para 18 e então ir para 19 (nunca resetar a 1) =====
  {
    const uid = tenantUid("legacy18");
    await seedPlan(db, uid, "pro"); // Pro para não ser bloqueado pelo bootstrap de 18 (bem abaixo de 20 de qualquer forma)
    const serviceId = await seedService(db, uid);
    const legacyDocs = Array.from({ length: 18 }, (_, i) => ({
      id: `legacy-${i}`, tenantUid: uid, serviceId, resourceId: "legacy",
      workId: `legacy-work-${i}`, startAt: hoursAfter(SEPT_BASE, i), endAt: hoursAfter(SEPT_BASE, i + 1),
      status: "confirmed", source: "manual", createdAt: SEPT_BASE, updatedAt: SEPT_BASE,
    }));
    await Promise.all(legacyDocs.map((entry) => db.collection("users").doc(uid).collection("bookings").doc(entry.id).set(entry)));
    const monthKey = resolveBookingQuotaMonthKey(SEPT_BASE, DEFAULT_BUSINESS_TIMEZONE);
    const monthDocBefore = await monthlyUsageDocRef(db, uid, monthKey).get();
    assert.equal(monthDocBefore.exists, false, "§53 setup: nenhum doc mensal deve existir ainda para dados legados");

    await createAndConfirm(db, uid, serviceId, "default", hoursAfter(SEPT_BASE, 50));
    assert.equal(await readConfirmedCount(db, uid, monthKey), 19, "§53: bootstrap deve contar os 18 legados + a nova confirmação = 19, nunca resetar a 1");
    console.log("PASS §53 legacy data bootstrap counts pre-existing confirmed bookings correctly (18 -> 19, never reset to 1)");
  }

  // ===== §54 — bootstrap de dados legados ACIMA do limite: 25 legados no Free, nova tentativa rejeitada,
  // os 25 permanecem intocados =====
  {
    const uid = tenantUid("legacy25");
    await seedPlan(db, uid, "free");
    const serviceId = await seedService(db, uid);
    const legacyDocs = Array.from({ length: 25 }, (_, i) => ({
      id: `legacy25-${i}`, tenantUid: uid, serviceId, resourceId: "legacy",
      workId: `legacy25-work-${i}`, startAt: hoursAfter(SEPT_BASE, i), endAt: hoursAfter(SEPT_BASE, i + 1),
      status: "confirmed", source: "manual", createdAt: SEPT_BASE, updatedAt: SEPT_BASE,
    }));
    await Promise.all(legacyDocs.map((entry) => db.collection("users").doc(uid).collection("bookings").doc(entry.id).set(entry)));

    await assert.rejects(
      () => createAndConfirm(db, uid, serviceId, "default", hoursAfter(SEPT_BASE, 50)),
      (error: unknown) => { assert.ok(error instanceof ServiceBookingCommandError); assert.equal(error.code, "PLAN_BOOKING_LIMIT_REACHED"); return true; },
      "§54: bootstrap deve detectar 25 >= 20 (Free) e rejeitar a nova confirmação",
    );
    const bookingsSnap = await db.collection("users").doc(uid).collection("bookings").get();
    assert.equal(bookingsSnap.size, 25, "§54: os 25 Bookings legados permanecem intocados (nenhum criado a mais, nenhum apagado)");
    const monthKey = resolveBookingQuotaMonthKey(SEPT_BASE, DEFAULT_BUSINESS_TIMEZONE);
    // §22/§27 — mesma razão do BQ11: uma confirmação REJEITADA nunca persiste o doc mensal bootstrapado
    // (a escrita só aconteceria na fase de escrita, nunca alcançada) — a verificação real é sobre os
    // Bookings legados em si, nunca sobre um doc de cache que a rejeição legitimamente não cria.
    assert.equal(await recountBookingMonthUsage(db, uid, monthKey, DEFAULT_BUSINESS_TIMEZONE), 25, "§54: os 25 Bookings legados reais continuam contando 25, não são resetados pela rejeição");
    console.log("PASS §54 legacy over-limit bootstrap rejects new booking, existing 25 untouched");
  }

  // ===== §55 — diagnóstico de recontagem: independente do que o doc mensal diz, recountBookingMonthUsage
  // sempre recalcula do zero a partir dos Bookings reais =====
  {
    const uid = tenantUid("recount");
    const serviceId = "svc-recount";
    const monthKey = "2026-09";
    const docs = [
      { id: "r1", status: "confirmed" }, { id: "r2", status: "confirmed" }, { id: "r3", status: "cancelled" },
    ];
    await Promise.all(docs.map((entry, i) => db.collection("users").doc(uid).collection("bookings").doc(entry.id).set({
      id: entry.id, tenantUid: uid, serviceId, resourceId: "r", workId: `${entry.id}-work`,
      startAt: hoursAfter(SEPT_BASE, i), endAt: hoursAfter(SEPT_BASE, i + 1), status: entry.status, source: "manual", createdAt: SEPT_BASE, updatedAt: SEPT_BASE,
    })));
    // Doc mensal deliberadamente errado (simulando drift) — recountBookingMonthUsage nunca confia nele.
    await monthlyUsageDocRef(db, uid, monthKey).set({ monthKey, timezone: DEFAULT_BUSINESS_TIMEZONE, confirmedCount: 999, initializedAt: SEPT_BASE, updatedAt: SEPT_BASE });
    const recount = await recountBookingMonthUsage(db, uid, monthKey, DEFAULT_BUSINESS_TIMEZONE);
    assert.equal(recount, 2, "§55: recountBookingMonthUsage deve ignorar o doc (999) e contar os Bookings reais confirmados (2 de 3, o terceiro está cancelled)");
    console.log("PASS §55 recountBookingMonthUsage diagnostic recomputes from real data, ignoring stale doc");
  }

  console.log("PLAN-IMPL-02C integration tests passed: TZ1-TZ7, BQ1-BQ20, legacy bootstrap (§53/§54), recount diagnostic (§55).");
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
