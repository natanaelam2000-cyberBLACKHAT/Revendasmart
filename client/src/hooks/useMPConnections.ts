import { useState, useEffect } from "react";
import { getFirebaseAuth } from "@/lib/firebase";
import { onAuthStateChanged } from "firebase/auth";
import { getFirestore, collection, onSnapshot, query, orderBy } from "firebase/firestore";
import { getApiUrl } from "@/lib/api-config";
import type { MPConnectionSafeView } from "../../../shared/connections";

export type { MPConnectionSafeView };

export interface UseMPConnectionsResult {
  connections: MPConnectionSafeView[];
  activeConnections: MPConnectionSafeView[];
  defaultConnection: MPConnectionSafeView | null;
  loading: boolean;
  error: string;
}

/**
 * Real-time hook that subscribes to users/{uid}/mercadopago_connections.
 * Returns safe views (no encrypted token data).
 */
export function useMPConnections(): UseMPConnectionsResult {
  const [connections, setConnections] = useState<MPConnectionSafeView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const auth = getFirebaseAuth();
    if (!auth) { setLoading(false); return; }

    const unsubAuth = onAuthStateChanged(auth, (user) => {
      if (!user) { setLoading(false); setConnections([]); return; }

      const db = getFirestore();
      const q = query(
        collection(db, "users", user.uid, "mercadopago_connections"),
        orderBy("connectedAt", "desc")
      );

      const unsubSnap = onSnapshot(
        q,
        (snap) => {
          const data = snap.docs.map((d) => ({ id: d.id, ...d.data() })) as MPConnectionSafeView[];
          setConnections(data);
          setLoading(false);
          setError("");
        },
        (err) => {
          console.error("[useMPConnections] Firestore error:", err);
          setError("Erro ao carregar conexões");
          setLoading(false);
        }
      );

      return () => unsubSnap();
    });

    return () => unsubAuth();
  }, []);

  const activeConnections = connections.filter((c) => c.status === "active");
  const defaultConnection = activeConnections.find((c) => c.isDefault) ?? activeConnections[0] ?? null;

  return { connections, activeConnections, defaultConnection, loading, error };
}

// ---------------------------------------------------------------------------
// API helpers
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
