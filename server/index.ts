import { config as loadDotenv } from "dotenv";
import * as Sentry from "@sentry/node";
import express, { type Request, Response, NextFunction } from "express";
import { createServer } from "http";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { logError, logInfo, logWarn, requestIdMiddleware, sanitizeForLog } from "./logger";

if (process.env.NODE_ENV !== "production") {
  loadDotenv();
}

const IS_PRODUCTION = process.env.NODE_ENV === "production";
const SENTRY_DSN = process.env.SENTRY_DSN?.trim();

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
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

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
    logInfo("http.request", {
      requestId: req.requestId,
      method: req.method,
      route: requestPath,
      status: res.statusCode,
      durationMs: duration,
      responseBytes,
    });
  });

  next();
});

// Healthcheck endpoint
app.get("/health", (req, res) => {
  const baseHealth = {
    status: "ok",
    timestamp: new Date().toISOString(),
    requestId: req.requestId,
  };

  if (IS_PRODUCTION) {
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
      const publicMessage = process.env.NODE_ENV === "production"
        ? "Ocorreu um erro temporário."
        : technicalMessage;

      logError("http.unhandled_error", err, {
        requestId: req.requestId,
        method: req.method,
        route: req.path,
        status,
        message: technicalMessage,
      });

      if (res.headersSent) {
        return next(err);
      }

      return res.status(status).json({ message: publicMessage });
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
