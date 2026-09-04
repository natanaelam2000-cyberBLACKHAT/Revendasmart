/**
 * PLAN-IMPL-07A §17/§18 — catálogo fechado de ações + roteamento determinístico. Cada ação mapeia para
 * uma rota REAL já existente (nunca inventada) — nenhum CTA morto. `client_id`/`product_id` nunca
 * aparecem em analytics (ver client/src/pages/opportunities.tsx), só aqui, para montar a URL local.
 */
import type { OpportunityActionType, OpportunityEntityReference } from "@shared/opportunity-rules";

export function resolveOpportunityActionRoute(actionType: OpportunityActionType, entity: OpportunityEntityReference): string {
  switch (actionType) {
    case "contact_client":
      // §17/§18 — rota real de detalhe do cliente já existente (client/src/pages/client-detail.tsx),
      // onde telefone/WhatsApp do cliente já são exibidos/acionáveis pelo dono — nenhuma nova UI de
      // contato precisa existir aqui.
      return `/clients/${encodeURIComponent(entity.id)}`;
    case "open_product":
      // §19 — abre o produto real para edição (ex.: preparar com Ads Pro, ajustar preço/estoque); a
      // ação NUNCA exige geração de IA por si só, só chega até o fluxo determinístico já existente.
      return `/edit-product/${encodeURIComponent(entity.id)}`;
    case "open_schedule":
      return "/servicos/disponibilidade";
    default: {
      const exhaustiveCheck: never = actionType;
      throw new Error(`Unhandled opportunity action type: ${String(exhaustiveCheck)}`);
    }
  }
}
