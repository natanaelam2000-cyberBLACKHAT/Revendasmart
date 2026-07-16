const RECENT_PRODUCT_IDS_KEY = "rs:recent-product-ids";
const MAX_RECENT_PRODUCT_IDS = 5;

function safeParseIds(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string" && id.trim().length > 0) : [];
  } catch {
    return [];
  }
}

export function readRecentProductIds(): string[] {
  if (typeof window === "undefined") return [];
  try {
    return safeParseIds(window.localStorage.getItem(RECENT_PRODUCT_IDS_KEY));
  } catch {
    return [];
  }
}

export function rememberRecentProductId(productId: string): void {
  if (typeof window === "undefined" || !productId) return;
  try {
    const ids = readRecentProductIds().filter((id) => id !== productId);
    window.localStorage.setItem(RECENT_PRODUCT_IDS_KEY, JSON.stringify([productId, ...ids].slice(0, MAX_RECENT_PRODUCT_IDS)));
  } catch {
    // localStorage can fail in private mode; this must never block product creation.
  }
}
