#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

export const DEFAULT_ANDROID_API_BASE_URL = "https://revendasmart.vercel.app";
const WEB_DIR = "dist/public";
const FORBIDDEN_BUNDLE_MARKERS = [
  "http://localhost:5000",
  "http://localhost/api",
  "https://localhost/api",
  "capacitor://localhost/api",
  "server.url",
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

export function normalizeAndroidApiBaseUrl(value) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) throw new Error("VITE_API_BASE_URL Android não pode ficar vazia.");

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error("VITE_API_BASE_URL Android precisa ser uma URL válida.");
  }

  if (parsed.protocol !== "https:") {
    throw new Error("VITE_API_BASE_URL Android precisa usar HTTPS.");
  }

  const host = parsed.hostname.toLowerCase();
  if (host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0" || host === "::1") {
    throw new Error("VITE_API_BASE_URL Android não pode apontar para localhost.");
  }

  return parsed.origin;
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

function assertWebBuild(apiBaseUrl) {
  const indexPath = join(WEB_DIR, "index.html");
  if (!statSync(indexPath, { throwIfNoEntry: false })?.isFile()) {
    fail(`${indexPath} não encontrado após build.`);
  }

  const files = walkFiles(WEB_DIR).filter((file) => /\.(html|js|css|json|map)$/.test(file));
  let apiBaseSeen = false;
  for (const file of files) {
    const contents = readFileSync(file, "utf8");
    if (contents.includes(apiBaseUrl)) apiBaseSeen = true;
    for (const marker of FORBIDDEN_BUNDLE_MARKERS) {
      if (contents.includes(marker)) fail(`marcador proibido encontrado em ${file}: ${marker}`);
    }
  }

  if (!apiBaseSeen) fail(`domínio público de API não encontrado no build: ${apiBaseUrl}`);
}

export function runAndroidWebSync(command = "sync") {
  if (!["sync", "copy"].includes(command)) fail(`comando inválido: ${command}`);
  const apiBaseUrl = normalizeAndroidApiBaseUrl(process.env.VITE_API_BASE_URL || DEFAULT_ANDROID_API_BASE_URL);
  const env = { ...process.env, VITE_API_BASE_URL: apiBaseUrl };

  run(npmCommand(), ["run", "build"], { env });
  assertWebBuild(apiBaseUrl);
  run(capCommand(), [command, "android"]);
  console.log(JSON.stringify({ command, webDir: WEB_DIR, apiBaseUrl }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runAndroidWebSync(process.argv[2] || "sync");
}
