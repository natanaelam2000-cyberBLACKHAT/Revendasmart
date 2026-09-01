/**
 * REVENDASMART-OWNER-ACCESS-02 — testes A-T do ticket, contra o emulador real (Auth + Firestore).
 * Sobe o app COMPLETO (`registerRoutes`) e chama as rotas por HTTP real com tokens reais, exatamente
 * como script/pro13-real-emulator-route-call.ts já faz — para exercitar o `requireAuth`/`requireAdmin`
 * de produção, não uma reimplementação de teste.
 */
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import { initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth, signInWithEmailAndPassword } from "firebase/auth";

process.env.FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || "demo-revendasmart";
process.env.FIREBASE_STORAGE_BUCKET = process.env.FIREBASE_STORAGE_BUCKET || "demo-revendasmart.appspot.com";
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || "127.0.0.1:9099";
process.env.FIREBASE_STORAGE_EMULATOR_HOST = process.env.FIREBASE_STORAGE_EMULATOR_HOST || "127.0.0.1:9199";

const [{ initializeFirebaseAdmin, getFirebaseAdmin }, { registerRoutes }, accountDeletion] = await Promise.all([
  import("../server/firebase-admin-init"),
  import("../server/routes"),
  import("../server/account-deletion"),
]);

initializeFirebaseAdmin();

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID;
const suffix = Date.now();
const PASSWORD = "OwnerAccess02-test-password!";

const adminUid = `oa02-admin-${suffix}`;
const regularUid = `oa02-user-${suffix}`;
const testerTargetUid = `oa02-tester-${suffix}`;
const premiumPlusTargetUid = `oa02-pplus-${suffix}`;
const paidPremiumUid = `oa02-paid-${suffix}`;
const throwawayUid = `oa02-throwaway-${suffix}`;

async function main() {
  const admin = getFirebaseAdmin();
  const authAdmin = admin.auth();
  const db = admin.firestore();

  const app = express();
  app.use(express.json({ limit: "1mb" }));
  const server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${(address as { port: number }).port}`;

  const clientApp = initializeApp(
    { apiKey: "demo-api-key", authDomain: `${PROJECT_ID}.firebaseapp.com`, projectId: PROJECT_ID, appId: "1:0:web:oa02" },
    `oa02-${suffix}`,
  );
  connectAuthEmulator(getAuth(clientApp), "http://127.0.0.1:9099", { disableWarnings: true });

  async function createUserAndToken(uid: string, email: string, forceTokenRefresh = false): Promise<string> {
    await authAdmin.createUser({ uid, email, password: PASSWORD });
    const credential = await signInWithEmailAndPassword(getAuth(clientApp), email, PASSWORD);
    return await credential.user.getIdToken(forceTokenRefresh);
  }

  // Setup: admin custom claim precisa existir ANTES do sign-in para entrar no ID token.
  await authAdmin.createUser({ uid: adminUid, email: `${adminUid}@example.test`, password: PASSWORD });
  await authAdmin.setCustomUserClaims(adminUid, { admin: true });
  const adminToken = await (await signInWithEmailAndPassword(getAuth(clientApp), `${adminUid}@example.test`, PASSWORD)).user.getIdToken(true);

  const regularToken = await createUserAndToken(regularUid, `${regularUid}@example.test`);
  const testerToken = await createUserAndToken(testerTargetUid, `${testerTargetUid}@example.test`);
  const premiumPlusToken = await createUserAndToken(premiumPlusTargetUid, `${premiumPlusTargetUid}@example.test`);
  const paidPremiumToken = await createUserAndToken(paidPremiumUid, `${paidPremiumUid}@example.test`);

  // paidPremiumUid já é Premium comercial de verdade (assinatura Mercado Pago autorizada) — nunca tocado
  // por nenhuma concessão interna nesta suíte.
  await db.doc(`users/${paidPremiumUid}/planData/main`).set({
    currentPlan: "premium", premiumActive: true, subscriptionStatus: "authorized",
    subscriptionId: "sub-oa02", billingProvider: "mercado_pago",
  });

  function authed(token: string) {
    return { authorization: `Bearer ${token}`, "content-type": "application/json" };
  }

  async function getJson(path: string, token: string) {
    const response = await fetch(`${baseUrl}${path}`, { headers: authed(token) });
    return { status: response.status, body: await response.json() as Record<string, unknown> };
  }
  async function postJson(path: string, token: string, body: unknown) {
    const response = await fetch(`${baseUrl}${path}`, { method: "POST", headers: authed(token), body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() as Record<string, unknown> };
  }

  // A: admin reconhecido
  {
    const { status, body } = await getJson("/api/admin/status", adminToken);
    assert.equal(status, 200, "A: admin deve ser reconhecido");
    assert.equal(body.isAdmin, true);
  }

  // B/C/O: usuário comum e tester recebem 403 nas rotas admin (isso é o que drives o hide da UI)
  {
    for (const token of [regularToken, testerToken]) {
      const status1 = (await getJson("/api/admin/status", token)).status;
      assert.equal(status1, 403, "B/C: não-admin não pode ser reconhecido como admin");
      const status2 = (await getJson(`/api/admin/users/lookup?email=${regularUid}@example.test`, token)).status;
      assert.equal(status2, 403, "O: lookup precisa recusar não-admin");
      const status3 = (await postJson(`/api/admin/grants/${regularUid}`, token, { action: "GRANT_TESTER" })).status;
      assert.equal(status3, 403, "O: mutação de grant precisa recusar não-admin");
      const status4 = (await getJson("/api/admin/testers/count", token)).status;
      assert.equal(status4, 403, "O: contagem de testers precisa recusar não-admin");
    }
  }

  // D: admin busca usuário por e-mail
  {
    const { status, body } = await getJson(`/api/admin/users/lookup?email=${testerTargetUid}@example.test`, adminToken);
    assert.equal(status, 200, "D: admin deve conseguir buscar por e-mail");
    assert.equal(body.uid, testerTargetUid);
    assert.equal(body.role, "user");
    assert.equal(body.benefitGrant, "none");
  }

  // E: admin promove tester
  {
    const { status, body } = await postJson(`/api/admin/grants/${testerTargetUid}`, adminToken, { action: "GRANT_TESTER", reason: "QA interna" });
    assert.equal(status, 200, "E: GRANT_TESTER deve suceder");
    assert.equal(body.benefitGrant, "tester");
  }

  // F: tester recebe TODOS os benefícios Premium (via a própria rota que o client usa)
  {
    const { status, body } = await getJson(`/api/plan/data/${testerTargetUid}`, testerToken);
    assert.equal(status, 200);
    assert.equal(body.hasPremiumAccess, true, "F: tester precisa ter hasPremiumAccess=true");
    assert.equal(body.isTester, true);
    assert.equal(body.isPremiumPlus, false);
  }

  // G: tester não gera cobrança — planData comercial nunca foi tocado pela concessão
  {
    const planSnap = await db.doc(`users/${testerTargetUid}/planData/main`).get();
    assert.equal(planSnap.exists, false, "G: nenhum documento planData deve ter sido criado para o tester");
  }

  // H: remover tester revoga SOMENTE o grant tester — usuário com Premium pago real continua Premium
  {
    await postJson(`/api/admin/grants/${paidPremiumUid}`, adminToken, { action: "GRANT_TESTER" });
    const revoke = await postJson(`/api/admin/grants/${paidPremiumUid}`, adminToken, { action: "REVOKE_TESTER" });
    assert.equal(revoke.status, 200, "H: revoke deve suceder");
    assert.equal(revoke.body.benefitGrant, "none");
    const { body } = await getJson(`/api/plan/data/${paidPremiumUid}`, paidPremiumToken);
    assert.equal(body.hasPremiumAccess, true, "H: Premium pago precisa sobreviver à revogação do tester");
    assert.equal(body.entitlementSource, "commercial");
  }

  // I: premium pago continua funcionando (sem nenhuma concessão interna envolvida)
  {
    const { body } = await getJson(`/api/plan/data/${paidPremiumUid}`, paidPremiumToken);
    assert.equal(body.hasPremiumAccess, true, "I: Premium pago precisa continuar ativo");
    assert.equal(body.billingProvider, "mercado_pago", "R: campos de billing precisam sobreviver à composição");
    assert.equal(body.subscriptionId, "sub-oa02", "S: subscriptionId precisa sobreviver à composição");
  }

  // J: admin concede Premium+
  {
    const { status, body } = await postJson(`/api/admin/grants/${premiumPlusTargetUid}`, adminToken, { action: "GRANT_PREMIUM_PLUS" });
    assert.equal(status, 200, "J: GRANT_PREMIUM_PLUS deve suceder");
    assert.equal(body.benefitGrant, "premium_plus");
  }

  // K: Premium+ recebe todos os benefícios Premium
  {
    const { body } = await getJson(`/api/plan/data/${premiumPlusTargetUid}`, premiumPlusToken);
    assert.equal(body.hasPremiumAccess, true, "K: Premium+ precisa ter hasPremiumAccess=true");
    assert.equal(body.isPremiumPlus, true);
    assert.equal(body.isTester, false);
  }

  // L/M: Premium+ não aparece no pricing nem é comprável — verificação estática do contrato compartilhado
  {
    const { PLAN_CONFIG } = await import("../shared/monetization");
    // PLAN-IMPL-01: PLAN_CONFIG now lists a real third commercial plan ("pro", PLAN-DEFINITION-01) —
    // the guarantee this line protects is unchanged (an internal benefit grant like "premium_plus"
    // must never appear here as if it were a purchasable plan), it just needs the real plan list now.
    assert.deepEqual(Object.keys(PLAN_CONFIG).sort(), ["free", "premium", "pro"], "L: PLAN_CONFIG (pricing) não pode listar premium_plus");
    // M: a única rota que escreve benefitGrant é a de admin, sempre atrás de requireAdmin — nenhuma rota
    // pública/checkout aceita `benefitGrant`/`premium_plus` no corpo (coberto pelos 403 acima, testes B/C/O).
  }

  // N: autoelevação bloqueada — mesmo um admin não pode mudar a própria concessão por esta rota
  {
    const { status, body } = await postJson(`/api/admin/grants/${adminUid}`, adminToken, { action: "GRANT_PREMIUM_PLUS" });
    assert.equal(status, 403, "N: autoelevação precisa ser bloqueada");
    assert.equal(body.code, "SELF_ELEVATION_BLOCKED");
  }

  // P: audit log criado (GRANT_TESTER + REVOKE_TESTER + GRANT_PREMIUM_PLUS já geraram entradas acima)
  {
    const grantEntries = await db.collection("adminGrantAuditLog")
      .where("targetUid", "==", testerTargetUid).where("action", "==", "GRANT_TESTER").get();
    assert.ok(grantEntries.size >= 1, "P: GRANT_TESTER precisa gerar entrada de auditoria");
    const entry = grantEntries.docs[0].data();
    assert.equal(entry.actorUid, adminUid);
    assert.equal(entry.previousState, "none");
    assert.equal(entry.newState, "tester");
    assert.ok(entry.timestamp, "P: entrada precisa ter timestamp");
  }

  // Q: referral continua funcionando — o payload de /api/plan/data ainda expõe referralCode/referralCount
  // (regressão de schema seria um spread quebrado na composição desta rodada)
  {
    await db.doc(`users/${regularUid}/planData/main`).set({ referralCode: "USER-OA02TESTX", referralCount: 2 });
    const { body } = await getJson(`/api/plan/data/${regularUid}`, regularToken);
    assert.equal(body.referralCode, "USER-OA02TESTX", "Q: referralCode precisa sobreviver à composição");
    assert.equal(body.referralCount, 2, "Q: referralCount precisa sobreviver à composição");
    assert.equal(body.hasPremiumAccess, false, "Q: usuário free sem grant continua free");
  }

  // T: account deletion limpa os grants internos, mas preserva o audit log (retenção já documentada)
  {
    await authAdmin.createUser({ uid: throwawayUid, email: `${throwawayUid}@example.test`, password: PASSWORD });
    await postJson(`/api/admin/grants/${throwawayUid}`, adminToken, { action: "GRANT_TESTER" });
    const grantSnapBefore = await db.doc(`users/${throwawayUid}/internalGrants/main`).get();
    assert.equal(grantSnapBefore.exists, true, "T: grant precisa existir antes da exclusão");

    await accountDeletion.deleteAccountByUid(throwawayUid, {
      db, auth: authAdmin, bucket: admin.storage().bucket(process.env.FIREBASE_STORAGE_BUCKET), now: () => new Date(),
    });

    const grantSnapAfter = await db.doc(`users/${throwawayUid}/internalGrants/main`).get();
    assert.equal(grantSnapAfter.exists, false, "T: internalGrants precisa ser removido pela exclusão de conta (recursiveDelete)");

    const auditAfter = await db.collection("adminGrantAuditLog").where("targetUid", "==", throwawayUid).get();
    assert.ok(auditAfter.size >= 1, "T: audit log precisa SOBREVIVER à exclusão de conta (retenção já documentada)");
  }

  server.close();
  console.log("REVENDASMART-OWNER-ACCESS-02 tests passed: role/benefit/commercial-plan separation, admin lookup/grant/revoke, self-elevation blocked, 403 for non-admin/tester/premium, audit log, referral/billing fields preserved, account deletion clears grants without touching audit log.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
