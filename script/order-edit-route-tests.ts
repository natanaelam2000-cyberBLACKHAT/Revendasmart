/**
 * RS-PEDIDOS-01 — prova que registerOrderEditRoutes está REALMENTE registrada em server/routes.ts
 * (registerRoutes), não só importável. Mesma disciplina de account-deletion-tests.ts: app Express real,
 * registerRoutes real, servidor HTTP real numa porta efêmera, requisição HTTP real — nunca chamando
 * handleOrderEditRequest diretamente. O ID token vem do próprio emulador de Auth (signInWithPassword),
 * então requireAuth verifica um token real, não um mock.
 *
 * Roda no emulador (auth + firestore):
 *   npx --yes firebase-tools@15.24.0 emulators:exec --project demo-revendasmart --only auth,firestore "tsx script/order-edit-route-tests.ts"
 */
import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:http";

process.env.FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || "demo-revendasmart";
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || "127.0.0.1:9099";

function requireEmulator(): void {
  const projectId = process.env.FIREBASE_PROJECT_ID ?? "";
  if (!projectId.startsWith("demo-") || !/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST ?? "")) {
    throw new Error(`Recusado: só roda no emulador (projeto demo-*, FIRESTORE_EMULATOR_HOST local). projeto=${projectId || "-"}`);
  }
}

async function main(): Promise<void> {
  requireEmulator();
  const [{ initializeFirebaseAdmin, getFirebaseAdmin }, { registerRoutes }] = await Promise.all([
    import("../server/firebase-admin-init"),
    import("../server/routes"),
  ]);

  initializeFirebaseAdmin();
  const admin = getFirebaseAdmin();
  const db = admin.firestore();
  const auth = admin.auth();

  const uid = `order-edit-route-${Date.now()}`;
  const email = `${uid}@example.test`;
  const password = "OrderEditRoute-test-password!";
  const orderId = "route-order-1";

  await auth.createUser({ uid, email, password });
  const now = new Date().toISOString();
  await db.collection("users").doc(uid).collection("orders").doc(orderId).set({
    id: orderId,
    clientId: "client-1",
    clientName: "Cliente Rota",
    status: "new",
    items: [{ productId: undefined, name: "Item manual", quantity: 2, unitPrice: 10 }].map((item) =>
      Object.fromEntries(Object.entries(item).filter(([, value]) => value !== undefined))),
    total: 20,
    createdAt: now,
    updatedAt: now,
  });

  const app = express();
  app.use(express.json());
  const server = createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    // R-ROUTE-1 — rota está montada (401, nunca 404): requireAuth reage antes de qualquer lógica de pedido.
    const unauthenticated = await fetch(`${baseUrl}/api/orders/${orderId}/edit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ expectedUpdatedAt: now, idempotencyKey: "route-test-key-1", items: [{ name: "x", quantity: 1, unitPrice: 1 }] }),
    });
    assert.equal(unauthenticated.status, 401, "R-ROUTE-1: sem token deveria ser 401 (rota registrada), não 404 (rota ausente)");

    // R-ROUTE-2 — token inválido também é rejeitado (nunca aceito silenciosamente).
    const bogusToken = await fetch(`${baseUrl}/api/orders/${orderId}/edit`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer not-a-real-token" },
      body: JSON.stringify({ expectedUpdatedAt: now, idempotencyKey: "route-test-key-2", items: [{ name: "x", quantity: 1, unitPrice: 1 }] }),
    });
    assert.equal(bogusToken.status, 401, "R-ROUTE-2: token inválido deveria ser 401");

    // R-ROUTE-3 — fluxo real ponta a ponta: sign-in de verdade no emulador de Auth, POST autenticado
    // através do servidor HTTP real, e o pedido de fato muda no Firestore.
    const signIn = await fetch(
      `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-api-key`,
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password, returnSecureToken: true }) },
    );
    assert.equal(signIn.status, 200, "sign-in no emulador de Auth deveria funcionar");
    const { idToken } = await signIn.json() as { idToken: string };

    const authenticated = await fetch(`${baseUrl}/api/orders/${orderId}/edit`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${idToken}` },
      body: JSON.stringify({ expectedUpdatedAt: now, idempotencyKey: "route-test-key-3", items: [{ name: "Item manual", quantity: 5, unitPrice: 10 }] }),
    });
    const authenticatedBody = await authenticated.text();
    assert.equal(authenticated.status, 200, `R-ROUTE-3: edição autenticada deveria ser 200, veio ${authenticated.status}: ${authenticatedBody}`);
    const result = JSON.parse(authenticatedBody) as { orderId: string; total: number; itemCount: number };
    assert.equal(result.orderId, orderId);
    assert.equal(result.total, 50);
    assert.equal(result.itemCount, 1);

    const stored = await db.collection("users").doc(uid).collection("orders").doc(orderId).get();
    assert.equal(stored.data()?.total, 50, "R-ROUTE-3: o pedido gravado precisa refletir a edição feita pela rota real");
    assert.equal(stored.data()?.items?.[0]?.quantity, 5);
    assert.equal(stored.data()?.clientName, "Cliente Rota", "R-ROUTE-3: cliente precisa continuar intacto — a rota não aceita clientName no payload");

    // R-ROUTE-4 — cross-tenant: outro uid não enxerga o pedido através da rota real (404, nunca 200/403 vazando existência de outro tenant).
    const otherUid = `order-edit-route-other-${Date.now()}`;
    await auth.createUser({ uid: otherUid, email: `${otherUid}@example.test`, password });
    const otherSignIn = await fetch(
      `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-api-key`,
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: `${otherUid}@example.test`, password, returnSecureToken: true }) },
    );
    const { idToken: otherIdToken } = await otherSignIn.json() as { idToken: string };
    const crossTenant = await fetch(`${baseUrl}/api/orders/${orderId}/edit`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${otherIdToken}` },
      body: JSON.stringify({ expectedUpdatedAt: now, idempotencyKey: "route-test-key-4", items: [{ name: "x", quantity: 1, unitPrice: 1 }] }),
    });
    assert.equal(crossTenant.status, 404, "R-ROUTE-4: outro tenant não deveria enxergar este pedido através da rota real");

    console.log("ok R-ROUTE-1 sem token: 401 (rota registrada em server/routes.ts, não 404)");
    console.log("ok R-ROUTE-2 token inválido: 401");
    console.log("ok R-ROUTE-3 edição autenticada ponta a ponta (sign-in real + HTTP real): 200, pedido gravado reflete a mudança, cliente intacto");
    console.log("ok R-ROUTE-4 cross-tenant através da rota real: 404");
    console.log("Order edit route tests passed: 4 casos.");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
