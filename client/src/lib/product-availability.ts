/**
 * Interpretação ÚNICA de disponibilidade de produto e da ordem "disponível antes de esgotado".
 *
 * Existia a mesma noção escrita em três lugares (a vitrine do catálogo, as coleções curadas e,
 * por omissão, a listagem de Produtos — que simplesmente não ordenava por estoque). Isso deixou
 * passar o bug real: em Produtos, um item com 0 unidades aparecia acima de um com 7 só porque vinha
 * antes no alfabeto. Módulo puro, sem React e sem I/O.
 */

/** Fonte real do estoque, tolerante a documento legado onde `stock` veio ausente, string ou nulo. */
export function resolveProductStock(product: { stock?: unknown } | null | undefined): number {
  const parsed = Number(product?.stock);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Esgotado é qualquer coisa <= 0 — inclui o caso defensivo de estoque negativo. */
export function isProductAvailable(product: { stock?: unknown } | null | undefined): boolean {
  return resolveProductStock(product) > 0;
}

/**
 * Comparador de disponibilidade: disponível primeiro, esgotado por último. Devolve 0 quando ambos
 * estão do mesmo lado, para que o chamador aplique o próprio critério secundário (nome, foto, etc.)
 * sem que esta função imponha uma ordenação além da que lhe cabe.
 */
export function compareProductAvailabilityFirst(
  left: { stock?: unknown } | null | undefined,
  right: { stock?: unknown } | null | undefined,
): number {
  const leftAvailable = isProductAvailable(left);
  const rightAvailable = isProductAvailable(right);
  if (leftAvailable === rightAvailable) return 0;
  return leftAvailable ? -1 : 1;
}

/** Ordem padrão de navegação: disponíveis primeiro e, dentro de cada grupo, ordem alfabética. */
export function compareProductsForBrowsing(
  left: { stock?: unknown; name?: unknown },
  right: { stock?: unknown; name?: unknown },
): number {
  return compareProductAvailabilityFirst(left, right)
    || String(left?.name || "").localeCompare(String(right?.name || ""));
}

export interface GenerationController {
  current(): number;
  invalidate(): number;
  isCurrent(generation: number): boolean;
}

export function createGenerationController(): GenerationController {
  let generation = 0;
  return {
    current: () => generation,
    invalidate: () => ++generation,
    isCurrent: (candidate) => candidate === generation,
  };
}

export interface InFlightLock {
  tryAcquire(): boolean;
  release(): void;
  isLocked(): boolean;
}

export function createInFlightLock(): InFlightLock {
  let locked = false;
  return {
    tryAcquire: () => {
      if (locked) return false;
      locked = true;
      return true;
    },
    release: () => { locked = false; },
    isLocked: () => locked,
  };
}

export type ProductPageStatus = "loaded" | "finished" | "error" | "stale";

export function canCompleteAutoLoad(status: ProductPageStatus): boolean {
  return status === "finished";
}
