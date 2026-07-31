#!/usr/bin/env node
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { loadEnv } from "vite";
import {
  ANDROID_WEB_DIR,
  BUILD_MANIFEST_FILE,
  WEB_BUILD_DIR,
  buildDirectoryHashMap,
  compareDirectoryHashMaps,
  createBuildManifest,
  getGitSnapshot,
  resolveRepositoryRoot,
  walkFiles,
} from "./build-provenance.mjs";

export const DEFAULT_ANDROID_API_BASE_URL = "https://revendasmart.vercel.app";
export const DEFAULT_ANDROID_PUBLIC_APP_URL = "https://revendasmart.vercel.app";
export const REQUIRED_ANDROID_FIREBASE_ENV_VARS = Object.freeze([
  "VITE_FIREBASE_API_KEY",
  "VITE_FIREBASE_AUTH_DOMAIN",
  "VITE_FIREBASE_PROJECT_ID",
  "VITE_FIREBASE_STORAGE_BUCKET",
  "VITE_FIREBASE_MESSAGING_SENDER_ID",
  "VITE_FIREBASE_APP_ID",
]);

function readNonEmptyEnvValue(env, name) {
  return String(env?.[name] ?? "").trim();
}

export function resolveAndroidFirebaseConfig(processEnv = {}, fileEnv = {}) {
  const values = {};
  const missing = [];
  for (const name of REQUIRED_ANDROID_FIREBASE_ENV_VARS) {
    const value = readNonEmptyEnvValue(processEnv, name) || readNonEmptyEnvValue(fileEnv, name);
    if (value) values[name] = value;
    else missing.push(name);
  }
  return { values, missing, firebaseConfigPresent: missing.length === 0 };
}

export function assertAndroidFirebaseConfig(config) {
  if (config?.firebaseConfigPresent === true && config.missing?.length === 0) return config;
  const missing = Array.isArray(config?.missing) && config.missing.length
    ? config.missing
    : REQUIRED_ANDROID_FIREBASE_ENV_VARS;
  throw new Error([
    "Firebase config ausente para build Android:",
    ...missing.map((name) => `- ${name}`),
  ].join("\n"));
}

const REQUIRED_ANDROID_BUNDLE_MARKERS = [
  "Resumo do per\u00edodo",
  "Insight principal",
  "O que precisa da sua aten\u00e7\u00e3o",
];
const FORBIDDEN_BUNDLE_MARKERS = [
  "http://localhost:5000",
  "http://localhost/api",
  "https://localhost/api",
  "capacitor://localhost/api",
  "server.url",
  "http://localhost/u/",
  "https://localhost/u/",
  "http://127.0.0.1/u/",
  "https://127.0.0.1/u/",
  "capacitor://localhost/u/",
  "file:///u/",
  "Produto selecionado para voc\u00ea pedir direto pelo WhatsApp",
  "Imagem omitida; arte gerada sem ela",
  "Pe\u00e7a pelo WhatsApp",
  "REVENDA SMART",
];

function fail(message) {
  throw new Error(message);
}

function formatCommand(command, args) {
  return [command, ...args].join(" ");
}

function isFile(path) {
  return statSync(path, { throwIfNoEntry: false })?.isFile() === true;
}

export function runCommand(command, args, options = {}) {
  const cwd = resolve(options.cwd || process.cwd());
  const logger = options.logger || console;
  logger.log(`$ ${formatCommand(command, args)}`);

  return new Promise((resolveCommand, rejectCommand) => {
    let child;
    try {
      child = spawn(command, args, {
        cwd,
        env: options.env || process.env,
        stdio: options.stdio || "inherit",
        shell: false,
        windowsHide: process.platform === "win32",
      });
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? `; code=${error.code}` : "";
      const errno = error && typeof error === "object" && "errno" in error ? `; errno=${error.errno}` : "";
      rejectCommand(new Error(`falha ao iniciar comando: ${formatCommand(command, args)}; cwd=${cwd}; erro=${error instanceof Error ? error.message : String(error)}${code}${errno}`));
      return;
    }

    child.once("error", (error) => {
      const code = error.code ? `; code=${error.code}` : "";
      const errno = error.errno !== undefined ? `; errno=${error.errno}` : "";
      rejectCommand(new Error(`falha ao iniciar comando: ${formatCommand(command, args)}; cwd=${cwd}; erro=${error.message}${code}${errno}`));
    });
    child.once("close", (code, signal) => {
      if (code === 0) {
        resolveCommand();
        return;
      }
      const signalDetails = signal ? `; signal=${signal}` : "";
      rejectCommand(new Error(`comando falhou: ${formatCommand(command, args)}; cwd=${cwd}; exit code=${code ?? "nulo"}${signalDetails}`));
    });
  });
}

export function resolveNpmInvocation(options = {}) {
  const nodeExecutable = options.nodeExecutable || process.execPath;
  const nodeDirectory = dirname(nodeExecutable);
  const npmCliCandidates = [
    options.npmExecPath || process.env.npm_execpath || "",
    join(nodeDirectory, "node_modules", "npm", "bin", "npm-cli.js"),
    resolve(nodeDirectory, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
  ].filter(Boolean);

  for (const npmCliPath of [...new Set(npmCliCandidates)]) {
    if (isFile(npmCliPath)) return { command: nodeExecutable, args: [npmCliPath] };
  }

  fail("npm-cli.js não foi localizado. Execute o sync por npm run android:sync ou reinstale o Node.js com npm.");
}

export function resolveCapInvocation(root = resolveRepositoryRoot(), nodeExecutable = process.execPath) {
  const capCliPath = join(root, "node_modules", "@capacitor", "cli", "bin", "capacitor");
  if (!isFile(capCliPath)) {
    fail(`CLI do Capacitor não encontrado em ${capCliPath}. Execute npm ci antes do sync Android.`);
  }
  return { command: nodeExecutable, args: [capCliPath] };
}

export async function executeAndroidSyncSteps(steps, logger = console) {
  const pipeline = [
    { label: "Build web", success: "Build web", action: steps.build },
    { label: "Manifesto/proveniência", success: "Manifesto", action: steps.manifest },
    { label: "Capacitor sync", success: "Capacitor sync", action: steps.capacitor },
    { label: "Validação de assets", success: "Android sync concluído", action: steps.validate },
  ];

  for (const [index, step] of pipeline.entries()) {
    logger.log(`[${index + 1}/${pipeline.length}] ${step.label}`);
    try {
      await step.action();
      logger.log(`OK: ${step.success}`);
    } catch (error) {
      logger.error(`FALHA: ${step.label}\n${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }
}

function normalizeAndroidHttpsBaseUrl(value, envName) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) throw new Error(`${envName} Android não pode ficar vazia.`);

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(`${envName} Android precisa ser uma URL válida.`);
  }

  if (parsed.protocol !== "https:") {
    throw new Error(`${envName} Android precisa usar HTTPS.`);
  }

  const host = parsed.hostname.toLowerCase();
  if (host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0" || host === "::1") {
    throw new Error(`${envName} Android não pode apontar para localhost.`);
  }

  return parsed.origin;
}

export function normalizeAndroidApiBaseUrl(value) {
  return normalizeAndroidHttpsBaseUrl(value, "VITE_API_BASE_URL");
}

export function normalizeAndroidPublicAppUrl(value) {
  return normalizeAndroidHttpsBaseUrl(value, "VITE_PUBLIC_APP_URL");
}

function readBuildFiles(dir) {
  const indexPath = join(dir, "index.html");
  if (!statSync(indexPath, { throwIfNoEntry: false })?.isFile()) {
    fail(`${indexPath} nao encontrado apos build.`);
  }
  return walkFiles(dir).filter((file) => /\.(html|js|css|json|map)$/.test(file));
}

function assertMarkerSeen(files, marker, label) {
  for (const file of files) {
    if (readFileSync(file, "utf8").includes(marker)) return;
  }
  fail(`${label} nao encontrado no bundle: ${marker}`);
}

function assertForbiddenMarkersAbsent(files) {
  for (const file of files) {
    const contents = readFileSync(file, "utf8");
    for (const marker of FORBIDDEN_BUNDLE_MARKERS) {
      if (contents.includes(marker)) fail(`marcador proibido encontrado em ${file}: ${marker}`);
    }
  }
}

function assertWebBuild(apiBaseUrl, publicAppUrl, buildId) {
  const files = readBuildFiles(WEB_BUILD_DIR);
  const runtimeFiles = files.filter((file) => !file.endsWith(BUILD_MANIFEST_FILE));
  assertForbiddenMarkersAbsent(files);
  assertMarkerSeen(files, apiBaseUrl, "dominio publico de API");
  assertMarkerSeen(files, publicAppUrl, "dominio publico do app");
  for (const marker of REQUIRED_ANDROID_BUNDLE_MARKERS) assertMarkerSeen(files, marker, "marcador funcional Android");
  assertMarkerSeen(runtimeFiles, buildId, "identificador de build no código da aplicação");
}

function assertAndroidAssets(apiBaseUrl, publicAppUrl, buildId) {
  const files = readBuildFiles(ANDROID_WEB_DIR);
  const runtimeFiles = files.filter((file) => !file.endsWith(BUILD_MANIFEST_FILE));
  assertForbiddenMarkersAbsent(files);
  assertMarkerSeen(files, apiBaseUrl, "dominio publico de API nos assets Android");
  assertMarkerSeen(files, publicAppUrl, "dominio publico do app nos assets Android");
  for (const marker of REQUIRED_ANDROID_BUNDLE_MARKERS) assertMarkerSeen(files, marker, "marcador funcional nos assets Android");
  assertMarkerSeen(runtimeFiles, buildId, "identificador de build no código dos assets Android");
}

function normalizeBuildStartedAt(value) {
  const timestamp = Date.parse(String(value || ""));
  if (!Number.isFinite(timestamp)) fail("ANDROID_BUILD_STARTED_AT inválido.");
  return new Date(timestamp).toISOString();
}

function assertSnapshotUnchanged(before, after) {
  for (const field of ["gitCommit", "gitShortCommit", "branch", "worktreeFingerprint"]) {
    if (before[field] !== after[field]) fail(`o estado Git mudou durante o build (${field}).`);
  }
}

function assertCopiedAssetsMatch() {
  const webHashes = buildDirectoryHashMap(WEB_BUILD_DIR);
  const androidHashes = buildDirectoryHashMap(ANDROID_WEB_DIR);
  const comparison = compareDirectoryHashMaps(webHashes, androidHashes);
  const allowedCapacitorExtras = new Set(["cordova.js", "cordova_plugins.js"]);
  const unexpected = comparison.unexpected.filter((file) => !allowedCapacitorExtras.has(file));
  if (comparison.missing.length || comparison.mismatched.length || unexpected.length) {
    fail([
      "assets copiados para Android divergem do build web.",
      comparison.missing.length ? `ausentes=${comparison.missing.join(",")}` : "",
      comparison.mismatched.length ? `hash-divergente=${comparison.mismatched.join(",")}` : "",
      unexpected.length ? `inesperados=${unexpected.join(",")}` : "",
    ].filter(Boolean).join(" "));
  }
}

export async function runAndroidWebSync(command = "sync") {
  if (!["sync", "copy"].includes(command)) fail(`comando inválido: ${command}`);
  const root = resolveRepositoryRoot();
  process.chdir(root);
  const firebaseFileEnv = loadEnv("production", join(root, "client"), "VITE_FIREBASE_");
  const firebaseConfig = resolveAndroidFirebaseConfig(process.env, firebaseFileEnv);
  assertAndroidFirebaseConfig(firebaseConfig);
  const snapshot = getGitSnapshot(root);
  const apiBaseUrl = normalizeAndroidApiBaseUrl(process.env.VITE_API_BASE_URL || DEFAULT_ANDROID_API_BASE_URL);
  const publicAppUrl = normalizeAndroidPublicAppUrl(process.env.VITE_PUBLIC_APP_URL || DEFAULT_ANDROID_PUBLIC_APP_URL);
  const requestedBuildId = String(process.env.VITE_APP_BUILD_ID || "").trim();
  if (requestedBuildId && requestedBuildId !== snapshot.gitShortCommit) {
    fail(`VITE_APP_BUILD_ID ${requestedBuildId} não corresponde ao HEAD ${snapshot.gitShortCommit}.`);
  }
  const buildId = snapshot.gitShortCommit;
  const buildStartedAt = normalizeBuildStartedAt(process.env.ANDROID_BUILD_STARTED_AT || new Date().toISOString());
  const env = { ...process.env, ...firebaseConfig.values, VITE_API_BASE_URL: apiBaseUrl, VITE_PUBLIC_APP_URL: publicAppUrl, VITE_APP_BUILD_ID: buildId };
  const npmInvocation = resolveNpmInvocation();
  const capInvocation = resolveCapInvocation(root);

  await executeAndroidSyncSteps({
    build: () => runCommand(npmInvocation.command, [...npmInvocation.args, "run", "build"], { cwd: root, env }),
    manifest: () => {
      const completedSnapshot = getGitSnapshot(root);
      assertSnapshotUnchanged(snapshot, completedSnapshot);
      const buildManifest = createBuildManifest(snapshot, { buildStartedAt, firebaseConfigPresent: firebaseConfig.firebaseConfigPresent });
      writeFileSync(join(WEB_BUILD_DIR, BUILD_MANIFEST_FILE), `${JSON.stringify(buildManifest, null, 2)}\n`, "utf8");
      assertWebBuild(apiBaseUrl, publicAppUrl, buildId);
    },
    capacitor: () => runCommand(capInvocation.command, [...capInvocation.args, command, "android"], { cwd: root }),
    validate: () => {
      assertAndroidAssets(apiBaseUrl, publicAppUrl, buildId);
      assertCopiedAssetsMatch();
    },
  });

  console.log(JSON.stringify({
    command,
    webDir: WEB_BUILD_DIR,
    androidWebDir: ANDROID_WEB_DIR,
    apiBaseUrl,
    publicAppUrl,
    firebaseConfigPresent: firebaseConfig.firebaseConfigPresent,
    buildId,
    gitCommit: snapshot.gitCommit,
    branch: snapshot.branch,
    buildManifest: join(WEB_BUILD_DIR, BUILD_MANIFEST_FILE),
    worktreeClean: snapshot.worktreeClean,
  }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runAndroidWebSync(process.argv[2] || "sync").catch((error) => {
    console.error(`Android web sync bloqueado: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
