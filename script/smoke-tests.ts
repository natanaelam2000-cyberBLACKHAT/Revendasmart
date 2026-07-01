import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path: string) => fs.readFileSync(path, "utf8");
const routes = read("server/routes.ts");
const serverIndex = read("server/index.ts");
const publicCatalog = read("client/src/pages/public-catalog.tsx");
const layout = read("client/src/components/layout.tsx");
const settings = read("client/src/pages/settings.tsx");
const images = read("client/src/components/ProductImageCard.tsx");
const subscribe = read("client/src/pages/subscribe.tsx");
const dashboard = read("client/src/pages/dashboard.tsx");
const dashboardMetrics = read("client/src/lib/dashboard-metrics.ts");
const sell = read("client/src/pages/sell.tsx");
const subscriptions = read("server/subscriptions.ts");
const payments = read("server/payments.ts");
const mpConnections = read("server/mercadopago-connections.ts");
const app = read("client/src/App.tsx");
const partialPaymentModal = read("client/src/components/PartialPaymentModal.tsx");
const onboarding = read("client/src/pages/onboarding.tsx");
const vercel = JSON.parse(read("vercel.json"));

assert.match(routes, /catalogSlug.*catalog_slug.*userSlug.*slug/);
assert.match(routes, /catalogEnabled/);
// Public catalog scalability regressions.
const publicCatalogStart = routes.indexOf('export async function findPublicCatalogSettingsDoc');
const publicCatalogEnd = routes.indexOf('// GET /api/user/settings/:userId');
assert.ok(publicCatalogStart >= 0 && publicCatalogEnd > publicCatalogStart);
const publicCatalogRoutes = routes.slice(publicCatalogStart, publicCatalogEnd);
assert.doesNotMatch(publicCatalogRoutes, /(?:const|let) snapshot = await ref\.get\(\)/);
assert.match(publicCatalogRoutes, /return null;/);
assert.match(publicCatalogRoutes, /api\/public\/catalog\/:storeSlug", publicCatalogRateLimit/);
assert.match(publicCatalogRoutes, /u\/:storeSlug", publicCatalogRateLimit/);
assert.match(publicCatalogRoutes, /api\/public\/catalog\/:storeSlug\/products", publicCatalogRateLimit/);
assert.match(publicCatalogRoutes, /limit\(limit \+ 1\)/);
assert.match(publicCatalogRoutes, /orderBy\("stock", "desc"\)/);
assert.doesNotMatch(publicCatalogRoutes, /collection\("products"\)\.get\(\)/);
assert.doesNotMatch(publicCatalogRoutes, /catalog\.products\.find/);
assert.match(publicCatalog, /Carregar mais/);
assert.match(routes, /status\(429\).*CATALOG_RATE_LIMITED/);
assert.doesNotMatch(serverIndex, /capturedJsonResponse|JSON\.stringify\(capturedJsonResponse\)/);
assert.match(serverIndex, /content-length/);
assert.match(serverIndex, /bytes=/);
assert.match(publicCatalog, /catalogEnabled === false/);
assert.match(images, /photoUrl/);
assert.match(images, /onError/);
assert.match(images, /Sem foto/);
for (const label of ["Início", "Produtos", "Vendas", "Catálogo", "Anúncios", "Conta"]) assert.ok(layout.includes(`label:"${label}"`));
for (const path of ["/clients", "/billings", "/subscribe"]) assert.ok(settings.includes(`path: "${path}"`));
assert.match(subscribe, /Plano atual/);
assert.match(subscribe, /Number\.isNaN/);
assert.match(dashboardMetrics, /slice\(0, 5\)/);
assert.match(dashboard, /Lucro/);
assert.ok(routes.includes("/api/sales/finalize"));
assert.match(routes, /runTransaction/);
assert.match(routes, /INSUFFICIENT_STOCK/);
assert.ok(routes.includes('collection("installments")'));
assert.ok(sell.includes("/api/sales/finalize"));
assert.match(subscriptions, /createHmac\("sha256", WEBHOOK_SECRET\)/);
assert.match(subscriptions, /timingSafeEqual/);
assert.match(subscriptions, /x-signature/);
assert.match(subscriptions, /x-request-id/);
assert.match(subscriptions, /WEBHOOK_SECRET_NOT_CONFIGURED/);
assert.ok(subscriptions.includes('/^\\d{10,13}$/'));
assert.ok(!subscriptions.includes("Signature validation bypassed temporarily"));
assert.match(payments, /tokenSource: tokenSource \|\| "central"/);
assert.match(payments, /mpConnectionId = resolvedConnectionId/);
assert.match(payments, /getMPAccessTokenForCharge/);
assert.match(payments, /PAYMENT_SYNC_FAILED/);
assert.match(payments, /PAYMENT_REFERENCE_MISMATCH/);
assert.match(payments, /chargeId=\$\{encodeURIComponent\(chargeId\)\}/);
assert.match(mpConnections, /Revendedor charges never fall back to the central account/);
// Mercado Pago webhooks are fail-closed and logs do not expose credentials or identifiers.
assert.doesNotMatch(payments, /skipping signature check|Permissive when no secret/);
assert.match(payments, /if \(!WEBHOOK_SECRET\)[\s\S]*?status\(401\)/);
assert.match(payments, /if \(!rawBody \|\| !verifyWebhookSignature\(req, rawBody\)\)/);
assert.doesNotMatch(subscriptions, /ALLOW_UNSIGNED_SUBSCRIPTION_WEBHOOK|explicit-dev-bypass/);
assert.match(subscriptions, /if \(!WEBHOOK_SECRET\)[\s\S]*?status: 401/);
const subscriptionWebhook = subscriptions.slice(subscriptions.indexOf('app.post("/api/app-subscription/webhook"'));
assert.ok(subscriptionWebhook.indexOf("if (!WEBHOOK_SECRET)") < subscriptionWebhook.indexOf("const body = req.body"));
assert.doesNotMatch(payments, /Raw body:|FULL PAYLOAD:|Preference full response:|Payload fields:/);
assert.doesNotMatch(subscriptions, /Token length:|console\.log\("UID:"/);
assert.doesNotMatch(mpConnections, /OAuth state (created|consumed) for uid=|OAuth state not found: \$\{nonce\}/);
assert.match(app, /if \(authState\.loading\) return/);
assert.match(settings, /normalizeSettingsTab/);
assert.match(publicCatalog, /onError=\{\(\) => setLogoFailed\(true\)\}/);
assert.match(partialPaymentModal, /safe-area-inset-bottom/);
assert.ok(vercel.rewrites.some((rule: any) => rule.source === "/u/:storeSlug" && rule.destination === "/index.html"));

// Referral/Premium security regression checks.
const trackReferralStart = routes.indexOf('app.post("/api/referral/track-event"');
const validateReferralStart = routes.indexOf('app.post("/api/referral/validate-referral"');
const referralRoutesEnd = routes.indexOf('app.get("/api/admin/global-config"');
assert.ok(trackReferralStart >= 0 && validateReferralStart > trackReferralStart && referralRoutesEnd > validateReferralStart);
const trackReferralRoute = routes.slice(trackReferralStart, validateReferralStart);
const validateReferralRoute = routes.slice(validateReferralStart, referralRoutesEnd);
const securedReferralRoutes = `${trackReferralRoute}\n${validateReferralRoute}`;

// Anonymous calls are blocked by the shared Firebase token middleware.
assert.match(trackReferralRoute, /track-event", requireAuth/);
assert.match(validateReferralRoute, /validate-referral", requireAuth/);
// The body UID is never trusted; ownership comes from the verified token.
assert.match(securedReferralRoutes, /const referredUid = \(req as any\)\.firebaseUid/);
assert.match(securedReferralRoutes, /suppliedReferredUid !== referredUid/);
assert.match(securedReferralRoutes, /status\(403\).*REFERRAL_OWNERSHIP_MISMATCH/);
// Invalid payloads and self-referrals are rejected before Firestore writes.
assert.match(securedReferralRoutes, /status\(400\).*INVALID_REFERRAL_PAYLOAD/);
assert.match(securedReferralRoutes, /referrerUid === referredUid/);
assert.match(securedReferralRoutes, /status\(400\).*SELF_REFERRAL_NOT_ALLOWED/);
// Both real Auth users and the persisted onboarding flag are required.
assert.match(securedReferralRoutes, /admin\.auth\(\)\.getUser\(referredUid\)/);
assert.match(securedReferralRoutes, /admin\.auth\(\)\.getUser\(referrerUid\)/);
assert.match(securedReferralRoutes, /onboarding_completed !== true/);
// Deterministic pair identity plus a unique validation marker prevents double counting.
assert.match(routes, /sha256.*referrerUid.*referredUid/);
assert.match(validateReferralRoute, /validatedReferrals/);
assert.match(validateReferralRoute, /validationDoc\.exists/);
assert.match(validateReferralRoute, /status\(409\)/);
assert.match(validateReferralRoute, /DUPLICATE_REFERRAL/);
assert.match(validateReferralRoute, /transaction\.create\(validationRef/);
// Validation, unique marker, counter increment and Premium grant share one transaction.
assert.match(validateReferralRoute, /runTransaction/);
assert.match(validateReferralRoute, /const newCount = validatedReferrals.size \+ 1/);
assert.match(validateReferralRoute, /transaction\.set\(planRef, planUpdate/);
assert.match(validateReferralRoute, /newCount === REFERRAL_REWARD_LIMIT/);
assert.doesNotMatch(validateReferralRoute, /referralCount\s*=\s*body|body\.referralCount|planDoc\.data\(\)\?\.referralCount/);
// Simple per-user rate limiting protects both mutation routes.
assert.match(trackReferralRoute, /checkReferralRateLimit\(referredUid, "track"\)/);
assert.match(validateReferralRoute, /checkReferralRateLimit\(referredUid, "validate"\)/);


// Referral frontend sends a Firebase ID token and never trusts a client UID.
assert.match(onboarding, /currentUser\.getIdToken\(\)/);
assert.match(onboarding, /Authorization: `Bearer \$\{referralToken\}`/);
assert.ok(onboarding.includes("/api/referral/track-event"));
assert.ok(onboarding.includes("/api/referral/validate-referral"));
assert.doesNotMatch(onboarding, /referredUID:/);
const frontendTrackStart = onboarding.indexOf("/api/referral/track-event");
const frontendValidateStart = onboarding.indexOf("/api/referral/validate-referral");
assert.ok(frontendTrackStart >= 0 && frontendValidateStart > frontendTrackStart);
const referralFrontend = onboarding.slice(frontendTrackStart, frontendValidateStart + 600);
assert.match(referralFrontend, /status === 401 \|\| .*status === 403/);
assert.match(onboarding, /if \(refUID && uid && currentUser\)/);
const { findPublicCatalogSettingsDoc, publicCatalogRateLimit, resetPublicCatalogRateLimitsForTests } = await import("../server/routes");
const queriedFields: string[] = [];
const fakeRef = {
  where(field: string, _operator: string, candidate: string) {
    queriedFields.push(`${field}:${candidate}`);
    return {
      limit(limitValue: number) {
        assert.equal(limitValue, 1);
        return {
          async get() {
            const found = field === "catalogSlug" && candidate === "adriana-perfumes";
            return { empty: !found, docs: found ? [{ id: "owner-uid", data: () => ({ catalogSlug: candidate }) }] : [] };
          },
        };
      },
    };
  },
};
assert.equal((await findPublicCatalogSettingsDoc(fakeRef, "adriana-perfumes"))?.id, "owner-uid");
queriedFields.length = 0;
assert.equal(await findPublicCatalogSettingsDoc(fakeRef, "Slug Inexistente QA"), null);
assert.equal(queriedFields.length, 8);

resetPublicCatalogRateLimitsForTests();
let nextCalls = 0;
let lastStatus = 0;
const fakeRequest = {
  headers: { "x-forwarded-for": "203.0.113.10" },
  params: { storeSlug: "adriana-perfumes" },
  ip: "203.0.113.10",
  socket: {},
} as any;
for (let requestNumber = 1; requestNumber <= 61; requestNumber += 1) {
  lastStatus = 0;
  const fakeResponse = {
    setHeader() {},
    status(statusCode: number) { lastStatus = statusCode; return this; },
    json(payload: any) { assert.equal(payload.error, "CATALOG_RATE_LIMITED"); return this; },
  } as any;
  publicCatalogRateLimit(fakeRequest, fakeResponse, () => { nextCalls += 1; });
}
assert.equal(nextCalls, 60);
assert.equal(lastStatus, 429);

const response = await fetch("https://revendasmart-backend-cc2743rkmq-uc.a.run.app/api/public/catalog/adriana-perfumes");
assert.equal(response.status, 200);
const catalog = await response.json() as any;
assert.ok(catalog.settings?.storeName);
assert.ok(Array.isArray(catalog.products));
console.log("Smoke tests passed: catalog, images, navigation, modules, subscription and ranking.");