/**
 * RELEASE-09 — semântica de cancelamento da assinatura Mercado Pago.
 *
 * Propriedade central provada aqui: `cancelled && now < paid-through` => Premium CONTINUA ativo.
 * Cancelar significa "não renovar mais", nunca "perder agora o período já pago".
 *
 * Roda a aplicação Express REAL (registerRoutes) contra o Firebase Auth/Firestore Emulator. Todas as
 * chamadas ao Mercado Pago (PreApproval.update/get) são interceptadas por um `fetch` global mockado —
 * ZERO chamada real ao Mercado Pago em qualquer cenário deste arquivo.
 */
import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import { createServer, type Server } from "node:http";
import express from "express";
import { initializeApp, deleteApp, type FirebaseApp } from "firebase/app";
import { connectAuthEmulator, createUserWithEmailAndPassword, getAuth, type User } from "firebase/auth";

const PROJECT_ID = "demo-revendasmart";

process.env.FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || PROJECT_ID;
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || "127.0.0.1:9099";

// Lidas no module-load de server/subscriptions.ts — precisam existir ANTES do primeiro import dele.
// Token com prefixo de produção só para passar na validação de formato; nunca é enviado a lugar
// nenhum, porque todo fetch para api.mercadopago.com é interceptado pelo mock abaixo.
process.env.MERCADOPAGO_ACCESS_TOKEN = "APP_USR-test-central-token-never-sent-anywhere";
const WEBHOOK_SECRET = "release09-test-webhook-secret";
process.env.MERCADOPAGO_WEBHOOK_SECRET = WEBHOOK_SECRET;

function requireLocalEmulators(): void {
  assert.equal(process.env.FIRESTORE_EMULATOR_HOST, "127.0.0.1:8080");
  assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, "127.0.0.1:9099");
  assert.notEqual(process.env.GOOGLE_CLOUD_PROJECT, "revenda-smart");
}

const DAY_MS = 24 * 60 * 60 * 1000;
const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();

async function createTestUser(label: string): Promise<{ app: FirebaseApp; user: User }> {
  const app = initializeApp({
    apiKey: "demo-api-key",
    authDomain: `${PROJECT_ID}.firebaseapp.com`,
    projectId: PROJECT_ID,
    appId: `sub-cancel-${label}-${Date.now()}`,
  }, `sub-cancel-${label}-${Date.now()}-${Math.random()}`);
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

/** Estado que o Mercado Pago devolveria para uma dada assinatura, controlado por cenário. */
type MpSubscriptionState = {
  status: string;
  next_payment_date?: string | null;
  first_payment_status?: string;
  payer_id?: number;
  external_reference?: string;
  last_modified?: string;
};

function buildMockFetch(
  originalFetch: typeof fetch,
  mpState: Map<string, MpSubscriptionState>,
  calls: Array<{ method: string; url: string; body?: unknown }>,
): typeof fetch {
  return (async (input: any, init?: any) => {
    const url = typeof input === "string" ? input : input?.url ?? String(input);
    if (!url.startsWith("https://api.mercadopago.com/")) return originalFetch(input, init);

    const method = String(init?.method ?? "GET").toUpperCase();
    const match = url.match(/\/preapproval\/([^/?]+)/);
    const subscriptionId = match?.[1] ?? "";
    const parsedBody = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, url, body: parsedBody });

    const current = mpState.get(subscriptionId);
    if (!current) return new Response(JSON.stringify({ message: "not found" }), { status: 404 });

    if (method === "PUT") {
      // PreApproval.update — o cancelamento no provider. Reflete no estado mockado.
      const next = { ...current, ...(parsedBody ?? {}), last_modified: new Date().toISOString() };
      mpState.set(subscriptionId, next);
      return new Response(JSON.stringify({ id: subscriptionId, ...next }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ id: subscriptionId, ...current }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

function signedWebhookHeaders(subscriptionId: string): Record<string, string> {
  const requestId = `req-${Math.random().toString(36).slice(2)}`;
  const ts = String(Date.now());
  const manifest = `id:${subscriptionId.toLowerCase()};request-id:${requestId};ts:${ts};`;
  const v1 = crypto.createHmac("sha256", WEBHOOK_SECRET).update(manifest).digest("hex");
  return { "Content-Type": "application/json", "x-request-id": requestId, "x-signature": `ts=${ts},v1=${v1}` };
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

  const admin = getFirebaseAdmin();
  const db = admin.firestore();
  const createdApps: FirebaseApp[] = [];
  const originalFetch = globalThis.fetch;

  const mpState = new Map<string, MpSubscriptionState>();
  const mpCalls: Array<{ method: string; url: string; body?: unknown }> = [];
  (globalThis as any).fetch = buildMockFetch(originalFetch, mpState, mpCalls);

  const planRef = (uid: string) => db.collection("users").doc(uid).collection("planData").doc("main");
  const getPlan = async (uid: string) => (await planRef(uid).get()).data() as any;

  /** Cria um usuário com uma assinatura MP ativa, com período pago até `paidThroughMs` no futuro. */
  const seedActiveSubscriber = async (label: string, options: { paidThroughMs?: number; extra?: Record<string, unknown> } = {}) => {
    const { app: fbApp, user } = await createTestUser(label);
    createdApps.push(fbApp);
    const subscriptionId = `preapproval-${label}-${Math.random().toString(36).slice(2)}`;
    const nextBillingAt = iso(options.paidThroughMs ?? 20 * DAY_MS);
    mpState.set(subscriptionId, {
      status: "authorized",
      next_payment_date: nextBillingAt,
      first_payment_status: "approved",
      payer_id: 12345,
      external_reference: user.uid,
    });
    await planRef(user.uid).set({
      subscriptionId,
      subscriptionStatus: "authorized",
      paymentStatus: "approved",
      premiumActive: true,
      currentPlan: "premium",
      premiumSource: "subscription",
      premiumStartedAt: new Date(Date.now() - 10 * DAY_MS).toISOString(),
      premiumExpiresAt: null,
      autoRenew: true,
      nextBillingAt: new Date(nextBillingAt),
      canceledAt: null,
      updatedAt: new Date().toISOString(),
      ...(options.extra ?? {}),
    });
    return { user, subscriptionId, nextBillingAt };
  };

  const callApi = async (user: User, path: string, method = "POST", body?: unknown) => {
    const token = await user.getIdToken();
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    let parsed: any = null;
    try { parsed = await response.json(); } catch { /* ignore */ }
    return { status: response.status, body: parsed };
  };

  const postWebhook = async (subscriptionId: string) => {
    const response = await fetch(`${baseUrl}/api/app-subscription/webhook`, {
      method: "POST",
      headers: signedWebhookHeaders(subscriptionId),
      body: JSON.stringify({ type: "subscription_preapproval", action: "updated", data: { id: subscriptionId } }),
    });
    let parsed: any = null;
    try { parsed = await response.json(); } catch { /* ignore */ }
    return { status: response.status, body: parsed };
  };

  try {
    const { isPremiumActive, toEntitlementDate } = await import("../shared/monetization");
    const {
      resolvePaidThroughDate,
      isRevokingPaymentStatus,
      reconcilePremiumStatusForTests,
    } = await import("../server/subscriptions");

    // ===== A: assinatura ativa + autoRenew=true => Premium =====
    {
      const { user } = await seedActiveSubscriber("active");
      const status = await callApi(user, "/api/app-subscription/status", "GET");
      assert.equal(status.status, 200);
      assert.equal(status.body.premiumActive, true, "A: assinatura autorizada é Premium");
      assert.equal(status.body.currentPlan, "premium");
      const plan = await getPlan(user.uid);
      assert.equal(plan.autoRenew, true, "A: renovação automática ligada enquanto ativa");
      assert.equal(isPremiumActive(plan), true, "A: contrato compartilhado concorda");
    }

    // ===== B: cancela hoje, período pago futuro => Premium CONTINUA (o bug do RELEASE-09) =====
    let cancelledUser: User;
    let expectedPaidThrough = "";
    {
      const { user, subscriptionId, nextBillingAt } = await seedActiveSubscriber("cancel-in-period");
      cancelledUser = user;
      expectedPaidThrough = nextBillingAt;

      const cancel = await callApi(user, "/api/app-subscription/cancel");
      assert.equal(cancel.status, 200, "B: cancelamento precisa ser aceito");

      const plan = await getPlan(user.uid);
      assert.equal(plan.premiumActive, true, "B: Premium NÃO pode ser removido antes do fim do período pago");
      assert.equal(plan.currentPlan, "premium", "B: o plano continua premium até o período acabar");
      assert.equal(plan.subscriptionStatus, "cancelled", "B: a assinatura fica marcada como cancelada");
      assert.equal(isPremiumActive(plan), true, "B: o contrato compartilhado também mantém o Premium");
      // RELEASE-16 §5: o endpoint de cancelamento do Mercado Pago persiste billingProvider mesmo que o
      // documento tenha sido criado antes dessa mudança (seedActiveSubscriber não o define).
      assert.equal(plan.billingProvider, "mercado_pago", "B: cancelamento MP grava billingProvider explicitamente");

      const status = await callApi(user, "/api/app-subscription/status", "GET");
      assert.equal(status.body.premiumActive, true, "B: /status também mantém o Premium");

      // O provider realmente recebeu o cancelamento (renovação futura interrompida).
      assert.ok(mpCalls.some((c) => c.method === "PUT" && c.url.includes(subscriptionId) && (c.body as any)?.status === "cancelled"),
        "B: o cancelamento precisa ser propagado ao Mercado Pago");
      assert.equal(mpState.get(subscriptionId)?.status, "cancelled");
    }

    // ===== C: autoRenew=false após o cancelamento =====
    {
      const plan = await getPlan(cancelledUser!.uid);
      assert.equal(plan.autoRenew, false, "C: cancelar desliga a renovação automática");
      assert.ok(plan.canceledAt, "C: o momento do cancelamento fica registrado");
    }

    // ===== D: o fim do período pago é preservado, nunca encurtado =====
    {
      const plan = await getPlan(cancelledUser!.uid);
      const paidThrough = resolvePaidThroughDate(plan);
      assert.ok(paidThrough, "D: precisa existir uma data de fim de período após o cancelamento");
      assert.equal(paidThrough!.toISOString(), new Date(expectedPaidThrough).toISOString(),
        "D: a data preservada é exatamente a que já estava paga (nextBillingAt original)");
      assert.ok(paidThrough!.getTime() > Date.now(), "D: a data preservada está no futuro");
    }

    // ===== E: a UI recebe a data final para exibir =====
    {
      const plan = await getPlan(cancelledUser!.uid);
      const apiPlan = await callApi(cancelledUser!, `/api/plan/data/${cancelledUser!.uid}`, "GET");
      assert.equal(apiPlan.status, 200);
      assert.ok(apiPlan.body.premiumExpiresAt, "E: /api/plan/data expõe premiumExpiresAt para a UI");
      // O campo chega ao browser como Timestamp serializado (`{_seconds}`); `new Date(...)` cru daria
      // Invalid Date. A UI usa `toEntitlementDate`, então o teste valida exatamente esse caminho.
      const uiExpiresAt = toEntitlementDate(apiPlan.body.premiumExpiresAt);
      assert.ok(uiExpiresAt, "E: a UI consegue interpretar a data que o servidor devolveu");
      assert.equal(uiExpiresAt!.toISOString(), resolvePaidThroughDate(plan)!.toISOString());
      assert.equal(apiPlan.body.autoRenew, false, "E: a UI consegue distinguir 'cancelada mas ativa'");
      assert.equal(apiPlan.body.premiumActive, true);
    }

    // ===== F: segunda chamada de cancelamento é idempotente e não encurta o período =====
    {
      const before = await getPlan(cancelledUser!.uid);
      const second = await callApi(cancelledUser!, "/api/app-subscription/cancel");
      assert.equal(second.status, 200, "F: cancelar de novo não quebra");
      const after = await getPlan(cancelledUser!.uid);
      assert.equal(after.premiumActive, true, "F: repetir o cancelamento não remove o Premium");
      assert.equal(
        resolvePaidThroughDate(after)!.toISOString(),
        resolvePaidThroughDate(before)!.toISOString(),
        "F: repetir o cancelamento não encurta o período pago",
      );
      assert.equal(after.autoRenew, false);
    }

    // ===== G: passado o fim do período => Free =====
    {
      const { user } = await seedActiveSubscriber("expired-period");
      await callApi(user, "/api/app-subscription/cancel");
      // Simula a passagem do tempo: o período pago terminou ontem.
      await planRef(user.uid).set({ premiumExpiresAt: new Date(Date.now() - DAY_MS), nextBillingAt: new Date(Date.now() - DAY_MS) }, { merge: true });

      const plan = await getPlan(user.uid);
      assert.equal(isPremiumActive(plan), false, "G: expirado deixa de ser Premium pelo contrato compartilhado");
      const status = await callApi(user, "/api/app-subscription/status", "GET");
      assert.equal(status.body.premiumActive, false, "G: /status também reporta Free depois do fim do período");
      assert.equal(status.body.currentPlan, "free");
    }

    // ===== H: refund/chargeback remove o Premium IMEDIATAMENTE, mesmo dentro do período pago =====
    {
      const { user, subscriptionId } = await seedActiveSubscriber("refunded");
      await callApi(user, "/api/app-subscription/cancel");
      assert.equal((await getPlan(user.uid)).premiumActive, true, "H: antes do refund ainda é Premium");

      mpState.set(subscriptionId, { ...mpState.get(subscriptionId)!, status: "cancelled", first_payment_status: "refunded" });
      const webhook = await postWebhook(subscriptionId);
      assert.equal(webhook.status, 200);

      const plan = await getPlan(user.uid);
      assert.equal(plan.premiumActive, false, "H: refund revoga o Premium na hora, sem esperar o fim do período");
      assert.equal(plan.currentPlan, "free");
      assert.equal(isPremiumActive(plan), false, "H: o contrato compartilhado também revoga (expiry no passado)");
    }

    // ===== I: renovação válida estende o Premium =====
    {
      const { user, subscriptionId } = await seedActiveSubscriber("renewed");
      const renewedNextBilling = iso(45 * DAY_MS);
      mpState.set(subscriptionId, {
        ...mpState.get(subscriptionId)!, status: "authorized", first_payment_status: "approved", next_payment_date: renewedNextBilling,
      });
      const webhook = await postWebhook(subscriptionId);
      assert.equal(webhook.status, 200);
      assert.equal(webhook.body.applied, true);

      const plan = await getPlan(user.uid);
      assert.equal(plan.premiumActive, true, "I: renovação mantém o Premium");
      assert.equal(plan.autoRenew, true, "I: renovação religa a renovação automática");
      assert.equal(new Date(plan.nextBillingAt.toDate?.() ?? plan.nextBillingAt).toISOString(), new Date(renewedNextBilling).toISOString(),
        "I: o novo fim de período é o informado pelo Mercado Pago");
      assert.equal(isPremiumActive(plan), true);
      // RELEASE-16 §5: o webhook/sync (syncPlanDataFromSubscription) também grava billingProvider —
      // seedActiveSubscriber não o define, então isto prova que o próprio fluxo authoritative o persiste.
      assert.equal(plan.billingProvider, "mercado_pago", "I: sync via webhook grava billingProvider explicitamente");
    }

    // ===== J: pending não ativa Premium =====
    {
      const { app: fbApp, user } = await createTestUser("pending");
      createdApps.push(fbApp);
      const subscriptionId = `preapproval-pending-${Math.random().toString(36).slice(2)}`;
      mpState.set(subscriptionId, { status: "pending", external_reference: user.uid });
      await planRef(user.uid).set({
        subscriptionId, subscriptionStatus: "pending", premiumActive: false, currentPlan: "free",
        autoRenew: false, updatedAt: new Date().toISOString(),
      });
      const status = await callApi(user, "/api/app-subscription/status", "GET");
      assert.equal(status.body.premiumActive, false, "J: pending nunca concede Premium");
      assert.equal(isPremiumActive(await getPlan(user.uid)), false);
    }

    // ===== K: cancelar no Mercado Pago não toca o entitlement de uma conta Google Play =====
    {
      const { app: fbApp, user } = await createTestUser("play-provider");
      createdApps.push(fbApp);
      await planRef(user.uid).set({
        billingProvider: "google_play",
        playProductId: "revendasmart_premium_monthly",
        subscriptionStatus: "authorized",
        premiumActive: true, currentPlan: "premium", premiumSource: "subscription",
        premiumExpiresAt: new Date(Date.now() + 15 * DAY_MS), autoRenew: true,
        updatedAt: new Date().toISOString(),
      });
      const before = await getPlan(user.uid);
      const cancel = await callApi(user, "/api/app-subscription/cancel");
      // RELEASE-16 §6: guarda explícita de isolamento — billingProvider="google_play" é rejeitado ANTES
      // de sequer olhar para subscriptionId (defesa em profundidade contra um bug futuro que também
      // deixasse um subscriptionId de MP preenchido numa conta Google Play).
      assert.equal(cancel.status, 409, "K: billingProvider=google_play nunca é tocado pelo endpoint MP");
      assert.equal(cancel.body.error, "SUBSCRIPTION_MANAGED_BY_GOOGLE_PLAY");
      const after = await getPlan(user.uid);
      assert.equal(after.premiumActive, true, "K: o entitlement do Google Play permanece intacto");
      assert.equal(after.billingProvider, "google_play");
      assert.equal(after.autoRenew, before.autoRenew, "K: autoRenew do Google Play não é alterado pelo endpoint MP");
      assert.equal(new Date(after.premiumExpiresAt.toDate?.() ?? after.premiumExpiresAt).toISOString(),
        new Date(before.premiumExpiresAt.toDate?.() ?? before.premiumExpiresAt).toISOString(),
        "K: o período pago pelo Google Play não é encurtado");
    }

    // ===== L: o provider Google Play tem o seu próprio caminho — nunca o endpoint do Mercado Pago =====
    {
      const clientSource = await import("node:fs").then((fs) => fs.readFileSync("client/src/pages/subscribe.tsx", "utf8"));
      assert.match(clientSource, /managesSubscriptionViaGooglePlay/,
        "L: a UI decide o caminho de cancelamento pelo provider");
      const cancelBlock = clientSource.slice(
        clientSource.indexOf("async function handleCancel"),
        clientSource.indexOf("// Actions — Android (Google Play Billing)"),
      );
      assert.ok(cancelBlock.length > 0);
      assert.match(cancelBlock, /\/api\/app-subscription\/cancel/);
      // O corpo do cancelamento MP não pode chamar NADA do Play Billing.
      assert.doesNotMatch(cancelBlock, /GooglePlay|play-billing|openAndroidSubscriptionManagement/,
        "L: o cancelamento MP nunca aciona o caminho do Google Play");
      // E o caminho do Play nunca chama o endpoint do Mercado Pago.
      const manageBlock = clientSource.slice(clientSource.indexOf("async function handleManageAndroidSubscription"));
      assert.doesNotMatch(manageBlock.slice(0, 400), /app-subscription/,
        "L: a gestão de assinatura do Google Play nunca usa o endpoint do Mercado Pago");
    }

    // ===== estrutural: /api/app-subscription/create também grava billingProvider explicitamente =====
    {
      const serverSource = await import("node:fs").then((fs) => fs.readFileSync("server/subscriptions.ts", "utf8"));
      const createBlock = serverSource.slice(
        serverSource.indexOf('export async function createSubscriptionCommand'),
        serverSource.indexOf('export async function syncSubscriptionFromProviderCommand'),
      );
      assert.match(createBlock, /billingProvider:\s*"mercado_pago"/,
        "estrutural: toda nova assinatura MP grava billingProvider desde a criação");
    }

    // ===== N: provider desconhecido nunca escolhe um fluxo perigoso (nem MP, nem Play) =====
    {
      const { resolveLegacyBillingProvider } = await import("../shared/monetization");
      // Documento nunca visto por nenhum provider: nenhuma evidência server-owned → não determinável.
      assert.equal(resolveLegacyBillingProvider(null), null);
      assert.equal(resolveLegacyBillingProvider({} as any), null, "N: planData vazio não vira nenhum provider");
      // Legado com evidência EXCLUSIVAMENTE de Mercado Pago (sem billingProvider persistido).
      assert.equal(
        resolveLegacyBillingProvider({ subscriptionId: "preapproval-legacy" } as any),
        "mercado_pago",
        "N: evidência MP legada nunca é lida como Google Play",
      );
      // Legado com evidência EXCLUSIVAMENTE de Google Play (sem billingProvider persistido).
      assert.equal(
        resolveLegacyBillingProvider({ playProductId: "revendasmart_premium_monthly" } as any),
        "google_play",
      );
      // billingProvider explícito sempre vence, mesmo com evidência contraditória de outro provider.
      assert.equal(
        resolveLegacyBillingProvider({ billingProvider: "mercado_pago", playProductId: "x" } as any),
        "mercado_pago",
      );
    }

    // ===== M: o client não consegue alterar expiry/autoRenew server-owned =====
    {
      const { user } = await seedActiveSubscriber("mass-assignment");
      await callApi(user, "/api/app-subscription/cancel");
      const before = await getPlan(user.uid);

      const forged = await callApi(user, `/api/user/settings/${user.uid}`, "POST", {
        premiumExpiresAt: iso(3650 * DAY_MS),
        autoRenew: true,
        premiumActive: true,
        subscriptionStatus: "authorized",
      });
      assert.ok(forged.status < 500, "M: a requisição forjada não derruba o servidor");

      const after = await getPlan(user.uid);
      assert.equal(
        resolvePaidThroughDate(after)!.toISOString(),
        resolvePaidThroughDate(before)!.toISOString(),
        "M: o client não consegue estender o período pago",
      );
      assert.equal(after.autoRenew, false, "M: o client não consegue religar a renovação automática");
      assert.equal(after.subscriptionStatus, "cancelled", "M: o client não consegue reativar a assinatura");
    }

    // ===== N: fronteira de data/timezone — o instante exato do fim do período =====
    {
      // Um segundo ANTES do fim: ainda Premium. Um segundo DEPOIS: Free. Comparação sempre em UTC
      // absoluto (Date.getTime()), nunca em string local — timezone do servidor não pode mudar o resultado.
      const paidThrough = new Date(Date.now() + 1000);
      const stillInside = {
        subscriptionStatus: "cancelled", premiumActive: true, currentPlan: "premium",
        premiumSource: "subscription", autoRenew: false, premiumExpiresAt: paidThrough,
      };
      assert.equal(isPremiumActive(stillInside as any), true, "N: 1s antes do fim ainda é Premium");
      assert.equal(reconcilePremiumStatusForTests("cancelled", null, stillInside).premiumActive, true);

      const justExpired = { ...stillInside, premiumExpiresAt: new Date(Date.now() - 1000) };
      assert.equal(isPremiumActive(justExpired as any), false, "N: 1s depois do fim já é Free");
      assert.equal(reconcilePremiumStatusForTests("cancelled", null, justExpired).premiumActive, false);

      // A mesma data expressa com offset de fuso diferente precisa dar o mesmo veredito.
      const utcMidnight = new Date(Date.now() + 5 * DAY_MS);
      const sameInstantOtherOffset = new Date(utcMidnight.getTime());
      assert.equal(
        resolvePaidThroughDate({ premiumExpiresAt: utcMidnight.toISOString() })!.getTime(),
        resolvePaidThroughDate({ premiumExpiresAt: sameInstantOtherOffset })!.getTime(),
        "N: string ISO e Date do mesmo instante são equivalentes",
      );
      assert.equal(resolvePaidThroughDate({ premiumExpiresAt: "not-a-date" }), null, "N: data inválida nunca vira período válido");
      assert.equal(resolvePaidThroughDate({}), null, "N: sem data não há período (fallback conservador)");
    }

    // ===== O: webhook/sync não reativa indevidamente uma renovação já cancelada =====
    {
      const { user, subscriptionId } = await seedActiveSubscriber("no-reactivation");
      await callApi(user, "/api/app-subscription/cancel");
      const afterCancel = await getPlan(user.uid);
      assert.equal(afterCancel.autoRenew, false);

      // O Mercado Pago continua reportando "cancelled" (com o pagamento original ainda aprovado).
      const webhook = await postWebhook(subscriptionId);
      assert.equal(webhook.status, 200);

      const plan = await getPlan(user.uid);
      assert.equal(plan.subscriptionStatus, "cancelled", "O: o webhook não ressuscita a assinatura");
      assert.equal(plan.autoRenew, false, "O: o webhook nunca religa a renovação automática de uma assinatura cancelada");
      assert.equal(plan.premiumActive, true, "O: e também não retira o Premium do período já pago");
      assert.equal(
        resolvePaidThroughDate(plan)!.toISOString(),
        resolvePaidThroughDate(afterCancel)!.toISOString(),
        "O: o período pago continua o mesmo depois do webhook",
      );
    }

    // ===== Legacy: documentos antigos sem os campos novos continuam legíveis =====
    {
      // Cancelado antigo, sem premiumExpiresAt nem nextBillingAt: não há como saber o período pago →
      // fallback conservador (permanece Free, exatamente como já estava antes do RELEASE-09).
      const legacyCancelled = { subscriptionStatus: "cancelled", premiumActive: false, currentPlan: "free" };
      assert.equal(resolvePaidThroughDate(legacyCancelled), null);
      assert.equal(reconcilePremiumStatusForTests("cancelled", null, legacyCancelled).premiumActive, false,
        "legacy: cancelado antigo sem data continua Free (nenhum Premium é inventado)");
      assert.equal(isPremiumActive(legacyCancelled as any), false);

      // Ativo antigo (sem autoRenew/premiumExpiresAt persistidos) continua Premium.
      const legacyActive = { subscriptionStatus: "authorized", premiumActive: true, currentPlan: "premium" };
      assert.equal(reconcilePremiumStatusForTests("authorized", "approved", legacyActive).premiumActive, true);
      assert.equal(isPremiumActive(legacyActive as any), true, "legacy: assinante ativo antigo não perde nada");
    }

    // ===== Helpers puros de revogação =====
    {
      assert.equal(isRevokingPaymentStatus("refunded"), true);
      assert.equal(isRevokingPaymentStatus("charged_back"), true);
      assert.equal(isRevokingPaymentStatus("chargeback"), true);
      assert.equal(isRevokingPaymentStatus("REFUNDED"), true, "case-insensitive");
      assert.equal(isRevokingPaymentStatus("approved"), false);
      assert.equal(isRevokingPaymentStatus("pending"), false);
      assert.equal(isRevokingPaymentStatus(null), false);
      assert.equal(isRevokingPaymentStatus(undefined), false);
      // "rejected" é uma tentativa de cobrança que falhou, não um estorno do período já pago.
      assert.equal(isRevokingPaymentStatus("rejected"), false);
    }

    // ===== Play Review account access: script administrativo, entitlement canônico, sem billing real =====
    {
      const { grantPlayReviewAccess, PlayReviewAccountNotFoundError } = await import("../script/grant-play-review-access");

      // D: falha explicitamente se a conta não existir — nunca cria um uid nem um planData "no ar".
      await assert.rejects(() => grantPlayReviewAccess(`nao-existe-${Date.now()}@example.test`), PlayReviewAccountNotFoundError);

      const { app: playReviewApp, user } = await createTestUser("play-review");
      createdApps.push(playReviewApp);
      const email = user.email!;

      // Semeia um campo não relacionado ANTES do grant, para provar que `merge: true` preserva o resto.
      await planRef(user.uid).set({ referralCode: "USER-PLAYREVIEW1", referralCount: 3 }, { merge: true });

      // A/B/C: grant concede Premium sem expiry, sem nenhum campo de billing.
      const firstGrant = await grantPlayReviewAccess(email);
      assert.equal(firstGrant.outcome, "granted");
      const plan = await getPlan(user.uid);
      assert.equal(plan.premiumSource, "play_review");
      assert.equal(plan.premiumActive, true);
      assert.equal(plan.currentPlan, "premium");
      assert.equal(plan.premiumExpiresAt, null, "A: sem data de expiração");
      assert.equal(plan.billingProvider ?? null, null, "B: nenhum billingProvider fictício");
      assert.equal(plan.subscriptionId ?? null, null, "B: nenhum subscriptionId fictício");
      assert.equal(plan.playPurchaseTokenHash ?? null, null, "B: nenhum purchaseToken/hash fictício");
      assert.equal(isPremiumActive(plan), true, "C: isPremiumActive reconhece play_review pela mesma função canônica");
      // Campo não relacionado preservado pelo merge.
      assert.equal(plan.referralCode, "USER-PLAYREVIEW1", "merge preserva campos não relacionados");
      assert.equal(plan.referralCount, 3);

      // Idempotência: rodar de novo reafirma, nunca duplica nem perde o campo não relacionado.
      const secondGrant = await grantPlayReviewAccess(email);
      assert.equal(secondGrant.outcome, "reaffirmed");
      assert.equal(secondGrant.uidMasked, firstGrant.uidMasked);
      const planAfterSecondGrant = await getPlan(user.uid);
      assert.equal(planAfterSecondGrant.premiumSource, "play_review");
      assert.equal(planAfterSecondGrant.referralCode, "USER-PLAYREVIEW1");

      // D: PlanProvider/usePlanData continuam dependendo só da função canônica — confirmado
      // estruturalmente (o teste em script/smoke-tests.ts já prova a chamada exata).
      const usePlanDataSource = await (await import("node:fs/promises")).readFile("client/src/hooks/usePlanData.ts", "utf8");
      assert.match(usePlanDataSource, /isPremiumActive\(/, "D: usePlanData decide Premium via isPremiumActive()");

      // E: reconciliadores comerciais não conseguem alcançar (nem rebaixar) a conta play_review —
      // ela nunca tem subscriptionId, então sync-now nem encontra o que sincronizar.
      const syncResult = await callApi(user, "/api/app-subscription/sync-now");
      assert.equal(syncResult.status, 404);
      assert.equal(syncResult.body.error, "NO_SUBSCRIPTION", "E: sem subscriptionId, o reconciliador MP não toca a conta");
      const planAfterSync = await getPlan(user.uid);
      assert.equal(planAfterSync.premiumActive, true, "E: play_review continua ativo após tentativa de sync");
      assert.equal(planAfterSync.premiumSource, "play_review");

      // E (defesa em profundidade): mesmo que reconcilePremiumStatus algum dia seja chamado sobre este
      // planData (ex.: um subscriptionId aparecer por engano), premiumOverride=true já é a MESMA
      // proteção "ADMIN — NUNCA SOBRESCREVE" que existe para concessões de admin — prioridade 1, antes
      // de qualquer status/pagamento hostil.
      const hostileReconciliation = reconcilePremiumStatusForTests("cancelled", "refunded", planAfterSync);
      assert.equal(hostileReconciliation.premiumActive, true, "E: premiumOverride blinda play_review de um status hostil");
      assert.equal(hostileReconciliation.reason, "admin_override");

      // E: /api/app-subscription/create nunca cria uma assinatura MP real por cima de um grant existente.
      const createResult = await callApi(user, "/api/app-subscription/create");
      assert.equal(createResult.status, 200);
      assert.equal(createResult.body.status, "existing", "E: create nunca sobrepõe o grant com uma assinatura MP real");

      // F: uma conta comum, sem play_review nem assinatura nenhuma, não ganha Premium.
      const { app: plainApp, user: plainUser } = await createTestUser("plain-no-sub");
      createdApps.push(plainApp);
      const plainStatus = await callApi(plainUser, "/api/app-subscription/status", "GET");
      assert.equal(plainStatus.status, 200);
      assert.equal(plainStatus.body.premiumActive, false, "F: conta comum sem assinatura continua Free");
    }

    console.log("Subscription cancel tests passed: período pago preservado, refund revoga, idempotência, boundary, isolamento de provider e Play Review access.");
  } finally {
    globalThis.fetch = originalFetch;
    await close(server);
    await Promise.allSettled(createdApps.map((fbApp) => deleteApp(fbApp)));
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exit(1);
});
