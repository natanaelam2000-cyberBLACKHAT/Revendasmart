/**
 * ADS-PRO-FINAL — recorte LOCAL (grátis) com fundo de estúdio cinza/bege: os limiares seguem a cor real das bordas,
 * mas continuam fail-closed (fundo escuro/médio/ruidoso não vira recorte) e o produto nunca é alterado.
 */
import assert from "node:assert/strict";
import { computeOpaqueBounds, estimateLightBackdropOptions } from "../shared/ads-pro/ad-cutout-options";
import { removeBackgroundLocalHeuristic } from "../client/src/lib/product-cutout-local-heuristic";
import { generateProductCutoutRgba } from "../client/src/lib/product-cutout-pipeline";
import { check, checkCount, createRng } from "./ads-pro-test-kit";

type Rgb = readonly [number, number, number];
const RESOLVED = { sourceUrl: "https://example.test/p.png", safeSrc: "data:image/png;base64,AAAA", mimeType: "image/png", width: 64, height: 64, candidateIndex: 0, transport: "inline" } as never;

function buildImage(size: number, background: Rgb, product: { x0: number; y0: number; x1: number; y1: number; color: Rgb }, options: { noise?: number; seed?: number; label?: { x0: number; y0: number; x1: number; y1: number; color: Rgb } } = {}) {
  const rng = createRng(options.seed ?? 7);
  const noise = options.noise ?? 0;
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const o = (y * size + x) * 4;
      const insideProduct = x >= product.x0 && x < product.x1 && y >= product.y0 && y < product.y1;
      const insideLabel = options.label && x >= options.label.x0 && x < options.label.x1 && y >= options.label.y0 && y < options.label.y1;
      const base = insideLabel ? options.label!.color : insideProduct ? product.color : background;
      const jitter = insideProduct ? 0 : Math.round((rng() - 0.5) * 2 * noise);
      data[o] = base[0] + jitter; data[o + 1] = base[1] + jitter; data[o + 2] = base[2] + jitter; data[o + 3] = 255;
    }
  }
  return { data, width: size, height: size };
}

const PRODUCT = { x0: 20, y0: 12, x1: 44, y1: 52, color: [150, 82, 28] as Rgb };
const BEIGE: Rgb = [239, 237, 231];

function foregroundCount(mask: Uint8Array): number {
  let count = 0;
  for (const value of mask) if (value === 255) count += 1;
  return count;
}

await check("CO1 fundo bege de estúdio: a heurística padrão falhava; com os limiares adaptativos o recorte sai", () => {
  const image = buildImage(64, BEIGE, PRODUCT);
  const fallback = removeBackgroundLocalHeuristic(image);
  assert.equal(fallback.ok, false, "antes: 'não achamos um fundo liso' mesmo sendo liso");
  const options = estimateLightBackdropOptions(image);
  assert.ok(options);
  assert.ok(options.whiteThreshold >= 205 && options.whiteThreshold <= 235);
  assert.ok(options.whiteThreshold <= 231 - 12 + 1, "o limiar acompanha a cor do fundo (canal mínimo 231 − 12)");
  const result = removeBackgroundLocalHeuristic(image, options);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(foregroundCount(result.mask), (PRODUCT.x1 - PRODUCT.x0) * (PRODUCT.y1 - PRODUCT.y0), "só o produto fica");
  for (let i = 0; i < 64; i += 1) assert.equal(result.mask[i], 0, "a borda superior é fundo");
});

await check("CO2 branco puro e cinza claro continuam funcionando (e o branco não fica mais permissivo)", () => {
  const white = buildImage(64, [255, 255, 255], PRODUCT);
  const whiteOptions = estimateLightBackdropOptions(white);
  assert.ok(whiteOptions);
  assert.equal(whiteOptions.whiteThreshold, 235, "branco puro = limiar original");
  assert.equal(removeBackgroundLocalHeuristic(white, whiteOptions).ok, true);
  const gray = buildImage(64, [226, 226, 226], PRODUCT);
  const grayOptions = estimateLightBackdropOptions(gray);
  assert.ok(grayOptions);
  assert.equal(removeBackgroundLocalHeuristic(gray, grayOptions).ok, true);
});

await check("CO3 fundo escuro ou médio NUNCA vira recorte (fail-closed)", () => {
  for (const background of [[20, 20, 20], [90, 90, 90], [180, 180, 180], [199, 199, 199]] as Rgb[]) {
    const image = buildImage(64, background, PRODUCT);
    assert.equal(estimateLightBackdropOptions(image), null, `fundo ${background.join(",")} não é fundo claro e liso`);
    assert.equal(removeBackgroundLocalHeuristic(image).ok, false);
  }
});

await check("CO4 ruído leve de câmera no fundo ainda é reconhecido", () => {
  const image = buildImage(96, BEIGE, { ...PRODUCT, x0: 30, x1: 66, y0: 18, y1: 78 }, { noise: 3 });
  const options = estimateLightBackdropOptions(image);
  assert.ok(options);
  assert.equal(removeBackgroundLocalHeuristic(image, options).ok, true);
});

await check("CO5 detalhe claro DENTRO do produto (rótulo branco) nunca é apagado", () => {
  const label = { x0: 24, y0: 28, x1: 40, y1: 38, color: [250, 247, 238] as Rgb };
  const image = buildImage(64, BEIGE, PRODUCT, { label });
  const options = estimateLightBackdropOptions(image);
  assert.ok(options);
  const result = removeBackgroundLocalHeuristic(image, options);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.mask[33 * 64 + 32], 255, "o rótulo claro continua sendo produto (não está ligado à borda)");
});

await check("CO6 ponta a ponta: o recorte adaptativo preserva os pixels do produto e zera o fundo", async () => {
  const image = buildImage(64, BEIGE, PRODUCT);
  const result = await generateProductCutoutRgba("prod-bege", RESOLVED, {
    decodeImageToRgba: async () => image,
    heuristicOptions: (decoded) => estimateLightBackdropOptions(decoded) ?? undefined,
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const productPixel = (33 * 64 + 30) * 4;
  assert.deepEqual([result.composed.rgba[productPixel], result.composed.rgba[productPixel + 1], result.composed.rgba[productPixel + 2], result.composed.rgba[productPixel + 3]], [150, 82, 28, 255], "produto idêntico ao original");
  assert.equal(result.composed.rgba[3], 0, "o canto (fundo) fica transparente");
});

await check("CO7 sem o hook o comportamento é o antigo (compatível): bege → background-not-detected", async () => {
  const image = buildImage(64, BEIGE, PRODUCT);
  const result = await generateProductCutoutRgba("prod-bege", RESOLVED, { decodeImageToRgba: async () => image });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "background-not-detected");
});

await check("CO8 produto colado nas bordas ou imagem minúscula: sem recorte (fail-closed)", () => {
  const cropped = buildImage(64, BEIGE, { x0: 0, y0: 0, x1: 64, y1: 56, color: [150, 82, 28] });
  const options = estimateLightBackdropOptions(cropped) ?? undefined;
  assert.equal(removeBackgroundLocalHeuristic(cropped, options).ok, false, "borda majoritariamente ocupada pelo produto");
  assert.equal(estimateLightBackdropOptions({ data: new Uint8ClampedArray(4), width: 1, height: 1 }), null);
  assert.equal(estimateLightBackdropOptions({ data: new Uint8ClampedArray(16), width: 2, height: 2 }), null);
});

await check("CO9 PNG com fundo transparente: a borda transparente não é interpretada como fundo claro", () => {
  const image = buildImage(64, BEIGE, PRODUCT);
  for (let i = 3; i < image.data.length; i += 4) image.data[i] = 0;
  assert.equal(estimateLightBackdropOptions(image), null, "sem pixels opacos na borda não há o que estimar");
});

function alphaImage(size: number, box: { x0: number; y0: number; x1: number; y1: number } | null) {
  const data = new Uint8ClampedArray(size * size * 4);
  if (box) {
    for (let y = box.y0; y < box.y1; y += 1) for (let x = box.x0; x < box.x1; x += 1) { const o = (y * size + x) * 4; data[o] = 10; data[o + 1] = 20; data[o + 2] = 30; data[o + 3] = 255; }
  }
  return { data, width: size, height: size };
}

await check("CO10 o recorte é aparado nas margens transparentes (produto pequeno na foto vira produto grande no anúncio)", () => {
  const bounds = computeOpaqueBounds(alphaImage(100, { x0: 40, y0: 20, x1: 60, y1: 80 }));
  assert.ok(bounds);
  assert.ok(bounds.x <= 40 && bounds.y <= 20 && bounds.x + bounds.width >= 60 && bounds.y + bounds.height >= 80, "o produto inteiro cabe na caixa");
  assert.ok(bounds.width * bounds.height < 100 * 100 * 0.5, "a caixa é bem menor que a foto");
  assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= 100 && bounds.y + bounds.height <= 100, "o respiro nunca sai da imagem");
  assert.ok(bounds.x < 40 && bounds.y < 20, "existe um respiro ao redor do produto");
});

await check("CO11 recorte vazio ou que já ocupa quase tudo não é aparado", () => {
  assert.equal(computeOpaqueBounds(alphaImage(100, null)), null, "sem pixel de produto");
  assert.equal(computeOpaqueBounds(alphaImage(100, { x0: 2, y0: 2, x1: 98, y1: 98 })), null, "já ocupa quase toda a foto");
  assert.equal(computeOpaqueBounds({ data: new Uint8ClampedArray(8), width: 10, height: 10 }), null, "buffer inconsistente");
});

await check("CO12 produto encostado na borda: a caixa respeita os limites da imagem", () => {
  const bounds = computeOpaqueBounds(alphaImage(100, { x0: 0, y0: 0, x1: 30, y1: 30 }));
  assert.ok(bounds);
  assert.equal(bounds.x, 0);
  assert.equal(bounds.y, 0);
  assert.ok(bounds.width >= 30 && bounds.height >= 30);
});

console.log(`ADS-PRO studio cutout tests passed: ${checkCount()} checks.`);
