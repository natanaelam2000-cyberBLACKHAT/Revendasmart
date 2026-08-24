/**
 * RELEASE-06 — validação de conteúdo real de imagem (magic bytes + dimensões), independente de
 * `contentType` declarado/extensão. Firebase Storage Rules só enxergam metadata (tamanho,
 * `contentType` declarado no request) — nunca os bytes em si — então a única fronteira capaz de provar
 * "isto É realmente um JPEG/PNG/WebP" é este módulo, chamado a partir do servidor antes de gravar no
 * Storage.
 *
 * Portado do parser binário já existente em `script/marketing-pro-benchmark/image-dimensions.ts`
 * (JPEG/PNG) e estendido com WebP — deliberadamente reescrito aqui em `shared/` (sem `Buffer`, só
 * `Uint8Array`) em vez de importado de `script/`: `script/` é um sandbox Node-only que nunca deve virar
 * dependência de runtime do client/server (mesmo raciocínio já aplicado em PRO-07K/PRO-07J). Sem
 * dependência nova — nenhum Sharp/Jimp/OpenCV.
 *
 * Só LÊ cabeçalhos binários (nunca decodifica/aloca a imagem inteira) — por isso é seguro rejeitar uma
 * "image bomb" (dimensões absurdas declaradas no cabeçalho) sem nunca chegar a alocar o buffer de pixels.
 */

export type SupportedImageFormat = "image/jpeg" | "image/png" | "image/webp";

export const SUPPORTED_IMAGE_FORMATS: readonly SupportedImageFormat[] = ["image/jpeg", "image/png", "image/webp"];

export interface ImagePixelDimensions {
  readonly width: number;
  readonly height: number;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function asciiAt(bytes: Uint8Array, offset: number, length: number): string {
  if (offset + length > bytes.length) return "";
  let result = "";
  for (let i = 0; i < length; i += 1) result += String.fromCharCode(bytes[offset + i]);
  return result;
}

function readUint16BE(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] << 8) | bytes[offset + 1];
}

function readUint32BE(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
}

function readUint16LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readUint32LE(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
}

/**
 * Assinatura real dos 3 formatos aceitos, verificada byte a byte — nunca a extensão do nome do arquivo,
 * nunca o `contentType` declarado pelo cliente. `null` quando os bytes não começam como nenhum dos três.
 */
export function detectImageFormatFromMagicBytes(bytes: Uint8Array): SupportedImageFormat | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && PNG_SIGNATURE.every((value, index) => bytes[index] === value)) return "image/png";
  if (bytes.length >= 12 && asciiAt(bytes, 0, 4) === "RIFF" && asciiAt(bytes, 8, 4) === "WEBP") return "image/webp";
  return null;
}

/** JPEG: sequência de marcadores `0xFF <marker>`. SOF0–SOFxx carregam altura/largura logo após o marcador. */
function readJpegDimensions(bytes: Uint8Array): ImagePixelDimensions | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 1 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1];
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    if (offset + 4 > bytes.length) return null;
    const segmentLength = readUint16BE(bytes, offset + 2);
    const isStartOfFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isStartOfFrame) {
      if (offset + 9 > bytes.length) return null;
      const height = readUint16BE(bytes, offset + 5);
      const width = readUint16BE(bytes, offset + 7);
      return { width, height };
    }
    if (segmentLength < 2) return null;
    offset += 2 + segmentLength;
  }
  return null;
}

/** PNG: assinatura de 8 bytes + chunk IHDR (width/height big-endian nos bytes 16-23). */
function readPngDimensions(bytes: Uint8Array): ImagePixelDimensions | null {
  if (bytes.length < 24) return null;
  if (!PNG_SIGNATURE.every((value, index) => bytes[index] === value)) return null;
  if (asciiAt(bytes, 12, 4) !== "IHDR") return null;
  return { width: readUint32BE(bytes, 16), height: readUint32BE(bytes, 20) };
}

/**
 * WebP (RIFF container): dispatch pelo fourCC em offset 12 — VP8X (extended, o formato mais comum hoje
 * em dia por causa de alpha/animation), VP8 (lossy simples) ou VP8L (lossless). Layout de cada um é
 * parte estável da especificação pública do formato, nunca muda entre arquivos.
 */
function readWebpDimensions(bytes: Uint8Array): ImagePixelDimensions | null {
  if (bytes.length < 30) return null;
  if (asciiAt(bytes, 0, 4) !== "RIFF" || asciiAt(bytes, 8, 4) !== "WEBP") return null;
  const fourCC = asciiAt(bytes, 12, 4);

  if (fourCC === "VP8X") {
    const width = (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16)) + 1;
    const height = (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16)) + 1;
    return { width, height };
  }

  if (fourCC === "VP8 ") {
    // Bytes 23-25 precisam ser o sync code 0x9d 0x01 0x2a — sem ele não é um frame VP8 válido.
    if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) return null;
    const width = readUint16LE(bytes, 26) & 0x3fff;
    const height = readUint16LE(bytes, 28) & 0x3fff;
    return { width, height };
  }

  if (fourCC === "VP8L") {
    if (bytes.length < 25 || bytes[20] !== 0x2f) return null;
    const bits = readUint32LE(bytes, 21);
    const width = (bits & 0x3fff) + 1;
    const height = ((bits >>> 14) & 0x3fff) + 1;
    return { width, height };
  }

  return null;
}

/** Nunca inventa dimensão: `null` para bytes truncados/corrompidos/formato não reconhecido. */
export function readImagePixelDimensions(bytes: Uint8Array, format: SupportedImageFormat): ImagePixelDimensions | null {
  if (format === "image/jpeg") return readJpegDimensions(bytes);
  if (format === "image/png") return readPngDimensions(bytes);
  return readWebpDimensions(bytes);
}

export interface ImageUploadLimits {
  readonly maxBytes: number;
  /**
   * Teto anti-abuso/memória, não estético — 25 megapixels cobre com folga qualquer foto legítima de
   * produto (o app já comprime para no máx. 1200×1200 = 1.44MP antes do upload) inclusive fotos de
   * câmera de celular sem compressão prévia (tipicamente 12–48MP em fatias comuns), mas recusa
   * cabeçalhos com dimensões declaradas absurdas — sem nunca alocar o buffer de pixels para saber isso,
   * já que só o CABEÇALHO é lido.
   */
  readonly maxMegapixels: number;
  readonly minDimensionPx: number;
}

/** 5MB — o MESMO valor de `isValidImageUpload()`/`isValidApprovedCutoutUpload()` em storage.rules;
 * cliente/servidor/Rules precisam concordar, nunca divergir. */
export const IMAGE_UPLOAD_MAX_BYTES = 5 * 1024 * 1024;
export const IMAGE_UPLOAD_MAX_MEGAPIXELS = 25;
export const IMAGE_UPLOAD_MIN_DIMENSION_PX = 1;

export const DEFAULT_IMAGE_UPLOAD_LIMITS: ImageUploadLimits = {
  maxBytes: IMAGE_UPLOAD_MAX_BYTES,
  maxMegapixels: IMAGE_UPLOAD_MAX_MEGAPIXELS,
  minDimensionPx: IMAGE_UPLOAD_MIN_DIMENSION_PX,
};

/** approvedCutout já é contratualmente PNG-only (shared/approved-product-cutout.ts, PRO-07K) — mesmos
 * limites de tamanho/megapixel, formato único. */
export const CUTOUT_UPLOAD_LIMITS: ImageUploadLimits = {
  maxBytes: IMAGE_UPLOAD_MAX_BYTES,
  maxMegapixels: IMAGE_UPLOAD_MAX_MEGAPIXELS,
  minDimensionPx: IMAGE_UPLOAD_MIN_DIMENSION_PX,
};

export type ImageUploadRejectionReason =
  | "empty"
  | "too-large"
  | "unsupported-format"
  | "mime-mismatch"
  | "corrupt-or-truncated"
  | "invalid-dimensions"
  | "megapixels-exceeded";

export type ImageUploadValidationResult =
  | {
      readonly accepted: true;
      readonly format: SupportedImageFormat;
      readonly width: number;
      readonly height: number;
      readonly byteSize: number;
    }
  | { readonly accepted: false; readonly reason: ImageUploadRejectionReason };

/**
 * Único ponto de validação real de upload de imagem — magic bytes, cross-check contra o `contentType`
 * declarado, dimensões reais lidas do cabeçalho, tamanho e megapixels. Fail-closed: qualquer
 * inconsistência rejeita, nunca tenta "corrigir" ou adivinhar o formato real.
 */
export function validateImageUploadBytes(
  bytes: Uint8Array,
  declaredMimeType: string,
  limits: ImageUploadLimits = DEFAULT_IMAGE_UPLOAD_LIMITS,
): ImageUploadValidationResult {
  if (bytes.length === 0) return { accepted: false, reason: "empty" };
  if (bytes.length > limits.maxBytes) return { accepted: false, reason: "too-large" };

  const realFormat = detectImageFormatFromMagicBytes(bytes);
  if (!realFormat) return { accepted: false, reason: "unsupported-format" };

  const normalizedDeclared = String(declaredMimeType || "").trim().toLowerCase().split(";")[0];
  if (normalizedDeclared !== realFormat) return { accepted: false, reason: "mime-mismatch" };

  const dimensions = readImagePixelDimensions(bytes, realFormat);
  if (!dimensions) return { accepted: false, reason: "corrupt-or-truncated" };
  if (
    !Number.isFinite(dimensions.width) || !Number.isFinite(dimensions.height)
    || dimensions.width < limits.minDimensionPx || dimensions.height < limits.minDimensionPx
  ) {
    return { accepted: false, reason: "invalid-dimensions" };
  }

  const megapixels = (dimensions.width * dimensions.height) / 1_000_000;
  if (megapixels > limits.maxMegapixels) return { accepted: false, reason: "megapixels-exceeded" };

  return { accepted: true, format: realFormat, width: dimensions.width, height: dimensions.height, byteSize: bytes.length };
}
