import { getFirebaseAuth } from "@/lib/firebase";
import { getApiUrl } from "@/lib/api-config";

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
  return resp.json();
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
