/**
 * RELEASE-07 — contrato central do Google Play Billing: IDs de produto, nome de pacote, e os tipos que
 * atravessam a fronteira client → servidor → Google Play Developer API. Nada aqui faz uma chamada real
 * — é só o CONTRATO, para nunca hardcodar um product ID solto em múltiplos arquivos.
 *
 * Confirmado via documentação oficial do Google Play (RELEASE-07, sem chamada real): "app functionality
 * or content (such as an ad-free version of an app or new features not available in the free version)"
 * exige Google Play's billing system para apps distribuídos pela Play — é exatamente o que o Premium do
 * RevendaSmart desbloqueia (produtos/clientes ilimitados, categorias, cobranças, etc.). "User choice
 * billing" (a única alternativa formal elegível para o Brasil) NÃO substitui o Google Play Billing — ela
 * exige que o Google Play Billing continue integrado, só permite OFERECER um billing adicional ao lado
 * dele. Não há caminho confirmado que dispense a integração real do Google Play Billing no Android.
 */

/** Deve bater com `appId` em capacitor.config.ts. */
export const PLAY_BILLING_PACKAGE_NAME = "com.revendasmart.app";

export const PLAY_BILLING_PRODUCT_IDS = {
  pro: "revendasmart_pro",
  premium: "revendasmart_premium",
} as const;

export type PlayBillingProductId = (typeof PLAY_BILLING_PRODUCT_IDS)[keyof typeof PLAY_BILLING_PRODUCT_IDS];
export type PlayBillingPlan = "pro" | "premium";
export type PlayBillingCycle = "monthly" | "annual";

export function isKnownPlayBillingProductId(value: unknown): value is PlayBillingProductId {
  return typeof value === "string"
    && (Object.values(PLAY_BILLING_PRODUCT_IDS) as readonly string[]).includes(value);
}

/**
 * Android subscriptions (Google Play Billing Library) exigem TANTO o product id quanto um base plan
 * id na hora de comprar. Este é o catálogo canônico compartilhado por client e servidor.
 */
export const PLAY_BILLING_CATALOG = {
  pro: {
    monthly: { productId: PLAY_BILLING_PRODUCT_IDS.pro, basePlanId: "pro-monthly-autorenew" },
    annual: { productId: PLAY_BILLING_PRODUCT_IDS.pro, basePlanId: "pro-annual-autorenew" },
  },
  premium: {
    monthly: { productId: PLAY_BILLING_PRODUCT_IDS.premium, basePlanId: "premium-monthly-autorenew" },
    annual: { productId: PLAY_BILLING_PRODUCT_IDS.premium, basePlanId: "premium-annual-autorenew" },
  },
} as const satisfies Record<PlayBillingPlan, Record<PlayBillingCycle, { productId: PlayBillingProductId; basePlanId: string }>>;

export const PLAY_BILLING_BASE_PLAN_IDS = {
  proMonthly: PLAY_BILLING_CATALOG.pro.monthly.basePlanId,
  proAnnual: PLAY_BILLING_CATALOG.pro.annual.basePlanId,
  premiumMonthly: PLAY_BILLING_CATALOG.premium.monthly.basePlanId,
  premiumAnnual: PLAY_BILLING_CATALOG.premium.annual.basePlanId,
} as const;

export function getPlayBillingCatalogEntry(plan: PlayBillingPlan, cycle: PlayBillingCycle) {
  return PLAY_BILLING_CATALOG[plan][cycle];
}

export function resolvePlayBillingPlanAndCycle(productId: unknown, basePlanId: unknown): { plan: PlayBillingPlan; cycle: PlayBillingCycle } | null {
  for (const plan of ["pro", "premium"] as const) {
    for (const cycle of ["monthly", "annual"] as const) {
      const entry = PLAY_BILLING_CATALOG[plan][cycle];
      if (entry.productId === productId && entry.basePlanId === basePlanId) return { plan, cycle };
    }
  }
  return null;
}

export function isKnownPlayBillingBasePlanId(productId: PlayBillingProductId, basePlanId: unknown): boolean {
  return resolvePlayBillingPlanAndCycle(productId, basePlanId) !== null;
}

/**
 * Estado de assinatura devolvido pela Google Play Developer API (subscriptionsv2.get), reduzido aos
 * campos que o servidor realmente usa. Nomes seguem a API real do Google, não inventados — mesmo sem
 * chamada real nesta tarefa, o shape é o documentado publicamente pela Google.
 */
export type GooglePlaySubscriptionState =
  | "SUBSCRIPTION_STATE_UNSPECIFIED"
  | "SUBSCRIPTION_STATE_ACTIVE"
  | "SUBSCRIPTION_STATE_CANCELED"
  | "SUBSCRIPTION_STATE_IN_GRACE_PERIOD"
  | "SUBSCRIPTION_STATE_ON_HOLD"
  | "SUBSCRIPTION_STATE_PAUSED"
  | "SUBSCRIPTION_STATE_EXPIRED"
  | "SUBSCRIPTION_STATE_PENDING"
  | "SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED";

export interface GooglePlaySubscriptionPurchase {
  readonly subscriptionState: GooglePlaySubscriptionState;
  readonly lineItemProductId: string;
  readonly lineItemBasePlanId?: string;
  readonly expiryTimeMillis: number | null;
  readonly autoRenewing: boolean;
  readonly acknowledgementState: "ACKNOWLEDGEMENT_STATE_PENDING" | "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED";
  /** obfuscatedExternalAccountId — usado pelo Google para amarrar a compra a uma conta específica. */
  readonly obfuscatedExternalAccountId?: string;
  readonly orderId?: string;
}

/**
 * RELEASE-15 §5 — estado de entitlement INTERNO, fechado. É para cá que toda resposta da Google Play
 * converge antes de virar Premium; nenhum outro lugar do servidor interpreta `subscriptionState` cru.
 *
 * Sobre REFUNDED/REVOKED: a `purchases.subscriptionsv2` NÃO tem um enum de "refunded". Quando o Google
 * estorna ou revoga uma assinatura, a própria consulta passa a devolver `SUBSCRIPTION_STATE_EXPIRED`
 * (ou uma expiry no passado) — é assim que um refund chega aqui, e é por isso que ele cai em EXPIRED e
 * revoga o acesso na hora. `REVOKED` fica reservado para o caso explícito em que o Google informa que
 * a compra pendente foi cancelada/recusada (`SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED`).
 */
export type PlayEntitlementState =
  | "ACTIVE"
  | "GRACE_PERIOD"
  | "CANCELLED_BUT_ACTIVE"
  | "PENDING"
  | "ON_HOLD"
  | "PAUSED"
  | "EXPIRED"
  | "REVOKED";

/** Erro de mapeamento: um estado que este código não conhece NUNCA vira acesso liberado. */
export class UnknownGooglePlaySubscriptionStateError extends Error {
  constructor(state: unknown) {
    super(`Estado de assinatura Google Play desconhecido: ${String(state)}`);
    this.name = "UnknownGooglePlaySubscriptionStateError";
  }
}

/** Os únicos estados que concedem Premium. Qualquer outro (inclusive futuros) não concede. */
const ENTITLED_STATES: ReadonlySet<PlayEntitlementState> = new Set<PlayEntitlementState>([
  "ACTIVE",
  "GRACE_PERIOD",
  "CANCELLED_BUT_ACTIVE",
]);

export function isEntitledPlayState(state: PlayEntitlementState): boolean {
  return ENTITLED_STATES.has(state);
}

/**
 * Função PURA (§14): resposta normalizada da Google → estado interno. Sem rede, sem Firestore.
 *
 * Duas dimensões decidem juntas: o `subscriptionState` que o Google reporta E a expiry. Um estado
 * "ativo" com expiry no passado é EXPIRED — o carimbo de tempo do Google é a autoridade final, nunca
 * o rótulo isolado. Estado não reconhecido → lança (fail closed), nunca cai em ACTIVE.
 */
export function mapGooglePlaySubscriptionState(
  purchase: Pick<GooglePlaySubscriptionPurchase, "subscriptionState" | "expiryTimeMillis">,
  nowMs: number = Date.now(),
): PlayEntitlementState {
  const expiresAt = purchase.expiryTimeMillis;
  const hasFutureExpiry = typeof expiresAt === "number" && Number.isFinite(expiresAt) && expiresAt > nowMs;

  switch (purchase.subscriptionState) {
    case "SUBSCRIPTION_STATE_ACTIVE":
      return hasFutureExpiry ? "ACTIVE" : "EXPIRED";
    case "SUBSCRIPTION_STATE_IN_GRACE_PERIOD":
      return hasFutureExpiry ? "GRACE_PERIOD" : "EXPIRED";
    // Cancelada é "não renova mais", não "acabou agora": o acesso continua até a expiry que o Google
    // reporta. Depois dela, EXPIRED.
    case "SUBSCRIPTION_STATE_CANCELED":
      return hasFutureExpiry ? "CANCELLED_BUT_ACTIVE" : "EXPIRED";
    case "SUBSCRIPTION_STATE_PENDING":
      return "PENDING";
    case "SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED":
      return "REVOKED";
    case "SUBSCRIPTION_STATE_ON_HOLD":
      return "ON_HOLD";
    case "SUBSCRIPTION_STATE_PAUSED":
      return "PAUSED";
    case "SUBSCRIPTION_STATE_EXPIRED":
      return "EXPIRED";
    // UNSPECIFIED é explicitamente "o Google não sabe dizer" — tratar como acesso é inaceitável.
    case "SUBSCRIPTION_STATE_UNSPECIFIED":
      throw new UnknownGooglePlaySubscriptionStateError(purchase.subscriptionState);
    default:
      throw new UnknownGooglePlaySubscriptionStateError(purchase.subscriptionState);
  }
}

/** Decisão final de entitlement, derivada do mapping fechado acima (fonte única). */
export function isGooglePlaySubscriptionEntitled(
  purchase: Pick<GooglePlaySubscriptionPurchase, "subscriptionState" | "expiryTimeMillis">,
  nowMs: number = Date.now(),
): boolean {
  return isEntitledPlayState(mapGooglePlaySubscriptionState(purchase, nowMs));
}

export interface GooglePlayVerifyRequestBody {
  readonly productId: string;
  readonly basePlanId: string;
  readonly purchaseToken: string;
  readonly packageName: string;
}

export interface GooglePlayVerifyResponseBody {
  readonly premiumActive: boolean;
  readonly currentPlan: "free" | "pro" | "premium";
  readonly billingCycle: PlayBillingCycle | null;
  readonly premiumExpiresAt: string | null;
  readonly autoRenew: boolean;
  readonly deduplicated: boolean;
}
