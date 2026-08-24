/**
 * PRO-07F.1 — Coordinate space canônico do pipeline de imagem de produto.
 *
 * Este módulo não decodifica nada — é só o CONTRATO que distingue, em nível de tipo, uma dimensão que
 * já passou por um decode orientation-aware (`CanonicalDecodedImage`) de uma dimensão física crua de
 * bitstream sem noção de EXIF (`RawBitstreamDimensions`). PRO-07F.0 confirmou que o harness Node de
 * calibração (script/marketing-pro-benchmark/image-dimensions.ts) só consegue produzir a segunda —
 * misturar as duas é exatamente o risco que motivou esta sprint.
 *
 * Decisão arquitetural (PRO-07F.1): o DERIVADO já comprimido/orientation-normalized é o coordinate
 * space canônico para `ProductAssetOriginal`/Preview/Export/futuro `ProductCutout` — não o arquivo
 * RAW. O RAW continua existindo só para `ProductImageQualityAssessment` (PRO-07E), que é
 * deliberadamente uma avaliação separada e não deve ser confundida com o coordinate space canônico.
 */

/** Versão de CONTRATO, não timestamp — muda só quando a semântica do coordinate space muda. */
export const PRODUCT_IMAGE_COORDINATE_SPACE_VERSION = "product-image-coordinate-space-v1" as const;

/**
 * PRO-07F.2A: tipo isolado do valor acima, para contratos (ex.: ProductAssetOriginal, ResolvedMarketingImage)
 * que só precisam referenciar a VERSÃO no tipo, sem importar a constante como valor.
 */
export type ProductImageCoordinateSpaceVersion = typeof PRODUCT_IMAGE_COORDINATE_SPACE_VERSION;

/**
 * Métodos de decode que aplicam EXIF Orientation antes de expor width/height — os únicos autorizados
 * a produzir um `CanonicalDecodedImage`. `create-image-bitmap-from-image` só é seguro quando
 * `imageOrientation: "from-image"` é passado explicitamente (o default da API é `"none"` — PRO-07F.0
 * §3); nada no projeto usa `createImageBitmap` hoje, mas o tipo já reserva o nome para quando/se isso
 * mudar, com a obrigação implícita de já vir orientation-aware.
 */
export type CanonicalDecodeMethod = "html-image-element" | "create-image-bitmap-from-image";

/**
 * Método usado pelo harness Node de calibração — parsing binário puro do marcador JPEG SOF0 / chunk
 * PNG IHDR, sem nenhuma leitura do marcador EXIF de orientação. Deliberadamente um tipo DIFERENTE de
 * `CanonicalDecodeMethod` (não uma união com ele) — não existe combinação de campos que permita
 * confundir os dois tipos por engano.
 */
export type RawBitstreamDecodeMethod = "raw-bitstream-no-orientation";

export type ProductImageDecodeMethod = CanonicalDecodeMethod | RawBitstreamDecodeMethod;

/**
 * Dimensão já no coordinate space canônico: width/height finais (orientados), decodificados por um
 * método que aplica EXIF, na versão de contrato atual. `orientationNormalized` é sempre `true` — mesmo
 * padrão de `allowCrop: false` do PRO-07B: uma garantia de tipo, não um booleano que pudesse ser falso.
 */
export interface CanonicalDecodedImage {
  readonly width: number;
  readonly height: number;
  readonly orientationNormalized: true;
  readonly decodeMethod: CanonicalDecodeMethod;
  readonly coordinateSpaceVersion: typeof PRODUCT_IMAGE_COORDINATE_SPACE_VERSION;
}

/**
 * Dimensão física crua do bitstream — NUNCA um `CanonicalDecodedImage`. Sem `coordinateSpaceVersion`
 * de propósito: não pertence ao coordinate space canônico, então não faz sentido ele carregar uma
 * versão dele. Usado hoje exclusivamente por script/product-image-quality-calibration/ (Node, sem
 * decode de imagem real disponível).
 */
export interface RawBitstreamDimensions {
  readonly width: number;
  readonly height: number;
  readonly decodeMethod: RawBitstreamDecodeMethod;
}

export function isCanonicalDecodeMethod(method: ProductImageDecodeMethod): method is CanonicalDecodeMethod {
  return method === "html-image-element" || method === "create-image-bitmap-from-image";
}

/**
 * Guarda de runtime equivalente à checagem de tipo: útil quando um valor chega de fora do compilador
 * (ex.: JSON persistido, dado vindo de outro processo). Lança se o método não for orientation-aware ou
 * se a versão do coordinate space não for a atual — nunca tenta "corrigir" silenciosamente.
 */
export function assertCanonicalDecodedImage(image: {
  readonly decodeMethod: string;
  readonly coordinateSpaceVersion: string;
}): void {
  if (!isCanonicalDecodeMethod(image.decodeMethod as ProductImageDecodeMethod)) {
    throw new Error(`decodeMethod "${image.decodeMethod}" não é orientation-aware — não pode ser tratado como CanonicalDecodedImage`);
  }
  if (image.coordinateSpaceVersion !== PRODUCT_IMAGE_COORDINATE_SPACE_VERSION) {
    throw new Error(`coordinateSpaceVersion "${image.coordinateSpaceVersion}" não corresponde à versão canônica atual ("${PRODUCT_IMAGE_COORDINATE_SPACE_VERSION}")`);
  }
}

/**
 * Preparação para o futuro ProductCutout (PRO-07F §9): compara o coordinate space de dois objetos
 * quaisquer (ex.: um ProductAssetOriginal e um ProductCutout) e recusa — fail-closed — se divergirem.
 * Genérico de propósito: não depende dos tipos concretos, que ainda não existem no cutout.
 */
export function assertMatchingCoordinateSpace(
  a: { readonly coordinateSpaceVersion: string },
  b: { readonly coordinateSpaceVersion: string },
): void {
  if (a.coordinateSpaceVersion !== b.coordinateSpaceVersion) {
    throw new Error(
      `coordinateSpaceVersion divergente ("${a.coordinateSpaceVersion}" !== "${b.coordinateSpaceVersion}") — recusado (fail-closed): uma máscara de outro coordinate space nunca pode ser aplicada.`,
    );
  }
}
