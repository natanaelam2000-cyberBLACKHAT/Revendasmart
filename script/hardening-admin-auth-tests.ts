import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import { initializeApp, deleteApp } from "firebase/app";
import { connectAuthEmulator, getAuth, signInWithEmailAndPassword } from "firebase/auth";
import { connectFirestoreEmulator, getFirestore, doc, setDoc } from "firebase/firestore";

assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, "127.0.0.1:9099");
assert.equal(process.env.FIRESTORE_EMULATOR_HOST, "127.0.0.1:8080");
process.env.FIREBASE_PROJECT_ID = "demo-revendasmart";
const { initializeFirebaseAdmin, getFirebaseAdmin } = await import("../server/firebase-admin-init");
const { registerRoutes } = await import("../server/routes");
const { isAdminUid } = await import("../server/admin-auth");
initializeFirebaseAdmin();
const admin = getFirebaseAdmin();
const suffix = Date.now();
const regular = `hardening-regular-${suffix}`;
const authorized = `hardening-admin-${suffix}`;
const password = "Hardening-local-only-Password!123";
const client = initializeApp({ apiKey: "demo-api-key", projectId: "demo-revendasmart" }, `hardening-auth-${suffix}`);
const auth = getAuth(client);
connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
const clientDb = getFirestore(client);
connectFirestoreEmulator(clientDb, "127.0.0.1", 8080);
const app = express();
app.use(express.json());
const server = http.createServer(app);
try {
  await admin.auth().createUser({ uid: regular, email: "natanaelam2000@gmail.com", emailVerified: false, password });
  await admin.auth().createUser({ uid: authorized, email: `${authorized}@example.test`, emailVerified: true, password });
  await admin.auth().setCustomUserClaims(authorized, { admin: true });
  const adminToken = await (await signInWithEmailAndPassword(auth, `${authorized}@example.test`, password)).user.getIdToken(true);
  const regularToken = await (await signInWithEmailAndPassword(auth, "natanaelam2000@gmail.com", password)).user.getIdToken(true);
  assert.equal(await isAdminUid(regular), false);
  console.log("PASS ADMIN_UNVERIFIED_EMAIL_DENIED");
  for (const collection of ["users", "admin_users"]) {
    await assert.rejects(setDoc(doc(clientDb, collection, regular), { admin: true, role: "admin" }),
      (error: unknown) => (error as { code?: string }).code === "permission-denied");
  }
  console.log("PASS ADMIN_CLIENT_ROLE_WRITE_DENIED_BY_FIRESTORE_RULES");
  await registerRoutes(server, app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const routes = (app as any).router.stack.filter((layer: any) => layer.route &&
    (String(layer.route.path).startsWith("/api/admin/") || String(layer.route.path).startsWith("/api/rewards/grant/")));
  assert.ok(routes.length >= 10, "all registered admin routes must be exercised");
  for (const layer of routes) {
    const path = String(layer.route.path).replace(/:[A-Za-z]+/g, authorized);
    for (const method of Object.keys(layer.route.methods)) {
      for (const token of [undefined, regularToken]) {
        const response = await fetch(`${base}${path}?uid=${authorized}&email=${authorized}@example.test&admin=true`, {
          method: method.toUpperCase(),
          headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": "application/json", "x-user-id": authorized },
          ...(method === "get" ? {} : { body: JSON.stringify({ uid: authorized, firebaseUid: authorized, email: `${authorized}@example.test`, admin: true }) }),
        });
        assert.equal(response.status, token ? 403 : 401, `${method} ${path} must reject spoofed admin identity`);
      }
    }
  }
  console.log(`PASS ADMIN_CLIENT_EMAIL_SPOOF_DENIED; ADMIN_CLIENT_UID_SPOOF_DENIED; ADMIN_NON_ADMIN_TOKEN_DENIED; ${routes.length} routes`);
  assert.equal((await fetch(`${base}/api/admin/status`, { headers: { Authorization: `Bearer ${adminToken}` } })).status, 200);
  console.log("PASS ADMIN_VALID_AUTHORIZED_USER_ALLOWED");
  await admin.auth().setCustomUserClaims(authorized, {});
  assert.equal((await fetch(`${base}/api/admin/status`, { headers: { Authorization: `Bearer ${adminToken}` } })).status, 403);
  console.log("PASS ADMIN_ROLE_REVOCATION_DENIED_WITH_OLD_TOKEN");
} finally {
  server.closeAllConnections();
  if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
  await deleteApp(client);
  await Promise.all([regular, authorized].map((uid) => admin.auth().deleteUser(uid).catch(() => {})));
}
