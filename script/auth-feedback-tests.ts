import assert from "node:assert/strict";
import { AccountBootstrapError, runBoundedAccountOperation } from "../client/src/lib/account-bootstrap";
import { createAuthSdkGate, getPasswordResetFeedback, getSignInFeedback, PASSWORD_RESET_ACCEPTED_MESSAGE } from "../client/src/lib/auth-feedback";

// Pure test doubles only: no Firebase initialization, environment, browser, fetch or accounts.
const privateDetail = "PRIVATE_SDK_DETAIL_MUST_NOT_REACH_PUBLIC_FEEDBACK";
const credentials = ["auth/invalid-credential", "auth/wrong-password", "auth/user-not-found"]
  .map((code) => getSignInFeedback({ code, message: privateDetail }));
assert.equal(new Set(credentials.map((feedback) => feedback.message)).size, 1);
assert.ok(credentials.every((feedback) => feedback.kind === "credentials"));
assert.equal(getSignInFeedback({ code: "auth/user-disabled" }).message, credentials[0].message);
for (const classify of [getSignInFeedback, getPasswordResetFeedback]) {
  const results = ["auth/network-request-failed", "auth/too-many-requests", "auth/invalid-api-key"]
    .map((code) => classify({ code, message: privateDetail }));
  assert.deepEqual(results.map((feedback) => feedback.kind), ["network", "rate-limited", "configuration"]);
  assert.equal(new Set(results.map((feedback) => feedback.message)).size, 3);
  assert.ok(results.every((feedback) => !feedback.message.includes(privateDetail) && !feedback.accepted));
  assert.ok(!classify(new Error(privateDetail)).message.includes(privateDetail));
}
assert.equal(getPasswordResetFeedback({ code: "auth/user-not-found" }).message, PASSWORD_RESET_ACCEPTED_MESSAGE);
assert.equal(getPasswordResetFeedback({ code: "auth/user-not-found" }).accepted, true);
assert.ok(!/enviamos|entregue|foi enviado|link enviado/i.test(PASSWORD_RESET_ACCEPTED_MESSAGE));
const resetTimeout = getPasswordResetFeedback(new AccountBootstrapError("timeout", "reset"));
assert.equal(resetTimeout.kind, "timeout");
assert.ok(!resetTimeout.accepted);
assert.match(resetTimeout.message, /ainda pode ser concluída/);
assert.equal(getSignInFeedback(new AccountBootstrapError("configuration", "auth")).kind, "configuration");

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}

for (const phase of ["auth", "reset"] as const) {
  const gate = createAuthSdkGate();
  const sdk = deferred<string>();
  const changes: boolean[] = [];
  const unsubscribe = gate.subscribe((pending) => { changes.push(pending); });
  let sdkCalls = 0;
  let lateUiSuccess = 0;
  let trackedSdk!: Promise<string>;
  const bounded = runBoundedAccountOperation(() => {
    trackedSdk = gate.run(() => { sdkCalls += 1; return sdk.promise; });
    return trackedSdk;
  }, { phase, timeoutMs: 5 });
  const observedUi = bounded.then(() => { lateUiSuccess += 1; });
  await assert.rejects(observedUi, (error: unknown) => error instanceof AccountBootstrapError
    && error.kind === "timeout" && error.phase === phase);
  assert.equal(gate.isPending(), true, "UI timeout must not release the actual SDK reservation");
  await assert.rejects(gate.run(async () => { sdkCalls += 1; return "forbidden second call"; }));
  assert.equal(sdkCalls, 1);
  sdk.resolve("late SDK result");
  await trackedSdk;
  assert.equal(gate.isPending(), false);
  assert.equal(lateUiSuccess, 0, "a timed-out UI operation cannot become successful later");
  assert.deepEqual(changes, [true, false]);
  unsubscribe();
  assert.equal(await gate.run(async () => { sdkCalls += 1; return "explicit retry"; }), "explicit retry");
  assert.equal(sdkCalls, 2);
  assert.deepEqual(changes, [true, false], "unmounted subscribers must not receive late updates");
}

{
  const gate = createAuthSdkGate();
  const sdk = deferred<void>();
  const controller = new AbortController();
  let trackedSdk!: Promise<void>;
  const bounded = runBoundedAccountOperation(() => {
    trackedSdk = gate.run(() => sdk.promise);
    return trackedSdk;
  }, {
    signal: controller.signal, phase: "auth", timeoutMs: 1000,
  });
  await Promise.resolve();
  await Promise.resolve();
  controller.abort();
  await assert.rejects(bounded, (error: unknown) => error instanceof AccountBootstrapError && error.kind === "cancelled");
  assert.equal(gate.isPending(), true, "screen unmount must not claim SDK cancellation");
  sdk.reject(new Error(privateDetail));
  await assert.rejects(trackedSdk);
  assert.equal(gate.isPending(), false, "late SDK rejection releases only the reservation");
}

{
  const gate = createAuthSdkGate();
  await assert.rejects(gate.run(() => { throw new Error(privateDetail); }));
  assert.equal(gate.isPending(), false, "a synchronous SDK failure must release the reservation");
  const controller = new AbortController();
  controller.abort();
  let sdkCalls = 0;
  await assert.rejects(runBoundedAccountOperation(() => gate.run(async () => {
    sdkCalls += 1;
  }), { signal: controller.signal, phase: "reset" }));
  assert.equal(sdkCalls, 0, "an already cancelled screen must not start an SDK call");
}

console.log("PASS pure auth feedback and SDK reservation: anti-enumeration, bounded UI, late settle and cancellation");
