import { config as loadDotenv } from "dotenv";
import * as Sentry from "@sentry/node";

if (process.env.NODE_ENV !== "production") {
  loadDotenv();
}

Sentry.init({
  dsn: "https://32752c8db032da58f02a989ae3e95805@o4511473504354304.ingest.us.sentry.io/4511474807144448",
  environment: process.env.NODE_ENV || "development",
  tracesSampleRate: 0.1,
  sendDefaultPii: false,
});
import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http"

// Global error handlers for uncaught exceptions
process.on("uncaughtException", (err) => {
  Sentry.captureException(err);

  console.error("[UNCAUGHT EXCEPTION] Stack:", err.stack);
  console.error("[UNCAUGHT EXCEPTION] Message:", err.message);
});

process.on("unhandledRejection", (reason) => {
  Sentry.captureException(reason);

  console.error("[UNHANDLED REJECTION]", reason);
});

// Optional: Event loop and memory monitoring can be enabled on demand
// Removed for now to avoid startup issues — can be re-added if needed

const app = express();
const httpServer = createServer(app);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

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
    "Origin, X-Requested-With, Content-Type, Accept, Authorization"
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
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
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
    log(`${req.method} ${requestPath} ${res.statusCode} in ${duration}ms bytes=${responseBytes}`);
  });

  next();
});

// Healthcheck endpoint
app.get("/health", (_req, res) => {
  res.status(200).json({
    status: "ok",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: {
      heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      heapTotal: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
    },
  });
});

(async () => {
  try {
    console.log("[STARTUP] Server initialization starting...");
    console.log("[STARTUP] NODE_ENV:", process.env.NODE_ENV);
    console.log("[STARTUP] PORT:", process.env.PORT);

    await registerRoutes(httpServer, app);
    console.log("[STARTUP] Routes registered successfully");

    app.use((err: any, req: Request, res: Response, next: NextFunction) => {
      Sentry.captureException(err);

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

      console.error("[ERROR]", {
        method: req.method,
        path: req.path,
        status,
        message: technicalMessage,
        stack: err instanceof Error ? err.stack : undefined,
      });

      if (res.headersSent) {
        return next(err);
      }

      return res.status(status).json({ message: publicMessage });
    });

    if (process.env.NODE_ENV === "production") {
      serveStatic(app);
      console.log("[STARTUP] Static files configured");
    } else {
      const { setupVite } = await import("./vite");
      await setupVite(httpServer, app);
      console.log("[STARTUP] Vite dev server configured");
    }

    // 🔥 ESSENCIAL PARA CLOUD RUN
    const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 8080;

    httpServer.listen(PORT, "0.0.0.0", () => {
      console.log(`🚀 Server rodando na porta ${PORT}`);
    });

  } catch (err) {
    console.error("[FATAL] Falha ao iniciar servidor:", err);
    process.exit(1);
  }
})();
