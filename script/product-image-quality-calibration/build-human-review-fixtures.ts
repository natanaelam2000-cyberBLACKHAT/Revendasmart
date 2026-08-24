/**
 * PRO-07E.2C — gera o pacote visual de calibração (Manual + Premium) a partir das 19 imagens já
 * usadas em PRO-07E.2B, reaproveitando `calibration-results.json` como fonte das métricas (com
 * checagem de consistência contra os arquivos reais — nunca confia cegamente). Isolado em script/,
 * não conectado ao runtime, não altera Policy V0, não decide nada sozinho: `manualSharpEnough`/
 * `premiumSharpEnough` ficam sempre `null` no manifesto.
 *
 * NÃO decodifica/reencoda pixel nenhum — ver fixture-html.ts para o porquê. Só lê os bytes originais
 * e os referencia como estão, via data URI base64.
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { calculateProductContainTransform } from "../../shared/product-image-preservation";
import { computeManualProductBoxPx, computePremiumProductBoxPx } from "./product-boxes";
import { buildProductFixtureHtml } from "./fixture-html";

const SAMPLES_DIR = path.join(".tmp", "product-image-quality-calibration-samples");
const CALIBRATION_RESULTS_PATH = path.join(".tmp", "product-image-quality-calibration", "calibration-results.json");
const OUTPUT_DIR = path.join(".tmp", "product-image-quality-calibration", "human-review");
const MANUAL_CANVAS = { width: 1080, height: 1080 };
const PREMIUM_CANVAS = { width: 1080, height: 1350 };

interface CalibrationEntryLike {
  readonly fileName: string;
  readonly metadata: { readonly width: number; readonly height: number; readonly mimeType: string; readonly byteSize: number } | null;
  readonly policyV0: { readonly status: string; readonly reasons: readonly string[] } | null;
  readonly manual: { readonly scale: number } | null;
  readonly premium: { readonly scale: number } | null;
}

function sha256Hex(bytes: Buffer): string {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function loadCalibrationResults(): readonly CalibrationEntryLike[] {
  const raw = JSON.parse(fs.readFileSync(CALIBRATION_RESULTS_PATH, "utf8")) as { entries: CalibrationEntryLike[] };
  return raw.entries;
}

/** Confirma que o JSON existente ainda descreve os arquivos reais — nunca confia sem checar. */
function assertConsistentWithSampleFiles(entries: readonly CalibrationEntryLike[], sampleHashesBefore: ReadonlyMap<string, string>): void {
  const sampleFiles = new Set(sampleHashesBefore.keys());
  const jsonFiles = new Set(entries.map((entry) => entry.fileName));
  const missingFromJson = [...sampleFiles].filter((name) => !jsonFiles.has(name));
  const missingFromDisk = [...jsonFiles].filter((name) => !sampleFiles.has(name));
  if (missingFromJson.length > 0 || missingFromDisk.length > 0) {
    throw new Error(
      `calibration-results.json inconsistente com a pasta de amostras. Faltando no JSON: ${JSON.stringify(missingFromJson)}. Faltando no disco: ${JSON.stringify(missingFromDisk)}.`,
    );
  }
  for (const entry of entries) {
    if (!entry.metadata) continue;
    const filePath = path.join(SAMPLES_DIR, entry.fileName);
    const bytes = fs.readFileSync(filePath);
    if (bytes.length !== entry.metadata.byteSize) {
      throw new Error(`${entry.fileName}: byteSize do JSON (${entry.metadata.byteSize}) diverge do arquivo real (${bytes.length}) — calibration-results.json está desatualizado.`);
    }
  }
}

function mimeToDataUriPrefix(mimeType: string): string {
  return `data:${mimeType};base64,`;
}

function buildFlowFixture(
  flow: "Manual" | "Premium",
  index: string,
  entry: CalibrationEntryLike,
  box: { x: number; y: number; width: number; height: number },
  canvas: { width: number; height: number },
  imageDataUri: string,
  outDir: string,
): { scale: number } {
  if (!entry.metadata) throw new Error(`${entry.fileName}: metadata ausente, não é possível gerar fixture`);
  const result = calculateProductContainTransform({
    sourceAssetId: entry.fileName,
    source: { width: entry.metadata.width, height: entry.metadata.height },
    bounds: box,
    padding: 0,
  });
  if (!result.accepted || !result.transform) {
    throw new Error(`${entry.fileName} (${flow}): ProductTransform recusado — ${JSON.stringify(result.errors)}`);
  }
  const { transform } = result;

  // Consistência com o que PRO-07E.2B já mediu — mesma chamada, mesmo box, mesma fonte: tem que bater.
  const storedScale = flow === "Manual" ? entry.manual?.scale : entry.premium?.scale;
  if (storedScale !== undefined && storedScale !== null && Math.abs(storedScale - transform.scale) > 1e-9) {
    throw new Error(`${entry.fileName} (${flow}): scale recalculado (${transform.scale}) diverge do calibration-results.json (${storedScale})`);
  }

  const html = buildProductFixtureHtml(
    { canvasWidth: canvas.width, canvasHeight: canvas.height, targetWidth: transform.targetWidth, targetHeight: transform.targetHeight, translateX: transform.translateX, translateY: transform.translateY },
    { index, fileName: entry.fileName, flow, sourceWidth: entry.metadata.width, sourceHeight: entry.metadata.height, scale: transform.scale },
    imageDataUri,
  );
  fs.writeFileSync(path.join(outDir, flow === "Manual" ? "manual.html" : "premium.html"), html);
  return { scale: transform.scale };
}

function main(): void {
  console.log("=== PRO-07E.2C — pacote visual de calibração (Manual + Premium) ===");

  if (!fs.existsSync(SAMPLES_DIR)) throw new Error(`Pasta de amostras não encontrada: ${SAMPLES_DIR}`);
  if (!fs.existsSync(CALIBRATION_RESULTS_PATH)) throw new Error(`calibration-results.json não encontrado em ${CALIBRATION_RESULTS_PATH} — rode a calibração (PRO-07E.2B) antes.`);

  const sampleFileNames = fs.readdirSync(SAMPLES_DIR, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name).sort();
  const sampleHashesBefore = new Map<string, string>(sampleFileNames.map((name) => [name, sha256Hex(fs.readFileSync(path.join(SAMPLES_DIR, name)))]));
  console.log(`${sampleFileNames.length} arquivo(s) na pasta de amostras. Hashes de integridade capturados.`);

  const entries = loadCalibrationResults();
  assertConsistentWithSampleFiles(entries, sampleHashesBefore);
  console.log("calibration-results.json consistente com os arquivos reais.");

  const manualBox = computeManualProductBoxPx();
  const premiumBox = computePremiumProductBoxPx();

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const manifestEntries: Array<Record<string, unknown>> = [];

  entries.forEach((entry, i) => {
    const index = String(i + 1).padStart(2, "0");
    const outDir = path.join(OUTPUT_DIR, index);
    fs.mkdirSync(outDir, { recursive: true });

    if (!entry.metadata) {
      console.log(`  ${index}: ${entry.fileName} — sem metadata (extração falhou na calibração original), pulando fixture.`);
      manifestEntries.push({
        fileName: entry.fileName,
        sourceWidth: null,
        sourceHeight: null,
        policyV0Status: null,
        manualScale: null,
        premiumScale: null,
        manualSharpEnough: null,
        premiumSharpEnough: null,
        notes: "",
      });
      return;
    }

    const rawBytes = fs.readFileSync(path.join(SAMPLES_DIR, entry.fileName));
    const imageDataUri = mimeToDataUriPrefix(entry.metadata.mimeType) + rawBytes.toString("base64");

    const manualResult = buildFlowFixture("Manual", index, entry, manualBox, MANUAL_CANVAS, imageDataUri, outDir);
    const premiumResult = buildFlowFixture("Premium", index, entry, premiumBox, PREMIUM_CANVAS, imageDataUri, outDir);

    console.log(`  ${index}: ${entry.fileName} -> manual.html (scale=${manualResult.scale.toFixed(3)}) premium.html (scale=${premiumResult.scale.toFixed(3)})`);

    manifestEntries.push({
      fileName: entry.fileName,
      sourceWidth: entry.metadata.width,
      sourceHeight: entry.metadata.height,
      policyV0Status: entry.policyV0?.status ?? null,
      manualScale: manualResult.scale,
      premiumScale: premiumResult.scale,
      manualSharpEnough: null,
      premiumSharpEnough: null,
      notes: "",
    });
  });

  fs.writeFileSync(
    path.join(OUTPUT_DIR, "human-review-manifest.json"),
    JSON.stringify({ generatedAt: new Date().toISOString(), entries: manifestEntries }, null, 2),
  );

  // Integridade: os 19 originais precisam continuar byte-a-byte intactos — nada acima os escreveu.
  let allIntact = true;
  for (const name of sampleFileNames) {
    const after = sha256Hex(fs.readFileSync(path.join(SAMPLES_DIR, name)));
    if (after !== sampleHashesBefore.get(name)) {
      allIntact = false;
      console.error(`  DIVERGÊNCIA DE HASH: ${name}`);
    }
  }
  console.log(allIntact ? "\nIntegridade confirmada: os 19 arquivos originais permanecem byte-a-byte intactos." : "\nATENÇÃO: divergência de hash detectada — ver acima.");
  console.log(`Fixtures gravadas em ${OUTPUT_DIR}`);
  console.log("manualSharpEnough/premiumSharpEnough ficaram null em todos os casos — nenhuma avaliação humana foi inventada.");
}

main();
