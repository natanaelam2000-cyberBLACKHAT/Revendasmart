import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { build } from "esbuild";
import type { PendingSaleDoc } from "../client/src/lib/offline-sales-queue";

test("offline claims recover interrupted sync without stale-worker deletion or cross-session writes", async () => {
  const rows = new Map<string, PendingSaleDoc>();
  const path = "users/synthetic-owner/pendingSales/sale";
  const record: PendingSaleDoc = {
    id: "sale", status: "syncing", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
    payload: { saleId: "sale", clientId: "synthetic-client", products: [{ productId: "synthetic-product", quantity: 1 }],
      discountType: "fixed", discountValue: 0, paymentType: "avista", paymentMethod: "cash" },
  };
  let tail = Promise.resolve();
  let afterRead: (() => void) | undefined;
  let failCommit = false;
  let responseStatus = 200;
  let responseBody: object = {};
  const store = {
    runTransaction: async (callback: (tx: object) => Promise<unknown>) => {
      const previous = tail;
      let release!: () => void;
      tail = new Promise<void>(done => { release = done; });
      await previous;
      const writes: (() => void)[] = [];
      try {
        const result = await callback({
          get: async (key: string) => {
            const value = rows.get(key);
            const copy = value && structuredClone(value);
            afterRead?.();
            return { exists: () => Boolean(copy), data: () => copy };
          },
          update: (key: string, updates: object) => writes.push(() => {
            const next = { ...rows.get(key), ...updates } as Record<string, unknown>;
            for (const field of Object.keys(next)) if (next[field] === "__delete") delete next[field];
            rows.set(key, next as unknown as PendingSaleDoc);
          }),
          delete: (key: string) => writes.push(() => { rows.delete(key); }),
        });
        if (failCommit) throw new Error("synthetic interrupted commit");
        writes.forEach(write => write());
        return result;
      } finally { release(); }
    },
  };
  const output = await build({
    entryPoints: [resolve("client/src/lib/offline-sales-queue.ts")], bundle: true,
    platform: "node", format: "cjs", write: false,
    plugins: [{ name: "isolated-queue-storage", setup(builder) {
      builder.onResolve({ filter: /^firebase\/firestore$|^\.\/api-config$/ }, args => ({ path: args.path, namespace: "fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({ contents: path === "firebase/firestore"
        ? "export const doc=(_db,...parts)=>parts.join('/'); export const getFirestore=()=>globalThis.store; export const runTransaction=(db,cb)=>db.runTransaction(cb); export const deleteField=()=>'__delete'; export const setDoc=()=>{throw Error('unexpected nontransactional write')}; export const deleteDoc=()=>{throw Error('unexpected nontransactional delete')};"
        : "export const getApiUrl=path=>'http://127.0.0.1'+path;",
      }));
    } }],
  });
  const module = { exports: {} };
  runInNewContext(output.outputFiles[0].text, {
    module, exports: module.exports, store,
    fetch: async (_url: string, options: RequestInit) => {
      if (options.signal?.aborted) throw new Error("synthetic request aborted");
      assert.equal(JSON.parse(String(options.body)).saleId, "sale", "retries preserve the idempotency key");
      return { ok: responseStatus >= 200 && responseStatus < 300, status: responseStatus, json: async () => responseBody };
    },
  });
  const queue = module.exports as typeof import("../client/src/lib/offline-sales-queue");
  const now = Date.parse("2026-10-24T00:00:00.000Z");
  assert.equal(queue.isPendingSaleReady(record, now), true, "a restored legacy syncing item must be recoverable");
  assert.equal(queue.isPendingSaleReady({ ...record, updatedAt: new Date(now).toISOString() }, now), false);
  assert.equal(queue.isPendingSaleReady({ ...record, updatedAt: "invalid" }, now), true);
  for (const status of ["failed", "conflict"] as const) assert.equal(queue.isPendingSaleReady({ ...record, status }, now), false);

  rows.set(path, structuredClone(record));
  const claims = await Promise.all([
    queue.claimPendingSale("synthetic-owner", "sale", "worker-a", () => true, now),
    queue.claimPendingSale("synthetic-owner", "sale", "worker-b", () => true, now),
  ]);
  assert.equal(claims.filter(Boolean).length, 1, "only one concurrent worker may claim");
  const replacement = await queue.claimPendingSale("synthetic-owner", "sale", "worker-b", () => true, now + queue.PENDING_SALE_LEASE_MS + 1);
  assert.ok(replacement, "a restart can reclaim an expired lease");
  await queue.settlePendingSale("synthetic-owner", "sale", "worker-a", { outcome: "synced" });
  assert.equal(rows.get(path)?.syncOwner, "worker-b", "a stale worker cannot delete its replacement");

  failCommit = true;
  await assert.rejects(queue.settlePendingSale("synthetic-owner", "sale", "worker-b", { outcome: "synced" }));
  assert.equal(rows.has(path), true, "an interrupted commit must keep the item");
  failCommit = false;
  await queue.settlePendingSale("synthetic-owner", "sale", "worker-b", { outcome: "retry" });
  assert.equal(rows.get(path)?.status, "pending");
  assert.equal(rows.get(path)?.syncOwner, undefined);
  assert.deepEqual(JSON.parse(JSON.stringify(rows.get(path)?.payload)), record.payload);

  let currentSession = true;
  afterRead = () => { currentSession = false; };
  assert.equal(await queue.claimPendingSale("synthetic-owner", "sale", "new-session", () => currentSession, now), null);
  assert.equal(rows.get(path)?.status, "pending");
  afterRead = undefined;
  await queue.claimPendingSale("synthetic-owner", "sale", "worker-c", () => true, now);
  await queue.settlePendingSale("synthetic-owner", "sale", "worker-c", { outcome: "synced" }, () => false);
  assert.equal(rows.has(path), true, "user switching fences old async completions");

  responseStatus = 503;
  const retry = await queue.syncPendingSaleToServer("synthetic", record.payload);
  assert.equal(retry.outcome, "retry");
  await queue.settlePendingSale("synthetic-owner", "sale", "worker-c", retry);
  assert.equal(rows.get(path)?.status, "pending");
  await queue.claimPendingSale("synthetic-owner", "sale", "worker-c", () => true, now);
  responseStatus = 409; responseBody = { code: "INSUFFICIENT_STOCK", message: "synthetic stock conflict" };
  const conflict = await queue.syncPendingSaleToServer("synthetic", record.payload);
  await queue.settlePendingSale("synthetic-owner", "sale", "worker-c", conflict);
  assert.equal(rows.get(path)?.status, "conflict");
  assert.equal(queue.isPendingSaleReady(rows.get(path)!, now), false);

  rows.set(path, structuredClone(record));
  await queue.claimPendingSale("synthetic-owner", "sale", "worker-c", () => true, now);
  responseBody = { code: "SALE_ALREADY_EXISTS" };
  const replay = await queue.syncPendingSaleToServer("synthetic", record.payload);
  assert.equal(replay.outcome, "already-exists");
  await queue.settlePendingSale("synthetic-owner", "sale", "worker-c", replay);
  assert.equal(rows.has(path), false, "only a successful or already-committed response completes the queue");
  await queue.settlePendingSale("synthetic-owner", "sale", "worker-c", { outcome: "retry" });
  assert.equal(rows.has(path), false, "late callbacks must not resurrect deleted records");
});
