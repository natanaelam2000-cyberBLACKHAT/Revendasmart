import assert from "node:assert/strict";
import fs from "node:fs";
import { canUseFeature } from "../shared/monetization";
import {
  CREATIVE_DECISION_PRIORITY,
  buildCreativeBrief,
  createCampaignCreativeIntent,
  resolveSellerCreativePreferences,
  validateCampaignCreativeIntent,
  validateCreativeConceptSet,
  validateProductCreativeContext,
  validateProductVisualUnderstanding,
  validateSellerCreativeProfile,
  type CreativeConcept,
  type ProductCreativeContext,
  type SellerCreativeProfile,
} from "../shared/marketing-pro-creative-intelligence";
import type { ProductCreativeContext as ComposerProductCreativeContext } from "../shared/marketing-pro-creative-v2";

function run(): void {
  assert.deepEqual(CREATIVE_DECISION_PRIORITY, [
    "product_truth",
    "commercial_coherence",
    "campaign_objective",
    "seller_preferences",
  ]);

  const product: ProductCreativeContext = {
    version: 1,
    productId: "product-red-1",
    truth: {
      productId: "product-red-1",
      name: "Controle sem fio",
      brand: "Marca cadastrada",
      category: "Eletrônicos",
      salePrice: 199.9,
      color: "red",
      volume: "1 unidade",
      imageAsset: { imageId: "image-original-1", storagePath: "users/u/products/product-red-1/original.webp" },
    },
    visualUnderstanding: {
      version: 1,
      sourceImageAssetId: "image-original-1",
      observed: {
        dominantColors: ["red"],
        perceivedBrightness: "light",
      },
      inferred: {
        recommendedBackgroundContrast: "high",
        recommendedCreativeFamilies: ["modern"],
        avoidCreativeFamilies: ["luxury"],
        recommendedEnvironmentHints: ["clean technology environment"],
        visualMoodCandidates: ["fast charging"],
        commercialToneCandidates: ["premium performance"],
      },
      confidence: 0.82,
    },
    category: "Eletrônicos",
    dominantColorFamily: "red",
  };

  const sellerProfile: SellerCreativeProfile = {
    version: 1,
    globalPreferences: {
      visualStyles: ["luxury"],
      productEmphasis: "subtle",
      typographyPreference: "expressive",
      compositionPreference: "dynamic",
      colorTendencies: ["red"],
      preferredCreativeFamilies: ["luxury"],
    },
    categoryPreferences: {
      "Eletrônicos": {
        preferredCreativeFamilies: ["modern"],
        informationDensity: "low",
        typographyPreference: "clean",
      },
    },
    confidence: 0.74,
    sampleCount: 12,
    updatedAt: "2026-08-20T12:00:00.000Z",
  };

  assert.equal(validateProductCreativeContext(product).valid, true);
  assert.equal(validateProductVisualUnderstanding(product.visualUnderstanding).valid, true);
  assert.equal(validateSellerCreativeProfile(sellerProfile).valid, true);
  const promoIntent = createCampaignCreativeIntent("promo");
  assert.equal(validateCampaignCreativeIntent(promoIntent).valid, true);

  const before = JSON.stringify({ product, sellerProfile });
  let externalProviderCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    externalProviderCalls += 1;
    throw new Error("external calls are forbidden in foundation tests");
  }) as typeof fetch;
  const brief = buildCreativeBrief({ product, campaignIntent: promoIntent, sellerProfile });
  globalThis.fetch = originalFetch;

  // A. Product Truth vence preferência que tentava reduzir o produto.
  assert.equal(brief.productPositioning, "protected_hero");
  assert.equal(brief.productProminence, "hero");
  assert.ok(brief.decisionTrace.some((entry) => entry.source === "product_truth" && entry.rule === "protect_real_product_identity"));

  // B/H/I. Coerência e separação visual vencem preferência/camuflagem.
  assert.equal(brief.paletteStrategy, "contrastive");
  assert.equal(brief.contrastStrategy, "high");
  assert.ok(brief.decisionTrace.some((entry) => entry.rule === "avoid_color_camouflage"));

  // C. A intenção canônica da campanha participa da decisão.
  assert.equal(brief.visualObjective, "special_offer");
  assert.equal(brief.priceTreatment, "highlight");
  assert.equal(brief.promotionTreatment, "strong");
  assert.ok(brief.decisionTrace.some((entry) => entry.source === "campaign_objective"));

  // D/E. Preferências personalizam quando seguras; categoria substitui global.
  assert.equal(brief.creativeFamily, "modern");
  assert.equal(brief.typographyDirection, "clean");
  assert.equal(brief.informationDensity, "low");
  assert.equal(resolveSellerCreativePreferences(sellerProfile, "eletrônicos").typographyPreference, "clean");
  assert.ok(brief.decisionTrace.some((entry) => entry.rule === "category_overrides_global_when_safe"));

  // F/G. Somente Product Truth vira claim factual; observações/inferências ficam fora.
  assert.ok(brief.allowedClaims.some((claim) => claim.field === "brand" && claim.value === "Marca cadastrada" && claim.source === "trusted"));
  assert.ok(brief.allowedClaims.some((claim) => claim.field === "volume" && claim.value === "1 unidade"));
  assert.equal(brief.allowedClaims.some((claim) => String(claim.value).includes("fast charging")), false);
  assert.equal(brief.allowedClaims.some((claim) => String(claim.value).includes("premium performance")), false);

  // J/K/N. Contrato compartilhado, sem SDK/provider/rede/custo.
  const composerCompatibility: ComposerProductCreativeContext = product;
  assert.equal(composerCompatibility.productId, product.productId);
  assert.equal(externalProviderCalls, 0);
  const source = fs.readFileSync("shared/marketing-pro-creative-intelligence.ts", "utf8");
  const importLines = source.match(/^import .*$/gm) || [];
  assert.equal(importLines.some((line) => /google|gemini|openai|provider|firebase|server\/|client\//i.test(line)), false);
  assert.equal(/\bfetch\s*\(/.test(source), false);
  assert.equal(/generateBackground|reserveMarketingProBackgroundBudget|costMicrousd/.test(source), false);

  // L. Nenhum dado/asset do produto é mutado.
  assert.equal(JSON.stringify({ product, sellerProfile }), before);
  assert.equal(product.truth?.imageAsset?.imageId, "image-original-1");
  assert.ok(brief.constraints.includes("preserve original product identity"));

  // M. Fundação não expõe funcionalidade ao Free.
  assert.equal(canUseFeature("free", "proAds"), false);

  const concepts: readonly CreativeConcept[] = [
    { id: "a", label: "Fresh premium", creativeFamily: "fresh-premium", visualDirection: "spa premium", palette: ["aqua", "ivory"], environment: ["stone", "water"], lighting: "soft", composition: "quiet hero", productPlacement: "center", priceTreatment: "standard", promotionTreatment: "subtle", informationHierarchy: ["product", "name", "price"] },
    { id: "b", label: "Fresh sport", creativeFamily: "fresh-sport", visualDirection: "active freshness", palette: ["cyan", "navy"], environment: ["motion", "mist"], lighting: "hard daylight", composition: "diagonal", productPlacement: "lower third", priceTreatment: "highlight", promotionTreatment: "balanced", informationHierarchy: ["product", "offer", "price"] },
    { id: "c", label: "Fresh commercial", creativeFamily: "fresh-commercial", visualDirection: "retail clarity", palette: ["white", "blue"], environment: ["clean retail stage"], lighting: "studio", composition: "catalog grid", productPlacement: "right", priceTreatment: "highlight", promotionTreatment: "strong", informationHierarchy: ["offer", "product", "price"] },
  ];
  assert.equal(validateCreativeConceptSet(concepts).valid, true);
  assert.equal(validateCreativeConceptSet([concepts[0], { ...concepts[1], visualDirection: concepts[0].visualDirection }, concepts[2]]).valid, false);

  console.log("Creative Intelligence Foundation: 14 invariants passed; external provider calls=0; paid calls=0.");
}

run();
