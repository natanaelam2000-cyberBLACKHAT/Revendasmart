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

/** PRODUCT-GROWTH-05 §11 — teto de UMA leitura em lote de users/{uid}/opportunity_actions por request
 * (nunca uma leitura por fingerprint candidato — ver loadOpportunityActionState em
 * server/opportunity-engine.ts). Essa coleção só cresce por ação EXPLÍCITA do usuário (marcar
 * feito/dispensar), nunca por carregamento de página — na prática, muito menor que este teto para a
 * grande maioria dos tenants; generoso o bastante para nunca truncar um histórico real de uso normal,
 * ainda assim bounded. Ordenado por updatedAt desc (ver o mesmo arquivo), então um truncamento
 * hipotético perde as ações MAIS ANTIGAS primeiro, nunca as mais recentes. */
export const OPPORTUNITY_ACTION_STATE_QUERY_LIMIT = 500;

// ===================================================================================================
// Shape canônico — §5 do ticket, adaptado às necessidades reais do domínio.
// ===================================================================================================

/** Deterministic opportunity kinds; repeat_purchase uses cadence and stock_risk uses recent sell-through coverage. */
export type OpportunityType = "inactive_client" | "stalled_product" | "idle_schedule" | "overdue_receivable" | "repeat_purchase" | "stock_risk";

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
  /** §26 — estável: `${type}:${entityId}:${RULE_VERSION}`, nunca um UUID aleatório por avaliação.
   * Identidade da oportunidade COMO COMPUTADA nesta resposta (React key, data-testid) — não usar para
   * persistência de lifecycle (PRODUCT-GROWTH-05): ver `fingerprint` abaixo. */
  readonly id: string;
  /** PRODUCT-GROWTH-05 §6 — identidade estável do CICLO da condição de negócio subjacente, usada como
   * chave de persistência em users/{uid}/opportunity_actions (mark-acted/dismiss/history). Diferente de
   * `id`: `id` é estável por type+entidade PARA SEMPRE (nunca muda, mesmo entre ciclos diferentes da
   * mesma condição); `fingerprint` inclui uma "cycle key" derivada de um campo mutável da própria fonte
   * de dados (ex. lastPurchaseAt/lastSoldDate) quando a condição pode genuinamente se repetir — ver
   * buildOpportunityFingerprint. Para overdue_receivable (condição de disparo único por parcela, nunca
   * reabre depois de resolvida) `fingerprint === id` sem sufixo de ciclo — ver comentário na função. */
  readonly fingerprint: string;
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

/**
 * PRODUCT-GROWTH-05 §6/§7 — fingerprint determinístico para persistência de lifecycle. `cycleKey`,
 * quando fornecida, é sempre um campo já existente e mantido pela própria fonte de dados (nunca um
 * timestamp de avaliação/agora, que mudaria a cada request e nunca deixaria uma ação persistir) —
 * `lastPurchaseAt`/`lastSoldDate` para inactive_client/stalled_product (ambos escritos
 * transacionalmente só quando uma venda real acontece, nunca em toda avaliação), um bucket de janela
 * derivado de IDLE_SCHEDULE_WINDOW_DAYS para idle_schedule (não existe um campo mutável natural por
 * "entidade" — o resource é sempre "default" — então o próprio período de 14 dias já usado pelo
 * detector vira o ciclo: dispensar/marcar feito vale para O PERÍODO atual, nunca para sempre). Omitir
 * `cycleKey` (overdue_receivable) produz o mesmo valor de `buildOpportunityId` sem o sufixo de versão —
 * correto, porque uma parcela é uma condição de disparo único por natureza (nunca "reabre" depois de
 * paga; um parcelamento novo é sempre um installmentId novo, nunca o mesmo documento reaparecendo).
 */
export function buildOpportunityFingerprint(type: OpportunityType, entityId: string, cycleKey?: string | number): string {
  return cycleKey === undefined ? `${type}:${entityId}` : `${type}:${entityId}:${cycleKey}`;
}

// ===================================================================================================
// Lifecycle (PRODUCT-GROWTH-05) — estado de interação do usuário sobre uma oportunidade, persistido
// separadamente do cálculo determinístico em si (§2 do ticket: "a oportunidade em si continua computada
// a partir dos dados-fonte; persiste-se só o estado de interação do usuário", nunca uma segunda cópia
// do payload inteiro). Vive aqui porque tanto o server (opportunity-engine.ts, que lê/escreve o
// Firestore) quanto o client (opportunities-client.ts, que só tipa a resposta HTTP) precisam do mesmo
// shape — mesma fronteira já respeitada por `Opportunity`/`OpportunitySummary` acima.
// ===================================================================================================

/** §2 — só 2 estados terminais fechados, nunca um workflow com mais etapas do que o pedido precisa. */
export type OpportunityActionStatus = "acted" | "dismissed";

/** §2/§5 — um registro de ação persistido. `title`/`reasonSnapshot` são um retrato do texto exibido NO
 * MOMENTO da ação (nunca recalculado depois) — só assim o Histórico continua útil mesmo se a condição de
 * origem já tiver sido resolvida/apagada (§5: "se o dado de origem não estiver mais disponível, mostre
 * um resumo histórico honesto"). Isto NÃO é uma segunda fonte de verdade de negócio: nenhum valor
 * financeiro/quantidade é persistido aqui além do que já está embutido no texto de `reasonSnapshot`
 * (mesmo texto que `reason` já mostrava, nunca um novo cálculo). */
export interface OpportunityActionRecord {
  readonly fingerprint: string;
  readonly opportunityType: OpportunityType;
  readonly status: OpportunityActionStatus;
  readonly title: string;
  readonly reasonSnapshot: string;
  readonly outcome?: "converted" | "no_result";
  readonly outcomeAt?: string;
  readonly resultReference?: { type: "sale" | "installment" | "work"; id: string };
  readonly actedAt: string | null;
  readonly dismissedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** §2 — tamanho máximo de `title`/`reasonSnapshot` aceito pelo endpoint de ação; texto de exibição
 * inerte (nunca executado, nunca usado em decisão de autorização/valor financeiro — a query real
 * continua sendo a única autoridade sobre o que está ativo), mas limitado mesmo assim contra um payload
 * abusivo. */
export const OPPORTUNITY_ACTION_SNAPSHOT_MAX_LENGTH = 240;

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
 * §25 — ordenação estável: 1) prioridade (high antes de medium antes de low); 2) PRODUCT-GROWTH-11 §1/§6
 * — desempate por efetividade histórica do TIPO (nunca da oportunidade individual), só entre dois tipos
 * DIFERENTES que já tenham amostra suficiente (`eligible`, ambos os lados — §6: "se apenas um dos dois
 * tipos possuir amostra suficiente, NÃO assumir automaticamente que ele é melhor") e só quando as taxas
 * realmente diferem; 3) `magnitude` (o quanto a condição está "além" do limiar — dias adicionais de
 * inatividade/parada, ou o quanto abaixo do ratio de ociosidade — maior primeiro, mais urgente primeiro);
 * 4) `id` como desempate final ESTÁVEL (nunca a ordem de inserção do array, que pode variar entre
 * chamadas da mesma query). Chamador passa `magnitude` já calculada por oportunidade (nunca recalculada
 * aqui, para o comparador continuar puro e sem acoplamento ao shape de evidence de cada tipo).
 *
 * `effectivenessByType` é opcional e, quando omitido (chamador antigo, ou nenhum histórico disponível
 * ainda), o comparador se comporta EXATAMENTE como antes desta ticket — nunca uma segunda função de
 * ordenação paralela (§10 do ticket: dashboard e /opportunities usam este MESMO comparador, nunca um
 * próprio). Nenhum peso escondido/multiplicador: o desempate é só "taxa de conversão maior primeiro",
 * nada além disso.
 */
export function compareOpportunities(
  a: { readonly id: string; readonly type: OpportunityType; readonly priority: OpportunityPriority; readonly magnitude: number },
  b: { readonly id: string; readonly type: OpportunityType; readonly priority: OpportunityPriority; readonly magnitude: number },
  effectivenessByType?: Readonly<Record<OpportunityType, OpportunityTypeEffectiveness>>,
): number {
  const priorityDelta = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
  if (priorityDelta !== 0) return priorityDelta;
  if (effectivenessByType && a.type !== b.type) {
    const aEffectiveness = effectivenessByType[a.type];
    const bEffectiveness = effectivenessByType[b.type];
    if (aEffectiveness.eligible && bEffectiveness.eligible && aEffectiveness.conversionRate !== bEffectiveness.conversionRate) {
      return bEffectiveness.conversionRate - aEffectiveness.conversionRate;
    }
  }
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

/** Outcomes describe explicit attribution; authoritative business data stays in its own record. */
export function opportunityResultState(item: OpportunityActionRecord) {
  return item.status === "dismissed" ? "dismissed" : item.outcome ?? "awaiting_result";
}

export function summarizeOpportunityOutcomes(items: readonly OpportunityActionRecord[]) {
  const actions = items.filter(item => item.status === "acted");
  const converted = actions.filter(item => item.outcome === "converted").length;
  const noResult = actions.filter(item => item.outcome === "no_result").length;
  return { actions: actions.length, converted, no_result: noResult,
    awaiting: actions.length - converted - noResult,
    conversionRate: converted + noResult ? 100 * converted / (converted + noResult) : 0 };
}

// ===================================================================================================
// PRODUCT-GROWTH-11 — aprendizado determinístico por tipo, a partir só dos outcomes reais já
// persistidos em users/{uid}/opportunity_actions (nunca IA/ML/score oculto, §22 do ticket). `resolved`
// é sempre converted+noResult (nunca inclui dismissed/awaiting no denominador, §12 — dispensar uma
// oportunidade nunca reduz artificialmente a taxa de conversão de um tipo). `eligible` é o único portão
// usado tanto para decidir se a taxa entra como desempate em compareOpportunities quanto (na UI) se ela
// é confiável o bastante pra exibir uma porcentagem — nunca dois limiares divergentes para a mesma ideia.
// ===================================================================================================

/** §5 do ticket — amostra mínima de outcomes RESOLVIDOS (converted+no_result) por tipo antes de deixar a
 * taxa de conversão influenciar a ordenação entre tipos de mesma prioridade. Não afeta o que é EXIBIDO
 * (a UI mostra a fração real sempre que resolved > 0, nunca esconde um dado real) — só o que é usado como
 * desempate, para nunca deixar 1-2 outcomes reordenarem oportunidades de negócio. */
export const MIN_RESOLVED_SAMPLE = 10;

export interface OpportunityTypeEffectiveness {
  readonly actionsTaken: number;
  readonly converted: number;
  readonly noResult: number;
  readonly awaitingResult: number;
  readonly dismissed: number;
  readonly resolved: number;
  readonly conversionRate: number;
  readonly eligible: boolean;
}

const ALL_OPPORTUNITY_TYPES: readonly OpportunityType[] =
  ["inactive_client", "stalled_product", "idle_schedule", "overdue_receivable", "repeat_purchase", "stock_risk"];

/** Groups the SAME bounded opportunity_actions read already loaded for lifecycle filtering (nunca uma
 * segunda query) by type, and reduces each group with the same converted/no_result/resolved semantics
 * as summarizeOpportunityOutcomes above — só por tipo, em vez de global. Sempre devolve as 6 chaves
 * (mesmo padrão de countsByType em summarizeOpportunities/server/opportunity-engine.ts), mesmo para um
 * tipo sem nenhum registro ainda (actionsTaken=0, eligible=false) — nunca uma chave ausente que
 * obrigaria todo consumidor a tratar undefined. */
export function summarizeOpportunityEffectivenessByType(
  items: readonly OpportunityActionRecord[],
): Record<OpportunityType, OpportunityTypeEffectiveness> {
  const result = {} as Record<OpportunityType, OpportunityTypeEffectiveness>;
  for (const type of ALL_OPPORTUNITY_TYPES) {
    const forType = items.filter(item => item.opportunityType === type);
    const actions = forType.filter(item => item.status === "acted");
    const converted = actions.filter(item => item.outcome === "converted").length;
    const noResult = actions.filter(item => item.outcome === "no_result").length;
    const resolved = converted + noResult;
    result[type] = {
      actionsTaken: actions.length,
      converted,
      noResult,
      awaitingResult: actions.length - resolved,
      dismissed: forType.filter(item => item.status === "dismissed").length,
      resolved,
      conversionRate: resolved ? 100 * converted / resolved : 0,
      eligible: resolved >= MIN_RESOLVED_SAMPLE,
    };
  }
  return result;
}
