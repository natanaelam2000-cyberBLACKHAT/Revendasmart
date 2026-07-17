/**
 * Configure API base URL for frontend requests.
 *
 * Resolution order:
 * 1. VITE_API_BASE_URL when provided (Android Capacitor debug/prod builds use this).
 * 2. window.location.origin for hosted web and local web development.
 * 3. empty base outside the browser, keeping paths relative for tests/SSR helpers.
 */
export function normalizeApiBaseUrl(value: string | undefined | null): string {
  const trimmed = value?.trim();
  if (!trimmed) return "";

  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:" && url.protocol !== "http:") return "";
    return url.origin;
  } catch {
    return "";
  }
}

export function resolveApiBaseUrl(explicitBaseUrl: string | undefined | null, browserOrigin?: string | undefined | null): string {
  const explicit = normalizeApiBaseUrl(explicitBaseUrl);
  if (explicit) return explicit;
  return normalizeApiBaseUrl(browserOrigin);
}

export function buildApiUrl(baseUrl: string, endpoint: string): string {
  if (/^https?:\/\//i.test(endpoint)) return endpoint;
  const normalizedEndpoint = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
  const normalizedBase = normalizeApiBaseUrl(baseUrl);
  return normalizedBase ? `${normalizedBase}${normalizedEndpoint}` : normalizedEndpoint;
}

export function getApiBaseUrl(): string {
  return resolveApiBaseUrl(
    import.meta.env?.VITE_API_BASE_URL,
    typeof window !== "undefined" ? window.location.origin : undefined,
  );
}

/**
 * Build full API URL from endpoint.
 * @param endpoint e.g., "/api/user/settings/{uid}"
 */
export function getApiUrl(endpoint: string): string {
  return buildApiUrl(getApiBaseUrl(), endpoint);
}
