import { useCallback, useEffect, useState } from "react";
import { collection, getCountFromServer, getFirestore, query, where } from "firebase/firestore";
import { getFirebaseAuth } from "@/lib/firebase";
import { usePlanData } from "@/hooks/usePlanData";
import { buildPlanUsageSnapshot, type PlanUsageSnapshot } from "@shared/monetization";

/**
 * PLAN-IMPL-02B2 §31 — total via `getCountFromServer` puro, preservados via a MESMA aggregate query com
 * `where("planAccessState","==","preserved")` (nunca `!=`, que excluiria documentos legados sem o campo —
 * o oposto do que backward-compat exige). `active = total - preserved` é aritmética local, não uma
 * terceira leitura. Nenhum scan de coleção inteira: só 2 números por domínio, iguais ao que
 * reconcilePlanAccess já resume no lado servidor.
 */
async function fetchDomainAccessCounts(uid: string, domain: "products" | "services"): Promise<{ active: number; preserved: number }> {
  const base = collection(getFirestore(), "users", uid, domain);
  const [totalSnap, preservedSnap] = await Promise.all([
    getCountFromServer(base),
    getCountFromServer(query(base, where("planAccessState", "==", "preserved"))),
  ]);
  const total = totalSnap.data().count;
  const preserved = preservedSnap.data().count;
  return { active: Math.max(0, total - preserved), preserved };
}

export function usePlanUsageSnapshot() {
  const { activePlan, loading: planLoading } = usePlanData();
  const [snapshot, setSnapshot] = useState<PlanUsageSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const uid = getFirebaseAuth()?.currentUser?.uid;
    if (!uid) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const [products, services, clientsSnap] = await Promise.all([
        fetchDomainAccessCounts(uid, "products"),
        fetchDomainAccessCounts(uid, "services"),
        getCountFromServer(collection(getFirestore(), "users", uid, "clients")),
      ]);
      setSnapshot(buildPlanUsageSnapshot(activePlan, { products, clients: clientsSnap.data().count, services }));
    } catch (err) {
      console.error("[usePlanUsageSnapshot] load error:", err);
      setError("Não foi possível carregar o uso do seu plano.");
    } finally {
      setLoading(false);
    }
  }, [activePlan]);

  useEffect(() => {
    if (planLoading) return;
    load();
  }, [planLoading, load]);

  return { snapshot, loading: loading || planLoading, error, refresh: load, activePlan };
}
