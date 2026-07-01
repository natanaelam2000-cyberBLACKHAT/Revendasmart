import { useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { collection, getFirestore, onSnapshot } from "firebase/firestore";
import { getFirebaseAuth } from "@/lib/firebase";
import type { Client } from "@/lib/mock-data";

interface ClientsLiteData {
  clients: Client[];
  loading: boolean;
  error?: string;
}

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

    let unsubscribeClients: (() => void) | undefined;
    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      unsubscribeClients?.();

      if (!user) {
        setClients([]);
        setLoading(false);
        setError("Not authenticated");
        return;
      }

      setLoading(true);
      unsubscribeClients = onSnapshot(
        collection(getFirestore(), "users", user.uid, "clients"),
        (snapshot) => {
          const data = snapshot.docs.map((doc) => ({ ...doc.data(), id: doc.id } as Client));
          setClients(data);
          setError(undefined);
          setLoading(false);
        },
        (err) => {
          console.error("[useClientsLiteData] Clients error:", err);
          setClients([]);
          setError("Failed to load clients");
          setLoading(false);
        }
      );
    });

    return () => {
      unsubscribeClients?.();
      unsubscribeAuth();
    };
  }, []);

  return { clients, loading, error };
}
