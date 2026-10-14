import test from "node:test";
import assert from "node:assert/strict";

import {
  buildExternalReference,
  detectEnvironment,
  parseExternalReference,
  resolveChargeStatus,
} from "../../shared/charges";
import {
  detectImageFormatFromMagicBytes,
  readImagePixelDimensions,
  validateImageUploadBytes,
} from "../../shared/image-validation";
import {
  isMarketingProAtmosphereId,
  isMarketingProLightingId,
  isMarketingProSurfaceId,
  resolveMarketingProCategory,
} from "../../shared/marketing-pro-contract";
import {
  buildPublicCatalogStore,
  toPublicCatalogProduct,
} from "../../server/public-catalog";

test("charges contract preserves provider mapping and reference round trips", () => {
  assert.equal(resolveChargeStatus("approved"), "paid");
  assert.equal(resolveChargeStatus("unknown-provider-status"), "pending");
  assert.equal(detectEnvironment("TEST-abc"), "sandbox");
  assert.equal(detectEnvironment("APP_USR-abc"), "production");

  const saleRef = buildExternalReference("uid123", "charge123", { kind: "sale", id: "sale9" });
  assert.deepEqual(parseExternalReference(saleRef), {
    uid: "uid123",
    chargeId: "charge123",
    saleId: "sale9",
    orderId: null,
  });

  const orderRef = buildExternalReference("uid123", "charge123", { kind: "order", id: "order9" });
  assert.deepEqual(parseExternalReference(orderRef), {
    uid: "uid123",
    chargeId: "charge123",
    saleId: null,
    orderId: "order9",
  });
  assert.equal(parseExternalReference("malformed"), null);
});

test("image contract rejects spoofed content and reads real PNG headers", () => {
  const png = new Uint8Array(24);
  png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  png.set([0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52], 8);
  png.set([0x00, 0x00, 0x04, 0x00, 0x00, 0x00, 0x03, 0x00], 16);

  assert.equal(detectImageFormatFromMagicBytes(png), "image/png");
  assert.deepEqual(readImagePixelDimensions(png, "image/png"), { width: 1024, height: 768 });
  assert.equal(detectImageFormatFromMagicBytes(new TextEncoder().encode("not-a-png")), null);

  const valid = validateImageUploadBytes(png, "image/png");
  assert.equal(valid.accepted, true);
  const spoofed = validateImageUploadBytes(png, "image/jpeg");
  assert.deepEqual(spoofed, { accepted: false, reason: "mime-mismatch" });
});

test("marketing provider contract accepts only closed visual identifiers", () => {
  assert.equal(isMarketingProLightingId("studio"), true);
  assert.equal(isMarketingProLightingId("product description"), false);
  assert.equal(isMarketingProSurfaceId("reflective"), true);
  assert.equal(isMarketingProAtmosphereId("energetic"), true);
  assert.equal(isMarketingProAtmosphereId("free text"), false);
  assert.equal(resolveMarketingProCategory("Cosméticos"), "beauty");
  assert.equal(resolveMarketingProCategory("categoria desconhecida"), "general");
});

test("public catalog contract redacts Pix value and sanitizes products", () => {
  const store = buildPublicCatalogStore({
    storeName: "  Loja  Teste  ",
    pixKey: "secret-pix-value",
    storeLogo: "javascript:alert(1)",
    showPrice: false,
  }, "loja-teste", false);
  assert.equal(store.name, "Loja Teste");
  assert.equal(store.pixAvailable, true);
  assert.equal("pixKey" in store, false);
  assert.equal("storeLogo" in store, false);
  assert.equal(store.showPrice, false);

  const product = toPublicCatalogProduct("p1", {
    name: " Produto ",
    salePrice: "39.90",
    stock: -2,
    imageUrl: "data:text/plain,secret",
    promotionalPrice: 49,
    extras: { color: " azul ", privateNote: "do not expose" },
  });
  assert.deepEqual(product, {
    id: "p1",
    name: "Produto",
    salePrice: 39.9,
    available: false,
    availableQuantity: 0,
    publicAttributes: { color: "azul" },
  });
});
