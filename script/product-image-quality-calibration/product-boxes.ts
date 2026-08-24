/**
 * Geometria REAL dos dois compositores — PRO-07E.2A §6/§7. Nenhuma dimensão é copiada à mão: os boxes
 * em pixel são derivados das mesmas fontes canônicas que o app usa para renderizar de verdade
 * (`getArtPhotoInnerBox()`/`ART_SIZE` para o anúncio manual, `MARKETING_PRO_PRODUCT_ZONE`/
 * `MARKETING_PRO_FORMAT_DIMENSIONS` para o Premium/IA). `calculateProductContainTransform` é o mesmo
 * do PRO-07B — este módulo não reimplementa contain, só aplica a função existente contra os dois boxes.
 */

import { calculateProductContainTransform } from "../../shared/product-image-preservation";
import type { ProductBoundingBox } from "../../shared/product-image-preservation";
import { MARKETING_PRO_FORMAT_DIMENSIONS, MARKETING_PRO_PRODUCT_ZONE } from "../../shared/marketing-pro-contract";
import { ART_SIZE, getArtPhotoInnerBox } from "../../client/src/lib/marketing-art-layout";
import type { ProductImageQualityMetrics } from "../../shared/product-image-quality";
import type { ProductImageCalibrationBoxResult } from "./types";

/**
 * Box do anúncio manual, em pixel — canvas quadrado (`ART_SIZE`), então a mesma constante escala
 * largura e altura. `getArtPhotoInnerBox()` já é a área ÚTIL (depois do inset) — a mesma que
 * `createMarketingCard`/`MarketingAdCanvas` usam para desenhar o produto.
 */
export function computeManualProductBoxPx(): ProductBoundingBox {
  const inner = getArtPhotoInnerBox();
  return {
    x: inner.x * ART_SIZE,
    y: inner.y * ART_SIZE,
    width: inner.width * ART_SIZE,
    height: inner.height * ART_SIZE,
  };
}

/**
 * Box do Marketing Pro (formato portrait 4:5), em pixel — canvas NÃO é quadrado (1080×1350), então x/
 * width usam a largura do formato e y/height usam a altura, cada fração aplicada à dimensão certa.
 */
export function computePremiumProductBoxPx(): ProductBoundingBox {
  const zone = MARKETING_PRO_PRODUCT_ZONE.portrait;
  const format = MARKETING_PRO_FORMAT_DIMENSIONS.portrait;
  return {
    x: zone.x * format.width,
    y: zone.y * format.height,
    width: zone.width * format.width,
    height: zone.height * format.height,
  };
}

/**
 * §8: `scale` é exatamente o que `calculateProductContainTransform` devolve — nenhuma fórmula paralela,
 * nenhum corte de severidade em graus aqui. `upscaleRequired` é só `scale > 1`, nada além disso.
 * `null` quando o próprio PRO-07B recusa a entrada (ex.: dimensões inválidas) — nunca inventa um número.
 */
export function computeBoxCalibration(
  sourceAssetId: string,
  metrics: Pick<ProductImageQualityMetrics, "width" | "height">,
  box: ProductBoundingBox,
): ProductImageCalibrationBoxResult | null {
  const result = calculateProductContainTransform({
    sourceAssetId,
    source: { width: metrics.width, height: metrics.height },
    bounds: box,
    padding: 0,
  });
  if (!result.accepted || !result.transform) return null;
  const { transform } = result;
  return {
    boxWidth: box.width,
    boxHeight: box.height,
    renderedWidth: transform.targetWidth,
    renderedHeight: transform.targetHeight,
    scale: transform.scale,
    upscaleRequired: transform.scale > 1,
  };
}
