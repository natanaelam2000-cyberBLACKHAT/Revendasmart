import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = readFileSync("client/src/pages/plan-usage.tsx", "utf8");
const snapshotHook = readFileSync("client/src/hooks/usePlanUsageSnapshot.ts", "utf8");

assert.match(snapshotHook, /import \{ usePlan \} from "@\/providers\/PlanProvider";/,
  "PLAN-USAGE-ANDROID-01R: snapshot must reuse the existing PlanProvider");
assert.doesNotMatch(snapshotHook, /usePlanData/,
  "PLAN-USAGE-ANDROID-01R: snapshot must not create a second plan-data request");
assert.equal((page.match(/usePlanUsageSnapshot\(\)/g) ?? []).length, 1,
  "PLAN-USAGE-ANDROID-01R: PlanUsage must load the snapshot once");
assert.match(page, /const \{ activePlan \} = usePlan\(\);/,
  "PLAN-USAGE-ANDROID-01R: the manager view must use the existing plan context");

console.log("PLAN-USAGE-ANDROID-01R PASS: PlanProvider and usage snapshot have one shared plan load; the page mounts one snapshot loader.");
