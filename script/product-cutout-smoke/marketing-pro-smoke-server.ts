/**
 * PRO-07G — servidor local isolado (fora do runtime de Marketing) para o smoke do compositor
 * Premium com o cutout já aprovado do Case B. Nenhuma rede externa, nenhuma chamada a provider —
 * o cutout já foi gerado e aprovado na Fase 2 (PRO-07F.4).
 */
import express from "express";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  buildApprovedProductCutoutAsset,
  prepareMarketingProCutoutProductImage,
} from "./marketing-pro-cutout-adapter";

const CUTOUT_PATH = path.join(".tmp", "product-cutout-smoke", "2026-08-17T01-48-05-144Z", "B", "cutout.png");
const OUTPUT_DIR = path.join(".tmp", "product-cutout-smoke", "marketing-pro-premium-smoke");
const PORT = Number(process.env.MARKETING_PRO_SMOKE_PORT || 5185);

const app = express();

app.get("/", (_req, res) => {
  res.type("html").send(fs.readFileSync(path.join(import.meta.dirname, "marketing-pro-smoke-harness.html"), "utf8"));
});

app.get("/cutout.png", (_req, res) => {
  res.type("image/png").send(fs.readFileSync(CUTOUT_PATH));
});

// §1/§2/§3: prepara asset+transform UMA vez, no servidor, reaproveitando o Preservation Gate real —
// Preview e PNG (ambos no browser) recebem exatamente este mesmo par, nunca recalculam.
app.post("/marketing-pro-smoke/prepare", (_req, res) => {
  const cutoutBytes = fs.readFileSync(CUTOUT_PATH);
  const width = cutoutBytes.readUInt32BE(16);
  const height = cutoutBytes.readUInt32BE(20);
  const contentHash = createHash("sha256").update(cutoutBytes).digest("hex");

  const asset = buildApprovedProductCutoutAsset({
    productId: "product-cutout-smoke:coffee-unique",
    cutoutContentHash: `sha256:${contentHash}`,
    width,
    height,
    assetRef: CUTOUT_PATH,
  });

  try {
    const prepared = prepareMarketingProCutoutProductImage({ asset, format: "portrait" });
    res.json({
      ok: true,
      asset: prepared.asset,
      transform: prepared.transform,
      overlay: {
        storeName: "Loja Exemplo",
        productName: "Coffee Unique",
        brand: "O Boticário",
        priceText: "R$ 189,90",
        ctaLabel: "Comprar agora",
      },
    });
  } catch (error) {
    res.json({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
});

app.post("/marketing-pro-smoke/save-ad", express.raw({ type: "image/png", limit: "20mb" }), (req, res) => {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const bytes = req.body as Buffer;
  const outputPath = path.join(OUTPUT_DIR, "premium-ad.png");
  fs.writeFileSync(outputPath, bytes);
  console.log("[marketing-pro-smoke] premium-ad.png salvo:", outputPath, bytes.length, "bytes");
  res.json({ ok: true, path: outputPath, bytes: bytes.length });
});

app.post("/marketing-pro-smoke/save-result", express.json({ limit: "1mb" }), (req, res) => {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const outputPath = path.join(OUTPUT_DIR, "marketing-pro-result.json");
  fs.writeFileSync(outputPath, JSON.stringify(req.body, null, 2));
  console.log("[marketing-pro-smoke] marketing-pro-result.json salvo:", outputPath);
  res.json({ ok: true });
});

app.listen(PORT, "127.0.0.1", () => {
  console.log(`[marketing-pro-smoke] harness em http://127.0.0.1:${PORT} — só localhost, nenhuma rede externa, nenhuma chamada a provider`);
});
