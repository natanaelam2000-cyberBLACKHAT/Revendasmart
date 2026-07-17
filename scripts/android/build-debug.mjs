#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";

const packageName = "com.revendasmart.app";
const apkPath = "android/app/build/outputs/apk/debug/app-debug.apk";

function run(command, args, options = {}) {
  console.log(`$ ${[command, ...args].join(" ")}`);
  return spawnSync(command, args, { stdio: "inherit", shell: false, ...options });
}

function commandExists(command) {
  const result = spawnSync("bash", ["-lc", `command -v ${command}`], { encoding: "utf8" });
  return result.status === 0 && result.stdout.trim().length > 0;
}

function fail(message) {
  console.error(`Android debug build bloqueado: ${message}`);
  process.exit(1);
}

const sdkRoot = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || "";
if (!sdkRoot) fail("ANDROID_HOME ou ANDROID_SDK_ROOT não está configurado.");
if (!existsSync(sdkRoot)) fail(`SDK Android não encontrado em ${sdkRoot}.`);
if (!commandExists("java") || !commandExists("javac")) fail("Java/Javac não estão disponíveis no PATH.");
if (!existsSync("android/gradlew")) fail("android/gradlew não encontrado. Execute a fundação Capacitor antes.");
if (existsSync("android/local.properties")) {
  console.log("android/local.properties detectado localmente; confirme que ele permanece ignorado pelo Git.");
}

let availableKb = 0;
try {
  const output = execFileSync("df", ["--output=avail", "-k", "."], { encoding: "utf8" }).trim().split(/\s+/).pop();
  availableKb = Number(output || 0);
} catch {
  availableKb = 0;
}
if (availableKb > 0 && availableKb < 1048576) {
  fail("menos de 1 GB livre no filesystem do projeto; não vou arriscar ENOSPC.");
}

let result = run(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "android:sync"]);
if (result.status !== 0) process.exit(result.status ?? 1);

result = run("./gradlew", ["assembleDebug", "--stacktrace", "--no-daemon"], { cwd: "android" });
if (result.status !== 0) process.exit(result.status ?? 1);

if (!existsSync(apkPath)) fail(`APK debug não encontrado em ${apkPath}.`);
const size = statSync(apkPath).size;
const sha256 = execFileSync("sha256sum", [apkPath], { encoding: "utf8" }).trim().split(/\s+/)[0];
console.log(JSON.stringify({ packageName, variant: "debug", apkPath, sizeBytes: size, sha256 }, null, 2));
