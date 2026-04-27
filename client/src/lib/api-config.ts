/**
 * Configure API base URL for frontend requests
 * Uses VITE_API_BASE_URL environment variable
 * Falls back to window.location.origin in local development
 */
export function getApiBaseUrl(): string {
  const viteApiBase = import.meta.env.VITE_API_BASE_URL;
  
  if (viteApiBase) {
    console.log("[API Config] Using VITE_API_BASE_URL:", viteApiBase);
    return viteApiBase;
  }

  // Fallback to current origin (works for local dev)
  const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5000';
  console.log("[API Config] Using window.location.origin:", origin);
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
