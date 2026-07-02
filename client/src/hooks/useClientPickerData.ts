import { useCallback, useEffect, useRef, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import {
  collection,
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
import type { Client } from "@/lib/mock-data";

const CLIENT_PICKER_PAGE_SIZE = 30;

interface ClientPickerData {
  clients: Client[];
  loading: boolean;
  loadingMore: boolean;
  error: string;
  hasMore: boolean;
  search: string;
  setSearch: (search: string) => void;
  loadMore: () => Promise<void>;
}

function mapClientDoc(doc: QueryDocumentSnapshot<DocumentData>): Client {
  return { ...doc.data(), id: doc.id } as Client;
}

function mergeClients(current: Client[], incoming: Client[]): Client[] {
  const byId = new Map<string, Client>();
  for (const client of current) byId.set(client.id, client);
  for (const client of incoming) {
    if (client?.id) byId.set(client.id, client);
  }
  return Array.from(byId.values()).sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
}

export function useClientPickerData(): ClientPickerData {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [hasMore, setHasMore] = useState(false);
  const [search, setSearch] = useState("");
  const uidRef = useRef<string | null>(null);
  const lastVisibleRef = useRef<QueryDocumentSnapshot<DocumentData> | null>(null);

  useEffect(() => {
    const auth = getFirebaseAuth();
    if (!auth) {
      setLoading(false);
      setError("Firebase não inicializado");
      return;
    }

    let unsubscribeClients: (() => void) | undefined;
    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      unsubscribeClients?.();
      lastVisibleRef.current = null;

      if (!user) {
        uidRef.current = null;
        setClients([]);
        setHasMore(false);
        setLoading(false);
        setError("Usuário não autenticado");
        return;
      }

      uidRef.current = user.uid;
      setLoading(true);
      setError("");

      const firstPageQuery = query(
        collection(getFirestore(), "users", user.uid, "clients"),
        orderBy("name"),
        limit(CLIENT_PICKER_PAGE_SIZE)
      );

      unsubscribeClients = onSnapshot(
        firstPageQuery,
        (snapshot) => {
          const pageClients = snapshot.docs.map(mapClientDoc).filter((client) => client?.id);
          lastVisibleRef.current = snapshot.docs[snapshot.docs.length - 1] ?? null;
          setClients(pageClients);
          setHasMore(snapshot.docs.length === CLIENT_PICKER_PAGE_SIZE);
          setError("");
          setLoading(false);
        },
        (err) => {
          console.error("[useClientPickerData] Clients error:", err);
          setClients([]);
          setHasMore(false);
          setError("Erro ao carregar clientes");
          setLoading(false);
        }
      );
    });

    return () => {
      unsubscribeClients?.();
      unsubscribeAuth();
    };
  }, []);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || !uidRef.current || !lastVisibleRef.current) return;
    setLoadingMore(true);
    setError("");

    try {
      const nextPageQuery = query(
        collection(getFirestore(), "users", uidRef.current, "clients"),
        orderBy("name"),
        startAfter(lastVisibleRef.current),
        limit(CLIENT_PICKER_PAGE_SIZE)
      );
      const snapshot = await getDocs(nextPageQuery);
      const nextClients = snapshot.docs.map(mapClientDoc).filter((client) => client?.id);
      lastVisibleRef.current = snapshot.docs[snapshot.docs.length - 1] ?? lastVisibleRef.current;
      setClients((current) => mergeClients(current, nextClients));
      setHasMore(snapshot.docs.length === CLIENT_PICKER_PAGE_SIZE);
    } catch (err) {
      console.error("[useClientPickerData] Load more error:", err);
      setError("Erro ao carregar mais clientes");
    } finally {
      setLoadingMore(false);
    }
  }, [hasMore, loadingMore]);

  return { clients, loading, loadingMore, error, hasMore, search, setSearch, loadMore };
}
