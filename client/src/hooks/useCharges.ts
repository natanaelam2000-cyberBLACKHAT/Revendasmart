import { useState, useEffect } from "react";
import { getFirebaseAuth } from "@/lib/firebase";
import { onAuthStateChanged } from "firebase/auth";
import { getFirestore, collection, onSnapshot, query, orderBy } from "firebase/firestore";
import type { Charge } from "../../../shared/charges";

export interface UseChargesResult {
  charges: Charge[];
  loading: boolean;
  error: string;
}

/**
 * Real-time hook that subscribes to users/{uid}/charges in Firestore.
 * Returns charges sorted by createdAt descending (newest first).
 */
export function useCharges(): UseChargesResult {
  const [charges, setCharges] = useState<Charge[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const auth = getFirebaseAuth();
    if (!auth) {
      setLoading(false);
      setError("Firebase não inicializado");
      return;
    }

    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      if (!user) {
        setLoading(false);
        setCharges([]);
        return;
      }

      const db = getFirestore();
      const chargesRef = collection(db, "users", user.uid, "charges");
      const q = query(chargesRef, orderBy("createdAt", "desc"));

      const unsubscribeSnapshot = onSnapshot(
        q,
        (snapshot) => {
          const data = snapshot.docs.map((doc) => ({
            ...doc.data(),
            id: doc.id,
          })) as Charge[];
          setCharges(data);
          setLoading(false);
          setError("");
        },
        (err) => {
          console.error("[useCharges] Firestore error:", err);
          setError("Erro ao carregar cobranças");
          setLoading(false);
        }
      );

      return () => unsubscribeSnapshot();
    });

    return () => unsubscribeAuth();
  }, []);

  return { charges, loading, error };
}

// ---------------------------------------------------------------------------
// Status helpers for UI rendering
// ---------------------------------------------------------------------------
export const CHARGE_STATUS_LABELS: Record<string, string> = {
  pending:    "Pendente",
  paid:       "Pago",
  in_process: "Em análise",
  authorized: "Autorizado",
  failed:     "Recusado",
  cancelled:  "Cancelado",
  refunded:   "Reembolsado",
  expired:    "Expirado",
  paused:     "Pausado",
};

export const CHARGE_STATUS_COLORS: Record<string, string> = {
  pending:    "bg-orange-100 text-orange-700",
  paid:       "bg-green-100 text-green-700",
  in_process: "bg-blue-100 text-blue-700",
  authorized: "bg-indigo-100 text-indigo-700",
  failed:     "bg-red-100 text-red-700",
  cancelled:  "bg-gray-100 text-gray-600",
  refunded:   "bg-purple-100 text-purple-700",
  expired:    "bg-gray-100 text-gray-500",
  paused:     "bg-yellow-100 text-yellow-700",
};

export const CHARGE_MODE_LABELS: Record<string, string> = {
  one_time:     "Avulso",
  subscription: "Assinatura",
};
