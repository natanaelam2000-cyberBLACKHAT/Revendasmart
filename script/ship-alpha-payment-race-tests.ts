import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { build } from "esbuild";
import { buildExternalReference } from "../shared/charges";

test("late payment responses cannot downgrade paid/refunded charges; replay is idempotent", async () => {
  const externalReference = buildExternalReference("synthetic-owner", "charge");
  let state: Record<string, unknown> = {
    id: "charge", uid: "synthetic-owner", status: "pending", amount: 50,
    externalReference, tokenSource: "central",
  };
  let writes = 0;
  const ref = {
    id: "charge",
    get: async () => ({ exists: true, id: "charge", data: () => structuredClone(state) }),
    update: async (updates: object) => { state = { ...state, ...updates }; writes += 1; },
  };
  let transactionTail = Promise.resolve();
  const chain = { collection: () => chain, doc: () => chain, get: ref.get, update: ref.update, id: "charge" };
  const db = {
    collection: () => chain,
    runTransaction: async (callback: (tx: object) => Promise<unknown>) => {
      const prior = transactionTail;
      let unlock!: () => void;
      transactionTail = new Promise<void>(done => { unlock = done; });
      await prior;
      try { return await callback({ get: ref.get, update: (_ref: unknown, updates: object) => ref.update(updates) }); }
      finally { unlock(); }
    },
  };
  let pendingStarted!: () => void;
  const pendingRequested = new Promise<void>(done => { pendingStarted = done; });
  let releasePending!: () => void;
  const pendingGate = new Promise<void>(done => { releasePending = done; });
  const fixture = {
    getFirebaseAdmin: () => ({ firestore: () => db }),
    payment: async (id: string) => {
      if (id === "late") { pendingStarted(); await pendingGate; }
      return {
        external_reference: externalReference,
        status: id === "late" ? "pending" : id === "refund" ? "refunded" : "approved",
        date_approved: "2026-10-24T00:00:00.000Z",
      };
    },
  };
  const source = readFileSync("server/payments.ts", "utf8") + "\nexport { syncPaymentFromMP };\n";
  const output = await build({
    stdin: { contents: source, resolveDir: resolve("server"), sourcefile: "payments.ts", loader: "ts" },
    bundle: true, platform: "node", format: "cjs", write: false,
    plugins: [{ name: "isolated-provider-and-firestore", setup(builder) {
      builder.onResolve({ filter: /firebase-admin-init$|mercadopago-connections$|^mercadopago$|^\.\/logger$/ }, args => ({ path: args.path, namespace: "fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({ contents:
        path.endsWith("firebase-admin-init") ? "export const getFirebaseAdmin=()=>globalThis.fixture.getFirebaseAdmin();" :
        path.endsWith("mercadopago-connections") ? "export const getMPAccessTokenForCharge=async()=>({accessToken:'synthetic'}); export const findMPConnectionByMerchantId=()=>{throw Error('unexpected provider path')}; export const getValidMPAccessToken=()=>{throw Error('unexpected provider path')};" :
        path === "mercadopago" ? "export class MercadoPagoConfig{}; export class Preference{}; export class Payment { get({id}) {return globalThis.fixture.payment(id)} };" :
        "export const logError=()=>{};export const logInfo=()=>{};export const logWarn=()=>{};",
      }));
    } }],
  });
  const module = { exports: {} as Record<string, unknown> };
  runInNewContext(output.outputFiles[0].text, {
    module, exports: module.exports, fixture, require: createRequire(import.meta.url),
    process: { env: { NODE_ENV: "test" } },
  });
  const sync = module.exports.syncPaymentFromMP as (uid: string, charge: string, payment: string, event: string) => Promise<Record<string, unknown>>;
  const late = sync("synthetic-owner", "charge", "late", "late-event");
  await pendingRequested;
  try {
    await sync("synthetic-owner", "charge", "approved", "approved-event");
  } finally { releasePending(); }
  const lateResult = await late;
  assert.equal(state.status, "paid", "a response started before approval must not overwrite it");
  assert.equal(lateResult.status, "paid", "resync must return the committed status");
  assert.equal(state.providerRawStatus, "approved");
  assert.equal(state.paidAt, "2026-10-24T00:00:00.000Z");
  const beforeReplay = writes;
  await sync("synthetic-owner", "charge", "approved", "approved-event");
  assert.equal(writes, beforeReplay);
  await sync("synthetic-owner", "charge", "refund", "refund-event");
  assert.equal(state.status, "refunded", "an explicit provider refund remains supported");
  const beforeOldApproval = writes;
  await sync("synthetic-owner", "charge", "approved", "old-approved-event");
  assert.equal(state.status, "refunded");
  assert.equal(writes, beforeOldApproval);
});
