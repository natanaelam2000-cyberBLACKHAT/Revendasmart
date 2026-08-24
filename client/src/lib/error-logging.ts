import type { FirebaseApp } from "firebase/app";
import { maskEmail, maskId, safeLogger, sanitizeLogMessage, sanitizeLogPayload } from "@/lib/safe-logger";

/**
 * ERROR LOGGING MODULE
 *
 * Client-side error tracking and diagnostics, routed through `safeLogger` (browser console, already
 * sanitized/masked — see safe-logger.ts).
 *
 * RELEASE-22: this module used to write to Firebase Realtime Database (`error_logs`/`event_logs`).
 * RTDB was never configured for this project — no `databaseURL` in `client/src/lib/firebase.ts`'s
 * config, no `database` entry in `firebase.json`, no versioned Rules anywhere in this repo — and the
 * one place that documented an observed outcome (`internal-telemetry.ts`) recorded that the equivalent
 * write path failed with `permission_denied` on Android/PWA. Writing to an unconfigured, unruled
 * database is not real observability; it's a dead network call with an undefined access-control
 * posture. This module now only logs locally (safeLogger → browser console) — the same sink
 * `client-diagnostics.ts` already writes to for every event, so no diagnostic signal is lost, only the
 * RTDB call that never reliably worked. Server-side observability (structured logs, Sentry when
 * configured) and Firebase Analytics/Performance are untouched by this change.
 */

let isInitialized = false;

declare global {
  interface Window {
    __errorLoggingUser?: {
      userId?: string;
      email?: string;
    };
  }
}

/**
 * Marks error logging as ready. Kept as a function (rather than deleted) so `firebase.ts` doesn't need
 * to change its call site — it no longer touches Firebase Realtime Database.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- assinatura preservada para o call site em firebase.ts; RTDB (o único uso real do app aqui) foi removido nesta tarefa
export function initializeErrorLogging(app: FirebaseApp): void {
  isInitialized = true;
}

/**
 * Log an error for local diagnostics (browser console via safeLogger — sanitized, masked).
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
  if (!isInitialized) return;

  const context: Record<string, unknown> = {
    module: "error-logging",
    message: sanitizeLogMessage(message),
    url: typeof window !== "undefined" ? window.location.pathname : "unknown",
  };
  if (options?.error?.stack) {
    context.stack = sanitizeLogMessage(options.error.stack, "Stack indisponível.");
  }
  if (options?.context) {
    context.context = sanitizeLogPayload(options.context);
  }
  if (options?.userId) {
    context.userId = maskId(options.userId) || undefined;
  }

  const severity = options?.severity ?? "error";
  if (severity === "warning") safeLogger.warn(errorType, context);
  else if (severity === "info") safeLogger.info(errorType, context);
  else safeLogger.error(errorType, options?.error, context);
}

/**
 * Log a business event for local diagnostics (browser console via safeLogger — sanitized, masked).
 */
export async function logEvent(
  eventName: string,
  data?: Record<string, unknown>,
  userId?: string
): Promise<void> {
  if (!isInitialized) return;

  safeLogger.info(eventName, {
    module: "error-logging",
    data: sanitizeLogPayload(data),
    userId: userId ? maskId(userId) || undefined : undefined,
    url: typeof window !== "undefined" ? window.location.pathname : "unknown",
  });
}

/**
 * Set user context for attributing logs to specific users
 */
export function setUserContext(userId: string, email?: string): void {
  try {
    if (typeof window !== "undefined") {
      window.__errorLoggingUser = {
        userId: maskId(userId) || undefined,
        email: maskEmail(email) || undefined,
      };
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
      delete window.__errorLoggingUser;
    }
  } catch (err) {
    safeLogger.error("error_logging_clear_user_context_failed", err, { module: "error-logging" });
  }
}
