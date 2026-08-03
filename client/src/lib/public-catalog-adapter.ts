import type {
  CatalogCategorySummary,
  CatalogCollection,
  CatalogExperience,
  CatalogHero,
  CatalogNicheExperience,
  CatalogNicheId,
} from "@/lib/catalog-experience";
import type { Product } from "@/lib/mock-data";
import type {
  PublicCatalogCategorySummary,
  PublicCatalogCollection,
  PublicCatalogHero,
  PublicCatalogPresentation,
  PublicCatalogProduct,
} from "@shared/public-catalog";

export function toCatalogProduct(product: PublicCatalogProduct): Product {
  return {
    id: product.id,
    name: product.name,
    brand: product.brand || "",
    category: product.category || "",
    productType: product.productType,
    costPrice: 0,
    salePrice: product.salePrice,
    stock: product.availableQuantity,
    imageUrl: product.imageUrl,
    description: product.description,
    gender: product.gender,
    extras: product.publicAttributes,
    isFeatured: product.isFeatured,
    isOnSale: product.isOnSale,
    discountPercent: product.discountPercent,
    ...(product.promotionalPrice !== undefined ? { promotionalPrice: product.promotionalPrice } : {}),
  } as Product;
}

function mapCategory(category: PublicCatalogCategorySummary): CatalogCategorySummary {
  return { ...category, unitsSold: 0 };
}

function mapHero(hero: PublicCatalogHero | undefined): CatalogHero | undefined {
  return hero ? { product: toCatalogProduct(hero.product), reason: hero.reason, unitsSold: 0 } : undefined;
}

function mapCollection(collection: PublicCatalogCollection): CatalogCollection {
  return { id: collection.id, products: collection.products.map(toCatalogProduct) };
}

function uniqueProducts(products: Product[]): Product[] {
  const seen = new Set<string>();
  return products.filter((product) => {
    if (seen.has(product.id)) return false;
    seen.add(product.id);
    return true;
  });
}

function mapNiche(niche: PublicCatalogPresentation["niches"][number]): CatalogNicheExperience {
  const quickCollections = niche.quickCollections.map(mapCollection);
  const products = uniqueProducts([
    ...(niche.hero ? [toCatalogProduct(niche.hero.product)] : []),
    ...quickCollections.flatMap((collection) => collection.products),
  ]);
  const lowStockIds = new Set(
    quickCollections.find((collection) => collection.id === "low_stock")?.products.map((product) => product.id) || [],
  );
  return {
    id: niche.id as CatalogNicheId,
    label: niche.label,
    isPrimary: niche.isPrimary,
    products,
    productCount: niche.productCount,
    officialCategories: [...niche.categories],
    customCategories: [],
    categories: [...niche.categories],
    usedCategories: niche.usedCategories.map(mapCategory),
    availableProducts: products.filter((product) => Number(product.stock || 0) > 0),
    outOfStockProducts: products.filter((product) => Number(product.stock || 0) <= 0),
    lowStockProducts: products.filter((product) => lowStockIds.has(product.id)),
    hero: mapHero(niche.hero),
    quickCollections,
  };
}

export function toCatalogExperience(presentation: PublicCatalogPresentation): CatalogExperience {
  const quickCollections = presentation.quickCollections.map(mapCollection);
  const featuredProducts = quickCollections.find((collection) => collection.id === "featured")?.products || [];
  const hero = mapHero(presentation.hero);
  return {
    mode: presentation.mode,
    activeNicheId: presentation.activeNicheId as CatalogNicheId | undefined,
    niches: presentation.niches.map(mapNiche),
    hero,
    topCategories: presentation.topCategories.map(mapCategory),
    quickCollections,
    featuredProducts,
    inventorySummary: {
      totalProducts: presentation.inventorySummary.totalProducts,
      availableProducts: presentation.inventorySummary.availableProducts,
      outOfStockProducts: presentation.inventorySummary.outOfStockProducts,
      lowStockProducts: 0,
      totalUnits: 0,
      productsWithImage: 0,
      productsWithoutImage: 0,
      activeNiches: presentation.inventorySummary.activeNiches,
      orphanedProducts: 0,
      uncategorizedProducts: 0,
    },
    orphanedProducts: [],
    uncategorizedProducts: [],
    adCTA: {
      route: "/marketing",
      source: "catalog",
      productId: hero?.product.id,
      reason: hero?.reason,
      params: { source: "catalog", productId: hero?.product.id },
    },
    emptyReason: presentation.emptyReason,
  };
}

export function buildPublicProductNicheMap(
  presentation: PublicCatalogPresentation,
  pageProducts: readonly PublicCatalogProduct[],
): Map<string, string> {
  const result = new Map<string, string>();
  const publicNicheIds = new Set(presentation.niches.map((niche) => niche.id));
  const fallbackNicheId = presentation.activeNicheId && publicNicheIds.has(presentation.activeNicheId)
    ? presentation.activeNicheId
    : presentation.niches[0]?.id;
  const add = (product: PublicCatalogProduct) => {
    if (product.nicheId && publicNicheIds.has(product.nicheId)) result.set(product.id, product.nicheId);
  };
  const addPageProduct = (product: PublicCatalogProduct) => {
    if (product.nicheId && publicNicheIds.has(product.nicheId)) {
      result.set(product.id, product.nicheId);
    } else if (fallbackNicheId) {
      result.set(product.id, fallbackNicheId);
    }
  };
  pageProducts.forEach(addPageProduct);
  if (presentation.hero) add(presentation.hero.product);
  presentation.quickCollections.forEach((collection) => collection.products.forEach(add));
  presentation.niches.forEach((niche) => {
    if (niche.hero) add(niche.hero.product);
    niche.quickCollections.forEach((collection) => collection.products.forEach(add));
  });
  return result;
}
