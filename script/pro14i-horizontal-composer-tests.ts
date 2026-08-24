/** PRO-14I — horizontal composer + contrast-aware hero zone. Local only; zero provider calls. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import {
  MARKETING_PRO_TEXT_ZONE,
  resolveMarketingProProductPlacement,
} from "../shared/marketing-pro-contract";
import { buildMarketingProBackgroundSpecFromConceptSelection } from "../shared/marketing-pro-art-direction";
import { buildMarketingProBackgroundPrompt } from "../server/marketing-pro-provider-google";
import {
  MARKETING_PRO_SAFE_ZONE_THRESHOLDS_V1,
  computeMarketingProHeroContrastSuitability,
  decodePngToLuminance,
} from "../server/marketing-pro-safe-zone-gate";
import type { ProductVisualUnderstanding } from "../shared/marketing-pro-creative-intelligence";

const repoRoot = process.cwd();
const outputsDir = "C:/Users/natan/Documents/Codex/2026-08-20/files-pasted-by-the-user-pro/outputs";
const rejectedBackgroundPath = path.join(outputsDir, "pro14h-jbl-background-rejected.png");
const fallbackRejectedBackgroundPath = path.join(repoRoot, ".tmp", "marketing-pro-safezone-quarantine", "pro14h-d2913f89-b98e-43ff-a376-ea729c46689c", "background-rejected.png");
const cutoutPath = path.join(repoRoot, ".tmp", "pro14h", "jbl-cutout.png");
const backgroundPath = fs.existsSync(rejectedBackgroundPath) ? rejectedBackgroundPath : fallbackRejectedBackgroundPath;

const beforePath = path.join(outputsDir, "pro14i-horizontal-before.png");
const afterPath = path.join(outputsDir, "pro14i-horizontal-after.png");
const groundedPath = path.join(outputsDir, "pro14i-horizontal-grounded.png");
const contrastDebugPath = path.join(outputsDir, "pro14i-contrast-debug.png");
const reportPath = path.join(outputsDir, "pro14i-horizontal-composer-report.json");

const CANVAS = 1080;

const jblUnderstanding: ProductVisualUnderstanding = {
  version: 1,
  sourceImageAssetId: "local-pro14i-fixture",
  observed: {
    dominantColors: ["white", "light gray"],
    secondaryColors: ["orange"],
    perceivedBrightness: "light",
    productOrientation: "landscape",
    visualComplexity: "medium",
  },
  inferred: {
    recommendedBackgroundContrast: "high",
    recommendedCreativeFamilies: ["fresh-sport", "modern"],
  },
  confidence: 0.95,
};

const darkProductUnderstanding: ProductVisualUnderstanding = {
  ...jblUnderstanding,
  observed: {
    ...jblUnderstanding.observed,
    dominantColors: ["black", "dark gray"],
    secondaryColors: ["blue"],
    perceivedBrightness: "dark",
  },
};

function assertFixtureExists(filePath: string): void {
  assert.equal(fs.existsSync(filePath), true, `${filePath} missing`);
}

async function alphaBounds(filePath: string): Promise<{ sx: number; sy: number; sw: number; sh: number; sourceSha256: string }> {
  const bytes = fs.readFileSync(filePath);
  const raw = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = raw.info;
  assert.equal(channels, 4);
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (raw.data[(y * width + x) * 4 + 3] <= 12) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  assert.ok(maxX > minX && maxY > minY, "cutout alpha bbox unavailable");
  const pad = 4;
  const sx = Math.max(0, minX - pad);
  const sy = Math.max(0, minY - pad);
  const ex = Math.min(width - 1, maxX + pad);
  const ey = Math.min(height - 1, maxY + pad);
  const { createHash } = await import("node:crypto");
  return { sx, sy, sw: ex - sx + 1, sh: ey - sy + 1, sourceSha256: createHash("sha256").update(bytes).digest("hex") };
}

function fitDrawBox(input: {
  rect: { x: number; y: number; width: number; height: number };
  imageWidth: number;
  imageHeight: number;
  scale: number;
  bottomAlign: boolean;
  horizontal?: boolean;
}): { x: number; y: number; width: number; height: number; productWidthShare: number } {
  const box = {
    x: input.rect.x * CANVAS,
    y: input.rect.y * CANVAS,
    width: input.rect.width * CANVAS,
    height: input.rect.height * CANVAS,
  };
  const targetHorizontalWidthShare = Math.min(0.70, Math.max(0.55, 0.58 * input.scale));
  const scale = input.horizontal
    ? Math.min((CANVAS * targetHorizontalWidthShare) / input.imageWidth, (box.width * 0.98) / input.imageWidth)
    : Math.min(
      Math.min(box.width / input.imageWidth, box.height / input.imageHeight) * input.scale,
      (box.width * 0.98) / input.imageWidth,
      (box.height * 0.96) / input.imageHeight,
    );
  const width = input.imageWidth * scale;
  const height = input.imageHeight * scale;
  return {
    x: box.x + (box.width - width) / 2,
    y: input.bottomAlign ? box.y + box.height - height * (input.horizontal ? 0.72 : 1.04) : box.y + (box.height - height) / 2,
    width,
    height,
    productWidthShare: width / CANVAS,
  };
}

function shadowSvg(box: { x: number; y: number; width: number; height: number }): Buffer {
  const cx = box.x + box.width / 2;
  const bottom = box.y + box.height;
  return Buffer.from(`
    <svg width="${CANVAS}" height="${CANVAS}" viewBox="0 0 ${CANVAS} ${CANVAS}" xmlns="http://www.w3.org/2000/svg">
      <filter id="blur1"><feGaussianBlur stdDeviation="18"/></filter>
      <filter id="blur2"><feGaussianBlur stdDeviation="34"/></filter>
      <ellipse cx="${cx}" cy="${bottom + 12}" rx="${box.width * 0.42}" ry="${Math.max(16, box.height * 0.07)}" fill="rgba(15,23,42,0.22)" filter="url(#blur1)"/>
      <ellipse cx="${cx}" cy="${bottom + 24}" rx="${box.width * 0.54}" ry="${Math.max(24, box.height * 0.12)}" fill="rgba(15,23,42,0.12)" filter="url(#blur2)"/>
    </svg>
  `);
}

function contrastOverlaySvg(rect: { x: number; y: number; width: number; height: number }, label: string): Buffer {
  const x = rect.x * CANVAS;
  const y = rect.y * CANVAS;
  const width = rect.width * CANVAS;
  const height = rect.height * CANVAS;
  const textZones = MARKETING_PRO_TEXT_ZONE.square;
  const zone = (r: typeof rect, color: string, text: string) => `
    <rect x="${r.x * CANVAS}" y="${r.y * CANVAS}" width="${r.width * CANVAS}" height="${r.height * CANVAS}" fill="none" stroke="${color}" stroke-width="4"/>
    <text x="${r.x * CANVAS + 16}" y="${r.y * CANVAS + 30}" fill="${color}" font-size="24" font-family="Arial" font-weight="800">${text}</text>
  `;
  return Buffer.from(`
    <svg width="${CANVAS}" height="${CANVAS}" viewBox="0 0 ${CANVAS} ${CANVAS}" xmlns="http://www.w3.org/2000/svg">
      <rect x="${x}" y="${y}" width="${width}" height="${height}" fill="rgba(15,23,42,0.28)" stroke="#f97316" stroke-width="5"/>
      ${zone(textZones.primaryText, "#22c55e", "primary text")}
      ${zone(textZones.secondaryText, "#22c55e", "secondary text")}
      ${zone(textZones.callToAction, "#22c55e", "CTA")}
      <rect x="32" y="958" width="920" height="82" rx="24" fill="rgba(15,23,42,0.86)"/>
      <text x="58" y="1009" fill="#fff" font-size="26" font-family="Arial" font-weight="800">${label}</text>
    </svg>
  `);
}

async function renderComposite(input: {
  outputPath: string;
  rect: { x: number; y: number; width: number; height: number };
  source: { sx: number; sy: number; sw: number; sh: number };
  scale: number;
  useCrop: boolean;
  grounding: boolean;
  heroMock: boolean;
  horizontal?: boolean;
}): Promise<{ x: number; y: number; width: number; height: number; productWidthShare: number }> {
  const productSource = input.useCrop
    ? await sharp(cutoutPath).extract({ left: input.source.sx, top: input.source.sy, width: input.source.sw, height: input.source.sh }).png().toBuffer()
    : fs.readFileSync(cutoutPath);
  const productMeta = await sharp(productSource).metadata();
  assert.ok(productMeta.width && productMeta.height);
  const box = fitDrawBox({
    rect: input.rect,
    imageWidth: productMeta.width,
    imageHeight: productMeta.height,
    scale: input.scale,
    bottomAlign: input.useCrop,
    horizontal: input.horizontal,
  });
  const productLayer = await sharp(productSource).resize(Math.round(box.width), Math.round(box.height), { fit: "fill" }).png().toBuffer();
  const composites: sharp.OverlayOptions[] = [];
  if (input.heroMock) {
    composites.push({ input: Buffer.from(`<svg width="${CANVAS}" height="${CANVAS}" xmlns="http://www.w3.org/2000/svg"><rect x="${input.rect.x * CANVAS}" y="${input.rect.y * CANVAS}" width="${input.rect.width * CANVAS}" height="${input.rect.height * CANVAS}" fill="rgba(15,23,42,0.30)"/></svg>`), blend: "multiply" });
  }
  if (input.grounding) composites.push({ input: shadowSvg(box), blend: "multiply" });
  composites.push({ input: productLayer, left: Math.round(box.x), top: Math.round(box.y) });
  await sharp(backgroundPath)
    .resize(CANVAS, CANVAS, { fit: "cover" })
    .composite(composites)
    .png()
    .toFile(input.outputPath);
  return box;
}

async function run(): Promise<void> {
  assertFixtureExists(backgroundPath);
  assertFixtureExists(cutoutPath);
  fs.mkdirSync(outputsDir, { recursive: true });

  const source = await alphaBounds(cutoutPath);
  const oldRect = { x: 0.12, y: 0.33, width: 0.76, height: 0.31 };
  const placement = resolveMarketingProProductPlacement({
    format: "square",
    creativeFamily: "fresh-sport",
    productUnderstanding: jblUnderstanding,
  });

  const before = await renderComposite({ outputPath: beforePath, rect: oldRect, source, scale: 1, useCrop: false, grounding: false, heroMock: false });
  const after = await renderComposite({ outputPath: afterPath, rect: placement.rect, source, scale: placement.scale, useCrop: true, grounding: false, heroMock: false, horizontal: true });
  const grounded = await renderComposite({ outputPath: groundedPath, rect: placement.rect, source, scale: placement.scale, useCrop: true, grounding: true, heroMock: false, horizontal: true });
  const contrastMock = await renderComposite({ outputPath: contrastDebugPath, rect: placement.rect, source, scale: placement.scale, useCrop: true, grounding: true, heroMock: true, horizontal: true });

  const decoded = decodePngToLuminance(fs.readFileSync(backgroundPath));
  assert.equal(decoded.ok, true, "fixture background must be decodable PNG");
  if (!decoded.ok) throw new Error("unreachable");
  const contrast = computeMarketingProHeroContrastSuitability({
    image: decoded.image,
    rect: placement.rect,
    productBrightness: jblUnderstanding.observed.perceivedBrightness,
  });
  await sharp(contrastDebugPath)
    .composite([{ input: contrastOverlaySvg(placement.rect, `hero contrast: ${contrast.expectedDirection} diff=${contrast.relativeDifference.toFixed(3)} suitable=${contrast.suitable}`) }])
    .png()
    .toFile(`${contrastDebugPath}.tmp.png`);
  fs.renameSync(`${contrastDebugPath}.tmp.png`, contrastDebugPath);

  const lightSpec = buildMarketingProBackgroundSpecFromConceptSelection({
    creativeConceptId: "pro14i-light",
    creativeFamily: "fresh-sport",
    category: "electronics",
    format: "square",
    productUnderstanding: jblUnderstanding,
  });
  const darkSpec = buildMarketingProBackgroundSpecFromConceptSelection({
    creativeConceptId: "pro14i-dark",
    creativeFamily: "fresh-sport",
    category: "electronics",
    format: "square",
    productUnderstanding: darkProductUnderstanding,
  });
  const lightPrompt = buildMarketingProBackgroundPrompt(lightSpec);
  const darkPrompt = buildMarketingProBackgroundPrompt(darkSpec);

  assert.ok(after.productWidthShare > before.productWidthShare + 0.18, "horizontal scale must improve materially");
  assert.ok(after.productWidthShare >= 0.55 && after.productWidthShare <= 0.70, `horizontal product width share ${after.productWidthShare}`);
  assert.ok(after.y + after.height > before.y + before.height, "horizontal product bottom must move lower");
  assert.ok(placement.rect.y + placement.rect.height < MARKETING_PRO_TEXT_ZONE.square.primaryText.y, "product zone cannot overlap primary text zone");
  assert.deepEqual(lightSpec.requestedSafeZones.find((zone) => zone.region === "product")?.rect, placement.rect, "safe-zone and composer placement must align");
  assert.equal(MARKETING_PRO_SAFE_ZONE_THRESHOLDS_V1.productZone.maxLuminanceStdDev, 0.18);
  assert.equal(MARKETING_PRO_SAFE_ZONE_THRESHOLDS_V1.productZone.maxStrongEdgeDensity, 0.12);
  assert.equal(MARKETING_PRO_SAFE_ZONE_THRESHOLDS_V1.textZone.maxStrongEdgeDensity, 0.15);
  assert.match(lightPrompt, /darker\/neutral compared with the light-colored item/);
  assert.match(darkPrompt, /lighter\/neutral compared with the dark-colored item/);
  assert.match(lightPrompt, /Avoid filling the hero area with a hue too similar/);
  assert.equal(source.sourceSha256, (await alphaBounds(cutoutPath)).sourceSha256, "cutout bytes must remain unchanged");

  const outputs = await Promise.all([beforePath, afterPath, groundedPath, contrastDebugPath].map(async (filePath) => {
    const meta = await sharp(filePath).metadata();
    assert.equal(meta.format, "png");
    assert.equal(meta.width, CANVAS);
    assert.equal(meta.height, CANVAS);
    return { filePath, bytes: fs.statSync(filePath).size };
  }));

  const report = {
    before,
    after,
    grounded,
    contrastMock,
    placement,
    contrast,
    cutoutSha256: source.sourceSha256,
    thresholds: MARKETING_PRO_SAFE_ZONE_THRESHOLDS_V1,
    lightHeroZone: lightSpec.visualProductHints?.heroZoneContrast,
    darkHeroZone: darkSpec.visualProductHints?.heroZoneContrast,
    outputs,
    externalProviderCalls: 0,
    paidCalls: 0,
  };
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log("PRO-14I horizontal composer tests passed; external provider calls=0; paid calls=0");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
