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

export type ProductsDataOptions = { enabled?: boolean };

export function productsDataStateForEnabled(enabled: boolean): ProductsData {
  return enabled ? { products: [], loading: true, error: undefined } : { products: [], loading: false, error: undefined };
}

export function shouldSubscribeToProducts(enabled: boolean): boolean {
  return enabled;
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
export function useProductsData(options: ProductsDataOptions = {}): ProductsData {
  const enabled = options.enabled !== false;
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  const [previousEnabled, setPreviousEnabled] = useState(enabled);
  const enabling = enabled && !previousEnabled;
  if (previousEnabled !== enabled) {
    setPreviousEnabled(enabled);
    setProducts([]);
    setLoading(enabled);
    setError(undefined);
  }

  useEffect(() => {
    if (!shouldSubscribeToProducts(enabled)) {
      setProducts([]);
      setLoading(false);
      setError(undefined);
      return;
    }
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
  }, [enabled]);

  return { products: enabled && !enabling ? products : [], loading: enabled && (enabling || loading), error: enabled && !enabling ? error : undefined };
}
