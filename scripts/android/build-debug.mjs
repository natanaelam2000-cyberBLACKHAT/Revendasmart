#!/usr/bin/env node
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { DEBUG_APK_RELATIVE_PATH, DEBUG_PROVENANCE_RELATIVE_PATH } from "./build-provenance.mjs";

const apkPath = DEBUG_APK_RELATIVE_PATH;
const isWindows = process.platform === "win32";

function formatCommand(command, args) {
  return [command, ...args].join(" ");
}

function runCommand(command, args, options = {}) {
  console.log(`$ ${formatCommand(command, args)}`);
  return new Promise((resolveCommand, rejectCommand) => {
    let child;
    try {
      child = spawn(command, args, {
        cwd: options.cwd,
        env: options.env || process.env,
        stdio: "inherit",
        shell: false,
        windowsHide: isWindows,
      });
    } catch (error) {
      rejectCommand(new Error(`não foi possível iniciar ${formatCommand(command, args)}: ${error instanceof Error ? error.message : String(error)}`));
      return;
    }

    child.once("error", (error) => {
      rejectCommand(new Error(`não foi possível iniciar ${formatCommand(command, args)}: ${error.message}`));
    });
    child.once("close", (code, signal) => {
      if (code === 0) {
        resolveCommand();
        return;
      }
      const outcome = code === null ? `sem exit code${signal ? ` (sinal ${signal})` : ""}` : `exit code ${code}`;
      rejectCommand(new Error(`${formatCommand(command, args)} terminou com ${outcome}`));
    });
  });
}

function capture(command, args, options = {}) {
  return spawnSync(command, args, { encoding: "utf8", shell: false, ...options });
}

function fail(message) {
  throw new Error(message);
}

function firstLine(value) {
  return String(value || "").split(/\r?\n/).map((line) => line.trim()).find(Boolean) || "versão não informada";
}

function commandPathFromPath(command) {
  const result = isWindows
    ? capture("where.exe", [command])
    : capture("sh", ["-c", "command -v \"$1\"", "sh", command]);
  if (result.status !== 0) return "";
  return firstLine(result.stdout);
}

function resolveNpmInvocation() {
  const nodeDirectory = dirname(process.execPath);
  const npmCliCandidates = [
    process.env.npm_execpath || "",
    join(nodeDirectory, "node_modules", "npm", "bin", "npm-cli.js"),
    resolve(nodeDirectory, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
  ].filter(Boolean);

  for (const npmCliPath of [...new Set(npmCliCandidates)]) {
    if (existsSync(npmCliPath)) {
      return { command: process.execPath, args: [npmCliPath] };
    }
  }

  if (!isWindows) {
    const npmCommand = commandPathFromPath("npm");
    if (npmCommand) return { command: npmCommand, args: [] };
  }

  fail("npm-cli.js não foi localizado. Execute este comando por npm run android:build:debug ou reinstale o Node.js com npm.");
}

function javaHomeCandidate(command) {
  const javaHome = process.env.JAVA_HOME || "";
  if (!javaHome) return "";
  const executable = isWindows ? `${command}.exe` : command;
  return join(javaHome, "bin", executable);
}

function verifyJavaTool(command) {
  const candidates = [javaHomeCandidate(command), commandPathFromPath(command), command].filter(Boolean);
  const uniqueCandidates = [...new Set(candidates)];
  const failures = [];

  for (const candidate of uniqueCandidates) {
    if (candidate.includes("bin") && !existsSync(candidate)) {
      failures.push(`${candidate}: não encontrado`);
      continue;
    }
    const result = capture(candidate, ["-version"]);
    if (result.status === 0) {
      return { command: candidate, version: firstLine(`${result.stdout}\n${result.stderr}`) };
    }
    if (result.error?.code !== "ENOENT") {
      failures.push(`${candidate}: ${firstLine(`${result.stderr}\n${result.stdout}`)}`);
    }
  }

  const hint = command === "javac"
    ? "Confirme que JAVA_HOME aponta para um JDK completo, não para um JRE."
    : "Configure JAVA_HOME ou inclua o JDK no PATH.";
  fail(`${command} não foi encontrado ou não executou corretamente. ${hint}${failures.length ? ` Detalhes: ${failures.join("; ")}` : ""}`);
}

function availableSpaceKb() {
  if (!isWindows) {
    try {
      const output = execFileSync("df", ["--output=avail", "-k", "."], { encoding: "utf8" }).trim().split(/\s+/).pop();
      return Number(output || 0);
    } catch {
      return 0;
    }
  }

  try {
    const drive = resolve(".").slice(0, 2).replace(":", "");
    if (!drive) return 0;
    const output = execFileSync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", `$d=Get-PSDrive -Name '${drive}' -ErrorAction Stop; [math]::Floor($d.Free / 1KB)`],
      { encoding: "utf8" },
    ).trim();
    return Number(output || 0);
  } catch {
    return 0;
  }
}

async function main() {
  const sdkRoot = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || "";
  if (!sdkRoot) fail("ANDROID_HOME ou ANDROID_SDK_ROOT não está configurado.");
  if (!existsSync(sdkRoot)) fail(`SDK Android não encontrado em ${sdkRoot}.`);

  const java = verifyJavaTool("java");
  const javac = verifyJavaTool("javac");
  console.log(`Java detectado: ${java.version}`);
  console.log(`Javac detectado: ${javac.version}`);

  const gradleWrapper = isWindows ? "android/gradlew.bat" : "android/gradlew";
  if (!existsSync(gradleWrapper)) fail(`${gradleWrapper} não encontrado. Execute a fundação Capacitor antes.`);
  if (existsSync("android/local.properties")) {
    console.log("android/local.properties detectado localmente; confirme que ele permanece ignorado pelo Git.");
  }

  const availableKb = availableSpaceKb();
  if (availableKb > 0 && availableKb < 1048576) {
    fail("menos de 1 GB livre no filesystem do projeto; não vou arriscar ENOSPC.");
  }

  const buildStartedAt = new Date().toISOString();
  rmSync(apkPath, { force: true });
  rmSync(DEBUG_PROVENANCE_RELATIVE_PATH, { force: true });

  const npmInvocation = resolveNpmInvocation();
  await runCommand(npmInvocation.command, [...npmInvocation.args, "run", "android:sync"], {
    env: { ...process.env, ANDROID_BUILD_STARTED_AT: buildStartedAt },
  });
  console.log("Sincronização Android concluída; iniciando o Gradle.");

  // Nota: no Windows, `cmd.exe /c gradlew.bat` (sem `.\` explícito) falha neste tipo de ambiente quando
  // NoDefaultCurrentDirectoryInExePath=1 está setado (cmd não procura o executável no cwd) — usar o
  // caminho relativo explícito evita depender dessa configuração da máquina (mesmo fix já aplicado em
  // build-release.mjs; RELEASE-CANDIDATE-01 encontrou o mesmo bug aqui, nunca replicado).
  const gradleCommand = isWindows ? "cmd.exe" : "./gradlew";
  const gradleArgs = isWindows
    ? ["/d", "/s", "/c", ".\\gradlew.bat", "clean", "assembleDebug", "--stacktrace", "--no-daemon"]
    : ["clean", "assembleDebug", "--stacktrace", "--no-daemon"];
  await runCommand(gradleCommand, gradleArgs, { cwd: "android" });

  if (!existsSync(apkPath)) fail(`Gradle terminou sem criar o APK debug em ${apkPath}.`);
  console.log(`APK debug criado em ${apkPath}; iniciando a verificação de proveniência.`);
  await runCommand(process.execPath, ["scripts/android/verify-debug-apk.mjs", "--build-start", buildStartedAt]);
  console.log("Pipeline Android debug concluído com APK verificado.");
}

main().catch((error) => {
  console.error(`Android debug build bloqueado: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
