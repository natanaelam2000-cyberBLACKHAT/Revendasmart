#!/usr/bin/env node
import { spawn } from "node:child_process";
import { error as logError } from "node:console";
import { existsSync } from "node:fs";
import { get } from "node:http";
import { createServer as createTcpServer } from "node:net";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const PORT = Number(process.env.PRODUCTION_ROUTING_PORT || 4177);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const PROJECT_ID = "demo-revendasmart";
const READY_TIMEOUT_MS = 30_000;

const localBin = (relativePath) => fileURLToPath(new URL(`../../node_modules/${relativePath}`, import.meta.url));

function fail(message) {
  logError(`Production routing E2E blocked: ${message}`);
  process.exitCode = 1;
}

function startProcess(label, command, args, env) {
  const state = { label, exited: false, exitCode: null, child: null };
  const child = spawn(command, args, { stdio: ["ignore", "inherit", "inherit"], shell: false, env });
  child.on("close", (code) => {
    state.exited = true;
    state.exitCode = code;
  });
  state.child = child;
  return state;
}

async function assertPortAvailable() {
  await new Promise((resolve, reject) => {
    const probe = createTcpServer();
    probe.once("error", () => reject(new Error(`port ${PORT} is already in use`)));
    probe.listen(PORT, "127.0.0.1", () => probe.close(resolve));
  });
}

async function waitForServer(server) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < READY_TIMEOUT_MS) {
    if (server.exited) throw new Error(`${server.label} exited early with code ${server.exitCode}`);
    try {
      const status = await new Promise((resolve, reject) => {
        const request = get(`${BASE_URL}/api/health`, (response) => {
          response.resume();
          resolve(response.statusCode ?? 0);
        });
        request.setTimeout(2_000, () => request.destroy(new Error("health check timed out")));
        request.on("error", reject);
      });
      if (status === 200) return;
    } catch {
      // Server is still starting.
    }
    await delay(250);
  }
  throw new Error(`${server.label} did not become ready within ${READY_TIMEOUT_MS}ms`);
}

function runPlaywright() {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [localBin("@playwright/test/cli.js"), "test", "tests/e2e/production-routing.spec.ts", "--project=chromium", "--reporter=list"],
      {
        stdio: "inherit",
        shell: false,
        env: {
          ...process.env,
          E2E_PRODUCTION_ROUTING: "1",
          E2E_BASE_URL: BASE_URL,
        },
      },
    );
    child.on("close", (code) => resolve(code ?? 1));
  });
}

async function main() {
  if (!existsSync("dist/index.cjs") || !existsSync("dist/public/index.html")) {
    throw new Error("Production bundle missing. Run npm run build before the routing test.");
  }

  await assertPortAvailable();

  const server = startProcess("production bundle", process.execPath, ["dist/index.cjs"], {
    ...process.env,
    NODE_ENV: "production",
    PORT: String(PORT),
    FIREBASE_PROJECT_ID: PROJECT_ID,
    GOOGLE_CLOUD_PROJECT: PROJECT_ID,
    GCLOUD_PROJECT: PROJECT_ID,
    FIREBASE_STORAGE_BUCKET: `${PROJECT_ID}.appspot.com`,
    FIRESTORE_EMULATOR_HOST: "127.0.0.1:18080",
    FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:19099",
  });

  let exitCode = 1;
  try {
    await waitForServer(server);
    exitCode = await runPlaywright();
  } finally {
    if (!server.exited) server.child.kill();
  }

  if (exitCode !== 0) fail(`Playwright exited with code ${exitCode}.`);
}

main().catch((error) => {
  fail(error instanceof Error ? error.stack || error.message : String(error));
});
