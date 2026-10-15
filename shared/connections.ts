/**
 * RevendaSmart — Mercado Pago Connections: Shared types
 *
 * Types for per-revendedor OAuth connections to Mercado Pago.
 * Firestore paths:
 *   users/{uid}/mercadopago_connections/{connectionId}  — active/revoked connections
 *   mercadopago_oauth_states/{nonce}                   — short-lived OAuth state (server-side)
 */

// ---------------------------------------------------------------------------
// Encrypted token storage (AES-256-GCM)
// ---------------------------------------------------------------------------
export interface EncryptedToken {
  ciphertext: string;           // hex-encoded ciphertext
  iv: string;                   // hex-encoded initialization vector (16 bytes)
  authTag: string;              // hex-encoded authentication tag (16 bytes)
  algorithm: "aes-256-gcm";    // constant — for future-proofing
  encryptedAt: string;          // ISO 8601 — when encryption happened
  /** RC-P0-SECURITY-02B — which MERCADOPAGO_TOKEN_ENCRYPTION_KEY[_V2] encrypted this value.
   * Absent on every document written before this field existed — server/mercadopago-crypto.ts
   * treats a missing keyVersion as "v1" (the only key that could have produced it), never as an
   * error and never by guessing/trying multiple keys. Once present, decryption uses ONLY the
   * named version's key — no cross-key fallback, ever (fail closed on a wrong/missing key for a
   * known version, and on any version string that isn't a currently-known one). */
  keyVersion?: "v1" | "v2";
}

// ---------------------------------------------------------------------------
// Connection status
// ---------------------------------------------------------------------------
export type MPConnectionStatus = "active" | "revoked" | "expired";

// ---------------------------------------------------------------------------
// MP Connection document (Firestore: users/{uid}/mercadopago_connections/{id})
// ---------------------------------------------------------------------------
export interface MPConnection {
  // ── Identity ──────────────────────────────────────────────────────────────
  id: string;                         // Firestore doc ID (auto-generated)
  uid: string;                        // FK → Firebase Auth UID

  // ── Encrypted credentials ─────────────────────────────────────────────────
  accessToken: EncryptedToken | null;     // null after revoke
  refreshToken: EncryptedToken | null;    // null after revoke

  // ── Token lifecycle ───────────────────────────────────────────────────────
  tokenObtainedAt: string;            // ISO 8601: when token was obtained
  accessTokenExpiresAt: string;       // ISO 8601: when access_token expires
  refreshTokenExpiresAt: string;      // ISO 8601: when refresh_token expires

  // ── Account info (from MP OAuth response) ─────────────────────────────────
  merchantId: string;                 // MP merchant user_id
  accountEmail: string;               // MP account email
  accountName?: string;               // MP account name / display name
  accountDocumentId?: string;         // CPF/CNPJ on file with MP

  // ── Status & control ──────────────────────────────────────────────────────
  status: MPConnectionStatus;
  isDefault: boolean;                 // Use by default when generating charges
  environment: "sandbox" | "production";

  // ── Audit (preserved even after revoke) ───────────────────────────────────
  connectedAt: string;                // ISO 8601
  lastUsedAt?: string;                // ISO 8601: last charge generated with this connection
  revokedAt?: string;                 // ISO 8601: when user revoked
  revokedBy?: string;                 // uid of who revoked (self or admin)
  revocationReason?: string;          // "user_initiated" | "token_expired" | "admin"
  ipAddress?: string;                 // IP where connection was established

  // ── Internal ──────────────────────────────────────────────────────────────
  scopes?: string[];                  // OAuth scopes granted
  updatedAt: string;                  // ISO 8601
}

// ---------------------------------------------------------------------------
// Safe view (for frontend — no encrypted tokens)
// ---------------------------------------------------------------------------
export interface MPConnectionSafeView {
  id: string;
  uid: string;
  merchantId: string;
  accountEmail: string;
  accountName?: string;
  status: MPConnectionStatus;
  isDefault: boolean;
  environment: "sandbox" | "production";
  connectedAt: string;
  lastUsedAt?: string;
  revokedAt?: string;
  accessTokenExpiresAt: string;
  refreshTokenExpiresAt: string;
  // No tokens, no ciphertexts
}

export function toSafeView(conn: MPConnection): MPConnectionSafeView {
  return {
    id: conn.id,
    uid: conn.uid,
    merchantId: conn.merchantId,
    accountEmail: conn.accountEmail,
    accountName: conn.accountName,
    status: conn.status,
    isDefault: conn.isDefault,
    environment: conn.environment,
    connectedAt: conn.connectedAt,
    lastUsedAt: conn.lastUsedAt,
    revokedAt: conn.revokedAt,
    accessTokenExpiresAt: conn.accessTokenExpiresAt,
    refreshTokenExpiresAt: conn.refreshTokenExpiresAt,
  };
}

// ---------------------------------------------------------------------------
// OAuth state document (Firestore: mercadopago_oauth_states/{nonce})
// Short-lived (TTL: 10 min), server-side, bound to authenticated uid.
// ---------------------------------------------------------------------------
export interface MPOAuthState {
  nonce: string;                      // Random secure token (document ID)
  uid: string;                        // Firebase Auth UID who initiated flow
  createdAt: string;                  // ISO 8601
  expiresAt: string;                  // ISO 8601 (createdAt + 10 min)
  used: boolean;                      // Invalidated after successful OAuth callback
  usedAt?: string;                    // When it was consumed
  ipAddress?: string;                 // IP of client who initiated
}

// ---------------------------------------------------------------------------
// Token refresh margin (refresh 5 min before expiry)
// ---------------------------------------------------------------------------
export const ACCESS_TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000; // 5 minutes
export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;            // 10 minutes
export const ACCESS_TOKEN_TTL_S = 21600;                      // 6 hours (MP default)
export const REFRESH_TOKEN_TTL_DAYS = 180;                    // 180 days (MP default)

// ---------------------------------------------------------------------------
// RELEASE-05 — browser continuity proof for the OAuth callback.
//
// The state nonce alone proves the callback carries a value the SERVER issued and hasn't seen
// consumed yet — it does NOT prove the browser completing the callback is the same one that started
// the flow (a leaked/copied callback URL would still "work"). An HttpOnly cookie set on the
// `start-auth` response and required to match the `state` param on `callback` closes that gap: only
// the browser that received the Set-Cookie response can present it back, and `SameSite=Lax` still
// allows it to survive the top-level redirect through Mercado Pago's own domain.
// ---------------------------------------------------------------------------
export const MP_OAUTH_CONTINUITY_COOKIE = "mp_oauth_attempt";
