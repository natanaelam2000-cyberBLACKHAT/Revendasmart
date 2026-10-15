/**
 * ADS-PRO-FINAL — melhoria de foto local: segura, determinística e NUNCA destrutiva (a original é preservada).
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { PHOTO_ADJUST_LIMITS, isNeutralPhotoAdjust } from "../shared/ads-pro/ad-document";
import { analyzePhoto, applyPhotoAdjust, computeAutoAdjust, estimateEdgeColor, isPhotoAlreadyGood, type RgbaImage } from "../shared/ads-pro/ad-photo-adjust";
import { check, checkCount, createRng } from "./ads-pro-test-kit";

function sha(data: Uint8ClampedArray): string {
  return createHash("sha256").update(Buffer.from(data.buffer, data.byteOffset, data.byteLength)).digest("hex");
}

/** Foto sintética: gradiente suave + "produto" central texturizado. */
function makePhoto(width: number, height: number, opts: { base: number; spread: number; sat: number; noise: number; alphaHole?: boolean }): RgbaImage {
  const data = new Uint8ClampedArray(width * height * 4);
  const random = createRng(99);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const o = (y * width + x) * 4;
      const inProduct = Math.abs(x - width / 2) < width * 0.25 && Math.abs(y - height / 2) < height * 0.3;
      const t = (x / width + y / height) / 2;
      const level = opts.base + (t - 0.5) * opts.spread + (inProduct ? (random() - 0.5) * opts.noise : (random() - 0.5) * opts.noise * 0.2);
      data[o] = level + opts.sat;
      data[o + 1] = level;
      data[o + 2] = level - opts.sat;
      data[o + 3] = opts.alphaHole && !inProduct ? 0 : 255;
    }
  }
  return { data, width, height };
}

async function main(): Promise<void> {
  await check("P1 a foto ORIGINAL nunca é alterada: applyPhotoAdjust devolve buffer novo e os bytes da entrada ficam idênticos", () => {
    const original = makePhoto(120, 90, { base: 90, spread: 50, sat: 6, noise: 30 });
    const before = sha(original.data);
    const adjusted = applyPhotoAdjust(original, { brightness: 0.2, contrast: 1.25, saturation: 1.3, sharpness: 0.9 });
    assert.equal(sha(original.data), before, "a entrada foi mutada!");
    assert.notEqual(adjusted.data, original.data, "precisa ser outro buffer");
    assert.notEqual(sha(adjusted.data), before, "o ajuste deveria ter efeito");
    const frozen = new Uint8ClampedArray(original.data);
    Object.freeze(frozen.buffer);
    applyPhotoAdjust({ ...original, data: frozen }, { brightness: 0.1 });
    assert.equal(sha(frozen), before);
  });

  await check("P2 ajuste neutro devolve uma CÓPIA idêntica; dimensões sempre preservadas", () => {
    const original = makePhoto(64, 48, { base: 128, spread: 30, sat: 4, noise: 10 });
    const neutral = applyPhotoAdjust(original, {});
    assert.equal(sha(neutral.data), sha(original.data));
    assert.notEqual(neutral.data, original.data);
    const changed = applyPhotoAdjust(original, { sharpness: 1, contrast: 1.2 });
    assert.equal(changed.width, 64);
    assert.equal(changed.height, 48);
    assert.equal(changed.data.length, original.data.length);
  });

  await check("P3 o canal alfa e os pixels transparentes (recorte) permanecem intocados", () => {
    const cutout = makePhoto(80, 60, { base: 110, spread: 40, sat: 8, noise: 20, alphaHole: true });
    const adjusted = applyPhotoAdjust(cutout, { brightness: 0.25, contrast: 1.3, saturation: 1.35, sharpness: 1 });
    for (let i = 0; i < cutout.data.length; i += 4) {
      assert.equal(adjusted.data[i + 3], cutout.data[i + 3], "alfa mudou");
      if (cutout.data[i + 3] === 0) {
        assert.equal(adjusted.data[i], cutout.data[i]);
        assert.equal(adjusted.data[i + 1], cutout.data[i + 1]);
        assert.equal(adjusted.data[i + 2], cutout.data[i + 2]);
      }
    }
  });

  await check("P4 brilho/contraste/saturação têm efeito direcional correto", () => {
    const original = makePhoto(60, 40, { base: 100, spread: 40, sat: 10, noise: 16 });
    const mean = (image: RgbaImage) => analyzePhoto(image).meanLuma;
    assert.ok(mean(applyPhotoAdjust(original, { brightness: 0.15 })) > mean(original) + 10);
    assert.ok(mean(applyPhotoAdjust(original, { brightness: -0.15 })) < mean(original) - 10);
    const wide = (image: RgbaImage) => { const s = analyzePhoto(image); return s.p99 - s.p01; };
    assert.ok(wide(applyPhotoAdjust(original, { contrast: 1.3 })) > wide(original));
    assert.ok(analyzePhoto(applyPhotoAdjust(original, { saturation: 1.35 })).meanSaturation > analyzePhoto(original).meanSaturation);
    assert.ok(analyzePhoto(applyPhotoAdjust(original, { saturation: 0.8 })).meanSaturation < analyzePhoto(original).meanSaturation);
    assert.ok(analyzePhoto(applyPhotoAdjust(original, { sharpness: 1 })).sharpness > analyzePhoto(original).sharpness * 1.4, "nitidez precisa aumentar o Laplaciano");
  });

  await check("P5 limites impedem exagero: pedir o máximo absurdo não passa dos limites seguros e não estoura o quadro todo", () => {
    const original = makePhoto(60, 40, { base: 128, spread: 60, sat: 8, noise: 20 });
    const absurd = applyPhotoAdjust(original, { brightness: 50, contrast: 50, saturation: 50, sharpness: 50 });
    const maxed = applyPhotoAdjust(original, { brightness: PHOTO_ADJUST_LIMITS.brightness.max, contrast: PHOTO_ADJUST_LIMITS.contrast.max, saturation: PHOTO_ADJUST_LIMITS.saturation.max, sharpness: PHOTO_ADJUST_LIMITS.sharpness.max });
    assert.equal(sha(absurd.data), sha(maxed.data), "valores absurdos equivalem ao máximo seguro");
    assert.ok(analyzePhoto(maxed).clippedHigh < 0.9, "o máximo seguro não pode branquear a foto inteira");
  });

  await check("P6 ajuste automático: foto escura ganha brilho, foto lavada ganha contraste, foto boa fica neutra", () => {
    const dark = computeAutoAdjust(analyzePhoto(makePhoto(100, 80, { base: 55, spread: 60, sat: 10, noise: 40 })));
    assert.ok(dark.brightness > 0.03, `brilho ${dark.brightness}`);
    const washed = computeAutoAdjust(analyzePhoto(makePhoto(100, 80, { base: 150, spread: 40, sat: 4, noise: 20 })));
    assert.ok(washed.contrast > 1.05, `contraste ${washed.contrast}`);
    const bright = computeAutoAdjust(analyzePhoto(makePhoto(100, 80, { base: 215, spread: 40, sat: 4, noise: 30 })));
    assert.ok(bright.brightness < 0, `foto clara demais deveria escurecer: ${bright.brightness}`);
    const good = makePhoto(100, 80, { base: 128, spread: 230, sat: 40, noise: 120 });
    const goodAdjust = computeAutoAdjust(analyzePhoto(good));
    assert.equal(goodAdjust.brightness, 0);
    assert.equal(goodAdjust.contrast, 1);
    assert.equal(goodAdjust.saturation, 1);
    assert.equal(isPhotoAlreadyGood(goodAdjust), true, "foto boa => a UI avisa que já está boa");
    for (const adjust of [dark, washed, bright, goodAdjust]) {
      assert.ok(adjust.brightness >= PHOTO_ADJUST_LIMITS.brightness.min && adjust.brightness <= PHOTO_ADJUST_LIMITS.brightness.max);
      assert.ok(adjust.contrast >= PHOTO_ADJUST_LIMITS.contrast.min && adjust.contrast <= PHOTO_ADJUST_LIMITS.contrast.max);
    }
  });

  await check("P7 o ajuste automático realmente melhora a foto (e é determinístico)", () => {
    const dark = makePhoto(100, 80, { base: 55, spread: 60, sat: 10, noise: 40 });
    const stats = analyzePhoto(dark);
    const adjust = computeAutoAdjust(stats);
    assert.deepEqual(computeAutoAdjust(analyzePhoto(dark)), adjust);
    const improved = analyzePhoto(applyPhotoAdjust(dark, adjust));
    assert.ok(Math.abs(improved.meanLuma - 128) < Math.abs(stats.meanLuma - 128), "ficou mais perto do equilíbrio de exposição");
    assert.equal(isNeutralPhotoAdjust(adjust), false);
  });

  await check("P8 imagem totalmente transparente/vazia não quebra a análise (ajuste neutro)", () => {
    const empty: RgbaImage = { data: new Uint8ClampedArray(16 * 16 * 4), width: 16, height: 16 };
    const stats = analyzePhoto(empty);
    assert.equal(stats.sampledPixels, 0);
    assert.ok(isNeutralPhotoAdjust(computeAutoAdjust(stats)));
    assert.equal(applyPhotoAdjust(empty, { brightness: 0.2 }).data.every((value) => value === 0), true);
  });

  await check("P9 cor das bordas: média dos cantos opacos; recorte transparente => branco", () => {
    const solid: RgbaImage = { data: new Uint8ClampedArray(40 * 30 * 4), width: 40, height: 30 };
    for (let i = 0; i < solid.data.length; i += 4) { solid.data[i] = 200; solid.data[i + 1] = 100; solid.data[i + 2] = 50; solid.data[i + 3] = 255; }
    assert.equal(estimateEdgeColor(solid), "#C86432");
    const transparent: RgbaImage = { data: new Uint8ClampedArray(40 * 30 * 4), width: 40, height: 30 };
    assert.equal(estimateEdgeColor(transparent), "#FFFFFF");
  });

  console.log(`ADS-PRO photo adjust tests passed: ${checkCount()} checks.`);
}

void main().catch((error) => { console.error(error); process.exit(1); });
