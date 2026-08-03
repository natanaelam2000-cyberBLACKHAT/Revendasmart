import { useCallback, useEffect, useRef, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  limit,
  onSnapshot,
  orderBy,
  query,
  startAfter,
  type DocumentData,
  type QueryDocumentSnapshot,
} from "firebase/firestore";
import { getFirebaseAuth } from "@/lib/firebase";
import type { Product } from "@/lib/mock-data";
import { readRecentProductIds } from "@/lib/recent-products";

const PRODUCT_PICKER_PAGE_SIZE = 30;

interface ProductPickerData {
  products: Product[];
  loading: boolean;
  loadingMore: boolean;
  error: string;
  preferredProductStatus: "idle" | "loading" | "found" | "missing";
  hasMore: boolean;
  search: string;
  setSearch: (search: string) => void;
  loadMore: () => Promise<void>;
}

interface ProductPickerOptions {
  preferredProductId?: string;
}

function mapProductDoc(doc: QueryDocumentSnapshot<DocumentData>): Product {
  return { ...doc.data(), id: doc.id } as Product;
}

function mergeProducts(current: Product[], incoming: Product[]): Product[] {
  const byId = new Map<string, Product>();
  for (const product of current) byId.set(product.id, product);
  for (const product of incoming) {
    if (product?.id) byId.set(product.id, product);
  }
  return Array.from(byId.values()).sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
}

async function loadRecentProductDocs(uid: string, currentProducts: Product[], preferredProductId = ""): Promise<Product[]> {
  const existingIds = new Set(currentProducts.map((product) => product.id));
  const recentIds = Array.from(new Set([
    preferredProductId.trim(),
    ...readRecentProductIds(),
  ]))
    .filter((productId) => productId && !existingIds.has(productId))
    .slice(0, 4);
  if (recentIds.length === 0) return [];

  const firestore = getFirestore();
  const snapshots = await Promise.all(
    recentIds.map((productId) => getDoc(doc(firestore, "users", uid, "products", productId)).catch(() => null))
  );

  return snapshots
    .filter((snapshot): snapshot is NonNullable<typeof snapshot> => Boolean(snapshot?.exists()))
    .map((snapshot) => ({ ...snapshot.data(), id: snapshot.id } as Product))
    .filter((product) => product?.id);
}

export function useProductPickerData(options: ProductPickerOptions = {}): ProductPickerData {
  const preferredProductId = String(options.preferredProductId || "").trim();
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [preferredProductStatus, setPreferredProductStatus] = useState<"idle" | "loading" | "found" | "missing">(
    preferredProductId ? "loading" : "idle",
  );
  const [hasMore, setHasMore] = useState(false);
  const [search, setSearch] = useState("");
  const uidRef = useRef<string | null>(null);
  const lastVisibleRef = useRef<QueryDocumentSnapshot<DocumentData> | null>(null);
  const supplementalProductsRef = useRef<Product[]>([]);
  const supplementalLookupKeyRef = useRef("");

  useEffect(() => {
    const auth = getFirebaseAuth();
    if (!auth) {
      setLoading(false);
      setError("Firebase não inicializado");
      return;
    }

    let unsubscribeProducts: (() => void) | undefined;
    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      unsubscribeProducts?.();
      lastVisibleRef.current = null;
      supplementalProductsRef.current = [];
      supplementalLookupKeyRef.current = "";

      if (!user) {
        uidRef.current = null;
        setProducts([]);
        setHasMore(false);
        setLoading(false);
        setError("Usuário não autenticado");
        setPreferredProductStatus("idle");
        return;
      }

      uidRef.current = user.uid;
      setLoading(true);
      setError("");
      setPreferredProductStatus(preferredProductId ? "loading" : "idle");

      const firstPageQuery = query(
        collection(getFirestore(), "users", user.uid, "products"),
        orderBy("name"),
        limit(PRODUCT_PICKER_PAGE_SIZE)
      );

      unsubscribeProducts = onSnapshot(
        firstPageQuery,
        (snapshot) => {
          const pageProducts = snapshot.docs.map(mapProductDoc).filter((product) => product?.id);
          lastVisibleRef.current = snapshot.docs[snapshot.docs.length - 1] ?? null;
          const productsWithSupplemental = mergeProducts(pageProducts, supplementalProductsRef.current);
          setProducts(productsWithSupplemental);

          if (preferredProductId && productsWithSupplemental.some((product) => product.id === preferredProductId)) {
            setPreferredProductStatus("found");
          }

          const lookupKey = `${user.uid}:${preferredProductId || "recent"}`;
          if (supplementalLookupKeyRef.current !== lookupKey) {
            supplementalLookupKeyRef.current = lookupKey;
            void loadRecentProductDocs(user.uid, pageProducts, preferredProductId).then((recentProducts) => {
              if (uidRef.current !== user.uid || supplementalLookupKeyRef.current !== lookupKey) return;
              supplementalProductsRef.current = recentProducts;
              if (recentProducts.length > 0) {
                setProducts((current) => mergeProducts(current, recentProducts));
              }
              if (preferredProductId) {
                setPreferredProductStatus(
                  pageProducts.some((product) => product.id === preferredProductId)
                    || recentProducts.some((product) => product.id === preferredProductId)
                    ? "found"
                    : "missing",
                );
              }
            });
          }
          setHasMore(snapshot.docs.length === PRODUCT_PICKER_PAGE_SIZE);
          setError("");
          setLoading(false);
        },
        (err) => {
          console.error("[useProductPickerData] Products error:", err);
          setProducts([]);
          setHasMore(false);
          setError("Erro ao carregar produtos");
          setLoading(false);
        }
      );
    });

    return () => {
      unsubscribeProducts?.();
      unsubscribeAuth();
    };
  }, [preferredProductId]);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || !uidRef.current || !lastVisibleRef.current) return;
    setLoadingMore(true);
    setError("");

    try {
      const nextPageQuery = query(
        collection(getFirestore(), "users", uidRef.current, "products"),
        orderBy("name"),
        startAfter(lastVisibleRef.current),
        limit(PRODUCT_PICKER_PAGE_SIZE)
      );
      const snapshot = await getDocs(nextPageQuery);
      const nextProducts = snapshot.docs.map(mapProductDoc).filter((product) => product?.id);
      lastVisibleRef.current = snapshot.docs[snapshot.docs.length - 1] ?? lastVisibleRef.current;
      setProducts((current) => mergeProducts(current, nextProducts));
      setHasMore(snapshot.docs.length === PRODUCT_PICKER_PAGE_SIZE);
    } catch (err) {
      console.error("[useProductPickerData] Load more error:", err);
      setError("Erro ao carregar mais produtos");
    } finally {
      setLoadingMore(false);
    }
  }, [hasMore, loadingMore]);

  return { products, loading, loadingMore, error, preferredProductStatus, hasMore, search, setSearch, loadMore };
}
