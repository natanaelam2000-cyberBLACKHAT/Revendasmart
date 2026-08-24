/**
 * RELEASE-02 — mass assignment em /api/user/settings/:userId e referral farming via conta descartável.
 *
 * Roda a aplicação Express REAL (registerRoutes) contra o Firebase Auth/Firestore Emulator, com contas
 * de teste reais criadas via Firebase Auth — reproduz os exploits end-to-end (não só a função pura) e
 * confirma que continuam bloqueados.
 */
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import express from "express";
import { initializeApp, deleteApp, type FirebaseApp } from "firebase/app";
import { connectAuthEmulator, createUserWithEmailAndPassword, getAuth, type User } from "firebase/auth";
import { connectFirestoreEmulator, getFirestore, type Firestore } from "firebase/firestore";

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
    appId: `referral-${label}-${Date.now()}`,
  }, `referral-${label}-${Date.now()}-${Math.random()}`);
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function run(): Promise<void> {
  requireLocalEmulators();

  const [{ registerRoutes, MIN_REFERRAL_ACCOUNT_AGE_MS }, { getFirebaseAdmin }] = await Promise.all([
    import("../server/routes"),
    import("../server/firebase-admin-init"),
  ]);
  const app = express();
  app.use(express.json({ limit: "100kb" }));
  const server = createServer(app);
  await registerRoutes(server, app);
  const baseUrl = await listen(server);

  const admin = getFirebaseAdmin();
  const db = admin.firestore();
  const createdApps: FirebaseApp[] = [];

  const postJson = async (user: User, path: string, body: Record<string, unknown>) => {
    const token = await user.getIdToken();
    return fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
  };
  const postWithoutBody = async (user: User, path: string) => {
    const token = await user.getIdToken();
    return fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
  };
  const postSettings = (user: User, pathUid: string, body: Record<string, unknown>) => postJson(user, `/api/user/settings/${pathUid}`, body);
  const trackEvent = (user: User, referrerUID: string) => postJson(user, "/api/referral/track-event", { referrerUID, event: "onboarding_completed" });
  const validateReferral = (user: User, referrerUID: string) => postJson(user, "/api/referral/validate-referral", { referrerUID });
  const planData = (uid: string) => db.doc(`users/${uid}/planData/main`).get();

  try {
    const referrer = await createTestUser("referrer");
    createdApps.push(referrer.app);
    const referrerUid = referrer.user.uid;
    const initReferrerPlan = await postWithoutBody(referrer.user, `/api/plan/initialize/${referrerUid}`);
    assert.equal(initReferrerPlan.status, 200, "A: plan initialize do referrer precisa funcionar");
    const initReferrerBody = await initReferrerPlan.json() as { referralCode?: string };
    assert.match(String(initReferrerBody.referralCode ?? ""), /^USER-[A-Z0-9]{9}$/, "A: referralCode público é emitido pelo servidor");
    const referralCode = String(initReferrerBody.referralCode);
    const publicLink = `https://revendasmart.vercel.app/?referral=${referralCode}`;
    assert.match(publicLink, /\?referral=USER-[A-Z0-9]{9}$/u, "A: novo link público usa referralCode");
    assert.doesNotMatch(publicLink, new RegExp(referrerUid.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), "B: novo link público não expõe o UID bruto");

    // ===== A/O: campo permitido persiste; campo desconhecido não vira mass assignment de nada sensível =====
    const legitSave = await postSettings(referrer.user, referrerUid, { storeName: "Loja Referrer", someUnknownField: "hello" });
    assert.equal(legitSave.status, 200, "A: campo permitido deveria salvar normalmente");
    const referrerSettingsAfterLegit = await db.doc(`user_settings/${referrerUid}`).get();
    assert.equal(referrerSettingsAfterLegit.data()?.storeName, "Loja Referrer");
    assert.equal(referrerSettingsAfterLegit.data()?.someUnknownField, "hello", "O: campo desconhecido persiste como dado inofensivo (não é sensível, não é bloqueado)");

    // ===== B-F: campos server-owned injetados no body nunca persistem =====
    const attackerSave = await postSettings(referrer.user, referrerUid, {
      storeName: "Loja Referrer",
      uid: "attacker-uid",
      userId: "attacker-uid",
      ownerId: "attacker-uid",
      ownerUid: "attacker-uid",
      tenantId: "attacker-tenant",
      isAdmin: true,
      role: "admin",
      plan: "premium",
      currentPlan: "premium",
      premium: true,
      premiumActive: true,
      referralReward: 999,
      rewardGranted: true,
      referral_conversions: 999,
      referred_users: ["fake-1", "fake-2", "fake-3"],
    });
    assert.equal(attackerSave.status, 200);
    const referrerSettingsAfterAttack = await db.doc(`user_settings/${referrerUid}`).get();
    for (const field of [
      "uid", "userId", "ownerId", "ownerUid", "tenantId", "isAdmin", "role", "plan", "currentPlan",
      "premium", "premiumActive", "referralReward", "rewardGranted", "referral_conversions", "referred_users",
    ]) {
      assert.equal(referrerSettingsAfterAttack.data()?.[field], undefined, `B-F: ${field} não pode persistir vindo do body do cliente`);
    }
    const referrerPlanAfterAttack = await planData(referrerUid);
    assert.equal(referrerPlanAfterAttack.exists, true, "E: planData inicial continua existindo");
    assert.equal(referrerPlanAfterAttack.data()?.currentPlan, "free", "E: settings malicioso não promove o plano");
    assert.equal(referrerPlanAfterAttack.data()?.premiumActive, false, "E: settings malicioso não ativa Premium");

    // ===== G/K: conta descartável forjando onboarding_completed, sem esperar, não concede referral =====
    const disposable = await createTestUser("disposable-fresh");
    createdApps.push(disposable.app);
    const disposableUid = disposable.user.uid;
    const disposableOnboarding = await postSettings(disposable.user, disposableUid, { onboarding_completed: true, storeName: "Loja Descartável" });
    assert.equal(disposableOnboarding.status, 200, "onboarding_completed continua sendo um campo de UX legítimo, gravável pelo próprio usuário");

    const freshTrack = await trackEvent(disposable.user, referrerUid);
    assert.equal(freshTrack.status, 400, "G/K: conta recém-criada com onboarding_completed forjado não pode iniciar um referral válido");
    const freshTrackBody = await freshTrack.json() as { error?: string };
    assert.equal(freshTrackBody.error, "REFERRAL_ACCOUNT_TOO_NEW");
    const referrerPlanAfterFreshAttempt = await planData(referrerUid);
    assert.equal(referrerPlanAfterFreshAttempt.exists, true, "G/K: o plano inicial do referrer continua existindo");
    assert.equal(referrerPlanAfterFreshAttempt.data()?.referralCount, 0, "G/K: tentativa descartável não incrementa referralCount");
    assert.equal(referrerPlanAfterFreshAttempt.data()?.premiumActive, false, "G/K: tentativa descartável não concede Premium");

    // ===== H: self-referral bloqueado, independente da idade da conta =====
    const selfReferralAttempt = await trackEvent(disposable.user, disposableUid);
    assert.equal(selfReferralAttempt.status, 400);
    assert.equal((await selfReferralAttempt.json() as { error?: string }).error, "SELF_REFERRAL_NOT_ALLOWED");

    // ===== L/I/J/M: referral legítimo (conta com idade real) funciona e é idempotente =====
    // As contas precisam nascer ANTES da espera — criar depois de dormir manteria `creationTime`
    // recente e cairia no mesmo bloqueio testado acima. Usa a MESMA constante que a rota aplica, nunca
    // um valor hardcoded solto.
    const legitAccounts = await Promise.all([0, 1, 2].map((index) => createTestUser(`legit-${index}`)));
    for (const account of legitAccounts) createdApps.push(account.app);
    await sleep(MIN_REFERRAL_ACCOUNT_AGE_MS + 1500);

    const referredUids: string[] = [];
    for (let index = 0; index < 3; index += 1) {
      const referred = legitAccounts[index];
      referredUids.push(referred.user.uid);
      const ownPlanInit = await postWithoutBody(referred.user, `/api/plan/initialize/${referred.user.uid}`);
      assert.equal(ownPlanInit.status, 200);

      const onboardingSave = await postSettings(referred.user, referred.user.uid, {
        onboarding_completed: true,
        storeName: `Loja Legítima ${index}`,
        referral_source: referralCode,
      });
      assert.equal(onboardingSave.status, 200);
      const onboardingBody = await onboardingSave.json() as { settings?: { referral_source?: unknown } };
      assert.equal(onboardingBody.settings?.referral_source, referrerUid, `C: código público resolve para o UID correto do referrer #${index}`);

      const track = await trackEvent(referred.user, referrerUid);
      assert.equal(track.status, 200, `L: referral legítimo #${index} deveria ser aceito (conta com idade real)`);

      const validate = await validateReferral(referred.user, referrerUid);
      assert.equal(validate.status, 200, `L: validação do referral legítimo #${index} deveria funcionar`);
      const validateBody = await validate.json() as { premiumGranted: boolean; referralCount: number };
      assert.equal(validateBody.referralCount, index + 1);
      assert.equal(validateBody.premiumGranted, index === 2, "Premium só é concedido exatamente no 3º referral válido (REFERRAL_REWARD_LIMIT)");

      // I/M: repetir o MESMO track-event/validate-referral para o MESMO referred UID é idempotente.
      const duplicateTrack = await trackEvent(referred.user, referrerUid);
      assert.equal(duplicateTrack.status, 409, "I: o mesmo referral não pode ser rastreado duas vezes");
      const duplicateValidate = await validateReferral(referred.user, referrerUid);
      assert.equal(duplicateValidate.status, 409, "M: a mesma validação não pode conceder o grant duas vezes");
    }

    const referrerPlanAfterLegit = await planData(referrerUid);
    assert.equal(referrerPlanAfterLegit.data()?.currentPlan, "premium");
    assert.equal(referrerPlanAfterLegit.data()?.premiumActive, true);
    assert.equal(referrerPlanAfterLegit.data()?.referralCount, 3);

    // J: um referrer diferente, que não recebeu 3 referrals válidos, nunca ganha Premium.
    const otherReferrer = await createTestUser("other-referrer");
    createdApps.push(otherReferrer.app);
    const otherReferrerPlan = await planData(otherReferrer.user.uid);
    assert.equal(otherReferrerPlan.exists, false);
    const selfCodeUser = await createTestUser("self-code");
    createdApps.push(selfCodeUser.app);
    const selfCodeUid = selfCodeUser.user.uid;
    const selfCodeInit = await postWithoutBody(selfCodeUser.user, `/api/plan/initialize/${selfCodeUid}`);
    assert.equal(selfCodeInit.status, 200);
    const selfCode = String(((await selfCodeInit.json()) as { referralCode?: string }).referralCode ?? "");

    const invalidCodeSave = await postSettings(otherReferrer.user, otherReferrer.user.uid, {
      referral_source: "USER-INVALID",
      storeName: "Código inválido",
    });
    assert.equal(invalidCodeSave.status, 400, "D: código inexistente/malformado falha closed");

    const selfCodeSave = await postSettings(selfCodeUser.user, selfCodeUid, {
      referral_source: selfCode,
      storeName: "Self referral",
    });
    assert.equal(selfCodeSave.status, 400, "E: código próprio é bloqueado no backend");
    assert.equal(((await selfCodeSave.json()) as { referralValidation?: { result?: string } }).referralValidation?.result, "self_referral");

    console.log("Referral/settings isolation integration tests passed: mass assignment blocked, disposable-account referral farming blocked, legit referral flow idempotent.");
  } finally {
    await close(server);
    await Promise.allSettled(createdApps.map((app) => deleteApp(app)));
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exit(1);
});
