import { PLAN_CONFIG, PlanType, canAddProduct, canAddClient, canUseFeature, isPremiumOpenAccessActive } from '@shared/monetization';

/**
 * Client-side plan validation helpers
 */

export function checkProductLimit(
  plan: PlanType,
  currentCount: number,
  openAccess = false
): { allowed: boolean; limit: number } {

  // ADMIN / PREMIUM = ILIMITADO
  if (openAccess || plan === "premium" || plan === "admin") {
    return { allowed: true, limit: Infinity };
  }

  // fallback segurança
  if (!plan) {
    return { allowed: true, limit: Infinity };
  }

  const allowed = canAddProduct(plan, currentCount);
  const limit = PLAN_CONFIG[plan]?.limits?.products || 9999;

  return { allowed, limit };
}
  const allowed = canAddProduct(plan, currentCount);
  const limit = PLAN_CONFIG[plan].limits.products;
  return { allowed, limit };
}

export function checkClientLimit(plan: PlanType, currentCount: number, openAccess = false): { allowed: boolean; limit: number } {
  if (openAccess) return { allowed: true, limit: Infinity };
  const allowed = canAddClient(plan, currentCount);
  const limit = PLAN_CONFIG[plan].limits.clients;
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
  return canUseFeature(plan, 'multiNiche');
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

export function shouldBypassLimits(globalConfig: { premiumOpenAccess: boolean; premiumOpenAccessUntil: Date | null } | null, hasPremiumAccess: boolean): boolean {
  return hasPremiumAccess || isPremiumOpenAccessActive(globalConfig);
}

// Mensagens de bloqueio
export const UPGRADE_MESSAGES = {
  PRODUCTS_LIMIT: 'Você atingiu o limite de 30 produtos no plano Grátis. Upgrade para Premium para produtos ilimitados.',
  CLIENTS_LIMIT: 'Você atingiu o limite de 50 clientes no plano Grátis. Upgrade para Premium para clientes ilimitados.',
  CHARGES_FEATURE: 'Cobranças e links de pagamento são recursos Premium. Faça upgrade para começar a cobrar seus clientes.',
  HIGHLIGHT_FEATURE: 'Destaque de produtos é um recurso Premium. Faça upgrade para destacar seus produtos.',
  CATEGORIES_FEATURE: 'Categorias personalizadas são um recurso Premium. Faça upgrade para personalizar suas categorias.',
  MULTINICHE_FEATURE: 'Multi-nicho é um recurso Premium. Faça upgrade para gerenciar múltiplos tipos de negócio.',
} as const;
