import { getDatabase, ref, push, set } from "firebase/database";
import { FirebaseApp } from "firebase/app";

/**
 * INTERNAL TELEMETRY MODULE
 * 
 * Customized event logging for RevendaSmart.
 * 
 * This module provides:
 * - Detailed internal logging to Firebase Realtime Database: /analytics_events/
 * - Complementary to Firebase Analytics official
 * - Useful for:
 *   - Raw audit trails
 *   - Debug context capture
 *   - Contextual data that doesn't fit official events
 *   - Fine-grained tracking for internal use
 * 
 * NOTE: This is internal telemetry. For product analytics, use firebase-analytics.ts
 */

let database: any = null;
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
  user_logged_out: {};

  // Products
  product_created: {
    productId: string;
    category: string;
    price: number;
  };
  product_updated: {
    productId: string;
  };
  product_deleted: {
    productId: string;
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

/**
 * Initialize internal telemetry with Firebase Realtime Database
 */
export function initializeInternalTelemetry(app: FirebaseApp): void {
  if (isInitialized) return;

  try {
    database = getDatabase(app);
    isInitialized = true;
    console.log("[InternalTelemetry] Initialized successfully");
  } catch (error) {
    console.error("[InternalTelemetry] Failed to initialize:", error);
  }
}

/**
 * Log an internal telemetry event
 * Complementary to Firebase Analytics - captures richer context
 */
export async function logTelemetryEvent<K extends keyof InternalTelemetryEvents>(
  eventName: K,
  data: InternalTelemetryEvents[K],
  userId?: string
): Promise<void> {
  if (!isInitialized || !database) {
    console.warn("[InternalTelemetry] Not initialized, event not logged");
    return;
  }

  try {
    const eventLog = {
      timestamp: new Date().toISOString(),
      eventName,
      data,
      userId,
      url: typeof window !== "undefined" ? window.location.href : "unknown",
    };

    const eventsRef = ref(database, "analytics_events");
    const newEventRef = push(eventsRef);
    await set(newEventRef, eventLog);

    console.log(`[InternalTelemetry] Logged: ${eventName}`);
  } catch (err) {
    console.error("[InternalTelemetry] Failed to log event:", err);
  }
}

/**
 * Set user ID for telemetry attribution
 */
export function setTelemetryUserId(userId: string): void {
  try {
    if (typeof window !== "undefined") {
      (window as any).__telemetryUser = userId;
    }
  } catch (err) {
    console.error("[InternalTelemetry] Failed to set user ID:", err);
  }
}

/**
 * Clear user ID
 */
export function clearTelemetryUserId(): void {
  try {
    if (typeof window !== "undefined") {
      delete (window as any).__telemetryUser;
    }
  } catch (err) {
    console.error("[InternalTelemetry] Failed to clear user ID:", err);
  }
}
