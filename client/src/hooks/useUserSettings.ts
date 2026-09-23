import { useEffect, useState } from "react";
import { defaultSettings, AppSettings } from "@/lib/mock-data";
import { getFirebaseAuth } from "@/lib/firebase";
import { onAuthStateChanged, User } from "firebase/auth";
import { getApiUrl } from "@/lib/api-config";
import { resolveBusinessModeBootstrap, type BusinessModeResolution } from "@shared/business-mode";

// ============================================================
// Module-level shared state for cross-instance coordination
// ============================================================

/** All active hook instances register a setter here */
type SettingsPatchListener = (patch: Partial<AppSettings>) => void;
const patchListeners = new Map<string, Set<SettingsPatchListener>>();
/** All active hook instances register a refetch trigger here */
const refetchListeners = new Set<() => void>();

/**
 * Optimistically patches settings in ALL active useUserSettings instances.
 * Use this for immediate UI update after a confirmed backend write.
 * Does NOT make a network request — just updates in-memory state.
 */
export function patchUserSettingsOptimistic(patch: Partial<AppSettings>, targetUid: string | null) {
  if (!targetUid) return;
  patchListeners.get(targetUid)?.forEach(fn => fn(patch));
}

/**
 * Triggers a full refetch in ALL active useUserSettings instances.
 * Use this when you need fresh data from Firestore.
 */
export function invalidateUserSettings() {
  refetchListeners.forEach(fn => fn());
}

// ============================================================

export type UserSettingsLoadStatus = "loading" | "loaded" | "error";

interface UseUserSettingsResult {
  settings: AppSettings;
  loading: boolean;
  loaded: boolean;
  loadStatus: UserSettingsLoadStatus;
  error?: string;
  userId: string | null;
  businessModeResolution: BusinessModeResolution;
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
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string>();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [refetchSignal, setRefetchSignal] = useState(0);

  // Register this instance for optimistic patches
  useEffect(() => {
    const uid = currentUser?.uid;
    if (!uid) return;
    const patchListener = (patch: Partial<AppSettings>) => {
      setSettings(prev => ({ ...prev, ...patch }));
    };
    const listeners = patchListeners.get(uid) ?? new Set<SettingsPatchListener>();
    listeners.add(patchListener);
    patchListeners.set(uid, listeners);
    return () => {
      listeners.delete(patchListener);
      if (listeners.size === 0) patchListeners.delete(uid);
    };
  }, [currentUser?.uid]);

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
      setLoaded(false);
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
      setLoaded(false);
      setError(undefined);
      setSettings(defaultSettings);
      setLoading(false);
      return;
    }

    let isMounted = true;
    setLoading(true);
    setLoaded(false);
    setError(undefined);
    setSettings(defaultSettings);

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
          setLoaded(true);
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error("[useUserSettings] Failed to fetch settings:", errorMsg);
        if (isMounted) {
          setError(errorMsg);
          setLoaded(false);
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

  const businessModeResolution = resolveBusinessModeBootstrap({
    businessMode: settings.businessMode,
    loading,
    loaded,
    error,
  });
  const loadStatus: UserSettingsLoadStatus = error ? "error" : loading || !loaded ? "loading" : "loaded";

  return {
    settings,
    loading,
    loaded,
    loadStatus,
    error,
    userId: currentUser?.uid ?? null,
    businessModeResolution,
    onboarding_completed: settings.onboarding_completed === true
  };
}
