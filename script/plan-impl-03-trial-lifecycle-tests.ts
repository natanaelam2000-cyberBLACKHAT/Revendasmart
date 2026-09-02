import assert from "node:assert/strict";
import { initializeApp, deleteApp } from "firebase/app";
import { getAuth, connectAuthEmulator, createUserWithEmailAndPassword } from "firebase/auth";
import { connectFirestoreEmulator, doc, getFirestore, setDoc, updateDoc } from "firebase/firestore";
import { initializeFirebaseAdmin } from "../server/firebase-admin-init";
import {
  TRIAL_ELIGIBILITY_SINCE,
  computeTrialGrantFields,
  ensurePlanLifecycleCurrent,
  initializePlanCommand,
  isNewEligibleUserForTrial,
} from "../server/plan-lifecycle";
import { syncPlanDataFromSubscriptionForTests } from "../server/subscriptions";
import {
  createServiceBookingHoldCommand,
  confirmServiceBookingHoldCommand,
  ServiceBookingCommandError,
} from "../server/service-booking-commands";
import { recountBookingMonthUsage, resolveBookingQuotaMonthKey, DEFAULT_BUSINESS_TIMEZONE } from "../server/booking-quota";
import {
  PLAN_CONFIG,
  TRIAL_DURATION_DAYS,
  isTrialCurrentlyActive,
  resolveBaseCommercialPlan,
  resolveCommercialPlan,
  type PlanData,
} from "../shared/monetization";
import type { Firestore as AdminFirestore } from "firebase-admin/firestore";

/**
 * PLAN-IMPL-03 — trial Premium de 7 dias + lifecycle unificado. Segue as convenções já estabelecidas
 * pelos scripts PLAN-IMPL-02*: pure tests primeiro (sem Firestore), depois integração real contra o
 * emulador, sempre contra as funções REAIS deste ticket, nunca uma reimplementação em código de teste.
 *
 * Nenhum usuário Firebase Auth real é necessário para a maior parte destes testes: initializePlanCommand/
 * computeTrialGrantFields/ensurePlanLifecycleCurrent recebem `authUserCreationTimeIso`/`now` como
 * parâmetros explícitos (§50 — nenhuma data hardcoded, tudo injetável), então um ISO string fabricado é
 * suficiente e determinístico. Só o teste de segurança (X1, ao final) precisa de um usuário Auth real,
 * pelo mesmo motivo já estabelecido em PLAN-IMPL-02B1: provar a negação de Rules exige um client SDK
 * autenticado como o PRÓPRIO dono, não Admin SDK (que ignora Rules por completo).
 */

process.env.FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || "demo-revendasmart";
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || "127.0.0.1:9099";

function requireEmulatorEnv() {
  assert.equal(process.env.FIREBASE_PROJECT_ID, "demo-revendasmart");
  assert.equal(process.env.FIRESTORE_EMULATOR_HOST, "127.0.0.1:8080");
  assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, "127.0.0.1:9099");
}

function tenantUid(prefix = "p3"): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const CUTOVER = TRIAL_ELIGIBILITY_SINCE;
const AFTER_CUTOVER = new Date(Date.parse(CUTOVER) + DAY_MS).toISOString(); // conta "nova" de verdade
const BEFORE_CUTOVER = new Date(Date.parse(CUTOVER) - 30 * DAY_MS).toISOString(); // conta legada

function planRef(db: AdminFirestore, uid: string) {
  return db.collection("users").doc(uid).collection("planData").doc("main");
}
async function readPlan(db: AdminFirestore, uid: string): Promise<PlanData | null> {
  const snap = await planRef(db, uid).get();
  return snap.exists ? (snap.data() as PlanData) : null;
}

function asDate(value: unknown): Date {
  if (value instanceof Date) return value;
  if (typeof value === "string") return new Date(value);
  if (value && typeof value === "object" && "toDate" in value && typeof (value as { toDate?: unknown }).toDate === "function") {
    return (value as { toDate: () => Date }).toDate();
  }
  throw new Error(`Expected Date-compatible value, got ${typeof value}`);
}

// ===================================================================================================
// PURE TESTS — sem Firestore.
// ===================================================================================================
function runPureTests(): void {
  // §10/T11 — elegibilidade de conta nova: só o timestamp do Firebase Auth decide, comparado ao corte.
  assert.equal(isNewEligibleUserForTrial(AFTER_CUTOVER, CUTOVER), true, "conta criada depois do corte é elegível");
  assert.equal(isNewEligibleUserForTrial(BEFORE_CUTOVER, CUTOVER), false, "conta legada (antes do corte) nunca é elegível");
  assert.equal(isNewEligibleUserForTrial(CUTOVER, CUTOVER), true, "exatamente no instante do corte conta como elegível (>=, não >)");
  assert.equal(isNewEligibleUserForTrial(undefined, CUTOVER), false, "sem creationTime (Auth lookup falhou) nunca é elegível");
  assert.equal(isNewEligibleUserForTrial("not-a-date", CUTOVER), false, "creationTime inválido nunca é elegível");

  // T2 — duração exata do trial concedido.
  const nowIso = "2026-09-10T12:00:00.000Z";
  const fields = computeTrialGrantFields(AFTER_CUTOVER, nowIso, CUTOVER);
  assert.equal(fields.trialStatus, "active");
  assert.equal(fields.trialGrantedPlan, "premium");
  assert.equal((fields.trialStartedAt as Date).toISOString(), nowIso);
  const expectedEndsAt = new Date(Date.parse(nowIso) + TRIAL_DURATION_DAYS * DAY_MS).toISOString();
  assert.equal((fields.trialEndsAt as Date).toISOString(), expectedEndsAt, "T2: trialEndsAt deve ser exatamente TRIAL_DURATION_DAYS (7) depois de trialStartedAt");

  // §7 — conta não elegível: nenhum campo é devolvido (nunca um trialStatus:'ineligible' gravado em massa).
  assert.deepEqual(computeTrialGrantFields(BEFORE_CUTOVER, nowIso, CUTOVER), {}, "conta legada não deve receber nenhum campo de trial");

  // §16/T12 — fronteira exata do relógio: um milissegundo antes/depois de trialEndsAt já muda o resultado.
  const activeTrialData: PlanData = { ...basePlanData("free"), trialStatus: "active", trialEndsAt: new Date("2026-09-17T12:00:00.000Z") };
  assert.equal(isTrialCurrentlyActive(activeTrialData, new Date("2026-09-17T11:59:59.999Z")), true, "1ms antes de trialEndsAt ainda é ativo");
  assert.equal(isTrialCurrentlyActive(activeTrialData, new Date("2026-09-17T12:00:00.000Z")), false, "exatamente em trialEndsAt já não é mais ativo");
  assert.equal(isTrialCurrentlyActive({ ...activeTrialData, trialStatus: "expired" }, new Date("2026-09-10T00:00:00.000Z")), false, "trialStatus!='active' nunca conta, mesmo com now bem antes de trialEndsAt");
  assert.equal(isTrialCurrentlyActive({ ...activeTrialData, trialStatus: "converted" }, new Date("2026-09-10T00:00:00.000Z")), false, "C6: trialStatus='converted' nunca reaparece como ativo, mesmo antes de trialEndsAt");
  assert.equal(isTrialCurrentlyActive(null, new Date()), false);

  // C1/C2/C3/§14 — trial ativo sempre vence sobre QUALQUER plano base.
  const activeNow = new Date("2026-09-10T00:00:00.000Z");
  const trialWindow = { trialStatus: "active" as const, trialEndsAt: new Date("2026-09-17T00:00:00.000Z") };
  assert.equal(resolveCommercialPlan({ ...basePlanData("free"), ...trialWindow }, activeNow), "premium", "C1: free + trial ativo => premium");
  assert.equal(resolveCommercialPlan({ ...basePlanData("pro"), ...trialWindow }, activeNow), "premium", "C2: pro + trial ativo => premium");
  assert.equal(resolveCommercialPlan({ ...basePlanData("premium"), ...trialWindow }, activeNow), "premium", "C3: premium (assinatura real) + trial ativo => continua premium");

  // T13/T14/§14 — trial expirado (pelo relógio) sempre volta para o plano BASE, nunca Free incondicional.
  const afterExpiry = new Date("2026-09-20T00:00:00.000Z");
  assert.equal(resolveCommercialPlan({ ...basePlanData("free"), ...trialWindow }, afterExpiry), "free", "T13: base free + trial expirado => free");
  assert.equal(resolveCommercialPlan({ ...basePlanData("pro"), ...trialWindow }, afterExpiry), "pro", "T14: base pro + trial expirado => pro (nunca free)");

  // §4 — resolveBaseCommercialPlan ignora trial por completo, mesmo com trial ativo.
  assert.equal(resolveBaseCommercialPlan({ ...basePlanData("free"), ...trialWindow }), "free", "basePlan nunca é mascarado pelo trial");

  console.log("PLAN-IMPL-03 pure tests passed: elegibilidade de conta nova, duração exata do trial, fronteira de relógio, precedência trial-vs-base (C1-C3, T13-T14), basePlan nunca mascarado.");
}

function basePlanData(currentPlan: "free" | "pro" | "premium"): PlanData {
  return {
    currentPlan, premiumActive: currentPlan === "premium", premiumExpiresAt: null, premiumStartedAt: null,
    premiumSource: null, referralCode: "X", referralCount: 0, updatedAt: new Date(),
    subscriptionId: null, subscriptionStatus: null, subscriptionPlanId: null, autoRenew: false,
    lastPaymentAt: null, nextBillingAt: null, canceledAt: null, paymentStatus: null,
  };
}

// ===================================================================================================
// INTEGRATION — emulador real, sempre pelas funções reais.
// ===================================================================================================
async function seedProducts(db: AdminFirestore, uid: string, count: number): Promise<void> {
  await Promise.all(Array.from({ length: count }, (_, i) =>
    db.collection("users").doc(uid).collection("products").doc(`prod-${i}`).set({ id: `prod-${i}`, name: `P${i}`, salePrice: 10, stock: 1 })));
}
async function seedServices(db: AdminFirestore, uid: string, count: number): Promise<void> {
  const nowIso = new Date().toISOString();
  await Promise.all(Array.from({ length: count }, (_, i) =>
    db.collection("users").doc(uid).collection("services").doc(`svc-${i}`).set({
      id: `svc-${i}`, tenantUid: uid, name: `S${i}`, active: true, published: true,
      pricing: { mode: "fixed", priceCents: 1000 }, cost: { kind: "unknown" }, bookingMode: "instant",
      createdAt: nowIso, updatedAt: nowIso,
    })));
}
async function countByAccessState(db: AdminFirestore, uid: string, domain: "products" | "services"): Promise<{ active: number; preserved: number; total: number }> {
  const snap = await db.collection("users").doc(uid).collection(domain).get();
  let preserved = 0;
  for (const d of snap.docs) if (d.data().planAccessState === "preserved") preserved += 1;
  return { active: snap.size - preserved, preserved, total: snap.size };
}

async function run(): Promise<void> {
  runPureTests();

  requireEmulatorEnv();
  initializeFirebaseAdmin();
  const db = initializeFirebaseAdmin().firestore();

  // ===== T1/T3/T4 — signup elegível real: initializePlanCommand concede trial, basePlan nunca muda,
  // effectivePlan já reflete o trial via ensurePlanLifecycleCurrent. =====
  {
    const uid = tenantUid("t1");
    await initializePlanCommand(db, uid, AFTER_CUTOVER, "2026-09-10T00:00:00.000Z", CUTOVER);
    const plan = await readPlan(db, uid);
    assert.equal(plan?.trialStatus, "active", "T1: conta nova elegível deve sair do initialize com trial ativo");
    assert.equal(plan?.currentPlan, "free", "T3: basePlan (currentPlan) nunca é escrito como premium pelo trial");
    assert.equal(plan?.premiumActive, false, "T3: premiumActive continua false — trial nunca toca o plano base");

    const lifecycle = await ensurePlanLifecycleCurrent(db, uid, new Date("2026-09-11T00:00:00.000Z"));
    assert.equal(lifecycle.basePlan, "free", "T3: basePlan resolvido também mostra free");
    assert.equal(lifecycle.effectivePlan, "premium", "T4: effectivePlan já é premium durante o trial");
    assert.equal(lifecycle.trial?.status, "active");
    console.log("PASS T1/T3/T4 new eligible signup grants trial without touching base plan; effective plan is premium");
  }

  // ===== T7 — replay idempotente: segunda chamada de initializePlanCommand não reinicia nem altera o trial. =====
  {
    const uid = tenantUid("t7");
    await initializePlanCommand(db, uid, AFTER_CUTOVER, "2026-09-10T00:00:00.000Z", CUTOVER);
    const first = await readPlan(db, uid);
    await initializePlanCommand(db, uid, AFTER_CUTOVER, "2026-09-15T00:00:00.000Z", CUTOVER); // now bem diferente
    const second = await readPlan(db, uid);
    assert.equal(asDate(second?.trialEndsAt).getTime(), asDate(first?.trialEndsAt).getTime(), "T7: replay não deve mudar trialEndsAt, mesmo com um `now` diferente na segunda chamada");
    console.log("PASS T7 repeated initialize is idempotent, never restarts the trial window");
  }

  // ===== T8 — duas chamadas concorrentes para o MESMO uid novo produzem exatamente UM trial, com o
  // MESMO trialStartedAt/trialEndsAt (tx.create() garante — a perdedora vê o doc já existente). =====
  {
    const uid = tenantUid("t8");
    const now = "2026-09-10T00:00:00.000Z";
    await Promise.all([
      initializePlanCommand(db, uid, AFTER_CUTOVER, now, CUTOVER),
      initializePlanCommand(db, uid, AFTER_CUTOVER, now, CUTOVER),
    ]);
    const plan = await readPlan(db, uid);
    assert.equal(plan?.trialStatus, "active");
    const endsAtMs = asDate(plan?.trialEndsAt).getTime();
    assert.equal(endsAtMs, Date.parse(now) + TRIAL_DURATION_DAYS * DAY_MS, "T8: mesmo sob concorrência, só uma janela de trial existe, com trialEndsAt correto");
    console.log("PASS T8 concurrent initialize for the same new uid converges to exactly one trial window");
  }

  // ===== T11 — conta legada (creationTime antes do corte) nunca recebe trial, mesmo passando pelo
  // caminho real de initializePlanCommand. =====
  {
    const uid = tenantUid("t11");
    await initializePlanCommand(db, uid, BEFORE_CUTOVER, "2026-09-10T00:00:00.000Z", CUTOVER);
    const plan = await readPlan(db, uid);
    assert.equal(plan?.trialStatus, undefined, "T11: conta legada não deve ter nenhum campo de trial gravado");
    assert.equal(plan?.currentPlan, "free", "T11: ainda assim inicializada normalmente como Free");
    console.log("PASS T11 legacy account (creationTime before cutover) never receives a trial via the real initialize path");
  }

  const SEPT_10 = "2026-09-10T00:00:00.000Z";
  const SEPT_20 = "2026-09-20T00:00:00.000Z"; // > 7 dias depois — trial expirado por relógio

  // ===== R1 — 100 Products sob trial (effective premium, sem limite baixo) expiram para Free (30):
  // 30 active/70 preserved, NENHUM apagado. Prova ensurePlanLifecycleCurrent como primeiro chamador real
  // de reconcilePlanAccess (o próprio cabeçalho de plan-access-reconciliation.ts previa isto). =====
  {
    const uid = tenantUid("r1");
    await initializePlanCommand(db, uid, AFTER_CUTOVER, SEPT_10, CUTOVER);
    await seedProducts(db, uid, 100);
    // Enquanto o trial está ativo, o effectivePlan é premium (ilimitado) — nenhuma reconciliação
    // deveria ter rebaixado nada ainda.
    await ensurePlanLifecycleCurrent(db, uid, new Date("2026-09-11T00:00:00.000Z"));
    const duringTrial = await countByAccessState(db, uid, "products");
    assert.equal(duringTrial.preserved, 0, "R1: durante o trial (premium efetivo), nenhum produto deve estar preserved");

    const afterExpiry = await ensurePlanLifecycleCurrent(db, uid, new Date(SEPT_20));
    assert.equal(afterExpiry.effectivePlan, "free", "R1: 7 dias depois, effectivePlan já caiu para o base (free)");
    assert.equal(afterExpiry.trial?.status, "expired", "§22: trialStatus deve ser materializado como 'expired' na mesma passagem");
    const after = await countByAccessState(db, uid, "products");
    assert.deepEqual({ active: after.active, preserved: after.preserved, total: after.total }, { active: PLAN_CONFIG.free.limits.products, preserved: 100 - PLAN_CONFIG.free.limits.products, total: 100 }, "R1: exatamente 30 active/70 preserved, nenhum documento apagado");
    console.log("PASS R1 100 products under trial correctly partition to 30 active / 70 preserved on trial expiry, zero deleted");
  }

  // ===== R2 — mesma garantia para Services (limite 5). =====
  {
    const uid = tenantUid("r2");
    await initializePlanCommand(db, uid, AFTER_CUTOVER, SEPT_10, CUTOVER);
    await seedServices(db, uid, 12);
    await ensurePlanLifecycleCurrent(db, uid, new Date(SEPT_20));
    const after = await countByAccessState(db, uid, "services");
    assert.deepEqual({ active: after.active, preserved: after.preserved, total: after.total }, { active: PLAN_CONFIG.free.limits.services, preserved: 12 - PLAN_CONFIG.free.limits.services, total: 12 }, "R2: exatamente 5 active/7 preserved, nenhum serviço apagado");
    console.log("PASS R2 12 services under trial correctly partition to 5 active / 7 preserved on trial expiry");
  }

  // ===== R3/§30 — cota de agendamentos: usados durante o trial (premium, sem cap) permanecem contados
  // depois de expirar; um 21º agendamento é bloqueado pelo cap Free (20), sem resetar o contador. =====
  {
    const uid = tenantUid("r3");
    await initializePlanCommand(db, uid, AFTER_CUTOVER, SEPT_10, CUTOVER);
    const nowIso = new Date().toISOString();
    await db.collection("users").doc(uid).collection("services").doc("svc-book").set({
      id: "svc-book", tenantUid: uid, name: "Corte", active: true, published: true,
      pricing: { mode: "fixed", priceCents: 5000 }, cost: { kind: "unknown" }, bookingMode: "instant",
      durationMinutes: 30, createdAt: nowIso, updatedAt: nowIso,
    });
    const BOOK_BASE = "2026-09-11T13:00:00.000Z"; // dentro do trial (iniciado em SEPT_10)
    for (let i = 0; i < 20; i += 1) {
      const startAt = new Date(Date.parse(BOOK_BASE) + i * 3_600_000).toISOString();
      const holdOutcome = await createServiceBookingHoldCommand(db, uid, "svc-book", "default", startAt, undefined, `r3-hold-${i}`);
      if ("conflict" in holdOutcome) throw new Error(`unexpected hold conflict at ${i}`);
      await confirmServiceBookingHoldCommand(db, uid, holdOutcome.holdId, `r3-confirm-${i}`);
    }
    // 20 confirmados durante o trial — Free normalmente bloquearia no 21º, mas o trial (premium efetivo)
    // não tem esse teto baixo, então isto NÃO deveria lançar.
    const extraStartAt = new Date(Date.parse(BOOK_BASE) + 20 * 3_600_000).toISOString();
    const extraHold = await createServiceBookingHoldCommand(db, uid, "svc-book", "default", extraStartAt, undefined, "r3-hold-extra");
    if ("conflict" in extraHold) throw new Error("unexpected hold conflict for r3 extra");
    await confirmServiceBookingHoldCommand(db, uid, extraHold.holdId, "r3-confirm-extra");

    const timezone = DEFAULT_BUSINESS_TIMEZONE;
    const monthKey = resolveBookingQuotaMonthKey(BOOK_BASE, timezone);
    assert.equal(await recountBookingMonthUsage(db, uid, monthKey, timezone), 21, "R3: 21 agendamentos confirmados durante o trial, sem bloqueio (Premium efetivo)");

    // Trial expira -> effectivePlan volta a Free -> o contador de 21 permanece intocado, e uma NOVA
    // confirmação agora é rejeitada pelo cap de 20 do Free.
    await ensurePlanLifecycleCurrent(db, uid, new Date(SEPT_20));
    assert.equal(await recountBookingMonthUsage(db, uid, monthKey, timezone), 21, "R3: expirar o trial não reseta o contador de agendamentos já confirmados");

    const blockedStartAt = new Date(Date.parse(BOOK_BASE) + 21 * 3_600_000).toISOString();
    const blockedHold = await createServiceBookingHoldCommand(db, uid, "svc-book", "default", blockedStartAt, undefined, "r3-hold-blocked");
    if ("conflict" in blockedHold) throw new Error("unexpected hold conflict for r3 blocked");
    await assert.rejects(
      () => confirmServiceBookingHoldCommand(db, uid, blockedHold.holdId, "r3-confirm-blocked"),
      (error: unknown) => { assert.ok(error instanceof ServiceBookingCommandError); assert.equal(error.code, "PLAN_BOOKING_LIMIT_REACHED"); return true; },
      "R3: depois do trial expirar, um novo agendamento é corretamente bloqueado pelo cap Free (20)",
    );
    console.log("PASS R3 booking usage confirmed during trial survives expiry uncounted-reset; new bookings correctly capped by Free afterward");
  }

  // ===== R4/§27 — idempotência: uma SEGUNDA chamada de ensurePlanLifecycleCurrent após a mesma transição
  // já aplicada não deve reconciliar de novo (prova por manipulação direta: um item preserved é virado
  // manualmente para active; se a segunda chamada reconciliasse de novo, ela reverteria essa manipulação
  // — como não reconcilia, o item manipulado permanece exatamente como foi deixado). =====
  {
    const uid = tenantUid("r4");
    await initializePlanCommand(db, uid, AFTER_CUTOVER, SEPT_10, CUTOVER);
    await seedProducts(db, uid, 35);
    await ensurePlanLifecycleCurrent(db, uid, new Date(SEPT_20)); // primeira chamada: reconcilia 30/5
    const afterFirst = await countByAccessState(db, uid, "products");
    assert.equal(afterFirst.preserved, 5, "R4 setup: primeira chamada deve preservar 5 dos 35");

    // Manipulação direta (Admin SDK) — simula "o que aconteceria se a segunda chamada reconciliasse de
    // novo e decidisse diferente": um doc preserved é forçado de volta para active manualmente.
    await db.collection("users").doc(uid).collection("products").doc("prod-34").set({ planAccessState: "active" }, { merge: true });

    await ensurePlanLifecycleCurrent(db, uid, new Date("2026-09-21T00:00:00.000Z")); // segunda chamada, mesma transição já aplicada
    const manipulatedSnap = await db.collection("users").doc(uid).collection("products").doc("prod-34").get();
    assert.equal(manipulatedSnap.data()?.planAccessState, "active", "R4: a segunda chamada NÃO deve ter revertido a manipulação manual — prova que ela não reconciliou de novo (lastAppliedEffectivePlan já igual a effectivePlan)");
    console.log("PASS R4 a second ensurePlanLifecycleCurrent call after the same transition is a true no-op, never re-runs reconciliation");
  }

  // ===== R5 — tenant nunca inicializado (sem doc planData): safe no-op, nunca cria um doc parcial que o
  // initialize legítimo depois nunca completaria. =====
  {
    const uid = tenantUid("r5");
    const lifecycle = await ensurePlanLifecycleCurrent(db, uid, new Date(SEPT_10));
    assert.deepEqual(lifecycle, { basePlan: "free", effectivePlan: "free", trial: null }, "R5: tenant sem doc deve devolver Free puro, sem side effects");
    const snap = await planRef(db, uid).get();
    assert.equal(snap.exists, false, "R5: nenhum doc planData deve ser criado por ensurePlanLifecycleCurrent — só initializePlanCommand cria");
    console.log("PASS R5 ensurePlanLifecycleCurrent on a never-initialized uid is a safe no-op, creates nothing");
  }

  // ===== C4/C5/§15 — assinatura paga real ativa DURANTE um trial em curso: trial marcado 'converted',
  // premiumSource passa a refletir a assinatura real, e o trial nunca mais volta a contar como ativo. =====
  {
    const uid = tenantUid("c4");
    await initializePlanCommand(db, uid, AFTER_CUTOVER, SEPT_10, CUTOVER);
    await syncPlanDataFromSubscriptionForTests(uid, "sub-c4", "authorized", "approved", null, "pay-c4", { source: "webhook", eventId: "evt-c4" });
    const plan = await readPlan(db, uid);
    assert.equal(plan?.trialStatus, "converted", "C4: trial deve ser marcado 'converted' quando uma assinatura real ativa em cima dele");
    assert.equal(plan?.currentPlan, "premium", "C4: basePlan agora é premium de verdade, via assinatura");
    assert.equal(plan?.premiumSource, "subscription", "C4: premiumSource reflete a assinatura real, não mais 'trial' (que nunca escreveu este campo)");

    // C6 — mesmo se o trialEndsAt original ainda estivesse no futuro, 'converted' nunca volta a contar.
    assert.equal(isTrialCurrentlyActive(plan, new Date(SEPT_10)), false, "C6: trial convertido nunca reaparece como ativo, mesmo antes do trialEndsAt original");
    console.log("PASS C4/C6 a real paid subscription activating during trial marks it converted and it never reactivates");
  }

  // ===== X1/§48 — mesmo o PRÓPRIO dono não pode escrever campos de trial/lifecycle via client SDK
  // direto (planData inteiro cai no catch-all `allow read, write: if false` de firestore.rules). =====
  await runClientRulesTest();

  console.log("PLAN-IMPL-03 integration tests passed: T1/T3/T4/T7/T8/T11 (concessão e idempotência do trial), R1-R5 (reconciliação Products/Services/booking-quota/idempotência/no-op), C4/C6 (conversão para assinatura real), X1 (client nunca escreve planData).");
}

async function runClientRulesTest(): Promise<void> {
  const appName = `p3-x1-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const clientApp = initializeApp({
    apiKey: "demo-api-key", authDomain: "demo-revendasmart.firebaseapp.com", projectId: "demo-revendasmart", appId: `demo-${appName}`,
  }, appName);
  try {
    const auth = getAuth(clientApp);
    const clientDb = getFirestore(clientApp);
    connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
    connectFirestoreEmulator(clientDb, "127.0.0.1", 8080);

    const credential = await createUserWithEmailAndPassword(auth, `${appName}@example.test`, "LocalTestPassword!123");
    const uid = credential.user.uid;
    const ref = doc(clientDb, "users", uid, "planData", "main");

    await assert.rejects(
      () => setDoc(ref, { trialStatus: "active", trialEndsAt: new Date(Date.now() + 365 * DAY_MS), currentPlan: "premium" }),
      (error: unknown) => { assert.equal((error as { code?: string }).code, "permission-denied"); return true; },
      "X1: owner must not be able to forge trialStatus/trialEndsAt/currentPlan via a direct client setDoc",
    );
    await assert.rejects(
      () => updateDoc(ref, { trialEndsAt: new Date(Date.now() + 365 * DAY_MS) }),
      (error: unknown) => { assert.equal((error as { code?: string }).code, "permission-denied"); return true; },
      "X1: owner must not be able to extend trialEndsAt via a direct client updateDoc either",
    );
  } finally {
    await deleteApp(clientApp);
  }
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
