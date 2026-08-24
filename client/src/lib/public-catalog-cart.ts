/**
 * RELEASE-32: revalidação do carrinho do catálogo público contra o estado ATUAL (authoritative) do
 * mesmo slug/loja, imediatamente antes de abrir o WhatsApp — o carrinho em memória do visitante é um
 * snapshot que pode ter ficado stale (produto removido, estoque mudou, preço/promoção mudou, pedidos
 * por WhatsApp foram desativados) enquanto ele navegava.
 *
 * Dividido em duas camadas testáveis sem browser:
 *   - `detectCartStaleness`: pura, compara o carrinho contra um snapshot já carregado — cobre os
 *     casos A-G da tarefa com objetos simples, sem I/O.
 *   - `fetchAuthoritativeCatalogSnapshot`: busca esse snapshot via os MESMOS endpoints públicos que a
 *     página já usa (`/api/public/catalog/:slug` + `/products`), seguindo paginação só o necessário
 *     para cobrir os produtos do carrinho — nenhum endpoint novo, nenhuma rota criada.
 */
import { resolveEffectiveProductPrice } from "./product-pricing";
import type { PublicCatalogPagination, PublicCatalogProduct, PublicCatalogStore } from "@shared/public-catalog";

export interface CartRevalidationItem {
  readonly productId: string;
  readonly name: string;
  readonly quantity: number;
  /** Preço efetivo (já considerando promoção) que o carrinho tinha no momento da revalidação. */
  readonly effectivePrice: number;
}

export type CartChangeReason =
  | { readonly kind: "removed"; readonly productId: string; readonly name: string }
  | { readonly kind: "out_of_stock"; readonly productId: string; readonly name: string }
  | { readonly kind: "insufficient_stock"; readonly productId: string; readonly name: string; readonly available: number; readonly requested: number }
  | { readonly kind: "price_changed"; readonly productId: string; readonly name: string; readonly previousPrice: number; readonly currentPrice: number }
  | { readonly kind: "orders_disabled" };

export interface CartRevalidationResult {
  readonly stale: boolean;
  readonly reasons: readonly CartChangeReason[];
  /** Quantidades já ajustadas ao estoque atual — itens removidos/esgotados não aparecem aqui. */
  readonly updatedQuantities: ReadonlyMap<string, number>;
}

const PRICE_EPSILON = 0.005; // meio centavo — evita falso positivo por arredondamento de ponto flutuante

/**
 * Núcleo puro: nunca faz I/O, nunca decide o que fazer com o resultado — só compara. §5 casos A-G.
 */
export function detectCartStaleness(
  items: readonly CartRevalidationItem[],
  currentStore: Pick<PublicCatalogStore, "allowWhatsappOrders">,
  currentProductsById: ReadonlyMap<string, PublicCatalogProduct>,
): CartRevalidationResult {
  const reasons: CartChangeReason[] = [];
  const updatedQuantities = new Map<string, number>();

  // G: pedidos por WhatsApp foram desativados — nenhum item específico causou isso, então não impede
  // reportar as outras mudanças também (o vendedor pode ter mudado várias coisas ao mesmo tempo).
  if (currentStore.allowWhatsappOrders === false) {
    reasons.push({ kind: "orders_disabled" });
  }

  for (const item of items) {
    const current = currentProductsById.get(item.productId);
    // A: produto deletado/despublicado desde que entrou no carrinho.
    if (!current) {
      reasons.push({ kind: "removed", productId: item.productId, name: item.name });
      continue;
    }
    const availableQuantity = Math.max(0, Math.floor(current.availableQuantity));
    // B: ficou sem estoque.
    if (availableQuantity <= 0 || current.available === false) {
      reasons.push({ kind: "out_of_stock", productId: item.productId, name: current.name });
      continue;
    }
    // C: estoque caiu abaixo da quantidade pedida — clampa em vez de remover.
    const clampedQuantity = Math.min(item.quantity, availableQuantity);
    if (clampedQuantity < item.quantity) {
      reasons.push({
        kind: "insufficient_stock",
        productId: item.productId,
        name: current.name,
        available: availableQuantity,
        requested: item.quantity,
      });
    }
    // D/E/F: preço mudou (inclui início ou fim de promoção — ambos mudam o effectivePrice).
    const currentPrice = resolveEffectiveProductPrice(current).effectivePrice;
    if (Math.abs(currentPrice - item.effectivePrice) > PRICE_EPSILON) {
      reasons.push({
        kind: "price_changed",
        productId: item.productId,
        name: current.name,
        previousPrice: item.effectivePrice,
        currentPrice,
      });
    }
    updatedQuantities.set(item.productId, clampedQuantity);
  }

  return { stale: reasons.length > 0, reasons, updatedQuantities };
}

export interface CatalogSnapshotFetcher {
  fetchStoreAndFirstPage(slug: string): Promise<{
    store: PublicCatalogStore;
    products: PublicCatalogProduct[];
    pagination: PublicCatalogPagination;
  } | null>;
  fetchProductsPage(slug: string, cursor: string): Promise<{
    products: PublicCatalogProduct[];
    pagination: PublicCatalogPagination;
  } | null>;
}

function allNeededIdsFound(neededIds: ReadonlySet<string>, productsById: ReadonlyMap<string, PublicCatalogProduct>): boolean {
  return Array.from(neededIds).every((id) => productsById.has(id));
}

/**
 * Busca o snapshot authoritative reusando os mesmos dois endpoints públicos já existentes — segue
 * paginação só até achar todos os produtos do carrinho (ou esgotar as páginas/o teto de segurança),
 * nunca busca o catálogo inteiro à toa para um carrinho pequeno.
 */
export async function fetchAuthoritativeCatalogSnapshot(
  slug: string,
  neededProductIds: ReadonlySet<string>,
  fetcher: CatalogSnapshotFetcher,
  maxPages = 15,
): Promise<{ store: PublicCatalogStore; productsById: Map<string, PublicCatalogProduct> } | null> {
  const first = await fetcher.fetchStoreAndFirstPage(slug);
  if (!first) return null;

  const productsById = new Map(first.products.map((product) => [product.id, product]));
  let cursor = first.pagination.nextCursor;
  let hasMore = first.pagination.hasMore;
  let pagesFetched = 1;

  while (hasMore && cursor && pagesFetched < maxPages && !allNeededIdsFound(neededProductIds, productsById)) {
    const page = await fetcher.fetchProductsPage(slug, cursor);
    if (!page) break;
    for (const product of page.products) productsById.set(product.id, product);
    cursor = page.pagination.nextCursor;
    hasMore = page.pagination.hasMore;
    pagesFetched += 1;
  }

  return { store: first.store, productsById };
}
