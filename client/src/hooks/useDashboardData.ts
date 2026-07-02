import { useEffect, useState } from "react";
import { getFirebaseAuth } from "@/lib/firebase";
import { getFirestore, collection, onSnapshot } from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import { Product } from "@/lib/mock-data";

interface DashboardData {
  products: Product[];
  sales: any[];
  clients: any[];
  loading: boolean;
  error?: string;
}

/**
 * Hook to fetch dashboard data directly from Firestore
 * Reads: users/{uid}/products, users/{uid}/sales, users/{uid}/clients
 * Uses onSnapshot for real-time updates
 */
export function useDashboardData(): DashboardData {
  const [data, setData] = useState<DashboardData>({
    products: [],
    sales: [],
    clients: [],
    loading: true,
  });

  useEffect(() => {
    const auth = getFirebaseAuth();
    if (!auth) {
      setData(prev => ({
        ...prev,
        loading: false,
        error: "Firebase not initialized"
      }));
      return;
    }

    let unsubscribeProducts: (() => void) | undefined;
    let unsubscribeSales: (() => void) | undefined;
    let unsubscribeClients: (() => void) | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      unsubscribeProducts?.(); unsubscribeSales?.(); unsubscribeClients?.();
      if (timer) clearTimeout(timer);
      if (!user) {
        setData(prev => ({
          ...prev,
          products: [],
          sales: [],
          clients: [],
          loading: false,
          error: "Not authenticated"
        }));
        return;
      }

      const firestore = getFirestore();
      const uid = user.uid;

      // Subscribe to products
      unsubscribeProducts = onSnapshot(
        collection(firestore, "users", uid, "products"),
        (snapshot) => {
          const prods = snapshot.docs.map(doc => ({
            ...doc.data(),
            id: doc.id
          } as Product));
          setData(prev => ({ ...prev, products: prods }));
        },
        (err) => {
          console.error("[useDashboardData] Products error:", err);
          setData(prev => ({ ...prev, error: "Failed to load products" }));
        }
      );

      // Subscribe to sales
      unsubscribeSales = onSnapshot(
        collection(firestore, "users", uid, "sales"),
        (snapshot) => {
          const salesData = snapshot.docs.map(d => d.data());
          setData(prev => ({ ...prev, sales: salesData }));
        },
        (err) => {
          console.error("[useDashboardData] Sales error:", err);
        }
      );

      // Subscribe to clients
      unsubscribeClients = onSnapshot(
        collection(firestore, "users", uid, "clients"),
        (snapshot) => {
          const clientsData = snapshot.docs.map(d => d.data());
          setData(prev => ({ ...prev, clients: clientsData }));
        },
        (err) => {
          console.error("[useDashboardData] Clients error:", err);
        }
      );

      // Set loading to false once first batch loaded
      timer = setTimeout(() => {
        setData(prev => ({ ...prev, loading: false }));
      }, 500);

      // Debug logging

    });

    return () => {
      if (timer) clearTimeout(timer);
      unsubscribeProducts?.(); unsubscribeSales?.(); unsubscribeClients?.(); unsubscribeAuth();
    };
  }, []);

  return data;
}
