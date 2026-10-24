import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import vm from "node:vm";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const requireTest = createRequire(import.meta.url);
const networkGuard = requireTest("./rs-infra-recovery-01-network-guard.mjs") as { getAttempts(): number };
const root = path.resolve(process.env.RS_INFRA_CANDIDATE_ROOT || path.join(testDirectory, ".."));
const requireCandidate = createRequire(path.join(root, "package.json"));
const cases: string[] = [];

type FakeRequest = {
  headers: Record<string, string>;
  method: string;
  path: string;
  params: { userId: string };
  firebaseUid?: string;
};

function responseRecorder() {
  return {
    statusCode: 200,
    ended: false,
    body: undefined as unknown,
    headers: new Map<string, string>(),
    status(code: number) { this.statusCode = code; return this; },
    json(body: unknown) { this.body = body; this.ended = true; return this; },
    sendStatus(code: number) { this.statusCode = code; this.ended = true; return this; },
    header(name: string, value: string) { this.headers.set(name.toLowerCase(), value); return this; },
  };
}

function request(overrides: Partial<FakeRequest> = {}): FakeRequest {
  return {
    headers: { origin: "https://localhost", authorization: "Bearer synthetic-owner-token" },
    method: "GET",
    path: "/api/user/settings/synthetic-owner",
    params: { userId: "synthetic-owner" },
    ...overrides,
  };
}

type AnyMiddleware = (req: any, res: any, next: () => void) => unknown;

function loadRealCorsMiddleware(): AnyMiddleware {
  // Importing server/index.ts would execute startup and initialize Admin. Instead,
  // execute its actual isolated CORS policy block with a recorder, never listen().
  const source = readFileSync(path.join(root, "server/index.ts"), "utf8");
  const start = source.indexOf("function normalizeCorsOrigin(");
  const end = source.indexOf("export function log(", start);
  assert(start >= 0 && end > start, "the real CORS block must remain identifiable");
  assert(start < source.indexOf("await registerRoutes(httpServer, app)"), "CORS must be registered before authenticated routes");
  const typescript = requireCandidate("typescript") as typeof import("typescript");
  const javascript = typescript.transpileModule(source.slice(start, end), {
    compilerOptions: { target: typescript.ScriptTarget.ES2022, module: typescript.ModuleKind.CommonJS },
  }).outputText;
  const handlers: AnyMiddleware[] = [];
  vm.runInNewContext(javascript, {
    app: { use: (middleware: AnyMiddleware) => handlers.push(middleware) },
    process: { env: Object.freeze({}) },
    URL,
  }, { timeout: 1_000, filename: "real-server-cors-policy.js" });
  assert.equal(handlers.length, 1, "one actual CORS middleware expected");
  return handlers[0];
}

function loadRealErrorResponder(): (...args: any[]) => unknown {
  const source = readFileSync(path.join(root, "server/routes.ts"), "utf8");
  const start = source.indexOf("function errorResponse(");
  const end = source.indexOf("const requireAuth =", start);
  assert(start >= 0 && end > start, "real safe error responder must remain identifiable");
  const typescript = requireCandidate("typescript") as typeof import("typescript");
  const javascript = typescript.transpileModule(source.slice(start, end), {
    compilerOptions: { target: typescript.ScriptTarget.ES2022, module: typescript.ModuleKind.CommonJS },
  }).outputText;
  const context: Record<string, any> = { crypto: requireTest("node:crypto"), logError: () => undefined };
  vm.runInNewContext(javascript, context, { timeout: 1_000, filename: "real-route-error-responder.js" });
  assert.equal(typeof context.errorResponse, "function");
  return context.errorResponse;
}

async function runOriginalE2Suite(): Promise<void> {
  const cli = path.join(root, "node_modules/tsx/dist/cli.mjs");
  const original = path.join(root, "script/rs-par-e-02-auth-middleware-tests.ts");
  assert(existsSync(cli) && existsSync(original), "installed TSX and preserved original E2 suite are required");
  // Only environment needed to execute installed local tools is inherited. No
  // Firebase, cloud, payment or other credential variables enter the child.
  const environment: NodeJS.ProcessEnv = { NODE_ENV: "test" };
  for (const key of ["PATH", "Path", "SystemRoot", "SYSTEMROOT", "WINDIR", "COMSPEC", "ComSpec", "TEMP", "TMP", "PATHEXT", "LOCALAPPDATA"]) {
    if (process.env[key] !== undefined) environment[key] = process.env[key];
  }
  const child = spawnSync(process.execPath, [
    "--import", pathToFileURL(path.join(testDirectory, "rs-infra-recovery-01-network-guard.mjs")).href, cli, original,
  ], { cwd: root, env: environment, encoding: "utf8", timeout: 60_000, maxBuffer: 2 * 1024 * 1024, windowsHide: true });
  assert.equal(child.status, 0, `original E2 suite failed: ${child.stderr || child.stdout || child.error?.message}`);
  assert.match(child.stdout, /RS-PAR-E-02 auth middleware negative tests passed/);
  assert.match(child.stdout, /BACKEND_CONTRACT_NETWORK_ATTEMPTS=0/);
  cases.push("preserved original E2 suite with network guard");
}

async function main(): Promise<void> {
  assert(existsSync(path.join(root, "package.json")), "candidate root missing");
  await runOriginalE2Suite();
  const { createRequireAuth, createRequireOwnership } = await import(pathToFileURL(path.join(root, "server/auth-authorization-middleware.ts")).href);
  const { createGetUserSettingsHandler } = await import(pathToFileURL(path.join(root, "server/user-settings-read.ts")).href);
  const cors = loadRealCorsMiddleware();
  const errorResponse = loadRealErrorResponder();

  type Options = {
    request?: Partial<FakeRequest>;
    adminUnavailable?: boolean;
    verifyFailure?: unknown;
    deletionFailure?: boolean;
    deleting?: boolean;
    settingsFailure?: boolean;
    settings?: Record<string, unknown>;
    settingsExist?: boolean;
  };

  async function invoke(options: Options = {}) {
    const req = request(options.request);
    const res = responseRecorder();
    const calls = { admin: 0, verify: 0, deletion: 0, settings: 0, mismatch: 0, corsNext: 0 };
    const requireAuth = createRequireAuth(() => {
      calls.admin += 1;
      if (options.adminUnavailable) throw new Error("synthetic unavailable Admin");
      return {
        auth: () => ({ verifyIdToken: async (token: string, checkRevoked: boolean) => {
          calls.verify += 1;
          assert.equal(token, "synthetic-owner-token", "CORS preserves Authorization for the real auth middleware");
          assert.equal(checkRevoked, true);
          if (options.verifyFailure) throw options.verifyFailure;
          return { uid: "synthetic-owner" };
        } }),
        firestore: () => ({ collection: (name: string) => {
          assert.equal(name, "account_deletion_requests");
          return { doc: (uid: string) => {
            assert.equal(uid, "synthetic-owner");
            return { get: async () => {
              calls.deletion += 1;
              if (options.deletionFailure) throw new Error("synthetic tombstone dependency failure");
              return { exists: options.deleting === true };
            } };
          } };
        } }),
      };
    });
    const ownership = createRequireOwnership(() => { calls.mismatch += 1; });
    const settings = createGetUserSettingsHandler({
      getFirebaseAdmin: () => ({ firestore: () => ({ collection: (name: string) => {
        assert.equal(name, "user_settings");
        return { doc: (uid: string) => {
          assert.equal(uid, "synthetic-owner");
          return { get: async () => {
            calls.settings += 1;
            if (options.settingsFailure) throw new Error("synthetic private dependency detail");
            return { exists: options.settingsExist === true, data: () => options.settings };
          } };
        } };
      } }) }),
      errorResponse,
    });
    let next = false;
    cors(req, res, () => { calls.corsNext += 1; next = true; });
    if (!next) return { req, res, calls };
    for (const middleware of [requireAuth, ownership, settings]) {
      next = false;
      await middleware(req, res, () => { next = true; });
      if (!next) break;
    }
    return { req, res, calls };
  }

  const options = await invoke({ request: { method: "OPTIONS", headers: { origin: "https://localhost", "access-control-request-method": "GET", "access-control-request-headers": "authorization" } } });
  assert.equal(options.res.statusCode, 204);
  assert.equal(options.res.headers.get("access-control-allow-origin"), "https://localhost");
  assert.match(options.res.headers.get("access-control-allow-headers") || "", /Authorization/);
  assert.match(options.res.headers.get("access-control-allow-methods") || "", /OPTIONS/);
  assert.equal(options.res.headers.get("access-control-allow-credentials"), "true");
  assert.equal(options.res.headers.get("vary"), "Origin");
  assert.deepEqual(options.calls, { admin: 0, verify: 0, deletion: 0, settings: 0, mismatch: 0, corsNext: 0 });
  cases.push("Android OPTIONS returns 204 and ACAO before auth without Bearer");

  const rejectedOrigin = await invoke({ request: { method: "OPTIONS", headers: { origin: "https://synthetic-untrusted.invalid" } } });
  assert.equal(rejectedOrigin.res.statusCode, 204);
  assert.equal(rejectedOrigin.res.headers.has("access-control-allow-origin"), false);
  assert.equal(rejectedOrigin.calls.admin, 0);
  cases.push("untrusted origin gets no ACAO");

  const missing = await invoke({ request: { headers: { origin: "https://localhost" }, firebaseUid: "stale-synthetic" } });
  assert.equal(missing.res.statusCode, 401); assert.equal(missing.calls.admin, 0); assert.equal(missing.req.firebaseUid, undefined);
  assert.equal(missing.res.headers.get("access-control-allow-origin"), "https://localhost");
  cases.push("missing Bearer returns 401 with Android CORS and no Admin call");

  const revoked = await invoke({ verifyFailure: { code: "auth/id-token-revoked" } });
  assert.equal(revoked.res.statusCode, 401); assert.equal(revoked.calls.deletion, 0); assert.equal(revoked.calls.settings, 0); assert.equal(revoked.req.firebaseUid, undefined);
  cases.push("revoked token returns 401 and no settings read");

  const mismatch = await invoke({ request: { params: { userId: "synthetic-other" } } });
  assert.equal(mismatch.res.statusCode, 403); assert.equal(mismatch.calls.mismatch, 1); assert.equal(mismatch.calls.settings, 0);
  cases.push("cross UID returns 403 and never reads other settings");

  const deleting = await invoke({ deleting: true });
  assert.equal(deleting.res.statusCode, 403); assert.equal(deleting.calls.settings, 0); assert.equal(deleting.req.firebaseUid, undefined);
  cases.push("deletion tombstone returns 403 before settings");

  for (const [label, scenario] of [["Admin unavailable", { adminUnavailable: true }], ["deletion Firestore unavailable", { deletionFailure: true }], ["verification operational failure", { verifyFailure: { code: "auth/internal-error" } }]] as const) {
    const unavailable = await invoke(scenario);
    assert.equal(unavailable.res.statusCode, 503); assert.equal(unavailable.calls.settings, 0); assert.equal(unavailable.req.firebaseUid, undefined);
    assert.deepEqual(unavailable.res.body, { error: "AUTH_SERVICE_UNAVAILABLE" });
    cases.push(`${label} returns 503 without identity or settings read`);
  }

  const failedSettings = await invoke({ settingsFailure: true });
  assert.equal(failedSettings.res.statusCode, 500);
  const failureBody = failedSettings.res.body as Record<string, unknown>;
  assert.equal(failureBody.error, "SETTINGS_LOAD_FAILED");
  assert.equal(failureBody.message, "Ocorreu um erro temporário.");
  assert.match(String(failureBody.errorId), /^[0-9a-f]{12}$/);
  assert(Number.isFinite(Date.parse(String(failureBody.timestamp))));
  assert.equal(JSON.stringify(failedSettings.res.body).includes("private dependency detail"), false);
  cases.push("settings read failure returns safe 500");

  const absentSettings = await invoke();
  assert.equal(absentSettings.res.statusCode, 200);
  assert.deepEqual(absentSettings.res.body, { onboarding_completed: false, settings: {} });
  cases.push("absent settings returns valid 200 and onboarding false");

  const valid = await invoke({ settingsExist: true, settings: { onboarding_completed: true, businessMode: "products", syntheticOwnerMarker: true } });
  assert.equal(valid.res.statusCode, 200);
  assert.deepEqual(valid.res.body, { onboarding_completed: true, settings: { onboarding_completed: true, businessMode: "products", syntheticOwnerMarker: true } });
  assert.equal(valid.calls.settings, 1); assert.equal(valid.calls.verify, 1); assert.equal(valid.req.firebaseUid, "synthetic-owner");
  cases.push("valid synthetic identity and existing settings returns own 200 true");

  assert.equal(networkGuard.getAttempts(), 0);
  console.log(JSON.stringify({ result: "PASS", candidate: root, cases: cases.length, checks: cases, networkAttempts: 0, scope: "real E2 factories plus actual inline CORS policy and safe error responder in VM; no remote proxy, live Firebase or HTTP server" }, null, 2));
}

main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
