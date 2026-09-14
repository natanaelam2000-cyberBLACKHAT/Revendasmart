import { apiRequest } from "@/lib/api-client";
import type { Opportunity, OpportunityActionRecord, OpportunityActionStatus, OpportunityType } from "@shared/opportunity-rules";

export interface OpportunitiesResponse {
  readonly opportunities: Opportunity[];
}

/** PLAN-IMPL-07A §22 — só chama a rota real; entitlement é revalidado no servidor de qualquer forma,
 * mas o caller (opportunities.tsx) só chama isto depois de já saber (via usePlan()) que o tenant tem
 * acesso, para nunca gerar uma chamada/erro 403 previsível no caminho comum de Free/Pro. */
export async function fetchOpportunities(): Promise<OpportunitiesResponse> {
  return apiRequest<OpportunitiesResponse>("/api/opportunities", { auth: true });
}

/** PRODUCT-GROWTH-05 §2/§9 — marca uma oportunidade como "acted"/"dismissed". `title`/`reason` são o
 * MESMO texto que a oportunidade já mostrava nesta resposta (nunca recalculado aqui) — usado pelo
 * servidor só como retrato para o Histórico (§5), nunca como autoridade sobre o que está ativo. */
export async function markOpportunityAction(
  fingerprint: string,
  status: OpportunityActionStatus,
  opportunity: Pick<Opportunity, "type" | "reason"> & { title: string },
): Promise<{ action: OpportunityActionRecord }> {
  return apiRequest<{ action: OpportunityActionRecord }>(`/api/opportunities/${encodeURIComponent(fingerprint)}/action`, {
    auth: true,
    method: "POST",
    body: { status, type: opportunity.type, title: opportunity.title, reason: opportunity.reason },
  });
}

export interface OpportunityHistoryResponse {
  readonly items: OpportunityActionRecord[];
}

/** PRODUCT-GROWTH-05 §5 — só chamado quando a aba Histórico é aberta (nunca junto com a lista ativa por
 * padrão), mesmo espírito de §22 do 07A: nenhuma chamada previsível a mais no caminho comum. */
export async function fetchOpportunityHistory(): Promise<OpportunityHistoryResponse> {
  return apiRequest<OpportunityHistoryResponse>("/api/opportunities/history", { auth: true });
}

export type { OpportunityActionRecord, OpportunityActionStatus, OpportunityType };
