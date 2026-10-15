export const PRODUCT_SEARCH_SCHEMA_VERSION = 1;
export const MAX_NORMALIZED_PRODUCT_SEARCH_LENGTH = 160;
export const MAX_PRODUCT_SEARCH_TOKEN_LENGTH = 48;
export const MAX_PRODUCT_SEARCH_TOKENS = 16;
export const MIN_PRODUCT_SERVER_SEARCH_LENGTH = 2;
export const PRODUCT_SEARCH_DEFAULT_PAGE_SIZE = 20;
export const PRODUCT_SEARCH_MAX_PAGE_SIZE = 50;
export const PRODUCT_SEARCH_DEBOUNCE_MS = 300;

// SEARCH-SERVER-01 — a busca server-side fica ativada para o catálogo interno, sem reintroduzir
// nenhum serviço externo e sem mexer nos outros fluxos de busca local que continuam fora de escopo.
export const SERVER_SIDE_PRODUCT_SEARCH_ENABLED = true;
export const SERVER_SIDE_CLIENT_SEARCH_ENABLED = false;
export const CATALOG_SERVER_SEARCH_ENABLED = true;

export interface ProductSearchInput {
  name?: unknown;
  brand?: unknown;
  category?: unknown;
  barcode?: unknown;
  productType?: unknown;
}

export interface ProductSearchFields {
  nameNormalized: string;
  brandNormalized: string;
  categoryNormalized: string;
  barcodeNormalized: string;
  productTypeNormalized: string;
  searchTokens: string[];
  searchSchemaVersion: number;
}

export type ProductSearchIndexField =
  | "nameNormalized"
  | "brandNormalized"
  | "categoryNormalized"
  | "barcodeNormalized"
  | "productTypeNormalized";

export type ProductSearchPlanKind =
  | "disabled"
  | "empty"
  | "term_too_short"
  | "barcode_exact"
  | "token"
  | "name_prefix";

export type ProductSearchPlanSource = "local_fallback" | "server";

export interface ProductServerSearchPlan {
  kind: ProductSearchPlanKind;
  source: ProductSearchPlanSource;
  enabled: boolean;
  normalizedTerm: string;
  searchToken: string;
  pageSize: number;
  debounceMs: number;
  reason?: string;
}

export type ProductServerSearchIndexKey =
  | "single:nameNormalized"
  | "categoryNormalized_nameNormalized"
  | "searchTokens_nameNormalized"
  | "barcodeNormalized_nameNormalized"
  | "categoryNormalized_searchTokens_nameNormalized"
  | "categoryNormalized_barcodeNormalized_nameNormalized";

export interface ProductServerSearchQueryFilter {
  fieldPath: "categoryNormalized" | "barcodeNormalized" | "searchTokens" | "nameNormalized";
  op: "==" | "array-contains" | "prefix";
}

export interface ProductServerSearchQuerySpec {
  normalizedCategoryFilter: string;
  hasCategoryFilter: boolean;
  filters: ProductServerSearchQueryFilter[];
  orderByField: "nameNormalized";
  indexKey: ProductServerSearchIndexKey;
}

export function buildProductServerSearchQuerySpec(input: { plan: ProductServerSearchPlan; categoryFilter?: unknown }): ProductServerSearchQuerySpec {
  const normalizedCategoryFilter = normalizeProductSearchText(input.categoryFilter);
  const hasCategoryFilter = Boolean(normalizedCategoryFilter && normalizedCategoryFilter !== "todos");
  const filters: ProductServerSearchQueryFilter[] = [];
  const { plan } = input;

  if (hasCategoryFilter) filters.push({ fieldPath: "categoryNormalized", op: "==" });

  if (plan.kind === "barcode_exact") {
    filters.push({ fieldPath: "barcodeNormalized", op: "==" });
  } else if (plan.kind === "token") {
    filters.push({ fieldPath: "searchTokens", op: "array-contains" });
  } else if (plan.kind === "name_prefix") {
    filters.push({ fieldPath: "nameNormalized", op: "prefix" });
  }

  let indexKey: ProductServerSearchIndexKey = "single:nameNormalized";
  if (hasCategoryFilter && plan.kind === "token") {
    indexKey = "categoryNormalized_searchTokens_nameNormalized";
  } else if (hasCategoryFilter && plan.kind === "barcode_exact") {
    indexKey = "categoryNormalized_barcodeNormalized_nameNormalized";
  } else if (hasCategoryFilter) {
    indexKey = "categoryNormalized_nameNormalized";
  } else if (plan.kind === "token") {
    indexKey = "searchTokens_nameNormalized";
  } else if (plan.kind === "barcode_exact") {
    indexKey = "barcodeNormalized_nameNormalized";
  }

  return {
    normalizedCategoryFilter,
    hasCategoryFilter,
    filters,
    orderByField: "nameNormalized",
    indexKey,
  };
}

export interface BuildProductServerSearchPlanInput {
  term?: unknown;
  pageSize?: unknown;
  serverSearchEnabled?: boolean;
}

type ProductSearchIndexedRecord = Partial<Record<ProductSearchIndexField, unknown>> & {
  searchTokens?: unknown;
  searchSchemaVersion?: unknown;
};

export function normalizeProductSearchText(value: unknown): string {
  if (value === null || value === undefined) return "";

  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['’`´]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_NORMALIZED_PRODUCT_SEARCH_LENGTH);
}

export function normalizeProductBarcode(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value)
    .normalize("NFKC")
    .replace(/[^\dA-Za-z]/g, "")
    .toLowerCase()
    .slice(0, MAX_NORMALIZED_PRODUCT_SEARCH_LENGTH);
}

function tokenizeNormalizedText(value: string): string[] {
  if (!value) return [];
  return value
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length >= MIN_PRODUCT_SERVER_SEARCH_LENGTH);
}

function compactUniqueTokens(tokens: string[]): string[] {
  const unique = new Set<string>();
  for (const token of tokens) {
    if (!token) continue;
    unique.add(token.slice(0, MAX_PRODUCT_SEARCH_TOKEN_LENGTH));
    if (unique.size >= MAX_PRODUCT_SEARCH_TOKENS) break;
  }
  return Array.from(unique);
}

export function sanitizeProductSearchPageSize(value: unknown): number {
  const parsed = Math.floor(Number(value));
  if (!Number.isFinite(parsed) || parsed <= 0) return PRODUCT_SEARCH_DEFAULT_PAGE_SIZE;
  return Math.min(PRODUCT_SEARCH_MAX_PAGE_SIZE, parsed);
}

export function isLikelyBarcodeSearchTerm(value: unknown): boolean {
  const barcode = normalizeProductBarcode(value);
  return /^\d{8,32}$/.test(barcode);
}

export function getProductSearchIndexField(
  product: ProductSearchIndexedRecord,
  field: ProductSearchIndexField,
  fallback: unknown
): string {
  const indexedValue = product[field];
  if (typeof indexedValue === "string" && indexedValue.trim()) {
    return indexedValue.slice(0, MAX_NORMALIZED_PRODUCT_SEARCH_LENGTH);
  }

  return field === "barcodeNormalized" ? normalizeProductBarcode(fallback) : normalizeProductSearchText(fallback);
}

export function buildProductSearchFields(input: ProductSearchInput): ProductSearchFields {
  const nameNormalized = normalizeProductSearchText(input.name);
  const brandNormalized = normalizeProductSearchText(input.brand);
  const categoryNormalized = normalizeProductSearchText(input.category);
  const barcodeNormalized = normalizeProductBarcode(input.barcode);
  const productTypeNormalized = normalizeProductSearchText(input.productType);

  const searchTokens = compactUniqueTokens([
    ...tokenizeNormalizedText(nameNormalized),
    ...tokenizeNormalizedText(brandNormalized),
    ...tokenizeNormalizedText(categoryNormalized),
    ...tokenizeNormalizedText(productTypeNormalized),
    barcodeNormalized,
  ]);

  return {
    nameNormalized,
    brandNormalized,
    categoryNormalized,
    barcodeNormalized,
    productTypeNormalized,
    searchTokens,
    searchSchemaVersion: PRODUCT_SEARCH_SCHEMA_VERSION,
  };
}

export function isProductSearchIndexed(product: ProductSearchIndexedRecord): boolean {
  return product.searchSchemaVersion === PRODUCT_SEARCH_SCHEMA_VERSION
    && typeof product.nameNormalized === "string"
    && typeof product.brandNormalized === "string"
    && typeof product.categoryNormalized === "string"
    && typeof product.barcodeNormalized === "string"
    && typeof product.productTypeNormalized === "string"
    && Array.isArray(product.searchTokens)
    && product.searchTokens.length > 0
    && product.searchTokens.length <= MAX_PRODUCT_SEARCH_TOKENS;
}

export function getProductSearchIndexStatus(product: ProductSearchIndexedRecord): "indexed" | "missing" | "partial" | "future_schema" | "legacy_schema" {
  if (product.searchSchemaVersion === undefined && product.searchTokens === undefined) return "missing";
  if (typeof product.searchSchemaVersion === "number" && product.searchSchemaVersion > PRODUCT_SEARCH_SCHEMA_VERSION) return "future_schema";
  if (typeof product.searchSchemaVersion === "number" && product.searchSchemaVersion < PRODUCT_SEARCH_SCHEMA_VERSION) return "legacy_schema";
  return isProductSearchIndexed(product) ? "indexed" : "partial";
}

export function canUseCatalogServerSearch(term: unknown): boolean {
  const normalized = normalizeProductSearchText(term);
  return normalized.length >= MIN_PRODUCT_SERVER_SEARCH_LENGTH || isLikelyBarcodeSearchTerm(term);
}

export function getPrimaryProductSearchToken(term: unknown): string {
  const normalized = normalizeProductSearchText(term);
  return tokenizeNormalizedText(normalized)[0] || "";
}

export function buildProductServerSearchPlan(input: BuildProductServerSearchPlanInput = {}): ProductServerSearchPlan {
  const enabled = input.serverSearchEnabled ?? SERVER_SIDE_PRODUCT_SEARCH_ENABLED;
  const normalizedTerm = normalizeProductSearchText(input.term);
  const barcode = normalizeProductBarcode(input.term);
  const pageSize = sanitizeProductSearchPageSize(input.pageSize);
  const searchToken = getPrimaryProductSearchToken(input.term);

  if (!enabled) {
    return { kind: "disabled", source: "local_fallback", enabled: false, normalizedTerm, searchToken, pageSize, debounceMs: PRODUCT_SEARCH_DEBOUNCE_MS, reason: "feature_flag_disabled" };
  }

  if (!normalizedTerm && !barcode) {
    return { kind: "empty", source: "server", enabled: true, normalizedTerm, searchToken, pageSize, debounceMs: 0 };
  }

  if (isLikelyBarcodeSearchTerm(input.term)) {
    return { kind: "barcode_exact", source: "server", enabled: true, normalizedTerm: barcode, searchToken: barcode, pageSize, debounceMs: 0 };
  }

  if (normalizedTerm.length < MIN_PRODUCT_SERVER_SEARCH_LENGTH) {
    return { kind: "term_too_short", source: "local_fallback", enabled: true, normalizedTerm, searchToken: "", pageSize, debounceMs: PRODUCT_SEARCH_DEBOUNCE_MS, reason: "term_too_short" };
  }

  if (searchToken && normalizedTerm.includes(" ")) {
    return { kind: "token", source: "server", enabled: true, normalizedTerm, searchToken, pageSize, debounceMs: PRODUCT_SEARCH_DEBOUNCE_MS };
  }

  // Termos curtos ainda usam prefixo para acompanhar a digitação ("ma" -> "mal" -> "malb"). Termos
  // únicos mais estáveis passam para token search para cobrir marca/categoria/nome em qualquer posição
  // prática do índice (ex.: "carolina", "perfume", "malbec", "212").
  if (normalizedTerm.length <= 4) {
    return { kind: "name_prefix", source: "server", enabled: true, normalizedTerm, searchToken, pageSize, debounceMs: PRODUCT_SEARCH_DEBOUNCE_MS };
  }

  return { kind: "token", source: "server", enabled: true, normalizedTerm, searchToken, pageSize, debounceMs: PRODUCT_SEARCH_DEBOUNCE_MS };
}

export function productMatchesLocalSearch(product: ProductSearchIndexedRecord & ProductSearchInput, term: unknown): boolean {
  const normalized = normalizeProductSearchText(term);
  if (!normalized) return true;
  const barcode = normalizeProductBarcode(term);
  const name = getProductSearchIndexField(product, "nameNormalized", product.name);
  const brand = getProductSearchIndexField(product, "brandNormalized", product.brand);
  const category = getProductSearchIndexField(product, "categoryNormalized", product.category);
  const productType = getProductSearchIndexField(product, "productTypeNormalized", product.productType);
  const barcodeNormalized = getProductSearchIndexField(product, "barcodeNormalized", product.barcode);
  return name.includes(normalized)
    || brand.includes(normalized)
    || category.includes(normalized)
    || productType.includes(normalized)
    || Boolean(barcode && barcodeNormalized.includes(barcode));
}

export function buildProductSearchBackfillPatch(product: ProductSearchInput & ProductSearchIndexedRecord): ProductSearchFields | null {
  const next = buildProductSearchFields(product);
  const current = {
    nameNormalized: typeof product.nameNormalized === "string" ? product.nameNormalized : "",
    brandNormalized: typeof product.brandNormalized === "string" ? product.brandNormalized : "",
    categoryNormalized: typeof product.categoryNormalized === "string" ? product.categoryNormalized : "",
    barcodeNormalized: typeof product.barcodeNormalized === "string" ? product.barcodeNormalized : "",
    productTypeNormalized: typeof product.productTypeNormalized === "string" ? product.productTypeNormalized : "",
    searchTokens: Array.isArray(product.searchTokens) ? product.searchTokens : [],
    searchSchemaVersion: product.searchSchemaVersion,
  };
  if (current.nameNormalized === next.nameNormalized
    && current.brandNormalized === next.brandNormalized
    && current.categoryNormalized === next.categoryNormalized
    && current.barcodeNormalized === next.barcodeNormalized
    && current.productTypeNormalized === next.productTypeNormalized
    && current.searchSchemaVersion === next.searchSchemaVersion
    && JSON.stringify(current.searchTokens) === JSON.stringify(next.searchTokens)) {
    return null;
  }
  return next;
}
