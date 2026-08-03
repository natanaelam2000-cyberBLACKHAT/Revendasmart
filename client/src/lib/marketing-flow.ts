import type { Product } from "@/lib/mock-data";
import { MARKETING_TEMPLATES, type MarketingTemplateId } from "@/lib/marketing-ad";

export type MarketingWorkspaceView = "hub" | "editor" | "history";
export type MarketingLaunchSource = "hub" | "catalog" | "legacy-social" | "history";

export interface MarketingLaunchRequest {
  productId: string;
  invalidProductId: boolean;
  source: MarketingLaunchSource;
  templateId?: MarketingTemplateId;
}

export const MARKETING_MANUAL_CAPABILITIES = [
  "product",
  "kit",
  "template",
  "theme",
  "price",
  "note",
  "cta",
  "brand",
  "volume",
  "stock",
  "payment",
  "preview",
  "copy",
  "download",
  "share",
  "history",
] as const;

function normalizeMarketingClassification(value: unknown): string {
  return String(value || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLocaleLowerCase("pt-BR");
}

export function isMarketingKitProduct(product: Pick<Product, "category" | "productType">): boolean {
  return [product.category, product.productType]
    .map(normalizeMarketingClassification)
    .some((value) => value === "kit" || value === "kits");
}

export function readMarketingLaunchRequest(search: string): MarketingLaunchRequest {
  const params = new URLSearchParams(search);
  const rawProductId = String(params.get("productId") || "").trim();
  const invalidProductId = rawProductId.length > 120
    || rawProductId.includes("/")
    || rawProductId.includes("\\")
    || Array.from(rawProductId).some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127;
    });
  const rawSource = params.get("source");
  const source: MarketingLaunchSource =
    rawSource === "catalog" || rawSource === "legacy-social" || rawSource === "history"
      ? rawSource
      : "hub";
  const rawTemplate = params.get("template");
  const templateId = rawTemplate && Object.prototype.hasOwnProperty.call(MARKETING_TEMPLATES, rawTemplate)
    ? rawTemplate as MarketingTemplateId
    : undefined;

  return {
    productId: invalidProductId ? "" : rawProductId,
    invalidProductId,
    source,
    templateId,
  };
}
