#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const CLIENT_PORT = 5063;
const CLIENT_URL = `http://127.0.0.1:${CLIENT_PORT}`;
const localBin = (relativePath) => fileURLToPath(new URL(`../../node_modules/${relativePath}`, import.meta.url));
const required = {
  PRO13_REAL_CALL: "1",
  FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
  FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099",
  FIREBASE_STORAGE_EMULATOR_HOST: "127.0.0.1:9199",
  MARKETING_PRO_REAL_BACKGROUND_ENABLED: "true",
  MARKETING_PRO_PRODUCT_UNDERSTANDING_ENABLED: "true",
};
for (const [name, expected] of Object.entries(required)) {
  if (process.env[name] !== expected) throw new Error(`${name} precisa ser ${expected}`);
}

const routeCall = spawnSync(process.execPath, [localBin("tsx/dist/cli.mjs"), "script/pro13-real-emulator-route-call.ts"], { stdio: "inherit", shell: false, env: process.env });
if (routeCall.status !== 0) process.exit(routeCall.status ?? 1);
if (!existsSync(".tmp/pro13-real-final/background.png") || !existsSync(".tmp/pro13-real-final/cutout.png")) throw new Error("rota não produziu os assets aprovados");

const vite = spawn(process.execPath, [localBin("vite/bin/vite.js"), "dev", "--port", String(CLIENT_PORT), "--host", "127.0.0.1", "--strictPort"], {
  stdio: ["ignore", "inherit", "inherit"], shell: false,
  env: { ...process.env, NODE_ENV: "development", VITE_USE_FIREBASE_EMULATORS: "true", VITE_MARKETING_PRO_REAL_BACKGROUND_ENABLED: "true" },
});
try {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 60_000) {
    if (vite.exitCode !== null) throw new Error(`Vite encerrou com ${vite.exitCode}`);
    try { const response = await fetch(CLIENT_URL); if (response.ok) break; } catch { /* aguardando */ }
    await delay(500);
  }
  const playwright = spawnSync(process.execPath, [localBin("@playwright/test/cli.js"), "test", "tests/e2e/pro13-real-final.spec.ts", "--reporter=list"], {
    stdio: "inherit", shell: false, env: { ...process.env, E2E_BASE_URL: CLIENT_URL },
  });
  process.exitCode = playwright.status ?? 1;
} finally {
  vite.kill();
}
