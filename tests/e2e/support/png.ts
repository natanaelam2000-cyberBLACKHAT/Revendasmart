/**
 * PRO-06: PNG encode/decode sem dependências novas (só `node:zlib`), para validar de verdade os
 * arquivos exportados pelo Marketing Pro (dimensões reais, conteúdo de pixel real) em vez de apenas
 * inspecionar metadados. Suporta o único formato que interessa aqui: RGBA 8 bits, não entrelaçado —
 * exatamente o que `canvas.toBlob("image/png")` (marketing-card.ts) produz em todo navegador Chromium.
 */
import { deflateSync, inflateSync } from "node:zlib";

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const typeBuf = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([length, typeBuf, data, crc]);
}

/**
 * Gera um PNG RGBA 8 bits com uma faixa de contraste no centro (para o teste de "não é canvas vazio"
 * também detectar variação de pixel na própria imagem de origem do produto).
 */
export function generateProductTestPng(width: number, height: number, rgb: [number, number, number]): Buffer {
  const [r, g, b] = rgb;
  const [cr, cg, cb] = [255 - r, 255 - g, 255 - b];
  const bytesPerPixel = 4;
  const rowBytes = 1 + width * bytesPerPixel;
  const raw = Buffer.alloc(rowBytes * height);
  const bandStart = Math.floor(height * 0.35);
  const bandEnd = Math.floor(height * 0.65);
  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * rowBytes;
    raw[rowOffset] = 0; // filter: None
    const inBand = y >= bandStart && y < bandEnd;
    for (let x = 0; x < width; x += 1) {
      const pixelOffset = rowOffset + 1 + x * bytesPerPixel;
      raw[pixelOffset] = inBand ? cr : r;
      raw[pixelOffset + 1] = inBand ? cg : g;
      raw[pixelOffset + 2] = inBand ? cb : b;
      raw[pixelOffset + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace
  const idat = deflateSync(raw);
  return Buffer.concat([SIGNATURE, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

/**
 * PRO-07: variante com margem branca/uniforme ao redor de um bloco de cor central — o formato que a
 * heurística local de remoção de fundo (product-cutout-local-heuristic.ts) espera (fundo liso
 * conectado à borda). `generateProductTestPng` acima não serve para isso (preenche o canvas inteiro).
 */
export function generateProductOnPlainBackgroundPng(
  size: number,
  marginFraction: number,
  productColor: [number, number, number],
): Buffer {
  const [r, g, b] = productColor;
  const bytesPerPixel = 4;
  const rowBytes = 1 + size * bytesPerPixel;
  const raw = Buffer.alloc(rowBytes * size);
  const margin = Math.round(size * marginFraction);
  for (let y = 0; y < size; y += 1) {
    const rowOffset = y * rowBytes;
    raw[rowOffset] = 0;
    const inProduct = y >= margin && y < size - margin;
    for (let x = 0; x < size; x += 1) {
      const pixelOffset = rowOffset + 1 + x * bytesPerPixel;
      const isProductPixel = inProduct && x >= margin && x < size - margin;
      const [pr, pg, pb] = isProductPixel ? [r, g, b] : [250, 250, 250];
      raw[pixelOffset] = pr;
      raw[pixelOffset + 1] = pg;
      raw[pixelOffset + 2] = pb;
      raw[pixelOffset + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const idat = deflateSync(raw);
  return Buffer.concat([SIGNATURE, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

export type DecodedPng = {
  width: number;
  height: number;
  colorType: number;
  bitDepth: number;
  /** RGBA, 8 bits por canal, linha a linha, sem byte de filtro. */
  pixels: Buffer;
};

function paethPredictor(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

export function decodePng(buffer: Buffer): DecodedPng {
  if (!buffer.subarray(0, 8).equals(SIGNATURE)) throw new Error("Assinatura PNG inválida");
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idatChunks: Buffer[] = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      if (data[12] !== 0) throw new Error("PNG entrelaçado não suportado por este decoder de teste");
    } else if (type === "IDAT") {
      idatChunks.push(Buffer.from(data));
    } else if (type === "IEND") {
      break;
    }
    offset += 12 + length;
  }
  if (!width || !height) throw new Error("IHDR ausente ou inválido");
  if (bitDepth !== 8 || (colorType !== 6 && colorType !== 2)) {
    throw new Error(`Formato PNG não suportado por este decoder de teste: bitDepth=${bitDepth} colorType=${colorType}`);
  }
  const channels = colorType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idatChunks));
  const rowBytes = width * channels;
  const pixels = Buffer.alloc(width * height * 4);
  let prevRow = Buffer.alloc(rowBytes);
  for (let y = 0; y < height; y += 1) {
    const srcOffset = y * (rowBytes + 1);
    const filterType = raw[srcOffset];
    const row = Buffer.from(raw.subarray(srcOffset + 1, srcOffset + 1 + rowBytes));
    for (let i = 0; i < rowBytes; i += 1) {
      const a = i >= channels ? row[i - channels] : 0;
      const b = prevRow[i];
      const c = i >= channels ? prevRow[i - channels] : 0;
      let value = row[i];
      if (filterType === 1) value = (value + a) & 0xff;
      else if (filterType === 2) value = (value + b) & 0xff;
      else if (filterType === 3) value = (value + Math.floor((a + b) / 2)) & 0xff;
      else if (filterType === 4) value = (value + paethPredictor(a, b, c)) & 0xff;
      row[i] = value;
    }
    for (let x = 0; x < width; x += 1) {
      const rowPixelOffset = x * channels;
      const outOffset = (y * width + x) * 4;
      pixels[outOffset] = row[rowPixelOffset];
      pixels[outOffset + 1] = row[rowPixelOffset + 1];
      pixels[outOffset + 2] = row[rowPixelOffset + 2];
      pixels[outOffset + 3] = channels === 4 ? row[rowPixelOffset + 3] : 255;
    }
    prevRow = row;
  }
  return { width, height, colorType, bitDepth, pixels };
}

/** Desvio-padrão de luminância numa região retangular — usado para detectar "canvas vazio/uniforme". */
export function regionLuminanceStdDev(png: DecodedPng, x0: number, y0: number, x1: number, y1: number): number {
  const values: number[] = [];
  for (let y = Math.max(0, y0); y < Math.min(png.height, y1); y += 1) {
    for (let x = Math.max(0, x0); x < Math.min(png.width, x1); x += 1) {
      const offset = (y * png.width + x) * 4;
      const luminance = 0.299 * png.pixels[offset] + 0.587 * png.pixels[offset + 1] + 0.114 * png.pixels[offset + 2];
      values.push(luminance);
    }
  }
  if (!values.length) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}
