import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { build } from "esbuild";

test("concurrent full/partial payments and repeated partial commands cannot regress or duplicate balances", async () => {
  let state = { amount: 100, paidAmount: 0, status: "pending" };
  let tail = Promise.resolve();
  let afterRead: (() => void) | undefined;
  let writes = 0;
  const store = {
    runTransaction: async (callback: (tx: object) => Promise<unknown>) => {
      const previous = tail;
      let release!: () => void;
      tail = new Promise<void>(done => { release = done; });
      await previous;
      let update: object | undefined;
      try {
        const result = await callback({
          get: async () => {
            const copy = structuredClone(state);
            afterRead?.();
            return { exists: () => true, data: () => copy };
          },
          update: (_ref: unknown, next: object) => { update = next; },
        });
        if (update) { state = { ...state, ...update }; writes += 1; }
        return result;
      } finally { release(); }
    },
  };
  const output = await build({
    entryPoints: [resolve("client/src/lib/installment-payments.ts")], bundle: true,
    platform: "node", format: "cjs", write: false,
    plugins: [{ name: "isolated-installment-transactions", setup(builder) {
      builder.onResolve({ filter: /^firebase\/firestore$/ }, () => ({ path: "store", namespace: "fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents:
        "export const getFirestore=()=>globalThis.store;export const doc=(_db,...parts)=>parts.join('/');export const runTransaction=(db,cb)=>db.runTransaction(cb);",
      }));
    } }],
  });
  const module = { exports: {} };
  runInNewContext(output.outputFiles[0].text, { module, exports: module.exports, store });
  const { payInstallment } = module.exports as typeof import("../client/src/lib/installment-payments");
  const partial = { kind: "partial" as const, amount: 20, expectedPaidAmount: 0 };
  for (const fullFirst of [true, false]) {
    state = { amount: 100, paidAmount: 0, status: "pending" };
    const full = () => payInstallment("synthetic-owner", "installment", { kind: "full" }, () => true);
    const part = () => payInstallment("synthetic-owner", "installment", partial, () => true);
    await Promise.all(fullFirst ? [full(), part()] : [part(), full()]);
    assert.equal(state.status, "paid");
    assert.equal(state.paidAmount, 100);
  }
  state = { amount: 100, paidAmount: 0, status: "pending" };
  const duplicate = await Promise.allSettled([
    payInstallment("synthetic-owner", "installment", partial, () => true),
    payInstallment("synthetic-owner", "installment", partial, () => true),
  ]);
  assert.equal(duplicate.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(state.paidAmount, 20, "the same observed balance cannot accept the payment twice");
  await assert.rejects(payInstallment("synthetic-owner", "installment", partial, () => true), /parcela mudou/);
  await payInstallment("synthetic-owner", "installment", { kind: "partial", amount: 30, expectedPaidAmount: 20 }, () => true);
  assert.equal(state.paidAmount, 50);
  for (const amount of [0, -1, NaN, Infinity, 1000]) {
    await assert.rejects(payInstallment("synthetic-owner", "installment", { kind: "partial", amount, expectedPaidAmount: 50 }, () => true));
    assert.equal(state.paidAmount, 50);
  }
  let current = true;
  afterRead = () => { current = false; };
  const beforeSessionChange = writes;
  await assert.rejects(payInstallment("synthetic-owner", "installment", { kind: "full" }, () => current), /sessão mudou/);
  assert.equal(writes, beforeSessionChange);
  afterRead = undefined;
  await payInstallment("synthetic-owner", "installment", { kind: "full" }, () => true);
  const beforeReplay = writes;
  await payInstallment("synthetic-owner", "installment", partial, () => true);
  assert.equal(writes, beforeReplay);
  assert.equal(state.paidAmount, 100);
});
