/**
 * Extração de metadados de um arquivo local — PRO-07E.2A, equivalente Node de
 * client/src/lib/product-image-metadata.ts, que decodifica via `Image`/`URL.createObjectURL`
 * (indisponíveis neste runtime). Aqui a leitura de largura/altura reaproveita
 * script/marketing-pro-benchmark/image-dimensions.ts (PRO-06B2.2) — nenhuma regra de parsing binário
 * nova, mesmo leitor JPEG/PNG já usado (e já testado) para o benchmark do Gemini.
 *
 * §3 do enunciado: WebP não é decodificável hoje sem uma dependência nova (o leitor reaproveitado só
 * entende JPEG/PNG) — em vez de inventar um decoder, arquivos `.webp` são reportados como
 * "unsupported-format" e ficam de fora do cálculo de metrics/policy/transform. Documentado, não
 * contornado.
 *
 * PRO-07F.1 — AVISO EXPLÍCITO: `readImagePixelDimensions` lê width/height direto do marcador JPEG SOF0
 * / chunk PNG IHDR — dimensão FÍSICA CRUA do bitstream, sem nenhuma leitura do marcador EXIF de
 * orientação. Para uma foto com Orientation 5/6/7/8 (rotação de 90°/270°), esse width/height pode vir
 * TROCADO em relação ao que `client/src/lib/product-image-metadata.ts` (decode via `new Image()`, que
 * aplica EXIF) reportaria para o MESMO arquivo. Por isso este módulo nunca produz um
 * `CanonicalDecodedImage` (shared/product-image-coordinate-space.ts) — a constante abaixo torna essa
 * classificação verificável em tempo de compilação, não só em comentário.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { readImagePixelDimensions } from "../marketing-pro-benchmark/image-dimensions";
import type { ProductImageQualityMetrics } from "../../shared/product-image-quality";
import type { RawBitstreamDecodeMethod } from "../../shared/product-image-coordinate-space";
import type { ProductImageCalibrationExtractionError } from "./types";

/**
 * Classificação explícita e checável pelo compilador: se `RawBitstreamDecodeMethod` mudar de nome/valor
 * em shared/product-image-coordinate-space.ts, esta linha para de compilar — a distinção entre "dimensão
 * crua" e `CanonicalDecodedImage` não pode ser esquecida silenciosamente.
 */
export const CALIBRATION_HARNESS_DECODE_METHOD: RawBitstreamDecodeMethod = "raw-bitstream-no-orientation";

export const SUPPORTED_CALIBRATION_EXTENSIONS = [".jpg", ".jpeg", ".png"] as const;
/** Reconhecido pelo harness, mas sem decode disponível — ver cabeçalho deste arquivo. */
export const UNSUPPORTED_DECODE_EXTENSIONS = [".webp"] as const;

function inferMimeTypeFromExtension(filePath: string): string | null {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  return null;
}

export type ReadCalibrationMetadataResult =
  | { readonly ok: true; readonly metrics: ProductImageQualityMetrics }
  | { readonly ok: false; readonly error: ProductImageCalibrationExtractionError };

/** Só leitura: nunca escreve, nunca converte, nunca move o arquivo recebido. */
export function readCalibrationImageMetadata(filePath: string): ReadCalibrationMetadataResult {
  const mimeType = inferMimeTypeFromExtension(filePath);
  if (!mimeType) return { ok: false, error: "unsupported-format" };
  if (UNSUPPORTED_DECODE_EXTENSIONS.some((ext) => filePath.toLowerCase().endsWith(ext))) {
    return { ok: false, error: "unsupported-format" };
  }

  const bytes = fs.readFileSync(filePath);
  if (bytes.length === 0) return { ok: false, error: "empty-file" };

  const dimensions = readImagePixelDimensions(bytes, mimeType);
  if (!dimensions) return { ok: false, error: "decode-failed" };

  const { width, height } = dimensions;
  return {
    ok: true,
    metrics: {
      width,
      height,
      megapixels: (width * height) / 1_000_000,
      byteSize: bytes.length,
      aspectRatio: width / height,
      mimeType,
    },
  };
}
