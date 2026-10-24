#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { applyNativePurchasesHardening, verifyNativePurchasesHardening } from "./apply-native-purchases-hardening.mjs";

const safeLog = 'Log.d(TAG, "Purchase state: " + purchase.getPurchaseState());';
const unsafeLogs = [
  'Log.d(TAG, "Purchase details: " + purchase.toString());',
  'Log.d(TAG, "Purchase token: " + purchase.getPurchaseToken());',
  'Log.d(TAG, "Processing purchase: " + purchase.getOrderId());',
  'Log.i(NativePurchasesPlugin.TAG, "onConsumeResponse OK " + billingResult + purchaseToken);',
  'Log.d(TAG, "Manually acknowledging purchase with token: " + purchaseToken);',
  safeLog,
].join("\n");

function javaSource(logs = unsafeLogs) {
  return `class NativePurchasesPlugin {\nvoid run(Purchase purchase, String purchaseToken, BillingResult billingResult) {\n${logs}\nret.put("transactionId", purchase.getPurchaseToken());\nparams.setPurchaseToken(purchaseToken);\n}\n}`;
}

async function fixture({ version = "8.6.5", source = javaSource(), includeSource = true } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "rs-par-c-02-"));
  const plugin = path.join(root, "node_modules", "@capgo", "native-purchases");
  const java = path.join(plugin, "android", "src", "main", "java", "ee", "forgr", "nativepurchases", "NativePurchasesPlugin.java");
  await mkdir(path.dirname(java), { recursive: true });
  await mkdir(path.join(root, "android", "app"), { recursive: true });
  await writeFile(path.join(plugin, "package.json"), JSON.stringify({ name: "@capgo/native-purchases", version }), "utf8");
  await writeFile(path.join(root, "android", "capacitor.settings.gradle"), "include ':capgo-native-purchases'\nproject(':capgo-native-purchases').projectDir = new File('../node_modules/@capgo/native-purchases/android')\n", "utf8");
  await writeFile(path.join(root, "android", "app", "capacitor.build.gradle"), "dependencies { implementation project(':capgo-native-purchases') }\n", "utf8");
  if (includeSource) await writeFile(java, source, "utf8");
  return { root, java };
}

async function rejects(action, expected) {
  await assert.rejects(action, new RegExp(expected));
}

async function run() {
  const created = [];
  try {
    const positive = await fixture(); created.push(positive.root);
    await rejects(() => verifyNativePurchasesHardening({ root: positive.root }), "sensitive log patterns remain");
    const first = await applyNativePurchasesHardening({ root: positive.root });
    assert.equal(first.changed, true, "unsafe fixture must be changed");
    const hardened = await readFile(positive.java, "utf8");
    assert.match(hardened, /Purchase received/);
    assert.match(hardened, /Purchase state/);
    assert.match(hardened, /ret\.put\("transactionId", purchase\.getPurchaseToken\(\)\)/, "billing contract must remain outside Log calls");
    assert.match(hardened, /setPurchaseToken\(purchaseToken\)/, "billing action must remain outside Log calls");
    const second = await applyNativePurchasesHardening({ root: positive.root });
    assert.equal(second.changed, false, "second application must be idempotent");
    assert.equal(await readFile(positive.java, "utf8"), hardened, "idempotence must not rewrite safe source");

    const unexpected = await fixture({ source: javaSource('Log.e(TAG, "error " + purchaseToken);') }); created.push(unexpected.root);
    await rejects(() => verifyNativePurchasesHardening({ root: unexpected.root }), "purchase-token-or-id");

    const indirect = await fixture({ source: javaSource('Log.d(TAG, String.valueOf(purchase));') }); created.push(indirect.root);
    await rejects(() => verifyNativePurchasesHardening({ root: indirect.root }), "purchase-object-or-identifier");

    const formatted = await fixture({ source: javaSource('Log.d( TAG,\n "token" + purchase . getPurchaseToken ( )\n);') }); created.push(formatted.root);
    await rejects(() => verifyNativePurchasesHardening({ root: formatted.root }), "purchase-object-or-identifier");

    const unknown = await fixture({ version: "9.0.0", source: javaSource(safeLog) }); created.push(unknown.root);
    await rejects(() => verifyNativePurchasesHardening({ root: unknown.root }), "expected @capgo/native-purchases@8\\.6\\.5");

    const missing = await fixture({ includeSource: false }); created.push(missing.root);
    await rejects(() => verifyNativePurchasesHardening({ root: missing.root }), "expected native source is missing");

    const clean = await fixture({ source: javaSource(safeLog) }); created.push(clean.root);
    await verifyNativePurchasesHardening({ root: clean.root });
    console.log("native-purchases hardening tests: PASS");
  } finally {
    await Promise.all(created.map((directory) => rm(directory, { recursive: true, force: true })));
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
