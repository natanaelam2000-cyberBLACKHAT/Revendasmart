import assert from "node:assert/strict";
import fs, { existsSync } from "node:fs";
import { APP_THEME_IDS, APP_THEMES, DEFAULT_APP_THEME_ID, DESIGN_TOKEN_NAMES, buildDesignSystemVariables, resolveAppThemeId } from "../client/src/lib/app-themes";
import { NICHO_CONFIG, ONBOARDING_NICHO_IDS, getNichoConfig, getProductCategoriesForNicho } from "../client/src/lib/nicho-config";
import { CATALOG_SERVER_SEARCH_ENABLED, PRODUCT_SEARCH_SCHEMA_VERSION, SERVER_SIDE_CLIENT_SEARCH_ENABLED, SERVER_SIDE_PRODUCT_SEARCH_ENABLED, buildProductSearchBackfillPatch, buildProductSearchFields, buildProductServerSearchPlan, buildProductServerSearchQuerySpec, canUseCatalogServerSearch, getProductSearchIndexStatus, isLikelyBarcodeSearchTerm, isProductSearchIndexed, normalizeProductBarcode, normalizeProductSearchText, productMatchesLocalSearch, sanitizeProductSearchPageSize } from "../client/src/lib/product-search";
import { buildStoreIntelligence } from "../client/src/lib/store-health";
import { defaultSettings } from "../client/src/lib/mock-data";
import { buildProductCreatePayload } from "../client/src/lib/product-payload";
import { MARKETING_AD_THEME_IDS, buildMarketingAdConfig, buildMarketingAdMessage, buildMarketingAdVisualModel, buildMarketingWhatsappUrl, formatMarketingPrice, normalizeMarketingAdConfig, normalizeMarketingCtaText, normalizeMarketingGeneratedText, sanitizeMarketingHistoryPayload } from "../client/src/lib/marketing-ad";
import { sanitizeMarketingFileName } from "../client/src/lib/marketing-share";
import { buildPublicCatalogUrl, normalizePublicAppBaseUrl, resolvePublicAppBaseUrl } from "../client/src/lib/public-url";
import { HOME_SUMMARY_KPI_IDS, buildHomeDashboardViewModel } from "../client/src/lib/home-dashboard-view-model";
import { validateMercadoPagoAccessTokenForEnvironment } from "../server/mercadopago-environment";
import { buildHealthPayload, buildReadinessPayload, buildSafeErrorBody, classifySafeError, createRequestId, normalizeRequestId, requestIdMiddleware, sanitizeForLog } from "../server/logger";
import { ApiError, apiRequest, buildApiErrorDisplayMessage, formatApiSupportCode } from "../client/src/lib/api-client";
import { buildApiUrl, normalizeApiBaseUrl, resolveApiBaseUrl } from "../client/src/lib/api-config";

const read = (path: string) => fs.readFileSync(path, "utf8");
const routes = read("server/routes.ts");
const serverIndex = read("server/index.ts");
const loggerSource = read("server/logger.ts");
const observabilityDocs = read("docs/OBSERVABILITY.md");
const tokenEfficiencyDocs = read("docs/TOKEN_EFFICIENCY_SKILLS.md");
const nextStepsPlan = read("docs/qa/NEXT_STEPS_PLAN.md");
const minimalChangeSkill = read(".codex/skills/minimal-change-engineering/SKILL.md");
const conciseOutputSkill = read(".codex/skills/concise-technical-output/SKILL.md");
const terminalOutputSkill = read(".codex/skills/terminal-output-efficiency/SKILL.md");
const publicCatalog = read("client/src/pages/public-catalog.tsx");
const catalog = read("client/src/pages/catalog.tsx");
const productsPage = read("client/src/pages/products.tsx");
const clientsPage = read("client/src/pages/clients.tsx");
const paginatedClientsHook = read("client/src/hooks/usePaginatedClientsData.ts");
const paginatedProductsHook = read("client/src/hooks/usePaginatedProductsData.ts");
const productPickerHook = read("client/src/hooks/useProductPickerData.ts");
const clientPickerHook = read("client/src/hooks/useClientPickerData.ts");
const marketing = read("client/src/pages/marketing.tsx");
const marketingAd = read("client/src/lib/marketing-ad.ts");
const marketingCard = read("client/src/lib/marketing-card.ts");
const marketingShare = read("client/src/lib/marketing-share.ts");
const publicUrl = read("client/src/lib/public-url.ts");
const marketingCanvas = read("client/src/components/MarketingAdCanvas.tsx");
const marketingHistoryHook = read("client/src/hooks/useMarketingHistory.ts");
const marketingHistoryPanel = read("client/src/components/MarketingHistoryPanel.tsx");
const layout = read("client/src/components/layout.tsx");
const settings = read("client/src/pages/settings.tsx");
const images = read("client/src/components/ProductImageCard.tsx");
const subscribe = read("client/src/pages/subscribe.tsx");
const dashboard = read("client/src/pages/dashboard.tsx");
const homeDashboardViewModel = read("client/src/lib/home-dashboard-view-model.ts");
const storeIntelligencePanel = read("client/src/components/StoreIntelligencePanel.tsx");
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
const sharedCharges = read("shared/charges.ts");
const firestoreIndexes = read("firestore.indexes.json");
const firestoreIndexConfig = JSON.parse(firestoreIndexes);
const subscriptions = read("server/subscriptions.ts");
const mercadoPagoEnvironment = read("server/mercadopago-environment.ts");
const mercadoPagoSandboxTests = read("script/mercado-pago-sandbox-tests.ts");
const mercadoPagoSandboxDocs = read("docs/MERCADO_PAGO_SANDBOX_TESTING.md");
const payments = read("server/payments.ts");
const mpConnections = read("server/mercadopago-connections.ts");
const app = read("client/src/App.tsx");
const main = read("client/src/main.tsx");
const indexHtml = read("client/index.html");
const serviceWorker = read("client/public/sw.js");
const manifest = JSON.parse(read("client/public/manifest.json"));
const privateRouter = read("client/src/routers/PrivateRouter.tsx");
const userSettingsProvider = read("client/src/providers/UserSettingsProvider.tsx");
const planProvider = read("client/src/providers/PlanProvider.tsx");
const appThemes = read("client/src/lib/app-themes.ts");
const buildInfo = read("client/src/lib/build-info.ts");
const onboardingChecklist = read("client/src/components/OnboardingChecklist.tsx");
const partialPaymentModal = read("client/src/components/PartialPaymentModal.tsx");
const onboarding = read("client/src/pages/onboarding.tsx");
const nichoConfig = read("client/src/lib/nicho-config.ts");
const addProduct = read("client/src/pages/add-product.tsx");
const mockData = read("client/src/lib/mock-data.ts");
const productSearch = read("client/src/lib/product-search.ts");
const productPayload = read("client/src/lib/product-payload.ts");
const recentProducts = read("client/src/lib/recent-products.ts");
const internalTelemetry = read("client/src/lib/internal-telemetry.ts");
const storeHealth = read("client/src/lib/store-health.ts");
const catalogProductsHook = read("client/src/hooks/useCatalogProductsData.ts");
const firestoreRules = read("firestore.rules");
const productSearchBackfill = read("docs/architecture/PRODUCT_SEARCH_INDEX_BACKFILL.md");
const serverSideSearchDoc = read("docs/architecture/SERVER_SIDE_SEARCH.md");
const searchDataModelDoc = read("docs/architecture/SEARCH_DATA_MODEL.md");
const searchBackfillDoc = read("docs/operations/SEARCH_BACKFILL.md");
const searchBackfillScript = read("scripts/search/backfill-search-fields.ts");
const vercel = JSON.parse(read("vercel.json"));
const packageJson = JSON.parse(read("package.json"));
const firebaseJson = JSON.parse(read("firebase.json"));
const firebaseClient = read("client/src/lib/firebase.ts");
const buildScript = read("script/build.ts");
const firebaseEmulatorTests = read("script/firebase-emulator-tests.ts");
const firebaseEmulatorDocs = read("docs/FIREBASE_EMULATOR_TESTING.md");
const capacitorConfig = read("capacitor.config.ts");
const androidBuildGradle = read("android/app/build.gradle");
const androidManifest = read("android/app/src/main/AndroidManifest.xml");
const androidStrings = read("android/app/src/main/res/values/strings.xml");
const androidStyles = read("android/app/src/main/res/values/styles.xml");
const androidStylesV28 = read("android/app/src/main/res/values-v28/styles.xml");
const androidMainActivity = read("android/app/src/main/java/com/revendasmart/app/MainActivity.java");
const androidDocs = read("docs/ANDROID_CAPACITOR.md");
const androidDebugDocs = read("docs/ANDROID_DEBUG_TESTING.md");
const androidGitignore = read("android/.gitignore");
const androidBuildDebugScript = read("scripts/android/build-debug.mjs");
const androidBuildProvenanceScript = read("scripts/android/build-provenance.mjs");
const androidVerifyDebugApkScript = read("scripts/android/verify-debug-apk.mjs");
const androidInstallDebugScript = read("scripts/android/install-debug.mjs");
const androidLogcatScript = read("scripts/android/logcat.mjs");
const androidSyncWebScript = read("scripts/android/sync-web.mjs");
const androidColors = read("android/app/src/main/res/values/colors.xml");
const androidLauncherBackground = read("android/app/src/main/res/values/ic_launcher_background.xml");

function productIndexSignature(fields: Array<Record<string, string>>) {
  return fields.map((field) => `${field.fieldPath}:${field.arrayConfig || field.order}`).join("|");
}

const productIndexSignatures = new Set(
  firestoreIndexConfig.indexes
    .filter((index: { collectionGroup?: string }) => index.collectionGroup === "products")
    .map((index: { fields: Array<Record<string, string>> }) => productIndexSignature(index.fields))
);

function assertProductIndex(fields: Array<Record<string, string>>) {
  const signature = productIndexSignature(fields);
  assert.ok(productIndexSignatures.has(signature), `missing Firestore product index ${signature}`);
}

function assertNoProductIndex(fields: Array<Record<string, string>>) {
  const signature = productIndexSignature(fields);
  assert.equal(productIndexSignatures.has(signature), false, `unexpected Firestore product index ${signature}`);
}

function asc(fieldPath: string) {
  return { fieldPath, order: "ASCENDING" };
}

function contains(fieldPath: string) {
  return { fieldPath, arrayConfig: "CONTAINS" };
}

function serverPlan(term: string) {
  return buildProductServerSearchPlan({ term, serverSearchEnabled: true });
}

function querySpec(term: string, categoryFilter?: string) {
  return buildProductServerSearchQuerySpec({ plan: serverPlan(term), categoryFilter });
}

assert.equal(normalizeProductSearchText("  Café   Premium 123!! "), "cafe premium 123");
assert.equal(normalizeProductSearchText("Água de Cheiro"), "agua de cheiro");
assert.equal(normalizeProductSearchText("Perfume Águas de Verão"), "perfume aguas de verao");
assert.equal(normalizeProductSearchText("  perfume   aguas  de verao "), "perfume aguas de verao");
assert.equal(normalizeProductSearchText("JOÃO"), "joao");
assert.equal(normalizeProductSearchText("Kit 2-em-1"), "kit 2 em 1");
assert.equal(normalizeProductSearchText("  Cuidados   com PÉLE  "), "cuidados com pele");
assert.equal(normalizeProductSearchText("PERFUMES"), "perfumes");
assert.equal(normalizeProductBarcode("0012345678905"), "0012345678905");
assert.equal(isLikelyBarcodeSearchTerm("0012345678905"), true);
assert.equal(sanitizeProductSearchPageSize(999), 50);
assert.equal(sanitizeProductSearchPageSize("bad"), 20);
const productSearchFields = buildProductSearchFields({
  name: "Perfume Flor de Café",
  brand: "Natura",
  category: "Perfumes",
  barcode: "7891234567890",
  productType: "cosmeticos",
});
assert.equal(productSearchFields.nameNormalized, "perfume flor de cafe");
assert.equal(productSearchFields.brandNormalized, "natura");
assert.equal(productSearchFields.categoryNormalized, "perfumes");
assert.equal(productSearchFields.barcodeNormalized, "7891234567890");
assert.equal(productSearchFields.searchSchemaVersion, PRODUCT_SEARCH_SCHEMA_VERSION);
for (const token of ["perfume", "flor", "cafe", "natura", "perfumes", "7891234567890"]) {
  assert.ok(productSearchFields.searchTokens.includes(token), `missing product search token ${token}`);
}
assert.equal(CATALOG_SERVER_SEARCH_ENABLED, false);
assert.equal(SERVER_SIDE_PRODUCT_SEARCH_ENABLED, false);
assert.equal(SERVER_SIDE_CLIENT_SEARCH_ENABLED, false);
assert.equal(canUseCatalogServerSearch("a"), false);
assert.equal(canUseCatalogServerSearch("ab"), true);
assert.equal(isProductSearchIndexed({ searchSchemaVersion: PRODUCT_SEARCH_SCHEMA_VERSION, searchTokens: ["perfume"] }), false);
assert.equal(isProductSearchIndexed({ searchSchemaVersion: PRODUCT_SEARCH_SCHEMA_VERSION + 1, searchTokens: ["perfume"] }), false);
assert.equal(getProductSearchIndexStatus({}), "missing");
assert.equal(getProductSearchIndexStatus({ searchSchemaVersion: PRODUCT_SEARCH_SCHEMA_VERSION + 1, searchTokens: ["perfume"] }), "future_schema");
assert.equal(getProductSearchIndexStatus({ searchSchemaVersion: PRODUCT_SEARCH_SCHEMA_VERSION, searchTokens: ["perfume"] }), "partial");
const indexedProductSearchRecord = {
  name: "Perfume Flor de Café",
  brand: "Natura",
  category: "Perfumes",
  barcode: "7891234567890",
  productType: "cosmeticos",
  ...productSearchFields,
};
assert.equal(isProductSearchIndexed(indexedProductSearchRecord), true);
assert.equal(getProductSearchIndexStatus(indexedProductSearchRecord), "indexed");
assert.equal(buildProductServerSearchPlan({ term: "perfume", serverSearchEnabled: false }).kind, "disabled");
assert.equal(buildProductServerSearchPlan({ term: "p", serverSearchEnabled: true }).kind, "term_too_short");
assert.equal(buildProductServerSearchPlan({ term: "0012345678905", serverSearchEnabled: true }).kind, "barcode_exact");
assert.equal(buildProductServerSearchPlan({ term: "perfume aguas", serverSearchEnabled: true }).kind, "token");
assert.equal(buildProductServerSearchPlan({ term: "perf", serverSearchEnabled: true }).kind, "name_prefix");

const defaultListSpec = buildProductServerSearchQuerySpec({ plan: buildProductServerSearchPlan({ term: "", serverSearchEnabled: true }), categoryFilter: "todos" });
assert.equal(defaultListSpec.indexKey, "single:nameNormalized");
assert.equal(defaultListSpec.orderByField, "nameNormalized");
assert.equal(defaultListSpec.hasCategoryFilter, false);
assert.deepEqual(defaultListSpec.filters, []);
const defaultListWithCategorySpec = buildProductServerSearchQuerySpec({ plan: buildProductServerSearchPlan({ term: "", serverSearchEnabled: true }), categoryFilter: "  PERFUMES  " });
assert.equal(defaultListWithCategorySpec.indexKey, "categoryNormalized_nameNormalized");
assert.equal(defaultListWithCategorySpec.normalizedCategoryFilter, "perfumes");
assert.deepEqual(defaultListWithCategorySpec.filters.map((filter) => `${filter.fieldPath}:${filter.op}`), ["categoryNormalized:=="]);
const prefixSpec = querySpec("perf", "todos");
assert.equal(prefixSpec.indexKey, "single:nameNormalized");
assert.deepEqual(prefixSpec.filters.map((filter) => `${filter.fieldPath}:${filter.op}`), ["nameNormalized:prefix"]);
const prefixWithCategorySpec = querySpec("perf", "  Cuidados   com PÉLE  ");
assert.equal(prefixWithCategorySpec.indexKey, "categoryNormalized_nameNormalized");
assert.equal(prefixWithCategorySpec.normalizedCategoryFilter, "cuidados com pele");
assert.deepEqual(prefixWithCategorySpec.filters.map((filter) => `${filter.fieldPath}:${filter.op}`), ["categoryNormalized:==", "nameNormalized:prefix"]);
const tokenSpec = querySpec("perfume aguas", "todos");
assert.equal(tokenSpec.indexKey, "searchTokens_nameNormalized");
assert.deepEqual(tokenSpec.filters.map((filter) => `${filter.fieldPath}:${filter.op}`), ["searchTokens:array-contains"]);
const tokenWithCategorySpec = querySpec("perfume aguas", "  PERFUMES  ");
assert.equal(tokenWithCategorySpec.indexKey, "categoryNormalized_searchTokens_nameNormalized");
assert.deepEqual(tokenWithCategorySpec.filters.map((filter) => `${filter.fieldPath}:${filter.op}`), ["categoryNormalized:==", "searchTokens:array-contains"]);
const barcodeSpec = querySpec("0012345678905", "todos");
assert.equal(barcodeSpec.indexKey, "barcodeNormalized_nameNormalized");
assert.deepEqual(barcodeSpec.filters.map((filter) => `${filter.fieldPath}:${filter.op}`), ["barcodeNormalized:=="]);
const barcodeWithCategorySpec = querySpec("0012345678905", "  Cuidados   com PÉLE  ");
assert.equal(barcodeWithCategorySpec.indexKey, "categoryNormalized_barcodeNormalized_nameNormalized");
assert.deepEqual(barcodeWithCategorySpec.filters.map((filter) => `${filter.fieldPath}:${filter.op}`), ["categoryNormalized:==", "barcodeNormalized:=="]);
assert.equal(querySpec("perf", "   ").hasCategoryFilter, false);
assert.equal(querySpec("perf", "todos").hasCategoryFilter, false);
assert.equal(productMatchesLocalSearch({ name: "Perfume Águas", brand: "", category: "", productType: "", barcode: "0012345678905" }, "aguas"), true);
assert.equal(productMatchesLocalSearch({ name: "Perfume Águas", brand: "", category: "", productType: "", barcode: "0012345678905" }, "0012345678905"), true);
assert.ok(buildProductSearchFields({ name: Array.from({ length: 40 }, (_, index) => `token${index}`).join(" ") }).searchTokens.length <= 16);
assert.equal(buildProductSearchBackfillPatch({ ...indexedProductSearchRecord }), null);
assert.ok(buildProductSearchBackfillPatch({ name: "Perfume Novo", brand: "Marca", category: "Perfumes", barcode: "0012345678905", productType: "Cosmeticos" }));
assert.match(productSearch, /SERVER_SIDE_PRODUCT_SEARCH_ENABLED = false/);
assert.match(productSearch, /CATALOG_SERVER_SEARCH_ENABLED = SERVER_SIDE_PRODUCT_SEARCH_ENABLED/);

for (const skill of [minimalChangeSkill, conciseOutputSkill, terminalOutputSkill]) {
  assert.match(skill, /defaultMode: REVIEW_ONLY/);
  assert.match(skill, /Não fazer commit/);
  assert.match(skill, /Não fazer deploy/);
  assert.match(skill, /Não imprimir segredos/);
  assert.match(skill, /production/);
}
assert.match(tokenEfficiencyDocs, /RTK foi analisado/);
assert.match(tokenEfficiencyDocs, /não foi instalado/i);
assert.match(tokenEfficiencyDocs, /Bonsai Memory foi avaliado/);
assert.match(tokenEfficiencyDocs, /Medições locais reais/);

function jsonApiResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function textApiResponse(body: string, status: number, headers: Record<string, string> = {}) {
  return new Response(body, { status, headers });
}

assert.equal(normalizeApiBaseUrl("https://revendasmart.vercel.app/"), "https://revendasmart.vercel.app");
assert.equal(resolveApiBaseUrl("https://revendasmart.vercel.app/", "https://localhost"), "https://revendasmart.vercel.app");
assert.equal(resolveApiBaseUrl(undefined, "https://revendasmart.vercel.app"), "https://revendasmart.vercel.app");
assert.equal(buildApiUrl("https://revendasmart.vercel.app/", "/api/test"), "https://revendasmart.vercel.app/api/test");
assert.equal(buildApiUrl("https://revendasmart.vercel.app/", "api/test"), "https://revendasmart.vercel.app/api/test");
assert.equal(buildApiUrl("", "/api/test"), "/api/test");
assert.equal(buildApiUrl("https://revendasmart.vercel.app", "https://example.com/api/test"), "https://example.com/api/test");


const apiSuccess = await apiRequest<{ ok: true; value: number }>("/api/test-success", {
  fetchImpl: async (input) => {
    assert.match(String(input), /\/api\/test-success$/);
    return jsonApiResponse({ ok: true, value: 7 });
  },
});
assert.deepEqual(apiSuccess, { ok: true, value: 7 });
const apiNoBody = await apiRequest<void>("/api/no-content", {
  fetchImpl: async () => new Response(null, { status: 204 }),
});
assert.equal(apiNoBody, undefined);
try {
  await apiRequest("/api/error-json-request-id", {
    fetchImpl: async () => jsonApiResponse({ message: "Falha segura", error: { code: "SAFE_FAILURE", requestId: "req-body-123" } }, 500, { "X-Request-Id": "req-header-999" }),
  });
  assert.fail("apiRequest should throw on 500");
} catch (error) {
  assert.ok(error instanceof ApiError);
  assert.equal(error.status, 500);
  assert.equal(error.code, "SAFE_FAILURE");
  assert.equal(error.message, "Falha segura");
  assert.equal(error.requestId, "req-body-123");
  assert.equal(formatApiSupportCode(error), "Código de atendimento: REQ-BODY-123");
}
try {
  await apiRequest("/api/error-header-request-id", {
    fetchImpl: async () => jsonApiResponse({ message: "Serviço indisponível" }, 503, { "X-Request-Id": "req-header-123" }),
  });
  assert.fail("apiRequest should use X-Request-Id fallback");
} catch (error) {
  assert.ok(error instanceof ApiError);
  assert.equal(error.requestId, "req-header-123");
  assert.match(buildApiErrorDisplayMessage(error), /Código de atendimento: REQ-HEADER-/);
}
try {
  await apiRequest("/api/error-text", { fetchImpl: async () => textApiResponse("Erro de texto seguro", 500, { "X-Request-Id": "req-text-123" }) });
  assert.fail("apiRequest should throw on text error");
} catch (error) {
  assert.ok(error instanceof ApiError);
  assert.equal(error.message, "Erro de texto seguro");
}
try {
  await apiRequest("/api/error-html", { fetchImpl: async () => textApiResponse("<html><body>stack</body></html>", 500, { "Content-Type": "text/html", "X-Request-Id": "req-html-123" }) });
  assert.fail("apiRequest should hide HTML errors");
} catch (error) {
  assert.ok(error instanceof ApiError);
  assert.equal(error.message, "Falha temporária do serviço. Tente novamente.");
  assert.equal(error.requestId, "req-html-123");
}
for (const [status, code] of [[401, "UNAUTHENTICATED"], [403, "FORBIDDEN"], [404, "NOT_FOUND"], [409, "CONFLICT"], [429, "RATE_LIMITED"], [500, "INTERNAL_SERVER_ERROR"]] as const) {
  try {
    await apiRequest(`/api/status-${status}`, { fetchImpl: async () => jsonApiResponse({}, status) });
    assert.fail(`apiRequest should throw on ${status}`);
  } catch (error) {
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, status);
    assert.equal(error.code, code);
  }
}
let authHeaderSeen = "";
await apiRequest("/api/auth-required", {
  auth: true,
  getAuthToken: () => "FIREBASE_SECRET_TOKEN",
  fetchImpl: async (_input, init) => {
    authHeaderSeen = new Headers(init?.headers).get("Authorization") ?? "";
    return jsonApiResponse({ ok: true });
  },
});
assert.equal(authHeaderSeen, "Bearer FIREBASE_SECRET_TOKEN");
let authHeaderWithoutAuth = "present";
await apiRequest("/api/no-auth", {
  fetchImpl: async (_input, init) => {
    authHeaderWithoutAuth = new Headers(init?.headers).get("Authorization") ?? "";
    return jsonApiResponse({ ok: true });
  },
});
assert.equal(authHeaderWithoutAuth, "");
try {
  await apiRequest("/api/token-hidden", {
    auth: true,
    getAuthToken: () => "FIREBASE_SECRET_TOKEN",
    fetchImpl: async () => jsonApiResponse({ message: "Bearer FIREBASE_SECRET_TOKEN stack" }, 500, { "X-Request-Id": "req-secret-123" }),
  });
  assert.fail("apiRequest should sanitize token-like backend messages");
} catch (error) {
  assert.ok(error instanceof ApiError);
  assert.equal(error.message.includes("FIREBASE_SECRET_TOKEN"), false);
}
let writeAttempts = 0;
try {
  await apiRequest("/api/write-no-retry", {
    method: "POST",
    body: { value: true },
    fetchImpl: async (_input, init) => {
      writeAttempts += 1;
      assert.equal(new Headers(init?.headers).get("Content-Type"), "application/json");
      assert.equal(init?.body, JSON.stringify({ value: true }));
      return jsonApiResponse({}, 500);
    },
  });
  assert.fail("apiRequest should throw on write failure");
} catch (error) {
  assert.ok(error instanceof ApiError);
  assert.equal(writeAttempts, 1);
}
try {
  await apiRequest("/api/timeout", {
    timeoutMs: 5,
    fetchImpl: async (_input, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
    }),
  });
  assert.fail("apiRequest should timeout");
} catch (error) {
  assert.ok(error instanceof ApiError);
  assert.equal(error.code, "TIMEOUT");
}
try {
  const controller = new AbortController();
  const pending = apiRequest("/api/manual-abort", {
    signal: controller.signal,
    fetchImpl: async (_input, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
    }),
  });
  controller.abort();
  await pending;
  assert.fail("apiRequest should respect manual abort");
} catch (error) {
  assert.ok(error instanceof ApiError);
  assert.equal(error.code, "REQUEST_ABORTED");
}
try {
  await apiRequest("/api/network-error", { fetchImpl: async () => { throw new TypeError("fetch failed"); } });
  assert.fail("apiRequest should convert network errors");
} catch (error) {
  assert.ok(error instanceof ApiError);
  assert.equal(error.code, "NETWORK_ERROR");
  assert.equal(error.message.includes("fetch failed"), false);
}
assert.match(productPayload, /buildProductSearchFields/);
assert.match(productSearch, /searchTokens/);
assert.match(addProduct, /buildProductCreatePayload/);
assert.match(addProduct, /deleteObject/);
assert.match(productPickerHook, /useProductPickerData/);
assert.match(productPickerHook, /orderBy\("name"\)/);
assert.match(recentProducts, /rememberRecentProductId/);
assert.match(recentProducts, /readRecentProductIds/);
assert.match(addProduct, /rememberRecentProductId\(productId\)/);
assert.match(paginatedProductsHook, /loadRecentProductDocs/);
assert.match(productPickerHook, /loadRecentProductDocs/);
assert.match(productPickerHook, /mergeProducts\(current, recentProducts\)/);
assert.match(addProduct, /buildProductCreatePayload/);
assert.match(addProduct, /cleanupUploadedProductImages/);
assert.match(addProduct, /deleteObject/);
assert.match(addProduct, /isSaving/);
assert.match(addProduct, /getProductSaveErrorMessage/);
assert.match(addProduct, /auth_check|plan_limit_read|storage_upload|firestore_create|storage_cleanup/);
assert.match(addProduct, /Sem conexão|Sua sessão expirou|Limite de produtos atingido|Permissão negada/);
const productDataBlock = addProduct.slice(addProduct.indexOf("const productData = buildProductCreatePayload"), addProduct.indexOf("saveStage = id ?"));
assert.doesNotMatch(productDataBlock, /thumbnailUrl|thumbnailStoragePath/);
assert.doesNotMatch(productDataBlock, /undefined/);
const createPayloadFixture = buildProductCreatePayload({
  formData: {
    name: "  Perfume Teste  ", brand: " natura ", origin: "Brasil", category: "Perfumes", costPrice: 10, salePrice: 30, stock: 2,
    barcode: "001234", description: "  desc  ", imageUrl: "", storagePath: "", extras: { volume: " 100ml ", empty: "" }, isFeatured: false, isOnSale: false,
    discountPercent: Number.NaN, productType: "Cosméticos & Perfumes", gender: "unisex",
  },
  productName: "Perfume Teste", normalizedBrand: "Natura", category: "Perfumes", costPrice: 10, salePrice: 30, stock: 2,
  imageUrl: "https://example.invalid/p.webp", storagePath: "users/test/products/p1/p.webp", activeNicho: "Cosméticos & Perfumes" as any,
});
assert.deepEqual(Object.keys(createPayloadFixture).sort(), ["barcode", "barcodeNormalized", "brand", "brandNormalized", "category", "categoryNormalized", "costPrice", "description", "discountPercent", "extras", "gender", "imageUrl", "isFeatured", "isOnSale", "name", "nameNormalized", "origin", "productType", "productTypeNormalized", "salePrice", "searchSchemaVersion", "searchTokens", "stock", "storagePath"].sort());
assert.equal(createPayloadFixture.name, "Perfume Teste");
assert.equal(createPayloadFixture.brand, "Natura");
assert.equal(createPayloadFixture.imageUrl, "https://example.invalid/p.webp");
assert.equal(createPayloadFixture.storagePath, "users/test/products/p1/p.webp");
assert.equal(createPayloadFixture.discountPercent, 0);
assert.equal(createPayloadFixture.nameNormalized, "perfume teste");
assert.equal(createPayloadFixture.brandNormalized, "natura");
assert.equal(createPayloadFixture.categoryNormalized, "perfumes");
assert.equal(createPayloadFixture.barcodeNormalized, "001234");
assert.equal(createPayloadFixture.searchSchemaVersion, PRODUCT_SEARCH_SCHEMA_VERSION);
assert.equal(JSON.stringify(createPayloadFixture).includes("undefined"), false);
assert.equal(Object.prototype.hasOwnProperty.call(createPayloadFixture, "thumbnailUrl"), false);
assert.equal(Object.prototype.hasOwnProperty.call(createPayloadFixture, "thumbnailStoragePath"), false);
const productAllowedFieldsMatch = firestoreRules.match(/function productAllowedFields\(\) \{\s*return \[([\s\S]*?)\];/);
assert.ok(productAllowedFieldsMatch);
const productAllowedFields = new Set([...productAllowedFieldsMatch[1].matchAll(/'([^']+)'/g)].map((match) => match[1]));
for (const key of ["id", "name", "brand", "origin", "category", "productType", "costPrice", "salePrice", "stock", "barcode", "description", "imageUrl", "storagePath", "gender", "extras", "isFeatured", "isOnSale", "discountPercent", "discount", "promotionalPrice", "createdAt", "updatedAt", "nameNormalized", "brandNormalized", "categoryNormalized", "barcodeNormalized", "productTypeNormalized", "searchTokens", "searchSchemaVersion"]) {
  assert.ok(productAllowedFields.has(key), `product key not allowed by rules: ${key}`);
}
for (const key of ["thumbnailUrl", "thumbnailStoragePath"]) assert.equal(productAllowedFields.has(key), false, `${key} unexpectedly allowed`);
assert.match(addProduct, /Number\.isFinite\(costPrice\)/);
assert.match(addProduct, /Number\.isFinite\(salePrice\)/);
assert.match(addProduct, /Number\.isFinite\(stock\)/);
assert.match(addProduct, /cleanupUploadedProductImages\(uploadedPaths\)/);
assert.match(addProduct, /if \(isSaving\) return/);
assert.match(mockData, /nameNormalized\?: string/);
assert.match(firestoreRules, /searchTokens/);
assert.match(firestoreRules, /searchSchemaVersion/);
assert.match(catalog, /useProductsData/);
assert.match(catalog, /normalizeProductSearchText/);
assert.match(catalog, /getProductSearchIndexField/);
assert.match(productSearch, /getProductSearchIndexField/);
assert.match(catalog, /barcode\.includes\(normalizedSearch\)/);
assert.match(catalog, /category\.includes\(normalizedSearch\)/);
assert.doesNotMatch(catalog, /useCatalogProductsData/);
assert.match(catalogProductsHook, /const CATALOG_PAGE_SIZE = 30/);
assert.match(catalogProductsHook, /buildProductServerSearchPlan/);
assert.match(catalogProductsHook, /requestIdRef/);
assert.match(catalogProductsHook, /barcodeNormalized/);
assert.match(catalogProductsHook, /categoryNormalized/);
assert.match(catalogProductsHook, /orderBy\(querySpec\.orderByField\)/);
assert.doesNotMatch(catalogProductsHook, /orderBy\("name"\)/);
assert.doesNotMatch(catalogProductsHook, /where\("category",\s*"=="/);
assert.match(catalogProductsHook, /name_prefix/);
assert.match(catalogProductsHook, /array-contains/);
assert.match(catalogProductsHook, /searchFallbackRequired/);
assert.match(catalogProductsHook, /getDocs/);
assert.match(productSearchBackfill, /dry-run/);
assert.match(productSearchBackfill, /CATALOG_SERVER_SEARCH_ENABLED=false/);
assert.match(productSearchBackfill, /Não executar em produção/);
assert.match(serverSideSearchDoc, /SERVER_SIDE_PRODUCT_SEARCH_ENABLED=false/);
assert.match(searchDataModelDoc, /PRODUCT_SEARCH_SCHEMA_VERSION = 1/);
assert.match(searchBackfillDoc, /revenda-smart/);
assert.match(searchBackfillScript, /FIRESTORE_EMULATOR_HOST/);
assert.match(searchBackfillScript, /revendasmart-prod/);
assertProductIndex([contains("searchTokens"), asc("nameNormalized")]);
assertProductIndex([asc("barcodeNormalized"), asc("nameNormalized")]);
assertProductIndex([asc("categoryNormalized"), asc("nameNormalized")]);
assertProductIndex([asc("categoryNormalized"), contains("searchTokens"), asc("nameNormalized")]);
assertProductIndex([asc("categoryNormalized"), asc("barcodeNormalized"), asc("nameNormalized")]);
assertNoProductIndex([contains("searchTokens"), asc("name")]);
assertNoProductIndex([asc("barcodeNormalized"), asc("name")]);
assertNoProductIndex([asc("category"), asc("name")]);
assert.match(firestoreIndexes, /searchTokens/);
assert.match(firestoreIndexes, /barcodeNormalized/);
assert.match(firestoreIndexes, /categoryNormalized/);

const storeIntelligenceFixture = buildStoreIntelligence({
  referenceDate: new Date("2026-07-14T12:00:00Z"),
  lowStockThreshold: 3,
  settings: { ...defaultSettings, storeName: "Loja Teste", appTheme: "blue-professional", onboarding_theme_selected: true, onboarding_completed: true, catalogSlug: "loja-teste", enablePublicCatalog: true, pixKey: "chave-pix-teste" },
  products: [
    { id: "p1", name: "Perfume Floral", brand: "Marca A", category: "Perfumes", costPrice: 40, salePrice: 100, stock: 4, imageUrl: "https://example.com/p1.webp", description: "Perfume feminino" },
    { id: "p2", name: "Batom Nude", brand: "Marca B", category: "Maquiagem", costPrice: 10, salePrice: 30, stock: 1 },
  ],
  clients: [{ id: "c1", name: "Cliente VIP", phone: "11999999999" }, { id: "c2", name: "Cliente Inativa", phone: "11888888888" }],
  sales: [
    { id: "s1", clientId: "c1", products: [{ productId: "p1", quantity: 2, price: 100 }], totalPrice: 200, paymentType: "cash", date: "2026-07-14T09:00:00Z" },
    { id: "s2", clientId: "c1", products: [{ productId: "p2", quantity: 1, price: 30 }], totalPrice: 30, paymentType: "cash", date: "2026-07-03T09:00:00Z" },
    { id: "s3", clientId: "c2", products: [{ productId: "p1", quantity: 1, price: 100 }], totalPrice: 100, paymentType: "cash", date: "2026-04-01T09:00:00Z" },
  ],
});
assert.ok(storeIntelligenceFixture.health.score >= 80);
assert.equal(storeIntelligenceFixture.products.topSoldProduct?.product.name, "Perfume Floral");
assert.equal(storeIntelligenceFixture.products.lowStockProducts.length, 1);
assert.equal(storeIntelligenceFixture.customers.vipClient?.client.name, "Cliente VIP");
assert.equal(storeIntelligenceFixture.financial.todayRevenue, 200);
assert.equal(storeIntelligenceFixture.catalog.active, true);
assert.ok(storeIntelligenceFixture.recommendations.some((item) => item.title.includes("Adicione fotos")));
assert.ok(storeIntelligenceFixture.dataLimitations.some((item) => item.includes("Cobrancas")));

assert.equal(formatMarketingPrice(230), "R$ 230,00");
assert.equal(formatMarketingPrice("230.00"), "R$ 230,00");
assert.equal(formatMarketingPrice("1.230,50"), "R$ 1.230,50");
const marketingAdFixture = buildMarketingAdConfig({
  productId: "p1",
  productName: "Perfume Floral com Nome Bem Grande Para Validar Corte Seguro",
  productBrand: "Marca A",
  productVolume: "Volume: 100ml",
  productStock: 3,
  price: "230.00",
  headline: "OFERTA IMPERDÍVEL!",
  note: "Só hoje",
  ctaText: "Peça pelo WhatsApp",
  storeName: "Loja Teste",
  primaryColor: "#ec4899",
  templateId: "promo",
  themeId: "roseGlow",
  showBrand: true,
  showVolume: true,
  showStockStatus: true,
  showWhatsAppCta: true,
});
assert.equal(marketingAdFixture.priceText, "R$ 230,00");
assert.equal(marketingAdFixture.ctaText, "Chamar no WhatsApp");
assert.equal(normalizeMarketingCtaText("Pedir no WhatsApp"), "Chamar no WhatsApp");
const normalizedLegacyMarketingText = normalizeMarketingGeneratedText("Produto selecionado para você pedir direto pelo WhatsApp.\nImagem omitida; arte gerada sem ela.\n💬 Peça pelo WhatsApp\n🛒 Catálogo: https://revendasmart.vercel.app/u/loja");
assert.doesNotMatch(normalizedLegacyMarketingText, /Produto selecionado|Imagem omitida|Peça pelo WhatsApp/);
assert.match(normalizedLegacyMarketingText, /Chamar no WhatsApp/);
assert.equal(marketingAdFixture.stockStatus, "Pronta entrega");
assert.match(buildMarketingAdMessage(marketingAdFixture), /Por apenas R\$ 230,00/);
assert.match(buildMarketingAdMessage(marketingAdFixture), /Marca: Marca A/);
assert.match(buildMarketingAdMessage(marketingAdFixture), /Volume: 100ml/);
assert.equal(normalizeMarketingAdConfig({ ...marketingAdFixture, template: "legacy-missing", themeId: "missing" }).templateId, "promo");
assert.equal(normalizeMarketingAdConfig({ ...marketingAdFixture, themeId: "missing" }).themeId, "brand");
const sanitizedMarketing = sanitizeMarketingHistoryPayload({ productId: "p1", imageUrl: "data:image/png;base64,AAA", storeLogoUrl: "data:image/png;base64,BBB", photoUrl: "https://cdn.example/photo.webp", generatedText: "ok" });
assert.equal(sanitizedMarketing.imageUrl, undefined);
assert.equal(sanitizedMarketing.storeLogoUrl, undefined);
assert.equal(sanitizedMarketing.photoUrl, "https://cdn.example/photo.webp");
assert.ok(MARKETING_AD_THEME_IDS.includes("black"));
assert.match(marketingAd, /MARKETING_AD_THEMES/);
assert.match(marketing, /MarketingAdCanvas/);
assert.match(marketing, /handleSaveEditedEntry/);
assert.match(marketing, /handleDuplicateEntry/);
assert.match(marketing, /formatMarketingPrice/);
assert.doesNotMatch(marketing, /salePrice\.toFixed\(2\)/);
assert.match(marketingCard, /buildMarketingAdVisualModel/);
assert.match(marketingCard, /fetch\(src, \{ mode: "cors", credentials: "omit" \}\)/);
assert.match(marketingCard, /URL\.createObjectURL/);
assert.match(marketingCard, /URL\.revokeObjectURL/);
assert.match(marketingCard, /crossOrigin = "anonymous"/);
assert.match(marketingCard, /MarketingCardImageError/);
assert.match(marketingCard, /MARKETING_CARD_IMAGE_ERROR_MESSAGE/);
assert.doesNotMatch(marketingCard, /onImageFallback/);
assert.match(marketingCard, /try \{ canvas\.toBlob/);
assert.match(marketingCard, /config\.priceText/);
assert.match(marketingCard, /ctaText/);
assert.match(marketingCard, /fitFontForLines\(ctx, config\.productName/);
assert.doesNotMatch(marketing, /Imagem omitida; arte gerada sem ela/);
assert.doesNotMatch(marketing, /imageFallbackNotice/);
assert.doesNotMatch(marketingAd, /Produto selecionado/);
assert.match(marketing, /normalizeMarketingGeneratedText\(entry\.generatedText\)/);
assert.doesNotMatch(marketing, /navigator\.clipboard\.writeText\(entry\.generatedText\)/);
assert.doesNotMatch(marketing, /downloadEntryCard\(entry\)/);
assert.match(marketing, /repeatPayload\(entry, "downloaded"\)/);
assert.match(marketing, /createMarketingCard\(payload\)/);
assert.match(marketing, /shareMarketingCard/);
assert.match(marketing, /handleCardCtaClick/);
assert.match(marketing, /buildPublicCatalogUrl\(catalogSlug\)/);
assert.doesNotMatch(marketing, /window\.open\(previewWhatsappUrl[\s\S]{0,120}button-share-whatsapp-ad/);
assert.match(marketingShare, /@capacitor\/share/);
assert.match(marketingShare, /@capacitor\/filesystem/);
assert.match(marketingShare, /Capacitor\.isNativePlatform\(\)/);
assert.match(marketingShare, /Directory\.Cache/);
assert.match(marketingShare, /MarketingShareCancelledError/);
assert.match(marketing, /Compartilhamento cancelado/);
assert.match(marketingShare, /Filesystem\.writeFile/);
assert.match(marketingShare, /Share\.share/);
assert.match(marketingShare, /files:\s*\[savedFile\.uri\]/);
assert.match(marketingShare, /navigator/);
assert.match(marketingShare, /canShare\(\{ files: \[file\] \}\)/);
assert.match(marketingShare, /onWebDownloadFallback/);
assert.doesNotMatch(marketingShare, /wa\.me/);
assert.equal(sanitizeMarketingFileName("Perfume 100ml Áurea"), "anuncio-perfume-100ml-aurea.png");
assert.equal(buildPublicCatalogUrl("adriana-perfumes", "https://revendasmart.vercel.app"), "https://revendasmart.vercel.app/u/adriana-perfumes");
assert.equal(resolvePublicAppBaseUrl("https://revendasmart.vercel.app/", "https://localhost"), "https://revendasmart.vercel.app");
assert.equal(normalizePublicAppBaseUrl("https://revendasmart.vercel.app/app/ignored"), "https://revendasmart.vercel.app");
assert.match(publicUrl, /VITE_PUBLIC_APP_URL/);
assert.match(publicUrl, /OFFICIAL_PUBLIC_APP_URL = "https:\/\/revendasmart\.vercel\.app"/);
assert.match(marketingCanvas, /data-testid="marketing-ad-canvas"/);
assert.match(marketingCanvas, /Criado com Revenda Smart/);
assert.match(marketingCanvas, /logo-revenda-smart-symbol\.png/);
assert.doesNotMatch(marketingCanvas, /<p className="ma10">Revenda Smart<\/p>/);
assert.match(marketingCanvas, /config.priceText/);
assert.match(marketingHistoryHook, /sanitizeMarketingHistoryPayload/);
assert.match(marketingHistoryHook, /updateEntry/);
assert.match(marketingHistoryPanel, /Editar anúncio/);
assert.match(marketingHistoryPanel, /Trocar tema/);
assert.match(marketingHistoryPanel, /Duplicar/);
assert.doesNotMatch(marketingHistoryHook, /base64/);
assert.match(settings, /path: "\/settings\?tab=store"/);
assert.match(settings, /activeTab === 'store'/);
assert.match(settings, /Tema atual:/);
assert.match(settings, /Trocar tema/);
assert.match(settings, /rs-store-theme-grid/);
assert.match(settings, /rs-store-theme-option/);
assert.match(settings, /Personalização visual da loja/);
assert.match(settings, /Nicho principal:/);
assert.match(settings, /Alterar nicho/);
assert.match(settings, /store-nicho-select/);
assert.match(settings, /htmlFor="store-nicho-select"/);
assert.match(settings, /updateStoreTheme/);
assert.match(settings, /updatePrimaryNicho/);
assert.match(settings, /setFormSettings/);
assert.match(settings, /patchUserSettingsOptimistic/);
assert.match(settings, /storeName: normalizedSettings\.storeName/);
assert.match(settings, /app-build-id/);
assert.match(settings, /formatAppBuildId\(APP_BUILD_ID\)/);
assert.match(buildInfo, /APP_BUILD_ID/);
assert.match(buildInfo, /VITE_APP_BUILD_ID/);
assert.match(buildScript, /VITE_APP_BUILD_ID/);
assert.match(buildScript, /git rev-parse --short=12 HEAD/);
assert.doesNotMatch(internalTelemetry, /firebase\/database/);
assert.match(internalTelemetry, /permission_denied on Android\/PWA/);
assert.match(internalTelemetry, /initializeInternalTelemetry\(_app: FirebaseApp\)/);
assert.match(internalTelemetry, /if \(!isInitialized\) return/);
const marketingCss = read("client/src/styles/marketing.css");
assert.match(marketingCss, /@media \(max-width:430px\)/);
assert.match(marketingCss, /\.mk65\{overflow-x:hidden\}/);
assert.match(marketingCss, /\.mk58\{grid-template-columns:1fr\}/);
assert.match(marketingCss, /overflow-wrap:anywhere/);
assert.match(marketingCss, /word-break:break-word/);
assert.match(marketingCss, /\.mk52\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)\}/);
assert.doesNotMatch(marketingCss, /min-width:\s*4\d\dpx|(?:^|[;{])width:\s*4\d\dpx/);
assert.match(storeHealth, /buildStoreIntelligence/);
assert.match(storeHealth, /evitando novas leituras Firestore/);
assert.doesNotMatch(dashboard, /StoreIntelligencePanel/);
assert.match(storeIntelligencePanel, /buildStoreIntelligence/);
assert.match(storeIntelligencePanel, /Saude da loja/);
assert.match(storeIntelligencePanel, /BI automatico/);
assert.match(storeIntelligencePanel, /Sem IA - regras deterministicas/);
assert.match(storeIntelligencePanel, /Cobrancas nao entram neste score/);

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
assert.doesNotMatch(clientDetail, /useProductsData/);
assert.match(clientDetailHook, /doc\(db, "users", user\.uid, "clients", clientId\)/);
assert.match(clientDetailHook, /where\("clientId", "==", clientId\)/);
assert.match(clientDetailHook, /documentId/);
assert.match(clientDetailHook, /fetchProductsByIds/);
assert.match(clientDetailHook, /PRODUCT_LOOKUP_BATCH_SIZE = 10/);
assert.match(clientDetailHook, /unsubscribeSales/);
assert.match(clientMetrics, /favoriteProducts/);
assert.match(clientMetrics, /groupClientTimelineByMonth/);
assert.match(clientMetrics, /calculateClientBehaviorSummary/);
assert.match(dashboardMetrics, /calculateDashboardPremiumIndicators/);
assert.doesNotMatch(dashboard, /Centro de comando/);
assert.doesNotMatch(dashboard, /commandCenter/);
assert.doesNotMatch(dashboard, /commandKpis/);
assert.doesNotMatch(dashboard, /executiveWidgets/);
assert.doesNotMatch(dashboard, /smartAlerts/);
assert.match(dashboard, /buildHomeDashboardViewModel/);
assert.match(dashboard, /Resumo do período/);
assert.match(dashboard, /O que precisa da sua atenção/);
assert.doesNotMatch(dashboard, /<SectionCard title="Desempenho"/);
assert.doesNotMatch(dashboard, /home-performance-chart|home-performance-detail|PerformanceChart|selectedPerformancePoint|selectedPerformanceDay/);
assert.doesNotMatch(dashboard, /aria-pressed=\{isSelected\}/);
assert.doesNotMatch(homeDashboardViewModel, /performance:|HomePerformancePoint|buildPerformancePoints|PERFORMANCE_DAYS/);
assert.doesNotMatch(dashboard, /Produtos e estoque/);
assert.doesNotMatch(dashboard, /Saúde da loja/);

assert.match(dashboardMetrics, /calculateExecutiveSummary/);
assert.match(dashboardMetrics, /calculateMonthlyGoal/);
assert.match(dashboardMetrics, /calculateStockExecutiveMetrics/);
assert.match(dashboardMetrics, /calculateWorstProduct/);
assert.match(dashboardMetrics, /statusLabel/);
assert.doesNotMatch(dashboardMetrics, /999/);
assert.match(dashboardMetrics, /calculateAttentionItems/);
assert.doesNotMatch(dashboard, /Alertas inteligentes/);
assert.match(dashboard, /Meta mensal/);
assert.match(dashboard, /monthlyGoalInput/);
assert.match(dashboard, /handleSaveMonthlyGoal/);
assert.doesNotMatch(dashboard, /Ticket médio/);
assert.doesNotMatch(dashboard, /Produto campeão/);
assert.doesNotMatch(dashboard, /Produto parado/);
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
assert.match(marketing, /Central de divulgação/);
assert.match(marketing, /MARKETING_TEMPLATES/);
assert.match(marketingAd, /Produto em destaque/);
assert.match(marketingAd, /Encomendas abertas/);
assert.match(marketing, /QRCodeSVG/);
assert.match(marketing, /copyTextWithFallback/);
assert.match(marketing, /catalogCopyResetTimeoutRef/);
assert.match(marketing, /window\.clearTimeout/);
assert.match(marketing, /noopener,noreferrer/);
assert.doesNotMatch(marketing, /useProductsData/);
assert.match(publicCatalog, /activeFilterCount/);
assert.match(publicCatalog, /Limpar \{activeFilterCount\}/);
assert.match(publicCatalog, /Loja segura/);
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
assert.match(nichoConfig, /Celulares/);
assert.match(nichoConfig, /Cadernos/);
assert.match(nichoConfig, /Casa e Decoração/);
assert.match(nichoConfig, /Bombons/);
assert.match(nichoConfig, /Congelados/);
assert.match(nichoConfig, /Produção própria/);
assert.match(nichoConfig, /Garrafa térmica inox/);
assert.match(nichoConfig, /return \['Geral'\]/);
assert.ok(ONBOARDING_NICHO_IDS.includes("Eletrônicos" as any));
assert.ok(ONBOARDING_NICHO_IDS.includes("Doces" as any));
assert.ok(ONBOARDING_NICHO_IDS.includes("Alimentos" as any));
assert.ok(!ONBOARDING_NICHO_IDS.includes("Alimentos/Doces" as any));
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
  "Eletrônicos": ["Perfumes", "Bolos", "Cadernos", "Vestidos"],
  "Papelaria": ["Perfumes", "Celulares", "Marmitas", "Vestidos"],
  "Casa e Decoração": ["Perfumes", "Celulares", "Cadernos", "Marmitas"],
  "Utilidades": ["Perfumes", "Celulares", "Cadernos", "Bolos"],
  "Doces": ["Eletrônicos", "Papelaria", "Casa", "Decoração", "Massas", "Congelados", "Perfumes"],
  "Alimentos": ["Eletrônicos", "Papelaria", "Casa", "Decoração", "Trufas", "Brigadeiros", "Perfumes"],
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
assert.ok(getProductCategoriesForNicho({}, "Eletrônicos").includes("Celulares"));
assert.ok(getProductCategoriesForNicho({}, "Doces").includes("Trufas"));
assert.ok(getProductCategoriesForNicho({}, "Alimentos").includes("Congelados"));
const customFashionCategories = getProductCategoriesForNicho(
  { customCategoriesByNicho: { Roupas: ["Jeans Premium", "Vestidos", "Jeans Premium"] } },
  "Roupas",
);
assert.equal(customFashionCategories[0], "Jeans Premium");
assert.equal(customFashionCategories.filter((category) => category === "Jeans Premium").length, 1);
assert.ok(!customFashionCategories.includes("Eletrônicos"));
assert.equal(getNichoConfig("nicho-invalido").id, "Geral");
assert.equal(resolveAppThemeId("tema-invalido"), DEFAULT_APP_THEME_ID);
assert.ok(APP_THEMES.length >= 10);
for (const themeId of ["red", "oled", "turquoise", "gold"]) {
  assert.ok(APP_THEME_IDS.includes(themeId as any), `missing design-system theme ${themeId}`);
}
for (const tokenName of ["primary", "surface", "success", "warning", "info", "duration"]) {
  assert.ok(DESIGN_TOKEN_NAMES.includes(tokenName as any), `missing design token ${tokenName}`);
}
const designVariables = buildDesignSystemVariables("turquoise");
for (const cssVar of ["--rs-color-primary", "--rs-surface", "--rs-focus-ring", "--rs-chart-1"]) {
  assert.ok(designVariables[cssVar], `missing design system variable ${cssVar}`);
}
assert.match(mockData, /storeIdentity\?:/);
assert.match(mockData, /slogan\?: string/);
assert.match(chargesHook, /const CHARGES_PAGE_SIZE = 30/);
assert.match(chargesHook, /orderBy\("createdAt", "desc"\), limit\(CHARGES_PAGE_SIZE\)/);
assert.match(chargesHook, /startAfter\(lastChargeDocRef\.current\)/);
assert.match(chargesHook, /loadMoreCharges/);
assert.match(billingsPage, /const INSTALLMENTS_PAGE_SIZE = 30/);
assert.match(billingsPage, /createInstallmentsQuery/);
assert.match(billingsPage, /where\("status", "in", \["pending", "partial", "overdue"\]\)/);
assert.match(billingsPage, /limit\(INSTALLMENTS_PAGE_SIZE\)/);
assert.match(billingsPage, /loadMoreInstallments/);
assert.match(billingsPage, /collectClientIdsForLookup/);
assert.match(billingsPage, /fetchClientsByIds/);
assert.match(billingsPage, /documentId\(\)/);
assert.match(billingsPage, /showPaymentModal/);
assert.match(billingsPage, /modalClients\.length > 0 \? modalClients : clientLookup/);
assert.match(sharedCharges, /clientName\?: string/);
assert.match(sharedCharges, /clientPhone\?: string/);
assert.match(mockData, /clientName\?: string/);
assert.match(mockData, /clientPhone\?: string/);
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
assert.match(payments, /resolveChargeClientSnapshot/);
assert.match(payments, /collection\("clients"\)\.doc\(clientId\)/);
assert.match(payments, /charge\.clientName/);
assert.match(payments, /charge\.clientPhone/);
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
assert.equal(validateMercadoPagoAccessTokenForEnvironment("APP_USR-production", "sandbox").ok, false);
assert.equal(validateMercadoPagoAccessTokenForEnvironment("TEST-sandbox", "sandbox").ok, true);
assert.equal(validateMercadoPagoAccessTokenForEnvironment("TEST-sandbox", "production").ok, false);
assert.match(mercadoPagoEnvironment, /PRODUCTION_TOKEN_IN_SANDBOX/);
assert.match(mercadoPagoEnvironment, /SANDBOX_TOKEN_IN_PRODUCTION/);
assert.match(mercadoPagoEnvironment, /UNKNOWN_SANDBOX_TOKEN/);
assert.match(subscriptions, /MERCADO_PAGO_ENV/);
assert.match(subscriptions, /validateMercadoPagoAccessTokenForEnvironment/);
assert.match(subscriptions, /sendSubscriptionCredentialError\(res, "create", uid\)/);
assert.match(subscriptions, /sendSubscriptionCredentialError\(res, "cancel", uid\)/);
assert.match(subscriptions, /sendSubscriptionCredentialError\(res, "sync-now", uid\)/);
assert.match(subscriptions, /sendSubscriptionCredentialError\(res, "webhook", null\)/);
assert.match(subscriptions, /app\.post\("\/api\/app-subscription\/sync-now", requireAuth/);
assert.match(subscriptions, /SUBSCRIPTION_OWNERSHIP_MISMATCH/);
assert.match(subscriptions, /external_reference:\s*uid/);
assert.match(subscriptions, /transaction_amount:\s*PREMIUM_PRICE_BRL/);
assert.doesNotMatch(subscriptions, /req\.body\.(price|plan|premiumActive|currentPlan|transaction_amount)/);
assert.match(subscriptions, /lastSubscriptionEventId/);
assert.match(subscriptions, /lastSubscriptionEventAt/);
assert.match(subscriptions, /duplicate_event/);
assert.match(subscriptions, /stale_event/);
assert.match(subscriptions, /buildSubscriptionEventId/);
assert.match(subscriptions, /extractMercadoPagoSubscriptionEventDate/);
assert.match(subscriptions, /idempotent:\s*true/);
assert.match(mercadoPagoSandboxTests, /RUN_MERCADO_PAGO_SANDBOX_LIVE/);
assert.match(mercadoPagoSandboxTests, /TEST-\*/);
assert.match(mercadoPagoSandboxTests, /APP_USR-production/);
assert.match(mercadoPagoSandboxTests, /SANDBOX_TOKEN_IN_PRODUCTION/);
assert.match(mercadoPagoSandboxTests, /PRODUCTION_TOKEN_IN_SANDBOX/);
assert.match(mercadoPagoSandboxDocs, /Não usar token `APP_USR-\*`/);
assert.match(mercadoPagoSandboxDocs, /Não usar token `TEST-\*` com ambiente de produção/);
assert.match(mercadoPagoSandboxDocs, /produção não foi acessada/);
assert.equal(packageJson.scripts["test:mercado-pago:sandbox"], "tsx script/mercado-pago-sandbox-tests.ts");

const generatedRequestId = createRequestId();
assert.match(generatedRequestId, /^[a-f0-9]{16}$/);
assert.equal(classifySafeError(400, undefined).code, "VALIDATION_ERROR");
assert.equal(classifySafeError(401, undefined).code, "UNAUTHENTICATED");
assert.equal(classifySafeError(403, undefined).code, "FORBIDDEN");
assert.equal(classifySafeError(404, undefined).code, "NOT_FOUND");
assert.equal(classifySafeError(409, undefined).code, "CONFLICT");
assert.equal(classifySafeError(429, undefined).code, "RATE_LIMITED");
assert.equal(classifySafeError(503, undefined).code, "EXTERNAL_SERVICE_ERROR");
const safeErrorFixture = buildSafeErrorBody(500, new Error("Database stack SECRET token line"), "req-test-123");
assert.equal(safeErrorFixture.error.code, "INTERNAL_SERVER_ERROR");
assert.equal(safeErrorFixture.error.requestId, "req-test-123");
assert.equal(JSON.stringify(safeErrorFixture).includes("stack"), false);
assert.equal(JSON.stringify(safeErrorFixture).includes("SECRET"), false);
const healthFixture = buildHealthPayload("req-health-123");
assert.equal(healthFixture.status, "ok");
assert.equal(healthFixture.requestId, "req-health-123");
assert.match(healthFixture.timestamp, /^\d{4}-\d{2}-\d{2}T/);
const readinessOkFixture = buildReadinessPayload("req-ready-123", { firebaseAdmin: "ok" });
assert.equal(readinessOkFixture.statusCode, 200);
assert.equal(readinessOkFixture.body.status, "ready");
assert.equal(readinessOkFixture.body.requestId, "req-ready-123");
assert.deepEqual(readinessOkFixture.body.checks, { firebaseAdmin: "ok" });
const readinessFailedFixture = buildReadinessPayload("req-ready-456", { firebaseAdmin: "failed" });
assert.equal(readinessFailedFixture.statusCode, 503);
assert.equal(readinessFailedFixture.body.status, "degraded");
assert.equal(readinessFailedFixture.body.requestId, "req-ready-456");
function runRequestIdMiddlewareForTest(headerValue?: unknown) {
  const headers: Record<string, unknown> = {};
  if (headerValue !== undefined) headers["x-request-id"] = headerValue;
  const req = { headers } as any;
  const responseHeaders: Record<string, string> = {};
  const res = { setHeader(name: string, value: string) { responseHeaders[name] = value; } } as any;
  let nextCalled = false;
  requestIdMiddleware(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
  assert.equal(responseHeaders["X-Request-Id"], req.requestId);
  return req.requestId as string;
}
assert.match(runRequestIdMiddlewareForTest(), /^[a-f0-9]{16}$/);
assert.equal(runRequestIdMiddlewareForTest("valid-REQ_123"), "valid-REQ_123");
assert.match(runRequestIdMiddlewareForTest("bad header with spaces"), /^[a-f0-9]{16}$/);
const sanitizedLogFixture = JSON.stringify(sanitizeForLog({
  headers: { authorization: "Bearer TEST-12345678901234567890", cookie: "session=abc" },
  body: { password: "123456", email: "cliente@example.com", phone: "1199999-8888" },
  query: { access_token: "APP_USR-12345678901234567890" },
}));
assert.equal(sanitizedLogFixture.includes("Bearer TEST-"), false);
assert.equal(sanitizedLogFixture.includes("session=abc"), false);
assert.equal(sanitizedLogFixture.includes("123456"), false);
assert.equal(sanitizedLogFixture.includes("cliente@example.com"), false);
assert.equal(sanitizedLogFixture.includes("APP_USR-"), false);
assert.equal(normalizeRequestId("abc-123_DEF:456"), "abc-123_DEF:456");
assert.equal(normalizeRequestId("short"), null);
assert.equal(normalizeRequestId("bad header with spaces"), null);
assert.equal(normalizeRequestId("x".repeat(81)), null);
assert.match(serverIndex, /app\.use\(requestIdMiddleware\)/);
assert.match(loggerSource, /res\.setHeader\("X-Request-Id", requestId\)/);
assert.match(loggerSource, /token\|secret\|password\|senha\|authorization\|cookie/);
assert.match(loggerSource, /payload\|client_secret\|access\[_-\]\?token\|refresh\[_-\]\?token/);
const httpRequestLoggerBlock = serverIndex.slice(serverIndex.indexOf('logInfo("http.request"'), serverIndex.indexOf('// Healthcheck endpoint'));
assert.match(httpRequestLoggerBlock, /eventType:\s*"http_request"/);
assert.match(httpRequestLoggerBlock, /result:\s*res\.statusCode >= 400 \? "error" : "success"/);
assert.match(httpRequestLoggerBlock, /errorCode:\s*safeErrorCode/);
assert.match(httpRequestLoggerBlock, /route:\s*getObservedRoute\(req\)/);
assert.doesNotMatch(httpRequestLoggerBlock, /authorization|cookie|headers|body|rawBody|query|originalUrl/);
assert.match(serverIndex, /app\.get\(\["\/health", "\/api\/health"\]/);
assert.match(serverIndex, /app\.get\("\/api\/readiness"/);
const readinessBlock = serverIndex.slice(serverIndex.indexOf('app.get("/api/readiness"'), serverIndex.indexOf('(async () =>'));
assert.match(readinessBlock, /getFirebaseAdmin\(\)/);
assert.match(readinessBlock, /withTimeout/);
assert.match(readinessBlock, /buildReadinessPayload\(req\.requestId, checks\)/);
assert.match(readinessBlock, /res\.status\(readiness\.statusCode\)/);
assert.match(readinessBlock, /EXTERNAL_SERVICE_ERROR/);
assert.doesNotMatch(readinessBlock, /MercadoPago|mercadopago|MERCADOPAGO|process\.env/);
const errorHandlerBlock = serverIndex.slice(serverIndex.indexOf('app.use((err: any'));
assert.match(errorHandlerBlock, /classifySafeError\(status, err\)/);
assert.match(errorHandlerBlock, /res\.locals\.safeErrorCode = safeError\.code/);
assert.match(errorHandlerBlock, /buildSafeErrorBody\(status, err, req\.requestId\)/);
assert.doesNotMatch(errorHandlerBlock, /stack/);
assert.match(observabilityDocs, /X-Request-Id/);
assert.match(observabilityDocs, /Authorization/);
assert.match(observabilityDocs, /\/api\/health/);
assert.match(observabilityDocs, /\/api\/readiness/);
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
assert.match(onboarding, /onboarding_store_configured/);
assert.match(onboarding, /storeName: cleanStoreName/);
assert.match(onboarding, /storeLogo: cleanStoreLogo/);
assert.match(onboarding, /stepOverride/);
assert.match(onboarding, /customCategoriesByNicho/);
assert.match(onboarding, /renderStoreStep/);
assert.match(onboarding, /input-onboarding-store-name/);
assert.match(onboarding, /renderCategoriesStep/);
assert.match(onboarding, /dashboardTour/);
assert.match(onboarding, /productsTour/);
assert.match(onboarding, /clientsTour/);
assert.match(onboarding, /salesTour/);
assert.match(onboarding, /catalogTour/);
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
assert.doesNotMatch(dashboard, /OnboardingChecklist/);
assert.match(dashboard, /home-onboarding-strip/);
assert.match(dashboard, /Finalize a configura..o da loja/);
assert.match(dashboard, /products\.length === 0/);
assert.match(onboardingChecklist, /local|Primeiros passos|Configure sua loja/);
assert.match(planProvider, /api\/plan\/data/);
assert.match(planProvider, /onAuthStateChanged/);
assert.match(planProvider, /limits/);
assert.match(clientsPage, /usePlan\(\)/);
assert.match(settings, /providers\/UserSettingsProvider/);
assert.match(dashboard, /providers\/UserSettingsProvider/);
assert.match(productsPage, /providers\/UserSettingsProvider/);
assert.match(addProduct, /providers\/UserSettingsProvider/);
assert.match(marketing, /providers\/UserSettingsProvider/);
assert.match(billingsPage, /providers\/UserSettingsProvider/);
assert.match(catalog, /providers\/UserSettingsProvider/);
assert.match(catalog, /normalizedSearch/);
assert.match(catalog, /productById/);
assert.match(catalog, /copyResetTimeoutRef/);
assert.doesNotMatch(addProduct, /hooks\/useUserSettings/);
assert.doesNotMatch(marketing, /hooks\/useUserSettings/);
assert.doesNotMatch(billingsPage, /hooks\/useUserSettings/);
assert.doesNotMatch(catalog, /hooks\/useUserSettings/);
assert.match(publicCatalog, /availableProducts/);
assert.match(publicCatalog, /copyResetTimeoutRef/);
assert.match(settings, /normalizeSettingsTab/);
assert.match(publicCatalog, /onError=\{\(\) => setLogoFailed\(true\)\}/);
assert.match(partialPaymentModal, /safe-area-inset-bottom/);
assert.match(indexHtml, /content="width=device-width, initial-scale=1, viewport-fit=cover"/);
assert.doesNotMatch(indexHtml, /user-scalable=no|maximum-scale/);
assert.match(indexHtml, /apple-mobile-web-app-capable/);
assert.match(indexHtml, /<link rel="manifest" href="\/manifest\.json"/);
assert.equal(manifest.name, "Revenda Smart");
assert.equal(manifest.short_name, "Revenda Smart");
assert.equal(manifest.display, "standalone");
assert.equal(manifest.id, "/");
assert.equal(manifest.orientation, "portrait-primary");
assert.ok(manifest.display_override.includes("standalone"));
assert.ok(manifest.categories.includes("business"));
assert.equal(manifest.theme_color, "#4c16ad");
assert.equal(manifest.background_color, "#fbf9ff");
assert.ok(manifest.icons.every((icon: any) => String(icon.src) === "/logo-revenda-smart-symbol-official.png"));
assert.ok(manifest.icons.some((icon: any) => String(icon.src) === "/logo-revenda-smart-symbol-official.png" && String(icon.purpose || "").includes("maskable")));
assert.match(indexHtml, /href="\/logo-revenda-smart-symbol-official\.png"/);
assert.match(indexHtml, /theme-color" content="#4c16ad"/);
assert.match(indexHtml, /og:image" content="https:\/\/revendasmart\.vercel\.app\/logo-revenda-smart-official\.png"/);
assert.match(indexHtml, /twitter:image" content="https:\/\/revendasmart\.vercel\.app\/logo-revenda-smart-official\.png"/);
assert.ok(manifest.shortcuts.every((shortcut: any) => shortcut.icons?.every((icon: any) => String(icon.src) === "/logo-revenda-smart-symbol-official.png")));
assert.ok(manifest.shortcuts.some((shortcut: any) => shortcut.url === "/products"));
assert.ok(manifest.shortcuts.some((shortcut: any) => shortcut.url === "/clients"));
assert.ok(manifest.shortcuts.some((shortcut: any) => shortcut.url === "/sell"));
assert.ok(manifest.shortcuts.some((shortcut: any) => shortcut.url === "/catalog"));
assert.match(serviceWorker, /revenda-smart-static-v7/);
assert.match(serviceWorker, /logo-revenda-smart-symbol-official\.png/);
assert.match(serviceWorker, /login-hero-approved\.png/);
assert.match(layout, /rs-app-frame/);
assert.doesNotMatch(layout, /max-w-\[1200px\] mx-auto/);
const globalCss = read("client/src/index.css");
assert.doesNotMatch(globalCss, /overflow-x:\s*hidden/);
assert.doesNotMatch(globalCss, /overflow-x:\s*clip/);
assert.match(globalCss, /@media \(display-mode: standalone\)/);
assert.match(globalCss, /rs-bottom-nav-edge/);
assert.doesNotMatch(serviceWorker, /login-reference-official\.png/);
assert.doesNotMatch(serviceWorker, /icons\/icon-192x192\.png/);
assert.doesNotMatch(serviceWorker, /favicon\.png/);
assert.match(main, /function registerPwaServiceWorker/);
assert.match(main, /navigator\.serviceWorker/);
assert.match(main, /register\("\/sw\.js"\)/);
assert.match(main, /import\.meta\.env\.PROD/);
assert.match(main, /window\.addEventListener\("load", register, \{ once: true \}\)/);
assert.match(serviceWorker, /revenda-smart-static-v7/);
assert.match(serviceWorker, /PRECACHE_ASSETS/);
assert.match(serviceWorker, /STATIC_CACHEABLE_DESTINATIONS/);
assert.match(serviceWorker, /request\.mode === 'navigate'/);
assert.match(serviceWorker, /cache\.put\(request, response\.clone\(\)\)/);
assert.doesNotMatch(serviceWorker, /\/api\//);
assert.ok(vercel.rewrites.some((rule: any) => rule.source === "/u/:storeSlug" && rule.destination === "/index.html"));
assert.ok(vercel.rewrites.some((rule: any) => rule.source === "/:path*" && rule.destination === "/index.html"));
const apiRewriteIndex = vercel.rewrites.findIndex((rule: any) => rule.source === "/api/:path*");
const spaFallbackIndex = vercel.rewrites.findIndex((rule: any) => rule.source === "/:path*" && rule.destination === "/index.html");
assert.ok(apiRewriteIndex >= 0, "Vercel must route /api/:path* before the SPA fallback");
assert.ok(spaFallbackIndex >= 0, "Vercel must keep the SPA fallback for frontend routes");
assert.ok(apiRewriteIndex < spaFallbackIndex, "Vercel API rewrite must be evaluated before SPA fallback");
assert.equal(vercel.rewrites[apiRewriteIndex].destination, "https://revendasmart-backend-cc2743rkmq-uc.a.run.app/api/:path*");
assert.doesNotMatch(JSON.stringify(vercel.rewrites), /api\/api/);
assert.equal(existsSync("api/index.ts"), false);
assert.equal(existsSync("api/[...path].ts"), false);


// Android Capacitor foundation guardrails.
assert.match(capacitorConfig, /appId:\s*"com\.revendasmart\.app"/);
assert.match(capacitorConfig, /appName:\s*"Revenda Smart"/);
assert.match(capacitorConfig, /webDir:\s*"dist\/public"/);
assert.equal(packageJson.dependencies?.["@capacitor/core"]?.replace(/[\^~]/g, ""), "8.4.2");
assert.equal(packageJson.dependencies?.["@capacitor/android"]?.replace(/[\^~]/g, ""), "8.4.2");
assert.equal(packageJson.dependencies?.["@capacitor/share"]?.replace(/[\^~]/g, ""), "8.0.1");
assert.equal(packageJson.dependencies?.["@capacitor/filesystem"]?.replace(/[\^~]/g, ""), "8.1.2");
assert.equal(packageJson.devDependencies?.["@capacitor/cli"]?.replace(/[\^~]/g, ""), "8.4.2");
assert.equal(packageJson.scripts?.["android:copy"], "node scripts/android/sync-web.mjs copy");
assert.equal(packageJson.scripts?.["android:sync"], "node scripts/android/sync-web.mjs sync");
assert.equal(packageJson.scripts?.["android:open"], "cap open android");
assert.equal(packageJson.scripts?.["android:doctor"], "cap doctor android");
assert.match(androidBuildGradle, /namespace\s*=\s*"com\.revendasmart\.app"/);
assert.match(androidBuildGradle, /applicationId\s+"com\.revendasmart\.app"/);
assert.match(androidBuildGradle, /androidx\.core:core:/);
assert.match(androidManifest, /android\.permission\.INTERNET/);
assert.match(androidManifest, /android:theme="@style\/AppTheme\.NoActionBarLaunch"/);
assert.match(androidManifest, /android:exported="true"/);
assert.match(androidManifest, /android:icon="@mipmap\/ic_launcher"/);
assert.match(androidManifest, /android:roundIcon="@mipmap\/ic_launcher_round"/);
assert.match(androidStrings, /<string name="app_name">Revenda Smart<\/string>/);
assert.match(androidStrings, /<string name="title_activity_main">Revenda Smart<\/string>/);
assert.match(androidStrings, /<string name="package_name">com\.revendasmart\.app<\/string>/);
assert.match(androidStrings, /<string name="custom_url_scheme">com\.revendasmart\.app<\/string>/);
assert.match(androidStyles, /Theme\.SplashScreen/);
assert.match(androidStyles, /windowSplashScreenBackground/);
assert.match(androidStyles, /windowSplashScreenAnimatedIcon/);
assert.match(androidStyles, /@color\/splashBackground/);
assert.match(androidStyles, /android:statusBarColor">@android:color\/transparent/);
assert.match(androidStyles, /android:navigationBarColor">@android:color\/transparent/);
assert.match(androidStyles, /android:windowLightStatusBar">true/);
assert.match(androidStyles, /android:windowLightNavigationBar">true/);
assert.match(androidStylesV28, /android:windowLayoutInDisplayCutoutMode">shortEdges/);
assert.match(androidMainActivity, /package com\.revendasmart\.app;/);
assert.match(androidMainActivity, /WindowCompat\.setDecorFitsSystemWindows\(window, false\)/);
assert.match(androidMainActivity, /setStatusBarColor\(Color\.TRANSPARENT\)/);
assert.match(androidMainActivity, /setNavigationBarColor\(Color\.TRANSPARENT\)/);
assert.match(androidDocs, /com\.revendasmart\.app/);
assert.match(androidDocs, /não gera APK\/AAB/i);
assert.match(androidDocs, /keystore/i);
assert.match(androidDocs, /Play Store/i);
assert.match(androidDocs, /testes posteriores no Galaxy/i);
assert.match(androidDocs, /android:doctor/i);
assert.match(androidDocs, /google-services\.json/i);

assert.match(packageJson.scripts?.["android:sync"] ?? "", /scripts\/android\/sync-web\.mjs sync/);
assert.match(packageJson.scripts?.["android:copy"] ?? "", /scripts\/android\/sync-web\.mjs copy/);
assert.match(androidSyncWebScript, /DEFAULT_ANDROID_API_BASE_URL = "https:\/\/revendasmart\.vercel\.app"/);
assert.match(androidSyncWebScript, /DEFAULT_ANDROID_PUBLIC_APP_URL = "https:\/\/revendasmart\.vercel\.app"/);
assert.match(androidSyncWebScript, /VITE_API_BASE_URL/);
assert.match(androidSyncWebScript, /VITE_PUBLIC_APP_URL/);
assert.match(androidSyncWebScript, /publicAppUrl/);
assert.match(androidSyncWebScript, /https:/);
assert.match(androidSyncWebScript, /localhost/);
assert.match(androidSyncWebScript, /FORBIDDEN_BUNDLE_MARKERS/);
assert.match(androidSyncWebScript, /REQUIRED_ANDROID_BUNDLE_MARKERS/);
assert.match(androidSyncWebScript, /VITE_APP_BUILD_ID/);
assert.match(androidSyncWebScript, /assertAndroidAssets/);
assert.match(androidSyncWebScript, /build-manifest\.json|BUILD_MANIFEST_FILE/);
assert.match(androidSyncWebScript, /createBuildManifest/);
assert.match(androidSyncWebScript, /assertCopiedAssetsMatch/);
assert.match(androidSyncWebScript, /worktreeFingerprint/);
assert.match(androidSyncWebScript, /Produto selecionado para voc\\u00ea pedir direto pelo WhatsApp/);
assert.match(androidSyncWebScript, /Imagem omitida; arte gerada sem ela/);
assert.match(androidSyncWebScript, /Pe\\u00e7a pelo WhatsApp/);
assert.match(androidSyncWebScript, /REVENDA SMART/);
assert.match(androidSyncWebScript, /pathToFileURL/);
assert.match(androidSyncWebScript, /function runCommand\([\s\S]*new Promise/);
assert.match(androidSyncWebScript, /spawn\(command, args,[\s\S]*stdio: options\.stdio \|\| "inherit"[\s\S]*shell: false/);
assert.match(androidSyncWebScript, /child\.once\("error"/);
assert.match(androidSyncWebScript, /child\.once\("close"/);
assert.match(androidSyncWebScript, /process\.env\.npm_execpath/);
assert.match(androidSyncWebScript, /node_modules", "@capacitor", "cli", "bin", "capacitor"/);
assert.doesNotMatch(androidSyncWebScript, /npm\.cmd|npx\.cmd|cap\.cmd/);
assert.doesNotMatch(androidSyncWebScript, /spawnSync|process\.exit\(/);
assert.match(androidBuildDebugScript, /function runCommand\([\s\S]*new Promise/);
assert.match(androidBuildDebugScript, /spawn\(command, args,[\s\S]*stdio: "inherit"[\s\S]*shell: false/);
assert.match(androidBuildDebugScript, /child\.once\("error"/);
assert.match(androidBuildDebugScript, /child\.once\("close"/);
assert.match(androidBuildDebugScript, /process\.env\.npm_execpath/);
assert.match(androidBuildDebugScript, /npm-cli\.js/);
assert.match(androidBuildDebugScript, /command: process\.execPath/);
assert.match(androidBuildDebugScript, /await runCommand\(npmInvocation\.command,[\s\S]*"run", "android:sync"/);
assert.match(androidBuildDebugScript, /await runCommand\(gradleCommand, gradleArgs/);
assert.match(androidBuildDebugScript, /await runCommand\(process\.execPath, \["scripts\/android\/verify-debug-apk\.mjs"/);
assert.doesNotMatch(androidBuildDebugScript, /run\(isWindows \? "npm\.cmd"/);
assert.doesNotMatch(androidBuildDebugScript, /process\.exit\(/);
assert.match(androidBuildDebugScript, /JAVA_HOME/);
assert.match(androidBuildDebugScript, /javaHomeCandidate/);
assert.match(androidBuildDebugScript, /where\.exe/);
assert.match(androidBuildDebugScript, /cmd\.exe/);
assert.match(androidBuildDebugScript, /gradlew\.bat/);
assert.match(androidBuildDebugScript, /"clean", "assembleDebug"/);
assert.match(androidBuildDebugScript, /verify-debug-apk\.mjs/);
assert.match(androidBuildDebugScript, /ANDROID_BUILD_STARTED_AT/);
assert.match(androidBuildDebugScript, /rmSync\(apkPath/);
assert.doesNotMatch(androidBuildDebugScript, /spawnSync\("bash"/);
assert.doesNotMatch(androidBuildDebugScript, /sha256sum/);
assert.match(serverIndex, /"https:\/\/localhost", \/\/ Android Capacitor WebView origin/);
assert.match(serverIndex, /Access-Control-Allow-Headers[\s\S]*Authorization/);
assert.match(serverIndex, /Access-Control-Allow-Methods[\s\S]*OPTIONS/);
assert.match(serverIndex, /Access-Control-Allow-Credentials[\s\S]*true/);
assert.doesNotMatch(serverIndex, /Access-Control-Allow-Origin", "\*"/);
assert.match(androidDocs, /VITE_API_BASE_URL=https:\/\/revendasmart\.vercel\.app/);
assert.match(androidDebugDocs, /VITE_API_BASE_URL=https:\/\/revendasmart\.vercel\.app/);
const { executeAndroidSyncSteps, normalizeAndroidApiBaseUrl, normalizeAndroidPublicAppUrl, resolveCapInvocation, resolveNpmInvocation, runCommand } = await import("../scripts/android/sync-web.mjs");
const { createBuildManifest, validateBuildManifest, compareDirectoryHashMaps } = await import("../scripts/android/build-provenance.mjs");
const { parseAaptPackageName, isApkFresh, REQUIRED_APK_MARKERS, FORBIDDEN_APK_MARKERS } = await import("../scripts/android/verify-debug-apk.mjs");
assert.equal(normalizeAndroidApiBaseUrl("https://revendasmart.vercel.app/"), "https://revendasmart.vercel.app");
assert.equal(normalizeAndroidPublicAppUrl("https://revendasmart.vercel.app/u/demo"), "https://revendasmart.vercel.app");
for (const badAndroidApiBaseUrl of ["", "http://revendasmart.vercel.app", "https://localhost", "https://127.0.0.1", "not-a-url"]) {
  assert.throws(() => normalizeAndroidApiBaseUrl(badAndroidApiBaseUrl));
  assert.throws(() => normalizeAndroidPublicAppUrl(badAndroidApiBaseUrl));
}
const silentProcessLogger = { log() {}, error() {} };
const npmInvocationFixture = resolveNpmInvocation();
assert.equal(npmInvocationFixture.command, process.execPath);
assert.match(npmInvocationFixture.args[0], /npm-cli\.js$/);
assert.doesNotMatch(npmInvocationFixture.args[0], /\.cmd$/i);
const capInvocationFixture = resolveCapInvocation();
assert.equal(capInvocationFixture.command, process.execPath);
assert.match(capInvocationFixture.args[0], /@capacitor[\\/]cli[\\/]bin[\\/]capacitor$/);
assert.doesNotMatch(capInvocationFixture.args[0], /\.cmd$/i);
await runCommand(process.execPath, ["-e", "process.exit(0)"], { stdio: "ignore", logger: silentProcessLogger });
await assert.rejects(
  runCommand(process.execPath, ["-e", "process.exit(7)"], { stdio: "ignore", logger: silentProcessLogger }),
  /exit code=7/,
);
await assert.rejects(
  runCommand("__missing_android_sync_command__", [], { stdio: "ignore", logger: silentProcessLogger }),
  /falha ao iniciar comando:[\s\S]*cwd=[\s\S]*(ENOENT|não encontrado|not found)/i,
);
const successfulSyncSteps: string[] = [];
await executeAndroidSyncSteps({
  build: async () => { successfulSyncSteps.push("build"); },
  manifest: async () => { successfulSyncSteps.push("manifest"); },
  capacitor: async () => { successfulSyncSteps.push("capacitor"); },
  validate: async () => { successfulSyncSteps.push("validate"); },
}, silentProcessLogger);
assert.deepEqual(successfulSyncSteps, ["build", "manifest", "capacitor", "validate"]);
const failedSyncSteps: string[] = [];
await assert.rejects(
  executeAndroidSyncSteps({
    build: async () => { failedSyncSteps.push("build"); throw new Error("synthetic build failure"); },
    manifest: async () => { failedSyncSteps.push("manifest"); },
    capacitor: async () => { failedSyncSteps.push("capacitor"); },
    validate: async () => { failedSyncSteps.push("validate"); },
  }, silentProcessLogger),
  /synthetic build failure/,
);
assert.deepEqual(failedSyncSteps, ["build"]);

const buildSnapshotFixture = {
  gitCommit: "a".repeat(40),
  gitShortCommit: "a".repeat(12),
  branch: "release/test",
  worktreeClean: true,
  worktreeFingerprint: "b".repeat(64),
};
const buildManifestFixture = createBuildManifest(buildSnapshotFixture, {
  buildStartedAt: "2026-07-22T12:00:00.000Z",
  generatedAt: "2026-07-22T12:01:00.000Z",
});
assert.equal(buildManifestFixture.packageName, "com.revendasmart.app");
assert.equal(buildManifestFixture.buildType, "debug");
assert.equal(validateBuildManifest(buildManifestFixture, buildSnapshotFixture), buildManifestFixture);
assert.throws(() => validateBuildManifest({ ...buildManifestFixture, gitCommit: "c".repeat(40) }, buildSnapshotFixture));
assert.deepEqual(
  compareDirectoryHashMaps(new Map([["index.html", "aaa"], ["assets/app.js", "bbb"]]), new Map([["index.html", "aaa"], ["assets/app.js", "ccc"], ["old.js", "ddd"]])),
  { missing: [], unexpected: ["old.js"], mismatched: ["assets/app.js"] },
);
assert.equal(parseAaptPackageName("package: name='com.revendasmart.app' versionCode='1'"), "com.revendasmart.app");
assert.equal(isApkFresh(Date.parse("2026-07-22T12:02:00.000Z"), "2026-07-22T12:01:00.000Z", "2026-07-22T12:00:00.000Z"), true);
assert.equal(isApkFresh(Date.parse("2026-07-22T11:59:00.000Z"), "2026-07-22T12:01:00.000Z", "2026-07-22T12:00:00.000Z"), false);
assert.deepEqual(REQUIRED_APK_MARKERS, ["Chamar no WhatsApp", "Resumo do período", "O que precisa da sua atenção"]);
assert.ok(FORBIDDEN_APK_MARKERS.includes("Últimos 7 dias"));
assert.doesNotMatch(androidDocs, /server\.url|http:\/\/localhost|usesCleartextTraffic/);

assert.equal(packageJson.scripts?.["android:build:debug"], "node scripts/android/build-debug.mjs");
assert.equal(packageJson.scripts?.["android:verify:debug"], "node scripts/android/verify-debug-apk.mjs");
assert.equal(packageJson.scripts?.["android:install:debug"], "node scripts/android/install-debug.mjs");
assert.equal(packageJson.scripts?.["android:logcat"], "node scripts/android/logcat.mjs");
assert.match(androidGitignore, /^local\.properties$/m);
assert.match(androidGitignore, /^\.gradle\/$/m);
assert.match(androidGitignore, /^build\/$/m);
assert.match(androidGitignore, /^app\/src\/main\/assets\/public$/m);
assert.match(androidGitignore, /^\*\.apk$/m);
assert.match(androidGitignore, /^\*\.aab$/m);
assert.match(androidGitignore, /^\*\.jks$/m);
assert.match(androidGitignore, /^\*\.keystore$/m);
assert.match(androidGitignore, /^google-services\.json$/m);
assert.match(androidGitignore, /^\.idea\/$/m);
const launcherBackgroundDefinitionCount = `${androidColors}
${androidLauncherBackground}`.match(/name="ic_launcher_background"/g)?.length ?? 0;
assert.equal(launcherBackgroundDefinitionCount, 1);
assert.doesNotMatch(androidColors, /name="ic_launcher_background"/);
assert.match(androidLauncherBackground, /name="ic_launcher_background"/);
assert.doesNotMatch(androidManifest, /usesCleartextTraffic="true"/);
assert.doesNotMatch(androidManifest, /android\.permission\.(CAMERA|RECORD_AUDIO|ACCESS_FINE_LOCATION|READ_CONTACTS|SEND_SMS|READ_EXTERNAL_STORAGE|WRITE_EXTERNAL_STORAGE|POST_NOTIFICATIONS)/);
assert.doesNotMatch(capacitorConfig, /server\.url|url:\s*["']https?:\/\//);
assert.doesNotMatch(capacitorConfig, /localhost|127\.0\.0\.1|cleartext/i);
assert.doesNotMatch(androidBuildGradle, /storePassword|keyPassword|signingConfig\s+release/);
assert.doesNotMatch(androidBuildDebugScript, /assembleRelease|bundleRelease|signing|keystore/i);
assert.doesNotMatch(androidInstallDebugScript, /assembleRelease|bundleRelease|signing|keystore/i);
assert.match(androidBuildProvenanceScript, /worktreeFingerprint/);
assert.match(androidBuildProvenanceScript, /"diff", "--binary"/);
assert.match(androidVerifyDebugApkScript, /assets["'], ["']public/);
assert.match(androidVerifyDebugApkScript, /aapt/);
assert.match(androidVerifyDebugApkScript, /compareDirectoryHashMaps/);
assert.match(androidVerifyDebugApkScript, /assertSingleApplicationBundle/);
assert.match(androidVerifyDebugApkScript, /app-debug\.provenance\.json|DEBUG_PROVENANCE_RELATIVE_PATH/);
assert.match(androidVerifyDebugApkScript, /Chamar no WhatsApp/);
assert.match(androidVerifyDebugApkScript, /Resumo do per\\u00edodo/);
assert.match(androidVerifyDebugApkScript, /O que precisa da sua aten\\u00e7\\u00e3o/);
assert.match(androidInstallDebugScript, /verifyDebugApk/);
assert.match(androidInstallDebugScript, /shell", "pm", "path"/);
assert.match(androidInstallDebugScript, /"pull", installedBaseApk/);
assert.match(androidInstallDebugScript, /installedSha256 !== verification\.apkSha256/);
assert.doesNotMatch(androidLogcatScript, /adb logcat\s*[`"']?\s*$/);
assert.match(androidBuildDebugScript, /assembleDebug/);
assert.match(androidBuildDebugScript, /ANDROID_HOME.*ANDROID_SDK_ROOT|ANDROID_SDK_ROOT.*ANDROID_HOME/s);
assert.match(androidBuildDebugScript, /menos de 1 GB livre/);
assert.match(androidInstallDebugScript, /ANDROID_SERIAL/);
assert.match(androidInstallDebugScript, /nenhum aparelho autorizado/);
assert.match(androidInstallDebugScript, /process\.platform === "win32"/);
assert.match(androidInstallDebugScript, /ADB_PATH/);
assert.match(androidInstallDebugScript, /ANDROID_HOME/);
assert.match(androidInstallDebugScript, /ANDROID_SDK_ROOT/);
assert.match(androidInstallDebugScript, /platform-tools/);
assert.match(androidInstallDebugScript, /where\.exe/);
assert.match(androidInstallDebugScript, /command -v adb/);
assert.match(androidInstallDebugScript, /"version"/);
assert.match(androidInstallDebugScript, /adb\.exe/);
assert.match(androidInstallDebugScript, /Android.*Sdk.*platform-tools.*adb\.exe/s);
assert.doesNotMatch(androidInstallDebugScript, /spawnSync\("bash"/);
assert.doesNotMatch(androidInstallDebugScript, /which\s+adb/);
assert.match(androidLogcatScript, /com\.revendasmart\.app/);
assert.match(androidDebugDocs, /Windows \+ Android Studio/);
assert.match(androidDebugDocs, /Checklist funcional no Galaxy/);
assert.match(androidDebugDocs, /android\/app\/build\/outputs\/apk\/debug\/app-debug\.apk/);
assert.doesNotMatch(androidDebugDocs, /server\.url|http:\/\/localhost|usesCleartextTraffic/);
assert.match(androidDebugDocs, /não gerou APK/i);
assert.match(androidDebugDocs, /configuração remota de servidor do Capacitor/);

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

assert.match(marketingCard, /toBlob/);
assert.match(marketingCard, /Produto sem imagem/);
assert.match(marketingCard, /N.{1}o foi poss.{1}vel carregar a foto deste produto/);
assert.doesNotMatch(marketingCard, /REVENDA SMART/);
assert.match(marketingCard, /#2563eb/);
assert.match(marketingCard, /badgeText/);
assert.match(marketingCard, /features/);
assert.match(marketingCanvas, /buildMarketingAdVisualModel/);
assert.match(marketingCanvas, /onCtaClick/);
assert.match(marketingCanvas, /ctaText/);
assert.match(marketing, /buildMarketingWhatsappUrl/);
assert.match(marketing, /storeWhatsappNumber/);
assert.match(marketing, /Cadastre o WhatsApp da sua loja para receber pedidos por este card\./);
assert.match(marketing, /button-configure-store-whatsapp/);
assert.match(marketing, /window\.open\(previewWhatsappUrl/);
assert.doesNotMatch(marketing, /previewWhatsappUrl \|\| `https:\/\/wa\.me\/\?text=/);
assert.equal(buildMarketingWhatsappUrl({ phone: "(11) 99999-8888", message: "Quero Produto" }), "https://wa.me/11999998888?text=Quero%20Produto");
assert.equal(buildMarketingWhatsappUrl({ phone: "", message: "Quero Produto" }), "");
assert.match(settings, /Personalização visual da loja/);
assert.match(settings, /rs-store-theme-grid/);
assert.match(settings, /rs-store-nicho-grid/);
assert.match(settings, /toggleBusinessType/);
assert.match(settings, /APP_THEMES/);
assert.match(nextStepsPlan, /An.{1}ncios Premium com descri.{1,2}o assistida por IA/);
assert.match(nextStepsPlan, /n.{1}o implementado nesta hotfix/);
const loginPage = read("client/src/pages/login.tsx");
const loginCss = read("client/src/styles/login.css");
const readPngSize = (path: string) => {
  const buffer = fs.readFileSync(path);
  assert.equal(buffer.toString("ascii", 1, 4), "PNG");
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
};
assert.deepEqual(readPngSize("client/public/login-reference-approved.png"), { width: 935, height: 1600 });
assert.deepEqual(readPngSize("client/public/login-hero-approved.png"), { width: 935, height: 1236 });
assert.match(loginPage, /Sua revenda,/);
assert.match(loginPage, /do seu jeito,/);
assert.match(loginPage, /com controle total/);
assert.match(loginPage, /login-hero-approved\.png/);
assert.match(loginPage, /rs-login-hero-image/);
assert.match(loginPage, /rs-login-form/);
assert.match(loginPage, /autoComplete="email"/);
assert.match(loginPage, /autoComplete="current-password"/);
assert.match(loginPage, /Lembrar meus dados/);
assert.match(loginPage, /Mostrar senha/);
assert.match(loginCss, /rs-login-hero-image/);
assert.match(loginCss, /rs-login-message-area/);
assert.doesNotMatch(loginPage, /login-reference-official\.png/);
assert.doesNotMatch(loginPage, /rs-login-overlay-form/);
assert.doesNotMatch(loginCss, /aspect-ratio:\s*9 \/ 16/);
assert.doesNotMatch(loginCss, /rs-login-email-field|rs-login-password-field/);
assert.doesNotMatch(loginPage, /aparência de negócio grande/);
assert.doesNotMatch(loginPage, /Gestão, vendas e catálogo em um só lugar/);
assert.doesNotMatch(loginPage, /bg-\[\#160b2e\]/);
assert.doesNotMatch(loginPage, /rs-login-person-illustration/);
assert.doesNotMatch(loginPage, />A<|rs-login-avatar/);


// Android/public URL and executive Home guardrails
assert.match(settings, /buildPublicCatalogUrl\(slug\)/);
assert.match(clientsPage, /buildPublicCatalogUrl\(slug\)/);
assert.doesNotMatch(settings, /window\.location\.origin[^\n]+\/u\//);
assert.doesNotMatch(clientsPage, /window\.location\.origin[^\n]+\/u\//);
assert.doesNotMatch(marketingShare, /wa\.me/);
assert.match(marketingShare, /Share\.share\(\{[\s\S]*files: \[savedFile\.uri\]/);
assert.match(marketingShare, /Filesystem\.writeFile/);
assert.match(marketingShare, /Directory\.Cache/);
assert.match(marketingShare, /MarketingShareCancelledError/);
assert.match(marketing, /Compartilhamento cancelado/);
assert.match(marketingShare, /nav\.canShare\(\{ files: \[file\] \}\)/);
assert.match(androidSyncWebScript, /VITE_PUBLIC_APP_URL/);
assert.match(androidSyncWebScript, /VITE_API_BASE_URL/);
assert.match(androidSyncWebScript, /revendasmart\.vercel\.app/);
assert.match(publicUrl, /VITE_PUBLIC_APP_URL/);
assert.match(publicUrl, /resolvePublicAppBaseUrl/);
assert.doesNotMatch(publicUrl, /https:\/\/localhost/);

const homeReferenceDate = new Date("2026-07-15T12:00:00.000Z");
const homeFixture = buildHomeDashboardViewModel({
  referenceDate: homeReferenceDate,
  settings: {
    storeName: "Adriana Perfumes",
    monthlyGoal: 10000,
    lowStockThreshold: 3,
    catalogSlug: "adriana-perfumes",
    enablePublicCatalog: true,
    appTheme: "purple-default",
    onboarding_completed: true,
  } as any,
  products: [
    { id: "p1", name: "Kaiak Oceano", brand: "Natura", category: "Perfumes", stock: 2, costPrice: 50, salePrice: 100, imageUrl: "https://example.test/kaiak.png" },
    { id: "p2", name: "Glamour Diva", brand: "Boticário", category: "Perfumes", stock: 1, costPrice: 0, salePrice: 80 },
    { id: "p3", name: "Ameixa e Flor de Baunilha", brand: "Natura", category: "Corpo", stock: 7, costPrice: 40, salePrice: 70 },
    { id: "p4", name: "Produto sem estoque", brand: "", category: "Kits", stock: 0, costPrice: 15, salePrice: 30 },
  ] as any,
  clients: [
    { id: "c1", name: "Ana", phone: "11999990000" },
    { id: "c2", name: "Bia", phone: "11999990001" },
    { id: "c3", name: "Cris", phone: "11999990002" },
  ] as any,
  sales: [
    { id: "s1", clientId: "c1", date: "2026-07-10T10:00:00.000Z", totalPrice: 1200, paymentType: "pix", products: [{ productId: "p1", quantity: 12, price: 100 }] },
    { id: "s2", clientId: "c2", date: "2026-06-01T10:00:00.000Z", totalPrice: 80, paymentType: "pix", products: [{ productId: "p2", quantity: 1, price: 80 }] },
  ] as any,
});
assert.deepEqual(HOME_SUMMARY_KPI_IDS, ["monthlyRevenue", "monthlyProfit", "monthlySalesCount", "monthComparison"]);
assert.equal(HOME_SUMMARY_KPI_IDS.length, 4);
assert.equal(homeFixture.summary.monthlyRevenue, 1200);
assert.equal(homeFixture.summary.monthlySalesCount, 1);
assert.equal(homeFixture.summary.previousRevenue, 80);
assert.equal(homeFixture.goal.hasExplicitGoal, true);
assert.equal(homeFixture.goal.progressPercent, 12);
assert.ok(homeFixture.priorities.length <= 3);
assert.ok(homeFixture.priorityTotalCount >= homeFixture.priorities.length);
assert.ok(homeFixture.hiddenPriorityCount === Math.max(0, homeFixture.priorityTotalCount - 3));
assert.deepEqual(homeFixture.priorities.map((item) => item.severity), [...homeFixture.priorities.map((item) => item.severity)].sort((a, b) => a - b));
assert.ok(homeFixture.mainInsight);
const emptyHome = buildHomeDashboardViewModel({ referenceDate: homeReferenceDate, settings: {} as any, products: [] as any, clients: [] as any, sales: [] as any });
assert.equal(emptyHome.summary.monthlySalesCount, 0);
assert.equal(emptyHome.summary.comparisonPercent, null);
assert.equal(emptyHome.goal.hasExplicitGoal, false);
assert.equal(emptyHome.mainInsight, null);
assert.ok(emptyHome.priorities.length <= 3);
assert.match(homeDashboardViewModel, /cliente ativo/i);
assert.doesNotMatch(homeDashboardViewModel, /onSnapshot|getDocs|collection\(/);
assert.match(dashboard, /buildHomeDashboardViewModel/);
assert.match(dashboard, /Visão geral/);
assert.match(dashboard, /Resumo do período/);
assert.match(dashboard, /O que precisa da sua atenção/);
assert.match(dashboard, /Meta mensal/);
assert.match(dashboard, /Insight principal/);
assert.match(dashboard, /Defina uma meta mensal/);
assert.match(dashboard, /Finalize a configuração da loja/);
assert.match(dashboard, /home-onboarding-strip/);
assert.doesNotMatch(dashboard, /Math\.max\(12/);
assert.match(dashboard, /hiddenPriorityCount/);
assert.doesNotMatch(dashboard, /OnboardingChecklist/);
assert.doesNotMatch(dashboard, /home-summary-kpis[\s\S]*Ticket médio/);
assert.doesNotMatch(dashboard, /HOME_ACCORDION_STORAGE_KEY|data-home-accordion|resolveHomeAccordionSectionId/);
assert.doesNotMatch(dashboard, /StoreIntelligencePanel/);
assert.doesNotMatch(dashboard, /quickActions/);
assert.doesNotMatch(dashboard, /Centro de comando/);
assert.doesNotMatch(dashboard, /Estoque inteligente/);
assert.doesNotMatch(dashboard, /Sem IA|regras determinísticas|listener extra|bundle|cache/);
assert.doesNotMatch(dashboard, />Novo produto<|>Nova venda<|>Novo cliente<|>Nova cobrança<|>Compartilhar catálogo<|>Criar campanha<|>Registrar venda/);
assert.doesNotMatch(dashboard, /display:\s*none/);
assert.doesNotMatch(dashboard, /onSnapshot|getDocs|getFirestore|collection\(/);

// Firebase emulator static guardrails
assert.equal(firebaseJson.emulators.auth.port, 9099);
assert.equal(firebaseJson.emulators.auth.host, "127.0.0.1");
assert.equal(firebaseJson.emulators.firestore.port, 8080);
assert.equal(firebaseJson.emulators.firestore.host, "127.0.0.1");
assert.equal(firebaseJson.emulators.storage.port, 9199);
assert.equal(firebaseJson.emulators.storage.host, "127.0.0.1");
assert.equal(firebaseJson.emulators.ui.port, 4000);
assert.equal(firebaseJson.emulators.hub.port, 4400);
assert.equal(firebaseJson.emulators.logging.port, 4500);
assert.equal(firebaseJson.emulators.singleProjectMode, true);
assert.match(packageJson.scripts["emulators:start"], /firebase-tools@15\.24\.0/);
assert.match(packageJson.scripts["emulators:start"], /--project demo-revendasmart/);
assert.match(packageJson.scripts["test:firebase"], /emulators:exec/);
assert.match(packageJson.scripts["test:firebase"], /auth,firestore,storage/);
assert.match(packageJson.scripts["test:firebase:run"], /firebase-emulator-tests\.ts/);
assert.match(firebaseClient, /VITE_USE_FIREBASE_EMULATORS/);
assert.match(firebaseClient, /connectAuthEmulator/);
assert.match(firebaseClient, /connectFirestoreEmulator/);
assert.match(firebaseClient, /connectStorageEmulator/);
assert.match(firebaseClient, /import\.meta\.env\.PROD/);
assert.match(firebaseClient, /__revendaSmartFirebaseEmulatorsConnected/);
assert.doesNotMatch(firebaseClient, /import \{ getFirestore, connectFirestoreEmulator \} from "firebase\/firestore"/);
assert.doesNotMatch(firebaseClient, /import \{ getStorage, connectStorageEmulator \} from "firebase\/storage"/);
assert.match(buildScript, /loadEnv\("production"/);
assert.match(buildScript, /VITE_USE_FIREBASE_EMULATORS=true/);
assert.match(firebaseEmulatorTests, /demo-revendasmart/);
assert.match(firebaseEmulatorTests, /FIRESTORE_EMULATOR_HOST/);
assert.match(firebaseEmulatorTests, /FIREBASE_AUTH_EMULATOR_HOST/);
assert.match(firebaseEmulatorTests, /FIREBASE_STORAGE_EMULATOR_HOST/);
assert.match(firebaseEmulatorTests, /outro usuário não lê produto do owner/);
assert.match(firebaseEmulatorTests, /SVG é bloqueado no Storage/);
assert.match(firebaseEmulatorDocs, /Nunca execute esses testes contra produção/);
assert.match(firebaseEmulatorDocs, /VITE_USE_FIREBASE_EMULATORS=true npm run dev:client/);


// Quality Sprint 1 guardrails
const qualityPackageJson = JSON.parse(read("package.json"));
const playwrightConfig = read("playwright.config.ts");
const e2eSpec = read("tests/e2e/core-product-sale.spec.ts");
const gitleaksConfig = read(".gitleaks.toml");
const gitleaksRunner = read("scripts/security/run-gitleaks.mjs");
const dependabotConfig = read(".github/dependabot.yml");
const knipConfig = read("knip.json");
const qualityWorkflow = read(".github/workflows/quality-gates.yml");
const androidSkill = read(".codex/skills/revendasmart-android-release/SKILL.md");
const skillIndex = JSON.parse(read(".codex/skills/index.json"));

assert.equal(qualityPackageJson.scripts["test:e2e"], "playwright test");
assert.equal(qualityPackageJson.scripts["security:gitleaks"], "node scripts/security/run-gitleaks.mjs");
assert.equal(qualityPackageJson.scripts["quality:knip"], "knip --config knip.json --reporter compact --no-exit-code");
assert.match(playwrightConfig, /baseURL/);
assert.match(e2eSpec, /E2E_ALLOW_MUTATIONS/);
assert.match(e2eSpec, /test\.skip/);
assert.match(gitleaksConfig, /mercado-pago-token/);
assert.match(gitleaksConfig, /firebase-admin-private-key/);
assert.match(gitleaksConfig, /vercel-token/);
assert.match(gitleaksRunner, /--redact/);
assert.match(gitleaksRunner, /não encontrou padrões sensíveis|nao encontrou padroes sensiveis/i);
assert.match(dependabotConfig, /open-pull-requests-limit: 5/);
assert.doesNotMatch(dependabotConfig, /automerge/i);
assert.match(knipConfig, /client\/src/);
assert.match(qualityWorkflow, /gitleaks\/gitleaks-action@v2/);
assert.match(qualityWorkflow, /npm run quality:knip/);
assert.doesNotMatch(qualityWorkflow, /deploy|vercel|cloud run|AAB|keystore/i);
assert.match(androidSkill, /Não fazer commit/);
assert.match(androidSkill, /android:sync/);
assert.match(androidSkill, /SHA-256/);
assert.ok(skillIndex.skills.some((skill: { name: string }) => skill.name === "revendasmart-android-release"));

console.log("Smoke tests passed: catalog, images, navigation, modules, subscription and ranking.");
