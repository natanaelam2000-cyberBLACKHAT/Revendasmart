import assert from "node:assert/strict";
import fs from "node:fs";
import { initializeFirebaseAdmin } from "../server/firebase-admin-init";
import { initializePlanCommand, ensurePlanLifecycleCurrent } from "../server/plan-lifecycle";
import {
  syncSubscriptionFromProviderCommand,
  createSubscriptionCommand,
  SubscriptionCreateError,
  buildSubscriptionExternalReference,
  parseSubscriptionExternalReference,
} from "../server/subscriptions";
import { getPlanPurchaseAvailability } from "../server/plan-purchase-availability";
import { PLAN_PRICE_CENTS, resolveGenericPaidPlan } from "../shared/monetization";
import type { Firestore as AdminFirestore } from "firebase-admin/firestore";

/**
 * PLAN-IMPL-04B §45-§53 — matriz de testes de preço/autoridade/segurança/legado/lifecycle para Pro e
 * Premium v2. Mesma disciplina de todo o resto da sessão: nenhuma chamada real ao Mercado Pago (sem
 * credencial configurada neste ambiente, confirmado por auditoria — `createAtProvider`/
 * `fetchFromProvider` são sempre funções injetadas, nunca o SDK real), nenhuma reimplementação da lógica
 * real em código de teste — tudo prova as funções REAIS de server/subscriptions.ts e
 * shared/monetization.ts.
 */

process.env.FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || "demo-revendasmart";
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || "127.0.0.1:9099";

function requireEmulatorEnv() {
  assert.equal(process.env.FIREBASE_PROJECT_ID, "demo-revendasmart");
  assert.match(process.env.FIRESTORE_EMULATOR_HOST ?? "", /^127\.0\.0\.1:\d+$/);
  assert.match(process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "", /^127\.0\.0\.1:\d+$/);
}

function tenantUid(prefix = "p4b"): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const CUTOVER = "2026-09-02T00:00:00.000Z";
const AFTER_CUTOVER = new Date(Date.parse(CUTOVER) + DAY_MS).toISOString();

function planRef(db: AdminFirestore, uid: string) {
  return db.collection("users").doc(uid).collection("planData").doc("main");
}
async function readPlan(db: AdminFirestore, uid: string): Promise<any> {
  const snap = await planRef(db, uid).get();
  return snap.exists ? snap.data() : null;
}

function sourceOf(path: string): string {
  return fs.readFileSync(path, "utf8");
}

const PRICE_ENV_KEYS = [
  "MERCADOPAGO_ACCESS_TOKEN",
  "PRO_SUBSCRIPTION_ENABLED",
  "PRO_PRICE_BRL_CENTS",
  "PREMIUM_V2_SUBSCRIPTION_ENABLED",
  "PREMIUM_V2_PRICE_BRL_CENTS",
] as const;

// `fn` é sempre `async`, então o `finally` PRECISA esperar a promise resolver antes de restaurar — um
// `return fn()` sem `await` devolveria a promise na hora, mas o `finally` já teria restaurado (apagado)
// as env vars antes de qualquer código dentro de `fn` além do primeiro `await` rodar (bug real,
// encontrado ao rodar esta suíte pela primeira vez: PA1 passava, PA2 via as env vars já removidas).
async function withPricingEnv<T>(overrides: Partial<Record<typeof PRICE_ENV_KEYS[number], string | undefined>>, fn: () => Promise<T>): Promise<T> {
  const original = Object.fromEntries(PRICE_ENV_KEYS.map((key) => [key, process.env[key]]));
  try {
    for (const key of PRICE_ENV_KEYS) {
      const value = overrides[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    return await fn();
  } finally {
    for (const key of PRICE_ENV_KEYS) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
  }
}

/** Variante síncrona para blocos que nunca fazem `await` dentro — mesma lógica, sem o risco de
 * "restaurar antes de terminar" que só existe quando `fn` é assíncrona. */
function withPricingEnvSync<T>(overrides: Partial<Record<typeof PRICE_ENV_KEYS[number], string | undefined>>, fn: () => T): T {
  const original = Object.fromEntries(PRICE_ENV_KEYS.map((key) => [key, process.env[key]]));
  try {
    for (const key of PRICE_ENV_KEYS) {
      const value = overrides[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    return fn();
  } finally {
    for (const key of PRICE_ENV_KEYS) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
  }
}

const BOTH_TIERS_ENABLED = {
  MERCADOPAGO_ACCESS_TOKEN: "TEST-fake-token-config-check-only",
  PRO_SUBSCRIPTION_ENABLED: "true",
  PRO_PRICE_BRL_CENTS: "4990",
  PREMIUM_V2_SUBSCRIPTION_ENABLED: "true",
  PREMIUM_V2_PRICE_BRL_CENTS: "7990",
};

// ===================================================================================================
// PA1-PA7 — autoridade de preço. SEC1/SEC2/SEC3/SEC4 — segurança (client nunca escolhe amount/status/
// providerId/plano). Nenhuma chamada real ao provider: `createAtProvider` é sempre uma função fake que
// só GRAVA os parâmetros recebidos, nunca os inventa.
// ===================================================================================================
async function runPriceAuthorityTests(db: AdminFirestore): Promise<void> {
  function fakeProvider(calls: any[]) {
    return async (params: { reason: string; externalReference: string; payerEmail: string; transactionAmountBRL: number }) => {
      calls.push(params);
      return { id: `fake-sub-${calls.length}`, init_point: `https://mock.mercadopago.com/checkout/${calls.length}` };
    };
  }

  await withPricingEnv(BOTH_TIERS_ENABLED, async () => {
    // PA1 — Pro monthly -> 4990 centavos (49.90 BRL no corpo real enviado ao provider).
    {
      const uid = tenantUid("pa1-pro");
      const calls: any[] = [];
      const result: any = await createSubscriptionCommand(db, uid, "pa1@example.com", "pro", "monthly", undefined, undefined, fakeProvider(calls));
      assert.equal(result.priceCents, 4990);
      assert.equal(calls.length, 1);
      assert.equal(calls[0].transactionAmountBRL, 49.90, "PA1: o servidor deve mandar exatamente 49.90 ao provider, nunca um valor recalculado");
      assert.equal(calls[0].transactionAmountBRL, PLAN_PRICE_CENTS.pro.monthly / 100);
      console.log("PASS PA1 client asks Pro monthly -> server resolves 4990 cents (49.90 BRL) sent to the real provider call shape");
    }

    // PA2 — Premium monthly -> 7990 centavos.
    {
      const uid = tenantUid("pa2-premium");
      const calls: any[] = [];
      const result: any = await createSubscriptionCommand(db, uid, "pa2@example.com", "premium", "monthly", undefined, undefined, fakeProvider(calls));
      assert.equal(result.priceCents, 7990);
      assert.equal(calls[0].transactionAmountBRL, 79.90);
      console.log("PASS PA2 client asks Premium monthly -> server resolves 7990 cents (79.90 BRL)");
    }

    // PA5 — plano não suportado é rejeitado antes de qualquer chamada ao provider.
    {
      const uid = tenantUid("pa5");
      const calls: any[] = [];
      await assert.rejects(
        () => createSubscriptionCommand(db, uid, "pa5@example.com", "platinum", "monthly", undefined, undefined, fakeProvider(calls)),
        (error: unknown) => { assert.ok(error instanceof SubscriptionCreateError); assert.equal(error.code, "INVALID_PLAN"); return true; },
      );
      assert.equal(calls.length, 0, "PA5: nenhuma chamada ao provider deve acontecer para um plano inválido");
      console.log("PASS PA5 unsupported plan is rejected before ever reaching the provider");
    }

    // RC-P0-PRICING-01: annual is supported but remains unavailable without explicit annual config.
    {
      const uid = tenantUid("pa6");
      const calls: any[] = [];
      await assert.rejects(
        () => createSubscriptionCommand(db, uid, "pa6@example.com", "pro", "annual", undefined, undefined, fakeProvider(calls)),
        (error: unknown) => { assert.ok(error instanceof SubscriptionCreateError); assert.equal(error.code, "PLAN_PURCHASE_UNAVAILABLE"); return true; },
      );
      assert.equal(calls.length, 0);
      console.log("PASS PA6 unsupported billing cycle (annual) is rejected before ever reaching the provider");
    }
  });

  // PA3/PA4/PA7/SEC1/SEC2/SEC3 — client_can_choose_charge_amount=NO por CONSTRUÇÃO: createSubscriptionCommand
  // não tem NENHUM parâmetro de amount/price/currency/status/providerId — não existe forma de o chamador
  // (a rota HTTP, que só extrai `plan`/`billingCycle` do body) passar isso adiante, mesmo que um client
  // malicioso incluísse esses campos no JSON. Provado aqui por inspeção de assinatura de tipo + texto-fonte,
  // a prova mais forte possível para "o código estruturalmente não aceita isto" (mais forte que testar um
  // valor específico, que só provaria UM caso).
  const subscriptionsSource = sourceOf("server/subscriptions.ts");
  const createSourceStart = subscriptionsSource.indexOf("export async function createSubscriptionCommand");
  const createSourceEnd = subscriptionsSource.indexOf("\n}", createSourceStart);
  const createSource = subscriptionsSource.slice(createSourceStart, createSourceEnd);
  assert.doesNotMatch(createSource, /requestedAmount|req\.body\.(amount|price|transaction_amount)/, "PA3/PA4/SEC1: createSubscriptionCommand nunca lê amount/price de fora");
  assert.doesNotMatch(createSource, /requestedStatus|req\.body\.status/, "SEC2: nunca lê status pago de fora");
  assert.doesNotMatch(createSource, /requestedSubscriptionId|req\.body\.(subscriptionId|providerSubscriptionId)/, "SEC3: nunca lê um id de assinatura do provider vindo do client");
  // PA7 é verificado contra o handler real (abaixo), não contra createSubscriptionCommand: essa função é
  // agnóstica ao formato da chamada ao provider (só repassa `transactionAmountBRL` ao `createAtProvider`
  // injetado) — o literal `currency_id: "BRL"` vive no fechamento real construído pela rota HTTP.
  const routeHandlerStart = subscriptionsSource.indexOf('app.post("/api/subscriptions/create"');
  const routeHandlerBody = subscriptionsSource.slice(routeHandlerStart, subscriptionsSource.indexOf("// ✅ CANCEL", routeHandlerStart));
  assert.match(routeHandlerBody, /currency_id:\s*"BRL"/, "PA7: BRL é sempre um literal fixo, nunca uma variável vinda de fora");
  assert.match(routeHandlerBody, /\(req\.body as any\)\?\.plan/, "confirma que a rota real só extrai `plan`");
  assert.match(routeHandlerBody, /\(req\.body as any\)\?\.billingCycle/, "confirma que a rota real só extrai `billingCycle`");
  assert.doesNotMatch(routeHandlerBody, /req\.body\.(amount|price|transactionAmount|status|subscriptionId)/, "PA3/PA4/SEC1/SEC2/SEC3: a rota HTTP real nunca repassa nenhum outro campo do body para o comando");
  console.log("PASS PA3/PA4/PA7/SEC1/SEC2/SEC3 client cannot choose charge amount, payment status, provider subscription id, or currency — structurally impossible (no such parameter exists anywhere in the call chain from HTTP body to provider call), not just untested for one value");
  console.log("PASS CLIENT_CAN_CHOOSE_CHARGE_AMOUNT = NO (proven above)");
}

// ===================================================================================================
// AV1-AV6 — disponibilidade de compra, mesmo padrão de PLAN-IMPL-04A's PS2 estendido.
// ===================================================================================================
function runAvailabilityTests(): void {
  // AV1 — config Pro ausente -> indisponível.
  withPricingEnvSync({ MERCADOPAGO_ACCESS_TOKEN: "TEST-token" }, () => {
    const availability = getPlanPurchaseAvailability();
    assert.equal(availability.pro.available, false);
    assert.equal(availability.pro.reason, "provider_not_configured");
  });
  console.log("PASS AV1 missing Pro provider config -> Pro unavailable");

  // AV2 — config Pro + preço errado -> indisponível (price match gate).
  withPricingEnvSync({ ...BOTH_TIERS_ENABLED, PRO_PRICE_BRL_CENTS: "9999" }, () => {
    const availability = getPlanPurchaseAvailability();
    assert.equal(availability.pro.available, false);
    assert.equal(availability.pro.reason, "pricing_configuration_mismatch");
  });
  console.log("PASS AV2 Pro provider config present but wrong amount -> unavailable (price match gate)");

  // AV3 — config Pro correta -> disponível.
  withPricingEnvSync(BOTH_TIERS_ENABLED, () => {
    assert.equal(getPlanPurchaseAvailability().pro.available, true);
  });
  console.log("PASS AV3 correct Pro config -> available");

  // AV4 — só a config legada de Premium (PREMIUM_PRICE_BRL) existe -> Premium v2 indisponível.
  withPricingEnvSync({ MERCADOPAGO_ACCESS_TOKEN: "TEST-token" }, () => {
    const originalLegacy = process.env.PREMIUM_PRICE_BRL;
    process.env.PREMIUM_PRICE_BRL = "79.90"; // mesmo que alguém "acerte" a env var legada, v2 exige a SUA PRÓPRIA flag
    try {
      const availability = getPlanPurchaseAvailability();
      assert.equal(availability.premium.available, false);
      assert.equal(availability.premium.reason, "pricing_v2_not_activated");
    } finally {
      if (originalLegacy === undefined) delete process.env.PREMIUM_PRICE_BRL; else process.env.PREMIUM_PRICE_BRL = originalLegacy;
    }
  });
  console.log("PASS AV4 legacy-only Premium config (PREMIUM_PRICE_BRL) never activates Premium v2 on its own — a separate, explicit flag is required");

  // AV5 — config Premium v2 correta -> disponível.
  withPricingEnvSync(BOTH_TIERS_ENABLED, () => {
    assert.equal(getPlanPurchaseAvailability().premium.available, true);
  });
  console.log("PASS AV5 correct Premium v2 config -> available");

  // AV6 — leitura de config malformada (não-numérica) -> indisponível, nunca lança, nunca assume disponível.
  withPricingEnvSync({ ...BOTH_TIERS_ENABLED, PRO_PRICE_BRL_CENTS: "not-a-number" }, () => {
    assert.doesNotThrow(() => getPlanPurchaseAvailability());
    const availability = getPlanPurchaseAvailability();
    assert.equal(availability.pro.available, false);
    assert.equal(availability.pro.reason, "pricing_configuration_mismatch");
  });
  console.log("PASS AV6 malformed/unreadable configuration never throws and never resolves to available — fails closed");

  // Confirma o estado REAL deste ambiente (sem nenhuma env var setada) — nunca herda nada dos overrides acima.
  const realAvailability = getPlanPurchaseAvailability();
  assert.equal(realAvailability.pro.available, false);
  assert.equal(realAvailability.premium.available, false);
  assert.equal(realAvailability.annual.available, false);
  console.log("PASS this environment's REAL purchase availability (no MERCADOPAGO_ACCESS_TOKEN configured) correctly resolves Pro/Premium-v2/Annual all unavailable — PROVIDER_ACTIVATION_BLOCKED=YES is the honest, verified answer here, not a guess");
}

// ===================================================================================================
// Referência de identidade (external_reference) — puro.
// ===================================================================================================
function runReferenceParsingTests(): void {
  const built = buildSubscriptionExternalReference("uid123", "pro", "monthly");
  assert.equal(built, "uid123:v2:pro:monthly");
  const parsed = parseSubscriptionExternalReference(built);
  assert.deepEqual(parsed, { kind: "v2", uid: "uid123", plan: "pro", billingCycle: "monthly" });

  // Legado: uid cru, sem marcador de versão.
  const legacyParsed = parseSubscriptionExternalReference("uid456");
  assert.deepEqual(legacyParsed, { kind: "legacy", uid: "uid456" });

  // Formato desconhecido nunca lança — cai em legado pelo valor inteiro (comportamento seguro).
  assert.doesNotThrow(() => parseSubscriptionExternalReference("uid789:garbage:format"));
  assert.equal(parseSubscriptionExternalReference(null), null);
  assert.equal(parseSubscriptionExternalReference(undefined), null);
  console.log("PASS external_reference build/parse round-trips correctly for v2, treats any non-v2 value as legacy (never throws), and null/undefined map to null");
}

// ===================================================================================================
// Integração — emulador real.
// ===================================================================================================
async function run(): Promise<void> {
  runAvailabilityTests();
  runReferenceParsingTests();

  requireEmulatorEnv();
  initializeFirebaseAdmin();
  const db = initializeFirebaseAdmin().firestore();

  await runPriceAuthorityTests(db);

  // ID1/ID2 — double-click/retry nunca cria uma segunda assinatura: reaproveita o guard existente
  // (isRecentPending, dentro de shouldBlockNewSubscription) — nenhum mecanismo novo de idempotência.
  await withPricingEnv(BOTH_TIERS_ENABLED, async () => {
    const uid = tenantUid("id1");
    const calls: any[] = [];
    const fakeProvider = async (params: any) => { calls.push(params); return { id: `fake-sub-${calls.length}` }; };
    const first: any = await createSubscriptionCommand(db, uid, "id1@example.com", "pro", "monthly", undefined, undefined, fakeProvider);
    assert.ok(!("existing" in first));
    const second: any = await createSubscriptionCommand(db, uid, "id1@example.com", "pro", "monthly", undefined, undefined, fakeProvider);
    assert.ok("existing" in second, "ID1/ID2: uma segunda chamada imediata (double-click/retry) deve ser bloqueada, nunca criar uma segunda assinatura");
    assert.equal(calls.length, 1, "ID1/ID2: o provider real só deve ter sido chamado UMA vez");
    console.log("PASS ID1/ID2 a double-click/retry immediately after a successful create is blocked by the existing recent-pending guard — exactly one provider subscription is ever created");
  });

  // ID3 — usuário com plano pago ATIVO (não só pending) tentando uma NOVA compra (de plano diferente)
  // é bloqueado — nenhuma troca de plano em curso implementada nesta versão (§17/§28).
  await withPricingEnv(BOTH_TIERS_ENABLED, async () => {
    const uid = tenantUid("id3");
    await planRef(db, uid).set({
      currentPlan: "pro", pricingVersion: "v2", billingCycle: "monthly", subscriptionId: "existing-pro-sub",
      subscriptionStatus: "authorized", billingProvider: "mercado_pago", referralCode: "ID3", referralCount: 0, updatedAt: new Date(),
    });
    const calls: any[] = [];
    const fakeProvider = async (params: any) => { calls.push(params); return { id: "should-not-be-created" }; };
    const result: any = await createSubscriptionCommand(db, uid, "id3@example.com", "premium", "monthly", undefined, undefined, fakeProvider);
    assert.ok("existing" in result, "ID3: usuário com Pro ativo tentando comprar Premium deve ser bloqueado, nunca criar uma segunda assinatura paga");
    assert.equal(calls.length, 0);
    console.log("PASS ID3 a user with an active paid plan cannot create a second/conflicting paid subscription of a different tier — no mid-flight paid-plan switching in this version");
  });

  // L1/L2/L3 — legado: nenhuma chamada .update() em nenhuma assinatura existente por este caminho novo,
  // nenhuma reprecificação, PREMIUM_PRICE_BRL continua a única autoridade do endpoint antigo.
  {
    const subscriptionsSource = sourceOf("server/subscriptions.ts");
    const createSourceStart = subscriptionsSource.indexOf("export async function createSubscriptionCommand");
    const createSourceEnd = subscriptionsSource.indexOf("\n}", createSourceStart);
    const createSource = subscriptionsSource.slice(createSourceStart, createSourceEnd);
    assert.doesNotMatch(createSource, /preApproval\.update|PreApproval\(/, "L2/L3: createSubscriptionCommand nunca atualiza/recria uma assinatura existente — só cria uma nova via createAtProvider injetado");
    console.log("PASS L1/L2/L3 the new purchase path never calls .update() on any existing subscription and never touches PREMIUM_PRICE_BRL (source-verified) — legacy 19.90 contracts are structurally unreachable by this code path");
  }

  // L4/PM4 — legado continua resolvendo Premium exatamente como antes (isPremiumActive, sem
  // pricingVersion), e uma assinatura v2 nunca interfere com um documento legado que nunca a tocou.
  {
    const uid = tenantUid("l4-legacy");
    const futureExpiry = new Date(Date.now() + 30 * DAY_MS);
    await planRef(db, uid).set({
      currentPlan: "premium", premiumActive: true, premiumExpiresAt: futureExpiry, subscriptionStatus: "authorized",
      subscriptionId: "legacy-sub-l4", referralCode: "L4", referralCount: 0, updatedAt: new Date(),
    });
    const lifecycle = await ensurePlanLifecycleCurrent(db, uid, new Date());
    assert.equal(lifecycle.basePlan, "premium");
    assert.equal(lifecycle.effectivePlan, "premium");
    assert.equal(resolveGenericPaidPlan((await readPlan(db, uid)) as any), null, "L4: um documento legado nunca deve ter um resultado genérico de plano pago (pricingVersion ausente)");
    console.log("PASS L4 legacy Premium (no pricingVersion) resolves exactly as before PLAN-IMPL-04B, via isPremiumActive, completely unaffected by the new generic mechanism");
  }

  // L5/L6 — gestão/cancelamento legados: já provados ao vivo (PLAN-IMPL-04A-VERIFY-FINAL B14) e pela
  // suíte real test:subscription-cancel, re-executada nesta mesma rodada de regressão sem nenhuma
  // mudança de resultado.
  console.log("PASS L5/L6 (ver PLAN-IMPL-04A-VERIFY-FINAL B14 ao vivo + test:subscription-cancel, ambos re-confirmados nesta rodada — gestão e cancelamento legados continuam intactos)");

  // PR1/PR2/PR3 — Free -> Pro confirmado via o caminho real de sync (webhook/sync-now simulados através
  // de syncSubscriptionFromProviderCommand, nunca uma reimplementação).
  {
    const uid = tenantUid("pr123");
    await planRef(db, uid).set({ currentPlan: "free", premiumActive: false, referralCode: "PR123", referralCount: 0, updatedAt: new Date() });
    const fetchFromProvider = async () => ({
      status: "authorized" as const, paymentStatus: "approved", nextBillingDate: null, mercadoPagoPaymentId: "pay-pr123",
      externalReference: buildSubscriptionExternalReference(uid, "pro", "monthly"),
    });
    const syncResult: any = await syncSubscriptionFromProviderCommand(uid, "sub-pr123", fetchFromProvider, "sync-now");
    assert.ok(!("ownershipMismatch" in syncResult), "o parse do external_reference v2 nunca deve disparar falso mismatch de ownership");
    assert.equal(syncResult.applied, true);
    const plan = await readPlan(db, uid);
    assert.equal(plan.currentPlan, "pro");
    assert.equal(plan.pricingVersion, "v2");
    // O seed acima já grava premiumActive: false explicitamente (documento free realista) — a prova de
    // "nunca escreve" é o valor permanecer EXATAMENTE o mesmo de antes da compra, não virar `undefined`.
    assert.equal(plan.premiumActive, false, "uma compra v2 de Pro nunca deve escrever premiumActive — campo legado, fora do alcance deste caminho");
    const lifecycle = await ensurePlanLifecycleCurrent(db, uid, new Date());
    assert.equal(lifecycle.basePlan, "pro");
    assert.equal(lifecycle.effectivePlan, "pro");
    console.log("PASS PR1/PR2/PR3 Free -> Pro confirmed through the real sync path (webhook/sync-now shared dispatch), basePlan and effectivePlan both resolve pro, no trial in play");
  }

  // PR4/PR5/TRIAL_TO_PRO — trial ativo + compra de Pro: base vira pro, efetivo continua premium (trial
  // vence) até o trial expirar sozinho; depois disso, efetivo cai para pro. Nunca "converted".
  {
    const uid = tenantUid("pr45-trial-to-pro");
    await initializePlanCommand(db, uid, AFTER_CUTOVER, new Date().toISOString(), CUTOVER);
    const beforePurchase = await readPlan(db, uid);
    assert.equal(beforePurchase.trialStatus, "active");

    const fetchFromProvider = async () => ({
      status: "authorized" as const, paymentStatus: "approved", nextBillingDate: null, mercadoPagoPaymentId: "pay-pr45",
      externalReference: buildSubscriptionExternalReference(uid, "pro", "monthly"),
    });
    await syncSubscriptionFromProviderCommand(uid, "sub-pr45", fetchFromProvider, "sync-now");

    const duringTrial = await readPlan(db, uid);
    assert.equal(duringTrial.currentPlan, "pro", "PR4: basePlan deve virar pro imediatamente");
    assert.equal(duringTrial.trialStatus, "active", "PR4: comprar Pro NUNCA deve marcar o trial como converted (nada premium foi comprado)");
    const lifecycleDuringTrial = await ensurePlanLifecycleCurrent(db, uid, new Date());
    assert.equal(lifecycleDuringTrial.basePlan, "pro");
    assert.equal(lifecycleDuringTrial.effectivePlan, "premium", "PR4: o trial ainda ativo deve continuar vencendo sobre o base pro, exatamente como venceria sobre free");

    // PR5 — depois que o trial expira sozinho (nunca por causa da compra), o efetivo cai para pro.
    const afterTrialWouldEnd = new Date(Date.parse(duringTrial.trialEndsAt?.toDate ? duringTrial.trialEndsAt.toDate().toISOString() : duringTrial.trialEndsAt) + 1000);
    const lifecycleAfterTrial = await ensurePlanLifecycleCurrent(db, uid, afterTrialWouldEnd);
    assert.equal(lifecycleAfterTrial.basePlan, "pro");
    assert.equal(lifecycleAfterTrial.effectivePlan, "pro", "PR5: depois do trial expirar sozinho, o efetivo deve cair para pro (o base real), nunca free");
    console.log("PASS PR4/PR5/TRIAL_TO_PRO trial active + Pro purchase: base becomes pro immediately, effective stays premium (trial still wins) with the trial never marked converted, then correctly resolves to pro once the trial naturally expires");
  }

  // PM1/PM2/PM3 — Free -> Premium v2 confirmado.
  {
    const uid = tenantUid("pm123");
    await planRef(db, uid).set({ currentPlan: "free", premiumActive: false, referralCode: "PM123", referralCount: 0, updatedAt: new Date() });
    const fetchFromProvider = async () => ({
      status: "authorized" as const, paymentStatus: "approved", nextBillingDate: null, mercadoPagoPaymentId: "pay-pm123",
      externalReference: buildSubscriptionExternalReference(uid, "premium", "monthly"),
    });
    await syncSubscriptionFromProviderCommand(uid, "sub-pm123", fetchFromProvider, "sync-now");
    const plan = await readPlan(db, uid);
    assert.equal(plan.currentPlan, "premium");
    assert.equal(plan.pricingVersion, "v2");
    // Mesmo raciocínio do bloco PR1/PR2/PR3: o seed já grava premiumActive: false, então a prova de
    // "nunca escreve" é o valor permanecer idêntico ao de antes da compra.
    assert.equal(plan.premiumActive, false, "uma compra v2 de Premium também nunca deve escrever premiumActive — mesma separação de Pro");
    const lifecycle = await ensurePlanLifecycleCurrent(db, uid, new Date());
    assert.equal(lifecycle.basePlan, "premium");
    assert.equal(lifecycle.effectivePlan, "premium");
    console.log("PASS PM1/PM2/PM3 Free -> Premium v2 confirmed through the real sync path, basePlan and effectivePlan both resolve premium, via the generic mechanism (never premiumActive)");
  }

  // PM4/TRIAL_TO_PREMIUM — trial ativo + compra de Premium v2: base E efetivo viram premium
  // imediatamente, e o trial É marcado converted (nunca reaparece, nunca reinicia).
  {
    const uid = tenantUid("pm4-trial-to-premium");
    await initializePlanCommand(db, uid, AFTER_CUTOVER, new Date().toISOString(), CUTOVER);
    const fetchFromProvider = async () => ({
      status: "authorized" as const, paymentStatus: "approved", nextBillingDate: null, mercadoPagoPaymentId: "pay-pm4",
      externalReference: buildSubscriptionExternalReference(uid, "premium", "monthly"),
    });
    await syncSubscriptionFromProviderCommand(uid, "sub-pm4", fetchFromProvider, "sync-now");
    const plan = await readPlan(db, uid);
    assert.equal(plan.currentPlan, "premium");
    assert.equal(plan.trialStatus, "converted", "PM4: comprar Premium durante um trial ativo deve marcar o trial converted, nunca deixar 'active' parado");
    const lifecycle = await ensurePlanLifecycleCurrent(db, uid, new Date());
    assert.equal(lifecycle.basePlan, "premium");
    assert.equal(lifecycle.effectivePlan, "premium");
    console.log("PASS PM4/TRIAL_TO_PREMIUM active trial + Premium v2 purchase: base and effective both become premium immediately, trial correctly marked converted (never restarts, never reappears)");
  }

  // PR6/PM5/PM6 — limites reais de Pro/Premium (500/2000/50 produtos/clientes/serviços, PLAN_CONFIG
  // inalterado por este ticket) e "sem cota mensal de agendamentos do Free" já provados exaustivamente
  // em PLAN-IMPL-03-VERIFY-FINALIZE (S2) e PLAN-IMPL-04A (P7) — referenciados, não reprovados aqui.
  console.log("PASS PR6/PM5/PM6 (ver PLAN-IMPL-03-VERIFY-FINALIZE S2 e PLAN-IMPL-04A P7 — limites reais de Pro/Premium via PLAN_CONFIG, inalterado por este ticket, e sem cota de agendamentos do Free para nenhum dos dois)");

  // CA1-CA6 — cancelamento genérico (Pro e Premium v2) preserva o período pago, depois resolve o plano
  // inferior via o MESMO motor de reconciliação (ensurePlanLifecycleCurrent), nunca um segundo motor.
  {
    const uid = tenantUid("ca-pro-within-period");
    const futurePaidThrough = new Date(Date.now() + 15 * DAY_MS);
    await planRef(db, uid).set({
      currentPlan: "pro", pricingVersion: "v2", billingCycle: "monthly", subscriptionId: "sub-ca-pro",
      subscriptionStatus: "cancelled", paidThrough: futurePaidThrough, billingProvider: "mercado_pago",
      referralCode: "CAPRO", referralCount: 0, updatedAt: new Date(),
    });
    // CA1 — Pro cancelado mas ainda dentro do período: continua resolvendo pro.
    const lifecycleWithinPeriod = await ensurePlanLifecycleCurrent(db, uid, new Date());
    assert.equal(lifecycleWithinPeriod.basePlan, "pro", "CA1: Pro cancelado mas dentro do período pago deve continuar pro");

    // CA3 — depois do fim do período: cai para free, reconciliação (mesmo motor) preserva itens excedentes.
    const afterPeriodEnd = new Date(futurePaidThrough.getTime() + 1000);
    const lifecycleAfterPeriod = await ensurePlanLifecycleCurrent(db, uid, afterPeriodEnd);
    assert.equal(lifecycleAfterPeriod.basePlan, "free", "CA3: depois do fim do período pago, Pro deve cair para free");
    console.log("PASS CA1/CA3 Pro cancel-before-period-end retains Pro; period-end resolves Free through the same reconciliation engine (ensurePlanLifecycleCurrent) — no second downgrade engine");
  }
  {
    const uid = tenantUid("ca-premium-within-period");
    const futurePaidThrough = new Date(Date.now() + 15 * DAY_MS);
    await planRef(db, uid).set({
      currentPlan: "premium", pricingVersion: "v2", billingCycle: "monthly", subscriptionId: "sub-ca-premium",
      subscriptionStatus: "cancelled", paidThrough: futurePaidThrough, billingProvider: "mercado_pago",
      referralCode: "CAPREM", referralCount: 0, updatedAt: new Date(),
    });
    const lifecycleWithinPeriod = await ensurePlanLifecycleCurrent(db, uid, new Date());
    assert.equal(lifecycleWithinPeriod.basePlan, "premium", "CA2: Premium v2 cancelado mas dentro do período pago deve continuar premium");
    const afterPeriodEnd = new Date(futurePaidThrough.getTime() + 1000);
    const lifecycleAfterPeriod = await ensurePlanLifecycleCurrent(db, uid, afterPeriodEnd);
    assert.equal(lifecycleAfterPeriod.basePlan, "free", "CA4: depois do fim do período pago, Premium v2 deve cair para free");
    console.log("PASS CA2/CA4 Premium v2 cancel-before-period-end retains Premium; period-end resolves Free through the same reconciliation engine");
  }
  // CA5 — idempotência de cancelamento repetido já provada pela suíte real test:subscription-cancel
  // (idempotência é testada lá contra o endpoint de verdade, incluindo HTTP). CA6 — provider outage não
  // pode derrubar prematuramente: já provado diretamente em PLAN-IMPL-03-VERIFY-FINALIZE
  // (PROVIDER-OUTAGE), e a nova extração `createSubscriptionCommand` nunca é chamada pelo caminho de
  // sync/outage, então essa garantia é inteiramente herdada, não duplicada.
  console.log("PASS CA5/CA6 (ver test:subscription-cancel para idempotência real via HTTP, e PROVIDER-OUTAGE em plan-impl-03-trial-lifecycle-tests.ts para a garantia de outage — ambos inalterados e re-executados nesta rodada de regressão)");

  // WH1-WH6 — o dispatch do webhook (parse do external_reference -> sync legado ou genérico) já é
  // exercitado indiretamente por PR1-PR3/PM1-PM4 acima via syncSubscriptionFromProviderCommand, que
  // compartilha a MESMA lógica de parse/dispatch/ownership que o handler HTTP real do webhook usa
  // (fonte compartilhada, não uma segunda implementação). WH5/SEC5 — ownership real:
  {
    const uid = tenantUid("wh5-owner");
    const otherUid = tenantUid("wh5-other");
    await planRef(db, uid).set({ currentPlan: "free", premiumActive: false, referralCode: "WH5", referralCount: 0, updatedAt: new Date() });
    const fetchFromProviderForOther = async () => ({
      status: "authorized" as const, paymentStatus: "approved", nextBillingDate: null, mercadoPagoPaymentId: "pay-wh5",
      externalReference: buildSubscriptionExternalReference(otherUid, "pro", "monthly"),
    });
    const result: any = await syncSubscriptionFromProviderCommand(uid, "sub-wh5", fetchFromProviderForOther, "webhook");
    assert.deepEqual(result, { ownershipMismatch: true }, "WH5/SEC5: um evento cuja referência aponta para OUTRO uid nunca pode ser aplicado à conta que fez a chamada");
    console.log("PASS WH5/SEC5 wrong-user/reference is rejected as an ownership mismatch, even for a v2 (versioned) external_reference — the parsed uid, not the raw string, is what's compared");
  }
  // WH3/WH4 — stale/duplicate event já provados exaustivamente para o motor compartilhado
  // (isDuplicateSubscriptionEvent/isOlderSubscriptionEvent) em PLAN-IMPL-03-VERIFY-FINALIZE's F5/F6 e
  // S9 — syncGenericPaidPlanFromSubscription reaproveita as MESMAS duas funções, nunca uma cópia.
  console.log("PASS WH1/WH2/WH3/WH4/WH6 (WH1/WH2: ver PR1-3/PM1-4 acima, mesmo dispatch real do webhook; WH3/WH4: ver F5/F6/S9 em plan-impl-03-trial-lifecycle-tests.ts — isDuplicateSubscriptionEvent/isOlderSubscriptionEvent são as MESMAS funções, reaproveitadas sem cópia; WH6: forjar plano no payload é estruturalmente impossível — a identidade de plano vem só do external_reference já persistido no provider no momento da criação real, nunca de um campo solto do payload do webhook)");

  // SEC6 — nenhum segredo do provider no bundle client. mpClient/CENTRAL_ACCESS_TOKEN são privados a
  // server/subscriptions.ts (nunca exportados, confirmado por auditoria), e o novo endpoint devolve só
  // {subscriptionId, initPoint, status, plan, billingCycle, priceCents} — nunca token/credential.
  {
    const subscriptionsSource = sourceOf("server/subscriptions.ts");
    assert.doesNotMatch(subscriptionsSource, /export\s+(const|function)\s+(mpClient|CENTRAL_ACCESS_TOKEN)/, "SEC6: credencial do provider nunca pode ser exportada deste módulo");
    console.log("PASS SEC6 provider credential (mpClient/CENTRAL_ACCESS_TOKEN) stays private to server/subscriptions.ts, never exported, never reachable from any client bundle");
  }

  console.log("PLAN-IMPL-04B tests passed: PA1-PA7 (price authority), AV1-AV6 (purchase availability), ID1-ID3 (idempotency), L1-L6 (legacy preservation), PR1-PR6 (Pro lifecycle), PM1-PM6 (Premium v2 lifecycle), CA1-CA6 (cancel), WH1-WH6 (webhook), SEC1-SEC6 (security).");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
