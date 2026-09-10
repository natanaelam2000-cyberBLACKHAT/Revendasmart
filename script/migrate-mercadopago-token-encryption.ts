/**
 * RC-P0-SECURITY-02B — migration + coverage tool for Mercado Pago OAuth token encryption key
 * rotation (v1 -> v2). See docs/SECURITY_PROVIDER_ROTATION_RUNBOOK.md, Section I / Phases, for the
 * full manual rollout sequence this tool is one step of.
 *
 * This tool does THREE things, all gated behind explicit flags — the default with no flags is the
 * safest possible mode (read-only, reports what a real run would do):
 *
 *   npx tsx script/migrate-mercadopago-token-encryption.ts --project <FIREBASE_PROJECT_ID>
 *     → DRY RUN. Scans every mercadopago_connections document, classifies each stored token's key
 *       version, and reports what WOULD be re-encrypted. Writes nothing.
 *
 *   npx tsx script/migrate-mercadopago-token-encryption.ts --project <FIREBASE_PROJECT_ID> --apply
 *     → Actually re-encrypts every v1/legacy (unversioned) token to v2, one Firestore precondition-
 *       guarded update per connection document (see "Stale-write protection" below).
 *
 *   npx tsx script/migrate-mercadopago-token-encryption.ts --project <FIREBASE_PROJECT_ID> --verify
 *     → Read-only coverage/retirement report: TOTAL_CONNECTIONS, V1_OR_UNVERSIONED, V2,
 *       UNKNOWN_VERSION, DECRYPT_FAILURES, and OLD_KEY_RETIREMENT_GUARD (whether it is currently
 *       safe to remove MERCADOPAGO_TOKEN_ENCRYPTION_KEY from the environment).
 *
 * --apply and --verify are mutually exclusive with each other (pick one); omitting both is the
 * dry-run default.
 *
 * REQUIRED ENVIRONMENT GUARD
 * ---------------------------------------------------------------------------------------------
 * `--project <id>` is REQUIRED in every mode and must match `process.env.FIREBASE_PROJECT_ID`
 * exactly, or the tool refuses to run. This is a deliberate "type the environment name to confirm"
 * safety gate — it exists so an operator who meant to target a demo/staging project can never
 * accidentally run this against production (or vice versa) just because their shell's environment
 * variables were left over from a previous session.
 *
 * SAFETY CONTRACT
 * ---------------------------------------------------------------------------------------------
 * - NEVER logs a plaintext token or any encryption key value — only connection paths, counts, and
 *   outcome labels (migrated / skipped-already-v2 / skipped-concurrent-write / decrypt-failed).
 * - NEVER touches any field on a connection document other than accessToken/refreshToken.
 * - Stale-write protected: each write uses a Firestore `lastUpdateTime` precondition captured at
 *   read time. If an OAuth token refresh (server/mercadopago-connections.ts) writes newer tokens to
 *   the SAME document between this tool's read and write, the precondition fails, the write is
 *   REJECTED (never applied), and the document is simply left for the next run to pick up — the
 *   fresher (refreshed) tokens are never overwritten with stale re-encrypted ones.
 * - Idempotent and resumable by construction: a document already at keyVersion=v2 is never
 *   re-written, so running this tool any number of times — including after an interruption — only
 *   ever touches documents that are still v1/legacy.
 *
 * The core scan/migrate logic is exported as `runTokenEncryptionMigration()` so
 * script/mercadopago-token-encryption-migration-tests.ts can exercise it directly against the
 * Firestore emulator (including real concurrency) without shelling out to this file as a CLI.
 */
import { fileURLToPath } from "url";
import type { Firestore } from "firebase-admin/firestore";
import { initializeFirebaseAdmin } from "../server/firebase-admin-init";
import {
  decryptToken,
  encryptTokenAsVersion,
  resolveStoredKeyVersion,
} from "../server/mercadopago-crypto";
import type { EncryptedToken } from "../shared/connections";

export type MigrationMode = "dry_run" | "apply" | "verify";

export type MigrationSummary = {
  totalConnections: number;
  v1OrUnversionedFields: number;
  v2Fields: number;
  unknownVersionFields: number;
  decryptFailures: number;
  migratedDocuments: number;
  skippedAlreadyV2Documents: number;
  skippedConcurrentWriteDocuments: number;
  retirementSafe: boolean;
};

/** Pure decision logic for OLD_KEY_RETIREMENT_GUARD — extracted so it can be tested deterministically
 * without depending on real Firestore scan results (see script/mercadopago-token-encryption-tests.ts
 * T18/T19), and reused as-is by runTokenEncryptionMigration()'s --verify mode. */
export function computeRetirementSafety(counts: Pick<MigrationSummary, "v1OrUnversionedFields" | "unknownVersionFields" | "decryptFailures">): boolean {
  return counts.v1OrUnversionedFields === 0 && counts.unknownVersionFields === 0 && counts.decryptFailures === 0;
}

type TokenFieldName = "accessToken" | "refreshToken";
const TOKEN_FIELDS: readonly TokenFieldName[] = ["accessToken", "refreshToken"];

type Classification = "v1_or_unversioned" | "v2" | "unknown_version" | "absent";

function classify(token: EncryptedToken | null | undefined): Classification {
  if (!token) return "absent";
  const version = resolveStoredKeyVersion(token);
  if (version === "v2") return "v2";
  if (version === "v1") return "v1_or_unversioned";
  return "unknown_version";
}

/** Silent by default (no console output) — callers (the CLI `main()` below, or tests) decide what
 * to print. Never receives or returns plaintext tokens or key material, only counts/paths. */
export async function runTokenEncryptionMigration(db: Firestore, mode: MigrationMode): Promise<MigrationSummary> {
  const snap = await db.collectionGroup("mercadopago_connections").get();

  const summary: MigrationSummary = {
    totalConnections: 0,
    v1OrUnversionedFields: 0,
    v2Fields: 0,
    unknownVersionFields: 0,
    decryptFailures: 0,
    migratedDocuments: 0,
    skippedAlreadyV2Documents: 0,
    skippedConcurrentWriteDocuments: 0,
    retirementSafe: false,
  };

  for (const doc of snap.docs) {
    summary.totalConnections += 1;
    const data = doc.data() as { accessToken?: EncryptedToken | null; refreshToken?: EncryptedToken | null };

    const updates: Record<string, EncryptedToken> = {};
    let anyLegacyField = false;
    let anyUnknownField = false;

    for (const field of TOKEN_FIELDS) {
      const token = data[field] ?? null;
      const classification = classify(token);
      if (classification === "absent") continue;
      if (classification === "v2") {
        summary.v2Fields += 1;
        continue;
      }
      if (classification === "unknown_version") {
        summary.unknownVersionFields += 1;
        anyUnknownField = true;
        continue;
      }
      // v1_or_unversioned
      summary.v1OrUnversionedFields += 1;
      anyLegacyField = true;

      if (mode === "verify") {
        // Coverage mode also confirms the token is genuinely readable with v1, not just that the
        // field is present — a decrypt failure here means the "safe to retire v1" guard must fail.
        try {
          decryptToken(token as EncryptedToken);
        } catch {
          summary.decryptFailures += 1;
        }
        continue;
      }

      if (mode === "dry_run") continue;

      try {
        const plaintext = decryptToken(token as EncryptedToken);
        updates[field] = encryptTokenAsVersion(plaintext, "v2");
      } catch {
        summary.decryptFailures += 1;
      }
    }

    if (mode !== "apply") continue; // dry-run / verify never write

    if (Object.keys(updates).length === 0) {
      // Either every field was already v2 (a genuine skip), or a legacy/unknown field's decrypt
      // failed above (already counted in decryptFailures — not a second, silent skip).
      if (!anyLegacyField && !anyUnknownField) summary.skippedAlreadyV2Documents += 1;
      continue;
    }

    try {
      // Stale-write protection: this precondition makes the write fail (never partially apply) if
      // a concurrent OAuth refresh (or anything else) has touched this exact document since we
      // read it above — the fresher data always wins, this migration never overwrites it.
      await doc.ref.update(updates, { lastUpdateTime: doc.updateTime! });
      summary.migratedDocuments += 1;
    } catch {
      summary.skippedConcurrentWriteDocuments += 1;
    }
  }

  summary.retirementSafe = computeRetirementSafety(summary);
  return summary;
}

// ---------------------------------------------------------------------------
// CLI entrypoint
// ---------------------------------------------------------------------------

function readArgValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

async function main() {
  const apply = process.argv.includes("--apply");
  const verify = process.argv.includes("--verify");
  const targetProject = readArgValue("--project");

  if (apply && verify) {
    console.error("Use only one of --apply or --verify (omit both for a dry run).");
    process.exitCode = 2;
    return;
  }
  if (!targetProject) {
    console.error("Required: --project <FIREBASE_PROJECT_ID> (must match the current environment's FIREBASE_PROJECT_ID exactly).");
    process.exitCode = 2;
    return;
  }
  if (targetProject !== process.env.FIREBASE_PROJECT_ID) {
    console.error(
      `--project ${targetProject} does not match the current environment's FIREBASE_PROJECT_ID ` +
        `(${process.env.FIREBASE_PROJECT_ID ?? "unset"}). Refusing to run — this guard exists so a ` +
        "mismatched shell environment can never point this tool at the wrong project.",
    );
    process.exitCode = 2;
    return;
  }

  const mode: MigrationMode = apply ? "apply" : verify ? "verify" : "dry_run";
  console.log(`== Mercado Pago token-encryption migration tool — mode: ${mode.toUpperCase()} — project: ${targetProject} ==\n`);

  const admin = initializeFirebaseAdmin();
  const db = admin.firestore();

  const summary = await runTokenEncryptionMigration(db, mode);

  console.log(`Scanned ${summary.totalConnections} mercadopago_connections document(s).\n`);
  console.log("== Summary ==");
  console.log(`TOTAL_CONNECTIONS = ${summary.totalConnections}`);
  console.log(`V1_OR_UNVERSIONED = ${summary.v1OrUnversionedFields}`);
  console.log(`V2 = ${summary.v2Fields}`);
  console.log(`UNKNOWN_VERSION = ${summary.unknownVersionFields}`);
  if (mode === "verify") console.log(`DECRYPT_FAILURES = ${summary.decryptFailures}`);

  if (mode === "apply") {
    console.log(`MIGRATED_DOCUMENTS = ${summary.migratedDocuments}`);
    console.log(`SKIPPED_ALREADY_V2_DOCUMENTS = ${summary.skippedAlreadyV2Documents}`);
    console.log(`SKIPPED_CONCURRENT_WRITE_DOCUMENTS = ${summary.skippedConcurrentWriteDocuments}`);
    if (summary.decryptFailures > 0) console.log(`DECRYPT_FAILURES = ${summary.decryptFailures}`);
  }

  if (mode === "verify") {
    console.log(`\nOLD_KEY_RETIREMENT_GUARD = ${summary.retirementSafe ? "SAFE_TO_RETIRE_V1" : "NOT_SAFE_YET"}`);
    if (!summary.retirementSafe) {
      console.log(
        "Do not remove MERCADOPAGO_TOKEN_ENCRYPTION_KEY from the environment yet — run this tool " +
          "with --apply until V1_OR_UNVERSIONED, UNKNOWN_VERSION, and DECRYPT_FAILURES are all 0.",
      );
    }
  }

  if (mode === "dry_run") {
    console.log(
      "\nThis was a dry run — no document was modified. Re-run with --apply once ready, or --verify for a read-only coverage report.",
    );
  }
}

// ESM equivalent of `require.main === module` — true only when this file is the process entry
// point (a direct `tsx script/migrate-...ts` run), false when imported by the test suite.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
