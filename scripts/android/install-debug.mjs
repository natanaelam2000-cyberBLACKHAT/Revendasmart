#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const apkPath = "android/app/build/outputs/apk/debug/app-debug.apk";
const isWindows = process.platform === "win32";

function fail(message) {
  console.error(`Instalação debug bloqueada: ${message}`);
  process.exit(1);
}

function capture(command, args, options = {}) {
  return spawnSync(command, args, { encoding: "utf8", shell: false, ...options });
}

function normalizePath(value) {
  return String(value || "").trim().replace(/^['\"]|['\"]$/g, "");
}

function executableFromSdkRoot(root) {
  const sdkRoot = normalizePath(root);
  if (!sdkRoot) return "";
  return join(sdkRoot, "platform-tools", isWindows ? "adb.exe" : "adb");
}

function windowsDefaultAdbCandidates() {
  if (!isWindows) return [];
  const candidates = [];
  const localAppData = normalizePath(process.env.LOCALAPPDATA);
  const userProfile = normalizePath(process.env.USERPROFILE);
  if (localAppData) candidates.push(join(localAppData, "Android", "Sdk", "platform-tools", "adb.exe"));
  if (userProfile) candidates.push(join(userProfile, "AppData", "Local", "Android", "Sdk", "platform-tools", "adb.exe"));
  return candidates;
}

function adbCandidatesFromPath() {
  if (isWindows) {
    const result = capture("where.exe", ["adb"]);
    if (result.status !== 0) return [];
    return result.stdout.split(/\r?\n/).map(normalizePath).filter(Boolean);
  }

  const result = capture("sh", ["-c", "command -v adb"]);
  if (result.status !== 0) return [];
  return result.stdout.split(/\r?\n/).map(normalizePath).filter(Boolean);
}

function validateAdb(candidate) {
  const adbPath = normalizePath(candidate);
  if (!adbPath) return null;
  if ((adbPath.includes("/") || adbPath.includes("\\")) && !existsSync(adbPath)) return null;
  const result = capture(adbPath, ["version"]);
  if (result.status !== 0) return null;
  return { path: adbPath, version: `${result.stdout}\n${result.stderr}`.trim().split(/\r?\n/).find(Boolean) || "Android Debug Bridge" };
}

function resolveAdb() {
  const candidates = [
    process.env.ADB_PATH,
    executableFromSdkRoot(process.env.ANDROID_HOME),
    executableFromSdkRoot(process.env.ANDROID_SDK_ROOT),
    ...adbCandidatesFromPath(),
    ...windowsDefaultAdbCandidates(),
  ].map(normalizePath).filter(Boolean);

  const uniqueCandidates = [...new Set(candidates)];
  for (const candidate of uniqueCandidates) {
    const adb = validateAdb(candidate);
    if (adb) return adb;
  }

  fail([
    "adb não foi encontrado ou não executou corretamente.",
    "Verifique ADB_PATH, ANDROID_HOME ou ANDROID_SDK_ROOT.",
    isWindows ? "No Windows, também confirme se platform-tools está instalado pelo Android Studio." : "No Linux/macOS, confirme se adb está no PATH ou no SDK Android.",
  ].join(" "));
}

if (!existsSync(apkPath)) fail(`APK debug não encontrado em ${apkPath}. Execute npm run android:build:debug antes.`);

const adb = resolveAdb();
console.log(`ADB detectado: ${adb.path}`);
console.log(adb.version);

const devices = capture(adb.path, ["devices"]);
if (devices.status !== 0) process.exit(devices.status ?? 1);
const authorized = devices.stdout
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith("List of devices"))
  .filter((line) => /\sdevice$/.test(line));

if (authorized.length === 0) fail("nenhum aparelho autorizado encontrado. Ative depuração USB e autorize o computador no Galaxy.");
if (authorized.length > 1 && !process.env.ANDROID_SERIAL) {
  fail("mais de um aparelho autorizado encontrado. Defina ANDROID_SERIAL para escolher o destino explicitamente.");
}

const args = process.env.ANDROID_SERIAL
  ? ["-s", process.env.ANDROID_SERIAL, "install", "-r", apkPath]
  : ["install", "-r", apkPath];
console.log(`$ ${adb.path} ${args.join(" ")}`);
const install = spawnSync(adb.path, args, { stdio: "inherit", shell: false });
process.exit(install.status ?? 1);
