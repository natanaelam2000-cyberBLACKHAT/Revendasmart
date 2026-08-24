import { resolveCatalogExperience } from "../client/src/lib/catalog-experience";
import type { Product, Sale } from "../client/src/lib/mock-data";
import type {
  PublicCatalogCategorySummary,
  PublicCatalogCollection,
  PublicCatalogHero,
  PublicCatalogPresentation,
  PublicCatalogProduct,
  PublicCatalogStore,
} from "../shared/public-catalog";

export interface PublicCatalogSourceProduct {
  id: string;
  data: Record<string, unknown>;
}

export interface BuildPublicCatalogPayloadInput {
  slug: string;
  settings: Record<string, unknown>;
  products: readonly PublicCatalogSourceProduct[];
  sales: readonly Record<string, unknown>[];
  now: Date | number;
  /** Default false: callers that discard `.store` (ex.: paginação de produtos) não precisam informar. */
  cardAvailable?: boolean;
}

export interface BuiltPublicCatalogPayload {
  store: PublicCatalogStore;
  presentation: PublicCatalogPresentation;
  products: PublicCatalogProduct[];
}

const PUBLIC_ATTRIBUTE_KEYS = [
  "volume_ml",
  "scent_family",
  "skin_type",
  "size",
  "color",
  "public_type",
  "variation",
  "material",
  "model",
  "warranty",
  "condition",
  "quantity_pack",
  "dimensions",
  "room",
  "usage",
  "expiration_date",
  "flavor",
  "availability",
  "weight",
] as const;

function cleanText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().replace(/\s+/g, " ").slice(0, maxLength);
  return normalized || undefined;
}

function cleanUrl(value: unknown): string | undefined {
  const candidate = cleanText(value, 4096);
  if (!candidate) return undefined;
  try {
    const url = new URL(candidate);
    return url.protocol === "https:" || url.protocol === "http:" ? candidate : undefined;
  } catch {
    return undefined;
  }
}

function cleanColor(value: unknown): string | undefined {
  const candidate = cleanText(value, 32);
  return candidate && /^#[0-9a-f]{3,8}$/i.test(candidate) ? candidate : undefined;
}

function toNonNegativeNumber(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function toAvailableQuantity(value: unknown): number {
  return toNonNegativeNumber(value);
}

function cleanPublicAttribute(value: unknown): unknown {
  if (typeof value === "string") return cleanText(value, 160);
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    const values = value.slice(0, 20)
      .map(cleanPublicAttribute)
      .filter((item) => item !== undefined && !Array.isArray(item));
    return values.length > 0 ? values : undefined;
  }
  return undefined;
}

function buildPublicAttributes(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const source = value as Record<string, unknown>;
  const attributes: Record<string, unknown> = {};
  for (const key of PUBLIC_ATTRIBUTE_KEYS) {
    const cleaned = cleanPublicAttribute(source[key]);
    if (cleaned !== undefined) attributes[key] = cleaned;
  }
  return Object.keys(attributes).length > 0 ? attributes : undefined;
}

export function buildPublicCatalogStore(settings: Record<string, unknown>, slug: string, cardAvailable: boolean): PublicCatalogStore {
  const identity = settings.storeIdentity && typeof settings.storeIdentity === "object" && !Array.isArray(settings.storeIdentity)
    ? settings.storeIdentity as Record<string, unknown>
    : {};
  const name = cleanText(settings.storeName, 120)
    || cleanText(identity.name, 120)
    || "Minha Loja";
  const description = cleanText(settings.storeDescription, 600)
    || cleanText(settings.catalogDescription, 600)
    || cleanText(settings.storeBannerSubtitle, 600)
    || cleanText(identity.slogan, 600);
  const logoUrl = cleanUrl(settings.storeLogo)
    || cleanUrl(settings.storeLogoUrl)
    || cleanUrl(identity.logoUrl);
  const bannerUrl = cleanUrl(settings.storeBannerUrl)
    || cleanUrl(settings.bannerUrl)
    || cleanUrl(identity.heroImageUrl);
  const whatsappNumber = cleanText(settings.whatsappNumber, 40)
    || cleanText(settings.whatsapp, 40)
    || cleanText(settings.phone, 40);

  return {
    slug,
    name,
    ...(description ? { description } : {}),
    ...(logoUrl ? { logoUrl } : {}),
    ...(bannerUrl ? { bannerUrl } : {}),
    ...(cleanText(settings.storeBannerTitle, 160) ? { bannerTitle: cleanText(settings.storeBannerTitle, 160) } : {}),
    ...(cleanText(settings.storeBannerSubtitle, 300) ? { bannerSubtitle: cleanText(settings.storeBannerSubtitle, 300) } : {}),
    ...(cleanColor(settings.primaryColor) || cleanColor(identity.primaryColor)
      ? { primaryColor: cleanColor(settings.primaryColor) || cleanColor(identity.primaryColor) }
      : {}),
    ...(whatsappNumber ? { whatsappNumber } : {}),
    // LGPD §7: só o booleano — o VALOR da chave Pix não entra na carga inicial do catálogo (que
    // qualquer visitante recebe só de abrir a URL, com cache de CDN de 60s). O valor é servido sob
    // demanda pelo endpoint dedicado GET /api/public/catalog/:storeSlug/pix-key, chamado apenas quando
    // o comprador efetivamente chega na etapa de pagamento por Pix.
    pixAvailable: Boolean(cleanText(settings.pixKey, 140)),
    showPrice: settings.showPrice !== false,
    showStock: settings.showStock !== false,
    allowWhatsappOrders: settings.allowWhatsappOrders !== false,
    cardAvailable,
  };
}

/** Mesma normalização usada para os demais campos do catálogo — reaproveitada pelo endpoint dedicado
 * de chave Pix (ver comentário acima) em vez de embutida na carga pública inicial. */
export function resolvePublicCatalogPixKey(settings: Record<string, unknown>): string | undefined {
  return cleanText(settings.pixKey, 140);
}

export function toPublicCatalogProduct(
  id: string,
  data: Record<string, unknown>,
): PublicCatalogProduct | null {
  const productId = cleanText(id, 256);
  const name = cleanText(data.name, 240);
  if (!productId || !name) return null;

  const salePrice = toNonNegativeNumber(data.salePrice);
  const availableQuantity = toAvailableQuantity(data.stock);
  const promotionalPriceValue = toNonNegativeNumber(data.promotionalPrice);
  const promotionalPrice = promotionalPriceValue > 0 && promotionalPriceValue < salePrice
    ? promotionalPriceValue
    : undefined;
  const discountPercentValue = toNonNegativeNumber(data.discountPercent);
  const discountPercent = discountPercentValue > 0 && discountPercentValue < 100
    ? discountPercentValue
    : undefined;
  const imageUrl = cleanUrl(data.imageUrl)
    || cleanUrl(data.photoUrl)
    || cleanUrl(data.image)
    || cleanUrl(data.photo)
    || cleanUrl(data.thumbnailUrl);
  const publicAttributes = buildPublicAttributes(data.extras);

  return {
    id: productId,
    name,
    ...(cleanText(data.description, 2000) ? { description: cleanText(data.description, 2000) } : {}),
    ...(cleanText(data.category, 160) ? { category: cleanText(data.category, 160) } : {}),
    ...(cleanText(data.brand, 160) ? { brand: cleanText(data.brand, 160) } : {}),
    ...(cleanText(data.productType, 160) ? { productType: cleanText(data.productType, 160) } : {}),
    ...(cleanText(data.gender, 80) ? { gender: cleanText(data.gender, 80) } : {}),
    salePrice,
    ...(promotionalPrice !== undefined ? { promotionalPrice } : {}),
    ...(discountPercent !== undefined ? { discountPercent } : {}),
    ...(data.isOnSale === true ? { isOnSale: true } : {}),
    ...(data.isFeatured === true ? { isFeatured: true } : {}),
    ...(imageUrl ? { imageUrl } : {}),
    available: availableQuantity > 0,
    availableQuantity,
    ...(publicAttributes ? { publicAttributes } : {}),
  };
}

function toResolverProduct(product: PublicCatalogProduct, source: Record<string, unknown>): Product {
  const resolverImage = [source.imageUrl, source.photoUrl, source.image, source.photo, source.thumbnailUrl]
    .find((value) => typeof value === "string" && value.trim().length > 0);
  return {
    id: product.id,
    name: product.name,
    brand: product.brand || "",
    category: product.category || "",
    productType: product.productType,
    costPrice: 0,
    salePrice: product.salePrice,
    stock: product.availableQuantity,
    imageUrl: typeof resolverImage === "string" ? resolverImage : undefined,
    description: product.description,
    gender: product.gender,
    extras: product.publicAttributes,
    isFeatured: product.isFeatured,
    isOnSale: product.isOnSale,
    discountPercent: product.discountPercent,
    ...(product.promotionalPrice !== undefined ? { promotionalPrice: product.promotionalPrice } : {}),
  } as Product;
}

function mapCategory(category: {
  id: string;
  label: string;
  productCount: number;
  availableProductCount: number;
}): PublicCatalogCategorySummary {
  return {
    id: category.id,
    label: category.label,
    productCount: category.productCount,
    availableProductCount: category.availableProductCount,
  };
}

export function buildPublicCatalogPayload(input: BuildPublicCatalogPayloadInput): BuiltPublicCatalogPayload {
  const productPairs = input.products
    .map(({ id, data }) => ({ product: toPublicCatalogProduct(id, data), source: data }))
    .filter((pair): pair is { product: PublicCatalogProduct; source: Record<string, unknown> } => pair.product !== null);
  const baseProducts = productPairs.map((pair) => pair.product);
  const resolverProducts = productPairs.map((pair) => toResolverProduct(pair.product, pair.source));
  const experience = resolveCatalogExperience({
    businessType: cleanText(input.settings.businessType, 160) || "",
    businessTypes: Array.isArray(input.settings.businessTypes)
      ? input.settings.businessTypes.filter((value): value is string => typeof value === "string")
      : undefined,
    customCategoriesByNicho: input.settings.customCategoriesByNicho && typeof input.settings.customCategoriesByNicho === "object"
      ? input.settings.customCategoriesByNicho as Record<string, string[]>
      : undefined,
    products: resolverProducts,
    sales: input.sales as unknown as Sale[],
    lowStockThreshold: toNonNegativeNumber(input.settings.lowStockThreshold),
    now: input.now,
  });

  const nicheIdByProductId = new Map<string, string>();
  for (const niche of experience.niches) {
    for (const product of niche.products) nicheIdByProductId.set(product.id, niche.id);
  }
  const products = baseProducts.map((product) => ({
    ...product,
    ...(nicheIdByProductId.get(product.id)
      ? { nicheId: nicheIdByProductId.get(product.id) }
      : {}),
  }));
  const productById = new Map(products.map((product) => [product.id, product]));

  const mapHero = (hero: typeof experience.hero): PublicCatalogHero | undefined => {
    if (!hero) return undefined;
    const product = productById.get(hero.product.id);
    return product ? { product, reason: hero.reason } : undefined;
  };
  const mapCollection = (collection: typeof experience.quickCollections[number]): PublicCatalogCollection | undefined => {
    if (collection.id === "uncategorized") return undefined;
    return {
      id: collection.id,
      products: collection.products
        .map((product) => productById.get(product.id))
        .filter((product): product is PublicCatalogProduct => Boolean(product))
        .slice(0, 8),
    };
  };
  const mapCollections = (collections: typeof experience.quickCollections): PublicCatalogCollection[] => collections
    .map(mapCollection)
    .filter((collection): collection is PublicCatalogCollection => Boolean(collection));

  const presentation: PublicCatalogPresentation = {
    mode: experience.mode,
    activeNicheId: experience.activeNicheId,
    niches: experience.niches.map((niche) => ({
      id: niche.id,
      label: niche.label,
      isPrimary: niche.isPrimary,
      productCount: niche.productCount,
      categories: [...niche.categories],
      usedCategories: niche.usedCategories.map(mapCategory),
      availableProductCount: niche.availableProducts.length,
      outOfStockProductCount: niche.outOfStockProducts.length,
      lowStockProductCount: niche.lowStockProducts.length,
      hero: mapHero(niche.hero),
      quickCollections: mapCollections(niche.quickCollections),
    })),
    hero: mapHero(experience.hero),
    topCategories: experience.topCategories.map(mapCategory),
    quickCollections: mapCollections(experience.quickCollections),
    inventorySummary: {
      totalProducts: experience.inventorySummary.totalProducts,
      availableProducts: experience.inventorySummary.availableProducts,
      outOfStockProducts: experience.inventorySummary.outOfStockProducts,
      activeNiches: experience.inventorySummary.activeNiches,
    },
    emptyReason: experience.emptyReason,
  };

  return {
    store: buildPublicCatalogStore(input.settings, input.slug, input.cardAvailable ?? false),
    presentation,
    products,
  };
}

export function buildPublicCatalogProductPage(input: Omit<BuildPublicCatalogPayloadInput, "sales">): PublicCatalogProduct[] {
  return buildPublicCatalogPayload({ ...input, sales: [] }).products;
}
