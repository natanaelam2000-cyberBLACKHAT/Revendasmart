/**
 * RevendaSmart — Monetization Structures
 * Plans, Referral, and Limits
 */
const UNLIMITED = -1;
export const PLANS = {
  FREE: 'free',
  PREMIUM: 'premium',
} as const;

export type PlanType = typeof PLANS[keyof typeof PLANS];

export interface PlanLimits {
  products: number;
  clients: number;
  niches: number;
  categories: boolean;
  sales: boolean;
  charges: boolean;
  productHighlight: boolean;
  professionalCatalog: boolean;
  noAds: boolean;
}

export interface PlanInfo {
  name: string;
  price: number | null;
  currency: string;
  limits: PlanLimits;
  features: string[];
  color: string;
}

export const PLAN_CONFIG: Record<PlanType, PlanInfo> = {
  free: {
    name: 'Plano Grátis',
    price: 0,
    currency: 'BRL',
    limits: {
      products: 30,
      clients: 50,
      niches: 1,
      categories: false,
      sales: true,
      charges: false,
      productHighlight: false,
      professionalCatalog: false,
      noAds: false,
    },
    features: [
      'Até 30 produtos',
      'Até 50 clientes',
      'Cadastro de vendas',
      'Catálogo básico',
      '1 tipo de negócio',
      'Suporte por e-mail',
      'Ajuda e tutorial',
    ],
    color: 'bg-gray-100',
  },
  premium: {
    name: 'Plano Premium',
    price: null,
    currency: 'BRL',
    limits: {
     products: UNLIMITED,
    clients: UNLIMITED,
    niches: UNLIMITED,
      categories: true,
      sales: true,
      charges: true,
      productHighlight: true,
      professionalCatalog: true,
      noAds: true,
    },
    features: [
      'Produtos ilimitados',
      'Clientes ilimitados',
      'Multi-nicho completo',
      'Categorias personalizadas',
      'Cobranças e links de pagamento',
      'Destaque de produtos',
      'Catálogo profissional',
      'Futuras funções de marketing e IA',
      'Sem anúncios',
    ],
    color: 'bg-amber-50',
  },
};

// Subscription status from Mercado Pago PreApproval
export type SubscriptionStatus =
  | 'authorized'
  | 'paused'
  | 'cancelled'
  | 'pending'
  | 'expired';

// Firestore document: users/{uid}/planData/main
export interface PlanData {
  currentPlan: PlanType;
  premiumActive: boolean;
  premiumExpiresAt: Date | null;
  premiumStartedAt: Date | null;
  premiumSource:
    | 'direct_purchase'
    | 'referral_reward'
    | 'admin'
    | 'manual'
    | 'subscription'
    | null;
  referralCode: string;
  referralCount: number;
  updatedAt: Date;

  subscriptionId: string | null;
  subscriptionStatus: SubscriptionStatus | null;
  subscriptionPlanId: string | null;
  autoRenew: boolean;
  lastPaymentAt: Date | null;
  nextBillingAt: Date | null;
  canceledAt: Date | null;
  paymentStatus: string | null;
}

// Firestore document: system/config
export interface GlobalConfig {
  premiumOpenAccess: boolean;
  premiumOpenAccessUntil: Date | null;
  premiumOpenAccessMessage: string | null;
}

export const DEFAULT_GLOBAL_CONFIG: GlobalConfig = {
  premiumOpenAccess: false,
  premiumOpenAccessUntil: null,
  premiumOpenAccessMessage: null,
};

export function isPremiumActive(planData: PlanData | null): boolean {
  if (!planData) return false;

  const now = new Date();

  if (planData.subscriptionStatus === 'authorized') {
    return true;
  }

  const hasDirectPremiumFlag =
    planData.premiumActive === true ||
    planData.currentPlan === PLANS.PREMIUM ||
    planData.premiumSource === 'admin' ||
    planData.premiumSource === 'manual' ||
    planData.premiumSource === 'direct_purchase' ||
    planData.premiumSource === 'subscription' ||
    planData.premiumSource === 'referral_reward';

  if (!hasDirectPremiumFlag) {
    return false;
  }

  if (!planData.premiumExpiresAt) {
    return true;
  }

  return now < new Date(planData.premiumExpiresAt);
}

export function getActivePlan(planData: PlanData | null): PlanType {
  return isPremiumActive(planData) ? PLANS.PREMIUM : PLANS.FREE;
}

export function getEffectivePlan(
  planData: PlanData | null,
  globalConfig: GlobalConfig | null
): PlanType {
  if (isPremiumActive(planData)) {
    return PLANS.PREMIUM;
  }

  if (globalConfig?.premiumOpenAccess) {
    if (globalConfig.premiumOpenAccessUntil) {
      if (new Date() >= new Date(globalConfig.premiumOpenAccessUntil)) {
        return PLANS.FREE;
      }
    }
    return PLANS.PREMIUM;
  }

  return PLANS.FREE;
}

export function isPremiumFromGlobalAccess(
  planData: PlanData | null,
  globalConfig: GlobalConfig | null
): boolean {
  if (isPremiumActive(planData)) return false;
  if (!globalConfig?.premiumOpenAccess) return false;

  if (globalConfig.premiumOpenAccessUntil) {
    return new Date() < new Date(globalConfig.premiumOpenAccessUntil);
  }

  return true;
}

export function isPremiumOpenAccessActive(globalConfig: GlobalConfig | null): boolean {
  if (!globalConfig?.premiumOpenAccess) return false;

  if (globalConfig.premiumOpenAccessUntil) {
    return new Date() < new Date(globalConfig.premiumOpenAccessUntil);
  }

  return true;
}

export function getEffectivePlanWithOverrides(
  planData: PlanData | null,
  globalConfig: GlobalConfig | null
): PlanType {
  if (isPremiumOpenAccessActive(globalConfig)) {
    return PLANS.PREMIUM;
  }
  return getActivePlan(planData);
}

// Generate referral code from UID
export function generateReferralCode(uid: string): string {
  const hash = uid.split('').reduce((acc, char) => {
    return ((acc << 5) - acc) + char.charCodeAt(0);
  }, 0);
  const encoded = Math.abs(hash).toString(36).substring(0, 9).toUpperCase();
  return `USER-${encoded}`;
}
// =============================
// LIMIT HELPERS (FALTANTES)
// =============================

export function canAddProduct(plan: PlanType, currentCount: number): boolean {
  const limit = PLAN_CONFIG[plan].limits.products;

  if (limit === UNLIMITED) return true;

  return currentCount < limit;
}

export function canAddClient(plan: PlanType, currentCount: number): boolean {
  const limit = PLAN_CONFIG[plan].limits.clients;

  if (limit === UNLIMITED) return true;

  return currentCount < limit;
}

export function canUseFeature(plan: PlanType, feature: keyof PlanLimits): boolean {
  const value = PLAN_CONFIG[plan].limits[feature];

  // Se for boolean (feature tipo premium)
  if (typeof value === 'boolean') return value;

  // Se for número (tipo limite), significa que pode usar
  return true;
}