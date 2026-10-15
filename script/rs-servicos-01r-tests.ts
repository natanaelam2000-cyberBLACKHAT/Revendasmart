import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import ts from "typescript";
import { build } from "esbuild";
import { chromium } from "@playwright/test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const root = process.cwd();
const paths = {
  products: "client/src/hooks/useProductsData.ts",
  sales: "client/src/hooks/useSalesData.ts",
  dashboard: "client/src/pages/dashboard.tsx",
  persistence: "client/src/lib/services-persistence.ts",
  firebase: "client/src/lib/firebase.ts",
};
type Result = { name: string; pass: boolean; detail?: string };

function dashboardLogic(source: string) {
  const tree = ts.createSourceFile("dashboard.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const names = new Set(["countDashboardPendingConfigurationSteps", "resolveDashboardDataError", "dashboardBusinessLabel"]);
  const declarations = tree.statements
    .filter((statement): statement is ts.FunctionDeclaration => ts.isFunctionDeclaration(statement) && Boolean(statement.name) && names.has(statement.name!.text))
    .map((statement) => ts.transpileModule(statement.getText(tree).replace(/^export\s+/m, ""), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText);
  assert.equal(declarations.length, names.size, "Dashboard policy helpers must be exported");
  const evaluate = new Function("React", "resolvedBusinessMode", "settings", "products", "sales", "clients", "servicesCount", "productsError", "salesError", "clientsError", `${declarations.join("\n")}
    return {
      count: countDashboardPendingConfigurationSteps({ businessMode: resolvedBusinessMode, settings, productsCount: products.length, salesCount: sales.length, clientsCount: clients.length, servicesCount }),
      error: resolveDashboardDataError(resolvedBusinessMode === "products" || resolvedBusinessMode === "both", productsError, salesError, clientsError),
      copy: React.createElement("span", null, "O Premium identifica oportunidades comerciais para ", dashboardBusinessLabel(resolvedBusinessMode)),
    };
  `);
  return (...args: unknown[]) => evaluate(React, ...args);
}

async function suite(sourceRoot: string): Promise<Result[]> {
  const results: Result[] = [];
  function check(name: string, operation: () => void) {
    try { operation(); results.push({ name, pass: true }); }
    catch (error) { results.push({ name, pass: false, detail: String(error) }); }
  }
  const dashboard = dashboardLogic(fs.readFileSync(path.join(sourceRoot, paths.dashboard), "utf8"));
  const complete = { appTheme: "light", businessType: "services", storeName: "Oficina", storeLogo: "logo", catalogSlug: "oficina" };
  const run = (mode: string, settings = complete, products: unknown[] = [{}], sales: unknown[] = [{}], servicesCount = 10, pe?: string, se?: string, ce?: string) => dashboard(mode, settings, products, sales, [{}], servicesCount, pe, se, ce);
  for (const mode of ["services", "products", "both"]) {
    check("copy " + mode, () => {
      const html = renderToStaticMarkup(run(mode).copy);
      assert(html.includes(mode === "services" ? "para seu negócio" : "para sua loja"));
      assert(!html.includes("para seu loja"));
    });
  }
  check("T8 SERVICES ignores productsError", () => assert.equal(run("services", complete, [], [], 0, "products failed").error, undefined));
  check("T9 SERVICES ignores salesError", () => assert.equal(run("services", complete, [], [], 0, undefined, "sales failed").error, undefined));
  check("SERVICES preserves clientsError", () => assert.equal(run("services", complete, [], [], 0, undefined, undefined, "clients failed").error, "clients failed"));
  for (const field of ["businessType", "storeName"] as const) {
    check(`T10 SERVICES requires ${field}`, () => assert.equal(run("services", { ...complete, [field]: "" }).count, 1));
  }
  check("T11 SERVICES isolates products and requires services", () => {
    assert.equal(run("services", { ...complete, catalogSlug: "" }, [], [], 10).count, 0);
    assert.equal(run("services", complete, [], [], 0).count, 1);
  });
  check("T14 storeLogo is optional across service modes", () => {
    const withoutLogo = { ...complete, storeLogo: "", storeIdentity: undefined };
    assert.equal(run("services", withoutLogo, [], [], 10).count, 0);
    assert.equal(run("both", withoutLogo, [{}], [{}], 10).count, 0);
  });
  for (const [mode, id] of [["both", "T12"], ["products", "T13"]]) {
    check(`${id} ${mode} prior checklist`, () => {
      assert.equal(run(mode).count, 0);
      assert.equal(run(mode, complete, [], []).count, 2);
      assert.equal(run(mode, { ...complete, catalogSlug: "" }).count, 1);
      for (const field of ["appTheme", "businessType", "storeName"]) assert.equal(run(mode, { ...complete, [field]: "" }).count, 1);
      assert.equal(run(mode, complete, [{}], [{}], 10).count, 0);
      if (mode === "both") assert.equal(run(mode, complete, [{}], [{}], 0).count, 1);
      assert.equal(run(mode, complete, [], [], 0, "product failure").error, "product failure");
      assert.equal(run(mode, complete, [], [], 0, undefined, "sale failure").error, "sale failure");
    });
  }
  check("general checklist fallbacks preserved", () => {
    assert.equal(run("services", { ...complete, storeName: "Minha loja" }).count, 1);
    assert.equal(dashboard("services", { ...complete, storeLogo: "", storeIdentity: { logoUrl: "fallback" } }, [{}], [{}], [{}], 10).count, 0);
  });

  const firebaseSource = fs.readFileSync(path.join(sourceRoot, paths.firebase), "utf8");
  check("T15 waitForAuthReady awaits pendingTenantCacheClear before resolving", () => {
    assert.match(firebaseSource, /if \(pendingTenantCacheClear\) \{\s*await pendingTenantCacheClear;\s*\}\s*return user;/);
  });

  // Bundle production modules against controlled I/O boundaries; React and ReactDOM are real.
  const bundled = await build({
    stdin: { contents: browserHarness, resolveDir: root, loader: "ts" },
    bundle: true, write: false, platform: "browser", format: "iife",
    nodePaths: [path.join(root, "node_modules")],
    define: { "process.env.NODE_ENV": '"development"' },
    plugins: [{ name: "controlled-io", setup(b) {
      b.onResolve({ filter: /^test-production:/ }, args => ({ path: path.join(sourceRoot, paths[args.path.slice(16) as keyof typeof paths]) }));
      b.onResolve({ filter: /^(firebase\/auth|firebase\/firestore|@\/lib\/firebase|@\/lib\/firestore-shared-collection)$/ }, args => ({ path: args.path, namespace: "mock" }));
      b.onResolve({ filter: /^\.\/(firebase|api-client)$/ }, args => ({ path: args.path, namespace: "mock" }));
      b.onResolve({ filter: /^\.\/(plan-helpers|plan-paywall-copy)$/ }, args => ({ path: path.join(root, "client/src/lib", args.path.slice(2) + ".ts") }));
      b.onResolve({ filter: /^@shared\// }, args => ({ path: path.join(root, "shared", args.path.slice(8) + ".ts") }));
      b.onLoad({ filter: /.*/, namespace: "mock" }, () => ({ loader: "js", contents: `
        const io = globalThis.__io;
        export const getFirebaseAuth = () => ({});
        export const getCurrentFirebaseUser = () => ({uid: "test-user"});
        export const onAuthStateChanged = (_auth, callback) => { io.authStarts++; io.auth = callback; return () => { io.authStops++; }; };
        export const subscribeSharedUserCollection = (collection, uid, mapper, callback) => { io.starts++; io.collection = collection; io.snapshot = callback; return () => { io.stops++; }; };
        export const getCountFromServer = async () => { if (io.precheckError) throw io.precheckError; return {data: () => ({count: io.count})}; };
        export const apiRequest = async (url, options) => { io.posts.push({url, options}); if (io.serverError) throw io.serverError; return {service: options.body.service, isFirstService: true}; };
        export const collection = () => ({}), getFirestore = () => ({}), doc = () => ({}), getDoc = () => ({}), getDocs = () => ({}), orderBy = () => ({}), query = () => ({}), setDoc = () => ({}), updateDoc = () => ({});
      ` }));
    } }],
  });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<div id="root"></div>');
    await page.evaluate(() => { (globalThis as any).__io = {}; });
    await page.addScriptTag({ content: bundled.outputFiles[0].text });
    const browserResults = await page.evaluate(async () => await (globalThis as any).__tests);
    results.push(...browserResults);
  } finally { await browser.close(); }
  return results;
}

const browserHarness = `
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { useProductsData } from "test-production:products";
import { useSalesData } from "test-production:sales";
import { createService, ServiceLimitError } from "test-production:persistence";
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const io = globalThis.__io;
const results = [];
const equal = (actual, expected) => { if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(JSON.stringify({ actual, expected })); };
async function check(name, fn) { try { await fn(); results.push({name, pass: true}); } catch (error) { results.push({name, pass: false, detail: String(error)}); } }
const reset = () => Object.assign(io, {authStarts: 0, authStops: 0, starts: 0, stops: 0, posts: [], count: 0, precheckError: undefined, serverError: undefined, auth: undefined, snapshot: undefined});
globalThis.__tests = (async () => {
 const input = {name: "Corte", active: true, published: true, pricing: {mode: "fixed", priceCents: 5000}, cost: {kind: "unknown"}, bookingMode: "request", activePlan: "free"};
 await check("T1 technical precheck failure still POSTs", async () => { reset(); io.precheckError = new Error("offline"); const value = await createService(input); equal(io.posts.length, 1); equal(io.posts[0].options.method, "POST"); equal(io.posts[0].url, "/api/services"); equal(value.name, "Corte"); });
 await check("T2 ServiceLimitError blocks POST", async () => { reset(); io.count = 100000; let caught; try {await createService(input);} catch(error) {caught = error;} equal(caught instanceof ServiceLimitError, true); equal(io.posts.length, 0); });
 await check("T3 server error propagates", async () => { reset(); io.serverError = new Error("server rejected"); let caught; try {await createService(input);} catch(error) {caught = error;} equal(caught === io.serverError, true); equal(io.posts.length, 1); });
 for (const [name, hook, field] of [["Products", useProductsData, "products"], ["Sales", useSalesData, "sales"]]) {
  await check(name + " disabled and activation lifecycle (T4/T6 or T5/T7, A-G)", async () => {
   reset(); const container = document.createElement("div"); document.body.append(container); const root = createRoot(container); let latest; const renders = [];
   function Probe({enabled}) { latest = hook({enabled}); renders.push(structuredClone(latest)); return null; }
   try {
    await act(async () => root.render(React.createElement(Probe, {enabled: false})));
    equal(io.authStarts, 0); equal(io.starts, 0); equal(renders.every(state => state.loading === false), true); equal(latest.loading, false); equal(latest[field], []); equal(latest.error, undefined);
    const activationStart = renders.length;
    await act(async () => root.render(React.createElement(Probe, {enabled: true})));
    equal(latest.loading, true); equal(io.authStarts, 1); equal(io.starts, 0);
    equal(renders.slice(activationStart).every(state => state.loading === true), true);
    await act(async () => io.auth({uid: "test-user"}));
    equal(io.starts, 1); equal(io.collection, field); equal(latest.loading, true);
    equal(renders.slice(activationStart).every(state => state.loading === true), true);
    await act(async () => io.snapshot({data: [{id: "first"}], error: undefined}));
    equal(latest.loading, false); equal(latest[field], [{id: "first"}]);
    await act(async () => root.render(React.createElement(Probe, {enabled: false})));
    equal(io.stops, 1); equal(io.authStops, 1); equal(latest.loading, false); equal(latest[field], []); equal(latest.error, undefined);
    const reactivationStart = renders.length;
    await act(async () => root.render(React.createElement(Probe, {enabled: true})));
    equal(renders.slice(reactivationStart).every(state => state.loading === true), true);
    await act(async () => io.auth(null)); equal(latest.loading, false); equal(latest.error, "Not authenticated");
   } finally { await act(async () => root.unmount()); container.remove(); }
  });
  await check(name + " initially enabled resolves subscription", async () => {
   reset(); const container = document.createElement("div"); const root = createRoot(container); let latest;
   function Probe() {latest = hook(); return null;}
   try { await act(async () => root.render(React.createElement(Probe))); equal(latest.loading, true); await act(async () => io.auth({uid: "test-user"})); equal(io.starts, 1); await act(async () => io.snapshot({data: [], error: "read failed"})); equal(latest.loading, false); equal(latest.error, "read failed"); }
   finally { await act(async () => root.unmount()); }
  });
 }
 return results;
})();
`;

const baseline = await suite(root);
for (const result of baseline) console.log(`${result.pass ? "PASS" : "FAIL"} ${result.name}${result.detail ? ": " + result.detail : ""}`);
console.log(`RS-SERVICOS-01R: ${baseline.filter(r => r.pass).length}/${baseline.length} PASS`);
assert(baseline.every(r => r.pass), "Behavioral baseline failed");

if (process.argv.includes("--mutations")) {
  const mutations = [
    { name: "M1", file: paths.persistence, from: "if (error instanceof ServiceLimitError) throw error;", to: "throw error;", expected: "T1" },
    { name: "M2", file: paths.products, from: "const enabled = options.enabled !== false;", to: "const enabled = true;", expected: "Products disabled" },
    { name: "M3", file: paths.dashboard, from: " : clientsError;", to: " : productsError || clientsError;", expected: "T8" },
    { name: "M4", file: paths.dashboard, from: "    input.clientsCount === 0,", to: "    input.productsCount === 0,\n    input.clientsCount === 0,", expected: "T11" },
    { name: "M5", file: paths.products, from: /\n\x20{2}const \[previousEnabled[\s\S]*?(?=\n\x20{2}useEffect)/, to: "  const enabling = false;\n", expected: "Products disabled" },
    { name: "M6", file: paths.dashboard, from: "    !input.settings.businessType,", to: '    input.businessMode !== "services" && !input.settings.businessType,', expected: "T10 SERVICES requires businessType" },
    { name: "M7", file: paths.dashboard, from: "    !input.settings.storeName || String(input.settings.storeName).trim() === \"Minha loja\",", to: "    false,", expected: "T10 SERVICES requires storeName" },
    { name: "M8", file: paths.dashboard, from: "    ...(usesServices ? [input.servicesCount === 0] : []),", to: "    ...(usesServices ? [] : []),", expected: "T11" },
    { name: "M9", file: paths.dashboard, from: /\x20{4}!input\.settings\.storeName \|\| String\(input\.settings\.storeName\)\.trim\(\) === "Minha loja",\r?\n/, to: '    !input.settings.storeName || String(input.settings.storeName).trim() === "Minha loja",\n    !input.settings.storeLogo && !input.settings.storeIdentity?.logoUrl,\n', expected: "T14" },
    { name: "M10", file: paths.firebase, from: /if \(pendingTenantCacheClear\) \{\r?\n\x20{4}await pendingTenantCacheClear;\r?\n\x20{2}\}\r?\n\x20{2}return user;/, to: "return user;", expected: "T15" },
  ];
  let detected = 0;
  for (const mutation of mutations) {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), "rs-correct03-"));
    try {
      for (const relative of Object.values(paths)) { const target = path.join(temp, relative); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(path.join(root, relative), target); }
      const target = path.join(temp, mutation.file);
      const original = fs.readFileSync(target, "utf8");
      const changed = original.replace(mutation.from, mutation.to);
      assert.notEqual(changed, original, `${mutation.name} mutation must apply`);
      fs.writeFileSync(target, changed);
      const results = await suite(temp);
      const failures = results.filter(r => !r.pass);
      assert(failures.some(r => r.name.startsWith(mutation.expected)), `${mutation.name} NOT DETECTED by intended behavior`);
      detected++;
      console.log(`${mutation.name} DETECTED: ${failures.map(r => r.name).join(", ")}`);
    } finally {
      const resolved = path.resolve(temp);
      assert(path.dirname(resolved) === path.resolve(os.tmpdir()) && path.basename(resolved).startsWith("rs-correct03-"));
      fs.rmSync(resolved, { recursive: true, force: true });
    }
  }
  console.log(`Mutations: ${detected}/${mutations.length} DETECTED`);
}
