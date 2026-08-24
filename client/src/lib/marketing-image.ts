import { getMarketingAdImageCandidates, type MarketingAdConfig } from "./marketing-ad";
import {
  PRODUCT_IMAGE_COORDINATE_SPACE_VERSION,
  type CanonicalDecodeMethod,
  type ProductImageCoordinateSpaceVersion,
} from "@shared/product-image-coordinate-space";

export const MARKETING_IMAGE_ERROR_MESSAGE =
  "Não foi possível preparar a foto deste produto. Verifique a imagem e tente novamente.";

export type MarketingImageTransport = "inline" | "web-fetch" | "capacitor-http";

export type ResolvedMarketingImage = {
  sourceUrl: string;
  safeSrc: string;
  mimeType: string;
  width: number;
  height: number;
  candidateIndex: number;
  transport: MarketingImageTransport;
  /**
   * PRO-07F.2A: metadata canônica do decode (largura/altura já orientadas por EXIF). Opcional para não
   * quebrar fixtures antigas construídas à mão nos testes; o resolver real abaixo sempre preenche os dois.
   */
  decodeMethod?: CanonicalDecodeMethod;
  coordinateSpaceVersion?: ProductImageCoordinateSpaceVersion;
};

type SafeImagePayload = {
  safeSrc: string;
  mimeType: string;
  transport: MarketingImageTransport;
};

type DecodedImageSize = {
  width: number;
  height: number;
};

export type MarketingImageResolverDependencies = {
  browserLoader?: (sourceUrl: string) => Promise<SafeImagePayload | null>;
  nativeLoader?: (sourceUrl: string) => Promise<SafeImagePayload | null>;
  decodeDataUrl?: (safeSrc: string) => Promise<DecodedImageSize | null>;
};

export class MarketingImageResolutionError extends Error {
  readonly code = "marketing-image-unreadable";
  readonly candidateCount: number;

  constructor(candidateCount: number) {
    super(MARKETING_IMAGE_ERROR_MESSAGE);
    this.name = "MarketingImageResolutionError";
    this.candidateCount = candidateCount;
  }
}

const MAX_RESOLVED_IMAGE_CACHE_ENTRIES = 8;
const resolvedImageCache = new Map<string, ResolvedMarketingImage>();
const DATA_IMAGE_RE = /^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$/i;

function normalizeMimeType(value: unknown): string {
  const mime = String(value || "").split(";")[0].trim().toLowerCase();
  if (!/^image\/(?:png|jpe?g|webp|gif|avif)$/.test(mime)) return "";
  return mime === "image/jpg" ? "image/jpeg" : mime;
}

function inferMimeTypeFromUrl(sourceUrl: string): string {
  let path = sourceUrl;
  try {
    const baseUrl = typeof window === "undefined" ? "https://revendasmart.invalid" : window.location.href;
    path = decodeURIComponent(new URL(sourceUrl, baseUrl).pathname);
  } catch {
    // Keep the original value for unusual but valid relative URLs.
  }
  const match = path.match(/\.(png|jpe?g|webp|gif|avif)(?:$|[?#])/i);
  if (!match) return "";
  const extension = match[1].toLowerCase();
  return extension === "jpg" ? "image/jpeg" : `image/${extension}`;
}

function inferMimeTypeFromBytes(bytes: Uint8Array): string {
  const ascii = (start: number, end: number) => Array.from(bytes.slice(start, end), (value) => String.fromCharCode(value)).join("");
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 6 && ascii(0, 6) === "GIF89a") return "image/gif";
  if (bytes.length >= 6 && ascii(0, 6) === "GIF87a") return "image/gif";
  if (bytes.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  if (bytes.length >= 12 && ascii(4, 8) === "ftyp" && /avif|avis/.test(ascii(8, 12))) return "image/avif";
  return "";
}

function decodeBase64Prefix(base64: string): Uint8Array {
  try {
    const decoded = atob(base64.replace(/\s+/g, "").slice(0, 32));
    return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
  } catch {
    return new Uint8Array();
  }
}

function normalizeBase64(value: unknown): string {
  const base64 = String(value || "").replace(/\s+/g, "");
  if (!base64 || !/^[a-z0-9+/]+={0,2}$/i.test(base64)) return "";
  return base64;
}

export function isSafeMarketingImageDataUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = value.match(DATA_IMAGE_RE);
  return Boolean(match && normalizeMimeType(match[1]) && normalizeBase64(match[2]));
}

function getHeader(headers: Record<string, string> | undefined, name: string): string {
  if (!headers) return "";
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase());
  return entry ? String(entry[1] || "") : "";
}

async function readBlobAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("marketing-image-blob-read-failed"));
    reader.onloadend = () => resolve(String(reader.result || ""));
    reader.readAsDataURL(blob);
  });
}

async function loadWithBrowserFetch(sourceUrl: string): Promise<SafeImagePayload | null> {
  if (typeof fetch !== "function") return null;
  const response = await fetch(sourceUrl, {
    mode: "cors",
    credentials: "omit",
    cache: "force-cache",
  });
  if (!response.ok) return null;
  const blob = await response.blob();
  if (!blob.size) return null;
  const bytes = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
  const mimeType = normalizeMimeType(blob.type) || inferMimeTypeFromBytes(bytes) || inferMimeTypeFromUrl(sourceUrl);
  if (!mimeType) return null;
  const typedBlob = blob.type === mimeType ? blob : new Blob([blob], { type: mimeType });
  const safeSrc = await readBlobAsDataUrl(typedBlob);
  return isSafeMarketingImageDataUrl(safeSrc) ? { safeSrc, mimeType, transport: "web-fetch" } : null;
}

async function loadWithCapacitorHttp(sourceUrl: string): Promise<SafeImagePayload | null> {
  const { Capacitor, CapacitorHttp } = await import("@capacitor/core");
  if (!Capacitor.isNativePlatform() || !/^https:\/\//i.test(sourceUrl)) return null;
  const response = await CapacitorHttp.get({
    url: sourceUrl,
    responseType: "arraybuffer",
    connectTimeout: 15_000,
    readTimeout: 20_000,
  });
  if (response.status < 200 || response.status >= 300) return null;
  const base64 = normalizeBase64(response.data);
  if (!base64) return null;
  const mimeType =
    normalizeMimeType(getHeader(response.headers, "content-type")) ||
    inferMimeTypeFromBytes(decodeBase64Prefix(base64)) ||
    inferMimeTypeFromUrl(sourceUrl);
  if (!mimeType) return null;
  return {
    safeSrc: `data:${mimeType};base64,${base64}`,
    mimeType,
    transport: "capacitor-http",
  };
}

async function decodeDataUrl(safeSrc: string): Promise<DecodedImageSize | null> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      const width = image.naturalWidth || image.width;
      const height = image.naturalHeight || image.height;
      resolve(width > 0 && height > 0 ? { width, height } : null);
    };
    image.onerror = () => resolve(null);
    image.src = safeSrc;
  });
}

export async function resolveMarketingImageCandidates(
  candidates: readonly string[],
  dependencies: MarketingImageResolverDependencies = {},
): Promise<ResolvedMarketingImage | null> {
  const orderedCandidates = Array.from(new Set(candidates.map((value) => String(value || "").trim()).filter(Boolean)));
  if (!orderedCandidates.length) return null;

  const useSharedCache = !dependencies.browserLoader && !dependencies.nativeLoader && !dependencies.decodeDataUrl;
  const browserLoader = dependencies.browserLoader || loadWithBrowserFetch;
  const nativeLoader = dependencies.nativeLoader || loadWithCapacitorHttp;
  const decoder = dependencies.decodeDataUrl || decodeDataUrl;

  for (let candidateIndex = 0; candidateIndex < orderedCandidates.length; candidateIndex += 1) {
    const sourceUrl = orderedCandidates[candidateIndex];
    const cached = useSharedCache ? resolvedImageCache.get(sourceUrl) : undefined;
    if (cached) {
      resolvedImageCache.delete(sourceUrl);
      resolvedImageCache.set(sourceUrl, cached);
      return { ...cached, candidateIndex };
    }

    let payload: SafeImagePayload | null = null;
    if (isSafeMarketingImageDataUrl(sourceUrl)) {
      const match = sourceUrl.match(DATA_IMAGE_RE);
      payload = {
        safeSrc: sourceUrl,
        mimeType: normalizeMimeType(match?.[1]),
        transport: "inline",
      };
    } else {
      try {
        payload = await browserLoader(sourceUrl);
      } catch {
        payload = null;
      }
      if (!payload) {
        try {
          payload = await nativeLoader(sourceUrl);
        } catch {
          payload = null;
        }
      }
    }

    if (!payload || !isSafeMarketingImageDataUrl(payload.safeSrc)) continue;
    const dimensions = await decoder(payload.safeSrc).catch(() => null);
    if (!dimensions) continue;

    const resolved: ResolvedMarketingImage = {
      sourceUrl,
      safeSrc: payload.safeSrc,
      mimeType: normalizeMimeType(payload.mimeType),
      width: dimensions.width,
      height: dimensions.height,
      candidateIndex,
      transport: payload.transport,
      // PRO-07F.2A: o decoder padrão (decodeDataUrl, acima) é `new Image()` — o único mecanismo real
      // usado em produção hoje (mesmo raciocínio de decodeCanonicalProductImage, PRO-07F.1). Um
      // `dependencies.decodeDataUrl` injetado só existe em teste, nunca troca esse mecanismo real.
      decodeMethod: "html-image-element",
      coordinateSpaceVersion: PRODUCT_IMAGE_COORDINATE_SPACE_VERSION,
    };
    if (useSharedCache) {
      resolvedImageCache.set(sourceUrl, resolved);
      while (resolvedImageCache.size > MAX_RESOLVED_IMAGE_CACHE_ENTRIES) {
        const oldestKey = resolvedImageCache.keys().next().value;
        if (typeof oldestKey !== "string") break;
        resolvedImageCache.delete(oldestKey);
      }
    }
    return resolved;
  }

  throw new MarketingImageResolutionError(orderedCandidates.length);
}

export function resolveMarketingProductImage(
  config: Pick<MarketingAdConfig, "productImageUrl" | "imageUrl" | "photoUrl" | "image">,
  dependencies?: MarketingImageResolverDependencies,
) {
  return resolveMarketingImageCandidates(getMarketingAdImageCandidates(config), dependencies);
}

/**
 * Fonte de imagem que o Marketing consegue enxergar — os mesmos campos que ProductImageCard já usa
 * em Produtos, incluindo `imageId`, que aponta para uma foto guardada no IndexedDB local.
 *
 * Antes desta função, um produto cujo ÚNICO retrato estava em `imageId` aparecia normalmente na tela
 * de Produtos mas era invisível para o anúncio: o card saía sem foto (ou falhava), embora o usuário
 * estivesse vendo a imagem a poucos toques dali.
 */
export type MarketingImageSource = {
  productImageUrl?: unknown;
  imageUrl?: unknown;
  photoUrl?: unknown;
  image?: unknown;
  thumbnailUrl?: unknown;
  photo?: unknown;
  imageId?: unknown;
};

const asTrimmedString = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

/** Existe alguma origem de imagem? Síncrono de propósito: serve para travar botões sem esperar I/O. */
export function hasMarketingImageSource(source: MarketingImageSource | null | undefined): boolean {
  if (!source) return false;
  return Boolean(
    asTrimmedString(source.productImageUrl) || asTrimmedString(source.imageUrl) || asTrimmedString(source.photoUrl)
    || asTrimmedString(source.image) || asTrimmedString(source.thumbnailUrl) || asTrimmedString(source.photo)
    || asTrimmedString(source.imageId),
  );
}

/**
 * Monta a lista de candidatas na ordem de preferência, resolvendo `imageId` no armazenamento local.
 * A busca por `imageId` nunca derruba o fluxo: se falhar, as demais candidatas seguem valendo.
 */
export async function collectMarketingImageCandidates(
  source: MarketingImageSource | null | undefined,
  loadStoredImage?: (imageId: string) => Promise<string | null | undefined>,
): Promise<string[]> {
  if (!source) return [];
  // Reaproveita a ordem já estabelecida para os quatro campos clássicos, sem duplicar a regra.
  const candidates = getMarketingAdImageCandidates({
    productImageUrl: asTrimmedString(source.productImageUrl),
    imageUrl: asTrimmedString(source.imageUrl),
    photoUrl: asTrimmedString(source.photoUrl),
    image: asTrimmedString(source.image),
  } as Pick<MarketingAdConfig, "productImageUrl" | "imageUrl" | "photoUrl" | "image">);

  for (const extra of [asTrimmedString(source.thumbnailUrl), asTrimmedString(source.photo)]) {
    if (extra) candidates.push(extra);
  }

  const imageId = asTrimmedString(source.imageId);
  if (imageId) {
    try {
      const loader = loadStoredImage ?? (await import("./mock-data")).getImage;
      const stored = await loader(imageId);
      const storedUrl = asTrimmedString(stored);
      if (storedUrl) candidates.push(storedUrl);
    } catch {
      /* imagem local indisponível: as outras candidatas continuam valendo */
    }
  }

  return Array.from(new Set(candidates.filter(Boolean)));
}

/** Coleta as candidatas (incluindo imageId) e já devolve a imagem pronta para desenhar no card. */
export async function resolveMarketingImageSource(
  source: MarketingImageSource | null | undefined,
  dependencies?: MarketingImageResolverDependencies,
): Promise<ResolvedMarketingImage | null> {
  const candidates = await collectMarketingImageCandidates(source);
  if (!candidates.length) return null;
  return resolveMarketingImageCandidates(candidates, dependencies);
}
