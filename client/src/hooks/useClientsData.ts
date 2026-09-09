import { useEffect, useState } from "react";
import { getFirebaseAuth } from "@/lib/firebase";
import { getFirestore, collection, onSnapshot, doc, updateDoc, deleteDoc } from "firebase/firestore";
import { apiRequest } from "@/lib/api-client";
import { onAuthStateChanged } from "firebase/auth";
import { Client } from "@/lib/mock-data";

interface ClientsData {
  clients: Client[];
  loading: boolean;
  error?: string;
  addClient: (client: Omit<Client, 'id'>) => Promise<string | null>;
  updateClient: (id: string, client: Partial<Omit<Client, 'id'>>) => Promise<boolean>;
  deleteClient: (id: string) => Promise<boolean>;
}

/**
 * Hook to manage clients data directly from Firestore
 * Reads: users/{uid}/clients
 * Writes: users/{uid}/clients/{clientId}
 */
export function useClientsData(): ClientsData {
  const [data, setData] = useState<ClientsData>({
    clients: [],
    loading: true,
    addClient: async () => null,
    updateClient: async () => false,
    deleteClient: async () => false
  });

  useEffect(() => {
    const auth = getFirebaseAuth();
    if (!auth) {
      setData(prev => ({
        ...prev,
        loading: false,
        error: "Firebase not initialized"
      }));
      return;
    }

    let unsubscribeClients: (() => void) | undefined;
    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      unsubscribeClients?.();
      if (!user) {
        setData(prev => ({
          ...prev,
          clients: [],
          loading: false,
          error: "Not authenticated"
        }));
        return;
      }

      const firestore = getFirestore();
      const uid = user.uid;

      // Subscribe to clients collection
      unsubscribeClients = onSnapshot(
        collection(firestore, "users", uid, "clients"),
        (snapshot) => {
          const clientsData = snapshot.docs.map(d => ({
            ...d.data(),
            id: d.id
          } as Client));
          setData(prev => ({
            ...prev,
            clients: clientsData,
            loading: false
          }));
        },
        (err) => {
          console.error("[useClientsData] Error loading clients:", err);
          setData(prev => ({
            ...prev,
            loading: false,
            error: "Failed to load clients"
          }));
        }
      );

      // Define addClient function
      const addClient = async (clientData: Omit<Client, 'id'>) => {
        const clientId = Math.random().toString(36).substr(2, 9);
        try {
          await apiRequest("/api/clients", { method: "POST", auth: true, body: { clientId, idempotencyKey: `client-create-${clientId}`, client: { ...clientData, id: clientId } } });
          return clientId;
        } catch (err) {
          console.error("[useClientsData] Error creating client:", err);
          setData(prev => ({
            ...prev,
            error: "Failed to create client"
          }));
          return null;
        }
      };

      const updateClient = async (id: string, clientData: Partial<Omit<Client, 'id'>>) => {
        try { await updateDoc(doc(firestore, "users", uid, "clients", id), clientData); return true; }
        catch (err) { console.error("[useClientsData] Error updating client:", err); return false; }
      };
      const deleteClient = async (id: string) => {
        try { await deleteDoc(doc(firestore, "users", uid, "clients", id)); return true; }
        catch (err) { console.error("[useClientsData] Error deleting client:", err); return false; }
      };

      setData(prev => ({ ...prev, addClient, updateClient, deleteClient }));

    });

    return () => { unsubscribeClients?.(); unsubscribeAuth(); };
  }, []);

  return data;
}
