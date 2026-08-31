const LOCAL_PUBLIC_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1"]);
const OFFICIAL_PUBLIC_APP_URL = "https://revendasmart.vercel.app";

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

export function normalizePublicAppBaseUrl(value: string | null | undefined): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    return trimTrailingSlash(parsed.origin);
  } catch {
    return "";
  }
}

export function isLocalPublicAppBaseUrl(value: string | null | undefined): boolean {
  const normalized = normalizePublicAppBaseUrl(value);
  if (!normalized) return false;
  try {
    const host = new URL(normalized).hostname.toLowerCase();
    return LOCAL_PUBLIC_HOSTS.has(host);
  } catch {
    return false;
  }
}

export function resolvePublicAppBaseUrl(explicitBaseUrl?: string, browserOrigin?: string): string {
  const configured = normalizePublicAppBaseUrl(explicitBaseUrl ?? import.meta.env?.VITE_PUBLIC_APP_URL);
  if (configured) return configured;

  const origin = normalizePublicAppBaseUrl(browserOrigin ?? (typeof window !== "undefined" ? window.location?.origin : ""));
  if (origin) return origin;

  return OFFICIAL_PUBLIC_APP_URL;
}

export function getPublicAppBaseUrl(): string {
  return resolvePublicAppBaseUrl();
}

export function buildPublicAppUrl(path: string, baseUrl = getPublicAppBaseUrl()): string {
  const normalizedBase = normalizePublicAppBaseUrl(baseUrl) || OFFICIAL_PUBLIC_APP_URL;
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${normalizedBase}${normalizedPath}`;
}

export function buildPublicCatalogUrl(slug: string, baseUrl = getPublicAppBaseUrl()): string {
  const safeSlug = String(slug ?? "").trim().replace(/^\/+|\/+$/g, "");
  return safeSlug ? buildPublicAppUrl(`/u/${encodeURIComponent(safeSlug)}`, baseUrl) : "";
}

/** SERV-E2E-01 §19 — mesmo slug público já usado por /u/:slug (server/public-catalog-ownership.ts), nunca
 * um segundo sistema de identificador: /agendar/:slug é resolvido pelo mesmo `catalogSlug` do tenant. */
export function buildPublicServiceBookingUrl(slug: string, baseUrl = getPublicAppBaseUrl()): string {
  const safeSlug = String(slug ?? "").trim().replace(/^\/+|\/+$/g, "");
  return safeSlug ? buildPublicAppUrl(`/agendar/${encodeURIComponent(safeSlug)}`, baseUrl) : "";
}
