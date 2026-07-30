#!/usr/bin/env node
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
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
  console.error(`Android web sync bloqueado: ${message}`);
  process.exit(1);
}

function run(command, args, options = {}) {
  console.log(`$ ${[command, ...args].join(" ")}`);
  const result = spawnSync(command, args, { stdio: "inherit", shell: false, ...options });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function npmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function capCommand() {
  return process.platform === "win32" ? "node_modules/.bin/cap.cmd" : "node_modules/.bin/cap";
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

export function runAndroidWebSync(command = "sync") {
  if (!["sync", "copy"].includes(command)) fail(`comando inválido: ${command}`);
  const root = resolveRepositoryRoot();
  process.chdir(root);
  const snapshot = getGitSnapshot(root);
  const apiBaseUrl = normalizeAndroidApiBaseUrl(process.env.VITE_API_BASE_URL || DEFAULT_ANDROID_API_BASE_URL);
  const publicAppUrl = normalizeAndroidPublicAppUrl(process.env.VITE_PUBLIC_APP_URL || DEFAULT_ANDROID_PUBLIC_APP_URL);
  const requestedBuildId = String(process.env.VITE_APP_BUILD_ID || "").trim();
  if (requestedBuildId && requestedBuildId !== snapshot.gitShortCommit) {
    fail(`VITE_APP_BUILD_ID ${requestedBuildId} não corresponde ao HEAD ${snapshot.gitShortCommit}.`);
  }
  const buildId = snapshot.gitShortCommit;
  const buildStartedAt = normalizeBuildStartedAt(process.env.ANDROID_BUILD_STARTED_AT || new Date().toISOString());
  const env = { ...process.env, VITE_API_BASE_URL: apiBaseUrl, VITE_PUBLIC_APP_URL: publicAppUrl, VITE_APP_BUILD_ID: buildId };

  run(npmCommand(), ["run", "build"], { env });
  const completedSnapshot = getGitSnapshot(root);
  assertSnapshotUnchanged(snapshot, completedSnapshot);
  const buildManifest = createBuildManifest(snapshot, { buildStartedAt });
  writeFileSync(join(WEB_BUILD_DIR, BUILD_MANIFEST_FILE), `${JSON.stringify(buildManifest, null, 2)}\n`, "utf8");
  assertWebBuild(apiBaseUrl, publicAppUrl, buildId);
  run(capCommand(), [command, "android"]);
  assertAndroidAssets(apiBaseUrl, publicAppUrl, buildId);
  assertCopiedAssetsMatch();
  console.log(JSON.stringify({
    command,
    webDir: WEB_BUILD_DIR,
    androidWebDir: ANDROID_WEB_DIR,
    apiBaseUrl,
    publicAppUrl,
    buildId,
    gitCommit: snapshot.gitCommit,
    branch: snapshot.branch,
    buildManifest: join(WEB_BUILD_DIR, BUILD_MANIFEST_FILE),
    worktreeClean: snapshot.worktreeClean,
  }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runAndroidWebSync(process.argv[2] || "sync");
}
