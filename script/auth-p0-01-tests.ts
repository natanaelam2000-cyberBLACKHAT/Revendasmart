import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { build } from "esbuild";
import vm from "node:vm";

const root = process.cwd();
const firebasePath = path.join(root, "client/src/lib/firebase.ts");
const apiClientPath = path.join(root, "client/src/lib/api-client.ts");
const baselineFirebaseSource = process.env.AUTH_P0_BASELINE === "1"
  ? execFileSync("git", ["show", "HEAD:client/src/lib/firebase.ts"], { encoding: "utf8" })
  : null;

const browserHarness = `
import { waitForAuthReady } from "test-production:firebase";
import { apiRequest } from "test-production:api-client";

const io = globalThis.__io;
const user = (uid) => ({ uid, email: uid + "@example.test", getIdToken: async () => "token-" + uid });
const flush = async () => { await Promise.resolve(); await new Promise((resolve) => setTimeout(resolve, 0)); };
const emit = async (nextUser) => {
  io.auth.currentUser = nextUser;
  for (const callback of [...io.authListeners]) callback(nextUser);
  await flush();
};
const check = async (name, operation) => {
  try { await operation(); return { name, pass: true }; }
  catch (error) { return { name, pass: false, detail: String(error) }; }
};
const equal = (actual, expected) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(JSON.stringify({ actual, expected }));
};

globalThis.__tests = (async () => {
  const results = [];

  if (io.scenario === "existing-user") {
    io.auth.currentUser = io.startingUser;
    const initial = waitForAuthReady();
    equal(io.authListenerStarts, 2);
    await emit(io.startingUser);
    equal(await initial, io.startingUser);

    const logoutResultPromise = (async () => {
      await emit(null);
      return waitForAuthReady();
    })();
    await flush();
    io.cacheClearRelease();
    results.push(await check("T3 existing A -> logout returns null", async () => equal(await logoutResultPromise, null)));

    await emit(user("user-b"));
    results.push(await check("T4 existing A -> logout -> B returns B", async () => equal(await waitForAuthReady(), user("user-b"))));
    return results;
  }

  io.auth.currentUser = null;

  const bootstrapCalls = Array.from({ length: 20 }, () => waitForAuthReady());
  equal(io.authListenerStarts, 2);
  await emit(null);
  const bootstrapResults = await Promise.all(bootstrapCalls);
  equal(bootstrapResults, Array(20).fill(null));
  equal(io.authListenerStarts, 2);
  equal(io.authListeners.length, 1);
  equal(io.authListenerStops, 1);
  results.push(await check("T1 app starts without a user => null", async () => equal(bootstrapResults[0], null)));
  results.push(await check("T5 concurrent bootstrap calls use bounded listeners", async () => equal(io.authListenerStarts, 2)));

  const userA = user("user-a");
  await emit(userA);
  results.push(await check("T2 null -> login A returns A", async () => equal(await waitForAuthReady(), userA)));

  io.cacheClearRelease = null;
  const logoutResultPromise = (async () => {
    await emit(null);
    return waitForAuthReady();
  })();
  await flush();
  results.push(await check("T6 waitForAuthReady waits for pendingTenantCacheClear", async () => {
    equal(io.cacheClearStarted, true);
    equal(io.cacheClearReleased, false);
    io.cacheClearRelease();
    equal(await logoutResultPromise, null);
  }));
  results.push(await check("T3 logout returns null", async () => equal(await waitForAuthReady(), null)));

  const userB = user("user-b");
  await emit(userB);
  results.push(await check("T4 A -> logout -> B returns B", async () => equal(await waitForAuthReady(), userB)));

  let authorization = null;
  results.push(await check("T7 authenticated apiRequest uses current user's token", async () => {
    await apiRequest("/api/auth-probe", {
      auth: true,
      fetchImpl: async (_url, init) => {
        authorization = new Headers(init.headers).get("Authorization");
        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } });
      },
    });
    equal(authorization, "Bearer token-user-b");
  }));

  for (const uid of ["user-a", "user-b", "user-a"]) {
    await emit(user(uid));
    if (io.cacheClearRelease) io.cacheClearRelease();
    results.push(await check("T5/T6 direct UID swap " + uid, async () => equal((await waitForAuthReady())?.uid, uid)));
  }
  results.push(await check("T7 five concurrent calls", async () => equal((await Promise.all(Array.from({length: 5}, () => waitForAuthReady()))).map(u => u?.uid), Array(5).fill("user-a"))));
  results.push(await check("T9 token refresh", async () => {
    io.auth.currentUser.getIdToken = async () => "refreshed-a";
    await apiRequest("/api/probe", { auth: true, fetchImpl: async (_url, init) => {
      equal(new Headers(init.headers).get("Authorization"), "Bearer refreshed-a");
      return new Response("{}", { headers: { "Content-Type": "application/json" } });
    }});
  }));
  return results;
})();
`;

const genericSupportModule = `
export const initializeErrorLogging = () => {};
export const logError = () => {};
export const setUserContext = () => {};
export const initializeInternalTelemetry = () => {};
export const logTelemetryEvent = async () => {};
export const setTelemetryUserId = () => {};
export const clearTelemetryUserId = () => {};
export const initializeFirebaseAnalytics = () => {};
export const trackAnalyticsEvent = () => {};
export const setFirebaseAnalyticsUserId = () => {};
export const setFirebaseAnalyticsUserProperty = () => {};
export const initializeFirebasePerformance = () => {};
export const measureOperation = async (_name, operation) => operation();
export const measureSyncOperation = (_name, operation) => operation();
export const createTrace = () => null;
export const withPerformanceTrace = async (_name, operation) => operation();
export const initializeRemoteConfig = async () => {};
export const fetchRemoteConfig = async () => {};
export const refreshRemoteConfig = async () => {};
export const setupConfigUpdateListener = () => {};
export const unsubscribeFromConfigUpdates = () => {};
export const isFeatureEnabled = () => false;
export const getFlag = () => undefined;
export const getAllFlags = () => ({});
export const getMaintenanceInfo = () => ({ enabled: false, message: "" });
`;

const bundled = await build({
  stdin: { contents: browserHarness, resolveDir: root, loader: "ts" },
  bundle: true,
  write: false,
  platform: "browser",
  format: "iife",
  nodePaths: [path.join(root, "node_modules")],
  define: {
    "import.meta.env.VITE_FIREBASE_API_KEY": JSON.stringify("test-api-key"),
    "import.meta.env.VITE_FIREBASE_AUTH_DOMAIN": JSON.stringify("test.example.com"),
    "import.meta.env.VITE_FIREBASE_PROJECT_ID": JSON.stringify("test-project"),
    "import.meta.env.VITE_FIREBASE_STORAGE_BUCKET": JSON.stringify("test.appspot.com"),
    "import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID": JSON.stringify("test-sender"),
    "import.meta.env.VITE_FIREBASE_APP_ID": JSON.stringify("test-app"),
    "import.meta.env.VITE_USE_FIREBASE_EMULATORS": JSON.stringify("false"),
    "import.meta.env.PROD": "false",
    "import.meta.env.DEV": "true",
    "import.meta.env.VITE_API_BASE_URL": JSON.stringify(""),
  },
  plugins: [{
    name: "auth-p0-controlled-firebase",
    setup(plugin) {
      plugin.onResolve({ filter: /^test-production:firebase$/ }, () => ({ path: firebasePath }));
      plugin.onResolve({ filter: /^test-production:api-client$/ }, () => ({ path: apiClientPath }));
      plugin.onResolve({ filter: /^\.\/firebase$/ }, () => ({ path: firebasePath }));
      plugin.onResolve({ filter: /^\.\/api-config$/ }, () => ({ path: path.join(root, "client/src/lib/api-config.ts") }));
      plugin.onResolve({ filter: /^\.\/(error-logging|internal-telemetry|firebase-analytics|firebase-performance|remote-config)$/ }, (args) => ({ path: args.path, namespace: "auth-p0-support" }));
      plugin.onResolve({ filter: /^\.\/mock-data$/ }, () => ({ path: "auth-p0-mock-data", namespace: "auth-p0-support" }));
      plugin.onLoad({ filter: /.*/, namespace: "auth-p0-support" }, (args) => {
        if (args.path === "auth-p0-mock-data") return { loader: "js", contents: "export const clearAllImagesFromIndexedDb = async () => {};" };
        return { loader: "js", contents: genericSupportModule };
      });
      plugin.onResolve({ filter: /^firebase\/app$/ }, () => ({ path: "firebase-app", namespace: "auth-p0-firebase" }));
      plugin.onResolve({ filter: /^firebase\/auth$/ }, () => ({ path: "firebase-auth", namespace: "auth-p0-firebase" }));
      plugin.onResolve({ filter: /^firebase\/firestore$/ }, () => ({ path: "firebase-firestore", namespace: "auth-p0-firebase" }));
      plugin.onResolve({ filter: /^firebase\/storage$/ }, () => ({ path: "firebase-storage", namespace: "auth-p0-firebase" }));
      plugin.onLoad({ filter: /.*/, namespace: "auth-p0-firebase" }, (args) => {
        if (args.path === "firebase-app") return { loader: "js", contents: `
          let app = { name: "test-app" };
          export const initializeApp = () => app;
          export const getApps = () => [];
          export const getApp = () => app;
        ` };
        if (args.path === "firebase-auth") return { loader: "js", contents: `
          const io = globalThis.__io;
          export const getAuth = () => io.auth;
          export const connectAuthEmulator = () => {};
          export const browserLocalPersistence = {};
          export const setPersistence = async () => {};
          export const onAuthStateChanged = (_auth, callback) => {
            io.authListenerStarts++;
            io.authListeners.push(callback);
            let active = true;
            return () => { if (active) { active = false; io.authListenerStops++; io.authListeners = io.authListeners.filter((listener) => listener !== callback); } };
          };
        ` };
        return { loader: "js", contents: `
          const io = globalThis.__io;
          export const initializeFirestore = () => {};
          export const getFirestore = () => ({});
          export const persistentLocalCache = () => ({});
          export const persistentMultipleTabManager = () => ({});
          export const terminate = async () => {
            io.cacheClearStarted = true;
            await new Promise((resolve) => { io.cacheClearRelease = resolve; });
            io.cacheClearReleased = true;
          };
          export const clearIndexedDbPersistence = async () => {};
        ` };
      });
      if (baselineFirebaseSource) {
        plugin.onLoad({ filter: /firebase\.ts$/ }, () => ({ loader: "ts", contents: baselineFirebaseSource }));
      }
    },
  }],
});

async function runScenario(scenario: string) {
  const context = vm.createContext({ console, setTimeout, clearTimeout, Headers, Response, AbortController, DOMException, URLSearchParams, Blob, FormData, ArrayBuffer, ReadableStream,
    __io: { scenario, startingUser: { uid: "user-a", email: "user-a@example.test" }, auth: { currentUser: null }, authListeners: [], authListenerStarts: 0, authListenerStops: 0, cacheClearStarted: false, cacheClearReleased: false, cacheClearRelease: null },
  });
  vm.runInContext(bundled.outputFiles[0].text, context);
  const results = await Promise.race([context.__tests, new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error("Auth harness timed out")), 5000); timer.unref(); })]) as Array<{name: string; pass: boolean; detail?: string}>;
  for (const result of results) console.log(`${result.pass ? "PASS" : "FAIL"} ${result.name}${result.detail ? ": " + result.detail : ""}`);
  if (results.some((result) => !result.pass)) process.exitCode = 1;
}
await runScenario("bootstrap-null");
await runScenario("existing-user");

const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), "utf8");
const productAccess = read("client/src/hooks/useProductAccessList.ts");
const planUsage = read("client/src/hooks/usePlanUsageSnapshot.ts");
const admin = read("client/src/pages/admin.tsx");
const productEditor = read("client/src/pages/add-product.tsx");
const sourceChecks: Array<[string, () => void]> = [
  ["T8 access/usage hooks derive reads from waitForAuthReady UID", () => {
    assert.match(productAccess, /const uid = \(await waitForAuthReady\(\)\)\?\.uid/);
    assert.match(productAccess, /fetchAllProducts\(uid\)/);
    assert.match(productAccess, /getCurrentFirebaseUser\(\)\?\.uid !== uid/);
    assert.match(productAccess, /setProducts\(\[\]\)/);
    assert.match(planUsage, /const uid = \(await waitForAuthReady\(\)\)\?\.uid/);
    assert.match(planUsage, /fetchDomainAccessCounts\(uid, "products"\)/);
    assert.match(planUsage, /fetchDomainAccessCounts\(uid, "services"\)/);
    assert.match(planUsage, /getCurrentFirebaseUser\(\)\?\.uid !== uid/);
    assert.match(planUsage, /setSnapshot\(null\)/);
  }],
  ["T9 admin identity is derived from current Firebase user", () => {
    assert.doesNotMatch(admin, /getCurrentUserId\(\)/);
    assert.doesNotMatch(admin, /getUsers\(\)/);
    assert.match(admin, /user\??\.uid/);
  }],
  ["T10 product edit reads under the awaited user's tenant path", () => {
    assert.match(productEditor, /getDoc\(doc\(firestore, "users", user\.uid, "products", id\)\)/);
    assert.match(productEditor, /getFirebaseAuth\(\)\?\.currentUser\?\.uid !== user\.uid/);
  }],
];
if (!baselineFirebaseSource) {
  for (const [name, operation] of sourceChecks) {
    try { operation(); console.log(`PASS ${name}`); }
    catch (error) { console.log(`FAIL ${name}: ${String(error)}`); process.exitCode = 1; }
  }
}

// Executes the production hooks with a controlled React lifecycle and Firestore I/O.
// No DOM, browser, network, or duplicated hook implementation is involved.
const hookBundle = await build({
  stdin: { contents: `import { useProductAccessList } from "./client/src/hooks/useProductAccessList";
    import { usePlanUsageSnapshot } from "./client/src/hooks/usePlanUsageSnapshot";
    globalThis.hooks = { product: useProductAccessList, usage: usePlanUsageSnapshot };`, resolveDir: root },
  bundle: true, write: false, platform: "node", format: "iife",
  plugins: [{ name: "controlled-hook-io", setup(plugin) {
    plugin.onResolve({ filter: /^\.\/client\/src\/hooks\// }, args => ({ path: path.join(root, args.path + ".ts") }));
    plugin.onResolve({ filter: /^(react|firebase\/auth|firebase\/firestore|@\/lib\/firebase|@\/providers\/PlanProvider|@shared\/monetization|@\/lib\/booking-quota|@\/lib\/ads-pro-preparation-quota)$/ }, args => ({ path: args.path, namespace: "hook-io" }));
    plugin.onLoad({ filter: /.*/, namespace: "hook-io" }, args => {
      const modules: Record<string, string> = {
        react: `const h = globalThis.h;
          export const useState = initial => { const i=h.cursor++; if (!(i in h.cells)) h.cells[i]=initial; return [h.cells[i], value => { if (!h.active) throw Error("setState after unmount"); h.cells[i]=value; }]; };
          export const useRef = initial => { const i=h.cursor++; if (!(i in h.cells)) h.cells[i]={current: initial}; return h.cells[i]; };
          export const useCallback = fn => fn;
          export const useEffect = fn => { if (h.mounting) h.effects.push(fn); };`,
        "firebase/auth": `export const onAuthStateChanged = (_auth, cb) => { const h=globalThis.h; h.listeners.add(cb); queueMicrotask(() => { if(h.listeners.has(cb)) cb(h.auth.currentUser); }); return () => h.listeners.delete(cb); };`,
        "@/lib/firebase": `export const getFirebaseAuth = () => globalThis.h.auth;
          export const getCurrentFirebaseUser = () => globalThis.h.auth.currentUser;
          export const waitForAuthReady = async () => { if(globalThis.h.barrier) await globalThis.h.barrier; return globalThis.h.auth.currentUser; };`,
        "firebase/firestore": `const h=globalThis.h;
          export const getFirestore = () => ({});
          export const collection = (_db, ...parts) => ({uid:parts[1], domain:parts[2]});
          export const documentId = () => "id"; export const limit = () => ({}); export const orderBy = () => ({}); export const startAfter = () => ({}); export const where = () => ({});
          export const query = base => base;
          export const getDocs = base => new Promise((resolve,reject) => h.requests.push({ ...base, resolve, reject }));
          export const getCountFromServer = base => new Promise(resolve => h.counts.push({...base, resolve}));`,
        "@/providers/PlanProvider": `export const usePlan = () => ({activePlan:"pro",basePlan:"pro",trial:null,loading:false});`,
        "@shared/monetization": `export const buildPlanUsageSnapshot = (_plan, counts) => counts;`,
        "@/lib/booking-quota": `export const getCurrentMonthBookingUsage = async () => ({used:0,monthKey:"test"});`,
        "@/lib/ads-pro-preparation-quota": `export const getCurrentMonthPreparationUsage = async () => ({used:0,monthKey:"test"});`,
      };
      return { contents: modules[args.path], loader: "js" };
    });
  }}],
});
const flushHooks = async () => { for (let i=0;i<20;i++) await Promise.resolve(); };
function hookRuntime(kind: "product" | "usage", uid: string | null) {
  const h = { cursor:0, cells:[] as any[], effects:[] as Array<() => any>, active:true, mounting:true,
    listeners:new Set<(user:any)=>void>(), auth:{currentUser:uid ? {uid} : null as any}, requests:[] as any[], counts:[] as any[], barrier:null as Promise<void> | null };
  const context = vm.createContext({h, console, queueMicrotask});
  vm.runInContext(hookBundle.outputFiles[0].text,context);
  const render = () => { h.cursor=0; return context.hooks[kind](); };
  render(); const cleanups=h.effects.map(fn=>fn()); h.mounting=false;
  return {h, render, emit(next:string|null) { h.auth.currentUser=next ? {uid:next}:null; for(const cb of h.listeners) cb(h.auth.currentUser); },
    unmount() { cleanups.forEach(fn=>fn?.()); h.active=false; },
    resolve(request:any, state="active") { request.resolve({docs:[{id:request.uid,data:()=>({name:request.uid,planAccessState:state})}]}); },
  };
}
async function hookCheck(name:string, operation:()=>Promise<void>) {
  try { await operation(); console.log(`PASS ${name}`); }
  catch(error) { console.error(`FAIL ${name}: ${error}`); process.exitCode=1; }
}
await hookCheck("T10 ProductAccess Pro -> Free and Free -> Pro auto refetch", async () => {
  for(const states of [["active","preserved"],["preserved","active"]]) {
    const r=hookRuntime("product","A"); await flushHooks(); r.resolve(r.h.requests[0],states[0]); await flushHooks();
    assert.equal(r.render().products[0].id,"A");
    r.emit("B"); assert.equal(r.render().products.length,0); assert.equal(r.render().loading,true);
    await flushHooks(); assert.equal(r.h.requests[1].uid,"B"); r.resolve(r.h.requests[1],states[1]); await flushHooks();
    assert.equal(r.render().products[0].id,"B"); assert.equal(r.render().products[0].planAccessState,states[1]); assert.equal(r.render().loading,false); r.unmount();
  }
});
await hookCheck("T11 pending A -> B; late success/error cannot overwrite B", async () => {
  for(const failure of [false,true]) {
    const r=hookRuntime("product","A"); await flushHooks(); const a=r.h.requests[0];
    r.emit("B"); await flushHooks(); r.resolve(r.h.requests[1]); await flushHooks();
    if(failure) a.reject(Error("late A")); else r.resolve(a); await flushHooks();
    assert.equal(r.render().products[0].id,"B"); assert.equal(r.render().error,""); assert.equal(r.render().loading,false); r.unmount();
  }
});
await hookCheck("T6 rapid A -> B -> A discards earlier A generation", async () => {
  const r=hookRuntime("product","A"); await flushHooks(); const first=r.h.requests[0];
  r.emit("B"); r.emit("A"); await flushHooks(); assert.equal(r.h.requests.length,2);
  r.resolve(first); await flushHooks(); assert.equal(r.render().products.length,0);
  r.resolve(r.h.requests[1]); await flushHooks(); assert.equal(r.render().products[0].id,"A"); r.unmount();
});
await hookCheck("T12 null/login/logout, refresh, unmount/reopen listener cleanup", async () => {
  for(let i=0;i<3;i++) {
    const r=hookRuntime("product",null); await flushHooks(); assert.equal(r.render().loading,false); assert.equal(r.h.listeners.size,1);
    r.emit("A"); await flushHooks(); const count=r.h.requests.length; r.emit("A"); await flushHooks(); assert.equal(r.h.requests.length,count);
    r.emit(null); await flushHooks(); r.resolve(r.h.requests[0]); await flushHooks(); assert.equal(r.render().products.length,0);
    r.emit("B"); await flushHooks(); const pending=r.h.requests.at(-1); r.unmount(); assert.equal(r.h.listeners.size,0); r.resolve(pending); await flushHooks(); r.emit("A");
  }
});
await hookCheck("T8 ProductAccess waits for tenant cache before B read", async () => {
  const r=hookRuntime("product","A"); await flushHooks(); let release!:()=>void;
  r.h.barrier=new Promise<void>(resolve=>{release=resolve;}); r.emit("B"); await flushHooks(); assert.equal(r.h.requests.length,1); assert.equal(r.render().products.length,0);
  release(); await flushHooks(); assert.equal(r.h.requests[1].uid,"B"); r.unmount(); r.resolve(r.h.requests[0]); r.resolve(r.h.requests[1]); await flushHooks();
});
await hookCheck("PlanUsage pending A response after B cannot publish A snapshot", async () => {
  const r=hookRuntime("usage","A"); await flushHooks(); r.emit("B");
  for(const req of r.h.counts) req.resolve({data:()=>({count:1})}); await flushHooks(); assert.equal(r.render().snapshot,null); r.unmount();
});
await hookCheck("PlanUsage loaded A is hidden after B render", async () => {
  const r=hookRuntime("usage","A"); await flushHooks();
  for(const req of r.h.counts) req.resolve({data:()=>({count:1})}); await flushHooks();
  assert.ok(r.render().snapshot); r.emit("B"); assert.equal(r.render().snapshot,null); r.unmount();
});
await hookCheck("T7 ProductAccess 5/20 concurrent refresh calls settle latest generation only", async () => {
  for(const count of [5,20]) {
    const r=hookRuntime("product","A"); await flushHooks(); r.resolve(r.h.requests[0]); await flushHooks();
    const calls=Array.from({length:count},()=>r.render().refresh()); await flushHooks();
    assert.equal(r.h.requests.length,2); r.resolve(r.h.requests[1]); await Promise.all(calls); assert.equal(r.render().products[0].id,"A"); assert.equal(r.render().loading,false); r.unmount();
  }
});
await hookCheck("T10 render before auth callback cannot expose previous tenant products", async () => {
  const r=hookRuntime("product","A"); await flushHooks(); r.resolve(r.h.requests[0]); await flushHooks(); assert.equal(r.render().products[0].id,"A");
  r.h.auth.currentUser={uid:"B"}; assert.equal(r.render().products.length,0); r.unmount();
});
await hookCheck("T13 npm test invokes auth suite exactly once and propagates failure", async () => {
  const scripts=JSON.parse(read("package.json")).scripts;
  const commands=scripts.test.split(/\s*&&\s*/);
  assert.equal(commands.filter((cmd:string)=>cmd === "npm run test:auth-p0-01" || cmd === "tsx script/auth-p0-01-tests.ts").length,1);
  assert.equal(commands[0],"npm run test:auth-p0-01"); assert.equal(scripts["test:auth-p0-01"],"tsx script/auth-p0-01-tests.ts");
});
