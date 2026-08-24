/**
 * PRO-07F.4 §2 — servidor local isolado (fora do runtime de Marketing) para fechar a Fase 2 real do
 * Case B. Serve o harness browser (decode canônico) e expõe o compose/gate REAIS em Node
 * (script/product-cutout-smoke/phase2-compose.ts), gravando cutout.png/phase2-result.json ao final.
 * Nenhuma rede externa: só localhost. Nenhuma chamada a provider.
 */
import express from "express";
import fs from "node:fs";
import path from "node:path";
import { runPhase2Composition } from "./phase2-compose";

const RUN_DIR = path.join(".tmp", "product-cutout-smoke", "2026-08-17T01-48-05-144Z", "B");
const SOURCE_PATH = path.join(".tmp", "product-image-quality-calibration-samples", "WhatsApp Image 2026-08-16 at 16.29.58.jpeg");
const MASK_PATH = path.join(RUN_DIR, "mask.png");
const SOURCE_ASSET_ID = "cutout-smoke:sha256:44721639f385e81677a4de5c3f40369080f9084334add862d159a66397ee72d0";
const COORDINATE_SPACE_VERSION = "product-image-coordinate-space-v1" as const;
const EXPECTED_WIDTH = 1600;
const EXPECTED_HEIGHT = 1600;
const PORT = Number(process.env.PHASE2_PORT || 5183);

const app = express();

app.get("/", (_req, res) => {
  res.type("html").send(fs.readFileSync(path.join(import.meta.dirname, "phase2-harness.html"), "utf8"));
});
app.get("/source.jpg", (_req, res) => {
  res.type("image/jpeg").send(fs.readFileSync(SOURCE_PATH));
});
app.get("/mask.png", (_req, res) => {
  res.type("image/png").send(fs.readFileSync(MASK_PATH));
});

app.post("/phase2/compose", express.json({ limit: "60mb" }), (req, res) => {
  const body = req.body as {
    sourceWidth: number; sourceHeight: number; sourceRgbaBase64: string;
    maskWidth: number; maskHeight: number; maskAlphaBase64: string;
  };
  const result = runPhase2Composition({
    expectedWidth: EXPECTED_WIDTH,
    expectedHeight: EXPECTED_HEIGHT,
    sourceAssetId: SOURCE_ASSET_ID,
    coordinateSpaceVersion: COORDINATE_SPACE_VERSION,
    sourceWidth: body.sourceWidth,
    sourceHeight: body.sourceHeight,
    sourceRgba: Uint8ClampedArray.from(Buffer.from(body.sourceRgbaBase64, "base64")),
    maskWidth: body.maskWidth,
    maskHeight: body.maskHeight,
    maskAlpha: Uint8ClampedArray.from(Buffer.from(body.maskAlphaBase64, "base64")),
  });
  console.log("[phase2] compose:", { composerAccepted: result.composerAccepted, pixelGateAccepted: result.pixelGateAccepted, rgbDifferentPixels: result.rgbDifferentPixels });
  // Nunca reenviar `cutoutRgba` (Uint8ClampedArray bruto) como JSON — serializaria como um objeto
  // indexado com milhões de chaves numéricas. Só a versão base64, compacta, é devolvida.
  const { cutoutRgba, ...resultWithoutRawBuffer } = result as typeof result & { cutoutRgba?: Uint8ClampedArray };
  res.json({
    ...resultWithoutRawBuffer,
    cutoutRgbaBase64: result.composerAccepted && cutoutRgba ? Buffer.from(cutoutRgba).toString("base64") : undefined,
  });
});

app.post("/phase2/save-cutout", express.raw({ type: "image/png", limit: "20mb" }), (req, res) => {
  const bytes = req.body as Buffer;
  fs.mkdirSync(RUN_DIR, { recursive: true });
  const cutoutPath = path.join(RUN_DIR, "cutout.png");
  fs.writeFileSync(cutoutPath, bytes);
  console.log("[phase2] cutout.png salvo:", cutoutPath, bytes.length, "bytes");
  res.json({ ok: true, bytes: bytes.length });
});

app.post("/phase2/save-result", express.json({ limit: "1mb" }), (req, res) => {
  const payload = {
    ...req.body,
    cutoutPath: path.join(RUN_DIR, "cutout.png"),
    visualReviewPath: path.join(RUN_DIR, "visual-review.html"),
  };
  fs.mkdirSync(RUN_DIR, { recursive: true });
  const resultPath = path.join(RUN_DIR, "phase2-result.json");
  fs.writeFileSync(resultPath, JSON.stringify(payload, null, 2));
  console.log("[phase2] phase2-result.json salvo:", resultPath);
  res.json({ ok: true });
});

app.listen(PORT, "127.0.0.1", () => {
  console.log(`[phase2] harness em http://127.0.0.1:${PORT} — só localhost, nenhuma rede externa`);
});
