import { PLANS, type PlanType } from "@shared/monetization";
import { trackAnalyticsEvent } from "@/lib/firebase";
import { readPendingSubscriptionActivation, clearPendingSubscriptionActivation } from "@/lib/subscription-activation-marker";

/**
 * PLAN-IMPL-06 §30-§32 — chamado por PlanProvider.tsx a cada `planData` observado. Nenhuma lógica de
 * plano é decidida aqui (isso continua sendo resolveActivePlan/PLAN-IMPL-03's ensurePlanLifecycleCurrent,
 * server-side) — este módulo só REAGE a mudanças já resolvidas, para analytics.
 *
 * `previous === null` só na primeira observação da SESSÃO atual do PlanProvider — nunca dispara uma
 * transição nessa chamada, só grava a baseline (§30/§31: "not every render of an [already known]
 * state"). trial_started é a ÚNICA exceção a essa regra de "primeira carga não conta": usa um marcador
 * PERSISTENTE (localStorage por uid, não por sessão) porque precisa capturar o caso mais comum e mais
 * valioso — o trial já concedido no cadastro, "active" desde a primeira carga da própria sessão em que
 * a conta nasceu. Mesmo raciocínio de subscription_activated, documentado por completo em
 * subscription-activation-marker.ts: a ativação real é assíncrona (webhook), então a carga da página
 * logo depois do redirect de volta do checkout também É a "primeira carga da sessão" — a regra genérica
 * de sessão perderia exatamente o momento mais importante.
 *
 * Limitação conhecida, documentada em vez de escondida (§29 permite isto — Option B, aproximação
 * honesta): trial_expired/plan_upgraded/plan_downgraded só disparam quando a MUDANÇA acontece durante a
 * sessão atual (comparando com o que esta mesma sessão já tinha visto antes) — uma transição que
 * acontece inteiramente ENTRE sessões (app fechado, trial expira, app reaberto) não gera o evento de
 * transição (só a nova baseline é gravada) — para essas duas famílias, capturar isso exigiria uma
 * segunda autoridade server-side (fora do escopo real deste ticket, §29 opção C).
 */

export type PlanLifecycleSnapshot = {
  readonly basePlan: PlanType;
  readonly trialStatus: "active" | "expired" | "converted" | null;
};

const TRIAL_STARTED_STORAGE_PREFIX = "rs:analytics_milestone:trial_started:";

function hasTrialStartedFired(uid: string): boolean {
  try {
    return typeof window !== "undefined" && window.localStorage.getItem(`${TRIAL_STARTED_STORAGE_PREFIX}${uid}`) === "1";
  } catch {
    return false;
  }
}
function markTrialStartedFired(uid: string): void {
  try {
    if (typeof window !== "undefined") window.localStorage.setItem(`${TRIAL_STARTED_STORAGE_PREFIX}${uid}`, "1");
  } catch {
    // fail-open — §37.
  }
}

const PLAN_RANK: Record<PlanType, number> = { [PLANS.FREE]: 0, [PLANS.PRO]: 1, [PLANS.PREMIUM]: 2 };

export function firePlanLifecycleAnalytics(uid: string, previous: PlanLifecycleSnapshot | null, current: PlanLifecycleSnapshot): void {
  if (current.trialStatus === "active" && !hasTrialStartedFired(uid)) {
    markTrialStartedFired(uid);
    trackAnalyticsEvent("trial_started", { plan: PLANS.PREMIUM });
  }

  // subscription_activated — consome (e limpa) o marcador de checkout pendente só quando o plano base
  // observado agora bate com o que plans.tsx marcou como "acabei de tentar comprar isto". Idempotente
  // por construção: uma segunda chamada com o mesmo estado já encontra o marcador limpo, não re-dispara.
  const pending = readPendingSubscriptionActivation();
  if (pending && current.basePlan === pending.plan) {
    clearPendingSubscriptionActivation();
    trackAnalyticsEvent("subscription_activated", { plan: current.basePlan, billing_cycle: pending.billingCycle });
  }

  if (!previous) return;

  if (previous.trialStatus === "active" && current.trialStatus === "expired") {
    trackAnalyticsEvent("trial_expired", { base_plan: current.basePlan });
  }

  if (previous.basePlan !== current.basePlan) {
    if (PLAN_RANK[current.basePlan] > PLAN_RANK[previous.basePlan]) {
      trackAnalyticsEvent("plan_upgraded", { from_plan: previous.basePlan, to_plan: current.basePlan });
    } else {
      trackAnalyticsEvent("plan_downgraded", { from_plan: previous.basePlan, to_plan: current.basePlan });
    }
  }
}
