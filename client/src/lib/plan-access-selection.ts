import { apiRequest } from "./api-client";

/**
 * PLAN-IMPL-02B2 — chamadores finos para os comandos server-authoritative de seleção explícita
 * (server/plan-access-selection.ts). A UI é só apresentação (§7 do ticket): estes wrappers nunca
 * calculam plano/limite localmente, só empacotam a lista final de ids escolhidos e devolvem o que o
 * servidor decidiu de verdade.
 */
export type PlanAccessSelectionResult = {
  readonly total: number;
  readonly active: number;
  readonly preserved: number;
  readonly limit: number;
};

export async function setActiveProductSelection(selectedIds: readonly string[]): Promise<PlanAccessSelectionResult> {
  return await apiRequest<PlanAccessSelectionResult>("/api/plan-access/products/selection", {
    method: "POST",
    auth: true,
    body: { selectedIds },
  });
}

export async function setActiveServiceSelection(selectedIds: readonly string[]): Promise<PlanAccessSelectionResult> {
  return await apiRequest<PlanAccessSelectionResult>("/api/plan-access/services/selection", {
    method: "POST",
    auth: true,
    body: { selectedIds },
  });
}
