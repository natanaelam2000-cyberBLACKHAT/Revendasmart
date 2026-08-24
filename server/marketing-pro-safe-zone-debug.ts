import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import sharp from "sharp";
import { validateImageUploadBytes } from "../shared/image-validation";
import type { MarketingProRect } from "../shared/marketing-pro-contract";
import type { MarketingProSafeZoneMetricsReport, MarketingProSafeZoneRejectionCode } from "./marketing-pro-safe-zone-gate";
import type { MarketingProSemanticMetadata } from "./marketing-pro-semantic-inspector-google";
import { logInfo, logWarn } from "./logger";

const QUARANTINE_ROOT = path.join(process.cwd(), ".tmp", "marketing-pro-safezone-quarantine");

function isLocalOrTestRuntime(): boolean {
  return process.env.NODE_ENV !== "production" || Boolean(process.env.FIRESTORE_EMULATOR_HOST);
}

function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 120) || "unknown";
}

function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function rectToPixels(rect: MarketingProRect, width: number, height: number) {
  return {
    x: Math.round(rect.x * width),
    y: Math.round(rect.y * height),
    width: Math.round(rect.width * width),
    height: Math.round(rect.height * height),
  };
}

function svgText(value: unknown): string {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function zoneSvg(input: {
  readonly name: string;
  readonly rect: MarketingProRect;
  readonly width: number;
  readonly height: number;
  readonly color: string;
  readonly violated: boolean;
  readonly label: string;
}): string {
  const rect = rectToPixels(input.rect, input.width, input.height);
  const fill = input.violated ? "rgba(239,68,68,0.22)" : "rgba(34,197,94,0.10)";
  const strokeWidth = input.violated ? 8 : 4;
  return [
    `<rect x="${rect.x}" y="${rect.y}" width="${rect.width}" height="${rect.height}" fill="${fill}" stroke="${input.color}" stroke-width="${strokeWidth}" />`,
    `<text x="${rect.x + 14}" y="${Math.max(28, rect.y + 30)}" font-family="Arial" font-size="24" font-weight="700" fill="${input.color}">${svgText(input.label)}</text>`,
  ].join("");
}

async function writeDebugOverlay(input: {
  readonly backgroundBytes: Uint8Array;
  readonly report: MarketingProSafeZoneMetricsReport;
  readonly outputPath: string;
  readonly rejectionCode: QuarantineMarketingProSafeZoneRejectedBackgroundInput["rejectionCode"];
  readonly rejectedZone?: string;
}): Promise<void> {
  const metadata = await sharp(input.backgroundBytes).metadata();
  const width = metadata.width || 1080;
  const height = metadata.height || 1080;
  const zones = [
    zoneSvg({
      name: "product",
      rect: input.report.productZone.rect,
      width,
      height,
      color: "#EF4444",
      violated: input.report.productZone.violations.length > 0,
      label: `product std=${input.report.productZone.metrics.luminanceStdDev.toFixed(3)} edge=${input.report.productZone.metrics.strongEdgeDensity.toFixed(3)}`,
    }),
    ...input.report.textZones.map((zone) => zoneSvg({
      name: zone.name,
      rect: zone.rect,
      width,
      height,
      color: zone.violations.length > 0 ? "#EF4444" : "#22C55E",
      violated: zone.violations.length > 0,
      label: `${zone.name} edge=${zone.metrics.strongEdgeDensity.toFixed(3)}`,
    })),
  ].join("");
  const svg = Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <rect width="100%" height="100%" fill="rgba(15,23,42,0.12)" />
      ${zones}
      <rect x="24" y="${height - 112}" width="${Math.min(840, width - 48)}" height="88" rx="18" fill="rgba(15,23,42,0.78)" />
      <text x="48" y="${height - 74}" font-family="Arial" font-size="25" font-weight="800" fill="#FFFFFF">${svgText(input.rejectionCode)} ${svgText(input.rejectedZone || "")}</text>
      <text x="48" y="${height - 40}" font-family="Arial" font-size="19" fill="#CBD5E1">thresholds: product std ${input.report.thresholds.productZone.maxLuminanceStdDev} / edge ${input.report.thresholds.productZone.maxStrongEdgeDensity}; text edge ${input.report.thresholds.textZone.maxStrongEdgeDensity}</text>
    </svg>
  `);
  await sharp(input.backgroundBytes).composite([{ input: svg, top: 0, left: 0 }]).png().toFile(input.outputPath);
}

async function writeDebugComposite(input: {
  readonly backgroundBytes: Uint8Array;
  readonly cutoutBytes: Uint8Array;
  readonly productZone: MarketingProRect;
  readonly outputPath: string;
}): Promise<void> {
  const [backgroundMeta, cutoutMeta] = await Promise.all([
    sharp(input.backgroundBytes).metadata(),
    sharp(input.cutoutBytes).metadata(),
  ]);
  const width = backgroundMeta.width || 1080;
  const height = backgroundMeta.height || 1080;
  const cutoutWidth = cutoutMeta.width || width;
  const cutoutHeight = cutoutMeta.height || height;
  const zone = rectToPixels(input.productZone, width, height);
  const scale = Math.min(zone.width / cutoutWidth, zone.height / cutoutHeight);
  const resizedWidth = Math.max(1, Math.round(cutoutWidth * scale));
  const resizedHeight = Math.max(1, Math.round(cutoutHeight * scale));
  const left = zone.x + Math.round((zone.width - resizedWidth) / 2);
  const top = zone.y + Math.round((zone.height - resizedHeight) / 2);
  const resizedCutout = await sharp(input.cutoutBytes).resize(resizedWidth, resizedHeight, { fit: "contain" }).png().toBuffer();
  await sharp(input.backgroundBytes)
    .composite([{ input: resizedCutout, left, top }])
    .png()
    .toFile(input.outputPath);
}

export interface QuarantineMarketingProSafeZoneRejectedBackgroundInput {
  readonly uid: string;
  readonly generationId: string;
  readonly productId: string;
  readonly backgroundBytes: Uint8Array;
  readonly mimeType: string;
  readonly rejectionCode: MarketingProSafeZoneRejectionCode | "SEMANTIC_GATE_UNAVAILABLE" | "SEMANTIC_CONTENT_REJECTED" | "SEMANTIC_INVALID_OUTPUT" | "SEMANTIC_TIMEOUT" | "PERSISTENCE_FAILED" | "GENERATION_FAILED";
  readonly rejectedZone?: string;
  readonly metricsReport?: MarketingProSafeZoneMetricsReport;
  readonly semanticMetadata?: MarketingProSemanticMetadata;
  readonly semanticReason?: string;
  readonly persistenceReason?: string;
  readonly loadCutoutBytes?: () => Promise<Uint8Array>;
}

export async function quarantineMarketingProSafeZoneRejectedBackground(input: QuarantineMarketingProSafeZoneRejectedBackgroundInput): Promise<void> {
  if (!isLocalOrTestRuntime()) {
    return;
  }
  if (input.mimeType !== "image/png" && input.mimeType !== "image/jpeg") {
    logWarn("marketing_pro.safe_zone_quarantine_skipped", { generationId: input.generationId, reason: "unsupported_mime" });
    return;
  }

  const dir = path.join(QUARANTINE_ROOT, safeSegment(input.generationId));
  await fs.mkdir(dir, { recursive: true });
  const imageValidation = validateImageUploadBytes(input.backgroundBytes, input.mimeType);
  const backgroundPath = path.join(dir, input.mimeType === "image/png" ? "background-rejected.png" : "background-rejected.jpg");
  const metricsPath = path.join(dir, "safezone-metrics.json");
  const overlayPath = path.join(dir, "safezone-debug-overlay.png");
  const compositePath = path.join(dir, "rejected-composite-debug.png");
  const debugPath = path.join(dir, "debug-metadata.json");

  await fs.writeFile(backgroundPath, Buffer.from(input.backgroundBytes));
  if (input.metricsReport) {
    await fs.writeFile(metricsPath, `${JSON.stringify(input.metricsReport, null, 2)}\n`, "utf8");
  }
  await fs.writeFile(debugPath, `${JSON.stringify({
    generationId: input.generationId,
    productId: input.productId,
    uidHash: shortHash(input.uid),
    rejectionCode: input.rejectionCode,
    rejectedZone: input.rejectedZone || null,
    image: imageValidation.accepted
      ? { mimeType: imageValidation.format, width: imageValidation.width, height: imageValidation.height, byteSize: input.backgroundBytes.byteLength }
      : { mimeType: input.mimeType, byteSize: input.backgroundBytes.byteLength, rejected: imageValidation.reason },
    safeZoneMetricsAvailable: Boolean(input.metricsReport),
    semanticMetadata: input.semanticMetadata || null,
    semanticReason: input.semanticReason || null,
    persistenceReason: input.persistenceReason || null,
    artifacts: {
      backgroundPath,
      metricsPath: input.metricsReport ? metricsPath : null,
      overlayPath: input.metricsReport ? overlayPath : null,
      compositePath: input.metricsReport && input.loadCutoutBytes ? compositePath : null,
      debugPath,
    },
    debugOnly: true,
    approvedAsset: false,
  }, null, 2)}\n`, "utf8");
  if (input.metricsReport) {
    await writeDebugOverlay({ backgroundBytes: input.backgroundBytes, report: input.metricsReport, outputPath: overlayPath, rejectionCode: input.rejectionCode, rejectedZone: input.rejectedZone });
  }

  if (input.loadCutoutBytes && input.metricsReport) {
    try {
      const cutoutBytes = await input.loadCutoutBytes();
      await writeDebugComposite({ backgroundBytes: input.backgroundBytes, cutoutBytes, productZone: input.metricsReport.productZone.rect, outputPath: compositePath });
    } catch (error) {
      logWarn("marketing_pro.safe_zone_debug_composite_failed", { generationId: input.generationId, reason: error instanceof Error ? error.name : "unknown" });
    }
  }

  logInfo("marketing_pro.safe_zone_quarantine_written", {
    generationId: input.generationId,
    rejectionCode: input.rejectionCode,
    rejectedZone: input.rejectedZone,
    backgroundPath,
    overlayPath: input.metricsReport ? overlayPath : null,
    compositePath: input.metricsReport && input.loadCutoutBytes ? compositePath : null,
  });
}
