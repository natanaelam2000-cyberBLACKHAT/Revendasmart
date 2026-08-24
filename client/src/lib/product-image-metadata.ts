/**
 * PRO-07E.1 — extração de metadados do File/Blob ORIGINAL, antes de qualquer compressão.
 *
 * A auditoria PRO-07E-PREP confirmou que a etapa de compressão em add-product.tsx é o único ponto que
 * toca a foto recém-selecionada, e que o arquivo original nunca é persistido — só o derivado comprimido
 * chega à Storage. Por isso a extração daqui precisa rodar ANTES dessa etapa, sobre o `File` bruto:
 * depois disso a informação sobre a captura original já não existe mais em lugar nenhum.
 *
 * Este módulo só LÊ o arquivo (decodifica para saber width/height) — nunca comprime, nunca converte,
 * nunca salva, nunca modifica o arquivo recebido.
 *
 * O passo de decode (`decodeImageDimensions`) é injetável, no mesmo padrão já usado em
 * `marketing-image.ts` (`MarketingImageResolverDependencies`) — existe especificamente para permitir
 * testar a orquestração (arquivo vazio → empty-file, decode falho → decode-failed, decode ok → metrics)
 * sem precisar de um DOM real, já que `smoke-tests.ts` roda em Node puro.
 */

import {
  assessProductImageQuality,
  PRODUCT_IMAGE_QUALITY_ASSESSOR_VERSION,
  type ProductImageQualityAssessment,
  type ProductImageQualityMetrics,
  type ProductImageQualityPolicy,
} from "@shared/product-image-quality";
import { PRODUCT_IMAGE_COORDINATE_SPACE_VERSION, type CanonicalDecodedImage } from "@shared/product-image-coordinate-space";

export type ProductImageMetadataExtractionFailureReason = "empty-file" | "decode-failed";

export type ProductImageMetadataExtractionResult =
  | { readonly ok: true; readonly metrics: ProductImageQualityMetrics }
  | { readonly ok: false; readonly reason: ProductImageMetadataExtractionFailureReason };

export type DecodeImageDimensions = (file: File | Blob) => Promise<{ width: number; height: number } | null>;

export interface ProductImageMetadataExtractionDependencies {
  decodeImageDimensions?: DecodeImageDimensions;
}

function normalizeMimeType(value: string): string {
  return String(value || "").trim().toLowerCase().split(";")[0]?.trim() ?? "";
}

/**
 * PRO-07F.2A: primitive de decode ÚNICA, compartilhada com o redimensionamento em add-product.tsx (que
 * antes tinha sua própria cópia de `new Image()` + `URL.createObjectURL`) e com `decodeDataUrl`
 * (marketing-image.ts, que já usa o mesmo mecanismo por padrão coincidente, não por construção).
 * Só lê/decodifica — nunca desenha em canvas, nunca reencoda. A URL do objeto é revogada assim que
 * `onload`/`onerror` dispara; o elemento decodificado continua desenhável normalmente depois disso.
 */
export function loadOrientedImageElement(file: File | Blob): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(null);
    };
    image.src = objectUrl;
  });
}

async function decodeImageDimensionsViaBrowser(file: File | Blob): Promise<{ width: number; height: number } | null> {
  const image = await loadOrientedImageElement(file);
  if (!image) return null;
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  return width > 0 && height > 0 ? { width, height } : null;
}

/**
 * Só leitura: byteSize/mimeType vêm direto do `File`/`Blob` recebido; width/height vêm do decode. Nunca
 * comprime, nunca converte, nunca persiste. `byteSize <= 0` nem tenta decodificar — não há o que ler.
 */
export async function extractProductImageMetadata(
  file: File | Blob,
  dependencies: ProductImageMetadataExtractionDependencies = {},
): Promise<ProductImageMetadataExtractionResult> {
  const byteSize = file.size;
  const mimeType = normalizeMimeType(file.type || "");
  if (!(byteSize > 0)) return { ok: false, reason: "empty-file" };

  const decode = dependencies.decodeImageDimensions || decodeImageDimensionsViaBrowser;
  const dimensions = await decode(file);
  if (!dimensions) return { ok: false, reason: "decode-failed" };

  const { width, height } = dimensions;
  return {
    ok: true,
    metrics: {
      width,
      height,
      megapixels: (width * height) / 1_000_000,
      byteSize,
      aspectRatio: width / height,
      mimeType,
    },
  };
}

/** Metrics-sentinela para uma extração que falhou — width/height/aspectRatio/megapixels ficam `NaN` (não decodificados, nunca 0 fingido). byteSize/mimeType são o que realmente se sabe do arquivo, mesmo sem decode. */
function buildExtractionFailureMetrics(file: File | Blob): ProductImageQualityMetrics {
  return {
    width: NaN,
    height: NaN,
    megapixels: NaN,
    byteSize: file.size,
    aspectRatio: NaN,
    mimeType: normalizeMimeType(file.type || ""),
  };
}

/**
 * Orquestração completa: extrai metadados do arquivo ORIGINAL e classifica contra a policy recebida.
 * Falha de extração (`empty-file`/`decode-failed`) sempre vira `unusable` — o mesmo arquivo que falha
 * aqui também falharia na etapa de compressão do produto (mesmo mecanismo de decode), então não é um
 * bloqueio NOVO.
 *
 * Chamar isto sobre o arquivo comprimido/derivado produziria uma avaliação de OUTRA coisa — por isso o
 * chamador deve nomear o resultado como "avaliação do original" (`sourceAssessment`, não um nome
 * genérico), nunca reaproveitar o mesmo campo para uma futura avaliação do derivado.
 */
export async function assessRawProductImage(
  file: File | Blob,
  policy: ProductImageQualityPolicy,
  dependencies: ProductImageMetadataExtractionDependencies = {},
): Promise<ProductImageQualityAssessment> {
  const extraction = await extractProductImageMetadata(file, dependencies);
  if (!extraction.ok) {
    return {
      status: "unusable",
      reasons: [extraction.reason],
      metrics: buildExtractionFailureMetrics(file),
      assessorVersion: PRODUCT_IMAGE_QUALITY_ASSESSOR_VERSION,
    };
  }
  return assessProductImageQuality(extraction.metrics, policy);
}

export type CanonicalProductImageDecodeResult =
  | { readonly ok: true; readonly image: CanonicalDecodedImage }
  | { readonly ok: false; readonly reason: ProductImageMetadataExtractionFailureReason };

/**
 * PRO-07F.1 — decodifica um File/Blob no coordinate space canônico do pipeline (largura/altura já
 * orientadas por EXIF). Construído LITERALMENTE em cima de `extractProductImageMetadata` — não é uma
 * segunda implementação de decode, é a MESMA chamada reembalada. Por isso os dois nunca podem divergir
 * em width/height: qualquer mudança no decoder usado por um se reflete automaticamente no outro.
 *
 * `decodeMethod` é sempre `"html-image-element"` porque o decoder default (`decodeImageDimensionsViaBrowser`,
 * acima) é `new Image()` — o único mecanismo de decode realmente usado em produção hoje (PRO-07F.0). Se
 * `createImageBitmap` for introduzido no futuro, este é o lugar a atualizar — nunca sem
 * `imageOrientation: "from-image"` explícito.
 */
export async function decodeCanonicalProductImage(
  file: File | Blob,
  dependencies: ProductImageMetadataExtractionDependencies = {},
): Promise<CanonicalProductImageDecodeResult> {
  const extraction = await extractProductImageMetadata(file, dependencies);
  if (!extraction.ok) return { ok: false, reason: extraction.reason };
  return {
    ok: true,
    image: {
      width: extraction.metrics.width,
      height: extraction.metrics.height,
      orientationNormalized: true,
      decodeMethod: "html-image-element",
      coordinateSpaceVersion: PRODUCT_IMAGE_COORDINATE_SPACE_VERSION,
    },
  };
}
