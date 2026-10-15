import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { build } from "esbuild";
import { chromium } from "@playwright/test";

const SETTINGS_ERROR_COPY = "Não foi possível carregar as configurações do negócio.";
const DATA_ERROR_COPY = "Ocorreu um erro temporário.";
// Latin-1 bytes decoded as UTF-8 (U+FFFD) or UTF-8 bytes re-decoded as Latin-1 (0xC3/0xC2 followed by a continuation char).
const REPLACEMENT_CHAR = String.fromCharCode(0xfffd);
const MOJIBAKE = new RegExp(`${REPLACEMENT_CHAR}|[\xC3\xC2][\x80-\xBF]`);

function assertCleanUtf8(file: string): string {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(fs.readFileSync(file));
  assert.doesNotMatch(text, MOJIBAKE, `${file} must not contain mojibake`);
  return text;
}

// RUNTIME_REAL: production Dashboard, boundaries, TodayPriorities, coordinator and save.
// Only external data/services and card presentation are replaced at the module boundary.
const mocks: Record<string, string> = {
  "@/components/layout": 'export const Layout = ({children}) => <div>{children}</div>;',
  "@/components/PageSkeleton": 'export const PageSkeleton = () => <div>Loading</div>;',
  "@/hooks/useClientsLiteData": 'export const useClientsLiteData = () => ({clients:[],loading:false});',
  "@/hooks/useProductsData": 'export const useProductsData = () => ({products:[],loading:false,error:window.productsError});',
  "@/hooks/useSalesData": 'export const useSalesData = () => ({sales:[],loading:false});',
  "@/hooks/useUserSettings": 'export const useUserSettings = () => ({userId:window.uid,settings:{},loading:window.settingsStatus==="loading",error:window.settingsStatus==="error"?"synthetic error":undefined,onboarding_completed:true,businessModeResolution:{resolved:window.settingsStatus!=="error",mode:"products",status:window.settingsStatus??"loaded"},loaded:window.settingsStatus!=="loading",loadStatus:window.settingsStatus??"loaded"}); export const invalidateUserSettings = () => {window.invalidations++;};',
  "next-themes": 'export const useTheme = () => ({resolvedTheme:"light"});',
  "@/lib/app-themes": 'export const applyAppTheme = () => {};',
  "@/providers/PlanProvider": 'export const usePlan = () => ({trial:{},hasPremiumAccess:true,loading:false,planResolved:true});',
  "@/components/dashboard/TrialBanner": 'window.trialImports++; throw new TypeError("TrialBanner lazy import rejected"); export default () => <div data-testid="trial-banner"/>;',
  "@/lib/client-diagnostics": 'export const reportClientDiagnostic = () => {window.globalDiagnostics++; return Promise.resolve();};',
  "@/lib/opportunities-client": 'export const fetchOpportunities = () => { window.reads.push(window.uid ?? "anonymous"); return Promise.resolve({opportunities:[{fingerprint:"one",entityReference:{type:"client",id:"1",name:"Test"},reason:"Test"}]}); }; export const markOpportunityAction = () => Promise.resolve();',
  "./OpportunityCard": 'export const OpportunityCard = ({opportunity,onDismiss}) => <div data-testid="test-card"><button onClick={()=>onDismiss(opportunity)}>dismiss-test</button></div>;',
  "@/lib/firebase": 'export const getFirebaseAuth = () => ({currentUser:{uid:"test",getIdToken:async()=>"synthetic"}}); export const waitForAuthReady = async()=>({uid:"test"});',
  "@/lib/api-config": 'export const getApiUrl = path => path;',
  "@/components/dashboard/ServicesOverviewSection": 'export default () => null; export const fetchDashboardServicesCount = async () => 0;',
};

async function run() {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const pageErrors: string[] = [];
    page.on("pageerror", error => pageErrors.push(error.message));
    await page.setContent('<div id="root"></div>');
    const result = await build({
      entryPoints: [path.resolve("script/dashboard-runtime-fixture.tsx")],
      bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic", charset: "utf8",
      define: { "import.meta.env": "{}" },
      plugins: [{ name: "synthetic-services", setup(builder) {
        builder.onResolve({ filter: /.*/ }, args => args.path in mocks ? { path: args.path, namespace: "fixture" } : undefined);
        builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: mocks[args.path], loader: "tsx", resolveDir: process.cwd() }));
      } }],
    });
    await page.addScriptTag({ content: result.outputFiles[0].text });
    await page.evaluate(() => {
      window.fetch = async (_url, options) => {
        (window as any).saved.push(options?.body);
        return new Response("{}", { status: 200 });
      };
    });
    const bundleText = result.outputFiles[0].text;
    assert.ok(!bundleText.includes(REPLACEMENT_CHAR), "Built fixture bundle must not contain U+FFFD");
    assert.ok(bundleText.includes(SETTINGS_ERROR_COPY), "Built bundle must carry the exact settings error copy");
    const scenario = (name: string) => page.evaluate(n => (window as any).scenarios[n](), name);

    const trial = await scenario("trialBanner");
    assert.equal(trial.mainSurvived, true, "Dashboard must survive TrialBanner lazy rejection");
    assert.equal(trial.bannerRendered, false, "Failed banner must disappear");
    assert.equal(trial.globalBoundaryTookOver, false, "GlobalErrorBoundary must not take over");
    assert.equal(trial.trialImports, 1, "Lazy rejection must not retry in a loop");
    assert.equal(trial.globalDiagnostics, 0, "Local failure must never call global diagnostic boundary");
    console.log("TRIAL_BANNER_RUNTIME=PASS: lazy rejection contained locally; no retry; global boundary untouched.");

    const tenant = await scenario("tenantRemount");
    assert.equal(tenant.readsAfterA, "A", "A mounted once");
    assert.equal(tenant.aDismissed, true, "A internal state changed");
    assert.equal(tenant.sameUidPreservedState, true, "Same UID must preserve state");
    assert.equal(tenant.sameUidSameInstance, true, "Same UID must keep the same DOM instance");
    assert.equal(tenant.readsAfterSameUid, "A", "Same UID must not remount");
    assert.equal(tenant.aUnmountedOnB, true, "A instance must unmount when UID changes to B");
    assert.equal(tenant.bClean, true, "B cannot retain A dismissed state");
    assert.equal(tenant.bUnmountedOnAnonymous, true, "B instance must unmount on sign-out");
    assert.equal(tenant.anonymousClean, true, "Anonymous cannot retain B state");
    assert.equal(tenant.reads, "A,B,anonymous", "Each tenant mounts exactly once");
    console.log("TENANT_REMOUNT_RUNTIME=PASS: same UID keeps state; A->B->anonymous remount clean.");

    const settingsError = await scenario("settingsError");
    assert.equal(settingsError.loadingGated, true, "Provider loading must keep Dashboard gated");
    assert.ok(settingsError.text.includes(SETTINGS_ERROR_COPY), "Provider error must render exact UTF-8 copy");
    assert.doesNotMatch(settingsError.text, MOJIBAKE, "Rendered error copy must not contain mojibake");
    assert.equal(settingsError.retryInvalidated, true, "Settings error retry must invoke real provider refresh");
    assert.equal(settingsError.recovered, true, "Dashboard must recover after settings reload");
    assert.equal(settingsError.globalDiagnostics, 0, "Settings error must stay local");
    console.log("SETTINGS_ERROR_RUNTIME=PASS: exact copy rendered, retry refreshes provider, recovery works.");

    const dataError = await scenario("dataError");
    assert.equal(dataError.mainRendered, false, "Data error must replace the dashboard body");
    assert.ok(dataError.text.includes(DATA_ERROR_COPY), "Data error copy preserved");
    assert.ok(!dataError.text.includes(SETTINGS_ERROR_COPY), "Data error must not reuse settings copy");
    assert.equal(dataError.containerClass, "mx-auto max-w-3xl px-4 py-8 text-center", "Data error container layout preserved");
    assert.match(String(dataError.buttonClass), /\btext-sm\b/, "Data error button keeps text-sm");
    assert.match(String(dataError.buttonClass), /\bfont-bold\b/, "Data error button keeps font-bold");
    assert.doesNotMatch(String(dataError.buttonClass), /\btext-xs\b|\bfont-semibold\b/, "Data error button must not inherit settings-error classes");
    assert.equal(dataError.recovered, true, "Dashboard renders again once data error clears");
    console.log("DATA_ERROR_RUNTIME=PASS: original layout/classes/copy preserved.");

    const goal = await scenario("saveGoal");
    assert.equal(goal.loadingWhilePending, true, "Loading true while import is pending");
    assert.deepEqual(goal.afterFailure, { loading: false, open: true, refreshed: 0, saved: 0, feedback: [{ type: "error", message: "Erro ao salvar meta mensal." }] }, "Import failure must clean loading, keep editor open, not save and report feedback");
    assert.deepEqual(goal.afterRetry, { loading: false, open: false, refreshed: 1, saved: 1, monthlyGoal: 10000 }, "Retry must execute the real save, close editor and refresh");
    assert.equal(goal.imports, 2, "Retry must re-attempt the import");
    console.log("SAVE_GOAL_HELPER_RUNTIME=PASS: import failure cleanup, feedback and real save retry.");

    const teardown = await scenario("teardown");
    assert.equal(teardown.unhandled, 0, "No unhandled rejection");
    assert.deepEqual(pageErrors, [], "No uncaught browser runtime error");

    // SOURCE_ONLY: wiring and eager dependency contracts supplement runtime proofs.
    const dashboard = assertCleanUtf8("client/src/pages/dashboard.tsx");
    assertCleanUtf8("script/dashboard-runtime-fixture.tsx");
    assertCleanUtf8("script/dashboard-runtime-resilience-tests.ts");
    assert.ok(dashboard.includes(SETTINGS_ERROR_COPY), "dashboard.tsx must carry the exact settings error copy");
    assert.match(dashboard, /className="min-h-32 rounded-2xl bg-secondary\/30 p-4" role="status"/, "Priorities fallback keeps p-4");
    assert.ok(!fs.existsSync("client/src/components/dashboard/ServicesOverviewLoader.tsx"), "No intermediate ServicesOverview loader");
    assert.match(dashboard, /lazy\(loadServicesOverview\)/, "Services section loads directly from its own module");
    const provider = fs.readFileSync("client/src/providers/UserSettingsProvider.tsx", "utf8");
    assert.match(provider, /userId: userId \?\? null/);
    assert.match(provider, /resolvedSettings, userId\]/);
    assert.doesNotMatch(dashboard, /from ["']@\/lib\/firebase["']/);
    assert.match(dashboard, /runSaveMonthlyGoal\(/);
    console.log("SOURCE_ONLY: UTF-8/mojibake guard, provider UID memo, priorities fallback, direct services loader and eager Firebase contract passed.");
  } finally {
    await browser.close();
  }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
