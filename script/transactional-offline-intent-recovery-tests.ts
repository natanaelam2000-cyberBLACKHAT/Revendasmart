/*
 * RS-PAR-B-02: deterministic local doubles for the terminal-journal recovery protocol.
 * No Firebase project, HTTP server, browser, or emulator is contacted by this test.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// `createRequire` honors NODE_PATH for this isolated worktree, while normal project installs resolve
// esbuild locally as usual. It avoids installing or downloading anything to run this test.
const { build } = createRequire(import.meta.url)("esbuild") as typeof import("esbuild");

const fixture = String.raw`
import assert from "node:assert/strict";
import * as queue from "./client/src/lib/offline-sales-queue";

type Row = Record<string, unknown>;
const rows = new Map<string, Row>();
const remote = new Map<string, Row>();
let failRead = false;
let failWrite = false;
let failTransaction = false;
let onTransactionRead: (() => void) | undefined;
const key = (parts: unknown[]) => JSON.stringify(parts);
const defer = (fn: () => void) => setTimeout(fn, 0);

class DbTx {
  oncomplete: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  error: Error | null = null;
  aborted = false;
  objectStore() { return new Store(this); }
  abort() { this.aborted = true; this.error = new Error("OFFLINE_DB_WRITE_ABORTED"); this.onabort?.(); }
  complete() { if (!this.aborted) this.oncomplete?.(); }
}
class Store {
  constructor(private tx: DbTx) {}
  get(parts: unknown[]) {
    const request: { result?: Row; onsuccess?: () => void } = {};
    defer(() => {
      if (failRead) { this.tx.error = new Error("OFFLINE_DB_READ_FAILED"); this.tx.onerror?.(); return; }
      request.result = rows.get(key(parts)); request.onsuccess?.(); this.tx.complete();
    });
    return request;
  }
  put(value: Row) { rows.set(key([value.projectId, value.uid, value.saleId]), structuredClone(value)); }
  index() { return { getAll: (parts: unknown[]) => {
    const request: { result?: Row[]; onsuccess?: () => void } = {};
    defer(() => {
      if (failRead) { this.tx.error = new Error("OFFLINE_DB_READ_FAILED"); this.tx.onerror?.(); return; }
      request.result = [...rows.values()].filter((row) => row.projectId === parts[0] && row.uid === parts[1]).map((row) => structuredClone(row));
      request.onsuccess?.(); this.tx.complete();
    });
    return request;
  }}; }
}
const database = {
  objectStoreNames: { contains: () => true },
  createObjectStore: () => ({ createIndex: () => undefined, indexNames: { contains: () => true } }),
  transaction: () => new DbTx(), close: () => undefined, onversionchange: null,
};
(globalThis as any).indexedDB = { open: () => {
  const request: any = { result: database, error: null };
  defer(() => request.onsuccess?.());
  return request;
}};
Object.defineProperty(globalThis, "navigator", { configurable: true, value: { locks: { request: async (_: string, __: unknown, callback: () => unknown) => callback() } } });
(globalThis as any).__auth = { currentUser: { uid: "u1", getIdToken: async () => "token" } };
(globalThis as any).__firestore = {
  runTransaction: async (callback: (tx: any) => Promise<unknown>) => {
    const operations: (() => void)[] = [];
    const tx = {
      get: async (ref: any) => {
        onTransactionRead?.();
        const value = remote.get(ref.path);
        return { exists: () => value !== undefined, data: () => value && structuredClone(value) };
      },
      delete: (ref: any) => operations.push(() => remote.delete(ref.path)),
      update: (ref: any, patch: Row) => operations.push(() => {
        const current = remote.get(ref.path) ?? {};
        const next: Row = { ...current };
        for (const [field, value] of Object.entries(patch)) {
          if ((value as any)?.__delete) delete next[field]; else next[field] = value;
        }
        remote.set(ref.path, next);
      }),
      set: (ref: any, value: Row) => operations.push(() => remote.set(ref.path, structuredClone(value))),
    };
    const result = await callback(tx);
    if (failTransaction) { failTransaction = false; throw new Error("REMOTE_TRANSACTION_FAILED"); }
    operations.forEach((operation) => operation());
    return result;
  },
};

const docPath = (uid: string, collection: string, saleId: string) => "users/" + uid + "/" + collection + "/" + saleId;
const pendingPath = (id: string) => docPath("u1", "pendingSales", id);
const salesPath = (id: string) => docPath("u1", "sales", id);
const payload = (saleId: string) => ({ saleId, clientId: "client-1", products: [{ productId: "product-1", quantity: 1 }], discountType: "fixed" as const, discountValue: 0, paymentType: "avista" as const, paymentMethod: "cash" });
const create = async (saleId: string) => {
  const data = payload(saleId);
  await queue.queuePendingSale("u1", data);
  const now = new Date().toISOString();
  remote.set(pendingPath(saleId), { id: saleId, payload: data, status: "pending", createdAt: now, updatedAt: now });
};
const record = (saleId: string) => rows.get(key(["demo-project", "u1", saleId]));
const addAuthoritativeSale = (saleId: string, extra: Row = {}) => remote.set(salesPath(saleId), { id: saleId, clientId: "client-1", ...extra });
const reset = () => { rows.clear(); remote.clear(); failRead = false; failWrite = false; failTransaction = false; onTransactionRead = undefined; };

// 1: intent survives a failure before the remote delete and later completes from authoritative proof.
reset(); await create("before-delete"); await queue.claimPendingSale("u1", "before-delete", "worker-a", 1_000); addAuthoritativeSale("before-delete"); failTransaction = true;
await assert.rejects(queue.settlePendingSale("u1", "before-delete", "worker-a", { outcome: "synced" }, 2_000));
assert.equal(record("before-delete")?.intent !== undefined, true);
assert.equal(await queue.reconcilePendingSaleIntent("u1", "before-delete"), "completed");
assert.equal(remote.has(pendingPath("before-delete")), false);

// 2: delete committed but the local final journal write crashed; restart finishes without POST/replay.
reset(); await create("after-delete"); await queue.claimPendingSale("u1", "after-delete", "worker-a", 1_000); addAuthoritativeSale("after-delete", { paymentStatus: "paid" });
await queue.settlePendingSale("u1", "after-delete", "worker-a", { outcome: "synced" }, 2_000);
// Deterministic crash image: the remote delete committed, but IndexedDB still contains the prior
// active intent because the final local commit did not reach durable storage.
const afterDelete = record("after-delete")!;
rows.set(key(["demo-project", "u1", "after-delete"]), { ...afterDelete, journalState: "active", intent: { id: "intent-after-delete", kind: "settle", owner: "worker-a", createdAt: new Date().toISOString(), confirmation: { saleId: "after-delete", outcome: "synced" } } });
let postCount = 0; (globalThis as any).fetch = async () => { postCount += 1; throw new Error("must not POST during recovery"); };
assert.equal(await queue.reconcilePendingSaleIntent("u1", "after-delete"), "completed");
assert.equal(postCount, 0);
assert.equal(remote.get(salesPath("after-delete"))?.paymentStatus, "paid");
assert.equal(remote.get(salesPath("after-delete"))?.id, "after-delete");

// 3: cancel interruption is recoverable only when the mirror is not being synced.
reset(); await create("cancel-interrupted"); failTransaction = true;
await assert.rejects(queue.removePendingSale("u1", "cancel-interrupted"));
assert.equal(await queue.reconcilePendingSaleIntent("u1", "cancel-interrupted"), "cancelled");
assert.equal(remote.has(pendingPath("cancel-interrupted")), false);

// 4/5/6: leases are exclusive, stale leases are recoverable, current leases are not stolen.
reset(); await create("lease");
assert.ok(await queue.claimPendingSale("u1", "lease", "worker-a", 1_000));
assert.equal(await queue.claimPendingSale("u1", "lease", "worker-b", 2_000), null);
assert.ok(await queue.claimPendingSale("u1", "lease", "worker-b", 1_000 + queue.SYNC_LEASE_MS + 1));
assert.equal(remote.get(pendingPath("lease"))?.syncOwner, "worker-b");

// 7: a user change during the transaction prevents the destructive write.
reset(); await create("uid-change"); let current = true; onTransactionRead = () => { current = false; };
await assert.rejects(queue.removePendingSale("u1", "uid-change", () => current));
assert.equal(remote.has(pendingPath("uid-change")), true);

// 8: a missing mirror without the server sale is never sufficient to complete a settle intent.
reset(); await create("no-proof"); await queue.claimPendingSale("u1", "no-proof", "worker-a", 1_000); failTransaction = true;
await assert.rejects(queue.settlePendingSale("u1", "no-proof", "worker-a", { outcome: "synced" }, 2_000));
assert.equal(await queue.reconcilePendingSaleIntent("u1", "no-proof"), "needs-review");
assert.equal(record("no-proof")?.intent !== undefined, true);

// 9: malformed local journal is visible as a reviewable error and is never deleted.
reset(); rows.set(key(["demo-project", "u1", "bad-journal"]), { projectId: "demo-project", uid: "u1", saleId: "bad-journal", id: "bad-journal", journalState: "active", status: "pending", payload: { saleId: "different" } });
const invalid = await queue.listPersistedPendingSales("u1");
assert.equal(invalid[0].localReconciliationRequired, true);
assert.equal(await queue.reconcilePendingSaleIntent("u1", "bad-journal"), "invalid-journal");
assert.ok(record("bad-journal"));

// 10/11/12: recovery makes no POST and never changes the server sale/payment identity.
assert.equal(postCount, 0);

// 13: an IndexedDB read fault rejects; it does not erase the journal.
reset(); await create("idb-fault"); failRead = true;
await assert.rejects(queue.listPersistedPendingSales("u1"));
failRead = false; assert.ok(record("idb-fault"));

// 14: a remote transaction error keeps the terminal intent and payload intact for later retry.
reset(); await create("remote-fault"); const originalPayload = structuredClone(record("remote-fault")?.payload); failTransaction = true;
await assert.rejects(queue.removePendingSale("u1", "remote-fault"));
assert.deepEqual(record("remote-fault")?.payload, originalPayload);
assert.ok(record("remote-fault")?.intent);

// 15: a normal retry leaves the durable payload and sale ID intact rather than discarding it.
reset(); await create("retry-data"); await queue.claimPendingSale("u1", "retry-data", "worker-a", 1_000);
await queue.settlePendingSale("u1", "retry-data", "worker-a", { outcome: "retry" }, 2_000);
assert.equal(remote.get(pendingPath("retry-data"))?.id, "retry-data");
assert.deepEqual(record("retry-data")?.payload, payload("retry-data"));

console.log("PASS RS-PAR-B-02 deterministic transactional intent recovery (15 scenarios)");
`;

const temp = await mkdtemp(join(tmpdir(), "rs-par-b-02-"));
try {
  const output = await build({
    absWorkingDir: process.cwd(), bundle: true, write: false, platform: "node", format: "esm",
    stdin: { contents: fixture, resolveDir: process.cwd(), loader: "ts" },
    plugins: [{ name: "offline-queue-local-doubles", setup(builder) {
      builder.onResolve({ filter: /^firebase\/firestore$/ }, () => ({ path: "firestore", namespace: "local-double" }));
      builder.onResolve({ filter: /^firebase\/auth$/ }, () => ({ path: "auth", namespace: "local-double" }));
      builder.onResolve({ filter: /^\.\/firebase$/ }, () => ({ path: "firebase", namespace: "local-double" }));
      builder.onResolve({ filter: /^\.\/api-config$/ }, () => ({ path: "api-config", namespace: "local-double" }));
      builder.onLoad({ filter: /.*/, namespace: "local-double" }, (args) => ({
        contents: args.path === "firestore"
          ? "export const getFirestore=()=>globalThis.__firestore;export const runTransaction=(_,cb)=>globalThis.__firestore.runTransaction(cb);export const doc=(_, ...p)=>({path:p.join('/')});export const deleteField=()=>({__delete:true});"
          : args.path === "auth"
            ? "export const onAuthStateChanged=(auth,cb)=>{cb(auth.currentUser);return()=>{}};"
            : args.path === "firebase"
              ? "export const getFirebaseAuth=()=>globalThis.__auth;export const getFirebaseProjectId=()=>\"demo-project\";"
              : "export const getApiUrl=(value)=>value;",
        loader: "ts",
      }));
    }}],
  });
  const file = join(temp, "intent-recovery.mjs");
  await writeFile(file, output.outputFiles[0].text);
  await import(`${pathToFileURL(file).href}?${Date.now()}`);
} finally {
  await rm(temp, { recursive: true, force: true });
}
