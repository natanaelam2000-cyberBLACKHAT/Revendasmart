import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import sharp from "sharp";
import {
  MARKETING_PRO_PRODUCT_ZONE,
  MARKETING_PRO_TEXT_ZONE,
  resolveMarketingProProductSafeZone,
  type MarketingProRect,
} from "../shared/marketing-pro-contract";
import {
  evaluateMarketingProSafeZoneGate,
  MARKETING_PRO_SAFE_ZONE_THRESHOLDS_V1,
} from "../server/marketing-pro-safe-zone-gate";
import { quarantineMarketingProSafeZoneRejectedBackground } from "../server/marketing-pro-safe-zone-debug";

const OUT_DIR = path.join(".tmp", "pro14c-safezone-tests");
fs.mkdirSync(OUT_DIR, { recursive: true });

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBytes = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(Buffer.concat([typeBytes, data])) >>> 0, 0);
  return Buffer.concat([length, typeBytes, data, crc]);
}

/**
 * TEST-FIX-CUTOUT-SMOKE-01 (mesma classe do fix anterior) — este teste dependia de
 * .tmp/pro14a/jbl-cutout.png, um artefato nunca versionado e nunca gerado por este próprio arquivo, então
 * ausente em qualquer clone/worktree limpo. quarantineMarketingProSafeZoneRejectedBackground só usa
 * largura/altura via sharp(...).metadata() para redimensionar/compor (writeDebugComposite, em
 * server/marketing-pro-safe-zone-debug.ts) — nunca decodifica conteúdo de pixel específico — então um PNG
 * mínimo porém estruturalmente válido, gerado aqui mesmo, é suficiente e 100% reproduzível.
 */
function buildDeterministicCutoutPng(): Buffer {
  const width = 200;
  const height = 200;
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0; // 8-bit RGBA, sem interlace
  const bytesPerPixel = 4;
  const raw = Buffer.alloc((1 + width * bytesPerPixel) * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (1 + width * bytesPerPixel);
    raw[rowStart] = 0; // filtro None
    for (let x = 0; x < width; x += 1) {
      const offset = rowStart + 1 + x * bytesPerPixel;
      raw[offset] = 40; raw[offset + 1] = 40; raw[offset + 2] = 46; raw[offset + 3] = 255;
    }
  }
  const idat = zlib.deflateSync(raw);
  return Buffer.concat([signature, pngChunk("IHDR", ihdr), pngChunk("IDAT", idat), pngChunk("IEND", Buffer.alloc(0))]);
}

function rectBounds(rect: MarketingProRect, width: number, height: number) {
  return {
    x0: Math.floor(rect.x * width),
    y0: Math.floor(rect.y * height),
    x1: Math.ceil((rect.x + rect.width) * width),
    y1: Math.ceil((rect.y + rect.height) * height),
  };
}

async function pngFromPixels(width: number, height: number, pixel: (x: number, y: number) => [number, number, number]): Promise<Buffer> {
  const data = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = pixel(x, y);
      const offset = (y * width + x) * 3;
      data[offset] = r;
      data[offset + 1] = g;
      data[offset + 2] = b;
    }
  }
  return await sharp(data, { raw: { width, height, channels: 3 } }).png().toBuffer();
}

function squareTextZones() {
  return [
    { name: "primaryText", rect: MARKETING_PRO_TEXT_ZONE.square.primaryText },
    { name: "secondaryText", rect: MARKETING_PRO_TEXT_ZONE.square.secondaryText },
    { name: "callToAction", rect: MARKETING_PRO_TEXT_ZONE.square.callToAction },
  ];
}

const squareHorizontalZone = resolveMarketingProProductSafeZone({
  format: "square",
  productUnderstanding: { observed: { productOrientation: "landscape" } },
});
assert.deepEqual(MARKETING_PRO_SAFE_ZONE_THRESHOLDS_V1.productZone, { maxLuminanceStdDev: 0.18, maxStrongEdgeDensity: 0.12 });
assert.equal(MARKETING_PRO_SAFE_ZONE_THRESHOLDS_V1.textZone.maxStrongEdgeDensity, 0.15);
assert.notDeepEqual(squareHorizontalZone, MARKETING_PRO_PRODUCT_ZONE.square);
// TEST-FIX-CUTOUT-SMOKE-01 — valor atualizado para o retângulo real hoje (PRO-14I passou a resolver a
// zona horizontal via resolveMarketingProProductPlacement/MARKETING_PRO_ORIENTATION_PRODUCT_ZONE); a
// garantia protegida (zona horizontal difere da zona vertical canônica, ver assert acima) continua válida.
assert.deepEqual(squareHorizontalZone, { x: 0.07, y: 0.28, width: 0.86, height: 0.34 });

const calm = await pngFromPixels(1080, 1080, () => [31, 41, 59]);
const verticalGood = evaluateMarketingProSafeZoneGate({
  bytes: calm,
  mimeType: "image/png",
  productZone: resolveMarketingProProductSafeZone({ format: "square", productUnderstanding: { observed: { productOrientation: "portrait" } } }),
  textZones: squareTextZones(),
});
assert.equal(verticalGood.accepted, true, "vertical calm fixture should pass");
if (verticalGood.accepted) assert.ok(verticalGood.metricsReport.productZone.metrics.strongEdgeDensity <= MARKETING_PRO_SAFE_ZONE_THRESHOLDS_V1.productZone.maxStrongEdgeDensity);

const oldZone = MARKETING_PRO_PRODUCT_ZONE.square;
const oldBounds = rectBounds(oldZone, 1080, 1080);
const newBounds = rectBounds(squareHorizontalZone, 1080, 1080);
const horizontalGood = await pngFromPixels(1080, 1080, (x, y) => {
  const inOldUpperOnly = x >= oldBounds.x0 && x < oldBounds.x1 && y >= oldBounds.y0 && y < Math.min(newBounds.y0 - 8, oldBounds.y1);
  // TEST-FIX-CUTOUT-SMOKE-01 — período-18 (mudança de cor a cada ~9px) ficou fraco demais depois que a
  // zona horizontal real (PRO-14I) encolheu a área "só na zona antiga": a métrica é uma MÉDIA sobre a
  // zona inteira (computeMarketingProZoneMetrics), então uma faixa de ruído menor precisa de densidade de
  // borda mais alta para continuar ultrapassando o limiar. Período 2 (puro checkerboard) NÃO funciona aqui
  // — o gradiente usado por computeMarketingProZoneMetrics compara x-1 com x+1 (pula 1), e num checkerboard
  // de período 2 essas duas posições sempre caem na MESMA cor, então o gradiente fica sempre zero (ponto
  // cego de Nyquist do formato de amostragem). Período 4 evita esse ponto cego (todo pixel vê uma borda em
  // x-1 OU x+1) e maximiza strongEdgeDensity dentro da MESMA região já correta, sem alterar geometria
  // nenhuma — confirmado numericamente: strongEdgeDensity(oldZone)=0.245 > limiar 0.12.
  if (inOldUpperOnly) return (x + y) % 4 < 2 ? [245, 138, 30] : [15, 23, 42];
  return [20, 33, 52];
});
const horizontalGoodNewZone = evaluateMarketingProSafeZoneGate({
  bytes: horizontalGood,
  mimeType: "image/png",
  productZone: squareHorizontalZone,
  textZones: squareTextZones(),
});
assert.equal(horizontalGoodNewZone.accepted, true, "horizontal fixture should pass when measured where the horizontal product is actually placed");
const horizontalGoodOldZone = evaluateMarketingProSafeZoneGate({
  bytes: horizontalGood,
  mimeType: "image/png",
  productZone: oldZone,
  textZones: squareTextZones(),
});
assert.equal(horizontalGoodOldZone.accepted, false, "same horizontal fixture demonstrates old square geometry can reject useful upper energy");
if (!horizontalGoodOldZone.accepted) assert.equal(horizontalGoodOldZone.rejectionCode, "PRODUCT_ZONE_TOO_BUSY");

const horizontalBad = await pngFromPixels(1080, 1080, (x, y) => {
  const inHorizontalZone = x >= newBounds.x0 && x < newBounds.x1 && y >= newBounds.y0 && y < newBounds.y1;
  if (inHorizontalZone) return ((x + y) % 12) < 6 ? [250, 250, 250] : [2, 6, 23];
  return [25, 35, 55];
});
const horizontalBadGate = evaluateMarketingProSafeZoneGate({
  bytes: horizontalBad,
  mimeType: "image/png",
  productZone: squareHorizontalZone,
  textZones: squareTextZones(),
});
assert.equal(horizontalBadGate.accepted, false, "busy background in the actual horizontal product zone must still fail");
if (!horizontalBadGate.accepted) {
  assert.equal(horizontalBadGate.rejectionCode, "PRODUCT_ZONE_TOO_BUSY");
  assert.ok(horizontalBadGate.metricsReport);
  assert.ok(horizontalBadGate.metricsReport.productZone.violations.length > 0);
}

const pro13Background = path.join(".tmp", "pro13-real-final", "background.png");
if (fs.existsSync(pro13Background)) {
  const bytes = fs.readFileSync(pro13Background);
  const pro13Gate = evaluateMarketingProSafeZoneGate({
    bytes,
    mimeType: "image/png",
    productZone: MARKETING_PRO_PRODUCT_ZONE.square,
    textZones: squareTextZones(),
  });
  assert.equal(pro13Gate.accepted, true, "previously approved PRO-13 background should remain accepted");
}

await quarantineMarketingProSafeZoneRejectedBackground({
  uid: "pro14c-test-user",
  generationId: "pro14c-horizontal-bad-fixture",
  productId: "pro14c-horizontal-product",
  backgroundBytes: horizontalBad,
  mimeType: "image/png",
  rejectionCode: horizontalBadGate.accepted ? "PRODUCT_ZONE_TOO_BUSY" : horizontalBadGate.rejectionCode,
  rejectedZone: horizontalBadGate.accepted ? "product" : horizontalBadGate.zone,
  metricsReport: horizontalBadGate.accepted ? undefined : horizontalBadGate.metricsReport,
  loadCutoutBytes: async () => buildDeterministicCutoutPng(),
});
const quarantineDir = path.join(".tmp", "marketing-pro-safezone-quarantine", "pro14c-horizontal-bad-fixture");
for (const fileName of ["background-rejected.png", "safezone-metrics.json", "safezone-debug-overlay.png", "rejected-composite-debug.png"]) {
  const fullPath = path.join(quarantineDir, fileName);
  assert.equal(fs.existsSync(fullPath), true, `${fileName} should be generated`);
  assert.ok(fs.statSync(fullPath).size > 0, `${fileName} should not be empty`);
}

fs.writeFileSync(path.join(OUT_DIR, "report.json"), `${JSON.stringify({
  thresholds: MARKETING_PRO_SAFE_ZONE_THRESHOLDS_V1,
  canonicalSquareProductZone: MARKETING_PRO_PRODUCT_ZONE.square,
  horizontalSquareProductZone: squareHorizontalZone,
  verticalGoodAccepted: verticalGood.accepted,
  horizontalGoodAcceptedWithOrientationZone: horizontalGoodNewZone.accepted,
  horizontalGoodRejectedWithOldZone: !horizontalGoodOldZone.accepted,
  horizontalBadRejected: !horizontalBadGate.accepted,
  quarantineDir,
}, null, 2)}\n`, "utf8");

console.log("PRO-14C safe-zone observability tests passed");
