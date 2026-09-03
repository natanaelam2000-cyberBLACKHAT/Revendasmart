/**
 * RevendaSmart — Monetization Structures
 * Plans, Referral, and Limits
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
  /** PLAN-IMPL-01 — contrato apenas: nenhum caminho de criação de serviço lê este campo ainda
   * (PLAN-IMPL-02 fará a aplicação real, downgrade-safe). */
  services: number;
  /** PLAN-IMPL-01 — contrato apenas, mesmo motivo de `services`. Usa o mesmo sentinela `UNLIMITED`
   * (-1) de `products`/`clients` para Pro/Premium ("fair use", nunca um teto comercial baixo). */
  bookingsMonthly: number;
  /**
   * Preparações NOVAS de Anúncios Pro por ciclo mensal — contrato apenas (PLAN-IMPL-01 §6).
   *
   * NÃO é lido pelo rate limiter (`server/marketing-pro-rate-limit-firestore.ts`, diário) nem pelo
   * cost guard (`server/marketing-pro-cost-guard.ts`, teto global em USD) — nenhum dos dois muda
   * neste ticket. A aplicação real deste campo (contador mensal por usuário, distinguindo geração
   * nova de reaproveitamento de cutout aprovado) é PLAN-IMPL-05.
   */
  proAdPreparationsMonthly: number;
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
   * PLAN-IMPL-01: `PlanType` agora inclui `pro`, e o contrato já expressa que Pro e Premium têm
   * `proAds` — mas isso NUNCA muda o rollout público real. Anúncios Pro continua gated por admin no
   * servidor (`server/marketing-pro.ts`) e por `canUseFeature(activePlan, 'proAds')` no client — e
   * hoje não existe nenhum caminho real (checkout, admin grant) que resulte num usuário com
   * `activePlan === 'pro'`, então este `true` é inatingível na prática até PLAN-IMPL-03/04 existirem.
   * A liberação pública em si e a quota mensal (`proAdPreparationsMonthly`) são PLAN-IMPL-05.
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
    features: [
      'Até 30 produtos',
      'Até 50 clientes',
      'Até 5 serviços',
      'Cadastro de vendas',
      'Catálogo básico',
      '1 tipo de negócio',
      'Suporte por e-mail',
      'Ajuda e tutorial',
    ],
    color: 'bg-gray-100',
  },
  // PLAN-IMPL-01 §3/§5 — nível comercial novo, entre Free e Premium. Booleanos/niches iguais aos do
  // Premium (a lista de recursos Pro em PLAN-DEFINITION-01 §2 já é "tudo do Free + operação
  // profissional completa"; o que diferencia Premium de Pro é a camada de inteligência/marketing
  // avançado — PLAN-DEFINITION-01 §3 —, não estes flags booleanos existentes). Só produtos/clientes/
  // serviços/preparações Ads Pro têm valor próprio, menor que o do Premium.
  pro: {
    name: 'Plano Pro',
    price: null,
    currency: 'BRL',
    limits: {
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
    features: [
      'Até 500 produtos',
      'Até 2.000 clientes',
      'Até 50 serviços',
      'Agendamentos sem teto comercial baixo',
      'CRM e financeiro completos',
      'Catálogo profissional',
      'Serviços completo (agenda, orçamentos, reagendamento)',
      'Campanhas e sorteios completos',
      '3 preparações profissionais de Anúncios Pro por mês',
      'Sem anúncios externos',
    ],
    color: 'bg-indigo-50',
  },
  premium: {
    name: 'Plano Premium',
    price: null,
    currency: 'BRL',
    limits: {
      // PLAN-IMPL-01 §5 — antes UNLIMITED (-1): a auditoria (PLAN-AUDIT-01/02) confirmou que isso
      // divergia do contrato comercial (PLAN-DEFINITION-01 §3, tetos generosos mas finitos, para
      // manter o modelo de custo previsível). Vendas continuam sem limite artificial (`sales: true`,
      // nunca comparado a uma contagem) — só produtos/clientes/serviços ganham teto.
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
    features: [
      'Até 2.000 produtos',
      'Até 10.000 clientes',
      'Até 200 serviços',
      'Multi-nicho completo',
      'Categorias personalizadas',
      'Cobranças e links de pagamento',
      'Destaque de produtos',
      'Catálogo profissional',
      'Inteligência comercial e ação (Premium)',
      '100 preparações profissionais de Anúncios Pro por mês',
      'Sem anúncios',
    ],
    color: 'bg-amber-50',
  },
};

/**
 * PLAN-IMPL-01 §12/§13 — preço-alvo comercial (PLAN-DEFINITION-01 §2/§3), mantido SEPARADO de
 * `PLAN_CONFIG[plan].price` de propósito: essa metadata ainda não está conectada a nenhum preço
 * exibido ou cobrado de verdade. O preço realmente cobrado hoje (`server/subscriptions.ts`,
 * `PREMIUM_PRICE_BRL`) e o preço exibido hoje (`client/src/pages/subscribe.tsx`,
 * `VITE_PREMIUM_PRICE_BRL`) são cada um controlado por uma env var de produção DIFERENTE, cujo valor
 * real não pode ser verificado nem alterado com segurança a partir deste ticket — mudar a UI sem
 * garantir que o valor cobrado mudou junto criaria exatamente a divergência que PLAN-IMPL-01 §13
 * proíbe. `PLAN_PRICING` existe para PLAN-IMPL-03/04 terem uma única fonte a consumir quando a
 * ativação do preço real for resolvida — não espalhar 49.90/79.90/499/799 por arquivos novos até lá.
 */
export const PLAN_PRICING: Record<PlanType, { readonly monthly: number; readonly annual: number }> = {
  free: { monthly: 0, annual: 0 },
  pro: { monthly: 49.90, annual: 499 },
  premium: { monthly: 79.90, annual: 799 },
};

/**
 * PLAN-IMPL-04A §5/§6/§8 — metadata de APRESENTAÇÃO comercial (posicionamento, destaque, benefícios
 * vendáveis hoje), deliberadamente separada de `PLAN_CONFIG` (limites/flags técnicos) e `PLAN_PRICING`
 * (preço-alvo): nome vem de `PLAN_CONFIG[plan].name`, preço de `PLAN_PRICING[plan]`, números de
 * `PLAN_CONFIG[plan].limits` — nada aqui duplica esses valores, só adiciona o que não existia.
 *
 * `sellableHighlights` é uma lista NOVA e deliberadamente mais conservadora que `PLAN_CONFIG[plan].features`
 * (que continua existindo, inalterada, para quem já a consome) — `features` inclui promessas §7 proíbe
 * vender agora (preparações de Anúncios Pro, inteligência Premium — ver o comentário de `proAds` acima,
 * "inatingível na prática até PLAN-IMPL-03/04 existirem"). `sellableHighlights` só lista o que o runtime
 * atual realmente entrega. Pro e Premium hoje têm os MESMOS flags booleanos (categories/charges/
 * productHighlight/professionalCatalog/noAds — ver o comentário acima de `PLAN_CONFIG.pro`: o que
 * diferencia os dois ainda é só a camada de inteligência, que não existe em runtime) — por isso Premium
 * não re-anuncia esses booleanos como se fossem exclusivos dela (seria falso); ela vende capacidade maior
 * (§39: "Seu plano tem a maior capacidade atual"), nunca um recurso booleano inexistente.
 */
export interface PlanPresentation {
  /** Forma curta para contexto compacto (card, CTA, badge) — "Pro", não "Plano Pro". Para o nome
   * completo já usado em superfícies existentes (`plan-usage.tsx` etc.), continue usando
   * `PLAN_CONFIG[plan].name`; os dois convivem de propósito, um não substitui o outro. */
  readonly title: string;
  readonly positioning: string;
  readonly highlighted: boolean;
  readonly badge: string | null;
  readonly sellableHighlights: readonly string[];
}

export const PLAN_PRESENTATION: Record<PlanType, PlanPresentation> = {
  free: {
    title: 'Grátis',
    positioning: 'Comece',
    highlighted: false,
    badge: null,
    sellableHighlights: [
      'Até 30 produtos',
      'Até 50 clientes',
      'Até 5 serviços',
      'Até 20 agendamentos por mês',
      'Vendas sem limite',
      'Catálogo público',
    ],
  },
  pro: {
    title: 'Pro',
    positioning: 'Profissionalize',
    highlighted: true,
    badge: 'Mais Popular',
    sellableHighlights: [
      'Até 500 produtos',
      'Até 2.000 clientes',
      'Até 50 serviços',
      'Agendamentos sem o limite mensal do Free',
      'Categorias personalizadas',
      'Cobranças e links de pagamento',
      'Catálogo profissional',
      // PLAN-IMPL-05 §37 — só entrou aqui depois do runtime real existir (proAdPreparationsMonthly
      // agora é aplicado de verdade, server/ads-pro-preparation-quota.ts). Nunca "anúncios": a unidade
      // vendida é o produto preparado, reutilizável em quantos anúncios o dono quiser depois.
      '3 novos produtos preparados profissionalmente por mês',
      'Sem anúncios',
    ],
  },
  premium: {
    title: 'Premium',
    positioning: 'Cresça',
    highlighted: false,
    badge: null,
    sellableHighlights: [
      'Até 2.000 produtos',
      'Até 10.000 clientes',
      'Até 200 serviços',
      'Agendamentos sem o limite mensal do Free',
      'Tudo do Pro',
      // PLAN-IMPL-05 §37 — mesmo motivo do Pro acima; número próprio (não "tudo do Pro", que já cobre o
      // resto da lista) porque a cota é diferente (100 vs. 3).
      '100 novos produtos preparados profissionalmente por mês',
      'A maior capacidade atual da plataforma',
    ],
  },
};

/**
 * PLAN-IMPL-04B §31 — mesmos valores de PLAN_PRICING, em centavos, para o único lugar que de fato cria
 * uma cobrança (server/subscriptions.ts's PreApproval.create) nunca precisar calcular dinheiro a partir
 * de float. `PLAN_PRICING` continua a fonte para APRESENTAÇÃO (client, já em uso, já testada, nunca
 * tocada por este ticket); `PLAN_PRICE_CENTS` é a fonte para COBRANÇA. Um teste garante que os dois
 * nunca divergem (cents/100 === PLAN_PRICING), então nunca há duas verdades sobre o mesmo preço.
 */
export const PLAN_PRICE_CENTS: Record<PlanType, { readonly monthly: number; readonly annual: number }> = {
  free: { monthly: 0, annual: 0 },
  pro: { monthly: 4990, annual: 49900 },
  premium: { monthly: 7990, annual: 79900 },
};

export type BillingCycle = 'monthly' | 'annual';

/**
 * PLAN-IMPL-04A §26/§29/§57 — único lugar que define "perto do limite" (80%): nenhum componente deve
 * repetir o número 0.8. `limit === UNLIMITED` nunca é "perto do limite" (mesma semântica de
 * canAddProduct/canAddService/canAddClient — sentinel nunca comparado como se fosse um teto real).
 */
export const PLAN_USAGE_NEAR_LIMIT_RATIO = 0.8;

export function isNearPlanLimit(used: number, limit: number): boolean {
  if (limit === UNLIMITED || limit <= 0) return false;
  return used < limit && used >= limit * PLAN_USAGE_NEAR_LIMIT_RATIO;
}

/**
 * PLAN-IMPL-04A §37 — regra V1 deliberadamente simples (sem IA/scoring): Free recomenda Pro, Pro
 * recomenda Premium, Premium não recomenda nada (§39 — sem upgrade pressure, ela já é o teto comercial).
 */
export function recommendedUpgradePlan(currentPlan: PlanType): PlanType | null {
  if (currentPlan === PLANS.FREE) return PLANS.PRO;
  if (currentPlan === PLANS.PRO) return PLANS.PREMIUM;
  return null;
}

/**
 * PLAN-IMPL-04A §15/§49, estendido por PLAN-IMPL-04B §12/§13/§29 — shape puro (sem lógica) de
 * `GET /api/plans/purchase-availability` (server/plan-purchase-availability.ts). Vive aqui, não em
 * server/, para o client poder tipar a resposta sem importar um módulo que lê `process.env` (Node-only,
 * não existe no bundle do Vite).
 *
 * `pricing_configuration_mismatch` (§13) — o "price match gate": o valor realmente configurado para
 * cobrança não bate o alvo canônico (PLAN_PRICE_CENTS). Isto é o que torna estruturalmente impossível
 * a UI mostrar R$79,90 e o checkout cobrar R$19,90 — nunca `available: true` quando os dois divergem.
 * `not_supported_by_provider` (§29) — cadência anual: a API do Mercado Pago (PreApproval.auto_recurring)
 * só documenta `frequency_type: "days"|"months"`, sem cadência anual nativa; permanece `false` sempre,
 * a UI continua mostrando o preço-alvo anual só como referência (nunca um checkout fake).
 */
export type PurchaseUnavailableReason =
  | "provider_not_configured"
  | "pricing_v2_not_activated"
  | "pricing_configuration_mismatch"
  | "not_supported_by_provider";

export interface PlanPurchaseAvailabilityEntry {
  readonly available: boolean;
  readonly reason: PurchaseUnavailableReason | null;
}

export interface PlanPurchaseAvailability {
  readonly pro: PlanPurchaseAvailabilityEntry;
  readonly premium: PlanPurchaseAvailabilityEntry;
  readonly annual: PlanPurchaseAvailabilityEntry;
}

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

  // --- PLAN-IMPL-03: trial Premium de 7 dias, EFFECTIVE-only — nunca escreve currentPlan/premiumActive/
  // premiumSource (esses continuam descrevendo só o plano BASE: assinatura/admin/indicação). Ausente =
  // conta nunca elegível/nunca concedida (nenhuma migração retroativa para contas legadas). Server-owned,
  // sem regra dedicada em firestore.rules pelo mesmo motivo de planData inteiro (§10 do ticket): o
  // catch-all `match /{document=**} { allow read, write: if false }` já cobre o documento inteiro.
  trialStatus?: 'active' | 'expired' | 'converted' | null;
  trialStartedAt?: Date | null;
  trialEndsAt?: Date | null;
  /** Contrato apenas — hoje sempre 'premium' (§6/§7 do ticket); existe para o resolver nunca precisar
   * de um `if (trial) return PREMIUM` hardcoded caso um trial de outro tier venha a existir depois. */
  trialGrantedPlan?: PlanType | null;

  // --- PLAN-IMPL-03: marca de transição de plano EFETIVO já reconciliado (Products/Services), para
  // ensurePlanLifecycleCurrent (server/plan-lifecycle.ts) nunca rodar reconcilePlanAccess mais de uma vez
  // pela MESMA transição (§26-28 do ticket) — comparado a cada leitura, nunca usado para decidir o valor
  // do plano efetivo em si (que é sempre recalculado do zero a partir de trial+base, nunca deste cache).
  lastAppliedEffectivePlan?: PlanType | null;
  lastLifecycleEvaluatedAt?: Date | null;

  // --- PLAN-IMPL-04B: representação genérica de assinatura paga para compras NOVAS (Pro ou Premium
  // v2) — nunca escrita por uma assinatura legada (que continua inteiramente nos campos premiumActive/
  // premiumExpiresAt/premiumSource acima, intocados). `pricingVersion` presente é o próprio sinal de
  // "isto é uma compra nova"; sua ausência é o sinal de "isto é legado" (§4/§6 do ticket — nenhuma
  // migração, nenhuma reescrita retroativa). `currentPlan` já é genérico (PlanType) e é reaproveitado
  // como está — nunca um segundo campo paralelo só para "qual plano pago" (minimização de campos, §2 do
  // ticket). `paidThrough` é o equivalente genérico de `premiumExpiresAt` (mesma semântica exata: null =
  // renovando/sem fim conhecido; uma data = carência até quando o acesso já pago continua valendo depois
  // de cancelar) — deliberadamente um campo NOVO e SEPARADO, nunca compartilhado com premiumExpiresAt,
  // para nenhuma assinatura legada jamais ser afetada por esta lógica nova.
  paidThrough?: Date | null;
  pricingVersion?: 'v2' | null;
  billingCycle?: BillingCycle | null;
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

export function isPremiumActive(planData: PlanData | null, now: Date = new Date()): boolean {
  if (!planData) return false;

  // RELEASE-09: o período pago manda sobre o status. Uma assinatura `authorized` cujo período já
  // venceu não pode continuar Premium só pelo rótulo do status (antes, este early-return pulava a
  // verificação de data por completo).
  const premiumExpiresAt = toEntitlementDate(planData.premiumExpiresAt);
  if (premiumExpiresAt && now.getTime() >= premiumExpiresAt.getTime()) {
    return false;
  }

  // PLAN-IMPL-04B: uma assinatura Premium v2 grava carência em `paidThrough`, não `premiumExpiresAt`
  // (campo exclusivamente legado). Mesma regra RELEASE-09 acima, campo novo — sem isto, um v2 expirado
  // "sobreviveria" via `hasDirectPremiumFlag` logo abaixo, já que `currentPlan` continua "premium" como
  // registro histórico da última compra. Isto é sempre um no-op para documentos legados: eles nunca têm
  // `paidThrough` gravado.
  const paidThrough = toEntitlementDate(planData.paidThrough);
  if (paidThrough && now.getTime() >= paidThrough.getTime()) {
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

/**
 * PLAN-IMPL-03 §13/§16 — puro (nunca lê Firestore), sempre pelo relógio do SERVIDOR: `now` é injetável
 * só para teste (§50 do ticket — nenhuma data hardcoded), nunca vem do client. Um trial só conta como
 * ativo com `trialStatus === 'active'` E `now` ainda antes de `trialEndsAt` — a expiração em si nunca
 * precisa de um job/cron para "acontecer" (§25): ela já é verdadeira aqui no instante em que `now`
 * ultrapassa `trialEndsAt`, mesmo que o rótulo `trialStatus` armazenado ainda diga "active" até a
 * próxima passagem de `ensurePlanLifecycleCurrent` (server/plan-lifecycle.ts) atualizá-lo.
 */
export function isTrialCurrentlyActive(planData: PlanData | null, now: Date = new Date()): boolean {
  if (!planData || planData.trialStatus !== 'active') return false;
  const endsAt = toEntitlementDate(planData.trialEndsAt);
  return endsAt !== null && now.getTime() < endsAt.getTime();
}

/**
 * PLAN-IMPL-04B §2/§3 — mecanismo GENÉRICO de assinatura paga (Pro ou Premium v2), paralelo a
 * `isPremiumActive` mas nunca compartilhando seus campos: `pricingVersion` ausente = nenhuma
 * assinatura v2 nesta conta (toda conta legada cai aqui, devolve null, e resolveBaseCommercialPlan
 * cai no fallback de isPremiumActive logo abaixo — comportamento 100% inalterado para quem já tinha
 * Premium 19,90 antes deste ticket). Mesma semântica de carência de `premiumExpiresAt`: `paidThrough`
 * null = renovando/sem fim conhecido; uma data no passado = acesso encerrado; uma data no futuro =
 * cancelado mas ainda dentro do período já pago (§25/§26 do ticket — mesma garantia, campo separado).
 */
export function resolveGenericPaidPlan(planData: PlanData | null, now: Date = new Date()): PlanType | null {
  if (!planData || !planData.pricingVersion) return null;
  const plan = planData.currentPlan === PLANS.PRO || planData.currentPlan === PLANS.PREMIUM ? planData.currentPlan : null;
  if (!plan) return null;

  const paidThrough = toEntitlementDate(planData.paidThrough);
  if (paidThrough && now.getTime() >= paidThrough.getTime()) return null;

  if (planData.subscriptionStatus === 'authorized') return plan;
  if (paidThrough && now.getTime() < paidThrough.getTime()) return plan;

  return null;
}

/**
 * PLAN-IMPL-01 §3/§4, agora SEM considerar trial (PLAN-IMPL-03 §4) — o plano BASE, isto é, o que este
 * tenant tem de verdade via assinatura/admin/indicação, ignorando qualquer boost temporário de trial.
 * Usado para exibição ("Seu plano base: Free") e para comparar transições de plano EFETIVO sem o
 * trial mascarar o base por baixo (ex.: ensurePlanLifecycleCurrent precisa saber que uma trial-driven
 * effective premium volta para "pro", não para "free", quando basePlan já era "pro" — §14 do ticket).
 *
 * PLAN-IMPL-04B — `resolveGenericPaidPlan` é checado PRIMEIRO: uma assinatura v2 (Pro ou Premium)
 * nunca depende de `isPremiumActive`/`premiumActive` (que ficam sempre `false`/ausentes para uma conta
 * que só tem estado v2). Para qualquer conta sem `pricingVersion`, `resolveGenericPaidPlan` devolve
 * `null` imediatamente e o resto da função roda exatamente como antes deste ticket.
 */
export function resolveBaseCommercialPlan(planData: PlanData | null, now: Date = new Date()): PlanType {
  const genericPaidPlan = resolveGenericPaidPlan(planData, now);
  if (genericPaidPlan) return genericPaidPlan;
  if (isPremiumActive(planData, now)) return PLANS.PREMIUM;
  // Este fallback é só para contas que NUNCA tiveram pricingVersion (legado, sem expiração própria de
  // Pro) — uma conta v2 expirada não pode "renascer" aqui: resolveGenericPaidPlan já decidiu que o
  // período pago acabou, e currentPlan continua "pro" só como registro histórico da última compra.
  if (!planData?.pricingVersion && planData?.currentPlan === PLANS.PRO) return PLANS.PRO;
  return PLANS.FREE;
}

/**
 * PLAN-IMPL-01 §3/§4, estendido por PLAN-IMPL-03 §13/§14 — resolve o NÍVEL COMERCIAL EFETIVO
 * (`free`/`pro`/`premium`): trial ativo sempre vence sobre o plano base (Premium enquanto durar,
 * qualquer que seja o base — free, pro ou já premium, §14), nunca escrito de volta em `currentPlan`.
 * Continua sendo a ÚNICA função que todo o resto do app usa para "qual plano este tenant tem agora"
 * (client — plan-helpers.ts, PlanProvider/usePlanData via hasPremiumAccess — e server — booking-quota,
 * resolveServerPlan, marketing-pro) — nenhum destes precisou mudar para ganhar consciência de trial,
 * porque a extensão fica inteira aqui dentro (§3 do ticket: nenhuma autoridade paralela nova).
 */
export function resolveCommercialPlan(planData: PlanData | null, now: Date = new Date()): PlanType {
  if (isTrialCurrentlyActive(planData, now)) return PLANS.PREMIUM;
  return resolveBaseCommercialPlan(planData, now);
}

export function getActivePlan(planData: PlanData | null): PlanType {
  return resolveCommercialPlan(planData);
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
        return resolveCommercialPlan(planData);
      }
    }
    return PLANS.PREMIUM;
  }

  return resolveCommercialPlan(planData);
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
 * PLAN-IMPL-03 §6 — duração do trial Premium gratuito para conta nova elegível. Única fonte: o
 * grant server-side (server/plan-lifecycle.ts) e qualquer copy de UI que precise mencionar "7 dias"
 * importam DAQUI, nunca um literal duplicado.
 */
export const TRIAL_DURATION_DAYS = 7;

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

/**
 * PLAN-IMPL-01 §11 — contrato apenas, mesmo formato de `canAddProduct`/`canAddClient`. Nenhum caminho
 * de criação de serviço chama esta função ainda (`SERVICES_RUNTIME_BEHAVIOR_CHANGED = NO`); existe
 * para PLAN-IMPL-02 aplicar de verdade, e para os testes deste ticket validarem os números do
 * contrato (5/50/200) sem duplicar a lógica de comparação.
 */
export function canAddService(plan: PlanType, currentCount: number): boolean {
  const limit = PLAN_CONFIG[plan].limits.services;

  if (limit === UNLIMITED) return true;

  return currentCount < limit;
}

/**
 * PLAN-IMPL-02A §9 — estado derivado puro, nunca uma segunda autoridade de números (só compara `count`
 * contra o `limit` já resolvido de PLAN_CONFIG). `limit === UNLIMITED` nunca conta como atingido/
 * excedido, mesma semântica de `canAddProduct`/`canAddClient`/`canAddService`.
 */
export interface LimitStatus {
  readonly withinLimit: boolean;
  readonly atLimit: boolean;
  readonly overLimit: boolean;
  readonly remaining: number;
  readonly overBy: number;
}

export function getLimitStatus(count: number, limit: number): LimitStatus {
  if (limit === UNLIMITED) {
    return { withinLimit: true, atLimit: false, overLimit: false, remaining: Infinity, overBy: 0 };
  }
  return {
    withinLimit: count < limit,
    atLimit: count === limit,
    overLimit: count > limit,
    remaining: Math.max(0, limit - count),
    overBy: Math.max(0, count - limit),
  };
}

export type PlanUsageDomainStatus = "withinLimit" | "atLimit" | "overLimit";

export interface PlanUsageDomainSnapshot {
  readonly used: number;
  readonly limit: number;
  readonly remaining: number;
  readonly overBy: number;
  readonly status: PlanUsageDomainStatus;
}

/**
 * PLAN-IMPL-02B1 §2/§4 — os únicos dois estados de acesso operacional de um Product/Service existente:
 * `active` opera normalmente (venda/reserva nova permitida); `preserved` significa "downgrade excedeu o
 * limite do plano atual" — o documento continua existindo, visível ao dono e presente no histórico, só
 * não pode ser usado para uma NOVA venda/reserva nem aparece em catálogo/agenda pública (ver
 * server/plan-access-reconciliation.ts). Nunca confundir com `Service.active`/`Service.published`
 * (campos pré-existentes, dormentes, reservados para a alternância manual do dono em PLAN-IMPL-02B2) —
 * são conceitos deliberadamente separados, ver PLAN-IMPL-02B1_REPORT.
 */
export const PLAN_ACCESS_STATES = { ACTIVE: "active", PRESERVED: "preserved" } as const;
export type PlanAccessState = typeof PLAN_ACCESS_STATES[keyof typeof PLAN_ACCESS_STATES];

export function isPlanAccessState(value: unknown): value is PlanAccessState {
  return value === PLAN_ACCESS_STATES.ACTIVE || value === PLAN_ACCESS_STATES.PRESERVED;
}

/** Documento antigo sem o campo (todo produto/serviço anterior a este ticket) sempre significa `active`
 * — nunca exigir migração para continuar operando (PLAN-IMPL-02B1 §5). */
export function resolvePlanAccessState(value: unknown): PlanAccessState {
  return value === PLAN_ACCESS_STATES.PRESERVED ? PLAN_ACCESS_STATES.PRESERVED : PLAN_ACCESS_STATES.ACTIVE;
}

/**
 * PLAN-IMPL-02B2 §12 — distingue COMO um `planAccessState` chegou ao valor atual: `"automatic"` (o
 * default determinístico de `reconcilePlanAccess`, server/plan-access-reconciliation.ts) vs `"user"`
 * (uma escolha explícita salva via setActiveProductSelection/setActiveServiceSelection,
 * server/plan-access-selection.ts). Escrito SOMENTE pelos comandos de seleção explícita — nunca por
 * `reconcilePlanAccess`, que só LÊ este campo (como sinal de prioridade máxima: um item marcado
 * `active`+`user` sempre vence a ordem determinística) e nunca o sobrescreve. Isso é o que faz uma
 * escolha manual sobreviver a qualquer replay futuro de reconciliação (mesmo plano, upgrade parcial,
 * downgrade) sem precisar de um segundo documento/histórico de seleção — o próprio par
 * (`planAccessState`, `planAccessSelectionSource`) de cada documento já é sua única fonte de memória.
 * Ausente em documento antigo (antes deste ticket) significa `"automatic"`, mesmo espírito de
 * `resolvePlanAccessState`.
 */
export const PLAN_ACCESS_SELECTION_SOURCES = { AUTOMATIC: "automatic", USER: "user" } as const;
export type PlanAccessSelectionSource = typeof PLAN_ACCESS_SELECTION_SOURCES[keyof typeof PLAN_ACCESS_SELECTION_SOURCES];

export function isPlanAccessSelectionSource(value: unknown): value is PlanAccessSelectionSource {
  return value === PLAN_ACCESS_SELECTION_SOURCES.AUTOMATIC || value === PLAN_ACCESS_SELECTION_SOURCES.USER;
}

export function resolvePlanAccessSelectionSource(value: unknown): PlanAccessSelectionSource {
  return value === PLAN_ACCESS_SELECTION_SOURCES.USER ? PLAN_ACCESS_SELECTION_SOURCES.USER : PLAN_ACCESS_SELECTION_SOURCES.AUTOMATIC;
}

/** PLAN-IMPL-02B1 §28 — usada só por `products`/`services` em PlanUsageSnapshot; `clients` não tem
 * conceito de active/preserved (§26 do ticket: histórico de clientes nunca é dividido, só a CRIAÇÃO de
 * novos é bloqueada acima do limite — comportamento inalterado desde PLAN-IMPL-02A). */
export interface PlanAccessDomainSnapshot extends PlanUsageDomainSnapshot {
  readonly active: number;
  readonly preserved: number;
}

/** PLAN-IMPL-02C §45 — `monthKey` ("YYYY-MM", resolveBookingQuotaMonthKey em server/booking-quota.ts)
 * junto do shape padrão de uso/limite — a UI (Plano e uso) usa `monthKey` só para exibição/depuração,
 * nunca para recalcular nada ela mesma. */
export interface BookingQuotaSnapshot extends PlanUsageDomainSnapshot {
  readonly monthKey: string;
}

/** PLAN-IMPL-05 §31 — mesmo shape/espírito de BookingQuotaSnapshot, para a cota mensal de NOVAS
 * preparações profissionais do Ads Pro (nunca anúncios/exports/reuso — ver proAdPreparationsMonthly). */
export interface AdsProPreparationQuotaSnapshot extends PlanUsageDomainSnapshot {
  readonly monthKey: string;
}

/**
 * PLAN-IMPL-02A §20 — contrato para a futura tela de seleção pós-downgrade (PLAN-IMPL-02B2), não a tela
 * em si.
 *
 * PLAN-IMPL-02B1 §28 — `products`/`services` agora carregam `active`/`preserved` (via
 * PlanAccessDomainSnapshot); `selectionRequired` é `true` quando QUALQUER um dos dois domínios tem pelo
 * menos 1 documento `preserved` — sinal para uma futura UI (PLAN-IMPL-02B2) de que o default temporário
 * determinístico está em vigor no lugar de uma escolha real do dono (§11 do ticket).
 *
 * PLAN-IMPL-02C §45 — `bookingsCurrentMonth` deixa de ser sempre `null`: a autoridade de timezone
 * mensal por tenant (server/booking-quota.ts) resolveu o bloqueador arquitetural que impedia isto em
 * PLAN-IMPL-02A (ver PLAN-IMPL-02A_REPORT) — continua `null` só quando o chamador não passou nada (ex.
 * um contexto que não tem acesso ao uso mensal), nunca mais um "não implementado" permanente.
 */
export interface PlanUsageSnapshot {
  readonly products: PlanAccessDomainSnapshot;
  readonly clients: PlanUsageDomainSnapshot;
  readonly services: PlanAccessDomainSnapshot;
  readonly bookingsCurrentMonth: BookingQuotaSnapshot | null;
  /** PLAN-IMPL-05 §31 — mesma semântica de bookingsCurrentMonth: `null` só quando o chamador não passou
   * nada, nunca um "não implementado" permanente. */
  readonly adsProPreparationsCurrentMonth: AdsProPreparationQuotaSnapshot | null;
  readonly selectionRequired: boolean;
}

function toPlanUsageDomainSnapshot(count: number, limit: number): PlanUsageDomainSnapshot {
  const status = getLimitStatus(count, limit);
  return {
    used: count,
    limit,
    remaining: status.remaining,
    overBy: status.overBy,
    status: status.overLimit ? "overLimit" : status.atLimit ? "atLimit" : "withinLimit",
  };
}

function toPlanAccessDomainSnapshot(active: number, preserved: number, limit: number): PlanAccessDomainSnapshot {
  const total = active + preserved;
  return { ...toPlanUsageDomainSnapshot(total, limit), active, preserved };
}

/**
 * PLAN-IMPL-02A §20 — função pura: recebe contagens JÁ CONHECIDAS (o chamador decide como obtê-las —
 * tipicamente `getCountFromServer`, mesmo padrão já usado em add-product.tsx/services-persistence.ts —
 * nunca um scan client-side de todos os documentos). Não busca nada sozinha, de propósito.
 *
 * PLAN-IMPL-02B1 §28 — `products`/`services` agora recebem `{active, preserved}` em vez de um total
 * único (tipicamente a saída de `reconcilePlanAccess`, server/plan-access-reconciliation.ts, ou uma
 * contagem por `planAccessState` já carregada) — nunca um scan caro repetido aqui dentro.
 */
export function buildPlanUsageSnapshot(
  plan: PlanType,
  counts: {
    readonly products: { readonly active: number; readonly preserved: number };
    readonly clients: number;
    readonly services: { readonly active: number; readonly preserved: number };
    /** PLAN-IMPL-02C §45 — omitido/`null` quando o chamador não tem (ou não precisa d)o uso mensal;
     * `limit` nunca vem daqui — é sempre PLAN_CONFIG[plan].limits.bookingsMonthly, a mesma autoridade
     * única de todo o resto deste arquivo. */
    readonly bookingsCurrentMonth?: { readonly used: number; readonly monthKey: string } | null;
    /** PLAN-IMPL-05 §31 — mesmo espírito de bookingsCurrentMonth; `limit` sempre
     * PLAN_CONFIG[plan].limits.proAdPreparationsMonthly. */
    readonly adsProPreparationsCurrentMonth?: { readonly used: number; readonly monthKey: string } | null;
  },
): PlanUsageSnapshot {
  const limits = PLAN_CONFIG[plan].limits;
  const products = toPlanAccessDomainSnapshot(counts.products.active, counts.products.preserved, limits.products);
  const services = toPlanAccessDomainSnapshot(counts.services.active, counts.services.preserved, limits.services);
  const bookingsCurrentMonth = counts.bookingsCurrentMonth
    ? { ...toPlanUsageDomainSnapshot(counts.bookingsCurrentMonth.used, limits.bookingsMonthly), monthKey: counts.bookingsCurrentMonth.monthKey }
    : null;
  const adsProPreparationsCurrentMonth = counts.adsProPreparationsCurrentMonth
    ? { ...toPlanUsageDomainSnapshot(counts.adsProPreparationsCurrentMonth.used, limits.proAdPreparationsMonthly), monthKey: counts.adsProPreparationsCurrentMonth.monthKey }
    : null;
  return {
    products,
    clients: toPlanUsageDomainSnapshot(counts.clients, limits.clients),
    services,
    bookingsCurrentMonth,
    adsProPreparationsCurrentMonth,
    selectionRequired: products.preserved > 0 || services.preserved > 0,
  };
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
  // PLAN-IMPL-03 §17/§19 — `resolveCommercialPlan` (não mais `isPremiumActive` puro) para que
  // `hasPremiumAccess` reflita um trial ativo, já que este é o campo que `/api/plan/data/:userId`
  // devolve e que PlanProvider.tsx/usePlanData.ts usam como fonte primária de `activePlan` no client.
  const commercialPremium = resolveCommercialPlan(planData) === PLANS.PREMIUM;
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