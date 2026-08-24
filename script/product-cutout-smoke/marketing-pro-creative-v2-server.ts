/** Servidor localhost isolado do PRO-07I. Não integra runtime e não chama provider. */
import express from "express";
import fs from "node:fs";
import path from "node:path";
import { CUTOUT_PATH } from "./marketing-pro-creative-tokens";
import {
  buildMarketingProCreativeV2Payload,
  type PremiumCreativeFamily,
} from "./marketing-pro-creative-v2-tokens";

const OUTPUT_DIR = path.join(".tmp", "product-cutout-smoke", "marketing-pro-creative-v2");
const PORT = Number(process.env.MARKETING_PRO_CREATIVE_V2_PORT || 5187);
const FAMILIES: readonly PremiumCreativeFamily[] = ["luxury", "editorial", "modern"];

function isPremiumCreativeFamily(value: unknown): value is PremiumCreativeFamily {
  return typeof value === "string" && FAMILIES.includes(value as PremiumCreativeFamily);
}

const app = express();

app.get("/", (_req, res) => {
  res.type("html").send(fs.readFileSync(path.join(import.meta.dirname, "marketing-pro-creative-v2-harness.html"), "utf8"));
});

app.get("/cutout.png", (_req, res) => {
  res.type("image/png").send(fs.readFileSync(CUTOUT_PATH));
});

app.post("/creative-v2/prepare", express.json(), (req, res) => {
  const family = req.body?.family;
  if (!isPremiumCreativeFamily(family)) {
    res.status(400).json({ ok: false, error: "invalid family" });
    return;
  }
  try {
    res.json({ ok: true, payload: buildMarketingProCreativeV2Payload(family) });
  } catch (error) {
    res.status(422).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
});

app.post("/creative-v2/save-png", express.raw({ type: "image/png", limit: "20mb" }), (req, res) => {
  const family = req.query.family;
  if (!isPremiumCreativeFamily(family)) {
    res.status(400).json({ ok: false, error: "invalid family" });
    return;
  }
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const outputPath = path.join(OUTPUT_DIR, `premium-${family}-v2.png`);
  fs.writeFileSync(outputPath, req.body as Buffer);
  res.json({ ok: true, path: outputPath, bytes: (req.body as Buffer).length });
});

app.post("/creative-v2/save-report", express.json({ limit: "2mb" }), (req, res) => {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const outputPath = path.join(OUTPUT_DIR, "creative-v2-report.json");
  fs.writeFileSync(outputPath, JSON.stringify(req.body, null, 2));
  res.json({ ok: true, path: outputPath });
});

app.listen(PORT, "127.0.0.1", () => {
  console.log(`[marketing-pro-creative-v2] http://127.0.0.1:${PORT} — localhost only; provider calls: 0`);
});
