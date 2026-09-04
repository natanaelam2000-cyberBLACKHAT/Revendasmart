import { apiRequest } from "@/lib/api-client";
import type { OpportunitySummary } from "@shared/opportunity-rules";

export type { OpportunitySummary };

/** PLAN-IMPL-07B §22 — só chama a rota real; entitlement é revalidado no servidor de qualquer forma,
 * mas o caller (reports.tsx) só chama isto depois de já saber (via usePlan()) que o tenant tem acesso,
 * mesmo padrão de opportunities-client.ts. */
export async function fetchStrategicSummary(): Promise<OpportunitySummary> {
  return apiRequest<OpportunitySummary>("/api/reports/strategic-summary", { auth: true });
}
