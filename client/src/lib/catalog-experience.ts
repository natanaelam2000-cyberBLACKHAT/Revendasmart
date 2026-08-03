import {
  NICHO_CONFIG,
  ONBOARDING_NICHO_IDS,
  inferNichoFromCategory,
  type NichoId,
} from "@/lib/nicho-config";
import { getProductImage, type AppSettings, type Product, type Sale } from "@/lib/mock-data";
import { normalizeProductSearchText } from "@/lib/product-search";

export type CatalogExperienceMode = "general" | "focused" | "segmented" | "hub";

export type CatalogNicheId = Exclude<NichoId, "Alimentos/Doces">;

export type CatalogHeroReason =
  | "manual_featured"
  | "active_promotion"
  | "top_seller"
  | "has_image"
  | "available";

export type CatalogCollectionId =
  | "offers"
  | "featured"
  | "best_sellers"
  | "kits"
  | "ready_to_deliver"
  | "low_stock"
  | "uncategorized";

export type CatalogEmptyReason =
  | "no_products"
  | "no_products_and_no_niches"
  | "all_out_of_stock";

export interface CatalogHero {
  product: Product;
  reason: CatalogHeroReason;
  unitsSold: number;
}

export interface CatalogCategorySummary {
  id: string;
  label: string;
  productCount: number;
  availableProductCount: number;
  unitsSold: number;
}

export interface CatalogCollection {
  id: CatalogCollectionId;
  products: Product[];
}

export interface CatalogInventorySummary {
  totalProducts: number;
  availableProducts: number;
  outOfStockProducts: number;
  lowStockProducts: number;
  totalUnits: number;
  productsWithImage: number;
  productsWithoutImage: number;
  activeNiches: number;
  orphanedProducts: number;
  uncategorizedProducts: number;
}

export interface CatalogAdCTA {
  route: "/marketing";
  source: "catalog";
  productId?: string;
  reason?: CatalogHeroReason;
  params: {
    source: "catalog";
    productId?: string;
  };
}

export interface CatalogNicheExperience {
  id: CatalogNicheId;
  label: string;
  isPrimary: boolean;
  products: Product[];
  productCount: number;
  officialCategories: string[];
  customCategories: string[];
  categories: string[];
  usedCategories: CatalogCategorySummary[];
  availableProducts: Product[];
  outOfStockProducts: Product[];
  lowStockProducts: Product[];
  hero?: CatalogHero;
  quickCollections: CatalogCollection[];
}

export interface CatalogExperience {
  mode: CatalogExperienceMode;
  activeNicheId?: CatalogNicheId;
  niches: CatalogNicheExperience[];
  hero?: CatalogHero;
  topCategories: CatalogCategorySummary[];
  quickCollections: CatalogCollection[];
  featuredProducts: Product[];
  inventorySummary: CatalogInventorySummary;
  orphanedProducts: Product[];
  uncategorizedProducts: Product[];
  adCTA: CatalogAdCTA;
  emptyReason?: CatalogEmptyReason;
}

export interface ResolveCatalogExperienceInput {
  businessType?: AppSettings["businessType"];
  businessTypes?: AppSettings["businessTypes"];
  customCategoriesByNicho?: AppSettings["customCategoriesByNicho"];
  products: readonly Product[];
  sales: readonly Sale[];
  lowStockThreshold: number;
  now: Date | number;
}

type ProductResolutionSource = "explicit" | "inferred" | "uncategorized" | "orphaned";

interface ProductFacts {
  product: Product;
  stock: number;
  unitsSold: number;
  hasImage: boolean;
  category: string;
  categoryKey: string;
  normalizedName: string;
  isPromotion: boolean;
  resolvedNicheId?: CatalogNicheId;
  resolutionSource: ProductResolutionSource;
}

const LEGACY_FOOD_NICHE = "Alimentos/Doces";
const NORMALIZED_FOOD_NICHE: CatalogNicheId = "Doces";

function normalizeDisplayText(value: unknown): string {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

function normalizeCategoryKey(value: unknown): string {
  return normalizeDisplayText(value).toLocaleLowerCase("pt-BR");
}

function normalizeNicheId(value: unknown): CatalogNicheId | undefined {
  const candidate = normalizeDisplayText(value);
  if (!candidate) return undefined;
  if (candidate.toLocaleLowerCase("pt-BR") === LEGACY_FOOD_NICHE.toLocaleLowerCase("pt-BR")) {
    return NORMALIZED_FOOD_NICHE;
  }

  return ONBOARDING_NICHO_IDS.find(
    (nicheId) => nicheId.toLocaleLowerCase("pt-BR") === candidate.toLocaleLowerCase("pt-BR"),
  );
}

function resolveConfiguredNiches(
  businessType: AppSettings["businessType"] | undefined,
  businessTypes: AppSettings["businessTypes"],
): { nicheIds: CatalogNicheId[]; primaryNicheId?: CatalogNicheId } {
  const nicheIds: CatalogNicheId[] = [];
  const seen = new Set<CatalogNicheId>();

  if (Array.isArray(businessTypes)) {
    for (const candidate of businessTypes) {
      const nicheId = normalizeNicheId(candidate);
      if (nicheId && !seen.has(nicheId)) {
        seen.add(nicheId);
        nicheIds.push(nicheId);
      }
    }
  }

  const legacyPrimary = normalizeNicheId(businessType);
  if (nicheIds.length === 0 && legacyPrimary) {
    nicheIds.push(legacyPrimary);
  }

  const primaryNicheId = legacyPrimary && nicheIds.includes(legacyPrimary)
    ? legacyPrimary
    : nicheIds[0];

  return { nicheIds, primaryNicheId };
}

function resolveMode(nicheCount: number): CatalogExperienceMode {
  if (nicheCount === 0) return "general";
  if (nicheCount === 1) return "focused";
  if (nicheCount <= 3) return "segmented";
  return "hub";
}

function toFiniteNumber(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeStock(value: unknown): number {
  return Math.max(0, toFiniteNumber(value));
}

function normalizeThreshold(value: unknown): number {
  return Math.max(0, toFiniteNumber(value));
}

function buildUnitsSoldByProduct(sales: readonly Sale[]): Map<string, number> {
  const result = new Map<string, number>();
  for (const sale of sales) {
    if (!Array.isArray(sale.products)) continue;
    for (const soldProduct of sale.products) {
      const productId = normalizeDisplayText(soldProduct?.productId);
      const quantity = toFiniteNumber(soldProduct?.quantity);
      if (!productId || quantity <= 0) continue;
      result.set(productId, (result.get(productId) ?? 0) + quantity);
    }
  }
  return result;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function categoryLabelQuality(label: string): number {
  const lower = label.toLocaleLowerCase("pt-BR");
  const upper = label.toLocaleUpperCase("pt-BR");
  if (label === upper && label !== lower) return 2;
  if (label === lower && label !== upper) return 1;
  return 0;
}

function choosePreferredCategoryLabel(left: string, right: string): string {
  const qualityDifference = categoryLabelQuality(left) - categoryLabelQuality(right);
  if (qualityDifference !== 0) return qualityDifference < 0 ? left : right;
  const normalizedDifference = compareText(normalizeProductSearchText(left), normalizeProductSearchText(right));
  if (normalizedDifference !== 0) return normalizedDifference < 0 ? left : right;
  return compareText(left, right) <= 0 ? left : right;
}

function compareFactTieBreakers(left: ProductFacts, right: ProductFacts): number {
  if (left.unitsSold !== right.unitsSold) return right.unitsSold - left.unitsSold;
  if (left.hasImage !== right.hasImage) return left.hasImage ? -1 : 1;
  if (left.stock !== right.stock) return right.stock - left.stock;
  const byName = compareText(left.normalizedName, right.normalizedName);
  if (byName !== 0) return byName;
  return compareText(String(left.product.id), String(right.product.id));
}

function getHeroReason(fact: ProductFacts): CatalogHeroReason {
  if (fact.product.isFeatured === true) return "manual_featured";
  if (fact.isPromotion) return "active_promotion";
  if (fact.unitsSold > 0) return "top_seller";
  if (fact.hasImage) return "has_image";
  return "available";
}

function getHeroPriority(fact: ProductFacts): number {
  switch (getHeroReason(fact)) {
    case "manual_featured": return 0;
    case "active_promotion": return 1;
    case "top_seller": return 2;
    case "has_image": return 3;
    case "available": return 4;
  }
}

function compareHeroCandidates(left: ProductFacts, right: ProductFacts): number {
  const priorityDifference = getHeroPriority(left) - getHeroPriority(right);
  return priorityDifference || compareFactTieBreakers(left, right);
}

function compareAvailableFirst(left: ProductFacts, right: ProductFacts): number {
  const leftAvailable = left.stock > 0;
  const rightAvailable = right.stock > 0;
  if (leftAvailable !== rightAvailable) return leftAvailable ? -1 : 1;
  return compareFactTieBreakers(left, right);
}

function selectHero(facts: readonly ProductFacts[]): CatalogHero | undefined {
  let candidate: ProductFacts | undefined;
  for (const fact of facts) {
    if (fact.stock <= 0) continue;
    if (!candidate || compareHeroCandidates(fact, candidate) < 0) candidate = fact;
  }
  if (!candidate) return undefined;
  return {
    product: candidate.product,
    reason: getHeroReason(candidate),
    unitsSold: candidate.unitsSold,
  };
}

function sortProducts(
  facts: readonly ProductFacts[],
  comparator: (left: ProductFacts, right: ProductFacts) => number = compareFactTieBreakers,
): Product[] {
  return [...facts].sort(comparator).map((fact) => fact.product);
}

function buildCollections(facts: readonly ProductFacts[], lowStockThreshold: number): CatalogCollection[] {
  const definitions: Array<{
    id: CatalogCollectionId;
    predicate: (fact: ProductFacts) => boolean;
    comparator?: (left: ProductFacts, right: ProductFacts) => number;
  }> = [
    { id: "offers", predicate: (fact) => fact.isPromotion, comparator: compareAvailableFirst },
    { id: "featured", predicate: (fact) => fact.product.isFeatured === true, comparator: compareAvailableFirst },
    { id: "best_sellers", predicate: (fact) => fact.unitsSold > 0 },
    { id: "kits", predicate: (fact) => fact.categoryKey === "kit" || fact.categoryKey === "kits" },
    { id: "ready_to_deliver", predicate: (fact) => fact.stock > 0 },
    {
      id: "low_stock",
      predicate: (fact) => fact.stock > 0 && fact.stock <= lowStockThreshold,
      comparator: (left, right) => left.stock - right.stock || compareFactTieBreakers(left, right),
    },
    { id: "uncategorized", predicate: (fact) => !fact.categoryKey },
  ];

  const collections: CatalogCollection[] = [];
  for (const definition of definitions) {
    const matching = facts.filter(definition.predicate);
    if (matching.length === 0) continue;
    collections.push({
      id: definition.id,
      products: sortProducts(matching, definition.comparator),
    });
  }
  return collections;
}

function dedupeCategories(values: readonly unknown[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const label = normalizeDisplayText(value);
    const key = normalizeCategoryKey(label);
    if (!label || seen.has(key)) continue;
    seen.add(key);
    result.push(label);
  }
  return result;
}

function resolveCustomCategories(
  customCategoriesByNicho: AppSettings["customCategoriesByNicho"],
): Map<CatalogNicheId, string[]> {
  const result = new Map<CatalogNicheId, string[]>();
  if (!customCategoriesByNicho || typeof customCategoriesByNicho !== "object") return result;

  for (const [rawNicheId, categories] of Object.entries(customCategoriesByNicho)) {
    const nicheId = normalizeNicheId(rawNicheId);
    if (!nicheId || !Array.isArray(categories)) continue;
    result.set(nicheId, dedupeCategories([...(result.get(nicheId) ?? []), ...categories]));
  }
  return result;
}

function buildCategorySummaries(facts: readonly ProductFacts[]): CatalogCategorySummary[] {
  const summaries = new Map<string, CatalogCategorySummary>();
  for (const fact of facts) {
    if (!fact.categoryKey) continue;
    const current = summaries.get(fact.categoryKey) ?? {
      id: fact.categoryKey,
      label: fact.category,
      productCount: 0,
      availableProductCount: 0,
      unitsSold: 0,
    };
    current.productCount += 1;
    current.availableProductCount += fact.stock > 0 ? 1 : 0;
    current.unitsSold += fact.unitsSold;
    current.label = choosePreferredCategoryLabel(current.label, fact.category);
    summaries.set(fact.categoryKey, current);
  }

  return Array.from(summaries.values()).sort((left, right) =>
    right.productCount - left.productCount
    || right.availableProductCount - left.availableProductCount
    || right.unitsSold - left.unitsSold
    || compareText(left.id, right.id),
  );
}

function resolveProductNiche(
  product: Product,
  selectedNiches: ReadonlySet<CatalogNicheId>,
): { nicheId?: CatalogNicheId; source: ProductResolutionSource } {
  const explicitValue = normalizeDisplayText(product.productType);
  const explicitNicheId = normalizeNicheId(explicitValue);
  if (explicitValue && explicitNicheId) {
    return selectedNiches.has(explicitNicheId)
      ? { nicheId: explicitNicheId, source: "explicit" }
      : { nicheId: explicitNicheId, source: "orphaned" };
  }

  const category = normalizeDisplayText(product.category);
  if (!category) {
    return selectedNiches.has("Geral")
      ? { nicheId: "Geral", source: "uncategorized" }
      : { source: "uncategorized" };
  }

  const inferredNicheId = normalizeNicheId(inferNichoFromCategory(category)) ?? "Geral";
  return selectedNiches.has(inferredNicheId)
    ? { nicheId: inferredNicheId, source: "inferred" }
    : { nicheId: inferredNicheId, source: "orphaned" };
}

function createProductFacts(
  product: Product,
  unitsSoldByProduct: ReadonlyMap<string, number>,
  selectedNiches: ReadonlySet<CatalogNicheId>,
): ProductFacts {
  const resolution = resolveProductNiche(product, selectedNiches);
  const category = normalizeDisplayText(product.category);
  return {
    product,
    stock: normalizeStock(product.stock),
    unitsSold: unitsSoldByProduct.get(String(product.id)) ?? 0,
    hasImage: Boolean(getProductImage(product)),
    category,
    categoryKey: normalizeCategoryKey(category),
    normalizedName: normalizeProductSearchText(product.name),
    isPromotion: product.isOnSale === true,
    resolvedNicheId: resolution.nicheId,
    resolutionSource: resolution.source,
  };
}

function buildNicheExperience(
  nicheId: CatalogNicheId,
  primaryNicheId: CatalogNicheId | undefined,
  facts: readonly ProductFacts[],
  customCategories: readonly string[],
  lowStockThreshold: number,
): CatalogNicheExperience {
  const officialCategories = [...NICHO_CONFIG[nicheId].categories];
  const normalizedCustomCategories = dedupeCategories(customCategories);
  const actualCategories = facts.map((fact) => fact.category).filter(Boolean);
  const categories = dedupeCategories([
    ...officialCategories,
    ...normalizedCustomCategories,
    ...actualCategories,
  ]);
  const availableFacts = facts.filter((fact) => fact.stock > 0);
  const outOfStockFacts = facts.filter((fact) => fact.stock <= 0);
  const lowStockFacts = availableFacts.filter((fact) => fact.stock <= lowStockThreshold);

  return {
    id: nicheId,
    label: NICHO_CONFIG[nicheId].label,
    isPrimary: nicheId === primaryNicheId,
    products: sortProducts(facts),
    productCount: facts.length,
    officialCategories,
    customCategories: normalizedCustomCategories,
    categories,
    usedCategories: buildCategorySummaries(facts),
    availableProducts: sortProducts(availableFacts),
    outOfStockProducts: sortProducts(outOfStockFacts),
    lowStockProducts: sortProducts(
      lowStockFacts,
      (left, right) => left.stock - right.stock || compareFactTieBreakers(left, right),
    ),
    hero: selectHero(facts),
    quickCollections: buildCollections(facts, lowStockThreshold),
  };
}

export function resolveCatalogExperience(input: ResolveCatalogExperienceInput): CatalogExperience {
  const { nicheIds, primaryNicheId } = resolveConfiguredNiches(input.businessType, input.businessTypes);
  const selectedNiches = new Set(nicheIds);
  const lowStockThreshold = normalizeThreshold(input.lowStockThreshold);
  const unitsSoldByProduct = buildUnitsSoldByProduct(input.sales);
  const customCategoriesByNiche = resolveCustomCategories(input.customCategoriesByNicho);
  const factsByNiche = new Map<CatalogNicheId, ProductFacts[]>(nicheIds.map((nicheId) => [nicheId, []]));
  const allFacts: ProductFacts[] = [];
  const orphanedFacts: ProductFacts[] = [];
  const uncategorizedFacts: ProductFacts[] = [];

  // No temporal promotion fields exist in Product today. Keeping the injected
  // reference in the contract prevents a future implementation from consulting
  // Date.now() when such fields become real.
  void input.now;

  for (const product of input.products) {
    const facts = createProductFacts(product, unitsSoldByProduct, selectedNiches);
    allFacts.push(facts);
    if (!facts.categoryKey) uncategorizedFacts.push(facts);
    if (facts.resolutionSource === "orphaned") {
      orphanedFacts.push(facts);
      continue;
    }
    if (facts.resolvedNicheId) factsByNiche.get(facts.resolvedNicheId)?.push(facts);
  }

  const niches = nicheIds.map((nicheId) => buildNicheExperience(
    nicheId,
    primaryNicheId,
    factsByNiche.get(nicheId) ?? [],
    customCategoriesByNiche.get(nicheId) ?? [],
    lowStockThreshold,
  ));
  const hero = selectHero(allFacts);
  const availableCount = allFacts.reduce((total, fact) => total + (fact.stock > 0 ? 1 : 0), 0);
  const lowStockCount = allFacts.reduce(
    (total, fact) => total + (fact.stock > 0 && fact.stock <= lowStockThreshold ? 1 : 0),
    0,
  );
  const productsWithImage = allFacts.reduce((total, fact) => total + (fact.hasImage ? 1 : 0), 0);

  let emptyReason: CatalogEmptyReason | undefined;
  if (allFacts.length === 0) {
    emptyReason = nicheIds.length === 0 ? "no_products_and_no_niches" : "no_products";
  } else if (availableCount === 0) {
    emptyReason = "all_out_of_stock";
  }

  return {
    mode: resolveMode(nicheIds.length),
    activeNicheId: primaryNicheId,
    niches,
    hero,
    topCategories: buildCategorySummaries(allFacts),
    quickCollections: buildCollections(allFacts, lowStockThreshold),
    featuredProducts: sortProducts(
      allFacts.filter((fact) => fact.product.isFeatured === true),
      compareAvailableFirst,
    ),
    inventorySummary: {
      totalProducts: allFacts.length,
      availableProducts: availableCount,
      outOfStockProducts: allFacts.length - availableCount,
      lowStockProducts: lowStockCount,
      totalUnits: allFacts.reduce((total, fact) => total + fact.stock, 0),
      productsWithImage,
      productsWithoutImage: allFacts.length - productsWithImage,
      activeNiches: nicheIds.length,
      orphanedProducts: orphanedFacts.length,
      uncategorizedProducts: uncategorizedFacts.length,
    },
    orphanedProducts: sortProducts(orphanedFacts),
    uncategorizedProducts: sortProducts(uncategorizedFacts),
    adCTA: {
      route: "/marketing",
      source: "catalog",
      productId: hero?.product.id,
      reason: hero?.reason,
      params: {
        source: "catalog",
        productId: hero?.product.id,
      },
    },
    emptyReason,
  };
}
