#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const config = path.join(root, ".gitleaks.toml");

function run(command, args, options = {}) {
  return spawnSync(command, args, { cwd: root, encoding: "utf8", stdio: options.stdio || "pipe" });
}

function hasCommand(command) {
  const probe = run(command, ["version"]);
  return !probe.error && probe.status === 0;
}

if (hasCommand("gitleaks")) {
  const result = run("gitleaks", ["detect", "--source", root, "--config", config, "--redact", "--no-banner"], { stdio: "inherit" });
  process.exit(result.status ?? 1);
}

console.warn("Gitleaks binary não encontrado; executando guardrail local de segredos sem imprimir valores. CI usa gitleaks-action oficial.");
const tracked = run("git", ["ls-files", "--cached", "--others", "--exclude-standard"]);
if (tracked.status !== 0) {
  console.error("Não foi possível listar arquivos do git para secret scan local.");
  process.exit(1);
}

const excluded = ["node_modules/", "dist/", "android/app/build/", "android/.gradle/", "android/app/src/main/assets/public/", ".vercel/", ".gitleaks.toml", "scripts/security/run-gitleaks.mjs", "scripts/security/validate-agent-skills.mjs", "script/smoke-tests.ts", "CLOUD_RUN_MIGRATION.md"];
const rules = [
  { id: "mercado-pago-token", regex: /\b(?:APP_USR|TEST)-[A-Za-z0-9_-]{20,}\b/ },
  { id: "private-key", regex: /-----BEGIN (?:RSA |EC |OPENSSH |)?PRIVATE KEY-----/ },
  { id: "android-keystore-password", regex: /\b(?:storePassword|keyPassword)\s*[=:]\s*['"]?[A-Za-z0-9_@%+=:,./-]{8,}/i },
  { id: "vercel-token", regex: /\bvercel_[A-Za-z0-9]{20,}\b/ },
  { id: "gcp-service-account-json-key", regex: /"private_key"\s*:\s*"-----BEGIN PRIVATE KEY-----/ },
];
const findings = [];
for (const relative of tracked.stdout.split(/\r?\n/).filter(Boolean)) {
  if (excluded.some((prefix) => relative.startsWith(prefix))) continue;
  const file = path.join(root, relative);
  let stat;
  try { stat = fs.statSync(file); } catch { continue; }
  if (!stat.isFile() || stat.size > 1_500_000) continue;
  let text;
  try { text = fs.readFileSync(file, "utf8"); } catch { continue; }
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    for (const rule of rules) if (rule.regex.test(lines[index])) findings.push({ file: relative, line: index + 1, rule: rule.id });
  }
}
if (findings.length) {
  console.error(`Possíveis segredos encontrados: ${findings.length}`);
  for (const finding of findings) console.error(`${finding.file}:${finding.line} ${finding.rule} [redacted]`);
  process.exit(1);
}
console.log("Secret scan local não encontrou padrões sensíveis nos arquivos versionados/não ignorados.");
