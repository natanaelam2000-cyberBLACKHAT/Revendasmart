/**
 * PRO-07E.2A — harness LOCAL de calibração da Product Image Quality Policy.
 *
 * Isolado do runtime, do mesmo jeito que script/marketing-pro-benchmark/ já é: nada aqui é importado
 * por client/ ou server/, e nenhuma rota real conecta a este script. NÃO altera
 * MARKETING_PRODUCT_IMAGE_QUALITY_POLICY_V0, NÃO cria uma Policy V1, NÃO chama nenhum provider externo,
 * NÃO acessa Firebase, NÃO baixa nada da internet — só lê arquivos locais explicitamente informados.
 *
 * Uso:
 *   npm run product-image-quality:calibrate -- --input <diretório>
 *   npm run product-image-quality:calibrate -- --file <imagem1> --file <imagem2>
 *
 * `--input` NÃO é recursivo: só olha os arquivos diretamente dentro do diretório informado. Formatos
 * aceitos: .jpg/.jpeg/.png (decodificáveis pelo leitor binário já existente do PRO-06B2.2). `.webp` é
 * reconhecido mas reportado como "unsupported-format" — não há decoder Node no projeto hoje e esta
 * tarefa não autoriza instalar dependência nova (ver read-image-metadata.ts).
 *
 * Saída: .tmp/product-image-quality-calibration/calibration-results.json (+ .csv), fora do Git.
 * `humanEvaluation` é sempre `null` — nunca preenchido automaticamente (§9/§10).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { parseCalibrationCliArgs } from "./cli-args";
import { buildCalibrationEntry } from "./build-entry";
import { SUPPORTED_CALIBRATION_EXTENSIONS, UNSUPPORTED_DECODE_EXTENSIONS } from "./read-image-metadata";
import { MARKETING_PRODUCT_IMAGE_QUALITY_POLICY_V0 } from "../../shared/product-image-quality";
import type { ProductImageCalibrationEntry, ProductImageCalibrationReport } from "./types";

export const CALIBRATION_HARNESS_VERSION = "product-image-quality-calibration-v0" as const;
const OUTPUT_DIR = path.join(".tmp", "product-image-quality-calibration");

function isRecognizedImageFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return (SUPPORTED_CALIBRATION_EXTENSIONS as readonly string[]).includes(ext)
    || (UNSUPPORTED_DECODE_EXTENSIONS as readonly string[]).includes(ext);
}

/** Só o nível informado — nunca desce em subpastas (§2: nenhuma varredura além do que foi pedido). */
function listImageFilesInDirectory(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && isRecognizedImageFile(entry.name))
    .map((entry) => path.join(dir, entry.name))
    .sort();
}

function toCsvRow(entry: ProductImageCalibrationEntry): string {
  const cell = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  return [
    entry.fileName,
    entry.metadata?.width ?? "",
    entry.metadata?.height ?? "",
    entry.metadata?.byteSize ?? "",
    entry.metadata?.mimeType ?? "",
    entry.metadata?.aspectRatio ?? "",
    entry.metadata?.megapixels ?? "",
    entry.extractionError ?? "",
    entry.policyV0?.status ?? "",
    entry.policyV0 ? entry.policyV0.reasons.join("|") : "",
    entry.manual?.scale ?? "",
    entry.manual?.upscaleRequired ?? "",
    entry.premium?.scale ?? "",
    entry.premium?.upscaleRequired ?? "",
  ].map(cell).join(",");
}

function writeReport(report: ProductImageCalibrationReport): void {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUTPUT_DIR, "calibration-results.json"), JSON.stringify(report, null, 2));

  const header = "fileName,width,height,byteSize,mimeType,aspectRatio,megapixels,extractionError,policyV0Status,policyV0Reasons,manualScale,manualUpscaleRequired,premiumScale,premiumUpscaleRequired";
  const csv = [header, ...report.entries.map(toCsvRow)].join("\n");
  fs.writeFileSync(path.join(OUTPUT_DIR, "calibration-results.csv"), csv);
}

function main(): void {
  const args = parseCalibrationCliArgs(process.argv.slice(2));
  const filePaths = args.inputDir ? listImageFilesInDirectory(args.inputDir) : [...args.files];

  console.log("=== PRO-07E.2A — harness de calibração da Product Image Quality Policy ===");
  console.log(`Modo: ${args.inputDir ? `--input ${args.inputDir} (não-recursivo)` : `--file (${args.files.length} arquivo(s))`}`);
  console.log(`${filePaths.length} arquivo(s) a processar.`);

  const entries = filePaths.map((filePath) => buildCalibrationEntry(filePath, MARKETING_PRODUCT_IMAGE_QUALITY_POLICY_V0));
  const report: ProductImageCalibrationReport = {
    generatedAt: new Date().toISOString(),
    harnessVersion: CALIBRATION_HARNESS_VERSION,
    entries,
  };
  writeReport(report);

  for (const entry of entries) {
    const summary = entry.policyV0
      ? `status=${entry.policyV0.status} manualScale=${entry.manual?.scale.toFixed(3)} premiumScale=${entry.premium?.scale.toFixed(3)}`
      : `extractionError=${entry.extractionError}`;
    console.log(`  ${entry.fileName}: ${summary}`);
  }
  console.log(`\nRelatório gravado em ${path.join(OUTPUT_DIR, "calibration-results.json")} (+ .csv).`);
  console.log("humanEvaluation ficou null em todos os casos — nenhuma avaliação humana foi inventada.");
}

main();
