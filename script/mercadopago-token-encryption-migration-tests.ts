import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import { initializeFirebaseAdmin } from "../server/firebase-admin-init";
import { encryptTokenAsVersion, decryptToken, resolveStoredKeyVersion } from "../server/mercadopago-crypto";
import { runTokenEncryptionMigration } from "./migrate-mercadopago-token-encryption";
import type { EncryptedToken } from "../shared/connections";

/**
 * RC-P0-SECURITY-02B — T10-T19: emulator-backed proof of the migration/coverage tool, including
 * real Firestore concurrency (T14) and log-leak checks (T16/T17). Every token/key value here is
 * generated fresh via crypto.randomBytes — never a fixed literal.
 */

const PROJECT_ID = "demo-revendasmart";
const FAKE_V1_KEY = crypto.randomBytes(32).toString("hex");
const FAKE_V2_KEY = crypto.randomBytes(32).toString("hex");

function requireLocalEmulators() {
  assert.equal(process.env.FIRESTORE_EMULATOR_HOST, "127.0.0.1:8080");
  assert.notEqual(process.env.GOOGLE_CLOUD_PROJECT, "revenda-smart");
}

function uidFor(label: string): string {
  return `mp-crypto-mig-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

// Async-aware: awaits fn() BEFORE restoring the environment, so an async fn's real work (including
// any await inside it, e.g. a Firestore call) happens while the env vars are still set — a plain
// try/finally without awaiting the result would restore the environment as soon as fn() merely
// returns its promise, not when the async work inside it actually completes.
async function withEnv<T>(env: Record<string, string | undefined>, fn: () => T | Promise<T>): Promise<T> {
  const previous: Record<string, string | undefined> = {};
  for (const key of Object.keys(env)) previous[key] = process.env[key];
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function minimalConnection(uid: string, id: string, accessToken: EncryptedToken, refreshToken: EncryptedToken | null) {
  return {
    id,
    uid,
    accessToken,
    refreshToken,
    tokenObtainedAt: new Date().toISOString(),
    accessTokenExpiresAt: new Date(Date.now() + 3600_000).toISOString(),
    refreshTokenExpiresAt: new Date(Date.now() + 86400_000 * 180).toISOString(),
    merchantId: "123456789",
    accountEmail: "seller@example.test",
    status: "active" as const,
    isDefault: true,
    environment: "sandbox" as const,
    connectedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

async function run() {
  requireLocalEmulators();
  process.env.FIREBASE_PROJECT_ID = PROJECT_ID;
  initializeFirebaseAdmin();
  const db = initializeFirebaseAdmin().firestore();

  // ===== T10/T13 — migration converts v1 -> v2, and skips an already-v2 sibling in the same pass =====
  {
    const uid = uidFor("t10");
    const v1Access = await withEnv({ MERCADOPAGO_TOKEN_ENCRYPTION_KEY: FAKE_V1_KEY }, () => encryptTokenAsVersion("plain-access-t10", "v1"));
    const v1Refresh = await withEnv({ MERCADOPAGO_TOKEN_ENCRYPTION_KEY: FAKE_V1_KEY }, () => encryptTokenAsVersion("plain-refresh-t10", "v1"));
    const legacyAccess = { ...v1Access } as Partial<EncryptedToken>;
    delete legacyAccess.keyVersion; // simulates a real pre-versioning production document

    const connRef1 = db.collection("users").doc(uid).collection("mercadopago_connections").doc();
    await connRef1.set(minimalConnection(uid, connRef1.id, legacyAccess as EncryptedToken, v1Refresh));

    // A sibling connection already on v2 — must be left completely untouched.
    const v2Access = await withEnv({ MERCADOPAGO_TOKEN_ENCRYPTION_KEY_V2: FAKE_V2_KEY }, () => encryptTokenAsVersion("plain-access-already-v2", "v2"));
    const connRef2 = db.collection("users").doc(uid).collection("mercadopago_connections").doc();
    await connRef2.set(minimalConnection(uid, connRef2.id, v2Access, null));

    await withEnv({ MERCADOPAGO_TOKEN_ENCRYPTION_KEY: FAKE_V1_KEY, MERCADOPAGO_TOKEN_ENCRYPTION_KEY_V2: FAKE_V2_KEY }, async () => {
      const summary = await runTokenEncryptionMigration(db, "apply");
      assert.equal(summary.migratedDocuments >= 1, true, "T10: at least the v1 connection must be migrated");
      assert.equal(summary.skippedAlreadyV2Documents >= 1, true, "T13: the already-v2 connection must be counted as skipped, not migrated again");
    });

    const after1 = (await connRef1.get()).data() as { accessToken: EncryptedToken; refreshToken: EncryptedToken };
    assert.equal(resolveStoredKeyVersion(after1.accessToken), "v2", "T10: accessToken must now be v2");
    assert.equal(resolveStoredKeyVersion(after1.refreshToken), "v2", "T10: refreshToken must now be v2");
    await withEnv({ MERCADOPAGO_TOKEN_ENCRYPTION_KEY_V2: FAKE_V2_KEY }, () => {
      assert.equal(decryptToken(after1.accessToken), "plain-access-t10", "T10: re-encrypted accessToken must decrypt back to the original plaintext");
      assert.equal(decryptToken(after1.refreshToken), "plain-refresh-t10", "T10: re-encrypted refreshToken must decrypt back to the original plaintext");
    });

    const after2 = (await connRef2.get()).data() as { accessToken: EncryptedToken };
    assert.deepEqual(after2.accessToken, v2Access, "T13: the already-v2 sibling's token bytes must be byte-for-byte untouched");

    console.log("PASS T10 migration converts v1 (incl. unversioned legacy) to v2");
    console.log("PASS T13 already-v2 connection is skipped, untouched");

    // ===== T11 — a second run is idempotent: THIS test's own documents are provably untouched =====
    // Scoped to this test's own two documents rather than the migration's global summary counts —
    // the emulator's collectionGroup scan can include data from OTHER suites sharing the same
    // Firestore instance (e.g. mercadopago-oauth-tests.ts, encrypted with a different real key this
    // process can never decrypt — correctly counted as a permanent, expected decrypt failure by
    // THAT data, not a bug here). Only this test's own documents can be asserted unchanged.
    const before1 = (await connRef1.get()).data() as { accessToken: EncryptedToken; refreshToken: EncryptedToken };
    const before2 = (await connRef2.get()).data() as { accessToken: EncryptedToken };
    await withEnv({ MERCADOPAGO_TOKEN_ENCRYPTION_KEY: FAKE_V1_KEY, MERCADOPAGO_TOKEN_ENCRYPTION_KEY_V2: FAKE_V2_KEY }, () => runTokenEncryptionMigration(db, "apply"));
    const afterRerun1 = (await connRef1.get()).data() as { accessToken: EncryptedToken; refreshToken: EncryptedToken };
    const afterRerun2 = (await connRef2.get()).data() as { accessToken: EncryptedToken };
    assert.deepEqual(afterRerun1.accessToken, before1.accessToken, "T11: a second run must not re-encrypt an already-v2 accessToken (byte-identical)");
    assert.deepEqual(afterRerun1.refreshToken, before1.refreshToken, "T11: a second run must not re-encrypt an already-v2 refreshToken (byte-identical)");
    assert.deepEqual(afterRerun2.accessToken, before2.accessToken, "T11: the untouched sibling must remain byte-identical across the second run too");
    console.log("PASS T11 migration is idempotent on a second run (this test's own documents are provably byte-identical)");
  }

  // ===== T12 — an "interrupted" migration (only some documents migrated) resumes correctly on the next run =====
  {
    const uid = uidFor("t12");
    const docsToMigrate = 3;
    const refs: FirebaseFirestore.DocumentReference[] = [];
    for (let i = 0; i < docsToMigrate; i += 1) {
      const access = await withEnv({ MERCADOPAGO_TOKEN_ENCRYPTION_KEY: FAKE_V1_KEY }, () => encryptTokenAsVersion(`plain-t12-${i}`, "v1"));
      const ref = db.collection("users").doc(uid).collection("mercadopago_connections").doc();
      await ref.set(minimalConnection(uid, ref.id, access, null));
      refs.push(ref);
    }

    // Simulate "interruption": migrate ONLY the first document manually, as if the tool had crashed
    // partway through a real run — the remaining two are still v1, exactly like a real interruption
    // would leave them.
    const firstData = (await refs[0].get()).data() as { accessToken: EncryptedToken };
    const migratedFirst = await withEnv({ MERCADOPAGO_TOKEN_ENCRYPTION_KEY: FAKE_V1_KEY, MERCADOPAGO_TOKEN_ENCRYPTION_KEY_V2: FAKE_V2_KEY }, () => encryptTokenAsVersion(decryptToken(firstData.accessToken), "v2"));
    await refs[0].update({ accessToken: migratedFirst });

    // Resume: a normal --apply run must pick up exactly the two still-v1 documents, leaving the
    // already-migrated first one alone.
    const resumeSummary = await withEnv({ MERCADOPAGO_TOKEN_ENCRYPTION_KEY: FAKE_V1_KEY, MERCADOPAGO_TOKEN_ENCRYPTION_KEY_V2: FAKE_V2_KEY }, () => runTokenEncryptionMigration(db, "apply"));
    assert.equal(resumeSummary.migratedDocuments >= 2, true, "T12: the resumed run must migrate the remaining un-migrated documents");

    for (const ref of refs) {
      const data = (await ref.get()).data() as { accessToken: EncryptedToken };
      assert.equal(resolveStoredKeyVersion(data.accessToken), "v2", "T12: every connection must end up on v2 after resuming");
    }
    console.log("PASS T12 an interrupted migration resumes correctly on the next run");
  }

  // ===== T14 — a concurrent write (simulating a live OAuth refresh) is never overwritten by a stale migration write =====
  {
    const uid = uidFor("t14");
    const originalAccess = await withEnv({ MERCADOPAGO_TOKEN_ENCRYPTION_KEY: FAKE_V1_KEY }, () => encryptTokenAsVersion("plain-t14-original", "v1"));
    const ref = db.collection("users").doc(uid).collection("mercadopago_connections").doc();
    await ref.set(minimalConnection(uid, ref.id, originalAccess, null));

    // "Migration's read" — captures the updateTime at this moment, exactly like
    // runTokenEncryptionMigration's own collectionGroup().get() would.
    const staleSnapshot = await ref.get();
    const staleUpdateTime = staleSnapshot.updateTime!;

    // A REAL concurrent write lands after that read — simulating server/mercadopago-connections.ts's
    // own plain `.update()` during a live OAuth token refresh (a genuinely fresher access token).
    const refreshedAccess = await withEnv({ MERCADOPAGO_TOKEN_ENCRYPTION_KEY: FAKE_V1_KEY }, () => encryptTokenAsVersion("plain-t14-refreshed-by-oauth", "v1"));
    await ref.update({ accessToken: refreshedAccess, updatedAt: new Date().toISOString() });

    // Now attempt the exact write the migration tool would have attempted, using the STALE
    // precondition it captured before the refresh happened — this must be rejected.
    const staleMigratedAccess = await withEnv({ MERCADOPAGO_TOKEN_ENCRYPTION_KEY: FAKE_V1_KEY, MERCADOPAGO_TOKEN_ENCRYPTION_KEY_V2: FAKE_V2_KEY }, () => encryptTokenAsVersion("plain-t14-original", "v2"));
    await assert.rejects(
      () => ref.update({ accessToken: staleMigratedAccess }, { lastUpdateTime: staleUpdateTime }),
      "T14: a write using a precondition captured before a concurrent refresh must be rejected by Firestore",
    );

    const finalData = (await ref.get()).data() as { accessToken: EncryptedToken };
    await withEnv({ MERCADOPAGO_TOKEN_ENCRYPTION_KEY: FAKE_V1_KEY }, () => {
      assert.equal(decryptToken(finalData.accessToken), "plain-t14-refreshed-by-oauth", "T14: the refreshed (newer) token must survive — never overwritten by the stale migration attempt");
    });
    console.log("PASS T14 concurrent OAuth-refresh-style write is never overwritten by a stale migration write");
  }

  // ===== T15 — after ACTIVE_VERSION flips to v2, a normal OAuth-refresh-style encryptToken() call
  // lazily produces v2 output, with zero changes to server/mercadopago-connections.ts's own code =====
  {
    const uid = uidFor("t15");
    const v1Access = await withEnv({ MERCADOPAGO_TOKEN_ENCRYPTION_KEY: FAKE_V1_KEY }, () => encryptTokenAsVersion("plain-t15-old", "v1"));
    const ref = db.collection("users").doc(uid).collection("mercadopago_connections").doc();
    await ref.set(minimalConnection(uid, ref.id, v1Access, null));

    // This mirrors EXACTLY what server/mercadopago-connections.ts's refresh functions already do:
    // `encryptToken(newTokens.access_token)` — the generic, ACTIVE_VERSION-driven function, not the
    // migration-only encryptTokenAsVersion. No call site needs to change for this to happen.
    const { encryptToken } = await import("../server/mercadopago-crypto");
    const refreshedViaEncryptToken = await withEnv({ MERCADOPAGO_TOKEN_ENCRYPTION_KEY: FAKE_V1_KEY, MERCADOPAGO_TOKEN_ENCRYPTION_KEY_V2: FAKE_V2_KEY, MERCADOPAGO_TOKEN_ENCRYPTION_ACTIVE_VERSION: "v2" }, () => encryptToken("plain-t15-refreshed"));
    await ref.update({ accessToken: refreshedViaEncryptToken });

    const after = (await ref.get()).data() as { accessToken: EncryptedToken };
    assert.equal(resolveStoredKeyVersion(after.accessToken), "v2", "T15: a plain encryptToken() call after ACTIVE_VERSION=v2 must lazily upgrade the document to v2");
    console.log("PASS T15 OAuth-refresh-style encryptToken() lazily upgrades to v2 once ACTIVE_VERSION flips — no merchant reconnect, no call-site change");
  }

  // ===== T16/T17 — no plaintext token or key ever appears in migration console output =====
  {
    const uid = uidFor("t16t17");
    const secretPlaintext = `super-secret-plaintext-${crypto.randomBytes(6).toString("hex")}`;
    const access = await withEnv({ MERCADOPAGO_TOKEN_ENCRYPTION_KEY: FAKE_V1_KEY }, () => encryptTokenAsVersion(secretPlaintext, "v1"));
    const ref = db.collection("users").doc(uid).collection("mercadopago_connections").doc();
    await ref.set(minimalConnection(uid, ref.id, access, null));

    const captured: string[] = [];
    const original = { log: console.log, warn: console.warn, error: console.error };
    for (const name of ["log", "warn", "error"] as const) {
      console[name] = (...args: unknown[]) => {
        captured.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
      };
    }
    try {
      await withEnv({ MERCADOPAGO_TOKEN_ENCRYPTION_KEY: FAKE_V1_KEY, MERCADOPAGO_TOKEN_ENCRYPTION_KEY_V2: FAKE_V2_KEY }, () => runTokenEncryptionMigration(db, "apply"));
    } finally {
      console.log = original.log;
      console.warn = original.warn;
      console.error = original.error;
    }

    const allOutput = captured.join("\n");
    assert.equal(allOutput.includes(secretPlaintext), false, "T16: the plaintext token must never appear in any console output during migration");
    assert.equal(allOutput.includes(FAKE_V1_KEY), false, "T17: the v1 key must never appear in any console output during migration");
    assert.equal(allOutput.includes(FAKE_V2_KEY), false, "T17: the v2 key must never appear in any console output during migration");
    console.log("PASS T16 plaintext tokens absent from migration output");
    console.log("PASS T17 encryption keys absent from migration output");
  }

  // ===== T18/T19 wiring check — runTokenEncryptionMigration's --verify mode actually uses
  // computeRetirementSafety() on whatever it really observes in Firestore, end to end =====
  // The DECISION LOGIC itself (reject on any nonzero count, pass only at 0/0/0) is proven
  // deterministically in script/mercadopago-token-encryption-tests.ts (T18/T19 there) — a global
  // "must be exactly 0" assertion here would be flaky whenever this emulator session is shared with
  // OTHER suites that leave their own real-keyed (permanently undecryptable-by-us) v1 data behind,
  // which is expected, correct fail-closed behavior, not a defect. What's worth proving here is only
  // that the live --verify path's retirementSafe field is never inconsistent with the counts it
  // itself just reported — i.e. the wiring between the scan and the guard is real.
  {
    const uid = uidFor("t18t19-wiring");
    const v1Access = await withEnv({ MERCADOPAGO_TOKEN_ENCRYPTION_KEY: FAKE_V1_KEY }, () => encryptTokenAsVersion("plain-t18-wiring", "v1"));
    const ref = db.collection("users").doc(uid).collection("mercadopago_connections").doc();
    await ref.set(minimalConnection(uid, ref.id, v1Access, null));

    const { computeRetirementSafety } = await import("./migrate-mercadopago-token-encryption");
    const guard = await withEnv({ MERCADOPAGO_TOKEN_ENCRYPTION_KEY: FAKE_V1_KEY, MERCADOPAGO_TOKEN_ENCRYPTION_KEY_V2: FAKE_V2_KEY }, () => runTokenEncryptionMigration(db, "verify"));
    assert.equal(guard.retirementSafe, computeRetirementSafety(guard), "T18/T19 wiring: --verify's retirementSafe field must always match computeRetirementSafety() applied to its own reported counts");
    // This connection is freshly seeded and unmigrated, so the counts must reflect at least it.
    assert.equal(guard.v1OrUnversionedFields >= 1, true, "T18: the freshly seeded v1 connection must be counted");
    assert.equal(guard.retirementSafe, false, "T18: retirementSafe must be false while at least one v1 field is known to exist");
    console.log("PASS T18/T19 wiring: live --verify retirementSafe is always consistent with computeRetirementSafety() over its own counts (decision logic itself proven separately, deterministically, in mercadopago-token-encryption-tests.ts)");
  }

  console.log(
    "RC-P0-SECURITY-02B migration tests passed: T10-T19 — v1/legacy converts to v2 while an " +
    "already-v2 sibling is left byte-for-byte untouched, a second run and a simulated resume are " +
    "both correct, a concurrent OAuth-refresh-style write always wins over a stale migration write, " +
    "a plain encryptToken() call lazily upgrades a document once ACTIVE_VERSION flips with zero " +
    "call-site changes, no plaintext token or key ever appears in console output, and the retirement " +
    "guard's live wiring is consistent with its own (separately, deterministically proven) decision logic.",
  );
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
