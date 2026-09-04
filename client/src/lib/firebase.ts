import { initializeApp, getApps, getApp, FirebaseApp } from "firebase/app";
import { getAuth, connectAuthEmulator, Auth, User, setPersistence, browserLocalPersistence, onAuthStateChanged } from "firebase/auth";
import { initializeFirestore, getFirestore, persistentLocalCache, persistentMultipleTabManager, terminate, clearIndexedDbPersistence } from "firebase/firestore";
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

const FIREBASE_EMULATORS_CONNECTED_KEY = "__revendaSmartFirebaseEmulatorsConnected";

function shouldUseFirebaseEmulators() {
  return import.meta.env.VITE_USE_FIREBASE_EMULATORS === "true";
}

async function connectFirestoreAndStorageEmulators(firebaseApp: FirebaseApp) {
  const [{ connectFirestoreEmulator }, { getStorage, connectStorageEmulator }] = await Promise.all([
    import("firebase/firestore"),
    import("firebase/storage"),
  ]);

  // getFirestore(app) aqui devolve a MESMA instância já criada por initializeFirestoreWithOfflinePersistence
  // (chamada antes, em initializeFirebase) — nunca uma segunda instância sem cache persistente.
  connectFirestoreEmulator(getFirestore(firebaseApp), "127.0.0.1", 8080);
  connectStorageEmulator(getStorage(firebaseApp), "127.0.0.1", 9199);
}

let firestorePersistenceInitialized = false;

/**
 * RELEASE-QUALITY-04 §2/§4 — liga a persistência offline do Firestore (IndexedDB) UMA vez, antes de
 * qualquer `getFirestore(app)` no resto do código (que continua funcionando sem mudar nada, porque
 * `getFirestore()` sem novos settings devolve a MESMA instância já configurada). Isso é o único passo
 * necessário para leitura offline (todos os hooks já usam onSnapshot) e escrita offline de
 * produtos/clientes (já são setDoc direto) funcionarem — o SDK já resolve a fila sozinho.
 */
function initializeFirestoreWithOfflinePersistence(firebaseApp: FirebaseApp): void {
  if (firestorePersistenceInitialized) return;
  firestorePersistenceInitialized = true;
  try {
    initializeFirestore(firebaseApp, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    });
  } catch (err) {
    // Só pode acontecer se algo já tiver chamado getFirestore(app) antes disto (ex.: HMR em dev
    // reexecutando este módulo) — o app continua funcionando, só sem cache persistente até reload.
    console.warn("[Firebase] Persistent Firestore cache not applied:", err);
  }
}

/**
 * §8 — isolamento por tenant: ao deslogar, apaga o cache local do Firestore (IndexedDB) inteiro para
 * que nenhum documento do usuário anterior sobreviva num troca de conta no mesmo aparelho. O
 * isolamento por path (`users/{uid}/...`) já impede a UI de MOSTRAR dado de outro usuário, mas o
 * arquivo IndexedDB em si é por projeto, não por uid — isto é a camada extra de defesa.
 */
/**
 * Retorna `true` quando o cache foi realmente limpo, `false` quando falhou (ex.: outra aba ainda
 * segurando o banco IndexedDB, via persistentMultipleTabManager). LGPD §8 (REVENDASMART-LGPD-ANPD-
 * REMEDIATION-01): antes essa falha só ia para `console.warn` (invisível em produção) e os chamadores
 * nem checavam o retorno — o cache do usuário anterior podia sobreviver silenciosamente num dispositivo
 * compartilhado. Agora reporta via `logError` (visível nos logs de produção) para que uma falha real
 * de isolamento de tenant não passe despercebida.
 */
export async function clearFirestoreOfflineCache(): Promise<boolean> {
  if (!app) return true;
  try {
    const db = getFirestore(app);
    await terminate(db);
    await clearIndexedDbPersistence(db);
    return true;
  } catch (err) {
    logError("firestore_offline_cache_clear_failed", err instanceof Error ? err.message : String(err), {
      severity: "error",
    });
    return false;
  } finally {
    // Reinicia a persistência imediatamente — sem isto, o PRÓXIMO getFirestore(app) (ex.: outro
    // usuário logando na mesma aba, sem reload de página) criaria uma instância nova SEM cache
    // persistente, e o próximo logout não teria nada para limpar de propósito.
    firestorePersistenceInitialized = false;
    initializeFirestoreWithOfflinePersistence(app);
  }
}

let lastKnownAuthUid: string | null | undefined;

/**
 * LGPD §8 (REVENDASMART-LGPD-ANPD-REMEDIATION-01) — fecha o gap "nenhum caminho de expiração de sessão
 * limpa o cache offline" achado na auditoria. Os dois pontos de logout manual (`settings.tsx`,
 * `account-deletion.tsx`) já chamavam `clearFirestoreOfflineCache()` diretamente, mas uma sessão que
 * cai sozinha (token revogado, refresh token inválido, troca de conta sem logout explícito) nunca
 * passava por lá. Este listener cobre TODAS as transições de uid — incluindo essas — num único lugar,
 * em vez de depender de cada tela lembrar de chamar a limpeza.
 */
function installOfflineCacheTenantIsolation(auth: Auth): void {
  onAuthStateChanged(auth, (user) => {
    const currentUid = user?.uid ?? null;
    // Primeira chamada (lastKnownAuthUid ainda `undefined`) é só a leitura inicial da sessão — não é
    // uma transição de usuário, nunca deve limpar nada.
    if (lastKnownAuthUid !== undefined && lastKnownAuthUid !== null && lastKnownAuthUid !== currentUid) {
      void clearFirestoreOfflineCache();
      // Import dinâmico: mock-data.ts é um módulo grande e este caminho só roda numa transição real de
      // usuário, não no boot do app.
      void import("./mock-data").then(({ clearAllImagesFromIndexedDb }) => clearAllImagesFromIndexedDb());
    }
    lastKnownAuthUid = currentUid;
  });
}

function connectFirebaseEmulatorsOnce(firebaseApp: FirebaseApp, auth: Auth) {
  if (!shouldUseFirebaseEmulators()) return;

  if (import.meta.env.PROD) {
    throw new Error("VITE_USE_FIREBASE_EMULATORS=true não pode ser usado em produção.");
  }

  const emulatorState = globalThis as typeof globalThis & { [FIREBASE_EMULATORS_CONNECTED_KEY]?: boolean };
  if (emulatorState[FIREBASE_EMULATORS_CONNECTED_KEY]) return;

  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  void connectFirestoreAndStorageEmulators(firebaseApp);
  emulatorState[FIREBASE_EMULATORS_CONNECTED_KEY] = true;
}

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

   // 🔥 CORREÇÃO CRÍTICA
app = getApps().length === 0
  ? initializeApp(firebaseConfig)
  : getApp();

// Precisa vir ANTES de qualquer getFirestore(app) (inclusive o do conector de emulador logo abaixo) —
// initializeFirestore só pode configurar settings na primeira chamada para esta app.
initializeFirestoreWithOfflinePersistence(app);

authInstance = getAuth(app);
connectFirebaseEmulatorsOnce(app, authInstance);
installOfflineCacheTenantIsolation(authInstance);

// força persistência corretamente
setPersistence(authInstance, browserLocalPersistence)
  .then(() => undefined)
  .catch((err) => {
    console.error("[Firebase] Persistence error:", err);
  });

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

    // PLAN-IMPL-06 §38 — nunca inicializa Analytics contra o emulador/dev local: sem este gate, uma
    // sessão de dev com credenciais REAIS de Analytics no .env.local (ou CI/QA local) mandaria eventos
    // de teste para a propriedade de produção do Google Analytics, poluindo as métricas reais. Mesmo
    // flag já usado para Firestore/Auth/Storage emulator — nenhum segundo mecanismo de detecção.
    if (!shouldUseFirebaseEmulators()) {
      try {
        initializeFirebaseAnalytics(app);
      } catch (err) {
        console.warn("[Firebase] Firebase Analytics initialization failed, continuing without it");
      }
    }

    // Initialize Firebase Performance Monitoring
    try {
      initializeFirebasePerformance(app);
    } catch (err) {
      console.warn("[Firebase] Firebase Performance Monitoring initialization failed, continuing without it");
    }

    // Initialize Firebase Remote Config. Assíncrono desde RELEASE-QUALITY-02 §7 (o SDK
    // firebase/remote-config agora é importado sob demanda, não no boot) — a própria função já trata
    // seus erros internamente e nunca rejeita, então isto continua "fire and forget" como antes.
    void initializeRemoteConfig(app);

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

    const user = auth?.currentUser;

    if (!user) {
      return null;
    }

    const token = await user.getIdToken();
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
  type AnalyticsPaywallReason,
  type AnalyticsResourceType,
  type AnalyticsSource,
  type AnalyticsCheckoutFailureReason,
  type AnalyticsPreparationFailureCategory,
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