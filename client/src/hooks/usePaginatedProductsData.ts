import { useCallback, useEffect, useRef, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import {
  collection,
  doc,
  getCountFromServer,
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
import { canCompleteAutoLoad, compareProductsForBrowsing, createGenerationController, createInFlightLock, type GenerationController, type InFlightLock, type ProductPageStatus } from "@/lib/product-availability";

const PRODUCTS_PAGE_SIZE = 30;
export const PRODUCTS_AUTOLOAD_THRESHOLD = 500;

interface PaginatedProductsData {
  products: Product[];
  loading: boolean;
  loadingMore: boolean;
  error: string;
  hasMore: boolean;
  loadMore: () => Promise<void>;
  refresh: () => void;
  totalCount: number | null;
}

type PageResult =
  | { status: "loaded"; hasMore: true }
  | { status: "finished" }
  | { status: "error" }
  | { status: "stale" };

function mapProductDoc(doc: QueryDocumentSnapshot<DocumentData>): Product {
  return { ...doc.data(), id: doc.id } as Product;
}

function mergeProducts(current: Product[], incoming: Product[]): Product[] {
  const byId = new Map<string, Product>();
  for (const product of current) byId.set(product.id, product);
  for (const product of incoming) if (product?.id) byId.set(product.id, product);
  return Array.from(byId.values()).sort(compareProductsForBrowsing);
}

async function loadRecentProductDocs(uid: string, currentProducts: Product[]): Promise<Product[]> {
  const existingIds = new Set(currentProducts.map((product) => product.id));
  const recentIds = readRecentProductIds().filter((productId) => !existingIds.has(productId)).slice(0, 3);
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

export function usePaginatedProductsData(): PaginatedProductsData {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [hasMore, setHasMore] = useState(false);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const uidRef = useRef<string | null>(null);
  const lastVisibleRef = useRef<QueryDocumentSnapshot<DocumentData> | null>(null);
  const generationRef = useRef<GenerationController>(createGenerationController());
  const inFlightRef = useRef<InFlightLock>(createInFlightLock());
  const autoLoadDoneRef = useRef(false);
  const countGenerationRef = useRef<GenerationController>(createGenerationController());
  const mountedRef = useRef(false);
  const listenerTokenRef = useRef(0);

  const resetCycle = useCallback(() => {
    generationRef.current.invalidate();
    lastVisibleRef.current = null;
    inFlightRef.current.release();
    autoLoadDoneRef.current = false;
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    const auth = getFirebaseAuth();
    if (!auth) {
      setLoading(false);
      setError("Firebase não inicializado");
      return;
    }

    let unsubscribeProducts: (() => void) | undefined;
    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      if (!mountedRef.current) return;
      const listenerToken = ++listenerTokenRef.current;
      unsubscribeProducts?.();
      resetCycle();
      countGenerationRef.current.invalidate();
      setProducts([]);
      setTotalCount(null);
      setHasMore(false);
      setLoadingMore(false);
      setError("");

      if (!user) {
        uidRef.current = null;
        setLoading(false);
        setError("Usuário não autenticado");
        return;
      }

      uidRef.current = user.uid;
      const expectedUid = user.uid;
      let expectedCycle = generationRef.current.current();
      const countGeneration = countGenerationRef.current.current();
      setLoading(true);
      const firestore = getFirestore();
      getCountFromServer(collection(firestore, "users", user.uid, "products"))
        .then((snapshot) => {
          if (countGenerationRef.current.isCurrent(countGeneration) && uidRef.current === user.uid) {
            setTotalCount(snapshot.data().count);
          }
        })
        .catch(() => {
          if (countGenerationRef.current.isCurrent(countGeneration) && uidRef.current === user.uid) setTotalCount(null);
        });

      const firstPageQuery = query(collection(firestore, "users", user.uid, "products"), orderBy("name"), limit(PRODUCTS_PAGE_SIZE));
      unsubscribeProducts = onSnapshot(
        firstPageQuery,
        (snapshot) => {
          if (!mountedRef.current || listenerTokenRef.current !== listenerToken || uidRef.current !== expectedUid || !generationRef.current.isCurrent(expectedCycle)) return;
          const cycle = resetCycleAndGetGeneration(resetCycle, generationRef.current);
          expectedCycle = generationRef.current.current();
          const pageProducts = snapshot.docs.map(mapProductDoc).filter((product) => product?.id);
          lastVisibleRef.current = snapshot.docs[snapshot.docs.length - 1] ?? null;
          setProducts(pageProducts);
          setHasMore(snapshot.docs.length === PRODUCTS_PAGE_SIZE);
          setLoadingMore(false);
          setError("");
          setLoading(false);
          void loadRecentProductDocs(user.uid, pageProducts).then((recentProducts) => {
            if (!generationRef.current.isCurrent(cycle) || uidRef.current !== user.uid) return;
            if (recentProducts.length > 0) setProducts((current) => mergeProducts(current, recentProducts));
          });
        },
        (err) => {
          if (!mountedRef.current || listenerTokenRef.current !== listenerToken || uidRef.current !== expectedUid || !generationRef.current.isCurrent(expectedCycle)) return;
          console.error("[usePaginatedProductsData] Products error:", err);
          resetCycle();
          setProducts([]);
          setHasMore(false);
          setError("Erro ao carregar produtos do servidor");
          setLoading(false);
        }
      );
    });

    return () => {
      mountedRef.current = false;
      listenerTokenRef.current += 1;
      resetCycle();
      countGenerationRef.current.invalidate();
      unsubscribeProducts?.();
      unsubscribeAuth();
    };
  }, [refreshKey, resetCycle]);

  const fetchNextPage = useCallback(async (cycle: number): Promise<PageResult> => {
    if (!generationRef.current.isCurrent(cycle) || !uidRef.current || !lastVisibleRef.current) return { status: "stale" };
    if (!inFlightRef.current.tryAcquire()) return { status: "stale" };
    const uid = uidRef.current;
    const cursor = lastVisibleRef.current;
    try {
      const snapshot = await getDocs(query(
        collection(getFirestore(), "users", uid, "products"),
        orderBy("name"),
        startAfter(cursor),
        limit(PRODUCTS_PAGE_SIZE)
      ));
      if (!generationRef.current.isCurrent(cycle) || uidRef.current !== uid) return { status: "stale" };
      const nextProducts = snapshot.docs.map(mapProductDoc).filter((product) => product?.id);
      lastVisibleRef.current = snapshot.docs[snapshot.docs.length - 1] ?? cursor;
      const moreAvailable = snapshot.docs.length === PRODUCTS_PAGE_SIZE;
      setProducts((current) => mergeProducts(current, nextProducts));
      setHasMore(moreAvailable);
      return moreAvailable ? { status: "loaded", hasMore: true } : { status: "finished" };
    } catch (err) {
      console.error("[usePaginatedProductsData] Load more error:", err);
      if (generationRef.current.isCurrent(cycle) && uidRef.current === uid) setError("Erro ao carregar mais produtos");
      return generationRef.current.isCurrent(cycle) ? { status: "error" } : { status: "stale" };
    } finally {
      if (generationRef.current.isCurrent(cycle)) inFlightRef.current.release();
    }
  }, []);

  const loadMore = useCallback(async () => {
    const cycle = generationRef.current.current();
    if (!hasMore || inFlightRef.current.isLocked()) return;
    setLoadingMore(true);
    setError("");
    try {
      await fetchNextPage(cycle);
    } finally {
      if (generationRef.current.isCurrent(cycle)) setLoadingMore(false);
    }
  }, [fetchNextPage, hasMore]);

  useEffect(() => {
    if (totalCount == null || totalCount <= 0 || totalCount > PRODUCTS_AUTOLOAD_THRESHOLD) return;
    if (loading || !hasMore || autoLoadDoneRef.current || inFlightRef.current.isLocked()) return;
    const cycle = generationRef.current.current();
    let cancelled = false;
    void (async () => {
      setLoadingMore(true);
      let finished = false;
      try {
        while (!cancelled && generationRef.current.isCurrent(cycle)) {
          const result = await fetchNextPage(cycle);
          if (canCompleteAutoLoad(result.status as ProductPageStatus)) { finished = true; break; }
          if (result.status === "error" || result.status === "stale") break;
          if (result.status !== "loaded" || !result.hasMore) { finished = true; break; }
        }
        if (finished && !cancelled && generationRef.current.isCurrent(cycle)) autoLoadDoneRef.current = true;
      } finally {
        if (!cancelled && generationRef.current.isCurrent(cycle)) setLoadingMore(false);
      }
    })();
    return () => { cancelled = true; };
  }, [totalCount, hasMore, loading, fetchNextPage]);

  const refresh = useCallback(() => {
    resetCycle();
    countGenerationRef.current.invalidate();
    uidRef.current = null;
    setProducts([]);
    setTotalCount(null);
    setHasMore(false);
    setLoadingMore(false);
    setError("");
    setLoading(true);
    setRefreshKey((current) => current + 1);
  }, [resetCycle]);

  return { products, loading, loadingMore, error, hasMore, loadMore, refresh, totalCount };
}

function resetCycleAndGetGeneration(resetCycle: () => void, controller: GenerationController): number {
  resetCycle();
  return controller.current();
}
