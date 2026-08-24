/**
 * REMOTE CONFIG PROVIDER
 * 
 * Wraps the app with RemoteConfig context.
 * Handles fetch lifecycle and provides reactive flag access.
 * 
 * RUNTIME UPDATES (Firebase Web SDK v12.2.1+):
 * - Initial fetch on mount
 * - Real-time listener (onConfigUpdate) for instant updates when dev publishes
 * - Fallback: Tab visibility & page resume events if listener fails
 * - Manual refetch available via refreshRemoteConfig()
 * 
 * Listener is primary mechanism for updates (sub-second response).
 * Fallbacks ensure reliability if listener fails or is unsupported.
 */

import { ReactNode, useState, useEffect } from "react";
import { RemoteConfigContext } from "@/lib/remote-config-context";
import { 
  fetchRemoteConfig as fetchRemoteConfigFn, 
  setFlagsUpdatedCallback, 
  isFeatureEnabled as isFeatureEnabledFn,
  getFlag as getFlagFn,
  getMaintenanceInfo as getMaintenanceInfoFn,
  getAllFlags,
  refreshRemoteConfig,
  setupConfigUpdateListener,
  unsubscribeFromConfigUpdates
} from "@/lib/remote-config";
import type { RemoteFlags } from "@/lib/remote-config";

interface RemoteConfigProviderProps {
  children: ReactNode;
}

export function RemoteConfigProvider({ children }: RemoteConfigProviderProps) {
  const [flags, setFlags] = useState<RemoteFlags>(() => getAllFlags());
  const [isLoading, setIsLoading] = useState(true);

  // Register callback for flag updates
  useEffect(() => {
    setFlagsUpdatedCallback((updatedFlags) => {
      setFlags(updatedFlags);
    });
  }, []);

  // Fetch Remote Config on mount and setup listener
  useEffect(() => {
    (async () => {
      try {
        await fetchRemoteConfigFn();
        
        // Setup real-time listener for updates
        void setupConfigUpdateListener();
      } catch (err) {
        console.warn("[RemoteConfigProvider] Initial fetch failed:", err);
      } finally {
        setIsLoading(false);
      }
    })();

    // Cleanup listener on unmount
    return () => {
      unsubscribeFromConfigUpdates();
    };
  }, []);

  // Setup runtime update listeners
  useEffect(() => {
    // 1. Refetch when tab becomes visible (user returns to tab)
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        refreshRemoteConfig().catch((err) =>
          console.warn("[RemoteConfigProvider] Tab visibility refetch failed:", err)
        );
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    // 2. Refetch when app resumes from background (PWA/mobile)
    const handlePageShow = () => {
      refreshRemoteConfig().catch((err) =>
        console.warn("[RemoteConfigProvider] App resume refetch failed:", err)
      );
    };

    window.addEventListener("pageshow", handlePageShow);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pageshow", handlePageShow);
    };
  }, []);

  const value = {
    flags,
    isLoading,
    isFeatureEnabled: (flagName: keyof RemoteFlags) => isFeatureEnabledFn(flagName),
    getFlag: (flagName: keyof RemoteFlags) => getFlagFn(flagName),
    getMaintenanceInfo: () => getMaintenanceInfoFn(),
  };

  return (
    <RemoteConfigContext.Provider value={value}>
      {children}
    </RemoteConfigContext.Provider>
  );
}
