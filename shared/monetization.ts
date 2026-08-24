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
  /**
   * Recursos classificados como "Anúncios Pro".
   *
   * É uma capability do contrato, não um plano: `PlanType` continua `free | premium`. A separação
   * comercial Free/Pro/Premium só existirá quando houver runtime correspondente — até lá, quem tem
   * premium tem `proAds`.
   *
   * Consome-se por `canUseFeature(plan, 'proAds')`, o mesmo caminho de `charges` e `categories`.
   * Nenhum consumidor está ligado ainda: nesta etapa o contrato existe e a UI não o lê.
   */
  proAds: boolean;
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
      proAds: false,
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
      proAds: true,
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

/**
 * RELEASE-07 — qual provider de billing é dono da assinatura ATUAL. `planData/main` continua a ÚNICA
 * fonte de entitlement (mesmo documento, mesmo `isPremiumActive()` abaixo) — isto só registra QUEM
 * concedeu, nunca decide sozinho se o Premium está ativo (isso continua sendo `premiumExpiresAt` +
 * status, iguais para os dois providers).
 */
export type BillingProvider = 'mercado_pago' | 'google_play';

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
    /**
     * Conta dedicada à revisão do app pela Google Play (license testers / revisão manual da loja).
     * Concedida só por script administrativo (script/grant-play-review-access.ts), nunca por um
     * fluxo de billing real — nunca tem subscriptionId/purchaseToken/billingProvider associado.
     */
    | 'play_review'
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

  // --- Google Play Billing (RELEASE-07) — só preenchido quando billingProvider === 'google_play' ---
  billingProvider?: BillingProvider | null;
  /** Product ID do Google Play (revendasmart_premium_monthly/yearly) — nunca o purchaseToken. */
  playProductId?: string | null;
  /** sha256(purchaseToken) — nunca o token bruto. Usado só para idempotência/auditoria. */
  playPurchaseTokenHash?: string | null;
  playOrderId?: string | null;
  playPackageName?: string | null;
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

/**
 * RELEASE-09 — normaliza qualquer representação de data que `planData` possa carregar até um `Date`
 * utilizável, ou `null` quando não há data válida.
 *
 * O mesmo campo chega em formatos diferentes conforme o caminho: `Date` (escrito pelo Admin SDK),
 * `Timestamp` do Firestore (lido pelo Admin SDK ou pelo SDK web), o formato serializado em JSON de um
 * Timestamp (`{_seconds}` / `{seconds}`, que é o que `/api/plan/data` devolve ao browser) ou uma
 * string ISO (documentos legados). `new Date(timestamp)` devolveria `Invalid Date` em vários desses
 * casos, e uma data inválida numa comparação `now < expiry` é sempre `false` — ou seja, revogaria
 * silenciosamente o Premium de quem ainda tem período pago. Por isso a normalização é explícita.
 */
export function toEntitlementDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;

  if (typeof value === 'object') {
    const candidate = value as {
      toDate?: () => Date;
      _seconds?: number; seconds?: number;
      _nanoseconds?: number; nanoseconds?: number;
    };
    if (typeof candidate.toDate === 'function') {
      const converted = candidate.toDate();
      return converted instanceof Date && !Number.isNaN(converted.getTime()) ? converted : null;
    }
    const seconds = typeof candidate._seconds === 'number' ? candidate._seconds
      : typeof candidate.seconds === 'number' ? candidate.seconds
      : null;
    if (seconds !== null) {
      // Os nanossegundos importam: sem eles a data perde a fração de segundo e deixa de bater com o
      // instante original gravado no Firestore.
      const nanoseconds = typeof candidate._nanoseconds === 'number' ? candidate._nanoseconds
        : typeof candidate.nanoseconds === 'number' ? candidate.nanoseconds
        : 0;
      const fromSeconds = new Date(seconds * 1000 + Math.floor(nanoseconds / 1_000_000));
      return Number.isNaN(fromSeconds.getTime()) ? null : fromSeconds;
    }
    return null;
  }

  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  return null;
}

export function isPremiumActive(planData: PlanData | null): boolean {
  if (!planData) return false;

  const now = new Date();

  // RELEASE-09: o período pago manda sobre o status. Uma assinatura `authorized` cujo período já
  // venceu não pode continuar Premium só pelo rótulo do status (antes, este early-return pulava a
  // verificação de data por completo).
  const premiumExpiresAt = toEntitlementDate(planData.premiumExpiresAt);
  if (premiumExpiresAt && now.getTime() >= premiumExpiresAt.getTime()) {
    return false;
  }

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
    planData.premiumSource === 'referral_reward' ||
    planData.premiumSource === 'play_review';

  if (!hasDirectPremiumFlag) {
    return false;
  }

  // Sem data de término conhecida, o acesso é aberto (assinatura renovando, concessão de admin,
  // recompensa por indicação). Quando existe data, ela já foi validada acima.
  return true;
}

/**
 * RELEASE-16 §7 — fallback conservador para `planData` legado sem `billingProvider` persistido.
 * `billingProvider` só passou a ser gravado a partir do Google Play Billing (RELEASE-07); qualquer
 * documento mais antigo com evidência de assinatura Mercado Pago (`subscriptionId`/`subscriptionStatus`)
 * é MP por construção. NUNCA infere pelo dispositivo/plataforma atual — só por evidência server-owned
 * já persistida no próprio documento. Sem nenhuma evidência, devolve `null`: quem chama decide o
 * fallback seguro (nunca escolher um fluxo de cancelamento/gestão específico de provider sem certeza).
 */
export function resolveLegacyBillingProvider(planData: PlanData | null): BillingProvider | null {
  if (!planData) return null;
  if (planData.billingProvider === 'mercado_pago' || planData.billingProvider === 'google_play') {
    return planData.billingProvider;
  }
  if (planData.subscriptionId || planData.subscriptionStatus) return 'mercado_pago';
  if (planData.playPurchaseTokenHash || planData.playProductId) return 'google_play';
  return null;
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

/**
 * RELEASE-27: número de indicações validadas necessárias para conceder a recompensa (Premium por
 * `referral_reward`). Única fonte — server/routes.ts (que grava a recompensa) e a UI de indicação
 * (que mostra "X de N indicações") importam DAQUI, nunca um literal `3` duplicado em cada lugar.
 */
export const REFERRAL_REWARD_LIMIT = 3;

/**
 * RELEASE-28: formato do código público de indicação (`USER-XXXXXXXXX`, gerado em
 * server/routes.ts `/api/plan/initialize`). Único lugar onde o formato é definido — o servidor usa
 * para validar antes de consultar o Firestore, o client usa para decidir se um `?referral=` é um
 * código novo (resolve via API) ou um link antigo com UID bruto (compatibilidade, nunca gerado de
 * novo). Mudar o formato de geração sem atualizar este regex quebraria a detecção nos dois lados.
 */
export const REFERRAL_CODE_FORMAT = /^USER-[A-Z0-9]{9}$/;
export function isReferralCodeFormat(value: unknown): value is string {
  return typeof value === "string" && REFERRAL_CODE_FORMAT.test(value);
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

// =============================
// OWNER-ACCESS-02 — ROLE / BENEFIT GRANT / COMMERCIAL PLAN
// =============================
//
// Três conceitos deliberadamente separados, nunca misturados no mesmo campo:
//
// - ROLE (`admin` | `user`): quem PODE administrar o app — Firebase custom claim, ver server/admin-auth.ts.
//   Ortogonal a tudo abaixo; um admin não ganha benefícios Premium automaticamente só por ser admin (os
//   poucos lugares que hoje dão bypass de admin para uma feature específica — ex. Anúncios Pro,
//   PhotoRoom — já faziam isso antes desta rodada, via `isAdminUid()`, e continuam fazendo, sem relação
//   com o resolver abaixo).
// - BENEFIT GRANT (`none` | `tester` | `premium_plus`): concessão interna, nunca comprável, nunca gera
//   cobrança, decidida só por um admin. Vive em `users/{uid}/internalGrants/main` — documento SEPARADO
//   de `planData/main`, propositalmente: `planData` continua sendo o registro COMERCIAL (Mercado
//   Pago/Google Play/referral), nunca tocado por uma concessão interna.
// - COMMERCIAL PLAN (`free` | `premium` | futuros): o que `isPremiumActive()` acima já resolve a partir
//   de `planData` — inalterado por esta rodada.
//
// `resolveEntitlements()` é o único ponto que COMPÕE os três em uma decisão final de acesso — nunca um
// overwrite (testar/premium_plus não escrevem `currentPlan`/`premiumActive`/`premiumSource`; a decisão
// final é sempre "algum dos caminhos concede?"). Preparado para o NO_ADS futuro: `adsDisabled` é seu
// próprio campo, não um alias de `hasPremiumAccess` — um pacote NO_ADS futuro poderá desligar anúncios
// sem precisar conceder Premium completo (`ads.disabled = true` sem `premium = true`, como o ticket
// exige), bastando compor mais uma fonte aqui dentro sem quebrar os consumidores existentes.

export type Role = 'admin' | 'user';

export const BENEFIT_GRANTS = {
  NONE: 'none',
  TESTER: 'tester',
  PREMIUM_PLUS: 'premium_plus',
} as const;
export type BenefitGrant = typeof BENEFIT_GRANTS[keyof typeof BENEFIT_GRANTS];

export function isBenefitGrant(value: unknown): value is BenefitGrant {
  return value === 'none' || value === 'tester' || value === 'premium_plus';
}

// Firestore document: users/{uid}/internalGrants/main
export interface InternalGrantData {
  benefitGrant: BenefitGrant;
  grantedBy: string | null;
  grantedAt: unknown;
  reason: string | null;
  updatedAt: unknown;
}

export const DEFAULT_INTERNAL_GRANT: InternalGrantData = {
  benefitGrant: 'none',
  grantedBy: null,
  grantedAt: null,
  reason: null,
  updatedAt: null,
};

export type EntitlementSource = 'commercial' | 'tester_grant' | 'premium_plus_grant' | 'none';

export interface ResolvedEntitlements {
  /** Acesso completo a todos os recursos Premium — comercial OU concedido (tester/premium+). */
  hasPremiumAccess: boolean;
  isTester: boolean;
  isPremiumPlus: boolean;
  /**
   * Campo próprio, não um alias de `hasPremiumAccess` — de propósito, para o NO_ADS futuro (§7 do
   * ticket) poder desligar anúncios independente de conceder Premium completo. Hoje coincide com
   * `hasPremiumAccess` porque `noAds` já é um benefício do Premium atual (PLAN_CONFIG.premium.limits.noAds).
   */
  adsDisabled: boolean;
  source: EntitlementSource;
}

/**
 * Composição pura — nunca lê Firestore, nunca decide sozinha quem é admin. `resolveUserEntitlements`
 * (server/admin-grants.ts) é quem busca `planData`/`internalGrants` e chama esta função; o client usa a
 * MESMA função sobre o payload que o servidor já devolveu em `/api/plan/data/:userId` (ver
 * PlanProvider.tsx/usePlanData.ts), garantindo que os dois lados nunca divirjam sobre "quem tem Premium".
 */
export function resolveEntitlements(
  planData: PlanData | null,
  grant: Pick<InternalGrantData, 'benefitGrant'> | null | undefined,
): ResolvedEntitlements {
  const commercialPremium = isPremiumActive(planData);
  const isTester = grant?.benefitGrant === 'tester';
  const isPremiumPlus = grant?.benefitGrant === 'premium_plus';
  const hasPremiumAccess = commercialPremium || isTester || isPremiumPlus;

  const source: EntitlementSource = isPremiumPlus
    ? 'premium_plus_grant'
    : isTester
      ? 'tester_grant'
      : commercialPremium
        ? 'commercial'
        : 'none';

  return {
    hasPremiumAccess,
    isTester,
    isPremiumPlus,
    adsDisabled: hasPremiumAccess,
    source,
  };
}

// =============================
// AUDIT LOG — concessões internas (§14 do ticket)
// =============================

export const GRANT_AUDIT_ACTIONS = {
  GRANT_TESTER: 'GRANT_TESTER',
  REVOKE_TESTER: 'REVOKE_TESTER',
  GRANT_PREMIUM_PLUS: 'GRANT_PREMIUM_PLUS',
  REVOKE_PREMIUM_PLUS: 'REVOKE_PREMIUM_PLUS',
} as const;
export type GrantAuditAction = typeof GRANT_AUDIT_ACTIONS[keyof typeof GRANT_AUDIT_ACTIONS];

export function isGrantAuditAction(value: unknown): value is GrantAuditAction {
  return value === 'GRANT_TESTER' || value === 'REVOKE_TESTER' || value === 'GRANT_PREMIUM_PLUS' || value === 'REVOKE_PREMIUM_PLUS';
}

// Firestore document: adminGrantAuditLog/{autoId} — write-only pelo servidor, nunca lido pelo client
// (nenhuma tela pede para exibir o log; existe só para responsabilização/auditoria).
export interface GrantAuditLogEntry {
  actorUid: string;
  targetUid: string;
  action: GrantAuditAction;
  previousState: BenefitGrant;
  newState: BenefitGrant;
  reason: string | null;
  timestamp: unknown;
}