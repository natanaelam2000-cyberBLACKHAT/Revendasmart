import assert from "node:assert/strict";
import * as crypto from "node:crypto";

/**
 * RC-P0-SECURITY-02B — T1-T9: pure, no-emulator proof of the versioned Mercado Pago token
 * encryption contract (legacy compatibility, dual-key, fail-closed version resolution, no
 * cross-key fallback, and that presence of a v2 key never auto-activates it).
 *
 * Every key/token value here is generated fresh at test-run time via crypto.randomBytes — never a
 * fixed literal, so nothing here can ever resemble a real credential.
 */

const FAKE_V1_KEY = crypto.randomBytes(32).toString("hex");
const FAKE_V2_KEY = crypto.randomBytes(32).toString("hex");
const FAKE_WRONG_V2_KEY = crypto.randomBytes(32).toString("hex");
const FAKE_PLAINTEXT_TOKEN = `synthetic-oauth-token-${crypto.randomBytes(8).toString("hex")}`;

function withEnv<T>(env: Record<string, string | undefined>, fn: () => T): T {
  const previous: Record<string, string | undefined> = {};
  for (const key of Object.keys(env)) previous[key] = process.env[key];
  try {
    for (const [key, value] of Object.entries(env)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    return fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function importFresh() {
  // Bust the module cache so each scenario's env-var setup is what the module's lazy resolvers
  // actually see — mercadopago-crypto.ts itself never caches, but importing once and reusing the
  // reference across scenarios is still the most direct way to prove that (no reload needed).
  return import("../server/mercadopago-crypto");
}

async function run() {
  const crypto_ = await importFresh();
  const { encryptToken, decryptToken, resolveActiveEncryptVersion, MercadoPagoEncryptionKeyError, resolveStoredKeyVersion } = crypto_;

  // ===== T1 — old unversioned ciphertext (no keyVersion field at all) decrypts with v1 =====
  withEnv({ MERCADOPAGO_TOKEN_ENCRYPTION_KEY: FAKE_V1_KEY, MERCADOPAGO_TOKEN_ENCRYPTION_KEY_V2: undefined, MERCADOPAGO_TOKEN_ENCRYPTION_ACTIVE_VERSION: undefined }, () => {
    const encrypted = encryptToken(FAKE_PLAINTEXT_TOKEN);
    // Simulate a pre-existing production document: strip keyVersion entirely.
    const legacy = { ...encrypted } as Partial<typeof encrypted>;
    delete legacy.keyVersion;
    assert.equal(decryptToken(legacy as typeof encrypted), FAKE_PLAINTEXT_TOKEN, "T1: unversioned ciphertext must decrypt with v1");
    assert.equal(resolveStoredKeyVersion(legacy as typeof encrypted), "v1", "T1: resolveStoredKeyVersion must classify an absent field as v1");
  });
  console.log("PASS T1 legacy unversioned ciphertext decrypts with v1");

  // ===== T2 — explicit v1 decrypts =====
  withEnv({ MERCADOPAGO_TOKEN_ENCRYPTION_KEY: FAKE_V1_KEY, MERCADOPAGO_TOKEN_ENCRYPTION_ACTIVE_VERSION: "v1" }, () => {
    const encrypted = encryptToken(FAKE_PLAINTEXT_TOKEN);
    assert.equal(encrypted.keyVersion, "v1");
    assert.equal(decryptToken(encrypted), FAKE_PLAINTEXT_TOKEN, "T2: explicit v1-stamped ciphertext must decrypt with v1");
  });
  console.log("PASS T2 explicit v1 decrypts");

  // ===== T3 — explicit v2 decrypts =====
  withEnv({ MERCADOPAGO_TOKEN_ENCRYPTION_KEY: FAKE_V1_KEY, MERCADOPAGO_TOKEN_ENCRYPTION_KEY_V2: FAKE_V2_KEY, MERCADOPAGO_TOKEN_ENCRYPTION_ACTIVE_VERSION: "v2" }, () => {
    const encrypted = encryptToken(FAKE_PLAINTEXT_TOKEN);
    assert.equal(encrypted.keyVersion, "v2");
    assert.equal(decryptToken(encrypted), FAKE_PLAINTEXT_TOKEN, "T3: explicit v2-stamped ciphertext must decrypt with v2");
  });
  console.log("PASS T3 explicit v2 decrypts");

  // ===== T4 — v2 encryption stamps keyVersion=v2 (redundant with T3's assert, kept explicit per the required matrix) =====
  withEnv({ MERCADOPAGO_TOKEN_ENCRYPTION_KEY: FAKE_V1_KEY, MERCADOPAGO_TOKEN_ENCRYPTION_KEY_V2: FAKE_V2_KEY, MERCADOPAGO_TOKEN_ENCRYPTION_ACTIVE_VERSION: "v2" }, () => {
    const encrypted = encryptToken(FAKE_PLAINTEXT_TOKEN);
    assert.equal(encrypted.keyVersion, "v2", "T4: new encryption under ACTIVE_VERSION=v2 must stamp keyVersion=v2");
  });
  console.log("PASS T4 v2 encryption stamps keyVersion=v2");

  // ===== T5 — active v1 (default) writes v1 =====
  withEnv({ MERCADOPAGO_TOKEN_ENCRYPTION_KEY: FAKE_V1_KEY, MERCADOPAGO_TOKEN_ENCRYPTION_KEY_V2: FAKE_V2_KEY, MERCADOPAGO_TOKEN_ENCRYPTION_ACTIVE_VERSION: undefined }, () => {
    assert.equal(resolveActiveEncryptVersion(), "v1", "T5: unset ACTIVE_VERSION must resolve to v1");
    const encrypted = encryptToken(FAKE_PLAINTEXT_TOKEN);
    assert.equal(encrypted.keyVersion, "v1", "T5: with ACTIVE_VERSION unset, new encryption must stamp v1");
  });
  console.log("PASS T5 active v1 (default) writes v1");

  // ===== T6 — mere presence of a v2 key does NOT activate it =====
  withEnv({ MERCADOPAGO_TOKEN_ENCRYPTION_KEY: FAKE_V1_KEY, MERCADOPAGO_TOKEN_ENCRYPTION_KEY_V2: FAKE_V2_KEY, MERCADOPAGO_TOKEN_ENCRYPTION_ACTIVE_VERSION: undefined }, () => {
    // Same setup as T5, restated as its own scenario per the required test matrix (T6 is explicitly
    // about the presence of V2 alongside V1, not merely ACTIVE_VERSION being unset).
    assert.equal(resolveActiveEncryptVersion(), "v1", "T6: MERCADOPAGO_TOKEN_ENCRYPTION_KEY_V2 being set must not, by itself, activate v2");
  });
  console.log("PASS T6 presence of v2 key does not auto-activate it");

  // ===== T7 — unknown keyVersion fails closed, before touching any key =====
  withEnv({ MERCADOPAGO_TOKEN_ENCRYPTION_KEY: FAKE_V1_KEY, MERCADOPAGO_TOKEN_ENCRYPTION_KEY_V2: FAKE_V2_KEY }, () => {
    const encrypted = encryptToken(FAKE_PLAINTEXT_TOKEN);
    const tampered = { ...encrypted, keyVersion: "v99" as unknown as "v1" };
    assert.throws(() => decryptToken(tampered), MercadoPagoEncryptionKeyError, "T7: an unrecognized keyVersion must throw MercadoPagoEncryptionKeyError");
  });
  console.log("PASS T7 unknown key version fails closed");

  // ===== T8 — a v2-stamped document with a wrong/missing v2 key fails, and NEVER falls back to v1 =====
  withEnv({ MERCADOPAGO_TOKEN_ENCRYPTION_KEY: FAKE_V1_KEY, MERCADOPAGO_TOKEN_ENCRYPTION_KEY_V2: FAKE_V2_KEY, MERCADOPAGO_TOKEN_ENCRYPTION_ACTIVE_VERSION: "v2" }, () => {
    const encrypted = encryptToken(FAKE_PLAINTEXT_TOKEN);
    assert.equal(encrypted.keyVersion, "v2");
    // Now simulate the v2 key being wrong (e.g. operator error) — v1 remains correctly configured,
    // proving a decrypt failure here is NOT explained by v1 being unavailable, only by the code
    // correctly refusing to try v1 for a v2-stamped document.
    withEnv({ MERCADOPAGO_TOKEN_ENCRYPTION_KEY_V2: FAKE_WRONG_V2_KEY }, () => {
      assert.throws(() => decryptToken(encrypted), undefined, "T8: a v2 document with the wrong v2 key must fail, never silently succeed");
    });
    withEnv({ MERCADOPAGO_TOKEN_ENCRYPTION_KEY_V2: undefined }, () => {
      assert.throws(() => decryptToken(encrypted), MercadoPagoEncryptionKeyError, "T8: a v2 document with NO v2 key configured must fail closed, even though v1 IS configured");
    });
  });
  console.log("PASS T8 wrong/missing v2 key fails with no v1 fallback");

  // ===== T9 — a mixed v1/v2 dataset is readable in one pass, each document resolved independently =====
  withEnv({ MERCADOPAGO_TOKEN_ENCRYPTION_KEY: FAKE_V1_KEY, MERCADOPAGO_TOKEN_ENCRYPTION_KEY_V2: FAKE_V2_KEY }, () => {
    const v1Doc = withEnv({ MERCADOPAGO_TOKEN_ENCRYPTION_ACTIVE_VERSION: "v1" }, () => encryptToken(`${FAKE_PLAINTEXT_TOKEN}-v1`));
    const legacyDoc = (() => {
      const e = { ...withEnv({ MERCADOPAGO_TOKEN_ENCRYPTION_ACTIVE_VERSION: "v1" }, () => encryptToken(`${FAKE_PLAINTEXT_TOKEN}-legacy`)) } as Partial<typeof v1Doc>;
      delete e.keyVersion;
      return e as typeof v1Doc;
    })();
    const v2Doc = withEnv({ MERCADOPAGO_TOKEN_ENCRYPTION_ACTIVE_VERSION: "v2" }, () => encryptToken(`${FAKE_PLAINTEXT_TOKEN}-v2`));

    assert.equal(decryptToken(v1Doc), `${FAKE_PLAINTEXT_TOKEN}-v1`);
    assert.equal(decryptToken(legacyDoc), `${FAKE_PLAINTEXT_TOKEN}-legacy`);
    assert.equal(decryptToken(v2Doc), `${FAKE_PLAINTEXT_TOKEN}-v2`);
  });
  console.log("PASS T9 mixed v1/v2/legacy dataset is readable, each document resolved independently");

  // ===== T18/T19 — OLD_KEY_RETIREMENT_GUARD decision logic, tested as a pure function =====
  // Deliberately NOT tested against a live Firestore scan: script/mercadopago-token-encryption-
  // migration-tests.ts's emulator session can be shared with OTHER test suites (e.g.
  // mercadopago-oauth-tests.ts) that create their own v1-encrypted connections using a DIFFERENT
  // real key value — documents this test process can never decrypt, by design (that's the fail-
  // closed contract working correctly, not a bug). A global "must be exactly 0" assertion against a
  // shared database would be flaky for reasons that have nothing to do with the guard's own logic.
  // Testing computeRetirementSafety() directly, with fully controlled inputs, is what actually
  // proves the decision rule — and it's the exact function runTokenEncryptionMigration() calls.
  const { computeRetirementSafety } = await import("./migrate-mercadopago-token-encryption");

  assert.equal(computeRetirementSafety({ v1OrUnversionedFields: 1, unknownVersionFields: 0, decryptFailures: 0 }), false, "T18: must reject with any v1/unversioned field remaining");
  assert.equal(computeRetirementSafety({ v1OrUnversionedFields: 0, unknownVersionFields: 1, decryptFailures: 0 }), false, "T18: must reject with any unknown-version field remaining");
  assert.equal(computeRetirementSafety({ v1OrUnversionedFields: 0, unknownVersionFields: 0, decryptFailures: 1 }), false, "T18: must reject with any decrypt failure remaining");
  assert.equal(computeRetirementSafety({ v1OrUnversionedFields: 3, unknownVersionFields: 2, decryptFailures: 1 }), false, "T18: must reject when all three are simultaneously nonzero");
  console.log("PASS T18 retirement guard rejects whenever any of the three counts is nonzero");

  assert.equal(computeRetirementSafety({ v1OrUnversionedFields: 0, unknownVersionFields: 0, decryptFailures: 0 }), true, "T19: must pass only when all three counts are exactly zero");
  console.log("PASS T19 retirement guard passes only when v1/unversioned, unknown-version, and decrypt-failure counts are all exactly zero");

  console.log(
    "RC-P0-SECURITY-02B crypto tests passed: T1-T9 — legacy-unversioned/explicit-v1/explicit-v2 all " +
    "decrypt correctly, v2 encryption stamps keyVersion, default and presence-of-v2 both leave v1 " +
    "active, unknown version and wrong/missing v2 key both fail closed with zero cross-key fallback, " +
    "and a mixed dataset decrypts correctly document-by-document. T18-T19 — the retirement guard's " +
    "decision logic rejects on any nonzero count and passes only at a clean 0/0/0.",
  );
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
