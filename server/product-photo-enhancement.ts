/**
 * RELEASE V1 §7 — melhoria REAL da foto do produto, Premium/admin. Substitui a implementação anterior
 * de `enhancePhoto()` (client/src/pages/add-product.tsx), que era um `setTimeout` de 2s sem tocar um
 * único byte da imagem — exatamente o que o ticket proíbe ("fingir melhoria de imagem").
 *
 * Só operações NÃO-generativas, determinísticas, que remapeiam intensidade/contraste do que já existe
 * na imagem — nunca redesenham/inventam conteúdo:
 *   - `normalize()`: estica o histograma para usar toda a faixa dinâmica (corrige exposição/contraste
 *     baixo sem mudar QUAL pixel está onde, só a intensidade dele).
 *   - `sharpen()` leve (unsharp mask padrão do sharp): realça bordas já existentes, não inventa novas.
 * Nenhuma das duas altera geometria, cor de identidade (matiz dominante), recorta, ou reconstrói
 * qualquer região — por isso preservam embalagem/rótulo/marca por construção, não por sorte.
 *
 * `improved=true` só quando as métricas ANTES/DEPOIS provam ganho real (nitidez OU contraste
 * melhorou, sem piorar o outro além de uma tolerância pequena) — caso contrário o original é mantido e
 * o usuário é avisado, nunca substituído (§7.4 fail-safe).
 */
import sharp from "sharp";

export interface ProductPhotoQualityMetrics {
  readonly width: number;
  readonly height: number;
  /** Desvio padrão do Laplaciano em escala de cinza — proxy padrão de nitidez (maior = mais nítido). */
  readonly sharpness: number;
  /** Luminância média (0-255) — proxy de exposição. */
  readonly exposureMean: number;
  /** Desvio padrão da luminância (0-255) — proxy de contraste. */
  readonly contrast: number;
  /** Fração de pixels perto de preto/branco puro (0-1) — proxy de clipping. */
  readonly clipping: number;
}

async function measureQuality(bytes: Buffer): Promise<ProductPhotoQualityMetrics> {
  const image = sharp(bytes, { failOn: "error", limitInputPixels: 25_000_000 });
  const metadata = await image.metadata();
  const width = metadata.width || 0;
  const height = metadata.height || 0;

  const grey = await image.clone().greyscale().raw().toBuffer();
  let sum = 0;
  let sumSquares = 0;
  let clippedCount = 0;
  for (let i = 0; i < grey.length; i += 1) {
    const value = grey[i];
    sum += value;
    sumSquares += value * value;
    if (value <= 4 || value >= 251) clippedCount += 1;
  }
  const pixelCount = grey.length || 1;
  const mean = sum / pixelCount;
  const variance = Math.max(0, sumSquares / pixelCount - mean * mean);
  const contrast = Math.sqrt(variance);
  const clipping = clippedCount / pixelCount;

  // Variância do Laplaciano — técnica padrão de detecção de blur (Pech-Pacheco et al.).
  const laplacian = await sharp(grey, { raw: { width, height, channels: 1 } })
    .convolve({ width: 3, height: 3, kernel: [0, 1, 0, 1, -4, 1, 0, 1, 0] })
    .raw()
    .toBuffer();
  let lapSum = 0;
  let lapSumSquares = 0;
  for (let i = 0; i < laplacian.length; i += 1) {
    lapSum += laplacian[i];
    lapSumSquares += laplacian[i] * laplacian[i];
  }
  const lapCount = laplacian.length || 1;
  const lapMean = lapSum / lapCount;
  const sharpness = Math.max(0, lapSumSquares / lapCount - lapMean * lapMean);

  return { width, height, sharpness, exposureMean: mean, contrast, clipping };
}

export interface ProductPhotoEnhancementResult {
  readonly improved: boolean;
  readonly reason: string;
  readonly metricsBefore: ProductPhotoQualityMetrics;
  readonly metricsAfter: ProductPhotoQualityMetrics;
  /** Só presente quando `improved` é true. */
  readonly enhancedPngBytes?: Buffer;
}

/** §7.4: tolerâncias fail-safe — precisa de ganho REAL em pelo menos uma métrica sem regressão
 * relevante nas outras, nunca "diferente" sozinho contando como "melhor". */
const SHARPNESS_MIN_GAIN_RATIO = 1.05;
const CONTRAST_MIN_GAIN_RATIO = 1.05;
const CONTRAST_REGRESSION_TOLERANCE_RATIO = 0.97;
const SHARPNESS_REGRESSION_TOLERANCE_RATIO = 0.97;
const CLIPPING_MAX_REGRESSION = 0.01;

export async function enhanceProductPhoto(bytes: Buffer): Promise<ProductPhotoEnhancementResult> {
  const metricsBefore = await measureQuality(bytes);

  const enhancedBuffer = await sharp(bytes, { failOn: "error", limitInputPixels: 25_000_000 })
    .normalize()
    .sharpen({ sigma: 0.8 })
    .png()
    .toBuffer();
  const metricsAfter = await measureQuality(enhancedBuffer);

  const sharpnessGain = metricsBefore.sharpness > 0 ? metricsAfter.sharpness / metricsBefore.sharpness : (metricsAfter.sharpness > 0 ? Infinity : 1);
  const contrastGain = metricsBefore.contrast > 0 ? metricsAfter.contrast / metricsBefore.contrast : (metricsAfter.contrast > 0 ? Infinity : 1);
  const clippingRegression = metricsAfter.clipping - metricsBefore.clipping;

  const sharpnessImproved = sharpnessGain >= SHARPNESS_MIN_GAIN_RATIO;
  const contrastImproved = contrastGain >= CONTRAST_MIN_GAIN_RATIO;
  const noSharpnessRegression = sharpnessGain >= SHARPNESS_REGRESSION_TOLERANCE_RATIO;
  const noContrastRegression = contrastGain >= CONTRAST_REGRESSION_TOLERANCE_RATIO;
  const noClippingRegression = clippingRegression <= CLIPPING_MAX_REGRESSION;

  const improved = (sharpnessImproved || contrastImproved) && noSharpnessRegression && noContrastRegression && noClippingRegression;

  if (!improved) {
    return {
      improved: false,
      reason: !noClippingRegression
        ? "increased-clipping"
        : !noSharpnessRegression || !noContrastRegression
          ? "regression-detected"
          : "no-measurable-gain",
      metricsBefore,
      metricsAfter,
    };
  }

  return {
    improved: true,
    reason: sharpnessImproved && contrastImproved ? "sharpness-and-contrast-improved" : sharpnessImproved ? "sharpness-improved" : "contrast-improved",
    metricsBefore,
    metricsAfter,
    enhancedPngBytes: enhancedBuffer,
  };
}
