import assert from "node:assert/strict";
import fs from "node:fs";
import console from "node:console";
import { URL } from "node:url";
import { assessProbeResults, probeTarget, validateTargetConfig, TARGET_ORIGIN } from "./rs-infra-recovery-01-target-gate.mjs";

const config = JSON.parse(fs.readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));
validateTargetConfig(config);
const otherProject = globalThis.structuredClone(config);
otherProject.rewrites[0].destination = "https://unapproved.invalid/privacy-policy";
assert.throws(() => validateTargetConfig(otherProject), /IDENTITY_MISMATCH/);

let requests = 0;
async function compatibleBackend(url, options) {
  requests++;
  assert.equal(new URL(url).origin, TARGET_ORIGIN);
  assert(["GET", "OPTIONS"].includes(options.method));
  assert(["https://localhost", "https://untrusted.invalid"].includes(options.headers.Origin));
  assert.equal(Object.keys(options.headers).some((key) => key.toLowerCase() === "authorization"), false);
  if (options.method === "OPTIONS" && options.headers.Origin === "https://untrusted.invalid") return new globalThis.Response(null, { status: 204 });
  if (options.method === "OPTIONS") return new globalThis.Response(null, { status: 204, headers: {
    "Access-Control-Allow-Origin": "https://localhost",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
  } });
  const route = new URL(url).pathname;
  if (route.includes("/settings/")) return globalThis.Response.json({ error: "Unauthorized: missing token" }, { status: 401 });
  if (route.endsWith("/health")) return globalThis.Response.json({ status: "ok" });
  const heading = route === "/privacy-policy" ? "# Política de Privacidade — RevendaSmart" : "# Termos de Serviço — RevendaSmart";
  return new globalThis.Response(heading + "\n\n" + "Documento público sintético. ".repeat(15), { headers: { "content-type": "text/markdown; charset=utf-8" } });
}
const passed = await probeTarget(compatibleBackend);
assert.equal(requests, 7);
assert.deepEqual(assessProbeResults(passed), []);

// Captures the observed limitations of the May revision: liveness and 401
// alone are insufficient to qualify a routing switch.
const mayRevision = globalThis.structuredClone(passed);
mayRevision.find((x) => x.name === "api-health").status = 404;
for (const name of ["privacy", "terms"]) mayRevision.find((x) => x.name === name).status = 404;
mayRevision.find((x) => x.name === "android-options").allowOrigin = null;
assert.deepEqual(assessProbeResults(mayRevision), [
  "api-health:REAL_LIVENESS_REQUIRED", "privacy:PUBLIC_DOCUMENT_REQUIRED",
  "terms:PUBLIC_DOCUMENT_REQUIRED", "android-options:EXACT_ANDROID_CORS_REQUIRED",
]);

for (const mutate of [
  (copy) => { copy.find((x) => x.name === "health").liveness = false; },
  (copy) => { copy.find((x) => x.name === "settings-no-token").status = 200; },
  (copy) => { copy.find((x) => x.name === "android-options").allowOrigin = "*"; },
  (copy) => { copy.find((x) => x.name === "android-options").allowHeaders = ["content-type"]; },
  (copy) => { copy.find((x) => x.name === "untrusted-options").allowOrigin = "https://untrusted.invalid"; },
]) {
  const rejected = globalThis.structuredClone(passed);
  mutate(rejected);
  assert(assessProbeResults(rejected).length > 0);
}
for (const wrongDocument of [
  new globalThis.Response('<!doctype html><div id="root"></div><script src="/assets/index-fixture.js"></script>' + " ".repeat(150), { headers: { "content-type": "text/html" } }),
  new globalThis.Response("# Termos de Serviço — RevendaSmart\n\n" + "Documento trocado. ".repeat(15), { headers: { "content-type": "text/markdown" } }),
]) {
  const rejected = await probeTarget((url, options) => new URL(url).pathname === "/privacy-policy" ? wrongDocument.clone() : compatibleBackend(url, options));
  assert(assessProbeResults(rejected).includes("privacy:PUBLIC_DOCUMENT_REQUIRED"));
}
const unavailable = await probeTarget(async () => { throw new Error("synthetic unavailable backend"); });
assert.equal(assessProbeResults(unavailable).length, 7);
console.log(JSON.stringify({ result: "PASS", checks: 14, network: "NONE", verified: [
  "selected service only", "no credentials or mutable requests", "compatible synthetic backend",
  "May revision rejected", "HTML health rejected", "unexpected settings success rejected",
  "wildcard CORS rejected", "missing Authorization allow-header rejected", "backend unavailable rejected",
  "untrusted CORS reflection rejected", "SPA200 legal fallback rejected", "swapped legal document rejected",
] }, null, 2));
