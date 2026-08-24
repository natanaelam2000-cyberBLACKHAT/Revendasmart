import { safeLogger, sanitizeLogMessage, sanitizeLogPayload } from "@/lib/safe-logger";

export type DiagnosticDomain =
  | "AUTH"
  | "CATALOG"
  | "UPLOAD"
  | "SUBSCRIPTION_MP"
  | "PLAY_BILLING"
  | "MARKETING_PRO"
  | "ACCOUNT_DELETION"
  | "REFERRAL"
  | "REACT"
  | "NETWORK";

export type DiagnosticResult = "success" | "failure" | "retry";
export type DiagnosticSeverity = "info" | "warning" | "error" | "fatal";

export interface ClientDiagnosticInput {
  readonly domain: DiagnosticDomain;
  readonly event: string;
  readonly result: DiagnosticResult;
  readonly severity?: DiagnosticSeverity;
  readonly error?: unknown;
  readonly requestId?: string;
  readonly context?: Record<string, unknown>;
}

export interface ClientDiagnosticEvent {
  readonly timestamp: string;
  readonly domain: DiagnosticDomain;
  readonly event: string;
  readonly result: DiagnosticResult;
  readonly severity: DiagnosticSeverity;
  readonly requestId?: string;
  readonly message?: string;
  readonly context?: Record<string, unknown>;
  readonly url?: string;
}

let installed = false;

export function buildClientDiagnosticEvent(input: ClientDiagnosticInput, now: Date = new Date()): ClientDiagnosticEvent {
  const errorMessage = input.error instanceof Error ? input.error.message : input.error;
  const context = sanitizeLogPayload(input.context ?? {}) as Record<string, unknown>;
  return {
    timestamp: now.toISOString(),
    domain: input.domain,
    event: input.event,
    result: input.result,
    severity: input.severity ?? (input.result === "failure" ? "error" : "info"),
    ...(input.requestId ? { requestId: sanitizeLogMessage(input.requestId) } : {}),
    ...(errorMessage ? { message: sanitizeLogMessage(errorMessage) } : {}),
    ...(Object.keys(context).length > 0 ? { context } : {}),
    ...(typeof window !== "undefined" ? { url: window.location.pathname } : {}),
  };
}

export async function reportClientDiagnostic(input: ClientDiagnosticInput): Promise<void> {
  const event = buildClientDiagnosticEvent(input);
  const payload = event as unknown as Record<string, unknown>;

  if (event.severity === "fatal") safeLogger.fatal("client.diagnostic", payload);
  else if (event.severity === "error") safeLogger.error("client.diagnostic", undefined, payload);
  else if (event.severity === "warning") safeLogger.warn("client.diagnostic", payload);
  else safeLogger.info("client.diagnostic", payload);

  try {
    const { logError } = await import("@/lib/error-logging");
    if (event.result === "failure") {
      await logError(event.event, event.message ?? "Client diagnostic failure", {
        context: payload,
        severity: event.severity === "fatal" ? "error" : event.severity,
      });
    }
  } catch (error) {
    safeLogger.warn("client_diagnostic_rtdb_log_failed", { module: "client-diagnostics", error });
  }
}

export function installClientDiagnostics(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;

  window.addEventListener("error", (event) => {
    void reportClientDiagnostic({
      domain: "REACT",
      event: "window_error",
      result: "failure",
      severity: "error",
      error: event.error ?? event.message,
      context: { filename: event.filename, lineno: event.lineno, colno: event.colno },
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    void reportClientDiagnostic({
      domain: "REACT",
      event: "unhandled_rejection",
      result: "failure",
      severity: "error",
      error: event.reason,
    });
  });

  window.addEventListener("offline", () => {
    void reportClientDiagnostic({ domain: "NETWORK", event: "client_offline", result: "failure", severity: "warning" });
  });
}
