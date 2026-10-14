import test from "node:test";
import assert from "node:assert/strict";

import {
  InvalidProductPriceError,
  resolveEffectiveProductPrice,
} from "../../shared/product-pricing";

test("explicit promotional price wins over discount and ignores the UI sale flag", () => {
  const result = resolveEffectiveProductPrice({
    salePrice: 280,
    promotionalPrice: 240,
    discountPercent: 10,
    isOnSale: false,
  });

  assert.deepEqual(result, {
    regularPrice: 280,
    effectivePrice: 240,
    regularPriceCents: 28_000,
    effectivePriceCents: 24_000,
    hasActivePromotion: true,
    promotionSource: "promotionalPrice",
  });
});

test("percentage promotion rounds the final cent amount, not the discount", () => {
  const result = resolveEffectiveProductPrice({ salePrice: 199.9, discountPercent: 15 });

  assert.equal(result.regularPriceCents, 19_990);
  assert.equal(result.effectivePriceCents, 16_992);
  assert.equal(result.effectivePrice, 169.92);
  assert.equal(result.promotionSource, "discountPercent");
});

test("invalid or non-beneficial promotion data does not create a free or overpriced sale", () => {
  const result = resolveEffectiveProductPrice({
    salePrice: 99.99,
    promotionalPrice: 120,
    discountPercent: 100,
  });

  assert.equal(result.effectivePriceCents, 9_999);
  assert.equal(result.hasActivePromotion, false);
  assert.equal(result.promotionSource, "none");
});

test("invalid sale prices fail closed instead of silently becoming zero", () => {
  for (const salePrice of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, "99.90"]) {
    assert.throws(
      () => resolveEffectiveProductPrice({ salePrice }),
      (error: unknown) => error instanceof InvalidProductPriceError,
    );
  }
});
