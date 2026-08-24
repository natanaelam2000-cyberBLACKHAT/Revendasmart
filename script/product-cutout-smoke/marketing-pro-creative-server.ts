/**
 * PRO-07H — servidor local isolado para o Premium Creative Composer v1. Reaproveita o sistema real de
 * direção de arte (client/src/lib/marketing-pro*.ts) e o adapter de cutout aprovado (PRO-07G). Nenhuma
 * rede externa, nenhuma chamada a provider.
 */
import express from "express";
import fs from "node:fs";
import path from "node:path";
import { buildMarketingProCreativePayload, CUTOUT_PATH } from "./marketing-pro-creative-tokens";
import { isMarketingProStyle } from "../../shared/marketing-pro-contract";

const OUTPUT_DIR = path.join(".tmp", "product-cutout-smoke", "marketing-pro-creative-v1");
const PORT = Number(process.env.MARKETING_PRO_CREATIVE_PORT || 5186);

const app = express();

app.get("/", (_req, res) => {
  res.type("html").send(fs.readFileSync(path.join(import.meta.dirname, "marketing-pro-creative-harness.html"), "utf8"));
});
app.get("/cutout.png", (_req, res) => {
  res.type("image/png").send(fs.readFileSync(CUTOUT_PATH));
});

app.post("/creative/prepare", express.json(), (req, res) => {
  const style = req.body?.style;
  if (!isMarketingProStyle(style)) {
    res.status(400).json({ ok: false, error: "invalid style" });
    return;
  }
  try {
    const payload = buildMarketingProCreativePayload(style);
    res.json({ ok: true, payload });
  } catch (error) {
    res.json({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
});

app.post("/creative/save-png", express.raw({ type: "image/png", limit: "20mb" }), (req, res) => {
  const style = String(req.query.style || "unknown");
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const outputPath = path.join(OUTPUT_DIR, `premium-${style}.png`);
  fs.writeFileSync(outputPath, req.body as Buffer);
  console.log(`[marketing-pro-creative] premium-${style}.png salvo:`, outputPath, (req.body as Buffer).length, "bytes");
  res.json({ ok: true, path: outputPath });
});

app.post("/creative/save-report", express.json({ limit: "2mb" }), (req, res) => {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const outputPath = path.join(OUTPUT_DIR, "creative-report.json");
  fs.writeFileSync(outputPath, JSON.stringify(req.body, null, 2));
  console.log("[marketing-pro-creative] creative-report.json salvo:", outputPath);
  res.json({ ok: true });
});

app.listen(PORT, "127.0.0.1", () => {
  console.log(`[marketing-pro-creative] harness em http://127.0.0.1:${PORT} — só localhost, nenhuma rede externa, nenhuma chamada a provider`);
});
