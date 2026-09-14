import { getApiUrl } from "./api-config";

export type ApiMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
export type ApiResponseType = "json" | "text" | "blob" | "arrayBuffer" | "response";

const DEFAULT_TIMEOUT_MS = 15000;

export type ApiRequestOptions = {
  method?: ApiMethod;
  headers?: HeadersInit;
  body?: unknown;
  auth?: boolean;
  timeoutMs?: number;
  signal?: AbortSignal;
  responseType?: ApiResponseType;
  fetchImpl?: typeof fetch;
  getAuthToken?: () => Promise<string | null | undefined> | string | null | undefined;
};

type ApiErrorParams = {
  status?: number;
  code: string;
  message: string;
  requestId?: string;
  retryable?: boolean;
  cause?: unknown;
};

export class ApiError extends Error {
  readonly status?: number;
  readonly code: string;
  readonly requestId?: string;
  readonly retryable: boolean;
  readonly safeCause?: unknown;

  constructor(params: ApiErrorParams) {
    super(params.message);
    this.name = "ApiError";
    this.status = params.status;
    this.code = params.code;
    this.requestId = params.requestId;
    this.retryable = params.retryable ?? false;
    if (isDevelopmentMode() && params.cause !== undefined) {
      this.safeCause = sanitizeCause(params.cause);
    }
  }
}

export function getApiSupportCode(error: unknown): string | null {
  if (!(error instanceof ApiError) || !shouldShowSupportCode(error) || !error.requestId) return null;
  return error.requestId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 12).toUpperCase() || null;
}

export function formatApiSupportCode(error: unknown): string | null {
  const code = getApiSupportCode(error);
  return code ? `Código de atendimento: ${code}` : null;
}

export function buildApiErrorDisplayMessage(error: unknown, fallback = "Erro inesperado. Tente novamente."): string {
  const message = error instanceof Error && error.message ? error.message : fallback;
  const supportCode = formatApiSupportCode(error);
  return supportCode ? `${message} ${supportCode}` : message;
}

export async function apiRequest<T = unknown>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const method = options.method ?? "GET";
  const headers = new Headers(options.headers ?? {});
  const fetcher = options.fetchImpl ?? fetch;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const abortFromCaller = () => controller.abort(options.signal?.reason ?? new DOMException("Request aborted", "AbortError"));
  if (options.signal?.aborted) abortFromCaller();
  else options.signal?.addEventListener("abort", abortFromCaller, { once: true });

  if (timeoutMs > 0) {
    timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort(new DOMException("Request timed out", "TimeoutError"));
    }, timeoutMs);
  }

  try {
    if (options.auth) {
      const token = await resolveAuthToken(options.getAuthToken);
      if (!token) {
        throw new ApiError({ status: 401, code: "UNAUTHENTICATED", message: "Sua sessão expirou. Entre novamente.", retryable: false });
      }
      headers.set("Authorization", `Bearer ${token}`);
    }

    const body = prepareRequestBody(options.body, headers);
    const response = await fetcher(getApiUrl(path), { method, headers, body, signal: controller.signal });
    return await parseApiResponse<T>(response, options.responseType ?? "json");
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (timedOut) {
      throw new ApiError({ code: "TIMEOUT", message: "A requisição demorou para responder. Tente novamente.", retryable: true, cause: error });
    }
    if (isAbortError(error)) {
      throw new ApiError({ code: "REQUEST_ABORTED", message: "Requisição cancelada.", retryable: false, cause: error });
    }
    throw new ApiError({ code: "NETWORK_ERROR", message: resolveNetworkErrorMessage(), retryable: true, cause: error });
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
    options.signal?.removeEventListener("abort", abortFromCaller);
  }
}

async function resolveAuthToken(getAuthToken?: ApiRequestOptions["getAuthToken"]): Promise<string | null | undefined> {
  if (getAuthToken) return await getAuthToken();
  // RELEASE-AUTOMATION-01 — waits for Firebase Auth's INITIAL onAuthStateChanged emission instead of
  // reading `auth.currentUser` synchronously. On a fresh full-page load, the persisted session is still
  // being restored asynchronously when this can run, so a synchronous read sees `null` even for a
  // genuinely logged-in user — every apiRequest(path, { auth: true }) call site inherited this race by
  // construction (e.g. sorteios-admin.tsx on first load), throwing "Sua sessão expirou" for no reason.
  const { waitForAuthReady } = await import("./firebase");
  const user = await waitForAuthReady();
  return await user?.getIdToken();
}

function prepareRequestBody(body: unknown, headers: Headers): BodyInit | undefined {
  if (body === undefined || body === null) return undefined;
  if (isNativeBody(body)) return body;
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  return JSON.stringify(body);
}

function isNativeBody(body: unknown): body is BodyInit {
  if (typeof body === "string") return true;
  if (typeof FormData !== "undefined" && body instanceof FormData) return true;
  if (typeof URLSearchParams !== "undefined" && body instanceof URLSearchParams) return true;
  if (typeof Blob !== "undefined" && body instanceof Blob) return true;
  if (typeof ArrayBuffer !== "undefined" && body instanceof ArrayBuffer) return true;
  if (ArrayBuffer.isView(body)) return true;
  if (typeof ReadableStream !== "undefined" && body instanceof ReadableStream) return true;
  return false;
}

async function parseApiResponse<T>(response: Response, responseType: ApiResponseType): Promise<T> {
  if (responseType === "response") return response as T;

  const requestIdFromHeader = response.headers.get("X-Request-Id") ?? undefined;
  const hasBody = response.status !== 204 && response.status !== 205 && response.headers.get("Content-Length") !== "0";

  if (response.ok) {
    if (!hasBody) return undefined as T;
    if (responseType === "blob") return await response.blob() as T;
    if (responseType === "arrayBuffer") return await response.arrayBuffer() as T;
    if (responseType === "text") return await response.text() as T;
    if (isJsonResponse(response)) return await response.json() as T;
    return await response.text() as T;
  }

  const parsed = hasBody ? await readErrorBody(response) : { kind: "empty" as const };
  throw buildApiErrorFromResponse(response, parsed, requestIdFromHeader);
}

type ParsedErrorBody =
  | { kind: "json"; value: unknown }
  | { kind: "text"; value: string }
  | { kind: "html"; value: string }
  | { kind: "empty" };

async function readErrorBody(response: Response): Promise<ParsedErrorBody> {
  const contentType = response.headers.get("Content-Type") ?? "";
  const text = await response.text();
  if (!text.trim()) return { kind: "empty" };
  if (contentType.includes("application/json")) {
    try { return { kind: "json", value: JSON.parse(text) }; }
    catch { return { kind: "text", value: "Resposta inválida do servidor." }; }
  }
  if (contentType.includes("text/html") || /^\s*</.test(text)) return { kind: "html", value: text };
  return { kind: "text", value: text };
}

function buildApiErrorFromResponse(response: Response, parsed: ParsedErrorBody, requestIdFromHeader?: string): ApiError {
  const json = parsed.kind === "json" && isRecord(parsed.value) ? parsed.value : undefined;
  const nestedError = isRecord(json?.error) ? json.error : undefined;
  const code = extractErrorCode(json, nestedError, response.status);
  const requestId = extractRequestId(json, nestedError) ?? requestIdFromHeader;
  const backendMessage = extractSafeMessage(json, nestedError, parsed);
  const message = backendMessage ?? mapStatusToMessage(response.status);
  return new ApiError({
    status: response.status,
    code,
    message,
    requestId,
    retryable: isRetryableStatus(response.status),
  });
}

function extractErrorCode(json: Record<string, unknown> | undefined, nestedError: Record<string, unknown> | undefined, status: number): string {
  const raw = nestedError?.code ?? json?.code ?? json?.error;
  if (typeof raw === "string" && raw.length > 0 && raw.length <= 80) return raw;
  return mapStatusToCode(status);
}

function extractRequestId(json: Record<string, unknown> | undefined, nestedError: Record<string, unknown> | undefined): string | undefined {
  const raw = nestedError?.requestId ?? json?.requestId;
  return typeof raw === "string" && raw.length <= 100 ? raw : undefined;
}

function extractSafeMessage(json: Record<string, unknown> | undefined, nestedError: Record<string, unknown> | undefined, parsed: ParsedErrorBody): string | undefined {
  const raw = nestedError?.message ?? json?.message ?? (parsed.kind === "text" ? parsed.value : undefined);
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 240) return undefined;
  if (/<\/?[a-z][\s\S]*>/i.test(trimmed)) return undefined;
  if (/stack|trace|authorization|bearer\s+|firebase|mercadopago|access[_ -]?token/i.test(trimmed)) return undefined;
  return trimmed;
}

function mapStatusToCode(status: number): string {
  if (status === 400 || status === 422) return "VALIDATION_ERROR";
  if (status === 401) return "UNAUTHENTICATED";
  if (status === 403) return "FORBIDDEN";
  if (status === 404) return "NOT_FOUND";
  if (status === 409) return "CONFLICT";
  if (status === 429) return "RATE_LIMITED";
  if (status >= 500 && status <= 599) return "INTERNAL_SERVER_ERROR";
  return "UNEXPECTED_RESPONSE";
}

function mapStatusToMessage(status: number): string {
  if (status === 400 || status === 422) return "Solicitação inválida.";
  if (status === 401) return "Sua sessão expirou. Entre novamente.";
  if (status === 403) return "Operação não permitida.";
  if (status === 404) return "Recurso não encontrado.";
  if (status === 409) return "Não foi possível concluir por conflito de estado.";
  if (status === 429) return "Muitas tentativas. Aguarde um momento e tente novamente.";
  if (status >= 500 && status <= 599) return "Falha temporária do serviço. Tente novamente.";
  return "Resposta inesperada do servidor.";
}

function shouldShowSupportCode(error: ApiError): boolean {
  if (!error.requestId) return false;
  if (typeof error.status === "number" && error.status >= 500) return true;
  return ["TIMEOUT", "NETWORK_ERROR", "UNEXPECTED_RESPONSE", "EXTERNAL_SERVICE_ERROR", "INTERNAL_SERVER_ERROR"].includes(error.code);
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || (status >= 500 && status <= 599);
}

function isJsonResponse(response: Response): boolean {
  return (response.headers.get("Content-Type") ?? "").includes("application/json");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function resolveNetworkErrorMessage(): string {
  if (typeof navigator !== "undefined" && navigator && navigator.onLine === false) {
    return "Sem conexão com a internet. Verifique sua rede.";
  }
  return "Não foi possível conectar ao servidor. Tente novamente.";
}

function isDevelopmentMode(): boolean {
  return Boolean(import.meta.env?.DEV);
}

function sanitizeCause(cause: unknown): string {
  if (cause instanceof Error) return `${cause.name}: ${cause.message}`.slice(0, 240);
  return String(cause).slice(0, 240);
}
