import { useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { collection, getFirestore, onSnapshot } from "firebase/firestore";
import { getFirebaseAuth } from "@/lib/firebase";
import type { Sale } from "@/lib/mock-data";

interface SalesData {
  sales: Sale[];
  loading: boolean;
  error?: string;
}

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

    let unsubscribeSales: (() => void) | undefined;
    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      unsubscribeSales?.();

      if (!user) {
        setSales([]);
        setLoading(false);
        setError("Not authenticated");
        return;
      }

      setLoading(true);
      unsubscribeSales = onSnapshot(
        collection(getFirestore(), "users", user.uid, "sales"),
        (snapshot) => {
          const data = snapshot.docs.map((doc) => ({ ...doc.data(), id: doc.id } as Sale));
          setSales(data);
          setError(undefined);
          setLoading(false);
        },
        (err) => {
          console.error("[useSalesData] Sales error:", err);
          setSales([]);
          setError("Failed to load sales");
          setLoading(false);
        }
      );
    });

    return () => {
      unsubscribeSales?.();
      unsubscribeAuth();
    };
  }, []);

  return { sales, loading, error };
}
