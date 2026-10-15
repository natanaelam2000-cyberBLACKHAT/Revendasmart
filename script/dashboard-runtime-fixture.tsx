import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { UserSettingsProvider } from "../client/src/providers/UserSettingsProvider";
import Dashboard from "../client/src/pages/dashboard";
import { GlobalErrorBoundary } from "../client/src/components/GlobalErrorBoundary";
import { runSaveMonthlyGoal } from "../client/src/lib/dashboard-helpers";

const state = window as any;
state.IS_REACT_ACT_ENVIRONMENT = true;
state.uid = "A";
state.reads = [];
state.trialImports = 0;
state.feedback = [];
state.globalDiagnostics = 0;
state.invalidations = 0;
state.unhandled = [];
window.addEventListener("unhandledrejection", event => state.unhandled.push(String(event.reason)));
window.addEventListener("revendasmart:user-feedback", event => state.feedback.push((event as CustomEvent).detail));
const root = createRoot(document.getElementById("root")!);
const verify = (ok: unknown, message: string) => { if (!ok) throw new Error(message); };
const render = async () => { await act(async () => { root.render(<GlobalErrorBoundary><UserSettingsProvider><Dashboard /></UserSettingsProvider></GlobalErrorBoundary>); }); };
const click = async (text: string) => {
  const button = [...document.querySelectorAll("button")].find(button => button.textContent === text);
  verify(button, `Missing button ${text}`);
  await act(async () => button!.click());
};
// Each scenario returns its own observations; the runner asserts them individually.
state.scenarios = {
  async trialBanner() {
    await render();
    const mainSurvived = Boolean(document.querySelector("main"));
    const bannerRendered = Boolean(document.querySelector('[data-testid="trial-banner"]'));
    const globalBoundaryTookOver = Boolean(document.querySelector('[data-testid="global-error-boundary"]'));
    await render();
    return { mainSurvived, bannerRendered, globalBoundaryTookOver, trialImports: state.trialImports, globalDiagnostics: state.globalDiagnostics };
  },
  async tenantRemount() {
    state.uid = "A";
    await render();
    const readsAfterA = state.reads.join();
    const tenantA = document.querySelector('[data-testid="today-priorities"]');
    await click("dismiss-test");
    const aDismissed = Boolean(document.querySelector('[data-testid="today-priorities-empty"]'));
    await render();
    const sameUidPreservedState = Boolean(document.querySelector('[data-testid="today-priorities-empty"]'));
    const sameUidSameInstance = document.querySelector('[data-testid="today-priorities"]') === tenantA;
    const readsAfterSameUid = state.reads.join();
    state.uid = "B";
    await render();
    const aUnmountedOnB = !tenantA!.isConnected;
    const bClean = Boolean(document.querySelector('[data-testid="test-card"]'));
    const tenantB = document.querySelector('[data-testid="today-priorities"]');
    // Only dismiss when B started clean; otherwise the runner reports bClean=false instead of a missing button.
    if (bClean) await click("dismiss-test");
    state.uid = null;
    await render();
    const bUnmountedOnAnonymous = !tenantB!.isConnected;
    const anonymousClean = Boolean(document.querySelector('[data-testid="test-card"]'));
    return { readsAfterA, aDismissed, sameUidPreservedState, sameUidSameInstance, readsAfterSameUid, aUnmountedOnB, bClean, bUnmountedOnAnonymous, anonymousClean, reads: state.reads.join() };
  },
  async settingsError() {
    state.settingsStatus = "loading";
    await render();
    const loadingGated = !document.querySelector("main") && document.body.textContent!.includes("Loading");
    state.settingsStatus = "error";
    await render();
    const text = document.body.textContent!;
    const invalidationsBefore = state.invalidations;
    await click("Tentar novamente");
    const retryInvalidated = state.invalidations === invalidationsBefore + 1;
    state.settingsStatus = "loaded";
    await render();
    return { loadingGated, text, retryInvalidated, recovered: Boolean(document.querySelector("main")), globalDiagnostics: state.globalDiagnostics };
  },
  async dataError() {
    state.productsError = "synthetic products error";
    await render();
    const button = [...document.querySelectorAll("button")].find(item => item.textContent === "Tentar novamente");
    const result = {
      text: document.body.textContent!,
      containerClass: button?.parentElement?.className,
      buttonClass: button?.className,
      mainRendered: Boolean(document.querySelector("main")),
    };
    state.productsError = undefined;
    await render();
    return { ...result, recovered: Boolean(document.querySelector("main")) };
  },
  async saveGoal() {
    let loading = false;
    let open = true;
    let refreshed = 0;
    let imports = 0;
    state.saved = [];
    state.feedback = [];
    const load = async () => {
      if (++imports === 1) throw new TypeError("Failed to fetch dynamically imported module");
      return import("../client/src/lib/save-monthly-goal");
    };
    const save = () => runSaveMonthlyGoal("10000", {}, () => { open = false; refreshed++; }, value => { loading = value; }, load);
    const failure = save();
    const loadingWhilePending = loading;
    await failure;
    const afterFailure = { loading, open, refreshed, saved: state.saved.length, feedback: state.feedback.map((item: any) => ({ type: item.type, message: item.message })) };
    await save();
    const afterRetry = { loading, open, refreshed, saved: state.saved.length, monthlyGoal: state.saved[0] ? JSON.parse(state.saved[0]).monthlyGoal : null };
    return { loadingWhilePending, afterFailure, afterRetry, imports };
  },
  async teardown() {
    await act(async () => root.unmount());
    await new Promise(resolve => setTimeout(resolve, 0));
    return { unhandled: state.unhandled.length };
  },
};
