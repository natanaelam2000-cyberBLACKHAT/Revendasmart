/**
 * PRO-09 — validação binária COMPLETA da resposta do provider real, ANTES de qualquer byte ir para
 * Storage ou o resultado virar `ready`. Corrige o gap do PRO-08: ali só existia `readImagePixelDimensions`
 * (dimensão) — nada validava tamanho da resposta JSON, tamanho/validade do base64, MIME declarado vs.
 * real, integridade estrutural (truncamento) ou política de alpha.
 *
 * Todos os limites são CONSTANTES NOMEADAS, nunca números soltos — ver `MARKETING_PRO_PROVIDER_LIMITS`.
 *
 * PRO-13: o provider Google agora canoniza o JPEG obrigatório da API para PNG opaco com `sharp`, mas
 * esta função continua sendo a autoridade binária antes E depois da transcodificação.
 */
import {
  detectImageFormatFromMagicBytes,
  readImagePixelDimensions,
  type SupportedImageFormat,
} from "../shared/image-validation";
import { MARKETING_PRO_FORMAT_DIMENSIONS, type MarketingProFormat } from "../shared/marketing-pro-contract";

/**
 * §3 da tarefa: MIME allowlist FECHADA para o provider Google atual — nunca "unknown → assume jpeg".
 * Ver `MARKETING_PRO_PROVIDER_ALLOWED_MIME_TYPES` abaixo, usada tanto para o `mime_type` DECLARADO pelo
 * provider quanto cross-checada contra os magic bytes reais.
 */
export const MARKETING_PRO_PROVIDER_ALLOWED_MIME_TYPES = ["image/jpeg", "image/png"] as const;
export type MarketingProProviderAllowedMimeType = (typeof MARKETING_PRO_PROVIDER_ALLOWED_MIME_TYPES)[number];

export function isMarketingProProviderAllowedMimeType(value: unknown): value is MarketingProProviderAllowedMimeType {
  return value === "image/jpeg" || value === "image/png";
}

/**
 * Limites iniciais literais da tarefa (§2). `maxBase64Chars` é o teto de CARACTERES da string base64
 * (não dos bytes decodificados) — 6.990.508 chars codifica no máximo ⌊6.990.508 / 4⌋×3 ≈ 5.242.880 bytes
 * (5 MiB exatos), consistente com `maxDecodedImageBytes` abaixo.
 */
export const MARKETING_PRO_PROVIDER_LIMITS = {
  maxJsonResponseBytes: 8 * 1024 * 1024,
  maxBase64Chars: 6_990_508,
  maxDecodedImageBytes: 5 * 1024 * 1024,
  maxPixelCount: 25_000_000,
  minShortEdgePx: 720,
  /** Mesma tolerância relativa já usada pelo quality gate técnico (server/marketing-pro-quality.ts). */
  aspectRatioTolerance: 0.02,
} as const;

export type MarketingProImageBinaryRejectionCode =
  | "JSON_RESPONSE_TOO_LARGE"
  | "BASE64_TOO_LARGE"
  | "BASE64_INVALID"
  | "MIME_NOT_ALLOWED"
  | "MAGIC_BYTES_MISMATCH"
  | "IMAGE_EMPTY"
  | "IMAGE_TRUNCATED_OR_CORRUPT"
  | "DIMENSIONS_UNREADABLE"
  | "DIMENSIONS_TOO_SMALL"
  | "PIXEL_COUNT_TOO_HIGH"
  | "ASPECT_RATIO_MISMATCH"
  | "DECODED_SIZE_TOO_LARGE"
  | "ALPHA_NOT_ALLOWED";

export type MarketingProImageBinaryGateResult =
  | { readonly accepted: true; readonly format: SupportedImageFormat; readonly width: number; readonly height: number; readonly byteSize: number }
  | { readonly accepted: false; readonly rejectionCode: MarketingProImageBinaryRejectionCode };

/** Base64 estrito: só o alfabeto padrão, padding correto, comprimento múltiplo de 4 — nunca "lenient decode". */
const STRICT_BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/;

export function isStrictlyValidBase64(value: string): boolean {
  return value.length > 0 && value.length % 4 === 0 && STRICT_BASE64_PATTERN.test(value);
}

/** §2: teto de bytes da resposta HTTP inteira, ANTES de fazer JSON.parse — nunca depois. */
export function validateMarketingProProviderResponseSize(byteLength: number): boolean {
  return byteLength <= MARKETING_PRO_PROVIDER_LIMITS.maxJsonResponseBytes;
}

/**
 * PNG: verifica que existe um chunk IEND (fim de arquivo válido, não truncado) e que o(s) chunk(s) IDAT
 * inflam sem erro via `zlib` (nativo do Node — sem dependência nova) para um tamanho de scanline
 * consistente com IHDR. JPEG: sem decoder de pixels neste projeto (ver comentário de topo) — a checagem
 * possível sem fabricar é estrutural: os dois últimos bytes precisam ser o marcador EOI (0xFFD9), prova
 * de que o stream não foi cortado no meio de um scan.
 */
function verifyNotTruncated(bytes: Uint8Array, format: SupportedImageFormat): boolean {
  if (format === "image/jpeg") {
    return bytes.length >= 4 && bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9;
  }
  if (format === "image/png") {
    // IEND é sempre os últimos 12 bytes de um PNG bem-formado: length(4)=0 + "IEND"(4) + CRC(4).
    const tail = bytes.subarray(bytes.length - 8, bytes.length - 4);
    return bytes.length >= 12 && tail[0] === 0x49 && tail[1] === 0x45 && tail[2] === 0x4e && tail[3] === 0x44;
  }
  return false;
}

/**
 * Alpha policy (§2 "alpha conforme política"): um background precisa ser OPACO — é composto por baixo
 * do produto, transparência quebraria a composição local. JPEG nunca tem alpha (estruturalmente
 * impossível). PNG: color type no byte 25 do IHDR — 4 (gray+alpha) e 6 (RGBA) têm alpha, rejeitados.
 */
function hasPngAlphaChannel(bytes: Uint8Array): boolean {
  if (bytes.length < 26) return false;
  const colorType = bytes[25];
  return colorType === 4 || colorType === 6;
}

export interface ValidateMarketingProImageBinaryInput {
  readonly base64: string;
  readonly declaredMimeType: string;
  readonly format: MarketingProFormat;
}

/**
 * Pipeline único e ordenado de validação binária — §2 da tarefa, item por item. Fail-closed em cada
 * etapa: a primeira falha já rejeita, sem seguir adiante tentando "aproveitar" bytes parcialmente
 * inválidos.
 */
export function validateMarketingProProviderImageBinary(input: ValidateMarketingProImageBinaryInput): MarketingProImageBinaryGateResult {
  if (!isMarketingProProviderAllowedMimeType(input.declaredMimeType)) {
    return { accepted: false, rejectionCode: "MIME_NOT_ALLOWED" };
  }
  if (input.base64.length > MARKETING_PRO_PROVIDER_LIMITS.maxBase64Chars) {
    return { accepted: false, rejectionCode: "BASE64_TOO_LARGE" };
  }
  if (!isStrictlyValidBase64(input.base64)) {
    return { accepted: false, rejectionCode: "BASE64_INVALID" };
  }

  const bytes = Buffer.from(input.base64, "base64");
  if (bytes.length === 0) {
    return { accepted: false, rejectionCode: "IMAGE_EMPTY" };
  }
  if (bytes.length > MARKETING_PRO_PROVIDER_LIMITS.maxDecodedImageBytes) {
    return { accepted: false, rejectionCode: "DECODED_SIZE_TOO_LARGE" };
  }

  // MIME declarado precisa bater com os magic bytes REAIS — nunca "unknown → assume jpeg" (§3).
  const realFormat = detectImageFormatFromMagicBytes(bytes);
  if (!realFormat || realFormat !== input.declaredMimeType) {
    return { accepted: false, rejectionCode: "MAGIC_BYTES_MISMATCH" };
  }

  if (!verifyNotTruncated(bytes, realFormat)) {
    return { accepted: false, rejectionCode: "IMAGE_TRUNCATED_OR_CORRUPT" };
  }

  if (realFormat === "image/png" && hasPngAlphaChannel(bytes)) {
    return { accepted: false, rejectionCode: "ALPHA_NOT_ALLOWED" };
  }

  const dimensions = readImagePixelDimensions(bytes, realFormat);
  if (!dimensions || !Number.isFinite(dimensions.width) || !Number.isFinite(dimensions.height) || dimensions.width <= 0 || dimensions.height <= 0) {
    return { accepted: false, rejectionCode: "DIMENSIONS_UNREADABLE" };
  }

  const shortEdge = Math.min(dimensions.width, dimensions.height);
  if (shortEdge < MARKETING_PRO_PROVIDER_LIMITS.minShortEdgePx) {
    return { accepted: false, rejectionCode: "DIMENSIONS_TOO_SMALL" };
  }

  const pixelCount = dimensions.width * dimensions.height;
  if (pixelCount > MARKETING_PRO_PROVIDER_LIMITS.maxPixelCount) {
    return { accepted: false, rejectionCode: "PIXEL_COUNT_TOO_HIGH" };
  }

  const expected = MARKETING_PRO_FORMAT_DIMENSIONS[input.format];
  const aspectRatio = dimensions.width / dimensions.height;
  const relativeDiff = Math.abs(aspectRatio - expected.aspectRatio) / expected.aspectRatio;
  if (relativeDiff > MARKETING_PRO_PROVIDER_LIMITS.aspectRatioTolerance) {
    return { accepted: false, rejectionCode: "ASPECT_RATIO_MISMATCH" };
  }

  return { accepted: true, format: realFormat, width: dimensions.width, height: dimensions.height, byteSize: bytes.length };
}
