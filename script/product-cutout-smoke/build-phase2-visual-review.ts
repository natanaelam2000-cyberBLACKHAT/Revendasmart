/**
 * PRO-07F.4 §8 — gera uma fixture HTML estática de comparação visual (source | cutout sobre
 * checkerboard | cutout sobre fundo escuro | cutout sobre fundo claro) para avaliação humana do
 * resultado real do Case B. Só leitura dos artefatos já existentes + escrita do HTML — não decodifica
 * nem recompõe nada, não altera um único pixel do produto.
 */
import fs from "node:fs";
import path from "node:path";

const RUN_DIR = path.join(".tmp", "product-cutout-smoke", "2026-08-17T01-48-05-144Z", "B");
const SOURCE_PATH = path.join(".tmp", "product-image-quality-calibration-samples", "WhatsApp Image 2026-08-16 at 16.29.58.jpeg");

export function buildPhase2VisualReviewHtml(sourceDataUri: string, cutoutDataUri: string): string {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<title>PRO-07F.4 — Revisão visual Case B (Coffee Unique)</title>
<style>
  body { font-family: system-ui, sans-serif; background: #0b0b0b; color: #eee; margin: 0; padding: 24px; }
  h1 { font-size: 16px; font-weight: 700; }
  .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-top: 16px; }
  .panel { background: #1a1a1a; border-radius: 12px; padding: 12px; }
  .panel h2 { font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; color: #999; margin: 0 0 8px; }
  .frame { width: 100%; aspect-ratio: 1 / 1; border-radius: 8px; overflow: hidden; display: flex; align-items: center; justify-content: center; }
  .frame img { max-width: 100%; max-height: 100%; display: block; }
  .checkerboard { background-image: linear-gradient(45deg, #444 25%, transparent 25%), linear-gradient(-45deg, #444 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #444 75%), linear-gradient(-45deg, transparent 75%, #444 75%); background-size: 20px 20px; background-position: 0 0, 0 10px, 10px -10px, -10px 0px; background-color: #666; }
  .darkBg { background-color: #000; }
  .lightBg { background-color: #fff; }
  ul { font-size: 12px; color: #ccc; line-height: 1.6; }
</style>
</head>
<body>
<h1>PRO-07F.4 — Case B (Coffee Unique, 1600x1600) — revisão humana, sem avaliação preenchida automaticamente</h1>
<div class="grid">
  <div class="panel">
    <h2>Source (original)</h2>
    <div class="frame"><img src="${sourceDataUri}" alt="source" /></div>
  </div>
  <div class="panel">
    <h2>Cutout sobre checkerboard</h2>
    <div class="frame checkerboard"><img src="${cutoutDataUri}" alt="cutout sobre checkerboard" /></div>
  </div>
  <div class="panel">
    <h2>Cutout sobre fundo escuro</h2>
    <div class="frame darkBg"><img src="${cutoutDataUri}" alt="cutout sobre fundo escuro" /></div>
  </div>
  <div class="panel">
    <h2>Cutout sobre fundo claro</h2>
    <div class="frame lightBg"><img src="${cutoutDataUri}" alt="cutout sobre fundo claro" /></div>
  </div>
</div>
<ul>
  <li>Avaliar especialmente: vidro âmbar (transparência preservada?), reflexos na tampa dourada, halo na borda do produto, perda de borda/detalhe fino, aspecto artificial/recortado.</li>
  <li>Esta fixture não altera nenhum pixel do produto — é só uma composição visual em CSS/HTML sobre o cutout.png já gerado.</li>
  <li>Nenhuma avaliação humana foi preenchida automaticamente.</li>
</ul>
</body>
</html>
`;
}

function toDataUri(filePath: string, mimeType: string): string {
  const bytes = fs.readFileSync(filePath);
  return `data:${mimeType};base64,${bytes.toString("base64")}`;
}

function main() {
  const cutoutPath = path.join(RUN_DIR, "cutout.png");
  if (!fs.existsSync(cutoutPath)) {
    throw new Error(`cutout.png não encontrado em ${cutoutPath} — rode a Fase 2 (phase2-server.ts + harness no browser) primeiro`);
  }
  const sourceDataUri = toDataUri(SOURCE_PATH, "image/jpeg");
  const cutoutDataUri = toDataUri(cutoutPath, "image/png");
  const html = buildPhase2VisualReviewHtml(sourceDataUri, cutoutDataUri);
  const outputPath = path.join(RUN_DIR, "visual-review.html");
  fs.writeFileSync(outputPath, html);
  console.log("Fixture visual escrita em:", outputPath);
}

if (process.argv[1] && process.argv[1].replace(/\\/g, "/").endsWith("product-cutout-smoke/build-phase2-visual-review.ts")) {
  main();
}
