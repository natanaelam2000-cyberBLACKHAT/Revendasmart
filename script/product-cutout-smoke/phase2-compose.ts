/**
 * PRO-07F.4 — núcleo puro da Fase 2 (composição local real). Separado do servidor HTTP
 * (phase2-server.ts) especificamente para ser testável em Node puro, sem precisar de um browser:
 * recebe os buffers RGBA/máscara JÁ decodificados (o decode em si só acontece no browser, via
 * ./phase2-harness.html — este módulo nunca decodifica JPEG/PNG, só compõe e valida).
 *
 * Executa, nesta ordem: FAIL CLOSED de dimensões -> composeProductCutoutRgba (real, PRO-07F.2B/3A) ->
 * evaluateProductCutoutPixelGate (chamado de novo, EXPLICITAMENTE, além do já embutido no composer) ->
 * confirmação independente pixel a pixel de R/G/B (rgbDifferentPixels), separada do Gate.
 */
import {
  composeProductCutoutRgba,
  evaluateProductCutoutPixelGate,
  type ProductCutoutMaskBuffer,
  type ProductCutoutOriginalRgbaBuffer,
} from "../../shared/product-cutout";

export interface Phase2ComposeInput {
  readonly expectedWidth: number;
  readonly expectedHeight: number;
  readonly sourceAssetId: string;
  readonly coordinateSpaceVersion: ProductCutoutOriginalRgbaBuffer["coordinateSpaceVersion"];
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  /** RGBA do source, já decodificado (4 bytes/pixel) — nunca mutado por esta função. */
  readonly sourceRgba: Uint8ClampedArray;
  readonly maskWidth: number;
  readonly maskHeight: number;
  /** Só o canal de máscara (1 byte/pixel) — nunca RGB da máscara. Nunca mutado por esta função. */
  readonly maskAlpha: Uint8ClampedArray;
}

export type Phase2ComposeResult =
  | {
      readonly composerAccepted: false;
      readonly pixelGateAccepted: false;
      readonly rgbDifferentPixels: null;
      readonly reason: string;
    }
  | {
      readonly composerAccepted: true;
      readonly pixelGateAccepted: boolean;
      readonly rgbDifferentPixels: number;
      readonly accepted: boolean;
      /** RGBA final (source RGB + alpha do provider) — só presente quando `accepted` é true. */
      readonly cutoutRgba?: Uint8ClampedArray;
    };

export function runPhase2Composition(input: Phase2ComposeInput): Phase2ComposeResult {
  // §3: FAIL CLOSED — dimensões do source decodificado precisam bater com o esperado (conhecido de
  // antemão, sem decodificar nada) antes de qualquer composição.
  if (input.sourceWidth !== input.expectedWidth || input.sourceHeight !== input.expectedHeight) {
    return { composerAccepted: false, pixelGateAccepted: false, rgbDifferentPixels: null, reason: "source-dimensions-mismatch" };
  }
  if (input.maskWidth !== input.expectedWidth || input.maskHeight !== input.expectedHeight) {
    return { composerAccepted: false, pixelGateAccepted: false, rgbDifferentPixels: null, reason: "mask-dimensions-mismatch" };
  }

  const originalRgba: ProductCutoutOriginalRgbaBuffer = {
    data: input.sourceRgba,
    width: input.sourceWidth,
    height: input.sourceHeight,
    sourceAssetId: input.sourceAssetId,
    coordinateSpaceVersion: input.coordinateSpaceVersion,
  };
  const mask: ProductCutoutMaskBuffer = {
    data: input.maskAlpha,
    width: input.maskWidth,
    height: input.maskHeight,
    sourceAssetId: input.sourceAssetId,
    coordinateSpaceVersion: input.coordinateSpaceVersion,
  };

  // §5: composer REAL — nunca reimplementado aqui.
  const composition = composeProductCutoutRgba({ originalRgba, mask, width: input.sourceWidth, height: input.sourceHeight });
  if (!composition.accepted) {
    return { composerAccepted: false, pixelGateAccepted: false, rgbDifferentPixels: null, reason: composition.errors[0]?.code || "compose-rejected" };
  }

  // §6: Pixel Gate chamado EXPLICITAMENTE de novo (composeProductCutoutRgba já roda um internamente —
  // esta chamada extra é a "execução obrigatória" pedida, independente da interna).
  const explicitGate = evaluateProductCutoutPixelGate({
    original: originalRgba,
    cutout: composition.cutout,
    mask,
    width: input.sourceWidth,
    height: input.sourceHeight,
  });

  // §6: confirmação independente, pixel a pixel, fora do Gate — nunca confia só no motor de validação.
  let rgbDifferentPixels = 0;
  const pixelCount = input.sourceWidth * input.sourceHeight;
  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
    const offset = pixelIndex * 4;
    if (
      originalRgba.data[offset] !== composition.rgba[offset]
      || originalRgba.data[offset + 1] !== composition.rgba[offset + 1]
      || originalRgba.data[offset + 2] !== composition.rgba[offset + 2]
    ) {
      rgbDifferentPixels += 1;
    }
  }

  const pixelGateAccepted = composition.pixelGate.accepted && explicitGate.accepted;
  const accepted = pixelGateAccepted && rgbDifferentPixels === 0;

  return {
    composerAccepted: true,
    pixelGateAccepted,
    rgbDifferentPixels,
    accepted,
    cutoutRgba: accepted ? composition.rgba : undefined,
  };
}
