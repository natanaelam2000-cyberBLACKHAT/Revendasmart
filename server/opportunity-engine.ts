/**
 * PLAN-IMPL-07A — autoridade determinística única de detecção de oportunidades comerciais (§4/§5 do
 * ticket): dados reais do negócio -> detectar -> explicar (WHAT/WHY) -> ação concreta. Nenhuma IA
 * generativa, nenhuma probabilidade fabricada (§6/§8) — cada regra é aritmética simples sobre campos
 * já existentes/mantidos transacionalmente, nunca um score oculto.
 *
 * Auditoria prévia (obrigatória antes de qualquer edição, §3 do ticket) encontrou UM sistema vivo
 * (client/src/lib/home-dashboard-view-model.ts + client-activity.ts, cartão "Prioridades" do
 * dashboard) e QUATRO implementações órfãs de gerações anteriores da mesma ideia
 * (store-health.ts/StoreIntelligencePanel.tsx — removidas deliberadamente do dashboard, guardadas por
 * asserções negativas em script/smoke-tests.ts; dashboard-metrics.ts e business-insights.ts — mortas,
 * zero callers). Esta engine é uma superfície NOVA e DISTINTA (mais avançada, Premium, servida por
 * endpoint HTTP com paginação/bounds reais) — nunca substitui nem duplica o cartão "Prioridades"
 * existente, que continua exatamente como está.
 *
 * Escala/custo (§29-§31): cada tipo de oportunidade é UMA query indexada e limitada (nunca "carregar
 * todas as Sales/Clients/Products"). Nenhum novo índice composto do Firestore foi necessário — as
 * queries de inactive_client/stalled_product/idle_schedule filtram/ordenam por um único campo
 * (`lastPurchaseAt`, `lastSoldDate`, `startAt`), que o Firestore já indexa automaticamente por padrão
 * (confirmado: firestore.indexes.json's fieldOverrides está vazio), ou reaproveitam um índice composto
 * JÁ existente (bookings/serviceAvailabilityBlocks resourceId+startAt, usado por
 * server/service-availability-commands.ts).
 *
 * PRODUCT-GROWTH-04 — adicionou "overdue_receivable" (installments.status+dueDate), reaproveitando o
 * índice composto status+dueDate de installments JÁ existente (a mesma query que client/src/pages/
 * billings.tsx já executa client-side) — nenhum índice novo aqui também. O único custo extra é um
 * db.getAll() em lote sobre os clientIds únicos da página (nunca um loop de awaits por documento),
 * bounded pelo mesmo OPPORTUNITY_QUERY_PAGE_SIZE de qualquer outro detector. "repeat-purchase" e "low
 * stock ativamente vendendo" (candidatos B/D do pedido) foram avaliados e propositalmente deixados de
 * fora desta rodada — ver o relatório final para o motivo de cada um.
 */
import type { Express, NextFunction, Request, Response } from "express";
import type { Firestore } from "firebase-admin/firestore";
import {
  type Opportunity,
  type OpportunityActionRecord,
  type OpportunityActionStatus,
  type OpportunityPriority,
  type OpportunityType,
  type OpportunitySummary,
  buildOpportunityFingerprint,
  buildOpportunityId,
  compareOpportunities,
  hasAdvancedOpportunityAccess,
  INACTIVE_CLIENT_THRESHOLD_DAYS,
  STALLED_PRODUCT_THRESHOLD_DAYS,
  IDLE_SCHEDULE_WINDOW_DAYS,
  IDLE_SCHEDULE_UNDERUSED_RATIO,
  OPPORTUNITY_RESPONSE_LIMIT,
  OPPORTUNITY_QUERY_PAGE_SIZE,
  OPPORTUNITY_ACTION_STATE_QUERY_LIMIT,
  OPPORTUNITY_ACTION_SNAPSHOT_MAX_LENGTH,
} from "../shared/opportunity-rules";
import { intervalsOverlap, type WeeklyHours } from "../shared/service-availability";
import type { PlanType } from "../shared/monetization";
import { getFirebaseAdmin } from "./firebase-admin-init";
import { isAdminUid } from "./admin-auth";
import { logError, logWarn } from "./logger";

const DAY_MS = 86_400_000;
/** Mesmo convencional já usado independentemente por client/src/pages/service-agenda.tsx e
 * server/service-public-booking.ts — "1 resource : 1 agenda" em V1 (nenhum CRUD de equipe ainda). */
const DEFAULT_RESOURCE_ID = "default";

function daysBetween(earlierIso: string, laterMs: number): number {
  const earlierMs = Date.parse(earlierIso);
  if (!Number.isFinite(earlierMs)) return 0;
  return Math.max(0, Math.floor((laterMs - earlierMs) / DAY_MS));
}

// ===================================================================================================
// inactive_client — §10: Client.lastPurchaseAt (escrito transacionalmente em
// server/sale-finalize-transaction.ts, mesmo padrão de Product.lastSoldDate) < limiar. Ausência do
// campo é "sem histórico conhecido", nunca inatividade — a própria semântica de `where(... "<" ...)` do
// Firestore já exclui documentos sem o campo, sem precisar de nenhum filtro extra (§5/§9 da resposta do
// usuário autorizando esta implementação).
// ===================================================================================================
async function detectInactiveClientOpportunities(db: Firestore, uid: string, nowMs: number): Promise<Opportunity[]> {
  const thresholdIso = new Date(nowMs - INACTIVE_CLIENT_THRESHOLD_DAYS * DAY_MS).toISOString();
  const snapshot = await db.collection("users").doc(uid).collection("clients")
    .where("lastPurchaseAt", "<", thresholdIso)
    .orderBy("lastPurchaseAt", "asc")
    .limit(OPPORTUNITY_QUERY_PAGE_SIZE)
    .get();

  return snapshot.docs.map((doc) => {
    const data = doc.data();
    const lastPurchaseAt = String(data.lastPurchaseAt);
    const daysSinceLastPurchase = daysBetween(lastPurchaseAt, nowMs);
    const priority: OpportunityPriority = daysSinceLastPurchase >= INACTIVE_CLIENT_THRESHOLD_DAYS * 2 ? "high" : "medium";
    const name = typeof data.name === "string" && data.name.trim() ? data.name : "Cliente";
    return {
      id: buildOpportunityId("inactive_client", doc.id),
      // PRODUCT-GROWTH-05 §7 — cycleKey=lastPurchaseAt: se este cliente comprar de novo e mais tarde
      // ficar inativo outra vez, lastPurchaseAt terá um valor NOVO -> fingerprint novo -> a oportunidade
      // antiga (dispensada/marcada feito) nunca suprime silenciosamente o novo ciclo.
      fingerprint: buildOpportunityFingerprint("inactive_client", doc.id, lastPurchaseAt),
      type: "inactive_client",
      priority,
      reason: `Sem compra há ${daysSinceLastPurchase} dias`,
      evidence: { daysSinceLastPurchase, lastPurchaseAt },
      action: { type: "contact_client", label: "Entrar em contato" },
      entityReference: { type: "client", id: doc.id, name },
      // usado só para ordenação (compareOpportunities), nunca serializado na resposta.
      magnitude: daysSinceLastPurchase,
    } as Opportunity & { magnitude: number };
  });
}

// ===================================================================================================
// stalled_product — §12: Product.stock > 0 + Product.lastSoldDate < limiar. Produtos NUNCA vendidos
// (lastSoldDate ausente) são deliberadamente excluídos — Product.createdAt não existe hoje (auditado:
// nunca escrito por nenhum caminho de criação real), então não há como distinguir "chegou ontem" de
// "nunca vendeu porque é ruim" sem uma segunda mudança de schema fora do escopo desta ticket; a regra
// conservadora (nunca marcar "nunca vendido" como parado) já satisfaz §12 ("não rotular produto recém-
// criado como parado") sem precisar desse campo. Produtos "preserved" (downgrade de plano, já
// indisponíveis para novas vendas) também são excluídos — recomendar "criar anúncio" para um produto que
// o dono não pode vender agora seria uma ação sem saída real.
// ===================================================================================================
async function detectStalledProductOpportunities(db: Firestore, uid: string, nowMs: number): Promise<Opportunity[]> {
  const thresholdIso = new Date(nowMs - STALLED_PRODUCT_THRESHOLD_DAYS * DAY_MS).toISOString();
  const snapshot = await db.collection("users").doc(uid).collection("products")
    .where("lastSoldDate", "<", thresholdIso)
    .orderBy("lastSoldDate", "asc")
    .limit(OPPORTUNITY_QUERY_PAGE_SIZE)
    .get();

  const opportunities: (Opportunity & { magnitude: number })[] = [];
  for (const doc of snapshot.docs) {
    const data = doc.data();
    const stock = Number(data.stock);
    if (!Number.isFinite(stock) || stock <= 0) continue;
    if (data.planAccessState === "preserved") continue;
    const lastSoldDate = String(data.lastSoldDate);
    const daysSinceLastSale = daysBetween(lastSoldDate, nowMs);
    const priority: OpportunityPriority = daysSinceLastSale >= STALLED_PRODUCT_THRESHOLD_DAYS * 2 ? "high" : "medium";
    const name = typeof data.name === "string" && data.name.trim() ? data.name : "Produto";
    opportunities.push({
      id: buildOpportunityId("stalled_product", doc.id),
      // PRODUCT-GROWTH-05 §7 — cycleKey=lastSoldDate: se o produto vender de novo e mais tarde ficar
      // parado outra vez, lastSoldDate terá um valor NOVO -> novo fingerprint -> elegível de novo.
      fingerprint: buildOpportunityFingerprint("stalled_product", doc.id, lastSoldDate),
      type: "stalled_product",
      priority,
      reason: `${stock} em estoque, sem vender há ${daysSinceLastSale} dias`,
      evidence: { daysSinceLastSale, stock, lastSoldDate },
      action: { type: "open_product", label: "Criar anúncio" },
      entityReference: { type: "product", id: doc.id, name },
      magnitude: daysSinceLastSale,
    });
  }
  return opportunities;
}

// ===================================================================================================
// overdue_receivable — PRODUCT-GROWTH-04: Installment.status in [pending, partial] (o mesmo par que
// qualquer escritor real produz hoje — server/sale-finalize-transaction.ts nunca grava "overdue";
// incluído aqui defensivamente por paridade com a MESMA lista que client/src/pages/billings.tsx já usa
// client-side) + dueDate < agora. Reaproveita o índice composto status+dueDate de installments já
// existente em firestore.indexes.json (a mesma query, mesmo formato, que billings.tsx já executa) —
// nenhum índice novo. O nome do cliente é obtido por um único db.getAll() em lote (nunca um await
// dentro de um loop por cliente) sobre os clientIds ÚNICOS da página já lida — no máximo
// OPPORTUNITY_QUERY_PAGE_SIZE leituras extras, o mesmo teto de qualquer outro detector aqui. O valor
// restante é sempre amount - paidAmount (nunca o valor original do parcelamento), para nunca superestimar
// o que falta cobrar de uma parcela já paga parcialmente. Prioridade sempre "high" — classificação do
// próprio pedido (§5): condição financeira vencida é sempre a categoria mais acionável, sem um segundo
// limiar de dias fabricado só para criar uma banda "medium" artificial.
// ===================================================================================================
async function detectOverdueReceivableOpportunities(db: Firestore, uid: string, nowMs: number): Promise<Opportunity[]> {
  const nowIso = new Date(nowMs).toISOString();
  const snapshot = await db.collection("users").doc(uid).collection("installments")
    .where("status", "in", ["pending", "partial"])
    .where("dueDate", "<", nowIso)
    .orderBy("dueDate", "asc")
    .limit(OPPORTUNITY_QUERY_PAGE_SIZE)
    .get();

  if (snapshot.empty) return [];

  const clientIds = Array.from(new Set(snapshot.docs.map((doc) => String(doc.data().clientId ?? "")).filter(Boolean)));
  const clientRefs = clientIds.map((clientId) => db.collection("users").doc(uid).collection("clients").doc(clientId));
  const clientSnaps = clientRefs.length ? await db.getAll(...clientRefs) : [];
  // Objeto simples, não um Map — o método mutador de um Map tem o mesmo nome do método de escrita do
  // Firestore, o que colidiria com a asserção textual A6 (prova de que esta engine nunca escreve no
  // Firestore, só lê) mesmo sendo só um Map em memória, nunca uma escrita real. Mais simples nunca
  // introduzir a coincidência de nome do que lembrar de excluí-la do regex depois.
  const clientNameById: Record<string, string> = {};
  clientSnaps.forEach((snap, index) => {
    const data = snap.exists ? snap.data() : undefined;
    const name = typeof data?.name === "string" && data.name.trim() ? data.name : "Cliente";
    clientNameById[clientIds[index]] = name;
  });

  const opportunities: (Opportunity & { magnitude: number })[] = [];
  for (const doc of snapshot.docs) {
    const data = doc.data();
    const clientId = String(data.clientId ?? "");
    if (!clientId) continue;
    const amount = Number(data.amount);
    const paidAmount = Number(data.paidAmount) || 0;
    const remaining = Number.isFinite(amount) ? amount - paidAmount : NaN;
    if (!Number.isFinite(remaining) || remaining <= 0) continue;
    const dueDate = String(data.dueDate);
    const daysOverdue = daysBetween(dueDate, nowMs);
    const name = clientNameById[clientId] ?? "Cliente";
    const formattedAmount = remaining.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
    opportunities.push({
      id: buildOpportunityId("overdue_receivable", doc.id),
      // PRODUCT-GROWTH-05 §7/§12 — sem cycleKey: uma parcela é um disparo único por natureza (nunca
      // "reabre" depois de paga; um parcelamento futuro é sempre um installmentId novo). Dispensar/
      // marcar feito vale para esta parcela específica enquanto ela continuar pending/partial.
      fingerprint: buildOpportunityFingerprint("overdue_receivable", doc.id),
      type: "overdue_receivable",
      priority: "high",
      reason: `Parcela de ${formattedAmount} vencida há ${daysOverdue} dia(s)`,
      evidence: { daysOverdue, amount: remaining, dueDate },
      action: { type: "open_billing", label: "Ver cobrança" },
      entityReference: { type: "client", id: clientId, name },
      magnitude: daysOverdue,
    });
  }
  return opportunities;
}

// ===================================================================================================
// idle_schedule — §13: capacidade configurada (ServiceResourceSchedule.weeklyHours) vs. horas
// reservadas por Bookings confirmados, numa janela futura limitada, excluindo bloqueios reais. Nunca
// chama um resource sem expediente configurado de "ocioso" (§13) — sem schedule, nenhuma oportunidade.
// ===================================================================================================
function sumWeeklyMinutes(weeklyHours: WeeklyHours): number {
  let total = 0;
  for (const periods of Object.values(weeklyHours)) {
    for (const period of periods) {
      const [startH, startM] = period.start.split(":").map(Number);
      const [endH, endM] = period.end.split(":").map(Number);
      total += (endH * 60 + endM) - (startH * 60 + startM);
    }
  }
  return total;
}

async function detectIdleScheduleOpportunities(db: Firestore, uid: string, nowMs: number): Promise<Opportunity[]> {
  const userRef = db.collection("users").doc(uid);
  const scheduleSnap = await userRef.collection("serviceResourceSchedules").doc(DEFAULT_RESOURCE_ID).get();
  if (!scheduleSnap.exists) return [];
  const schedule = scheduleSnap.data();
  const weeklyHours = schedule?.weeklyHours as WeeklyHours | undefined;
  if (!weeklyHours) return [];

  const weeklyAvailableMinutes = sumWeeklyMinutes(weeklyHours);
  if (weeklyAvailableMinutes <= 0) return [];
  // §13/§29 — estimativa proporcional simples (janela / 7 dias), nunca uma iteração dia-a-dia com bordas
  // parciais: aritmética explícita e documentada, não uma probabilidade (§8).
  const windowAvailableMinutes = weeklyAvailableMinutes * (IDLE_SCHEDULE_WINDOW_DAYS / 7);

  const windowStartIso = new Date(nowMs).toISOString();
  const windowEndIso = new Date(nowMs + IDLE_SCHEDULE_WINDOW_DAYS * DAY_MS).toISOString();

  const [bookingsSnap, blocksSnap] = await Promise.all([
    userRef.collection("bookings")
      .where("resourceId", "==", DEFAULT_RESOURCE_ID)
      .where("startAt", ">=", windowStartIso)
      .where("startAt", "<", windowEndIso)
      .limit(OPPORTUNITY_QUERY_PAGE_SIZE)
      .get(),
    // Mesmo padrão de query já usado em server/service-availability-commands.ts (resourceId+startAt,
    // índice já existente) — filtro de overlap real feito em memória via intervalsOverlap, igual lá.
    userRef.collection("serviceAvailabilityBlocks")
      .where("resourceId", "==", DEFAULT_RESOURCE_ID)
      .where("startAt", "<", windowEndIso)
      .limit(OPPORTUNITY_QUERY_PAGE_SIZE)
      .get(),
  ]);

  let bookedMinutes = 0;
  for (const doc of bookingsSnap.docs) {
    const data = doc.data();
    if (data.status !== "confirmed") continue;
    const startMs = Date.parse(String(data.startAt));
    const endMs = Date.parse(String(data.endAt));
    if (Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs) {
      bookedMinutes += (endMs - startMs) / 60_000;
    }
  }

  // LIMITAÇÃO CONHECIDA, documentada em vez de escondida: soma o overlap em minutos-relógio corridos
  // (24h/dia), não recortado às janelas de weeklyHours — um bloqueio que caia parcialmente FORA do
  // expediente configurado (ex.: um bloqueio de sábado, quando weeklyHours não tem sábado) subtrai
  // minutos que nunca estavam "disponíveis" pra começar, subestimando a capacidade efetiva nesse caso
  // específico. Aceitável para V1: o efeito é sempre CONSERVADOR (nunca gera uma falsa oportunidade —
  // na pior hipótese, deixa de sinalizar uma agenda genuinamente ociosa por causa de horas já fora do
  // expediente, nunca o contrário). Refinar exigiria recortar cada bloqueio pelos períodos reais de
  // weeklyHours, dia a dia — mais complexidade do que esta V1 justifica.
  let blockedMinutes = 0;
  for (const doc of blocksSnap.docs) {
    const data = doc.data();
    const blockStart = String(data.startAt);
    const blockEnd = String(data.endAt);
    if (!intervalsOverlap(windowStartIso, windowEndIso, blockStart, blockEnd)) continue;
    const overlapStartMs = Math.max(Date.parse(windowStartIso), Date.parse(blockStart));
    const overlapEndMs = Math.min(Date.parse(windowEndIso), Date.parse(blockEnd));
    if (Number.isFinite(overlapStartMs) && Number.isFinite(overlapEndMs) && overlapEndMs > overlapStartMs) {
      blockedMinutes += (overlapEndMs - overlapStartMs) / 60_000;
    }
  }

  const effectiveAvailableMinutes = Math.max(0, windowAvailableMinutes - blockedMinutes);
  // §13 — sem capacidade efetiva nenhuma (tudo bloqueado), não há "ociosidade" para reportar: é
  // indisponibilidade, um conceito diferente, fora do escopo desta oportunidade.
  if (effectiveAvailableMinutes <= 0) return [];

  const bookedRatio = bookedMinutes / effectiveAvailableMinutes;
  if (bookedRatio >= IDLE_SCHEDULE_UNDERUSED_RATIO) return [];

  const underusedPercent = Math.round((1 - bookedRatio) * 100);
  const priority: OpportunityPriority = bookedRatio <= IDLE_SCHEDULE_UNDERUSED_RATIO / 2 ? "high" : "medium";
  // PRODUCT-GROWTH-05 §7 — cycleKey=janela de IDLE_SCHEDULE_WINDOW_DAYS dias desde a época: não existe
  // um campo mutável natural por "entidade" aqui (o resource é sempre "default"), então o mesmo período
  // que já governa o detector vira o ciclo — dispensar/marcar feito vale para ESTA janela de avaliação,
  // nunca para sempre; uma janela futura (agenda genuinamente ociosa de novo, semanas depois) recebe um
  // bucket novo e fica elegível de novo.
  const windowCycleBucket = Math.floor(nowMs / (IDLE_SCHEDULE_WINDOW_DAYS * DAY_MS));
  return [{
    id: buildOpportunityId("idle_schedule", DEFAULT_RESOURCE_ID),
    fingerprint: buildOpportunityFingerprint("idle_schedule", DEFAULT_RESOURCE_ID, windowCycleBucket),
    type: "idle_schedule",
    priority,
    reason: `${underusedPercent}% da agenda livre nos próximos ${IDLE_SCHEDULE_WINDOW_DAYS} dias`,
    evidence: { underusedPercent, windowDays: IDLE_SCHEDULE_WINDOW_DAYS },
    action: { type: "open_schedule", label: "Divulgar horários" },
    entityReference: { type: "schedule", id: DEFAULT_RESOURCE_ID, name: "Agenda" },
    magnitude: underusedPercent,
  } as Opportunity & { magnitude: number }];
}

// ===================================================================================================
// Lifecycle (PRODUCT-GROWTH-05) — §2/§4/§11: users/{uid}/opportunity_actions é a ÚNICA leitura extra
// por request (nunca uma leitura por fingerprint candidato — ver CS2's N+1 guard, reaproveitado aqui),
// bounded por OPPORTUNITY_ACTION_STATE_QUERY_LIMIT. Sem regra de firestore.rules dedicada de propósito:
// o catch-all "deny all" já existente (firestore.rules, fim do arquivo) cobre esta subcoleção
// automaticamente, e todo acesso passa exclusivamente por estas rotas HTTP (Admin SDK + requireAuth) —
// nunca o SDK client-side lendo/escrevendo direto, então nenhuma regra nova precisa existir.
// ===================================================================================================
async function loadOpportunityActionState(db: Firestore, uid: string): Promise<Record<string, OpportunityActionRecord>> {
  const snapshot = await db.collection("users").doc(uid).collection("opportunity_actions")
    .orderBy("updatedAt", "desc")
    .limit(OPPORTUNITY_ACTION_STATE_QUERY_LIMIT)
    .get();
  // Objeto simples, não Map — mesmo motivo do clientNameById em detectOverdueReceivableOpportunities
  // acima: o método mutador de um Map tem o mesmo nome do método de escrita do Firestore, o que
  // colidiria com a asserção textual A6, mesmo sendo só uma estrutura em memória. Chaves aqui são sempre
  // fingerprints (contêm ":", nunca parecem um índice numérico), então a ordem de inserção (mesma ordem
  // já vinda de updatedAt desc) é preservada por Object.values() normalmente.
  const byFingerprint: Record<string, OpportunityActionRecord> = {};
  for (const doc of snapshot.docs) {
    const data = doc.data();
    if (data.status !== "acted" && data.status !== "dismissed") continue;
    byFingerprint[doc.id] = {
      fingerprint: doc.id,
      opportunityType: data.opportunityType,
      status: data.status,
      title: typeof data.title === "string" ? data.title : "",
      reasonSnapshot: typeof data.reasonSnapshot === "string" ? data.reasonSnapshot : "",
      actedAt: typeof data.actedAt === "string" ? data.actedAt : null,
      dismissedAt: typeof data.dismissedAt === "string" ? data.dismissedAt : null,
      createdAt: typeof data.createdAt === "string" ? data.createdAt : "",
      updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : "",
    };
  }
  return byFingerprint;
}

// ===================================================================================================
// Combinação — §14 (suporte híbrido natural: um tenant só-produto nunca recebe idle_schedule porque a
// query de schedule simplesmente não acha nada; um tenant só-serviço nunca recebe stalled_product pelo
// mesmo motivo — nenhuma detecção de "tipo de negócio" precisa existir, cada detector já responde
// vazio quando o domínio dele não se aplica), §25/§32 (ordenação estável, resposta limitada).
// ===================================================================================================
export async function computeOpportunities(db: Firestore, uid: string, nowMs: number = Date.now()): Promise<Opportunity[]> {
  const [inactiveClients, stalledProducts, idleSchedule, overdueReceivables, actionState] = await Promise.all([
    detectInactiveClientOpportunities(db, uid, nowMs).catch((error) => {
      logWarn("opportunity_engine.inactive_client_failed", { reason: error instanceof Error ? error.name : "unknown" });
      return [];
    }),
    detectStalledProductOpportunities(db, uid, nowMs).catch((error) => {
      logWarn("opportunity_engine.stalled_product_failed", { reason: error instanceof Error ? error.name : "unknown" });
      return [];
    }),
    detectIdleScheduleOpportunities(db, uid, nowMs).catch((error) => {
      logWarn("opportunity_engine.idle_schedule_failed", { reason: error instanceof Error ? error.name : "unknown" });
      return [];
    }),
    detectOverdueReceivableOpportunities(db, uid, nowMs).catch((error) => {
      logWarn("opportunity_engine.overdue_receivable_failed", { reason: error instanceof Error ? error.name : "unknown" });
      return [];
    }),
    loadOpportunityActionState(db, uid).catch((error) => {
      logWarn("opportunity_engine.action_state_failed", { reason: error instanceof Error ? error.name : "unknown" });
      // §4/§42 — falha ao carregar o estado de ação nunca deve mostrar de volta algo que o usuário já
      // tratou (seria pior que uma lista temporariamente incompleta); objeto vazio = filtro vira no-op =
      // fail CLOSED para "esconder", nunca fail open para "mostrar tudo de novo".
      return {} as Record<string, OpportunityActionRecord>;
    }),
  ]);

  const all = [...inactiveClients, ...stalledProducts, ...idleSchedule, ...overdueReceivables] as (Opportunity & { magnitude: number })[];
  // §4 — Ativa = sem ação terminal registrada para este fingerprint específico (não para o type/entidade
  // em geral — um ciclo novo, com um fingerprint novo, nunca fica preso por uma ação de um ciclo antigo).
  const active = all.filter((opportunity) => !actionState[opportunity.fingerprint]);
  active.sort((a, b) => compareOpportunities(a, b));
  // magnitude é um detalhe de ordenação interno, nunca exposto na resposta HTTP (§5 — evidence só leva
  // fatos já nomeados por tipo) — reconstrução explícita do objeto público, em vez de destructure-and-
  // discard, para nunca vazar um campo interno por engano se o shape mudar no futuro.
  return active.slice(0, OPPORTUNITY_RESPONSE_LIMIT).map((opportunity): Opportunity => ({
    id: opportunity.id,
    fingerprint: opportunity.fingerprint,
    type: opportunity.type,
    priority: opportunity.priority,
    reason: opportunity.reason,
    evidence: opportunity.evidence,
    action: opportunity.action,
    entityReference: opportunity.entityReference,
  }));
}

/**
 * PLAN-IMPL-07B §11/§29/§30 — resumo consumido pela seção estratégica de Relatórios (Premium). Nunca
 * uma segunda detecção: recebe a lista JÁ produzida por computeOpportunities (mesma autoridade de
 * /opportunities) e só agrupa/conta — nenhuma regra de negócio nova aqui. `strongest` é sempre o
 * primeiro elemento da lista já ordenada por compareOpportunities (mesmo comparador determinístico de
 * 07A, §30 — "não crie uma nova lógica de ranking própria do relatório"), nunca uma ordenação nova.
 * Shape (`OpportunitySummary`) vive em shared/opportunity-rules.ts, não aqui — o client também precisa
 * dele para tipar a resposta HTTP, e client/ nunca importa de server/.
 */
export function summarizeOpportunities(opportunities: readonly Opportunity[]): OpportunitySummary {
  const countsByType: Record<OpportunityType, number> = { inactive_client: 0, stalled_product: 0, idle_schedule: 0, overdue_receivable: 0 };
  for (const opportunity of opportunities) {
    countsByType[opportunity.type] += 1;
  }
  return {
    totalCount: opportunities.length,
    countsByType,
    strongest: opportunities[0] ?? null,
  };
}

/**
 * §22 — autoridade server-side do entitlement Premium desta engine (nunca só ocultação no client, §23:
 * a lista real nunca é computada e depois borrada para Free/Pro). §21 — sempre effectivePlan (via
 * resolveServerPlan, mesma autoridade grant/trial-aware de todo o resto do app — Tester/Premium+/trial
 * ativo contam automaticamente, sem lógica paralela aqui), nunca basePlan direto. §42 — falha de
 * resolução de plano nunca vira "assume Free" nem "assume Premium": simplesmente indisponível (503),
 * já que esta é uma superfície só-leitura, nenhuma mutação em jogo.
 */
function isValidOpportunityType(value: unknown): value is OpportunityType {
  return value === "inactive_client" || value === "stalled_product" || value === "idle_schedule" || value === "overdue_receivable";
}

function isValidActionStatus(value: unknown): value is OpportunityActionStatus {
  return value === "acted" || value === "dismissed";
}

/** §2 — texto de exibição inerte, nunca vazio (fallback), sempre limitado (§2). */
function sanitizeSnapshotText(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  return trimmed.slice(0, OPPORTUNITY_ACTION_SNAPSHOT_MAX_LENGTH);
}

export function registerOpportunityRoutes(
  app: Express,
  requireAuth: (req: Request, res: Response, next: NextFunction) => void,
  resolveServerPlan: (db: Firestore, uid: string) => Promise<PlanType>,
): void {
  app.get("/api/opportunities", requireAuth, async (req: Request, res: Response) => {
    const uid = (req as Request & { firebaseUid?: string }).firebaseUid;
    if (!uid) return res.status(401).json({ code: "UNAUTHORIZED", message: "Sessão inválida. Faça login novamente." });
    try {
      const db = getFirebaseAdmin().firestore();
      const admin = await isAdminUid(uid);
      if (!admin) {
        const effectivePlan = await resolveServerPlan(db, uid);
        if (!hasAdvancedOpportunityAccess(effectivePlan)) {
          return res.status(403).json({ code: "OPPORTUNITIES_PLAN_REQUIRED", message: "Oportunidades comerciais é um recurso do plano Premium." });
        }
      }
      const opportunities = await computeOpportunities(db, uid);
      return res.status(200).json({ opportunities });
    } catch (error) {
      logError("opportunity_engine.route_failed", error, { requestId: req.requestId });
      return res.status(503).json({ code: "OPPORTUNITIES_UNAVAILABLE", message: "Não foi possível carregar oportunidades agora. Tente novamente." });
    }
  });

  /**
   * PRODUCT-GROWTH-05 §2/§3/§8 — marca uma oportunidade como "acted" ou "dismissed". `fingerprint` vem
   * da URL (nunca do body — evita um segundo caminho para o mesmo valor divergir); uid SEMPRE de
   * `req.firebaseUid` (verificado por requireAuth, nunca aceito do client, §3 — cross-tenant é P0).
   * Idempotente por construção: a escrita sempre substitui o documento inteiro cuja chave já é o
   * fingerprint (nunca uma criação que falharia se o documento já existisse) — chamar duas vezes com o
   * mesmo status produz o mesmo resultado, nunca um erro de duplicidade (§9/§14 "double action").
   * `type`/`title`/`reason` vêm do client (o MESMO payload que
   * /api/opportunities acabou de servir para esta mesma oportunidade) — texto de exibição inerte só
   * (§2: nunca usado em autorização/valor financeiro; a query real em computeOpportunities continua
   * sendo a única autoridade sobre o que está ativo), sanitizado/limitado antes de persistir.
   */
  app.post("/api/opportunities/:fingerprint/action", requireAuth, async (req: Request, res: Response) => {
    const uid = (req as Request & { firebaseUid?: string }).firebaseUid;
    if (!uid) return res.status(401).json({ code: "UNAUTHORIZED", message: "Sessão inválida. Faça login novamente." });
    const fingerprint = String(req.params.fingerprint || "");
    if (!fingerprint || fingerprint.length > 300) {
      return res.status(400).json({ code: "INVALID_FINGERPRINT", message: "Identificador de oportunidade inválido." });
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    if (!isValidActionStatus(body.status)) {
      return res.status(400).json({ code: "INVALID_STATUS", message: "Status inválido." });
    }
    if (!isValidOpportunityType(body.type)) {
      return res.status(400).json({ code: "INVALID_TYPE", message: "Tipo de oportunidade inválido." });
    }
    try {
      const db = getFirebaseAdmin().firestore();
      const admin = await isAdminUid(uid);
      if (!admin) {
        const effectivePlan = await resolveServerPlan(db, uid);
        if (!hasAdvancedOpportunityAccess(effectivePlan)) {
          return res.status(403).json({ code: "OPPORTUNITIES_PLAN_REQUIRED", message: "Oportunidades comerciais é um recurso do plano Premium." });
        }
      }
      const ref = db.collection("users").doc(uid).collection("opportunity_actions").doc(fingerprint);
      const existing = await ref.get();
      const nowIso = new Date().toISOString();
      const existingCreatedAt = existing.exists && typeof existing.data()?.createdAt === "string" ? String(existing.data()!.createdAt) : nowIso;
      const status = body.status;
      const record: OpportunityActionRecord = {
        fingerprint,
        opportunityType: body.type,
        status,
        title: sanitizeSnapshotText(body.title, "Oportunidade"),
        reasonSnapshot: sanitizeSnapshotText(body.reason, ""),
        actedAt: status === "acted" ? nowIso : null,
        dismissedAt: status === "dismissed" ? nowIso : null,
        createdAt: existingCreatedAt,
        updatedAt: nowIso,
      };
      await ref.set(record);
      return res.status(200).json({ action: record });
    } catch (error) {
      logError("opportunity_engine.action_route_failed", error, { requestId: req.requestId });
      return res.status(503).json({ code: "OPPORTUNITY_ACTION_UNAVAILABLE", message: "Não foi possível registrar a ação agora. Tente novamente." });
    }
  });

  /**
   * PRODUCT-GROWTH-05 §5 — Histórico: lê a MESMA coleção que computeOpportunities já usa para filtrar a
   * lista ativa (loadOpportunityActionState, nenhuma segunda leitura/lógica), já ordenada por
   * updatedAt desc pela própria query — mais recente primeiro, nenhum sort adicional necessário.
   */
  app.get("/api/opportunities/history", requireAuth, async (req: Request, res: Response) => {
    const uid = (req as Request & { firebaseUid?: string }).firebaseUid;
    if (!uid) return res.status(401).json({ code: "UNAUTHORIZED", message: "Sessão inválida. Faça login novamente." });
    try {
      const db = getFirebaseAdmin().firestore();
      const admin = await isAdminUid(uid);
      if (!admin) {
        const effectivePlan = await resolveServerPlan(db, uid);
        if (!hasAdvancedOpportunityAccess(effectivePlan)) {
          return res.status(403).json({ code: "OPPORTUNITIES_PLAN_REQUIRED", message: "Oportunidades comerciais é um recurso do plano Premium." });
        }
      }
      const actionState = await loadOpportunityActionState(db, uid);
      return res.status(200).json({ items: Object.values(actionState) });
    } catch (error) {
      logError("opportunity_engine.history_route_failed", error, { requestId: req.requestId });
      return res.status(503).json({ code: "OPPORTUNITY_HISTORY_UNAVAILABLE", message: "Não foi possível carregar o histórico agora. Tente novamente." });
    }
  });
}
