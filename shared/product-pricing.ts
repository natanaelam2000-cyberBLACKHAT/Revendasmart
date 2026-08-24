/**
 * Autoridade financeira de preço de produto — a MESMA regra usada pelo backend ao cobrar e pelo
 * frontend ao exibir, para que nenhuma tela mostre um preço diferente do que será efetivamente
 * cobrado. Este módulo é puro: sem React, sem Firebase, sem I/O.
 *
 * Decisão central: preço inválido NUNCA vira zero silenciosamente. Uma venda que cobrasse R$ 0,00
 * por um produto com `salePrice` corrompido é pior do que uma venda que falha com erro claro, então
 * a função lança InvalidProductPriceError e quem chama decide o que fazer.
 *
 * Datas de promoção (início/fim) NÃO fazem parte deste contrato — o cadastro não as grava hoje.
 */

export type PromotionSource = "none" | "promotionalPrice" | "discountPercent";

export interface ProductPricingInput {
  salePrice: unknown;
  promotionalPrice?: unknown;
  discountPercent?: unknown;
  /**
   * Sinalizador legado de UI. NÃO é autoridade financeira: o que define promoção é a existência de
   * promotionalPrice/discountPercent válidos. Fica no contrato só para compatibilidade de tipo com
   * os objetos de produto já existentes.
   */
  isOnSale?: unknown;
}

export interface EffectiveProductPrice {
  regularPrice: number;
  effectivePrice: number;
  regularPriceCents: number;
  effectivePriceCents: number;
  hasActivePromotion: boolean;
  promotionSource: PromotionSource;
}

export class InvalidProductPriceError extends Error {
  readonly code = "INVALID_PRODUCT_PRICE";

  constructor(message = "Preço de produto inválido para cobrança.") {
    super(message);
    this.name = "InvalidProductPriceError";
  }
}

/**
 * Aceita SOMENTE number finito. String numérica é recusada de propósito: um preço financeiro
 * canônico gravado como "280" indica dado corrompido no cadastro, e convertê-lo silenciosamente
 * esconderia o problema exatamente no ponto em que dinheiro é calculado.
 */
function toFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Preço efetivo em centavos.
 *
 * O arredondamento acontece UMA única vez, sobre o preço final, e a multiplicação é feita antes da
 * divisão para manter a conta em inteiros o máximo possível:
 *
 *   effectivePriceCents = round(regularPriceCents * (100 - discountPercent) / 100)
 *
 * Isso reproduz os quatro casos de referência do negócio:
 *   280,00 + 10%  -> round(28000 * 90 / 100)  = 25200 -> 252,00
 *   199,90 + 15%  -> round(19990 * 85 / 100)  = 16992 -> 169,92
 *   99,99  + 33%  -> round(9999  * 67 / 100)  =  6699 ->  66,99
 *
 * Arredondar o DESCONTO e subtrair depois (round(19990 * 15 / 100) = 2999) daria 169,91 no segundo
 * caso — meio centavo a menos para o cliente. Por isso a conta arredonda o resultado, não a parcela.
 */
function applyPercentDiscountInCents(regularPriceCents: number, discountPercent: number): number {
  return Math.round((regularPriceCents * (100 - discountPercent)) / 100);
}

export function resolveEffectiveProductPrice(product: ProductPricingInput): EffectiveProductPrice {
  const salePrice = toFiniteNumber(product.salePrice);
  if (salePrice === null || salePrice <= 0) {
    throw new InvalidProductPriceError();
  }

  const regularPriceCents = Math.round(salePrice * 100);
  const regularPrice = regularPriceCents / 100;
  const base: EffectiveProductPrice = {
    regularPrice,
    effectivePrice: regularPrice,
    regularPriceCents,
    effectivePriceCents: regularPriceCents,
    hasActivePromotion: false,
    promotionSource: "none",
  };

  // Prioridade 1: preço promocional explícito. Só vale se for menor que o preço normal — um
  // "promocional" maior ou igual não é promoção, é dado errado, e é ignorado em silêncio.
  const promotionalPrice = toFiniteNumber(product.promotionalPrice);
  if (promotionalPrice !== null && promotionalPrice > 0 && promotionalPrice < regularPrice) {
    const effectivePriceCents = Math.round(promotionalPrice * 100);
    return {
      ...base,
      effectivePrice: effectivePriceCents / 100,
      effectivePriceCents,
      hasActivePromotion: true,
      promotionSource: "promotionalPrice",
    };
  }

  // Prioridade 2: desconto percentual. 100% ou mais zeraria a venda — tratado como dado inválido.
  const discountPercent = toFiniteNumber(product.discountPercent);
  if (discountPercent !== null && discountPercent > 0 && discountPercent < 100) {
    const effectivePriceCents = applyPercentDiscountInCents(regularPriceCents, discountPercent);
    return {
      ...base,
      effectivePrice: effectivePriceCents / 100,
      effectivePriceCents,
      hasActivePromotion: true,
      promotionSource: "discountPercent",
    };
  }

  return base;
}
