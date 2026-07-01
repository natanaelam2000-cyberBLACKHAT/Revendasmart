import { useState, useEffect, useCallback, useRef } from "react";
import { getFirebaseAuth } from "@/lib/firebase";
import { onAuthStateChanged } from "firebase/auth";
import { getFirestore, collection, onSnapshot, query, orderBy, limit, startAfter, getDocs, type DocumentData, type QueryDocumentSnapshot } from "firebase/firestore";
import type { Charge } from "../../../shared/charges";

const CHARGES_PAGE_SIZE = 30;

export interface UseChargesResult {
  charges: Charge[];
  loading: boolean;
  loadingMoreCharges: boolean;
  error: string;
  hasMoreCharges: boolean;
  loadMoreCharges: () => Promise<void>;
}

/**
 * Real-time hook that subscribes to users/{uid}/charges in Firestore.
 * Returns charges sorted by createdAt descending (newest first).
 */
export function useCharges(): UseChargesResult {
  const [charges, setCharges] = useState<Charge[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [loadingMoreCharges, setLoadingMoreCharges] = useState(false);
  const [hasMoreCharges, setHasMoreCharges] = useState(false);
  const uidRef = useRef<string | null>(null);
  const lastChargeDocRef = useRef<QueryDocumentSnapshot<DocumentData> | null>(null);

  useEffect(() => {
    const auth = getFirebaseAuth();
    if (!auth) {
      setLoading(false);
      setError("Firebase não inicializado");
      return;
    }

    let unsubscribeSnapshot: (() => void) | undefined;
    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      unsubscribeSnapshot?.();
      if (!user) {
        uidRef.current = null;
        lastChargeDocRef.current = null;
        setLoading(false);
        setCharges([]);
        setHasMoreCharges(false);
        return;
      }

      uidRef.current = user.uid;
      const db = getFirestore();
      const chargesRef = collection(db, "users", user.uid, "charges");
      const q = query(chargesRef, orderBy("createdAt", "desc"), limit(CHARGES_PAGE_SIZE));

      unsubscribeSnapshot = onSnapshot(
        q,
        (snapshot) => {
          const data = snapshot.docs.map((doc) => ({
            ...doc.data(),
            id: doc.id,
          })) as Charge[];
          lastChargeDocRef.current = snapshot.docs[snapshot.docs.length - 1] ?? null;
          setCharges(data);
          setHasMoreCharges(snapshot.docs.length === CHARGES_PAGE_SIZE);
          setLoading(false);
          setError("");
        },
        (err) => {
          console.error("[useCharges] Firestore error:", err);
          setError("Erro ao carregar cobranças");
          setHasMoreCharges(false);
          setLoading(false);
        }
      );

    });

    return () => { unsubscribeSnapshot?.(); unsubscribeAuth(); };
  }, []);

  const loadMoreCharges = useCallback(async () => {
    if (loadingMoreCharges || !hasMoreCharges || !uidRef.current || !lastChargeDocRef.current) return;
    setLoadingMoreCharges(true);
    try {
      const db = getFirestore();
      const chargesRef = collection(db, "users", uidRef.current, "charges");
      const nextQuery = query(
        chargesRef,
        orderBy("createdAt", "desc"),
        startAfter(lastChargeDocRef.current),
        limit(CHARGES_PAGE_SIZE)
      );
      const snapshot = await getDocs(nextQuery);
      const nextCharges = snapshot.docs.map((doc) => ({ ...doc.data(), id: doc.id })) as Charge[];
      lastChargeDocRef.current = snapshot.docs[snapshot.docs.length - 1] ?? lastChargeDocRef.current;
      setCharges((current) => {
        const byId = new Map<string, Charge>();
        for (const charge of current) byId.set(charge.id, charge);
        for (const charge of nextCharges) byId.set(charge.id, charge);
        return Array.from(byId.values()).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      });
      setHasMoreCharges(snapshot.docs.length === CHARGES_PAGE_SIZE);
      setError("");
    } catch (err) {
      console.error("[useCharges] Load more error:", err);
      setError("Erro ao carregar mais cobranças");
    } finally {
      setLoadingMoreCharges(false);
    }
  }, [hasMoreCharges, loadingMoreCharges]);

  return { charges, loading, loadingMoreCharges, error, hasMoreCharges, loadMoreCharges };
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
