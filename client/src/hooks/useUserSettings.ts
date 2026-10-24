import { useEffect, useRef, useState } from "react";
import { defaultSettings, AppSettings } from "@/lib/mock-data";
import { getFirebaseAuth } from "@/lib/firebase";
import { onAuthStateChanged, User } from "firebase/auth";
import { getApiUrl } from "@/lib/api-config";
import { resolveBusinessModeBootstrap, type BusinessModeResolution } from "@shared/business-mode";
import {
  ACCOUNT_BOOTSTRAP_TIMEOUT_MS,
  getAccountFailureFeedback,
  requestAccountSettings,
} from "@/lib/account-bootstrap";

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
  const [storedSettings, setSettings] = useState<AppSettings>(defaultSettings);
  const [storedLoading, setLoading] = useState(true);
  const [storedLoaded, setLoaded] = useState(false);
  const [storedError, setError] = useState<string>();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [refetchSignal, setRefetchSignal] = useState(0);
  const [authAttempt, setAuthAttempt] = useState(0);
  const [ownerUid, setOwnerUid] = useState<string | null>(null);
  const authRef = useRef<ReturnType<typeof getFirebaseAuth>>(null);
  const currentUserRef = useRef<User | null>(null);
  const authFailedRef = useRef(false);
  const requestGeneration = useRef(0);
  const requestController = useRef<AbortController | null>(null);
  const publishedUid = useRef<string | null>(null);

  const cancelPendingRequest = () => {
    requestGeneration.current += 1;
    requestController.current?.abort();
    requestController.current = null;
  };

  // Register this instance for optimistic patches
  useEffect(() => {
    const uid = currentUser?.uid;
    if (!uid) return;
    const patchListener = (patch: Partial<AppSettings>) => {
      if (publishedUid.current !== uid || currentUserRef.current?.uid !== uid || authRef.current?.currentUser?.uid !== uid) return;
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
    const refetchListener = () => {
      cancelPendingRequest();
      if (authFailedRef.current || currentUserRef.current?.uid !== authRef.current?.currentUser?.uid) setAuthAttempt(c => c + 1);
      else setRefetchSignal(c => c + 1);
    };
    refetchListeners.add(refetchListener);
    return () => { refetchListeners.delete(refetchListener); };
  }, []);

  // Unknown authentication is bounded, never treated as a new account or a confirmed logout.
  useEffect(() => {
    const auth = getFirebaseAuth();
    authRef.current = auth;
    if (!auth) {
      setAuthReady(true);
      currentUserRef.current = null;
      setCurrentUser(null);
      setLoaded(false);
      setLoading(false);
      return;
    }

    let active = true;
    let observed = false;
    const failAuth = () => {
      if (!active) return;
      cancelPendingRequest();
      authFailedRef.current = true;
      currentUserRef.current = null;
      publishedUid.current = null;
      setCurrentUser(null);
      setOwnerUid(null);
      setAuthReady(false);
      setSettings(defaultSettings);
      setLoaded(false);
      setLoading(false);
      setError("Não foi possível confirmar sua sessão. Tente novamente.");
    };
    setLoading(true);
    setError(undefined);
    const timeout = setTimeout(failAuth, ACCOUNT_BOOTSTRAP_TIMEOUT_MS);
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (!active) return;
      clearTimeout(timeout);
      const firstObservation = !observed;
      observed = true;
      const nextUser = user ?? null;
      const changed = currentUserRef.current?.uid !== nextUser?.uid || authFailedRef.current;
      authFailedRef.current = false;
      currentUserRef.current = nextUser;
      if (changed) {
        cancelPendingRequest();
        publishedUid.current = null;
        setOwnerUid(nextUser?.uid ?? null);
        setSettings(defaultSettings);
        setLoaded(false);
        setError(undefined);
        setLoading(Boolean(nextUser));
      }
      setCurrentUser(nextUser);
      setAuthReady(true);
      // Re-observation must restart a cancelled read even for the identical User object/UID.
      // Together with the auth setters above, this schedules one confirmed subscription read.
      if (firstObservation) setRefetchSignal(c => c + 1);
    }, () => {
      clearTimeout(timeout);
      failAuth();
    });
    return () => {
      active = false;
      clearTimeout(timeout);
      unsubscribe();
      cancelPendingRequest();
    };
  }, [authAttempt]);

  // A foreground transition retries only settings; it never signs in or initializes a plan.
  useEffect(() => {
    if (typeof document === "undefined" || typeof window === "undefined") return;
    let lastResumeAt = Date.now();
    const resume = () => {
      if (document.hidden || document.visibilityState === "hidden") return;
      const now = Date.now();
      if (now - lastResumeAt < 500) return;
      lastResumeAt = now;
      cancelPendingRequest();
      if (authFailedRef.current || currentUserRef.current?.uid !== authRef.current?.currentUser?.uid) setAuthAttempt(c => c + 1);
      else if (currentUserRef.current) setRefetchSignal(c => c + 1);
    };
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("pageshow", resume);
    return () => {
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("pageshow", resume);
    };
  }, []);

  // Fetch settings when auth is ready OR refetchSignal bumps
  useEffect(() => {
    if (!authReady) return;

    if (!currentUser) {
      publishedUid.current = null;
      setOwnerUid(null);
      setLoaded(false);
      setError(undefined);
      setSettings(defaultSettings);
      setLoading(false);
      return;
    }

    let isMounted = true;
    const generation = ++requestGeneration.current;
    const controller = new AbortController();
    requestController.current?.abort();
    requestController.current = controller;
    publishedUid.current = null;
    setOwnerUid(currentUser.uid);
    setLoading(true);
    setLoaded(false);
    setError(undefined);
    setSettings(defaultSettings);
    const isCurrentUser = () => isMounted
      && generation === requestGeneration.current
      && currentUserRef.current?.uid === currentUser.uid
      && authRef.current?.currentUser?.uid === currentUser.uid;

    (async () => {
      try {
        const data = await requestAccountSettings(currentUser, {
          url: getApiUrl(`/api/user/settings/${encodeURIComponent(currentUser.uid)}`),
          signal: controller.signal,
          isCurrentUser,
        });
        if (isCurrentUser()) {
          const mergedSettings = { ...defaultSettings, ...data } as AppSettings;
          setSettings(mergedSettings);
          setError(undefined);
          publishedUid.current = currentUser.uid;
          setLoaded(true);
        }
      } catch (err) {
        if (isCurrentUser()) {
          setError(getAccountFailureFeedback(err).message);
          setLoaded(false);
          setSettings(defaultSettings);
        }
      } finally {
        if (isCurrentUser()) {
          setLoading(false);
        }
      }
    })();

    return () => {
      isMounted = false;
      controller.abort();
      if (requestController.current === controller) requestController.current = null;
    };
  }, [authReady, currentUser, refetchSignal]);

  // Also fence render before an auth callback/effect can clear the preceding tenant's state.
  const ownsSnapshot = Boolean(currentUser
    && currentUser.uid === ownerUid
    && authRef.current?.currentUser?.uid === currentUser.uid);
  const settings = ownsSnapshot ? storedSettings : defaultSettings;
  const loading = storedLoading || Boolean(currentUser && !ownsSnapshot);
  const loaded = ownsSnapshot && storedLoaded;
  const error = ownsSnapshot || !currentUser ? storedError : undefined;
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
