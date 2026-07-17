import assert from "node:assert/strict";
import fs from "node:fs";
import { MercadoPagoConfig, PreApproval } from "mercadopago";
import {
  isMercadoPagoProductionAccessToken,
  isMercadoPagoSandboxAccessToken,
  maskMercadoPagoExternalId,
  normalizeMercadoPagoEnvironment,
  validateMercadoPagoAccessTokenForEnvironment,
} from "../server/mercadopago-environment";

const read = (path: string) => fs.readFileSync(path, "utf8");
const subscriptions = read("server/subscriptions.ts");
const envGuard = read("server/mercadopago-environment.ts");
const subscribePage = read("client/src/pages/subscribe.tsx");
const packageJson = JSON.parse(read("package.json"));

function routeBlock(startNeedle: string, endNeedle: string): string {
  const start = subscriptions.indexOf(startNeedle);
  assert.ok(start >= 0, `missing route start ${startNeedle}`);
  const end = subscriptions.indexOf(endNeedle, start + startNeedle.length);
  assert.ok(end > start, `missing route end ${endNeedle}`);
  return subscriptions.slice(start, end);
}

const createRoute = routeBlock('app.post("/api/app-subscription/create"', '// ✅ CANCEL');
const cancelRoute = routeBlock('app.post("/api/app-subscription/cancel"', '// ✅ STATUS');
const statusRoute = routeBlock('app.get("/api/app-subscription/status"', '// ✅ SYNC NOW');
const syncNowRoute = routeBlock('app.post("/api/app-subscription/sync-now"', 'app.post("/api/app-subscription/webhook"');
const webhookRoute = subscriptions.slice(subscriptions.indexOf('app.post("/api/app-subscription/webhook"'));

// Credential/environment guardrails.
assert.equal(normalizeMercadoPagoEnvironment(undefined), "production");
assert.equal(normalizeMercadoPagoEnvironment("sandbox"), "sandbox");
assert.equal(isMercadoPagoSandboxAccessToken("TEST-123"), true);
assert.equal(isMercadoPagoProductionAccessToken("APP_USR-123"), true);
assert.deepEqual(validateMercadoPagoAccessTokenForEnvironment("APP_USR-production", "sandbox"), {
  ok: false,
  environment: "sandbox",
  code: "PRODUCTION_TOKEN_IN_SANDBOX",
});
assert.deepEqual(validateMercadoPagoAccessTokenForEnvironment("TEST-sandbox", "production"), {
  ok: false,
  environment: "production",
  code: "SANDBOX_TOKEN_IN_PRODUCTION",
});
assert.equal(validateMercadoPagoAccessTokenForEnvironment("TEST-sandbox", "sandbox").ok, true);
assert.equal(validateMercadoPagoAccessTokenForEnvironment("", "sandbox").ok, true);
assert.match(envGuard, /PRODUCTION_TOKEN_IN_SANDBOX/);
assert.match(envGuard, /SANDBOX_TOKEN_IN_PRODUCTION/);
assert.match(envGuard, /UNKNOWN_SANDBOX_TOKEN/);

// Auth and route ownership.
assert.match(createRoute, /requireAuth/);
assert.match(cancelRoute, /requireAuth/);
assert.match(statusRoute, /requireAuth/);
assert.match(syncNowRoute, /requireAuth/);
assert.doesNotMatch(webhookRoute.slice(0, 180), /requireAuth/);
assert.match(createRoute, /sendSubscriptionCredentialError\(res, "create", uid\)/);
assert.match(cancelRoute, /sendSubscriptionCredentialError\(res, "cancel", uid\)/);
assert.match(syncNowRoute, /sendSubscriptionCredentialError\(res, "sync-now", uid\)/);
assert.match(webhookRoute, /sendSubscriptionCredentialError\(res, "webhook", null\)/);

// Create route keeps price and ownership server-side.
assert.match(createRoute, /transaction_amount:\s*PREMIUM_PRICE_BRL/);
assert.match(createRoute, /external_reference:\s*uid/);
assert.match(createRoute, /payer_email:\s*userEmail/);
assert.doesNotMatch(createRoute, /req\.body\.(price|plan|transaction_amount|premiumActive|currentPlan)/);

// Cancel/status/sync operate only on the authenticated user's planData.
for (const route of [cancelRoute, statusRoute, syncNowRoute]) {
  assert.match(route, /collection\("users"\)\.doc\(uid\)\.collection\("planData"\)\.doc\("main"\)/);
}
assert.match(cancelRoute, /idempotent:\s*true/);
assert.match(cancelRoute, /subscriptionStatus:\s*"cancelled"/);
assert.match(syncNowRoute, /SUBSCRIPTION_OWNERSHIP_MISMATCH/);
assert.match(syncNowRoute, /external_reference/);
assert.match(syncNowRoute, /source:\s*"sync-now"/);

// Webhook validates signature before any Mercado Pago API call and stores event context.
assert.ok(webhookRoute.indexOf("validateSubscriptionWebhookSignature") < webhookRoute.indexOf("new PreApproval"));
assert.match(webhookRoute, /buildSubscriptionEventId/);
assert.match(webhookRoute, /extractMercadoPagoSubscriptionEventDate/);
assert.match(webhookRoute, /source:\s*"webhook"/);
assert.match(webhookRoute, /applied:\s*syncResult\.applied/);

// Idempotency and out-of-order event guards.
assert.match(subscriptions, /lastSubscriptionEventId/);
assert.match(subscriptions, /lastSubscriptionEventAt/);
assert.match(subscriptions, /duplicate_event/);
assert.match(subscriptions, /stale_event/);
assert.match(subscriptions, /isDuplicateSubscriptionEvent/);
assert.match(subscriptions, /isOlderSubscriptionEvent/);

function shouldApplyEvent(existing: { id?: string | null; at?: Date | null }, event: { id?: string | null; at?: Date | null }) {
  if (event.id && existing.id === event.id) return { applied: false, reason: "duplicate_event" } as const;
  if (existing.at && event.at && event.at.getTime() < existing.at.getTime()) return { applied: false, reason: "stale_event" } as const;
  return { applied: true, reason: "applied" } as const;
}
assert.deepEqual(shouldApplyEvent({ id: "evt-1", at: new Date("2026-07-17T10:00:00Z") }, { id: "evt-1", at: new Date("2026-07-17T10:00:00Z") }), { applied: false, reason: "duplicate_event" });
assert.deepEqual(shouldApplyEvent({ id: "evt-2", at: new Date("2026-07-17T10:00:00Z") }, { id: "evt-1", at: new Date("2026-07-17T09:59:59Z") }), { applied: false, reason: "stale_event" });
assert.deepEqual(shouldApplyEvent({ id: "evt-1", at: new Date("2026-07-17T10:00:00Z") }, { id: "evt-2", at: new Date("2026-07-17T10:00:01Z") }), { applied: true, reason: "applied" });

// Frontend remains a consumer of server routes; it does not define price/client-side entitlement.
assert.match(subscribePage, /\/api\/app-subscription\/create/);
assert.match(subscribePage, /\/api\/app-subscription\/cancel/);
assert.match(subscribePage, /usePlanData/);
assert.doesNotMatch(subscribePage, /transaction_amount|premiumActive:\s*true|currentPlan:\s*"premium"/);
assert.equal(packageJson.scripts["test:mercado-pago:sandbox"], "tsx script/mercado-pago-sandbox-tests.ts");

async function runOptionalLiveSandboxCycle() {
  if (process.env.RUN_MERCADO_PAGO_SANDBOX_LIVE !== "1") {
    console.log("Mercado Pago Sandbox externo: pendente (RUN_MERCADO_PAGO_SANDBOX_LIVE != 1). Testes locais sem credenciais passaram.");
    return;
  }

  const accessToken = (process.env.MERCADOPAGO_SANDBOX_ACCESS_TOKEN || process.env.MERCADOPAGO_ACCESS_TOKEN || "").trim();
  const payerEmail = (process.env.MERCADOPAGO_SANDBOX_PAYER_EMAIL || "").trim();
  const validation = validateMercadoPagoAccessTokenForEnvironment(accessToken, "sandbox");
  assert.equal(validation.ok, true, "live sandbox cycle requires a TEST-* Mercado Pago token");
  assert.ok(payerEmail.includes("@"), "MERCADOPAGO_SANDBOX_PAYER_EMAIL is required for the live sandbox cycle");

  const client = new MercadoPagoConfig({ accessToken, options: { timeout: 15000 } });
  const preApproval = new PreApproval(client);
  const externalReference = `revendasmart-sandbox-${Date.now()}`;
  const response = await preApproval.create({
    body: {
      reason: "RevendaSmart Sandbox QA",
      external_reference: externalReference,
      payer_email: payerEmail,
      auto_recurring: {
        frequency: 1,
        frequency_type: "months",
        transaction_amount: 1,
        currency_id: "BRL",
      },
      back_url: "https://revendasmart.vercel.app/subscribe",
      status: "pending",
    },
  });

  assert.ok(response.id, "Sandbox PreApproval should return an id");
  try {
    await preApproval.update({ id: response.id, body: { status: "cancelled" } });
  } catch (error) {
    console.warn("Sandbox cleanup failed; verify manually:", maskMercadoPagoExternalId(response.id));
    throw error;
  }
  console.log(`Mercado Pago Sandbox externo executado com assinatura ${maskMercadoPagoExternalId(response.id)} e cancelamento OK.`);
}

await runOptionalLiveSandboxCycle();
console.log("Mercado Pago sandbox guardrails passed.");
