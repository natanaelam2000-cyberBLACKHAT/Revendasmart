import { useProductsData } from "./useProductsData";
import { useSalesData } from "./useSalesData";
import { useClientsLiteData } from "./useClientsLiteData";
import type { Product } from "@/lib/mock-data";

interface DashboardData {
  products: Product[];
  sales: any[];
  clients: any[];
  loading: boolean;
  error?: string;
}

/**
 * RELEASE-QUALITY-02 §1 — antes deste fix, este hook abria 3 listeners `onSnapshot` próprios
 * (products/sales/clients), independentes dos que `useProductsData`/`useSalesData`/`useClientsLiteData`
 * já abrem em outras telas (dashboard, catalog, reports...). Como só o `/admin` usa este hook, isso
 * significava 3 listeners inteiramente redundantes sempre que o admin estava aberto. Agora ele só
 * compõe os mesmos hooks compartilhados — se o admin estiver aberto ao mesmo tempo que o dashboard, os
 * dois reaproveitam a MESMA subscription real por baixo (ver `client/src/lib/shared-subscription.ts`).
 */
export function useDashboardData(): DashboardData {
  const { products, loading: productsLoading, error: productsError } = useProductsData();
  const { sales, loading: salesLoading, error: salesError } = useSalesData();
  const { clients, loading: clientsLoading, error: clientsError } = useClientsLiteData();

  return {
    products,
    sales,
    clients,
    loading: productsLoading || salesLoading || clientsLoading,
    error: productsError || salesError || clientsError,
  };
}
