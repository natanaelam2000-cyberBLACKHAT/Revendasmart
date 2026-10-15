/**
 * PEDIDOS EDITÁVEIS — ETAPAS 1/1B: domínio puro da edição de pedidos em client/src/lib/orders.ts.
 *
 * Só funções puras: sem Firestore, sem rota, sem UI e sem emulador. Cada caso leva o rótulo do plano para o
 * relatório apontar exatamente o que foi verificado: E1-* (Etapa 1, mantidos), 1B-* (regras refinadas de
 * quantidade, nome e preço), LEGACY-* (linha já gravada continua editável) e GUARD-* (pureza do domínio).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  aggregateOrderItemQuantities,
  calculateOrderTotal,
  compareOrderProductQuantities,
  isOrderEditableStatus,
  isOrderPaymentEditable,
  ORDER_EDIT_MAX_ITEMS,
  ORDER_PAYMENT_STATUS_IDS,
  ORDER_STATUS_IDS,
  validateOrderEditItems,
  withOrderItemQuantity,
  type OrderEditItemsErrorCode,
  type OrderItem,
} from "../client/src/lib/orders";

let passed = 0;

function caso(id: string, description: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`ok ${id} — ${description}`);
}

function expectInvalid(items: unknown, code: OrderEditItemsErrorCode, index?: number): void {
  const expected = index === undefined ? { ok: false, code } : { ok: false, code, index };
  assert.deepEqual(validateOrderEditItems(items), expected, `esperava ${code}${index === undefined ? "" : ` na linha ${index}`}`);
}

function expectValid(items: unknown[], expectedItems: unknown[]): void {
  assert.deepEqual(validateOrderEditItems(items), { ok: true, items: expectedItems });
}

const product = (productId: unknown, quantity: unknown) => ({ productId, quantity });
const manual = (name: unknown, quantity: unknown, unitPrice: unknown) => ({ name, quantity, unitPrice });

// ===== Status editáveis (Etapa 1, mantido) =====
caso("E1-A", "new é editável", () => assert.equal(isOrderEditableStatus("new"), true));
caso("E1-B", "in_progress é editável", () => assert.equal(isOrderEditableStatus("in_progress"), true));
caso("E1-C", "ready não é editável", () => assert.equal(isOrderEditableStatus("ready"), false));
caso("E1-D", "delivered não é editável", () => assert.equal(isOrderEditableStatus("delivered"), false));
caso("E1-E", "cancelled não é editável", () => assert.equal(isOrderEditableStatus("cancelled"), false));
caso("E1-X1", "status cru desconhecido nunca é editável e o contrato cobre todos os OrderStatus", () => {
  for (const value of [undefined, null, "", "NEW", "archived", 0, {}]) {
    assert.equal(isOrderEditableStatus(value), false, `${String(value)} não pode ser editável`);
  }
  assert.deepEqual(ORDER_STATUS_IDS.filter((status) => isOrderEditableStatus(status)), ["new", "in_progress"]);
});

// ===== Política de pagamento (Etapa 1, mantido) =====
caso("E1-X2", "só pedido sem cobrança (paymentStatus ausente ou not_started) é editável", () => {
  assert.equal(isOrderPaymentEditable(undefined), true, "pedido manual não tem paymentStatus");
  assert.equal(isOrderPaymentEditable("not_started"), true);
  for (const status of ORDER_PAYMENT_STATUS_IDS.filter((value) => value !== "not_started")) {
    assert.equal(isOrderPaymentEditable(status), false, `${status} bloqueia edição`);
  }
  for (const value of [null, "", "refunded", "NOT_STARTED"]) {
    assert.equal(isOrderPaymentEditable(value), false, `valor cru desconhecido ${String(value)} bloqueia`);
  }
});

// ===== Lista de itens (Etapa 1, mantido) =====
caso("E1-F", "pedido com 1 item válido", () => {
  expectValid([product("prod_A-1", 2)], [{ productId: "prod_A-1", quantity: 2 }]);
});
caso("E1-G", "pedido vazio é rejeitado com erro determinístico", () => {
  expectInvalid([], "ORDER_EDIT_EMPTY");
});

// ===== Quantidade: number finito > 0, sem exigir inteiro e sem teto (Etapa 1B) =====
caso("1B-A", "quantity 1 válida", () => {
  expectValid([product("A", 1), manual("Bolo", 1, 10)], [{ productId: "A", quantity: 1 }, { name: "Bolo", quantity: 1, unitPrice: 10 }]);
});
caso("1B-B", "quantity 1.5 válida", () => {
  expectValid([product("A", 1.5), manual("Queijo (kg)", 1.5, 42)], [{ productId: "A", quantity: 1.5 }, { name: "Queijo (kg)", quantity: 1.5, unitPrice: 42 }]);
});
caso("1B-C", "quantity pequena fracionária válida", () => {
  expectValid(
    [product("A", 0.25), manual("Essência (L)", 0.001, 500)],
    [{ productId: "A", quantity: 0.25 }, { name: "Essência (L)", quantity: 0.001, unitPrice: 500 }],
  );
});
caso("1B-D", "quantity 0 é rejeitada (produto e manual, -0 incluído)", () => {
  expectInvalid([product("A", 0)], "ORDER_EDIT_INVALID_QUANTITY", 0);
  expectInvalid([manual("Bolo", 0, 10)], "ORDER_EDIT_INVALID_QUANTITY", 0);
  expectInvalid([manual("Bolo", -0, 10)], "ORDER_EDIT_INVALID_QUANTITY", 0);
});
caso("1B-E", "quantity negativa é rejeitada", () => {
  for (const quantity of [-1, -0.5]) {
    expectInvalid([product("A", quantity)], "ORDER_EDIT_INVALID_QUANTITY", 0);
    expectInvalid([manual("Bolo", quantity, 10)], "ORDER_EDIT_INVALID_QUANTITY", 0);
  }
});
caso("1B-F", "quantity NaN é rejeitada", () => {
  expectInvalid([product("A", Number.NaN)], "ORDER_EDIT_INVALID_QUANTITY", 0);
  expectInvalid([manual("Bolo", Number.NaN, 10)], "ORDER_EDIT_INVALID_QUANTITY", 0);
});
caso("1B-G", "quantity Infinity é rejeitada", () => {
  for (const quantity of [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    expectInvalid([product("A", quantity)], "ORDER_EDIT_INVALID_QUANTITY", 0);
    expectInvalid([manual("Bolo", quantity, 10)], "ORDER_EDIT_INVALID_QUANTITY", 0);
  }
});
caso("E1-X3", "quantity que não é number é rejeitada (string, null, boolean, ausente)", () => {
  for (const quantity of ["2", null, true, undefined]) {
    expectInvalid([product("A", quantity)], "ORDER_EDIT_INVALID_QUANTITY", 0);
  }
  expectInvalid([{ name: "Bolo", unitPrice: 10 }], "ORDER_EDIT_INVALID_QUANTITY", 0);
});

// ===== Nome do item manual: string com conteúdo depois do trim, sem teto de tamanho (Etapa 1B) =====
caso("1B-H", "nome normal válido (aparado)", () => {
  expectValid([manual("  Bolo de pote  ", 3, 12.5)], [{ name: "Bolo de pote", quantity: 3, unitPrice: 12.5 }]);
});
caso("1B-I", "nome vazio, só espaços ou não-string é rejeitado", () => {
  for (const name of ["", "   ", "\t\n", undefined, null, 42]) {
    expectInvalid([manual(name, 1, 10)], "ORDER_EDIT_INVALID_ITEM_NAME", 0);
  }
});
caso("1B-J", "nome longo não é rejeitado só pelo tamanho", () => {
  const longName = "Kit presente personalizado ".repeat(40).trim();
  assert.ok(longName.length > 1000);
  expectValid([manual(longName, 1, 10)], [{ name: longName, quantity: 1, unitPrice: 10 }]);
});

// ===== Preço do item manual: number finito >= 0, sem teto por item (Etapa 1B) =====
caso("1B-K", "preço 0 válido (estimativa opcional do NewOrderSheet)", () => {
  expectValid([manual("Embalagem", 1, 0)], [{ name: "Embalagem", quantity: 1, unitPrice: 0 }]);
});
caso("1B-L", "preço positivo válido", () => {
  expectValid([manual("Bolo", 2, 12.5)], [{ name: "Bolo", quantity: 2, unitPrice: 12.5 }]);
});
caso("1B-M", "preço alto mas finito não é rejeitado por teto arbitrário", () => {
  for (const unitPrice of [2500000, 1e12, Number.MAX_SAFE_INTEGER]) {
    expectValid([manual("Projeto sob medida", 1, unitPrice)], [{ name: "Projeto sob medida", quantity: 1, unitPrice }]);
  }
});
caso("1B-N", "preço negativo é rejeitado", () => {
  for (const unitPrice of [-0.01, -100]) {
    expectInvalid([manual("Bolo", 1, unitPrice)], "ORDER_EDIT_INVALID_ITEM_PRICE", 0);
  }
});
caso("1B-O", "preço NaN/Infinity (e não-number) é rejeitado", () => {
  for (const unitPrice of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, "10", null, undefined]) {
    expectInvalid([manual("Bolo", 1, unitPrice)], "ORDER_EDIT_INVALID_ITEM_PRICE", 0);
  }
});

// ===== Compatibilidade legada: linha manual já gravada, reenviada sem mudança, continua válida =====
function resendUnchanged(line: OrderItem): unknown {
  return { name: line.name, quantity: line.quantity, unitPrice: line.unitPrice };
}
caso("LEGACY-1", "item manual com quantity 1.5 passa pela validação (e o total segue calculateOrderTotal)", () => {
  const stored: OrderItem = { name: "Queijo minas (kg)", quantity: 1.5, unitPrice: 42 };
  expectValid([resendUnchanged(stored)], [stored]);
  assert.equal(calculateOrderTotal([stored]), 63);
});
caso("LEGACY-2", "nome manual acima de 180 caracteres, não vazio, não é rejeitado só pelo tamanho", () => {
  const stored: OrderItem = { name: "Cesta de café da manhã personalizada com entrega agendada — ".repeat(4).trim(), quantity: 1, unitPrice: 180 };
  assert.ok(stored.name.length > 180);
  expectValid([resendUnchanged(stored)], [stored]);
});
caso("LEGACY-3", "unitPrice acima de 1.000.000, finito e >= 0, não é rejeitado só pelo limite de Produto", () => {
  const stored: OrderItem = { name: "Reforma completa", quantity: 1, unitPrice: 1000000.01 };
  expectValid([resendUnchanged(stored)], [stored]);
});

// ===== productId e limites da lista (Etapa 1, mantido) =====
caso("E1-X4", "productId inválido é rejeitado; preço/nome/imagem enviados com productId são descartados", () => {
  // Padrão = contrato autoritativo da criação de produto (assertEntityId); ids reais são auto-IDs do Firestore.
  for (const productId of [null, "", " A", "a/b", "../x", "a.b", 123, "x".repeat(121)]) {
    expectInvalid([product(productId, 1)], "ORDER_EDIT_INVALID_PRODUCT_ID", 0);
  }
  expectValid([product("x".repeat(120), 1)], [{ productId: "x".repeat(120), quantity: 1 }]);
  expectValid([product("Xq3fK9pLm2Rt7VwYz1Ab", 1)], [{ productId: "Xq3fK9pLm2Rt7VwYz1Ab", quantity: 1 }]);
  // Cliente tentando impor preço a um produto cadastrado: o campo some da saída, nunca vira preço.
  expectValid([{ productId: "A", quantity: 2, unitPrice: 0.01, name: "Grátis", imageUrl: "https://x.test/a.webp" }], [{ productId: "A", quantity: 2 }]);
});
caso("E1-X5", "limites da lista, payload malformado e primeiro erro determinístico", () => {
  const atLimit = Array.from({ length: ORDER_EDIT_MAX_ITEMS }, (_, index) => product(`p${index}`, 1));
  assert.equal(validateOrderEditItems(atLimit).ok, true, `${ORDER_EDIT_MAX_ITEMS} linhas é o teto válido`);
  expectInvalid([...atLimit, product("extra", 1)], "ORDER_EDIT_TOO_MANY_ITEMS");
  for (const items of [undefined, null, {}, "A", 1]) expectInvalid(items, "ORDER_EDIT_INVALID_ITEMS");
  for (const line of [null, 5, "A", [product("A", 1)]]) expectInvalid([line], "ORDER_EDIT_INVALID_ITEM", 0);
  // Varredura em ordem: a linha 1 (quantidade) vence a linha 2 (nome), sempre.
  expectInvalid([product("A", 1), product("B", 0), manual("", 1, 10)], "ORDER_EDIT_INVALID_QUANTITY", 1);
});

// ===== Agregação e comparação por productId (Etapa 1, mantido) =====
caso("E1-N", "duas linhas do mesmo productId agregam corretamente", () => {
  const legacyPublicOrder: OrderItem[] = [
    { productId: "A", name: "Batom", quantity: 2, unitPrice: 19.9 },
    { productId: "B", name: "Rímel", quantity: 1, unitPrice: 30 },
    { productId: "A", name: "Batom", quantity: 3, unitPrice: 19.9 },
    { name: "Embrulho", quantity: 4, unitPrice: 2 },
  ];
  assert.deepEqual(Array.from(aggregateOrderItemQuantities(legacyPublicOrder)), [["A", 5], ["B", 1]]);
  // Linha gravada malformada conta 0 (mesma regra do total) e produto que soma 0 não entra.
  const malformed = [{ productId: "A", quantity: Number.NaN }, { productId: "C", quantity: 0 }, { productId: "A", quantity: 2 }];
  assert.deepEqual(Array.from(aggregateOrderItemQuantities(malformed)), [["A", 2]]);
});

const stored: OrderItem[] = [{ productId: "A", name: "Batom", quantity: 10, unitPrice: 19.9 }];

caso("E1-O", "item novo aparece como added", () => {
  assert.deepEqual(compareOrderProductQuantities(stored, [{ productId: "A", quantity: 10 }, { productId: "B", quantity: 2 }]), [
    { productId: "A", previousQuantity: 10, nextQuantity: 10, kind: "unchanged" },
    { productId: "B", previousQuantity: 0, nextQuantity: 2, kind: "added" },
  ]);
});
caso("E1-P", "item removido (linha ausente da edição) aparece como removed", () => {
  const storedWithB: OrderItem[] = [...stored, { productId: "B", name: "Rímel", quantity: 2, unitPrice: 30 }];
  assert.deepEqual(compareOrderProductQuantities(storedWithB, [{ productId: "A", quantity: 10 }]), [
    { productId: "A", previousQuantity: 10, nextQuantity: 10, kind: "unchanged" },
    { productId: "B", previousQuantity: 2, nextQuantity: 0, kind: "removed" },
  ]);
});
caso("E1-Q", "quantidade 10 → 7 é decreased", () => {
  assert.deepEqual(compareOrderProductQuantities(stored, [{ productId: "A", quantity: 7 }]), [
    { productId: "A", previousQuantity: 10, nextQuantity: 7, kind: "decreased" },
  ]);
});
caso("E1-R", "quantidade 10 → 13 é increased", () => {
  assert.deepEqual(compareOrderProductQuantities(stored, [{ productId: "A", quantity: 13 }]), [
    { productId: "A", previousQuantity: 10, nextQuantity: 13, kind: "increased" },
  ]);
});
caso("E1-X6", "validar → comparar: linhas repetidas antigas comparam pela soma e item manual não entra", () => {
  const legacy: OrderItem[] = [
    { productId: "A", name: "Batom", quantity: 2, unitPrice: 19.9 },
    { productId: "A", name: "Batom", quantity: 3, unitPrice: 19.9 },
    { name: "Embrulho", quantity: 1, unitPrice: 2 },
  ];
  const edit = validateOrderEditItems([product("A", 4), manual("Embrulho", 3, 2)]);
  assert.ok(edit.ok);
  assert.deepEqual(compareOrderProductQuantities(legacy, edit.items), [
    { productId: "A", previousQuantity: 5, nextQuantity: 4, kind: "decreased" },
  ]);
});
caso("1B-X1", "comparação aceita quantidade fracionária (1 → 1.5 increased; 2.5 → 2 decreased)", () => {
  assert.deepEqual(compareOrderProductQuantities([{ productId: "A", quantity: 1 }, { productId: "B", quantity: 2.5 }], [{ productId: "A", quantity: 1.5 }, { productId: "B", quantity: 2 }]), [
    { productId: "A", previousQuantity: 1, nextQuantity: 1.5, kind: "increased" },
    { productId: "B", previousQuantity: 2.5, nextQuantity: 2, kind: "decreased" },
  ]);
});

// ===== Total e snapshot de preço (Etapa 1, mantido) =====
caso("E1-S", "calculateOrderTotal continua a conta oficial, exata em cents e com as regras antigas", () => {
  assert.equal(calculateOrderTotal([{ name: "Batom", quantity: 3, unitPrice: 19.9 }]), 59.7);
  assert.equal(calculateOrderTotal([{ name: "a", quantity: 1, unitPrice: 0.1 }, { name: "b", quantity: 1, unitPrice: 0.2 }]), 0.3);
  assert.equal(calculateOrderTotal([]), 0);
  assert.equal(calculateOrderTotal([{ name: "x", quantity: Number.NaN, unitPrice: 10 }, { name: "y", quantity: 2, unitPrice: -5 }]), 0);
});
caso("E1-T", "snapshot de preço existente não é alterado automaticamente", () => {
  // Suponha que o produto hoje custe 25,00 no catálogo: withOrderItemQuantity não tem por onde receber esse preço.
  const line: OrderItem = { productId: "A", name: "Batom (cor antiga)", quantity: 10, unitPrice: 19.9, imageUrl: "https://x.test/a.webp" };
  const increased = withOrderItemQuantity(line, 13);
  const decreased = withOrderItemQuantity(line, 7);
  assert.deepEqual(increased, { productId: "A", name: "Batom (cor antiga)", quantity: 13, unitPrice: 19.9, imageUrl: "https://x.test/a.webp" });
  assert.deepEqual(decreased, { productId: "A", name: "Batom (cor antiga)", quantity: 7, unitPrice: 19.9, imageUrl: "https://x.test/a.webp" });
  assert.equal(line.quantity, 10, "a linha gravada original não é mutada");
  assert.equal(calculateOrderTotal([increased]), 258.7, "10 → 13 cobra 13 × 19,90 do snapshot");
  assert.equal(calculateOrderTotal([decreased]), 139.3, "10 → 7 cobra 7 × 19,90 do snapshot");
});

// ===== Guardas de pureza =====
const ordersSource = fs.readFileSync("client/src/lib/orders.ts", "utf8");

caso("GUARD-1", "contratos históricos do smoke sobre orders.ts, espelhados literalmente (arquivo inteiro)", () => {
  // Mesmas regex de script/smoke-tests.ts (:6403, :6404, :6409). Lá elas avaliam o arquivo inteiro, inclusive
  // comentários, então aqui também — repetidas porque o smoke hoje aborta antes delas (baseline em :4629).
  assert.doesNotMatch(ordersSource, /sales\/finalize|payments\/create-link/i, "orders.ts não pode criar venda nem cobrança");
  assert.doesNotMatch(ordersSource, /stockQuantity|updateStock/, "orders.ts não pode mexer em estoque");
  assert.doesNotMatch(ordersSource, /fetch\(|apiRequest|MercadoPagoConfig|Preference\(/, "orders.ts continua sem I/O — só tipos, rótulos e funções puras");
});
caso("GUARD-2", "seção de edição: nenhum identificador de estoque, I/O ou pagamento no código executável", () => {
  const start = ordersSource.indexOf("export const ORDER_EDITABLE_STATUS_IDS");
  assert.ok(start > 0, "seção de edição precisa existir em orders.ts");
  // Sem comentários: vale o que o código faz, não as palavras da documentação. (Remoção simples basta aqui:
  // a seção não tem "//" dentro de string nem de regex.)
  const code = ordersSource.slice(start).replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
  const identifiers = new Set(code.match(/[A-Za-z_$][\w$]*/g) ?? []);
  const words = new Set(Array.from(identifiers).flatMap((identifier) =>
    identifier.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase().split(/[\s_$]+/).filter(Boolean)));
  for (const word of ["stock", "inventory", "reserve", "reserved", "reservation", "estoque", "firebase", "firestore", "mercadopago"]) {
    assert.ok(!words.has(word), `código da edição não pode usar "${word}"`);
  }
  for (const identifier of ["fetch", "apiRequest", "getFirestore", "runTransaction", "writeBatch", "setDoc", "updateDoc", "addDoc", "deleteDoc", "getDoc", "getDocs", "onSnapshot"]) {
    assert.ok(!identifiers.has(identifier), `código da edição não pode chamar ${identifier}`);
  }
});

console.log(`Orders edit domain tests passed: ${passed} casos (E1 + 1B + LEGACY + GUARD).`);
