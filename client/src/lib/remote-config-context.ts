/**
 * REMOTE CONFIG CONTEXT & HOOK
 * 
 * Provides reactive access to Remote Config flags with automatic rerendering
 * when flags are updated after fetch.
 */

import { createContext, useContext, useCallback } from "react";
import { getAllFlags, type RemoteFlags } from "./remote-config";

// ============================================================================
// CONTEXT TYPE
// ============================================================================

interface RemoteConfigContextType {
  flags: RemoteFlags;
  isLoading: boolean;
  isFeatureEnabled: (flagName: keyof RemoteFlags) => boolean;
  getFlag: (flagName: keyof RemoteFlags) => boolean | string;
  getMaintenanceInfo: () => { enabled: boolean; message: string };
}

// ============================================================================
// CREATE CONTEXT
// ============================================================================

export const RemoteConfigContext = createContext<RemoteConfigContextType | undefined>(
  undefined
);

// ============================================================================
// HOOK: useRemoteFlag
// ============================================================================

/**
 * Hook to safely access a single Remote Config flag
 * Triggers rerender when flags change
 */
export function useRemoteFlag(flagName: keyof RemoteFlags): boolean | string {
  const context = useContext(RemoteConfigContext);
  
  if (!context) {
    console.warn("[useRemoteFlag] Context not initialized, returning false");
    return false;
  }

  return context.getFlag(flagName);
}

/**
 * Hook to check if a feature is enabled (boolean flag)
 * Triggers rerender when flags change
 */
export function useFeatureEnabled(flagName: keyof RemoteFlags): boolean {
  const context = useContext(RemoteConfigContext);
  
  if (!context) {
    console.warn("[useFeatureEnabled] Context not initialized, returning false");
    return false;
  }

  return context.isFeatureEnabled(flagName);
}

/**
 * Hook to get maintenance info (enabled status + message)
 * Triggers rerender when flags change
 */
export function useMaintenanceInfo(): { enabled: boolean; message: string } {
  const context = useContext(RemoteConfigContext);
  
  if (!context) {
    return { enabled: false, message: "" };
  }

  return context.getMaintenanceInfo();
}

/**
 * Hook to get all flags (for debugging or admin pages)
 */
export function useAllRemoteFlags(): RemoteFlags {
  const context = useContext(RemoteConfigContext);
  
  if (!context) {
    return getAllFlags();
  }

  return { ...context.flags };
}

/**
 * Hook to check if Remote Config is still loading
 */
export function useRemoteConfigLoading(): boolean {
  const context = useContext(RemoteConfigContext);
  return context?.isLoading ?? true;
}

// Re-export refresh function for manual refresh (e.g., after user action)
export { refreshRemoteConfig } from "./remote-config";
