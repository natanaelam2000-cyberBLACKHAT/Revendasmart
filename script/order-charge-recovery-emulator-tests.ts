/**
 * PEDIDOS EDITÁVEIS — Etapa 2C: cobrança recuperável e idempotente contra o Firestore de verdade (emulador).
 *
 * Invariante: UMA intenção de cobrança (reserva/chargeId) nunca chega ao provedor duas vezes por retry, timeout,
 * queda, falha de finalize ou de persistência local. Na dúvida, fica fechado (ORDER_CHARGE_RECONCILIATION_REQUIRED)
 * e a reserva — com o bloqueio de edição — fica.
 *
 * O Mercado Pago é um fake local: NÃO deduplica pela chave (a API real não documenta X-Idempotency-Key em
 * POST /checkout/preferences), registra cada POST que "chegou" (chave, valor, chargeId) e só a busca por
 * external_reference permite reconciliar. "Queda" = promessa que nunca resolve: nenhum catch/finally roda.
 *
 * Roda como os demais testes de emulador (só projeto demo-*):
 *   npx --yes firebase-tools@15.24.0 emulators:exec --project demo-revendasmart --only firestore "tsx script/order-charge-recovery-emulator-tests.ts"
 */
import assert from "node:assert/strict";
import type { Firestore } from "firebase-admin/firestore";
import { getFirebaseAdmin, initializeFirebaseAdmin } from "../server/firebase-admin-init";
import { editOrderItemsCommand, OrderEditCommandError } from "../server/order-edit-command";
import {
  ORDER_CHARGE_PROVIDER_CALL_WINDOW_MS,
  startOrderMercadoPagoCharge,
  type OrderChargeProvider,
  type OrderChargeProviderResult,
  type StartOrderChargeHooks,
  type StartOrderChargeResult,
} from "../server/public-catalog-order-payment-idempotency";
import { MercadoPagoOrderChargeError } from "../server/payments";
import { buildExternalReference } from "../shared/charges";
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
  return `order-charge-rec-${Date.now().toString(36)}-${sequence}-${Math.random().toString(36).slice(2, 8)}`;
}

const lineA: OrderItem = { productId: "prodA", name: "Batom (cor antiga)", quantity: 10, unitPrice: 19.9 };
const lineManual: OrderItem = { name: "Embrulho", quantity: 1, unitPrice: 2 };
const TOTAL = 201;

const orderRef = (uid: string, orderId: string) => db.collection("users").doc(uid).collection("orders").doc(orderId);
const reservationRef = (uid: string, orderId: string) => db.collection("users").doc(uid).collection("orderChargeIdempotency").doc(orderId);
const chargeRef = (uid: string, chargeId: string) => db.collection("users").doc(uid).collection("charges").doc(chargeId);
const chargesOf = (uid: string, orderId: string) => db.collection("users").doc(uid).collection("charges").where("orderId", "==", orderId).get();

async function seedOrder(uid: string, orderId: string): Promise<void> {
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
  });
}

async function reservation(uid: string, orderId: string): Promise<Record<string, any> | undefined> {
  return (await reservationRef(uid, orderId).get()).data();
}

/** Tira a reserva da janela de "chamada em andamento" sem esperar o relógio (nunca apaga nada). */
async function ageProviderStart(uid: string, orderId: string): Promise<void> {
  await reservationRef(uid, orderId).update({ providerStartedAt: new Date(Date.now() - ORDER_CHARGE_PROVIDER_CALL_WINDOW_MS - 1000).toISOString() });
}

const never = (): Promise<never> => new Promise<never>(() => {});

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

type FakeBehavior =
  | "succeed"
  | "precheck_fail"
  | "reject"
  | "timeout_created"
  | "timeout_not_created"
  | "hang_after_mark"
  | "hang_after_create";

interface FakePreference {
  id: string;
  externalReference: string;
  amount: number;
  idempotencyKey: string;
}

/** Mercado Pago fake: cada POST que "chega" cria uma preferência nova — sem deduplicar pela chave. */
class FakeMercadoPago {
  behavior: FakeBehavior = "succeed";
  searchLag = false;
  readonly preferences: FakePreference[] = [];
  readonly posts: Array<{ idempotencyKey: string; amount: number; chargeId: string }> = [];
  invocations = 0;
  lookups = 0;
  readonly marked = deferred();
  readonly created = deferred();

  provider(): OrderChargeProvider {
    return {
      createCharge: async (params) => {
        this.invocations += 1;
        if (this.behavior === "precheck_fail") {
          throw new MercadoPagoOrderChargeError("MP_TOKEN_UNAVAILABLE", "sem token (fake)", 503, undefined, "not_started");
        }
        await params.markProviderCallStarted();
        this.marked.resolve();
        if (this.behavior === "hang_after_mark") return await never();
        this.posts.push({ idempotencyKey: params.idempotencyKey, amount: params.amount, chargeId: params.chargeId });
        if (this.behavior === "reject") {
          // Mesmo um 4xx após o POST não prova ausência de efeito externo; 2C fica fail-closed.
          throw new MercadoPagoOrderChargeError("PAYMENT_PREFERENCE_FAILED", "resposta HTTP ambígua (fake)", 502, { status: 400 }, "ambiguous");
        }
        const preference: FakePreference = {
          id: `pref-${this.preferences.length + 1}`,
          externalReference: buildExternalReference(params.uid, params.chargeId, { kind: "order", id: params.orderId }),
          amount: params.amount,
          idempotencyKey: params.idempotencyKey,
        };
        if (this.behavior !== "timeout_not_created") this.preferences.push(preference);
        this.created.resolve();
        if (this.behavior === "timeout_created" || this.behavior === "timeout_not_created") {
          throw new MercadoPagoOrderChargeError("PAYMENT_PREFERENCE_FAILED", "timeout (fake)", 502, new Error("aborted"), "ambiguous");
        }
        if (this.behavior === "hang_after_create") return await never();
        return await this.persist(params, preference);
      },
      findCharge: async (params) => {
        this.lookups += 1;
        if (this.searchLag) return null;
        const ref = buildExternalReference(params.uid, params.chargeId, { kind: "order", id: params.orderId });
        const matches = this.preferences.filter((preference) => preference.externalReference === ref);
        if (matches.length === 0) return null;
        if (matches.length > 1 || matches[0].amount !== params.amount) {
          throw new MercadoPagoOrderChargeError("PAYMENT_PREFERENCE_AMBIGUOUS", "ambíguo (fake)", 409);
        }
        return await this.persist(params, matches[0]);
      },
    };
  }

  /** Mesmo efeito local da função real: grava charges/{chargeId}. */
  private async persist(params: { uid: string; chargeId: string; orderId: string; amount: number }, preference: FakePreference): Promise<OrderChargeProviderResult> {
    const paymentUrl = `https://fake-mp.invalid/${preference.id}`;
    await chargeRef(params.uid, params.chargeId).set({
      id: params.chargeId, orderId: params.orderId, amount: params.amount, status: "pending", paymentUrl, preferenceId: preference.id,
    });
    return { chargeId: params.chargeId, paymentUrl, preferenceId: preference.id };
  }
}

function start(uid: string, orderId: string, fake: FakeMercadoPago, hooks: StartOrderChargeHooks = {}): Promise<StartOrderChargeResult> {
  return startOrderMercadoPagoCharge(db, { uid, orderId, storeName: "Loja da Ana", storeSlug: "loja-da-ana" }, fake.provider(), hooks);
}

async function editTo(uid: string, orderId: string, quantityA: number) {
  const version = String((await orderRef(uid, orderId).get()).data()?.updatedAt);
  return await editOrderItemsCommand(db, uid, {
    orderId,
    expectedUpdatedAt: version,
    idempotencyKey: `rec-edit-${sequence += 1}-${Math.random().toString(36).slice(2, 8)}`,
    items: [{ productId: "prodA", quantity: quantityA }, { name: "Embrulho", quantity: 1, unitPrice: 2 }],
  });
}

const isPaymentStarted = (error: unknown) => error instanceof OrderEditCommandError && error.code === "ORDER_PAYMENT_STARTED";

const cases: Array<[string, string, () => Promise<void>]> = [];
function caso(id: string, description: string, fn: () => Promise<void>): void {
  cases.push([id, description, fn]);
}

// ===== Antes do provedor =====
caso("REC-01", "falha ANTES do provedor (pré-checagem) → reserva liberada; nada chegou ao provedor; retry cobra uma vez", async () => {
  const uid = tenant();
  await seedOrder(uid, "order1");
  const fake = new FakeMercadoPago();
  fake.behavior = "precheck_fail";
  await assert.rejects(start(uid, "order1", fake), (error: unknown) => error instanceof MercadoPagoOrderChargeError && error.providerCall === "not_started");
  assert.equal(await reservation(uid, "order1"), undefined, "reserva liberada: o provedor comprovadamente não foi chamado");
  assert.equal(fake.posts.length, 0);
  assert.equal((await editTo(uid, "order1", 5)).total, 101.5, "sem reserva, a edição volta a passar");
  fake.behavior = "succeed";
  assert.equal((await start(uid, "order1", fake)).outcome, "created");
  assert.equal(fake.posts.length, 1);
});
caso("REC-01b", "resposta 4xx após o POST → reconciliação obrigatória; reserva mantida e retry não duplica", async () => {
  const uid = tenant();
  await seedOrder(uid, "order1");
  const fake = new FakeMercadoPago();
  fake.behavior = "reject";
  assert.equal((await start(uid, "order1", fake)).outcome, "reconciliation_required");
  const held = await reservation(uid, "order1");
  assert.ok(held, "reserva permanece fechada após resposta 4xx pós-POST");
  assert.equal(fake.posts.length, 1);
  assert.equal(held?.providerIdempotencyKey, fake.posts[0].idempotencyKey, "retry preserva a chave externa da mesma intenção");
  assert.equal((await start(uid, "order1", fake)).outcome, "reconciliation_required");
  assert.equal(fake.posts.length, 1, "retry não faz segundo POST");
});

// ===== Depois do provedor =====
caso("REC-02", "provedor OK + falha ao finalizar → URL entregue, reserva mantida; retry NÃO chama o provedor de novo", async () => {
  const uid = tenant();
  await seedOrder(uid, "order1");
  const fake = new FakeMercadoPago();
  const first = await start(uid, "order1", fake, { beforeFinalize: async () => { throw new Error("finalize indisponível"); } });
  assert.equal(first.outcome, "created");
  assert.equal((await reservation(uid, "order1"))?.status, "provider_started", "nunca liberada depois do efeito externo");
  const retry = await start(uid, "order1", fake);
  assert.ok(retry.outcome === "reused" && retry.via === "local_charge", JSON.stringify(retry));
  assert.ok(first.outcome === "created" && retry.chargeId === first.chargeId && retry.paymentUrl === first.paymentUrl);
  assert.equal(fake.posts.length, 1);
  assert.equal((await reservation(uid, "order1"))?.status, "ready");
  assert.equal((await chargesOf(uid, "order1")).size, 1);
});
caso("REC-02b", "queda depois de gravar a cobrança e antes de finalizar (C5) → retry finaliza a partir da cobrança local", async () => {
  const uid = tenant();
  await seedOrder(uid, "order1");
  const fake = new FakeMercadoPago();
  const reachedFinalize = deferred();
  void start(uid, "order1", fake, { beforeFinalize: async () => { reachedFinalize.resolve(); await never(); } });
  await reachedFinalize.promise;
  const retry = await start(uid, "order1", fake);
  assert.ok(retry.outcome === "reused" && retry.via === "local_charge", JSON.stringify(retry));
  assert.equal(fake.posts.length, 1);
});
caso("REC-03", "cobrança local existe + reserva não ready → finaliza sem nova cobrança nem busca", async () => {
  const uid = tenant();
  await seedOrder(uid, "order1");
  await reservationRef(uid, "order1").set({
    status: "provider_started", chargeId: "charge-rec03", createdAt: new Date().toISOString(), amount: TOTAL,
    orderUpdatedAt: "2026-09-21T10:00:00.000Z", providerIdempotencyKey: "charge-rec03", providerStartedAt: new Date().toISOString(),
  });
  await chargeRef(uid, "charge-rec03").set({ id: "charge-rec03", orderId: "order1", amount: TOTAL, status: "pending", paymentUrl: "https://fake-mp.invalid/pref-x", preferenceId: "pref-x" });
  const fake = new FakeMercadoPago();
  const result = await start(uid, "order1", fake);
  assert.ok(result.outcome === "reused" && result.via === "local_charge" && result.paymentUrl === "https://fake-mp.invalid/pref-x", JSON.stringify(result));
  assert.equal(fake.invocations, 0);
  assert.equal(fake.lookups, 0);
  assert.equal((await reservation(uid, "order1"))?.status, "ready");
});
caso("REC-03b", "cobrança local INCOERENTE (outro valor ou outro pedido) → fechado: não devolve, não finaliza, não chama o provedor", async () => {
  const uid = tenant();
  await seedOrder(uid, "order1");
  const startedAt = new Date().toISOString();
  await reservationRef(uid, "order1").set({
    status: "provider_started", orderId: "order1", chargeId: "charge-rec03b", createdAt: startedAt, amount: TOTAL,
    orderUpdatedAt: "2026-09-21T10:00:00.000Z", providerIdempotencyKey: "charge-rec03b", providerStartedAt: startedAt,
  });
  await chargeRef(uid, "charge-rec03b").set({ id: "charge-rec03b", orderId: "order1", amount: 999, status: "pending", paymentUrl: "https://fake-mp.invalid/pref-x", preferenceId: "pref-x" });
  const fake = new FakeMercadoPago();
  assert.equal((await start(uid, "order1", fake)).outcome, "inconsistent", "valor diferente do congelado na reserva");
  await chargeRef(uid, "charge-rec03b").update({ amount: TOTAL, orderId: "outro-pedido" });
  assert.equal((await start(uid, "order1", fake)).outcome, "inconsistent", "cobrança de outro pedido");
  assert.equal((await reservation(uid, "order1"))?.status, "provider_started", "nada finalizado a partir de dado incoerente");
  await reservationRef(uid, "order1").update({ status: "ready" });
  assert.equal((await start(uid, "order1", fake)).outcome, "inconsistent", "nem o replay de ready devolve cobrança incoerente");
  assert.equal(fake.invocations, 0);
  assert.equal(fake.lookups, 0);
  await assert.rejects(editTo(uid, "order1", 5), isPaymentStarted);
});
caso("REC-04", "timeout/erro ambíguo → reserva NÃO é apagada (provider_started + resultado desconhecido)", async () => {
  const uid = tenant();
  await seedOrder(uid, "order1");
  const fake = new FakeMercadoPago();
  fake.behavior = "timeout_created";
  assert.equal((await start(uid, "order1", fake)).outcome, "reconciliation_required");
  const kept = await reservation(uid, "order1");
  assert.equal(kept?.status, "provider_started");
  assert.equal(kept?.providerOutcome, "unknown");
  assert.equal(fake.posts.length, 1);
  assert.equal(fake.preferences.length, 1, "o provedor tinha criado a preferência");
});
caso("REC-05", "retry depois de resultado ambíguo → zero segunda cobrança (adota a existente, ou fica fechado)", async () => {
  // (a) o provedor tinha criado: a reconciliação adota a MESMA preferência.
  const uid = tenant();
  await seedOrder(uid, "order1");
  const fake = new FakeMercadoPago();
  fake.behavior = "timeout_created";
  await start(uid, "order1", fake);
  fake.behavior = "succeed";
  const adopted = await start(uid, "order1", fake);
  assert.ok(adopted.outcome === "reused" && adopted.via === "provider_lookup" && adopted.preferenceId === "pref-1", JSON.stringify(adopted));
  assert.equal(fake.posts.length, 1);
  assert.equal(fake.preferences.length, 1);
  assert.equal((await reservation(uid, "order1"))?.status, "ready");

  // (b) o provedor não tinha criado: sem prova de ausência, continua fechado — e nunca chama de novo.
  const other = tenant();
  await seedOrder(other, "order1");
  const fake2 = new FakeMercadoPago();
  fake2.behavior = "timeout_not_created";
  await start(other, "order1", fake2);
  fake2.behavior = "succeed";
  for (let retry = 0; retry < 3; retry += 1) {
    assert.equal((await start(other, "order1", fake2)).outcome, "reconciliation_required");
  }
  assert.equal(fake2.posts.length, 1);
  assert.equal(fake2.preferences.length, 0);
  assert.equal((await reservation(other, "order1"))?.status, "provider_started");

  // (c) busca atrasada: fechado enquanto não enxerga; depois adota a mesma preferência.
  const third = tenant();
  await seedOrder(third, "order1");
  const fake3 = new FakeMercadoPago();
  fake3.behavior = "timeout_created";
  await start(third, "order1", fake3);
  fake3.searchLag = true;
  assert.equal((await start(third, "order1", fake3)).outcome, "reconciliation_required");
  fake3.searchLag = false;
  assert.ok((await start(third, "order1", fake3)).outcome === "reused");
  assert.equal(fake3.posts.length, 1);
});
caso("REC-06", "reserva ready → replay da MESMA cobrança, zero chamada nova ao provedor", async () => {
  const uid = tenant();
  await seedOrder(uid, "order1");
  const fake = new FakeMercadoPago();
  const first = await start(uid, "order1", fake);
  assert.equal(first.outcome, "created");
  for (let retry = 0; retry < 3; retry += 1) {
    const replay = await start(uid, "order1", fake);
    assert.ok(replay.outcome === "reused" && replay.via === "ready", JSON.stringify(replay));
    assert.ok(first.outcome === "created" && replay.chargeId === first.chargeId && replay.paymentUrl === first.paymentUrl);
  }
  assert.equal(fake.invocations, 1);
  assert.equal(fake.lookups, 0);
});

// ===== Quedas =====
caso("REC-07", "queda logo depois de reservar (C1) → retry assume a pendente com a MESMA chave; o 'processo morto' que volta não cobra", async () => {
  const uid = tenant();
  await seedOrder(uid, "order1");
  const fake = new FakeMercadoPago();
  const paused = deferred();
  const release = deferred();
  const crashed = start(uid, "order1", fake, { afterReservation: async () => { paused.resolve(); await release.promise; } });
  await paused.promise;
  const pending = await reservation(uid, "order1");
  assert.deepEqual(Object.keys(pending ?? {}).sort(), ["amount", "chargeId", "createdAt", "orderId", "orderUpdatedAt", "providerIdempotencyKey", "status"], "intenção inteira persistida antes da chamada externa, sem dado do cliente");
  assert.equal(pending?.status, "pending");
  assert.equal(pending?.orderId, "order1");
  assert.equal(pending?.amount, TOTAL);
  assert.equal(pending?.orderUpdatedAt, "2026-09-21T10:00:00.000Z");
  assert.equal(pending?.providerIdempotencyKey, pending?.chargeId, "chave externa gravada ANTES de qualquer chamada");
  const retry = await start(uid, "order1", fake);
  assert.equal(retry.outcome, "created");
  assert.equal(fake.posts.length, 1);
  assert.equal(fake.posts[0].idempotencyKey, pending?.providerIdempotencyKey, "o retry usa a chave já persistida, não uma nova");
  release.resolve();
  assert.equal((await crashed).outcome, "in_progress", "a tentativa antiga perde a marcação e não chama o provedor");
  assert.equal(fake.posts.length, 1);
});
caso("REC-08", "queda depois de marcar provider_started, antes do POST (C2) → em andamento; depois da janela, fechado — nunca chama de novo", async () => {
  const uid = tenant();
  await seedOrder(uid, "order1");
  const fake = new FakeMercadoPago();
  fake.behavior = "hang_after_mark";
  void start(uid, "order1", fake);
  await fake.marked.promise;
  const started = await reservation(uid, "order1");
  assert.equal(started?.status, "provider_started");
  assert.equal(typeof started?.providerStartedAt, "string", "marca gravada antes do POST");
  fake.behavior = "succeed";
  assert.equal((await start(uid, "order1", fake)).outcome, "in_progress");
  await ageProviderStart(uid, "order1");
  assert.equal((await start(uid, "order1", fake)).outcome, "reconciliation_required");
  assert.equal(fake.posts.length, 0);
  assert.equal(fake.lookups, 1);
  assert.equal((await reservation(uid, "order1"))?.status, "provider_started", "tempo nunca apaga a reserva");
});
caso("REC-09", "provedor criou e o processo caiu antes de gravar (C3/C4) → retry reconcilia pela busca; com busca atrasada, fechado", async () => {
  const uid = tenant();
  await seedOrder(uid, "order1");
  const fake = new FakeMercadoPago();
  fake.behavior = "hang_after_create";
  void start(uid, "order1", fake);
  await fake.created.promise;
  fake.behavior = "succeed";
  assert.equal((await start(uid, "order1", fake)).outcome, "in_progress");
  await ageProviderStart(uid, "order1");
  fake.searchLag = true;
  assert.equal((await start(uid, "order1", fake)).outcome, "reconciliation_required", "sem prova, fechado");
  fake.searchLag = false;
  const adopted = await start(uid, "order1", fake);
  assert.ok(adopted.outcome === "reused" && adopted.via === "provider_lookup" && adopted.preferenceId === "pref-1", JSON.stringify(adopted));
  assert.equal(fake.posts.length, 1);
  assert.equal(fake.preferences.length, 1);
  assert.equal((await chargesOf(uid, "order1")).size, 1);
});
caso("REC-10", "edição durante reconciliação → ORDER_PAYMENT_STARTED; total intocado", async () => {
  const uid = tenant();
  await seedOrder(uid, "order1");
  const fake = new FakeMercadoPago();
  fake.behavior = "timeout_not_created";
  assert.equal((await start(uid, "order1", fake)).outcome, "reconciliation_required");
  assert.equal((await chargesOf(uid, "order1")).size, 0, "sem cobrança local — só a reserva protege");
  await assert.rejects(editTo(uid, "order1", 5), isPaymentStarted);
  assert.equal((await orderRef(uid, "order1").get()).data()?.total, TOTAL);
});

async function main(): Promise<void> {
  requireEmulator();
  initializeFirebaseAdmin();
  db = getFirebaseAdmin().firestore();
  for (const [id, description, fn] of cases) {
    await fn();
    console.log(`ok ${id} — ${description}`);
  }
  console.log(`Order charge recovery emulator tests passed: ${cases.length} casos.`);
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
