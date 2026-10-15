import assert from "node:assert/strict";
import http from "node:http";
import { build } from "esbuild";
import { chromium } from "@playwright/test";
import { initializeFirebaseAdmin, getFirebaseAdmin } from "../server/firebase-admin-init";

assert.equal(process.env.FIRESTORE_EMULATOR_HOST, "127.0.0.1:8080");
assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, "127.0.0.1:9099");
process.env.FIREBASE_PROJECT_ID = "demo-revendasmart";
initializeFirebaseAdmin();
const admin = getFirebaseAdmin();
const uid = `offline-lease-${Date.now()}`;
const email = `${uid}@example.test`;
const password = "Offline-local-test-Password!123";
await admin.auth().createUser({ uid, email, password });
const sends = new Map<string, number>();
let bundle = "";
const server = http.createServer(async (req, res) => {
  if (req.method === "POST") console.log(`HTTP_POST ${req.url}`);
  if (req.url === "/bundle.js") { res.setHeader("Content-Type", "application/javascript"); res.end(bundle); return; }
  if (req.url === "/api/sales/finalize") {
    // Network boundary only: real hook, Auth, queue, transactions, IndexedDB and reload are exercised.
    // Server financial idempotency is independently exercised by the existing domain/emulator suites.
    try {
      const decoded = await admin.auth().verifyIdToken(String(req.headers.authorization).replace(/^Bearer /, ""));
      assert.equal(decoded.uid, uid);
      let raw = ""; for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw);
      console.log(`API_REQUEST saleId=${body.saleId}`);
      sends.set(body.saleId, (sends.get(body.saleId) ?? 0) + 1);
      res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ saleId: body.saleId }));
    } catch { res.statusCode = 401; res.end("{}"); }
    return;
  }
  res.setHeader("Content-Type", "text/html");
  res.end('<div id="root"></div><script src="/bundle.js"></script>');
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
async function waitForServerCompletion(id: string): Promise<void> {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    assert.ok((sends.get(id) ?? 0) <= 1, `duplicate HTTP send: ${id}`);
    if (sends.get(id) === 1 && !(await admin.firestore().doc(`users/${uid}/pendingSales/${id}`).get()).exists) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.fail(`server completion missing: ${id}; sends=${JSON.stringify([...sends])}; record=${JSON.stringify((await admin.firestore().doc(`users/${uid}/pendingSales/${id}`).get()).data())}`);
}
const fixture = `
import * as queue from './client/src/lib/offline-sales-queue';
import {usePendingSalesSync} from './client/src/hooks/usePendingSalesSync';
import React from 'react'; import {createRoot} from 'react-dom/client';
import {initializeApp} from 'firebase/app';
import {getAuth,connectAuthEmulator,signInWithEmailAndPassword} from 'firebase/auth';
import {initializeFirestore,persistentLocalCache,persistentMultipleTabManager,connectFirestoreEmulator,doc,getDocFromServer,getDocFromCache} from 'firebase/firestore';
const app=initializeApp({apiKey:'demo-api-key',projectId:'demo-revendasmart'});
const db=initializeFirestore(app,{localCache:persistentLocalCache({tabManager:persistentMultipleTabManager()})});
connectFirestoreEmulator(db,'127.0.0.1',8080);
connectAuthEmulator(getAuth(app),'http://127.0.0.1:9099',{disableWarnings:true});
function Worker(){usePendingSalesSync();return null;}
window.queueTest={...queue,read:async(id,cache=false)=>{const snap=await(cache?getDocFromCache:getDocFromServer)(doc(db,'users',${JSON.stringify(uid)},'pendingSales',id));return snap.exists()?snap.data():null;},mount:()=>createRoot(document.getElementById('root')).render(React.createElement(Worker))};
signInWithEmailAndPassword(getAuth(app),${JSON.stringify(email)},${JSON.stringify(password)}).then(()=>{window.ready=true;});
`;
try {
  const compiled = await build({
    absWorkingDir: process.cwd(), preserveSymlinks: true, bundle: true, write: false, platform: "browser", format: "iife",
    stdin: { contents: fixture, resolveDir: process.cwd(), loader: "tsx" },
    define: { "process.env.NODE_ENV": '"test"', "import.meta.env": JSON.stringify({ VITE_API_BASE_URL: origin, DEV: true }) },
    plugins: [{ name: "test-auth-initialization", setup(builder) {
      builder.onResolve({ filter: /^@\/lib\/firebase$/ }, () => ({ path: "auth-fixture", namespace: "fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: "import {getAuth} from 'firebase/auth';export const getFirebaseAuth=()=>getAuth();", resolveDir: process.cwd() }));
    } }],
  });
  bundle = compiled.outputFiles[0].text;
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    const other = await context.newPage();
    const open = async (p: typeof page) => { await p.goto(origin); await p.waitForFunction(() => (window as any).ready); };
    context.on("page", (p) => p.on("pageerror", (error) => console.log(`BROWSER_ERROR ${error.message}`)));
    await open(page); await open(other);
    const create = async (id: string) => page.evaluate(async ({ uid, id }) => {
      await (window as any).queueTest.queuePendingSale(uid, { saleId: id, clientId: "fixture-client", products: [{ productId: "fixture-product", quantity: 1 }], discountType: "fixed", discountValue: 0, paymentType: "avista", paymentMethod: "cash" });
    }, { uid, id });
    const claim = (p: typeof page, id: string, owner: string, now = Date.now()) => p.evaluate(async ({ uid, id, owner, now }) => !!await (window as any).queueTest.claimPendingSale(uid, id, owner, now), { uid, id, owner, now });
    await create("fresh");
    assert.equal(await claim(page, "fresh", "worker-a"), true);
    assert.equal(await claim(other, "fresh", "worker-b"), false);
    console.log("PASS FRESH_SYNCING_NOT_STOLEN");
    await other.evaluate(async (uid) => {
      const q = (window as any).queueTest;
      await q.markPendingSalePending(uid, "fresh");
      await q.removePendingSale(uid, "fresh");
      if ((await q.read("fresh")).syncOwner !== "worker-a") throw new Error("manual actions stole an active lease");
      await q.queuePendingSale(uid, { saleId: "ownership", clientId: "fixture-client", products: [], discountType: "fixed", discountValue: 0, paymentType: "avista", paymentMethod: null });
      await q.claimPendingSale(uid, "ownership", "old-owner", Date.now() - 121_000);
      await q.claimPendingSale(uid, "ownership", "new-owner");
      if (await q.renewPendingSaleLease(uid, "ownership", "old-owner")) throw new Error("old owner renewed a stolen lease");
      if (await q.settlePendingSale(uid, "ownership", "old-owner", { outcome: "synced" })) throw new Error("late owner deleted another lease");
      if ((await q.read("ownership")).syncOwner !== "new-owner") throw new Error("lease ownership lost");
    }, uid);
    console.log("PASS LATE_WORKER_CANNOT_SETTLE_NEW_LEASE");
    await create("crashed");
    assert.equal(await claim(page, "crashed", "crashed-worker", Date.now() - 121_000), true);
    assert.equal((await page.evaluate(() => (window as any).queueTest.read("crashed"))).status, "syncing");
    // Transaction acknowledgement precedes local-cache notification. Wait for the real cache,
    // then reload; the assertion after restart must use IndexedDB only, never a server fallback.
    await page.waitForFunction(async () => (await (window as any).queueTest.read("crashed", true)).status === "syncing");
    await page.reload(); await page.waitForFunction(() => (window as any).ready);
    assert.equal((await page.evaluate(() => (window as any).queueTest.read("crashed", true))).status, "syncing");
    await page.evaluate(() => (window as any).queueTest.mount());
    await waitForServerCompletion("crashed");
    assert.equal(sends.get("crashed"), 1);
    console.log("PASS SYNCING_RECOVERED_AFTER_STALE_LEASE; CRASH_AFTER_SYNC_MARK_RECOVERS; RESTART_RECOVERS_STUCK_ITEM");
    assert.equal(await claim(other, "crashed", "worker-b"), false);
    console.log("PASS SUCCESSFUL_ITEM_NOT_REQUEUED");
    // Pause automatic drain by closing the mounted page; preserve the shared browser IndexedDB.
    await page.close();
    const third = await context.newPage(); await open(third);
    await other.evaluate(async (uid) => { await (window as any).queueTest.queuePendingSale(uid, { saleId: "two-workers", clientId: "fixture-client", products: [], discountType: "fixed", discountValue: 0, paymentType: "avista", paymentMethod: null }); }, uid);
    assert.equal((await admin.firestore().doc(`users/${uid}/pendingSales/two-workers`).get()).exists, true);
    await Promise.all([other.evaluate(() => (window as any).queueTest.mount()), third.evaluate(() => (window as any).queueTest.mount())]);
    await waitForServerCompletion("two-workers");
    console.log(`TWO_WORKERS_SERVER_EXISTS=${(await admin.firestore().doc(`users/${uid}/pendingSales/two-workers`).get()).exists}; SENDS=${JSON.stringify([...sends])}`);
    assert.equal(sends.get("two-workers"), 1);
    console.log("PASS TWO_WORKERS_DO_NOT_DOUBLE_SEND");
    await other.close(); await third.close();
    const manual = await context.newPage(); await open(manual);
    await manual.evaluate(async (uid) => {
      const q = (window as any).queueTest;
      await q.queuePendingSale(uid, { saleId: "conflict", clientId: "fixture-client", products: [], discountType: "fixed", discountValue: 0, paymentType: "avista", paymentMethod: null });
      await q.claimPendingSale(uid, "conflict", "conflict-worker");
      await q.settlePendingSale(uid, "conflict", "conflict-worker", { outcome: "conflict", reason: "INSUFFICIENT_STOCK", message: "stock conflict" });
      const conflict = await q.read("conflict");
      if (conflict.status !== "conflict" || conflict.conflictReason !== "INSUFFICIENT_STOCK" || !conflict.payload) throw new Error("conflict record lost");
      await q.queuePendingSale(uid, { saleId: "retry-limit", clientId: "fixture-client", products: [], discountType: "fixed", discountValue: 0, paymentType: "avista", paymentMethod: null });
      let now = Date.now();
      for (let i = 0; i < q.MAX_SYNC_ATTEMPTS; i++) {
        if (!await q.claimPendingSale(uid, "retry-limit", "retry-worker", now)) throw new Error("claim failed unexpectedly");
        await q.settlePendingSale(uid, "retry-limit", "retry-worker", { outcome: "retry" }, now);
        now += 300_001;
      }
      if (await q.claimPendingSale(uid, "retry-limit", "extra-worker", now)) throw new Error("retry limit exceeded");
      const record = await q.read("retry-limit");
      if (record.status !== "failed" || record.syncAttempts !== q.MAX_SYNC_ATTEMPTS) throw new Error("retry policy not persisted");
    }, uid);
    console.log("PASS MAX_RETRY_POLICY_RESPECTED");
    console.log("PASS BUSINESS_CONFLICT_PRESERVES_PAYLOAD_AND_REASON");
    assert.equal(await manual.evaluate(async (uid) => {
      try { await (window as any).queueTest.claimPendingSale(`${uid}-other`, "foreign-sale", "intruder"); return false; }
      catch (error) { return (error as { code?: string }).code === "permission-denied"; }
    }, uid), true);
    console.log("PASS OFFLINE_CROSS_TENANT_CLAIM_DENIED");
  } finally { await browser.close(); }
} finally {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await admin.firestore().recursiveDelete(admin.firestore().doc(`users/${uid}`));
  await admin.auth().deleteUser(uid);
}
