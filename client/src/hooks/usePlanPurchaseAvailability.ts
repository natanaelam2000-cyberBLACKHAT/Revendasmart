import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/api-client";
import type { PlanPurchaseAvailability } from "@shared/monetization";

/**
 * PLAN-IMPL-04A §15/§49/§50 — a única fonte de "este plano pode ser comprado agora" no client. Nunca
 * assume disponível em caso de erro (§56/PS6) — `availability: null` enquanto carregando ou se a
 * chamada falhar, e todo consumidor deve tratar `null` como "não comprável ainda", nunca como "livre".
 */
export function usePlanPurchaseAvailability() {
  const [availability, setAvailability] = useState<PlanPurchaseAvailability | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await apiRequest<PlanPurchaseAvailability>("/api/plans/purchase-availability");
        if (!cancelled) setAvailability(data);
      } catch {
        if (!cancelled) setError("Não foi possível verificar a disponibilidade de assinatura agora.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { availability, loading, error };
}
