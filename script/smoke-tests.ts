import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path: string) => fs.readFileSync(path, "utf8");
const routes = read("server/routes.ts");
const publicCatalog = read("client/src/pages/public-catalog.tsx");
const layout = read("client/src/components/layout.tsx");
const settings = read("client/src/pages/settings.tsx");
const images = read("client/src/components/ProductImageCard.tsx");
const subscribe = read("client/src/pages/subscribe.tsx");
const dashboard = read("client/src/pages/dashboard.tsx");
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
assert.match(publicCatalog, /catalogEnabled === false/);
assert.match(images, /photoUrl/);
assert.match(images, /onError/);
assert.match(images, /Sem foto/);
for (const label of ["Início", "Produtos", "Vendas", "Catálogo", "Anúncios", "Conta"]) assert.ok(layout.includes(`label:"${label}"`));
for (const path of ["/clients", "/billings", "/subscribe"]) assert.ok(settings.includes(`path: "${path}"`));
assert.match(subscribe, /Plano atual/);
assert.match(subscribe, /Number\.isNaN/);
assert.match(dashboard, /slice\(0, 5\)/);
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
const response = await fetch("https://revendasmart-backend-cc2743rkmq-uc.a.run.app/api/public/catalog/adriana-perfumes");
assert.equal(response.status, 200);
const catalog = await response.json() as any;
assert.ok(catalog.settings?.storeName);
assert.ok(Array.isArray(catalog.products));
console.log("Smoke tests passed: catalog, images, navigation, modules, subscription and ranking.");