import { useCallback, useEffect, useRef, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import {
  collection,
  doc,
  getCountFromServer,
  getDocs,
  getFirestore,
  limit,
  onSnapshot,
  orderBy,
  query,
  startAfter,
  updateDoc,
  type DocumentData,
  type QueryDocumentSnapshot,
} from "firebase/firestore";
import { getFirebaseAuth } from "@/lib/firebase";
import type { Client } from "@/lib/mock-data";
import { apiRequest } from "@/lib/api-client";

const CLIENTS_PAGE_SIZE = 30;

interface PaginatedClientsData {
  clients: Client[];
  loading: boolean;
  loadingMore: boolean;
  error?: string;
  hasMore: boolean;
  totalCount: number | null;
  loadMore: () => Promise<void>;
  refresh: () => void;
  addClient: (client: Omit<Client, "id">) => Promise<string | null>;
  updateClient: (id: string, client: Partial<Omit<Client, "id">>) => Promise<boolean>;
  deleteClient: (id: string) => Promise<boolean>;
}

function mapClientDoc(doc: QueryDocumentSnapshot<DocumentData>): Client {
  return { ...doc.data(), id: doc.id } as Client;
}

function sortClientsByName(clients: Client[]): Client[] {
  return [...clients].sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
}

function mergeClients(current: Client[], incoming: Client[]): Client[] {
  const byId = new Map<string, Client>();
  for (const client of current) byId.set(client.id, client);
  for (const client of incoming) {
    if (client?.id) byId.set(client.id, client);
  }
  return sortClientsByName(Array.from(byId.values()));
}

export function usePaginatedClientsData(): PaginatedClientsData {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string>();
  const [hasMore, setHasMore] = useState(false);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const uidRef = useRef<string | null>(null);
  const lastVisibleRef = useRef<QueryDocumentSnapshot<DocumentData> | null>(null);

  const refresh = useCallback(() => {
    setRefreshKey((current) => current + 1);
  }, []);

  useEffect(() => {
    const auth = getFirebaseAuth();
    if (!auth) {
      setLoading(false);
      setError("Firebase not initialized");
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
        setTotalCount(null);
        setLoading(false);
        setError("Not authenticated");
        return;
      }

      uidRef.current = user.uid;
      setLoading(true);
      setError(undefined);
      const firestore = getFirestore();
      const clientsRef = collection(firestore, "users", user.uid, "clients");

      getCountFromServer(clientsRef)
        .then((snapshot) => setTotalCount(snapshot.data().count))
        .catch((err) => {
          console.error("[usePaginatedClientsData] Count error:", err);
          setTotalCount(null);
        });

      const firstPageQuery = query(clientsRef, orderBy("name"), limit(CLIENTS_PAGE_SIZE));
      unsubscribeClients = onSnapshot(
        firstPageQuery,
        (snapshot) => {
          const pageClients = snapshot.docs.map(mapClientDoc).filter((client) => client?.id);
          lastVisibleRef.current = snapshot.docs[snapshot.docs.length - 1] ?? null;
          setClients(pageClients);
          setHasMore(snapshot.docs.length === CLIENTS_PAGE_SIZE);
          setError(undefined);
          setLoading(false);
        },
        (err) => {
          console.error("[usePaginatedClientsData] Clients error:", err);
          setClients([]);
          setHasMore(false);
          setError("Failed to load clients");
          setLoading(false);
        }
      );
    });

    return () => {
      unsubscribeClients?.();
      unsubscribeAuth();
    };
  }, [refreshKey]);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || !uidRef.current || !lastVisibleRef.current) return;
    setLoadingMore(true);
    try {
      const clientsRef = collection(getFirestore(), "users", uidRef.current, "clients");
      const nextPageQuery = query(
        clientsRef,
        orderBy("name"),
        startAfter(lastVisibleRef.current),
        limit(CLIENTS_PAGE_SIZE)
      );
      const snapshot = await getDocs(nextPageQuery);
      const nextClients = snapshot.docs.map(mapClientDoc).filter((client) => client?.id);
      lastVisibleRef.current = snapshot.docs[snapshot.docs.length - 1] ?? lastVisibleRef.current;
      setClients((current) => mergeClients(current, nextClients));
      setHasMore(snapshot.docs.length === CLIENTS_PAGE_SIZE);
      setError(undefined);
    } catch (err) {
      console.error("[usePaginatedClientsData] Load more error:", err);
      setError("Failed to load more clients");
    } finally {
      setLoadingMore(false);
    }
  }, [hasMore, loadingMore]);

  const addClient = useCallback(async (clientData: Omit<Client, "id">) => {
    if (!uidRef.current) return null;
    const clientId = Math.random().toString(36).slice(2, 11);
    try {
      await apiRequest("/api/clients", { method: "POST", auth: true, body: { clientId, idempotencyKey: `client-create-${clientId}`, client: { ...clientData, id: clientId } } });
      setTotalCount((current) => (current === null ? current : current + 1));
      refresh();
      return clientId;
    } catch (err) {
      console.error("[usePaginatedClientsData] Error creating client:", err);
      setError("Failed to create client");
      return null;
    }
  }, [refresh]);

  const updateClient = useCallback(async (id: string, clientData: Partial<Omit<Client, "id">>) => {
    if (!uidRef.current) return false;
    try {
      await updateDoc(doc(getFirestore(), "users", uidRef.current, "clients", id), clientData);
      setClients((current) => sortClientsByName(current.map((client) => client.id === id ? { ...client, ...clientData } : client)));
      return true;
    } catch (err) {
      console.error("[usePaginatedClientsData] Error updating client:", err);
      return false;
    }
  }, []);

  const deleteClient = useCallback(async (id: string) => {
    if (!uidRef.current) return false;
    try {
      await apiRequest(`/api/clients/${encodeURIComponent(id)}`, { method: "DELETE", auth: true });
      setClients((current) => current.filter((client) => client.id !== id));
      setTotalCount((current) => current === null ? current : Math.max(0, current - 1));
      return true;
    } catch (err) {
      console.error("[usePaginatedClientsData] Error deleting client:", err);
      return false;
    }
  }, []);

  return { clients, loading, loadingMore, error, hasMore, totalCount, loadMore, refresh, addClient, updateClient, deleteClient };
}
