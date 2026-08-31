import assert from "node:assert/strict";
import {
  resolveMarketingProEssentialContentBounds,
} from "../client/src/lib/marketing-pro-real-background-composer";
import {
  MARKETING_PRO_FORMAT_DIMENSIONS,
  resolveMarketingProProductPlacement,
  type MarketingProRect,
} from "../shared/marketing-pro-contract";

type Case = {
  readonly id: string;
  readonly format: "portrait" | "square";
  readonly creativeFamily: "luxury" | "editorial" | "modern" | "minimal" | "sensory" | "fresh-premium" | "fresh-sport" | "fresh-commercial";
  readonly category: "beauty" | "electronics" | "general";
  readonly productAspectRatio: number;
  readonly orientation: "portrait" | "landscape" | "square";
};

function rectRight(rect: MarketingProRect): number {
  return rect.x + rect.width;
}

function rectBottom(rect: MarketingProRect): number {
  return rect.y + rect.height;
}

function intersects(a: MarketingProRect, b: MarketingProRect, margin = 0): boolean {
  return !(
    rectRight(a) <= b.x + margin
    || rectRight(b) <= a.x + margin
    || rectBottom(a) <= b.y + margin
    || rectBottom(b) <= a.y + margin
  );
}

function insideCanvas(rect: MarketingProRect): boolean {
  return rect.x >= 0 && rect.y >= 0 && rect.width > 0 && rect.height > 0 && rectRight(rect) <= 1 && rectBottom(rect) <= 1;
}

function insideRect(inner: MarketingProRect, outer: MarketingProRect): boolean {
  return inner.x >= outer.x && inner.y >= outer.y && rectRight(inner) <= rectRight(outer) && rectBottom(inner) <= rectBottom(outer);
}

const CASES: readonly Case[] = [
  { id: "beauty-portrait", format: "portrait", creativeFamily: "luxury", category: "beauty", productAspectRatio: 0.52, orientation: "portrait" },
  { id: "beauty-square", format: "square", creativeFamily: "luxury", category: "beauty", productAspectRatio: 0.52, orientation: "portrait" },
  { id: "electronics-portrait", format: "portrait", creativeFamily: "modern", category: "electronics", productAspectRatio: 1.85, orientation: "landscape" },
  { id: "electronics-square", format: "square", creativeFamily: "modern", category: "electronics", productAspectRatio: 1.85, orientation: "landscape" },
  { id: "generic-portrait", format: "portrait", creativeFamily: "fresh-commercial", category: "general", productAspectRatio: 1, orientation: "square" },
  { id: "generic-square", format: "square", creativeFamily: "fresh-commercial", category: "general", productAspectRatio: 1, orientation: "square" },
] as const;

function run(): void {
  const portrait = resolveMarketingProEssentialContentBounds({
    format: "portrait",
    concept: { creativeFamily: "modern" },
    productUnderstanding: { observed: { productOrientation: "landscape" } },
    productAspectRatio: 1.8,
  });
  const square = resolveMarketingProEssentialContentBounds({
    format: "square",
    concept: { creativeFamily: "modern" },
    productUnderstanding: { observed: { productOrientation: "landscape" } },
    productAspectRatio: 1.8,
  });

  assert.deepEqual(portrait.canvas, MARKETING_PRO_FORMAT_DIMENSIONS.portrait, "V1: portrait precisa ser 1080x1350");
  assert.deepEqual(square.canvas, MARKETING_PRO_FORMAT_DIMENSIONS.square, "V2: square precisa ser 1080x1080");

  assert.ok(insideCanvas(portrait.product), "V3: product precisa caber no canvas portrait");
  assert.ok(insideCanvas(square.product), "V4: product precisa caber no canvas square");

  assert.equal(intersects(portrait.product, portrait.price, 0.012), false, "V5: product e price não podem sobrepor no portrait");
  assert.equal(intersects(portrait.product, portrait.logo, 0.012), false, "V6: product e logo não podem sobrepor no portrait");
  assert.equal(intersects(portrait.product, portrait.headline, 0.012), false, "V7: product e headline não podem sobrepor no portrait");
  assert.equal(intersects(portrait.product, portrait.badge, 0.012), false, "V8: product e badge não podem sobrepor no portrait");

  assert.equal(intersects(square.product, square.price, 0.012), false, "V9: product e price não podem sobrepor no square");
  assert.equal(intersects(square.product, square.logo, 0.012), false, "V10: product e logo não podem sobrepor no square");

  for (const rect of [portrait.product, portrait.price, portrait.logo, portrait.headline, portrait.badge]) {
    assert.ok(insideRect(rect, portrait.centralSquareCrop), "V11: todo conteúdo essencial do portrait precisa caber no crop central 1:1");
  }

  assert.ok(portrait.headline.width >= 0.5 && portrait.headline.height >= 0.09, "V12: headline precisa reservar área suficiente para nome longo no portrait");
  assert.ok(square.price.width >= 0.44 && square.price.height >= 0.09, "V13: preço precisa reservar área suficiente para valor grande no square");

  for (const sample of CASES) {
    const bounds = resolveMarketingProEssentialContentBounds({
      format: sample.format,
      concept: { creativeFamily: sample.creativeFamily },
      productUnderstanding: { observed: { productOrientation: sample.orientation } },
      productAspectRatio: sample.productAspectRatio,
    });
    const placement = resolveMarketingProProductPlacement({
      format: sample.format,
      creativeFamily: sample.creativeFamily,
      productUnderstanding: { observed: { productOrientation: sample.orientation } },
      productAspectRatio: sample.productAspectRatio,
    });
    assert.deepEqual(bounds.product, placement.rect, `${sample.id}: product zone precisa vir da mesma fonte canônica do composer`);
    for (const rect of [bounds.product, bounds.price, bounds.logo, bounds.headline, bounds.badge, bounds.storeName]) {
      assert.ok(insideCanvas(rect), `${sample.id}: conteúdo essencial fora do canvas`);
    }
  }

  console.log("ADS-PRO-04 geometry tests passed: V1-V13 + 6 canonical multi-category layout cases (portrait/square, crop-safe, no dangerous overlaps, same canonical product placement source).");
}

run();
