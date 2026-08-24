import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  PRODUCT_PRESERVATION_FLOAT_TOLERANCE,
  calculateProductContainTransform,
  evaluateProductPreservationGate,
  validateProductImageMetadata,
  type ProductAssetOriginal,
  type ProductBoundingBox,
  type ProductImageDimensions,
  type ProductTransform,
} from "../shared/product-image-preservation";
import {
  MarketingHistoryAssetError,
  MarketingProductPreservationError,
  assertProductAssetSnapshotMatches,
  assertPreparedMarketingProductImage,
  captureMarketingProductRenderIdentity,
  createProductAssetOriginal,
  createProductAssetSnapshot,
  getMarketingProductPreviewGeometry,
  getMarketingProductRenderGeometry,
  isMarketingProductRenderIdentityCurrent,
  prepareMarketingProductImage,
} from "../client/src/lib/marketing-product-preservation";
import type { ResolvedMarketingImage } from "../client/src/lib/marketing-image";
import { ART_LAYOUT, toArtPx } from "../client/src/lib/marketing-art-layout";
import { sanitizeMarketingHistoryPayload, sanitizeProductAssetSnapshot } from "../client/src/lib/marketing-ad";

function requireTransform(source: ProductImageDimensions, bounds: ProductBoundingBox, padding = 0): ProductTransform {
  const result = calculateProductContainTransform({ sourceAssetId: "asset-v1", source, bounds, padding });
  if (!result.accepted) {
    assert.fail(`contain deveria aceitar ${JSON.stringify({ source, bounds, padding })}: ${result.errors.map((error) => error.code).join(",")}`);
  }
  return result.transform;
}

function gate(transform: ProductTransform, assetOverrides: Partial<ProductAssetOriginal> = {}) {
  const asset: ProductAssetOriginal = {
    productId: "product-1",
    assetId: "asset-v1",
    assetRef: "users/u/products/product-1/original-v1.png",
    width: transform.sourceWidth,
    height: transform.sourceHeight,
    mimeType: "image/png",
    ...assetOverrides,
  };
  return evaluateProductPreservationGate({
    expectedProductId: "product-1",
    expectedAssetId: "asset-v1",
    asset,
    transform,
  });
}

function assertContained(transform: ProductTransform) {
  const minX = transform.bounds.x + transform.padding;
  const minY = transform.bounds.y + transform.padding;
  const maxX = transform.bounds.x + transform.bounds.width - transform.padding;
  const maxY = transform.bounds.y + transform.bounds.height - transform.padding;
  assert.ok(transform.translateX >= minX - PRODUCT_PRESERVATION_FLOAT_TOLERANCE);
  assert.ok(transform.translateY >= minY - PRODUCT_PRESERVATION_FLOAT_TOLERANCE);
  assert.ok(transform.translateX + transform.targetWidth <= maxX + PRODUCT_PRESERVATION_FLOAT_TOLERANCE);
  assert.ok(transform.translateY + transform.targetHeight <= maxY + PRODUCT_PRESERVATION_FLOAT_TOLERANCE);
}

export function runProductImagePreservationTests() {
  const portrait = { width: 800, height: 1200 };
  const landscape = { width: 1600, height: 900 };
  const square = { width: 1000, height: 1000 };
  const portraitBox = { x: 10, y: 20, width: 600, height: 900 };
  const landscapeBox = { x: 5, y: 7, width: 1200, height: 600 };
  const squareBox = { x: 0, y: 0, width: 800, height: 800 };

  // 1–6: combinações de orientação, incluindo imagem e box quadradas.
  for (const [source, bounds] of [
    [portrait, portraitBox],
    [portrait, landscapeBox],
    [landscape, portraitBox],
    [landscape, landscapeBox],
    [square, portraitBox],
    [portrait, squareBox],
  ] as const) {
    const transform = requireTransform(source, bounds, 12);
    assert.equal(gate(transform).accepted, true);
    assertContained(transform);
  }

  // 7–8: dimensões muito grandes e pequenas válidas.
  assert.equal(gate(requireTransform({ width: 1_000_000_000, height: 500_000_000 }, squareBox)).accepted, true);
  assert.equal(gate(requireTransform({ width: 1, height: 1 }, { x: 0, y: 0, width: 1, height: 1 })).accepted, true);

  // 9–12: zero, NaN e Infinity são recusados pela validação pura de metadata.
  assert.equal(validateProductImageMetadata({ width: 0, height: 10 }).accepted, false);
  assert.equal(validateProductImageMetadata({ width: 10, height: 0 }).accepted, false);
  assert.equal(validateProductImageMetadata({ width: Number.NaN, height: 10 }).accepted, false);
  assert.equal(validateProductImageMetadata({ width: 10, height: Number.POSITIVE_INFINITY }).accepted, false);
  assert.equal(validateProductImageMetadata({ width: undefined as unknown as number, height: 10 }).accepted, false);

  // 13 e 17: transformação proporcional com um único scale é aceita.
  const proportional = requireTransform(landscape, portraitBox, 20);
  assert.equal(proportional.targetWidth, proportional.sourceWidth * proportional.scale);
  assert.equal(proportional.targetHeight, proportional.sourceHeight * proportional.scale);
  assert.equal(gate(proportional).accepted, true);

  // 14–15: campos scaleX/scaleY são proibidos mesmo se um objeto externo contornar o tipo TS.
  const horizontalStretch = { ...proportional, scaleX: proportional.scale * 1.1 } as ProductTransform;
  const verticalStretch = { ...proportional, scaleY: proportional.scale * 0.9 } as ProductTransform;
  assert.ok(gate(horizontalStretch).errors.some((error) => error.code === "forbidden-transform-field"));
  assert.ok(gate(verticalStretch).errors.some((error) => error.code === "forbidden-transform-field"));

  // Stretch também é recusado quando tenta se esconder apenas nas dimensões finais.
  const distortedTarget = { ...proportional, targetWidth: proportional.targetWidth * 1.01 };
  assert.ok(gate(distortedTarget).errors.some((error) => error.code === "target-dimensions-mismatch" || error.code === "aspect-ratio-not-preserved"));
  assert.ok(gate({ ...proportional, targetWidth: 0 }).errors.some((error) => error.code === "invalid-target-width"));
  assert.ok(gate({ ...proportional, targetHeight: -1 }).errors.some((error) => error.code === "invalid-target-height"));
  assert.ok(gate({ ...proportional, translateX: Number.NaN }).errors.some((error) => error.code === "invalid-coordinate"));
  assert.ok(gate({ ...proportional, scale: Number.POSITIVE_INFINITY }).errors.some((error) => error.code === "invalid-scale"));

  // 16: produto fora da box é recusado.
  const outside = { ...proportional, translateX: proportional.bounds.x - proportional.targetWidth };
  assert.ok(gate(outside).errors.some((error) => error.code === "product-outside-bounds"));

  // 18–19: contain não recorta e preserva aspect ratio.
  assertContained(proportional);
  assert.equal(proportional.allowCrop, false);
  assert.ok(Math.abs(proportional.sourceWidth / proportional.sourceHeight - proportional.targetWidth / proportional.targetHeight) <= PRODUCT_PRESERVATION_FLOAT_TOLERANCE);

  // 20: mesma entrada produz exatamente o mesmo objeto, sem relógio/aleatoriedade/arredondamento externo.
  const deterministicInput = { sourceAssetId: "asset-v1", source: portrait, bounds: landscapeBox, padding: 17 };
  assert.deepEqual(calculateProductContainTransform(deterministicInput), calculateProductContainTransform(deterministicInput));

  // Regressão PRO-07A: asset alternativo não pode substituir silenciosamente o esperado.
  assert.ok(gate(proportional, { assetId: "asset-v2" }).errors.some((error) => error.code === "asset-id-mismatch"));
  assert.ok(gate(proportional, { productId: "other-product" }).errors.some((error) => error.code === "invalid-product-id"));
  assert.ok(gate(proportional, { width: proportional.sourceWidth + 1 }).errors.some((error) => error.code === "source-dimensions-mismatch"));
  assert.ok(gate(proportional, { assetRef: "data:image/png;base64,AAAA" }).errors.some((error) => error.code === "inline-image-not-allowed"));
  assert.ok(gate(proportional, { mimeType: "text/plain" }).errors.some((error) => error.code === "invalid-mime-type"));

  // Crop, rotação, skew, matriz e filtro nunca fazem parte da transformação permitida.
  for (const forbidden of ["crop", "rotation", "skewX", "matrix", "filter"] as const) {
    const malicious = { ...proportional, [forbidden]: forbidden === "crop" ? true : 1 } as ProductTransform;
    assert.ok(gate(malicious).errors.some((error) => error.code === "forbidden-transform-field" && error.field.endsWith(forbidden)));
  }

  // Padding inválido ou grande demais falha de forma estruturada, sem throw.
  assert.equal(calculateProductContainTransform({ sourceAssetId: "asset-v1", source: square, bounds: squareBox, padding: -1 }).accepted, false);
  assert.equal(calculateProductContainTransform({ sourceAssetId: "asset-v1", source: square, bounds: squareBox, padding: 400 }).accepted, false);

  // PRO-07C A–O: o mesmo pacote preparado alimenta Preview e PNG; nenhum renderizador calcula contain.
  const resolved = (sourceUrl: string, width: number, height: number): ResolvedMarketingImage => ({
    sourceUrl,
    safeSrc: `blob:${sourceUrl}`,
    mimeType: "image/png",
    width,
    height,
    candidateIndex: 0,
    transport: "web-fetch",
  });
  const prepare = (productId: string, sourceUrl: string, width: number, height: number) => prepareMarketingProductImage({
    productId,
    resolvedImage: resolved(sourceUrl, width, height),
  });

  const preparedPortrait = prepare("portrait-product", "https://assets.test/portrait.png", 800, 1200);
  const preparedLandscape = prepare("landscape-product", "https://assets.test/landscape.png", 1600, 900);
  const preparedSquare = prepare("square-product", "https://assets.test/square.png", 1000, 1000);

  // A/B: ambos consomem a mesma identidade e o mesmo ProductTransform, sem clone ou segunda preparação.
  assert.equal(preparedPortrait.asset.assetId, preparedPortrait.transform.sourceAssetId);
  assert.strictEqual(assertPreparedMarketingProductImage({ expectedProductId: "portrait-product", prepared: preparedPortrait }), preparedPortrait);
  assert.deepEqual(getMarketingProductRenderGeometry(preparedPortrait), {
    x: preparedPortrait.transform.translateX,
    y: preparedPortrait.transform.translateY,
    width: preparedPortrait.transform.targetWidth,
    height: preparedPortrait.transform.targetHeight,
  });

  // C/D/E: portrait, landscape e square têm uma única geometria canônica dentro da mesma box.
  for (const prepared of [preparedPortrait, preparedLandscape, preparedSquare]) {
    const exportGeometry = getMarketingProductRenderGeometry(prepared);
    const previewGeometry = getMarketingProductPreviewGeometry(prepared);
    assert.equal(previewGeometry.width, exportGeometry.width);
    assert.equal(previewGeometry.height, exportGeometry.height);
    assert.equal(previewGeometry.x + toArtPx(ART_LAYOUT.photo.x), exportGeometry.x);
    assert.equal(previewGeometry.y + toArtPx(ART_LAYOUT.photo.y), exportGeometry.y);
  }

  // F/G: contrato não expõe e o objeto produzido não carrega escalas independentes nem crop.
  for (const prepared of [preparedPortrait, preparedLandscape, preparedSquare]) {
    assert.equal("scaleX" in prepared.transform, false);
    assert.equal("scaleY" in prepared.transform, false);
    assert.equal(prepared.transform.allowCrop, false);
  }

  // H: mesmo ainda dentro da box, um produto reduzido/descentralizado não é o contain canônico.
  const nonCanonical = {
    ...preparedPortrait.transform,
    scale: preparedPortrait.transform.scale * 0.9,
    targetWidth: preparedPortrait.transform.targetWidth * 0.9,
    targetHeight: preparedPortrait.transform.targetHeight * 0.9,
  };
  assert.ok(evaluateProductPreservationGate({
    expectedProductId: preparedPortrait.asset.productId,
    expectedAssetId: preparedPortrait.asset.assetId,
    asset: preparedPortrait.asset,
    transform: nonCanonical,
  }).errors.some((error) => error.code === "contain-transform-mismatch"));

  // I/J/L: asset, produto ou source divergente falham fechados; não há escolha de outra candidata.
  assert.throws(() => assertPreparedMarketingProductImage({
    expectedProductId: "other-product",
    prepared: preparedPortrait,
  }), MarketingProductPreservationError);
  assert.throws(() => assertPreparedMarketingProductImage({
    expectedProductId: "portrait-product",
    prepared: preparedPortrait,
    resolvedImage: resolved("https://assets.test/replacement.png", 800, 1200),
  }), MarketingProductPreservationError);
  const alteredAsset = { ...preparedPortrait, asset: { ...preparedPortrait.asset, assetId: "other-asset" } };
  assert.throws(() => assertPreparedMarketingProductImage({
    expectedProductId: "portrait-product",
    prepared: alteredAsset,
  }), MarketingProductPreservationError);

  // K: resultado atrasado de A não é atual quando a seleção e o asset já são B.
  const capturedA = captureMarketingProductRenderIdentity(preparedPortrait);
  assert.equal(isMarketingProductRenderIdentityCurrent(capturedA, "portrait-product", preparedPortrait), true);
  assert.equal(isMarketingProductRenderIdentityCurrent(capturedA, "landscape-product", preparedLandscape), false);

  // M/N/O: proteção estrutural — Preview não usa cover; PNG preparado desenha a geometria pronta.
  const previewSource = readFileSync("client/src/components/MarketingAdCanvas.tsx", "utf8");
  const cssSource = readFileSync("client/src/styles/marketing.css", "utf8");
  const exportSource = readFileSync("client/src/lib/marketing-card.ts", "utf8");
  assert.match(previewSource, /getMarketingProductPreviewGeometry\(preparedProductImage\)/);
  assert.doesNotMatch(cssSource, /\.ma4(?:\s+img)?\{[^}]*object-fit:cover/);
  assert.match(exportSource, /getMarketingProductRenderGeometry\(prepared\)/);
  assert.match(exportSource, /ctx\.drawImage\(product, geometry\.x, geometry\.y, geometry\.width, geometry\.height\)/);
  assert.doesNotMatch(exportSource, /calculateProductContainTransform/);

  // O (dados): os quatro argumentos do PNG são literalmente os quatro campos do transform preparado.
  const pngGeometry = getMarketingProductRenderGeometry(preparedLandscape);
  assert.deepEqual(pngGeometry, {
    x: preparedLandscape.transform.translateX,
    y: preparedLandscape.transform.translateY,
    width: preparedLandscape.transform.targetWidth,
    height: preparedLandscape.transform.targetHeight,
  });

  // Adapter: identidade estável na sessão e nenhuma imagem inline grande escapa para assetRef/sourceUrl.
  assert.deepEqual(
    createProductAssetOriginal("portrait-product", preparedPortrait.resolvedImage),
    createProductAssetOriginal("portrait-product", preparedPortrait.resolvedImage),
  );
  const inlineAsset = createProductAssetOriginal("inline-product", {
    ...resolved("data:image/png;base64,AAAA", 1, 1),
    safeSrc: "data:image/png;base64,AAAA",
    transport: "inline",
  });
  assert.equal(inlineAsset.sourceUrl, undefined);
  assert.doesNotMatch(inlineAsset.assetRef, /^data:image\//);

  // PRO-07D A/B/L/M: snapshot nasce do pacote validado, é serializável e sobrevive ao round-trip local.
  const snapshot = createProductAssetSnapshot(preparedPortrait);
  assert.equal(snapshot.productId, "portrait-product");
  assert.equal(snapshot.assetId, preparedPortrait.asset.assetId);
  assert.strictEqual(assertProductAssetSnapshotMatches({ snapshot, prepared: preparedPortrait }), preparedPortrait);
  const serializedSnapshot = JSON.stringify(snapshot);
  assert.deepEqual(JSON.parse(serializedSnapshot), snapshot);
  const localRoundTrip = JSON.parse(JSON.stringify(sanitizeMarketingHistoryPayload({
    action: "generated",
    productAssetSnapshot: snapshot,
  })));
  assert.deepEqual(localRoundTrip.productAssetSnapshot, snapshot);
  const firestorePayload = sanitizeMarketingHistoryPayload({
    productId: snapshot.productId,
    action: "generated",
    productAssetSnapshot: snapshot,
  });
  assert.deepEqual(firestorePayload.productAssetSnapshot, snapshot);
  assert.doesNotMatch(JSON.stringify(firestorePayload), /safeSrc|base64/i);

  // C/D/E/G/O: qualquer troca relevante bloqueia, inclusive source diferente com assetId preservado.
  for (const changedSnapshot of [
    { ...snapshot, assetId: "other-asset" },
    { ...snapshot, productId: "other-product" },
    { ...snapshot, sourceUrl: "https://assets.test/other-source.png" },
  ]) {
    assert.throws(
      () => assertProductAssetSnapshotMatches({ snapshot: changedSnapshot, prepared: preparedPortrait }),
      MarketingHistoryAssetError,
    );
  }
  const photoB = prepareMarketingProductImage({
    productId: "portrait-product",
    resolvedImage: { ...preparedPortrait.resolvedImage, safeSrc: "data:image/png;base64,BBBB" },
  });
  assert.notEqual(photoB.asset.assetId, snapshot.assetId);
  assert.throws(() => assertProductAssetSnapshotMatches({ snapshot, prepared: photoB }), MarketingHistoryAssetError);

  // J/K/N: sanitizador fechado remove extras e rejeita integralmente referências inline/base64.
  assert.deepEqual(sanitizeProductAssetSnapshot({ ...snapshot, safeSrc: "secret", bytes: [1, 2, 3] }), snapshot);
  for (const unsafe of [
    { ...snapshot, assetRef: "data:image/png;base64,AAAA" },
    { ...snapshot, sourceUrl: "DATA:image/png;base64,AAAA" },
  ]) {
    const sanitized = sanitizeMarketingHistoryPayload({ productAssetSnapshot: unsafe });
    assert.equal("productAssetSnapshot" in sanitized, false);
    assert.doesNotMatch(JSON.stringify(sanitized), /base64|AAAA/i);
  }

  // F/H/I/P: comportamento estrutural do fluxo — snapshot é fail-closed; legacy segue sem garantia falsa.
  const marketingPageSource = readFileSync("client/src/pages/marketing.tsx", "utf8");
  assert.match(marketingPageSource, /if \(!entry\.productAssetSnapshot\) return \{ resolved, prepared: null, identityVerified: false \}/);
  assert.match(marketingPageSource, /if \(!resolved\) throw new MarketingHistoryAssetError\(\)/);
  assert.match(marketingPageSource, /assertProductAssetSnapshotMatches\(\{ snapshot: entry\.productAssetSnapshot, prepared \}\)/);
  assert.match(marketingPageSource, /preparedProductImage: historicalImage\.prepared/);
  assert.match(marketingPageSource, /preparedProductImage: currentPreparedProductImage/);
}
