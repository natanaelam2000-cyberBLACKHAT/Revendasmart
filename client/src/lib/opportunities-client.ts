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

/** Shared history and metrics read, gated by Premium in the caller and on the server. */
export async function fetchOpportunityHistory(): Promise<OpportunityHistoryResponse> {
  return apiRequest<OpportunityHistoryResponse>("/api/opportunities/history", { auth: true });
}

export type { OpportunityActionRecord, OpportunityActionStatus, OpportunityType };

export async function markOpportunityOutcome(fingerprint: string, outcome: "converted" | "no_result",
  resultReference?: OpportunityActionRecord["resultReference"]): Promise<{ action: OpportunityActionRecord }> {
  return apiRequest("/api/opportunities/" + encodeURIComponent(fingerprint) + "/outcome", {
    auth: true, method: "POST", body: { outcome, ...(resultReference ? { resultReference } : {}) },
  });
}

export interface OpportunityLinkedResult {
  type: "sale" | "installment" | "work"; id: string; date: string | null; status: string | null; amount: number | null; href: string | null;
}
export async function fetchOpportunityResult(fingerprint: string): Promise<{ result: OpportunityLinkedResult }> {
  return apiRequest("/api/opportunities/" + encodeURIComponent(fingerprint) + "/result", { auth: true });
}
