/**
 * RevendaSmart — Mercado Pago Connections Module
 *
 * Manages per-revendedor OAuth connections to Mercado Pago.
 * Implements: start-auth, callback, revoke, list, set-default, token-refresh.
 *
 * Endpoints:
 *   POST /api/mercadopago/start-auth          → Return OAuth redirect URL
 *   GET  /api/mercadopago/callback            → Exchange code for tokens (backend-only)
 *   POST /api/mercadopago/revoke/:connectionId → Soft-revoke (preserves history)
 *   GET  /api/mercadopago/connections         → List connections for current user
 *   POST /api/mercadopago/set-default/:id     → Set default connection
 *
 * Security:
 *   - OAuth state/nonce stored server-side in Firestore → bound to uid
 *   - Nonce invalidated after single successful use
 *   - Access/Refresh tokens encrypted with AES-256-GCM
 *   - Revoke: soft-delete (status="revoked", tokens cleared, audit preserved)
 */

import type { Express, NextFunction, Request, Response } from "express";
import * as crypto from "crypto";
import { getFirebaseAdmin } from "./firebase-admin-init";
import { encryptToken, decryptToken } from "./mercadopago-crypto";
import {
  type MPConnection,
  type MPOAuthState,
  toSafeView,
  ACCESS_TOKEN_REFRESH_MARGIN_MS,
  OAUTH_STATE_TTL_MS,
  ACCESS_TOKEN_TTL_S,
  REFRESH_TOKEN_TTL_DAYS,
  MP_OAUTH_CONTINUITY_COOKIE,
} from "../shared/connections";
import { logError, logInfo, logWarn } from "./logger";

function normalizeDetails(details: unknown[]): unknown {
  if (details.length === 0) return undefined;
  return details.length === 1 ? details[0] : details;
}

function mpInfo(message: string, ...details: unknown[]): void {
  logInfo("mp_connections.log", { message, details: normalizeDetails(details) });
}

function mpWarn(message: string, ...details: unknown[]): void {
  logWarn("mp_connections.log", { message, details: normalizeDetails(details) });
}

function mpLogError(message: string, ...details: unknown[]): void {
  logError("mp_connections.log", undefined, { message, details: normalizeDetails(details) });
}

function logMPConnectionError(
  operationName: string,
  uid: string | null,
  errorMsg: string,
  context?: Record<string, any>
) {
  logError(`mp_connections.${operationName}`, errorMsg, {
    uid,
    ...(context ?? {}),
  });
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const CLIENT_ID = process.env.MERCADOPAGO_CLIENT_ID ?? "";
const CLIENT_SECRET = process.env.MERCADOPAGO_CLIENT_SECRET ?? "";
// RC-P0-SECURITY-02N: no hardcoded fallback host — a previous version of this constant silently
// fell back to a specific obsolete Cloud Run URL whenever the env var was unset, which could
// register/authorize OAuth attempts against a stale host without anyone noticing. Same fail-closed
// posture as CLIENT_ID/CLIENT_SECRET above: an empty value here is rejected at request time in
// handleStartAuth, never silently substituted.
const REDIRECT_URI = process.env.MERCADOPAGO_REDIRECT_URI ?? "";
function normalizeFrontendUrl(value: string | undefined): string {
  try {
    const parsed = new URL(value?.trim() || "https://revendasmart.vercel.app");
    if (!["https:", "http:"].includes(parsed.protocol)) return "https://revendasmart.vercel.app";
    return parsed.origin;
  } catch {
    return "https://revendasmart.vercel.app";
  }
}

const FRONTEND_URL = normalizeFrontendUrl(process.env.FRONTEND_URL);
const frontendRedirectUrl = (path: string): string => `${FRONTEND_URL}${path.startsWith("/") ? path : `/${path}`}`;

const MP_AUTH_URL = "https://auth.mercadopago.com/authorization";
const MP_TOKEN_URL = "https://api.mercadopago.com/oauth/token";

function now(): string {
  return new Date().toISOString();
}

const MP_CONNECTION_RATE_LIMIT_WINDOW_MS = 60 * 1000;
const MP_CONNECTION_RATE_LIMIT_MAX_KEYS = 10_000;
const mpConnectionRateLimitMap = new Map<string, { count: number; resetAt: number }>();

function getMPConnectionClientKey(req: Request): string {
  const forwardedFor = req.headers["x-forwarded-for"];
  const firstForwardedFor = Array.isArray(forwardedFor)
    ? forwardedFor[0]
    : forwardedFor?.split(",")[0]?.trim();
  return req.ip ?? firstForwardedFor ?? "unknown";
}

function getQueryValue(value: unknown): string {
  if (Array.isArray(value)) return String(value[0] ?? "");
  return typeof value === "string" ? value : "";
}

// ---------------------------------------------------------------------------
// RELEASE-05 / RC-P0-SECURITY-02N — browser continuity: parse/compare the cookie set for this
// OAuth attempt against the `state` the callback received. Pure functions (no Express/cookie-parser
// dependency) so they're directly unit-testable.
//
// RC-P0-SECURITY-02N: this cookie is no longer trusted to arrive via the backend's own Set-Cookie
// response alone. When start-auth is served through Vercel's rewrite to this Cloud Run backend
// (an "external origin" rewrite — see vercel.json), Set-Cookie from that upstream response is not
// reliably forwarded to the browser (a documented Vercel limitation, not a bug in this module) — so
// a cookie that only the backend ever tried to set could silently never reach the browser at all,
// making every callback fail continuity regardless of host. The frontend (see
// client/src/lib/mercadopago-connection-actions.ts) now sets this cookie itself, from the nonce
// already present in start-auth's own JSON response body, which does not depend on any response
// header surviving a proxy hop. The backend still attempts res.cookie(...) too (kept below, unchanged
// and still HttpOnly) as harmless defense-in-depth for topologies where it does survive (e.g. local
// dev without Vercel) — but the client-set cookie is what the callback can actually rely on in
// production. The comparison logic itself (parse + timing-safe equality) is unchanged either way.
// ---------------------------------------------------------------------------
export function parseCookieHeader(header: string | undefined | null): Record<string, string> {
  const result: Record<string, string> = {};
  if (!header) return result;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    if (!key) continue;
    const rawValue = part.slice(eq + 1).trim();
    try {
      result[key] = decodeURIComponent(rawValue);
    } catch {
      result[key] = rawValue;
    }
  }
  return result;
}

export type OAuthContinuityCheck = "missing" | "mismatch" | "match";

/** Timing-safe: the nonce is a secret, so a naive `===` would leak length/prefix via timing.
 * Distinguishes "missing" (no cookie sent at all) from "mismatch" (a cookie was sent but doesn't
 * match) purely for sanitized diagnostic logging — the security decision itself (only "match" is
 * ever accepted) is identical to before this distinction existed. */
export function classifyOAuthContinuityCookie(cookieHeader: string | undefined | null, expectedNonce: string): OAuthContinuityCheck {
  const provided = parseCookieHeader(cookieHeader)[MP_OAUTH_CONTINUITY_COOKIE];
  if (!provided) return "missing";
  if (provided.length !== expectedNonce.length) return "mismatch";
  try {
    return crypto.timingSafeEqual(Buffer.from(provided, "utf8"), Buffer.from(expectedNonce, "utf8")) ? "match" : "mismatch";
  } catch {
    return "mismatch";
  }
}

/** Retained for callers/tests that only need the boolean fail-closed decision. */
export function hasMatchingOAuthContinuityCookie(cookieHeader: string | undefined | null, expectedNonce: string): boolean {
  return classifyOAuthContinuityCookie(cookieHeader, expectedNonce) === "match";
}

function mpConnectionRateLimit(
  max: number,
  keyPrefix: string,
  getKey: (req: Request) => string,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    const key = `${keyPrefix}:${getKey(req)}`;
    const nowMs = Date.now();
    const current = mpConnectionRateLimitMap.get(key);

    if (!current || nowMs > current.resetAt) {
      if (mpConnectionRateLimitMap.size >= MP_CONNECTION_RATE_LIMIT_MAX_KEYS) {
        for (const [entryKey, entry] of Array.from(mpConnectionRateLimitMap.entries())) {
          if (nowMs > entry.resetAt) mpConnectionRateLimitMap.delete(entryKey);
        }
      }
      mpConnectionRateLimitMap.set(key, {
        count: 1,
        resetAt: nowMs + MP_CONNECTION_RATE_LIMIT_WINDOW_MS,
      });
      return next();
    }

    if (current.count >= max) {
      const retryAfterSeconds = Math.max(1, Math.ceil((current.resetAt - nowMs) / 1000));
      res.setHeader("Retry-After", String(retryAfterSeconds));
      return res.status(429).json({ error: "RATE_LIMITED" });
    }

    current.count += 1;
    return next();
  };
}

const mpOAuthCallbackRateLimit = mpConnectionRateLimit(
  60,
  "mp-oauth:callback",
  (req) => `${getMPConnectionClientKey(req)}:${getQueryValue(req.query.state)}`,
);
const mpOAuthStartRateLimit = mpConnectionRateLimit(
  10,
  "mp-oauth:start",
  (req) => (req as any).firebaseUid ?? getMPConnectionClientKey(req),
);
const mpConnectionListRateLimit = mpConnectionRateLimit(
  120,
  "mp-connections:list",
  (req) => (req as any).firebaseUid ?? getMPConnectionClientKey(req),
);
const mpConnectionMutationRateLimit = mpConnectionRateLimit(
  30,
  "mp-connections:mutation",
  (req) => (req as any).firebaseUid ?? getMPConnectionClientKey(req),
);

// ---------------------------------------------------------------------------
// Firestore helpers
// ---------------------------------------------------------------------------

function getDB() {
  return getFirebaseAdmin().firestore();
}

async function getConnectionRef(uid: string, connectionId: string) {
  return getDB()
    .collection("users")
    .doc(uid)
    .collection("mercadopago_connections")
    .doc(connectionId);
}

async function fetchConnection(uid: string, connectionId: string): Promise<MPConnection | null> {
  const ref = await getConnectionRef(uid, connectionId);
  const doc = await ref.get();
  if (!doc.exists) return null;
  return { id: doc.id, ...doc.data() } as MPConnection;
}

async function getDefaultConnection(uid: string): Promise<MPConnection | null> {
  const snapshot = await getDB()
    .collection("users")
    .doc(uid)
    .collection("mercadopago_connections")
    .where("isDefault", "==", true)
    .limit(1)
    .get();

  if (snapshot.empty) return null;
  const doc = snapshot.docs[0];
  return { id: doc.id, ...doc.data() } as MPConnection;
}

// ---------------------------------------------------------------------------
// OAuth State management (server-side nonces)
// ---------------------------------------------------------------------------

async function createOAuthState(uid: string, ipAddress: string): Promise<string> {
  const nonce = crypto.randomBytes(32).toString("hex");
  const db = getDB();
  const expiresAt = new Date(Date.now() + OAUTH_STATE_TTL_MS).toISOString();

  const state: MPOAuthState = {
    nonce,
    uid,
    createdAt: now(),
    expiresAt,
    used: false,
    ipAddress,
  };

  await db.collection("mercadopago_oauth_states").doc(nonce).set(state);
  mpInfo("[mp-connections] OAuth state created");
  return nonce;
}

async function consumeOAuthState(
  nonce: string,
  expectedUid: string
): Promise<MPOAuthState | null> {
  const db = getDB();
  const ref = db.collection("mercadopago_oauth_states").doc(nonce);

  return db.runTransaction(async (transaction) => {
    const doc = await transaction.get(ref);

    if (!doc.exists) {
      mpWarn("[mp-connections] OAuth state not found");
      return null;
    }

    const state = doc.data() as MPOAuthState;

    if (new Date(state.expiresAt) < new Date()) {
      mpWarn("[mp-connections] OAuth state expired");
      transaction.delete(ref);
      return null;
    }

    if (state.used) {
      mpWarn("[mp-connections] OAuth state already used");
      return null;
    }

    if (state.uid !== expectedUid) {
      mpWarn("[mp-connections] OAuth state owner mismatch");
      return null;
    }

    transaction.update(ref, { used: true, usedAt: now() });
    mpInfo("[mp-connections] OAuth state consumed");

    return state;
  });
}


// ---------------------------------------------------------------------------
// Token exchange & refresh
// ---------------------------------------------------------------------------

interface MPTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
  user_id: number;
  refresh_token?: string;
}

async function exchangeCodeForTokens(code: string): Promise<MPTokenResponse> {
  const resp = await fetch(MP_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      code,
      redirect_uri: REDIRECT_URI,
    }),
  });

  if (!resp.ok) {
    throw new Error(`MP_TOKEN_EXCHANGE_FAILED_${resp.status}`);
  }

  return resp.json() as Promise<MPTokenResponse>;
}

async function refreshAccessTokens(refreshTokenPlain: string): Promise<MPTokenResponse> {
  const resp = await fetch(MP_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: refreshTokenPlain,
    }),
  });

  if (!resp.ok) {
    throw new Error(`MP_TOKEN_REFRESH_FAILED_${resp.status}`);
  }

  return resp.json() as Promise<MPTokenResponse>;
}

interface MercadoPagoAccountMetadata {
  readonly email: string;
  readonly name?: string;
  readonly documentId?: string;
}

/**
 * RELEASE-05B — /users/me nem sempre traz nome/documento (contas business, permissões reduzidas de
 * escopo, contas antigas). Pura de propósito: nunca lança, nunca inventa um nome/documento "unknown"
 * como se fosse dado real do Mercado Pago, e — o ponto central do bug original — OMITE a chave
 * (`name`/`documentId` simplesmente ausentes do objeto retornado) em vez de deixá-la presente com
 * valor `undefined`, que é exatamente o que o Firestore recusa a persistir.
 */
export function sanitizeMercadoPagoAccountMetadata(raw: unknown): MercadoPagoAccountMetadata {
  const data = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const email = typeof data.email === "string" ? data.email.trim() : "";
  const firstName = typeof data.first_name === "string" ? data.first_name.trim() : "";
  const lastName = typeof data.last_name === "string" ? data.last_name.trim() : "";
  const name = [firstName, lastName].filter(Boolean).join(" ").trim();

  const identification = data.identification && typeof data.identification === "object"
    ? (data.identification as Record<string, unknown>)
    : {};
  const rawDocumentId = identification.number;
  const documentId = typeof rawDocumentId === "string"
    ? rawDocumentId.trim()
    : typeof rawDocumentId === "number" && Number.isFinite(rawDocumentId)
      ? String(rawDocumentId)
      : "";

  return {
    email,
    ...(name ? { name } : {}),
    ...(documentId ? { documentId } : {}),
  };
}

async function fetchMPAccountInfo(accessToken: string): Promise<MercadoPagoAccountMetadata> {
  try {
    const resp = await fetch("https://api.mercadopago.com/users/me", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!resp.ok) return { email: "" };
    const data: unknown = await resp.json();
    return sanitizeMercadoPagoAccountMetadata(data);
  } catch {
    return { email: "" };
  }
}

// ---------------------------------------------------------------------------
// Token validity & refresh
// ---------------------------------------------------------------------------

/**
 * Return a valid (non-expired) access token for payment creation.
 * If the user has no active/default connection, central platform token is allowed.
 * If an explicit/default connected account exists but its token fails, fail closed.
 */
export async function getValidMPAccessToken(
  uid: string,
  mpConnectionId?: string | null
): Promise<{
  accessToken: string;
  tokenSource: "central" | "revendedor";
  connectionId: string | null;
}> {
  const centralToken = process.env.MERCADOPAGO_ACCESS_TOKEN ?? "";
  const centralFallback = (reason: string): { accessToken: string; tokenSource: "central"; connectionId: null } => {
    if (!centralToken) throw new Error(`Mercado Pago indisponível: credencial central ausente (${reason})`);
    mpInfo("[mp-connections] Using central payment credential", { reason });
    return { accessToken: centralToken, tokenSource: "central", connectionId: null };
  };
  const blockConnectedAccount = async (reason: string, connectionId: string): Promise<never> => {
    mpWarn("mp_connected_token_unavailable", { reason, connectionId });
    throw new Error("MP_CONNECTED_TOKEN_UNAVAILABLE");
  };

  // No connection specified → try to find default
  let connectionId = mpConnectionId ?? null;
  if (!connectionId) {
    const defaultConn = await getDefaultConnection(uid);
    connectionId = defaultConn?.id ?? null;
  }

  // No active/default connection → central token remains the explicit platform path.
  if (!connectionId) {
    return centralFallback("no_active_connection");
  }

  const connection = await fetchConnection(uid, connectionId);

  // Connected/default account selected → never fall back silently to central.
  if (!connection || connection.status !== "active") {
    return blockConnectedAccount("connection_missing_or_revoked", connectionId);
  }

  if (!connection.accessToken) {
    return blockConnectedAccount("connection_without_access_token", connectionId);
  }

  // Check if token needs refresh (expires within margin)
  const expiresAt = new Date(connection.accessTokenExpiresAt).getTime();
  const needsRefresh = expiresAt - Date.now() < ACCESS_TOKEN_REFRESH_MARGIN_MS;

  if (!needsRefresh) {
    try {
      const plainToken = decryptToken(connection.accessToken);
      return { accessToken: plainToken, tokenSource: "revendedor", connectionId };
    } catch {
      mpLogError("[mp-connections] Stored payment credential could not be decrypted");
      return blockConnectedAccount("stored_token_authentication_failed", connectionId);
    }
  }

  // Token expired or near expiry → refresh
  mpInfo("[mp-connections] Payment credential near expiry — refreshing");

  if (!connection.refreshToken) {
    mpWarn("[mp-connections] Refresh credential unavailable");
    // Mark as expired for user awareness
    await (await getConnectionRef(uid, connectionId)).update({
      status: "expired",
      updatedAt: now(),
    });
    return blockConnectedAccount("refresh_token_missing", connectionId);
  }

  try {
    const plainRefreshToken = decryptToken(connection.refreshToken);
    const newTokens = await refreshAccessTokens(plainRefreshToken);

    const newAccessTokenExpiresAt = new Date(
      Date.now() + newTokens.expires_in * 1000
    ).toISOString();

    const updates: Partial<MPConnection> = {
      accessToken: encryptToken(newTokens.access_token),
      accessTokenExpiresAt: newAccessTokenExpiresAt,
      updatedAt: now(),
    };

    // Also update refresh token if returned
    if (newTokens.refresh_token) {
      updates.refreshToken = encryptToken(newTokens.refresh_token);
    }

    await (await getConnectionRef(uid, connectionId)).update(updates);
    mpInfo("[mp-connections] Payment credential refreshed");

    return { accessToken: newTokens.access_token, tokenSource: "revendedor", connectionId };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logMPConnectionError("token_refresh", uid, msg, {
      connectionId,
      errorName: err instanceof Error ? err.name : "UnknownError",
    });
    // Mark as expired
    await (await getConnectionRef(uid, connectionId)).update({
      status: "expired",
      updatedAt: now(),
    });
    return blockConnectedAccount("token_refresh_failed", connectionId);
  }
}

/**
 * Resolve the exact credential recorded on a charge.
 * Revendedor charges never fall back to the central account.
 */
export async function getMPAccessTokenForCharge(
  uid: string,
  tokenSource: "central" | "revendedor",
  mpConnectionId?: string | null,
): Promise<{ accessToken: string; connectionId: string | null }> {
  if (tokenSource === "central") {
    const centralToken = process.env.MERCADOPAGO_ACCESS_TOKEN ?? "";
    if (!centralToken) throw new Error("CENTRAL_MP_TOKEN_NOT_CONFIGURED");
    return { accessToken: centralToken, connectionId: null };
  }

  if (!mpConnectionId) throw new Error("MP_CONNECTION_ID_MISSING");
  const connection = await fetchConnection(uid, mpConnectionId);
  if (!connection || connection.status !== "active") {
    throw new Error("MP_CONNECTION_NOT_ACTIVE");
  }
  if (!connection.accessToken) throw new Error("MP_CONNECTION_TOKEN_MISSING");

  const expiresAt = new Date(connection.accessTokenExpiresAt).getTime();
  const needsRefresh = !Number.isFinite(expiresAt) ||
    expiresAt - Date.now() < ACCESS_TOKEN_REFRESH_MARGIN_MS;
  if (!needsRefresh) {
    return { accessToken: decryptToken(connection.accessToken), connectionId: mpConnectionId };
  }
  if (!connection.refreshToken) throw new Error("MP_CONNECTION_REFRESH_TOKEN_MISSING");

  const plainRefreshToken = decryptToken(connection.refreshToken);
  const newTokens = await refreshAccessTokens(plainRefreshToken);
  const updates: Partial<MPConnection> = {
    accessToken: encryptToken(newTokens.access_token),
    accessTokenExpiresAt: new Date(Date.now() + newTokens.expires_in * 1000).toISOString(),
    updatedAt: now(),
  };
  if (newTokens.refresh_token) {
    updates.refreshToken = encryptToken(newTokens.refresh_token);
  }
  await (await getConnectionRef(uid, mpConnectionId)).update(updates);
  return { accessToken: newTokens.access_token, connectionId: mpConnectionId };
}

/**
 * Compatibility lookup for old webhook URLs that did not include charge identity.
 */
export async function findMPConnectionByMerchantId(
  merchantId: string,
): Promise<{ uid: string; connectionId: string } | null> {
  if (!merchantId) return null;
  const admin = getFirebaseAdmin();
  const snapshot = await admin.firestore()
    .collectionGroup("mercadopago_connections")
    .where("merchantId", "==", merchantId)
    .limit(10)
    .get();
  const document = snapshot.docs.find((item) => item.data()?.status === "active");
  if (!document) return null;
  const uid = document.ref.parent.parent?.id ?? "";
  return uid ? { uid, connectionId: document.id } : null;
}

// ---------------------------------------------------------------------------
// Route: POST /api/mercadopago/start-auth
// ---------------------------------------------------------------------------
async function handleStartAuth(req: Request, res: Response) {
  try {
    const uid = (req as any).firebaseUid as string;
    const ipAddress = req.ip ?? req.headers["x-forwarded-for"]?.toString() ?? "";

    if (!CLIENT_ID) {
      return res.status(500).json({
        error: "MERCADOPAGO_CLIENT_ID is not configured",
      });
    }

    // RC-P0-SECURITY-02N: fail closed rather than ever silently falling back to an obsolete host —
    // checked before creating any server-side state, so a missing config never leaves a dangling
    // OAuth attempt behind.
    if (!REDIRECT_URI) {
      return res.status(500).json({
        error: "MERCADOPAGO_REDIRECT_URI is not configured",
      });
    }

    // Create server-side nonce bound to this uid
    const nonce = await createOAuthState(uid, ipAddress);

    // RELEASE-05: bind this attempt to THIS browser — HttpOnly so client JS never reads/replays it,
    // Secure so it never leaves TLS, SameSite=Lax so it still rides the top-level redirect back from
    // Mercado Pago. Never relied on alone (state stays server-owned/single-use/expiring) — this is the
    // additional continuity layer the callback checks before trusting the state at all.
    res.cookie(MP_OAUTH_CONTINUITY_COOKIE, nonce, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      maxAge: OAUTH_STATE_TTL_MS,
      path: "/api/mercadopago",
    });

    const authUrl = new URL(MP_AUTH_URL);
    authUrl.searchParams.set("client_id", CLIENT_ID);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
    authUrl.searchParams.set("state", nonce);

    mpInfo("oauth_attempt_created");

    return res.json({ authUrl: authUrl.toString(), nonce });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const uid = (req as any).firebaseUid as string | null;
    logMPConnectionError("start_auth", uid, msg, {
      errorName: err instanceof Error ? err.name : "UnknownError",
    });
    return res.status(500).json({ error: "MP_AUTH_START_FAILED", message: "Não foi possível iniciar a autorização do Mercado Pago." });
  }
}

// ---------------------------------------------------------------------------
// Route: GET /api/mercadopago/callback
// MP redirects here with ?code=...&state={nonce}
// This is backend-only — no user token in this request.
// uid is recovered from the nonce stored in Firestore.
// ---------------------------------------------------------------------------
function rejectCallback(res: Response, reason: string): void {
  mpWarn("oauth_callback_rejected", { reason });
  return res.redirect(frontendRedirectUrl(`/settings/mercadopago?status=error&reason=${reason}`));
}

async function handleCallback(req: Request, res: Response) {
  const code = getQueryValue(req.query.code);
  const nonce = getQueryValue(req.query.state);
  const oauthError = getQueryValue(req.query.error);

  // Handle MP OAuth error (user denied permission)
  if (oauthError) {
    mpWarn("oauth_callback_rejected", { reason: "provider_denied" });
    return res.redirect(frontendRedirectUrl("/settings/mercadopago?status=denied"));
  }

  if (!code || !nonce) {
    rejectCallback(res, "missing_params");
    return;
  }

  if (!/^[a-f0-9]{64}$/i.test(nonce) || code.length > 2048) {
    rejectCallback(res, "invalid_state");
    return;
  }

  // RELEASE-05: browser continuity — checked BEFORE touching the state document at all, so a
  // leaked/copied callback URL opened in a different browser (which never received the start-auth
  // continuity cookie) never even gets to learn whether the nonce exists, and never burns it.
  // RC-P0-SECURITY-02N: classify() distinguishes "missing" from "mismatch" for sanitized logging
  // only — both are rejected identically; neither the cookie value nor the nonce is ever logged.
  const continuityCheck = classifyOAuthContinuityCookie(req.headers.cookie, nonce);
  if (continuityCheck !== "match") {
    rejectCallback(res, continuityCheck === "missing" ? "continuity_cookie_missing" : "continuity_cookie_mismatch");
    return;
  }

  try {
    // Recover uid from nonce: look it up in Firestore before consuming
    const db = getDB();
    const stateDoc = await db.collection("mercadopago_oauth_states").doc(nonce).get();

    if (!stateDoc.exists) {
      rejectCallback(res, "invalid_state");
      return;
    }

    const stateData = stateDoc.data() as MPOAuthState;
    const uid = stateData.uid;

    // Validate and consume the nonce
    const oauthState = await consumeOAuthState(nonce, uid);
    if (!oauthState) {
      rejectCallback(res, "invalid_state");
      return;
    }
    mpInfo("oauth_attempt_consumed");

    // Exchange code for tokens
    const tokens = await exchangeCodeForTokens(code);

    // Fetch MP account info
    const accountInfo = await fetchMPAccountInfo(tokens.access_token);

    // Compute expiry timestamps
    const accessTokenExpiresAt = new Date(
      Date.now() + (tokens.expires_in || ACCESS_TOKEN_TTL_S) * 1000
    ).toISOString();

    const refreshTokenExpiresAt = new Date(
      Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000
    ).toISOString();

    // Detect environment from token prefix
    const environment = tokens.access_token.startsWith("TEST-")
      ? ("sandbox" as const)
      : ("production" as const);

    // Deactivate any existing default connections for this uid
    const existingConnections = await db
      .collection("users")
      .doc(uid)
      .collection("mercadopago_connections")
      .where("status", "==", "active")
      .where("isDefault", "==", true)
      .get();

    const batch = db.batch();
    existingConnections.docs.forEach((doc: FirebaseFirestore.QueryDocumentSnapshot) => {
      batch.update(doc.ref, { isDefault: false, updatedAt: now() });
    });
    await batch.commit();

    // Create new connection document
    const connRef = db
      .collection("users")
      .doc(uid)
      .collection("mercadopago_connections")
      .doc();

    // RELEASE-05B: accountName/accountDocumentId só entram no objeto quando accountInfo realmente os
    // trouxe — nunca como uma chave presente com valor `undefined` (é exatamente isso que o Firestore
    // recusa a persistir). Construção explícita, sem JSON.parse(JSON.stringify(...)) como faxina.
    const connection: MPConnection = {
      id: connRef.id,
      uid,
      accessToken: encryptToken(tokens.access_token),
      refreshToken: tokens.refresh_token ? encryptToken(tokens.refresh_token) : null,
      tokenObtainedAt: now(),
      accessTokenExpiresAt,
      refreshTokenExpiresAt,
      merchantId: String(tokens.user_id),
      accountEmail: accountInfo.email,
      ...(accountInfo.name ? { accountName: accountInfo.name } : {}),
      ...(accountInfo.documentId ? { accountDocumentId: accountInfo.documentId } : {}),
      status: "active",
      isDefault: true,
      environment,
      connectedAt: now(),
      ipAddress: req.ip ?? "",
      scopes: tokens.scope ? tokens.scope.split(" ") : [],
      updatedAt: now(),
    };

    await connRef.set(connection);

    mpInfo("merchant_connection_created", { environment });
    res.clearCookie(MP_OAUTH_CONTINUITY_COOKIE, { path: "/api/mercadopago" });

    return res.redirect(
      frontendRedirectUrl(`/settings/mercadopago?status=success&connectionId=${connRef.id}`)
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logMPConnectionError("callback", null, msg, {
      errorName: err instanceof Error ? err.name : "UnknownError",
    });
    return res.redirect(
      frontendRedirectUrl("/settings/mercadopago?status=error&reason=server_error")
    );
  }
}

// ---------------------------------------------------------------------------
// Route: POST /api/mercadopago/revoke/:connectionId
// SOFT revoke: status="revoked", tokens cleared, audit history preserved
// ---------------------------------------------------------------------------
async function handleRevoke(req: Request, res: Response) {
  try {
    const uid = (req as any).firebaseUid as string;
    const connectionId = Array.isArray(req.params.connectionId)
      ? req.params.connectionId[0]
      : req.params.connectionId;

    if (!connectionId) {
      return res.status(400).json({ error: "connectionId required" });
    }

    const connection = await fetchConnection(uid, connectionId);
    if (!connection) {
      return res.status(404).json({ error: "Connection not found" });
    }

    if (connection.uid !== uid) {
      return res.status(403).json({ error: "Forbidden" });
    }

    if (connection.status === "revoked") {
      return res.json({ status: "revoked", message: "Already revoked" });
    }

    // Attempt to notify MP of revocation (best-effort, non-blocking)
    if (connection.accessToken && CLIENT_ID && CLIENT_SECRET) {
      try {
        const plainToken = decryptToken(connection.accessToken);
        await fetch("https://api.mercadopago.com/oauth/token", {
          method: "DELETE",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Authorization: `Bearer ${plainToken}`,
          },
          body: new URLSearchParams({
            client_id: CLIENT_ID,
            client_secret: CLIENT_SECRET,
          }),
        });
        mpInfo("[mp-connections/revoke] MP notified of revocation");
      } catch (err) {
        mpWarn(`[mp-connections/revoke] MP revoke call failed (continuing):`, err);
      }
    }

    // SOFT REVOKE: Clear tokens but preserve all audit fields
    const ref = await getConnectionRef(uid, connectionId);
    await ref.update({
      status: "revoked",
      accessToken: null,       // Encrypted token cleared
      refreshToken: null,      // Encrypted token cleared
      isDefault: false,
      revokedAt: now(),
      revokedBy: uid,
      revocationReason: "user_initiated",
      updatedAt: now(),
      // Preserve: id, uid, merchantId, accountEmail, accountName, connectedAt, lastUsedAt
    });

    mpInfo("[mp-connections/revoke] Connection revoked");

    return res.json({ connectionId, status: "revoked" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const uid = (req as any).firebaseUid as string | null;
    logMPConnectionError("revoke", uid, msg, {
      connectionId: req.params.connectionId,
      errorName: err instanceof Error ? err.name : "UnknownError",
    });
    return res.status(500).json({ error: "MP_CONNECTION_REVOKE_FAILED" });
  }
}

// ---------------------------------------------------------------------------
// Route: GET /api/mercadopago/connections
// ---------------------------------------------------------------------------
async function handleListConnections(req: Request, res: Response) {
  try {
    const uid = (req as any).firebaseUid as string;

    const snapshot = await getDB()
      .collection("users")
      .doc(uid)
      .collection("mercadopago_connections")
      .orderBy("connectedAt", "desc")
      .get();

    const connections = snapshot.docs.map((doc: FirebaseFirestore.QueryDocumentSnapshot) => {
      const conn = { id: doc.id, ...doc.data() } as MPConnection;
      return toSafeView(conn); // Strip encrypted tokens from response
    });

    return res.json({ connections });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const uid = (req as any).firebaseUid as string | null;
    logMPConnectionError("list_connections", uid, msg, {
      errorName: err instanceof Error ? err.name : "UnknownError",
    });
    return res.status(500).json({ error: "MP_CONNECTIONS_LIST_FAILED" });
  }
}

// ---------------------------------------------------------------------------
// Route: POST /api/mercadopago/set-default/:connectionId
// ---------------------------------------------------------------------------
async function handleSetDefault(req: Request, res: Response) {
  try {
    const uid = (req as any).firebaseUid as string;
    const connectionId = Array.isArray(req.params.connectionId)
      ? req.params.connectionId[0]
      : req.params.connectionId;

    const connection = await fetchConnection(uid, connectionId);
    if (!connection) {
      return res.status(404).json({ error: "Connection not found" });
    }
    if (connection.uid !== uid) {
      return res.status(403).json({ error: "Forbidden" });
    }
    if (connection.status !== "active") {
      return res.status(400).json({ error: "Cannot set a revoked/expired connection as default" });
    }

    const db = getDB();
    const batch = db.batch();

    // Unset all current defaults
    const currentDefaults = await db
      .collection("users")
      .doc(uid)
      .collection("mercadopago_connections")
      .where("isDefault", "==", true)
      .get();

    currentDefaults.docs.forEach((doc: FirebaseFirestore.QueryDocumentSnapshot) => {
      batch.update(doc.ref, { isDefault: false, updatedAt: now() });
    });

    // Set new default
    const ref = await getConnectionRef(uid, connectionId);
    batch.update(ref, { isDefault: true, updatedAt: now() });

    await batch.commit();

    mpInfo("[mp-connections/set-default] Default connection updated");

    return res.json({ connectionId, isDefault: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const uid = (req as any).firebaseUid as string | null;
    logMPConnectionError("set_default", uid, msg, {
      connectionId: req.params.connectionId,
      errorName: err instanceof Error ? err.name : "UnknownError",
    });
    return res.status(500).json({ error: "MP_CONNECTION_SET_DEFAULT_FAILED" });
  }
}

// ---------------------------------------------------------------------------
// Register all connection routes
// ---------------------------------------------------------------------------
export function registerConnectionRoutes(
  app: Express,
  requireAuth: (req: Request, res: Response, next: any) => void
): void {
  // OAuth callback is PUBLIC (MP redirects here, no Bearer token)
  app.get("/api/mercadopago/callback", mpOAuthCallbackRateLimit, handleCallback);

  // All other routes require auth
  app.post("/api/mercadopago/start-auth", requireAuth, mpOAuthStartRateLimit, handleStartAuth);
  app.post("/api/mercadopago/revoke/:connectionId", requireAuth, mpConnectionMutationRateLimit, handleRevoke);
  app.get("/api/mercadopago/connections", requireAuth, mpConnectionListRateLimit, handleListConnections);
  app.post("/api/mercadopago/set-default/:connectionId", requireAuth, mpConnectionMutationRateLimit, handleSetDefault);

  mpInfo("[mp-connections] Routes registered: /api/mercadopago/{start-auth,callback,revoke,connections,set-default}");
}
