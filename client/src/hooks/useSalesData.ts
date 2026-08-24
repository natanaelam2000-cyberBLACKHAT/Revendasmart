import { useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { getFirebaseAuth } from "@/lib/firebase";
import { subscribeSharedUserCollection } from "@/lib/firestore-shared-collection";
import type { Sale } from "@/lib/mock-data";

interface SalesData {
  sales: Sale[];
  loading: boolean;
  error?: string;
}

function mapSaleDoc(id: string, data: Record<string, unknown>): Sale {
  return { ...data, id } as Sale;
}

/** RELEASE-QUALITY-02 §1 — ver useProductsData.ts: mesma subscription compartilhada por uid+coleção. */
export function useSalesData(): SalesData {
  const [sales, setSales] = useState<Sale[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  useEffect(() => {
    const auth = getFirebaseAuth();
    if (!auth) {
      setLoading(false);
      setError("Firebase not initialized");
      return;
    }

    let unsubscribeCollection: (() => void) | undefined;
    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      unsubscribeCollection?.();

      if (!user) {
        setSales([]);
        setLoading(false);
        setError("Not authenticated");
        return;
      }

      setLoading(true);
      unsubscribeCollection = subscribeSharedUserCollection("sales", user.uid, mapSaleDoc, (snapshot) => {
        setSales(snapshot.data);
        setError(snapshot.error);
        setLoading(false);
      });
    });

    return () => {
      unsubscribeCollection?.();
      unsubscribeAuth();
    };
  }, []);

  return { sales, loading, error };
}
