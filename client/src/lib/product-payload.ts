import { buildProductSearchFields } from "@/lib/product-search";

export type ProductPayloadFormData = {
  name: string; brand: string; origin: string; category: string; costPrice: number; salePrice: number; stock: number; barcode: string; description: string; imageUrl: string; storagePath: string; extras: Record<string, string>; isFeatured: boolean; isOnSale: boolean; discountPercent: number; productType: string; gender: string;
};

export type ProductCreatePayloadInput = {
  formData: ProductPayloadFormData; productName: string; normalizedBrand: string; category: string; costPrice: number; salePrice: number; stock: number; imageUrl: string; storagePath: string; activeNicho: string;
  /** PRODUCT-THUMBNAIL-01 — opcionais: quando ausentes, as chaves NÃO existem no payload de saída (nunca
   * gravadas como `undefined`/string vazia) — mesmo contrato que firestore.rules já valida em
   * isValidProductImageFields (thumbnailStoragePath=='' equivale a ausente). Sempre fornecidos JUNTOS ou
   * nenhum dos dois (ver assert abaixo) — o par nasce sempre da MESMA resposta de upload em
   * add-product.tsx, nunca de fontes independentes. */
  thumbnailUrl?: string; thumbnailStoragePath?: string;
};

export function sanitizeProductExtras(extras: Record<string, string>) {
  return Object.fromEntries(Object.entries(extras).filter(([, value]) => value !== undefined && value !== null).map(([key, value]) => [key, String(value).trim()]));
}

export function buildProductCreatePayload(input: ProductCreatePayloadInput) {
  const { formData, productName, normalizedBrand, category, costPrice, salePrice, stock, imageUrl, storagePath, activeNicho, thumbnailUrl, thumbnailStoragePath } = input;
  if ((thumbnailUrl == null) !== (thumbnailStoragePath == null)) {
    throw new Error("buildProductCreatePayload: thumbnailUrl e thumbnailStoragePath devem ser fornecidos juntos ou nenhum dos dois.");
  }
  // O builder é a ÚNICA autoridade do shape de thumbnail: mesmo que `formData` (um superset usado pela
  // tela de edição) carregue thumbnailUrl/thumbnailStoragePath de uma carga anterior, esses valores nunca
  // vazam para o payload por baixo do spread — só os argumentos explícitos acima decidem o resultado.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- extraídos só para nunca vazarem do spread abaixo.
  const { thumbnailUrl: _formThumbnailUrl, thumbnailStoragePath: _formThumbnailStoragePath, ...restFormData } = formData as ProductPayloadFormData & { thumbnailUrl?: unknown; thumbnailStoragePath?: unknown };
  const payload = {
    ...restFormData,
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
    ...(thumbnailUrl != null && thumbnailStoragePath != null ? { thumbnailUrl, thumbnailStoragePath } : {}),
    ...buildProductSearchFields({ name: productName, brand: normalizedBrand, category, barcode: formData.barcode, productType: activeNicho }),
  };
  return payload;
}
