#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

const apkPath = "android/app/build/outputs/apk/debug/app-debug.apk";

function fail(message) {
  console.error(`Instalação debug bloqueada: ${message}`);
  process.exit(1);
}

function commandExists(command) {
  const result = spawnSync("bash", ["-lc", `command -v ${command}`], { encoding: "utf8" });
  return result.status === 0 && result.stdout.trim().length > 0;
}

if (!commandExists("adb")) fail("adb não está disponível no PATH.");
if (!existsSync(apkPath)) fail(`APK debug não encontrado em ${apkPath}. Execute npm run android:build:debug antes.`);

const devices = spawnSync("adb", ["devices"], { encoding: "utf8" });
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
console.log(`$ adb ${args.join(" ")}`);
const install = spawnSync("adb", args, { stdio: "inherit" });
process.exit(install.status ?? 1);
