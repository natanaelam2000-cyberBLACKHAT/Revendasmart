import { useEffect, useState } from "react";
import { defaultSettings, AppSettings } from "@/lib/mock-data";
import { getFirebaseAuth } from "@/lib/firebase";
import { onAuthStateChanged, User } from "firebase/auth";
import { getApiUrl } from "@/lib/api-config";

// ============================================================
// Module-level shared state for cross-instance coordination
// ============================================================

/** All active hook instances register a setter here */
const patchListeners = new Set<(patch: Partial<AppSettings>) => void>();
/** All active hook instances register a refetch trigger here */
const refetchListeners = new Set<() => void>();

/**
 * Optimistically patches settings in ALL active useUserSettings instances.
 * Use this for immediate UI update after a confirmed backend write.
 * Does NOT make a network request — just updates in-memory state.
 */
export function patchUserSettingsOptimistic(patch: Partial<AppSettings>) {
  patchListeners.forEach(fn => fn(patch));
}

/**
 * Triggers a full refetch in ALL active useUserSettings instances.
 * Use this when you need fresh data from Firestore.
 */
export function invalidateUserSettings() {
  refetchListeners.forEach(fn => fn());
}

// ============================================================

interface UseUserSettingsResult {
  settings: AppSettings;
  loading: boolean;
  error?: string;
  onboarding_completed: boolean;
}

/**
 * Custom hook to fetch user settings from Firestore via API.
 * Source: GET /api/user/settings/:userId (server/routes.ts)
 * Does NOT use localStorage — Firestore only.
 *
 * Cross-instance coordination:
 * - patchUserSettingsOptimistic(): immediate in-memory patch (no network)
 * - invalidateUserSettings(): full refetch from Firestore
 */
export function useUserSettings(): UseUserSettingsResult {
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [refetchSignal, setRefetchSignal] = useState(0);

  // Register this instance for optimistic patches
  useEffect(() => {
    const patchListener = (patch: Partial<AppSettings>) => {
      setSettings(prev => ({ ...prev, ...patch }));
    };
    patchListeners.add(patchListener);
    return () => { patchListeners.delete(patchListener); };
  }, []);

  // Register this instance for full refetch signals
  useEffect(() => {
    const refetchListener = () => setRefetchSignal(c => c + 1);
    refetchListeners.add(refetchListener);
    return () => { refetchListeners.delete(refetchListener); };
  }, []);

  // Track auth state (one-time subscription)
  useEffect(() => {
    const auth = getFirebaseAuth();
    if (!auth) {
      setAuthReady(true);
      setCurrentUser(null);
      setLoading(false);
      return;
    }
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setCurrentUser(user ?? null);
      setAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  // Fetch settings when auth is ready OR refetchSignal bumps
  useEffect(() => {
    if (!authReady) return;

    if (!currentUser) {
      setLoading(false);
      setSettings(defaultSettings);
      return;
    }

    let isMounted = true;
    setLoading(true);

    (async () => {
      try {
        const token = await currentUser.getIdToken();
        if (!token) throw new Error("Authentication token is empty");

        const debugTs = Date.now();
        const endpoint = `/api/user/settings/${currentUser.uid}?debug_auth=1&ts=${debugTs}`;
        const fetchUrl = getApiUrl(endpoint);

        const response = await fetch(fetchUrl, {
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`
          }
        });

        if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);

        const data = await response.json();
        if (isMounted) {
          const mergedSettings = { ...defaultSettings, ...data.settings };
          setSettings(mergedSettings);
          setError(undefined);
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error("[useUserSettings] Failed to fetch settings:", errorMsg);
        if (isMounted) {
          setError(errorMsg);
          setSettings(defaultSettings);
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    })();

    return () => { isMounted = false; };
  }, [authReady, currentUser, refetchSignal]);

  return {
    settings,
    loading,
    error,
    onboarding_completed: settings.onboarding_completed === true
  };
}
