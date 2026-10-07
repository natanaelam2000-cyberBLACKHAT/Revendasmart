import assert from "node:assert/strict";
import { test } from "node:test";
import { AuthController, type AuthAdapter, type AuthIdentity } from "../client/src/lib/auth-controller";
import { authErrorMessage, authFailure, RESET_PASSWORD_MESSAGE } from "../client/src/lib/auth-policy";
import { hasRecentAuthentication } from "../shared/auth-security";
import { checkRecentIdentity } from "../server/auth-recent";
import { finishAuthCleanup } from "../client/src/lib/auth-cleanup";
import { mirrorAuthenticatedUid } from "../client/src/lib/auth-session-mirror";

function fixture() {
  let user: AuthIdentity | null = { uid: "owner", email: "owner@example.test", emailVerified: false, providerData: [{ providerId: "password" }] };
  let now = 1_000_000;
  const calls: string[] = [];
  const adapter: AuthAdapter<AuthIdentity, string> = {
    currentUser: () => user,
    ready: async () => { calls.push("ready"); },
    emailLogin: async email => { calls.push(`login:${email}`); return user!; },
    signup: async email => { calls.push(`signup:${email}`); return user!; },
    socialLogin: async () => user!,
    socialLink: async () => { calls.push("link"); return user!; },
    linkCredential: async () => { calls.push("link-credential"); return user!; },
    collision: () => ({ email: "owner@example.test", credential: "pending" }),
    verify: async () => { calls.push("verify"); },
    reload: async () => { user!.emailVerified = true; calls.push("reload"); },
    token: async (_, force) => { calls.push(`token:${force}`); return "test-only"; },
    recent: async () => true,
    reset: async email => { calls.push(`reset:${email}`); },
    reauthenticate: async () => { calls.push("reauthenticate"); },
    logout: async () => { calls.push("logout"); user = null; },
  };
  const controller = new AuthController(adapter, () => now);
  return { controller, adapter, calls, setUser: (value: AuthIdentity | null) => { user = value; }, advance: (ms: number) => { now += ms; } };
}

test("login trims email, preserves password and awaits session bootstrap", async () => {
  const f = fixture(); let seen = "";
  f.adapter.emailLogin = async (email, password) => { seen = password; f.calls.push(email); return f.adapter.currentUser()!; };
  await f.controller.login(" owner@example.test ", "  secret  ");
  assert.deepEqual(f.calls, ["ready", "owner@example.test"]); assert.equal(seen, "  secret  ");
});
test("persistence/bootstrap failure prevents authentication", async () => {
  const f = fixture(); f.adapter.ready = async () => { throw new Error("storage unavailable"); };
  await assert.rejects(f.controller.login("email", "password")); assert.equal(f.calls.length, 0);
});
test("double submission sends exactly one login", async () => {
  const f = fixture(); let finish!: () => void;
  f.adapter.ready = () => new Promise<void>(resolve => { finish = resolve; });
  const first = f.controller.login("owner@example.test", "password");
  await assert.rejects(f.controller.login("owner@example.test", "password"), { code: "auth/operation-in-progress" });
  finish(); await first; assert.equal(f.calls.length, 1);
});
test("failed login releases the operation for retry", async () => {
  const f = fixture(); f.adapter.emailLogin = async () => { throw authFailure("auth/invalid-credential"); };
  await assert.rejects(f.controller.login("email", "pw"));
  f.adapter.emailLogin = async () => f.adapter.currentUser()!; await f.controller.login("email", "pw");
});
test("signup uses canonical email and never automatically links", async () => {
  const f = fixture(); await f.controller.signup(" owner@example.test ", "password");
  assert.deepEqual(f.calls, ["ready", "signup:owner@example.test"]);
});
test("existing and absent emails share the password recovery success response", async () => {
  const f = fixture(); await f.controller.resetPassword(" owner@example.test ");
  f.adapter.reset = async () => { throw authFailure("auth/user-not-found"); };
  await f.controller.resetPassword("missing@example.test");
  assert.match(RESET_PASSWORD_MESSAGE, /Se houver uma conta/);
});
test("password recovery network errors remain retryable errors", async () => {
  const f = fixture(); f.adapter.reset = async () => { throw authFailure("auth/network-request-failed"); };
  await assert.rejects(f.controller.resetPassword("owner@example.test"), { code: "auth/network-request-failed" });
});
test("verification has successful-send cooldown and allows resend after one minute", async () => {
  const f = fixture(); await f.controller.sendVerification();
  await assert.rejects(f.controller.sendVerification(), { code: "auth/verification-cooldown" });
  f.advance(60_000); await f.controller.sendVerification(); assert.equal(f.calls.filter(c => c === "verify").length, 2);
});
test("failed verification send does not consume cooldown", async () => {
  const f = fixture(); f.adapter.verify = async () => { throw new Error("network"); };
  await assert.rejects(f.controller.sendVerification()); f.adapter.verify = async () => {};
  await f.controller.sendVerification();
});
test("verified emails do not receive another verification", async () => {
  const f = fixture(); f.adapter.currentUser()!.emailVerified = true;
  await f.controller.sendVerification(); assert.ok(!f.calls.includes("verify"));
});
test("a social account without email cannot trigger a misleading verification send", async () => {
  const f = fixture(); f.adapter.currentUser()!.email = null;
  await assert.rejects(f.controller.sendVerification(), { code: "auth/missing-email" });
  assert.ok(!f.calls.includes("verify"));
});
test("verification refresh reloads before forcing the token", async () => {
  const f = fixture(); const user = await f.controller.refreshVerification();
  assert.equal(user.emailVerified, true); assert.deepEqual(f.calls, ["ready", "reload", "token:true"]);
});
test("verification refresh refuses a changed session", async () => {
  const f = fixture(); f.adapter.reload = async () => f.setUser(null);
  await assert.rejects(f.controller.refreshVerification()); assert.ok(!f.calls.includes("token:true"));
});
for (const provider of ["google", "facebook"] as const) {
  test(`${provider} login returns the Firebase session UID`, async () => {
    const f = fixture(); assert.equal((await f.controller.social(provider)).uid, "owner");
  });
  test(`${provider} collision does not link or merge automatically`, async () => {
    const f = fixture(); f.adapter.socialLogin = async () => { throw authFailure("auth/account-exists-with-different-credential"); };
    await assert.rejects(f.controller.social(provider)); assert.equal(f.controller.pendingEmail, "owner@example.test");
    assert.ok(!f.calls.includes("link-credential"));
    await f.controller.confirmPendingLink(); assert.ok(f.calls.includes("link-credential")); assert.equal(f.controller.pendingEmail, null);
  });
}
async function collision(f: ReturnType<typeof fixture>) {
  f.adapter.socialLogin = async () => { throw authFailure("auth/account-exists-with-different-credential"); };
  await assert.rejects(f.controller.social("google"));
}
test("pending linking expires without storing credentials", async () => {
  const f = fixture(); await collision(f); f.advance(300_000);
  assert.equal(f.controller.pendingEmail, null); await assert.rejects(f.controller.confirmPendingLink());
});
test("pending credential refuses an account with a different email", async () => {
  const f = fixture(); await collision(f); f.adapter.currentUser()!.email = "other@example.test";
  await assert.rejects(f.controller.confirmPendingLink(), { code: "auth/email-mismatch" }); assert.ok(!f.calls.includes("link-credential"));
});
test("stale sessions cannot link providers", async () => {
  const f = fixture(); f.adapter.recent = async () => false;
  await assert.rejects(f.controller.link("google"), { code: "auth/requires-recent-login" }); assert.ok(!f.calls.includes("link"));
});
test("linking cannot claim success after UID changes", async () => {
  const f = fixture(); f.adapter.socialLink = async () => ({ ...f.adapter.currentUser()!, uid: "other" });
  await assert.rejects(f.controller.link("facebook"), { code: "auth/user-mismatch" });
});
test("linking snapshots UID before asynchronous changes to the same user object", async () => {
  const f = fixture();
  f.adapter.socialLink = async () => { const user = f.adapter.currentUser()!; user.uid = "other"; return user; };
  await assert.rejects(f.controller.link("google"), { code: "auth/user-mismatch" });
});
test("reauthentication forces the token only after identity confirmation", async () => {
  const f = fixture(); await f.controller.reauthenticate("password", "password");
  assert.deepEqual(f.calls, ["ready", "reauthenticate", "token:true"]);
});
test("reauthentication refuses session replacement", async () => {
  const f = fixture(); f.adapter.reauthenticate = async () => f.setUser(null);
  await assert.rejects(f.controller.reauthenticate("google")); assert.ok(!f.calls.includes("token:true"));
});
test("logout clears pending credentials and current session", async () => {
  const f = fixture(); await collision(f); await f.controller.logout();
  assert.equal(f.adapter.currentUser(), null); assert.equal(f.controller.pendingEmail, null);
});
test("failed logout never reports successful termination", async () => {
  const f = fixture(); f.adapter.logout = async () => { throw new Error("failed"); };
  await assert.rejects(f.controller.logout()); assert.equal(f.adapter.currentUser()?.uid, "owner");
});
test("logout remains available when persistent storage initialization fails", async () => {
  const f = fixture(); f.adapter.ready = async () => { throw new Error("storage unavailable"); };
  await f.controller.logout(); assert.equal(f.adapter.currentUser(), null);
});
test("deleted/signed-out users cannot send verification", async () => {
  const f = fixture(); f.setUser(null); await assert.rejects(f.controller.sendVerification());
});
test("fresh auth_time is required, independently of token issue/refresh time", () => {
  const now = 1_000_000;
  assert.ok(hasRecentAuthentication(1000, now)); assert.ok(hasRecentAuthentication(700, now));
  for (const value of [699, 1031, undefined, "1000", NaN, Infinity]) assert.equal(hasRecentAuthentication(value, now), false);
});
test("modern invalid-credential errors do not leak account existence or raw secrets", () => {
  const invalid = authErrorMessage({ code: "auth/invalid-credential", message: "sensitive token" });
  assert.equal(invalid, authErrorMessage({ code: "auth/user-not-found" }));
  assert.ok(!authErrorMessage(new Error("secret")).includes("secret"));
});

test("server rejects missing authorization before verifying or deleting", async () => {
  let calls = 0;
  assert.equal(await checkRecentIdentity("owner", undefined, async () => { calls++; throw new Error(); }), "UNAUTHENTICATED");
  assert.equal(calls, 0);
});
test("server verifies revocation and binds the token UID to the authenticated request UID", async () => {
  let revokedFlag = false;
  assert.equal(await checkRecentIdentity("owner", "Bearer emulator-token", async (_, revoked) => {
    revokedFlag = revoked; return { uid: "other", auth_time: Date.now() / 1000 };
  }), "REAUTH_REQUIRED");
  assert.equal(revokedFlag, true);
});
test("server rejects revoked/invalid credentials", async () => {
  assert.equal(await checkRecentIdentity("owner", "Bearer revoked-token", async () => { throw new Error("revoked"); }), "UNAUTHENTICATED");
});
test("server rejects refreshed tokens with an old auth_time", async () => {
  assert.equal(await checkRecentIdentity("owner", "Bearer refreshed-token", async () => ({ uid: "owner", auth_time: Date.now() / 1000 - 301 })), "REAUTH_REQUIRED");
});
test("server accepts a recently reauthenticated matching UID", async () => {
  assert.equal(await checkRecentIdentity("owner", "Bearer recent-token", async () => ({ uid: "owner", auth_time: Date.now() / 1000 })), null);
});
test("failed local deletion cannot skip logout or leave the prior tenant query cache", async () => {
  const f = fixture(); const cache = new Map([["prior-tenant", "private-data"]]); let context = "owner";
  const complete = await finishAuthCleanup([
    () => { throw new Error("storage denied"); },
    () => f.controller.logout(),
    () => cache.clear(),
    () => { context = ""; },
  ]);
  assert.equal(complete, false); assert.equal(f.adapter.currentUser(), null); assert.equal(cache.size, 0); assert.equal(context, "");
});
test("login/user change/logout mirror only the authenticated UID for local helpers", () => {
  const local = new Map([["preferences", "kept"]]);
  const storage = { setItem: (key: string, value: string) => { local.set(key, value); }, removeItem: (key: string) => { local.delete(key); } };
  mirrorAuthenticatedUid("user-a", storage); assert.equal(local.get("rs:session"), "user-a");
  mirrorAuthenticatedUid("user-b", storage); assert.equal(local.get("rs:session"), "user-b");
  mirrorAuthenticatedUid(null, storage); assert.equal(local.has("rs:session"), false); assert.equal(local.get("preferences"), "kept");
});
test("a denied local UID mirror does not replace the Firebase identity", () => {
  const f = fixture();
  mirrorAuthenticatedUid("owner", { setItem: () => { throw new Error("storage denied"); }, removeItem: () => {} });
  assert.equal(f.adapter.currentUser()?.uid, "owner");
});
import { readFileSync } from "node:fs";
import ts from "typescript";

// Execute the actual page handlers with browser/Firebase doubles, including stale local state.
const settingsSource = readFileSync(new URL("../client/src/pages/settings.tsx", import.meta.url), "utf8");
const signupSource = readFileSync(new URL("../client/src/pages/signup.tsx", import.meta.url), "utf8");
function pageHandler(name: string, dependencies: Record<string, unknown>) {
  const source = ts.createSourceFile("settings.tsx", settingsSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let expression = "";
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name && node.initializer) expression = node.initializer.getText(source);
    if (name === "exportBackup" && ts.isJsxAttribute(node) && node.name.getText(source) === "onClick" && node.initializer && ts.isJsxExpression(node.initializer) && node.initializer.expression?.getText(source).includes("Backup exportado.")) expression = node.initializer.expression.getText(source);
    ts.forEachChild(node, visit);
  }
  visit(source); assert.ok(expression, `Handler ${name} exists`);
  const javascript = ts.transpile(`const handler = ${expression};`, { target: ts.ScriptTarget.ES2022 });
  return new Function(...Object.keys(dependencies), `${javascript}; return handler;`)(...Object.values(dependencies));
}
function backupFixture(uid: string | null, currentUid = uid) {
  const local = new Map([["rs:session", "stale"], ["rs:stale:settings", "private"], ["rs:owner:settings", "owner-data"]]);
  const reads: string[] = []; const writes: string[] = []; const errors: string[] = []; let reader: { onload?: (event: unknown) => void } | undefined; let downloads = 0;
  const dependencies = {
    firebaseUid: uid, getFirebaseAuth: () => ({ currentUser: currentUid ? { uid: currentUid } : null }),
    setSaveMessage: () => {}, notifyError: (message: string) => errors.push(message), notifySuccess: () => {}, setTimeout: () => {},
    FileReader: class { onload?: (event: unknown) => void; constructor() { reader = this; } readAsText() { reads.push("file"); } },
    localStorage: { get length() { reads.push("length"); return local.size; }, key: (i: number) => [...local.keys()][i], getItem: (key: string) => { reads.push(key); return local.get(key); }, setItem: (key: string, value: string) => { writes.push(key); local.set(key, value); } },
    Blob: class {}, window: { URL: { createObjectURL: () => "blob:test", revokeObjectURL: () => {} }, location: { reload: () => {} } },
    document: { createElement: () => ({ click: () => { downloads++; } }) },
  };
  return { dependencies, reads, writes, errors, load: () => reader?.onload?.({ target: { result: JSON.stringify({ "rs:stale:settings": "wrong", "rs:owner:settings": "restored" }) } }), downloads: () => downloads };
}
for (const handler of ["exportBackup", "restoreBackupFromFile"]) {
  test(`${handler} blocks a stale local session without Firebase UID before any data access`, () => {
    const f = backupFixture(null); pageHandler(handler, f.dependencies)({});
    assert.deepEqual(f.reads, []); assert.deepEqual(f.writes, []); assert.equal(f.downloads(), 0);
    assert.deepEqual(f.errors, ["Sessão expirada. Faça login novamente."]);
  });
  test(`${handler} selects only the Firebase namespace despite stale rs:session`, () => {
    const f = backupFixture("owner"); pageHandler(handler, f.dependencies)({}); f.load();
    assert.ok(!f.reads.includes("rs:session")); assert.ok(!f.reads.includes("rs:stale:settings"));
    if (handler === "exportBackup") { assert.ok(f.reads.includes("rs:owner:settings")); assert.equal(f.downloads(), 1); }
    else assert.deepEqual(f.writes, ["rs:owner:settings"]);
  });
}
test("restore refuses a Firebase session change during asynchronous file reading", () => {
  const f = backupFixture("owner"); let currentUid: string | null = "owner";
  f.dependencies.getFirebaseAuth = () => ({ currentUser: currentUid ? { uid: currentUid } : null });
  pageHandler("restoreBackupFromFile", f.dependencies)({}); currentUid = null; f.load();
  assert.deepEqual(f.writes, []); assert.deepEqual(f.errors, ["Sessão expirada. Faça login novamente."]);
});
test("logout captures only the Firebase UID before signOut and still clears legacy compatibility", async () => {
  for (const uid of [null, "owner"]) {
    const cleared: string[] = []; let legacyCleanup = 0; const auth = { currentUser: uid ? { uid } : null };
    const handler = pageHandler("handleLogout", {
      getFirebaseAuth: () => auth, getCurrentUserId: () => { throw Error("stale identity accessed"); },
      authController: { logout: async () => { auth.currentUser = null; } }, finishAuthCleanup,
      clearScopedAccountLocalData: (value: string) => cleared.push(value), clearFirestoreOfflineCache: () => {}, queryClient: { clear: () => {} }, clearUserContext: () => {}, clearTelemetryUserId: () => {}, logout: () => { legacyCleanup++; }, notifyError: () => {}, setLocation: () => {},
    });
    await handler(); assert.deepEqual(cleared, uid ? [uid] : []); assert.equal(legacyCleanup, 1);
  }
});
test("signup keeps explicit Firebase bootstrap UID and leaves session mirroring to the listener", async () => {
  assert.doesNotMatch(signupSource, /localStorage\.setItem\(["']rs:session["']/);
  assert.match(signupSource, /bootstrapUserData\(user\.uid, email\)/);
  const f = fixture(); assert.equal((await f.controller.signup("owner@example.test", "password")).uid, "owner");
});
test("Firebase auth listener synchronizes and removes the compatibility session mirror", () => {
  const source = readFileSync(new URL("../client/src/lib/firebase.ts", import.meta.url), "utf8");
  const listener = source.match(/onAuthStateChanged\(authInstance, user => mirrorAuthenticatedUid\(user\?\.uid \?\? null\)\);/);
  assert.ok(listener, "Firebase must own the compatibility mirror");
  const local = new Map<string, string>(); let emit!: (user: { uid: string } | null) => void;
  new Function("onAuthStateChanged", "authInstance", "mirrorAuthenticatedUid", listener[0])(
    (_auth: unknown, callback: typeof emit) => { emit = callback; }, {},
    (uid: string | null) => mirrorAuthenticatedUid(uid, { setItem: (key, value) => { local.set(key, value); }, removeItem: key => { local.delete(key); } }),
  );
  emit({ uid: "owner" }); assert.equal(local.get("rs:session"), "owner");
  emit({ uid: "other" }); assert.equal(local.get("rs:session"), "other");
  emit(null); assert.equal(local.has("rs:session"), false);
});
