import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL, URL } from "node:url";
import process from "node:process";
import console from "node:console";

export const TARGET_ORIGIN = "https://revendasmart-backend-164193806378.us-central1.run.app";
const ANDROID_ORIGIN = "https://localhost";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function validateTargetConfig(config) {
  const external = config.rewrites.filter((rule) => /^https:\/\//.test(rule.destination));
  if (external.length !== 5 || external.some((rule) => new URL(rule.destination).origin !== TARGET_ORIGIN)) {
    throw new Error("RECOVERY_TARGET_IDENTITY_MISMATCH");
  }
  if (config.rewrites.find((rule) => rule.source === "/api/health")?.destination !== TARGET_ORIGIN + "/health") {
    throw new Error("RECOVERY_HEALTH_ALIAS_MISSING");
  }
}

export function assessProbeResults(results) {
  const failures = [];
  for (const name of ["health", "api-health"]) {
    const probe = results.find((entry) => entry.name === name);
    if (probe?.status !== 200 || probe?.liveness !== true) failures.push(name + ":REAL_LIVENESS_REQUIRED");
  }
  for (const name of ["privacy", "terms"]) {
    const probe = results.find((entry) => entry.name === name);
    if (probe?.status !== 200 || probe?.publicDocument !== true) failures.push(name + ":PUBLIC_DOCUMENT_REQUIRED");
  }
  if (results.find((entry) => entry.name === "settings-no-token")?.status !== 401) {
    failures.push("settings-no-token:SAFE_NEGATIVE_REQUIRED");
  }
  const cors = results.find((entry) => entry.name === "android-options");
  if (![200, 204].includes(cors?.status) || cors?.allowOrigin !== ANDROID_ORIGIN ||
      !cors?.allowHeaders?.includes("authorization") || !cors?.allowHeaders?.includes("content-type") ||
      !cors?.allowMethods?.includes("GET") || !cors?.allowMethods?.includes("OPTIONS")) {
    failures.push("android-options:EXACT_ANDROID_CORS_REQUIRED");
  }
  const rejectedOrigin = results.find((entry) => entry.name === "untrusted-options");
  if (![200, 204, 403].includes(rejectedOrigin?.status) || rejectedOrigin?.allowOrigin) {
    failures.push("untrusted-options:ORIGIN_MUST_BE_REJECTED");
  }
  return failures;
}

export async function probeTarget(fetchImpl = globalThis.fetch) {
  const definitions = [
    ["health", "/health", "GET"],
    ["api-health", "/api/health", "GET"],
    ["privacy", "/privacy-policy", "GET"],
    ["terms", "/terms-of-service", "GET"],
    ["settings-no-token", "/api/user/settings/rs-infra-no-credentials", "GET"],
    ["android-options", "/api/user/settings/rs-infra-no-credentials", "OPTIONS"],
    ["untrusted-options", "/api/user/settings/rs-infra-no-credentials", "OPTIONS", "https://untrusted.invalid"],
  ];
  return await Promise.all(definitions.map(async ([name, route, method, origin]) => {
    try {
      const response = await fetchImpl(TARGET_ORIGIN + route, {
        method, redirect: "manual", signal: globalThis.AbortSignal.timeout(15_000),
        headers: { Origin: origin || ANDROID_ORIGIN, ...(method === "OPTIONS" ? {
          "Access-Control-Request-Method": "GET",
          "Access-Control-Request-Headers": "authorization,content-type",
        } : {}) },
      });
      const body = await response.text();
      let liveness = false;
      try { liveness = JSON.parse(body).status === "ok"; } catch { /* HTML is never liveness. */ }
      const heading = { privacy: "# Política de Privacidade — RevendaSmart", terms: "# Termos de Serviço — RevendaSmart" }[name];
      const firstLine = body.replace(/^\uFEFF/, "").trimStart().split(/\r?\n/, 1)[0].trim();
      return {
        name, status: response.status,
        liveness,
        publicDocument: Boolean(heading) && /^text\/markdown(?:;|$)/i.test(response.headers.get("content-type") || "") && firstLine === heading && body.trim().length > 100,
        allowOrigin: response.headers.get("access-control-allow-origin"),
        allowHeaders: (response.headers.get("access-control-allow-headers") || "").toLowerCase().split(",").map((x) => x.trim()),
        allowMethods: (response.headers.get("access-control-allow-methods") || "").toUpperCase().split(",").map((x) => x.trim()),
      };
    } catch (error) {
      return { name, status: null, error: error.name, reason: "BACKEND_UNAVAILABLE_OR_TIMEOUT" };
    }
  }));
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== "--live")) throw new Error("Only --live is supported.");
  validateTargetConfig(JSON.parse(fs.readFileSync(path.join(root, "vercel.json"), "utf8")));
  if (!args.includes("--live")) {
    console.log("RECOVERY_TARGET_STATIC_CONFIG=PASS; live compatibility remains required.");
    return;
  }
  const results = await probeTarget();
  const failures = assessProbeResults(results);
  console.log(JSON.stringify({ target: TARGET_ORIGIN, readOnly: true, credentialsSent: false, results, failures,
    limitation: "Liveness and unauthenticated 401 do not prove Firebase Auth or Firestore availability." }, null, 2));
  if (failures.length) throw new Error("RECOVERY_TARGET_NOT_QUALIFIED: " + failures.join(", "));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
