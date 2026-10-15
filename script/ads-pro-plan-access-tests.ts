import assert from "node:assert/strict";
import { canAccessAdsPro, PLANS } from "../shared/monetization";

assert.equal(canAccessAdsPro(PLANS.FREE), false, "ADS_PRO_FREE_DENIED");
assert.equal(canAccessAdsPro(PLANS.PRO), true, "ADS_PRO_PLAN2_ALLOWED");
assert.equal(canAccessAdsPro(PLANS.PREMIUM), true, "ADS_PRO_PLAN3_ALLOWED");
assert.equal(canAccessAdsPro(PLANS.FREE, true), true, "ADS_PRO_ADMIN_ALLOWED");
assert.equal(canAccessAdsPro(PLANS.FREE), false, "ADS_PRO_FREE_API_DENIED");
assert.equal(canAccessAdsPro(PLANS.FREE, false, "play_review"), true, "ADS_PRO_PLAY_REVIEW_ALLOWED");
assert.equal(canAccessAdsPro(PLANS.PRO), true, "ADS_PRO_PLAN2_API_ALLOWED");
assert.equal(canAccessAdsPro(PLANS.PREMIUM), true, "ADS_PRO_PLAN3_API_ALLOWED");
assert.equal(canAccessAdsPro(PLANS.FREE, false), false, "ADS_PRO_FREE_CANNOT_SPOOF_PRO");
assert.equal(canAccessAdsPro(PLANS.FREE, false), false, "ADS_PRO_NON_ADMIN_CANNOT_SPOOF_ADMIN");

console.log("ADS-PRO plan access tests passed");
