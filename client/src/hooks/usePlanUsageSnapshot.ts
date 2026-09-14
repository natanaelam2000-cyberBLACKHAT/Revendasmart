import { useCallback, useEffect, useState } from "react";
import { collection, getCountFromServer, getFirestore, query, where } from "firebase/firestore";
import { waitForAuthReady } from "@/lib/firebase";
import { usePlanData } from "@/hooks/usePlanData";
import { buildPlanUsageSnapshot, type PlanUsageSnapshot } from "@shared/monetization";
import { getCurrentMonthBookingUsage } from "@/lib/booking-quota";
import { getCurrentMonthPreparationUsage } from "@/lib/ads-pro-preparation-quota";

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
  const { activePlan, basePlan, trial, loading: planLoading } = usePlanData();
  const [snapshot, setSnapshot] = useState<PlanUsageSnapshot | null>(null);
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
      const [products, services, clientsSnap, bookingsCurrentMonth, adsProPreparationsCurrentMonth] = await Promise.all([
        fetchDomainAccessCounts(uid, "products"),
        fetchDomainAccessCounts(uid, "services"),
        getCountFromServer(collection(getFirestore(), "users", uid, "clients")),
        // PLAN-IMPL-02C §45/§46 — o doc mensal é server-only (firestore.rules), então isto é sempre uma
        // chamada HTTP (server/booking-quota.ts), nunca uma leitura Firestore direta como as 3 acima.
        getCurrentMonthBookingUsage(),
        // PLAN-IMPL-05 §31 — mesmo motivo: server/ads-pro-preparation-quota.ts, server-only.
        getCurrentMonthPreparationUsage(),
      ]);
      setSnapshot(buildPlanUsageSnapshot(activePlan, {
        products, clients: clientsSnap.data().count, services,
        bookingsCurrentMonth: { used: bookingsCurrentMonth.used, monthKey: bookingsCurrentMonth.monthKey },
        adsProPreparationsCurrentMonth: { used: adsProPreparationsCurrentMonth.used, monthKey: adsProPreparationsCurrentMonth.monthKey },
      }));
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

  return { snapshot, loading: loading || planLoading, error, refresh: load, activePlan, basePlan, trial };
}
