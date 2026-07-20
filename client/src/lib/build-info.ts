export const APP_BUILD_ID = String(import.meta.env.VITE_APP_BUILD_ID || "local-dev").trim() || "local-dev";

export function formatAppBuildId(value = APP_BUILD_ID): string {
  return value.length > 16 ? value.slice(0, 16) : value;
}
