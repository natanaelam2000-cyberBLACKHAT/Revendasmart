/**
 * PLAN-IMPL-07A — configuração canônica única da "opportunity engine" determinística: um limiar/janela
 * por tipo de oportunidade, nunca espalhado por React/server files (§9 do ticket). Antes desta ticket,
 * o mesmo conceito de "cliente inativo" tinha 3 declarações independentes do MESMO valor (60 dias:
 * client-activity.ts, client-metrics.ts, dashboard-metrics.ts morto) e "produto parado" tinha 3
 * declarações CONFLITANTES (30 dias em dashboard-metrics.ts morto; 90 dias em report-metrics.ts vivo e
 * em business-insights.ts morto) — auditado antes de qualquer edição desta ticket. Este arquivo é a
 * ÚNICA fonte de verdade daqui pra frente para os NOVOS tipos de oportunidade (engine determinística,
 * client/src/pages/opportunities.tsx + server/opportunity-engine.ts) — nunca reintroduzido em paralelo.
 *
 * client-activity.ts (dashboard "Prioridades" + clients.tsx) continua existindo e usando seu próprio
 * INACTIVE_CLIENT_THRESHOLD_DAYS — mantido EXATAMENTE no mesmo valor (60) e agora reexportado a partir
 * daqui, para que as duas superfícies (Prioridades do dashboard vs. página de Oportunidades) nunca
 * divirjam silenciosamente se alguém mudar um dos dois no futuro. report-metrics.ts (Reports, "Sem
 * giro", 90 dias) é uma métrica RETROSPECTIVA de um domínio diferente (PLAN-IMPL-07B, fora de escopo
 * aqui, ver §57 do ticket) — deliberadamente NÃO consolidada aqui, para não mudar um número já exibido
 * ao usuário fora do escopo desta ticket.
 */
import type { PlanType } from "./monetization";

// ===================================================================================================
// Limiares/janelas — únicos, nomeados, documentados. Nunca um literal solto no meio de uma query/regra.
// ===================================================================================================

/** Mesmo valor de client-activity.ts's INACTIVE_CLIENT_THRESHOLD_DAYS — nunca redeclarado com um
 * número diferente; ver o header deste arquivo. */
export const INACTIVE_CLIENT_THRESHOLD_DAYS = 60;

/** §12 do ticket — nenhum precedente vivo a preservar (report-metrics.ts é um domínio retrospectivo
 * diferente, fora de escopo aqui); escolhido para alinhar com o mesmo "ritmo" de 60 dias do cliente
 * inativo, já que ambos representam "sem atividade comercial há dois meses" sob a mesma ótica de
 * oportunidade acionável. Documentado aqui para nunca precisar ser redescoberto. */
export const STALLED_PRODUCT_THRESHOLD_DAYS = 60;

/** §13 — janela de olhar-à-frente para calcular "capacidade configurada vs. reservada". Bounded por
 * MAX_AVAILABILITY_QUERY_RANGE_DAYS (31, shared/service-availability.ts) — nunca solicitado um horizonte
 * maior que esse limite de segurança/performance já existente. */
export const IDLE_SCHEDULE_WINDOW_DAYS = 14;

/** §13/§25 — abaixo desta fração de minutos configurados (após excluir bloqueios) reservados por
 * Bookings confirmados na janela, o resource é considerado "ocioso" o suficiente para virar uma
 * oportunidade. Fração explícita, nunca uma probabilidade/score fabricado (§8). */
export const IDLE_SCHEDULE_UNDERUSED_RATIO = 0.3;

/** §32 — teto de oportunidades retornadas por request; nunca "todas". */
export const OPPORTUNITY_RESPONSE_LIMIT = 30;

/** §10/§12 — cada query busca uma página um pouco maior que o limite final, porque um filtro adicional
 * em memória (ex.: stock > 0 para stalled_product) pode descartar alguns documentos já buscados — nunca
 * uma segunda passada/nova query, só uma folga na PRIMEIRA página, ainda assim bounded. */
export const OPPORTUNITY_QUERY_PAGE_SIZE = 60;

// ===================================================================================================
// Shape canônico — §5 do ticket, adaptado às necessidades reais do domínio.
// ===================================================================================================

/** §65/§20 — só os tipos com suporte de dados eficiente confirmado (auditoria PLAN-IMPL-07A + a
 * extensão PRODUCT-GROWTH-04, que adicionou "overdue_receivable" reaproveitando o índice composto
 * status+dueDate de installments já existente — nenhum índice novo, nenhum N+1). "repurchase_candidate"
 * continua deliberadamente ausente — ver REPURCHASE_RUNTIME no relatório final de PLAN-IMPL-07A (zero
 * dado de cadência de recompra, reconfirmado sem mudança nesta ticket); nenhuma dessas strings pode ser
 * confundida com um tipo inventado. */
export type OpportunityType = "inactive_client" | "stalled_product" | "idle_schedule" | "overdue_receivable";

/** §8/§25 — só 3 buckets fechados, nunca um score/porcentagem fabricado. */
export type OpportunityPriority = "high" | "medium" | "low";

/** §17 — catálogo fechado de ações; cada uma mapeia para uma rota REAL existente (nunca um CTA morto,
 * §18). Ver ACTION_ROUTE_BY_TYPE em client/src/lib/opportunity-actions.ts para o mapeamento real.
 * "open_billing" (PRODUCT-GROWTH-04) aponta para /billings — a mesma Cobranças/Parcelas que já mostra
 * valor/vencimento e já tem seu próprio botão de lembrete por WhatsApp (billings.tsx's sendWhatsApp),
 * nunca uma segunda tela financeira dentro de Opportunities. */
export type OpportunityActionType = "contact_client" | "open_product" | "open_schedule" | "open_billing";

export interface OpportunityAction {
  readonly type: OpportunityActionType;
  /** Rótulo curto e acionável, ex. "Entrar em contato" — nunca um verbo genérico tipo "Ver mais". */
  readonly label: string;
}

export interface OpportunityEntityReference {
  readonly type: "client" | "product" | "schedule";
  readonly id: string;
  /** §5 — nome legível pelo DONO (nunca enviado para analytics, só renderizado localmente na UI já
   * autorizada a ler esse dado — mesmo dado que clients.tsx/products.tsx já mostram hoje). */
  readonly name: string;
}

/** §5/§7/§26 — shape final de uma oportunidade determinística. `evidence` é sempre fatos limitados
 * (nunca notas/texto livre do tenant) — WHAT é `type`, WHY é `reason`+`evidence`, ACTION é `action`. */
export interface Opportunity {
  /** §26 — estável: `${type}:${entityId}:${RULE_VERSION}`, nunca um UUID aleatório por avaliação. */
  readonly id: string;
  readonly type: OpportunityType;
  readonly priority: OpportunityPriority;
  /** Frase curta, pronta pra UI, construída só a partir de `evidence` (nunca texto livre do tenant). */
  readonly reason: string;
  readonly evidence: Record<string, number | string>;
  readonly action: OpportunityAction;
  readonly entityReference: OpportunityEntityReference;
}

/** §26 — versão da regra embutida no id estável; incrementar só se a REGRA em si mudar de um jeito que
 * mudaria quais entidades qualificam (nunca por causa de uma mudança de copy/UI). */
export const OPPORTUNITY_RULE_VERSION = 1;

export function buildOpportunityId(type: OpportunityType, entityId: string): string {
  return `${type}:${entityId}:v${OPPORTUNITY_RULE_VERSION}`;
}

/** PLAN-IMPL-07B §11/§29/§30 — shape do resumo consumido pela seção estratégica de Relatórios
 * (Premium). Vive aqui (shared, não em server/opportunity-engine.ts) porque tanto o server
 * (report-strategic-summary.ts, que constrói o valor) quanto o client (reports-strategic-summary-
 * client.ts, que só tipa a resposta HTTP) precisam do mesmo tipo — o client nunca importa nada de
 * server/, mesma fronteira já respeitada por `Opportunity` acima. */
export interface OpportunitySummary {
  readonly totalCount: number;
  readonly countsByType: Readonly<Record<OpportunityType, number>>;
  readonly strongest: Opportunity | null;
}

// ===================================================================================================
// Ordenação — §25/§26: comparador explícito e documentado, nunca um score aleatório/oculto.
// ===================================================================================================

const PRIORITY_RANK: Record<OpportunityPriority, number> = { high: 0, medium: 1, low: 2 };

/**
 * §25 — ordenação estável: 1) prioridade (high antes de medium antes de low); 2) `magnitude` (o quanto
 * a condição está "além" do limiar — dias adicionais de inatividade/parada, ou o quanto abaixo do ratio
 * de ociosidade — maior primeiro, mais urgente primeiro); 3) `id` como desempate final ESTÁVEL (nunca
 * a ordem de inserção do array, que pode variar entre chamadas da mesma query). Chamador passa
 * `magnitude` já calculada por oportunidade (nunca recalculada aqui, para o comparador continuar puro
 * e sem acoplamento ao shape de evidence de cada tipo).
 */
export function compareOpportunities(
  a: { readonly id: string; readonly priority: OpportunityPriority; readonly magnitude: number },
  b: { readonly id: string; readonly priority: OpportunityPriority; readonly magnitude: number },
): number {
  const priorityDelta = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
  if (priorityDelta !== 0) return priorityDelta;
  const magnitudeDelta = b.magnitude - a.magnitude;
  if (magnitudeDelta !== 0) return magnitudeDelta;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

// ===================================================================================================
// Plan gating — §20/§21: Premium (incluindo trial, effectivePlan já resolve isso) tem acesso; Free/Pro
// não. Reaproveita o MESMO PlanType de shared/monetization.ts, nunca uma segunda noção de plano.
// ===================================================================================================

/** §21 — o CALLER sempre passa o `effectivePlan` já resolvido (nunca basePlan direto — trial já conta
 * como premium via effectivePlan, autoridade existente de ensurePlanLifecycleCurrent). */
export function hasAdvancedOpportunityAccess(effectivePlan: PlanType): boolean {
  return effectivePlan === "premium";
}
