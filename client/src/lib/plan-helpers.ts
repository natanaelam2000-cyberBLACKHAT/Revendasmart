import { PLAN_CONFIG, PlanType, canAddProduct, canAddClient, canAddService, canUseFeature, isPremiumOpenAccessActive, type GlobalConfig } from '@shared/monetization';

/**
 * Client-side plan validation helpers
 */

  // fallback segurança
export function checkProductLimit(
  plan: PlanType | "admin" | null | undefined,
  currentCount: number,
  openAccess = false
): { allowed: boolean; limit: number } {

  // PLAN-IMPL-01 §5/§8: "premium" used to be hardcoded unlimited here, back when
  // PLAN_CONFIG.premium.limits.products really was UNLIMITED (-1). Now that Premium has a real,
  // finite cap (2000), a plan-specific bypass would silently ignore it — canAddProduct already
  // handles "unlimited" correctly via the UNLIMITED sentinel, for whichever tier actually has it, so
  // there's no need to special-case any specific plan name here. ADMIN keeps its own explicit bypass.
  if (openAccess || plan === "admin") {
    return { allowed: true, limit: Infinity };
  }

  if (!plan) {
    return { allowed: true, limit: Infinity };
  }

  const allowed = canAddProduct(plan, currentCount);
  const limit = PLAN_CONFIG[plan]?.limits?.products || 9999;

  return { allowed, limit };
}

export function checkClientLimit(plan: PlanType, currentCount: number, openAccess = false): { allowed: boolean; limit: number } {
  if (openAccess) return { allowed: true, limit: Infinity };
  const allowed = canAddClient(plan, currentCount);
  const limit = PLAN_CONFIG[plan].limits.clients;
  return { allowed, limit };
}

/**
 * PLAN-IMPL-01 §11 — contrato/helper apenas, mesmo formato de checkClientLimit. Nenhuma tela de
 * Serviços chama esta função ainda (SERVICES_RUNTIME_BEHAVIOR_CHANGED = NO neste ticket) — existe
 * para PLAN-IMPL-02 aplicar de verdade.
 */
export function checkServiceLimit(plan: PlanType, currentCount: number, openAccess = false): { allowed: boolean; limit: number } {
  if (openAccess) return { allowed: true, limit: Infinity };
  const allowed = canAddService(plan, currentCount);
  const limit = PLAN_CONFIG[plan].limits.services;
  return { allowed, limit };
}
export function checkChargesFeature(plan: PlanType, openAccess = false): boolean {
  if (openAccess) return true;
  return canUseFeature(plan, 'charges');
}

export function checkHighlightFeature(plan: PlanType, openAccess = false): boolean {
  if (openAccess) return true;
  return canUseFeature(plan, 'productHighlight');
}

export function checkCategoriesFeature(plan: PlanType, openAccess = false): boolean {
  if (openAccess) return true;
  return canUseFeature(plan, 'categories');
}

export function checkMultiNicheFeature(plan: PlanType, openAccess = false): boolean {
  if (openAccess) return true;
  return PLAN_CONFIG[plan].limits.niches !== 1;
}

export function getPlanName(plan: PlanType): string {
  return PLAN_CONFIG[plan].name;
}

export function getPlanFeatures(plan: PlanType): string[] {
  return PLAN_CONFIG[plan].features;
}

export function getPlanColor(plan: PlanType): string {
  return PLAN_CONFIG[plan].color;
}

export function shouldBypassLimits(globalConfig: GlobalConfig | null, hasPremiumAccess: boolean): boolean {
  return hasPremiumAccess || isPremiumOpenAccessActive(globalConfig);
}

export { formatTrialDaysRemaining } from './trial-format';

// Mensagens de bloqueio
export const UPGRADE_MESSAGES = {
  PRODUCTS_LIMIT: 'Você atingiu o limite de 30 produtos no plano Grátis. Upgrade para Premium para produtos ilimitados.',
  CLIENTS_LIMIT: 'Você atingiu o limite de 50 clientes no plano Grátis. Upgrade para Premium para clientes ilimitados.',
  CHARGES_FEATURE: 'Cobranças e links de pagamento são recursos Premium. Faça upgrade para começar a cobrar seus clientes.',
  HIGHLIGHT_FEATURE: 'Destaque de produtos é um recurso Premium. Faça upgrade para destacar seus produtos.',
  CATEGORIES_FEATURE: 'Categorias personalizadas são um recurso Premium. Faça upgrade para personalizar suas categorias.',
  MULTINICHE_FEATURE: 'Multi-nicho é um recurso Premium. Faça upgrade para gerenciar múltiplos tipos de negócio.',
} as const;
