#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ANDROID_PACKAGE_NAME, DEBUG_APK_RELATIVE_PATH, sha256File } from "./build-provenance.mjs";
import { verifyDebugApk } from "./verify-debug-apk.mjs";

const apkPath = DEBUG_APK_RELATIVE_PATH;
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

let verification;
try {
  verification = verifyDebugApk();
} catch (error) {
  fail(`o APK não passou no gate de proveniência: ${error instanceof Error ? error.message : String(error)}`);
}
const absoluteApkPath = resolve(verification.apkPath);

const adb = resolveAdb();
console.log(`ADB detectado: ${adb.path}`);
console.log(adb.version);

const devices = capture(adb.path, ["devices"]);
if (devices.status !== 0) process.exit(devices.status ?? 1);
const authorized = devices.stdout
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith("List of devices"))
  .filter((line) => /\sdevice(?:\s|$)/.test(line))
  .map((line) => line.split(/\s+/)[0]);

if (authorized.length === 0) fail("nenhum aparelho autorizado encontrado. Ative depuração USB e autorize o computador no Galaxy.");
if (authorized.length > 1 && !process.env.ANDROID_SERIAL) {
  fail("mais de um aparelho autorizado encontrado. Defina ANDROID_SERIAL para escolher o destino explicitamente.");
}
const requestedSerial = String(process.env.ANDROID_SERIAL || "").trim();
if (requestedSerial && !authorized.includes(requestedSerial)) {
  fail(`ANDROID_SERIAL não corresponde a um aparelho autorizado: ${requestedSerial}.`);
}
const serial = requestedSerial || authorized[0];
const withDevice = (args) => ["-s", serial, ...args];

const args = withDevice(["install", "-r", absoluteApkPath]);
console.log(`$ ${adb.path} ${args.join(" ")}`);
const install = spawnSync(adb.path, args, { stdio: "inherit", shell: false });
if (install.status !== 0) process.exit(install.status ?? 1);

const packagePathResult = capture(adb.path, withDevice(["shell", "pm", "path", ANDROID_PACKAGE_NAME]));
if (packagePathResult.status !== 0) fail(`o package ${ANDROID_PACKAGE_NAME} não foi localizado após a instalação.`);
const installedPaths = String(packagePathResult.stdout || "")
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line.startsWith("package:"))
  .map((line) => line.slice("package:".length));
const installedBaseApk = installedPaths.find((path) => /[/\\]base\.apk$/.test(path)) || installedPaths[0];
if (!installedBaseApk) fail(`o package ${ANDROID_PACKAGE_NAME} foi instalado, mas o caminho do base.apk não pôde ser validado.`);

const temporaryDirectory = mkdtempSync(join(tmpdir(), "revendasmart-installed-apk-"));
try {
  const pulledApk = join(temporaryDirectory, "installed-base.apk");
  const pull = spawnSync(adb.path, withDevice(["pull", installedBaseApk, pulledApk]), { stdio: "inherit", shell: false });
  if (pull.status !== 0 || !existsSync(pulledApk)) fail("não foi possível ler o base.apk instalado para validar sua proveniência.");
  const installedSha256 = sha256File(pulledApk);
  if (installedSha256 !== verification.apkSha256) {
    fail(`o APK instalado não corresponde ao APK verificado. esperado=${verification.apkSha256} instalado=${installedSha256}`);
  }
  console.log(`Instalação debug validada em ${serial}.`);
  console.log(`Package: ${ANDROID_PACKAGE_NAME}`);
  console.log(`HEAD: ${verification.gitShortCommit}`);
  console.log(`SHA-256 instalado: ${installedSha256}`);
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}
