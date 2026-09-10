/**
 * RevendaSmart — Mercado Pago Token Encryption
 *
 * AES-256-GCM authenticated encryption for Mercado Pago OAuth tokens.
 * Key sources (RC-P0-SECURITY-02B — versioned, backward-compatible):
 *   v1 = MERCADOPAGO_TOKEN_ENCRYPTION_KEY        (the only key that has ever existed until now)
 *   v2 = MERCADOPAGO_TOKEN_ENCRYPTION_KEY_V2      (future replacement, not yet in use)
 * Each: 64 hex chars = 32 bytes, or any string of 32+ chars (derived to 32 bytes via SHA-256).
 *
 * MERCADOPAGO_TOKEN_ENCRYPTION_ACTIVE_VERSION selects which key NEW encryptions use ("v1" | "v2",
 * defaults to "v1" when absent/empty). This is deliberately non-secret config, not a secret itself.
 * Any other non-empty value (a typo like "V2" or "v3") throws rather than silently falling back to
 * "v1" — a botched attempt to activate v2 must never be mistaken for a deliberate, unchanged deploy.
 *
 * SECURITY NOTES:
 * - A key is NEVER derived from FIREBASE_PRIVATE_KEY or any reused credential.
 * - A key is NEVER derived from a constant baked into this source file. RELEASE-21: a previous
 *   version of this module fell back to `sha256("insecure-dev-fallback-do-not-use")` whenever the
 *   env var was missing — a key anyone reading this repo could reproduce, making "encrypted" tokens
 *   no more protected than plaintext. There is no fallback anymore: without a real, operator-supplied
 *   secret, `encryptToken`/`decryptToken` throw instead of silently using a knowable key.
 * - Each encryption produces a fresh random 16-byte IV.
 * - GCM authentication tag (16 bytes) prevents tampering.
 * - Decryption fails loudly if ciphertext was modified.
 * - Decryption is fail-closed on the KEY VERSION too: a document's `keyVersion` field (or its
 *   absence, meaning legacy "v1") selects EXACTLY one key to try. There is no cross-key fallback —
 *   a v2-stamped document is never retried against v1, and an unrecognized version string is
 *   rejected outright rather than guessed at. This is what makes a future rotation safe: a wrong or
 *   missing v2 key can only ever fail v2 documents, never silently misbehave against v1 ones.
 * - Keys are resolved fresh on every call (never cached at module load) so a missing/invalid key,
 *   or a changed ACTIVE_VERSION, fails/takes effect only for the very next call — the server still
 *   boots and every other route keeps working, and a rollout doesn't need a restart to be observed
 *   (though Cloud Run only picks up new env/secret values on a fresh revision anyway).
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

export type MercadoPagoEncryptionKeyVersion = "v1" | "v2";

const KEY_VERSIONS: readonly MercadoPagoEncryptionKeyVersion[] = ["v1", "v2"];

const KEY_ENV_VAR_BY_VERSION: Record<MercadoPagoEncryptionKeyVersion, string> = {
  v1: "MERCADOPAGO_TOKEN_ENCRYPTION_KEY",
  v2: "MERCADOPAGO_TOKEN_ENCRYPTION_KEY_V2",
};

function isKnownKeyVersion(value: string): value is MercadoPagoEncryptionKeyVersion {
  return (KEY_VERSIONS as readonly string[]).includes(value);
}

/**
 * Thrown by `encryptToken`/`decryptToken` when the relevant MERCADOPAGO_TOKEN_ENCRYPTION_KEY[_V2]
 * is missing/too weak, or when a document names a key version this code doesn't recognize.
 * Callers must treat this as an operational-configuration failure — never persist a token, never
 * mark a connection active, never fall back to any other behavior.
 */
export class MercadoPagoEncryptionKeyError extends Error {
  constructor(reason: string) {
    super(
      `Chave de criptografia de token do Mercado Pago ${reason}. Tokens do Mercado Pago não podem ` +
        "ser lidos/gravados sem uma chave de criptografia real e reconhecida configurada no ambiente.",
    );
    this.name = "MercadoPagoEncryptionKeyError";
  }
}

if (!process.env.MERCADOPAGO_TOKEN_ENCRYPTION_KEY?.trim()) {
  // Visibility only — this module never crashes the process by itself. The actual fail-closed
  // behavior happens per-call in `resolveEncryptionKey()`, exactly when a Mercado Pago token
  // operation is attempted.
  logWarn("mp_crypto.encryption_key_missing", { module: "mercadopago-crypto", version: "v1" });
}

/**
 * Which key version NEW encryptions use. Defaults to "v1" — this is the single switch a rotation
 * flips once v2 is verified working; merely setting MERCADOPAGO_TOKEN_ENCRYPTION_KEY_V2 in the
 * environment does NOT activate it by itself, on purpose, so a v2 key can be deployed and verified
 * (§ security-verify-mercadopago style checks, or the migration tool's --verify mode) well before
 * it's ever actually used to encrypt anything.
 *
 * Absent/empty is the only silent case (→ "v1"). Any other value must be exactly "v1" or "v2" — a
 * typo like "V2" or "v3" throws instead of silently continuing on "v1", so a botched attempt to cut
 * over to v2 is never mistaken for a deliberate, unchanged v1 deploy.
 */
export function resolveActiveEncryptVersion(): MercadoPagoEncryptionKeyVersion {
  const raw = process.env.MERCADOPAGO_TOKEN_ENCRYPTION_ACTIVE_VERSION?.trim();
  if (!raw) return "v1";
  if (isKnownKeyVersion(raw)) return raw;
  throw new MercadoPagoEncryptionKeyError(
    "tem MERCADOPAGO_TOKEN_ENCRYPTION_ACTIVE_VERSION configurada com um valor não reconhecido — " +
      'use "v1" ou "v2" (ou remova a variável para o padrão "v1"); recusando adivinhar',
  );
}

/**
 * Resolves a 32-byte AES key for EXACTLY the requested version, or throws. Called fresh on every
 * encrypt/decrypt — never memoized — so tests and runtime both always see the current environment.
 */
function resolveEncryptionKey(version: MercadoPagoEncryptionKeyVersion): Buffer {
  const envVar = KEY_ENV_VAR_BY_VERSION[version];
  const rawKey = process.env[envVar]?.trim() ?? "";

  if (!rawKey) {
    throw new MercadoPagoEncryptionKeyError(`(${envVar}, ${version}) está ausente`);
  }
  if (HEX_KEY_PATTERN.test(rawKey)) {
    return Buffer.from(rawKey, "hex");
  }
  if (rawKey.length < MIN_PASSPHRASE_KEY_LENGTH) {
    throw new MercadoPagoEncryptionKeyError(
      `(${envVar}, ${version}) é curta demais (${rawKey.length} caracteres) — use 64 caracteres ` +
        `hexadecimais (32 bytes) ou uma senha de pelo menos ${MIN_PASSPHRASE_KEY_LENGTH} caracteres`,
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
 * Encrypt a plaintext string to an EncryptedToken object, using whichever key version is currently
 * ACTIVE (MERCADOPAGO_TOKEN_ENCRYPTION_ACTIVE_VERSION, default "v1"). Fresh random IV every call.
 * Throws MercadoPagoEncryptionKeyError if the active version's key isn't configured — callers must
 * not catch-and-persist-anyway; let it propagate to an operational error response.
 */
export function encryptToken(plaintext: string): EncryptedToken {
  const version = resolveActiveEncryptVersion();
  const key = resolveEncryptionKey(version);
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
    keyVersion: version,
  };
}

/**
 * Encrypt using an EXPLICIT key version, bypassing MERCADOPAGO_TOKEN_ENCRYPTION_ACTIVE_VERSION.
 * Exists only for the migration tool (script/migrate-mercadopago-token-encryption.ts): a migration
 * re-encrypting v1 documents to v2 must do so deterministically, regardless of whatever the live
 * ACTIVE_VERSION happens to be set to at the moment it runs — normal runtime code must always use
 * `encryptToken()` instead, never this function.
 */
export function encryptTokenAsVersion(plaintext: string, version: MercadoPagoEncryptionKeyVersion): EncryptedToken {
  const key = resolveEncryptionKey(version);
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
    keyVersion: version,
  };
}

// ---------------------------------------------------------------------------
// Decrypt
// ---------------------------------------------------------------------------

/**
 * Decrypt an EncryptedToken back to plaintext.
 *
 * Key-version resolution is fail-closed and never guesses: `encrypted.keyVersion` selects the one
 * key that is ever tried. A document written before this field existed has no `keyVersion` at all —
 * that absence means "v1" (the only key that could possibly have produced it), not an error and not
 * a signal to try multiple keys. An unrecognized version string throws immediately, before touching
 * any key material. This is what lets a v2 key be wrong/missing without silently corrupting v1
 * behavior, and vice versa.
 *
 * Also throws if the ciphertext was tampered with (GCM authentication failure) — never returns a
 * guessed/partial plaintext.
 */
export function decryptToken(encrypted: EncryptedToken): string {
  const versionField = encrypted.keyVersion;
  const version: MercadoPagoEncryptionKeyVersion = versionField ?? "v1";
  if (versionField !== undefined && !isKnownKeyVersion(versionField)) {
    throw new MercadoPagoEncryptionKeyError(
      `tem keyVersion desconhecida ("${versionField}") — recusando decifrar; nenhuma outra chave é tentada`,
    );
  }

  const key = resolveEncryptionKey(version);
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

/** Throws MercadoPagoEncryptionKeyError if the currently ACTIVE version's key isn't configured;
 * returns void otherwise. */
export function assertEncryptionKeyConfigured(): void {
  resolveEncryptionKey(resolveActiveEncryptVersion());
}

/** Resolves which key version a stored EncryptedToken belongs to, applying the same legacy-absent
 * -means-v1 rule as decryptToken — exported so operator tooling (migration/coverage scripts) can
 * classify documents without duplicating this rule or attempting a decrypt just to find out. */
export function resolveStoredKeyVersion(encrypted: Pick<EncryptedToken, "keyVersion">): string {
  return encrypted.keyVersion ?? "v1";
}
