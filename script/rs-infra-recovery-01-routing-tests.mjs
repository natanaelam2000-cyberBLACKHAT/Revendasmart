#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import process from "node:process";
import console from "node:console";
import { URL } from "node:url";

const OLD_ORIGIN = "https://revendasmart-backend-cc2743rkmq-uc.a.run.app";
const NEW_ORIGIN = "https://revendasmart-backend-164193806378.us-central1.run.app";
const ANDROID_ORIGIN = "https://localhost";
const BOT_PATTERN = ".*(facebookexternalhit|Facebot|WhatsApp|Twitterbot|LinkedInBot|Slackbot|TelegramBot).*";
const clone = (value) => globalThis.structuredClone(value);
const headerName = (value) => String(value).toLowerCase();
let assertions = 0;
function check(condition, message) { assertions += 1; assert.ok(condition, message); }
function equal(actual, expected, message) { assertions += 1; assert.deepEqual(actual, expected, message); }

function ruleMatchesHeaders(rule, requestHeaders) {
  return (rule.has ?? []).every((condition) => {
    if (condition.type !== "header") return false;
    const value = requestHeaders[headerName(condition.key)];
    return value !== undefined && (condition.value === undefined || new RegExp(condition.value).test(value));
  });
}

function resolveContractRoute(config, pathname, userAgent = "Mozilla/5.0") {
  for (const rule of config.rewrites) {
    if (!ruleMatchesHeaders(rule, { "user-agent": userAgent })) continue;
    if (rule.source === pathname) return rule.destination;
    if (rule.source === "/api/:path*" && (pathname === "/api" || pathname.startsWith("/api/"))) {
      return rule.destination.replace(":path*", pathname === "/api" ? "" : pathname.slice(5));
    }
    if (rule.source === "/u/:storeSlug" && /^\/u\/[^/]+$/.test(pathname)) {
      return rule.destination.replace(":storeSlug", pathname.slice(3));
    }
    if (rule.source === "/:path*") return rule.destination;
  }
  return undefined;
}

function validateHeaders(config) {
  const rules = config.headers ?? [];
  check(Array.isArray(rules), "headers, quando presente, deve ser array");
  let corsCount = 0;
  let authenticatedNoStoreCount = 0;
  for (const rule of rules) {
    check(Array.isArray(rule.headers), "cada regra deve conter headers");
    const pairs = rule.headers.map(({ key, value }) => [headerName(key), String(value)]);
    equal(new Set(pairs.map(([key]) => key)).size, pairs.length, "não duplicar nomes de headers na mesma regra");
    check(!pairs.some(([key]) => key === "authorization"), "Authorization jamais pode ser um header de resposta");
    const values = new Map(pairs);
    const allowOrigin = values.get("access-control-allow-origin");
    if (allowOrigin !== undefined) {
      corsCount += 1;
      equal(rule.source, "/api/:path*", "CORS Android deve se limitar ao prefixo API");
      equal(allowOrigin, ANDROID_ORIGIN, "ACAO deve ser exatamente o origin Android, nunca wildcard/reflexão");
      equal(rule.missing ?? [], [], "a regra CORS não deve aceitar origins por ausência de condição");
      equal(rule.has, [{ type: "header", key: "origin", value: "^https://localhost$" }], "CORS requer condição Origin exata e ancorada");
      const allowedHeaders = (values.get("access-control-allow-headers") ?? "").split(",").map((part) => part.trim().toLowerCase());
      check(allowedHeaders.includes("authorization"), "preflight Android deve aceitar Authorization");
      check(allowedHeaders.includes("content-type"), "preflight Android deve aceitar Content-Type");
      check(!allowedHeaders.includes("*"), "não usar wildcard em Allow-Headers");
      const methods = (values.get("access-control-allow-methods") ?? "").split(",").map((part) => part.trim().toUpperCase());
      check(methods.includes("GET") && methods.includes("OPTIONS"), "preflight deve incluir GET e OPTIONS");
      const vary = (values.get("vary") ?? "").split(",").map((part) => part.trim().toLowerCase());
      check(vary.includes("origin"), "CORS condicional exige Vary: Origin");
      check(ruleMatchesHeaders(rule, { origin: ANDROID_ORIGIN }), "origin Android precisa corresponder à condição");
      for (const origin of ["https://localhost.evil.test", "https://evil.test", "http://localhost", "https://127.0.0.1", "https://localhost:443", "null", ""]) {
        check(!ruleMatchesHeaders(rule, { origin }), `origin arbitrário não pode receber ACAO: ${origin}`);
      }
      check(!ruleMatchesHeaders(rule, {}), "requisição sem Origin não deve receber ACAO Android");
    }
    const cacheControl = values.get("cache-control");
    if (cacheControl !== undefined && ["/api/:path*", "/:path*"].includes(rule.source)) {
      check(/(?:^|,)\s*no-store\s*(?:,|$)/i.test(cacheControl), "regra de cache que abrange API deve exigir no-store");
      check(!/(?:^|,)\s*(?:public|s-maxage\s*=|stale-while-revalidate\s*=|max-age\s*=\s*[1-9])/i.test(cacheControl), "não tornar respostas autenticadas cacheáveis");
      const authConditions = (rule.has ?? []).filter((condition) => condition.type === "header" && headerName(condition.key) === "authorization");
      if (authConditions.length) {
        authenticatedNoStoreCount += 1;
        equal(rule.source, "/api/:path*", "no-store autenticado deve se limitar à API");
        check(ruleMatchesHeaders(rule, { authorization: "Bearer SYNTHETIC_NOT_A_TOKEN" }), "condição no-store deve corresponder a Bearer sintético");
        check(!ruleMatchesHeaders(rule, {}), "regra no-store autenticada não pode depender da ausência do header");
      }
    }
  }
  check(corsCount <= 1, "não duplicar regra de ACAO Android");
  return { corsCount, authenticatedNoStoreCount };
}

function validate(config) {
  equal(config.buildCommand, "node script/rs-infra-recovery-01-routing-tests.mjs . && node script/rs-infra-recovery-01-target-gate.mjs --live && npm run build", "bloquear deploy antes do build se configuração ou destino não passar no contrato");
  equal(config.outputDirectory, "dist/public", "preservar outputDirectory");
  check(Array.isArray(config.rewrites), "rewrites deve ser array");
  const healthRules = config.rewrites.filter((rule) => rule.source === "/api/health");
  check(healthRules.length <= 1, "não duplicar health alias");
  const inherited = config.rewrites.filter((rule) => rule.source !== "/api/health");
  equal(inherited, [
    { source: "/privacy-policy", destination: `${NEW_ORIGIN}/privacy-policy` },
    { source: "/terms-of-service", destination: `${NEW_ORIGIN}/terms-of-service` },
    { source: "/api/:path*", destination: `${NEW_ORIGIN}/api/:path*` },
    { source: "/u/:storeSlug", has: [{ type: "header", key: "user-agent", value: BOT_PATTERN }], destination: `${NEW_ORIGIN}/u/:storeSlug` },
    { source: "/u/:storeSlug", destination: "/index.html" },
    { source: "/:path*", destination: "/index.html" },
  ], "preservar as seis regras herdadas, seus paths, ordem, bots e fallbacks; trocar todos quatro destinos");
  const external = inherited.filter((rule) => /^https?:\/\//.test(rule.destination));
  equal(external.length, 4, "quatro destinos herdados devem continuar externos");
  for (const rule of external) equal(new URL(rule.destination.replace(":path*", "fixture").replace(":storeSlug", "fixture")).origin, NEW_ORIGIN, "origem Cloud Run única e validada");
  check(!JSON.stringify(config).includes(OLD_ORIGIN), "não manter destino antigo em outra regra");
  check(!JSON.stringify(config.rewrites).includes("/api/api"), "não duplicar prefixo API");
  if (healthRules.length) {
    equal(healthRules[0], { source: "/api/health", destination: `${NEW_ORIGIN}/health` }, "health alias deve encaminhar liveness real sem criar resposta sintética");
    check(config.rewrites.indexOf(healthRules[0]) < config.rewrites.findIndex((rule) => rule.source === "/api/:path*"), "health alias deve preceder API genérica");
    equal(resolveContractRoute(config, "/api/health"), `${NEW_ORIGIN}/health`, "health usa origem real /health");
  }
  equal(resolveContractRoute(config, "/privacy-policy"), `${NEW_ORIGIN}/privacy-policy`, "preservar política");
  equal(resolveContractRoute(config, "/terms-of-service"), `${NEW_ORIGIN}/terms-of-service`, "preservar termos");
  equal(resolveContractRoute(config, "/api/user/settings/synthetic-uid"), `${NEW_ORIGIN}/api/user/settings/synthetic-uid`, "settings não deve virar SPA nem duplicar prefixo");
  for (const bot of ["facebookexternalhit", "Facebot", "WhatsApp", "Twitterbot", "LinkedInBot", "Slackbot", "TelegramBot"]) equal(resolveContractRoute(config, "/u/catalogo-sintetico", bot), `${NEW_ORIGIN}/u/catalogo-sintetico`, `preservar catálogo para ${bot}`);
  equal(resolveContractRoute(config, "/u/catalogo-sintetico"), "/index.html", "navegação normal do catálogo permanece SPA");
  equal(resolveContractRoute(config, "/settings/profile"), "/index.html", "preservar fallback SPA");
  return { healthAlias: Boolean(healthRules.length), ...validateHeaders(config) };
}

function expectRejected(config, message) {
  assertions += 1;
  assert.throws(() => validate(config), undefined, message);
}

const rootArgument = process.argv[2] ?? process.env.ROOT ?? process.env.RS_INFRA_ROOT;
if (!rootArgument) throw new Error("Informe ROOT via argv[2], ROOT ou RS_INFRA_ROOT; nenhum acesso de rede é feito.");
const root = resolve(rootArgument);
const config = JSON.parse(readFileSync(join(root, "vercel.json"), "utf8"));
const actual = validate(config);
equal(actual.healthAlias, true, "a recuperação exige alias para liveness real");
equal(actual.corsCount, 1, "a recuperação exige CORS Android condicionado");
equal(actual.authenticatedNoStoreCount, 1, "a recuperação exige no-store autenticado");

// Exercita guardas negativos sem alterar a configuração lida.
let invalid = clone(config);
invalid.rewrites.find((rule) => rule.source === "/privacy-policy").destination = `${OLD_ORIGIN}/privacy-policy`;
expectRejected(invalid, "destino antigo residual deve falhar");
invalid = clone(config);
invalid.rewrites.splice(invalid.rewrites.findIndex((rule) => rule.source === "/terms-of-service"), 1);
expectRejected(invalid, "perda de documento público deve falhar");
invalid = clone(config);
invalid.rewrites.find((rule) => rule.has?.[0]?.key === "user-agent").has = [];
expectRejected(invalid, "remover limite bot deve falhar");
invalid = clone(config);
const apiIndex = invalid.rewrites.findIndex((rule) => rule.source === "/api/:path*");
const [apiRule] = invalid.rewrites.splice(apiIndex, 1);
invalid.rewrites.push(apiRule);
expectRejected(invalid, "API após fallback SPA deve falhar");

const withEdgeHeaders = clone(config);
withEdgeHeaders.headers = [
  { source: "/api/:path*", has: [{ type: "header", key: "origin", value: "^https://localhost$" }], headers: [
    { key: "Access-Control-Allow-Origin", value: ANDROID_ORIGIN },
    { key: "Access-Control-Allow-Headers", value: "Authorization, Content-Type" },
    { key: "Access-Control-Allow-Methods", value: "GET, POST, PUT, PATCH, DELETE, OPTIONS" },
    { key: "Vary", value: "Origin" },
  ] },
  { source: "/api/:path*", has: [{ type: "header", key: "authorization" }], headers: [{ key: "Cache-Control", value: "private, no-store" }] },
];
validate(withEdgeHeaders);
for (const mutate of [
  (value) => { value.headers[0].has[0].value = "https://localhost"; },
  (value) => { value.headers[0].has = []; },
  (value) => { value.headers[0].headers[0].value = "*"; },
  (value) => { value.headers[0].headers[0].value = ":origin"; },
  (value) => { value.headers[0].source = "/:path*"; },
  (value) => { value.headers[1].headers[0].value = "public, max-age=3600"; },
]) {
  invalid = clone(withEdgeHeaders);
  mutate(invalid);
  expectRejected(invalid, "variante permissiva CORS/cache deve falhar");
}
if (actual.healthAlias) {
  invalid = clone(config);
  const [health] = invalid.rewrites.splice(invalid.rewrites.findIndex((rule) => rule.source === "/api/health"), 1);
  invalid.rewrites.push(health);
  expectRejected(invalid, "alias health após API deve falhar");
}

const smokeFile = join(root, "script", "smoke-tests.ts");
if (existsSync(smokeFile)) {
  const smoke = readFileSync(smokeFile, "utf8");
  check(!smoke.includes(`assert.equal(vercel.rewrites[apiRewriteIndex].destination, "${OLD_ORIGIN}/api/:path*")`), "atualizar contrato literal antigo em script/smoke-tests.ts:4069 sem remover asserção");
}
console.log(JSON.stringify({ result: "PASS", assertions, network: "NONE", sourceWrites: "NONE", origin: NEW_ORIGIN, actualConfig: actual, note: "Contrato local; não comprova comportamento da borda Vercel publicada nem saúde Auth/Firestore." }, null, 2));
