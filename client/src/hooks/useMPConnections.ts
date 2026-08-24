import { useState, useEffect } from "react";
import { getFirebaseAuth } from "@/lib/firebase";
import { onAuthStateChanged } from "firebase/auth";
import { getFirestore, collection, onSnapshot, query, orderBy } from "firebase/firestore";
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

    let unsubSnap: (() => void) | undefined;
    const unsubAuth = onAuthStateChanged(auth, (user) => {
      unsubSnap?.();
      if (!user) { setLoading(false); setConnections([]); return; }

      const db = getFirestore();
      const q = query(
        collection(db, "users", user.uid, "mercadopago_connections"),
        orderBy("connectedAt", "desc")
      );

      unsubSnap = onSnapshot(
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

    });

    return () => { unsubSnap?.(); unsubAuth(); };
  }, []);

  const activeConnections = connections.filter((c) => c.status === "active");
  const defaultConnection = activeConnections.find((c) => c.isDefault) ?? activeConnections[0] ?? null;

  return { connections, activeConnections, defaultConnection, loading, error };
}
