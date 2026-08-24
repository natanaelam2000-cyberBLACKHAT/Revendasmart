/**
 * RELEASE-07 — verificação server-side de compras Google Play Billing (Android) e entitlement único
 * server-owned (planData/main).
 *
 * Roda a aplicação Express REAL (registerRoutes) contra Firebase Auth/Firestore Emulator. A Google Play
 * Developer API é substituída por um mock injetado via `setGooglePlayDeveloperApiClientForTests()` —
 * ZERO chamada real à Google em qualquer cenário deste arquivo.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import { createServer, type Server } from "node:http";
import express from "express";
import { initializeApp, deleteApp, type FirebaseApp } from "firebase/app";
import { connectAuthEmulator, createUserWithEmailAndPassword, getAuth, type User } from "firebase/auth";
import {
  GooglePlayDeveloperApiNotConfiguredError,
  normalizeGooglePlaySubscriptionPurchase,
  type GooglePlayDeveloperApiClient,
} from "../server/google-play-developer-api";
import {
  PLAY_BILLING_BASE_PLAN_IDS,
  type GooglePlaySubscriptionPurchase,
} from "../shared/play-billing-contract";
import { hashGooglePlayAccountUid, hashPurchaseToken } from "../server/google-play-billing";

process.env.FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || "demo-revendasmart";
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || "127.0.0.1:9099";

function requireLocalEmulators(): void {
  assert.equal(process.env.FIRESTORE_EMULATOR_HOST, "127.0.0.1:8080");
  assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, "127.0.0.1:9099");
  assert.notEqual(process.env.GOOGLE_CLOUD_PROJECT, "revenda-smart");
}

const PACKAGE_NAME = "com.revendasmart.app";
const PRODUCT_ID = "revendasmart_premium_monthly";

function purchase(overrides: Partial<GooglePlaySubscriptionPurchase> = {}): GooglePlaySubscriptionPurchase {
  return {
    subscriptionState: "SUBSCRIPTION_STATE_ACTIVE",
    lineItemProductId: PRODUCT_ID,
    lineItemBasePlanId: PLAY_BILLING_BASE_PLAN_IDS[PRODUCT_ID],
    expiryTimeMillis: Date.now() + 30 * 24 * 60 * 60 * 1000,
    autoRenewing: true,
    acknowledgementState: "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED",
    orderId: "GPA.0000-0000-0000-00000",
    ...overrides,
  };
}

/** Mock simples: responde de acordo com um mapa `purchaseToken -> purchase`, registra chamadas de ack. */
function buildMockClient(tokenMap: Map<string, GooglePlaySubscriptionPurchase>, acknowledged: string[]): GooglePlayDeveloperApiClient {
  return {
    async getSubscriptionPurchase(input) {
      const found = tokenMap.get(input.purchaseToken);
      if (!found) throw new Error("purchase not found in mock");
      return found;
    },
    async acknowledgeSubscriptionPurchase(input) {
      acknowledged.push(input.purchaseToken);
    },
  };
}

function buildNotConfiguredClient(): GooglePlayDeveloperApiClient {
  return {
    async getSubscriptionPurchase() {
      throw new GooglePlayDeveloperApiNotConfiguredError();
    },
    async acknowledgeSubscriptionPurchase() {
      throw new GooglePlayDeveloperApiNotConfiguredError();
    },
  };
}

async function createTestUser(label: string): Promise<{ app: FirebaseApp; user: User }> {
  const app = initializeApp({
    apiKey: "demo-api-key",
    authDomain: `${process.env.FIREBASE_PROJECT_ID}.firebaseapp.com`,
    projectId: process.env.FIREBASE_PROJECT_ID,
    appId: `play-billing-${label}-${Date.now()}`,
  }, `play-billing-${label}-${Date.now()}-${Math.random()}`);
  const auth = getAuth(app);
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  const credential = await createUserWithEmailAndPassword(
    auth,
    `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`,
    "LocalTestPassword!123",
  );
  return { app, user: credential.user };
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

function randomToken(label: string): string {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function readText(path: string): string {
  return fs.readFileSync(path, "utf8");
}

function assertBillingPermissionPresentInMergedManifest(): void {
  const releaseManifest = readText("android/app/build/intermediates/merged_manifest/release/processReleaseMainManifest/AndroidManifest.xml");
  assert.match(releaseManifest, /com\.android\.vending\.BILLING/, "V: merged manifest de release precisa conter com.android.vending.BILLING");
}

async function run(): Promise<void> {
  requireLocalEmulators();

  const [{ registerRoutes }, { getFirebaseAdmin }, { setGooglePlayDeveloperApiClientForTests }] = await Promise.all([
    import("../server/routes"),
    import("../server/firebase-admin-init"),
    import("../server/google-play-developer-api"),
  ]);
  const app = express();
  app.use(express.json({ limit: "100kb" }));
  const server = createServer(app);
  await registerRoutes(server, app);
  const baseUrl = await listen(server);

  const admin = getFirebaseAdmin();
  const db = admin.firestore();
  const createdApps: FirebaseApp[] = [];

  const tokenMap = new Map<string, GooglePlaySubscriptionPurchase>();
  const acknowledged: string[] = [];
  setGooglePlayDeveloperApiClientForTests(buildMockClient(tokenMap, acknowledged));

  const verify = async (user: User, body: { productId: string; purchaseToken: string; packageName: string }) => {
    const token = await user.getIdToken();
    const response = await fetch(`${baseUrl}/api/billing/google-play/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    let responseBody: any = null;
    try { responseBody = await response.json(); } catch { /* ignore */ }
    return { status: response.status, body: responseBody };
  };

  const restore = async (user: User, purchases: Array<{ productId: string; purchaseToken: string; packageName: string }>) => {
    const token = await user.getIdToken();
    const response = await fetch(`${baseUrl}/api/billing/google-play/restore`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ purchases }),
    });
    let responseBody: any = null;
    try { responseBody = await response.json(); } catch { /* ignore */ }
    return { status: response.status, body: responseBody };
  };

  const getPlan = async (uid: string) => (await db.collection("users").doc(uid).collection("planData").doc("main").get()).data();

  // ===== A0/A1: normalizador puro do adapter real, sem rede =====
  const normalized = normalizeGooglePlaySubscriptionPurchase({
    subscriptionState: "SUBSCRIPTION_STATE_ACTIVE",
    acknowledgementState: "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED",
    lineItems: [{
      productId: PRODUCT_ID,
      expiryTime: new Date(Date.now() + 86_400_000).toISOString(),
      latestSuccessfulOrderId: "GPA.1111-2222-3333-44444",
      autoRenewingPlan: { autoRenewEnabled: true },
      offerDetails: { basePlanId: PLAY_BILLING_BASE_PLAN_IDS[PRODUCT_ID] },
    }],
  });
  assert.equal(normalized.lineItemProductId, PRODUCT_ID);
  assert.equal(normalized.lineItemBasePlanId, PLAY_BILLING_BASE_PLAN_IDS[PRODUCT_ID]);
  assert.equal(normalized.autoRenewing, true);
  assert.equal(normalized.acknowledgementState, "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED");
  assert.throws(
    () => normalizeGooglePlaySubscriptionPurchase({
      subscriptionState: "SUBSCRIPTION_STATE_ACTIVE",
      acknowledgementState: "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED",
      lineItems: [{ productId: PRODUCT_ID, expiryTime: "not-a-date" }],
    }),
    /expiryTime inv/i,
  );

  try {
    // ===== A: sem chamar verify, nenhum entitlement forjado é concedido =====
    {
      const user = await createTestUser("forged");
      createdApps.push(user.app);
      const plan = await getPlan(user.user.uid);
      assert.equal(plan, undefined, "A: nenhum planData é criado sem uma verificação real");
    }

    // ===== B: compra válida e ativa concede Premium =====
    {
      const user = await createTestUser("valid");
      createdApps.push(user.app);
      const token = randomToken("valid");
      tokenMap.set(token, purchase());
      const result = await verify(user.user, { productId: PRODUCT_ID, purchaseToken: token, packageName: PACKAGE_NAME });
      assert.equal(result.status, 200, "B: compra válida precisa ser aceita");
      assert.equal(result.body.premiumActive, true);
      assert.equal(result.body.currentPlan, "premium");
      const plan = await getPlan(user.user.uid);
      assert.equal(plan?.billingProvider, "google_play");
      assert.equal(plan?.playProductId, PRODUCT_ID);
      assert.notEqual(plan?.playPurchaseTokenHash, token, "B: nunca persiste o token bruto, só o hash");
    }

    // ===== C: assinatura expirada não concede Premium =====
    {
      const user = await createTestUser("expired");
      createdApps.push(user.app);
      const token = randomToken("expired");
      tokenMap.set(token, purchase({ subscriptionState: "SUBSCRIPTION_STATE_EXPIRED", acknowledgementState: "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED" }));
      const result = await verify(user.user, { productId: PRODUCT_ID, purchaseToken: token, packageName: PACKAGE_NAME });
      assert.equal(result.status, 200);
      assert.equal(result.body.premiumActive, false, "C: expirada nunca vira premium");
    }

    // ===== D: grace period ainda concede Premium =====
    {
      const user = await createTestUser("grace");
      createdApps.push(user.app);
      const token = randomToken("grace");
      tokenMap.set(token, purchase({ subscriptionState: "SUBSCRIPTION_STATE_IN_GRACE_PERIOD" }));
      const result = await verify(user.user, { productId: PRODUCT_ID, purchaseToken: token, packageName: PACKAGE_NAME });
      assert.equal(result.body.premiumActive, true, "D: grace period ainda é premium");
    }

    // ===== E: cancelada mas ainda dentro do período pago (Google reporta ACTIVE, autoRenewing=false) mantém entitlement =====
    {
      const user = await createTestUser("canceled-active");
      createdApps.push(user.app);
      const token = randomToken("canceled-active");
      tokenMap.set(token, purchase({ autoRenewing: false }));
      const result = await verify(user.user, { productId: PRODUCT_ID, purchaseToken: token, packageName: PACKAGE_NAME });
      assert.equal(result.body.premiumActive, true, "E: cancelamento de auto-renovação não revoga o período já pago");
      assert.equal(result.body.autoRenew, false);
    }

    // ===== F: revogação/refund (reverificação passa a reportar EXPIRED) remove o entitlement =====
    {
      const user = await createTestUser("revoked");
      createdApps.push(user.app);
      const token = randomToken("revoked");
      tokenMap.set(token, purchase());
      const first = await verify(user.user, { productId: PRODUCT_ID, purchaseToken: token, packageName: PACKAGE_NAME });
      assert.equal(first.body.premiumActive, true);
      tokenMap.set(token, purchase({ subscriptionState: "SUBSCRIPTION_STATE_EXPIRED" }));
      const second = await verify(user.user, { productId: PRODUCT_ID, purchaseToken: token, packageName: PACKAGE_NAME });
      assert.equal(second.body.premiumActive, false, "F: refund/revoke reflete e remove o entitlement");
      const plan = await getPlan(user.user.uid);
      assert.equal(plan?.premiumActive, false);
    }

    // ===== G: packageName forjado é rejeitado =====
    {
      const user = await createTestUser("bad-package");
      createdApps.push(user.app);
      const token = randomToken("bad-package");
      tokenMap.set(token, purchase());
      const result = await verify(user.user, { productId: PRODUCT_ID, purchaseToken: token, packageName: "com.attacker.fake" });
      assert.equal(result.status, 400);
      assert.equal(result.body.error, "PACKAGE_NAME_MISMATCH");
      const plan = await getPlan(user.user.uid);
      assert.equal(plan, undefined, "G: nenhum entitlement é criado");
    }

    // ===== H: productId desconhecido/forjado é rejeitado =====
    {
      const user = await createTestUser("bad-product");
      createdApps.push(user.app);
      const token = randomToken("bad-product");
      const result = await verify(user.user, { productId: "revendasmart_free_forever", purchaseToken: token, packageName: PACKAGE_NAME });
      assert.equal(result.status, 400);
      assert.equal(result.body.error, "UNKNOWN_PRODUCT_ID");
    }

    {
      const user = await createTestUser("bad-base-plan");
      createdApps.push(user.app);
      const token = randomToken("bad-base-plan");
      tokenMap.set(token, purchase({ lineItemBasePlanId: "wrong-base-plan" }));
      const result = await verify(user.user, { productId: PRODUCT_ID, purchaseToken: token, packageName: PACKAGE_NAME });
      assert.equal(result.status, 400);
      assert.equal(result.body.error, "BASE_PLAN_MISMATCH");
    }

    // ===== I: mesmo purchaseToken usado por uma SEGUNDA conta é bloqueado (ownership) =====
    {
      const owner = await createTestUser("token-owner");
      createdApps.push(owner.app);
      const intruder = await createTestUser("token-intruder");
      createdApps.push(intruder.app);
      const token = randomToken("shared");
      tokenMap.set(token, purchase());
      const first = await verify(owner.user, { productId: PRODUCT_ID, purchaseToken: token, packageName: PACKAGE_NAME });
      assert.equal(first.status, 200);
      const second = await verify(intruder.user, { productId: PRODUCT_ID, purchaseToken: token, packageName: PACKAGE_NAME });
      assert.equal(second.status, 409, "I: token já amarrado a outra conta é rejeitado");
      assert.equal(second.body.error, "PURCHASE_TOKEN_OWNED_BY_ANOTHER_ACCOUNT");
      const intruderPlan = await getPlan(intruder.user.uid);
      assert.equal(intruderPlan, undefined, "I: intruso nunca ganha entitlement");
    }

    // ===== I2: primeira vinculação com ObfuscatedAccountId de outra conta é bloqueada =====
    {
      const owner = await createTestUser("obfuscated-owner");
      createdApps.push(owner.app);
      const intruder = await createTestUser("obfuscated-intruder");
      createdApps.push(intruder.app);
      const token = randomToken("obfuscated-shared");
      tokenMap.set(token, purchase({ obfuscatedExternalAccountId: hashGooglePlayAccountUid(owner.user.uid) }));

      const hijackAttempt = await verify(intruder.user, { productId: PRODUCT_ID, purchaseToken: token, packageName: PACKAGE_NAME });
      assert.equal(hijackAttempt.status, 409, "I2: token com ObfuscatedAccountId de outro UID não pode ser sequestrado na primeira verificação");
      assert.equal(hijackAttempt.body.error, "PURCHASE_ACCOUNT_MISMATCH");
      assert.equal(await db.collection("googlePlayPurchaseTokens").doc(hashPurchaseToken(token)).get().then((doc) => doc.exists), false,
        "I2: nenhuma vinculação é persistida para a tentativa rejeitada");

      const legitimateVerify = await verify(owner.user, { productId: PRODUCT_ID, purchaseToken: token, packageName: PACKAGE_NAME });
      assert.equal(legitimateVerify.status, 200, "I2: o dono legítimo continua conseguindo verificar a compra depois da tentativa rejeitada");
    }

    // ===== J: reverificar o MESMO token pela mesma conta é idempotente (deduplicated) =====
    {
      const user = await createTestUser("idempotent");
      createdApps.push(user.app);
      const token = randomToken("idempotent");
      tokenMap.set(token, purchase());
      const first = await verify(user.user, { productId: PRODUCT_ID, purchaseToken: token, packageName: PACKAGE_NAME });
      assert.equal(first.body.deduplicated, false);
      const second = await verify(user.user, { productId: PRODUCT_ID, purchaseToken: token, packageName: PACKAGE_NAME });
      assert.equal(second.status, 200);
      assert.equal(second.body.deduplicated, true, "J: mesma conta reenviando o mesmo token é reconhecida como duplicada");
    }

    // ===== K: lineItemProductId devolvido pela Google diverge do productId pedido =====
    {
      const user = await createTestUser("product-mismatch");
      createdApps.push(user.app);
      const token = randomToken("product-mismatch");
      tokenMap.set(token, purchase({ lineItemProductId: "revendasmart_premium_yearly" }));
      const result = await verify(user.user, { productId: PRODUCT_ID, purchaseToken: token, packageName: PACKAGE_NAME });
      assert.equal(result.status, 400);
      assert.equal(result.body.error, "PRODUCT_ID_MISMATCH");
    }

    // ===== L: compra pendente não concede Premium =====
    {
      const user = await createTestUser("pending");
      createdApps.push(user.app);
      const token = randomToken("pending");
      tokenMap.set(token, purchase({ subscriptionState: "SUBSCRIPTION_STATE_PENDING" }));
      const result = await verify(user.user, { productId: PRODUCT_ID, purchaseToken: token, packageName: PACKAGE_NAME });
      assert.equal(result.body.premiumActive, false, "L: pendente nunca é premium");
    }

    // ===== M: acknowledgement pendente é confirmado após a concessão =====
    {
      const user = await createTestUser("ack");
      createdApps.push(user.app);
      const token = randomToken("ack");
      tokenMap.set(token, purchase({ acknowledgementState: "ACKNOWLEDGEMENT_STATE_PENDING" }));
      const result = await verify(user.user, { productId: PRODUCT_ID, purchaseToken: token, packageName: PACKAGE_NAME });
      assert.equal(result.status, 200);
      assert.ok(acknowledged.includes(token), "M: acknowledge foi chamado para uma compra pendente de confirmação");
    }

    // ===== N: Google Play API não configurada nunca finge sucesso =====
    {
      setGooglePlayDeveloperApiClientForTests(buildNotConfiguredClient());
      const user = await createTestUser("not-configured");
      createdApps.push(user.app);
      const result = await verify(user.user, { productId: PRODUCT_ID, purchaseToken: randomToken("nc"), packageName: PACKAGE_NAME });
      assert.equal(result.status, 503);
      assert.equal(result.body.error, "GOOGLE_PLAY_API_NOT_CONFIGURED");
      const plan = await getPlan(user.user.uid);
      assert.equal(plan, undefined, "N: nunca concede Premium quando a verificação real está indisponível");
      setGooglePlayDeveloperApiClientForTests(buildMockClient(tokenMap, acknowledged));
    }

    // ===== O: restore (reinstalação/troca de device) reaplica várias compras de uma vez =====
    {
      const user = await createTestUser("restore");
      createdApps.push(user.app);
      const tokenA = randomToken("restore-a");
      tokenMap.set(tokenA, purchase());
      const result = await restore(user.user, [{ productId: PRODUCT_ID, purchaseToken: tokenA, packageName: PACKAGE_NAME }]);
      assert.equal(result.status, 200);
      assert.equal(result.body.results.length, 1);
      assert.equal(result.body.results[0].premiumActive, true, "O: restore aplica o entitlement real, sem precisar de estado local salvo");
    }

    // ===== P: sem autenticação é rejeitado =====
    {
      const response = await fetch(`${baseUrl}/api/billing/google-play/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId: PRODUCT_ID, purchaseToken: "x", packageName: PACKAGE_NAME }),
      });
      assert.equal(response.status, 401);
    }

    // ===== Q: RTDN reconcilia um token já conhecido sem depender do client abrir o app =====
    {
      const user = await createTestUser("rtdn");
      createdApps.push(user.app);
      const token = randomToken("rtdn");
      tokenMap.set(token, purchase());
      const initial = await verify(user.user, { productId: PRODUCT_ID, purchaseToken: token, packageName: PACKAGE_NAME });
      assert.equal(initial.body.premiumActive, true);

      // Google revoga a compra (ex.: refund) — a notificação chega antes do usuário abrir o app de novo.
      tokenMap.set(token, purchase({ subscriptionState: "SUBSCRIPTION_STATE_EXPIRED" }));
      const envelope = {
        message: {
          data: Buffer.from(JSON.stringify({
            packageName: PACKAGE_NAME,
            subscriptionNotification: { version: "1.0", notificationType: 13, purchaseToken: token, subscriptionId: PRODUCT_ID },
          })).toString("base64"),
        },
        subscription: "projects/demo/subscriptions/rtdn",
      };
      const rtdnResponse = await fetch(`${baseUrl}/api/billing/google-play/rtdn`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(envelope),
      });
      assert.equal(rtdnResponse.status, 200, "Q: RTDN sempre responde 200 para não gerar retry infinito do Pub/Sub");
      const plan = await getPlan(user.user.uid);
      assert.equal(plan?.premiumActive, false, "Q: a notificação disparou uma REVERIFICAÇÃO real, não confiou no conteúdo dela sozinho");
    }

    // ===== R: provider response malformada (mock lança um erro genérico) -> fail closed =====
    {
      const user = await createTestUser("malformed");
      createdApps.push(user.app);
      const token = randomToken("malformed");
      const brokenClient: GooglePlayDeveloperApiClient = {
        async getSubscriptionPurchase() {
          throw new Error("resposta não-JSON da Google Play Developer API");
        },
        async acknowledgeSubscriptionPurchase() {
          throw new Error("resposta não-JSON da Google Play Developer API");
        },
      };
      setGooglePlayDeveloperApiClientForTests(brokenClient);
      const result = await verify(user.user, { productId: PRODUCT_ID, purchaseToken: token, packageName: PACKAGE_NAME });
      assert.equal(result.status, 502, "R: resposta malformada nunca concede Premium");
      assert.equal(result.body.error, "GOOGLE_PLAY_VERIFICATION_FAILED");
      const plan = await getPlan(user.user.uid);
      assert.equal(plan, undefined);
      setGooglePlayDeveloperApiClientForTests(buildMockClient(tokenMap, acknowledged));
    }

    // ===== U: subscriptionState desconhecido (nunca visto hoje) -> fail closed, nunca ACTIVE =====
    {
      const user = await createTestUser("unknown-state");
      createdApps.push(user.app);
      const token = randomToken("unknown-state");
      tokenMap.set(token, purchase({ subscriptionState: "SUBSCRIPTION_STATE_UNSPECIFIED" }));
      const result = await verify(user.user, { productId: PRODUCT_ID, purchaseToken: token, packageName: PACKAGE_NAME });
      assert.equal(result.status, 502, "U: state desconhecido nunca vira 200");
      assert.equal(result.body.error, "GOOGLE_PLAY_VERIFICATION_FAILED");
      const plan = await getPlan(user.user.uid);
      assert.equal(plan, undefined, "U: nenhum entitlement é concedido para state desconhecido");
    }

    // ===== V: concorrência (2 verifies simultâneos do mesmo token/UID) -> um único grant consistente =====
    {
      const user = await createTestUser("concurrent");
      createdApps.push(user.app);
      const token = randomToken("concurrent");
      tokenMap.set(token, purchase());
      const [first, second] = await Promise.all([
        verify(user.user, { productId: PRODUCT_ID, purchaseToken: token, packageName: PACKAGE_NAME }),
        verify(user.user, { productId: PRODUCT_ID, purchaseToken: token, packageName: PACKAGE_NAME }),
      ]);
      assert.equal(first.status, 200);
      assert.equal(second.status, 200);
      assert.equal(first.body.premiumActive, true);
      assert.equal(second.body.premiumActive, true);
      const plan = await getPlan(user.user.uid);
      assert.equal(plan?.playPurchaseTokenHash, hashPurchaseToken(token), "V: mesmo par uid/token concorrente converge para um único hash consistente");
      assert.equal(plan?.premiumActive, true);
    }

    console.log("Play Billing tests passed: verify, restore, RTDN, ownership, idempotency, acknowledgement — zero chamada real à Google.");
    assert.doesNotMatch(readText("server/google-play-billing.ts"), /pb(?:Info|Warn|Error)\([^)]*purchaseToken/s, "R: purchaseToken bruto nunca aparece nos logs estruturados");
    assertBillingPermissionPresentInMergedManifest();
  } finally {
    await close(server);
    await Promise.allSettled(createdApps.map((app) => deleteApp(app)));
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exit(1);
});
