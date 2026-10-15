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
import { isPaidEntitlementActive, isPremiumActive } from "../shared/monetization";

const PROJECT_ID = "demo-revendasmart";

function requireLocalEmulators(): void {
  assert.match(process.env.FIRESTORE_EMULATOR_HOST ?? "", /^127\.0\.0\.1:\d+$/);
  assert.match(process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "", /^127\.0\.0\.1:\d+$/);
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
  const authEmulatorHost = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "127.0.0.1:9099";
  const [firestoreEmulatorHostname, firestoreEmulatorPort] = (process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080").split(":");
  connectAuthEmulator(auth, `http://${authEmulatorHost}`, { disableWarnings: true });
  connectFirestoreEmulator(db, firestoreEmulatorHostname, Number(firestoreEmulatorPort));
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

  const [{ registerRoutes, MIN_REFERRAL_ACCOUNT_AGE_MS }, { getFirebaseAdmin }, accountDeletion] = await Promise.all([
    import("../server/routes"),
    import("../server/firebase-admin-init"),
    import("../server/account-deletion"),
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
  const trackEvent = (user: User, referrerUID: string, extra: Record<string, unknown> = {}) => postJson(user, "/api/referral/track-event", { referrerUID, event: "onboarding_completed", ...extra });
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
    const abandoned = await createTestUser("abandoned");
    createdApps.push(abandoned.app);
    const paidReferrer = await createTestUser("paid-referrer");
    const paidReferred = await createTestUser("paid-referred");
    const replacementReferred = await createTestUser("replacement-referred");
    createdApps.push(paidReferrer.app, paidReferred.app, replacementReferred.app);
    const legitAccounts = await Promise.all([0, 1, 2, 3].map((index) => createTestUser(`legit-${index}`)));
    for (const account of legitAccounts) createdApps.push(account.app);
    await sleep(MIN_REFERRAL_ACCOUNT_AGE_MS + 1500);

    const abandonedTrack = await trackEvent(abandoned.user, referrerUid);
    assert.equal(abandonedTrack.status, 400, "B: conta que abandona sem concluir onboarding não pode gerar indicação");
    assert.equal((await abandonedTrack.json() as { error?: string }).error, "ONBOARDING_NOT_COMPLETED");

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

    // O indicador não pode ser escolhido pelo frontend: a atribuição canônica do cadastro vence o body
    // de track/validate, e um UID indicado adulterado é rejeitado antes de qualquer escrita.
    const wrongAttributionTrack = await trackEvent(legitAccounts[0].user, otherReferrer.user.uid);
    assert.equal(wrongAttributionTrack.status, 403, "o frontend não pode trocar o indicador de uma conta já atribuída");
    assert.equal((await wrongAttributionTrack.json() as { error?: string }).error, "REFERRAL_ATTRIBUTION_MISMATCH");
    const swappedUidTrack = await trackEvent(legitAccounts[0].user, referrerUid, { referredUID: legitAccounts[1].user.uid });
    assert.equal(swappedUidTrack.status, 403, "UID indicado vindo do cliente deve ser ignorado/rejeitado");
    assert.equal((await swappedUidTrack.json() as { error?: string }).error, "REFERRAL_OWNERSHIP_MISMATCH");

    // B pode usar dois códigos apenas se um deles vencer a corrida atômica; o segundo nunca sobrescreve
    // referral_source. Isso cobre duas abas/retries simultâneos no primeiro cadastro.
    const secondCodeOwner = await createTestUser("second-code-owner");
    createdApps.push(secondCodeOwner.app);
    const secondCodeInit = await postWithoutBody(secondCodeOwner.user, `/api/plan/initialize/${secondCodeOwner.user.uid}`);
    assert.equal(secondCodeInit.status, 200);
    const secondCode = String(((await secondCodeInit.json()) as { referralCode?: string }).referralCode ?? "");
    const racingUser = await createTestUser("racing-source");
    createdApps.push(racingUser.app);
    const raceResponses = await Promise.all([
      postSettings(racingUser.user, racingUser.user.uid, { referral_source: referralCode }),
      postSettings(racingUser.user, racingUser.user.uid, { referral_source: secondCode }),
    ]);
    assert.deepEqual(raceResponses.map((response) => response.status).sort((a, b) => a - b), [200, 409],
      "corrida de dois códigos deve aceitar exatamente uma atribuição");
    const racingSettings = await db.doc(`user_settings/${racingUser.user.uid}`).get();
    assert.ok([referrerUid, secondCodeOwner.user.uid].includes(racingSettings.data()?.referral_source),
      "a atribuição vencedora deve ser um dos códigos resolvidos pelo servidor");

    // A mesma indicação concorrente deve criar um evento e um benefício no máximo uma vez.
    const concurrentReferred = legitAccounts[3];
    const concurrentPlanInit = await postWithoutBody(concurrentReferred.user, `/api/plan/initialize/${concurrentReferred.user.uid}`);
    assert.equal(concurrentPlanInit.status, 200);
    const concurrentOnboarding = await postSettings(concurrentReferred.user, concurrentReferred.user.uid, {
      onboarding_completed: true,
      referral_source: referralCode,
    });
    assert.equal(concurrentOnboarding.status, 200);
    const concurrentTrackResponses = await Promise.all([
      trackEvent(concurrentReferred.user, referrerUid),
      trackEvent(concurrentReferred.user, referrerUid),
    ]);
    assert.deepEqual(concurrentTrackResponses.map((response) => response.status).sort((a, b) => a - b), [200, 409],
      "duas criações concorrentes do mesmo referral devem ser idempotentes");
    const concurrentValidateResponses = await Promise.all([
      validateReferral(concurrentReferred.user, referrerUid),
      validateReferral(concurrentReferred.user, referrerUid),
    ]);
    assert.deepEqual(concurrentValidateResponses.map((response) => response.status).sort((a, b) => a - b), [200, 409],
      "duas validações concorrentes devem conceder no máximo um benefício");
    const referrerPlanAfterConcurrent = await planData(referrerUid);
    assert.equal(referrerPlanAfterConcurrent.data()?.referralCount, 4);
    assert.equal(referrerPlanAfterConcurrent.data()?.premiumActive, true);

    // P1: deleting an indicated account removes PII/edges but cannot recycle the lifetime milestone.
    await accountDeletion.deleteAccountByUid(legitAccounts[0].user.uid, {
      db,
      auth: admin.auth(),
      bucket: { deleteFiles: async () => undefined } as any,
      now: () => new Date(),
    });
    const replacementInit = await postWithoutBody(replacementReferred.user, `/api/plan/initialize/${replacementReferred.user.uid}`);
    assert.equal(replacementInit.status, 200);
    const replacementOnboarding = await postSettings(replacementReferred.user, replacementReferred.user.uid, {
      onboarding_completed: true,
      referral_source: referralCode,
    });
    assert.equal(replacementOnboarding.status, 200);
    assert.equal((await trackEvent(replacementReferred.user, referrerUid)).status, 200);
    const replacementValidation = await validateReferral(replacementReferred.user, referrerUid);
    assert.equal(replacementValidation.status, 200);
    const replacementValidationBody = await replacementValidation.json() as { referralCount: number; premiumGranted: boolean };
    assert.equal(replacementValidationBody.referralCount, 5, "deleção não recicla a contagem vitalícia");
    assert.equal(replacementValidationBody.premiumGranted, false, "a mesma milestone não é concedida novamente após deleção");
    assert.equal((await planData(referrerUid)).data()?.referralLifetimeCount, 5);

    // P0: entitlement paid wins over a free reward, with an unexpired paid period.
    const paidInit = await postWithoutBody(paidReferrer.user, `/api/plan/initialize/${paidReferrer.user.uid}`);
    assert.equal(paidInit.status, 200);
    const paidExpiry = new Date(Date.now() + 86_400_000);
    await db.doc(`users/${paidReferrer.user.uid}/planData/main`).set({
      currentPlan: "premium",
      premiumActive: true,
      premiumExpiresAt: paidExpiry,
      premiumStartedAt: new Date(Date.now() - 86_400_000),
      premiumSource: "subscription",
      subscriptionId: "mp-paid-subscription",
      subscriptionStatus: "authorized",
      billingProvider: "mercado_pago",
      referralCount: 2,
      referralLifetimeCount: 2,
    }, { merge: true });
    const paidReferredInit = await postWithoutBody(paidReferred.user, `/api/plan/initialize/${paidReferred.user.uid}`);
    assert.equal(paidReferredInit.status, 200);
    assert.equal(isPremiumActive({ premiumActive: true, currentPlan: "premium", premiumExpiresAt: new Date(0), premiumSource: "subscription", subscriptionStatus: "authorized" } as any), false,
      "subscription authorized cannot override expired premiumExpiresAt");
    assert.equal(isPremiumActive({ currentPlan: "premium", premiumActive: true, premiumExpiresAt: new Date(Date.now() + 86_400_000), premiumSource: "subscription", subscriptionStatus: "active", billingProvider: "google_play" } as any), true,
      "Google Play active preserves paid entitlement");
    assert.equal(isPaidEntitlementActive({ currentPlan: "pro", pricingVersion: "v2", paidThrough: new Date(Date.now() + 86_400_000), premiumSource: null, subscriptionStatus: null } as any), true,
      "paid Pro entitlement remains stronger than a free reward");
    assert.equal(isPaidEntitlementActive({ currentPlan: "pro", pricingVersion: "v2", paidThrough: new Date(0), premiumSource: null, subscriptionStatus: "authorized" } as any), false,
      "authorized paid Pro expires at paidThrough");
    const paidOnboarding = await postSettings(paidReferred.user, paidReferred.user.uid, { onboarding_completed: true, referral_source: String((await paidInit.json() as { referralCode?: string }).referralCode) });
    assert.equal(paidOnboarding.status, 200);
    assert.equal((await trackEvent(paidReferred.user, paidReferrer.user.uid)).status, 200);
    const paidValidation = await validateReferral(paidReferred.user, paidReferrer.user.uid);
    assert.equal(paidValidation.status, 200);
    assert.deepEqual(await paidValidation.json(), {
      status: "valid",
      premiumGranted: false,
      paidEntitlementPreserved: true,
      productDecisionRequired: true,
      referralCount: 3,
      remaining: 0,
    });
    const paidPlanAfterReward = (await planData(paidReferrer.user.uid)).data()!;
    assert.equal(paidPlanAfterReward.currentPlan, "premium");
    assert.equal(paidPlanAfterReward.premiumActive, true);
    assert.equal(paidPlanAfterReward.premiumSource, "subscription");
    assert.equal(paidPlanAfterReward.subscriptionStatus, "authorized");
    assert.equal((paidPlanAfterReward.premiumExpiresAt.toDate?.() ?? paidPlanAfterReward.premiumExpiresAt).getTime(), paidExpiry.getTime(),
      "test fixture keeps the paid expiration untouched");
    assert.equal(paidPlanAfterReward.referralRewardDecision, "PRODUCT_DECISION_REQUIRED");

    // P1: the backend flag is authoritative even if the client Remote Config says otherwise.
    await db.doc("system/config").set({ referral_program_enabled: false }, { merge: true });
    const disabledSettings = await postSettings(otherReferrer.user, otherReferrer.user.uid, { referral_source: referralCode });
    assert.equal(disabledSettings.status, 403);
    assert.equal((await disabledSettings.json() as { error?: string }).error, "REFERRAL_PROGRAM_DISABLED");
    assert.equal((await trackEvent(paidReferred.user, referrerUid)).status, 403);
    assert.equal((await validateReferral(paidReferred.user, referrerUid)).status, 403);
    await db.doc("system/config").set({ referral_program_enabled: true }, { merge: true });

    const invalidCodeSave = await postSettings(otherReferrer.user, otherReferrer.user.uid, {
      referral_source: "USER-INVALID",
      storeName: "Código inválido",
    });
    assert.equal(invalidCodeSave.status, 400, "D: código inexistente/malformado falha closed");

    const emptyCodeSave = await postSettings(otherReferrer.user, otherReferrer.user.uid, { referral_source: "" });
    assert.equal(emptyCodeSave.status, 400, "código vazio não pode contornar a imutabilidade");
    const nullCodeSave = await postSettings(otherReferrer.user, otherReferrer.user.uid, { referral_source: null });
    assert.equal(nullCodeSave.status, 400, "código nulo não pode limpar uma atribuição ou habilitar replay");

    const selfCodeSave = await postSettings(secondCodeOwner.user, secondCodeOwner.user.uid, {
      referral_source: secondCode,
      storeName: "Self referral",
    });
    assert.equal(selfCodeSave.status, 400, "E: código próprio é bloqueado no backend");
    assert.equal(((await selfCodeSave.json()) as { referralValidation?: { result?: string } }).referralValidation?.result, "self_referral");

    console.log("Referral/settings isolation integration tests passed: mass assignment blocked, disposable-account referral farming blocked, legit referral flow idempotent.");
  } finally {
    await db.doc("system/config").set({ referral_program_enabled: true }, { merge: true }).catch(() => undefined);
    await close(server);
    await Promise.allSettled(createdApps.map((app) => deleteApp(app)));
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exit(1);
});
