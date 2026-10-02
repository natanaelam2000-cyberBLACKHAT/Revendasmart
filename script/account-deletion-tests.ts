import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:http";

process.env.FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || "demo-revendasmart";
process.env.FIREBASE_STORAGE_BUCKET = process.env.FIREBASE_STORAGE_BUCKET || "demo-revendasmart.appspot.com";
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || "127.0.0.1:9099";
process.env.FIREBASE_STORAGE_EMULATOR_HOST = process.env.FIREBASE_STORAGE_EMULATOR_HOST || "127.0.0.1:9199";

const [{ initializeFirebaseAdmin, getFirebaseAdmin }, accountDeletion, { registerRoutes }] = await Promise.all([
  import("../server/firebase-admin-init"),
  import("../server/account-deletion"),
  import("../server/routes"),
]);

initializeFirebaseAdmin();
const admin = getFirebaseAdmin();
const db = admin.firestore();
const auth = admin.auth();
const bucket = admin.storage().bucket(process.env.FIREBASE_STORAGE_BUCKET);
const uidA = `release03-a-${Date.now()}`;
const uidB = `release03-b-${Date.now()}`;
const uidC = `release03-c-${Date.now()}`;
const uidD = `release17-d-${Date.now()}`;
const password = "Release03-test-password!";

async function exists(path: string) { return (await db.doc(path).get()).exists; }

async function testScopedLocalCleanup(): Promise<void> {
  const values = new Map<string, string>([
    ["rs:local-a:products", "[]"],
    ["rs:local-a:settings", "{}"],
    ["rs:local-b:products", "[]"],
    ["rs:login:remembered-email", "owner@example.test"],
  ]);
  const localStorage: Record<string, unknown> = Object.fromEntries(values);
  Object.defineProperties(localStorage, {
    getItem: { enumerable: false, value: (key: string) => values.get(key) ?? null },
    removeItem: { enumerable: false, value: (key: string) => { values.delete(key); delete localStorage[key]; } },
  });
  Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage } });
  const { clearDeletedAccountLocalData } = await import("../client/src/lib/account-deletion-local");
  await clearDeletedAccountLocalData("local-a");
  assert.equal(values.has("rs:local-a:products"), false);
  assert.equal(values.has("rs:local-a:settings"), false);
  assert.equal(values.has("rs:local-b:products"), true);
  assert.equal(values.has("rs:login:remembered-email"), true);
  Reflect.deleteProperty(globalThis, "window");
}

try {
  await testScopedLocalCleanup();
  await Promise.all([
    auth.createUser({ uid: uidA, email: `${uidA}@example.test`, password }),
    auth.createUser({ uid: uidB, email: `${uidB}@example.test`, password }),
    auth.createUser({ uid: uidC, email: `${uidC}@example.test`, password }),
    auth.createUser({ uid: uidD, email: `${uidD}@example.test`, password }),
  ]);
  await Promise.all([
    db.doc(`users/${uidA}/products/a-product`).set({ owner: uidA }),
    db.doc(`users/${uidA}/clients/a-client`).set({ owner: uidA }),
    db.doc(`users/${uidA}/sales/a-sale`).set({ owner: uidA }),
    db.doc(`users/${uidA}/charges/a-charge`).set({ owner: uidA }),
    db.doc(`users/${uidA}/marketingHistory/a-history`).set({ owner: uidA }),
    db.doc(`users/${uidB}/products/b-product`).set({ owner: uidB }),
    db.doc(`user_settings/${uidA}`).set({ catalogSlug: "tenant-a", referral_source: uidB }),
    db.doc(`user_settings/${uidB}`).set({
      catalogSlug: "tenant-b",
      referred_users: [uidA, uidD],
      referral_conversions: 2,
      reward_eligible_conversions: 2,
    }),
    db.doc(`user_settings/${uidD}`).set({ catalogSlug: "tenant-d", referral_source: uidB }),
    db.doc("public_catalog_slugs/tenant-a").set({ ownerUid: uidA }),
    db.doc("public_catalog_slugs/tenant-b").set({ ownerUid: uidB }),
    db.doc("mercadopago_oauth_states/a-state").set({ uid: uidA }),
    db.doc("mercadopago_oauth_states/b-state").set({ uid: uidB }),
    // RELEASE-17: campos REAIS gravados por /api/referral/track-event e /validate-referral são
    // `referredUID`/`referrerUID` (UID maiúsculo) — ver server/routes.ts. Seedar com esse casing é o
    // que prova que o cleanup usa o schema real, não um nome de campo que só existia no teste antigo.
    db.doc("referralEvents/a-event").set({ referrerUID: uidA, referredUID: uidB }),
    bucket.file(`users/${uidA}/products/a.png`).save(Buffer.from("a")),
    bucket.file(`users/${uidB}/products/b.png`).save(Buffer.from("b")),
    db.doc(`users/${uidC}/products/c-product`).set({ owner: uidC }),
    db.doc(`referralEvents/c-event`).set({ referrerUID: uidB, referredUID: uidC }),
    db.doc(`users/${uidB}/planData/main/validatedReferrals/${uidC}`).set({ referrerUID: uidB, referredUID: uidC, validated: true }),
    db.doc(`users/${uidB}/planData/main/referralRewardLedger/c-event-ledger`).set({ milestone: 3, outcome: "referral_reward_granted" }),
    // RELEASE-17: A também aparece como REFERRED (B indicou A) — prova que o cleanup remove A tanto
    // quando A é referrerUID quanto quando A é referredUID, e limpa o validatedReferrals correspondente
    // sob a árvore de B (que sobrevive).
    db.doc("referralEvents/pre-a-event").set({ referrerUID: uidB, referredUID: uidA }),
    db.doc(`users/${uidB}/planData/main/validatedReferrals/${uidA}`).set({ referrerUID: uidB, referredUID: uidA, validated: true }),
    // Grafo de referral totalmente alheio a A (B indicou D): precisa sobreviver intacto à exclusão de A.
    db.doc("referralEvents/b-to-d-event").set({ referrerUID: uidB, referredUID: uidD }),
    db.doc(`users/${uidB}/planData/main/validatedReferrals/${uidD}`).set({ referrerUID: uidB, referredUID: uidD, validated: true }),
  ]);

  // A partial storage failure keeps Auth and the tombstone so the same user can retry safely.
  const failingBucket = {
    deleteFiles: async () => { throw new Error("SIMULATED_STORAGE_FAILURE"); },
  } as unknown as typeof bucket;
  await assert.rejects(
    accountDeletion.deleteAccountByUid(uidC, { db, auth, bucket: failingBucket, now: () => new Date() }),
    /SIMULATED_STORAGE_FAILURE/,
  );
  assert.equal((await auth.getUser(uidC)).uid, uidC);
  assert.equal(await exists(`${accountDeletion.ACCOUNT_DELETION_COLLECTION}/${uidC}`), true);
  await accountDeletion.deleteAccountByUid(uidC, { db, auth, bucket, now: () => new Date() });
  await assert.rejects(auth.getUser(uidC), (error: any) => error?.code === "auth/user-not-found");
  assert.equal(await exists("referralEvents/c-event"), false);
  assert.equal(await exists(`users/${uidB}/planData/main/validatedReferrals/${uidC}`), false);
  assert.equal(await exists(`users/${uidB}/planData/main/referralRewardLedger/c-event-ledger`), true,
    "ledger server-side permanece após a exclusão da conta indicada");

  // Active external state fails closed and leaves Auth/data intact.
  await db.doc(`users/${uidA}/planData/main`).set({ subscriptionId: "sub-a", subscriptionStatus: "active" });
  await assert.rejects(
    accountDeletion.deleteAccountByUid(uidA, { db, auth, bucket, now: () => new Date() }),
    (error: unknown) => error instanceof accountDeletion.AccountDeletionBlockedError && error.reason === "ACTIVE_SUBSCRIPTION",
  );
  assert.equal(await exists(`users/${uidA}/products/a-product`), true);
  await db.doc(`users/${uidA}/planData/main`).set({ subscriptionStatus: "cancelled" }, { merge: true });

  await db.doc(`users/${uidA}/mercadopago_connections/connection-a`).set({ status: "active" });
  await assert.rejects(
    accountDeletion.deleteAccountByUid(uidA, { db, auth, bucket, now: () => new Date() }),
    (error: unknown) => error instanceof accountDeletion.AccountDeletionBlockedError && error.reason === "ACTIVE_MERCADOPAGO_CONNECTION",
  );
  await db.doc(`users/${uidA}/mercadopago_connections/connection-a`).set({ status: "revoked" });

  // Real requireAuth ignores malicious body ownership fields and uses the verified token UID.
  const app = express();
  app.use(express.json());
  const server = createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address === "object");
  const unauthenticated = await fetch(`http://127.0.0.1:${address.port}/api/account`, { method: "DELETE" });
  assert.equal(unauthenticated.status, 401);
  const signIn = await fetch(
    `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-api-key`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: `${uidA}@example.test`, password, returnSecureToken: true }),
    },
  );
  assert.equal(signIn.status, 200);
  const token = String((await signIn.json() as { idToken?: string }).idToken ?? "");
  assert(token.length > 0);
  const response = await fetch(`http://127.0.0.1:${address.port}/api/account`, {
    method: "DELETE",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ uid: uidB, ownerId: uidB }),
  });
  assert.equal(response.status, 200);
  const replayApi = await fetch(`http://127.0.0.1:${address.port}/api/account`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(replayApi.status, 401);
  await new Promise<void>((resolve) => server.close(() => resolve()));

  await assert.rejects(auth.getUser(uidA), (error: any) => error?.code === "auth/user-not-found");
  assert.equal(await exists(`users/${uidA}/products/a-product`), false);
  assert.equal(await exists(`user_settings/${uidA}`), false);
  assert.equal(await exists("public_catalog_slugs/tenant-a"), false);
  assert.equal(await exists("mercadopago_oauth_states/a-state"), false);
  assert.equal(await exists("referralEvents/a-event"), false, "B: referralEvents com referrerUID=A é removido");
  assert.equal(await exists("referralEvents/pre-a-event"), false, "A: referralEvents com referredUID=A é removido");
  assert.equal(await exists(`users/${uidB}/planData/main/validatedReferrals/${uidA}`), false,
    "G: validatedReferrals de A (sob a árvore do referrer B, que sobrevive) é removido");
  const userSettingsAfterDeleteA = await db.doc(`user_settings/${uidB}`).get();
  assert.deepEqual(userSettingsAfterDeleteA.data()?.referred_users, [uidD], "K/L: referred_users legado remove apenas a edge A↔B");
  assert.equal(userSettingsAfterDeleteA.data()?.referral_conversions, 2, "K/L: contador histórico não recicla milestone ao apagar indicado");
  assert.equal(userSettingsAfterDeleteA.data()?.reward_eligible_conversions, 2, "K/L: elegibilidade histórica permanece monotônica");
  assert.equal((await bucket.file(`users/${uidA}/products/a.png`).exists())[0], false);

  // Tenant B remains untouched.
  assert.equal(await exists(`users/${uidB}/products/b-product`), true);
  assert.equal(await exists(`user_settings/${uidB}`), true);
  assert.equal(await exists("public_catalog_slugs/tenant-b"), true);
  assert.equal(await exists("mercadopago_oauth_states/b-state"), true);
  assert.equal((await bucket.file(`users/${uidB}/products/b.png`).exists())[0], true);
  assert.equal((await auth.getUser(uidB)).uid, uidB);

  // D: um grafo de referral totalmente alheio a A (B indicou D) não é afetado pela exclusão de A.
  assert.equal(await exists("referralEvents/b-to-d-event"), true, "D: referral B→D não é afetado pela exclusão de A");
  assert.equal(await exists(`users/${uidB}/planData/main/validatedReferrals/${uidD}`), true,
    "D: validatedReferrals de B→D não é afetado pela exclusão de A");
  assert.equal((await db.doc(`user_settings/${uidD}`).get()).data()?.referral_source, uidB,
    "N: referências legadas de outro tenant permanecem intactas");

  // A previously issued token cannot recreate data after the server-owned tombstone exists.
  const replay = await fetch(
    `http://${process.env.FIRESTORE_EMULATOR_HOST}/v1/projects/${process.env.FIREBASE_PROJECT_ID}/databases/(default)/documents/users/${uidA}/products/replayed`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ fields: { id: { stringValue: "replayed" }, name: { stringValue: "Replay" }, salePrice: { integerValue: "1" } } }),
    },
  );
  assert.equal(replay.status, 403);
  assert.equal(await exists(`users/${uidA}/products/replayed`), false);
  const storageReplay = await fetch(
    `http://${process.env.FIREBASE_STORAGE_EMULATOR_HOST}/v0/b/${process.env.FIREBASE_STORAGE_BUCKET}/o?uploadType=media&name=${encodeURIComponent(`users/${uidA}/products/replayed.png`)}`,
    {
      method: "POST",
      headers: { "content-type": "image/png", authorization: `Bearer ${token}` },
      body: Buffer.from("not-a-real-png"),
    },
  );
  assert.equal(storageReplay.status, 403);
  assert.equal((await bucket.file(`users/${uidA}/products/replayed.png`).exists())[0], false);

  // E: o cleanup de referral é idempotente — rodar de novo depois que os documentos já sumiram não
  // falha, não recria nada, e não some com o grafo de outro tenant (B→D) que nunca dependeu de A.
  await accountDeletion.deleteAccountByUid(uidA, { db, auth, bucket, now: () => new Date() });
  assert.equal(await exists("referralEvents/a-event"), false);
  assert.equal(await exists("referralEvents/pre-a-event"), false);
  assert.equal(await exists("referralEvents/b-to-d-event"), true, "E: segunda execução não remove o grafo de outro tenant");
  assert.equal(await exists(`users/${uidB}/planData/main/validatedReferrals/${uidD}`), true, "E: segunda execução não remove validatedReferrals de outro tenant");
  assert.deepEqual((await db.doc(`user_settings/${uidB}`).get()).data()?.referred_users, [uidD], "O: segunda execução continua idempotente no legado");

  await accountDeletion.deleteAccountByUid(uidB, { db, auth, bucket, now: () => new Date() });
  assert.equal((await db.doc(`user_settings/${uidD}`).get()).data()?.referral_source, undefined,
    "M: referral_source legado em documento de terceiro é limpo quando o referrer é excluído");
  assert.equal(await exists(`user_settings/${uidB}`), false);
  console.log("account deletion isolation tests passed");
} finally {
  await db.recursiveDelete(db.collection("users").doc(uidA)).catch(() => undefined);
  await db.recursiveDelete(db.collection("users").doc(uidB)).catch(() => undefined);
  await db.recursiveDelete(db.collection("users").doc(uidC)).catch(() => undefined);
  await db.recursiveDelete(db.collection("users").doc(uidD)).catch(() => undefined);
  await Promise.all([
    db.doc(`user_settings/${uidA}`).delete(), db.doc(`user_settings/${uidB}`).delete(), db.doc(`user_settings/${uidD}`).delete(),
    db.doc("public_catalog_slugs/tenant-a").delete(), db.doc("public_catalog_slugs/tenant-b").delete(),
    db.doc("mercadopago_oauth_states/a-state").delete(), db.doc("mercadopago_oauth_states/b-state").delete(),
    db.doc("referralEvents/a-event").delete(),
    db.doc("referralEvents/c-event").delete(),
    db.doc(`users/${uidB}/planData/main/referralRewardLedger/c-event-ledger`).delete(),
    db.doc("referralEvents/pre-a-event").delete(),
    db.doc("referralEvents/b-to-d-event").delete(),
    db.doc(`${accountDeletion.ACCOUNT_DELETION_COLLECTION}/${uidA}`).delete(),
    db.doc(`${accountDeletion.ACCOUNT_DELETION_COLLECTION}/${uidB}`).delete(),
    db.doc(`${accountDeletion.ACCOUNT_DELETION_COLLECTION}/${uidC}`).delete(),
    db.doc(`${accountDeletion.ACCOUNT_DELETION_COLLECTION}/${uidD}`).delete(),
    bucket.deleteFiles({ prefix: `users/${uidA}/`, force: true }),
    bucket.deleteFiles({ prefix: `users/${uidB}/`, force: true }),
    auth.deleteUser(uidA).catch(() => undefined), auth.deleteUser(uidB).catch(() => undefined), auth.deleteUser(uidC).catch(() => undefined),
    auth.deleteUser(uidD).catch(() => undefined),
  ]).catch(() => undefined);
}
