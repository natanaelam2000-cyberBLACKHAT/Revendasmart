import { getFirebaseAuth } from "@/lib/firebase";
import { getApiUrl } from "@/lib/api-config";
import { MP_OAUTH_CONTINUITY_COOKIE, OAUTH_STATE_TTL_MS } from "../../../shared/connections";

// ---------------------------------------------------------------------------
// Mercado Pago connection mutations — split out from useMPConnections.ts so
// pages that only need read-only connection status (e.g. Minha Conta) don't
// pull these OAuth/mutation calls into their bundle via the shared chunk.
// ---------------------------------------------------------------------------

export async function startMPOAuth(): Promise<{ authUrl: string } | null> {
  const auth = getFirebaseAuth();
  const user = auth?.currentUser;
  if (!user) return null;

  const token = await user.getIdToken();
  const resp = await fetch(getApiUrl("/api/mercadopago/start-auth"), {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!resp.ok) return null;
  const body = await resp.json() as { authUrl?: string; nonce?: string };
  if (!body.authUrl || !body.nonce) return null;

  // RC-P0-SECURITY-02N: the backend also tries to set this same cookie via Set-Cookie (kept as
  // defense-in-depth), but that response header is not reliably forwarded to the browser when this
  // request is served through Vercel's rewrite to the Cloud Run backend (a documented Vercel
  // limitation for rewrites to external origins, not something either side can fix in isolation) —
  // so relying on it alone left every production callback failing browser-continuity. Setting it
  // here instead, directly from the nonce already present in this response body, doesn't depend on
  // any header surviving a proxy hop, and exposes nothing new: this same nonce was already fully
  // visible to this page's own JS the moment this fetch resolved.
  document.cookie =
    `${MP_OAUTH_CONTINUITY_COOKIE}=${encodeURIComponent(body.nonce)}; Path=/api/mercadopago; ` +
    `Max-Age=${Math.floor(OAUTH_STATE_TTL_MS / 1000)}; SameSite=Lax; Secure`;

  return { authUrl: body.authUrl };
}

export async function revokeMPConnection(connectionId: string): Promise<boolean> {
  const auth = getFirebaseAuth();
  const user = auth?.currentUser;
  if (!user) return false;

  const token = await user.getIdToken();
  const resp = await fetch(getApiUrl(`/api/mercadopago/revoke/${connectionId}`), {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });

  return resp.ok;
}

export async function setDefaultMPConnection(connectionId: string): Promise<boolean> {
  const auth = getFirebaseAuth();
  const user = auth?.currentUser;
  if (!user) return false;

  const token = await user.getIdToken();
  const resp = await fetch(getApiUrl(`/api/mercadopago/set-default/${connectionId}`), {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });

  return resp.ok;
}
