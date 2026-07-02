import { initializeApp, FirebaseApp } from "firebase/app";
import { getDatabase, ref, push, set, Database } from "firebase/database";

/**
 * ERROR LOGGING MODULE
 * 
 * Custom client-side error tracking and logging to Firebase Realtime Database.
 * Captures JavaScript errors, network failures, and business logic errors
 * for monitoring and diagnostics.
 * 
 * Features:
 * - Automatic error logging with stack traces
 * - Business event tracking
 * - User context attribution
 * - Async, non-blocking logging
 */

let database: Database | null = null;
let isInitialized = false;

interface ErrorLog {
  timestamp: string;
  userId?: string;
  errorType: string;
  message: string;
  stack?: string;
  context?: Record<string, any>;
  url: string;
  userAgent: string;
  severity: "error" | "warning" | "info";
}

/**
 * Initialize error logging (uses existing Firebase app)
 */
export function initializeErrorLogging(app: FirebaseApp): void {
  if (isInitialized) return;

  try {
    database = getDatabase(app);
    isInitialized = true;
  } catch (error) {
    console.error("[ErrorLogging] Failed to initialize:", error);
  }
}

/**
 * Log an error for monitoring and diagnostics
 */
export async function logError(
  errorType: string,
  message: string,
  options?: {
    error?: Error;
    context?: Record<string, any>;
    userId?: string;
    severity?: "error" | "warning" | "info";
  }
): Promise<void> {
  if (!isInitialized || !database) {
    console.warn("[ErrorLogging] Not initialized, error not logged");
    return;
  }

  try {
    const errorLog: ErrorLog = {
      timestamp: new Date().toISOString(),
      errorType,
      message,
      url: typeof window !== "undefined" ? window.location.href : "unknown",
      userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "unknown",
      severity: options?.severity || "error",
    };

    // Only add optional fields if they have values (Firebase doesn't allow undefined)
    if (options?.error?.stack) {
      errorLog.stack = options.error.stack;
    }
    if (options?.context) {
      errorLog.context = options.context;
    }
    if (options?.userId) {
      errorLog.userId = options.userId;
    }

    const errorsRef = ref(database, "error_logs");
    const newErrorRef = push(errorsRef);
    await set(newErrorRef, errorLog);
  } catch (err) {
    console.error("[ErrorLogging] Failed to log error:", err);
  }
}

/**
 * Log a business event for tracking user journeys and system behavior
 */
export async function logEvent(
  eventName: string,
  data?: Record<string, any>,
  userId?: string
): Promise<void> {
  if (!isInitialized || !database) return;

  try {
    const eventLog = {
      timestamp: new Date().toISOString(),
      eventName,
      data,
      userId,
      url: typeof window !== "undefined" ? window.location.href : "unknown",
    };

    const eventsRef = ref(database, "event_logs");
    const newEventRef = push(eventsRef);
    await set(newEventRef, eventLog);
  } catch (err) {
    console.error("[ErrorLogging] Failed to log event:", err);
  }
}

/**
 * Set user context for attributing logs to specific users
 */
export function setUserContext(userId: string, email?: string): void {
  try {
    if (typeof window !== "undefined") {
      (window as any).__errorLoggingUser = { userId, email };
    }
  } catch (err) {
    console.error("[ErrorLogging] Failed to set user context:", err);
  }
}

/**
 * Clear user context
 */
export function clearUserContext(): void {
  try {
    if (typeof window !== "undefined") {
      delete (window as any).__errorLoggingUser;
    }
  } catch (err) {
    console.error("[ErrorLogging] Failed to clear user context:", err);
  }
}
