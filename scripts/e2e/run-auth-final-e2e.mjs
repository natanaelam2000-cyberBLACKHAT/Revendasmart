import { spawn } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";

const project = "demo-revendasmart";
for (const [name, expected] of Object.entries({ FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099", FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080", FIREBASE_STORAGE_EMULATOR_HOST: "127.0.0.1:9199" })) {
  if (process.env[name] !== expected) throw new Error(`${name} must point to the local demo emulator.`);
}
for (const name of ["FIREBASE_PROJECT_ID", "GOOGLE_CLOUD_PROJECT", "GCLOUD_PROJECT"]) {
  if (process.env[name] && process.env[name] !== project) throw new Error("Runtime tests must use demo-revendasmart.");
}
if (!existsSync("dist/index.cjs")) throw new Error("Run npm run build before the runtime tests.");
const clientPort = Number(process.env.E2E_PORT || 5067);
const apiPort = Number(process.env.E2E_API_PORT || 5068);
const clientUrl = `http://127.0.0.1:${clientPort}`;
const apiUrl = `http://127.0.0.1:${apiPort}`;
const children = [];
function start(args, env) {
  const child = spawn(process.execPath, args, { env: { ...process.env, ...env }, stdio: "inherit", windowsHide: true });
  children.push(child);
  return child;
}
async function ready(url) {
  for (let attempt = 0; attempt < 120; attempt++) {
    if (children.some(child => child.exitCode !== null)) throw new Error("Runtime process exited before readiness.");
    try { const response = await fetch(url, { signal: AbortSignal.timeout(3000) }); if (response.ok || response.status === 404) return; } catch { /* starting */ }
    await delay(1000);
  }
  throw new Error(`Runtime readiness timed out: ${url}`);
}
try {
  start(["dist/index.cjs"], { NODE_ENV: "production", PORT: String(apiPort), FIREBASE_PROJECT_ID: project, GOOGLE_CLOUD_PROJECT: project, GCLOUD_PROJECT: project, FIREBASE_STORAGE_BUCKET: `${project}.appspot.com`, CORS_ALLOWED_ORIGINS: clientUrl });
  start(["node_modules/tsx/dist/cli.mjs", "scripts/e2e/auth-final-vite.ts"], {
    NODE_ENV: "development", VITE_API_BASE_URL: apiUrl, VITE_USE_FIREBASE_EMULATORS: "true",
    VITE_FIREBASE_API_KEY: "demo-api-key", VITE_FIREBASE_AUTH_DOMAIN: `${project}.firebaseapp.com`,
    VITE_FIREBASE_PROJECT_ID: project, VITE_FIREBASE_STORAGE_BUCKET: `${project}.appspot.com`,
    VITE_FIREBASE_MESSAGING_SENDER_ID: "000000000000", VITE_FIREBASE_APP_ID: `1:000000000000:web:${project}`,
  });
  writeFileSync(".tmp/auth-runtime-pids.json", JSON.stringify(children.map(child => child.pid)));
  await Promise.all([ready(`${apiUrl}/api/health`), ready(clientUrl)]);
  const specs = process.env.E2E_SPEC ? [process.env.E2E_SPEC] : ["tests/e2e/auth-final.spec.ts", "tests/e2e/account-deletion.spec.ts", "tests/e2e/auth-first-run.spec.ts"];
  const testProcess = start(["node_modules/@playwright/test/cli.js", "test", ...specs, "--reporter=list"], { E2E_EMULATOR: "1", E2E_BASE_URL: clientUrl, E2E_API_BASE_URL: apiUrl });
  process.exitCode = await new Promise(resolve => testProcess.on("exit", code => resolve(code ?? 1)));
} catch (error) {
  console.error(error instanceof Error ? error.message : "Auth runtime failed");
  process.exitCode = 1;
} finally {
  for (const child of children) if (child.exitCode === null) child.kill();
}
