import { buildProductSearchFields } from "@/lib/product-search";

export type ProductPayloadFormData = {
  name: string; brand: string; origin: string; category: string; costPrice: number; salePrice: number; stock: number; barcode: string; description: string; imageUrl: string; storagePath: string; extras: Record<string, string>; isFeatured: boolean; isOnSale: boolean; discountPercent: number; productType: string; gender: string;
};

export type ProductCreatePayloadInput = {
  formData: ProductPayloadFormData; productName: string; normalizedBrand: string; category: string; costPrice: number; salePrice: number; stock: number; imageUrl: string; storagePath: string; activeNicho: string;
};

export function sanitizeProductExtras(extras: Record<string, string>) {
  return Object.fromEntries(Object.entries(extras).filter(([, value]) => value !== undefined && value !== null).map(([key, value]) => [key, String(value).trim()]));
}

export function buildProductCreatePayload(input: ProductCreatePayloadInput) {
  const { formData, productName, normalizedBrand, category, costPrice, salePrice, stock, imageUrl, storagePath, activeNicho } = input;
  const payload = {
    ...formData,
    name: productName,
    brand: normalizedBrand,
    category,
    costPrice,
    salePrice,
    stock,
    imageUrl,
    storagePath,
    barcode: formData.barcode.trim(),
    description: formData.description.trim(),
    extras: sanitizeProductExtras(formData.extras),
    discountPercent: Number.isFinite(Number(formData.discountPercent)) ? Number(formData.discountPercent) : 0,
    productType: activeNicho,
    gender: formData.gender || "unisex",
    ...buildProductSearchFields({ name: productName, brand: normalizedBrand, category, barcode: formData.barcode, productType: activeNicho }),
  };
  return payload;
}
