/** Test-only preload. Never import this file from the application. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
assert.equal(process.env.FIREBASE_PROJECT_ID, "demo-revendasmart");
assert.equal(process.env.FIRESTORE_EMULATOR_HOST, "127.0.0.1:8080");
assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, "127.0.0.1:9099");
assert.equal(process.env.RC_PRICING_TEST_PROVIDER, "true");
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  if (url.hostname === "api.mercadopago.com") {
    assert.equal(init?.method?.toUpperCase(), "POST");
    assert.ok(url.pathname === "/preapproval" || url.pathname === "/preapproval/");
    const body = JSON.parse(String(init.body));
    assert.equal(body.auto_recurring.frequency_type, "months");
    assert.ok([1, 12].includes(body.auto_recurring.frequency));
    assert.equal(body.auto_recurring.currency_id, "BRL");
    assert.ok([29.9, 49.9, 299, 499].includes(body.auto_recurring.transaction_amount));
    return new Response(JSON.stringify({ id: `browser-${randomUUID()}`, init_point: "http://127.0.0.1:5057/plans", status: "pending" }), { status: 201, headers: { "Content-Type": "application/json" } });
  }
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname), `External request forbidden in pricing fixture: ${url.hostname}`);
  return originalFetch(input, init);
};
