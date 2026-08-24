/**
 * Orquestração de UM arquivo — PRO-07E.2A. Junta metadata + Policy V0 + os dois boxes num único
 * `ProductImageCalibrationEntry`. Não reimplementa nenhuma regra: só chama, nessa ordem, funções que já
 * existem em outros módulos (metadata extraction, `assessProductImageQuality`,
 * `computeBoxCalibration`). `policyV0` é calculado de forma independente dos boxes — nenhum status é
 * ajustado por `scale`/`upscaleRequired` (§P do enunciado: nenhum upgrade/downgrade por scale ainda).
 */

import * as path from "node:path";
import { assessProductImageQuality, type ProductImageQualityPolicy } from "../../shared/product-image-quality";
import { readCalibrationImageMetadata } from "./read-image-metadata";
import { computeBoxCalibration, computeManualProductBoxPx, computePremiumProductBoxPx } from "./product-boxes";
import type { ProductImageCalibrationEntry } from "./types";

const MANUAL_BOX_PX = computeManualProductBoxPx();
const PREMIUM_BOX_PX = computePremiumProductBoxPx();

export function buildCalibrationEntry(filePath: string, policy: ProductImageQualityPolicy): ProductImageCalibrationEntry {
  const fileName = path.basename(filePath);
  const extraction = readCalibrationImageMetadata(filePath);

  if (!extraction.ok) {
    return {
      fileName,
      metadata: null,
      extractionError: extraction.error,
      policyV0: null,
      manual: null,
      premium: null,
      humanEvaluation: null,
    };
  }

  const { metrics } = extraction;
  const assessment = assessProductImageQuality(metrics, policy);

  return {
    fileName,
    metadata: metrics,
    extractionError: null,
    policyV0: { status: assessment.status, reasons: assessment.reasons },
    manual: computeBoxCalibration(fileName, metrics, MANUAL_BOX_PX),
    premium: computeBoxCalibration(fileName, metrics, PREMIUM_BOX_PX),
    humanEvaluation: null,
  };
}
