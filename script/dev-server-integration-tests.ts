import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import express, { type NextFunction, type Request, type Response } from "express";
import WebSocket from "ws";
import { setupVite } from "../server/vite";

async function closeHttpServer(server: Server) {
  if (!server.listening) return;

  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

async function expectHmrConnection(url: string) {
  await new Promise<void>((resolve, reject) => {
    const socket = new WebSocket(url, "vite-hmr");
    const timeout = setTimeout(() => {
      socket.terminate();
      reject(new Error("Timed out while opening the Vite HMR websocket"));
    }, 5_000);

    socket.once("open", () => {
      clearTimeout(timeout);
      socket.once("close", () => resolve());
      socket.close();
    });
    socket.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

async function main() {
  process.env.NODE_ENV = "development";

  const app = express();
  app.get("/api/dev-server-probe", (_req, res) => res.json({ ok: true }));

  const httpServer = createServer(app);
  const vite = await setupVite(httpServer, app);

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    void _next;
    const message = error instanceof Error ? error.message : "Unknown Vite error";
    res.status(500).json({ code: "DEV_VITE_ERROR", message });
  });

  let port: number | undefined;

  try {
    await new Promise<void>((resolve, reject) => {
      httpServer.once("error", reject);
      httpServer.listen(0, "127.0.0.1", resolve);
    });

    port = (httpServer.address() as AddressInfo).port;
    const baseUrl = `http://127.0.0.1:${port}`;

    assert.equal(path.normalize(vite.config.root), path.resolve("client"));
    assert.equal(vite.config.mode, "development");
    assert(vite.config.plugins.some((plugin) => plugin.name === "vite:react-babel"));
    assert(vite.config.plugins.some((plugin) => plugin.name.startsWith("@tailwindcss/vite")));

    const aliases = vite.config.resolve.alias.map((entry) => String(entry.find));
    assert(aliases.includes("@"));
    assert(aliases.includes("@shared"));
    assert(aliases.includes("@assets"));

    const homeResponse = await fetch(`${baseUrl}/`);
    const homeHtml = await homeResponse.text();
    assert.equal(homeResponse.status, 200);
    assert.match(homeResponse.headers.get("content-type") ?? "", /^text\/html/);
    assert.match(homeHtml, /src="\/src\/main\.tsx\?v=/);

    const deepRouteResponse = await fetch(`${baseUrl}/settings/profile`);
    assert.equal(deepRouteResponse.status, 200);
    assert.match(await deepRouteResponse.text(), /<div id="root"><\/div>/);

    const apiResponse = await fetch(`${baseUrl}/api/dev-server-probe`);
    assert.equal(apiResponse.status, 200);
    assert.deepEqual(await apiResponse.json(), { ok: true });

    const sourceResponse = await fetch(`${baseUrl}/src/main.tsx`);
    assert.equal(sourceResponse.status, 200);
    assert.match(await sourceResponse.text(), /\/src\/components\/RemoteConfigProvider/);

    const assetResponse = await fetch(`${baseUrl}/logo-revenda-smart-symbol-official.png`);
    assert.equal(assetResponse.status, 200);
    assert.equal(assetResponse.headers.get("content-type"), "image/png");
    await assetResponse.arrayBuffer();

    await expectHmrConnection(
      `ws://127.0.0.1:${port}/vite-hmr?token=${vite.config.webSocketToken}`,
    );

    const originalTransformIndexHtml = vite.transformIndexHtml;
    vite.transformIndexHtml = async () => {
      throw new Error("recoverable-vite-transform");
    };

    const recoverableErrorResponse = await fetch(`${baseUrl}/recoverable-error`);
    vite.transformIndexHtml = originalTransformIndexHtml;
    assert.equal(recoverableErrorResponse.status, 500);
    assert.deepEqual(await recoverableErrorResponse.json(), {
      code: "DEV_VITE_ERROR",
      message: "recoverable-vite-transform",
    });

    const apiAfterErrorResponse = await fetch(`${baseUrl}/api/dev-server-probe`);
    assert.equal(apiAfterErrorResponse.status, 200);
    assert.deepEqual(await apiAfterErrorResponse.json(), { ok: true });
  } finally {
    await vite.close();
    await closeHttpServer(httpServer);
  }

  assert(port !== undefined);
  const reboundServer = createServer();
  try {
    await new Promise<void>((resolve, reject) => {
      reboundServer.once("error", reject);
      reboundServer.listen(port, "127.0.0.1", resolve);
    });
  } finally {
    await closeHttpServer(reboundServer);
  }

  console.log("PASS dev server integration: API, SPA, root, plugins, aliases, assets, HMR, recoverable errors, shutdown");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});
