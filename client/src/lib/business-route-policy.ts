import type { BusinessModeResolution } from "@shared/business-mode";

/** Domain used by the private route policy. `unknown` deliberately passes through so that
 * PrivateRouter can keep rendering its NotFound route instead of inventing a business redirect. */
export type BusinessRouteDomain = "universal" | "products" | "services" | "admin" | "unknown";

export type BusinessRouteDecision =
  | { readonly kind: "allow" }
  | { readonly kind: "redirect"; readonly to: "/" }
  | { readonly kind: "unresolved" };

const PRODUCTS_ROUTES = [
  "/products",
  "/add",
  "/add-product",
  "/sale",
  "/sell",
  "/catalog",
  "/orders",
  "/billings",
  "/billing-calendar",
  "/monthly-sales",
  "/products-sold",
  "/reports",
] as const;

const SERVICES_ROUTES = [
  "/servicos",
  "/servicos/agenda",
  "/servicos/novo",
  "/servicos/disponibilidade",
  "/servicos/atendimentos",
] as const;

const UNIVERSAL_ROUTES = [
  "/",
  "/onboarding",
  "/clients",
  "/settings",
  "/settings/mercadopago",
  "/settings/plano-e-uso",
  "/plans",
  "/subscribe",
  "/marketing",
  "/social",
  "/opportunities",
] as const;

const ADMIN_ROUTES = ["/admin", "/sorteios"] as const;

function normalizedPathname(pathname: string): string {
  const withoutQueryOrHash = pathname.split(/[?#]/, 1)[0] || "/";
  const withLeadingSlash = withoutQueryOrHash.startsWith("/") ? withoutQueryOrHash : `/${withoutQueryOrHash}`;
  if (withLeadingSlash === "/") return "/";
  return withLeadingSlash.replace(/\/+$/, "");
}

function hasDynamicChild(pathname: string, base: string): boolean {
  return pathname.startsWith(`${base}/`) && pathname.slice(base.length + 1).length > 0 && !pathname.slice(base.length + 1).includes("/");
}

/** Classifies only private route shapes. Unknown paths pass through to NotFound. */
export function classifyBusinessRoute(pathname: string): BusinessRouteDomain {
  const path = normalizedPathname(pathname);
  if ((PRODUCTS_ROUTES as readonly string[]).includes(path) || hasDynamicChild(path, "/edit-product")) return "products";
  if ((SERVICES_ROUTES as readonly string[]).includes(path) || hasDynamicChild(path, "/servicos/atendimentos")) return "services";
  if ((UNIVERSAL_ROUTES as readonly string[]).includes(path) || hasDynamicChild(path, "/clients")) return "universal";
  if ((ADMIN_ROUTES as readonly string[]).includes(path) || hasDynamicChild(path, "/sorteios")) return "admin";
  if (path === "/edit-product") return "unknown";
  return "unknown";
}

export function resolveBusinessRouteDecision(
  domain: BusinessRouteDomain,
  resolution: BusinessModeResolution,
): BusinessRouteDecision {
  if (!resolution.resolved || resolution.status === "loading" || resolution.status === "error" || !resolution.mode) {
    return { kind: "unresolved" };
  }
  if (domain === "unknown" || domain === "universal" || domain === "admin") return { kind: "allow" };
  if (resolution.mode === "both" || resolution.mode === domain) return { kind: "allow" };
  return { kind: "redirect", to: "/" };
}

export function resolveBusinessRoute(pathname: string, resolution: BusinessModeResolution): BusinessRouteDecision {
  return resolveBusinessRouteDecision(classifyBusinessRoute(pathname), resolution);
}

export const PRIVATE_ROUTE_INVENTORY: ReadonlyArray<readonly [string, BusinessRouteDomain]> = [
  ["/onboarding", "universal"],
  ["/", "universal"],
  ["/products", "products"],
  ["/add", "products"],
  ["/add-product", "products"],
  ["/edit-product/:id", "products"],
  ["/sale", "products"],
  ["/sell", "products"],
  ["/catalog", "products"],
  ["/clients", "universal"],
  ["/clients/:id", "universal"],
  ["/orders", "products"],
  ["/billings", "products"],
  ["/billing-calendar", "products"],
  ["/marketing", "universal"],
  ["/monthly-sales", "products"],
  ["/products-sold", "products"],
  ["/social", "universal"],
  ["/reports", "products"],
  ["/settings", "universal"],
  ["/settings/mercadopago", "universal"],
  ["/settings/plano-e-uso", "universal"],
  ["/plans", "universal"],
  ["/opportunities", "universal"],
  ["/subscribe", "universal"],
  ["/servicos", "services"],
  ["/servicos/agenda", "services"],
  ["/servicos/novo", "services"],
  ["/servicos/disponibilidade", "services"],
  ["/servicos/atendimentos", "services"],
  ["/servicos/atendimentos/:workId", "services"],
  ["/admin", "admin"],
  ["/sorteios", "admin"],
  ["/sorteios/:campaignId", "admin"],
];
