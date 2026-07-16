import assert from "node:assert/strict";
import fs from "node:fs";
import { APP_THEME_IDS, APP_THEMES, DEFAULT_APP_THEME_ID, DESIGN_TOKEN_NAMES, buildDesignSystemVariables, resolveAppThemeId } from "../client/src/lib/app-themes";
import { NICHO_CONFIG, ONBOARDING_NICHO_IDS, getNichoConfig, getProductCategoriesForNicho } from "../client/src/lib/nicho-config";
import { CATALOG_SERVER_SEARCH_ENABLED, PRODUCT_SEARCH_SCHEMA_VERSION, SERVER_SIDE_CLIENT_SEARCH_ENABLED, SERVER_SIDE_PRODUCT_SEARCH_ENABLED, buildProductSearchBackfillPatch, buildProductSearchFields, buildProductServerSearchPlan, buildProductServerSearchQuerySpec, canUseCatalogServerSearch, getProductSearchIndexStatus, isLikelyBarcodeSearchTerm, isProductSearchIndexed, normalizeProductBarcode, normalizeProductSearchText, productMatchesLocalSearch, sanitizeProductSearchPageSize } from "../client/src/lib/product-search";
import { buildStoreIntelligence } from "../client/src/lib/store-health";
import { defaultSettings } from "../client/src/lib/mock-data";
import { buildProductCreatePayload } from "../client/src/lib/product-payload";
import { MARKETING_AD_THEME_IDS, buildMarketingAdConfig, buildMarketingAdMessage, formatMarketingPrice, normalizeMarketingAdConfig, sanitizeMarketingHistoryPayload } from "../client/src/lib/marketing-ad";

const read = (path: string) => fs.readFileSync(path, "utf8");
const routes = read("server/routes.ts");
const serverIndex = read("server/index.ts");
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
const marketingCanvas = read("client/src/components/MarketingAdCanvas.tsx");
const marketingHistoryHook = read("client/src/hooks/useMarketingHistory.ts");
const marketingHistoryPanel = read("client/src/components/MarketingHistoryPanel.tsx");
const layout = read("client/src/components/layout.tsx");
const settings = read("client/src/pages/settings.tsx");
const images = read("client/src/components/ProductImageCard.tsx");
const subscribe = read("client/src/pages/subscribe.tsx");
const dashboard = read("client/src/pages/dashboard.tsx");
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
assert.match(productPayload, /buildProductSearchFields/);
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
assert.match(marketingCard, /onImageFallback/);
assert.match(marketingCard, /try \{ canvas\.toBlob/);
assert.match(marketingCard, /config\.priceText/);
assert.match(marketingCard, /ctaText/);
assert.match(marketingCard, /wrap\(ctx, config\.productName/);
assert.match(marketing, /Imagem omitida; arte gerada sem ela/);
assert.match(marketing, /createMarketingCard\(entry, imageFallbackNotice\)/);
assert.match(marketing, /createMarketingCard\(payload, imageFallbackNotice\)/);
assert.match(marketingCanvas, /data-testid="marketing-ad-canvas"/);
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
assert.match(dashboard, /StoreIntelligencePanel/);
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
assert.match(dashboard, /Centro de comando/);
assert.match(dashboard, /commandCenter/);
assert.match(dashboard, /commandKpis/);
assert.match(dashboard, /executiveWidgets/);
assert.match(dashboard, /smartAlerts/);

assert.match(dashboardMetrics, /calculateExecutiveSummary/);
assert.match(dashboardMetrics, /calculateMonthlyGoal/);
assert.match(dashboardMetrics, /calculateStockExecutiveMetrics/);
assert.match(dashboardMetrics, /calculateWorstProduct/);
assert.match(dashboardMetrics, /statusLabel/);
assert.doesNotMatch(dashboardMetrics, /999/);
assert.match(dashboardMetrics, /calculateAttentionItems/);
assert.match(dashboard, /Alertas inteligentes/);
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
assert.match(dashboard, /OnboardingChecklist/);
assert.match(dashboard, /Configurar nome da loja/);
assert.match(dashboard, /Concluir configuração/);
assert.match(dashboard, /products\.length > 0/);
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
assert.match(indexHtml, /viewport-fit=cover/);
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
assert.ok(manifest.icons.every((icon: any) => String(icon.src) === "/logo-revenda-smart-symbol.png"));
assert.ok(manifest.icons.some((icon: any) => String(icon.src) === "/logo-revenda-smart-symbol.png" && String(icon.purpose || "").includes("maskable")));
assert.match(indexHtml, /href="\/logo-revenda-smart-symbol\.png"/);
assert.match(indexHtml, /theme-color" content="#4c16ad"/);
assert.match(indexHtml, /og:image" content="https:\/\/revendasmart\.vercel\.app\/logo-revenda-smart\.png"/);
assert.match(indexHtml, /twitter:image" content="https:\/\/revendasmart\.vercel\.app\/logo-revenda-smart\.png"/);
assert.ok(manifest.shortcuts.every((shortcut: any) => shortcut.icons?.every((icon: any) => String(icon.src) === "/logo-revenda-smart-symbol.png")));
assert.ok(manifest.shortcuts.some((shortcut: any) => shortcut.url === "/products"));
assert.ok(manifest.shortcuts.some((shortcut: any) => shortcut.url === "/clients"));
assert.ok(manifest.shortcuts.some((shortcut: any) => shortcut.url === "/sell"));
assert.ok(manifest.shortcuts.some((shortcut: any) => shortcut.url === "/catalog"));
assert.match(serviceWorker, /revenda-smart-static-v4/);
assert.match(serviceWorker, /logo-revenda-smart-symbol\.png/);
assert.doesNotMatch(serviceWorker, /icons\/icon-192x192\.png/);
assert.doesNotMatch(serviceWorker, /favicon\.png/);
assert.match(main, /function registerPwaServiceWorker/);
assert.match(main, /navigator\.serviceWorker/);
assert.match(main, /register\("\/sw\.js"\)/);
assert.match(main, /import\.meta\.env\.PROD/);
assert.match(main, /window\.addEventListener\("load", register, \{ once: true \}\)/);
assert.match(serviceWorker, /revenda-smart-static-v4/);
assert.match(serviceWorker, /PRECACHE_ASSETS/);
assert.match(serviceWorker, /STATIC_CACHEABLE_DESTINATIONS/);
assert.match(serviceWorker, /request\.mode === 'navigate'/);
assert.match(serviceWorker, /cache\.put\(request, response\.clone\(\)\)/);
assert.doesNotMatch(serviceWorker, /\/api\//);
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

assert.match(marketingCard, /toBlob/);
assert.match(marketingCard, /Produto sem imagem/);
assert.match(marketingCanvas, /buildMarketingAdVisualModel/);
assert.match(settings, /Personalização visual da loja/);
assert.match(settings, /rs-store-theme-grid/);
assert.match(settings, /rs-store-nicho-grid/);
assert.match(settings, /toggleBusinessType/);
assert.match(settings, /APP_THEMES/);
const loginPage = read("client/src/pages/login.tsx");
const loginCss = read("client/src/styles/login.css");
assert.match(loginPage, /Sua revenda,/);
assert.match(loginPage, /do seu jeito,/);
assert.match(loginPage, /com controle total/);
assert.match(loginPage, /logo-revenda-smart\.png/);
assert.match(loginPage, /rs-login-brand-logo/);
assert.match(loginPage, /rs-login-person-illustration/);
assert.match(loginPage, /Lembrar meus dados/);
assert.match(loginPage, /Mostrar senha/);
assert.match(loginCss, /rs-login-person-tablet/);
assert.match(loginCss, /background:\s*[\s\S]*linear-gradient\(180deg, #ffffff/);
assert.doesNotMatch(loginPage, /aparência de negócio grande/);
assert.doesNotMatch(loginPage, /Gestão, vendas e catálogo em um só lugar/);
assert.doesNotMatch(loginPage, /bg-\[\#160b2e\]/);

console.log("Smoke tests passed: catalog, images, navigation, modules, subscription and ranking.");
