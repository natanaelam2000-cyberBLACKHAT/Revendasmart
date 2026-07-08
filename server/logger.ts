import { createHash, randomUUID } from "crypto";
import type { NextFunction, Request, Response } from "express";

declare module "express-serve-static-core" {
  interface Request {
    requestId?: string;
  }
}

export type LogContext = Record<string, unknown>;

type LogLevel = "info" | "warn" | "error";

const IS_PRODUCTION = process.env.NODE_ENV === "production";
const MAX_STRING_LENGTH = 600;
const MAX_DEPTH = 5;
const MAX_ARRAY_ITEMS = 20;

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
  "nonce",
  "statenonce",
  "oauthnonce",
  "chargeid",
  "connectionid",
  "paymentid",
  "mppaymentid",
  "mercadopagopaymentid",
  "subscriptionid",
  "merchantid",
  "installmentid",
  "clientid",
  "saleid",
  "productid",
]);

function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 8);
}

function normalizeKey(key: string): string {
  return key.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

export function maskId(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const hash = shortHash(raw);
  if (raw.length <= 8) return `***#${hash}`;
  return `${raw.slice(0, 3)}…${raw.slice(-3)}#${hash}`;
}

export function maskEmail(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim();
  const [name, domain] = raw.split("@");
  if (!name || !domain) return maskId(raw);
  return `${name.slice(0, 1)}***@${domain}`;
}

export function maskPhone(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const digits = String(value).replace(/\D/g, "");
  if (digits.length < 4) return "***";
  return `(**) *****-${digits.slice(-4)}`;
}

function sanitizeString(value: string): string {
  let sanitized = value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/(TEST-|APP_USR-|APP-)[A-Za-z0-9._~+/=-]{16,}/g, "[redacted-token]")
    .replace(/-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----/g, "[redacted-private-key]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, (email) => maskEmail(email) || "[redacted-email]")
    .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, "***.***.***-**")
    .replace(/(?:\+55\s*)?\(?\d{2}\)?[\s-]9?\d{4}[-\s]\d{4}/g, (phone) => maskPhone(phone) || "[redacted-phone]");

  if (sanitized.length > MAX_STRING_LENGTH) {
    sanitized = `${sanitized.slice(0, MAX_STRING_LENGTH)}…[truncated]`;
  }
  return sanitized;
}

function sanitizeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: sanitizeString(error.message),
      ...(IS_PRODUCTION ? {} : { stack: sanitizeString(error.stack ?? "") }),
    };
  }
  return { message: sanitizeForLog(error) };
}

export function sanitizeForLog(value: unknown, depth = 0, keyHint = ""): unknown {
  if (SENSITIVE_KEY_PATTERN.test(keyHint)) return "[redacted]";

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
    return value.slice(0, MAX_ARRAY_ITEMS).map((item) => sanitizeForLog(item, depth + 1, keyHint));
  }

  if (typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      output[key] = sanitizeForLog(item, depth + 1, key);
    }
    return output;
  }

  return "[unserializable]";
}

function writeLog(level: LogLevel, event: string, context: LogContext = {}): void {
  const record = sanitizeForLog({
    timestamp: new Date().toISOString(),
    level,
    event,
    ...context,
  }) as Record<string, unknown>;

  const message = JSON.stringify(record);
  if (level === "error") console.error(message);
  else if (level === "warn") console.warn(message);
  else console.info(message);
}

export function logInfo(event: string, context: LogContext = {}): void {
  writeLog("info", event, context);
}

export function logWarn(event: string, context: LogContext = {}): void {
  writeLog("warn", event, context);
}

export function logError(event: string, error?: unknown, context: LogContext = {}): void {
  writeLog("error", event, {
    ...context,
    ...(error === undefined ? {} : { error: sanitizeError(error) }),
  });
}

function createRequestId(): string {
  return randomUUID().replace(/-/g, "").slice(0, 16);
}

function normalizeRequestId(value: unknown): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!/^[a-zA-Z0-9._:-]{6,80}$/.test(trimmed)) return null;
  return trimmed;
}

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const requestId = normalizeRequestId(req.headers["x-request-id"]) ?? createRequestId();
  req.requestId = requestId;
  res.setHeader("X-Request-Id", requestId);
  next();
}
