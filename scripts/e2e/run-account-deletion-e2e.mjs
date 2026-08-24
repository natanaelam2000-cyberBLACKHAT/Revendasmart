#!/usr/bin/env node
/**
 * RELEASE-03B — orquestra o E2E real do fluxo de exclusão de conta.
 *
 * Sobe DOIS processos reais contra o Firebase Auth/Firestore/Storage Emulator:
 *   1. a API real (server/index.ts) na porta E2E_API_PORT;
 *   2. o client real servido pelo dev server do Vite na porta E2E_PORT, apontando para a API acima
 *      via VITE_API_BASE_URL, com VITE_USE_FIREBASE_EMULATORS=true.
 *
 * Por que o Vite roda separado, e não pelo `setupVite` embutido do servidor: em modo development o
 * `server/vite.ts` faz `{...viteConfig}` de um config que é uma FUNÇÃO (`defineConfig(({mode}) => ...)`),
 * então o `root: client/` definido no vite.config.ts nunca é aplicado e o dev server embutido não
 * consegue resolver /src/main.tsx; além disso, o customLogger dele chama `process.exit(1)` em
 * qualquer erro do Vite, derrubando o processo inteiro. Isso é uma quebra pré-existente do `npm run
 * dev`, sem relação com exclusão de conta — o E2E a contorna em vez de alterar o backend (§2).
 *
 * Este script roda DENTRO de `firebase emulators:exec`, que garante os emuladores de pé e os derruba
 * no final (ver o npm script `test:e2e:account-deletion`).
 *
 * Segurança: aborta se qualquer variável apontar para um projeto que não seja o demo/emulado.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const CLIENT_PORT = Number(process.env.E2E_PORT || 5057);
const API_PORT = Number(process.env.E2E_API_PORT || 5058);
const CLIENT_URL = `http://127.0.0.1:${CLIENT_PORT}`;
const API_URL = `http://127.0.0.1:${API_PORT}`;
const PROJECT_ID = "demo-revendasmart";
const READINESS_TIMEOUT_MS = 180_000;

const localBin = (relativePath) => fileURLToPath(new URL(`../../node_modules/${relativePath}`, import.meta.url));

function fail(message) {
  console.error(`E2E de exclusão de conta bloqueado: ${message}`);
  process.exit(1);
}

function assertEmulatedEnvironment() {
  if (process.env.FIRESTORE_EMULATOR_HOST !== "127.0.0.1:8080") fail("FIRESTORE_EMULATOR_HOST não aponta para o emulador local.");
  if (process.env.FIREBASE_AUTH_EMULATOR_HOST !== "127.0.0.1:9099") fail("FIREBASE_AUTH_EMULATOR_HOST não aponta para o emulador local.");
  for (const name of ["FIREBASE_PROJECT_ID", "GOOGLE_CLOUD_PROJECT", "GCLOUD_PROJECT"]) {
    const value = process.env[name];
    if (value && value !== PROJECT_ID) fail(`${name}=${value} — este E2E só pode rodar contra ${PROJECT_ID}.`);
  }
}

/** Credenciais de fachada: o Auth Emulator não valida apiKey e nenhum segredo real é usado. */
const emulatedFirebaseClientEnv = {
  VITE_USE_FIREBASE_EMULATORS: "true",
  VITE_FIREBASE_API_KEY: "demo-api-key",
  VITE_FIREBASE_AUTH_DOMAIN: `${PROJECT_ID}.firebaseapp.com`,
  VITE_FIREBASE_PROJECT_ID: PROJECT_ID,
  VITE_FIREBASE_STORAGE_BUCKET: `${PROJECT_ID}.appspot.com`,
  VITE_FIREBASE_MESSAGING_SENDER_ID: "000000000000",
  VITE_FIREBASE_APP_ID: `1:000000000000:web:${PROJECT_ID}`,
};

function startProcess(label, command, args, env) {
  const state = { label, exited: false, exitCode: null, child: null };
  const child = spawn(command, args, { stdio: ["ignore", "inherit", "inherit"], shell: false, env });
  child.on("close", (code) => { state.exited = true; state.exitCode = code; });
  state.child = child;
  return state;
}

async function waitForHttp(label, url, ...processes) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < READINESS_TIMEOUT_MS) {
    for (const process of processes) {
      if (process.exited) fail(`${process.label} encerrou antes de ${label} ficar pronto (exit code ${process.exitCode}).`);
    }
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
      if (response.ok || response.status === 404) return;
    } catch {
      // ainda subindo
    }
    await delay(1_000);
  }
  fail(`${label} não respondeu em ${url} dentro de ${READINESS_TIMEOUT_MS / 1000}s.`);
}

function runPlaywright() {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [localBin("@playwright/test/cli.js"), "test", process.env.E2E_SPEC || "tests/e2e/account-deletion.spec.ts", "--reporter=list"],
      {
        stdio: "inherit",
        shell: false,
        env: { ...process.env, E2E_EMULATOR: "1", E2E_BASE_URL: CLIENT_URL, E2E_API_BASE_URL: API_URL },
      },
    );
    child.on("close", (code) => resolve(code ?? 1));
  });
}

async function main() {
  assertEmulatedEnvironment();

  // A API roda a partir do BUNDLE de produção real (dist/index.cjs) — o mesmo artefato que vai para o
  // Cloud Run. Rodar server/index.ts direto com NODE_ENV=production falharia em `serveStatic`
  // (`__dirname is not defined`, porque o fonte é ESM e só o bundle é CJS).
  if (!existsSync("dist/index.cjs")) {
    console.log("dist/index.cjs ausente; gerando o build de produção...");
    const build = spawnSync(process.execPath, [localBin("tsx/dist/cli.mjs"), "script/build.ts"], { stdio: "inherit", shell: false });
    if (build.status !== 0) fail("não foi possível gerar o build de produção necessário para o E2E.");
  }

  console.log(`Subindo a API real em ${API_URL} (emuladores Firebase)...`);
  const api = startProcess("a API", process.execPath, ["dist/index.cjs"], {
    ...process.env,
    NODE_ENV: "production",
    PORT: String(API_PORT),
    FIREBASE_PROJECT_ID: PROJECT_ID,
    GOOGLE_CLOUD_PROJECT: PROJECT_ID,
    GCLOUD_PROJECT: PROJECT_ID,
    FIREBASE_STORAGE_BUCKET: `${PROJECT_ID}.appspot.com`,
    CORS_ALLOWED_ORIGINS: CLIENT_URL,
  });

  console.log(`Subindo o client real (Vite) em ${CLIENT_URL}...`);
  const client = startProcess("o client", process.execPath, [
    localBin("vite/bin/vite.js"), "dev", "--port", String(CLIENT_PORT), "--host", "127.0.0.1", "--strictPort",
  ], {
    ...process.env,
    NODE_ENV: "development",
    ...emulatedFirebaseClientEnv,
    VITE_API_BASE_URL: API_URL,
  });

  let exitCode = 1;
  try {
    await waitForHttp("a API", `${API_URL}/api/health`, api, client);
    await waitForHttp("o client", CLIENT_URL, api, client);
    console.log("Aplicação pronta; iniciando o Playwright.");
    exitCode = await runPlaywright();
  } finally {
    for (const process of [client, api]) {
      if (!process.exited) process.child.kill();
    }
  }

  process.exit(exitCode);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exit(1);
});
