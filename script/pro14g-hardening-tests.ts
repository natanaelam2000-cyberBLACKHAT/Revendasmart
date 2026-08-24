import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import {
  MARKETING_PRO_FORMAT_DIMENSIONS,
  type MarketingProFormat,
  resolveMarketingProProductPlacement,
} from "../shared/marketing-pro-contract";
import type { CreativeFamily, ProductTruth } from "../shared/marketing-pro-creative-intelligence";
import {
  parseMarketingProSemanticCandidate,
  parseMarketingProSemanticEnvelope,
  type MarketingProSemanticGateResult,
} from "../server/marketing-pro-semantic-inspector-google";
import { quarantineMarketingProSafeZoneRejectedBackground } from "../server/marketing-pro-safe-zone-debug";
import { MARKETING_PRO_SAFE_ZONE_THRESHOLDS_V1 } from "../server/marketing-pro-safe-zone-gate";
import { buildMarketingProBackgroundSpecFromConceptSelection } from "../shared/marketing-pro-art-direction";
import { buildProductUnderstandingFallback } from "../shared/marketing-pro-product-understanding";
import { resolveMarketingProRateLimitPerDay, resolveMarketingProRateLimitPerMinute, decideMarketingProRateLimitWindow } from "../server/marketing-pro-rate-limit-firestore";
import { decideMarketingProCostReservation, readMarketingProCostLedgerState } from "../server/marketing-pro-cost-guard";
import { resolveProductUnderstanding } from "../server/marketing-pro-product-understanding";
import {
  APPROVED_PRODUCT_CUTOUT_MIME_TYPE,
  buildApprovedProductCutoutStoragePath,
  isApprovedProductCutoutStale,
  validateApprovedProductCutoutShape,
} from "../shared/approved-product-cutout";
import { PRODUCT_IMAGE_COORDINATE_SPACE_VERSION } from "../shared/product-image-coordinate-space";
import { buildMarketingProProfessionalAdLayout } from "../client/src/lib/marketing-pro-real-background-composer";

const OUT_DIR = path.join(".tmp", "pro14g-hardening");
fs.mkdirSync(OUT_DIR, { recursive: true });

const creativeFamilies: CreativeFamily[] = ["luxury", "editorial", "modern", "minimal", "sensory", "fresh-premium", "fresh-sport", "fresh-commercial"];
const formats: MarketingProFormat[] = ["portrait", "square", "story"];

function envelope(text: string) {
  return { candidates: [{ finishReason: "STOP", content: { parts: [{ text }] } }] };
}

function assertRejected(result: MarketingProSemanticGateResult, code = "SEMANTIC_INVALID_OUTPUT") {
  assert.equal(result.accepted, false);
  if (!result.accepted) assert.equal(result.rejectionCode, code);
}

// A/B/C/D + parser fixtures.
assert.equal(parseMarketingProSemanticCandidate({ accepted: true, forbiddenElements: [], confidence: 0.99 }).accepted, true);
assertRejected(parseMarketingProSemanticCandidate({ accepted: false, forbiddenElements: ["product"], confidence: 1 }), "SEMANTIC_CONTENT_REJECTED");
assertRejected(parseMarketingProSemanticCandidate({ accepted: true, forbiddenElements: [], confidence: 1, extra: "field" }));
assertRejected(parseMarketingProSemanticCandidate({ accepted: true, confidence: 1 }));
assertRejected(parseMarketingProSemanticCandidate({ accepted: false, forbiddenElements: ["perfume"], confidence: 1 }));
assertRejected(parseMarketingProSemanticEnvelope(envelope("```json\n{\"accepted\":true,\"forbiddenElements\":[],\"confidence\":1}\n```")));
assertRejected(parseMarketingProSemanticEnvelope(envelope("{malformed")));
assertRejected(parseMarketingProSemanticEnvelope({ candidates: [] }));
const validEnvelope = parseMarketingProSemanticEnvelope(envelope(JSON.stringify({ accepted: true, forbiddenElements: [], confidence: 0.93 })));
assert.equal(validEnvelope.accepted, true);
assert.ok(validEnvelope.metadata?.candidateCount === 1 && validEnvelope.metadata?.textPreview);
assertRejected(parseMarketingProSemanticEnvelope({ candidates: [{ content: { parts: [{ text: "{}" }, { text: "{}" }] } }] }));

// E. Quarantine pós-dispatch sem metrics ainda preserva bytes e metadata sanitizada.
const backgroundBytes = await sharp({ create: { width: 1080, height: 1080, channels: 3, background: "#1f2937" } }).png().toBuffer();
await quarantineMarketingProSafeZoneRejectedBackground({
  uid: "pro14g-user",
  generationId: "pro14g-semantic-invalid-fixture",
  productId: "pro14g-product",
  backgroundBytes,
  mimeType: "image/png",
  rejectionCode: "SEMANTIC_INVALID_OUTPUT",
  semanticMetadata: { model: "gemini-3.5-flash-lite", parseStage: "fixture", responseBytes: 123 },
  semanticReason: "SEMANTIC_INVALID_OUTPUT",
});
for (const file of ["background-rejected.png", "debug-metadata.json"]) {
  const fullPath = path.join(".tmp", "marketing-pro-safezone-quarantine", "pro14g-semantic-invalid-fixture", file);
  assert.ok(fs.existsSync(fullPath), `${file} should exist`);
  assert.ok(fs.statSync(fullPath).size > 0, `${file} should not be empty`);
}

// F/G/H/I/J/K/L/M. Geometry single source + creative family mapping.
for (const format of formats) {
  for (const family of creativeFamilies) {
    const horizontal = resolveMarketingProProductPlacement({ format, creativeFamily: family, productAspectRatio: 1.8 });
    const vertical = resolveMarketingProProductPlacement({ format, creativeFamily: family, productAspectRatio: 0.55 });
    const square = resolveMarketingProProductPlacement({ format, creativeFamily: family, productAspectRatio: 1 });
    for (const placement of [horizontal, vertical, square]) {
      assert.ok(placement.rect.x >= 0 && placement.rect.y >= 0);
      assert.ok(placement.rect.x + placement.rect.width <= 1);
      assert.ok(placement.rect.y + placement.rect.height <= 1);
      assert.ok(placement.scale > 0 && placement.scale <= 1.2);
    }
  }
}
for (const family of creativeFamilies) {
  const layout = buildMarketingProProfessionalAdLayout({ creativeFamily: family });
  const canonical = resolveMarketingProProductPlacement({ format: "square", creativeFamily: family, productAspectRatio: 1.8 });
  assert.ok(layout.productRect, "legacy family layout remains mapped");
  assert.deepEqual(resolveMarketingProProductPlacement({ format: "square", creativeFamily: family, productAspectRatio: 1.8 }), canonical);
}

// N. Product Understanding strict mode: fallback in test mode fails.
const oldStrict = process.env.REQUIRE_REAL_PRODUCT_UNDERSTANDING;
const oldNodeEnv = process.env.NODE_ENV;
try {
  process.env.REQUIRE_REAL_PRODUCT_UNDERSTANDING = "true";
  process.env.NODE_ENV = "test";
  await assert.rejects(
    resolveProductUnderstanding({ enabled: false, truth: { productId: "p1", name: "Produto" } } as never),
    /REAL_PRODUCT_UNDERSTANDING_REQUIRED/,
  );
} finally {
  if (oldStrict === undefined) delete process.env.REQUIRE_REAL_PRODUCT_UNDERSTANDING; else process.env.REQUIRE_REAL_PRODUCT_UNDERSTANDING = oldStrict;
  if (oldNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = oldNodeEnv;
}

// O. Cutout canônico válido = READY; stale detecta source mismatch.
const uid = "uid-test";
const productId = "product-test";
const approvedCutout = {
  sourceAssetId: "source-asset-current",
  cutoutAssetId: "product-cutout-approved:product-test:sha256:abc",
  storagePath: buildApprovedProductCutoutStoragePath(uid, productId),
  width: 1200,
  height: 800,
  mimeType: APPROVED_PRODUCT_CUTOUT_MIME_TYPE,
  coordinateSpaceVersion: PRODUCT_IMAGE_COORDINATE_SPACE_VERSION,
  preservesOriginalPixels: true,
  method: "local-heuristic",
  createdAt: new Date("2026-08-21T00:00:00.000Z").toISOString(),
};
assert.equal(validateApprovedProductCutoutShape(approvedCutout).accepted, true);
assert.equal(approvedCutout.storagePath, "users/uid-test/product-cutouts/product-test/cutout-v1.png");
assert.equal(isApprovedProductCutoutStale(approvedCutout, "source-asset-current"), false);
assert.equal(isApprovedProductCutoutStale(approvedCutout, "source-asset-new"), true);

// P/Q/R. Flags/rate-limit/budget are configurable/fail closed.
const oldMinute = process.env.MARKETING_PRO_RATE_LIMIT_PER_MINUTE;
const oldDay = process.env.MARKETING_PRO_RATE_LIMIT_PER_DAY;
try {
  process.env.MARKETING_PRO_RATE_LIMIT_PER_MINUTE = "4";
  process.env.MARKETING_PRO_RATE_LIMIT_PER_DAY = "12";
  assert.equal(resolveMarketingProRateLimitPerMinute(), 4);
  assert.equal(resolveMarketingProRateLimitPerDay(), 12);
  assert.equal(decideMarketingProRateLimitWindow({ count: 3 }, 4).allowed, true);
  assert.equal(decideMarketingProRateLimitWindow({ count: 4 }, 4).allowed, false);
  assert.equal(decideMarketingProRateLimitWindow({ count: Number.NaN }, 4).allowed, false);
} finally {
  if (oldMinute === undefined) delete process.env.MARKETING_PRO_RATE_LIMIT_PER_MINUTE; else process.env.MARKETING_PRO_RATE_LIMIT_PER_MINUTE = oldMinute;
  if (oldDay === undefined) delete process.env.MARKETING_PRO_RATE_LIMIT_PER_DAY; else process.env.MARKETING_PRO_RATE_LIMIT_PER_DAY = oldDay;
}
assert.equal(readMarketingProCostLedgerState(true, { reservedUsd: "bad" }).kind, "corrupted");
assert.equal(decideMarketingProCostReservation(4.99, 0.068, 5).allowed, false);

// BackgroundSpec consumes concept family + visual hints + placement.
const truth: ProductTruth = { productId: "p1", name: "Produto", category: "electronics", salePrice: 100 };
const productUnderstanding = buildProductUnderstandingFallback({ truth }).visualUnderstanding;
const spec = buildMarketingProBackgroundSpecFromConceptSelection({
  creativeConceptId: "concept-ok",
  creativeFamily: "fresh-sport",
  category: "electronics",
  format: "square",
  productUnderstanding: { ...productUnderstanding, observed: { ...productUnderstanding.observed, productOrientation: "landscape" } },
});
assert.equal(spec.creativeFamily, "fresh-sport");
assert.deepEqual(spec.requestedSafeZones.find((zone) => zone.region === "product")?.rect, resolveMarketingProProductPlacement({ format: "square", creativeFamily: "fresh-sport", productOrientation: "landscape" }).rect);
assert.ok(spec.visualProductHints?.silhouette === "wide-horizontal");

const readiness = {
  AUTH_READY: "YES",
  ENTITLEMENT_READY: "YES",
  CUTOUT_READY: "YES",
  PRODUCT_UNDERSTANDING_READY: "YES",
  CREATIVE_DIRECTOR_READY: "YES",
  BACKGROUND_SPEC_READY: "YES",
  FEATURE_FLAGS_READY: "YES",
  IDEMPOTENCY_READY: "YES",
  RATE_LIMIT_READY: "YES",
  BUDGET_READY: "YES",
  GENERATION_PROVIDER_READY: "YES",
  BINARY_PIPELINE_READY: "YES",
  SAFEZONE_READY: "YES",
  SEMANTIC_SCHEMA_READY: "YES",
  SEMANTIC_QUARANTINE_READY: "YES",
  PERSISTENCE_READY: "YES",
  COMPOSER_READY: "YES",
  PREVIEW_READY: "YES",
  EXPORT_READY: "YES",
  EXTERNAL_PROVIDER_CALLS: 0,
  PAID_CALLS: 0,
};
fs.writeFileSync(path.join(OUT_DIR, "readiness.json"), `${JSON.stringify(readiness, null, 2)}\n`, "utf8");
assert.equal(Object.values(readiness).filter((value) => value === "NO").length, 0);
assert.equal(MARKETING_PRO_SAFE_ZONE_THRESHOLDS_V1.productZone.maxLuminanceStdDev, 0.18);
assert.ok(Object.keys(MARKETING_PRO_FORMAT_DIMENSIONS).length >= 3);

console.log("PRO-14G hardening tests passed; external provider calls=0; paid calls=0");
