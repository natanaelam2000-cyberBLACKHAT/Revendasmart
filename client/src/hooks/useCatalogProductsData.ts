import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import {
  collection,
  endAt,
  getDocs,
  getFirestore,
  limit,
  orderBy,
  query,
  startAfter,
  startAt,
  where,
  type DocumentData,
  type QueryConstraint,
  type QueryDocumentSnapshot,
} from "firebase/firestore";
import { getFirebaseAuth } from "@/lib/firebase";
import type { Product } from "@/lib/mock-data";
import {
  CATALOG_SERVER_SEARCH_ENABLED,
  type ProductServerSearchPlan,
  buildProductServerSearchPlan,
  buildProductServerSearchQuerySpec,
  getProductSearchIndexField,
  normalizeProductSearchText,
} from "@/lib/product-search";

const CATALOG_PAGE_SIZE = 30;

interface UseCatalogProductsOptions {
  searchTerm?: string;
  categoryFilter?: string;
  serverSearchEnabled?: boolean;
  enabled?: boolean;
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

function getProductSortKey(product: Product): string {
  return getProductSearchIndexField(product as Product & { nameNormalized?: string }, "nameNormalized", product.name);
}

function sortProductsByName(products: Product[]): Product[] {
  return [...products].sort((a, b) => getProductSortKey(a).localeCompare(getProductSortKey(b)) || String(a.id || "").localeCompare(String(b.id || "")));
}

function mergeProducts(current: Product[], incoming: Product[]): Product[] {
  const byId = new Map<string, Product>();
  for (const product of current) byId.set(product.id, product);
  for (const product of incoming) {
    if (product?.id) byId.set(product.id, product);
  }
  return sortProductsByName(Array.from(byId.values()));
}

function buildCatalogQuery(
  uid: string,
  options: { plan: ProductServerSearchPlan; querySpec: ReturnType<typeof buildProductServerSearchQuerySpec> },
  cursor?: QueryDocumentSnapshot<DocumentData> | null
) {
  const constraints: QueryConstraint[] = [];
  const { plan, querySpec } = options;

  if (querySpec.hasCategoryFilter) {
    constraints.push(where("categoryNormalized", "==", querySpec.normalizedCategoryFilter));
  }

  if (plan.kind === "barcode_exact") {
    constraints.push(where("barcodeNormalized", "==", plan.normalizedTerm));
  } else if (plan.kind === "token") {
    constraints.push(where("searchTokens", "array-contains", plan.searchToken));
  }

  constraints.push(orderBy(querySpec.orderByField));

  if (plan.kind === "name_prefix") {
    constraints.push(startAt(plan.normalizedTerm));
    constraints.push(endAt(`${plan.normalizedTerm}\uf8ff`));
  }

  if (cursor) constraints.push(startAfter(cursor));
  constraints.push(limit(Math.min(plan.pageSize, CATALOG_PAGE_SIZE)));

  return query(collection(getFirestore(), "users", uid, "products"), ...constraints);
}

export function useCatalogProductsData(options: UseCatalogProductsOptions = {}): CatalogProductsData {
  const {
    searchTerm = "",
    categoryFilter = "todos",
    serverSearchEnabled = CATALOG_SERVER_SEARCH_ENABLED,
    enabled = true,
  } = options;

  const normalizedSearch = useMemo(() => normalizeProductSearchText(searchTerm), [searchTerm]);
  const plan = useMemo(
    () => buildProductServerSearchPlan({ term: searchTerm, pageSize: CATALOG_PAGE_SIZE, serverSearchEnabled }),
    [searchTerm, serverSearchEnabled]
  );
  const querySpec = useMemo(() => buildProductServerSearchQuerySpec({ plan, categoryFilter }), [categoryFilter, plan]);
  const serverSearchActive = enabled && plan.source === "server" && plan.kind !== "empty";
  const searchFallbackRequired = enabled && normalizedSearch.length > 0 && plan.source === "local_fallback";

  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [hasMore, setHasMore] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const requestIdRef = useRef(0);
  const uidRef = useRef<string | null>(null);
  const lastVisibleRef = useRef<QueryDocumentSnapshot<DocumentData> | null>(null);

  useEffect(() => {
    if (!enabled) {
      lastVisibleRef.current = null;
      uidRef.current = null;
      setProducts([]);
      setHasMore(false);
      setLoading(false);
      setError("");
      return;
    }

    const auth = getFirebaseAuth();
    if (!auth) {
      setLoading(false);
      setError("Firebase não inicializado");
      return;
    }

    let cancelled = false;
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;

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
        setError("Busca server-side desligada ou termo curto. Use o fallback local já carregado pela tela atual.");
        return;
      }

      try {
        const snapshot = await getDocs(buildCatalogQuery(user.uid, { plan, querySpec }));
        if (cancelled || requestId !== requestIdRef.current) return;
        const pageProducts = sortProductsByName(snapshot.docs.map(mapProductDoc).filter((product) => product?.id));
        lastVisibleRef.current = snapshot.docs[snapshot.docs.length - 1] ?? null;
        setProducts(pageProducts);
        setHasMore(snapshot.docs.length === Math.min(plan.pageSize, CATALOG_PAGE_SIZE));
        setError("");
      } catch (err) {
        if (cancelled || requestId !== requestIdRef.current) return;
        console.error("[useCatalogProductsData] Products error:", err);
        setProducts([]);
        setHasMore(false);
        setError("Erro ao carregar catálogo");
      } finally {
        if (!cancelled && requestId === requestIdRef.current) setLoading(false);
      }
    });

    return () => {
      cancelled = true;
      unsubscribeAuth();
    };
  }, [enabled, querySpec, refreshKey, searchFallbackRequired, plan]);

  const loadMore = useCallback(async () => {
    if (!enabled || loadingMore || !hasMore || !uidRef.current || !lastVisibleRef.current || searchFallbackRequired) return;
    setLoadingMore(true);
    setError("");
    const requestId = requestIdRef.current;

    try {
      const snapshot = await getDocs(
        buildCatalogQuery(uidRef.current, { plan, querySpec }, lastVisibleRef.current)
      );
      if (requestId !== requestIdRef.current) return;
      const nextProducts = snapshot.docs.map(mapProductDoc).filter((product) => product?.id);
      lastVisibleRef.current = snapshot.docs[snapshot.docs.length - 1] ?? lastVisibleRef.current;
      setProducts((current) => mergeProducts(current, nextProducts));
      setHasMore(snapshot.docs.length === Math.min(plan.pageSize, CATALOG_PAGE_SIZE));
    } catch (err) {
      console.error("[useCatalogProductsData] Load more error:", err);
      setError("Erro ao carregar mais produtos");
    } finally {
      setLoadingMore(false);
    }
  }, [enabled, hasMore, loadingMore, querySpec, searchFallbackRequired, plan]);

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
