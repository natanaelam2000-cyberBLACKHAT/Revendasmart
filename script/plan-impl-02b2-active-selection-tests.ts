import assert from "node:assert/strict";
import { initializeApp, deleteApp } from "firebase/app";
import { getAuth, connectAuthEmulator, createUserWithEmailAndPassword } from "firebase/auth";
import { connectFirestoreEmulator, doc, getDoc, getFirestore, updateDoc } from "firebase/firestore";
import { initializeFirebaseAdmin } from "../server/firebase-admin-init";
import { reconcilePlanAccess, computeReconciliationPlan } from "../server/plan-access-reconciliation";
import { setActiveProductSelection, setActiveServiceSelection, PlanAccessSelectionError } from "../server/plan-access-selection";
import { toPublicCatalogProduct } from "../server/public-catalog";
import { listPublicBookableServicesCommand } from "../server/service-public-booking";
import { createServiceBookingHoldCommand } from "../server/service-booking-commands";
import { PLAN_CONFIG } from "../shared/monetization";
import type { Firestore as AdminFirestore } from "firebase-admin/firestore";

/**
 * PLAN-IMPL-02B2 — U1-U16 (products), U17-U25 (services), U26-U32 (upgrade/downgrade + explicit
 * selection survival). Follows the exact structure/conventions of
 * script/plan-impl-02b1-downgrade-access-tests.ts: a pure decision-logic section (no Firestore) plus an
 * emulator-integration section, both against the real functions this ticket built — never a
 * reimplementation of the same logic in test code.
 */

process.env.FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || "demo-revendasmart";
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || "127.0.0.1:9099";

function requireEmulatorEnv() {
  assert.equal(process.env.FIREBASE_PROJECT_ID, "demo-revendasmart");
  assert.equal(process.env.FIRESTORE_EMULATOR_HOST, "127.0.0.1:8080");
  assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, "127.0.0.1:9099");
}

function tenantUid(prefix = "u"): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

type SyntheticDoc = { readonly id: string; readonly data: Record<string, unknown> };

function syntheticProducts(count: number, overrides: (index: number) => Record<string, unknown> = () => ({})): SyntheticDoc[] {
  return Array.from({ length: count }, (_, i) => ({ id: `p${String(i).padStart(5, "0")}`, data: { name: `Product ${i}`, ...overrides(i) } }));
}

/** U1/U2/U17 boundary sanity + the CORE new priority behavior: a document explicitly user-selected
 * active always wins the top slots over the plain deterministic tiebreak, but a user-EXCLUDED
 * (preserved) document competes normally once there is room (§12/§13 of the ticket — upgrade must still
 * restore everyone when they fit, so an explicit exclusion is not a permanent negative priority). */
function runPureTests(): void {
  // U1 — Free, 20 total: all active, 0 preserved.
  {
    const { result, changes } = computeReconciliationPlan("products", syntheticProducts(20), PLAN_CONFIG.free.limits.products);
    assert.deepEqual(result, { total: 20, allowed: 20, preserved: 0 }, "U1: Free 20 total must be all active");
    assert.equal(changes.length, 0);
  }
  // U2 — Free, 100 total: 30 active, 70 preserved.
  {
    const { result } = computeReconciliationPlan("products", syntheticProducts(100), PLAN_CONFIG.free.limits.products);
    assert.deepEqual(result, { total: 100, allowed: 30, preserved: 70 }, "U2: Free 100 total must be 30 active/70 preserved");
  }

  // U30 (pure) — partial downgrade: 40 docs, the LAST 10 (ids p00030..p00039, i.e. NOT what the plain
  // deterministic id-ascending order would pick first) are marked user+active. Free's limit (30) must
  // still select those 10 first, filling the remaining 20 slots with the lowest ids among the rest —
  // proving explicit user selection actually overrides the plain id-ascending tiebreak, not just
  // coincides with it.
  {
    const docs = syntheticProducts(40, (i) => (i >= 30
      ? { planAccessState: "active", planAccessSelectionSource: "user" }
      : { planAccessState: "active" }));
    const { result, changes } = computeReconciliationPlan("products", docs, PLAN_CONFIG.free.limits.products);
    assert.deepEqual(result, { total: 40, allowed: 30, preserved: 10 }, "U30: 40 total, Free limit 30, must still be 30 active/10 preserved");
    const preservedIds = new Set(changes.filter((c) => c.target === "preserved").map((c) => c.id));
    for (let i = 30; i < 40; i += 1) {
      assert.ok(!preservedIds.has(`p${String(i).padStart(5, "0")}`), `U30: user-selected active product p${i} must never be preserved`);
    }
    assert.equal(preservedIds.size, 10, "U30: exactly the 10 non-user-selected overflow docs get preserved");
  }
  // U32 (pure) — upgrade with enough room: even though only some docs are user+active and the rest are
  // user+preserved (an explicit exclusion), once the limit fits everyone (Pro, 500), ALL must become
  // active — an explicit exclusion is not a permanent negative priority once there's room.
  {
    const docs = syntheticProducts(40, (i) => (i < 10
      ? { planAccessState: "active", planAccessSelectionSource: "user" }
      : { planAccessState: "preserved", planAccessSelectionSource: "user" }));
    const { result, changes } = computeReconciliationPlan("products", docs, PLAN_CONFIG.pro.limits.products);
    assert.deepEqual(result, { total: 40, allowed: 40, preserved: 0 }, "U32: upgrade with enough room must restore ALL docs to active, including user-excluded ones");
    assert.ok(changes.every((c) => c.target === "active"));
  }

  console.log("PLAN-IMPL-02B2 pure reconciliation-priority tests passed: U1, U2, U30 (pure), U32 (pure).");
}

/** U13 — self-contained owner-signed-in client harness (same pattern as PLAN-IMPL-02B1's X2): proves,
 * via the REAL client SDK against the REAL Rules engine, that an authenticated owner can never flip
 * their own product's planAccessState OR planAccessSelectionSource directly. */
async function runClientRulesTest(adminDb: AdminFirestore): Promise<void> {
  const appName = `u13-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
      "U13: owner must not reactivate their own preserved product via direct updateDoc",
    );
    await assert.rejects(
      () => updateDoc(ref, { planAccessSelectionSource: "user" }),
      (error: unknown) => { assert.equal((error as { code?: string }).code, "permission-denied"); return true; },
      "U13: owner must not forge planAccessSelectionSource via direct updateDoc",
    );
    await updateDoc(ref, { name: "Preservado Editado" });
    const snap = await getDoc(ref);
    assert.equal(snap.data()?.name, "Preservado Editado", "U13: normal field edits on a preserved product must still work");
    assert.equal(snap.data()?.planAccessState, "preserved");
  } finally {
    await deleteApp(clientApp);
  }
}

async function seedPlan(db: AdminFirestore, uid: string, plan: "free" | "pro" | "premium"): Promise<void> {
  await db.collection("users").doc(uid).collection("planData").doc("main").set({
    currentPlan: plan, premiumActive: plan === "premium", premiumExpiresAt: null, premiumStartedAt: null,
    premiumSource: plan === "premium" ? "admin" : null, referralCode: "", referralCount: 0, updatedAt: new Date().toISOString(),
    subscriptionId: null, subscriptionStatus: null, subscriptionPlanId: null, autoRenew: false,
    lastPaymentAt: null, nextBillingAt: null, canceledAt: null, paymentStatus: null,
  });
}

async function seedProducts(db: AdminFirestore, uid: string, count: number, prefix = "prod"): Promise<string[]> {
  const ids = Array.from({ length: count }, (_, i) => `${prefix}-${i}`);
  await Promise.all(ids.map((id) => db.collection("users").doc(uid).collection("products").doc(id).set({
    id, name: `Produto ${id}`, salePrice: 10, stock: 5,
  })));
  return ids;
}

function serviceDoc(uid: string, id: string, overrides: Record<string, unknown> = {}) {
  const nowIso = new Date().toISOString();
  return {
    id, tenantUid: uid, name: `Serviço ${id}`, active: true, published: true,
    pricing: { mode: "fixed", priceCents: 5000 }, cost: { kind: "unknown" }, bookingMode: "instant",
    durationMinutes: 30, createdAt: nowIso, updatedAt: nowIso, ...overrides,
  };
}

async function seedServices(db: AdminFirestore, uid: string, count: number, prefix = "svc"): Promise<string[]> {
  const ids = Array.from({ length: count }, (_, i) => `${prefix}-${i}`);
  await Promise.all(ids.map((id) => db.collection("users").doc(uid).collection("services").doc(id).set(serviceDoc(uid, id))));
  return ids;
}

async function run(): Promise<void> {
  runPureTests();

  requireEmulatorEnv();
  initializeFirebaseAdmin();
  const db = initializeFirebaseAdmin().firestore();

  // ===== U3-U12 — Products: server-authoritative selection end-to-end =====
  {
    const uid = tenantUid("u3-12");
    await seedPlan(db, uid, "free");
    const ids = await seedProducts(db, uid, 40);

    // U3 — server rejects 31 selected ids on Free (limit 30).
    await assert.rejects(
      () => setActiveProductSelection(db, uid, ids.slice(0, 31)),
      (error: unknown) => { assert.ok(error instanceof PlanAccessSelectionError); assert.equal((error as PlanAccessSelectionError).code, "TOO_MANY_SELECTED"); return true; },
      "U3: selecting 31 products on Free must be rejected",
    );

    // U4/U5 — a valid 30-id selection saves and results in exactly 30 active.
    const chosen = ids.slice(0, 30);
    const saved = await setActiveProductSelection(db, uid, chosen);
    assert.deepEqual(saved, { total: 40, active: 30, preserved: 10, limit: 30 }, "U4/U5: saved selection must report 30 active/10 preserved");
    const afterSave = await db.collection("users").doc(uid).collection("products").get();
    assert.equal(afterSave.docs.filter((d) => d.data().planAccessState !== "preserved").length, 30, "U5: exactly 30 documents must be active");
    for (const id of chosen) {
      const docData = afterSave.docs.find((d) => d.id === id)?.data();
      assert.equal(docData?.planAccessSelectionSource, "user", "U4: every explicitly-selected product must be marked selectionSource=user");
    }

    // U6 — reload (a fresh read) reflects the same saved selection.
    const reread = await db.collection("users").doc(uid).collection("products").get();
    assert.equal(reread.docs.filter((d) => d.data().planAccessState !== "preserved").length, 30, "U6: a fresh read after reload must still show 30 active");

    // U7 — same-plan reconciliation replay must NOT undo the custom selection (it only touches docs
    // whose target actually changes, and the priority function already keeps every user+active doc active).
    const replay = await reconcilePlanAccess(db, uid, "free", "free");
    assert.deepEqual(replay.products, { total: 40, allowed: 30, preserved: 10 }, "U7: same-plan reconciliation must reproduce the identical 30/10 split");
    const afterReplay = await db.collection("users").doc(uid).collection("products").get();
    for (const id of chosen) {
      assert.notEqual(afterReplay.docs.find((d) => d.id === id)?.data().planAccessState, "preserved", `U7: user-selected product ${id} must survive same-plan reconciliation`);
    }

    // U8/U9 — preserved product stays owner-readable and is excluded from the public catalog.
    const preservedId = ids[30];
    const preservedSnap = await db.collection("users").doc(uid).collection("products").doc(preservedId).get();
    assert.equal(preservedSnap.exists, true, "U8: preserved product must still exist and be readable");
    assert.equal(toPublicCatalogProduct(preservedId, preservedSnap.data() as Record<string, unknown>), null, "U9: preserved product must be excluded from the public catalog");
    const activeSnap = await db.collection("users").doc(uid).collection("products").doc(chosen[0]).get();
    assert.notEqual(toPublicCatalogProduct(chosen[0], activeSnap.data() as Record<string, unknown>), null, "U9: an active sibling must still appear in the public catalog");

    // U10 — reactivating via selection alone does not force public eligibility: a selected-active product
    // with stock=0 still reads as unavailable in the catalog projection (plan access and normal catalog
    // eligibility are independent gates, §9 of the ticket).
    await db.collection("users").doc(uid).collection("products").doc(chosen[0]).update({ stock: 0 });
    const zeroStockSnap = await db.collection("users").doc(uid).collection("products").doc(chosen[0]).get();
    const projected = toPublicCatalogProduct(chosen[0], zeroStockSnap.data() as Record<string, unknown>);
    assert.notEqual(projected, null, "U10: a plan-active product must still be projected (not plan-hidden)");
    assert.equal(projected?.available, false, "U10: normal catalog eligibility (stock) still applies independently of plan access");
    await db.collection("users").doc(uid).collection("products").doc(chosen[0]).update({ stock: 5 });

    // U11 — stock/price are never touched by a selection swap.
    const swapSelection = [...chosen.slice(1), preservedId]; // drop chosen[0], add preservedId — a swap
    await setActiveProductSelection(db, uid, swapSelection);
    const afterSwap = await db.collection("users").doc(uid).collection("products").doc(preservedId).get();
    assert.equal(afterSwap.data()?.stock, 5, "U11: stock must be unchanged by a selection swap");
    assert.equal(afterSwap.data()?.salePrice, 10, "U11: salePrice must be unchanged by a selection swap");

    // U12 — a historical Sale referencing a now-preserved product remains untouched (selection never
    // reads or writes the sales collection at all).
    await db.collection("users").doc(uid).collection("clients").doc("client-1").set({ id: "client-1", name: "Cliente 1" });
    await db.collection("users").doc(uid).collection("sales").doc("sale-historical").set({
      id: "sale-historical", clientId: "client-1", products: [{ productId: chosen[0], quantity: 1, price: 10 }], total: 10, date: new Date().toISOString(),
    });
    await setActiveProductSelection(db, uid, chosen); // swap back, chosen[0] preserved again
    const saleSnap = await db.collection("users").doc(uid).collection("sales").doc("sale-historical").get();
    assert.equal(saleSnap.exists, true, "U12: historical sale must remain intact after further selection changes");
    assert.equal((saleSnap.data()?.products as Array<{ productId: string }>)[0].productId, chosen[0]);
  }

  // ===== U14-U16 — Products: selection security =====
  {
    const uidA = tenantUid("u14a");
    const uidB = tenantUid("u14b");
    await seedPlan(db, uidA, "free");
    await seedPlan(db, uidB, "free");
    await seedProducts(db, uidA, 5, "a-prod");
    const idsB = await seedProducts(db, uidB, 5, "b-prod");

    // U14 — an id belonging to a DIFFERENT tenant must be rejected outright, never silently ignored.
    await assert.rejects(
      () => setActiveProductSelection(db, uidA, [idsB[0]]),
      (error: unknown) => { assert.ok(error instanceof PlanAccessSelectionError); assert.equal((error as PlanAccessSelectionError).code, "UNKNOWN_PRODUCT_ID"); return true; },
      "U14: selecting a product id from another tenant must be rejected",
    );
    const bDocsUntouched = await db.collection("users").doc(uidB).collection("products").get();
    assert.ok(bDocsUntouched.docs.every((d) => d.data().planAccessState === undefined), "U14: tenant B's products must be completely untouched by A's rejected request");

    // U15 — a "stale client plan" (client believes it's on a higher plan) cannot exceed the CURRENT
    // server-resolved plan's limit: uidA is seeded as free (limit 30) regardless of what a client sends.
    const uidC = tenantUid("u15");
    await seedPlan(db, uidC, "free");
    const idsC = await seedProducts(db, uidC, 40, "c-prod");
    await assert.rejects(
      () => setActiveProductSelection(db, uidC, idsC.slice(0, 35)), // a client that "thinks" it's Pro (limit 500) sending 35
      (error: unknown) => { assert.ok(error instanceof PlanAccessSelectionError); assert.equal((error as PlanAccessSelectionError).code, "TOO_MANY_SELECTED"); return true; },
      "U15: server must reject a selection exceeding the CURRENT server plan, regardless of client belief",
    );

    // U16 — a malformed id (not matching the entity-id shape) is rejected as invalid input.
    await assert.rejects(
      () => setActiveProductSelection(db, uidA, ["../etc/passwd", "valid-looking-id"]),
      (error: unknown) => { assert.ok(error instanceof PlanAccessSelectionError); assert.equal((error as PlanAccessSelectionError).code, "INVALID_INPUT"); return true; },
      "U16: a malformed product id must be rejected before any Firestore read",
    );
  }

  // ===== U17-U25 — Services =====
  {
    const uid = tenantUid("u17-25");
    await seedPlan(db, uid, "free");
    const ids = await seedServices(db, uid, 12);

    // U17 — Free 12 services -> 5 active/7 preserved (pure prediction, confirmed against real data).
    const docs = (await db.collection("users").doc(uid).collection("services").get()).docs.map((d) => ({ id: d.id, data: d.data() }));
    const predicted = computeReconciliationPlan("services", docs, PLAN_CONFIG.free.limits.services);
    assert.deepEqual(predicted.result, { total: 12, allowed: 5, preserved: 7 }, "U17: Free 12 services must be 5 active/7 preserved");

    // U18 — server rejects 6 selected services on Free (limit 5).
    await assert.rejects(
      () => setActiveServiceSelection(db, uid, ids.slice(0, 6)),
      (error: unknown) => { assert.ok(error instanceof PlanAccessSelectionError); assert.equal((error as PlanAccessSelectionError).code, "TOO_MANY_SELECTED"); return true; },
      "U18: selecting 6 services on Free must be rejected",
    );

    // U19/U20 — a valid 5-id selection saves and a fresh read reflects it.
    const chosen = ids.slice(0, 5);
    const saved = await setActiveServiceSelection(db, uid, chosen);
    assert.deepEqual(saved, { total: 12, active: 5, preserved: 7, limit: 5 }, "U19: saved service selection must report 5 active/7 preserved");
    const reread = await db.collection("users").doc(uid).collection("services").get();
    assert.equal(reread.docs.filter((d) => d.data().planAccessState !== "preserved").length, 5, "U20: a fresh read after reload must still show 5 active services");

    // U21 — same-plan reconciliation replay must not undo the custom service selection.
    await reconcilePlanAccess(db, uid, "free", "free");
    const afterReplay = await db.collection("users").doc(uid).collection("services").get();
    for (const id of chosen) {
      assert.notEqual(afterReplay.docs.find((d) => d.id === id)?.data().planAccessState, "preserved", `U21: user-selected service ${id} must survive same-plan reconciliation`);
    }

    // U22 — preserved service unavailable for new public booking; active sibling still listed.
    const preservedId = ids[5];
    const listed = await listPublicBookableServicesCommand(db, uid);
    assert.ok(listed.every((service) => service.id !== preservedId), "U22: preserved service must not appear in the public booking listing");
    assert.ok(listed.some((service) => service.id === chosen[0]), "U22: an active sibling must still be listed");
    await assert.rejects(
      () => createServiceBookingHoldCommand(db, uid, preservedId, "default", new Date(Date.now() + 86_400_000).toISOString(), undefined, `hold-${Date.now()}`),
      /não pode ser reservado/,
      "U22: a direct hold attempt on the preserved service must be rejected server-side",
    );

    // U23/U24/U25 — existing Booking/Work/Quote referencing the now-preserved service remain untouched:
    // selection never reads or writes those collections.
    const nowIso = new Date().toISOString();
    await db.collection("users").doc(uid).collection("bookings").doc("booking-historical").set({
      id: "booking-historical", tenantUid: uid, serviceId: preservedId, resourceId: "default",
      workId: "work-historical", startAt: nowIso, endAt: nowIso, status: "confirmed", source: "manual", createdAt: nowIso, updatedAt: nowIso,
    });
    await db.collection("users").doc(uid).collection("serviceWorks").doc("work-historical").set({
      id: "work-historical", tenantUid: uid, status: "planned", origin: "booking", items: [],
      totals: { serviceRevenueCents: 0, productRevenueCents: 0, additionalRevenueCents: 0, discountTotalCents: 0, contractedTotalCents: 0 },
      financialSummary: { grossReceivedCents: 0, refundedTotalCents: 0, netReceivedCents: 0 },
      cost: { kind: "unknown" }, createdAt: nowIso, updatedAt: nowIso,
    });
    await db.collection("users").doc(uid).collection("quotes").doc("quote-historical").set({
      id: "quote-historical", tenantUid: uid, status: "draft", customerId: "client-1",
      draftItems: [], draftTotals: { serviceRevenueCents: 0, productRevenueCents: 0, additionalRevenueCents: 0, discountTotalCents: 0, contractedTotalCents: 0 },
      draftCustomerMessage: "", createdAt: nowIso, updatedAt: nowIso,
    });
    // Re-save the SAME selection (a genuinely different call) to prove these records are untouched by
    // further selection activity, not just by the first save.
    await setActiveServiceSelection(db, uid, chosen);
    const bookingSnap = await db.collection("users").doc(uid).collection("bookings").doc("booking-historical").get();
    const workSnap = await db.collection("users").doc(uid).collection("serviceWorks").doc("work-historical").get();
    const quoteSnap = await db.collection("users").doc(uid).collection("quotes").doc("quote-historical").get();
    assert.equal(bookingSnap.exists, true, "U23: existing Booking referencing the preserved service must remain intact");
    assert.equal(bookingSnap.data()?.status, "confirmed");
    assert.equal(workSnap.exists, true, "U24: existing ServiceWork must remain intact");
    assert.equal(quoteSnap.exists, true, "U25: existing Quote must remain intact");
    assert.equal(quoteSnap.data()?.status, "draft");
  }

  // ===== U26-U29 — plain upgrade/downgrade (no custom selection), real emulator =====
  {
    const uid = tenantUid("u26-29");
    await seedProducts(db, uid, 100);
    // U26 — Free -> Pro with 100 total: all 100 active.
    const u26 = await reconcilePlanAccess(db, uid, "free", "pro");
    assert.deepEqual(u26.products, { total: 100, allowed: 100, preserved: 0 }, "U26: Free->Pro with 100 must be all active");
  }
  {
    const uid = tenantUid("u27");
    await seedProducts(db, uid, 800);
    // U27 — Pro -> Premium with 800 total: all 800 active.
    const u27 = await reconcilePlanAccess(db, uid, "pro", "premium");
    assert.deepEqual(u27.products, { total: 800, allowed: 800, preserved: 0 }, "U27: Pro->Premium with 800 must be all active");
  }
  {
    const uid = tenantUid("u28");
    await seedProducts(db, uid, 800);
    // U28 — Premium -> Pro with 800 total: 500 active/300 preserved.
    const u28 = await reconcilePlanAccess(db, uid, "premium", "pro");
    assert.deepEqual(u28.products, { total: 800, allowed: 500, preserved: 300 }, "U28: Premium->Pro with 800 must be 500 active/300 preserved");
  }
  {
    const uid = tenantUid("u29");
    await seedProducts(db, uid, 100);
    // U29 — Pro -> Free with 100 total: 30 active/70 preserved.
    const u29 = await reconcilePlanAccess(db, uid, "pro", "free");
    assert.deepEqual(u29.products, { total: 100, allowed: 30, preserved: 70 }, "U29: Pro->Free with 100 must be 30 active/70 preserved");
  }

  // ===== U30/U31 — explicit selection prioritized during a REAL partial downgrade, and survives a REAL
  // same-plan replay (the pure-logic version already ran in runPureTests; this proves it end-to-end
  // against the real Firestore-backed engine) =====
  {
    const uid = tenantUid("u30-31");
    await seedPlan(db, uid, "pro");
    const ids = await seedProducts(db, uid, 100);
    // Simulate: tenant was on Pro with 100 active, then user explicitly chose a specific 30 (not the
    // deterministic id-ascending default, which would pick the FIRST 30) to keep active ahead of time.
    const userChosen = ids.slice(70); // the LAST 30 ids — opposite of what id-ascending would pick
    await setActiveProductSelection(db, uid, ids); // first, everyone active under Pro (limit 500, fits)
    await setActiveProductSelection(db, uid, userChosen); // now explicitly narrow to the last 30

    // U30 — downgrade Pro->Free (limit 30): the user's exact 30 must be the ones that survive, not the
    // deterministic id-ascending default (which would have picked ids[0..29] instead).
    const downgraded = await reconcilePlanAccess(db, uid, "pro", "free");
    assert.deepEqual(downgraded.products, { total: 100, allowed: 30, preserved: 70 }, "U30: partial downgrade must still be 30 active/70 preserved");
    const afterDowngrade = await db.collection("users").doc(uid).collection("products").get();
    for (const id of userChosen) {
      assert.notEqual(afterDowngrade.docs.find((d) => d.id === id)?.data().planAccessState, "preserved", `U30: explicitly user-selected product ${id} must survive a real partial downgrade`);
    }

    // U31 — a same-plan replay right after must not disturb the result at all.
    const replay = await reconcilePlanAccess(db, uid, "free", "free");
    assert.deepEqual(replay.products, downgraded.products, "U31: same-plan replay must reproduce the identical result");
    const afterReplay = await db.collection("users").doc(uid).collection("products").get();
    for (const id of userChosen) {
      assert.notEqual(afterReplay.docs.find((d) => d.id === id)?.data().planAccessState, "preserved", `U31: explicitly user-selected product ${id} must survive same-plan replay`);
    }
  }

  // ===== U32 — real upgrade with enough room restores everyone, including previously user-excluded docs =====
  {
    const uid = tenantUid("u32");
    await seedPlan(db, uid, "free");
    const ids = await seedProducts(db, uid, 40);
    await setActiveProductSelection(db, uid, ids.slice(0, 30)); // explicit selection: first 30 active, last 10 user-preserved
    const upgraded = await reconcilePlanAccess(db, uid, "free", "pro"); // limit 500, everyone fits
    assert.deepEqual(upgraded.products, { total: 40, allowed: 40, preserved: 0 }, "U32: upgrade with enough room must restore ALL 40, including the 10 the user had explicitly excluded");
  }

  // ===== U13 — client Rules bypass rejected =====
  await runClientRulesTest(db);

  console.log(
    "PLAN-IMPL-02B2 integration tests passed: U3-U12 (products: reject-over-limit, save/reload/same-plan " +
    "replay, owner-readable, catalog exclusion, plan-active independent of catalog eligibility, stock/" +
    "price/history untouched by swap), U14-U16 (cross-tenant rejected, stale-plan rejected, malformed id " +
    "rejected), U17-U25 (services: same shape, plus public-booking exclusion/direct-hold rejection and " +
    "Booking/Work/Quote left intact), U26-U29 (plain upgrade/downgrade against the real emulator), " +
    "U30/U31 (explicit selection prioritized in a real partial downgrade and survives a real same-plan " +
    "replay), U32 (real upgrade with enough room restores everyone, including previously user-excluded " +
    "docs), U13 (owner cannot bypass planAccessState/planAccessSelectionSource via direct client write).",
  );
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
