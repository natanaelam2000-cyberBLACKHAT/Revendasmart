/**
 * ADS-PRO-FINAL — limiares ADAPTATIVOS para o recorte local (flood-fill a partir das bordas).
 *
 * A heurística original (`product-cutout-local-heuristic.ts`) só reconhece fundo "quase branco" (canal mínimo >= 235).
 * Foto de produto de verdade costuma ter fundo de estúdio levemente cinza/bege (≈ 225–240) — e falhava com a
 * mensagem "não achamos um fundo liso" mesmo sendo um fundo liso. Aqui a cor do fundo é ESTIMADA pela mediana das
 * bordas e os limiares acompanham essa cor, sem nunca aceitar fundo escuro/médio (o recorte continua fail-closed:
 * foto sem fundo claro e liso segue usando a foto original) e sem nunca ficar mais permissivo que o necessário
 * (o limiar é "cor do fundo − 12", limitado a [205, 235]).
 *
 * Puro: recebe pixels RGBA já decodificados.
 */
export interface BackdropCutoutOptions {
  readonly whiteThreshold: number;
  readonly maxChannelSpread: number;
}

export interface CutoutPixels {
  readonly data: Uint8ClampedArray | Uint8Array;
  readonly width: number;
  readonly height: number;
}

const MAX_SAMPLES = 1600;
const MIN_BACKDROP_LUMINANCE_FLOOR = 200;
const THRESHOLD_MARGIN = 12;
const THRESHOLD_MIN = 205;
const THRESHOLD_MAX = 235;

function median(values: number[]): number {
  values.sort((a, b) => a - b);
  return values[Math.floor(values.length / 2)];
}

/** `null` = a borda não parece um fundo claro e liso (use a heurística padrão, que vai falhar de forma honesta). */
export function estimateLightBackdropOptions(image: CutoutPixels): BackdropCutoutOptions | null {
  const { data, width, height } = image;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 4 || height < 4 || data.length < width * height * 4) return null;
  const perimeter = 2 * (width + height);
  const step = Math.max(1, Math.floor(perimeter / MAX_SAMPLES));
  const reds: number[] = []; const greens: number[] = []; const blues: number[] = [];
  const take = (x: number, y: number) => {
    const o = (y * width + x) * 4;
    if (data[o + 3] < 128) return; // transparente não diz nada sobre o fundo
    reds.push(data[o]); greens.push(data[o + 1]); blues.push(data[o + 2]);
  };
  for (let x = 0; x < width; x += step) { take(x, 0); take(x, height - 1); }
  for (let y = 0; y < height; y += step) { take(0, y); take(width - 1, y); }
  if (reds.length < 16) return null;
  const r = median(reds); const g = median(greens); const b = median(blues);
  const lowest = Math.min(r, g, b);
  const spread = Math.max(r, g, b) - lowest;
  if (lowest < MIN_BACKDROP_LUMINANCE_FLOOR) return null;
  return {
    whiteThreshold: Math.min(THRESHOLD_MAX, Math.max(THRESHOLD_MIN, lowest - THRESHOLD_MARGIN)),
    maxChannelSpread: Math.min(36, Math.max(18, spread + 14)),
  };
}

export interface OpaqueBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Caixa que contém o produto (pixels com alfa > `alphaThreshold`) num recorte, com respiro proporcional.
 * Um recorte do mesmo tamanho da foto tem margens transparentes enormes — sem aparar, o produto aparece pequeno
 * no anúncio. `null` = recorte vazio ou que já ocupa quase tudo (nada a aparar).
 */
export function computeOpaqueBounds(image: CutoutPixels, options: { alphaThreshold?: number; paddingRatio?: number; skipAboveCoverage?: number } = {}): OpaqueBounds | null {
  const { data, width, height } = image;
  const alphaThreshold = options.alphaThreshold ?? 8;
  const paddingRatio = options.paddingRatio ?? 0.05;
  const skipAboveCoverage = options.skipAboveCoverage ?? 0.9;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || data.length < width * height * 4) return null;
  let minX = width; let minY = height; let maxX = -1; let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (data[(y * width + x) * 4 + 3] <= alphaThreshold) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < minX || maxY < minY) return null;
  const boxWidth = maxX - minX + 1;
  const boxHeight = maxY - minY + 1;
  const padding = Math.max(2, Math.round(Math.max(boxWidth, boxHeight) * paddingRatio));
  const x = Math.max(0, minX - padding);
  const y = Math.max(0, minY - padding);
  const right = Math.min(width, maxX + 1 + padding);
  const bottom = Math.min(height, maxY + 1 + padding);
  const bounds = { x, y, width: right - x, height: bottom - y };
  if ((bounds.width * bounds.height) / (width * height) >= skipAboveCoverage) return null;
  return bounds;
}
