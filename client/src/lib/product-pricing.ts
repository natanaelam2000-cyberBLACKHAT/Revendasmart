/**
 * Ponte do frontend para a regra de preço compartilhada (`shared/product-pricing.ts`). A conta em si
 * NÃO mora aqui — este arquivo só adapta a regra ao contexto de exibição e concentra a formatação.
 *
 * Por que existe uma variante que não lança: a regra compartilhada é a autoridade FINANCEIRA e
 * recusa preço inválido com exceção, o que é o comportamento certo na hora de cobrar. Mas as telas
 * (catálogo, carrinho, novo pedido) apenas EXIBEM preço, e um único produto com `salePrice` ausente
 * ou zerado não pode derrubar a página inteira — antes desta mudança esses casos apareciam como
 * R$ 0,00, e esse comportamento é preservado. Quem cobra (backend) usa a versão estrita.
 */

import {
  InvalidProductPriceError,
  resolveEffectiveProductPrice as resolveEffectiveProductPriceOrThrow,
  type EffectiveProductPrice,
  type ProductPricingInput,
} from "@shared/product-pricing";

export {
  InvalidProductPriceError,
  /** Versão estrita (lança em preço inválido). Use quando o valor for cobrado, não só exibido. */
  resolveEffectiveProductPriceOrThrow,
};
export type { EffectiveProductPrice, ProductPricingInput, PromotionSource } from "@shared/product-pricing";

/**
 * Versão de exibição: mesma regra, mas um produto sem preço válido cai em zero em vez de quebrar a
 * tela. Não reimplementa nada — delega e trata o erro.
 */
export function resolveEffectiveProductPrice(product: ProductPricingInput): EffectiveProductPrice {
  try {
    return resolveEffectiveProductPriceOrThrow(product);
  } catch (error) {
    if (error instanceof InvalidProductPriceError) {
      return {
        regularPrice: 0,
        effectivePrice: 0,
        regularPriceCents: 0,
        effectivePriceCents: 0,
        hasActivePromotion: false,
        promotionSource: "none",
      };
    }
    throw error;
  }
}

export function formatCurrency(value: number): string {
  return Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/** Preço promocional real: só existe quando os dados de promoção são válidos (nunca inventado). */
export function getPromotionalPrice(product: ProductPricingInput): number | null {
  const { effectivePrice, hasActivePromotion } = resolveEffectiveProductPrice(product);
  return hasActivePromotion ? effectivePrice : null;
}
