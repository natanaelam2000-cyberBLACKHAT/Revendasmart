/**
 * RC-P0-SECURITY-02A — operator verification script for a rotated Firebase Admin credential.
 *
 * Reuses the REAL server initialization path (server/firebase-admin-init.ts) — this never
 * reimplements credential handling, so a PASS here means the exact code path the running
 * backend uses also works with whatever FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL /
 * FIREBASE_PRIVATE_KEY are currently set in this shell's environment.
 *
 * SAFETY CONTRACT:
 * - Never reads or prints any env var VALUE — only presence (YES/NO).
 * - Default mode is READ-ONLY: one bounded read against a dedicated, non-business collection.
 * - A write+delete pair only runs with the explicit --write-check flag, against a dedicated
 *   "_ops_verification" collection — never any real application collection (users/products/
 *   clients/sales/etc). The temp document is deleted immediately after the read-back confirms it.
 * - Exits non-zero on any FAIL so it's safe to use as a pass/fail gate in a shell script.
 *
 * Usage:
 *   npx tsx script/security-verify-firebase-admin.ts
 *   npx tsx script/security-verify-firebase-admin.ts --write-check
 */
import { initializeFirebaseAdmin } from "../server/firebase-admin-init";

const WRITE_CHECK = process.argv.includes("--write-check");

type CheckStatus = "PASS" | "FAIL" | "SKIPPED";

function reportEnvPresence(): boolean {
  const required = ["FIREBASE_PROJECT_ID", "FIREBASE_CLIENT_EMAIL", "FIREBASE_PRIVATE_KEY"];
  const present = required.map((name) => Boolean(process.env[name]?.trim()));
  const allPresent = present.every(Boolean);
  // Names and presence only — values are never read into a variable, let alone printed.
  for (let i = 0; i < required.length; i += 1) {
    console.log(`  ${required[i]}: ${present[i] ? "present" : "MISSING"}`);
  }
  console.log(`FIREBASE_ENV_PRESENT = ${allPresent ? "YES" : "NO"}`);
  return allPresent;
}

async function main() {
  console.log("== Firebase Admin credential verification ==");
  console.log("(env var VALUES are never read or printed by this script — presence only)\n");

  const envPresent = reportEnvPresence();
  if (!envPresent) {
    console.log("\nFIREBASE_ADMIN_INIT = FAIL (missing required env vars)");
    console.log("FIRESTORE_READ = SKIPPED");
    console.log(`FIRESTORE_WRITE_DELETE = ${WRITE_CHECK ? "FAIL (skipped, env incomplete)" : "SKIPPED"}`);
    process.exitCode = 1;
    return;
  }

  let initStatus: CheckStatus = "FAIL";
  let readStatus: CheckStatus = "SKIPPED";
  let writeDeleteStatus: CheckStatus = WRITE_CHECK ? "FAIL" : "SKIPPED";

  try {
    const admin = initializeFirebaseAdmin();
    const db = admin.firestore();
    initStatus = "PASS";

    try {
      // A single bounded read against a dedicated, non-business collection — proves the new
      // credential can actually authenticate a Firestore call, without touching real tenant data.
      await db.collection("_ops_verification").limit(1).get();
      readStatus = "PASS";
    } catch (error) {
      readStatus = "FAIL";
      console.error("[FIRESTORE_READ] error (message only, no credential material):", error instanceof Error ? error.message : String(error));
    }

    if (WRITE_CHECK) {
      const docId = `verify-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      const ref = db.collection("_ops_verification").doc(docId);
      try {
        await ref.set({ createdAt: new Date().toISOString(), purpose: "security-verify-firebase-admin" });
        const snap = await ref.get();
        if (!snap.exists) throw new Error("write appeared to succeed but read-back found no document");
        await ref.delete();
        const confirmSnap = await ref.get();
        if (confirmSnap.exists) throw new Error("delete appeared to succeed but the document is still readable");
        writeDeleteStatus = "PASS";
      } catch (error) {
        writeDeleteStatus = "FAIL";
        console.error("[FIRESTORE_WRITE_DELETE] error (message only):", error instanceof Error ? error.message : String(error));
        // Best-effort cleanup even on partial failure — never leave a stray verification doc behind.
        await ref.delete().catch(() => {});
      }
    }
  } catch (error) {
    initStatus = "FAIL";
    console.error("[FIREBASE_ADMIN_INIT] error (message only, no credential material):", error instanceof Error ? error.message : String(error));
  }

  console.log(`\nFIREBASE_ADMIN_INIT = ${initStatus}`);
  console.log(`FIRESTORE_READ = ${readStatus}`);
  console.log(`FIRESTORE_WRITE_DELETE = ${writeDeleteStatus}`);

  if (initStatus !== "PASS" || readStatus === "FAIL" || writeDeleteStatus === "FAIL") {
    process.exitCode = 1;
  }
}

main();
