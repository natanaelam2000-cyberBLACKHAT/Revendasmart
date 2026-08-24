/**
 * PRO-09 §6 — gate quantitativo de "calma visual" nas zonas reservadas (produto + texto/CTA), ANTES do
 * Storage. Usa as MESMAS zonas do Composer (`MARKETING_PRO_PRODUCT_ZONE`/`MARKETING_PRO_TEXT_ZONE`,
 * shared/marketing-pro-contract.ts) — nunca uma geometria própria e divergente.
 *
 * DECODE: este projeto não tem nenhuma biblioteca de imagem (sem sharp/jimp/canvas nativo, ver
 * `shared/image-validation.ts`). Um decoder de JPEG correto (Huffman + IDCT) é grande demais e arriscado
 * demais para escrever à mão sem um corpus real de teste — um decoder sutilmente errado daria FALSA
 * confiança de segurança, pior que não ter o gate. Em vez disso, este módulo implementa um decoder PNG
 * real (só `zlib`, nativo do Node, já usado pelo próprio formato PNG) — suficiente porque o provider é
 * pedido explicitamente em PNG (`server/marketing-pro-provider-google.ts`). Se o provider devolver JPEG
 * mesmo assim (comportamento histórico documentado no benchmark), este gate FALHA FECHADO por
 * `"FORMAT_NOT_DECODABLE"` — não finge decodificar o que não decodifica.
 *
 * Suporta só PNG bitDepth=8, colorType 0 (gray) ou 2 (RGB), sem interlace — o caso comum de saída de
 * modelo de imagem. Qualquer variação fora disso (paleta, 16-bit, interlaced, alpha — que já é rejeitado
 * antes por `marketing-pro-image-binary-gate.ts`) também falha fechado, pelo mesmo motivo.
 */
import { inflateSync } from "node:zlib";
import type { MarketingProRect } from "../shared/marketing-pro-contract";
import type { PerceivedBrightness } from "../shared/marketing-pro-creative-intelligence";

export const MARKETING_PRO_SAFE_ZONE_THRESHOLDS_V1 = {
  version: 1,
  productZone: { maxLuminanceStdDev: 0.18, maxStrongEdgeDensity: 0.12 },
  textZone: { maxStrongEdgeDensity: 0.15 },
  /** Magnitude de gradiente de luminância (0..~2, soma de dois diffs normalizados) considerada "borda forte". */
  strongEdgeGradientThreshold: 0.15,
} as const;

export type MarketingProSafeZoneRejectionCode =
  | "FORMAT_NOT_DECODABLE"
  | "PNG_UNSUPPORTED_VARIANT"
  | "PNG_DECODE_FAILED"
  | "PRODUCT_ZONE_TOO_BUSY"
  | "TEXT_ZONE_TOO_BUSY";

export interface MarketingProDecodedLuminanceImage {
  readonly width: number;
  readonly height: number;
  /** Luminância normalizada [0,1] por pixel, row-major, sem canal alpha. */
  readonly luminance: Float32Array;
}

interface PngChunk {
  readonly type: string;
  readonly data: Uint8Array;
}

function readUint32BE(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function parsePngChunks(bytes: Uint8Array): readonly PngChunk[] | null {
  if (bytes.length < 8 || !PNG_SIGNATURE.every((value, index) => bytes[index] === value)) return null;
  const chunks: PngChunk[] = [];
  let offset = 8;
  while (offset + 8 <= bytes.length) {
    const length = readUint32BE(bytes, offset);
    const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > bytes.length) return null;
    chunks.push({ type, data: bytes.subarray(dataStart, dataEnd) });
    offset = dataEnd + 4; // pula os 4 bytes de CRC, nunca validado aqui (magic bytes/truncamento já checados no binary gate)
    if (type === "IEND") break;
  }
  return chunks;
}

function paethPredictor(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/**
 * Decodifica um PNG bitDepth=8, colorType 0/2, sem interlace, para luminância normalizada por pixel.
 * `null` para qualquer variante fora desse subconjunto suportado, ou dados corrompidos — nunca uma
 * aproximação "quase certa".
 */
export function decodePngToLuminance(bytes: Uint8Array): { ok: true; image: MarketingProDecodedLuminanceImage } | { ok: false; code: "PNG_UNSUPPORTED_VARIANT" | "PNG_DECODE_FAILED" } {
  const chunks = parsePngChunks(bytes);
  if (!chunks) return { ok: false, code: "PNG_DECODE_FAILED" };
  const ihdr = chunks.find((c) => c.type === "IHDR");
  if (!ihdr || ihdr.data.length < 13) return { ok: false, code: "PNG_DECODE_FAILED" };

  const width = readUint32BE(ihdr.data, 0);
  const height = readUint32BE(ihdr.data, 4);
  const bitDepth = ihdr.data[8];
  const colorType = ihdr.data[9];
  const interlace = ihdr.data[12];

  if (bitDepth !== 8 || interlace !== 0 || (colorType !== 0 && colorType !== 2)) {
    return { ok: false, code: "PNG_UNSUPPORTED_VARIANT" };
  }
  if (width <= 0 || height <= 0) return { ok: false, code: "PNG_DECODE_FAILED" };

  const channels = colorType === 2 ? 3 : 1;
  const idatChunks = chunks.filter((c) => c.type === "IDAT");
  if (idatChunks.length === 0) return { ok: false, code: "PNG_DECODE_FAILED" };
  const totalIdatLength = idatChunks.reduce((sum, c) => sum + c.data.length, 0);
  const idatConcatenated = new Uint8Array(totalIdatLength);
  let idatOffset = 0;
  for (const chunk of idatChunks) {
    idatConcatenated.set(chunk.data, idatOffset);
    idatOffset += chunk.data.length;
  }

  let inflated: Buffer;
  try {
    inflated = inflateSync(idatConcatenated);
  } catch {
    return { ok: false, code: "PNG_DECODE_FAILED" };
  }

  const rowBytes = width * channels;
  const expectedLength = (rowBytes + 1) * height;
  if (inflated.length < expectedLength) return { ok: false, code: "PNG_DECODE_FAILED" };

  const pixels = new Uint8ClampedArray(rowBytes * height);
  let prevRow = new Uint8ClampedArray(rowBytes);
  let readOffset = 0;
  for (let y = 0; y < height; y += 1) {
    const filterType = inflated[readOffset];
    readOffset += 1;
    const row = new Uint8ClampedArray(rowBytes);
    for (let x = 0; x < rowBytes; x += 1) {
      const raw = inflated[readOffset + x];
      const a = x >= channels ? row[x - channels] : 0;
      const b = prevRow[x];
      const c = x >= channels ? prevRow[x - channels] : 0;
      let value: number;
      if (filterType === 0) value = raw;
      else if (filterType === 1) value = raw + a;
      else if (filterType === 2) value = raw + b;
      else if (filterType === 3) value = raw + Math.floor((a + b) / 2);
      else if (filterType === 4) value = raw + paethPredictor(a, b, c);
      else return { ok: false, code: "PNG_DECODE_FAILED" };
      row[x] = value & 0xff;
    }
    pixels.set(row, y * rowBytes);
    prevRow = row;
    readOffset += rowBytes;
  }

  const luminance = new Float32Array(width * height);
  for (let i = 0; i < width * height; i += 1) {
    if (channels === 1) {
      luminance[i] = pixels[i] / 255;
    } else {
      const base = i * 3;
      luminance[i] = (0.299 * pixels[base] + 0.587 * pixels[base + 1] + 0.114 * pixels[base + 2]) / 255;
    }
  }

  return { ok: true, image: { width, height, luminance } };
}

function luminanceAt(image: MarketingProDecodedLuminanceImage, x: number, y: number): number {
  const clampedX = Math.min(Math.max(x, 0), image.width - 1);
  const clampedY = Math.min(Math.max(y, 0), image.height - 1);
  return image.luminance[clampedY * image.width + clampedX];
}

export interface MarketingProZoneMetrics {
  readonly luminanceStdDev: number;
  readonly strongEdgeDensity: number;
}

export interface MarketingProHeroContrastSuitability {
  readonly backgroundMeanLuminance: number;
  readonly productBrightness: PerceivedBrightness | undefined;
  readonly expectedDirection: "background-darker" | "background-lighter" | "neutral-separation";
  readonly relativeDifference: number;
  readonly suitable: boolean;
}

export interface MarketingProSafeZoneMetricsReport {
  readonly thresholds: typeof MARKETING_PRO_SAFE_ZONE_THRESHOLDS_V1;
  readonly productZone: {
    readonly name: "product";
    readonly rect: MarketingProRect;
    readonly metrics: MarketingProZoneMetrics;
    readonly violations: readonly ("luminanceStdDev" | "strongEdgeDensity")[];
  };
  readonly textZones: readonly {
    readonly name: string;
    readonly rect: MarketingProRect;
    readonly metrics: MarketingProZoneMetrics;
    readonly violations: readonly "strongEdgeDensity"[];
  }[];
}

/** Métricas puras sobre uma janela retangular fracionária (0..1) da imagem já decodificada. */
export function computeMarketingProZoneMetrics(image: MarketingProDecodedLuminanceImage, rect: MarketingProRect): MarketingProZoneMetrics {
  const x0 = Math.floor(rect.x * image.width);
  const y0 = Math.floor(rect.y * image.height);
  const x1 = Math.min(image.width, Math.ceil((rect.x + rect.width) * image.width));
  const y1 = Math.min(image.height, Math.ceil((rect.y + rect.height) * image.height));
  const pixelCount = Math.max(1, (x1 - x0) * (y1 - y0));

  let sum = 0;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) sum += luminanceAt(image, x, y);
  }
  const mean = sum / pixelCount;

  let variance = 0;
  let strongEdgeCount = 0;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const l = luminanceAt(image, x, y);
      variance += (l - mean) ** 2;
      const gradient = Math.abs(luminanceAt(image, x + 1, y) - luminanceAt(image, x - 1, y))
        + Math.abs(luminanceAt(image, x, y + 1) - luminanceAt(image, x, y - 1));
      if (gradient > MARKETING_PRO_SAFE_ZONE_THRESHOLDS_V1.strongEdgeGradientThreshold) strongEdgeCount += 1;
    }
  }
  const luminanceStdDev = Math.sqrt(variance / pixelCount);
  const strongEdgeDensity = strongEdgeCount / pixelCount;
  return { luminanceStdDev, strongEdgeDensity };
}

export function computeMarketingProZoneMeanLuminance(image: MarketingProDecodedLuminanceImage, rect: MarketingProRect): number {
  const x0 = Math.floor(rect.x * image.width);
  const y0 = Math.floor(rect.y * image.height);
  const x1 = Math.min(image.width, Math.ceil((rect.x + rect.width) * image.width));
  const y1 = Math.min(image.height, Math.ceil((rect.y + rect.height) * image.height));
  const pixelCount = Math.max(1, (x1 - x0) * (y1 - y0));
  let sum = 0;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) sum += luminanceAt(image, x, y);
  }
  return sum / pixelCount;
}

function representativeProductLuminance(brightness: PerceivedBrightness | undefined): number {
  if (brightness === "very_light") return 0.9;
  if (brightness === "light") return 0.78;
  if (brightness === "dark") return 0.24;
  if (brightness === "very_dark") return 0.12;
  return 0.5;
}

export function computeMarketingProHeroContrastSuitability(input: {
  readonly image: MarketingProDecodedLuminanceImage;
  readonly rect: MarketingProRect;
  readonly productBrightness?: PerceivedBrightness;
}): MarketingProHeroContrastSuitability {
  const backgroundMeanLuminance = computeMarketingProZoneMeanLuminance(input.image, input.rect);
  const productLuminance = representativeProductLuminance(input.productBrightness);
  const relativeDifference = Math.abs(productLuminance - backgroundMeanLuminance);
  const expectedDirection =
    input.productBrightness === "light" || input.productBrightness === "very_light"
      ? "background-darker"
      : input.productBrightness === "dark" || input.productBrightness === "very_dark"
        ? "background-lighter"
        : "neutral-separation";
  const directionPass = expectedDirection === "background-darker"
    ? backgroundMeanLuminance < productLuminance - 0.12
    : expectedDirection === "background-lighter"
      ? backgroundMeanLuminance > productLuminance + 0.12
      : relativeDifference >= 0.16;
  return {
    backgroundMeanLuminance,
    productBrightness: input.productBrightness,
    expectedDirection,
    relativeDifference,
    suitable: directionPass && relativeDifference >= 0.16,
  };
}

export type MarketingProSafeZoneGateResult =
  | { readonly accepted: true; readonly metricsReport: MarketingProSafeZoneMetricsReport }
  | { readonly accepted: false; readonly rejectionCode: MarketingProSafeZoneRejectionCode; readonly zone?: string; readonly metricsReport?: MarketingProSafeZoneMetricsReport };

export interface EvaluateMarketingProSafeZoneGateInput {
  readonly bytes: Uint8Array;
  readonly mimeType: string;
  readonly productZone: MarketingProRect;
  readonly textZones: readonly { readonly name: string; readonly rect: MarketingProRect }[];
}

/**
 * Só sabe validar PNG (ver comentário de topo). Qualquer outro `mimeType` falha fechado com
 * `FORMAT_NOT_DECODABLE` — nunca aprova sem ter verificado de verdade.
 */
export function evaluateMarketingProSafeZoneGate(input: EvaluateMarketingProSafeZoneGateInput): MarketingProSafeZoneGateResult {
  if (input.mimeType !== "image/png") {
    return { accepted: false, rejectionCode: "FORMAT_NOT_DECODABLE" };
  }
  const decoded = decodePngToLuminance(input.bytes);
  if (!decoded.ok) {
    return { accepted: false, rejectionCode: decoded.code === "PNG_UNSUPPORTED_VARIANT" ? "PNG_UNSUPPORTED_VARIANT" : "PNG_DECODE_FAILED" };
  }

  const productMetrics = computeMarketingProZoneMetrics(decoded.image, input.productZone);
  const thresholds = MARKETING_PRO_SAFE_ZONE_THRESHOLDS_V1;
  const productViolations = [
    ...(productMetrics.luminanceStdDev > thresholds.productZone.maxLuminanceStdDev ? ["luminanceStdDev" as const] : []),
    ...(productMetrics.strongEdgeDensity > thresholds.productZone.maxStrongEdgeDensity ? ["strongEdgeDensity" as const] : []),
  ];
  const textZoneReports = input.textZones.map((textZone) => {
    const metrics = computeMarketingProZoneMetrics(decoded.image, textZone.rect);
    return {
      name: textZone.name,
      rect: textZone.rect,
      metrics,
      violations: metrics.strongEdgeDensity > thresholds.textZone.maxStrongEdgeDensity ? ["strongEdgeDensity" as const] : [],
    };
  });
  const metricsReport: MarketingProSafeZoneMetricsReport = {
    thresholds,
    productZone: { name: "product", rect: input.productZone, metrics: productMetrics, violations: productViolations },
    textZones: textZoneReports,
  };
  if (productViolations.length > 0) {
    return { accepted: false, rejectionCode: "PRODUCT_ZONE_TOO_BUSY", zone: "product", metricsReport };
  }

  for (const textZone of textZoneReports) {
    if (textZone.violations.length > 0) {
      return { accepted: false, rejectionCode: "TEXT_ZONE_TOO_BUSY", zone: textZone.name, metricsReport };
    }
  }

  return { accepted: true, metricsReport };
}
