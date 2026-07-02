import { getAnalytics, logEvent as firebaseLogEvent, Analytics } from "firebase/analytics";
import { FirebaseApp } from "firebase/app";

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
  purchase: {
    transaction_id: string;
    value: number;
    currency: string;
    items: Array<{
      item_id: string;
      item_name: string;
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
    method: "whatsapp" | "email" | "copy";
    num_recipients?: number;
  };
  ad_text_copied: {
    item_id: string;
  };
  ad_image_downloaded: {
    item_id: string;
  };
}

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
 * Set user ID for Firebase Analytics
 */
export function setFirebaseAnalyticsUserId(userId: string): void {
  if (!isInitialized || !analytics) {
    console.warn("[FirebaseAnalytics] Not initialized");
    return;
  }

  try {
    firebaseLogEvent(analytics, "user_id", { user_id: userId } as any);
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
