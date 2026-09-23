import assert from "node:assert/strict";
import {
  classifyBusinessRoute,
  PRIVATE_ROUTE_INVENTORY,
  resolveBusinessRoute,
  resolveBusinessRouteDecision,
  type BusinessRouteDomain,
} from "../client/src/lib/business-route-policy";
import type { BusinessModeResolution } from "../shared/business-mode";

const resolution = (mode: BusinessModeResolution["mode"], status: BusinessModeResolution["status"] = "known"): BusinessModeResolution => ({
  mode,
  status,
  resolved: true,
});
const products = resolution("products");
const services = resolution("services");
const both = resolution("both");
const legacyProducts = resolution("products", "legacy-missing");
const loading: BusinessModeResolution = { mode: null, status: "loading", resolved: false };
const error: BusinessModeResolution = { mode: null, status: "error", resolved: false };

function expectDecision(path: string, mode: BusinessModeResolution, expected: "allow" | "redirect" | "unresolved") {
  assert.equal(resolveBusinessRoute(path, mode).kind, expected, `${path} deveria ser ${expected}`);
}

const productsPaths = ["/products", "/add", "/add-product", "/edit-product/abc", "/sale", "/sell", "/catalog", "/orders", "/billings", "/billing-calendar", "/monthly-sales", "/products-sold", "/reports"];
const servicesPaths = ["/servicos", "/servicos/agenda", "/servicos/novo", "/servicos/disponibilidade", "/servicos/atendimentos", "/servicos/atendimentos/abc"];
const universalPaths = ["/", "/onboarding", "/clients", "/clients/abc", "/settings", "/settings/mercadopago", "/settings/plano-e-uso", "/plans", "/subscribe"];
const adsDeferredPaths = ["/marketing", "/social", "/opportunities"];
const adminPaths = ["/admin", "/sorteios", "/sorteios/abc"];

for (const path of productsPaths) {
  expectDecision(path, products, "allow");
  expectDecision(path, services, "redirect");
  expectDecision(path, both, "allow");
}
for (const path of servicesPaths) {
  expectDecision(path, products, "redirect");
  expectDecision(path, services, "allow");
  expectDecision(path, both, "allow");
}
for (const path of [...universalPaths, ...adsDeferredPaths, ...adminPaths]) {
  expectDecision(path, products, "allow");
  expectDecision(path, services, "allow");
  expectDecision(path, both, "allow");
}

for (const path of ["/products", "/servicos", "/servicos/agenda"]) {
  expectDecision(path, loading, "unresolved");
  expectDecision(path, error, "unresolved");
}
expectDecision("/products", legacyProducts, "allow");
expectDecision("/servicos", legacyProducts, "redirect");

assert.equal(classifyBusinessRoute("/edit-product/abc?from=products#form"), "products");
assert.equal(classifyBusinessRoute("/servicos/atendimentos/work123?tab=commercial#summary"), "services");
assert.equal(classifyBusinessRoute("/clients/c123?tab=orders"), "universal");
for (const unknownPath of ["/products-other", "/servicosx", "/edit-product", "/not-a-private-route"]) {
  assert.equal(classifyBusinessRoute(unknownPath), "unknown");
  expectDecision(unknownPath, services, "allow");
}

for (const [pattern, expectedDomain] of PRIVATE_ROUTE_INVENTORY) {
  const concrete = pattern.replace(":id", "abc").replace(":workId", "work123").replace(":campaignId", "campaign123");
  assert.equal(classifyBusinessRoute(concrete), expectedDomain, `${pattern} precisa permanecer classificada como ${expectedDomain}`);
}

const expectedDomains: BusinessRouteDomain[] = ["universal", "products", "services", "admin", "unknown"];
assert.deepEqual([...new Set(PRIVATE_ROUTE_INVENTORY.map(([, domain]) => domain))].sort(), expectedDomains.slice(0, 4).sort());
assert.equal(resolveBusinessRouteDecision("unknown", products).kind, "allow");

console.log(`F2a/F2test route policy passed: ${PRIVATE_ROUTE_INVENTORY.length} private route patterns covered; ADS DOMAIN DEFERRED — CURRENTLY UNIVERSAL.`);
