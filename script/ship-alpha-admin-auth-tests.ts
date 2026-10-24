import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { resolve } from "node:path";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { build } from "esbuild";
import express from "express";

// Execute the production middleware over local HTTP. Only the Firebase Admin
// lookup and logging are replaced; no credentials or external services are used.
test("admin HTTP authorization requires a server-owned boolean claim", async () => {
  const source = readFileSync("server/admin-auth.ts", "utf8");
  const legacyEmail = source.match(/"([^"\n]+@[^"\n]+)"/)?.[1] ?? "legacy@example.test";
  const records: Record<string, object> = {
    unverified: { email: legacyEmail, emailVerified: false },
    verified: { email: legacyEmail, emailVerified: true },
    falseClaim: { email: legacyEmail, customClaims: { admin: false } },
    stringClaim: { customClaims: { admin: "true" } },
    disabled: { disabled: true, customClaims: { admin: true } },
    owner: { email: "synthetic@example.test", customClaims: { admin: true } },
  };
  const output = await build({
    entryPoints: [resolve("server/admin-auth.ts")], bundle: true,
    platform: "node", format: "cjs", write: false,
    plugins: [{ name: "isolated-admin-dependencies", setup(builder) {
      builder.onResolve({ filter: /firebase-admin-init$/ }, () => ({ path: "admin", namespace: "fixture" }));
      builder.onResolve({ filter: /\/logger$|^\.\/logger$/ }, () => ({ path: "logger", namespace: "fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({
        contents: path === "admin"
          ? "export const getFirebaseAdmin = () => globalThis.adminFixture;"
          : "export const logError=()=>{}; export const logInfo=()=>{}; export const logWarn=()=>{};",
      }));
    } }],
  });
  const module = { exports: {} as Record<string, unknown> };
  runInNewContext(output.outputFiles[0].text, {
    module, exports: module.exports,
    adminFixture: { auth: () => ({ getUser: async (uid: string) => {
      if (uid === "unavailable") throw new Error("synthetic dependency failure");
      if (!(uid in records)) throw new Error("synthetic missing user");
      return records[uid];
    } }) },
  });
  const requireAdmin = module.exports.requireAdmin as express.RequestHandler;
  const app = express();
  let privilegedActions = 0;
  app.use((req, _res, next) => {
    (req as express.Request & { firebaseUid?: string }).firebaseUid = req.get("x-synthetic-uid");
    next();
  });
  app.post("/privileged", (req, res, next) => { Promise.resolve(requireAdmin(req, res, next)).catch(next); }, (_req, res) => {
    privilegedActions += 1;
    res.json({ ok: true });
  });
  const server = createServer(app);
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  try {
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/privileged`;
    assert.equal((await fetch(url, { method: "POST" })).status, 401);
    for (const uid of ["unverified", "verified", "falseClaim", "stringClaim", "disabled"]) {
      const response = await fetch(url, { method: "POST", headers: { "x-synthetic-uid": uid } });
      assert.equal(response.status, 403, `${uid}: no administrative privilege without a trusted claim`);
      assert.equal(privilegedActions, 0);
    }
    const unavailable = await fetch(url, { method: "POST", headers: { "x-synthetic-uid": "unavailable" } });
    assert.equal(unavailable.status, 401);
    assert.equal(privilegedActions, 0);
    const allowed = await fetch(url, { method: "POST", headers: { "x-synthetic-uid": "owner" } });
    assert.equal(allowed.status, 200);
    assert.deepEqual(await allowed.json(), { ok: true });
    assert.equal(privilegedActions, 1);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done()));
  }
});

test("admin UI revokes previous privileges immediately on user change and ignores late responses", async () => {
  let state = { isAdmin: false, loading: true };
  let writes = 0;
  let onUser!: (user: object | null) => void;
  let cleanup!: () => void;
  const requests: ((value: { isAdmin: boolean }) => void)[] = [];
  const fixture = {
    useState: () => [state, (next: typeof state) => { state = next; writes += 1; }],
    useRef: (current: unknown) => ({ current }),
    useEffect: (effect: () => () => void) => { cleanup = effect(); },
    onAuthStateChanged: (_auth: unknown, listener: typeof onUser) => { onUser = listener; return () => {}; },
    request: () => new Promise<{ isAdmin: boolean }>(done => { requests.push(done); }),
  };
  const output = await build({
    entryPoints: [resolve("client/src/hooks/useAdminAccess.ts")], bundle: true,
    platform: "node", format: "cjs", write: false,
    plugins: [{ name: "isolated-hook-dependencies", setup(builder) {
      builder.onResolve({ filter: /^react$|^firebase\/auth$|^@\/lib\/(api-client|firebase)$/ }, args => ({ path: args.path, namespace: "fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({ contents:
        path === "react" ? "export const useState=(...args)=>globalThis.fixture.useState(...args);export const useRef=(...args)=>globalThis.fixture.useRef(...args);export const useEffect=(...args)=>globalThis.fixture.useEffect(...args);" :
        path === "firebase/auth" ? "export const onAuthStateChanged=(...args)=>globalThis.fixture.onAuthStateChanged(...args);" :
        path.endsWith("api-client") ? "export const apiRequest=()=>globalThis.fixture.request();" :
        "export const getFirebaseAuth=()=>({});",
      }));
    } }],
  });
  const module = { exports: {} as { useAdminAccess?: () => unknown } };
  runInNewContext(output.outputFiles[0].text, { module, exports: module.exports, fixture });
  module.exports.useAdminAccess!();
  const user = { getIdToken: async () => "synthetic" };
  onUser(user);
  requests.shift()!({ isAdmin: true });
  await new Promise(setImmediate);
  assert.equal(state.isAdmin, true);
  onUser(user);
  assert.equal(state.isAdmin, false, "the next account must not inherit the previous admin UI");
  const stale = requests.shift()!;
  onUser(user);
  stale({ isAdmin: true });
  await new Promise(setImmediate);
  assert.equal(state.isAdmin, false);
  const late = requests.shift()!;
  cleanup();
  const beforeUnmountedResponse = writes;
  late({ isAdmin: true });
  await new Promise(setImmediate);
  assert.equal(writes, beforeUnmountedResponse);
});
