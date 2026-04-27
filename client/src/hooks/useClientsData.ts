import { useEffect, useState } from "react";
import { getFirebaseAuth } from "@/lib/firebase";
import { getFirestore, collection, onSnapshot, setDoc, doc } from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import { Client } from "@/lib/mock-data";

interface ClientsData {
  clients: Client[];
  loading: boolean;
  error?: string;
  addClient: (client: Omit<Client, 'id'>) => Promise<string | null>;
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
    addClient: async () => null
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

    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
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
      const unsubscribeClients = onSnapshot(
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
          await setDoc(doc(firestore, "users", uid, "clients", clientId), {
            ...clientData,
            id: clientId
          });
          console.log("[useClientsData] Client created:", clientId);
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

      setData(prev => ({ ...prev, addClient }));

      return () => {
        unsubscribeClients();
      };
    });

    return () => unsubscribeAuth();
  }, []);

  return data;
}
