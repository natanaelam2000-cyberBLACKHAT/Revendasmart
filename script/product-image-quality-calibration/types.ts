/**
 * Tipos do harness de calibração — PRO-07E.2A.
 *
 * Isolado de propósito, mesmo padrão de script/marketing-pro-benchmark/: nada aqui é importado por
 * client/ ou server/ em runtime, e este módulo não é conectado a nenhuma rota real. Só orquestra
 * contratos que já existem (shared/product-image-quality.ts, shared/product-image-preservation.ts,
 * shared/marketing-pro-contract.ts, client/src/lib/marketing-art-layout.ts) — não redefine regra
 * nenhuma de classificação.
 */

import type {
  ProductImageQualityMetrics,
  ProductImageQualityReasonId,
  ProductImageQualityStatus,
} from "../../shared/product-image-quality";

export type ProductImageCalibrationExtractionError = "empty-file" | "decode-failed" | "unsupported-format";

/**
 * Resultado bruto de UM box (manual ou premium) — só o que `calculateProductContainTransform` (PRO-07B)
 * já calcula, sem nenhuma classificação adicional (§8/§O do enunciado: nada de "leve/médio/grave" aqui
 * — isso é trabalho da calibração humana, não deste harness).
 */
export interface ProductImageCalibrationBoxResult {
  readonly boxWidth: number;
  readonly boxHeight: number;
  readonly renderedWidth: number;
  readonly renderedHeight: number;
  readonly scale: number;
  readonly upscaleRequired: boolean;
}

/**
 * Reservado para uma etapa humana futura — nunca preenchido automaticamente por este harness (§9/§10).
 * O `null` no nível do campo (não o do harness) é o que representa "ainda não avaliado".
 */
export interface ProductImageCalibrationHumanEvaluation {
  readonly manualSharpEnough: boolean | null;
  readonly premiumSharpEnough: boolean | null;
  readonly notes: string;
}

export interface ProductImageCalibrationPolicyResult {
  readonly status: ProductImageQualityStatus;
  readonly reasons: readonly ProductImageQualityReasonId[];
}

export interface ProductImageCalibrationEntry {
  readonly fileName: string;
  readonly metadata: ProductImageQualityMetrics | null;
  /** `null` quando a extração funcionou; caso contrário, por que não foi possível medir esta imagem. */
  readonly extractionError: ProductImageCalibrationExtractionError | null;
  readonly policyV0: ProductImageCalibrationPolicyResult | null;
  readonly manual: ProductImageCalibrationBoxResult | null;
  readonly premium: ProductImageCalibrationBoxResult | null;
  readonly humanEvaluation: ProductImageCalibrationHumanEvaluation | null;
}

export interface ProductImageCalibrationReport {
  readonly generatedAt: string;
  readonly harnessVersion: string;
  readonly entries: readonly ProductImageCalibrationEntry[];
}
