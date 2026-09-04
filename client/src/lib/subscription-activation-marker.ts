import type { BillingCycle, PlanType } from "@shared/monetization";

/**
 * PLAN-IMPL-06 §29 — ponte Opção B ("client logs once after receiving a server-confirmed state
 * transition and a server-provided transition marker") para subscription_activated: a ativação REAL
 * acontece de forma assíncrona (webhook do Mercado Pago, PLAN-IMPL-04B), nunca na resposta síncrona de
 * POST /api/subscriptions/create — o client só recebe um link de checkout e é redirecionado para fora
 * do app. Sem este marcador, a única forma de detectar "acabou de assinar" seria comparar o plano da
 * sessão atual com o de uma sessão anterior (PlanProvider.tsx) — mas isso perde exatamente o caso mais
 * valioso: a PRIMEIRA carga da página depois do redirect de volta do checkout é, ela mesma, o "primeiro
 * load da sessão", que a lógica de comparação por sessão deliberadamente ignora (para nunca disparar um
 * falso "acabou de assinar" simplesmente porque o app foi reaberto com uma assinatura já antiga).
 *
 * `localStorage` (sobrevive ao redirect completo, ida e volta ao Mercado Pago) com expiração curta: um
 * marcador vindo de uma tentativa muito antiga (ex. checkout abandonado há dias, usuário assinou por
 * outro caminho meses depois) nunca deve ser confundido com a ativação atual.
 */

const STORAGE_KEY = "rs:pending_subscription_activation";
const MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24h — folga generosa para o webhook processar, sem risco de atribuir uma ativação não relacionada, muito mais tarde, a esta tentativa.

type PendingActivation = {
  readonly plan: PlanType;
  readonly billingCycle: BillingCycle;
  readonly createdAt: number;
};

export function markPendingSubscriptionActivation(plan: PlanType, billingCycle: BillingCycle): void {
  try {
    const payload: PendingActivation = { plan, billingCycle, createdAt: Date.now() };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // fail-open — nunca bloqueia o checkout por causa de analytics (§37).
  }
}

/** Devolve o marcador pendente se ainda válido (dentro da janela), sem removê-lo — quem chama decide
 * quando consumir (só depois de confirmar a transição real via PlanProvider). */
export function readPendingSubscriptionActivation(): PendingActivation | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PendingActivation>;
    if (typeof parsed.plan !== "string" || typeof parsed.billingCycle !== "string" || typeof parsed.createdAt !== "number") return null;
    if (Date.now() - parsed.createdAt > MAX_AGE_MS) return null;
    return parsed as PendingActivation;
  } catch {
    return null;
  }
}

export function clearPendingSubscriptionActivation(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // fail-open
  }
}
