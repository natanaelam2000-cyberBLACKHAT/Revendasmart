import { useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { collection, getFirestore, onSnapshot } from "firebase/firestore";
import { getFirebaseAuth } from "@/lib/firebase";
import type { Product } from "@/lib/mock-data";

interface ProductsData {
  products: Product[];
  loading: boolean;
  error?: string;
}

export function useProductsData(): ProductsData {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  useEffect(() => {
    const auth = getFirebaseAuth();
    if (!auth) {
      setLoading(false);
      setError("Firebase not initialized");
      return;
    }

    let unsubscribeProducts: (() => void) | undefined;
    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      unsubscribeProducts?.();

      if (!user) {
        setProducts([]);
        setLoading(false);
        setError("Not authenticated");
        return;
      }

      setLoading(true);
      unsubscribeProducts = onSnapshot(
        collection(getFirestore(), "users", user.uid, "products"),
        (snapshot) => {
          const data = snapshot.docs
            .map((doc) => ({ ...doc.data(), id: doc.id } as Product))
            .filter((product) => product && typeof product === "object" && product.id);
          setProducts(data);
          setError(undefined);
          setLoading(false);
        },
        (err) => {
          console.error("[useProductsData] Products error:", err);
          setProducts([]);
          setError("Failed to load products");
          setLoading(false);
        }
      );
    });

    return () => {
      unsubscribeProducts?.();
      unsubscribeAuth();
    };
  }, []);

  return { products, loading, error };
}
