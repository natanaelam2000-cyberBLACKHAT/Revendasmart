import { getMarketingAdImageCandidates, type MarketingAdConfig } from "./marketing-ad";

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
