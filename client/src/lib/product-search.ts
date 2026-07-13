export const PRODUCT_SEARCH_SCHEMA_VERSION = 1;
export const MAX_NORMALIZED_PRODUCT_SEARCH_LENGTH = 160;
export const MAX_PRODUCT_SEARCH_TOKENS = 16;
export const MIN_CATALOG_SERVER_SEARCH_LENGTH = 2;

// Conservative rollout flag: keep the current full local catalog search until
// product search index coverage is validated by the future backfill.
export const CATALOG_SERVER_SEARCH_ENABLED = false;

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

export function normalizeProductSearchText(value: unknown): string {
  if (value === null || value === undefined) return "";

  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_NORMALIZED_PRODUCT_SEARCH_LENGTH);
}

function tokenizeNormalizedText(value: string): string[] {
  if (!value) return [];
  return value
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length >= MIN_CATALOG_SERVER_SEARCH_LENGTH);
}

function compactUniqueTokens(tokens: string[]): string[] {
  const unique = new Set<string>();
  for (const token of tokens) {
    if (!token) continue;
    unique.add(token.slice(0, MAX_NORMALIZED_PRODUCT_SEARCH_LENGTH));
    if (unique.size >= MAX_PRODUCT_SEARCH_TOKENS) break;
  }
  return Array.from(unique);
}

export function buildProductSearchFields(input: ProductSearchInput): ProductSearchFields {
  const nameNormalized = normalizeProductSearchText(input.name);
  const brandNormalized = normalizeProductSearchText(input.brand);
  const categoryNormalized = normalizeProductSearchText(input.category);
  const barcodeNormalized = normalizeProductSearchText(input.barcode);
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

export function isProductSearchIndexed(product: { searchSchemaVersion?: unknown; searchTokens?: unknown }): boolean {
  return product.searchSchemaVersion === PRODUCT_SEARCH_SCHEMA_VERSION
    && Array.isArray(product.searchTokens)
    && product.searchTokens.length > 0;
}

export function canUseCatalogServerSearch(term: unknown): boolean {
  return normalizeProductSearchText(term).length >= MIN_CATALOG_SERVER_SEARCH_LENGTH;
}

export function getPrimaryProductSearchToken(term: unknown): string {
  const normalized = normalizeProductSearchText(term);
  return tokenizeNormalizedText(normalized)[0] || "";
}
