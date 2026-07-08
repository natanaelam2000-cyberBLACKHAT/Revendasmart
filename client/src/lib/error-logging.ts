import { initializeApp, FirebaseApp } from "firebase/app";
import { getDatabase, ref, push, set, Database } from "firebase/database";
import { maskEmail, maskId, safeLogger, sanitizeLogMessage, sanitizeLogPayload } from "@/lib/safe-logger";

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
  context?: Record<string, unknown>;
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
    safeLogger.error("error_logging_initialize_failed", error, { module: "error-logging" });
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
    context?: Record<string, unknown>;
    userId?: string;
    severity?: "error" | "warning" | "info";
  }
): Promise<void> {
  if (!isInitialized || !database) {
    safeLogger.warn("error_logging_not_initialized", { module: "error-logging", errorType });
    return;
  }

  try {
    const errorLog: ErrorLog = {
      timestamp: new Date().toISOString(),
      errorType,
      message: sanitizeLogMessage(message),
      url: typeof window !== "undefined" ? window.location.href : "unknown",
      userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "unknown",
      severity: options?.severity || "error",
    };

    // Only add optional fields if they have values (Firebase doesn't allow undefined)
    if (options?.error?.stack) {
      errorLog.stack = sanitizeLogMessage(options.error.stack, "Stack indisponível.");
    }
    if (options?.context) {
      errorLog.context = sanitizeLogPayload(options.context) as Record<string, unknown>;
    }
    if (options?.userId) {
      errorLog.userId = maskId(options.userId) || undefined;
    }

    const errorsRef = ref(database, "error_logs");
    const newErrorRef = push(errorsRef);
    await set(newErrorRef, errorLog);
  } catch (err) {
    safeLogger.error("error_logging_log_error_failed", err, { module: "error-logging" });
  }
}

/**
 * Log a business event for tracking user journeys and system behavior
 */
export async function logEvent(
  eventName: string,
  data?: Record<string, unknown>,
  userId?: string
): Promise<void> {
  if (!isInitialized || !database) return;

  try {
    const eventLog = {
      timestamp: new Date().toISOString(),
      eventName,
      data: sanitizeLogPayload(data),
      userId: maskId(userId) || undefined,
      url: typeof window !== "undefined" ? window.location.href : "unknown",
    };

    const eventsRef = ref(database, "event_logs");
    const newEventRef = push(eventsRef);
    await set(newEventRef, eventLog);
  } catch (err) {
    safeLogger.error("error_logging_log_event_failed", err, { module: "error-logging", eventName });
  }
}

/**
 * Set user context for attributing logs to specific users
 */
export function setUserContext(userId: string, email?: string): void {
  try {
    if (typeof window !== "undefined") {
      (window as any).__errorLoggingUser = { userId: maskId(userId), email: maskEmail(email) };
    }
  } catch (err) {
    safeLogger.error("error_logging_set_user_context_failed", err, { module: "error-logging" });
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
    safeLogger.error("error_logging_clear_user_context_failed", err, { module: "error-logging" });
  }
}
