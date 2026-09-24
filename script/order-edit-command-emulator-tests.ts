/**
 * PEDIDOS EDITÁVEIS — Etapa 2A: comando de edição contra o Firestore de verdade (emulador).
 *
 * Só roda no emulador: recusa começar se o projeto não for demo-* ou se FIRESTORE_EMULATOR_HOST não apontar
 * para a máquina local. Cada caso usa um tenant novo — nada é limpo nem compartilhado entre casos.
 *
 * Portas padrão do projeto:
 *   npx --yes firebase-tools@15.24.0 emulators:exec --project demo-revendasmart --only firestore "tsx script/order-edit-command-emulator-tests.ts"
 * Isolado de outra sessão (firebase.json próprio com outras portas):
 *   firebase --config <outro firebase.json> emulators:exec --project demo-revendasmart --only firestore "tsx script/order-edit-command-emulator-tests.ts"
 */
import assert from "node:assert/strict";
import type { Express, NextFunction, Request, Response } from "express";
import type { DocumentData, DocumentReference, Firestore } from "firebase-admin/firestore";
import { getFirebaseAdmin, initializeFirebaseAdmin } from "../server/firebase-admin-init";
import { handleOrderEditRequest, registerOrderEditRoutes } from "../server/order-edit-command";
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
  return `order-edit-${Date.now().toString(36)}-${sequence}-${Math.random().toString(36).slice(2, 8)}`;
}

function newKey(): string {
  sequence += 1;
  return `edit-${sequence}-${Math.random().toString(36).slice(2, 10)}`;
}

const CREATED_AT = "2026-09-20T10:00:00.000Z";
const UPDATED_AT = "2026-09-21T10:00:00.000Z";
const lineA: OrderItem = { productId: "prodA", name: "Batom (cor antiga)", quantity: 10, unitPrice: 19.9, imageUrl: "https://x.test/a.webp" };
const lineManual: OrderItem = { name: "Embrulho", quantity: 1, unitPrice: 2 };

const orderRef = (uid: string, orderId: string) => db.collection("users").doc(uid).collection("orders").doc(orderId);
const productRef = (uid: string, productId: string) => db.collection("users").doc(uid).collection("products").doc(productId);
const idempotencyRef = (uid: string, key: string) => db.collection("users").doc(uid).collection("orderEditIdempotency").doc(key);

async function seedOrder(uid: string, orderId: string, overrides: Record<string, unknown> = {}): Promise<DocumentData> {
  const items = (overrides.items as OrderItem[] | undefined) ?? [lineA, lineManual];
  const order = {
    id: orderId,
    clientId: "client-1",
    clientName: "Maria",
    clientPhone: "5511999999999",
    storeName: "Loja da Ana",
    status: "new",
    items,
    total: calculateOrderTotal(items),
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
    notes: "Entregar à tarde",
    expectedDate: "2026-09-30",
    ...overrides,
  };
  await orderRef(uid, orderId).set(order);
  return order;
}

async function seedProduct(uid: string, productId: string, data: Record<string, unknown>): Promise<void> {
  await productRef(uid, productId).set(data);
}

/** Dados + carimbo de escrita do servidor: carimbo igual prova que o documento não foi regravado. */
async function state(ref: DocumentReference): Promise<{ exists: boolean; data: DocumentData | undefined; writtenAt: string | undefined }> {
  const snapshot = await ref.get();
  return { exists: snapshot.exists, data: snapshot.data(), writtenAt: snapshot.updateTime?.valueOf() };
}

interface HttpResult {
  status: number;
  body: Record<string, any>;
}

function fakeResponse(captured: HttpResult): Response {
  const res = {
    status(code: number) {
      captured.status = code;
      return res;
    },
    json(value: Record<string, any>) {
      captured.body = value;
      return res;
    },
  };
  return res as unknown as Response;
}

async function httpEdit(uid: string | undefined, orderId: string, body: unknown): Promise<HttpResult> {
  const req = { firebaseUid: uid, params: { orderId }, body, requestId: "order-edit-emulator-test" } as unknown as Request;
  const captured: HttpResult = { status: 0, body: {} };
  await handleOrderEditRequest(req, fakeResponse(captured), db);
  return captured;
}

function editBody(items: unknown[], overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { expectedUpdatedAt: UPDATED_AT, idempotencyKey: newKey(), items, ...overrides };
}

function expectError(result: HttpResult, status: number, code: string): void {
  assert.equal(result.status, status, `esperava ${status} ${code}, veio ${result.status} ${JSON.stringify(result.body)}`);
  assert.equal(result.body.code, code);
}

const cases: Array<[string, string, () => Promise<void>]> = [];
function caso(id: string, description: string, fn: () => Promise<void>): void {
  cases.push([id, description, fn]);
}

// ===== Rota, autenticação e dono =====
caso("E-01", "rota POST /api/orders/:orderId/edit atrás do requireAuth; o uid vem só do middleware", async () => {
  const registered: Array<{ path: string; handlers: Array<(...args: any[]) => any> }> = [];
  const fakeApp = { post: (path: string, ...handlers: Array<(...args: any[]) => any>) => registered.push({ path, handlers }) } as unknown as Express;
  const requireAuth = (req: Request, _res: Response, next: NextFunction) => {
    (req as Request & { firebaseUid?: string }).firebaseUid = String(req.headers["x-test-uid"]);
    next();
  };
  registerOrderEditRoutes(fakeApp, requireAuth);
  assert.equal(registered.length, 1);
  assert.equal(registered[0].path, "/api/orders/:orderId/edit");
  assert.equal(registered[0].handlers[0], requireAuth);

  const uid = tenant();
  await seedOrder(uid, "order1");
  const req = { headers: { "x-test-uid": uid }, params: { orderId: "order1" }, body: editBody([{ productId: "prodA", quantity: 7 }, lineManual]) } as unknown as Request;
  const captured: HttpResult = { status: 0, body: {} };
  const res = fakeResponse(captured);
  await new Promise<void>((resolve) => registered[0].handlers[0](req, res, resolve));
  await registered[0].handlers[1](req, res);
  assert.equal(captured.status, 200, JSON.stringify(captured.body));
  assert.deepEqual((await orderRef(uid, "order1").get()).data()?.items, [{ ...lineA, quantity: 7 }, lineManual]);
});
caso("E-02", "dono edita o próprio pedido: só items/total/updatedAt mudam e o resultado bate com o gravado", async () => {
  const uid = tenant();
  await seedOrder(uid, "order1");
  const result = await httpEdit(uid, "order1", editBody([{ productId: "prodA", quantity: 7 }, lineManual]));
  assert.equal(result.status, 200, JSON.stringify(result.body));
  const saved = (await orderRef(uid, "order1").get()).data() ?? {};
  assert.deepEqual(saved.items, [{ ...lineA, quantity: 7 }, lineManual]);
  assert.equal(saved.total, 141.3);
  assert.notEqual(saved.updatedAt, UPDATED_AT);
  assert.deepEqual(result.body, { orderId: "order1", updatedAt: saved.updatedAt, total: 141.3, itemCount: 2, idempotentReplay: false });
});
caso("E-03", "cross-tenant: outro uid nunca enxerga nem altera o pedido", async () => {
  const owner = tenant();
  const intruder = tenant();
  await seedOrder(owner, "order1");
  const before = await state(orderRef(owner, "order1"));
  const body = editBody([{ productId: "prodA", quantity: 1 }]);
  expectError(await httpEdit(intruder, "order1", body), 404, "ORDER_NOT_FOUND");
  assert.deepEqual(await state(orderRef(owner, "order1")), before);
  assert.equal((await orderRef(intruder, "order1").get()).exists, false);
  assert.equal((await idempotencyRef(intruder, String(body.idempotencyKey)).get()).exists, false);
});
caso("E-04", "sem uid autenticado → 401, nada gravado", async () => {
  const uid = tenant();
  await seedOrder(uid, "order1");
  const before = await state(orderRef(uid, "order1"));
  expectError(await httpEdit(undefined, "order1", editBody([{ productId: "prodA", quantity: 1 }])), 401, "UNAUTHENTICATED");
  assert.deepEqual(await state(orderRef(uid, "order1")), before);
});

// ===== Status e pagamento =====
caso("E-05", "status new e in_progress são editáveis", async () => {
  for (const status of ["new", "in_progress"]) {
    const uid = tenant();
    await seedOrder(uid, "order1", { status });
    const result = await httpEdit(uid, "order1", editBody([{ productId: "prodA", quantity: 3 }]));
    assert.equal(result.status, 200, `${status}: ${JSON.stringify(result.body)}`);
    assert.equal((await orderRef(uid, "order1").get()).data()?.status, status, "status não muda na edição");
  }
});
caso("E-06", "status ready, delivered e cancelled bloqueiam (ORDER_NOT_EDITABLE) sem gravar", async () => {
  for (const status of ["ready", "delivered", "cancelled", "arquivado"]) {
    const uid = tenant();
    await seedOrder(uid, "order1", { status });
    const before = await state(orderRef(uid, "order1"));
    expectError(await httpEdit(uid, "order1", editBody([{ productId: "prodA", quantity: 3 }])), 409, "ORDER_NOT_EDITABLE");
    assert.deepEqual(await state(orderRef(uid, "order1")), before, status);
  }
});
caso("E-07", "pagamento iniciado bloqueia (awaiting/reported/paid/failed/cancelled); not_started edita", async () => {
  const catalog = { clientId: "public-catalog", paymentMethod: "pix", paymentProvider: "manual_pix", clientOrderId: "client-order-1" };
  for (const paymentStatus of ["awaiting_customer_payment", "customer_reported_paid", "paid", "failed", "cancelled", "desconhecido"]) {
    const uid = tenant();
    await seedOrder(uid, "order1", { ...catalog, paymentStatus });
    const before = await state(orderRef(uid, "order1"));
    expectError(await httpEdit(uid, "order1", editBody([{ productId: "prodA", quantity: 3 }])), 409, "ORDER_PAYMENT_STARTED");
    assert.deepEqual(await state(orderRef(uid, "order1")), before, paymentStatus);
  }
  const uid = tenant();
  await seedOrder(uid, "order1", { clientId: "public-catalog", paymentMethod: "whatsapp", paymentProvider: "manual_whatsapp", paymentStatus: "not_started", clientOrderId: "c1" });
  assert.equal((await httpEdit(uid, "order1", editBody([{ productId: "prodA", quantity: 3 }]))).status, 200);
});
caso("E-08", "reserva de cobrança (pending ou ready) bloqueia mesmo com paymentStatus not_started", async () => {
  for (const reservationStatus of ["pending", "ready"]) {
    const uid = tenant();
    await seedOrder(uid, "order1", { clientId: "public-catalog", paymentMethod: "whatsapp", paymentProvider: "manual_whatsapp", paymentStatus: "not_started", clientOrderId: "c1" });
    await db.collection("users").doc(uid).collection("orderChargeIdempotency").doc("order1").set({ status: reservationStatus, chargeId: "charge1", createdAt: CREATED_AT });
    const before = await state(orderRef(uid, "order1"));
    expectError(await httpEdit(uid, "order1", editBody([{ productId: "prodA", quantity: 3 }])), 409, "ORDER_PAYMENT_STARTED");
    assert.deepEqual(await state(orderRef(uid, "order1")), before, reservationStatus);
  }
});
caso("E-09", "cobrança gravada para o pedido sem reserva (órfã) também bloqueia", async () => {
  const uid = tenant();
  await seedOrder(uid, "order1");
  await db.collection("users").doc(uid).collection("charges").doc("charge1").set({ id: "charge1", orderId: "order1", status: "pending", amount: 201 });
  await db.collection("users").doc(uid).collection("charges").doc("charge2").set({ id: "charge2", orderId: "outro-pedido", status: "paid", amount: 10 });
  expectError(await httpEdit(uid, "order1", editBody([{ productId: "prodA", quantity: 3 }])), 409, "ORDER_PAYMENT_STARTED");
  const other = tenant();
  await seedOrder(other, "order1");
  await db.collection("users").doc(other).collection("charges").doc("charge2").set({ id: "charge2", orderId: "outro-pedido", status: "paid", amount: 10 });
  assert.equal((await httpEdit(other, "order1", editBody([{ productId: "prodA", quantity: 3 }]))).status, 200, "cobrança de OUTRO pedido não bloqueia");
});

// ===== CAS e concorrência =====
caso("E-10", "CAS: expectedUpdatedAt atual edita; divergente → STALE_ORDER_VERSION sem gravar", async () => {
  const uid = tenant();
  await seedOrder(uid, "order1");
  const before = await state(orderRef(uid, "order1"));
  expectError(await httpEdit(uid, "order1", editBody([{ productId: "prodA", quantity: 3 }], { expectedUpdatedAt: "2026-09-21T09:59:59.999Z" })), 409, "STALE_ORDER_VERSION");
  assert.deepEqual(await state(orderRef(uid, "order1")), before);
  const ok = await httpEdit(uid, "order1", editBody([{ productId: "prodA", quantity: 3 }]));
  assert.equal(ok.status, 200);
  expectError(await httpEdit(uid, "order1", editBody([{ productId: "prodA", quantity: 2 }])), 409, "STALE_ORDER_VERSION");
  // Redução (3 → 2): o produto A não existe neste tenant, e aumentar seria bloqueado por outra regra (E-20).
  assert.equal((await httpEdit(uid, "order1", editBody([{ productId: "prodA", quantity: 2 }], { expectedUpdatedAt: ok.body.updatedAt }))).status, 200, "com a versão nova volta a editar");
});
caso("E-11", "duas edições concorrentes na mesma versão: exatamente uma vence, a outra recebe STALE", async () => {
  const uid = tenant();
  await seedOrder(uid, "order1");
  const results = await Promise.all([
    httpEdit(uid, "order1", editBody([{ productId: "prodA", quantity: 3 }])),
    httpEdit(uid, "order1", editBody([{ productId: "prodA", quantity: 5 }])),
  ]);
  const winners = results.filter((result) => result.status === 200);
  const losers = results.filter((result) => result.status !== 200);
  assert.equal(winners.length, 1, JSON.stringify(results));
  expectError(losers[0], 409, "STALE_ORDER_VERSION");
  const saved = (await orderRef(uid, "order1").get()).data() ?? {};
  assert.equal(saved.updatedAt, winners[0].body.updatedAt);
  assert.equal(saved.total, winners[0].body.total);
});

// ===== Idempotência =====
caso("E-12", "retry com a mesma chave e o mesmo payload devolve o mesmo resultado sem regravar", async () => {
  const uid = tenant();
  await seedOrder(uid, "order1");
  const body = editBody([{ productId: "prodA", quantity: 3 }]);
  const first = await httpEdit(uid, "order1", body);
  assert.equal(first.status, 200);
  const afterFirst = await state(orderRef(uid, "order1"));
  const replay = await httpEdit(uid, "order1", { ...body });
  assert.equal(replay.status, 200);
  assert.deepEqual(replay.body, { ...first.body, idempotentReplay: true });
  assert.deepEqual(await state(orderRef(uid, "order1")), afterFirst, "replay não regrava o pedido");
});
caso("E-13", "replay depois de o pedido mudar de novo continua devolvendo o resultado original", async () => {
  const uid = tenant();
  await seedOrder(uid, "order1");
  const body = editBody([{ productId: "prodA", quantity: 3 }]);
  const first = await httpEdit(uid, "order1", body);
  const second = await httpEdit(uid, "order1", editBody([{ productId: "prodA", quantity: 1 }], { expectedUpdatedAt: first.body.updatedAt }));
  assert.equal(second.status, 200);
  const afterSecond = await state(orderRef(uid, "order1"));
  const replay = await httpEdit(uid, "order1", body);
  assert.equal(replay.status, 200);
  assert.deepEqual(replay.body, { ...first.body, idempotentReplay: true });
  assert.deepEqual(await state(orderRef(uid, "order1")), afterSecond, "o retry antigo não desfaz a edição nova");
});
caso("E-14", "mesma chave com payload diferente, ou em outro pedido → IDEMPOTENCY_CONFLICT sem gravar", async () => {
  const uid = tenant();
  await seedOrder(uid, "order1");
  await seedOrder(uid, "order2");
  const body = editBody([{ productId: "prodA", quantity: 3 }]);
  assert.equal((await httpEdit(uid, "order1", body)).status, 200);
  const afterFirst = await state(orderRef(uid, "order1"));
  expectError(await httpEdit(uid, "order1", { ...body, items: [{ productId: "prodA", quantity: 4 }] }), 409, "IDEMPOTENCY_CONFLICT");
  expectError(await httpEdit(uid, "order1", { ...body, expectedUpdatedAt: afterFirst.data?.updatedAt }), 409, "IDEMPOTENCY_CONFLICT");
  const order2Before = await state(orderRef(uid, "order2"));
  expectError(await httpEdit(uid, "order2", body), 409, "IDEMPOTENCY_CONFLICT");
  assert.deepEqual(await state(orderRef(uid, "order1")), afterFirst);
  assert.deepEqual(await state(orderRef(uid, "order2")), order2Before);
});
caso("E-15", "mesma chave em duas requisições simultâneas: aplica uma vez só, a outra é replay", async () => {
  const uid = tenant();
  await seedOrder(uid, "order1");
  const body = editBody([{ productId: "prodA", quantity: 3 }, lineManual]);
  const results = await Promise.all([httpEdit(uid, "order1", body), httpEdit(uid, "order1", { ...body })]);
  assert.deepEqual(results.map((result) => result.status), [200, 200], JSON.stringify(results));
  assert.deepEqual(results.map((result) => result.body.idempotentReplay).sort(), [false, true]);
  assert.equal(results[0].body.updatedAt, results[1].body.updatedAt);
  assert.equal((await orderRef(uid, "order1").get()).data()?.updatedAt, results[0].body.updatedAt);
});
caso("E-16", "registro de idempotência fica em users/{uid}/orderEditIdempotency/{key} com hash do payload", async () => {
  const uid = tenant();
  await seedOrder(uid, "order1");
  const body = editBody([{ productId: "prodA", quantity: 3 }]);
  const result = await httpEdit(uid, "order1", body);
  const record = (await idempotencyRef(uid, String(body.idempotencyKey)).get()).data() ?? {};
  assert.deepEqual(Object.keys(record).sort(), ["action", "createdAt", "itemCount", "key", "orderId", "payloadHash", "tenantUid", "total", "updatedAt"]);
  assert.equal(record.tenantUid, uid);
  assert.equal(record.orderId, "order1");
  assert.equal(record.action, "edit_order_items");
  assert.match(String(record.payloadHash), /^[0-9a-f]{64}$/);
  assert.equal(record.updatedAt, result.body.updatedAt);
});

// ===== Linhas, produtos e snapshot =====
caso("E-17", "linha existente mantém o preço histórico ao crescer e ao diminuir (produto hoje custa 25)", async () => {
  const uid = tenant();
  await seedProduct(uid, "prodA", { name: "Batom", salePrice: 25, stock: 7 });
  await seedOrder(uid, "order1");
  const up = await httpEdit(uid, "order1", editBody([{ productId: "prodA", quantity: 13, unitPrice: 0.01 }, lineManual]));
  assert.equal(up.status, 200, JSON.stringify(up.body));
  assert.deepEqual((await orderRef(uid, "order1").get()).data()?.items, [{ ...lineA, quantity: 13 }, lineManual]);
  assert.equal(up.body.total, 260.7);
  const down = await httpEdit(uid, "order1", editBody([{ productId: "prodA", quantity: 2 }], { expectedUpdatedAt: up.body.updatedAt }));
  assert.equal(down.status, 200);
  assert.deepEqual((await orderRef(uid, "order1").get()).data()?.items, [{ ...lineA, quantity: 2 }]);
});
caso("E-18", "produto novo recebe preço, nome e imagem do produto no servidor; preço do cliente é ignorado", async () => {
  const uid = tenant();
  await seedProduct(uid, "prodB", { name: "Rímel", salePrice: 30, promotionalPrice: 25, imageUrl: "https://x.test/b.webp", stock: 0 });
  await seedOrder(uid, "order1");
  const result = await httpEdit(uid, "order1", editBody([lineA, { productId: "prodB", quantity: 2, unitPrice: 0.01, name: "Grátis" }]));
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.deepEqual((await orderRef(uid, "order1").get()).data()?.items, [lineA, { productId: "prodB", name: "Rímel", quantity: 2, unitPrice: 25, imageUrl: "https://x.test/b.webp" }]);
  assert.equal(result.body.total, 249);
});
caso("E-19", "produto novo inexistente → ORDER_PRODUCT_NOT_FOUND; preservado → ORDER_PRODUCT_UNAVAILABLE", async () => {
  const uid = tenant();
  await seedProduct(uid, "prodP", { name: "Antigo", salePrice: 10, planAccessState: "preserved" });
  await seedOrder(uid, "order1");
  const before = await state(orderRef(uid, "order1"));
  const missing = await httpEdit(uid, "order1", editBody([lineA, { productId: "prodX", quantity: 1 }]));
  expectError(missing, 409, "ORDER_PRODUCT_NOT_FOUND");
  assert.equal(missing.body.productId, "prodX");
  expectError(await httpEdit(uid, "order1", editBody([lineA, { productId: "prodP", quantity: 1 }])), 409, "ORDER_PRODUCT_UNAVAILABLE");
  assert.deepEqual(await state(orderRef(uid, "order1")), before);
});
caso("E-20", "produto histórico excluído: reduz e remove; aumentar → ORDER_PRODUCT_NOT_INCREASABLE", async () => {
  const uid = tenant();
  await seedOrder(uid, "order1");
  const increase = await httpEdit(uid, "order1", editBody([{ productId: "prodA", quantity: 11 }]));
  expectError(increase, 409, "ORDER_PRODUCT_NOT_INCREASABLE");
  assert.equal(increase.body.productId, "prodA");
  const reduce = await httpEdit(uid, "order1", editBody([{ productId: "prodA", quantity: 4 }, lineManual]));
  assert.equal(reduce.status, 200, JSON.stringify(reduce.body));
  assert.deepEqual((await orderRef(uid, "order1").get()).data()?.items, [{ ...lineA, quantity: 4 }, lineManual]);
  const remove = await httpEdit(uid, "order1", editBody([lineManual], { expectedUpdatedAt: reduce.body.updatedAt }));
  assert.equal(remove.status, 200);
  assert.deepEqual((await orderRef(uid, "order1").get()).data()?.items, [lineManual]);
});
caso("E-21", "mesmo productId com snapshots divergentes: mantidos lado a lado; mudar quantidade → AMBIGUOUS; remover passa", async () => {
  const uid = tenant();
  const divergent: OrderItem[] = [{ productId: "prodA", name: "Batom", quantity: 2, unitPrice: 10 }, { productId: "prodA", name: "Batom", quantity: 3, unitPrice: 12 }];
  await seedOrder(uid, "order1", { items: divergent });
  const keep = await httpEdit(uid, "order1", editBody([{ productId: "prodA", quantity: 5 }, lineManual]));
  assert.equal(keep.status, 200, JSON.stringify(keep.body));
  assert.deepEqual((await orderRef(uid, "order1").get()).data()?.items, [...divergent, lineManual]);
  const ambiguous = await httpEdit(uid, "order1", editBody([{ productId: "prodA", quantity: 4 }], { expectedUpdatedAt: keep.body.updatedAt }));
  expectError(ambiguous, 409, "ORDER_AMBIGUOUS_PRODUCT_SNAPSHOT");
  const remove = await httpEdit(uid, "order1", editBody([lineManual], { expectedUpdatedAt: keep.body.updatedAt }));
  assert.equal(remove.status, 200);
  assert.deepEqual((await orderRef(uid, "order1").get()).data()?.items, [lineManual]);
});

// ===== Item manual, vazio e total =====
caso("E-22", "item manual: válido e fracionário passam; nome vazio, quantidade 0, preço negativo e pedido vazio não", async () => {
  const uid = tenant();
  await seedOrder(uid, "order1");
  const before = await state(orderRef(uid, "order1"));
  const blank = await httpEdit(uid, "order1", editBody([lineA, { name: "   ", quantity: 1, unitPrice: 5 }]));
  expectError(blank, 400, "ORDER_EDIT_INVALID_ITEM_NAME");
  assert.equal(blank.body.index, 1);
  expectError(await httpEdit(uid, "order1", editBody([{ name: "Bolo", quantity: 0, unitPrice: 5 }])), 400, "ORDER_EDIT_INVALID_QUANTITY");
  expectError(await httpEdit(uid, "order1", editBody([{ name: "Bolo", quantity: 1, unitPrice: -1 }])), 400, "ORDER_EDIT_INVALID_ITEM_PRICE");
  expectError(await httpEdit(uid, "order1", editBody([])), 400, "ORDER_EDIT_EMPTY");
  assert.deepEqual(await state(orderRef(uid, "order1")), before);
  const fractional = await httpEdit(uid, "order1", editBody([lineA, { name: "Queijo minas (kg)", quantity: 1.5, unitPrice: 42 }]));
  assert.equal(fractional.status, 200, JSON.stringify(fractional.body));
  assert.equal(fractional.body.total, 262);
  assert.deepEqual((await orderRef(uid, "order1").get()).data()?.items, [lineA, { name: "Queijo minas (kg)", quantity: 1.5, unitPrice: 42 }]);
});
caso("E-23", "total: Infinity → ORDER_TOTAL_INVALID; acima de 100000000 → LIMIT_EXCEEDED; exatamente o teto passa", async () => {
  const uid = tenant();
  await seedOrder(uid, "order1");
  const before = await state(orderRef(uid, "order1"));
  expectError(await httpEdit(uid, "order1", editBody([{ name: "Enorme", quantity: 10, unitPrice: 1e308 }])), 400, "ORDER_TOTAL_INVALID");
  expectError(await httpEdit(uid, "order1", editBody([lineA, { name: "Grande", quantity: 1, unitPrice: 100000000 }])), 400, "ORDER_TOTAL_LIMIT_EXCEEDED");
  assert.deepEqual(await state(orderRef(uid, "order1")), before);
  const atLimit = await httpEdit(uid, "order1", editBody([{ name: "No teto", quantity: 1, unitPrice: 100000000 }]));
  assert.equal(atLimit.status, 200);
  assert.equal((await orderRef(uid, "order1").get()).data()?.total, 100000000);
});

// ===== Imutáveis, mass assignment e estoque =====
caso("E-24", "cliente e demais campos imutáveis: só items, total e updatedAt mudam", async () => {
  const uid = tenant();
  const seeded = await seedOrder(uid, "order1", {
    clientId: "public-catalog", paymentMethod: "whatsapp", paymentProvider: "manual_whatsapp", paymentStatus: "not_started", clientOrderId: "client-order-9",
  });
  const result = await httpEdit(uid, "order1", editBody([{ productId: "prodA", quantity: 6 }]));
  assert.equal(result.status, 200);
  const saved = (await orderRef(uid, "order1").get()).data() ?? {};
  const withoutEditableFields = (doc: DocumentData): DocumentData => {
    const copy = { ...doc };
    delete copy.items;
    delete copy.total;
    delete copy.updatedAt;
    return copy;
  };
  assert.deepEqual(withoutEditableFields(saved), withoutEditableFields(seeded));
});
caso("E-25", "mass assignment: uid/ownerId/clientId/customerId/total/status/paymentStatus/createdAt/chargeId/saleId → 400 sem gravar", async () => {
  const uid = tenant();
  const other = tenant();
  await seedOrder(uid, "order1");
  const before = await state(orderRef(uid, "order1"));
  const attempts: Record<string, unknown> = {
    uid: other, ownerId: other, tenantUid: other, clientId: "client-2", customerId: "client-2", clientName: "Outro",
    total: 0.01, status: "delivered", paymentStatus: "paid", createdAt: "2020-01-01T00:00:00.000Z", chargeId: "c1", saleId: "s1", metadata: { admin: true },
  };
  for (const [field, value] of Object.entries(attempts)) {
    const body = editBody([{ productId: "prodA", quantity: 1 }], { [field]: value });
    const result = await httpEdit(uid, "order1", body);
    expectError(result, 400, "INVALID_PAYLOAD");
    assert.equal(result.body.field, field);
    assert.equal((await idempotencyRef(uid, String(body.idempotencyKey)).get()).exists, false);
  }
  assert.deepEqual(await state(orderRef(uid, "order1")), before);
  assert.equal((await orderRef(other, "order1").get()).exists, false);
});
caso("E-26", "estoque intocado: edições que aumentam, adicionam, diminuem e removem não regravam nenhum produto", async () => {
  const uid = tenant();
  await seedProduct(uid, "prodA", { name: "Batom", salePrice: 25, stock: 7 });
  await seedProduct(uid, "prodB", { name: "Rímel", salePrice: 30, stock: 3 });
  await seedProduct(uid, "prodC", { name: "Base", salePrice: 40, stock: 5 });
  await seedOrder(uid, "order1", { items: [lineA, { productId: "prodC", name: "Base", quantity: 2, unitPrice: 40 }] });
  const before = await Promise.all(["prodA", "prodB", "prodC"].map((productId) => state(productRef(uid, productId))));
  const increaseAndAdd = await httpEdit(uid, "order1", editBody([{ productId: "prodA", quantity: 12 }, { productId: "prodB", quantity: 4 }, { productId: "prodC", quantity: 2 }]));
  assert.equal(increaseAndAdd.status, 200, JSON.stringify(increaseAndAdd.body));
  const decreaseAndRemove = await httpEdit(uid, "order1", editBody([{ productId: "prodA", quantity: 1 }, { productId: "prodB", quantity: 1 }], { expectedUpdatedAt: increaseAndAdd.body.updatedAt }));
  assert.equal(decreaseAndRemove.status, 200, JSON.stringify(decreaseAndRemove.body));
  const after = await Promise.all(["prodA", "prodB", "prodC"].map((productId) => state(productRef(uid, productId))));
  assert.deepEqual(after, before, "nenhum produto (nem o campo stock) foi regravado");
});

async function main(): Promise<void> {
  requireEmulator();
  initializeFirebaseAdmin();
  db = getFirebaseAdmin().firestore();
  for (const [id, description, fn] of cases) {
    await fn();
    console.log(`ok ${id} — ${description}`);
  }
  console.log(`Order edit command emulator tests passed: ${cases.length} casos.`);
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
