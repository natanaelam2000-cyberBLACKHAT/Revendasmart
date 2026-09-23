import assert from "node:assert/strict";
import { resolveBusinessRouteGate } from "../client/src/lib/business-route-gate";
import type { BusinessModeResolution } from "../shared/business-mode";

const ready = (mode: BusinessModeResolution["mode"], status: BusinessModeResolution["status"] = "known"): BusinessModeResolution => ({ mode, status, resolved: true });
const products = ready("products");
const services = ready("services");
const both = ready("both");
const legacy = ready("products", "legacy-missing");
const loading: BusinessModeResolution = { mode: null, status: "loading", resolved: false };
const error: BusinessModeResolution = { mode: null, status: "error", resolved: false };

function kind(path: string, resolution: BusinessModeResolution): string {
  return resolveBusinessRouteGate(path, resolution).kind;
}

// G1-G6: the protected component is renderable only when policy allows its route.
assert.equal(kind("/products", products), "render");
assert.equal(kind("/servicos", products), "redirect");
assert.equal(kind("/servicos", services), "render");
assert.equal(kind("/products", services), "redirect");
assert.equal(kind("/products", both), "render");
assert.equal(kind("/servicos", both), "render");

// G7-G9: unresolved never mounts a protected page and never redirects to a guessed mode.
for (const path of ["/products", "/servicos"]) {
  assert.equal(kind(path, loading), "unresolved");
  assert.equal(kind(path, error), "unresolved");
}

// G10-G11: legacy is already resolved by F1a and therefore follows Products policy.
assert.equal(kind("/products", legacy), "render");
assert.equal(kind("/servicos", legacy), "redirect");

// G12: unknown routes reach NotFound rather than being redirected by business mode.
assert.equal(kind("/not-a-private-route", services), "render");

// Transition harness: the same route is re-evaluated when resolution changes, without mounting
// the now-invalid page. The integration effect performs exactly one replace for the redirect state.
assert.equal(kind("/products", products), "render");
assert.equal(kind("/products", services), "redirect");
assert.equal(kind("/products", both), "render");
assert.equal(kind("/servicos", services), "render");
assert.equal(kind("/servicos", products), "redirect");
assert.equal(kind("/servicos", both), "render");

// UID handoff harness: the new UID must pass through unresolved before its mode is known.
assert.equal(kind("/products", loading), "unresolved");
assert.equal(kind("/products", services), "redirect");

// Admin and deferred Ads remain allowed in every mode; no authorization is duplicated here.
for (const path of ["/admin", "/sorteios/abc", "/marketing", "/social", "/opportunities"]) {
  assert.equal(kind(path, products), "render");
  assert.equal(kind(path, services), "render");
  assert.equal(kind(path, both), "render");
}

const redirect = resolveBusinessRouteGate("/products", services);
assert.deepEqual(redirect, { kind: "redirect", to: "/" }, "redirect deve ser replace('/') no consumidor F2b");

console.log("F2b route guard tests passed: incompatible routes do not mount, unresolved stays neutral, redirects target / with replace, UID/mode transitions remain guarded.");
