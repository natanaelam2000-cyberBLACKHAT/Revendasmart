/**
 * Cliente HTTP para os endpoints públicos de criação/atualização de pedido do catálogo (ver
 * `server/routes.ts` — `POST/PATCH /api/public/catalog/:storeSlug/orders*`). Sem autenticação —
 * mesmo padrão de `fetch` cru já usado por `fetchAuthoritativeCatalogSnapshot` nesta página, já que o
 * visitante do catálogo não tem sessão Firebase.
 */
import { getApiUrl } from "./api-config";
import type { Order, OrderPaymentMethod } from "./orders";

export function generateClientOrderId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `co_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export interface CreatePublicOrderInput {
  clientOrderId: string;
  paymentMethod: OrderPaymentMethod;
  items: { productId: string; quantity: number }[];
  clientName?: string;
  clientPhone?: string;
}

export interface CreatePublicOrderResult {
  ok: boolean;
  order?: Order;
  errorCode?: string;
}

export async function createPublicCatalogOrder(storeSlug: string, input: CreatePublicOrderInput): Promise<CreatePublicOrderResult> {
  try {
    const response = await fetch(getApiUrl(`/api/public/catalog/${encodeURIComponent(storeSlug)}/orders`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const data = await response.json().catch(() => null) as { order?: Order; error?: string } | null;
    if (!response.ok || !data?.order) {
      return { ok: false, errorCode: data?.error };
    }
    return { ok: true, order: data.order };
  } catch {
    return { ok: false };
  }
}

export interface CreateOrderMercadoPagoPaymentResult {
  ok: boolean;
  paymentUrl?: string;
  errorCode?: string;
  userMessage?: string;
}

/** RELEASE-CHECKOUT-03 §3 — cria (ou devolve, se já existir) a cobrança Mercado Pago do pedido. */
export async function createPublicCatalogOrderMercadoPagoPayment(storeSlug: string, orderId: string): Promise<CreateOrderMercadoPagoPaymentResult> {
  try {
    const response = await fetch(getApiUrl(`/api/public/catalog/${encodeURIComponent(storeSlug)}/orders/${encodeURIComponent(orderId)}/payment/mercadopago`), {
      method: "POST",
    });
    const data = await response.json().catch(() => null) as { paymentUrl?: string; error?: string; message?: string } | null;
    if (!response.ok || !data?.paymentUrl) {
      return { ok: false, errorCode: data?.error, userMessage: data?.message };
    }
    return { ok: true, paymentUrl: data.paymentUrl };
  } catch {
    return { ok: false };
  }
}

export interface PublicCatalogOrderStatus {
  orderStatus: string;
  paymentStatus: string | null;
  total: number;
}

/** §7 — status server-side do pedido, para a tela pós-retorno do Mercado Pago nunca confiar no redirect. */
export async function getPublicCatalogOrderStatus(storeSlug: string, orderId: string): Promise<PublicCatalogOrderStatus | null> {
  try {
    const response = await fetch(getApiUrl(`/api/public/catalog/${encodeURIComponent(storeSlug)}/orders/${encodeURIComponent(orderId)}/status`));
    if (!response.ok) return null;
    return await response.json() as PublicCatalogOrderStatus;
  } catch {
    return null;
  }
}

export interface MarkOrderPaidByCustomerResult {
  ok: boolean;
  order?: Order;
}

export async function markPublicCatalogOrderPaidByCustomer(storeSlug: string, orderId: string, clientOrderId: string): Promise<MarkOrderPaidByCustomerResult> {
  try {
    const response = await fetch(getApiUrl(`/api/public/catalog/${encodeURIComponent(storeSlug)}/orders/${encodeURIComponent(orderId)}/mark-paid-by-customer`), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientOrderId }),
    });
    const data = await response.json().catch(() => null) as { order?: Order } | null;
    if (!response.ok || !data?.order) return { ok: false };
    return { ok: true, order: data.order };
  } catch {
    return { ok: false };
  }
}
