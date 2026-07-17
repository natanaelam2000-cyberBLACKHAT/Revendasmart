import { config as loadDotenv } from "dotenv";
import * as Sentry from "@sentry/node";
import express, { type Request, Response, NextFunction } from "express";
import { createServer } from "http";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { getFirebaseAdmin } from "./firebase-admin-init";
import { buildHealthPayload, buildReadinessPayload, buildSafeErrorBody, classifySafeError, logError, logInfo, logWarn, requestIdMiddleware, sanitizeForLog, type ReadinessCheckStatus, type SafeHttpErrorCode } from "./logger";

if (process.env.NODE_ENV !== "production") {
  loadDotenv();
}

const IS_PRODUCTION = process.env.NODE_ENV === "production";
const REQUEST_BODY_LIMIT = "100kb";
const URL_ENCODED_PARAMETER_LIMIT = 100;
const SENTRY_DSN = process.env.SENTRY_DSN?.trim();



function normalizeObservedPath(pathname: string): string {
  return pathname
    .split("/")
    .map((segment) => {
      if (!segment) return segment;
      if (/^\d+$/.test(segment)) return ":number";
      if (/^[0-9a-f]{24,}$/i.test(segment)) return ":id";
      if (/^[a-zA-Z0-9_-]{28,}$/.test(segment)) return ":id";
      if (/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(segment)) return ":id";
      return segment;
    })
    .join("/");
}

function getObservedRoute(req: Request): string {
  const routePath = (req as any).route?.path;
  if (typeof routePath === "string") {
    return `${req.baseUrl ?? ""}${routePath}` || req.path;
  }
  return normalizeObservedPath(req.path);
}

function getSafeHttpErrorCode(status: number): SafeHttpErrorCode | undefined {
  if (status < 400) return undefined;
  return classifySafeError(status, undefined).code;
}

async function withTimeout<T>(operation: () => Promise<T> | T, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(Object.assign(new Error("Readiness check timed out"), { safeCode: "EXTERNAL_SERVICE_ERROR" })), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: process.env.NODE_ENV || "development",
    tracesSampleRate: 0.1,
    sendDefaultPii: false,
    beforeSend(event) {
      return sanitizeForLog(event) as typeof event;
    },
  });
} else if (!IS_PRODUCTION) {
  logWarn("sentry.disabled", { reason: "missing_dsn" });
}

// Global error handlers for uncaught exceptions
process.on("uncaughtException", (err) => {
  Sentry.captureException(err);
  logError("process.uncaught_exception", err, { fatal: true });
});

process.on("unhandledRejection", (reason) => {
  Sentry.captureException(reason);
  logError("process.unhandled_rejection", reason, { fatal: true });
});

// Optional: Event loop and memory monitoring can be enabled on demand
// Removed for now to avoid startup issues — can be re-added if needed

const app = express();
app.disable("x-powered-by");
const httpServer = createServer(app);

app.use(requestIdMiddleware);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use((req, res, next) => {
  res.header("X-Content-Type-Options", "nosniff");
  res.header("X-Frame-Options", "DENY");
  res.header("Referrer-Policy", "strict-origin-when-cross-origin");
  res.header(
    "Permissions-Policy",
    [
      "camera=(self)",
      "microphone=()",
      "geolocation=()",
      "payment=(self)",
      "usb=()",
      "bluetooth=()",
      "accelerometer=()",
      "gyroscope=()",
      "magnetometer=()",
    ].join(", ")
  );

  if (req.path === "/health" || req.path.startsWith("/api/")) {
    res.header(
      "Content-Security-Policy",
      "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
    );
  }

  next();
});

app.use(
  express.json({
    limit: REQUEST_BODY_LIMIT,
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(
  express.urlencoded({
    extended: false,
    limit: REQUEST_BODY_LIMIT,
    parameterLimit: URL_ENCODED_PARAMETER_LIMIT,
  }),
);

function normalizeCorsOrigin(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;

  try {
    return new URL(trimmed).origin;
  } catch {
    return null;
  }
}

function parseCorsOrigins(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map(normalizeCorsOrigin)
    .filter((origin): origin is string => Boolean(origin));
}

const allowedCorsOrigins = new Set([
  "https://revendasmart.vercel.app",
  "https://localhost", // Android Capacitor WebView origin
  "http://localhost:3000",
  "http://localhost:5000",
  ...parseCorsOrigins(process.env.FRONTEND_URL),
  ...parseCorsOrigins(process.env.CORS_ALLOWED_ORIGINS),
  ...parseCorsOrigins(process.env.VERCEL_PREVIEW_ORIGINS),
]);

// CORS Configuration
app.use((req, res, next) => {
  const origin = req.headers.origin;

  if (origin && allowedCorsOrigins.has(origin)) {
    res.header("Access-Control-Allow-Origin", origin);
    res.header("Vary", "Origin");
  }

  res.header(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept, Authorization, X-Request-Id"
  );

  res.header(
    "Access-Control-Allow-Methods",
    "GET, POST, PUT, DELETE, OPTIONS"
  );

  res.header(
    "Access-Control-Allow-Credentials",
    "true"
  );

  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }

  next();
});

export function log(message: string, source = "express") {
  logInfo("legacy.log", { source, message });
}

app.use((req, res, next) => {
  const start = Date.now();
  const requestPath = req.path;

  res.on("finish", () => {
    if (!requestPath.startsWith("/api")) return;
    const duration = Date.now() - start;
    const contentLength = res.getHeader("content-length");
    const responseBytes = typeof contentLength === "string" || typeof contentLength === "number"
      ? String(contentLength)
      : "unknown";
    const safeErrorCode = typeof res.locals.safeErrorCode === "string"
      ? res.locals.safeErrorCode
      : getSafeHttpErrorCode(res.statusCode);
    logInfo("http.request", {
      requestId: req.requestId,
      method: req.method,
      route: getObservedRoute(req),
      status: res.statusCode,
      durationMs: duration,
      eventType: "http_request",
      result: res.statusCode >= 400 ? "error" : "success",
      ...(safeErrorCode ? { errorCode: safeErrorCode } : {}),
      responseBytes,
    });
  });

  next();
});

// Healthcheck endpoint: process liveness only.
app.get(["/health", "/api/health"], (req, res) => {
  const baseHealth = buildHealthPayload(req.requestId);

  if (req.path === "/api/health" || IS_PRODUCTION) {
    return res.status(200).json(baseHealth);
  }

  return res.status(200).json({
    ...baseHealth,
    uptime: process.uptime(),
    memory: {
      heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      heapTotal: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
    },
  });
});

// Readiness endpoint: lightweight dependency checks, no writes and no external payment calls.
app.get("/api/readiness", async (req, res) => {
  const checks: Record<string, ReadinessCheckStatus> = { firebaseAdmin: "failed" };

  try {
    await withTimeout(() => {
      getFirebaseAdmin();
      checks.firebaseAdmin = "ok";
    }, 500);
  } catch (error) {
    logWarn("http.readiness_check_failed", {
      requestId: req.requestId,
      dependency: "firebaseAdmin",
      errorCode: "READINESS_CHECK_FAILED",
    });
  }

  const readiness = buildReadinessPayload(req.requestId, checks);
  if (readiness.statusCode === 503) res.locals.safeErrorCode = "EXTERNAL_SERVICE_ERROR";

  return res.status(readiness.statusCode).json(readiness.body);
});

(async () => {
  try {
    logInfo("server.starting", {
      nodeEnv: process.env.NODE_ENV ?? "development",
      portConfigured: Boolean(process.env.PORT),
      sentryEnabled: Boolean(SENTRY_DSN),
    });

    await registerRoutes(httpServer, app);
    logInfo("server.routes_registered");

    app.use((err: any, req: Request, res: Response, next: NextFunction) => {
      Sentry.withScope((scope) => {
        scope.setTag("requestId", req.requestId ?? "unknown");
        scope.setContext("request", {
          method: req.method,
          path: req.path,
        });
        Sentry.captureException(err);
      });

      const rawStatus = Number(err?.status ?? err?.statusCode ?? 500);
      const status = Number.isInteger(rawStatus) && rawStatus >= 400 && rawStatus < 600
        ? rawStatus
        : 500;
      const technicalMessage = err instanceof Error
        ? err.message
        : "Internal Server Error";
      const safeError = classifySafeError(status, err);
      res.locals.safeErrorCode = safeError.code;

      logError("http.unhandled_error", err, {
        requestId: req.requestId,
        method: req.method,
        route: getObservedRoute(req),
        status,
        errorCode: safeError.code,
        message: technicalMessage,
      });

      if (res.headersSent) {
        return next(err);
      }

      return res.status(status).json(buildSafeErrorBody(status, err, req.requestId));
    });

    if (process.env.NODE_ENV === "production") {
      serveStatic(app);
      logInfo("server.static_configured");
    } else {
      const { setupVite } = await import("./vite");
      await setupVite(httpServer, app);
      logInfo("server.vite_configured");
    }

    // 🔥 ESSENCIAL PARA CLOUD RUN
    const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 8080;

    httpServer.listen(PORT, "0.0.0.0", () => {
      logInfo("server.listening", { port: PORT });
    });

  } catch (err) {
    logError("server.startup_failed", err, { fatal: true });
    process.exit(1);
  }
})();
