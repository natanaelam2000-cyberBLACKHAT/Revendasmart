import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const source = fs.readFileSync(path.resolve("client/src/pages/plans.tsx"), "utf8");

assert.match(source, /useState<"unknown" \| "android" \| "web" \| "error">\("unknown"\)/);
assert.match(source, /platformState === "web" && plan !== PLANS\.FREE/);
assert.match(source, /platformState === "unknown" \|\| platformState === "error"/);
assert.match(source, /if \(platformState !== "web"\) \{/);
assert.match(source, /if \(platformState !== "android"\) return;/);
assert.match(source, /setPlatformState\("error"\)/);
assert.match(source, /button-retry-platform-detection/);
assert.doesNotMatch(source, /if \(native\) .*setPlatformState\("web"\)/s);

console.log("ANDROID-BILLING-02A-P0-FIX: delayed, explicit-web, rejection, and handler fail-closed assertions passed");
