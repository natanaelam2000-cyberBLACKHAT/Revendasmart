/**
 * RS-PEDIDOS-01 — UI-1..UI-12: comportamento real da UI de edição de pedidos, executado em Chromium
 * headless com React real (mesma disciplina de script/rs-servicos-01r-tests.ts) contra os componentes
 * de produção de verdade (OrderDetailsSheet, EditOrderSheet, useOrdersData) — nunca reimplementados aqui,
 * só as bordas de I/O (Firebase, fetch) são controladas.
 */
import fs from "node:fs";
import path from "node:path";
import { build } from "esbuild";
import { chromium } from "@playwright/test";

const root = process.cwd();

function resolveClientPath(rel: string): string {
  const base = path.join(root, "client/src", rel);
  for (const ext of ["", ".tsx", ".ts"]) if (fs.existsSync(base + ext)) return base + ext;
  return base;
}

const browserHarness = `
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { OrderDetailsSheet } from "test-production:orderDetailsSheet";
import { EditOrderSheet } from "test-production:editOrderSheet";
import { useOrdersData } from "test-production:useOrdersData";
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const io = globalThis.__io;
const results = [];
const equal = (actual, expected) => { if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(JSON.stringify({ actual, expected })); };
async function check(name, fn) { try { await fn(); results.push({name, pass: true}); } catch (error) { results.push({name, pass: false, detail: String(error)}); } }
const reset = () => Object.assign(io, { authCallbacks: [], snapshotCallbacks: [], posts: [], count: 0 });

function baseOrder(overrides = {}) {
  return {
    id: "order-1", clientId: "client-1", clientName: "Cliente Teste", status: "new",
    items: [
      { productId: "prod-existing", name: "Produto Existente", quantity: 3, unitPrice: 19.9, imageUrl: "" },
      { name: "Item Manual", quantity: 2, unitPrice: 5 },
    ],
    total: 69.7,
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    ...overrides,
  };
}

async function mount(element) {
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(element));
  return {
    container,
    unmount: async () => { await act(async () => root.unmount()); container.remove(); },
  };
}

async function click(container, testid) {
  const el = container.querySelector(\`[data-testid="\${testid}"]\`);
  if (!el) throw new Error("missing " + testid);
  await act(async () => { el.click(); });
}

async function hasEditButton(order) {
  const { container, unmount } = await mount(React.createElement(OrderDetailsSheet, { order, onClose: () => {}, onChangeStatus: () => {}, onEdit: () => {} }));
  const found = Boolean(container.querySelector('[data-testid="button-edit-order"]'));
  await unmount();
  return found;
}

globalThis.__tests = (async () => {

await check("UI-1 Editar aparece em new + payment editable", async () => {
  equal(await hasEditButton(baseOrder({ status: "new" })), true);
});
await check("UI-2 Editar aparece em in_progress + payment editable", async () => {
  equal(await hasEditButton(baseOrder({ status: "in_progress" })), true);
});
await check("UI-3 Editar não aparece em ready/delivered/cancelled", async () => {
  for (const status of ["ready", "delivered", "cancelled"]) equal(await hasEditButton(baseOrder({ status })), false);
});
await check("UI-4 Editar não aparece quando pagamento já iniciou", async () => {
  for (const paymentStatus of ["awaiting_customer_payment", "customer_reported_paid", "paid", "failed", "cancelled"]) {
    equal(await hasEditButton(baseOrder({ status: "new", paymentStatus })), false);
  }
});

async function mountEdit(order, onSubmit) {
  return mount(React.createElement(EditOrderSheet, { order, onClose: () => { io.closed = true; }, onSubmit }));
}

await check("UI-5 alterar quantidade gera payload correto (preserva preço histórico)", async () => {
  const captured = [];
  const { container, unmount } = await mountEdit(baseOrder(), async (input) => { captured.push(input); return {}; });
  await click(container, "button-edit-order-increase-0"); // produto existente: 3 -> 4
  await click(container, "button-submit-edit-order");
  equal(captured.length, 1);
  equal(captured[0].items, [{ productId: "prod-existing", quantity: 4 }, { name: "Item Manual", quantity: 2, unitPrice: 5 }]);
  await unmount();
});

await check("UI-6 adicionar produto (busca) gera payload correto com productId, sem preço do cliente", async () => {
  reset();
  const captured = [];
  const { container, unmount } = await mountEdit(baseOrder(), async (input) => { captured.push(input); return {}; });
  await act(async () => { io.authCallbacks[io.authCallbacks.length - 1]({ uid: "test-user" }); });
  await act(async () => { io.snapshotCallbacks[io.snapshotCallbacks.length - 1]({ docs: [{ id: "prod-new", data: () => ({ name: "Produto Novo", salePrice: 30 }) }] }); });
  const search = container.querySelector('input[placeholder="Buscar produto do catálogo..."]');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  await act(async () => { setter.call(search, "Novo"); search.dispatchEvent(new Event("input", { bubbles: true })); });
  await click(container, "button-edit-order-add-product-prod-new");
  await click(container, "button-submit-edit-order");
  equal(captured.length, 1);
  const addedLine = captured[0].items.find((item) => item.productId === "prod-new");
  equal(addedLine, { productId: "prod-new", quantity: 1 });
  await unmount();
});

await check("UI-7 remover item exclui a linha inteira do payload", async () => {
  const captured = [];
  const { container, unmount } = await mountEdit(baseOrder(), async (input) => { captured.push(input); return {}; });
  await click(container, "button-edit-order-remove-1"); // remove o item manual
  await click(container, "button-submit-edit-order");
  equal(captured[0].items, [{ productId: "prod-existing", quantity: 3 }]);
  await unmount();
});

await check("UI-8 expectedUpdatedAt enviado é o do pedido aberto", async () => {
  const captured = [];
  const order = baseOrder({ updatedAt: "2024-02-02T00:00:00.000Z" });
  const { container, unmount } = await mountEdit(order, async (input) => { captured.push(input); return {}; });
  await click(container, "button-submit-edit-order");
  equal(captured[0].expectedUpdatedAt, "2024-02-02T00:00:00.000Z");
  equal(captured[0].orderId, "order-1");
  await unmount();
});

await check("UI-11 STALE_ORDER_VERSION mostra erro e oferece fechar (nunca sobrescreve em silêncio)", async () => {
  const { ApiError } = await import("test-production:apiClient");
  const { container, unmount } = await mountEdit(baseOrder(), async () => { throw new ApiError({ status: 409, code: "STALE_ORDER_VERSION", message: "O pedido foi alterado em outro lugar. Atualize e tente de novo." }); });
  await click(container, "button-submit-edit-order");
  await new Promise((resolve) => setTimeout(resolve, 0));
  equal(container.querySelector('[data-testid="text-edit-order-error"]').textContent, "O pedido foi alterado em outro lugar. Atualize e tente de novo.");
  equal(Boolean(container.querySelector('[data-testid="button-edit-order-close-stale"]')), true);
  equal(Boolean(container.querySelector('[data-testid="button-submit-edit-order"]')), false);
  await unmount();
});

await check("UI-12 double-submit: dois cliques rápidos chamam onSubmit uma única vez", async () => {
  let calls = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const { container, unmount } = await mountEdit(baseOrder(), async () => { calls++; await gate; return {}; });
  // Dois cliques reais nunca chegam no mesmo microtask — cada um é um evento de fila separado; o que o
  // guard isSaving precisa impedir é o segundo clique DEPOIS que o primeiro já está em andamento.
  await click(container, "button-submit-edit-order");
  await click(container, "button-submit-edit-order");
  await click(container, "button-submit-edit-order");
  equal(calls, 1);
  release();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await unmount();
});

// UI-9/UI-10: idempotencyKey e ausência de total autoritativo vivem em useOrdersData().editOrder, não no
// sheet (que só monta a lista de itens) — testados contra o hook real, com apiRequest mockado (a camada
// de transporte HTTP em si é infraestrutura pré-existente, fora do escopo desta ticket).
await check("UI-9/UI-10 useOrdersData().editOrder: idempotencyKey novo por chamada, nunca envia total/uid/clientId/status", async () => {
  reset();
  let latest;
  const { unmount } = await mount(React.createElement(function Probe() { latest = useOrdersData(); return null; }));
  await act(async () => { io.authCallbacks[io.authCallbacks.length - 1]({ uid: "test-user" }); });
  await act(async () => { io.snapshotCallbacks[io.snapshotCallbacks.length - 1]({ docs: [] }); });
  const first = await latest.editOrder({ orderId: "order-1", expectedUpdatedAt: "t1", items: [{ productId: "p1", quantity: 2 }] });
  const second = await latest.editOrder({ orderId: "order-1", expectedUpdatedAt: "t1", items: [{ productId: "p1", quantity: 2 }] });
  equal(io.posts.length, 2);
  equal(io.posts[0].url, "/api/orders/order-1/edit");
  const [bodyA, bodyB] = io.posts.map((p) => p.options.body);
  equal(Object.keys(bodyA).sort(), ["expectedUpdatedAt", "idempotencyKey", "items"]);
  equal(bodyA.expectedUpdatedAt, "t1");
  equal(bodyA.items, [{ productId: "p1", quantity: 2 }]);
  equal(typeof bodyA.idempotencyKey === "string" && bodyA.idempotencyKey.length >= 6, true);
  equal(bodyA.idempotencyKey === bodyB.idempotencyKey, false);
  await unmount();
});

return results;
})();
`;

async function main() {
  const bundled = await build({
    stdin: { contents: browserHarness, resolveDir: root, loader: "ts" },
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    nodePaths: [path.join(root, "node_modules")],
    define: { "process.env.NODE_ENV": '"development"' },
    plugins: [{
      name: "controlled-io", setup(b) {
        const productionPaths: Record<string, string> = {
          orderDetailsSheet: "client/src/components/orders/OrderDetailsSheet.tsx",
          editOrderSheet: "client/src/components/orders/EditOrderSheet.tsx",
          useOrdersData: "client/src/hooks/useOrdersData.ts",
        };
        b.onResolve({ filter: /^test-production:apiClient$/ }, () => ({ path: "api-client-mock-shim", namespace: "mock" }));
        b.onResolve({ filter: /^test-production:/ }, (args) => ({ path: path.join(root, productionPaths[args.path.slice(16)]) }));
        b.onResolve({ filter: /^(firebase\/auth|firebase\/firestore)$/ }, () => ({ path: "firebase-mock-shim", namespace: "mock" }));
        b.onResolve({ filter: /^(@\/lib\/firebase|\.\/firebase)$/ }, () => ({ path: "firebase-mock-shim", namespace: "mock" }));
        // api-client.ts é infraestrutura pré-existente (fetch/auth-token), não parte desta ticket — mockado
        // aqui para isolar exatamente o que editOrder/EditOrderSheet CONSTROEM (payload/erro), sem depender
        // do transporte HTTP real de verdade (esse já tem seus próprios consumidores testados no projeto).
        b.onResolve({ filter: /^@\/lib\/api-client$/ }, () => ({ path: "api-client-mock-shim", namespace: "mock" }));
        b.onResolve({ filter: /^@\// }, (args) => ({ path: resolveClientPath(args.path.slice(2)) }));
        b.onResolve({ filter: /^@shared\// }, (args) => ({ path: path.join(root, "shared", args.path.slice(8) + ".ts") }));
        b.onLoad({ filter: /.*/, namespace: "mock" }, (args) => {
          if (args.path === "api-client-mock-shim") {
            return {
              loader: "js", contents: `
                const io = globalThis.__io;
                export class ApiError extends Error {
                  constructor(params) { super(params.message); this.name = "ApiError"; this.code = params.code; this.status = params.status; }
                }
                export const apiRequest = async (url, options) => {
                  io.posts.push({ url, options });
                  return { orderId: "order-1", updatedAt: "t2", total: 1, itemCount: 1, idempotentReplay: false };
                };
              `,
            };
          }
          return {
            loader: "js", contents: `
              const io = globalThis.__io;
              export const getFirebaseAuth = () => ({ name: "test-auth" });
              export const getCurrentFirebaseUser = () => ({ uid: "test-user" });
              export const waitForAuthReady = async () => ({ uid: "test-user", getIdToken: async () => "test-token" });
              export const logTelemetryEvent = async () => undefined;
              export const logError = () => undefined;
              export const onAuthStateChanged = (_auth, callback) => { io.authCallbacks.push(callback); return () => {}; };
              export const collection = () => ({}), doc = () => ({}), getFirestore = () => ({}), orderBy = () => ({}), limit = () => ({}), query = () => ({}), startAfter = () => ({}), setDoc = async () => undefined;
              export const getDoc = async () => ({ exists: () => false }), getDocs = async () => ({ docs: [] });
              export const onSnapshot = (_query, onNext) => { io.snapshotCallbacks.push(onNext); return () => {}; };
            `,
          };
        });
      },
    }],
  });

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const consoleErrors: string[] = [];
    page.on("pageerror", (err) => consoleErrors.push(err.message));
    await page.setContent('<div id="root"></div>');
    await page.evaluate(() => {
      (globalThis as any).__io = { authCallbacks: [], snapshotCallbacks: [], posts: [], count: 0, closed: false };
    });
    await page.addScriptTag({ content: bundled.outputFiles[0].text });
    const results = await page.evaluate(async () => await (globalThis as any).__tests);
    for (const result of results) console.log(`${result.pass ? "PASS" : "FAIL"} ${result.name}${result.detail ? ": " + result.detail : ""}`);
    console.log(`RS-PEDIDOS-01 UI: ${results.filter((r: any) => r.pass).length}/${results.length} PASS`);
    if (consoleErrors.length > 0) {
      console.log("Page errors captured:", consoleErrors);
    }
    if (!results.every((r: any) => r.pass)) process.exit(1);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
