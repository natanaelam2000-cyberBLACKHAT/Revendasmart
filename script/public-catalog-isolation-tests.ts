import assert from "node:assert/strict";
import fs from "node:fs";
import { createServer, type Server } from "node:http";
import path from "node:path";
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

function ensurePublicCatalogIndexFixture(): { cleanup: () => void } {
  const candidates = [
    path.resolve(process.cwd(), "dist/public/index.html"),
    path.resolve(".", "dist/public/index.html"),
    path.resolve(process.cwd(), "public/index.html"),
  ];
  if (candidates.some((candidate) => fs.existsSync(candidate))) {
    return { cleanup: () => {} };
  }

  const publicDir = path.resolve(process.cwd(), "public");
  const publicIndex = path.join(publicDir, "index.html");
  fs.mkdirSync(publicDir, { recursive: true });
  fs.writeFileSync(
    publicIndex,
    "<!doctype html><html><head><meta charset=\"utf-8\"><title>RevendaSmart Test Catalog</title></head><body><div id=\"root\">catalog-test-shell</div></body></html>",
    "utf8",
  );

  return {
    cleanup: () => {
      fs.rmSync(publicDir, { recursive: true, force: true });
    },
  };
}

async function run(): Promise<void> {
  requireLocalEmulators();
  const publicIndexFixture = ensurePublicCatalogIndexFixture();

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
  const ensureCatalogSlug = async (user: User, pathUid: string) => {
    const token = await user.getIdToken();
    return fetch(`${baseUrl}/api/public-catalog/ensure/${pathUid}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
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

    const realCase = await createTestUser("placeholder-real-case");
    const duplicateA = await createTestUser("duplicate-a");
    const duplicateB = await createTestUser("duplicate-b");
    const inactive = await createTestUser("inactive-catalog");
    const accent = await createTestUser("accent-catalog");
    try {
      await Promise.all([
        db.doc(`users/${realCase.user.uid}/products/jbl`).set({ name: "Caixa JBL", salePrice: 499, stock: 2, category: "Eletrônicos" }),
        db.doc(`users/${duplicateA.user.uid}/products/a`).set({ name: "Produto A", salePrice: 10, stock: 1 }),
        db.doc(`users/${duplicateB.user.uid}/products/b`).set({ name: "Produto B", salePrice: 20, stock: 1 }),
        db.doc(`users/${inactive.user.uid}/products/inactive`).set({ name: "Produto inativo", salePrice: 30, stock: 1 }),
        db.doc(`users/${accent.user.uid}/products/accent`).set({ name: "Produto acento", salePrice: 40, stock: 1 }),
      ]);

      await db.doc(`user_settings/${realCase.user.uid}`).set({
        storeName: "Natanael Imports",
        catalogSlug: "minha-revenda",
        catalog_slug: "minha-revenda",
        enablePublicCatalog: true,
      });
      const realEnsure = await ensureCatalogSlug(realCase.user, realCase.user.uid);
      assert.equal(realEnsure.status, 200);
      const realEnsurePayload = await realEnsure.json() as { slug: string; url: string };
      assert.equal(realEnsurePayload.slug, "natanael-imports");
      assert.notEqual(realEnsurePayload.slug, "minha-revenda");
      assert.match(realEnsurePayload.url, /\/u\/natanael-imports$/);
      assert.equal((await db.doc("public_catalog_slugs/natanael-imports").get()).data()?.ownerUid, realCase.user.uid);
      assert.equal((await db.doc("public_catalog_slugs/minha-revenda").get()).exists, false);
      assert.equal((await catalog(realEnsurePayload.slug)).status, 200);
      const publicPage = await fetch(`${baseUrl}/u/${realEnsurePayload.slug}`);
      assert.equal(publicPage.status, 200);
      assert.match(await publicPage.text(), /Natanael Imports|root/);
      const repeatedEnsure = await ensureCatalogSlug(realCase.user, realCase.user.uid);
      assert.equal(repeatedEnsure.status, 200);
      assert.equal(((await repeatedEnsure.json()) as { slug: string }).slug, realEnsurePayload.slug);

      const renamePreserve = await postSettings(realCase.user, realCase.user.uid, {
        storeName: "Natanael Imports Franca",
        enablePublicCatalog: true,
      });
      assert.equal(renamePreserve.status, 200);
      assert.equal((await db.doc(`user_settings/${realCase.user.uid}`).get()).data()?.catalogSlug, "natanael-imports");
      assert.equal((await catalog("natanael-imports")).status, 200);

      await Promise.all([
        db.doc(`user_settings/${duplicateA.user.uid}`).set({ storeName: "Natanael Imports", catalogSlug: "minha-revenda", catalog_slug: "minha-revenda", enablePublicCatalog: true }),
        db.doc(`user_settings/${duplicateB.user.uid}`).set({ storeName: "Natanael Imports", catalogSlug: "minha-revenda", catalog_slug: "minha-revenda", enablePublicCatalog: true }),
      ]);
      const duplicateEnsures = await Promise.all([
        ensureCatalogSlug(duplicateA.user, duplicateA.user.uid),
        ensureCatalogSlug(duplicateB.user, duplicateB.user.uid),
      ]);
      assert.deepEqual(duplicateEnsures.map((response) => response.status), [200, 200]);
      const duplicateSlugs = await Promise.all(duplicateEnsures.map(async (response) => ((await response.json()) as { slug: string }).slug));
      assert.equal(new Set(duplicateSlugs).size, 2);
      assert.ok(duplicateSlugs.includes("natanael-imports-2"));
      assert.ok(duplicateSlugs.includes("natanael-imports-3"));
      for (const slug of duplicateSlugs) assert.equal((await catalog(slug)).status, 200);

      await db.doc("public_catalog_slugs/orphan-reservation").set({ ownerUid: "missing-owner", slug: "orphan-reservation" });
      assert.equal((await catalog("orphan-reservation")).status, 404);

      await Promise.all([
        db.doc(`user_settings/${inactive.user.uid}`).set({ storeName: "Loja Inativa", catalogSlug: "loja-inativa", catalog_slug: "loja-inativa", enablePublicCatalog: false }),
        db.doc("public_catalog_slugs/loja-inativa").set({ ownerUid: inactive.user.uid, slug: "loja-inativa" }),
      ]);
      assert.equal((await catalog("loja-inativa")).status, 404);

      await db.doc(`user_settings/${accent.user.uid}`).set({ storeName: "Loja São João", catalogSlug: "minha-revenda", catalog_slug: "minha-revenda", enablePublicCatalog: true });
      const accentEnsure = await ensureCatalogSlug(accent.user, accent.user.uid);
      assert.equal(accentEnsure.status, 200);
      assert.equal(((await accentEnsure.json()) as { slug: string }).slug, "loja-sao-joao");
      assert.equal((await catalog("loja-sao-joao")).status, 200);
    } finally {
      await Promise.allSettled([deleteApp(realCase.app), deleteApp(duplicateA.app), deleteApp(duplicateB.app), deleteApp(inactive.app), deleteApp(accent.app)]);
    }

    console.log("Public catalog isolation integration tests passed: ownership, mass assignment, atomic slug uniqueness and legacy compatibility.");
  } finally {
    await close(server);
    publicIndexFixture.cleanup();
    await Promise.allSettled([deleteApp(tenantA.app), deleteApp(tenantB.app), deleteApp(legacy.app)]);
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exit(1);
});
