/**
 * Leitor mínimo de dimensões de imagem (JPEG/PNG) a partir dos bytes crus — PRO-06B2.2.
 *
 * Por que existe: o adapter do Google pede `aspect_ratio: "4:5"` + `image_size: "1K"`, mas a doc
 * oficial confirma que o Gemini resolve isso para a resolução NATIVA do modelo (ex.: 928×1152), não
 * necessariamente o alvo comercial 1080×1350. Sem ler a dimensão real dos bytes retornados, o adapter
 * só podia ECOAR de volta o que foi pedido — o quality gate nunca veria a dimensão de verdade, e a
 * checagem de aspect ratio (server/marketing-pro-quality.ts) ficaria comparando contra um número
 * fabricado, não a saída real do provider. Sem dependência nova — parsing de marcador binário mínimo.
 */

export interface ImagePixelDimensions {
  readonly width: number;
  readonly height: number;
}

/**
 * JPEG é uma sequência de marcadores `0xFF <marker>`. Os marcadores SOF (Start Of Frame, 0xC0–0xCF
 * exceto 0xC4/0xC8/0xCC, que são DHT/JPG-reservado/DAC) carregam altura/largura no formato:
 * marker(2) + length(2, BE) + precision(1) + height(2, BE) + width(2, BE) + ...
 */
function readJpegDimensions(buf: Buffer): ImagePixelDimensions | null {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 1 < buf.length) {
    if (buf[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buf[offset + 1];
    if (marker === 0xff) {
      offset += 1; // byte de preenchimento entre marcadores
      continue;
    }
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2; // SOI/EOI/RST — sem campo de tamanho
      continue;
    }
    if (offset + 4 > buf.length) return null;
    const segmentLength = buf.readUInt16BE(offset + 2);
    const isStartOfFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isStartOfFrame) {
      if (offset + 9 > buf.length) return null;
      const height = buf.readUInt16BE(offset + 5);
      const width = buf.readUInt16BE(offset + 7);
      return { width, height };
    }
    offset += 2 + segmentLength;
  }
  return null;
}

/** PNG: assinatura de 8 bytes + chunk IHDR (width/height em big-endian nos bytes 16-23). */
function readPngDimensions(buf: Buffer): ImagePixelDimensions | null {
  const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buf.length < 24 || !buf.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
  if (buf.toString("ascii", 12, 16) !== "IHDR") return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/**
 * Dispatch por MIME normalizado. Devolve `null` se o formato não é reconhecido ou os bytes não formam
 * uma imagem válida desse tipo — o chamador decide como tratar isso (nunca inventa uma dimensão).
 */
export function readImagePixelDimensions(bytes: Buffer, mimeType: string): ImagePixelDimensions | null {
  const normalized = mimeType.trim().toLowerCase();
  if (normalized.includes("jpeg") || normalized.includes("jpg")) return readJpegDimensions(bytes);
  if (normalized.includes("png")) return readPngDimensions(bytes);
  return null;
}
