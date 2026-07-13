import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import {
  collection,
  getDocs,
  getFirestore,
  limit,
  orderBy,
  query,
  startAfter,
  where,
  type DocumentData,
  type QueryConstraint,
  type QueryDocumentSnapshot,
} from "firebase/firestore";
import { getFirebaseAuth } from "@/lib/firebase";
import type { Product } from "@/lib/mock-data";
import {
  CATALOG_SERVER_SEARCH_ENABLED,
  canUseCatalogServerSearch,
  getPrimaryProductSearchToken,
  normalizeProductSearchText,
} from "@/lib/product-search";

const CATALOG_PAGE_SIZE = 30;

interface UseCatalogProductsOptions {
  searchTerm?: string;
  categoryFilter?: string;
  serverSearchEnabled?: boolean;
}

interface CatalogProductsData {
  products: Product[];
  loading: boolean;
  loadingMore: boolean;
  error: string;
  hasMore: boolean;
  serverSearchActive: boolean;
  searchFallbackRequired: boolean;
  loadMore: () => Promise<void>;
  refresh: () => void;
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

function buildCatalogQuery(
  uid: string,
  options: { searchToken: string; categoryFilter: string; serverSearchActive: boolean },
  cursor?: QueryDocumentSnapshot<DocumentData> | null
) {
  const constraints: QueryConstraint[] = [];

  if (options.serverSearchActive && options.searchToken) {
    constraints.push(where("searchTokens", "array-contains", options.searchToken));
  }

  if (options.categoryFilter && options.categoryFilter !== "todos") {
    constraints.push(where("category", "==", options.categoryFilter));
  }

  constraints.push(orderBy("name"));
  if (cursor) constraints.push(startAfter(cursor));
  constraints.push(limit(CATALOG_PAGE_SIZE));

  return query(collection(getFirestore(), "users", uid, "products"), ...constraints);
}

export function useCatalogProductsData(options: UseCatalogProductsOptions = {}): CatalogProductsData {
  const {
    searchTerm = "",
    categoryFilter = "todos",
    serverSearchEnabled = CATALOG_SERVER_SEARCH_ENABLED,
  } = options;

  const normalizedSearch = useMemo(() => normalizeProductSearchText(searchTerm), [searchTerm]);
  const searchToken = useMemo(() => getPrimaryProductSearchToken(searchTerm), [searchTerm]);
  const serverSearchActive = serverSearchEnabled && canUseCatalogServerSearch(searchTerm);
  const searchFallbackRequired = normalizedSearch.length > 0 && !serverSearchActive;

  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [hasMore, setHasMore] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const uidRef = useRef<string | null>(null);
  const lastVisibleRef = useRef<QueryDocumentSnapshot<DocumentData> | null>(null);

  useEffect(() => {
    const auth = getFirebaseAuth();
    if (!auth) {
      setLoading(false);
      setError("Firebase não inicializado");
      return;
    }

    let cancelled = false;

    const unsubscribeAuth = onAuthStateChanged(auth, async (user) => {
      lastVisibleRef.current = null;

      if (!user) {
        uidRef.current = null;
        setProducts([]);
        setHasMore(false);
        setLoading(false);
        setError("Usuário não autenticado");
        return;
      }

      uidRef.current = user.uid;
      setLoading(true);
      setError("");

      if (searchFallbackRequired) {
        setProducts([]);
        setHasMore(false);
        setLoading(false);
        setError("Busca server-side ainda não ativada para produtos legados. Use o catálogo atual com fallback local.");
        return;
      }

      try {
        const snapshot = await getDocs(buildCatalogQuery(user.uid, { searchToken, categoryFilter, serverSearchActive }));
        if (cancelled) return;
        const pageProducts = snapshot.docs.map(mapProductDoc).filter((product) => product?.id);
        lastVisibleRef.current = snapshot.docs[snapshot.docs.length - 1] ?? null;
        setProducts(pageProducts);
        setHasMore(snapshot.docs.length === CATALOG_PAGE_SIZE);
        setError("");
      } catch (err) {
        if (cancelled) return;
        console.error("[useCatalogProductsData] Products error:", err);
        setProducts([]);
        setHasMore(false);
        setError("Erro ao carregar catálogo");
      } finally {
        if (!cancelled) setLoading(false);
      }
    });

    return () => {
      cancelled = true;
      unsubscribeAuth();
    };
  }, [categoryFilter, refreshKey, searchFallbackRequired, searchToken, serverSearchActive]);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || !uidRef.current || !lastVisibleRef.current || searchFallbackRequired) return;
    setLoadingMore(true);
    setError("");

    try {
      const snapshot = await getDocs(
        buildCatalogQuery(uidRef.current, { searchToken, categoryFilter, serverSearchActive }, lastVisibleRef.current)
      );
      const nextProducts = snapshot.docs.map(mapProductDoc).filter((product) => product?.id);
      lastVisibleRef.current = snapshot.docs[snapshot.docs.length - 1] ?? lastVisibleRef.current;
      setProducts((current) => mergeProducts(current, nextProducts));
      setHasMore(snapshot.docs.length === CATALOG_PAGE_SIZE);
    } catch (err) {
      console.error("[useCatalogProductsData] Load more error:", err);
      setError("Erro ao carregar mais produtos");
    } finally {
      setLoadingMore(false);
    }
  }, [categoryFilter, hasMore, loadingMore, searchFallbackRequired, searchToken, serverSearchActive]);

  const refresh = useCallback(() => {
    setRefreshKey((current) => current + 1);
  }, []);

  return {
    products,
    loading,
    loadingMore,
    error,
    hasMore,
    serverSearchActive,
    searchFallbackRequired,
    loadMore,
    refresh,
  };
}
