import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";

// Global error handlers for uncaught exceptions
process.on("uncaughtException", (err) => {
  console.error("[UNCAUGHT EXCEPTION] Stack:", err.stack);
  console.error("[UNCAUGHT EXCEPTION] Message:", err.message);
  console.error("[UNCAUGHT EXCEPTION] Name:", err.name);
  // Don't exit immediately — log and continue
  // process.exit(1);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("[UNHANDLED REJECTION] Promise:", promise);
  console.error("[UNHANDLED REJECTION] Reason:", reason);
  console.error("[UNHANDLED REJECTION] Reason Stack:", reason instanceof Error ? reason.stack : String(reason));
  // Don't exit immediately — log and continue
  // process.exit(1);
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

// CORS Configuration
app.use((req, res, next) => {
  const origin = req.headers.origin;

  const allowedOrigins = [
    "https://revendasmart.vercel.app",
    "https://revendasmart-7210hr3iv-natanaelam2000-9106s-projects.vercel.app",
    "http://localhost:3000",
    "http://localhost:5000",
  ];

  if (
    origin &&
    (
      allowedOrigins.includes(origin) ||
      origin.includes("vercel.app")
    )
  ) {
    res.header("Access-Control-Allow-Origin", origin);
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
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      log(logLine);
    }
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

    app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
      const status = err.status || err.statusCode || 500;
      const message = err.message || "Internal Server Error";

      console.error("[ERROR]", err);

      if (res.headersSent) {
        return next(err);
      }

      return res.status(status).json({ message });
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
