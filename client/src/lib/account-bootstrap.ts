/** Bounded account bootstrap. No Firebase initialization, environment reads or logging. */
export const ACCOUNT_BOOTSTRAP_TIMEOUT_MS = 15_000;

export type AccountFailureKind =
  | "auth" | "forbidden" | "not-found" | "rate-limited" | "server" | "http"
  | "network" | "timeout" | "invalid-response" | "configuration" | "cancelled";
export type AccountOperationPhase = "auth" | "token" | "settings" | "reset";

const PUBLIC_MESSAGES: Record<AccountFailureKind, string> = {
  auth: "Sua sessão não pôde ser validada. Entre novamente.",
  forbidden: "Não foi possível acessar as configurações da sua conta. Tente novamente ou procure suporte.",
  "not-found": "O serviço de configurações não foi encontrado. Tente novamente mais tarde.",
  "rate-limited": "Muitas tentativas. Aguarde um momento e tente novamente.",
  server: "O serviço está temporariamente indisponível. Tente novamente.",
  http: "Não foi possível carregar sua conta. Tente novamente.",
  network: "Falha de conexão ao carregar sua conta. Verifique a rede e tente novamente.",
  timeout: "O carregamento demorou mais que o esperado. Tente novamente.",
  "invalid-response": "O serviço retornou uma resposta incompleta. Tente novamente.",
  configuration: "A autenticação está indisponível no momento. Tente novamente mais tarde.",
  cancelled: "Carregamento cancelado.",
};

export class AccountBootstrapError extends Error {
  constructor(
    readonly kind: AccountFailureKind,
    readonly phase: AccountOperationPhase = "settings",
    readonly status?: number,
  ) {
    super(PUBLIC_MESSAGES[kind]);
    this.name = "AccountBootstrapError";
  }
}

export function getAccountFailureFeedback(error: unknown): {
  kind: AccountFailureKind; phase: AccountOperationPhase; status?: number; message: string;
} {
  const safe = error instanceof AccountBootstrapError
    ? error : new AccountBootstrapError("http");
  return { kind: safe.kind, phase: safe.phase, status: safe.status, message: PUBLIC_MESSAGES[safe.kind] };
}

export interface BoundedAccountOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  phase?: AccountOperationPhase;
}

/**
 * A deadline must settle the caller even when a dependency ignores AbortSignal.
 * It does NOT claim cancellation of Firebase SDK operations that cannot be aborted.
 * Such callers must keep their own reservation until the SDK promise settles.
 */
export async function runBoundedAccountOperation<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  options: BoundedAccountOptions = {},
): Promise<T> {
  const phase = options.phase ?? "settings";
  if (options.signal?.aborted) throw new AccountBootstrapError("cancelled", phase);
  const requested = options.timeoutMs ?? ACCOUNT_BOOTSTRAP_TIMEOUT_MS;
  const timeoutMs = Number.isFinite(requested) && requested > 0
    ? requested : ACCOUNT_BOOTSTRAP_TIMEOUT_MS;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abortError: AccountBootstrapError | undefined;
  let abortFromCaller: (() => void) | undefined;
  const cancellation = new Promise<never>((_resolve, reject) => {
    const cancel = (kind: "timeout" | "cancelled") => {
      if (abortError) return;
      abortError = new AccountBootstrapError(kind, phase);
      controller.abort();
      reject(abortError);
    };
    abortFromCaller = () => cancel("cancelled");
    options.signal?.addEventListener("abort", abortFromCaller, { once: true });
    timer = setTimeout(() => cancel("timeout"), timeoutMs);
  });
  try {
    const pending = Promise.resolve().then(() => {
      if (abortError) throw abortError;
      return operation(controller.signal);
    });
    const value = await Promise.race([pending, cancellation]);
    if (abortError) throw abortError;
    return value;
  } catch (error) {
    // Prefer the deadline/caller-cancel reason over a dependency's generic AbortError.
    throw abortError ?? error;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (abortFromCaller) options.signal?.removeEventListener("abort", abortFromCaller);
  }
}

export interface AccountBootstrapUser {
  uid: string;
  getIdToken: () => Promise<string>;
}

export type AccountSettingsSnapshot = Record<string, unknown> & { onboarding_completed: boolean };

export interface AccountSettingsOptions extends BoundedAccountOptions {
  url: string;
  fetchImpl?: typeof fetch;
  /** Must fence both UID and request generation. Checked across every async boundary. */
  isCurrentUser?: () => boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Only an explicit boolean can decide onboarding; HTTP failure is never a new account. */
export function parseAccountSettings(payload: unknown): AccountSettingsSnapshot {
  if (!isRecord(payload) || !isRecord(payload.settings)) {
    throw new AccountBootstrapError("invalid-response");
  }
  const top = payload.onboarding_completed;
  const nested = payload.settings.onboarding_completed;
  if ((top !== undefined && typeof top !== "boolean")
    || (nested !== undefined && typeof nested !== "boolean")
    || (typeof top === "boolean" && typeof nested === "boolean" && top !== nested)) {
    throw new AccountBootstrapError("invalid-response");
  }
  const completed = typeof top === "boolean" ? top : nested;
  if (typeof completed !== "boolean") throw new AccountBootstrapError("invalid-response");
  return { ...payload.settings, onboarding_completed: completed };
}

function failureForStatus(status: number): AccountBootstrapError {
  const kind: AccountFailureKind = status === 401 ? "auth"
    : status === 403 ? "forbidden"
    : status === 404 ? "not-found"
    : status === 429 ? "rate-limited"
    : status >= 500 && status <= 599 ? "server" : "http";
  return new AccountBootstrapError(kind, "settings", status);
}

function tokenFailure(error: unknown): AccountBootstrapError {
  const code = isRecord(error) && typeof error.code === "string" ? error.code : "";
  if (code === "auth/network-request-failed") return new AccountBootstrapError("network", "token");
  if (code === "auth/too-many-requests") return new AccountBootstrapError("rate-limited", "token");
  if (["auth/invalid-api-key", "auth/app-not-authorized", "auth/operation-not-allowed",
    "auth/unauthorized-domain", "auth/invalid-app-credential"].includes(code)) {
    return new AccountBootstrapError("configuration", "token");
  }
  return new AccountBootstrapError("auth", "token");
}

/** Token, response and JSON all share one deadline; no error body or SDK object is logged. */
export async function requestAccountSettings(
  user: AccountBootstrapUser,
  options: AccountSettingsOptions,
): Promise<AccountSettingsSnapshot> {
  let phase: AccountOperationPhase = "token";
  const assertCurrent = () => {
    if (options.signal?.aborted || (options.isCurrentUser && !options.isCurrentUser())) {
      throw new AccountBootstrapError("cancelled", phase);
    }
  };
  try {
    return await runBoundedAccountOperation(async (signal) => {
      const assertActive = () => {
        assertCurrent();
        if (signal.aborted) throw new AccountBootstrapError("cancelled", phase);
      };
      assertActive();
      if (!user?.uid || typeof user.getIdToken !== "function") {
        throw new AccountBootstrapError("auth", "token");
      }
      const token = await user.getIdToken();
      assertActive();
      if (!token || typeof token !== "string") throw new AccountBootstrapError("auth", "token");
      phase = "settings";
      const response = await (options.fetchImpl ?? fetch)(options.url, {
        method: "GET",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        signal,
      });
      assertActive();
      if (!response.ok) throw failureForStatus(response.status);
      let payload: unknown;
      try { payload = await response.json(); }
      catch (error) {
        assertActive();
        throw new AccountBootstrapError("invalid-response");
      }
      assertActive();
      return parseAccountSettings(payload);
    }, { signal: options.signal, timeoutMs: options.timeoutMs, phase: "settings" });
  } catch (error) {
    if (error instanceof AccountBootstrapError) {
      throw new AccountBootstrapError(error.kind, phase, error.status);
    }
    // A fetch TypeError cannot distinguish CORS/TLS/DNS from a physical network failure.
    throw phase === "token" ? tokenFailure(error) : new AccountBootstrapError("network", phase);
  }
}
