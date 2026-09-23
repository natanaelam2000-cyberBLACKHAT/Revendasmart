import {
  resolveBusinessRoute,
  type BusinessRouteDecision,
} from "@/lib/business-route-policy";
import type { BusinessModeResolution } from "@shared/business-mode";

export type BusinessRouteGate =
  | { readonly kind: "render" }
  | { readonly kind: "redirect"; readonly to: "/" }
  | { readonly kind: "unresolved" };

/** Pure render gate used by PrivateRouter before mounting any private page. */
export function resolveBusinessRouteGate(pathname: string, resolution: BusinessModeResolution): BusinessRouteGate {
  const decision: BusinessRouteDecision = resolveBusinessRoute(pathname, resolution);
  if (decision.kind === "allow") return { kind: "render" };
  return decision;
}
