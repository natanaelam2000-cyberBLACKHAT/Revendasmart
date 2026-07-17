import crypto from "crypto";
import type { IncomingMessage, ServerResponse } from "http";

process.env.REVENDA_SMART_SERVERLESS = "1";

type ServerModule = typeof import("../server/index");

type LoadedServer = {
  app: ServerModule["app"];
  initError?: unknown;
};

const serverModule = import("../server/index");
const loadedServer = serverModule.then(async (mod): Promise<LoadedServer> => {
  try {
    await mod.serverReady;
    return { app: mod.app };
  } catch (error) {
    return { app: mod.app, initError: error };
  }
});

function getRequestPath(req: IncomingMessage): string {
  try {
    return new URL(req.url ?? "/", "https://revendasmart.vercel.app").pathname;
  } catch {
    return "/api";
  }
}

function shouldUsePartiallyInitializedExpress(req: IncomingMessage): boolean {
  const pathname = getRequestPath(req);
  return req.method === "OPTIONS" || pathname === "/api/health" || pathname === "/api/readiness";
}

function sendInitializationError(req: IncomingMessage, res: ServerResponse) {
  const requestId = String(req.headers["x-request-id"] || crypto.randomUUID());
  res.statusCode = 503;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("X-Request-Id", requestId);
  res.end(JSON.stringify({
    ok: false,
    status: "unavailable",
    code: "SERVICE_UNAVAILABLE",
    message: "Serviço temporariamente indisponível.",
    requestId,
  }));
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const { app, initError } = await loadedServer;

  if (initError && !shouldUsePartiallyInitializedExpress(req)) {
    return sendInitializationError(req, res);
  }

  return app(req, res);
}
