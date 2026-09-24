/**
 * PEDIDOS EDITÁVEIS — Etapa 2A: partes puras do comando de edição (server/order-edit-command.ts).
 *
 * Sem Firestore e sem emulador: leitura do corpo (mass assignment, chave, versão), composição das linhas
 * finais (snapshot, produto novo, produto indisponível, duplicidade), total e o espelho das Rules. O que
 * depende de transação real (dono, CAS, idempotência, concorrência, estoque intocado) está em
 * script/order-edit-command-emulator-tests.ts.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  composeOrderEditItems,
  hashOrderEditPayload,
  listOrderEditProductLookups,
  OrderEditCommandError,
  ORDER_TOTAL_MAX,
  parseOrderEditRequest,
  resolveOrderEditTotal,
  statusForOrderEditError,
  type OrderEditCommandErrorCode,
  type OrderEditProductSnapshot,
} from "../server/order-edit-command";
import { ORDER_EDIT_MAX_ITEMS, type OrderEditItemInput, type OrderItem } from "../client/src/lib/orders";

let passed = 0;

function caso(id: string, description: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`ok ${id} — ${description}`);
}

function expectCode(fn: () => unknown, code: OrderEditCommandErrorCode, details?: Record<string, unknown>): void {
  assert.throws(fn, (error: unknown) => {
    assert.ok(error instanceof OrderEditCommandError, `esperava OrderEditCommandError ${code}, veio ${String(error)}`);
    assert.equal(error.code, code);
    if (details) assert.deepEqual(error.details, details);
    return true;
  });
}

const validBody = (overrides: Record<string, unknown> = {}) => ({
  expectedUpdatedAt: "2026-09-23T12:00:00.000Z",
  idempotencyKey: "edit-key-0001",
  items: [{ productId: "prodA", quantity: 2 }],
  ...overrides,
});

const products = (entries: Record<string, OrderEditProductSnapshot>) => new Map(Object.entries(entries));

// ===== Corpo da requisição =====
caso("P-01", "corpo válido vira a intenção normalizada (preço enviado com productId é descartado)", () => {
  const input = parseOrderEditRequest(" order_1 ", validBody({
    idempotencyKey: " edit-key-0001 ",
    items: [{ productId: "prodA", quantity: 2, unitPrice: 0.01, name: "Grátis" }, { name: "  Embrulho ", quantity: 1.5, unitPrice: 3 }],
  }));
  assert.deepEqual(input, {
    orderId: "order_1",
    expectedUpdatedAt: "2026-09-23T12:00:00.000Z",
    idempotencyKey: "edit-key-0001",
    items: [{ productId: "prodA", quantity: 2 }, { name: "Embrulho", quantity: 1.5, unitPrice: 3 }],
  });
});
caso("P-02", "mass assignment: qualquer campo fora de expectedUpdatedAt/idempotencyKey/items é rejeitado", () => {
  for (const field of ["uid", "ownerId", "tenantUid", "clientId", "customerId", "clientName", "total", "paymentStatus", "status", "createdAt", "updatedAt", "chargeId", "saleId", "metadata", "orderId"]) {
    expectCode(() => parseOrderEditRequest("order_1", validBody({ [field]: "x" })), "INVALID_PAYLOAD", { field });
  }
});
caso("P-03", "corpo, orderId, expectedUpdatedAt e idempotencyKey malformados → INVALID_PAYLOAD", () => {
  for (const body of [null, "x", [], 5]) expectCode(() => parseOrderEditRequest("order_1", body), "INVALID_PAYLOAD");
  for (const orderId of [undefined, "", "a/b", "x".repeat(121), 7]) expectCode(() => parseOrderEditRequest(orderId, validBody()), "INVALID_PAYLOAD", { field: "orderId" });
  for (const expectedUpdatedAt of [undefined, "", 123, "x".repeat(41)]) {
    expectCode(() => parseOrderEditRequest("order_1", validBody({ expectedUpdatedAt })), "INVALID_PAYLOAD", { field: "expectedUpdatedAt" });
  }
  for (const idempotencyKey of [undefined, "", "short", "com espaço", "x".repeat(121), 42]) {
    expectCode(() => parseOrderEditRequest("order_1", validBody({ idempotencyKey })), "INVALID_PAYLOAD", { field: "idempotencyKey" });
  }
});
caso("P-04", "itens seguem o contrato da Etapa 1B (código e linha repassados)", () => {
  expectCode(() => parseOrderEditRequest("order_1", validBody({ items: [] })), "ORDER_EDIT_EMPTY");
  expectCode(() => parseOrderEditRequest("order_1", validBody({ items: [{ productId: "prodA", quantity: 0 }] })), "ORDER_EDIT_INVALID_QUANTITY", { index: 0 });
  expectCode(() => parseOrderEditRequest("order_1", validBody({ items: [{ productId: "prodA", quantity: 1 }, { name: "  ", quantity: 1, unitPrice: 2 }] })), "ORDER_EDIT_INVALID_ITEM_NAME", { index: 1 });
  expectCode(() => parseOrderEditRequest("order_1", validBody({ items: [{ name: "Bolo", quantity: 1, unitPrice: -1 }] })), "ORDER_EDIT_INVALID_ITEM_PRICE", { index: 0 });
  assert.equal(parseOrderEditRequest("order_1", validBody({ items: [{ name: "Queijo (kg)", quantity: 1.5, unitPrice: 42 }] })).items[0].quantity, 1.5);
  // Contrato 1B preservado: sem teto de nome e sem teto de preço por item.
  assert.equal(parseOrderEditRequest("order_1", validBody({ items: [{ name: "n".repeat(500), quantity: 1, unitPrice: 2500000 }] })).items.length, 1);
});
caso("P-05", "payloadHash: mesma intenção → mesmo hash; qualquer mudança semântica → hash diferente", () => {
  const base = parseOrderEditRequest("order_1", validBody());
  const sameIntent = parseOrderEditRequest("order_1", validBody({ items: [{ productId: "prodA", quantity: 2, unitPrice: 999 }] }));
  assert.match(hashOrderEditPayload(base), /^[0-9a-f]{64}$/);
  assert.equal(hashOrderEditPayload(base), hashOrderEditPayload(sameIntent));
  for (const other of [
    parseOrderEditRequest("order_2", validBody()),
    parseOrderEditRequest("order_1", validBody({ expectedUpdatedAt: "2026-09-23T12:00:00.001Z" })),
    parseOrderEditRequest("order_1", validBody({ items: [{ productId: "prodA", quantity: 3 }] })),
    parseOrderEditRequest("order_1", validBody({ items: [{ productId: "prodA", quantity: 2 }, { name: "Embrulho", quantity: 1, unitPrice: 0 }] })),
  ]) {
    assert.notEqual(hashOrderEditPayload(other), hashOrderEditPayload(base));
  }
});

// ===== Composição das linhas finais =====
const storedA: OrderItem = { productId: "prodA", name: "Batom (cor antiga)", quantity: 10, unitPrice: 19.9, imageUrl: "https://x.test/a.webp" };
const currentA = { name: "Batom", salePrice: 25, stock: 7 };

caso("P-06", "linha existente que cresce mantém o preço histórico (10 → 13 continua 19,90, nunca 25,00)", () => {
  const items = composeOrderEditItems([storedA], [{ productId: "prodA", quantity: 13 }], products({ prodA: currentA }));
  assert.deepEqual(items, [{ ...storedA, quantity: 13 }]);
  assert.equal(resolveOrderEditTotal(items), 258.7);
});
caso("P-07", "linha existente que diminui mantém o snapshot e nem precisa reler o produto", () => {
  assert.deepEqual(listOrderEditProductLookups([storedA], [{ productId: "prodA", quantity: 7 }]), []);
  assert.deepEqual(composeOrderEditItems([storedA], [{ productId: "prodA", quantity: 7 }], products({})), [{ ...storedA, quantity: 7 }]);
});
caso("P-08", "produto novo recebe nome, imagem e preço efetivo atuais do produto relido", () => {
  const edit: OrderEditItemInput[] = [{ productId: "prodA", quantity: 10 }, { productId: "prodB", quantity: 2 }];
  assert.deepEqual(listOrderEditProductLookups([storedA], edit), ["prodB"]);
  const items = composeOrderEditItems([storedA], edit, products({ prodB: { name: " Rímel ", salePrice: 30, promotionalPrice: 25, imageUrl: "https://x.test/b.webp", stock: 0 } }));
  assert.deepEqual(items, [storedA, { productId: "prodB", name: "Rímel", quantity: 2, unitPrice: 25, imageUrl: "https://x.test/b.webp" }]);
});
caso("P-09", "produto novo inexistente, preservado, sem nome ou com preço inválido é recusado", () => {
  const edit: OrderEditItemInput[] = [{ productId: "prodB", quantity: 1 }];
  expectCode(() => composeOrderEditItems([], edit, products({ prodB: null })), "ORDER_PRODUCT_NOT_FOUND", { productId: "prodB" });
  expectCode(() => composeOrderEditItems([], edit, products({ prodB: { name: "Rímel", salePrice: 30, planAccessState: "preserved" } })), "ORDER_PRODUCT_UNAVAILABLE", { productId: "prodB" });
  expectCode(() => composeOrderEditItems([], edit, products({ prodB: { name: "  ", salePrice: 30 } })), "ORDER_PRODUCT_UNAVAILABLE", { productId: "prodB" });
  expectCode(() => composeOrderEditItems([], edit, products({ prodB: { name: "Rímel", salePrice: 0 } })), "ORDER_PRODUCT_UNAVAILABLE", { productId: "prodB" });
});
caso("P-10", "produto histórico excluído/preservado: reduzir e remover passam; aumentar é bloqueado", () => {
  const manual: OrderEditItemInput = { name: "Embrulho", quantity: 1, unitPrice: 2 };
  assert.deepEqual(composeOrderEditItems([storedA], [{ productId: "prodA", quantity: 4 }], products({})), [{ ...storedA, quantity: 4 }]);
  assert.deepEqual(composeOrderEditItems([storedA], [manual], products({})), [{ name: "Embrulho", quantity: 1, unitPrice: 2 }]);
  expectCode(() => composeOrderEditItems([storedA], [{ productId: "prodA", quantity: 11 }], products({ prodA: null })), "ORDER_PRODUCT_NOT_INCREASABLE", { productId: "prodA" });
  expectCode(() => composeOrderEditItems([storedA], [{ productId: "prodA", quantity: 11 }], products({ prodA: { ...currentA, planAccessState: "preserved" } })), "ORDER_PRODUCT_NOT_INCREASABLE", { productId: "prodA" });
});
caso("P-11", "mesmo productId com snapshots divergentes: preservado se não mudar, recusado se mudar, removível", () => {
  const divergent: OrderItem[] = [
    { productId: "prodA", name: "Batom", quantity: 2, unitPrice: 10 },
    { name: "Embrulho", quantity: 1, unitPrice: 2 },
    { productId: "prodA", name: "Batom", quantity: 3, unitPrice: 12 },
  ];
  // Mesma quantidade total (5), mandada em uma ou duas linhas: as duas linhas históricas ficam intactas.
  for (const edit of [[{ productId: "prodA", quantity: 5 }], [{ productId: "prodA", quantity: 2 }, { productId: "prodA", quantity: 3 }]] as OrderEditItemInput[][]) {
    assert.deepEqual(composeOrderEditItems(divergent, edit, products({})), [divergent[0], divergent[2]]);
  }
  expectCode(() => composeOrderEditItems(divergent, [{ productId: "prodA", quantity: 4 }], products({})), "ORDER_AMBIGUOUS_PRODUCT_SNAPSHOT", { productId: "prodA" });
  expectCode(() => composeOrderEditItems(divergent, [{ productId: "prodA", quantity: 6 }], products({ prodA: currentA })), "ORDER_AMBIGUOUS_PRODUCT_SNAPSHOT", { productId: "prodA" });
  assert.deepEqual(composeOrderEditItems(divergent, [{ name: "Embrulho", quantity: 1, unitPrice: 2 }], products({})), [{ name: "Embrulho", quantity: 1, unitPrice: 2 }]);
  // Linhas repetidas com o MESMO preço (pedido público antigo) viram uma só quando a quantidade muda.
  const samePrice: OrderItem[] = [{ productId: "prodA", name: "Batom", quantity: 2, unitPrice: 10 }, { productId: "prodA", name: "Batom", quantity: 3, unitPrice: 10 }];
  assert.deepEqual(composeOrderEditItems(samePrice, [{ productId: "prodA", quantity: 4 }], products({})), [{ productId: "prodA", name: "Batom", quantity: 4, unitPrice: 10 }]);
});
caso("P-12", "itens manuais vêm do payload (nome/quantidade/preço do lojista) e substituem os manuais gravados", () => {
  const stored: OrderItem[] = [storedA, { name: "Taxa antiga", quantity: 1, unitPrice: 5 }];
  const items = composeOrderEditItems(stored, [{ name: "Queijo (kg)", quantity: 1.5, unitPrice: 42 }, { productId: "prodA", quantity: 10 }], products({}));
  assert.deepEqual(items, [{ name: "Queijo (kg)", quantity: 1.5, unitPrice: 42 }, storedA]);
  assert.equal(resolveOrderEditTotal(items), 262);
});
caso("P-13", "produto que entra ou cresce sem ter sido relido é erro interno, nunca 'não encontrado' em silêncio", () => {
  assert.throws(() => composeOrderEditItems([], [{ productId: "prodB", quantity: 1 }], products({})), (error: unknown) => !(error instanceof OrderEditCommandError));
  assert.throws(() => composeOrderEditItems([storedA], [{ productId: "prodA", quantity: 11 }], products({})), (error: unknown) => !(error instanceof OrderEditCommandError));
});
caso("P-14", "mais de 100 linhas depois da composição é recusado", () => {
  const stored: OrderItem[] = Array.from({ length: 99 }, (_, index) => ({ productId: "prodA", name: "Batom", quantity: 1, unitPrice: 10 + index }));
  expectCode(() => composeOrderEditItems(stored, [{ productId: "prodA", quantity: 99 }, { name: "a", quantity: 1, unitPrice: 1 }, { name: "b", quantity: 1, unitPrice: 1 }], products({})), "ORDER_EDIT_TOO_MANY_ITEMS");
  assert.equal(composeOrderEditItems(stored, [{ productId: "prodA", quantity: 99 }, { name: "a", quantity: 1, unitPrice: 1 }], products({})).length, ORDER_EDIT_MAX_ITEMS);
});

// ===== Total =====
caso("P-15", "total: finito, teto real 100000000 aceito no limite, acima recusado; Infinity recusado", () => {
  assert.equal(resolveOrderEditTotal([{ name: "Queijo (kg)", quantity: 1.5, unitPrice: 42 }]), 63);
  assert.equal(resolveOrderEditTotal([{ name: "Teto", quantity: 1, unitPrice: ORDER_TOTAL_MAX }]), ORDER_TOTAL_MAX);
  expectCode(() => resolveOrderEditTotal([{ name: "Teto", quantity: 1, unitPrice: 100000000.01 }]), "ORDER_TOTAL_LIMIT_EXCEEDED");
  expectCode(() => resolveOrderEditTotal([{ name: "Enorme", quantity: 10, unitPrice: 1e308 }]), "ORDER_TOTAL_INVALID");
});

// ===== Erros HTTP =====
caso("P-16", "códigos estáveis mapeados para HTTP (401/404/409/400)", () => {
  assert.equal(statusForOrderEditError("UNAUTHENTICATED"), 401);
  assert.equal(statusForOrderEditError("ORDER_NOT_FOUND"), 404);
  for (const code of ["ORDER_NOT_EDITABLE", "ORDER_PAYMENT_STARTED", "STALE_ORDER_VERSION", "ORDER_PRODUCT_NOT_FOUND", "ORDER_PRODUCT_UNAVAILABLE", "ORDER_PRODUCT_NOT_INCREASABLE", "ORDER_AMBIGUOUS_PRODUCT_SNAPSHOT", "IDEMPOTENCY_CONFLICT"] as const) {
    assert.equal(statusForOrderEditError(code), 409, code);
  }
  for (const code of ["INVALID_PAYLOAD", "ORDER_EDIT_EMPTY", "ORDER_EDIT_INVALID_QUANTITY", "ORDER_EDIT_TOO_MANY_ITEMS", "ORDER_TOTAL_INVALID", "ORDER_TOTAL_LIMIT_EXCEEDED"] as const) {
    assert.equal(statusForOrderEditError(code), 400, code);
  }
});

// ===== Espelho das Rules e pureza do comando =====
caso("P-17", "limites e bloqueios espelham as Rules reais (total, linhas, update do cliente, default-deny)", () => {
  const rules = fs.readFileSync("firestore.rules", "utf8");
  assert.match(rules, /data\.total <= 100000000/, "ORDER_TOTAL_MAX precisa continuar igual ao teto de isValidOrderCreate");
  assert.equal(ORDER_TOTAL_MAX, 100000000);
  assert.match(rules, /data\.items\.size\(\) <= 100/, "ORDER_EDIT_MAX_ITEMS precisa continuar igual ao teto de isValidOrderCreate");
  assert.match(rules, /changed\.hasOnly\(\['status', 'updatedAt'\]\)/, "cliente continua sem poder editar itens/total direto no Firestore");
  assert.match(rules, /match \/\{document=\*\*\} \{\s*allow read, write: if false;/, "orderEditIdempotency depende do default-deny da raiz");
  assert.doesNotMatch(rules, /orderEditIdempotency/, "nenhuma Rule abre a coleção de idempotência da edição");
});
caso("P-18", "comando não grava produto nem mexe em estoque: só update do pedido e create da idempotência", () => {
  // Só código executável (comentários fora): a documentação pode citar estoque para dizer que ele não entra.
  const code = fs.readFileSync("server/order-edit-command.ts", "utf8").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
  assert.deepEqual(code.match(/\btx\.(set|update|create|delete)\([^,]+/g), ["tx.update(orderRef", "tx.create(idempotencyRef"]);
  assert.doesNotMatch(code, /writeBatch|bulkWriter|\.batch\(|FieldValue|\.increment\(/);
  assert.doesNotMatch(code, /collection\("products"\)\.doc\([^)]*\)\.(set|update|create|delete)\(/);
  const words = new Set((code.match(/[A-Za-z_$][\w$]*/g) ?? []).flatMap((identifier) =>
    identifier.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase().split(/[\s_$]+/).filter(Boolean)));
  for (const word of ["stock", "inventory", "estoque"]) {
    assert.ok(!words.has(word), `comando não pode usar "${word}"`);
  }
});

console.log(`Order edit command pure tests passed: ${passed} casos.`);
