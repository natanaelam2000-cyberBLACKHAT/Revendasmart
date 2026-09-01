import { useCallback, useEffect, useState } from "react";
import { listServices } from "@/lib/services-persistence";
import type { Service } from "@shared/services";

/** PLAN-IMPL-02B2 §18 — Services tem no máximo 200 (Premium), então `listServices()` (já busca a
 * coleção inteira, sem paginação — services-persistence.ts) é suficiente e é a mesma função já usada pela
 * Agenda; nenhuma segunda implementação de fetch. */
export function useServiceAccessList() {
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setServices(await listServices());
    } catch (err) {
      console.error("[useServiceAccessList] load error:", err);
      setError("Não foi possível carregar seus serviços.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return { services, loading, error, refresh: load };
}
