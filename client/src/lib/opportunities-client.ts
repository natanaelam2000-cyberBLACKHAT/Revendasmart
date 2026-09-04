import { apiRequest } from "@/lib/api-client";
import type { Opportunity } from "@shared/opportunity-rules";

export interface OpportunitiesResponse {
  readonly opportunities: Opportunity[];
}

/** PLAN-IMPL-07A §22 — só chama a rota real; entitlement é revalidado no servidor de qualquer forma,
 * mas o caller (opportunities.tsx) só chama isto depois de já saber (via usePlan()) que o tenant tem
 * acesso, para nunca gerar uma chamada/erro 403 previsível no caminho comum de Free/Pro. */
export async function fetchOpportunities(): Promise<OpportunitiesResponse> {
  return apiRequest<OpportunitiesResponse>("/api/opportunities", { auth: true });
}
