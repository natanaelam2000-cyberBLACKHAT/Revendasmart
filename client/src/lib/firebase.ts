import { initializeApp, getApps, getApp, FirebaseApp } from "firebase/app";
import { getAuth, Auth, User, setPersistence, browserLocalPersistence } from "firebase/auth";
import { initializeErrorLogging, logError, setUserContext } from "./error-logging";
import { initializeInternalTelemetry } from "./internal-telemetry";
import { initializeFirebaseAnalytics } from "./firebase-analytics";
import { initializeFirebasePerformance } from "./firebase-performance";
import { initializeRemoteConfig, fetchRemoteConfig } from "./remote-config";

// Firebase configuration from Vite environment variables
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

let app: FirebaseApp | null = null;
let authInstance: Auth | null = null;
let initError: string | null = null;

/**
 * Initialize Firebase safely
 * Returns { app, auth, error }
 * If config is invalid, returns error message without crashing
 */
function initializeFirebase() {
  if (app !== null || initError !== null) {
    return { app, auth: authInstance, error: initError };
  }

  try {
    // Check if config is valid (all keys are required)
    const requiredKeys = ["apiKey", "authDomain", "projectId", "appId"] as const;
    for (const key of requiredKeys) {
      if (!firebaseConfig[key]) {
        throw new Error(`Missing Firebase config: ${key}`);
      }
    }

    // Diagnóstico completo do ambiente Firebase carregado no frontend
    const apiKey = firebaseConfig.apiKey;
    const maskedApiKey = apiKey
      ? `${apiKey.substring(0, 4)}...${apiKey.substring(apiKey.length - 4)}`
      : "UNDEFINED";

    console.log("[FIREBASE DEBUG] apiKey loaded from VITE_FIREBASE_API_KEY:", maskedApiKey);
    console.log("[FIREBASE DEBUG] projectId:", firebaseConfig.projectId);
    console.log("[FIREBASE DEBUG] authDomain:", firebaseConfig.authDomain);
    console.log("[FIREBASE DEBUG] appId:", firebaseConfig.appId);
    console.log("[FIREBASE DEBUG] storageBucket:", firebaseConfig.storageBucket);
    console.log("[FIREBASE DEBUG] messagingSenderId:", firebaseConfig.messagingSenderId);

   // 🔥 CORREÇÃO CRÍTICA
app = getApps().length === 0
  ? initializeApp(firebaseConfig)
  : getApp();


authInstance = getAuth(app);

// força persistência corretamente
setPersistence(authInstance, browserLocalPersistence)
  .then(() => {
    console.log("[Firebase] Persistence set to LOCAL");
  })
  .catch((err) => {
    console.error("[Firebase] Persistence error:", err);
  });
    console.log("[FIREBASE DEBUG] initialized app name:", app.name);
   // @ts-expect-error Firebase compat issue
    console.log("[FIREBASE DEBUG] initialized app projectId:", app.options?.projectId);
   // @ts-expect-error Firebase compat issue
    console.log("[FIREBASE DEBUG] initialized app authDomain:", app.options?.authDomain);

    // Initialize error logging after Firebase is initialized
    try {
      initializeErrorLogging(app);
    } catch (err) {
      console.warn("[Firebase] Error logging initialization failed, continuing without it");
    }

    // Initialize internal telemetry after Firebase is initialized
    try {
      initializeInternalTelemetry(app);
    } catch (err) {
      console.warn("[Firebase] Internal telemetry initialization failed, continuing without it");
    }

    // Initialize Firebase Analytics official
    try {
      initializeFirebaseAnalytics(app);
    } catch (err) {
      console.warn("[Firebase] Firebase Analytics initialization failed, continuing without it");
    }

    // Initialize Firebase Performance Monitoring
    try {
      initializeFirebasePerformance(app);
    } catch (err) {
      console.warn("[Firebase] Firebase Performance Monitoring initialization failed, continuing without it");
    }

    // Initialize Firebase Remote Config
    try {
      initializeRemoteConfig(app);
    } catch (err) {
      console.warn("[Firebase] Firebase Remote Config initialization failed, continuing without it");
    }

    return { app, auth: authInstance, error: null };
  } catch (error: any) {
    initError = error?.message || "Failed to initialize Firebase";
    console.error("[Firebase] Initialization error:", initError);
    return { app: null, auth: null, error: initError };
  }
}

// Lazy initialization - only initialize when needed
export function getFirebaseAuth(): Auth | null {
  const { auth } = initializeFirebase();
  return auth;
}

// Re-export Remote Config functions for convenience
export {
  isFeatureEnabled,
  getFlag,
  getAllFlags,
  getMaintenanceInfo,
  fetchRemoteConfig,
  refreshRemoteConfig,
  setupConfigUpdateListener,
  unsubscribeFromConfigUpdates,
} from "./remote-config";

export function getFirebaseError(): string | null {
  initializeFirebase();
  return initError;
}

// Returns the currently signed-in Firebase user (null if not authenticated)
export function getCurrentFirebaseUser(): User | null {
  const { auth } = initializeFirebase();
  return auth?.currentUser ?? null;
}

// Returns true if Firebase is configured and initialized
export function isFirebaseConfigured(): boolean {
  const { app } = initializeFirebase();
  return app !== null;
}

// Get current user's ID token for API authorization
export async function getFirebaseIdToken(): Promise<string | null> {
  try {
    const { auth } = initializeFirebase();
    console.log("[getFirebaseIdToken] auth exists:", !!auth);

    const user = auth?.currentUser;
    console.log(
      "[getFirebaseIdToken] currentUser exists:",
      !!user,
      user?.uid ? `uid=${user.uid}` : "no uid"
    );

    if (!user) {
      console.log("[getFirebaseIdToken] No user, returning null");
      return null;
    }

    const token = await user.getIdToken();
    console.log(
      "[getFirebaseIdToken] Token obtained:",
      token ? `token=${token.substring(0, 20)}...` : "null"
    );
    return token;
  } catch (e) {
    console.warn("[getFirebaseIdToken] Failed to get ID token:", e);

    // Log to Crashlytics
    if (e instanceof Error) {
      logError("firebase_id_token_error", e.message, {
        error: e,
        severity: "warning",
      });
    }

    return null;
  }
}

// Export error logging utilities for use in other modules
export { logError, logEvent, setUserContext, clearUserContext } from "./error-logging";

// Export internal telemetry utilities (for detailed debug/audit logging)
export {
  logTelemetryEvent,
  setTelemetryUserId,
  clearTelemetryUserId,
  type InternalTelemetryEvents,
} from "./internal-telemetry";

// Export Firebase Analytics official utilities (for product analytics)
export {
  trackAnalyticsEvent,
  setFirebaseAnalyticsUserId,
  setFirebaseAnalyticsUserProperty,
  type FirebaseAnalyticsEvents,
} from "./firebase-analytics";

// Export performance monitoring utilities for use in other modules
export {
  measureOperation,
  measureSyncOperation,
  createTrace,
  withPerformanceTrace,
} from "./firebase-performance";

export function getFirebaseApp(): FirebaseApp | null {
  const { app } = initializeFirebase();
  return app;
}