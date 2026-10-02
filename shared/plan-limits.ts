/**
 * RevendaSmart — Limites Canônicos por Plano
 * Contrato canônico isolado para consumo de providers e verificações de limites sem puxar
 * estruturas completas de apresentação ou precificação comercial.
 */
export const UNLIMITED = -1;

export const PLANS = {
  FREE: 'free',
  PRO: 'pro',
  PREMIUM: 'premium',
} as const;

export type PlanType = typeof PLANS[keyof typeof PLANS];

export interface PlanLimits {
  products: number;
  clients: number;
  services: number;
  bookingsMonthly: number;
  proAdPreparationsMonthly: number;
  niches: number;
  categories: boolean;
  sales: boolean;
  charges: boolean;
  productHighlight: boolean;
  professionalCatalog: boolean;
  noAds: boolean;
  proAds: boolean;
}

export const PLAN_LIMITS: Record<PlanType, PlanLimits> = {
  free: {
    products: 30,
    clients: 50,
    services: 5,
    bookingsMonthly: 20,
    proAdPreparationsMonthly: 0,
    niches: 1,
    categories: false,
    sales: true,
    charges: false,
    productHighlight: false,
    professionalCatalog: false,
    noAds: false,
    proAds: false,
  },
  pro: {
    products: 500,
    clients: 2000,
    services: 50,
    bookingsMonthly: UNLIMITED,
    proAdPreparationsMonthly: 3,
    niches: UNLIMITED,
    categories: true,
    sales: true,
    charges: true,
    productHighlight: true,
    professionalCatalog: true,
    noAds: true,
    proAds: true,
  },
  premium: {
    products: 2000,
    clients: 10000,
    services: 200,
    bookingsMonthly: UNLIMITED,
    proAdPreparationsMonthly: 100,
    niches: UNLIMITED,
    categories: true,
    sales: true,
    charges: true,
    productHighlight: true,
    professionalCatalog: true,
    noAds: true,
    proAds: true,
  },
};
