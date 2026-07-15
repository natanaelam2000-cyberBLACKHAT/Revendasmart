import { FirebaseApp } from "firebase/app";
import { maskId, safeLogger } from "@/lib/safe-logger";

/**
 * INTERNAL TELEMETRY MODULE
 * 
 * Typed internal telemetry API for RevendaSmart.
 *
 * The frontend no longer writes to Realtime Database /analytics_events by default.
 * That path failed with permission_denied on Android/PWA and must remain fail-open
 * until a least-privilege telemetry model exists. Product analytics stays in
 * firebase-analytics.ts.
 */

let isInitialized = false;

/**
 * Internal telemetry event definitions
 */
export interface InternalTelemetryEvents {
  // Authentication
  user_logged_in: {
    provider: "email" | "google" | "facebook";
  };
  user_signed_up: {
    provider: "email" | "google" | "facebook";
  };
user_logged_out: Record<string, never>;
  // Products
  product_created: {
    productId: string;
    category: string;
    price: number;
    nicho?: string;
    hasImage?: boolean;
    extrasCount?: number;
  };
  product_updated: {
    productId: string;
  };
  product_deleted: {
    productId: string;
  };
  product_quick_shared: {
    productId: string;
  };
  product_last_unit_sold: {
    productId: string;
    productName: string;
  };

  // Clients
  client_created: {
    clientId: string;
  };
  client_updated: {
    clientId: string;
  };

  // Sales
  sale_registered: {
    saleId: string;
    clientId: string;
    amount: number;
    itemCount: number;
    paymentType: "cash" | "installments";
  };
  sale_completed: {
    saleId: string;
    totalAmount: number;
  };

  // Payments & Charges
  payment_link_generated: {
    chargeId: string;
    amount: number;
    clientId: string;
  };
  payment_link_copied: {
    chargeId: string;
  };
  payment_link_shared: {
    chargeId: string;
    channel: "whatsapp" | "email";
  };
  payment_received: {
    chargeId: string;
    amount: number;
  };
  payment_link_deleted: {
    chargeId: string;
  };
  installment_paid: {
    installmentId: string;
    amount: number;
  };
  installment_partial_payment: {
    installmentId: string;
    amount: number;
    totalPaid: number;
  };

  // Catalog
  catalog_link_shared: {
    catalogSlug: string;
    clientIds?: number;
  };
  catalog_viewed: {
    catalogSlug: string;
  };

  // Marketing
  ad_text_copied: {
    productId: string;
    template: string;
  };
  ad_image_downloaded: {
    productId: string;
  };
  ad_shared: {
    productId: string;
    channel: "whatsapp" | "email";
  };

  // Growth & Referral
  growth_tab_viewed: {
    origin: "dashboard_insight" | "settings_nav";
  };
  referral_link_copied: {
    origin: "settings_growth" | "dashboard";
  };
  referral_share_initiated: {
    method: "native_share" | "whatsapp" | "direct_share";
    origin: "settings_growth";
  };
  referral_share_success: {
    method: "native_share" | "whatsapp" | "direct_share";
  };
  referral_share_failed: {
    method: "native_share" | "whatsapp" | "direct_share";
    reason: string;
  };

  // Referral Capture (Deep Link Processing)
  referral_link_opened: {
    referralUid: string;
    stage: "app_open";
  };
  referral_captured: {
    referralUid: string;
    stage: "app_open" | "signup";
    result: "success" | "invalid";
  };
  referral_applied_client: {
    referralUid: string;
    stage: "signup_local";
    result: "success" | "pending";
  };
  referral_applied_backend: {
    referralUid: string;
    stage: "signup_api";
    result: "success" | "invalid_format" | "self_referral" | "referrer_not_found" | "error";
  };
  referral_rejected: {
    referralUid: string;
    reason: "invalid_format" | "self_referral" | "referrer_not_found" | "api_error" | "already_set";
  };
  referral_already_set: {
    referralUid: string;
    existingReferralSource: string;
  };

  // Referral Conversion Attribution (Backend Recording)
  referral_conversion_counted: {
    referralUid: string;
    newUserId: string;
    conversionCount: number;
    rewardEligibleCount?: number;
  };
  referral_conversion_skipped_duplicate: {
    referralUid: string;
    newUserId: string;
    reason: "already_in_list" | "atomic_failure";
  };
  referral_conversion_failed: {
    referralUid: string;
    newUserId: string;
    error: string;
  };
}

declare global {
  interface Window {
    __telemetryUser?: string;
  }
}

/**
 * Initialize internal telemetry in fail-open mode.
 */
export function initializeInternalTelemetry(_app: FirebaseApp): void {
  isInitialized = true;
}

/**
 * Preserve the public telemetry API without blocking user flows.
 */
export async function logTelemetryEvent<K extends keyof InternalTelemetryEvents>(
  _eventName: K,
  _data: InternalTelemetryEvents[K],
  _userId?: string
): Promise<void> {
  if (!isInitialized) return;
}

/**
 * Set user ID for telemetry attribution
 */
export function setTelemetryUserId(userId: string): void {
  try {
    if (typeof window !== "undefined") {
      window.__telemetryUser = maskId(userId) || undefined;
    }
  } catch (err) {
    safeLogger.error("internal_telemetry_set_user_failed", err, { module: "internal-telemetry" });
  }
}

/**
 * Clear user ID
 */
export function clearTelemetryUserId(): void {
  try {
    if (typeof window !== "undefined") {
      delete window.__telemetryUser;
    }
  } catch (err) {
    safeLogger.error("internal_telemetry_clear_user_failed", err, { module: "internal-telemetry" });
  }
}
