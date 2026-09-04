import { getAnalytics, logEvent as firebaseLogEvent, setUserId as firebaseSetUserId, Analytics } from "firebase/analytics";
import { FirebaseApp } from "firebase/app";
import { maskId } from "@/lib/safe-logger";
import type { PlanType, BillingCycle } from "@shared/monetization";

/**
 * FIREBASE ANALYTICS OFFICIAL — WEB
 * 
 * Official Google Analytics integration for RevendaSmart.
 * Tracks product analytics and user behavior.
 * 
 * This module:
 * - Uses official Firebase Analytics for Web (getAnalytics)
 * - Handles main product events
 * - Integrates with Google Analytics dashboard
 * - Provides product insights and metrics
 * 
 * NOTE: This is official analytics. For internal telemetry, use internal-telemetry.ts
 */

let analytics: Analytics | null = null;
let isInitialized = false;

/** PLAN-IMPL-06 §39 — sink injetável para testes: quando definido, `trackAnalyticsEvent` chama ESTE em
 * vez do Firebase Analytics real (nenhum tráfego real de GA/Firebase sai de testes automatizados).
 * Nunca setado em produção — só scripts de teste chamam `__setAnalyticsTestSinkForTesting`. */
type AnalyticsTestSink = <K extends keyof FirebaseAnalyticsEvents>(eventName: K, eventData: Partial<FirebaseAnalyticsEvents[K]>) => void;
let testSink: AnalyticsTestSink | null = null;

/** PLAN-IMPL-06 §39 — só para testes: injeta (ou, com `null`, remove) um sink mock. */
export function __setAnalyticsTestSinkForTesting(sink: AnalyticsTestSink | null): void {
  testSink = sink;
}

/**
 * Firebase Analytics event definitions
 * Using standard Firebase event naming conventions
 */
export interface FirebaseAnalyticsEvents {
  // Authentication events
  login: {
    method: "email" | "google" | "facebook";
  };
  sign_up: {
    method: "email" | "google" | "facebook";
  };

  // Product events
  view_item: {
    items: Array<{
      item_id: string;
      item_name: string;
      price: number;
    }>;
  };
  add_to_cart: {
    items: Array<{
      item_id: string;
      item_name: string;
      quantity: number;
      price: number;
    }>;
    value: number;
    currency: string;
  };
  view_cart: {
    value: number;
    currency: string;
    items: Array<{
      item_id: string;
      quantity: number;
    }>;
  };
  // ANALYTICS-PRIVACY-CLEANUP-01 — item_name (nome do produto, texto livre) removido: mesmo shape já
  // usado por view_cart abaixo (item_id + quantity, nunca o nome) — item_id já é suficiente para
  // qualquer análise de catálogo, sem expor texto livre do tenant.
  purchase: {
    transaction_id: string;
    value: number;
    currency: string;
    items: Array<{
      item_id: string;
      quantity: number;
    }>;
  };

  // Client management
  client_created: {
    client_id: string;
    value: number;
  };
  client_deleted: {
    client_id: string;
  };

  // Marketing & Sharing
  share: {
    method: "whatsapp" | "email";
    content_type: "catalog" | "product" | "ad";
    item_id: string;
  };
  generate_lead: {
    value: number;
    currency: string;
    lead_type: "payment_link" | "catalog";
  };

  // Payment & Billing
  payment_link_created: {
    value: number;
    currency: string;
  };
  payment_link_copied: {
    value: number;
  };

  // Custom business events
  sale_registered: {
    value: number;
    currency: string;
    num_items: number;
  };
  catalog_shared: {
    method: "whatsapp" | "email" | "copy" | "instagram";
    num_recipients?: number;
  };
  ad_text_copied: {
    item_id: string;
  };
  ad_image_downloaded: {
    item_id: string;
  };

  // PLAN-IMPL-06 §8-§14 — ativação: cada um só no limite real correspondente (ver os call sites), nunca
  // em render de página/abertura de formulário. Nenhum payload leva id/nome de produto/cliente/venda —
  // "primeiro" é sinalizado pela OCORRÊNCIA do evento em si, não por um parâmetro.
  first_product_created: Record<string, never>;
  first_sale_completed: Record<string, never>;
  catalog_published: Record<string, never>;
  first_booking_created: Record<string, never>;
  first_marketing_created: Record<string, never>;

  // PLAN-IMPL-06 §21-§23 — funil de paywall. `reason`/`resource_type`/`source` são enums fechados
  // (AnalyticsPaywallReason/AnalyticsResourceType/AnalyticsSource abaixo), nunca uma string livre.
  paywall_viewed: {
    reason: AnalyticsPaywallReason;
    resource_type?: AnalyticsResourceType;
    current_plan: PlanType;
    recommended_plan?: PlanType;
    usage?: number;
    limit?: number;
    source: AnalyticsSource;
  };
  paywall_cta_clicked: {
    reason: AnalyticsPaywallReason;
    resource_type?: AnalyticsResourceType;
    current_plan: PlanType;
    recommended_plan?: PlanType;
    source: AnalyticsSource;
  };

  // PLAN-IMPL-08 §34/§35 — promoção discricionária (nunca bloqueia uma ação, ao contrário do paywall_*
  // acima) — catálogo fechado de HousePromotionId, nunca criado dinamicamente por call site. Um
  // `useEffect` com deps vazias no componente dispara o view exatamente uma vez por montagem real
  // (§35 — "uma janela de visibilidade = uma view"; fechar/reabrir a página conta de novo naturalmente).
  house_promotion_viewed: {
    promotion_id: HousePromotionId;
    placement: HousePromotionPlacement;
    current_plan: PlanType;
    recommended_plan: PlanType;
  };
  house_promotion_clicked: {
    promotion_id: HousePromotionId;
    placement: HousePromotionPlacement;
    current_plan: PlanType;
    recommended_plan: PlanType;
  };

  // PLAN-IMPL-06 §24-§28/§45 — funil de assinatura: plans_viewed -> plan_selected -> checkout_started ->
  // subscription_activated, com checkout_failed como ramo de erro. Nunca leva valor/amount do client
  // (§26 — o preço é derivado depois de plan/billing_cycle, nunca enviado como autoridade).
  plans_viewed: {
    current_plan: PlanType;
    effective_plan: PlanType;
    is_trial: boolean;
    source: AnalyticsSource;
  };
  plan_selected: {
    selected_plan: PlanType;
    billing_cycle: BillingCycle;
    current_plan: PlanType;
    is_trial: boolean;
  };
  checkout_started: {
    plan: PlanType;
    billing_cycle: BillingCycle;
    pricing_version: "v2";
  };
  checkout_failed: {
    plan: PlanType;
    reason: AnalyticsCheckoutFailureReason;
  };
  subscription_activated: {
    plan: PlanType;
    billing_cycle: BillingCycle;
  };

  // PLAN-IMPL-06 §15-§20/§43/§44 — funil econômico do Ads Pro (PLAN-IMPL-05). Mede só a preparação
  // (chamada cara ao provider), nunca o anúncio gerado a partir dela — ver marketing_created acima, um
  // evento deliberadamente distinto. Nenhum productId/preparedAssetId (alta cardinalidade, §43).
  ads_pro_preparation_started: {
    plan: PlanType;
  };
  ads_pro_preparation_completed: {
    plan: PlanType;
    quota_used: number;
    quota_limit: number;
  };
  ads_pro_preparation_failed: {
    plan: PlanType;
    failure_category: AnalyticsPreparationFailureCategory;
  };
  ads_pro_preparation_reused: {
    plan: PlanType;
  };
  ads_pro_preparation_limit_reached: {
    plan: PlanType;
    quota_used: number;
    quota_limit: number;
  };

  // PLAN-IMPL-06 §30-§34 — ciclo de vida do plano, sempre a partir de uma transição real observada pelo
  // client (nunca a cada render de um estado já conhecido — ver PlanProvider.tsx).
  trial_started: {
    plan: PlanType;
  };
  trial_expired: {
    base_plan: PlanType;
  };
  plan_upgraded: {
    from_plan: PlanType;
    to_plan: PlanType;
  };
  plan_downgraded: {
    from_plan: PlanType;
    to_plan: PlanType;
  };

  // PLAN-IMPL-06 §33/§34 — cancellation_completed significa só que o provider aceitou a solicitação de
  // não-renovar; o acesso pago continua até o fim do período já pago (PLAN-IMPL-03/04B), nunca implica
  // downgrade imediato.
  cancellation_started: {
    plan: PlanType;
  };
  cancellation_completed: {
    plan: PlanType;
  };
}

/** PLAN-IMPL-06 §21/§47 — motivo fechado de paywall: um por recurso com cota real aplicada. */
export type AnalyticsPaywallReason = "product_limit" | "client_limit" | "service_limit" | "booking_limit" | "ads_pro_preparation_limit";

/** PLAN-IMPL-06 — mesmo domínio de PaywallResource (client/src/lib/plan-paywall-copy.ts), redeclarado
 * aqui como tipo (não importado) para este módulo nunca depender do módulo de cópia — analytics e texto
 * de UI são preocupações independentes, mesmo cobrindo o mesmo conjunto de recursos. */
export type AnalyticsResourceType = "products" | "clients" | "services" | "bookings" | "adsProPreparations";

/** PLAN-IMPL-06 §24/§47 — de onde a navegação para /plans (ou o paywall) partiu. Fechado: nunca uma URL
 * completa, nunca uma string arbitrária montada em runtime (§24 — "Do not include arbitrary URL"). */
export type AnalyticsSource = "dashboard" | "settings" | "plan_usage" | "product_limit" | "client_limit" | "booking_limit" | "ads_pro_preparation_limit" | "direct";

/** PLAN-IMPL-08 §27 — catálogo fechado das promoções internas que hoje existem; reflete os placements
 * reais (nunca um id arbitrário livre) — crescer este catálogo é adicionar uma promoção real, não uma
 * campanha remota (§28 — nenhum CMS de anúncio nesta ticket). */
export type HousePromotionId = "reports_operational_upgrade" | "reports_strategic_upgrade" | "opportunities_premium_upgrade";

/** PLAN-IMPL-08 §34 — onde a promoção apareceu; hoje só duas páginas têm promoção discricionária. */
export type HousePromotionPlacement = "reports" | "opportunities";

/** PLAN-IMPL-06 §27 — nunca a string de erro real da API/provider. */
export type AnalyticsCheckoutFailureReason = "purchase_unavailable" | "provider_unavailable" | "configuration_error" | "already_subscribed" | "authorization" | "temporary_error" | "unknown";

/** PLAN-IMPL-06 §19 — nunca o payload/erro bruto do PhotoRoom. */
export type AnalyticsPreparationFailureCategory = "provider_unavailable" | "provider_failed" | "storage_failed" | "invalid_result" | "temporary_error";

/**
 * Initialize Firebase Analytics
 */
export function initializeFirebaseAnalytics(app: FirebaseApp): void {
  if (isInitialized) return;

  try {
    analytics = getAnalytics(app);
    isInitialized = true;
  } catch (error) {
    console.error("[FirebaseAnalytics] Failed to initialize:", error);
  }
}

/**
 * Track a product/business event using Firebase Analytics
 */
export function trackAnalyticsEvent<K extends keyof FirebaseAnalyticsEvents>(
  eventName: K,
  eventData: Partial<FirebaseAnalyticsEvents[K]> = {}
): void {
  if (testSink) {
    testSink(eventName, eventData);
    return;
  }

  if (!isInitialized || !analytics) {
    console.warn("[FirebaseAnalytics] Not initialized, event not tracked");
    return;
  }

  try {
    const logTypedEvent = firebaseLogEvent as (
      analyticsInstance: Analytics,
      name: string,
      params?: Record<string, unknown>
    ) => void;
    logTypedEvent(analytics, eventName, eventData);
  } catch (err) {
    console.error("[FirebaseAnalytics] Failed to track event:", err);
  }
}

/**
 * RELEASE-23: set the Analytics user ID via the real Firebase `setUserId()` API — this previously
 * logged a custom `"user_id"` event with the RAW Firebase UID as an event parameter instead, which
 * neither enabled Firebase's actual User-ID reporting (that API expects `setUserId`, not an event)
 * nor matched this codebase's own standard of never sending an unmasked UID off-device (see
 * server/logger.ts, client/src/lib/safe-logger.ts). Masked with the same `maskId()` used everywhere
 * else — still stable per user (so cross-session Analytics segmentation keeps working), never the
 * raw identifier.
 */
export function setFirebaseAnalyticsUserId(userId: string): void {
  if (!isInitialized || !analytics) {
    console.warn("[FirebaseAnalytics] Not initialized");
    return;
  }

  try {
    const masked = maskId(userId);
    if (masked) firebaseSetUserId(analytics, masked);
  } catch (err) {
    console.error("[FirebaseAnalytics] Failed to set user ID:", err);
  }
}

/**
 * Set custom user properties for segmentation
 */
export function setFirebaseAnalyticsUserProperty(
  propertyName: string,
  value: string
): void {
  if (!isInitialized || !analytics) {
    console.warn("[FirebaseAnalytics] Not initialized");
    return;
  }

  try {
    firebaseLogEvent(analytics, "user_property", {
      [propertyName]: value,
    } as any);
  } catch (err) {
    console.error("[FirebaseAnalytics] Failed to set user property:", err);
  }
}
