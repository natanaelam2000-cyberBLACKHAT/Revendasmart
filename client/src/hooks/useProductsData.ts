import { useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { getFirebaseAuth } from "@/lib/firebase";
import { subscribeSharedUserCollection } from "@/lib/firestore-shared-collection";
import type { Product } from "@/lib/mock-data";

interface ProductsData {
  products: Product[];
  loading: boolean;
  error?: string;
}

function mapProductDoc(id: string, data: Record<string, unknown>): Product {
  return { ...data, id } as Product;
}

/**
 * RELEASE-QUALITY-02 §1 — a leitura real (`onSnapshot`) agora é compartilhada via
 * `subscribeSharedUserCollection`: outra tela lendo "products" para o mesmo uid ao mesmo tempo (ex.:
 * dashboard + catalog + reports) reaproveita o mesmo listener em vez de abrir um novo. A API pública
 * deste hook (shape do retorno, semântica de loading/error) não muda — nenhum consumer precisa mudar.
 */
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

    let unsubscribeCollection: (() => void) | undefined;
    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      unsubscribeCollection?.();

      if (!user) {
        setProducts([]);
        setLoading(false);
        setError("Not authenticated");
        return;
      }

      setLoading(true);
      unsubscribeCollection = subscribeSharedUserCollection("products", user.uid, mapProductDoc, (snapshot) => {
        const filtered = snapshot.data.filter((product) => product && typeof product === "object" && product.id);
        setProducts(filtered);
        setError(snapshot.error);
        setLoading(false);
      });
    });

    return () => {
      unsubscribeCollection?.();
      unsubscribeAuth();
    };
  }, []);

  return { products, loading, error };
}
