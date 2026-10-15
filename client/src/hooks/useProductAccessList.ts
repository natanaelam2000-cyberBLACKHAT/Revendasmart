import { useCallback, useEffect, useRef, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import {
  collection,
  documentId,
  getDocs,
  getFirestore,
  limit as fsLimit,
  orderBy,
  query,
  startAfter,
  type DocumentData,
  type Query,
  type QueryDocumentSnapshot,
} from "firebase/firestore";
import { getCurrentFirebaseUser, getFirebaseAuth, waitForAuthReady } from "@/lib/firebase";
import type { Product } from "@/lib/mock-data";

const FETCH_BATCH_SIZE = 300;

/**
 * PLAN-IMPL-02B2 §5/§23 — o gerenciador de itens ativos precisa do conjunto COMPLETO de produtos do
 * tenant para calcular contadores/checkboxes corretamente (uma seleção final precisa saber quem já está
 * ativo mesmo fora da página atualmente renderizada) — mas nunca de um único `.get()` sem limite: mesmo
 * padrão de paginação em loop já usado no servidor (fetchAllDocs, server/plan-access-reconciliation.ts) e
 * no catálogo público (loadPublicCatalogPresentationInputs, server/routes.ts). Quem evita renderizar
 * milhares de cards de imagem de uma vez é o componente (janela local sobre este array já carregado), não
 * este fetch.
 */
async function fetchAllProducts(uid: string): Promise<Product[]> {
  const results: Product[] = [];
  let lastDoc: QueryDocumentSnapshot<DocumentData> | null = null;
  do {
    const base = collection(getFirestore(), "users", uid, "products");
    const pageQuery: Query<DocumentData> = lastDoc
      ? query(base, orderBy(documentId()), startAfter(lastDoc), fsLimit(FETCH_BATCH_SIZE))
      : query(base, orderBy(documentId()), fsLimit(FETCH_BATCH_SIZE));
    const snapshot = await getDocs(pageQuery);
    for (const docSnap of snapshot.docs) results.push({ ...docSnap.data(), id: docSnap.id } as Product);
    lastDoc = snapshot.docs.length === FETCH_BATCH_SIZE ? snapshot.docs[snapshot.docs.length - 1] : null;
  } while (lastDoc);
  return results;
}

export function useProductAccessList() {
  const [products, setProducts] = useState<Product[]>([]);
  const [productsUid, setProductsUid] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const mounted = useRef(false);

  const load = useCallback(async () => {
    const request = ++generation.current;
    const current = () => mounted.current && request === generation.current;
    if (!mounted.current) return;
    setProducts([]);
    setLoading(true);
    setError("");
    // RELEASE-AUTOMATION-01 — waits for Firebase Auth's initial state instead of a synchronous
    // `currentUser` read, which is null on a fresh page load before the persisted session restores.
    const uid = (await waitForAuthReady())?.uid;
    if (!current()) return;
    if (!uid) {
      setProducts([]);
      setLoading(false);
      return;
    }
    try {
      const nextProducts = await fetchAllProducts(uid);
      if (!current() || getCurrentFirebaseUser()?.uid !== uid) return;
      setProductsUid(uid);
      setProducts(nextProducts);
    } catch (err) {
      if (!current() || getCurrentFirebaseUser()?.uid !== uid) return;
      console.error("[useProductAccessList] load error:", err);
      setError("Não foi possível carregar seus produtos.");
    } finally {
      if (current() && getCurrentFirebaseUser()?.uid === uid) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    const auth = getFirebaseAuth();
    let observedUid: string | null | undefined;
    const unsubscribe = auth ? onAuthStateChanged(auth, (user) => {
      const uid = user?.uid ?? null;
      if (uid === observedUid) return;
      observedUid = uid;
      void load();
    }) : undefined;
    if (!auth) void load();
    return () => {
      mounted.current = false;
      generation.current++;
      unsubscribe?.();
    };
  }, [load]);

  const currentUid = getCurrentFirebaseUser()?.uid ?? null;
  const ownsProducts = productsUid === currentUid;
  return { products: ownsProducts ? products : [], loading, error, refresh: load };
}
