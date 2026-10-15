/**
 * PEDIDOS EDITÁVEIS — Etapa 2B: corrida EDIÇÃO × INÍCIO DA COBRANÇA contra o Firestore de verdade (emulador).
 *
 * Invariante: nunca existe cobrança com o total T1 enquanto o pedido termina persistido com T2. Os
 * interleavings são forçados por barreiras (hooks de teste), não por sleep: a transação pausada primeiro
 * segura o que leu; a outra espera, é refeita depois do commit e enxerga o estado já gravado.
 *
 * O provedor (Mercado Pago) NUNCA é chamado: createCharge é um stub local que só grava a cobrança no
 * emulador, como a função real faz depois de falar com o provedor. Nenhuma credencial é usada.
 *
 * Roda como script/order-edit-command-emulator-tests.ts (só no emulador, projeto demo-*):
 *   npx --yes firebase-tools@15.24.0 emulators:exec --project demo-revendasmart --only firestore "tsx script/order-charge-race-emulator-tests.ts"
 */
import assert from "node:assert/strict";
import type { DocumentData, Firestore } from "firebase-admin/firestore";
import { getFirebaseAdmin, initializeFirebaseAdmin } from "../server/firebase-admin-init";
import { editOrderItemsCommand, OrderEditCommandError, type OrderEditCommandHooks, type OrderEditCommandResult } from "../server/order-edit-command";
import {
  OrderChargeReservationError,
  reserveOrderCharge,
  startOrderMercadoPagoCharge,
  type CreateOrderChargeFn,
  type StartOrderChargeHooks,
  type StartOrderChargeResult,
} from "../server/public-catalog-order-payment-idempotency";
import { MercadoPagoOrderChargeError, type CreateOrderMercadoPagoChargeParams } from "../server/payments";
import { calculateOrderTotal, type OrderItem } from "../client/src/lib/orders";

process.env.FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT || "demo-revendasmart";
// initializeFirebaseAdmin só entra em modo local com as duas variáveis; a de Auth nunca é usada aqui.
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || "127.0.0.1:9099";

function requireEmulator(): void {
  const projectId = process.env.FIREBASE_PROJECT_ID ?? "";
  const host = process.env.FIRESTORE_EMULATOR_HOST ?? "";
  if (!projectId.startsWith("demo-") || !/^(127\.0\.0\.1|localhost):\d+$/.test(host)) {
    throw new Error(`Recusado: estes testes só rodam no emulador (projeto demo-*, FIRESTORE_EMULATOR_HOST local). projeto=${projectId || "-"} host=${host || "-"}`);
  }
}

let db: Firestore;
let sequence = 0;

function tenant(): string {
  sequence += 1;
  return `order-charge-race-${Date.now().toString(36)}-${sequence}-${Math.random().toString(36).slice(2, 8)}`;
}

function newKey(): string {
  sequence += 1;
  return `race-${sequence}-${Math.random().toString(36).slice(2, 10)}`;
}

const lineA: OrderItem = { productId: "prodA", name: "Batom (cor antiga)", quantity: 10, unitPrice: 19.9 };
const lineManual: OrderItem = { name: "Embrulho", quantity: 1, unitPrice: 2 };
/** 10 × 19,90 + 2. */
const OLD_TOTAL = 201;
/** Depois da edição prodA 10 → 5: 5 × 19,90 + 2. */
const NEW_TOTAL = 101.5;

const orderRef = (uid: string, orderId: string) => db.collection("users").doc(uid).collection("orders").doc(orderId);
const reservationRef = (uid: string, orderId: string) => db.collection("users").doc(uid).collection("orderChargeIdempotency").doc(orderId);
const chargesOf = (uid: string, orderId: string) => db.collection("users").doc(uid).collection("charges").where("orderId", "==", orderId).get();

/** Pedido do catálogo combinado pelo WhatsApp: editável (sem pagamento iniciado) e ainda cobrável. */
async function seedOrder(uid: string, orderId: string, overrides: Record<string, unknown> = {}): Promise<void> {
  const items = [lineA, lineManual];
  await orderRef(uid, orderId).set({
    id: orderId,
    clientId: "public-catalog",
    clientName: "Cliente do catálogo",
    status: "new",
    items,
    total: calculateOrderTotal(items),
    createdAt: "2026-09-20T10:00:00.000Z",
    updatedAt: "2026-09-21T10:00:00.000Z",
    paymentMethod: "whatsapp",
    paymentProvider: "manual_whatsapp",
    paymentStatus: "not_started",
    clientOrderId: `client-${orderId}`,
    ...overrides,
  });
}

interface ProviderStub {
  create: CreateOrderChargeFn;
  calls: CreateOrderMercadoPagoChargeParams[];
}

/**
 * Stub do provedor: segue o contrato real (marca a reserva imediatamente antes do "POST"), registra o que seria
 * enviado e grava a cobrança como a função real grava. Sem rede. `calls` = POSTs que chegaram ao provedor.
 */
function providerStub(options: { fail?: boolean } = {}): ProviderStub {
  const calls: CreateOrderMercadoPagoChargeParams[] = [];
  const create: CreateOrderChargeFn = async (params) => {
    await params.markProviderCallStarted();
    calls.push(params);
    // Recusa DEFINITIVA do provedor (4xx): nada criado lá — a Etapa 2C só libera a reserva nesse caso.
    if (options.fail) throw new MercadoPagoOrderChargeError("PAYMENT_PREFERENCE_FAILED", "recusa do provedor (stub)", 502, { status: 400 }, "rejected");
    const paymentUrl = `https://provider.stub.invalid/${params.chargeId}`;
    const preferenceId = `pref-${params.chargeId}`;
    await db.collection("users").doc(params.uid).collection("charges").doc(params.chargeId)
      .set({ id: params.chargeId, orderId: params.orderId, amount: params.amount, status: "pending", paymentUrl, preferenceId });
    return { chargeId: params.chargeId, paymentUrl, preferenceId };
  };
  return { create, calls };
}

function startCharge(uid: string, orderId: string, stub: ProviderStub, hooks: StartOrderChargeHooks = {}): Promise<StartOrderChargeResult> {
  return startOrderMercadoPagoCharge(db, { uid, orderId, storeName: "Loja da Ana", storeSlug: "loja-da-ana" }, { createCharge: stub.create }, hooks);
}

/** Edição legítima (CAS com a versão atual, ou a informada): prodA vai para `quantityA`, o item manual fica. */
async function editTo(uid: string, orderId: string, quantityA: number, hooks: OrderEditCommandHooks = {}, expectedUpdatedAt?: string): Promise<OrderEditCommandResult> {
  const version = expectedUpdatedAt ?? String((await orderRef(uid, orderId).get()).data()?.updatedAt);
  return await editOrderItemsCommand(db, uid, {
    orderId,
    expectedUpdatedAt: version,
    idempotencyKey: newKey(),
    items: [{ productId: "prodA", quantity: quantityA }, { name: "Embrulho", quantity: 1, unitPrice: 2 }],
  }, undefined, hooks);
}

function isPaymentStarted(error: unknown): boolean {
  return error instanceof OrderEditCommandError && error.code === "ORDER_PAYMENT_STARTED";
}

interface Barrier {
  paused: Promise<void>;
  release: () => void;
  attempts: number[];
}

/** Pausa a PRIMEIRA tentativa da transação no ponto do hook; as seguintes passam direto. */
function attemptBarrier(): Barrier & { hook: (attempt: number) => Promise<void> } {
  let signalPaused: () => void = () => {};
  let release: () => void = () => {};
  const paused = new Promise<void>((resolve) => { signalPaused = resolve; });
  const released = new Promise<void>((resolve) => { release = resolve; });
  const attempts: number[] = [];
  const hook = async (attempt: number) => {
    attempts.push(attempt);
    if (attempt === 1) {
      signalPaused();
      await released;
    }
  };
  return { paused, release: () => release(), attempts, hook };
}

/** Mesma barreira para hooks sem número de tentativa (antes/depois da reserva). */
function onceBarrier(): Barrier & { hook: () => Promise<void> } {
  const inner = attemptBarrier();
  let calls = 0;
  return { ...inner, hook: async () => { calls += 1; await inner.hook(calls); } };
}

async function stillPendingAfter(promise: Promise<unknown>, ms: number): Promise<boolean> {
  let settled = false;
  promise.then(() => { settled = true; }, () => { settled = true; });
  await new Promise((resolve) => setTimeout(resolve, ms));
  return !settled;
}

/** Invariante: exatamente uma cobrança, e o valor enviado ao provedor === reserva === total FINAL do pedido. */
async function assertChargedWithFinalTotal(uid: string, orderId: string, stub: ProviderStub, expectedTotal: number): Promise<void> {
  const order: DocumentData = (await orderRef(uid, orderId).get()).data() ?? {};
  const reservation = (await reservationRef(uid, orderId).get()).data();
  const charges = await chargesOf(uid, orderId);
  assert.equal(order.total, expectedTotal, "total final do pedido");
  assert.deepEqual(stub.calls.map((call) => call.amount), [order.total], "provedor recebeu exatamente o total final, uma vez");
  assert.equal(reservation?.amount, order.total, "reserva congela o total final");
  assert.equal(reservation?.orderUpdatedAt, order.updatedAt, "reserva registra a versão do pedido que ela leu");
  assert.equal(reservation?.status, "ready");
  assert.equal(charges.size, 1, "uma única cobrança para o pedido");
  assert.equal(charges.docs[0].data().amount, order.total, "cobrança gravada com o total final");
}

const cases: Array<[string, string, () => Promise<void>]> = [];
function caso(id: string, description: string, fn: () => Promise<void>): void {
  cases.push([id, description, fn]);
}

// ===== RACE-01 — edição vence antes da reserva =====
caso("RACE-01a", "edição commita antes da reserva (em sequência) → cobrança usa o total NOVO", async () => {
  const uid = tenant();
  await seedOrder(uid, "order1");
  const stub = providerStub();
  assert.equal((await editTo(uid, "order1", 5)).total, NEW_TOTAL);
  assert.equal((await startCharge(uid, "order1", stub)).outcome, "created");
  await assertChargedWithFinalTotal(uid, "order1", stub, NEW_TOTAL);
});
caso("RACE-01b", "edição pausada segurando as leituras; cobrança espera; edição commita; reserva é refeita com o total NOVO", async () => {
  const uid = tenant();
  await seedOrder(uid, "order1");
  const stub = providerStub();
  const gate = attemptBarrier();
  const edit = editTo(uid, "order1", 5, { afterReads: gate.hook });
  await gate.paused;
  const chargeAttempts: number[] = [];
  const charge = startCharge(uid, "order1", stub, { afterReservationReads: async (attempt) => { chargeAttempts.push(attempt); } });
  assert.equal(await stillPendingAfter(charge, 600), true, "a cobrança precisa esperar a edição que segura o que leu");
  gate.release();
  const [edited, started] = await Promise.all([edit, charge]);
  assert.equal(edited.total, NEW_TOTAL);
  assert.equal(started.outcome, "created");
  assert.ok(Math.max(...chargeAttempts) >= 2, `a reserva precisa ter sido refeita depois do commit da edição (tentativas: ${chargeAttempts.join(",")})`);
  await assertChargedWithFinalTotal(uid, "order1", stub, NEW_TOTAL);
});
caso("RACE-01c", "cobrança já começou (antes da transação) e a edição commita nesse intervalo → reserva usa o total NOVO", async () => {
  const uid = tenant();
  await seedOrder(uid, "order1");
  const stub = providerStub();
  const gate = onceBarrier();
  const charge = startCharge(uid, "order1", stub, { beforeReservation: gate.hook });
  await gate.paused;
  // Sem transação aberta do lado da cobrança, nada segura a edição — era aqui que o protocolo antigo já
  // tinha lido order.total e depois cobrava o valor velho.
  assert.equal((await editTo(uid, "order1", 5)).total, NEW_TOTAL);
  gate.release();
  assert.equal((await charge).outcome, "created");
  await assertChargedWithFinalTotal(uid, "order1", stub, NEW_TOTAL);
});

// ===== RACE-02 — reserva vence antes da edição =====
caso("RACE-02a", "reserva commita antes da edição (em sequência) → edição recebe ORDER_PAYMENT_STARTED", async () => {
  const uid = tenant();
  await seedOrder(uid, "order1");
  const stub = providerStub();
  assert.equal((await startCharge(uid, "order1", stub)).outcome, "created");
  await assert.rejects(editTo(uid, "order1", 5), isPaymentStarted);
  await assertChargedWithFinalTotal(uid, "order1", stub, OLD_TOTAL);
});
caso("RACE-02b", "janela reserva gravada × provedor ainda não chamado: só a reserva bloqueia a edição", async () => {
  const uid = tenant();
  await seedOrder(uid, "order1");
  const stub = providerStub();
  const gate = onceBarrier();
  const charge = startCharge(uid, "order1", stub, { afterReservation: gate.hook });
  await gate.paused;
  assert.equal((await chargesOf(uid, "order1")).size, 0, "ainda não existe cobrança gravada nesta janela");
  assert.equal((await reservationRef(uid, "order1").get()).data()?.status, "pending");
  await assert.rejects(editTo(uid, "order1", 5), isPaymentStarted);
  gate.release();
  assert.equal((await charge).outcome, "created");
  await assertChargedWithFinalTotal(uid, "order1", stub, OLD_TOTAL);
});
caso("RACE-02c", "reserva pausada dentro da transação segurando as leituras; edição espera; reserva commita; edição é refeita e bloqueia", async () => {
  const uid = tenant();
  await seedOrder(uid, "order1");
  const stub = providerStub();
  const gate = attemptBarrier();
  const charge = startCharge(uid, "order1", stub, { afterReservationReads: gate.hook });
  await gate.paused;
  const editAttempts: number[] = [];
  const edit = editTo(uid, "order1", 5, { afterReads: async (attempt) => { editAttempts.push(attempt); } });
  assert.equal(await stillPendingAfter(edit, 600), true, "a edição precisa esperar a reserva que segura o que leu");
  gate.release();
  const [started, edited] = await Promise.allSettled([charge, edit]);
  assert.ok(started.status === "fulfilled" && started.value.outcome === "created", JSON.stringify(started));
  assert.ok(edited.status === "rejected" && isPaymentStarted(edited.reason), `edição devia parar em ORDER_PAYMENT_STARTED: ${JSON.stringify(edited)}`);
  assert.ok(Math.max(...editAttempts) >= 2, `a edição precisa ter sido refeita depois do commit da reserva (tentativas: ${editAttempts.join(",")})`);
  await assertChargedWithFinalTotal(uid, "order1", stub, OLD_TOTAL);
});

// ===== RACE-03 — simultâneos, sem barreira =====
caso("RACE-03", "edição e início de cobrança simultâneos (10 rodadas): sempre um dos dois estados coerentes, nunca total novo + cobrança antiga", async () => {
  const tally = { editFirst: 0, chargeFirst: 0 };
  for (let round = 0; round < 10; round += 1) {
    const uid = tenant();
    await seedOrder(uid, "order1");
    const stub = providerStub();
    // Versão lida antes e ordem de disparo alternada: nenhum dos dois sai com vantagem fixa.
    const version = String((await orderRef(uid, "order1").get()).data()?.updatedAt);
    const launchEdit = () => editTo(uid, "order1", 5, {}, version);
    const launchCharge = () => startCharge(uid, "order1", stub);
    const [edited, started] = round % 2 === 0
      ? await Promise.allSettled([launchEdit(), launchCharge()])
      : await Promise.allSettled([launchCharge(), launchEdit()]).then(([charged, editedResult]) => [editedResult, charged] as const);
    assert.ok(started.status === "fulfilled" && started.value.outcome === "created", JSON.stringify(started));
    if (edited.status === "fulfilled") {
      tally.editFirst += 1;
      await assertChargedWithFinalTotal(uid, "order1", stub, NEW_TOTAL);
    } else {
      assert.ok(isPaymentStarted(edited.reason), String(edited.reason));
      tally.chargeFirst += 1;
      await assertChargedWithFinalTotal(uid, "order1", stub, OLD_TOTAL);
    }
  }
  console.log(`   RACE-03 rodadas: edição primeiro=${tally.editFirst}, cobrança primeiro=${tally.chargeFirst}`);
});

// ===== RACE-04 — retry depois de o pedido mudar =====
caso("RACE-04", "pedido muda por fora depois da reserva: provedor e retries usam o amount reservado, nunca o total novo", async () => {
  const uid = tenant();
  await seedOrder(uid, "order1");
  const stub = providerStub();
  const gate = onceBarrier();
  const charge = startCharge(uid, "order1", stub, { afterReservation: gate.hook });
  await gate.paused;
  // Escrita fora do protocolo (nenhum fluxo do app muda o total com reserva existente) — só para provar
  // que o valor enviado ao provedor não é relido do pedido.
  await orderRef(uid, "order1").update({ total: 999, updatedAt: "2026-09-22T00:00:00.000Z" });
  gate.release();
  assert.equal((await charge).outcome, "created");
  assert.deepEqual(stub.calls.map((call) => call.amount), [OLD_TOTAL], "provedor recebeu o valor congelado na reserva");
  assert.equal((await reservationRef(uid, "order1").get()).data()?.amount, OLD_TOTAL);

  const retry = await startCharge(uid, "order1", stub);
  assert.equal(retry.outcome, "reused", "retry com reserva pronta devolve a MESMA cobrança");
  assert.equal(stub.calls.length, 1, "retry não chama o provedor de novo");
  const charges = await chargesOf(uid, "order1");
  assert.equal(charges.size, 1);
  assert.equal(charges.docs[0].data().amount, OLD_TOTAL);

  // Reserva `pending` (Etapa 2C: provedor comprovadamente ainda não chamado): o retry a assume e cobra o valor
  // CONGELADO nela, nunca o total relido do pedido.
  const other = tenant();
  await seedOrder(other, "order1");
  const pending = await reserveOrderCharge(db, other, "order1");
  assert.ok(!pending.alreadyExisted && pending.amount === OLD_TOTAL);
  await orderRef(other, "order1").update({ total: 999 });
  const otherStub = providerStub();
  assert.equal((await startCharge(other, "order1", otherStub)).outcome, "created");
  assert.deepEqual(otherStub.calls.map((call) => call.amount), [OLD_TOTAL], "retry cobra o valor reservado, não o total novo");
  assert.equal((await reservationRef(other, "order1").get()).data()?.amount, OLD_TOTAL);

  // Chamada ao provedor em andamento (`provider_started` recente, sem cobrança local): retry não chama de novo.
  const inFlight = tenant();
  await seedOrder(inFlight, "order1");
  const reserved = await reserveOrderCharge(db, inFlight, "order1");
  await reservationRef(inFlight, "order1").update({ status: "provider_started", providerStartedAt: new Date().toISOString() });
  await orderRef(inFlight, "order1").update({ total: 999 });
  const inFlightStub = providerStub();
  assert.equal((await startCharge(inFlight, "order1", inFlightStub)).outcome, "in_progress");
  assert.equal(inFlightStub.calls.length, 0);
  assert.equal((await reservationRef(inFlight, "order1").get()).data()?.amount, reserved.amount);
});

// ===== RACE-05 — tentativas concorrentes de iniciar a mesma cobrança =====
caso("RACE-05", "2 e 5 tentativas simultâneas de iniciar a cobrança → uma intenção, um amount, uma chamada ao provedor", async () => {
  for (const concurrency of [2, 5]) {
    const uid = tenant();
    await seedOrder(uid, "order1");
    const stub = providerStub();
    const results = await Promise.all(Array.from({ length: concurrency }, () => startCharge(uid, "order1", stub)));
    assert.equal(results.filter((result) => result.outcome === "created").length, 1, JSON.stringify(results));
    assert.ok(results.every((result) => ["created", "in_progress", "reused"].includes(result.outcome)), JSON.stringify(results));
    await assertChargedWithFinalTotal(uid, "order1", stub, OLD_TOTAL);
  }
});

// ===== Contrato da rota preservado =====
caso("CH-01", "estado do pedido decidido na transação da reserva: inexistente, pago, falho/cancelado, total inválido — sem reservar", async () => {
  const uid = tenant();
  await assert.rejects(reserveOrderCharge(db, uid, "missing"), (error: unknown) => error instanceof OrderChargeReservationError && error.code === "ORDER_NOT_FOUND");
  const refused: Array<[string, Record<string, unknown>, string]> = [
    ["paid", { paymentStatus: "paid" }, "ORDER_ALREADY_PAID"],
    ["failed", { paymentStatus: "failed" }, "ORDER_NOT_PAYABLE"],
    ["cancelled", { paymentStatus: "cancelled" }, "ORDER_NOT_PAYABLE"],
    ["no-total", { total: "201" }, "ORDER_NOT_PAYABLE"],
  ];
  for (const [orderId, overrides, code] of refused) {
    await seedOrder(uid, orderId, overrides);
    await assert.rejects(reserveOrderCharge(db, uid, orderId), (error: unknown) => error instanceof OrderChargeReservationError && error.code === code);
    assert.equal((await reservationRef(uid, orderId).get()).exists, false, `${orderId} não pode deixar reserva`);
  }
});
caso("CH-02", "recusa definitiva do provedor libera a reserva; o pedido volta a ser editável e o novo início congela o total editado", async () => {
  const uid = tenant();
  await seedOrder(uid, "order1");
  const failing = providerStub({ fail: true });
  await assert.rejects(startCharge(uid, "order1", failing), (error: unknown) => error instanceof MercadoPagoOrderChargeError && error.providerCall === "rejected");
  assert.equal((await reservationRef(uid, "order1").get()).exists, false, "reserva liberada");
  assert.equal((await editTo(uid, "order1", 5)).total, NEW_TOTAL, "sem reserva e sem cobrança, a edição volta a passar");
  const stub = providerStub();
  assert.equal((await startCharge(uid, "order1", stub)).outcome, "created");
  await assertChargedWithFinalTotal(uid, "order1", stub, NEW_TOTAL);
});

async function main(): Promise<void> {
  requireEmulator();
  initializeFirebaseAdmin();
  db = getFirebaseAdmin().firestore();
  for (const [id, description, fn] of cases) {
    await fn();
    console.log(`ok ${id} — ${description}`);
  }
  console.log(`Order charge race emulator tests passed: ${cases.length} casos.`);
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
