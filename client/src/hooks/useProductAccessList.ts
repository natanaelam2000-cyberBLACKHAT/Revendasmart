import { useCallback, useEffect, useState } from "react";
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
import { waitForAuthReady } from "@/lib/firebase";
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    // RELEASE-AUTOMATION-01 — waits for Firebase Auth's initial state instead of a synchronous
    // `currentUser` read, which is null on a fresh page load before the persisted session restores.
    const uid = (await waitForAuthReady())?.uid;
    if (!uid) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      setProducts(await fetchAllProducts(uid));
    } catch (err) {
      console.error("[useProductAccessList] load error:", err);
      setError("Não foi possível carregar seus produtos.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return { products, loading, error, refresh: load };
}
