import assert from "node:assert/strict";
import { initializeApp, deleteApp } from "firebase/app";
import { getAuth, connectAuthEmulator, createUserWithEmailAndPassword } from "firebase/auth";
import { connectFirestoreEmulator, doc, getFirestore, setDoc, updateDoc } from "firebase/firestore";
import fs from "node:fs";
import { initializeFirebaseAdmin } from "../server/firebase-admin-init";
import {
  TRIAL_ELIGIBILITY_SINCE,
  computeTrialGrantFields,
  ensurePlanLifecycleCurrent,
  initializePlanCommand,
  isNewEligibleUserForTrial,
} from "../server/plan-lifecycle";
import { syncPlanDataFromSubscriptionForTests, syncSubscriptionFromProviderCommand } from "../server/subscriptions";
import {
  createServiceBookingHoldCommand,
  confirmServiceBookingHoldCommand,
  ServiceBookingCommandError,
} from "../server/service-booking-commands";
import { recountBookingMonthUsage, resolveBookingQuotaMonthKey, DEFAULT_BUSINESS_TIMEZONE } from "../server/booking-quota";
import { createProductCommand, createServiceCommand, PlanMutationError } from "../server/plan-authoritative-mutations";
import { loadPublicCatalogSettings } from "../server/routes";
import { resolvePublicBookingStore, ServicePublicBookingError } from "../server/service-public-booking";
import { ensurePublicCatalogSlug } from "../server/public-catalog-ownership";
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
  // §3 do PLAN-IMPL-03-VERIFY — não fixa a porta: só confirma que os 3 estão de fato apontando para um
  // emulador local (nunca produção), para este arquivo funcionar tanto contra o emulador padrão quanto
  // contra uma instância isolada em portas alternativas.
  assert.equal(process.env.FIREBASE_PROJECT_ID, "demo-revendasmart");
  assert.match(process.env.FIRESTORE_EMULATOR_HOST ?? "", /^127\.0\.0\.1:\d+$/);
  assert.match(process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "", /^127\.0\.0\.1:\d+$/);
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

  // ===== T5/T6 — verificação estrutural: server/plan-lifecycle.ts nunca importa nada do Mercado Pago,
  // nunca cria PreApproval, nunca exige cartão — o trial é puramente uma escrita em planData/main. =====
  {
    const source = fs.readFileSync("server/plan-lifecycle.ts", "utf-8");
    assert.doesNotMatch(source, /mercadopago|MercadoPago|PreApproval|preApproval|cardToken|payment_method/i, "T5/T6: server/plan-lifecycle.ts não deve importar/referenciar nada do provider de pagamento — trial nunca cria assinatura nem exige cartão");
    console.log("PASS T5/T6 server/plan-lifecycle.ts never references the payment provider — no subscription created, no card required");
  }

  // ===== F1-F6/§5 — prova reproduzível de fail-closed, não só inspeção de código: quebra deliberadamente
  // SÓ a leitura de users/{targetUid}/planData/main (o único doc que ensurePlanLifecycleCurrent lê),
  // delegando tudo mais para o Firestore real — nunca um mock genérico. =====
  function dbWithBrokenPlanLifecycle(realDb: AdminFirestore, targetUid: string): AdminFirestore {
    const brokenMainDoc = { get: async () => { throw new Error("SIMULATED_FIRESTORE_OUTAGE"); } };
    const planDataCollectionWrapper = { doc: (docId: string) => (docId === "main" ? brokenMainDoc : realDb) };
    const userDocWrapper = {
      collection: (subName: string) => {
        const realUserDocRef = realDb.collection("users").doc(targetUid);
        return subName === "planData" ? planDataCollectionWrapper : realUserDocRef.collection(subName);
      },
    };
    const usersCollectionWrapper = {
      doc: (uid: string) => (uid === targetUid ? userDocWrapper : realDb.collection("users").doc(uid)),
    };
    const fakeDb = { collection: (name: string) => (name === "users" ? usersCollectionWrapper : realDb.collection(name)) };
    return fakeDb as unknown as AdminFirestore;
  }

  // F1 — public catalog: lifecycle quebrado -> loadPublicCatalogSettings deve LANÇAR, nunca devolver um
  // store/produtos (mesmo que stale) enquanto o próprio código de produção não consegue confirmar que
  // reconciliou.
  {
    const uid = tenantUid("f1");
    await initializePlanCommand(db, uid, AFTER_CUTOVER, SEPT_10, CUTOVER);
    const { slug } = await ensurePublicCatalogSlug({ db, ownerUid: uid });
    const brokenDb = dbWithBrokenPlanLifecycle(db, uid);
    await assert.rejects(
      () => loadPublicCatalogSettings(slug, brokenDb),
      (error: unknown) => { assert.match(String((error as Error)?.message ?? error), /SIMULATED_FIRESTORE_OUTAGE/); return true; },
      "F1: public catalog must throw (never silently serve a store) when the lifecycle check itself fails",
    );
    console.log("PASS F1 public catalog fails closed when ensurePlanLifecycleCurrent's underlying read fails — never serves stale data");
  }

  // F2 — public booking: mesma prova via resolvePublicBookingStore.
  {
    const uid = tenantUid("f2");
    await initializePlanCommand(db, uid, AFTER_CUTOVER, SEPT_10, CUTOVER);
    const { slug } = await ensurePublicCatalogSlug({ db, ownerUid: uid });
    const brokenDb = dbWithBrokenPlanLifecycle(db, uid);
    await assert.rejects(
      // resolvePublicBookingStore captura o erro interno e relança como ServicePublicBookingError com
      // mensagem genérica fixa (nunca vaza "SIMULATED_FIRESTORE_OUTAGE" nem qualquer detalhe interno ao
      // visitante público) — verificar o CÓDIGO tipado, não a mensagem original, que foi propositalmente substituída.
      () => resolvePublicBookingStore(brokenDb, slug),
      (error: unknown) => { assert.ok(error instanceof ServicePublicBookingError); assert.equal(error.code, "PLAN_LIFECYCLE_UNAVAILABLE"); return true; },
      "F2: public booking must throw PLAN_LIFECYCLE_UNAVAILABLE (never continue with possibly-stale Premium access) when the lifecycle check itself fails",
    );
    console.log("PASS F2 public booking fails closed when ensurePlanLifecycleCurrent's underlying read fails");
  }

  // F3 — Product create: lifecycle quebrado -> createProductCommand lança PLAN_LIFECYCLE_UNAVAILABLE, e o
  // Product NÃO é criado (nenhum documento parcial).
  {
    const uid = tenantUid("f3");
    await initializePlanCommand(db, uid, AFTER_CUTOVER, SEPT_10, CUTOVER);
    const brokenDb = dbWithBrokenPlanLifecycle(db, uid);
    await assert.rejects(
      () => createProductCommand(brokenDb, uid, { productId: "f3-prod", idempotencyKey: "f3-idempotency-key-1", product: { name: "Produto F3", salePrice: 10, stock: 1 } }),
      (error: unknown) => { assert.ok(error instanceof PlanMutationError); assert.equal(error.code, "PLAN_LIFECYCLE_UNAVAILABLE"); return true; },
      "F3: Product create must fail closed with PLAN_LIFECYCLE_UNAVAILABLE when lifecycle check fails",
    );
    const snap = await db.collection("users").doc(uid).collection("products").doc("f3-prod").get();
    assert.equal(snap.exists, false, "F3: the Product must NOT have been created");
    console.log("PASS F3 Product create fails closed and creates nothing when lifecycle check fails");
  }

  // F4 — Service create: mesma prova.
  {
    const uid = tenantUid("f4");
    await initializePlanCommand(db, uid, AFTER_CUTOVER, SEPT_10, CUTOVER);
    const brokenDb = dbWithBrokenPlanLifecycle(db, uid);
    const f4Now = new Date().toISOString();
    await assert.rejects(
      () => createServiceCommand(brokenDb, uid, { serviceId: "f4-svc", idempotencyKey: "f4-idempotency-key-1", service: { name: "Serviço F4", active: true, published: true, pricing: { mode: "fixed", priceCents: 1000 }, cost: { kind: "unknown" }, bookingMode: "instant", createdAt: f4Now, updatedAt: f4Now } }),
      (error: unknown) => { assert.ok(error instanceof PlanMutationError); assert.equal(error.code, "PLAN_LIFECYCLE_UNAVAILABLE"); return true; },
      "F4: Service create must fail closed with PLAN_LIFECYCLE_UNAVAILABLE when lifecycle check fails",
    );
    const snap = await db.collection("users").doc(uid).collection("services").doc("f4-svc").get();
    assert.equal(snap.exists, false, "F4: the Service must NOT have been created");
    console.log("PASS F4 Service create fails closed and creates nothing when lifecycle check fails");
  }

  // F5/F6 — sinal transiente/fora-de-ordem do provider (evento "pending" mais ANTIGO que o último já
  // aplicado) nunca rebaixa um usuário já premium — a proteção de staleness já existente
  // (isOlderSubscriptionEvent) é quem garante isto; aqui é a prova, não a implementação. Depois, um
  // evento novo e correto converge normalmente (F6).
  {
    const uid = tenantUid("f5");
    await initializePlanCommand(db, uid, AFTER_CUTOVER, SEPT_10, CUTOVER);
    const T2 = "2026-09-12T00:00:00.000Z";
    const T1_STALE = "2026-09-11T00:00:00.000Z"; // mais antigo que T2
    const T3 = "2026-09-13T00:00:00.000Z"; // mais novo que T2

    // Estabelece um usuário genuinamente premium via assinatura real, evento em T2.
    await syncPlanDataFromSubscriptionForTests(uid, "sub-f5", "authorized", "approved", null, "pay-f5-1", { source: "webhook", eventId: "evt-f5-t2", eventOccurredAt: T2 });
    const afterT2 = await readPlan(db, uid);
    assert.equal(afterT2?.premiumActive, true, "F5 setup: assinatura autorizada deve conceder premium de verdade");

    // F5 — evento "pending" só CHEGA depois, mas seu eventOccurredAt é ANTERIOR ao já aplicado (T1 < T2)
    // — uma entrega fora de ordem/atrasada da rede, exatamente o cenário que a proteção de staleness
    // existe para cobrir. Nunca deve rebaixar o usuário que já está premium de verdade.
    const staleResult = await syncPlanDataFromSubscriptionForTests(uid, "sub-f5", "pending", undefined, null, null, { source: "webhook", eventId: "evt-f5-t1-stale", eventOccurredAt: T1_STALE });
    assert.equal(staleResult.applied, false, "F5: evento mais antigo que o já aplicado deve ser recusado (stale_event), nunca processado");
    assert.equal(staleResult.reason, "stale_event");
    const afterStale = await readPlan(db, uid);
    assert.equal(afterStale?.premiumActive, true, "F5: base plan NÃO deve ser rebaixado para Free por um evento transiente/fora-de-ordem");
    assert.equal(afterStale?.currentPlan, "premium", "F5: reconciliação para tier inferior NÃO deve ocorrer a partir de um evento stale");

    // F6 — depois que um evento novo e válido chega (mais novo que T2), a sincronização converge
    // normalmente de novo.
    const retryResult = await syncPlanDataFromSubscriptionForTests(uid, "sub-f5", "authorized", "approved", null, "pay-f5-2", { source: "webhook", eventId: "evt-f5-t3", eventOccurredAt: T3 });
    assert.equal(retryResult.applied, true, "F6: um evento novo e válido deve ser aplicado normalmente depois do transiente");
    const afterRetry = await readPlan(db, uid);
    assert.equal(afterRetry?.premiumActive, true, "F6: convergência correta — continua premium via assinatura real");
    console.log("PASS F5/F6 a stale/out-of-order provider event never downgrades an already-premium user; a subsequent valid event converges correctly");
  }

  // ===== T23/T24/§10 — primeira requisição PÚBLICA (sem nunca abrir o dashboard autenticado antes) já
  // reconcilia antes de responder: um tenant com trial expirado (pelo relógio) mas cujo
  // lastAppliedEffectivePlan ainda diz "premium" (nunca visto por ninguém ainda) é corrigido já na
  // PRIMEIRA chamada de loadPublicCatalogSettings/resolvePublicBookingStore. Diferente dos blocos
  // acima: nem loadPublicCatalogSettings nem resolvePublicBookingStore aceitam um `now` injetado (só
  // ensurePlanLifecycleCurrent aceita, internamente) — usam o relógio REAL da máquina. Por isso o trial
  // aqui precisa começar no PASSADO REAL (agora - 8 dias), nunca numa data fixa de 2026-09, que já não
  // teria necessariamente expirado dependendo de quando este arquivo rodar de verdade. =====
  {
    const uid = tenantUid("t23");
    const realTrialStart = new Date(Date.now() - 8 * DAY_MS).toISOString(); // 8 dias reais atrás > 7 dias de trial
    await initializePlanCommand(db, uid, AFTER_CUTOVER, realTrialStart, CUTOVER);
    await seedProducts(db, uid, 40);
    await seedServices(db, uid, 8);
    const { slug } = await ensurePublicCatalogSlug({ db, ownerUid: uid });

    // Confirma que NINGUÉM reconciliou ainda (nem o dono nunca "logou" — nenhuma chamada prévia a
    // ensurePlanLifecycleCurrent para este uid).
    const before = await countByAccessState(db, uid, "products");
    assert.equal(before.preserved, 0, "T23 setup: antes de qualquer requisição pública, nada foi reconciliado ainda");

    // Primeira requisição pública de todas — catálogo. reconcilePlanAccess trata Products E Services
    // numa ÚNICA passagem (confirmado pelo log plan_access_reconciliation.applied logo acima, que já
    // reporta os dois domínios de uma vez) — então esta única chamada já reconcilia ambos.
    const catalogStore = await loadPublicCatalogSettings(slug);
    assert.ok(catalogStore, "T23: a loja pública deve resolver normalmente (dono não bloqueado, só rebaixado)");
    const afterCatalog = await countByAccessState(db, uid, "products");
    assert.deepEqual({ active: afterCatalog.active, preserved: afterCatalog.preserved }, { active: PLAN_CONFIG.free.limits.products, preserved: 40 - PLAN_CONFIG.free.limits.products }, "T23: a PRIMEIRA requisição pública de catálogo, sem nenhum login prévio do dono, já reconcilia Products antes de responder");
    console.log("PASS T23 first public catalog request (no prior owner login) reconciles Products before responding");
  }

  // ===== T24 — mesma garantia, mas provando que o AGENDAMENTO público (não o catálogo) também pode ser
  // a PRIMEIRA requisição de todas a disparar a reconciliação — tenant próprio, nunca tocado por nenhuma
  // chamada anterior (nem catálogo, nem dashboard autenticado). =====
  {
    const uid = tenantUid("t24");
    const realTrialStart = new Date(Date.now() - 8 * DAY_MS).toISOString();
    await initializePlanCommand(db, uid, AFTER_CUTOVER, realTrialStart, CUTOVER);
    await seedServices(db, uid, 8);
    const { slug } = await ensurePublicCatalogSlug({ db, ownerUid: uid });

    const before = await countByAccessState(db, uid, "services");
    assert.equal(before.preserved, 0, "T24 setup: antes de qualquer requisição pública, nada foi reconciliado ainda");

    const bookingStore = await resolvePublicBookingStore(db, slug);
    assert.ok(bookingStore, "T24: a loja de agendamento público deve resolver normalmente");
    const after = await countByAccessState(db, uid, "services");
    assert.deepEqual({ active: after.active, preserved: after.preserved }, { active: PLAN_CONFIG.free.limits.services, preserved: 8 - PLAN_CONFIG.free.limits.services }, "T24: a PRIMEIRA requisição pública de agendamento, sem login prévio do dono nem requisição de catálogo antes, já reconcilia Services antes de responder");
    console.log("PASS T24 first public booking request (no prior owner login, no prior catalog hit) reconciles Services before responding");
  }

  // ===== S1-S10/§7 — lifecycle pago, provado sobre o motor JÁ EXISTENTE (reconcilePremiumStatus +
  // syncPlanDataFromSubscription), nunca uma segunda implementação em código de teste. Nenhuma assinatura
  // real do Mercado Pago é criada — só a função de sincronização é chamada diretamente. =====
  {
    // S1 — assinatura confirmada -> base Premium.
    const uidS1 = tenantUid("s1");
    await db.collection("users").doc(uidS1).collection("planData").doc("main").set({ currentPlan: "free", premiumActive: false, referralCode: "S1", referralCount: 0, updatedAt: new Date() });
    await syncPlanDataFromSubscriptionForTests(uidS1, "sub-s1", "authorized", "approved", null, "pay-s1", { source: "webhook", eventId: "evt-s1" });
    assert.equal((await readPlan(db, uidS1))?.currentPlan, "premium", "S1: assinatura confirmada deve resultar em base Premium");
    console.log("PASS S1 confirmed subscription -> base Premium");

    // S2 (PLAN-IMPL-03-VERIFY-FINALIZE §2) — plano base Pro, direto pelo resolvedor canônico real, nunca
    // por inspeção de PLAN_CONFIG isolada nem por uma assinatura Pro fake do Mercado Pago (o ticket
    // proíbe ambos). Prova em duas camadas: (a) resolveServerPlan/resolveCommercialPlan — o MESMO
    // resolvedor que todo o resto do app usa — devolve "pro"; (b) o limite de Pro (500 produtos), não o
    // de Free (30) nem o de Premium, é o que de fato governa createProductCommand, o limite real
    // aplicado na fronteira de mutação, não uma constante lida à parte.
    const uidS2 = tenantUid("s2");
    await db.collection("users").doc(uidS2).collection("planData").doc("main").set({
      currentPlan: "pro", premiumActive: false, referralCode: "S2", referralCount: 0, updatedAt: new Date(),
    });
    const s2Lifecycle = await ensurePlanLifecycleCurrent(db, uidS2, new Date());
    assert.equal(s2Lifecycle.basePlan, "pro", "S2: basePlan resolvido pelo motor canônico deve ser pro (sem trial ativo, sem premiumActive)");
    assert.equal(s2Lifecycle.effectivePlan, "pro", "S2: effectivePlan também deve ser pro — nenhum trial mascarando o base");
    // Seed exatamente no TETO de Free (30): se resolveServerPlan resolvesse "free" por engano, o create
    // abaixo lançaria PLAN_LIMIT_REACHED. Sucesso só é explicável pelo teto de Pro (500) estar de fato
    // ativo através do mesmo caminho canônico usado em produção.
    assert.equal(PLAN_CONFIG.free.limits.products, 30, "S2 setup: pressupõe o teto atual de Free — se mudar, este teste precisa mudar junto");
    await seedProducts(db, uidS2, PLAN_CONFIG.free.limits.products);
    const s2Created = await createProductCommand(db, uidS2, { productId: "s2-prod-31", idempotencyKey: "s2-idempotency-key-1", product: { name: "Produto S2", salePrice: 10, stock: 1 } });
    assert.ok(s2Created, "S2: criar o 31º produto deve suceder sob Pro (teto 500) — provaria falha sob Free (teto 30)");
    const s2Snap = await db.collection("users").doc(uidS2).collection("products").doc("s2-prod-31").get();
    assert.equal(s2Snap.exists, true, "S2: o produto 31 deve ter sido de fato criado, através da fronteira real de mutação plan-authoritative");
    console.log("PASS S2 direct: Pro base plan resolves via the real canonical resolver, and Pro's real 500-product limit (not Free's 30) governs the real createProductCommand boundary");

    // S3 — cancelamento antes do fim do período pago: acesso permanece.
    const uidS3 = tenantUid("s3");
    const futureExpiry = new Date(Date.now() + 15 * DAY_MS);
    await db.collection("users").doc(uidS3).collection("planData").doc("main").set({
      currentPlan: "premium", premiumActive: true, premiumExpiresAt: futureExpiry, subscriptionStatus: "authorized",
      referralCode: "S3", referralCount: 0, updatedAt: new Date(),
    });
    const s3Result = await syncPlanDataFromSubscriptionForTests(uidS3, "sub-s3", "cancelled", undefined, null, null, { source: "webhook", eventId: "evt-s3" });
    assert.equal(s3Result.premiumActive, true, "S3: cancelamento dentro do período já pago deve preservar o acesso Premium");
    console.log("PASS S3 cancellation before paidThrough preserves paid access");

    // S4 — fim do período pago: transição ocorre corretamente (assinatura cancelada E já vencida).
    const uidS4 = tenantUid("s4");
    const pastExpiry = new Date(Date.now() - 1 * DAY_MS);
    await db.collection("users").doc(uidS4).collection("planData").doc("main").set({
      currentPlan: "premium", premiumActive: true, premiumExpiresAt: pastExpiry, subscriptionStatus: "cancelled", canceledAt: new Date(Date.now() - 10 * DAY_MS),
      referralCode: "S4", referralCount: 0, updatedAt: new Date(),
    });
    const s4Result = await syncPlanDataFromSubscriptionForTests(uidS4, "sub-s4", "cancelled", undefined, null, null, { source: "webhook", eventId: "evt-s4" });
    assert.equal(s4Result.premiumActive, false, "S4: depois do fim do período já pago, o acesso deve terminar");
    console.log("PASS S4 paid period end correctly transitions premiumActive to false");

    // S5 — downgrade aciona reconciliação (mesmo motor de R1, agora disparado por um evento de
    // assinatura real via ensurePlanLifecycleCurrent, não só por expiração de trial).
    const uidS5 = tenantUid("s5");
    await db.collection("users").doc(uidS5).collection("planData").doc("main").set({
      currentPlan: "premium", premiumActive: true, premiumExpiresAt: null, subscriptionStatus: "authorized",
      referralCode: "S5", referralCount: 0, updatedAt: new Date(),
    });
    await seedProducts(db, uidS5, 50);
    await ensurePlanLifecycleCurrent(db, uidS5, new Date()); // materializa lastAppliedEffectivePlan=premium primeiro
    await syncPlanDataFromSubscriptionForTests(uidS5, "sub-s5", "cancelled", undefined, null, null, { source: "webhook", eventId: "evt-s5" });
    const s5Lifecycle = await ensurePlanLifecycleCurrent(db, uidS5, new Date());
    assert.equal(s5Lifecycle.effectivePlan, "free", "S5 setup: downgrade real deve refletir no effectivePlan");
    const s5After = await countByAccessState(db, uidS5, "products");
    assert.deepEqual({ active: s5After.active, preserved: s5After.preserved }, { active: PLAN_CONFIG.free.limits.products, preserved: 50 - PLAN_CONFIG.free.limits.products }, "S5: downgrade de assinatura real deve acionar reconcilePlanAccess exatamente como expiração de trial");
    console.log("PASS S5 subscription downgrade invokes reconciliation exactly like trial expiry does");

    // S6 — upgrade restaura acesso a itens antes preservados.
    const s6Lifecycle = await syncPlanDataFromSubscriptionForTests(uidS5, "sub-s5-b", "authorized", "approved", null, "pay-s5-b", { source: "webhook", eventId: "evt-s5-b" });
    assert.equal(s6Lifecycle.premiumActive, true);
    await ensurePlanLifecycleCurrent(db, uidS5, new Date());
    const s6After = await countByAccessState(db, uidS5, "products");
    assert.equal(s6After.preserved, 0, "S6: upgrade de volta a Premium deve restaurar todos os itens antes preservados");
    console.log("PASS S6 upgrade restores previously-preserved items back to active");

    // S8 (PLAN-IMPL-03-VERIFY-FINALIZE §3) — status terminal-inativo REAL "expired" (nunca usado em
    // S3/S4/S5, que só exercitam "cancelled"): reconcilePremiumStatus (server/subscriptions.ts, ver o
    // comentário "Só cancelled recebe essa carência") trata paused/expired como terminal SEM consultar
    // isWithinPaidPeriod — um branch estruturalmente diferente do exercido por cancelled, não uma
    // segunda chamada ao mesmo caminho. Prova as 4 garantias pedidas na mesma passagem, nunca inferidas
    // de um boolean compartilhado: (a) transição do estado base; (b) plano EFETIVO via
    // ensurePlanLifecycleCurrent, não só o premiumActive cru; (c) reconciliação disparada por ser um
    // downgrade; (d) dado preservado (nunca deletado).
    const uidS8 = tenantUid("s8");
    await db.collection("users").doc(uidS8).collection("planData").doc("main").set({
      currentPlan: "premium", premiumActive: true, premiumExpiresAt: null, subscriptionStatus: "authorized",
      referralCode: "S8", referralCount: 0, updatedAt: new Date(),
    });
    await seedProducts(db, uidS8, 50);
    await ensurePlanLifecycleCurrent(db, uidS8, new Date()); // materializa lastAppliedEffectivePlan=premium primeiro

    // (a) transição do estado BASE, através do caminho real de sync.
    const s8SyncResult = await syncPlanDataFromSubscriptionForTests(uidS8, "sub-s8", "expired", undefined, null, null, { source: "webhook", eventId: "evt-s8" });
    assert.equal(s8SyncResult.applied, true, "S8: evento expired nunca visto antes deve ser aplicado (nunca duplicate_event/stale_event)");
    // A distinção "expired é terminal SEM carência de período pago" vive dentro de reconcilePremiumStatus
    // (server/subscriptions.ts) e não é exposta como string ao chamador — SubscriptionSyncResult.reason
    // só descreve se a escrita foi aplicada (applied/duplicate_event/stale_event), não a decisão de
    // negócio interna. A prova observável correta é o RESULTADO da decisão: premiumActive=false e
    // currentPlan=free abaixo, sem qualquer carência de período pago (diferente de S3, que preserva
    // acesso sob "cancelled" dentro do período já pago).
    assert.equal(s8SyncResult.premiumActive, false, "S8: base premiumActive deve transicionar para false — expired nunca recebe carência de período pago");
    const s8PlanAfterSync = await readPlan(db, uidS8);
    assert.equal(s8PlanAfterSync?.currentPlan, "free", "S8: base currentPlan deve transicionar para free");
    assert.equal(s8PlanAfterSync?.subscriptionStatus, "expired", "S8: subscriptionStatus deve refletir o status real recebido do provider");

    // (b) plano EFETIVO via o motor canônico — não apenas o premiumActive cru gravado acima.
    const s8Lifecycle = await ensurePlanLifecycleCurrent(db, uidS8, new Date());
    assert.equal(s8Lifecycle.basePlan, "free", "S8: basePlan resolvido pelo motor canônico também deve refletir free");
    assert.equal(s8Lifecycle.effectivePlan, "free", "S8: effectivePlan (não só o boolean) deve refletir a queda para free");

    // (c) reconciliação disparada por ser um downgrade + (d) dado preservado, nunca deletado.
    const s8After = await countByAccessState(db, uidS8, "products");
    assert.deepEqual(
      { active: s8After.active, preserved: s8After.preserved, total: s8After.total },
      { active: PLAN_CONFIG.free.limits.products, preserved: 50 - PLAN_CONFIG.free.limits.products, total: 50 },
      "S8: downgrade real via status expired deve acionar reconcilePlanAccess (itens excedentes marcados preserved, nunca deletados) — total permanece 50",
    );
    console.log("PASS S8 direct: real terminal-inactive provider status ('expired') transitions base state, resolves effective plan via the canonical engine, triggers reconciliation, and preserves all data — never inferred from a shared boolean");

    // S9 — sincronização repetida com o MESMO eventId é idempotente (duplicate_event).
    const dup1 = await syncPlanDataFromSubscriptionForTests(uidS1, "sub-s1", "authorized", "approved", null, "pay-s1", { source: "webhook", eventId: "evt-s1" });
    assert.equal(dup1.applied, false);
    assert.equal(dup1.reason, "duplicate_event", "S9: replay do mesmo eventId nunca deve ser reaplicado");
    console.log("PASS S9 repeated sync with the same eventId is idempotent (duplicate_event, never reapplied)");

    // S10 — client não pode forjar estado de provider: planData inteiro é server-only (já provado por X1
    // de forma geral; aqui é a mesma garantia, nomeada explicitamente para subscriptionStatus/premiumActive).
    console.log("PASS S10 (ver X1 abaixo — planData inteiro, incluindo subscriptionStatus/premiumActive, é server-only via a mesma regra catch-all)");
  }

  // ===== PROVIDER-OUTAGE (PLAN-IMPL-03-VERIFY-FINALIZE §4) — o próprio LOOKUP ao provider falha (não um
  // evento stale/fora-de-ordem como F5, nem um status terminal-inativo real como S8): uma falha
  // transiente de rede/infra ao consultar o Mercado Pago. Exercita syncSubscriptionFromProviderCommand
  // (server/subscriptions.ts), a extração mínima do handler real de POST /api/app-subscription/sync-now
  // — a MESMA função que a rota de produção chama, com `fetchFromProvider` injetado no lugar da chamada
  // real ao SDK do Mercado Pago (nunca uma segunda implementação). Prova: (1) a falha propaga (nunca é
  // engolida silenciosamente); (2) planData não é tocado — nem rebaixado para Free, nem o entitlement
  // pago destruído; (3) nenhuma reconciliação é disparada só por o lookup ter falhado (itens seguem
  // 100% ativos, nada marcado "preserved"); (4) uma tentativa seguinte bem-sucedida converge normalmente. =====
  {
    const uid = tenantUid("outage");
    await db.collection("users").doc(uid).collection("planData").doc("main").set({
      currentPlan: "free", premiumActive: false, referralCode: "OUTAGE", referralCount: 0, updatedAt: new Date(),
    });
    // Estabelece um usuário genuinamente Premium via assinatura real (mesmo caminho de S1), com itens
    // seedados acima do teto de Free — se uma reconciliação incorreta disparasse, isto seria visível.
    await syncPlanDataFromSubscriptionForTests(uid, "sub-outage", "authorized", "approved", null, "pay-outage-1", { source: "webhook", eventId: "evt-outage-1" });
    await seedProducts(db, uid, 50);
    await ensurePlanLifecycleCurrent(db, uid, new Date()); // materializa lastAppliedEffectivePlan=premium, 50 produtos ativos
    // Captura o estado "antes" só DEPOIS que toda a preparação (inclusive a própria materialização de
    // lastAppliedEffectivePlan/lastLifecycleEvaluatedAt por ensurePlanLifecycleCurrent) já aconteceu —
    // senão a comparação byte-a-byte abaixo compararia contra um estado que nunca existiu "antes da
    // falha" de verdade, e sim antes de um passo de setup não relacionado à falha em si.
    const beforeOutage = await readPlan(db, uid);
    assert.equal(beforeOutage?.premiumActive, true, "outage setup: assinatura autorizada deve conceder premium de verdade antes do teste de falha");

    // (1)/(2)/(3) — o lookup ao provider lança; a falha deve propagar, e nada em planData/produtos pode mudar.
    const providerOutageError = new Error("SIMULATED_PROVIDER_OUTAGE");
    const throwingFetchFromProvider = async (): Promise<never> => { throw providerOutageError; };
    await assert.rejects(
      () => syncSubscriptionFromProviderCommand(uid, "sub-outage", throwingFetchFromProvider, "sync-now"),
      (error: unknown) => { assert.equal(error, providerOutageError, "outage: a falha do lookup deve propagar sem ser engolida nem substituída"); return true; },
      "outage: syncSubscriptionFromProviderCommand deve rejeitar quando o lookup ao provider falha, nunca continuar com um resultado parcial",
    );
    const afterOutage = await readPlan(db, uid);
    assert.equal(afterOutage?.premiumActive, true, "outage: premiumActive NÃO deve ser rebaixado só porque o lookup ao provider falhou");
    assert.equal(afterOutage?.currentPlan, "premium", "outage: base plan NÃO deve cair para Free — o entitlement pago não pode ser destruído por uma falha de leitura");
    assert.deepEqual(afterOutage, beforeOutage, "outage: planData deve permanecer byte-a-byte idêntico — syncPlanDataFromSubscription nunca chegou a ser chamado, porque fetchFromProvider lançou antes");
    const outageLifecycle = await ensurePlanLifecycleCurrent(db, uid, new Date());
    assert.equal(outageLifecycle.effectivePlan, "premium", "outage: effectivePlan pelo motor canônico também deve continuar premium");
    const afterOutageProducts = await countByAccessState(db, uid, "products");
    assert.equal(afterOutageProducts.preserved, 0, "outage: nenhuma reconciliação de downgrade deve ter sido disparada só porque o lookup falhou — 0 itens marcados preserved");
    assert.equal(afterOutageProducts.total, 50, "outage: nenhum item deve ter sido apagado");

    // (4) — uma tentativa seguinte, com o provider respondendo normalmente, converge sem intervenção manual.
    const workingFetchFromProvider = async () => ({
      status: "authorized" as const, paymentStatus: "approved", nextBillingDate: null,
      mercadoPagoPaymentId: "pay-outage-2", externalReference: null,
    });
    const retryResult = await syncSubscriptionFromProviderCommand(uid, "sub-outage", workingFetchFromProvider, "sync-now");
    assert.ok(!("ownershipMismatch" in retryResult), "outage retry: não deve haver mismatch de ownership (externalReference nulo)");
    assert.equal(retryResult.applied, true, "outage retry: depois que o provider volta a responder, a sincronização deve convergir normalmente");
    assert.equal(retryResult.premiumActive, true, "outage retry: continua premium via assinatura real, sem qualquer intervenção manual");
    console.log("PASS PROVIDER-OUTAGE direct: a real throwing provider lookup propagates, never downgrades base plan to Free, never destroys paid entitlement, never triggers reconciliation merely because the lookup failed, and a subsequent successful retry converges normally");
  }

  // ===== §11 — cota de agendamentos com 27 confirmados (não 21), a garantia é a mesma de R3, só um
  // número diferente para bater com o exemplo literal do ticket. =====
  {
    const uid = tenantUid("q27");
    await initializePlanCommand(db, uid, AFTER_CUTOVER, SEPT_10, CUTOVER);
    const nowIso = new Date().toISOString();
    await db.collection("users").doc(uid).collection("services").doc("svc-q27").set({
      id: "svc-q27", tenantUid: uid, name: "Corte", active: true, published: true,
      pricing: { mode: "fixed", priceCents: 5000 }, cost: { kind: "unknown" }, bookingMode: "instant",
      durationMinutes: 30, createdAt: nowIso, updatedAt: nowIso,
    });
    const Q27_BASE = "2026-09-11T08:00:00.000Z";
    for (let i = 0; i < 27; i += 1) {
      const startAt = new Date(Date.parse(Q27_BASE) + i * 3_600_000).toISOString();
      const holdOutcome = await createServiceBookingHoldCommand(db, uid, "svc-q27", "default", startAt, undefined, `q27-hold-${i}`);
      if ("conflict" in holdOutcome) throw new Error(`unexpected hold conflict at ${i}`);
      await confirmServiceBookingHoldCommand(db, uid, holdOutcome.holdId, `q27-confirm-${i}`);
    }
    const timezone = DEFAULT_BUSINESS_TIMEZONE;
    const monthKey = resolveBookingQuotaMonthKey(Q27_BASE, timezone);
    assert.equal(await recountBookingMonthUsage(db, uid, monthKey, timezone), 27);
    await ensurePlanLifecycleCurrent(db, uid, new Date(SEPT_20));
    assert.equal(await recountBookingMonthUsage(db, uid, monthKey, timezone), 27, "§11: 27 agendamentos confirmados durante o trial permanecem 27 depois da expiração, sem reset");
    console.log("PASS §11 27 confirmed bookings during trial survive expiry uncounted-reset (BOOKING_USAGE_PRESERVED_ON_EXPIRY)");
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
    // §3 do PLAN-IMPL-03-VERIFY — nunca hardcoded: lê o mesmo host:porta que o Admin SDK já está usando
    // (FIREBASE_AUTH_EMULATOR_HOST/FIRESTORE_EMULATOR_HOST), para este arquivo funcionar tanto contra o
    // emulador padrão quanto contra uma instância isolada em portas alternativas.
    const [authHost, authPort] = process.env.FIREBASE_AUTH_EMULATOR_HOST!.split(":");
    const [firestoreHost, firestorePort] = process.env.FIRESTORE_EMULATOR_HOST!.split(":");
    connectAuthEmulator(auth, `http://${authHost}:${authPort}`, { disableWarnings: true });
    connectFirestoreEmulator(clientDb, firestoreHost, Number(firestorePort));

    const credential = await createUserWithEmailAndPassword(auth, `${appName}@example.test`, "LocalTestPassword!123");
    const uid = credential.user.uid;
    const ref = doc(clientDb, "users", uid, "planData", "main");
    const productRef = doc(clientDb, "users", uid, "products", "prod-0");
    const serviceRef = doc(clientDb, "users", uid, "services", "svc-0");

    await assert.rejects(
      () => setDoc(ref, { trialStatus: "active", trialEndsAt: new Date(Date.now() + 365 * DAY_MS), currentPlan: "premium" }),
      (error: unknown) => { assert.equal((error as { code?: string }).code, "permission-denied"); return true; },
      "X1: owner must not be able to forge trialStatus/trialEndsAt/currentPlan via a direct client setDoc",
    );
    await assert.rejects(
      () => updateDoc(ref, { trialEndsAt: new Date(Date.now() + 365 * DAY_MS) }),
      (error: unknown) => { assert.equal((error as { code?: string }).code, "permission-denied"); return true; },
      "X1/T10: owner must not be able to extend trialEndsAt via a direct client updateDoc, nor forge an active trial this way",
    );

    // §13 — planAccessState/planAccessSelectionSource continuam protegidos (já provados em PLAN-IMPL-
    // 02B1/02B2; reconfirmados aqui porque este ticket pede explicitamente). Seed via Admin SDK
    // separado (initializeFirebaseAdmin), não pelo client — o client só tenta a escrita proibida.
    const adminDb = initializeFirebaseAdmin().firestore();
    await adminDb.doc(`users/${uid}/products/prod-0`).set({ id: "prod-0", name: "P", salePrice: 10, stock: 1, planAccessState: "preserved" });
    await adminDb.doc(`users/${uid}/services/svc-0`).set({
      id: "svc-0", tenantUid: uid, name: "S", active: true, published: true,
      pricing: { mode: "fixed", priceCents: 1000 }, cost: { kind: "unknown" }, bookingMode: "instant",
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), planAccessState: "preserved",
    });
    await assert.rejects(
      () => updateDoc(productRef, { planAccessState: "active" }),
      (error: unknown) => { assert.equal((error as { code?: string }).code, "permission-denied"); return true; },
      "§13: owner must not be able to reactivate a preserved Product via direct client updateDoc",
    );
    await assert.rejects(
      () => updateDoc(serviceRef, { planAccessState: "active", planAccessSelectionSource: "user" }),
      (error: unknown) => { assert.equal((error as { code?: string }).code, "permission-denied"); return true; },
      "§13: owner must not be able to reactivate a preserved Service or forge planAccessSelectionSource via direct client updateDoc",
    );
  } finally {
    await deleteApp(clientApp);
  }
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
