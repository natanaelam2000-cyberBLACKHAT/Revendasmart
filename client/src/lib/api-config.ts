/**
 * Configure API base URL for frontend requests
 * Uses VITE_API_BASE_URL environment variable
 * Falls back to window.location.origin in local development
 */
export function getApiBaseUrl(): string {
  const viteApiBase = import.meta.env.VITE_API_BASE_URL;
  
  if (viteApiBase) {
    return viteApiBase;
  }

  // Fallback to current origin (works for local dev)
  const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5000';
  return origin;
}

/**
 * Build full API URL from endpoint
 * @param endpoint e.g., "/api/user/settings/{uid}"
 */
export function getApiUrl(endpoint: string): string {
  const baseUrl = getApiBaseUrl();
  return `${baseUrl}${endpoint}`;
}
