/**
 * RevendaSmart — Mercado Pago Token Encryption
 *
 * AES-256-GCM authenticated encryption for Mercado Pago OAuth tokens.
 * Key source: MERCADOPAGO_TOKEN_ENCRYPTION_KEY (dedicated secret, 64 hex chars = 32 bytes).
 *
 * SECURITY NOTES:
 * - Key is NEVER derived from FIREBASE_PRIVATE_KEY or any reused credential.
 * - Each encryption produces a fresh random 16-byte IV.
 * - GCM authentication tag (16 bytes) prevents tampering.
 * - Decryption fails loudly if ciphertext was modified.
 */

import * as crypto from "crypto";
import { logError, logWarn } from "./logger";
import type { EncryptedToken } from "../shared/connections";

// ---------------------------------------------------------------------------
// Key setup
// ---------------------------------------------------------------------------

const RAW_KEY = process.env.MERCADOPAGO_TOKEN_ENCRYPTION_KEY ?? "";

if (!RAW_KEY) {
  logWarn("mp_crypto.encryption_key_missing", {
    module: "mercadopago-crypto",
    encryptionEnabled: false,
  });
}

/**
 * Derive a 32-byte key from the env var.
 * If provided as 64 hex chars → use directly.
 * Otherwise → SHA-256 hash for consistent length.
 */
function buildKey(): Buffer {
  if (!RAW_KEY) {
    // Return a deterministic but useless key for dev mode (tokens won't decrypt on restart)
    logError("mp_crypto.insecure_fallback_key", undefined, { module: "mercadopago-crypto" });
    return crypto.createHash("sha256").update("insecure-dev-fallback-do-not-use").digest();
  }

  // If provided as 64 hex chars (32 bytes), use directly
  if (/^[0-9a-fA-F]{64}$/.test(RAW_KEY)) {
    return Buffer.from(RAW_KEY, "hex");
  }

  // Otherwise, derive 32 bytes via SHA-256 (allows arbitrary secret formats)
  return crypto.createHash("sha256").update(RAW_KEY).digest();
}

const ENCRYPTION_KEY = buildKey();
const ALGORITHM = "aes-256-gcm" as const;

// ---------------------------------------------------------------------------
// Encrypt
// ---------------------------------------------------------------------------

/**
 * Encrypt a plaintext string to an EncryptedToken object.
 * Fresh random IV every call.
 */
export function encryptToken(plaintext: string): EncryptedToken {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, ENCRYPTION_KEY, iv);

  let ciphertext = cipher.update(plaintext, "utf8", "hex");
  ciphertext += cipher.final("hex");

  const authTag = cipher.getAuthTag().toString("hex");

  return {
    ciphertext,
    iv: iv.toString("hex"),
    authTag,
    algorithm: ALGORITHM,
    encryptedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Decrypt
// ---------------------------------------------------------------------------

/**
 * Decrypt an EncryptedToken back to plaintext.
 * Throws if the ciphertext was tampered with (GCM authentication failure).
 */
export function decryptToken(encrypted: EncryptedToken): string {
  const iv = Buffer.from(encrypted.iv, "hex");
  const authTag = Buffer.from(encrypted.authTag, "hex");

  const decipher = crypto.createDecipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
  decipher.setAuthTag(authTag);

  let plaintext = decipher.update(encrypted.ciphertext, "hex", "utf8");
  plaintext += decipher.final("utf8");

  return plaintext;
}

// ---------------------------------------------------------------------------
// Key validity check (call at startup)
// ---------------------------------------------------------------------------

export function assertEncryptionKeyConfigured(): void {
  if (!RAW_KEY) {
    throw new Error(
      "MERCADOPAGO_TOKEN_ENCRYPTION_KEY is not set. " +
        "Generate a 64-char hex key: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
    );
  }
}
