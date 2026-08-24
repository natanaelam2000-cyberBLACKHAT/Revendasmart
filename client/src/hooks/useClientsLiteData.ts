import { useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { getFirebaseAuth } from "@/lib/firebase";
import { subscribeSharedUserCollection } from "@/lib/firestore-shared-collection";
import type { Client } from "@/lib/mock-data";

interface ClientsLiteData {
  clients: Client[];
  loading: boolean;
  error?: string;
}

function mapClientDoc(id: string, data: Record<string, unknown>): Client {
  return { ...data, id } as Client;
}

/** RELEASE-QUALITY-02 §1 — ver useProductsData.ts: mesma subscription compartilhada por uid+coleção. */
export function useClientsLiteData(): ClientsLiteData {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  useEffect(() => {
    const auth = getFirebaseAuth();
    if (!auth) {
      setLoading(false);
      setError("Firebase not initialized");
      return;
    }

    let unsubscribeCollection: (() => void) | undefined;
    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      unsubscribeCollection?.();

      if (!user) {
        setClients([]);
        setLoading(false);
        setError("Not authenticated");
        return;
      }

      setLoading(true);
      unsubscribeCollection = subscribeSharedUserCollection("clients", user.uid, mapClientDoc, (snapshot) => {
        setClients(snapshot.data);
        setError(snapshot.error);
        setLoading(false);
      });
    });

    return () => {
      unsubscribeCollection?.();
      unsubscribeAuth();
    };
  }, []);

  return { clients, loading, error };
}
