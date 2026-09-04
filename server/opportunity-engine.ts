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
 * todas as Sales/Clients/Products"). Nenhum novo índice composto do Firestore foi necessário — as três
 * queries abaixo filtram/ordenam por um único campo (`lastPurchaseAt`, `lastSoldDate`, `startAt`), que o
 * Firestore já indexa automaticamente por padrão (confirmado: firestore.indexes.json's fieldOverrides
 * está vazio), ou reaproveitam um índice composto JÁ existente (bookings/serviceAvailabilityBlocks
 * resourceId+startAt, usado por server/service-availability-commands.ts).
 */
import type { Express, NextFunction, Request, Response } from "express";
import type { Firestore } from "firebase-admin/firestore";
import {
  type Opportunity,
  type OpportunityPriority,
  type OpportunityType,
  type OpportunitySummary,
  buildOpportunityId,
  compareOpportunities,
  hasAdvancedOpportunityAccess,
  INACTIVE_CLIENT_THRESHOLD_DAYS,
  STALLED_PRODUCT_THRESHOLD_DAYS,
  IDLE_SCHEDULE_WINDOW_DAYS,
  IDLE_SCHEDULE_UNDERUSED_RATIO,
  OPPORTUNITY_RESPONSE_LIMIT,
  OPPORTUNITY_QUERY_PAGE_SIZE,
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
  return [{
    id: buildOpportunityId("idle_schedule", DEFAULT_RESOURCE_ID),
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
// Combinação — §14 (suporte híbrido natural: um tenant só-produto nunca recebe idle_schedule porque a
// query de schedule simplesmente não acha nada; um tenant só-serviço nunca recebe stalled_product pelo
// mesmo motivo — nenhuma detecção de "tipo de negócio" precisa existir, cada detector já responde
// vazio quando o domínio dele não se aplica), §25/§32 (ordenação estável, resposta limitada).
// ===================================================================================================
export async function computeOpportunities(db: Firestore, uid: string, nowMs: number = Date.now()): Promise<Opportunity[]> {
  const [inactiveClients, stalledProducts, idleSchedule] = await Promise.all([
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
  ]);

  const all = [...inactiveClients, ...stalledProducts, ...idleSchedule] as (Opportunity & { magnitude: number })[];
  all.sort((a, b) => compareOpportunities(a, b));
  // magnitude é um detalhe de ordenação interno, nunca exposto na resposta HTTP (§5 — evidence só leva
  // fatos já nomeados por tipo) — reconstrução explícita do objeto público, em vez de destructure-and-
  // discard, para nunca vazar um campo interno por engano se o shape mudar no futuro.
  return all.slice(0, OPPORTUNITY_RESPONSE_LIMIT).map((opportunity): Opportunity => ({
    id: opportunity.id,
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
  const countsByType: Record<OpportunityType, number> = { inactive_client: 0, stalled_product: 0, idle_schedule: 0 };
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
}
