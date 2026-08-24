/**
 * PRO-07F.3B-FIX §1/§2 — módulo puro, sem `main()`, para poder ser importado com segurança por
 * testes (cli.ts tem um `main()` incondicional no escopo do módulo, igual antes desta sprint —
 * importar cli.ts diretamente dispararia essa execução; este arquivo existe para nunca precisar
 * disso).
 */
import { PRODUCT_IMAGE_COORDINATE_SPACE_VERSION } from "../../shared/product-image-coordinate-space";
import type { ProductCutoutOriginalRgbaBuffer } from "../../shared/product-cutout";
import { decodePngToRgba } from "./png";

/**
 * Decodifica o SOURCE localmente SOMENTE quando ele já é PNG — reaproveita o MESMO decoder de
 * ./png.ts usado para a mask, desta vez aplicado a um arquivo que de fato é PNG. Para qualquer outro
 * formato (JPEG, WebP, ...) devolve `undefined`: nunca tenta decodificar, nunca escreve um parser
 * novo. O decode orientation-aware de verdade já existe no browser
 * (client/src/lib/product-image-metadata.ts) — este harness Node não duplica isso.
 */
export function decodeSourceRgbaIfPossible(
  sourceImageBytes: Uint8Array,
  mimeType: string,
  sourceAssetId: string,
): ProductCutoutOriginalRgbaBuffer | undefined {
  if (mimeType !== "image/png") return undefined;
  const decoded = decodePngToRgba(sourceImageBytes);
  return { data: decoded.data, width: decoded.width, height: decoded.height, sourceAssetId, coordinateSpaceVersion: PRODUCT_IMAGE_COORDINATE_SPACE_VERSION };
}
