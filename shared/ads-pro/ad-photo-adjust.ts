/**
 * ADS-PRO-FINAL — melhoria de foto LOCAL e SEGURA (sem IA, sem rede, sem custo).
 *
 * Operações puras sobre buffers RGBA: análise (histograma/nitidez), ajuste automático conservador e
 * aplicação de brilho, contraste, saturação e nitidez. A regra de ouro é a mesma do resto do produto:
 * a foto ORIGINAL nunca é alterada — `applyPhotoAdjust` sempre devolve um buffer NOVO; o documento do
 * anúncio guarda só os parâmetros (nunca pixels). O resultado continua sendo a foto real do produto:
 * os limites dos ajustes (ver PHOTO_ADJUST_LIMITS) impedem exageros mesmo se o usuário arrastar tudo ao máximo.
 */
import {
  NEUTRAL_PHOTO_ADJUST,
  PHOTO_ADJUST_LIMITS,
  clampPhotoAdjust,
  isNeutralPhotoAdjust,
  type AdsProPhotoAdjust,
} from "./ad-document";

export interface RgbaImage {
  readonly data: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
}

export interface PhotoStats {
  /** Luma média perceptual (0..255). */
  readonly meanLuma: number;
  /** Percentis 1% e 99% da luma — a "amplitude" real da foto. */
  readonly p01: number;
  readonly p99: number;
  /** Saturação HSV média (0..1). */
  readonly meanSaturation: number;
  /** Variância do Laplaciano da luma (quanto maior, mais nítida). */
  readonly sharpness: number;
  /** Fração de pixels estourados (>=250) / esmagados (<=5). */
  readonly clippedHigh: number;
  readonly clippedLow: number;
  readonly sampledPixels: number;
}

const ALPHA_VISIBLE = 16;

function luma(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/** Analisa uma amostra da foto (passo automático para ficar rápido em fotos grandes). */
export function analyzePhoto(image: RgbaImage): PhotoStats {
  const { data, width, height } = image;
  const step = Math.max(1, Math.floor(Math.sqrt((width * height) / 90000)));
  const histogram = new Uint32Array(256);
  let count = 0; let sumLuma = 0; let sumSat = 0; let high = 0; let low = 0;
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const o = (y * width + x) * 4;
      if (data[o + 3] < ALPHA_VISIBLE) continue;
      const r = data[o]; const g = data[o + 1]; const b = data[o + 2];
      const l = luma(r, g, b);
      histogram[Math.min(255, Math.round(l))] += 1;
      sumLuma += l;
      const max = Math.max(r, g, b); const min = Math.min(r, g, b);
      sumSat += max === 0 ? 0 : (max - min) / max;
      if (l >= 250) high += 1;
      if (l <= 5) low += 1;
      count += 1;
    }
  }
  if (count === 0) return { meanLuma: 128, p01: 0, p99: 255, meanSaturation: 0, sharpness: 0, clippedHigh: 0, clippedLow: 0, sampledPixels: 0 };

  const percentile = (fraction: number) => {
    const target = count * fraction;
    let acc = 0;
    for (let i = 0; i < 256; i += 1) { acc += histogram[i]; if (acc >= target) return i; }
    return 255;
  };

  // Nitidez: variância do Laplaciano numa grade reduzida (~256 px de largura), só em pixels visíveis.
  const gridStep = Math.max(1, Math.floor(width / 256));
  let lapSum = 0; let lapSq = 0; let lapCount = 0;
  const at = (x: number, y: number) => { const o = (y * width + x) * 4; return luma(data[o], data[o + 1], data[o + 2]); };
  for (let y = gridStep; y < height - gridStep; y += gridStep) {
    for (let x = gridStep; x < width - gridStep; x += gridStep) {
      if (data[(y * width + x) * 4 + 3] < ALPHA_VISIBLE) continue;
      const lap = at(x - gridStep, y) + at(x + gridStep, y) + at(x, y - gridStep) + at(x, y + gridStep) - 4 * at(x, y);
      lapSum += lap; lapSq += lap * lap; lapCount += 1;
    }
  }
  const lapMean = lapCount > 0 ? lapSum / lapCount : 0;
  const sharpness = lapCount > 0 ? Math.max(0, lapSq / lapCount - lapMean * lapMean) : 0;

  return {
    meanLuma: sumLuma / count,
    p01: percentile(0.01),
    p99: percentile(0.99),
    meanSaturation: sumSat / count,
    sharpness,
    clippedHigh: high / count,
    clippedLow: low / count,
    sampledPixels: count,
  };
}

/**
 * Ajuste automático CONSERVADOR. Cada correção só entra quando há um problema mensurável (foto escura/clara
 * demais, amplitude curta, cor lavada, pouca nitidez) e é limitada — foto já boa devolve o ajuste neutro.
 */
export function computeAutoAdjust(stats: PhotoStats): AdsProPhotoAdjust {
  if (stats.sampledPixels === 0) return NEUTRAL_PHOTO_ADJUST;
  let brightness = 0;
  let contrast = 1;
  let saturation = 1;
  let sharpness = 0;

  const exposureError = 128 - stats.meanLuma;
  if (Math.abs(exposureError) > 16) brightness = Math.max(-0.12, Math.min(0.18, (exposureError / 255) * 0.55));
  // Não clareia o que já estoura nem escurece o que já está esmagado.
  if (stats.clippedHigh > 0.08 && brightness > 0) brightness = 0;
  if (stats.clippedLow > 0.08 && brightness < 0) brightness = 0;

  const range = stats.p99 - stats.p01;
  if (range < 190 && range > 20) contrast = Math.min(1.22, 220 / range);

  if (stats.meanSaturation < 0.2) saturation = 1.08;

  if (stats.sharpness < 40) sharpness = 0.5;
  else if (stats.sharpness < 120) sharpness = 0.3;
  else if (stats.sharpness < 260) sharpness = 0.12;

  return clampPhotoAdjust({ brightness, contrast, saturation, sharpness });
}

/** true quando o ajuste automático não encontra nada a melhorar (a UI avisa "sua foto já está boa"). */
export function isPhotoAlreadyGood(adjust: AdsProPhotoAdjust): boolean {
  return adjust.brightness === 0 && adjust.contrast <= 1.02 && adjust.saturation === 1 && adjust.sharpness <= 0.12;
}

function clamp255(value: number): number {
  return value < 0 ? 0 : value > 255 ? 255 : value;
}

/**
 * Aplica o ajuste e devolve um buffer NOVO — `image.data` nunca é tocado (a foto original é preservada).
 * Pixels transparentes (recorte) permanecem idênticos; só RGB é alterado, nunca o canal alfa.
 */
export function applyPhotoAdjust(image: RgbaImage, adjustInput: Partial<AdsProPhotoAdjust>): RgbaImage {
  const adjust = clampPhotoAdjust(adjustInput);
  const { width, height } = image;
  const out = new Uint8ClampedArray(image.data); // cópia: o original fica intacto
  if (isNeutralPhotoAdjust(adjust)) return { data: out, width, height };

  const add = adjust.brightness * 255;
  for (let i = 0; i < out.length; i += 4) {
    if (out[i + 3] === 0) continue;
    const r = clamp255((out[i] - 128) * adjust.contrast + 128 + add);
    const g = clamp255((out[i + 1] - 128) * adjust.contrast + 128 + add);
    const b = clamp255((out[i + 2] - 128) * adjust.contrast + 128 + add);
    if (adjust.saturation === 1) { out[i] = r; out[i + 1] = g; out[i + 2] = b; continue; }
    const l = luma(r, g, b);
    out[i] = clamp255(l + (r - l) * adjust.saturation);
    out[i + 1] = clamp255(l + (g - l) * adjust.saturation);
    out[i + 2] = clamp255(l + (b - l) * adjust.saturation);
  }

  if (adjust.sharpness > 0 && width >= 3 && height >= 3) {
    // Máscara de nitidez: original + força * (original - desfoque 3x3). Só RGB.
    const source = new Uint8ClampedArray(out);
    const amount = adjust.sharpness * 1.1;
    for (let y = 1; y < height - 1; y += 1) {
      for (let x = 1; x < width - 1; x += 1) {
        const o = (y * width + x) * 4;
        if (source[o + 3] === 0) continue;
        for (let c = 0; c < 3; c += 1) {
          let sum = 0;
          for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) sum += source[o + (dy * width + dx) * 4 + c];
          const blur = sum / 9;
          out[o + c] = clamp255(source[o + c] + amount * (source[o + c] - blur));
        }
      }
    }
  }
  return { data: out, width, height };
}

export { NEUTRAL_PHOTO_ADJUST, PHOTO_ADJUST_LIMITS };
