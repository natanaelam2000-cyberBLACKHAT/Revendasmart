export type SafeLogLevel = "debug" | "info" | "warn" | "error" | "fatal";
export type SafeLogContext = Record<string, unknown>;

const IS_PRODUCTION = import.meta.env.PROD;
const MAX_STRING_LENGTH = 600;
const MAX_DEPTH = 4;
const MAX_ARRAY_ITEMS = 12;

const SENSITIVE_KEY_PATTERN = /token|secret|password|senha|authorization|cookie|private[_-]?key|credential|rawbody|raw_body|payload|client_secret|access[_-]?token|refresh[_-]?token|card|cvv|cpf|rg/i;
const IDENTIFIER_KEYS = new Set([
  "uid",
  "userid",
  "firebaseuid",
  "targetuserid",
  "sourceuid",
  "referreruid",
  "referreduid",
  "referraluid",
  "newuserid",
  "chargeid",
  "connectionid",
  "paymentid",
  "subscriptionid",
  "merchantid",
  "installmentid",
  "saleid",
  "productid",
  "clientid",
]);

const normalizeKey = (key: string) => key.replace(/[^a-z0-9]/gi, "").toLowerCase();

export const maskId = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  if (raw.length <= 6) return "***";
  return `${raw.slice(0, 3)}…${raw.slice(-3)}`;
};

export const maskEmail = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim();
  const [name, domain] = raw.split("@");
  if (!name || !domain) return maskId(raw);
  return `${name.slice(0, 2)}***@${domain}`;
};

export const maskPhone = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  const digits = String(value).replace(/\D/g, "");
  if (digits.length < 4) return "***";
  return `(**) *****-${digits.slice(-4)}`;
};

const sanitizeString = (value: string): string => {
  let sanitized = value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(/(TEST-|APP_USR-|APP-)[A-Za-z0-9._~+/=-]{12,}/g, "[REDACTED]")
    .replace(/-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----/g, "[REDACTED]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, (email) => maskEmail(email) || "[REDACTED]")
    .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, "***.***.***-**");

  if (sanitized.length > MAX_STRING_LENGTH) {
    sanitized = `${sanitized.slice(0, MAX_STRING_LENGTH)}…[truncated]`;
  }
  return sanitized;
};

const sanitizeError = (error: Error): SafeLogContext => ({
  name: error.name,
  message: sanitizeString(error.message),
  ...(IS_PRODUCTION ? {} : { stack: sanitizeString(error.stack || "") }),
});

export const sanitizeLogPayload = (value: unknown, depth = 0, keyHint = ""): unknown => {
  if (SENSITIVE_KEY_PATTERN.test(keyHint)) return "[REDACTED]";

  const normalizedKey = normalizeKey(keyHint);
  if (IDENTIFIER_KEYS.has(normalizedKey)) return maskId(value);
  if (normalizedKey.includes("email")) return maskEmail(value);
  if (normalizedKey.includes("phone") || normalizedKey.includes("telefone") || normalizedKey.includes("whatsapp")) return maskPhone(value);

  if (value === null || value === undefined) return value;
  if (typeof value === "string") return sanitizeString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) return sanitizeError(value);
  if (depth >= MAX_DEPTH) return "[max-depth]";

  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY_ITEMS).map(item => sanitizeLogPayload(item, depth + 1, keyHint));
  }

  if (typeof value === "object") {
    const output: SafeLogContext = {};
    for (const [key, item] of Object.entries(value as SafeLogContext)) {
      output[key] = sanitizeLogPayload(item, depth + 1, key);
    }
    return output;
  }

  return "[unserializable]";
};

export const sanitizeLogMessage = (message: unknown, fallback = "Operação registrada."): string => {
  const sanitized = sanitizeLogPayload(message);
  return typeof sanitized === "string" && sanitized.trim() ? sanitized : fallback;
};

const writeLog = (level: SafeLogLevel, event: string, context: SafeLogContext = {}) => {
  if (IS_PRODUCTION && (level === "debug" || level === "info")) return;

  const record = sanitizeLogPayload({
    timestamp: new Date().toISOString(),
    level,
    event,
    ...context,
  }) as SafeLogContext;

  if (level === "debug") console.debug(record);
  else if (level === "info") console.info(record);
  else if (level === "warn") console.warn(record);
  else console.error(record);
};

export const safeLogger = {
  debug: (event: string, context?: SafeLogContext) => writeLog("debug", event, context),
  info: (event: string, context?: SafeLogContext) => writeLog("info", event, context),
  warn: (event: string, context?: SafeLogContext) => writeLog("warn", event, context),
  error: (event: string, error?: unknown, context: SafeLogContext = {}) => writeLog("error", event, { ...context, error }),
  fatal: (event: string, error?: unknown, context: SafeLogContext = {}) => writeLog("fatal", event, { ...context, error }),
};
