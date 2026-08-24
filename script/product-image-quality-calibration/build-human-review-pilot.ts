/**
 * PRO-07E.2C-FIX — gera o piloto de 5 casos da nova fixture de comparação (SOURCE | RENDERED | DETAIL).
 *
 * Escopo deliberadamente restrito aos 5 índices pedidos — NÃO recria as 19. Reaproveita
 * calibration-results.json (já auditado em PRO-07E.2B) e calculateProductContainTransform (PRO-07B) —
 * nenhuma segunda fórmula de contain. Nunca escreve nos arquivos originais da pasta de amostras, nunca
 * toca nas fixtures antigas (`manual.html`/`premium.html`) — só adiciona `manual-compare.html`/
 * `premium-compare.html` ao lado delas, na mesma pasta numerada.
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { calculateProductContainTransform } from "../../shared/product-image-preservation";
import { computeManualProductBoxPx, computePremiumProductBoxPx } from "./product-boxes";
import { buildProductComparisonFixtureHtml } from "./fixture-html";

const SAMPLES_DIR = path.join(".tmp", "product-image-quality-calibration-samples");
const CALIBRATION_RESULTS_PATH = path.join(".tmp", "product-image-quality-calibration", "calibration-results.json");
const OUTPUT_DIR = path.join(".tmp", "product-image-quality-calibration", "human-review");

/**
 * Índices (1-based, mesma ordem de calibration-results.json) dos casos piloto pedidos.
 * PRO-07E.2C-FIX: 7, 12, 16, 18, 19. PRO-07E.2E: +14, +17 (próximos dois casos mais informativos —
 * ainda não têm manual-compare.html/premium-compare.html gerados). A função é determinística e pura
 * (mesmo transform, mesmos bytes), então reprocessar os 5 já existentes produz saída byte-idêntica —
 * verificado por hash antes/depois, não é regeneração com efeito.
 */
const PILOT_INDICES = [7, 12, 14, 16, 17, 18, 19];

interface CalibrationEntryLike {
  readonly fileName: string;
  readonly metadata: { readonly width: number; readonly height: number; readonly mimeType: string; readonly byteSize: number } | null;
  readonly manual: { readonly scale: number } | null;
  readonly premium: { readonly scale: number } | null;
}

function sha256Hex(bytes: Buffer): string {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function buildFlow(
  flow: "Manual" | "Premium",
  index: string,
  entry: CalibrationEntryLike,
  box: { x: number; y: number; width: number; height: number },
  imageDataUri: string,
  outDir: string,
): number {
  if (!entry.metadata) throw new Error(`${entry.fileName}: metadata ausente`);
  const result = calculateProductContainTransform({
    sourceAssetId: entry.fileName,
    source: { width: entry.metadata.width, height: entry.metadata.height },
    bounds: box,
    padding: 0,
  });
  if (!result.accepted || !result.transform) throw new Error(`${entry.fileName} (${flow}): ProductTransform recusado — ${JSON.stringify(result.errors)}`);
  const { transform } = result;

  const storedScale = flow === "Manual" ? entry.manual?.scale : entry.premium?.scale;
  if (storedScale !== undefined && storedScale !== null && Math.abs(storedScale - transform.scale) > 1e-9) {
    throw new Error(`${entry.fileName} (${flow}): scale recalculado diverge do calibration-results.json`);
  }

  const html = buildProductComparisonFixtureHtml({
    index,
    fileName: entry.fileName,
    flow,
    sourceWidth: entry.metadata.width,
    sourceHeight: entry.metadata.height,
    targetWidth: transform.targetWidth,
    targetHeight: transform.targetHeight,
    scale: transform.scale,
    imageDataUri,
  });
  fs.writeFileSync(path.join(outDir, flow === "Manual" ? "manual-compare.html" : "premium-compare.html"), html);
  return transform.scale;
}

function main(): void {
  console.log("=== PRO-07E.2C-FIX — piloto de 5 casos (SOURCE | RENDERED | DETAIL) ===");

  const sampleFileNames = fs.readdirSync(SAMPLES_DIR, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name).sort();
  const hashesBefore = new Map<string, string>(sampleFileNames.map((name) => [name, sha256Hex(fs.readFileSync(path.join(SAMPLES_DIR, name)))]));

  const entries = (JSON.parse(fs.readFileSync(CALIBRATION_RESULTS_PATH, "utf8")) as { entries: CalibrationEntryLike[] }).entries;
  const manualBox = computeManualProductBoxPx();
  const premiumBox = computePremiumProductBoxPx();

  for (const oneBasedIndex of PILOT_INDICES) {
    const entry = entries[oneBasedIndex - 1];
    if (!entry) throw new Error(`Índice ${oneBasedIndex} não existe em calibration-results.json (só há ${entries.length} entradas)`);
    const index = String(oneBasedIndex).padStart(2, "0");
    const outDir = path.join(OUTPUT_DIR, index);
    fs.mkdirSync(outDir, { recursive: true });

    if (!entry.metadata) {
      console.log(`  ${index}: ${entry.fileName} — sem metadata, pulando.`);
      continue;
    }
    const rawBytes = fs.readFileSync(path.join(SAMPLES_DIR, entry.fileName));
    const imageDataUri = `data:${entry.metadata.mimeType};base64,${rawBytes.toString("base64")}`;

    const manualScale = buildFlow("Manual", index, entry, manualBox, imageDataUri, outDir);
    const premiumScale = buildFlow("Premium", index, entry, premiumBox, imageDataUri, outDir);
    console.log(`  ${index}: ${entry.fileName} -> manual-compare.html (scale=${manualScale.toFixed(3)}) premium-compare.html (scale=${premiumScale.toFixed(3)})`);
  }

  let allIntact = true;
  for (const name of sampleFileNames) {
    const after = sha256Hex(fs.readFileSync(path.join(SAMPLES_DIR, name)));
    if (after !== hashesBefore.get(name)) {
      allIntact = false;
      console.error(`  DIVERGÊNCIA DE HASH: ${name}`);
    }
  }
  console.log(allIntact ? "\nIntegridade confirmada: os 19 arquivos originais permanecem byte-a-byte intactos." : "\nATENÇÃO: divergência de hash detectada.");
  console.log(`Fixtures do piloto gravadas em ${OUTPUT_DIR}\\<índice>\\manual-compare.html / premium-compare.html`);
}

main();
