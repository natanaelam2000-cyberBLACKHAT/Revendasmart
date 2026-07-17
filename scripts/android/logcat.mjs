#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";

const packageName = "com.revendasmart.app";

function fail(message) {
  console.error(`Logcat bloqueado: ${message}`);
  process.exit(1);
}

function commandExists(command) {
  const result = spawnSync("bash", ["-lc", `command -v ${command}`], { encoding: "utf8" });
  return result.status === 0 && result.stdout.trim().length > 0;
}

if (!commandExists("adb")) fail("adb não está disponível no PATH.");

const pidResult = spawnSync("adb", ["shell", "pidof", "-s", packageName], { encoding: "utf8" });
const pid = pidResult.status === 0 ? pidResult.stdout.trim() : "";

let command;
let args;
if (pid) {
  command = "adb";
  args = ["logcat", "--pid", pid];
  console.log(`Filtrando logcat por PID ${pid} do package ${packageName}.`);
} else {
  command = "bash";
  args = ["-lc", `adb logcat | grep --line-buffered -E '${packageName}|Capacitor|AndroidRuntime|chromium|Console'`];
  console.log(`Package ${packageName} não está em execução; usando filtro textual seguro.`);
}

const child = spawn(command, args, { stdio: "inherit" });
child.on("exit", (code) => process.exit(code ?? 0));
