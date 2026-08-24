/** PRO-11A — projeção pura do schema real de Product para o contrato compartilhado ProductTruth. */
import type { Product } from "@/lib/mock-data";
import type { ProductTruth } from "@shared/marketing-pro-creative-intelligence";
import { InvalidProductPriceError, resolveEffectiveProductPrice } from "@shared/product-pricing";

export type ProductRecordForTruth = Readonly<Product> & { readonly promotionalPrice?: unknown };

const PROMOTED_EXTRA_KEYS = new Set([
  "subcategory",
  "volume_ml",
  "weight",
  "size",
  "dimensions",
  "variation",
  "variant",
  "model",
  "color",
  "availability",
]);

export class ProductTruthAdapterError extends Error {
  readonly code = "INVALID_PRODUCT_TRUTH_SOURCE";

  constructor(message: string) {
    super(message);
    this.name = "ProductTruthAdapterError";
  }
}

function optionalText(value: unknown): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const normalized = String(value).replace(/\s+/g, " ").trim();
  return normalized || undefined;
}

function firstExtra(extras: Readonly<Record<string, unknown>>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = optionalText(extras[key]);
    if (value) return value;
  }
  return undefined;
}

function buildSpecifications(product: ProductRecordForTruth, extras: Readonly<Record<string, unknown>>): Readonly<Record<string, string>> | undefined {
  const specifications: Record<string, string> = {};
  for (const [key, rawValue] of Object.entries(extras)) {
    if (PROMOTED_EXTRA_KEYS.has(key)) continue;
    const value = optionalText(rawValue);
    if (value) specifications[key] = value;
  }
  const niche = optionalText(product.productType);
  const origin = optionalText(product.origin);
  const gender = optionalText(product.gender);
  if (niche) specifications.niche = niche;
  if (origin) specifications.origin = origin;
  if (gender) specifications.gender = gender;
  return Object.keys(specifications).length > 0 ? specifications : undefined;
}

/**
 * Não busca nem escreve nada. Preço promocional reutiliza a autoridade financeira compartilhada;
 * extras promovidos para campos próprios são removidos de specifications para não duplicar dados.
 */
export function buildProductTruthFromProduct(product: ProductRecordForTruth): ProductTruth {
  const productId = optionalText(product.id);
  const name = optionalText(product.name);
  if (!productId || !name) throw new ProductTruthAdapterError("Produto precisa de id e nome válidos.");

  let pricing;
  try {
    pricing = resolveEffectiveProductPrice(product);
  } catch (error) {
    if (error instanceof InvalidProductPriceError) throw new ProductTruthAdapterError("Produto possui preço inválido.");
    throw error;
  }

  const extras = product.extras && typeof product.extras === "object" && !Array.isArray(product.extras)
    ? product.extras as Readonly<Record<string, unknown>>
    : {};
  const imageId = optionalText(product.imageId);
  const imageUrl = optionalText(product.imageUrl);
  const storagePath = optionalText(product.storagePath);
  const imageAsset = imageId || imageUrl || storagePath
    ? { ...(imageId ? { imageId } : {}), ...(imageUrl ? { imageUrl } : {}), ...(storagePath ? { storagePath } : {}) }
    : undefined;
  const explicitAvailability = firstExtra(extras, ["availability"]);
  const availability = explicitAvailability || (Number.isFinite(product.stock) && product.stock > 0 ? "in_stock" : "out_of_stock");
  const brand = optionalText(product.brand);
  const category = optionalText(product.category);
  const subcategory = firstExtra(extras, ["subcategory"]);
  const volume = firstExtra(extras, ["volume_ml", "weight"]);
  const size = firstExtra(extras, ["size", "dimensions"]);
  const variant = firstExtra(extras, ["variation", "variant", "model"]);
  const color = firstExtra(extras, ["color"]);
  const description = optionalText(product.description);
  const specifications = buildSpecifications(product, extras);

  return {
    productId,
    name,
    ...(brand ? { brand } : {}),
    ...(category ? { category } : {}),
    ...(subcategory ? { subcategory } : {}),
    salePrice: pricing.regularPrice,
    ...(pricing.hasActivePromotion ? { promotionalPrice: pricing.effectivePrice } : {}),
    ...(volume ? { volume } : {}),
    ...(size ? { size } : {}),
    ...(variant ? { variant } : {}),
    ...(color ? { color } : {}),
    availability,
    ...(description ? { description } : {}),
    ...(specifications ? { specifications } : {}),
    ...(imageAsset ? { imageAsset } : {}),
    ...(product.approvedCutout ? { approvedCutout: product.approvedCutout } : {}),
  };
}
