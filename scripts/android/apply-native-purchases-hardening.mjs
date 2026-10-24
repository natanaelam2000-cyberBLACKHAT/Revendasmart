#!/usr/bin/env node
/**
 * RS-PAR-C-02 — native-purchases Android log hardening.
 *
 * This deliberately knows only the audited plugin layout. A new plugin version,
 * an absent source file, or unexpected Gradle wiring blocks the build rather than
 * assuming that the native source remains safe.
 */
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PLUGIN_NAME = "@capgo/native-purchases";
export const AUDITED_PLUGIN_VERSION = "8.6.5";
export const PLUGIN_PROJECT_NAME = "capgo-native-purchases";
export const PLUGIN_JAVA_RELATIVE_PATH = path.join(
  "node_modules", "@capgo", "native-purchases", "android", "src", "main", "java", "ee", "forgr", "nativepurchases", "NativePurchasesPlugin.java",
);

const replacements = Object.freeze([
  ['Log.d(TAG, "Purchase details: " + purchase.toString());', 'Log.d(TAG, "Purchase received");'],
  ['Log.i(NativePurchasesPlugin.TAG, "handlePurchase" + purchase);', 'Log.i(NativePurchasesPlugin.TAG, "Purchase received");'],
  ['Log.d(TAG, "Purchase token: " + purchase.getPurchaseToken());', 'Log.d(TAG, "Purchase token received");'],
  ['Log.d(TAG, "Resolving purchase call with transactionId: " + purchase.getPurchaseToken());', 'Log.d(TAG, "Resolving purchase call");'],
  ['Log.d(TAG, "acknowledgePurchase() called with token: " + purchaseToken);', 'Log.d(TAG, "acknowledgePurchase() called");'],
  ['Log.i(NativePurchasesPlugin.TAG, "onAcknowledgePurchaseResponse" + billingResult);', 'Log.i(NativePurchasesPlugin.TAG, "Acknowledge response received");'],
  ['Log.d(TAG, "Consuming purchase with token: " + purchaseToken);', 'Log.d(TAG, "Consuming purchase");'],
  ['Log.d(TAG, "Purchase token: " + purchaseToken);', 'Log.d(TAG, "Purchase token received");'],
  ['Log.i(NativePurchasesPlugin.TAG, "onPurchasesUpdated" + billingResult);', 'Log.i(NativePurchasesPlugin.TAG, "Purchase update response received");'],
  ['Log.i(NativePurchasesPlugin.TAG, "onConsumeResponse OK " + billingResult + purchaseToken);', 'Log.i(NativePurchasesPlugin.TAG, "Purchase consumption response OK");'],
  ['Log.i(NativePurchasesPlugin.TAG, "onConsumeResponse OTHER " + billingResult + purchaseToken);', 'Log.i(NativePurchasesPlugin.TAG, "Purchase consumption response received");'],
  ['Log.d(TAG, "Processing purchase: " + purchase.getOrderId());', 'Log.d(TAG, "Processing purchase");'],
  ['Log.d(TAG, "Processing in-app purchase: " + purchase.getOrderId());', 'Log.d(TAG, "Processing in-app purchase");'],
  ['Log.d(TAG, "Processing subscription purchase: " + purchase.getOrderId());', 'Log.d(TAG, "Processing subscription purchase");'],
  ['Log.d(TAG, "Manually acknowledging purchase with token: " + purchaseToken);', 'Log.d(TAG, "Manually acknowledging purchase");'],
]);

function fail(message) {
  throw new Error(`NativePurchases Android hardening blocked: ${message}`);
}

function rootFromEnvironment() {
  const requested = String(process.env.NATIVE_PURCHASES_HARDENING_ROOT || "").trim();
  return requested ? path.resolve(requested) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
}

async function readRequired(file, description) {
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") fail(`${description} is missing (${path.relative(rootFromEnvironment(), file)})`);
    throw error;
  }
}

function lineNumber(source, offset) {
  return source.slice(0, offset).split("\n").length;
}

function withoutJavaLiterals(value) {
  return value.replace(/"(?:\\.|[^"\\])*"/gs, "\"\"").replace(/'(?:\\.|[^'\\])*'/gs, "''");
}

function logCalls(source) {
  const calls = [];
  const pattern = /Log\s*\.\s*[divew]\s*\([\s\S]*?\);/g;
  for (const match of source.matchAll(pattern)) calls.push({ text: match[0], index: match.index ?? 0 });
  return calls;
}

export function findSensitiveNativePurchaseLogs(source) {
  const violations = [];
  for (const call of logCalls(source)) {
    const expression = withoutJavaLiterals(call.text);
    const rules = [];
    for (const reference of expression.matchAll(/\bpurchase\b(?:\s*\.\s*([A-Za-z][A-Za-z0-9_]*))?/g)) {
      const member = reference[1];
      if (!member || !["getPurchaseState", "isAcknowledged"].includes(member)) rules.push("purchase-object-or-identifier");
    }
    if (/\b(?:purchaseToken|transactionId|orderId)\b/.test(expression)) rules.push("purchase-token-or-id");
    if (/\+\s*billingResult\b(?!\s*\.)/.test(expression)) rules.push("billing-result-object");
    if (rules.length) violations.push({ line: lineNumber(source, call.index), rules: [...new Set(rules)] });
  }
  return violations;
}

async function assertAuditedPlugin(root) {
  const packageFile = path.join(root, "node_modules", "@capgo", "native-purchases", "package.json");
  const packageSource = await readRequired(packageFile, `${PLUGIN_NAME} package metadata`);
  let metadata;
  try { metadata = JSON.parse(packageSource); } catch { fail(`${PLUGIN_NAME} package metadata is not valid JSON`); }
  if (metadata.name !== PLUGIN_NAME || metadata.version !== AUDITED_PLUGIN_VERSION) {
    fail(`expected ${PLUGIN_NAME}@${AUDITED_PLUGIN_VERSION}; found ${metadata.name || "unknown"}@${metadata.version || "unknown"}`);
  }
}

async function resolveGradleNativeSource(root) {
  const settingsFile = path.join(root, "android", "capacitor.settings.gradle");
  const appBuildFile = path.join(root, "android", "app", "capacitor.build.gradle");
  const settings = await readRequired(settingsFile, "Capacitor Gradle settings");
  const appBuild = await readRequired(appBuildFile, "Capacitor app dependency declarations");
  const settingsPattern = new RegExp(String.raw`project\s*\(\s*['\"]:${PLUGIN_PROJECT_NAME}['\"]\s*\)\.projectDir\s*=\s*new\s+File\s*\(\s*['\"]\.\./node_modules/@capgo/native-purchases/android['\"]\s*\)`);
  if (!settingsPattern.test(settings)) fail(`Gradle does not map :${PLUGIN_PROJECT_NAME} to the audited plugin source`);
  const dependencyPattern = new RegExp(String.raw`implementation\s+project\s*\(\s*['\"]:${PLUGIN_PROJECT_NAME}['\"]\s*\)`);
  if (!dependencyPattern.test(appBuild)) fail(`app Gradle configuration does not depend on :${PLUGIN_PROJECT_NAME}`);
  const sourceFile = path.join(root, PLUGIN_JAVA_RELATIVE_PATH);
  if (!existsSync(sourceFile)) fail(`expected native source is missing (${path.relative(root, sourceFile)})`);
  return sourceFile;
}

export async function verifyNativePurchasesHardening({ root = rootFromEnvironment() } = {}) {
  await assertAuditedPlugin(root);
  const sourceFile = await resolveGradleNativeSource(root);
  const source = await readRequired(sourceFile, "audited NativePurchases Java source");
  const violations = findSensitiveNativePurchaseLogs(source);
  if (violations.length) {
    const detail = violations.map(({ line, rules }) => `line ${line}: ${rules.join(",")}`).join("; ");
    fail(`sensitive log patterns remain in the Gradle input (${detail})`);
  }
  return { sourceFile, changed: false };
}

export async function applyNativePurchasesHardening({ root = rootFromEnvironment() } = {}) {
  await assertAuditedPlugin(root);
  const sourceFile = await resolveGradleNativeSource(root);
  const source = await readRequired(sourceFile, "audited NativePurchases Java source");
  let hardened = source;
  for (const [from, to] of replacements) hardened = hardened.replaceAll(from, to);
  if (hardened !== source) await writeFile(sourceFile, hardened, "utf8");
  await verifyNativePurchasesHardening({ root });
  return { sourceFile, changed: hardened !== source };
}

async function main() {
  const mode = process.argv[2] || "apply";
  if (mode !== "apply" && mode !== "verify") fail(`unsupported mode ${JSON.stringify(mode)}`);
  const result = mode === "apply" ? await applyNativePurchasesHardening() : await verifyNativePurchasesHardening();
  console.log(`NativePurchases Android hardening ${mode === "apply" ? (result.changed ? "applied" : "already present") : "verified"}: ${path.relative(rootFromEnvironment(), result.sourceFile)}`);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replaceAll("\\", "/")}`).href) {
  main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
}
