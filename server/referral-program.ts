import type { Firestore } from "firebase-admin/firestore";

/**
 * Server-side kill switch for referral writes.
 *
 * Firebase Remote Config is intentionally not used here: it is a client SDK and cannot be
 * authoritative for a reward-granting backend route. `system/config` is already the trusted
 * server-owned configuration document used by the subscription admin flow.
 *
 * Missing legacy configuration keeps the existing program behavior. An explicit `false` is the
 * only value that disables the program; malformed values fail open only for backwards-compatible
 * reads, while all writes still pass through the transaction guard below.
 */
export const REFERRAL_PROGRAM_CONFIG_PATH = "system/config";

export class ReferralProgramDisabledError extends Error {
  constructor() {
    super("REFERRAL_PROGRAM_DISABLED");
    this.name = "ReferralProgramDisabledError";
  }
}

function isEnabled(data: Record<string, unknown> | undefined): boolean {
  return data?.referral_program_enabled !== false;
}

export async function isReferralProgramEnabled(db: Firestore): Promise<boolean> {
  try {
    const config = await db.doc(REFERRAL_PROGRAM_CONFIG_PATH).get();
    return isEnabled(config.exists ? config.data() : undefined);
  } catch {
    // A kill-switch read failure must not create a new attribution or reward.
    return false;
  }
}

export async function assertReferralProgramEnabledInTransaction(
  transaction: FirebaseFirestore.Transaction,
  db: Firestore,
): Promise<void> {
  const config = await transaction.get(db.doc(REFERRAL_PROGRAM_CONFIG_PATH));
  if (!isEnabled(config.exists ? config.data() : undefined)) {
    throw new ReferralProgramDisabledError();
  }
}
