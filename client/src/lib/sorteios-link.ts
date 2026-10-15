import { buildPublicAppUrl, isLocalPublicAppBaseUrl, normalizePublicAppBaseUrl, resolvePublicAppBaseUrl } from "./public-url";

/** Use the canonical configured/official public URL, never the WebView/browser origin. */
export function buildSorteioPublicUrl(path: string, configuredBase = resolvePublicAppBaseUrl(undefined, "")): string {
  if (!path.startsWith("/sorteio/") || path.startsWith("//")) throw new Error("Caminho público do sorteio inválido.");
  const normalized = normalizePublicAppBaseUrl(configuredBase);
  const parsed = normalized && normalized !== "null" ? new URL(normalized) : null;
  const valid = parsed && ["https:", "http:"].includes(parsed.protocol)
    && !isLocalPublicAppBaseUrl(normalized) && parsed.hostname !== "[::1]"
    && !parsed.hostname.endsWith(".localhost") && !/^127\./.test(parsed.hostname);
  // An empty explicit base invokes the existing official fallback in public-url.ts.
  return buildPublicAppUrl(path, valid ? normalized : "");
}

export type SorteioShareOutcome = "shared" | "cancelled" | "unavailable" | "failed";
interface ShareRequest { title: string; text: string; url: string }
export interface SorteioLinkActions {
  isNative: () => Promise<boolean>;
  nativeShare: (request: ShareRequest) => Promise<void>;
  webShare?: (request: ShareRequest) => Promise<void>;
  copy: (url: string) => Promise<void>;
}
const defaultActions: SorteioLinkActions = {
  isNative: async () => (await import("@capacitor/core")).Capacitor.isNativePlatform(),
  nativeShare: async request => { await (await import("@capacitor/share")).Share.share(request); },
  webShare: typeof navigator !== "undefined" && typeof navigator.share === "function"
    ? request => navigator.share(request) : undefined,
  copy: url => navigator.clipboard.writeText(url),
};

export async function copySorteioLink(url: string, actions = defaultActions): Promise<void> {
  await actions.copy(url);
}

export async function shareSorteioLink(url: string, actions = defaultActions): Promise<SorteioShareOutcome> {
  const request = { title: "Sorteio Promocional", text: "Escolha seus números no sorteio:", url };
  try {
    if (await actions.isNative()) await actions.nativeShare(request);
    else if (actions.webShare) await actions.webShare(request);
    else return "unavailable";
    return "shared";
  } catch (error) {
    return error instanceof Error && error.name === "AbortError" ? "cancelled" : "failed";
  }
}
