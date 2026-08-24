/**
 * RevendaSmart — Mercado Pago Token Encryption
 *
 * AES-256-GCM authenticated encryption for Mercado Pago OAuth tokens.
 * Key source: MERCADOPAGO_TOKEN_ENCRYPTION_KEY (dedicated secret, 64 hex chars = 32 bytes,
 * or any string of 32+ chars — derived to 32 bytes via SHA-256).
 *
 * SECURITY NOTES:
 * - Key is NEVER derived from FIREBASE_PRIVATE_KEY or any reused credential.
 * - Key is NEVER derived from a constant baked into this source file. RELEASE-21: a previous
 *   version of this module fell back to `sha256("insecure-dev-fallback-do-not-use")` whenever the
 *   env var was missing — a key anyone reading this repo could reproduce, making "encrypted" tokens
 *   no more protected than plaintext. There is no fallback anymore: without a real, operator-supplied
 *   secret, `encryptToken`/`decryptToken` throw instead of silently using a knowable key.
 * - Each encryption produces a fresh random 16-byte IV.
 * - GCM authentication tag (16 bytes) prevents tampering.
 * - Decryption fails loudly if ciphertext was modified.
 * - The key is resolved fresh on every call (never cached at module load) so a missing/invalid key
 *   fails only the Mercado Pago operation that needed it — the server still boots and every other
 *   route keeps working.
 */

import * as crypto from "crypto";
import { logWarn } from "./logger";
import type { EncryptedToken } from "../shared/connections";

// ---------------------------------------------------------------------------
// Key resolution — lazy, never cached, never falls back to a known value
// ---------------------------------------------------------------------------

const ALGORITHM = "aes-256-gcm" as const;
const HEX_KEY_PATTERN = /^[0-9a-fA-F]{64}$/;
/** Below this length a passphrase-style secret is too easy to guess/brute-force to trust. */
const MIN_PASSPHRASE_KEY_LENGTH = 32;

/**
 * Thrown by `encryptToken`/`decryptToken` when MERCADOPAGO_TOKEN_ENCRYPTION_KEY is missing or too
 * weak to trust. Callers must treat this as an operational-configuration failure — never persist a
 * token, never mark a connection active, never fall back to any other behavior.
 */
export class MercadoPagoEncryptionKeyError extends Error {
  constructor(reason: string) {
    super(
      `MERCADOPAGO_TOKEN_ENCRYPTION_KEY ${reason}. Tokens do Mercado Pago não podem ser lidos/gravados ` +
        "sem uma chave de criptografia real configurada no ambiente.",
    );
    this.name = "MercadoPagoEncryptionKeyError";
  }
}

if (!process.env.MERCADOPAGO_TOKEN_ENCRYPTION_KEY?.trim()) {
  // Visibility only — this module never crashes the process by itself. The actual fail-closed
  // behavior happens per-call in `resolveEncryptionKey()`, exactly when a Mercado Pago token
  // operation is attempted.
  logWarn("mp_crypto.encryption_key_missing", { module: "mercadopago-crypto" });
}

/**
 * Resolves a 32-byte AES key from the env var, or throws. Called fresh on every encrypt/decrypt —
 * never memoized — so tests and runtime both always see the current environment, and a key that
 * becomes available/unavailable between calls is reflected immediately.
 */
function resolveEncryptionKey(): Buffer {
  const rawKey = process.env.MERCADOPAGO_TOKEN_ENCRYPTION_KEY?.trim() ?? "";

  if (!rawKey) {
    throw new MercadoPagoEncryptionKeyError("está ausente");
  }
  if (HEX_KEY_PATTERN.test(rawKey)) {
    return Buffer.from(rawKey, "hex");
  }
  if (rawKey.length < MIN_PASSPHRASE_KEY_LENGTH) {
    throw new MercadoPagoEncryptionKeyError(
      `é curta demais (${rawKey.length} caracteres) — use 64 caracteres hexadecimais (32 bytes) ou uma senha de pelo menos ${MIN_PASSPHRASE_KEY_LENGTH} caracteres`,
    );
  }
  // Non-hex passphrase of adequate length — derive 32 bytes via SHA-256. Still a real, operator-
  // supplied secret; never a value guessable from this source file.
  return crypto.createHash("sha256").update(rawKey).digest();
}

// ---------------------------------------------------------------------------
// Encrypt
// ---------------------------------------------------------------------------

/**
 * Encrypt a plaintext string to an EncryptedToken object.
 * Fresh random IV every call. Throws MercadoPagoEncryptionKeyError if no valid key is configured —
 * callers must not catch-and-persist-anyway; let it propagate to an operational error response.
 */
export function encryptToken(plaintext: string): EncryptedToken {
  const key = resolveEncryptionKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

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
 * Throws if the ciphertext was tampered with (GCM authentication failure) or if no valid key is
 * configured (MercadoPagoEncryptionKeyError) — never returns a guessed/partial plaintext.
 */
export function decryptToken(encrypted: EncryptedToken): string {
  const key = resolveEncryptionKey();
  const iv = Buffer.from(encrypted.iv, "hex");
  const authTag = Buffer.from(encrypted.authTag, "hex");

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let plaintext = decipher.update(encrypted.ciphertext, "hex", "utf8");
  plaintext += decipher.final("utf8");

  return plaintext;
}

// ---------------------------------------------------------------------------
// Key validity check (callers that want to fail fast before doing other work)
// ---------------------------------------------------------------------------

/** Throws MercadoPagoEncryptionKeyError if no valid key is configured; returns void otherwise. */
export function assertEncryptionKeyConfigured(): void {
  resolveEncryptionKey();
}
