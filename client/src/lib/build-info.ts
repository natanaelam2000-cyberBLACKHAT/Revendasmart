export const APP_VERSION = String(import.meta.env.VITE_APP_VERSION || "0.0.0").trim().replace(/^v/i, "") || "0.0.0";
export const APP_BUILD_ID = String(import.meta.env.VITE_APP_BUILD_ID || "local-dev").trim() || "local-dev";

export function formatAppBuildId(value = APP_BUILD_ID): string {
  const normalized = String(value).trim() || "local-dev";
  return /^[a-f0-9]{7,}$/i.test(normalized) ? normalized.slice(0, 7) : normalized;
}
