/**
 * FIREBASE REMOTE CONFIG
 * 
 * Centralized feature flags and configuration management.
 * Flags are fetched at app startup and updated in real-time via listener.
 * 
 * RUNTIME UPDATES (Firebase Web SDK v12.2.1+):
 * - Real-time listener: onConfigUpdate() triggers when server publishes changes
 * - Fetch on startup: Initial load of all flags
 * - Fallback tab focus: visibilitychange event (complementary, for edge cases)
 * - Fallback background: pageshow event (complementary, for PWA)
 * 
 * Flow:
 * 1. App starts → fetchAndActivate() loads initial flags
 * 2. Listener registers → waits for server updates
 * 3. Dev publishes flags in Firebase Console → listener fires in <1 sec
 * 4. New flags loaded → onFlagsUpdated callback → UI rerenders
 * 5. If listener fails → tab/background events still refetch as fallback
 * 
 * TTL: 1 hour caching on failed/missing fetches. Listener is primary.
 * 
 * CRITICAL RULE: Do NOT use Remote Config for:
 * - Authentication/Authorization
 * - Payment logic
 * - Security-sensitive operations
 * 
 * Safe use: UI visibility, A/B testing non-critical features, rollout control
 */

import { getRemoteConfig, fetchAndActivate, getString, getBoolean, onConfigUpdate, activate } from "firebase/remote-config";
import { FirebaseApp } from "firebase/app";

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export interface RemoteFlags {
  // Onboarding & Activation
  onboarding_v2_enabled: boolean;
  
  // Analytics & Insights
  insights_enabled: boolean;
  
  // Dashboard Features
  sales_dashboard_enabled: boolean;
  
  // Growth Features
  referral_program_enabled: boolean;
  marketing_templates_v2_enabled: boolean;
  
  // Maintenance
  maintenance_mode_enabled: boolean;
  maintenance_message: string;
}

// ============================================================================
// DEFAULTS (Safe, Conservative)
// ============================================================================

const DEFAULT_FLAGS: RemoteFlags = {
  onboarding_v2_enabled: false,
  insights_enabled: false,
  sales_dashboard_enabled: true,
  referral_program_enabled: false,
  marketing_templates_v2_enabled: false,
  maintenance_mode_enabled: false,
  maintenance_message: "",
};

// ============================================================================
// STATE & CALLBACKS
// ============================================================================

let remoteConfig: any = null;
let isInitialized = false;
let flags: RemoteFlags = { ...DEFAULT_FLAGS };

// Callback to notify React Context of flag updates
let onFlagsUpdated: ((flags: RemoteFlags) => void) | null = null;

export function setFlagsUpdatedCallback(callback: (flags: RemoteFlags) => void): void {
  onFlagsUpdated = callback;
}

// Unsubscribe function for listener cleanup
let unsubscribeConfigListener: (() => void) | null = null;

export function unsubscribeFromConfigUpdates(): void {
  if (unsubscribeConfigListener) {
    unsubscribeConfigListener();
    unsubscribeConfigListener = null;
    console.log("[RemoteConfig] Listener unsubscribed");
  }
}

// ============================================================================
// INITIALIZATION
// ============================================================================

/**
 * Initialize Remote Config with safe defaults
 * Must be called after Firebase is initialized
 */
export function initializeRemoteConfig(app: FirebaseApp): void {
  if (isInitialized) return;

  try {
    remoteConfig = getRemoteConfig(app);
    
    // Set default values (used if fetch fails)
    remoteConfig.settings.minimumFetchIntervalMillis = 3600000; // 1 hour
    remoteConfig.settings.cacheTTL = 3600000;
    remoteConfig.defaultConfig = DEFAULT_FLAGS;
    
    console.log("[RemoteConfig] Initialized with defaults");
    isInitialized = true;
  } catch (error) {
    console.error("[RemoteConfig] Failed to initialize:", error);
    isInitialized = false;
  }
}

/**
 * Setup real-time listener for Remote Config updates
 * Called after initial fetch to enable live updates
 */
export function setupConfigUpdateListener(): void {
  if (!remoteConfig || !isInitialized) {
    console.warn("[RemoteConfig] Not initialized, cannot setup listener");
    return;
  }

  try {
    // unsubscribeConfigListener: Firebase provides a function to unsubscribe
    unsubscribeConfigListener = onConfigUpdate(remoteConfig, {
      next: async () => {
      console.log("[RemoteConfig] Real-time update received from Firebase, activating...");
      
      try {
        // Activate the updated config before reading values
        await activate(remoteConfig);
        
        // Load updated flags from activated config
        flags = {
          onboarding_v2_enabled: getBoolean(remoteConfig, "onboarding_v2_enabled"),
          insights_enabled: getBoolean(remoteConfig, "insights_enabled"),
          sales_dashboard_enabled: getBoolean(remoteConfig, "sales_dashboard_enabled"),
          referral_program_enabled: getBoolean(remoteConfig, "referral_program_enabled"),
          marketing_templates_v2_enabled: getBoolean(remoteConfig, "marketing_templates_v2_enabled"),
          maintenance_mode_enabled: getBoolean(remoteConfig, "maintenance_mode_enabled"),
          maintenance_message: getString(remoteConfig, "maintenance_message"),
        };
        
        console.log("[RemoteConfig] Updated flags from listener:", flags);
        notifyFlagsUpdated();
      } catch (error) {
        console.warn("[RemoteConfig] Failed to activate updated config:", error);
      }
      },
      error: (error) => {
        console.warn("[RemoteConfig] Real-time listener error:", error);
      },
      complete: () => {
        console.log("[RemoteConfig] Real-time listener completed");
      },
    });
    
    console.log("[RemoteConfig] Real-time listener setup complete");
  } catch (error) {
    console.warn("[RemoteConfig] Failed to setup listener, will use fallback refetch:", error);
  }
}

/**
 * Fetch and activate Remote Config
 * Called on app startup
 * Triggers context update callback if registered
 */
export async function fetchRemoteConfig(): Promise<void> {
  if (!remoteConfig || !isInitialized) {
    console.warn("[RemoteConfig] Not initialized, using defaults");
    flags = { ...DEFAULT_FLAGS };
    notifyFlagsUpdated();
    return;
  }

  try {
    // Fetch from Firebase (respects cache TTL)
    await fetchAndActivate(remoteConfig);
    
    // Load all flags from Remote Config
    flags = {
      onboarding_v2_enabled: getBoolean(remoteConfig, "onboarding_v2_enabled"),
      insights_enabled: getBoolean(remoteConfig, "insights_enabled"),
      sales_dashboard_enabled: getBoolean(remoteConfig, "sales_dashboard_enabled"),
      referral_program_enabled: getBoolean(remoteConfig, "referral_program_enabled"),
      marketing_templates_v2_enabled: getBoolean(remoteConfig, "marketing_templates_v2_enabled"),
      maintenance_mode_enabled: getBoolean(remoteConfig, "maintenance_mode_enabled"),
      maintenance_message: getString(remoteConfig, "maintenance_message"),
    };
    
    console.log("[RemoteConfig] Fetched and activated:", flags);
    notifyFlagsUpdated();
  } catch (error) {
    console.warn("[RemoteConfig] Failed to fetch, using defaults:", error);
    flags = { ...DEFAULT_FLAGS };
    notifyFlagsUpdated();
  }
}

// Internal: notify Context of update
function notifyFlagsUpdated(): void {
  if (onFlagsUpdated) {
    onFlagsUpdated({ ...flags });
  }
}

// ============================================================================
// ACCESSORS
// ============================================================================

/**
 * Get a boolean flag safely
 */
export function getFlag(flagName: keyof RemoteFlags): boolean | string {
  // Safety: ensure flag exists in defaults
  if (!(flagName in DEFAULT_FLAGS)) {
    console.warn(`[RemoteConfig] Unknown flag: ${flagName}, returning false`);
    return false;
  }

  const value = flags[flagName];
  return value !== undefined ? value : DEFAULT_FLAGS[flagName];
}

/**
 * Check if a boolean feature is enabled
 */
export function isFeatureEnabled(flagName: keyof RemoteFlags): boolean {
  const value = getFlag(flagName);
  return typeof value === "boolean" ? value : false;
}

/**
 * Get all current flags (for debugging)
 */
export function getAllFlags(): RemoteFlags {
  return { ...flags };
}

/**
 * Get maintenance mode status and message
 */
export function getMaintenanceInfo(): { enabled: boolean; message: string } {
  return {
    enabled: isFeatureEnabled("maintenance_mode_enabled"),
    message: flags.maintenance_message || DEFAULT_FLAGS.maintenance_message,
  };
}

// ============================================================================
// UTILITIES
// ============================================================================

/**
 * Reset flags to defaults (useful for testing)
 */
export function resetToDefaults(): void {
  flags = { ...DEFAULT_FLAGS };
  notifyFlagsUpdated();
  console.log("[RemoteConfig] Reset to defaults");
}

/**
 * Manual refresh of Remote Config (for use cases like onboarding completion)
 * Respects Firebase cache TTL (1 hour)
 */
export async function refreshRemoteConfig(): Promise<void> {
  console.log("[RemoteConfig] Manual refresh requested");
  await fetchRemoteConfig();
}
