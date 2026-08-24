import assert from "node:assert/strict";
import fs from "node:fs";
import { buildProductTruthFromProduct } from "../client/src/lib/product-truth-adapter";
import type { Product } from "../client/src/lib/mock-data";
import { buildCreativeBrief, createCampaignCreativeIntent } from "../shared/marketing-pro-creative-intelligence";
import {
  buildProductUnderstandingFallback,
  parseProductVisualUnderstandingOutput,
  resolveCategoryCreativeHints,
} from "../shared/marketing-pro-product-understanding";

function run(): void {
  const approvedCutout = {
    sourceAssetId: "source-image-1",
    cutoutAssetId: "approved-cutout-1",
    storagePath: "users/u/products/product-1/approved-cutout.png",
    width: 900,
    height: 1200,
    mimeType: "image/png" as const,
    coordinateSpaceVersion: "product-image-coordinate-space-v1" as const,
    preservesOriginalPixels: true as const,
    method: "specialized-api" as const,
    createdAt: "2026-08-20T12:00:00.000Z",
  };
  const product: Product = {
    id: "product-1",
    name: "Fragrância Azul",
    brand: "Marca cadastrada",
    origin: "Nacional",
    category: "Perfumes",
    productType: "Cosméticos & Perfumes",
    costPrice: 50,
    salePrice: 100,
    stock: 4,
    imageId: "source-image-1",
    imageUrl: "https://storage.example/product-1.webp",
    storagePath: "users/u/products/product-1/original.webp",
    description: "Descrição cadastrada pelo vendedor",
    gender: "unisex",
    extras: {
      volume_ml: "100 ml",
      size: "M",
      variation: "Edição azul",
      color: "Vermelho",
      availability: "Pronta entrega",
      scent_family: "Floral",
    },
    isOnSale: true,
    discountPercent: 10,
    approvedCutout,
  };
  const originalSnapshot = JSON.stringify(product);

  // A. Schema real -> ProductTruth, reutilizando preço e referências existentes sem duplicar extras.
  const truth = buildProductTruthFromProduct(product);
  assert.equal(truth.productId, product.id);
  assert.equal(truth.name, product.name);
  assert.equal(truth.salePrice, 100);
  assert.equal(truth.promotionalPrice, 90);
  assert.equal(truth.volume, "100 ml");
  assert.equal(truth.size, "M");
  assert.equal(truth.variant, "Edição azul");
  assert.equal(truth.color, "Vermelho");
  assert.equal(truth.availability, "Pronta entrega");
  assert.equal(truth.specifications?.niche, "Cosméticos & Perfumes");
  assert.equal(truth.specifications?.scent_family, "Floral");
  assert.equal("volume_ml" in (truth.specifications || {}), false);
  assert.equal(truth.imageAsset?.imageId, "source-image-1");
  assert.equal(truth.approvedCutout, approvedCutout);

  const understanding = buildProductUnderstandingFallback({
    truth,
    observed: {
      dominantColors: ["red", "light blue"],
      perceivedBrightness: "light",
      visualWeight: "balanced",
      productShape: "vertical bottle silhouette",
      productOrientation: "portrait",
      visualComplexity: "medium",
    },
  });
  const context = { version: 1 as const, productId: truth.productId, truth, visualUnderstanding: understanding.visualUnderstanding };
  const brief = buildCreativeBrief({ product: context, campaignIntent: createCampaignCreativeIntent("spotlight") });

  // B/C. Inferred orienta arte, mas só trusted entra como factual claim.
  assert.equal(brief.allowedClaims.some((claim) => String(claim.value).includes("fresh")), false);
  assert.equal(brief.allowedClaims.some((claim) => String(claim.value).includes("aquatic")), false);
  assert.ok(brief.allowedClaims.some((claim) => claim.field === "brand" && claim.value === "Marca cadastrada"));
  assert.ok(brief.allowedClaims.some((claim) => claim.field === "specifications.scent_family" && claim.value === "Floral"));

  // D/E. Vermelho ativa anti-camouflage; produto claro exige contraste alto.
  assert.equal(understanding.visualUnderstanding.inferred.recommendedBackgroundContrast, "high");
  assert.ok(understanding.visualUnderstanding.inferred.avoidEnvironmentHints?.some((hint) => hint.includes("red background")));
  assert.ok(understanding.decisionTrace.some((entry) => entry.rule === "avoid_color_camouflage" && entry.result === "complementary_contrast"));

  // F. Produto escuro também exige separação, sem concluir qualquer fato comercial.
  const dark = buildProductUnderstandingFallback({
    truth: { ...truth, productId: "product-dark", color: "Preto" },
    observed: { dominantColors: ["black"], perceivedBrightness: "very_dark" },
  });
  assert.equal(dark.visualUnderstanding.inferred.recommendedBackgroundContrast, "high");
  assert.ok(dark.visualUnderstanding.inferred.avoidEnvironmentHints?.some((hint) => hint.includes("dark low-separation")));

  // G. Categoria gera hints, nunca fatos novos.
  const electronicsHints = resolveCategoryCreativeHints({ productId: "e1", name: "Controle", category: "Eletrônicos" });
  assert.ok(electronicsHints.visualMoodCandidates.includes("clean-tech"));
  const electronicsResult = buildProductUnderstandingFallback({ truth: { productId: "e1", name: "Controle", category: "Eletrônicos", salePrice: 10 } });
  const electronicsBrief = buildCreativeBrief({
    product: { version: 1, productId: "e1", truth: { productId: "e1", name: "Controle", category: "Eletrônicos", salePrice: 10 }, visualUnderstanding: electronicsResult.visualUnderstanding },
    campaignIntent: createCampaignCreativeIntent("spotlight"),
  });
  assert.equal(electronicsBrief.allowedClaims.some((claim) => String(claim.value).includes("clean-tech") || String(claim.value).includes("performance")), false);

  // H/I. Confidence fora do intervalo e qualquer campo desconhecido falham fechados.
  assert.equal(parseProductVisualUnderstandingOutput({ ...understanding.visualUnderstanding, confidence: 1.01 }).accepted, false);
  assert.equal(parseProductVisualUnderstandingOutput({ ...understanding.visualUnderstanding, unexpected: true }).accepted, false);
  assert.equal(parseProductVisualUnderstandingOutput({
    ...understanding.visualUnderstanding,
    observed: { ...understanding.visualUnderstanding.observed, secretExtra: "no" },
  }).accepted, false);

  // J/K/O. Apenas boundary compartilhado; nenhum adapter/provider/client profile foi criado ou importado.
  const understandingSource = fs.readFileSync("shared/marketing-pro-product-understanding.ts", "utf8");
  const truthAdapterSource = fs.readFileSync("client/src/lib/product-truth-adapter.ts", "utf8");
  const sharedImports = understandingSource.match(/^import .*$/gm) || [];
  assert.equal(sharedImports.some((line) => /google|gemini|openai|firebase|server\/|client\//i.test(line)), false);
  assert.equal(/\bfetch\s*\(/.test(understandingSource + truthAdapterSource), false);
  assert.equal(/SellerCreativeProfile|creative-profile|onboarding/i.test(understandingSource + truthAdapterSource), false);
  assert.equal(/analyzeProductVisual/.test(truthAdapterSource), false);

  // L/M. O caminho default é puramente local e continua funcionando sem analyzer.
  let externalCalls = 0;
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async () => {
      externalCalls += 1;
      throw new Error("external calls are forbidden");
    }) as typeof fetch;
    const fallbackOnly = buildProductUnderstandingFallback({ truth });
    assert.ok(fallbackOnly.visualUnderstanding.inferred.recommendedCreativeFamilies?.length);
    assert.ok(fallbackOnly.visualUnderstanding.confidence <= 0.55);
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(externalCalls, 0);

  // N. Trace fechado e auditável: apenas quatro campos, sem texto livre de raciocínio.
  for (const entry of understanding.decisionTrace) {
    assert.deepEqual(Object.keys(entry).sort(), ["decision", "result", "rule", "source"]);
    assert.ok(["product_truth", "commercial_coherence", "campaign_objective", "seller_preferences"].includes(entry.source));
  }

  // P. Adapter e análise nunca alteram o produto nem suas referências de imagem/cutout.
  assert.equal(JSON.stringify(product), originalSnapshot);
  assert.equal(product.imageId, "source-image-1");
  assert.equal(product.approvedCutout, approvedCutout);

  console.log("Product Understanding Foundation: A-P passed; external provider calls=0; paid calls=0.");
}

run();
