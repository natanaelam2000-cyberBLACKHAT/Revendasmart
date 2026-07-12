import { useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { collection, doc, documentId, getDocs, getFirestore, onSnapshot, query, where } from "firebase/firestore";
import { getFirebaseAuth } from "@/lib/firebase";
import type { Client, Product, Sale } from "@/lib/mock-data";

interface ClientDetailData {
  client: Client | null;
  sales: Sale[];
  products: Product[];
  loading: boolean;
  error?: string;
}

const PRODUCT_LOOKUP_BATCH_SIZE = 10;

function collectSoldProductIds(sales: Sale[]): string[] {
  const ids = new Set<string>();
  for (const sale of sales) {
    for (const product of sale.products || []) {
      if (product.productId) ids.add(product.productId);
    }
  }
  return Array.from(ids);
}

async function fetchProductsByIds(uid: string, productIds: string[]): Promise<Product[]> {
  if (productIds.length === 0) return [];

  const db = getFirestore();
  const batches: string[][] = [];
  for (let index = 0; index < productIds.length; index += PRODUCT_LOOKUP_BATCH_SIZE) {
    batches.push(productIds.slice(index, index + PRODUCT_LOOKUP_BATCH_SIZE));
  }

  const snapshots = await Promise.all(
    batches.map((batch) =>
      getDocs(
        query(
          collection(db, "users", uid, "products"),
          where(documentId(), "in", batch)
        )
      )
    )
  );

  return snapshots
    .flatMap((snapshot) => snapshot.docs.map((doc) => ({ ...doc.data(), id: doc.id } as Product)))
    .filter((product) => product && typeof product === "object" && product.id);
}

export function useClientDetailData(clientId?: string): ClientDetailData {
  const [client, setClient] = useState<Client | null>(null);
  const [sales, setSales] = useState<Sale[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [clientLoading, setClientLoading] = useState(Boolean(clientId));
  const [salesLoading, setSalesLoading] = useState(Boolean(clientId));
  const [productsLoading, setProductsLoading] = useState(Boolean(clientId));
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!clientId) {
      setClient(null);
      setSales([]);
      setProducts([]);
      setClientLoading(false);
      setSalesLoading(false);
      setProductsLoading(false);
      setError(undefined);
      return;
    }

    const auth = getFirebaseAuth();
    if (!auth) {
      setClient(null);
      setSales([]);
      setProducts([]);
      setClientLoading(false);
      setSalesLoading(false);
      setProductsLoading(false);
      setError("Firebase not initialized");
      return;
    }

    setClientLoading(true);
    setSalesLoading(true);
    setProductsLoading(true);
    setError(undefined);

    let unsubscribeClient: (() => void) | undefined;
    let unsubscribeSales: (() => void) | undefined;
    let cancelled = false;
    let activeUid = "";
    let productLookupVersion = 0;

    const loadReferencedProducts = async (uid: string, clientSales: Sale[]) => {
      const lookupVersion = ++productLookupVersion;
      const productIds = collectSoldProductIds(clientSales);

      if (productIds.length === 0) {
        if (!cancelled && lookupVersion === productLookupVersion && uid === activeUid) {
          setProducts([]);
          setProductsLoading(false);
        }
        return;
      }

      setProductsLoading(true);
      try {
        const referencedProducts = await fetchProductsByIds(uid, productIds);
        if (!cancelled && lookupVersion === productLookupVersion && uid === activeUid) {
          setProducts(referencedProducts);
        }
      } catch (err) {
        console.error("[useClientDetailData] Products error:", err);
        if (!cancelled && lookupVersion === productLookupVersion && uid === activeUid) {
          setProducts([]);
        }
      } finally {
        if (!cancelled && lookupVersion === productLookupVersion && uid === activeUid) {
          setProductsLoading(false);
        }
      }
    };

    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      unsubscribeClient?.();
      unsubscribeSales?.();

      if (!user) {
        activeUid = "";
        setClient(null);
        setSales([]);
        setProducts([]);
        setClientLoading(false);
        setSalesLoading(false);
        setProductsLoading(false);
        setError("Not authenticated");
        return;
      }

      activeUid = user.uid;
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
          void loadReferencedProducts(user.uid, data);
          setError(undefined);
          setSalesLoading(false);
        },
        (err) => {
          console.error("[useClientDetailData] Sales error:", err);
          setSales([]);
          setProducts([]);
          setError("Failed to load client sales");
          setSalesLoading(false);
          setProductsLoading(false);
        }
      );
    });

    return () => {
      cancelled = true;
      unsubscribeClient?.();
      unsubscribeSales?.();
      unsubscribeAuth();
    };
  }, [clientId]);

  return { client, sales, products, loading: clientLoading || salesLoading || productsLoading, error };
}
