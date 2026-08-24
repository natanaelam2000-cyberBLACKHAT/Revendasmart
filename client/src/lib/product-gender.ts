import type { Product } from "@/lib/mock-data";
import { normalizeProductSearchText } from "@/lib/product-search";

export const PRODUCT_GENDER_OPTIONS = ["masculino", "feminino", "unisex"] as const;

/**
 * Campo real de público/gênero do produto: `product.gender` (sempre gravado pelo cadastro,
 * "unisex" por padrão, para qualquer nicho). `extras.public_type` é um campo extra específico
 * do nicho Roupas e serve só como reforço quando o produto é legado e não tem `gender` gravado.
 */
export function resolveProductGender(product: Pick<Product, "gender" | "category" | "name"> & { extras?: Record<string, string> }): string {
  const explicitGender = normalizeProductSearchText(product.gender);
  if (explicitGender) return explicitGender;
  const publicType = normalizeProductSearchText(product.extras?.public_type);
  if (publicType) return publicType;
  const searchable = normalizeProductSearchText(`${product.name} ${product.category}`);
  if (searchable.includes("feminino") || searchable.includes("mulher")) return "feminino";
  if (searchable.includes("masculino") || searchable.includes("homem")) return "masculino";
  return "unisex";
}
