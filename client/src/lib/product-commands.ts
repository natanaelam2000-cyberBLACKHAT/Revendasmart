import { apiRequest } from "@/lib/api-client";
import type { Product } from "@/lib/mock-data";

export type CreateProductCommandInput = {
  productId: string;
  product: Record<string, unknown>;
  idempotencyKey: string;
};

export type CreateProductCommandResponse = {
  productId: string;
  product: Product;
  idempotentReplay: boolean;
  /** PLAN-IMPL-06 §10 — sinal transacional real (usage.productsCount === 0 antes desta criação), nunca
   * inferido de uma lista em cache local. Ausente/`false` numa réplica idempotente. */
  isFirstProduct?: boolean;
};

export async function createProduct(input: CreateProductCommandInput): Promise<CreateProductCommandResponse> {
  return await apiRequest<CreateProductCommandResponse>("/api/products", {
    method: "POST",
    auth: true,
    body: input,
  });
}

export async function deleteProduct(productId: string): Promise<{ productId: string; deleted: true }> {
  return await apiRequest<{ productId: string; deleted: true }>(`/api/products/${encodeURIComponent(productId)}`, {
    method: "DELETE",
    auth: true,
  });
}
