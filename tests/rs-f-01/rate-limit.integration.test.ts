import test from "node:test";
import assert from "node:assert/strict";

import {
  buildPublicRateLimitDocId,
  checkDistributedRateLimit,
} from "../../server/public-rate-limit-firestore";

type StoredDoc = { count?: unknown; [key: string]: unknown };

function fakeFirestore(initial: StoredDoc | null = null, initialKey = "rate-limit-doc") {
  const documents = new Map<string, StoredDoc>();
  const ref = { id: "rate-limit-doc" };
  if (initial) documents.set(initialKey, initial);
  const tx = {
    async get(target: { id: string }) {
      return { data: () => documents.get(target.id) };
    },
    set(target: { id: string }, value: StoredDoc) {
      documents.set(target.id, { ...(documents.get(target.id) ?? {}), ...value });
    },
  };
  return {
    collection(name: string) {
      assert.equal(name, "publicRateLimits");
      return { doc(id: string) { ref.id = id; return ref; } };
    },
    async runTransaction(callback: (transaction: typeof tx) => unknown) {
      return callback(tx);
    },
    read(id = ref.id) { return documents.get(id); },
  };
}

test("distributed limiter increments a mocked Firestore document and blocks at max", async () => {
  const db = fakeFirestore();
  const first = await checkDistributedRateLimit(db as never, "127.0.0.1/catalog/a", { windowMs: 60_000, max: 2 }, 120_000);
  const second = await checkDistributedRateLimit(db as never, "127.0.0.1/catalog/a", { windowMs: 60_000, max: 2 }, 120_000);
  const third = await checkDistributedRateLimit(db as never, "127.0.0.1/catalog/a", { windowMs: 60_000, max: 2 }, 120_000);

  assert.deepEqual(first, { allowed: true, remaining: 1, retryAfterSeconds: 60 });
  assert.deepEqual(second, { allowed: true, remaining: 0, retryAfterSeconds: 60 });
  assert.deepEqual(third, { allowed: false, remaining: 0, retryAfterSeconds: 60 });
  assert.match(buildPublicRateLimitDocId("a/b", 60_000, 120_000), /^a_b__/);
});

test("rate-limit keys and time windows use isolated mocked documents", async () => {
  const db = fakeFirestore();
  const options = { windowMs: 60_000, max: 1 };
  assert.equal((await checkDistributedRateLimit(db as never, "ip-a", options, 120_000)).allowed, true);
  assert.equal((await checkDistributedRateLimit(db as never, "ip-a", options, 120_000)).allowed, false);
  assert.equal((await checkDistributedRateLimit(db as never, "ip-b", options, 120_000)).allowed, true);
  assert.equal((await checkDistributedRateLimit(db as never, "ip-a", options, 180_000)).allowed, true);
});

test("corrupt counter fails closed while infrastructure failure stays open", async () => {
  const corrupt = fakeFirestore({ count: Number.NaN }, buildPublicRateLimitDocId("key", 10_000, 0));
  const decision = await checkDistributedRateLimit(corrupt as never, "key", { windowMs: 10_000, max: 5 }, 0);
  assert.equal(decision.allowed, false);
  assert.equal(decision.remaining, 0);

  const failingDb = {
    collection() {
      return { doc() { return {}; } };
    },
    async runTransaction() { throw new Error("Firestore unavailable"); },
  };
  const fallback = await checkDistributedRateLimit(failingDb as never, "key", { windowMs: 10_000, max: 5 }, 0);
  assert.deepEqual(fallback, { allowed: true, remaining: 5, retryAfterSeconds: 10 });
});
