import assert from "node:assert/strict";
import { initializeApp, deleteApp, type FirebaseApp } from "firebase/app";
import { connectAuthEmulator, createUserWithEmailAndPassword, getAuth, type Auth } from "firebase/auth";
import { connectFirestoreEmulator, doc, getFirestore, setDoc, type Firestore } from "firebase/firestore";
import { deleteApp as deleteAdminApp, initializeApp as initializeAdminApp, type App as AdminApp } from "firebase-admin/app";
import { getFirestore as getAdminFirestore } from "firebase-admin/firestore";
import { initializeFirebaseAdmin } from "../server/firebase-admin-init";
import {
  createProductCommand,
  createServiceCommand,
  deleteProductCommand,
  PlanMutationError,
} from "../server/plan-authoritative-mutations";

const PROJECT_ID = "demo-revendasmart";
const NOW = "2026-09-01T00:00:00.000Z";

type ClientContext = { app: FirebaseApp; auth: Auth; db: Firestore; uid?: string };

function requireLocalEmulators() {
  assert.equal(process.env.FIRESTORE_EMULATOR_HOST, "127.0.0.1:8080");
  assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, "127.0.0.1:9099");
  assert.notEqual(process.env.GOOGLE_CLOUD_PROJECT, "revenda-smart");
}

function createClientContext(label: string): ClientContext {
  const app = initializeApp(
    {
      apiKey: "demo-api-key",
      authDomain: `${PROJECT_ID}.firebaseapp.com`,
      projectId: PROJECT_ID,
      appId: `plan-impl-02a2-${label}`,
    },
    `plan-impl-02a2-${label}-${Date.now()}-${Math.random()}`,
  );
  const auth = getAuth(app);
  const db = getFirestore(app);
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  return { app, auth, db };
}

async function signIn(context: ClientContext, label: string) {
  const credential = await createUserWithEmailAndPassword(
    context.auth,
    `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`,
    "LocalTestPassword!123",
  );
  context.uid = credential.user.uid;
  return credential.user.uid;
}

function validProduct(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    name: `Produto ${id}`,
    brand: "Marca Local",
    origin: "Brasil",
    category: "Teste",
    productType: "Geral",
    costPrice: 10,
    salePrice: 25,
    stock: 3,
    barcode: "",
    description: "Fixture PLAN-IMPL-02A2",
    imageUrl: "",
    storagePath: "",
    extras: {},
    gender: "unisex",
    isFeatured: false,
    isOnSale: false,
    discountPercent: 0,
    ...overrides,
  };
}

function validService(id: string, uid: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    tenantUid: uid,
    name: `Serviço ${id}`,
    active: true,
    published: true,
    pricing: { mode: "fixed", priceCents: 5000 },
    cost: { kind: "unknown" },
    bookingMode: "instant",
    durationMinutes: 60,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

async function seedPlan(db: FirebaseFirestore.Firestore, uid: string, plan: "free" | "pro" | "premium") {
  await db.collection("users").doc(uid).collection("planData").doc("main").set({
    currentPlan: plan,
    premiumActive: plan === "premium",
    premiumExpiresAt: null,
    premiumStartedAt: null,
    premiumSource: plan === "premium" ? "admin" : null,
    referralCode: "",
    referralCount: 0,
    updatedAt: NOW,
    subscriptionId: null,
    subscriptionStatus: null,
    subscriptionPlanId: null,
    autoRenew: false,
    lastPaymentAt: null,
    nextBillingAt: null,
    canceledAt: null,
    paymentStatus: null,
  });
}

async function seedProducts(db: FirebaseFirestore.Firestore, uid: string, count: number) {
  const batch = db.batch();
  for (let i = 0; i < count; i += 1) {
    const id = `seed-product-${i}`;
    batch.set(db.collection("users").doc(uid).collection("products").doc(id), validProduct(id));
  }
  await batch.commit();
}

async function seedServices(db: FirebaseFirestore.Firestore, uid: string, count: number) {
  const batch = db.batch();
  for (let i = 0; i < count; i += 1) {
    const id = `seed-service-${i}`;
    batch.set(db.collection("users").doc(uid).collection("services").doc(id), validService(id, uid));
  }
  await batch.commit();
}

async function countDocs(db: FirebaseFirestore.Firestore, uid: string, collectionName: "products" | "services") {
  const snap = await db.collection("users").doc(uid).collection(collectionName).count().get();
  return snap.data().count;
}

async function createProduct(db: FirebaseFirestore.Firestore, uid: string, id: string) {
  return await createProductCommand(db, uid, {
    productId: id,
    product: validProduct(id),
    idempotencyKey: `idem-${id}`,
  });
}

async function createService(db: FirebaseFirestore.Firestore, uid: string, id: string) {
  return await createServiceCommand(db, uid, {
    serviceId: id,
    service: validService(id, uid),
    idempotencyKey: `idem-${id}`,
  });
}

async function expectLimit(label: string, fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (error) {
    assert.ok(error instanceof PlanMutationError, `${label}: erro deve usar contrato de mutation`);
    assert.equal(error.code, "PLAN_LIMIT_REACHED", label);
    console.log(`PASS ${label}`);
    return;
  }
  throw new Error(`${label}: esperava PLAN_LIMIT_REACHED`);
}

async function expectRulesDenied(label: string, fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (error) {
    assert.notEqual((error as { code?: string }).code, "unavailable", `${label}: emulador indisponível`);
    console.log(`PASS ${label}`);
    return;
  }
  throw new Error(`${label}: esperava bloqueio pelas Rules`);
}

async function isolatedUid(label: string, db: FirebaseFirestore.Firestore, plan: "free" | "pro" | "premium") {
  const uid = `plan02a2-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  await seedPlan(db, uid, plan);
  return uid;
}

async function run() {
  requireLocalEmulators();
  process.env.FIREBASE_PROJECT_ID = PROJECT_ID;
  initializeFirebaseAdmin();
  const adminApp: AdminApp = initializeAdminApp({ projectId: PROJECT_ID }, `plan-impl-02a2-admin-${Date.now()}`);
  const db = getAdminFirestore(adminApp);

  try {
    const c1Uid = await isolatedUid("c1", db, "free");
    await seedProducts(db, c1Uid, 29);
    const c1 = await Promise.allSettled([createProduct(db, c1Uid, "c1-a"), createProduct(db, c1Uid, "c1-b")]);
    assert.equal(c1.filter((item) => item.status === "fulfilled").length, 1, "C1 exactly one product create succeeds");
    assert.equal(c1.filter((item) => item.status === "rejected" && item.reason instanceof PlanMutationError && item.reason.code === "PLAN_LIMIT_REACHED").length, 1, "C1 exactly one product create rejects");
    assert.equal(await countDocs(db, c1Uid, "products"), 30, "C1 final product count = 30");
    console.log("PASS C1 concurrent Product create safe");

    const c2Uid = await isolatedUid("c2", db, "free");
    await seedServices(db, c2Uid, 4);
    const c2 = await Promise.allSettled([createService(db, c2Uid, "c2-a"), createService(db, c2Uid, "c2-b")]);
    assert.equal(c2.filter((item) => item.status === "fulfilled").length, 1, "C2 exactly one service create succeeds");
    assert.equal(c2.filter((item) => item.status === "rejected" && item.reason instanceof PlanMutationError && item.reason.code === "PLAN_LIMIT_REACHED").length, 1, "C2 exactly one service create rejects");
    assert.equal(await countDocs(db, c2Uid, "services"), 5, "C2 final service count = 5");
    console.log("PASS C2 concurrent Service create safe");

    const owner = createClientContext("owner");
    const intruder = createClientContext("intruder");
    const ownerUid = await signIn(owner, "owner");
    const intruderUid = await signIn(intruder, "intruder");
    await seedPlan(db, ownerUid, "free");
    await seedPlan(db, intruderUid, "free");
    await expectRulesDenied("C3 direct Product create DENIED", () => setDoc(doc(owner.db, "users", ownerUid, "products", "direct-product"), validProduct("direct-product")));
    await expectRulesDenied("C4 direct Service create DENIED", () => setDoc(doc(owner.db, "users", ownerUid, "services", "direct-service"), validService("direct-service", ownerUid)));

    const c5 = await isolatedUid("c5", db, "free");
    await seedProducts(db, c5, 29);
    await createProduct(db, c5, "c5-ok");
    assert.equal(await countDocs(db, c5, "products"), 30, "C5 Free Product 29 -> success");
    console.log("PASS C5 Free Product 29 success");

    const c6 = await isolatedUid("c6", db, "free");
    await seedProducts(db, c6, 30);
    await expectLimit("C6 Free Product 30 rejected", () => createProduct(db, c6, "c6-reject"));

    const c7 = await isolatedUid("c7", db, "pro");
    await seedProducts(db, c7, 499);
    await createProduct(db, c7, "c7-ok");
    console.log("PASS C7 Pro Product 499 success");

    const c8 = await isolatedUid("c8", db, "pro");
    await seedProducts(db, c8, 500);
    await expectLimit("C8 Pro Product 500 rejected", () => createProduct(db, c8, "c8-reject"));

    const c9 = await isolatedUid("c9", db, "premium");
    await seedProducts(db, c9, 1999);
    await createProduct(db, c9, "c9-ok");
    console.log("PASS C9 Premium Product 1999 success");

    const c10 = await isolatedUid("c10", db, "premium");
    await seedProducts(db, c10, 2000);
    await expectLimit("C10 Premium Product 2000 rejected", () => createProduct(db, c10, "c10-reject"));

    const c11 = await isolatedUid("c11", db, "free");
    await seedServices(db, c11, 4);
    await createService(db, c11, "c11-ok");
    console.log("PASS C11 Free Service 4 success");

    const c12 = await isolatedUid("c12", db, "free");
    await seedServices(db, c12, 5);
    await expectLimit("C12 Free Service 5 rejected", () => createService(db, c12, "c12-reject"));

    const c13 = await isolatedUid("c13", db, "pro");
    await seedServices(db, c13, 49);
    await createService(db, c13, "c13-ok");
    console.log("PASS C13 Pro Service 49 success");

    const c14 = await isolatedUid("c14", db, "pro");
    await seedServices(db, c14, 50);
    await expectLimit("C14 Pro Service 50 rejected", () => createService(db, c14, "c14-reject"));

    const c15 = await isolatedUid("c15", db, "premium");
    await seedServices(db, c15, 199);
    await createService(db, c15, "c15-ok");
    console.log("PASS C15 Premium Service 199 success");

    const c16 = await isolatedUid("c16", db, "premium");
    await seedServices(db, c16, 200);
    await expectLimit("C16 Premium Service 200 rejected", () => createService(db, c16, "c16-reject"));

    const tenantA = await isolatedUid("c17a", db, "free");
    const tenantB = await isolatedUid("c17b", db, "free");
    await seedProducts(db, tenantA, 30);
    await createProduct(db, tenantB, "tenant-b-product");
    await seedServices(db, tenantA, 5);
    await createService(db, tenantB, "tenant-b-service");
    console.log("PASS C17 tenant A usage never affects tenant B");

    await expectRulesDenied("C18 tenant A cannot mutate tenant B Product", () => setDoc(doc(intruder.db, "users", ownerUid, "products", "cross-product"), validProduct("cross-product")));
    await expectRulesDenied("C19 tenant A cannot mutate tenant B Service", () => setDoc(doc(intruder.db, "users", ownerUid, "services", "cross-service"), validService("cross-service", ownerUid)));

    const c20 = await isolatedUid("c20", db, "free");
    const firstProduct = await createProduct(db, c20, "c20-product");
    const replayProduct = await createProduct(db, c20, "c20-product");
    assert.equal(firstProduct.idempotentReplay, false);
    assert.equal(replayProduct.idempotentReplay, true);
    assert.equal(await countDocs(db, c20, "products"), 1, "C20 replay does not double increment Product");
    console.log("PASS C20 Product create idempotent");

    const c21 = await isolatedUid("c21", db, "free");
    const firstService = await createService(db, c21, "c21-service");
    const replayService = await createService(db, c21, "c21-service");
    assert.equal(firstService.idempotentReplay, false);
    assert.equal(replayService.idempotentReplay, true);
    assert.equal(await countDocs(db, c21, "services"), 1, "C21 replay does not double increment Service");
    console.log("PASS C21 Service create idempotent");

    // C22 — delete decrements the server-owned usage counter, not just the document: seeded at the Free
    // limit (30, blocked), deleting ONE existing product must free exactly one slot for a real new create
    // to land — proving the COUNTER (not merely the doc) went down, since a stale/undecremented counter
    // would keep rejecting the next create even though a slot is actually free.
    const c22 = await isolatedUid("c22", db, "free");
    await seedProducts(db, c22, 30);
    await expectLimit("C22 Free Product 30 rejected before delete", () => createProduct(db, c22, "c22-blocked"));
    await deleteProductCommand(db, c22, "seed-product-0");
    assert.equal(await countDocs(db, c22, "products"), 29, "C22 delete actually removes the document");
    await createProduct(db, c22, "c22-after-delete");
    assert.equal(await countDocs(db, c22, "products"), 30, "C22 usage counter correctly decremented by delete, allowing exactly one more create back at the limit");
    console.log("PASS C22 Product delete decrements usage counter, unblocking exactly one new create");

    // C23 — delete never double-decrements: deleteProductCommand requires the document to still exist
    // (PRODUCT_NOT_FOUND otherwise), so a second delete attempt on the same id can never decrement the
    // counter twice — the only way it double-counts is via mutation state that doesn't exist here.
    const c23 = await isolatedUid("c23", db, "free");
    await seedProducts(db, c23, 1);
    await deleteProductCommand(db, c23, "seed-product-0");
    assert.equal(await countDocs(db, c23, "products"), 0, "C23 first delete removes the only product");
    await assert.rejects(
      () => deleteProductCommand(db, c23, "seed-product-0"),
      (error: unknown) => { assert.ok(error instanceof PlanMutationError); assert.equal((error as PlanMutationError).code, "PRODUCT_NOT_FOUND"); return true; },
      "C23 replaying delete on an already-deleted product must reject, never double-decrement",
    );
    console.log("PASS C23 Product delete never double-decrements usage");

    await Promise.all([deleteApp(owner.app), deleteApp(intruder.app)]);
    console.log("PLAN-IMPL-02A2 authoritative mutation tests passed: C1-C23.");
  } finally {
    await deleteAdminApp(adminApp);
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
