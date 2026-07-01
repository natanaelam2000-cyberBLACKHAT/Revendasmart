import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { collection, getFirestore, limit, onSnapshot, orderBy, query, where } from "firebase/firestore";
import { getFirebaseAuth } from "@/lib/firebase";
import type { Sale } from "@/lib/mock-data";

const MONTHLY_SALES_LIMIT = 100;

interface MonthlySalesData {
  sales: Sale[];
  loading: boolean;
  error?: string;
}

interface MonthlySalesRange {
  startIso: string;
  endIso: string;
}

function createMonthlySalesRange(month: number, year: number): MonthlySalesRange {
  const safeMonth = Number.isInteger(month) && month >= 0 && month <= 11 ? month : new Date().getMonth();
  const safeYear = Number.isInteger(year) && year >= 2000 && year <= 2100 ? year : new Date().getFullYear();
  const start = new Date(safeYear, safeMonth, 1);
  const end = new Date(safeYear, safeMonth + 1, 1);
  return {
    startIso: start.toISOString(),
    endIso: end.toISOString(),
  };
}

export function useMonthlySalesData(month: number, year: number): MonthlySalesData {
  const [sales, setSales] = useState<Sale[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const range = useMemo(() => createMonthlySalesRange(month, year), [month, year]);

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
      const salesQuery = query(
        collection(getFirestore(), "users", user.uid, "sales"),
        where("date", ">=", range.startIso),
        where("date", "<", range.endIso),
        orderBy("date", "desc"),
        limit(MONTHLY_SALES_LIMIT)
      );

      unsubscribeSales = onSnapshot(
        salesQuery,
        (snapshot) => {
          const data = snapshot.docs
            .map((doc) => ({ ...doc.data(), id: doc.id } as Sale))
            .filter((sale) => typeof sale.date === "string" && sale.date.trim().length > 0);
          setSales(data);
          setError(undefined);
          setLoading(false);
        },
        (err) => {
          console.error("[useMonthlySalesData] Sales error:", err);
          setSales([]);
          setError("Failed to load monthly sales");
          setLoading(false);
        }
      );
    });

    return () => {
      unsubscribeSales?.();
      unsubscribeAuth();
    };
  }, [range.endIso, range.startIso]);

  return { sales, loading, error };
}
