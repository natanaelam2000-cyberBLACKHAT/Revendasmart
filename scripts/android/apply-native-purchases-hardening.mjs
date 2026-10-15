import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const file = path.join(root, "node_modules", "@capgo", "native-purchases", "android", "src", "main", "java", "ee", "forgr", "nativepurchases", "NativePurchasesPlugin.java");
const replacements = [
  ['Log.d(TAG, "Purchase details: " + purchase.toString());', 'Log.d(TAG, "Purchase received");'],
  ['Log.i(NativePurchasesPlugin.TAG, "handlePurchase" + purchase);', 'Log.i(NativePurchasesPlugin.TAG, "Purchase received");'],
  ['Log.d(TAG, "Purchase token: " + purchase.getPurchaseToken());', 'Log.d(TAG, "Purchase token received");'],
  ['Log.d(TAG, "Resolving purchase call with transactionId: " + purchase.getPurchaseToken());', 'Log.d(TAG, "Resolving purchase call");'],
  ['Log.d(TAG, "acknowledgePurchase() called with token: " + purchaseToken);', 'Log.d(TAG, "acknowledgePurchase() called");'],
  ['Log.i(NativePurchasesPlugin.TAG, "onAcknowledgePurchaseResponse" + billingResult);', 'Log.i(NativePurchasesPlugin.TAG, "Acknowledge response received");'],
  ['Log.d(TAG, "Consuming purchase with token: " + purchaseToken);', 'Log.d(TAG, "Consuming purchase");'],
  ['Log.d(TAG, "Purchase token: " + purchase.getPurchaseToken());', 'Log.d(TAG, "Purchase token received");'],
  ['Log.i(NativePurchasesPlugin.TAG, "onPurchasesUpdated" + billingResult);', 'Log.i(NativePurchasesPlugin.TAG, "Purchase update response received");'],
  ['Log.i(NativePurchasesPlugin.TAG, "onConsumeResponse OK " + billingResult + purchaseToken);', 'Log.i(NativePurchasesPlugin.TAG, "Purchase consumption response OK");'],
  ['Log.i(NativePurchasesPlugin.TAG, "onConsumeResponse OTHER " + billingResult + purchaseToken);', 'Log.i(NativePurchasesPlugin.TAG, "Purchase consumption response received");'],
  ['Log.d(TAG, "Processing purchase: " + purchase.getOrderId());', 'Log.d(TAG, "Processing purchase");'],
  ['Log.d(TAG, "Processing in-app purchase: " + purchase.getOrderId());', 'Log.d(TAG, "Processing in-app purchase");'],
  ['Log.d(TAG, "Processing subscription purchase: " + purchase.getOrderId());', 'Log.d(TAG, "Processing subscription purchase");'],
  ['Log.d(TAG, "Purchase token: " + purchaseToken);', 'Log.d(TAG, "Purchase consumption requested");'],
  ['Log.d(TAG, "Manually acknowledging purchase with token: " + purchaseToken);', 'Log.d(TAG, "Manually acknowledging purchase");'],
];
let source;
try { source = await readFile(file, "utf8"); } catch (error) {
  if (error.code === "ENOENT") process.exit(0);
  throw error;
}
let next = source;
for (const [from, to] of replacements) next = next.replaceAll(from, to);
if (next !== source) await writeFile(file, next, "utf8");
const forbidden = [/purchase\.toString\s*\(/, /getPurchaseToken\(\)/, /billingResult\s*\)/, /purchaseToken\s*\)/, /getOrderId\(\)/];
const loggingLines = next.split("\n").filter((line) => /\bLog\./.test(line));
if (loggingLines.some((line) => forbidden.some((pattern) => pattern.test(line)))) {
  throw new Error("NativePurchases sensitive logging patch did not fully apply");
}
