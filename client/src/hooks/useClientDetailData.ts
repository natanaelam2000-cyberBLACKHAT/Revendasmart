import { useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { collection, doc, getFirestore, onSnapshot, query, where } from "firebase/firestore";
import { getFirebaseAuth } from "@/lib/firebase";
import type { Client, Sale } from "@/lib/mock-data";

interface ClientDetailData {
  client: Client | null;
  sales: Sale[];
  loading: boolean;
  error?: string;
}

export function useClientDetailData(clientId?: string): ClientDetailData {
  const [client, setClient] = useState<Client | null>(null);
  const [sales, setSales] = useState<Sale[]>([]);
  const [clientLoading, setClientLoading] = useState(Boolean(clientId));
  const [salesLoading, setSalesLoading] = useState(Boolean(clientId));
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!clientId) {
      setClient(null);
      setSales([]);
      setClientLoading(false);
      setSalesLoading(false);
      setError(undefined);
      return;
    }

    const auth = getFirebaseAuth();
    if (!auth) {
      setClient(null);
      setSales([]);
      setClientLoading(false);
      setSalesLoading(false);
      setError("Firebase not initialized");
      return;
    }

    setClientLoading(true);
    setSalesLoading(true);
    setError(undefined);

    let unsubscribeClient: (() => void) | undefined;
    let unsubscribeSales: (() => void) | undefined;

    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      unsubscribeClient?.();
      unsubscribeSales?.();

      if (!user) {
        setClient(null);
        setSales([]);
        setClientLoading(false);
        setSalesLoading(false);
        setError("Not authenticated");
        return;
      }

      const db = getFirestore();

      unsubscribeClient = onSnapshot(
        doc(db, "users", user.uid, "clients", clientId),
        (snapshot) => {
          setClient(snapshot.exists() ? ({ ...snapshot.data(), id: snapshot.id } as Client) : null);
          setError(undefined);
          setClientLoading(false);
        },
        (err) => {
          console.error("[useClientDetailData] Client error:", err);
          setClient(null);
          setError("Failed to load client");
          setClientLoading(false);
        }
      );

      const clientSalesQuery = query(
        collection(db, "users", user.uid, "sales"),
        where("clientId", "==", clientId)
      );

      unsubscribeSales = onSnapshot(
        clientSalesQuery,
        (snapshot) => {
          const data = snapshot.docs
            .map((doc) => ({ ...doc.data(), id: doc.id } as Sale))
            .filter((sale) => sale && typeof sale === "object" && sale.id)
            .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
          setSales(data);
          setError(undefined);
          setSalesLoading(false);
        },
        (err) => {
          console.error("[useClientDetailData] Sales error:", err);
          setSales([]);
          setError("Failed to load client sales");
          setSalesLoading(false);
        }
      );
    });

    return () => {
      unsubscribeClient?.();
      unsubscribeSales?.();
      unsubscribeAuth();
    };
  }, [clientId]);

  return { client, sales, loading: clientLoading || salesLoading, error };
}
