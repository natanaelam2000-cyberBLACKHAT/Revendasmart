#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

export const DEFAULT_ANDROID_API_BASE_URL = "https://revendasmart.vercel.app";
export const DEFAULT_ANDROID_PUBLIC_APP_URL = "https://revendasmart.vercel.app";
const WEB_DIR = "dist/public";
const ANDROID_WEB_DIR = "android/app/src/main/assets/public";
const REQUIRED_ANDROID_BUNDLE_MARKERS = [
  "Resumo do per\u00edodo",
  "Insight principal",
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

function resolveGitBuildId() {
  const result = spawnSync("git", ["rev-parse", "--short=12", "HEAD"], { encoding: "utf8", shell: false });
  if (result.status !== 0) return "local-dev";
  return String(result.stdout || "").trim() || "local-dev";
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

function walkFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walkFiles(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
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
  const files = readBuildFiles(WEB_DIR);
  assertForbiddenMarkersAbsent(files);
  assertMarkerSeen(files, apiBaseUrl, "dominio publico de API");
  assertMarkerSeen(files, publicAppUrl, "dominio publico do app");
  for (const marker of REQUIRED_ANDROID_BUNDLE_MARKERS) assertMarkerSeen(files, marker, "marcador funcional Android");
  assertMarkerSeen(files, buildId, "identificador de build");
}

function assertAndroidAssets(apiBaseUrl, publicAppUrl, buildId) {
  const files = readBuildFiles(ANDROID_WEB_DIR);
  assertForbiddenMarkersAbsent(files);
  assertMarkerSeen(files, apiBaseUrl, "dominio publico de API nos assets Android");
  assertMarkerSeen(files, publicAppUrl, "dominio publico do app nos assets Android");
  for (const marker of REQUIRED_ANDROID_BUNDLE_MARKERS) assertMarkerSeen(files, marker, "marcador funcional nos assets Android");
  assertMarkerSeen(files, buildId, "identificador de build nos assets Android");
}


export function runAndroidWebSync(command = "sync") {
  if (!["sync", "copy"].includes(command)) fail(`comando inválido: ${command}`);
  const apiBaseUrl = normalizeAndroidApiBaseUrl(process.env.VITE_API_BASE_URL || DEFAULT_ANDROID_API_BASE_URL);
  const publicAppUrl = normalizeAndroidPublicAppUrl(process.env.VITE_PUBLIC_APP_URL || DEFAULT_ANDROID_PUBLIC_APP_URL);
  const buildId = process.env.VITE_APP_BUILD_ID || resolveGitBuildId();
  const env = { ...process.env, VITE_API_BASE_URL: apiBaseUrl, VITE_PUBLIC_APP_URL: publicAppUrl, VITE_APP_BUILD_ID: buildId };

  run(npmCommand(), ["run", "build"], { env });
  assertWebBuild(apiBaseUrl, publicAppUrl, buildId);
  run(capCommand(), [command, "android"]);
  assertAndroidAssets(apiBaseUrl, publicAppUrl, buildId);
  console.log(JSON.stringify({ command, webDir: WEB_DIR, androidWebDir: ANDROID_WEB_DIR, apiBaseUrl, publicAppUrl, buildId }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runAndroidWebSync(process.argv[2] || "sync");
}
