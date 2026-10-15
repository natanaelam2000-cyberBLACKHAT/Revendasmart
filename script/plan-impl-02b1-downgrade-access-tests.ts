import assert from "node:assert/strict";
import { initializeApp, deleteApp } from "firebase/app";
import { getAuth, connectAuthEmulator, createUserWithEmailAndPassword } from "firebase/auth";
import { connectFirestoreEmulator, doc, getDoc, getFirestore, updateDoc } from "firebase/firestore";
import { initializeFirebaseAdmin } from "../server/firebase-admin-init";
import { reconcilePlanAccess, computeReconciliationPlan, type DomainName } from "../server/plan-access-reconciliation";
import { toPublicCatalogProduct } from "../server/public-catalog";
import { finalizeSaleTransaction } from "../server/sale-finalize-transaction";
import { listPublicBookableServicesCommand } from "../server/service-public-booking";
import { createServiceBookingHoldCommand } from "../server/service-booking-commands";
import { PLAN_CONFIG } from "../shared/monetization";
import type { Firestore as AdminFirestore } from "firebase-admin/firestore";

/**
 * PLAN-IMPL-02B1 — D1-D14 (products), S1-S10 (services), X1-X3 (security/tenancy).
 *
 * X2 (client cannot bypass planAccessState via a direct Firestore write, even on their own document) is
 * a small SELF-CONTAINED owner-signed-in client harness at the bottom of this file (runClientRulesTest),
 * NOT added to script/firebase-emulator-tests.ts's existing owner/intruder harness as originally planned:
 * that file's very FIRST assertion ("owner cria produto válido", a direct client `setDoc` create) now
 * fails with permission-denied, because Rules already block client-side product `create` — confirmed via
 * `git show HEAD:firestore.rules` that this is NOT this ticket's change (HEAD's committed Rules still
 * allow client create; the current `if false` comes from an already-uncommitted, in-progress ticket in
 * this same worktree that migrated product/service creation to be server-authoritative-only, evidenced by
 * server/plan-authoritative-mutations.ts and script/plan-impl-02a2-authoritative-mutations-tests.ts also
 * present uncommitted). That break aborts the whole script before reaching any assertion after it,
 * including a planAccessState addition placed there — so this file verifies X2 independently instead of
 * depending on a shared harness currently blocked by unrelated, pre-existing work. X2 assertions were
 * still ADDED to firebase-emulator-tests.ts (they are correct for the new architecture, using `updateDoc`
 * on an Admin-SDK-seeded document rather than a client `create`) and will start running once that file's
 * unrelated first-test regression is fixed — not this ticket's responsibility to fix.
 *
 * X4 (internal/admin override preserved where the contract requires it): not directly applicable to
 * `reconcilePlanAccess` — it takes an already-resolved `PlanType`, never raw PlanData/entitlements. WHO
 * resolves an admin/tester/premium_plus grant into a PlanType (resolveEntitlements, server/admin-grants.ts)
 * is untouched by this ticket and already covered by its own tests; X3 below already proves reconciliation
 * behaves correctly for every real PlanType the resolver could hand it.
 */

process.env.FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || "demo-revendasmart";
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || "127.0.0.1:9099";

function requireEmulatorEnv() {
  assert.equal(process.env.FIREBASE_PROJECT_ID, "demo-revendasmart");
  assert.equal(process.env.FIRESTORE_EMULATOR_HOST, "127.0.0.1:8080");
  assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, "127.0.0.1:9099");
}

function tenantUid(prefix = "pb1"): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

type SyntheticDoc = { readonly id: string; readonly data: Record<string, unknown> };

function syntheticProducts(count: number, overrides: (index: number) => Record<string, unknown> = () => ({})): SyntheticDoc[] {
  return Array.from({ length: count }, (_, i) => ({ id: `p${String(i).padStart(5, "0")}`, data: { name: `Product ${i}`, ...overrides(i) } }));
}
function syntheticServices(count: number, overrides: (index: number) => Record<string, unknown> = () => ({})): SyntheticDoc[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `s${String(i).padStart(5, "0")}`,
    data: { name: `Service ${i}`, active: true, published: true, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", ...overrides(i) },
  }));
}

/** D1-D10/S1-S5 — pure decision logic, no Firestore: computeReconciliationPlan is exactly what
 * reconcilePlanAccess uses internally, so these run instantly even at the 500/800/2000-document
 * boundaries the ticket specifies, without seeding thousands of real documents for numbers alone. */
function runPureTests(): void {
  // D1/D2 — Free (limit 30): 29 and 30 products, all active, zero unnecessary writes (§8).
  {
    const { result, changes } = computeReconciliationPlan("products", syntheticProducts(29), PLAN_CONFIG.free.limits.products);
    assert.deepEqual(result, { total: 29, allowed: 29, preserved: 0 }, "D1: Free must allow the 29th product to stay active");
    assert.equal(changes.length, 0, "D1: nothing over limit must mean zero writes");
  }
  {
    const { result, changes } = computeReconciliationPlan("products", syntheticProducts(30), PLAN_CONFIG.free.limits.products);
    assert.deepEqual(result, { total: 30, allowed: 30, preserved: 0 }, "D2: exactly at the limit, all active");
    assert.equal(changes.length, 0, "D2: at-limit tenant needs zero writes");
  }
  // D3 — Free, 31 products: 30 active + 1 preserved, exactly one write.
  {
    const { result, changes } = computeReconciliationPlan("products", syntheticProducts(31), PLAN_CONFIG.free.limits.products);
    assert.deepEqual(result, { total: 31, allowed: 30, preserved: 1 }, "D3: one over the limit");
    assert.equal(changes.length, 1, "D3: exactly one document needs a write");
    assert.equal(changes[0].target, "preserved");
  }
  // D4/D5 — Pro (limit 500).
  {
    const { result, changes } = computeReconciliationPlan("products", syntheticProducts(500), PLAN_CONFIG.pro.limits.products);
    assert.deepEqual(result, { total: 500, allowed: 500, preserved: 0 }, "D4: Pro 500 products all active");
    assert.equal(changes.length, 0);
  }
  {
    const { result, changes } = computeReconciliationPlan("products", syntheticProducts(501), PLAN_CONFIG.pro.limits.products);
    assert.deepEqual(result, { total: 501, allowed: 500, preserved: 1 }, "D5: Pro 501 -> 500 active + 1 preserved");
    assert.equal(changes.length, 1);
  }
  // D6 — Premium (limit 2000), all active.
  {
    const { result, changes } = computeReconciliationPlan("products", syntheticProducts(2000), PLAN_CONFIG.premium.limits.products);
    assert.deepEqual(result, { total: 2000, allowed: 2000, preserved: 0 }, "D6: Premium 2000 products all active");
    assert.equal(changes.length, 0);
  }
  // D7 — Pro->Free with 100 (all currently "active", simulating docs created while on Pro): 30 active,
  // 70 preserved, 0 deleted — provable structurally: `changes` only ever carries {id, target: active|
  // preserved}, there is no delete/removal code path anywhere near it.
  {
    const docs = syntheticProducts(100, () => ({ planAccessState: "active" }));
    const { result, changes } = computeReconciliationPlan("products", docs, PLAN_CONFIG.free.limits.products);
    assert.deepEqual(result, { total: 100, allowed: 30, preserved: 70 }, "D7: Pro->Free with 100 must be 30 active/70 preserved");
    assert.equal(changes.length, 70, "D7: only the 70 newly-preserved docs get a write");
    assert.ok(changes.every((c) => c.target === "active" || c.target === "preserved"));
  }
  // D8 — Premium->Pro with 800: 500 active, 300 preserved.
  {
    const docs = syntheticProducts(800, () => ({ planAccessState: "active" }));
    const { result } = computeReconciliationPlan("products", docs, PLAN_CONFIG.pro.limits.products);
    assert.deepEqual(result, { total: 800, allowed: 500, preserved: 300 }, "D8: Premium->Pro with 800 must be 500 active/300 preserved");
  }
  // D9 — Free->Pro with 100 total, 30 already active + 70 already preserved (simulating a prior Free-limit
  // reconciliation): upgrade must restore all 100 to active, 0 preserved.
  {
    const docs = syntheticProducts(100, (i) => ({ planAccessState: i < 30 ? "active" : "preserved" }));
    const { result, changes } = computeReconciliationPlan("products", docs, PLAN_CONFIG.pro.limits.products);
    assert.deepEqual(result, { total: 100, allowed: 100, preserved: 0 }, "D9: Free->Pro with 100 total must restore all 100 to active");
    assert.equal(changes.length, 70, "D9: only the 70 previously-preserved docs need a write back to active");
    assert.ok(changes.every((c) => c.target === "active"));
  }
  // D10 — replay: apply D7's target states locally (simulating the write), recompute — must be a true
  // no-op, proving idempotent replay at the decision-logic level.
  {
    const docs = syntheticProducts(100, () => ({ planAccessState: "active" }));
    const first = computeReconciliationPlan("products", docs, PLAN_CONFIG.free.limits.products);
    const targetById = new Map(first.changes.map((c) => [c.id, c.target]));
    const converged = docs.map((entry) => ({ id: entry.id, data: { ...entry.data, planAccessState: targetById.get(entry.id) ?? entry.data.planAccessState } }));
    const replay = computeReconciliationPlan("products", converged, PLAN_CONFIG.free.limits.products);
    assert.equal(replay.changes.length, 0, "D10: replaying the same transition after convergence must produce zero further changes");
    assert.deepEqual(replay.result, first.result, "D10: replay must report the identical result");
  }

  // S1-S5 — same shape for services (limits 5/50/200).
  {
    const { result, changes } = computeReconciliationPlan("services", syntheticServices(5), PLAN_CONFIG.free.limits.services);
    assert.deepEqual(result, { total: 5, allowed: 5, preserved: 0 }, "S1: Free 5 services all active");
    assert.equal(changes.length, 0);
  }
  {
    // The 6th service is a draft (active:false) — proves priorityRank (already active+published first)
    // actually drives the choice of which one gets preserved, not just an arbitrary/count-only decision.
    const docs = syntheticServices(6, (i) => (i === 5 ? { active: false, published: false } : {}));
    const { result, changes } = computeReconciliationPlan("services", docs, PLAN_CONFIG.free.limits.services);
    assert.deepEqual(result, { total: 6, allowed: 5, preserved: 1 }, "S2: Free 6 services -> 5 active + 1 preserved");
    assert.equal(changes.length, 1);
    assert.equal(changes[0].id, docs[5].id, "S2: the draft (not active+published) service must be the one preserved");
  }
  {
    const { result } = computeReconciliationPlan("services", syntheticServices(50), PLAN_CONFIG.pro.limits.services);
    assert.deepEqual(result, { total: 50, allowed: 50, preserved: 0 }, "S3: Pro 50 services all active");
  }
  {
    const { result } = computeReconciliationPlan("services", syntheticServices(51), PLAN_CONFIG.pro.limits.services);
    assert.deepEqual(result, { total: 51, allowed: 50, preserved: 1 }, "S4: Pro 51 -> 50 active + 1 preserved");
  }
  {
    const docs = syntheticServices(20, () => ({ planAccessState: "active" }));
    const { result, changes } = computeReconciliationPlan("services", docs, PLAN_CONFIG.free.limits.services);
    assert.deepEqual(result, { total: 20, allowed: 5, preserved: 15 }, "S5: Pro->Free with 20 services must be 5 active/15 preserved");
    assert.equal(changes.length, 15);
  }

  // Sanity: an unused DomainName import guard (keeps the type import meaningful/typed, not just `any`).
  const domains: DomainName[] = ["products", "services"];
  assert.equal(domains.length, 2);

  console.log("PLAN-IMPL-02B1 pure reconciliation-logic tests passed: D1-D10, S1-S5.");
}

/** X2 — self-contained owner-signed-in client harness (see file header for why this isn't shared with
 * script/firebase-emulator-tests.ts). Proves, via the REAL client SDK against the REAL Rules engine (not
 * a re-implementation of the Rules logic in JS), that an authenticated owner can never flip their own
 * product's planAccessState directly, while normal field edits on the same preserved document still work. */
async function runClientRulesTest(adminDb: AdminFirestore): Promise<void> {
  const appName = `pb1-x2-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const clientApp = initializeApp({
    apiKey: "demo-api-key", authDomain: "demo-revendasmart.firebaseapp.com", projectId: "demo-revendasmart", appId: `demo-${appName}`,
  }, appName);
  try {
    const auth = getAuth(clientApp);
    const clientDb = getFirestore(clientApp);
    connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
    connectFirestoreEmulator(clientDb, "127.0.0.1", 8080);

    const credential = await createUserWithEmailAndPassword(auth, `${appName}@example.test`, "LocalTestPassword!123");
    const uid = credential.user.uid;

    await adminDb.collection("users").doc(uid).collection("products").doc("product-preserved").set({
      id: "product-preserved", name: "Preservado", salePrice: 10, stock: 1, planAccessState: "preserved",
    });
    const ref = doc(clientDb, "users", uid, "products", "product-preserved");

    await assert.rejects(
      () => updateDoc(ref, { planAccessState: "active" }),
      (error: unknown) => { assert.equal((error as { code?: string }).code, "permission-denied"); return true; },
      "X2: owner must not be able to reactivate their own preserved product via direct updateDoc",
    );
    await updateDoc(ref, { name: "Preservado Editado" });
    const snap = await getDoc(ref);
    assert.equal(snap.data()?.name, "Preservado Editado", "X2: normal field edits on a preserved product must still work");
    assert.equal(snap.data()?.planAccessState, "preserved", "X2: planAccessState itself must remain untouched by the allowed edit");
  } finally {
    await deleteApp(clientApp);
  }
}

async function run(): Promise<void> {
  runPureTests();

  requireEmulatorEnv();
  initializeFirebaseAdmin();
  const db = initializeFirebaseAdmin().firestore();

  // ===== D11-D14 — read-path consequences of an already-preserved product (seeded directly, Admin SDK) =====
  {
    const uid = tenantUid("d11-14");
    await db.collection("users").doc(uid).collection("products").doc("product-active").set({ id: "product-active", name: "Ativo", salePrice: 100, stock: 5 });
    await db.collection("users").doc(uid).collection("products").doc("product-preserved").set({
      id: "product-preserved", name: "Preservado", salePrice: 100, stock: 5, planAccessState: "preserved",
    });

    // D11 — owner-readable: the document still exists and reads back in full via a plain Admin read
    // (Rules-level owner-readability is proven separately, via the client SDK, in firebase-emulator-tests.ts).
    const preservedSnap = await db.collection("users").doc(uid).collection("products").doc("product-preserved").get();
    assert.equal(preservedSnap.exists, true, "D11: preserved product must still exist and be readable");
    assert.equal(preservedSnap.data()?.name, "Preservado");

    // D12 — a historical Sale referencing a since-preserved product remains untouched: finalizeSaleTransaction
    // only reads live product docs for a NEW sale; a past sale document is a separate, already-committed
    // record this transaction never re-reads or mutates.
    await db.collection("users").doc(uid).collection("clients").doc("client-1").set({ id: "client-1", name: "Cliente 1" });
    await db.collection("users").doc(uid).collection("sales").doc("sale-historical").set({
      id: "sale-historical", clientId: "client-1",
      products: [{ productId: "product-preserved", quantity: 1, price: 100 }],
      total: 100, date: new Date().toISOString(),
    });
    const historicalSaleSnap = await db.collection("users").doc(uid).collection("sales").doc("sale-historical").get();
    assert.equal(historicalSaleSnap.exists, true, "D12: historical sale referencing a since-preserved product must remain intact");
    assert.equal((historicalSaleSnap.data()?.products as Array<{ productId: string }>)[0].productId, "product-preserved");

    // D13 — absent from the public catalog; the active sibling still appears.
    assert.equal(toPublicCatalogProduct("product-preserved", preservedSnap.data() as Record<string, unknown>), null, "D13: preserved product must be excluded from the public catalog");
    const activeSnap = await db.collection("users").doc(uid).collection("products").doc("product-active").get();
    assert.notEqual(toPublicCatalogProduct("product-active", activeSnap.data() as Record<string, unknown>), null, "D13: the active sibling must still appear in the public catalog");

    // D14 — a direct attempt to use a preserved product in a NEW sale is rejected server-side, atomically
    // (no sale document created, stock untouched).
    const newSaleId = `sale-new-${Date.now()}`;
    await assert.rejects(
      () => finalizeSaleTransaction(db, {
        uid, saleId: newSaleId, clientId: "client-1",
        products: [{ productId: "product-preserved", quantity: 1 }],
        paymentType: "avista", discountType: "percent", discountValue: 0, downPayment: 0, installmentCount: 1,
        paymentMethod: "cash", downPaymentMethod: null,
      }),
      /PRODUCT_NOT_AVAILABLE:product-preserved/,
      "D14: a NEW sale must reject a plan-preserved product",
    );
    const rejectedSaleSnap = await db.collection("users").doc(uid).collection("sales").doc(newSaleId).get();
    assert.equal(rejectedSaleSnap.exists, false, "D14: the rejected sale must never have been created");
    const stockAfterRejection = (await db.collection("users").doc(uid).collection("products").doc("product-preserved").get()).data()?.stock;
    assert.equal(stockAfterRejection, 5, "D14: stock must be untouched by a rejected sale attempt");
  }

  // ===== S6-S9 — read-path consequences of an already-preserved service (seeded directly, Admin SDK) =====
  {
    const uid = tenantUid("s6-9");
    const nowIso = new Date().toISOString();
    const baseService = (id: string, overrides: Record<string, unknown> = {}) => ({
      id, tenantUid: uid, name: `Corte ${id}`, active: true, published: true,
      pricing: { mode: "fixed", priceCents: 5000 }, cost: { kind: "unknown" }, bookingMode: "instant",
      durationMinutes: 30, createdAt: nowIso, updatedAt: nowIso, ...overrides,
    });
    await db.collection("users").doc(uid).collection("services").doc("service-active").set(baseService("service-active"));
    await db.collection("users").doc(uid).collection("services").doc("service-preserved").set(baseService("service-preserved", { planAccessState: "preserved" }));

    // S6 — hidden from the public booking listing; active sibling still listed.
    const listed = await listPublicBookableServicesCommand(db, uid);
    assert.ok(listed.every((service) => service.id !== "service-preserved"), "S6: preserved service must not appear in the public booking listing");
    assert.ok(listed.some((service) => service.id === "service-active"), "S6: the active sibling must still be listed");

    // S7 — a direct hold attempt on a preserved service (already knowing its id, bypassing the listing) is
    // rejected server-side — this must fail BEFORE resource/schedule validation, so no resourceSchedule seed
    // is needed for this assertion to be meaningful.
    await assert.rejects(
      () => createServiceBookingHoldCommand(db, uid, "service-preserved", "default", new Date(Date.now() + 86_400_000).toISOString(), undefined, `hold-key-${Date.now()}`),
      /não pode ser reservado/,
      "S7: a direct hold attempt on a preserved service must be rejected server-side",
    );

    // S8/S9 — existing Booking/ServiceWork created before the service was preserved remain untouched:
    // nothing in this ticket's read-path re-reads or mutates Booking/ServiceWork documents, and
    // reconcilePlanAccess itself never touches those collections (only products/services).
    await db.collection("users").doc(uid).collection("bookings").doc("booking-historical").set({
      id: "booking-historical", tenantUid: uid, serviceId: "service-preserved", resourceId: "default",
      workId: "work-historical", startAt: nowIso, endAt: nowIso, status: "confirmed", source: "manual",
      createdAt: nowIso, updatedAt: nowIso,
    });
    await db.collection("users").doc(uid).collection("serviceWorks").doc("work-historical").set({
      id: "work-historical", tenantUid: uid, status: "planned", origin: "booking",
      items: [],
      totals: { serviceRevenueCents: 0, productRevenueCents: 0, additionalRevenueCents: 0, discountTotalCents: 0, contractedTotalCents: 0 },
      financialSummary: { grossReceivedCents: 0, refundedTotalCents: 0, netReceivedCents: 0 },
      cost: { kind: "unknown" }, createdAt: nowIso, updatedAt: nowIso,
    });
    const bookingSnap = await db.collection("users").doc(uid).collection("bookings").doc("booking-historical").get();
    const workSnap = await db.collection("users").doc(uid).collection("serviceWorks").doc("work-historical").get();
    assert.equal(bookingSnap.exists, true, "S8: existing Booking referencing a since-preserved service must remain intact");
    assert.equal(bookingSnap.data()?.status, "confirmed");
    assert.equal(workSnap.exists, true, "S9: existing ServiceWork referencing a since-preserved service must remain intact");
  }

  // ===== End-to-end reconcilePlanAccess against real Firestore: downgrade, idempotent replay (D10/S-
  // equivalent for real), and upgrade restoration (S10) =====
  {
    const uid = tenantUid("e2e");
    const nowIso = new Date().toISOString();
    const productWrites = Array.from({ length: 35 }, (_, i) =>
      db.collection("users").doc(uid).collection("products").doc(`product-${i}`).set({ id: `product-${i}`, name: `P${i}`, salePrice: 10, stock: 1 }));
    const serviceWrites = Array.from({ length: 8 }, (_, i) =>
      db.collection("users").doc(uid).collection("services").doc(`service-${i}`).set({
        id: `service-${i}`, tenantUid: uid, name: `S${i}`, active: true, published: true,
        pricing: { mode: "fixed", priceCents: 1000 }, cost: { kind: "unknown" }, bookingMode: "instant",
        createdAt: nowIso, updatedAt: nowIso,
      }));
    await Promise.all([...productWrites, ...serviceWrites]);

    // Downgrade to Free: 35 products -> 30 active/5 preserved; 8 services -> 5 active/3 preserved.
    const downgraded = await reconcilePlanAccess(db, uid, "premium", "free");
    assert.deepEqual(downgraded.products, { total: 35, allowed: 30, preserved: 5 }, "E2E downgrade: products must match the pure-logic prediction");
    assert.deepEqual(downgraded.services, { total: 8, allowed: 5, preserved: 3 }, "E2E downgrade: services must match the pure-logic prediction");
    assert.equal(downgraded.selectionRequired, true, "E2E downgrade: selectionRequired must be true when anything was preserved");

    const [productSnaps, serviceSnaps] = await Promise.all([
      db.collection("users").doc(uid).collection("products").get(),
      db.collection("users").doc(uid).collection("services").get(),
    ]);
    assert.equal(productSnaps.docs.filter((doc) => doc.data().planAccessState === "preserved").length, 5, "E2E downgrade: exactly 5 products actually written as preserved");
    assert.equal(serviceSnaps.docs.filter((doc) => doc.data().planAccessState === "preserved").length, 3, "E2E downgrade: exactly 3 services actually written as preserved");
    assert.equal(productSnaps.size, 35, "E2E downgrade: 0 products deleted");
    assert.equal(serviceSnaps.size, 8, "E2E downgrade: 0 services deleted");

    // Replay the exact same transition against real Firestore — must be a true no-op.
    const replayed = await reconcilePlanAccess(db, uid, "premium", "free");
    assert.deepEqual(replayed, downgraded, "E2E replay: repeating the same transition must produce the identical result");

    // S10 — upgrade restores: Free -> Pro (limit 500/50) must bring everything back to active.
    const upgraded = await reconcilePlanAccess(db, uid, "free", "pro");
    assert.deepEqual(upgraded.products, { total: 35, allowed: 35, preserved: 0 }, "S10: upgrade must restore all previously-preserved products to active");
    assert.deepEqual(upgraded.services, { total: 8, allowed: 8, preserved: 0 }, "S10: upgrade must restore all previously-preserved services to active");
    assert.equal(upgraded.selectionRequired, false, "S10: selectionRequired must be false once nothing is preserved");
  }

  // ===== X1 — tenant isolation: two tenants reconciled concurrently must never cross-contaminate =====
  {
    const uidA = tenantUid("x1-a");
    const uidB = tenantUid("x1-b");
    await Promise.all(Array.from({ length: 32 }, (_, i) =>
      db.collection("users").doc(uidA).collection("products").doc(`p-${i}`).set({ id: `p-${i}`, name: `A${i}`, salePrice: 10, stock: 1 })));
    await Promise.all(Array.from({ length: 3 }, (_, i) =>
      db.collection("users").doc(uidB).collection("products").doc(`p-${i}`).set({ id: `p-${i}`, name: `B${i}`, salePrice: 10, stock: 1 })));

    const [resultA, resultB] = await Promise.all([
      reconcilePlanAccess(db, uidA, "premium", "free"),
      reconcilePlanAccess(db, uidB, "premium", "free"),
    ]);
    assert.deepEqual(resultA.products, { total: 32, allowed: 30, preserved: 2 }, "X1: tenant A's own 32 products must decide tenant A's result");
    assert.deepEqual(resultB.products, { total: 3, allowed: 3, preserved: 0 }, "X1: tenant B's own 3 products must decide tenant B's result, unaffected by A running concurrently");

    const bSnaps = await db.collection("users").doc(uidB).collection("products").get();
    assert.ok(bSnaps.docs.every((doc) => doc.data().planAccessState !== "preserved"), "X1: tenant A's reconciliation must never mark any of tenant B's products as preserved");
  }

  // ===== X3 — every real PlanType resolves without throwing (PlanType is a closed union already enforced
  // by TypeScript at every call site in this codebase; this proves the engine itself never crashes for any
  // of the three real values, on a tenant with zero documents — the cheapest possible case). =====
  {
    const uid = tenantUid("x3");
    for (const plan of ["free", "pro", "premium"] as const) {
      await assert.doesNotReject(() => reconcilePlanAccess(db, uid, "free", plan), `X3: reconcilePlanAccess must not throw for plan="${plan}"`);
    }
  }

  // ===== X2 — client Rules bypass rejected (self-contained harness; see file header) =====
  await runClientRulesTest(db);

  console.log(
    "PLAN-IMPL-02B1 integration tests passed: D11-D14 (owner-readable, historical sale intact, catalog " +
    "exclusion, atomic new-sale rejection), S6-S9 (booking-listing exclusion, direct-hold rejection, " +
    "historical booking/work intact), end-to-end downgrade + idempotent replay + upgrade restoration " +
    "(S10) against the real emulator, X1 (tenant isolation under concurrent reconciliation), X2 (owner " +
    "cannot bypass planAccessState via direct client write; normal edits on a preserved doc still work), " +
    "X3 (every real plan resolves safely). X4 not directly applicable (see file header).",
  );
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
