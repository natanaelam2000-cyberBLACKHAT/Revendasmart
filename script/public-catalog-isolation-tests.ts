import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import express from "express";
import { initializeApp, deleteApp, type FirebaseApp } from "firebase/app";
import {
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  getAuth,
  type User,
} from "firebase/auth";
import { connectFirestoreEmulator, doc, getFirestore, setDoc, type Firestore } from "firebase/firestore";

const PROJECT_ID = "demo-revendasmart";

function requireLocalEmulators(): void {
  assert.equal(process.env.FIRESTORE_EMULATOR_HOST, "127.0.0.1:8080");
  assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, "127.0.0.1:9099");
  assert.notEqual(process.env.GOOGLE_CLOUD_PROJECT, "revenda-smart");
  process.env.FIREBASE_PROJECT_ID = PROJECT_ID;
}

async function createTestUser(label: string): Promise<{ app: FirebaseApp; user: User; db: Firestore }> {
  const app = initializeApp({
    apiKey: "demo-api-key",
    authDomain: `${PROJECT_ID}.firebaseapp.com`,
    projectId: PROJECT_ID,
    appId: `catalog-${label}-${Date.now()}`,
  }, `catalog-${label}-${Date.now()}-${Math.random()}`);
  const auth = getAuth(app);
  const db = getFirestore(app);
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  const credential = await createUserWithEmailAndPassword(
    auth,
    `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`,
    "LocalTestPassword!123",
  );
  return { app, user: credential.user, db };
}

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return `http://127.0.0.1:${address.port}`;
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

async function run(): Promise<void> {
  requireLocalEmulators();

  const [{ registerRoutes }, { getFirebaseAdmin }] = await Promise.all([
    import("../server/routes"),
    import("../server/firebase-admin-init"),
  ]);
  const app = express();
  app.use(express.json({ limit: "100kb" }));
  const server = createServer(app);
  await registerRoutes(server, app);
  const baseUrl = await listen(server);

  const tenantA = await createTestUser("tenant-a");
  const tenantB = await createTestUser("tenant-b");
  const legacy = await createTestUser("legacy");
  const admin = getFirebaseAdmin();
  const db = admin.firestore();

  const postSettings = async (user: User, pathUid: string, body: Record<string, unknown>) => {
    const token = await user.getIdToken();
    return fetch(`${baseUrl}/api/user/settings/${pathUid}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
  };
  const catalog = async (slug: string) => fetch(`${baseUrl}/api/public/catalog/${slug}`);

  try {
    const uidA = tenantA.user.uid;
    const uidB = tenantB.user.uid;
    const legacyUid = legacy.user.uid;
    assert.notEqual(uidA, uidB);

    await Promise.all([
      db.doc(`users/${uidA}/products/product-a`).set({ name: "Produto exclusivo A", salePrice: 101, stock: 4, category: "A" }),
      db.doc(`users/${uidA}/sales/sale-a`).set({ products: [{ productId: "product-a", quantity: 1, price: 101 }] }),
      db.doc(`users/${uidB}/products/product-b`).set({ name: "Produto exclusivo B", salePrice: 202, stock: 5, category: "B" }),
      db.doc(`users/${uidB}/sales/sale-b`).set({ products: [{ productId: "product-b", quantity: 1, price: 202 }] }),
      db.doc(`users/${legacyUid}/products/product-legacy`).set({ name: "Produto legacy", salePrice: 303, stock: 3, category: "Legacy" }),
      db.doc(`users/${legacyUid}/sales/sale-legacy`).set({ products: [{ productId: "product-legacy", quantity: 1, price: 303 }] }),
    ]);

    const responseA = await postSettings(tenantA.user, uidA, {
      storeName: "Loja A",
      catalogSlug: "catalogo-a",
      catalog_slug: "catalogo-a",
      uid: uidB,
      ownerId: uidB,
      owner_uid: uidB,
      isAdmin: true,
      currentPlan: "premium",
      premiumActive: true,
    });
    assert.equal(responseA.status, 200);

    const responseB = await postSettings(tenantB.user, uidB, {
      storeName: "Loja B",
      catalogSlug: "catalogo-b",
      catalog_slug: "catalogo-b",
      uid: uidA,
      ownerId: uidA,
    });
    assert.equal(responseB.status, 200);

    const [settingsA, settingsB] = await Promise.all([
      db.doc(`user_settings/${uidA}`).get(),
      db.doc(`user_settings/${uidB}`).get(),
    ]);
    for (const [settings, expectedSlug] of [[settingsA, "catalogo-a"], [settingsB, "catalogo-b"]] as const) {
      assert.equal(settings.data()?.catalogSlug, expectedSlug);
      assert.equal(settings.data()?.uid, undefined);
      assert.equal(settings.data()?.ownerId, undefined);
      assert.equal(settings.data()?.owner_uid, undefined);
      assert.equal(settings.data()?.isAdmin, undefined);
      assert.equal(settings.data()?.currentPlan, undefined);
      assert.equal(settings.data()?.premiumActive, undefined);
    }

    const [publicA, publicB] = await Promise.all([catalog("catalogo-a"), catalog("catalogo-b")]);
    assert.equal(publicA.status, 200);
    assert.equal(publicB.status, 200);
    const payloadA = await publicA.json() as { products: Array<{ id: string }> };
    const payloadB = await publicB.json() as { products: Array<{ id: string }> };
    assert.deepEqual(payloadA.products.map((product) => product.id), ["product-a"]);
    assert.deepEqual(payloadB.products.map((product) => product.id), ["product-b"]);

    const forbiddenCrossPath = await postSettings(tenantA.user, uidB, { storeName: "Ataque" });
    assert.equal(forbiddenCrossPath.status, 403);
    const unauthenticated = await fetch(`${baseUrl}/api/user/settings/${uidA}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ catalogSlug: "sem-auth" }),
    });
    assert.equal(unauthenticated.status, 401);
    await assert.rejects(
      setDoc(doc(tenantA.db, "public_catalog_slugs", "client-controlled"), { ownerUid: uidA }),
      (error: any) => error?.code === "permission-denied",
    );

    const collision = await Promise.all([
      postSettings(tenantA.user, uidA, { storeName: "Loja A", catalogSlug: "slug-disputado", catalog_slug: "slug-disputado" }),
      postSettings(tenantB.user, uidB, { storeName: "Loja B", catalogSlug: "slug-disputado", catalog_slug: "slug-disputado" }),
    ]);
    assert.deepEqual(collision.map((response) => response.status).sort(), [200, 409]);
    const reservation = await db.doc("public_catalog_slugs/slug-disputado").get();
    const winnerUid = reservation.data()?.ownerUid as string;
    assert.ok(winnerUid === uidA || winnerUid === uidB);
    const winner = winnerUid === uidA ? tenantA.user : tenantB.user;
    const loserUid = winnerUid === uidA ? uidB : uidA;
    const loserOriginalSlug = loserUid === uidA ? "catalogo-a" : "catalogo-b";
    assert.equal((await db.doc(`user_settings/${loserUid}`).get()).data()?.catalogSlug, loserOriginalSlug);
    assert.equal((await catalog(loserOriginalSlug)).status, 200);
    const winnerUpdate = await postSettings(winner, winnerUid, {
      storeName: winnerUid === uidA ? "Loja A" : "Loja B",
      catalogSlug: "slug-atualizado",
      catalog_slug: "slug-atualizado",
    });
    assert.equal(winnerUpdate.status, 200);
    assert.equal((await catalog("slug-disputado")).status, 404);
    assert.equal((await catalog("slug-atualizado")).status, 200);
    assert.equal((await db.doc("public_catalog_slugs/slug-disputado").get()).exists, false);
    assert.equal((await db.doc("public_catalog_slugs/slug-atualizado").get()).data()?.ownerUid, winnerUid);

    await db.doc(`user_settings/${legacyUid}`).set({
      storeName: "Loja Legacy",
      userSlug: "catalogo-legacy",
      uid: uidB,
    });
    const legacyCatalog = await catalog("catalogo-legacy");
    assert.equal(legacyCatalog.status, 200);
    const legacyPayload = await legacyCatalog.json() as { products: Array<{ id: string }> };
    assert.deepEqual(legacyPayload.products.map((product) => product.id), ["product-legacy"]);

    const legacyCollision = await postSettings(tenantA.user, uidA, {
      catalogSlug: "catalogo-legacy",
      catalog_slug: "catalogo-legacy",
    });
    assert.equal(legacyCollision.status, 409);

    const migrateLegacy = await postSettings(legacy.user, legacyUid, {
      storeName: "Loja Legacy",
      catalogSlug: "catalogo-legacy",
      catalog_slug: "catalogo-legacy",
      userSlug: "valor-legacy-obsoleto",
      uid: uidA,
    });
    assert.equal(migrateLegacy.status, 200);
    assert.equal((await db.doc("public_catalog_slugs/catalogo-legacy").get()).data()?.ownerUid, legacyUid);
    assert.equal((await db.doc(`user_settings/${legacyUid}`).get()).data()?.uid, undefined);

    console.log("Public catalog isolation integration tests passed: ownership, mass assignment, atomic slug uniqueness and legacy compatibility.");
  } finally {
    await close(server);
    await Promise.allSettled([deleteApp(tenantA.app), deleteApp(tenantB.app), deleteApp(legacy.app)]);
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exit(1);
});
