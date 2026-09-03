import { PLAN_CONFIG, PLAN_PRESENTATION, UNLIMITED, recommendedUpgradePlan, type PlanType } from "@shared/monetization";

/**
 * PLAN-IMPL-04A §23 — única fonte de texto para paywalls contextuais (limite atingido/perto do limite),
 * consumida pelo componente compartilhado `PlanLimitPrompt` e por qualquer lugar que hoje só mostra uma
 * mensagem inline (ex.: `useCreateClient.ts`). Nenhum componente monta essa frase à mão — evita o que já
 * existia antes deste ticket: `add-product.tsx` e `clients.tsx` cada um com seu próprio texto hardcoded,
 * ambos dizendo "ilimitados" (falso — nem Pro nem Premium são ilimitados, §9) e recomendando Premium
 * diretamente (errado — Free deve recomendar Pro primeiro, §37).
 */
export type PaywallResource = "products" | "clients" | "services" | "bookings";

const RESOURCE_LABEL: Record<PaywallResource, string> = {
  products: "produtos",
  clients: "clientes",
  services: "serviços",
  bookings: "agendamentos",
};

function limitFor(plan: PlanType, resource: PaywallResource): number {
  return resource === "bookings" ? PLAN_CONFIG[plan].limits.bookingsMonthly : PLAN_CONFIG[plan].limits[resource];
}

/** Mesma convenção pt-BR (separador de milhar) já usada em PLAN_PRESENTATION (ex.: "Até 2.000 clientes")
 * e em plans.tsx (formatBRL) — nunca um número cru tipo "2000" numa frase em português. */
function formatCount(value: number): string {
  return value.toLocaleString("pt-BR");
}

export interface PaywallCopy {
  readonly title: string;
  /** null só quando não há próximo plano a recomendar (currentPlan já é Premium, §39 — sem upgrade pressure). */
  readonly benefitLine: string | null;
  readonly ctaLabel: string;
  readonly recommendedPlan: PlanType | null;
}

/**
 * §25/§27/§28/§29/§32/§38 — mensagem para uma CRIAÇÃO bloqueada pelo teto do plano atual.
 * `usedOverride` só é passado no cenário de downgrade (§32: já existem mais itens do que o novo teto
 * permite) — muda o título de "atingiu o limite de N" (uma tentativa nova) para "já possui M" (histórico
 * preservado, nunca apagado — a mensagem nunca deve soar como uma ameaça de bloqueio de dados, §31).
 */
export function buildLimitReachedCopy(resource: PaywallResource, currentPlan: PlanType, usedOverride?: number): PaywallCopy {
  const limit = limitFor(currentPlan, resource);
  const label = RESOURCE_LABEL[resource];
  const planName = PLAN_CONFIG[currentPlan].name;
  const recommendedPlan = recommendedUpgradePlan(currentPlan);
  const recommendedTitle = recommendedPlan ? PLAN_PRESENTATION[recommendedPlan].title : null;
  const recommendedLimit = recommendedPlan ? limitFor(recommendedPlan, resource) : null;
  const isOverLimitAfterDowngrade = typeof usedOverride === "number" && limit !== UNLIMITED && usedOverride > limit;

  const title = resource === "bookings"
    ? isOverLimitAfterDowngrade
      ? `Você já possui ${formatCount(usedOverride as number)} agendamentos neste mês.`
      : `Você usou os ${formatCount(limit)} agendamentos deste mês no ${planName}.`
    : isOverLimitAfterDowngrade
      ? `Você já possui ${formatCount(usedOverride as number)} ${label}.`
      : `Você atingiu o limite de ${formatCount(limit)} ${label} do ${planName}.`;

  let benefitLine: string | null = null;
  if (recommendedPlan && recommendedTitle) {
    if (resource === "bookings") {
      benefitLine = `Com o ${recommendedTitle}, você deixa de ter o limite mensal do ${planName}.`;
    } else if (recommendedLimit === UNLIMITED) {
      benefitLine = `No ${recommendedTitle}, você deixa de ter um teto de ${label}.`;
    } else {
      benefitLine = `No ${recommendedTitle}, você pode organizar até ${formatCount(recommendedLimit as number)} ${label}.`;
    }
  }

  return {
    title,
    benefitLine,
    ctaLabel: recommendedTitle ? `Conhecer ${recommendedTitle}` : "Ver planos",
    recommendedPlan,
  };
}

/** §26/§29/N1-N6 — aviso discreto de "perto do limite" (≥80%, isNearPlanLimit), nunca um bloqueio. */
export function buildNearLimitCopy(resource: PaywallResource, currentPlan: PlanType): string {
  const planName = PLAN_CONFIG[currentPlan].name;
  return resource === "bookings"
    ? `Você está chegando ao limite de agendamentos deste mês no ${planName}.`
    : `Você está chegando ao limite de ${RESOURCE_LABEL[resource]} do ${planName}.`;
}

/** §31/§32 — dados preservados após downgrade: nunca "bloqueados", sempre "seguros". */
export function buildPreservedDataCopy(resource: PaywallResource, preservedCount: number): string {
  const label = RESOURCE_LABEL[resource];
  return `${preservedCount} ${label} ${preservedCount === 1 ? "está preservado" : "estão preservados"}. Seus dados continuam seguros.`;
}
