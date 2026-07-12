import assert from "node:assert/strict";
import fs from "node:fs";
import { APP_THEMES, DEFAULT_APP_THEME_ID, resolveAppThemeId } from "../client/src/lib/app-themes";
import { NICHO_CONFIG, getNichoConfig, getProductCategoriesForNicho } from "../client/src/lib/nicho-config";

const read = (path: string) => fs.readFileSync(path, "utf8");
const routes = read("server/routes.ts");
const serverIndex = read("server/index.ts");
const publicCatalog = read("client/src/pages/public-catalog.tsx");
const productsPage = read("client/src/pages/products.tsx");
const clientsPage = read("client/src/pages/clients.tsx");
const paginatedClientsHook = read("client/src/hooks/usePaginatedClientsData.ts");
const paginatedProductsHook = read("client/src/hooks/usePaginatedProductsData.ts");
const productPickerHook = read("client/src/hooks/useProductPickerData.ts");
const clientPickerHook = read("client/src/hooks/useClientPickerData.ts");
const marketing = read("client/src/pages/marketing.tsx");
const layout = read("client/src/components/layout.tsx");
const settings = read("client/src/pages/settings.tsx");
const images = read("client/src/components/ProductImageCard.tsx");
const subscribe = read("client/src/pages/subscribe.tsx");
const dashboard = read("client/src/pages/dashboard.tsx");
const clientDetail = read("client/src/pages/client-detail.tsx");
const clientDetailHook = read("client/src/hooks/useClientDetailData.ts");
const clientMetrics = read("client/src/lib/client-metrics.ts");
const dashboardMetrics = read("client/src/lib/dashboard-metrics.ts");
const reportMetrics = read("client/src/lib/report-metrics.ts");
const reports = read("client/src/pages/reports.tsx");
const reportExport = read("client/src/lib/report-export.ts");
const sell = read("client/src/pages/sell.tsx");
const monthlySales = read("client/src/pages/monthly-sales.tsx");
const productsSold = read("client/src/pages/products-sold.tsx");
const monthlySalesHook = read("client/src/hooks/useMonthlySalesData.ts");
const chargesHook = read("client/src/hooks/useCharges.ts");
const billingsPage = read("client/src/pages/billings.tsx");
const firestoreIndexes = read("firestore.indexes.json");
const subscriptions = read("server/subscriptions.ts");
const payments = read("server/payments.ts");
const mpConnections = read("server/mercadopago-connections.ts");
const app = read("client/src/App.tsx");
const privateRouter = read("client/src/routers/PrivateRouter.tsx");
const userSettingsProvider = read("client/src/providers/UserSettingsProvider.tsx");
const planProvider = read("client/src/providers/PlanProvider.tsx");
const appThemes = read("client/src/lib/app-themes.ts");
const onboardingChecklist = read("client/src/components/OnboardingChecklist.tsx");
const partialPaymentModal = read("client/src/components/PartialPaymentModal.tsx");
const onboarding = read("client/src/pages/onboarding.tsx");
const nichoConfig = read("client/src/lib/nicho-config.ts");
const addProduct = read("client/src/pages/add-product.tsx");
const mockData = read("client/src/lib/mock-data.ts");
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
assert.match(productsPage, /usePaginatedProductsData/);
assert.match(productsPage, /Carregar mais/);
assert.match(paginatedProductsHook, /const PRODUCTS_PAGE_SIZE = 30/);
assert.match(paginatedProductsHook, /orderBy\("name"\)/);
assert.match(paginatedProductsHook, /limit\(PRODUCTS_PAGE_SIZE\)/);
assert.match(paginatedProductsHook, /startAfter\(lastVisibleRef\.current\)/);
assert.match(paginatedProductsHook, /const loadMore = useCallback/);
assert.match(paginatedProductsHook, /function mergeProducts/);
assert.match(clientsPage, /usePaginatedClientsData/);
assert.match(clientsPage, /Carregar mais/);
assert.match(clientsPage, /totalCount \?\? clients\.length/);
assert.match(clientsPage, /Exportando clientes carregados/);
assert.match(paginatedClientsHook, /const CLIENTS_PAGE_SIZE = 30/);
assert.match(paginatedClientsHook, /orderBy\("name"\)/);
assert.match(paginatedClientsHook, /limit\(CLIENTS_PAGE_SIZE\)/);
assert.match(paginatedClientsHook, /startAfter\(lastVisibleRef\.current\)/);
assert.match(paginatedClientsHook, /getCountFromServer/);
assert.match(paginatedClientsHook, /const loadMore = useCallback/);
assert.match(routes, /status\(429\).*CATALOG_RATE_LIMITED/);
assert.doesNotMatch(serverIndex, /capturedJsonResponse|JSON\.stringify\(capturedJsonResponse\)/);
assert.match(serverIndex, /content-length/);
assert.match(serverIndex, /responseBytes/);
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
assert.match(reportMetrics, /calculateFinancialSummary/);
assert.match(reportMetrics, /calculateRanking/);
assert.match(reportMetrics, /calculateComparisons/);
assert.match(reportMetrics, /calculateReportCharts/);
assert.match(reportMetrics, /calculateIndicators/);
assert.match(reports, /useSalesData/);
assert.match(reports, /useProductsData/);
assert.match(reports, /useClientsLiteData/);
assert.match(reports, /Relatórios Premium/);
assert.match(reports, /Resumo executivo/);
assert.match(reports, /Produtos mais vendidos/);
assert.match(reports, /Exportação profissional preparada/);
assert.doesNotMatch(reports, /getStored|STORAGE_KEYS|initialProducts|initialClients/);
assert.match(reportExport, /exportReportToPdf/);
assert.match(reportExport, /exportReportToExcel/);
assert.match(reportExport, /printReport/);
assert.match(reportExport, /Resumo financeiro/);
assert.match(reports, /handleExportPdf/);
assert.match(reports, /handleExportExcel/);
assert.match(reports, /handlePrintReport/);
assert.match(clientDetail, /Resumo do cliente/);
assert.match(clientDetail, /Produtos favoritos/);
assert.match(clientDetail, /Resumo de comportamento/);
assert.match(clientDetail, /timelineByMonth/);
assert.match(clientDetail, /useClientDetailData/);
assert.doesNotMatch(clientDetail, /useClientsLiteData/);
assert.doesNotMatch(clientDetail, /useSalesData/);
assert.match(clientDetailHook, /doc\(db, "users", user\.uid, "clients", clientId\)/);
assert.match(clientDetailHook, /where\("clientId", "==", clientId\)/);
assert.match(clientDetailHook, /unsubscribeSales/);
assert.match(clientMetrics, /favoriteProducts/);
assert.match(clientMetrics, /groupClientTimelineByMonth/);
assert.match(clientMetrics, /calculateClientBehaviorSummary/);
assert.match(dashboardMetrics, /calculateDashboardPremiumIndicators/);
assert.match(dashboard, /Mini resumo executivo/);
assert.match(dashboard, /premiumIndicators/);

assert.match(dashboardMetrics, /calculateExecutiveSummary/);
assert.match(dashboardMetrics, /calculateMonthlyGoal/);
assert.match(dashboardMetrics, /calculateStockExecutiveMetrics/);
assert.match(dashboardMetrics, /calculateWorstProduct/);
assert.match(dashboardMetrics, /statusLabel/);
assert.doesNotMatch(dashboardMetrics, /999/);
assert.match(dashboardMetrics, /calculateAttentionItems/);
assert.match(dashboard, /Atenção hoje/);
assert.match(dashboard, /Meta mensal/);
assert.match(dashboard, /monthlyGoalInput/);
assert.match(dashboard, /handleSaveMonthlyGoal/);
assert.match(dashboard, /Ticket médio/);
assert.match(dashboard, /Produto campeão/);
assert.match(dashboard, /Produto parado/);
assert.match(monthlySales, /useMonthlySalesData/);
assert.match(productsSold, /useMonthlySalesData/);
assert.match(monthlySalesHook, /where\("date", ">=", range\.startIso\)/);
assert.match(monthlySalesHook, /where\("date", "<", range\.endIso\)/);
assert.match(monthlySalesHook, /orderBy\("date", "desc"\)/);
assert.match(monthlySalesHook, /limit\(MONTHLY_SALES_LIMIT\)/);
assert.match(sell, /useProductPickerData/);
assert.match(sell, /useClientPickerData/);
assert.match(sell, /Pesquisar produto/);
assert.match(sell, /Pesquisar cliente/);
assert.match(sell, /Carregar mais/);
assert.match(marketing, /useProductPickerData/);
assert.match(marketing, /Pesquisar produto/);
assert.match(marketing, /Carregar mais/);
assert.match(productPickerHook, /const PRODUCT_PICKER_PAGE_SIZE = 30/);
assert.match(productPickerHook, /orderBy\("name"\)/);
assert.match(productPickerHook, /limit\(PRODUCT_PICKER_PAGE_SIZE\)/);
assert.match(productPickerHook, /startAfter\(lastVisibleRef\.current\)/);
assert.match(productPickerHook, /const loadMore = useCallback/);
assert.match(clientPickerHook, /const CLIENT_PICKER_PAGE_SIZE = 30/);
assert.match(clientPickerHook, /orderBy\("name"\)/);
assert.match(clientPickerHook, /limit\(CLIENT_PICKER_PAGE_SIZE\)/);
assert.match(clientPickerHook, /startAfter\(lastVisibleRef\.current\)/);
assert.match(clientPickerHook, /const loadMore = useCallback/);
assert.match(nichoConfig, /Camisetas/);
assert.match(nichoConfig, /Moda Feminina/);
assert.match(nichoConfig, /Bijuterias/);
assert.match(nichoConfig, /Produção própria/);
assert.match(nichoConfig, /Garrafa térmica inox/);
assert.match(nichoConfig, /return \['Geral'\]/);
assert.match(mockData, /businessType: 'Geral'/);
assert.match(addProduct, /nichoConfig\.productNamePlaceholder/);
assert.match(addProduct, /nichoConfig\.descriptionPlaceholder/);
assert.match(addProduct, /select-origin/);
assert.match(addProduct, /normalizeBrandInput/);
assert.match(addProduct, /saveLocalBrandSuggestion/);
assert.match(nichoConfig, /originOptions/);
assert.match(addProduct, /formData\.category && !baseCategorySuggestions\.includes/);

const forbiddenCategoriesByNicho: Record<string, string[]> = {
  "Cosméticos & Perfumes": ["Eletrônicos", "Papelaria", "Casa", "Decoração", "Marmitas", "Salgados"],
  Roupas: ["Eletrônicos", "Marmitas", "Bolos", "Perfumes"],
  "Acessórios": ["Eletrônicos", "Marmitas", "Bolos", "Hidratantes"],
  "Alimentos/Doces": ["Eletrônicos", "Papelaria", "Casa", "Decoração", "Perfumes"],
};

for (const [nicho, forbiddenCategories] of Object.entries(forbiddenCategoriesByNicho)) {
  const categories = getProductCategoriesForNicho({}, nicho as keyof typeof NICHO_CONFIG);
  for (const forbiddenCategory of forbiddenCategories) {
    assert.ok(!categories.includes(forbiddenCategory), `${nicho} não deve conter ${forbiddenCategory}`);
  }
  assert.ok(categories.includes("Outros"), `${nicho} deve manter fallback Outros`);
}

const generalCategories = getProductCategoriesForNicho({}, "Geral");
assert.ok(generalCategories.includes("Eletrônicos"));
assert.ok(generalCategories.includes("Papelaria"));
const customFashionCategories = getProductCategoriesForNicho(
  { customCategoriesByNicho: { Roupas: ["Jeans Premium", "Vestidos", "Jeans Premium"] } },
  "Roupas",
);
assert.equal(customFashionCategories[0], "Jeans Premium");
assert.equal(customFashionCategories.filter((category) => category === "Jeans Premium").length, 1);
assert.ok(!customFashionCategories.includes("Eletrônicos"));
assert.equal(getNichoConfig("nicho-invalido").id, "Geral");
assert.equal(resolveAppThemeId("tema-invalido"), DEFAULT_APP_THEME_ID);
assert.equal(APP_THEMES.length, 6);
assert.match(chargesHook, /const CHARGES_PAGE_SIZE = 30/);
assert.match(chargesHook, /orderBy\("createdAt", "desc"\), limit\(CHARGES_PAGE_SIZE\)/);
assert.match(chargesHook, /startAfter\(lastChargeDocRef\.current\)/);
assert.match(chargesHook, /loadMoreCharges/);
assert.match(billingsPage, /const INSTALLMENTS_PAGE_SIZE = 30/);
assert.match(billingsPage, /createInstallmentsQuery/);
assert.match(billingsPage, /where\("status", "in", \["pending", "partial", "overdue"\]\)/);
assert.match(billingsPage, /limit\(INSTALLMENTS_PAGE_SIZE\)/);
assert.match(billingsPage, /loadMoreInstallments/);
assert.match(firestoreIndexes, /"collectionGroup": "installments"/);
assert.match(firestoreIndexes, /"fieldPath": "status"/);
assert.match(firestoreIndexes, /"fieldPath": "dueDate"/);
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
assert.match(mpConnections, /mp_connected_token_unavailable/);
assert.match(mpConnections, /MP_CONNECTED_TOKEN_UNAVAILABLE/);
assert.doesNotMatch(mpConnections, /falling back to central token/);
assert.doesNotMatch(mpConnections, /Using central payment credential fallback/);
assert.match(payments, /payment_create_blocked_connected_account/);
assert.match(payments, /Reconecte sua conta Mercado Pago para gerar cobranças/);
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
assert.match(app, /function PublicRouter/);
assert.match(app, /PrivateRouter = lazy/);
assert.match(app, /lazy\(\(\) => import\("@\/pages\/login"\)\)/);
assert.match(app, /lazy\(\(\) => import\("@\/pages\/signup"\)\)/);
assert.match(app, /lazy\(\(\) => import\("@\/pages\/public-catalog"\)\)/);
assert.match(app, /lazy\(\(\) => import\("@\/pages\/not-found"\)\)/);
assert.doesNotMatch(app, /UserSettingsProvider/);
assert.doesNotMatch(app, /PlanProvider/);
assert.match(privateRouter, /if \(authState\.loading\) return/);
assert.match(privateRouter, /UserSettingsProvider/);
assert.match(privateRouter, /PlanProvider/);
assert.match(userSettingsProvider, /invalidateUserSettings/);
assert.match(userSettingsProvider, /useUserSettingsSource/);
assert.match(userSettingsProvider, /applyAppTheme\(resolvedSettings\)/);
assert.match(appThemes, /APP_THEMES/);
assert.match(appThemes, /applyAppTheme/);
assert.match(appThemes, /CSS variables|cssVariables/);
assert.match(onboarding, /APP_THEMES/);
assert.match(onboarding, /Continuar depois/);
assert.match(onboarding, /onboarding_completed: nextCompleted/);
assert.match(onboarding, /onboarding_theme_selected: true/);
assert.match(onboarding, /customCategoriesByNicho/);
assert.match(onboarding, /renderCategoriesStep/);
assert.match(onboarding, /Criar categoria personalizada/);
assert.match(onboarding, /BUTTON_TONES/);
assert.match(onboarding, /CARD_TONES/);
assert.match(appThemes, /SHADOW_LEVELS/);
assert.match(appThemes, /RADIUS_LEVELS/);
assert.match(nichoConfig, /getProductCategoriesForNicho/);
assert.match(nichoConfig, /validBusinessTypes/);
assert.match(nichoConfig, /Marca própria/);
assert.doesNotMatch(nichoConfig, /brandLabel: 'Marca \/ Origem'/);
assert.match(addProduct, /getProductCategoriesForNicho/);
assert.match(addProduct, /baseCategorySuggestions/);
assert.match(dashboard, /OnboardingChecklist/);
assert.match(dashboard, /products\.length > 0/);
assert.match(onboardingChecklist, /local|Primeiros passos|Configure sua loja/);
assert.match(planProvider, /api\/plan\/data/);
assert.match(planProvider, /onAuthStateChanged/);
assert.match(planProvider, /limits/);
assert.match(clientsPage, /usePlan\(\)/);
assert.match(settings, /providers\/UserSettingsProvider/);
assert.match(dashboard, /providers\/UserSettingsProvider/);
assert.match(productsPage, /providers\/UserSettingsProvider/);
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
assert.match(onboarding, /if \(!currentUser \|\| !uid\) return/);
assert.match(onboarding, /if \(!refUID\) return/);
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

if (process.env.RUN_LIVE_PUBLIC_CATALOG_SMOKE === "1") {
  const response = await fetch("https://revendasmart-backend-cc2743rkmq-uc.a.run.app/api/public/catalog/adriana-perfumes");
  assert.equal(response.status, 200);
  const catalog = await response.json() as any;
  assert.ok(catalog.settings?.storeName);
  assert.ok(Array.isArray(catalog.products));
}

console.log("Smoke tests passed: catalog, images, navigation, modules, subscription and ranking.");
