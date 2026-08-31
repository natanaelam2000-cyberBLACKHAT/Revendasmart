import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { apiRequest } from "@/lib/api-client";
import { getFirebaseAuth } from "@/lib/firebase";
import type { Product } from "@/lib/mock-data";
import {
  CATALOG_SERVER_SEARCH_ENABLED,
  buildProductServerSearchPlan,
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

type CatalogProductsSearchResponse = {
  items: Product[];
  nextCursor: string | null;
  hasMore: boolean;
};

function getProductSortKey(product: Product): string {
  return getProductSearchIndexField(product as Product & { nameNormalized?: string }, "nameNormalized", product.name);
}

function sortProductsByName(products: Product[]): Product[] {
  return [...products].sort((a, b) => getProductSortKey(a).localeCompare(getProductSortKey(b)) || String(a.id || "").localeCompare(String(b.id || "")));
}

function mergeProducts(current: Product[], incoming: Product[]): Product[] {
  const byId = new Map<string, Product>();
  for (const product of current) byId.set(product.id, product);
  for (const product of incoming) if (product?.id) byId.set(product.id, product);
  return sortProductsByName(Array.from(byId.values()));
}

async function fetchCatalogProducts(
  input: { query?: string; categoryFilter?: string; limit?: number; cursor?: string | null },
  signal?: AbortSignal,
): Promise<CatalogProductsSearchResponse> {
  const params = new URLSearchParams();
  if (typeof input.query === "string" && input.query.trim()) params.set("q", input.query);
  if (typeof input.categoryFilter === "string" && input.categoryFilter.trim()) params.set("category", input.categoryFilter);
  if (typeof input.limit === "number" && Number.isFinite(input.limit)) params.set("limit", String(input.limit));
  if (typeof input.cursor === "string" && input.cursor.trim()) params.set("cursor", input.cursor);

  const response = await apiRequest<CatalogProductsSearchResponse>(`/api/catalog/products${params.size > 0 ? `?${params.toString()}` : ""}`, {
    method: "GET",
    auth: true,
    signal,
  });

  return {
    items: Array.isArray(response?.items) ? response.items : [],
    nextCursor: typeof response?.nextCursor === "string" ? response.nextCursor : null,
    hasMore: response?.hasMore === true,
  };
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
    [searchTerm, serverSearchEnabled],
  );
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
  const nextCursorRef = useRef<string | null>(null);
  const productsRef = useRef<Product[]>([]);

  useEffect(() => {
    productsRef.current = products;
  }, [products]);

  useEffect(() => {
    if (!enabled) {
      nextCursorRef.current = null;
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
    const controller = new AbortController();

    const unsubscribeAuth = onAuthStateChanged(auth, async (user) => {
      nextCursorRef.current = null;

      if (!user) {
        uidRef.current = null;
        setProducts([]);
        setHasMore(false);
        setLoading(false);
        setError("Usuário não autenticado");
        return;
      }

      uidRef.current = user.uid;
      if (productsRef.current.length === 0) setLoading(true);
      setError("");

      try {
        const snapshot = await fetchCatalogProducts({
          query: searchTerm,
          categoryFilter,
          limit: CATALOG_PAGE_SIZE,
        }, controller.signal);
        if (cancelled || requestId !== requestIdRef.current) return;
        const pageProducts = sortProductsByName(snapshot.items.filter((product) => product?.id));
        nextCursorRef.current = snapshot.nextCursor;
        setProducts(pageProducts);
        setHasMore(snapshot.hasMore === true);
        setError("");
      } catch (err) {
        if (cancelled || requestId !== requestIdRef.current) return;
        console.error("[useCatalogProductsData] Products error:", err);
        if (productsRef.current.length === 0) setProducts([]);
        nextCursorRef.current = null;
        setHasMore(false);
        setError("Erro ao carregar catálogo");
      } finally {
        if (!cancelled && requestId === requestIdRef.current) setLoading(false);
      }
    });

    return () => {
      cancelled = true;
      controller.abort();
      unsubscribeAuth();
    };
  }, [categoryFilter, enabled, plan, refreshKey, searchTerm]);

  const loadMore = useCallback(async () => {
    if (!enabled || loadingMore || !hasMore || !uidRef.current || !nextCursorRef.current) return;
    setLoadingMore(true);
    setError("");
    const requestId = requestIdRef.current;

    try {
      const snapshot = await fetchCatalogProducts({
        query: searchTerm,
        categoryFilter,
        limit: CATALOG_PAGE_SIZE,
        cursor: nextCursorRef.current,
      });
      if (requestId !== requestIdRef.current) return;
      nextCursorRef.current = snapshot.nextCursor;
      setProducts((current) => mergeProducts(current, snapshot.items.filter((product) => product?.id)));
      setHasMore(snapshot.hasMore === true);
    } catch (err) {
      console.error("[useCatalogProductsData] Load more error:", err);
      if (requestId === requestIdRef.current) setError("Erro ao carregar mais produtos");
    } finally {
      if (requestId === requestIdRef.current) setLoadingMore(false);
    }
  }, [categoryFilter, enabled, hasMore, loadingMore, searchTerm]);

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
