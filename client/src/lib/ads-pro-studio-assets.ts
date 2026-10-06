/**
 * ADS-PRO-FINAL — carregamento e preparo das imagens do estúdio (foto, recorte, logo, fundo estático).
 *
 * Princípios:
 *  - A foto ORIGINAL nunca é modificada nem sobrescrita: o ajuste vive numa CÓPIA em canvas; o documento
 *    do anúncio guarda só os parâmetros. Nada aqui grava no produto.
 *  - Recorte de fundo é 100% local (flood-fill, `product-cutout-pipeline.ts`): zero IA, zero rede, zero custo.
 *    Se falhar, o estúdio segue com a foto original — o fluxo nunca fica refém do recorte.
 */
import {
  resolveMarketingImageSource,
  MarketingImageResolutionError,
  type ResolvedMarketingImage,
} from "@/lib/marketing-image";
import { generateProductCutoutRgba, type ProductCutoutGenerationFailureReason } from "@/lib/product-cutout-pipeline";
import { applyPhotoAdjust, estimateEdgeColor, type RgbaImage } from "@shared/ads-pro/ad-photo-adjust";
import { isNeutralPhotoAdjust, type AdsProAdDocumentV1, type AdsProPhotoAdjust } from "@shared/ads-pro/ad-document";
import type { AdsProPreparedPhoto, AdsProRenderAssets } from "@/lib/ads-pro-studio-render";
import type { Product } from "@/lib/mock-data";

export const STUDIO_PREVIEW_MAX_SIDE = 960;
export const STUDIO_EXPORT_MAX_SIDE = 1800;

/** Imagem decodificada pronta para ser reprocessada (ajuste) em qualquer resolução. */
export interface StudioImage {
  /** Identidade estável da origem (muda quando a foto/recorte muda). */
  readonly key: string;
  readonly source: CanvasImageSource;
  readonly width: number;
  readonly height: number;
}

export type StudioPhotoLoadResult =
  | { readonly ok: true; readonly image: StudioImage; readonly resolved: ResolvedMarketingImage }
  | { readonly ok: false; readonly reason: "no-image" | "load-failed" };

export function loadImageElement(src: string, crossOrigin: "anonymous" | null = "anonymous"): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    if (crossOrigin) image.crossOrigin = crossOrigin;
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Falha ao carregar imagem: ${src.slice(0, 80)}`));
    image.src = src;
  });
}

/** Carrega a foto do produto (qualquer origem que o Marketing já enxerga: URL, Storage, imageId local). */
export async function loadStudioProductPhoto(product: Product): Promise<StudioPhotoLoadResult> {
  let resolved: ResolvedMarketingImage | null;
  try {
    resolved = await resolveMarketingImageSource(product);
  } catch (error) {
    return { ok: false, reason: error instanceof MarketingImageResolutionError ? "load-failed" : "load-failed" };
  }
  if (!resolved) return { ok: false, reason: "no-image" };
  try {
    const element = await loadImageElement(resolved.safeSrc, null);
    return {
      ok: true,
      resolved,
      image: { key: `photo:${product.id}:${resolved.sourceUrl}:${resolved.width}x${resolved.height}`, source: element, width: element.naturalWidth || resolved.width, height: element.naturalHeight || resolved.height },
    };
  } catch {
    return { ok: false, reason: "load-failed" };
  }
}

/** Carrega o recorte já aprovado do produto (Storage), quando existir. */
export async function loadStudioApprovedCutout(product: Product): Promise<StudioImage | null> {
  const cutout = product.approvedCutout;
  const src = cutout?.downloadUrl || cutout?.storagePath;
  if (!cutout || !src) return null;
  try {
    const element = await loadImageElement(src, "anonymous");
    return { key: `cutout:${cutout.cutoutAssetId}`, source: element, width: element.naturalWidth, height: element.naturalHeight };
  } catch {
    return null;
  }
}

export type LocalCutoutResult =
  | { readonly ok: true; readonly image: StudioImage; readonly generation: Extract<Awaited<ReturnType<typeof generateProductCutoutRgba>>, { ok: true }> }
  | { readonly ok: false; readonly reason: ProductCutoutGenerationFailureReason };

/** Recorte local gratuito (flood-fill a partir das bordas). Nunca lança: falha vira `ok:false`. */
export async function generateStudioLocalCutout(product: Product, resolved: ResolvedMarketingImage): Promise<LocalCutoutResult> {
  try {
    const generation = await generateProductCutoutRgba(product.id, resolved);
    if (!generation.ok) return { ok: false, reason: generation.reason };
    const canvas = document.createElement("canvas");
    canvas.width = generation.width;
    canvas.height = generation.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return { ok: false, reason: "decode-failed" };
    ctx.putImageData(new ImageData(new Uint8ClampedArray(generation.composed.rgba), generation.width, generation.height), 0, 0);
    return { ok: true, generation, image: { key: `local-cutout:${product.id}:${generation.assetId}`, source: canvas, width: generation.width, height: generation.height } };
  } catch {
    return { ok: false, reason: "decode-failed" };
  }
}

// ---------------------------------------------------------------------------------------------
// Preparo (ajustes) com cache pequeno
// ---------------------------------------------------------------------------------------------

const PREPARED_CACHE_LIMIT = 8;
const preparedCache = new Map<string, AdsProPreparedPhoto>();

function adjustKey(adjust: AdsProPhotoAdjust): string {
  return `${adjust.brightness}|${adjust.contrast}|${adjust.saturation}|${adjust.sharpness}`;
}

/** Desenha `image` em canvas com no máximo `maxSide` px (nunca amplia) e devolve o ImageData. */
function rasterize(image: StudioImage, maxSide: number): { canvas: HTMLCanvasElement; imageData: ImageData } {
  const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas 2D indisponível.");
  ctx.drawImage(image.source, 0, 0, width, height);
  return { canvas, imageData: ctx.getImageData(0, 0, width, height) };
}

/**
 * Aplica os ajustes numa CÓPIA da imagem (a original continua intacta) e devolve o que o renderizador
 * desenha. `maxSide` pequeno no preview (arrastar sliders fica instantâneo), grande na exportação.
 */
export function prepareStudioPhoto(image: StudioImage, adjust: AdsProPhotoAdjust, maxSide: number): AdsProPreparedPhoto {
  const cacheKey = `${image.key}|${maxSide}|${adjustKey(adjust)}`;
  const cached = preparedCache.get(cacheKey);
  if (cached) return cached;
  const { canvas, imageData } = rasterize(image, maxSide);
  let output = canvas;
  let edgeSource: RgbaImage = { data: imageData.data, width: imageData.width, height: imageData.height };
  if (!isNeutralPhotoAdjust(adjust)) {
    const adjusted = applyPhotoAdjust(edgeSource, adjust);
    const adjustedCanvas = document.createElement("canvas");
    adjustedCanvas.width = adjusted.width;
    adjustedCanvas.height = adjusted.height;
    adjustedCanvas.getContext("2d")?.putImageData(new ImageData(adjusted.data, adjusted.width, adjusted.height), 0, 0);
    output = adjustedCanvas;
    edgeSource = adjusted;
  }
  const prepared: AdsProPreparedPhoto = { source: output, width: output.width, height: output.height, edgeColor: estimateEdgeColor(edgeSource) };
  preparedCache.set(cacheKey, prepared);
  if (preparedCache.size > PREPARED_CACHE_LIMIT) {
    const oldest = preparedCache.keys().next().value;
    if (oldest !== undefined) preparedCache.delete(oldest);
  }
  return prepared;
}

/** Lê os pixels da imagem (para análise automática de exposição). Amostra reduzida: rápido e barato. */
export function readStudioImagePixels(image: StudioImage, maxSide = 480): RgbaImage {
  const { imageData } = rasterize(image, maxSide);
  return { data: imageData.data, width: imageData.width, height: imageData.height };
}

export async function loadStudioLogo(url: string | undefined): Promise<HTMLImageElement | null> {
  if (!url) return null;
  try {
    return await loadImageElement(url, "anonymous");
  } catch {
    return null;
  }
}

export async function loadStudioStaticBackground(url: string): Promise<HTMLImageElement | null> {
  try {
    return await loadImageElement(url, null);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------------
// Montagem dos insumos de render (preview, miniaturas e exportação usam o mesmo caminho)
// ---------------------------------------------------------------------------------------------

export const STUDIO_THUMB_MAX_SIDE = 420;

/** Mensagens honestas quando o recorte local não funciona — o anúncio segue com a foto original. */
export const STUDIO_CUTOUT_FAILURE_MESSAGES: Readonly<Record<ProductCutoutGenerationFailureReason | "no-image" | "load-failed", string>> = Object.freeze({
  "no-image": "Este produto não tem foto cadastrada.",
  "load-failed": "Não foi possível carregar a foto deste produto.",
  "decode-failed": "Não foi possível processar esta foto.",
  "background-not-detected": "Não achamos um fundo liso para remover nesta foto. O anúncio continua com a foto original.",
  "compose-rejected": "A remoção não passou na checagem de preservação do produto — nada foi alterado.",
});

export interface BuildStudioRenderAssetsInput {
  readonly doc: AdsProAdDocumentV1;
  readonly original: StudioImage | null;
  readonly cutout: StudioImage | null;
  readonly logo: CanvasImageSource | null;
  readonly backgroundImage: CanvasImageSource | null;
  readonly maxSide: number;
}

/**
 * Documento que de fato é desenhado: "sem fundo" sem recorte disponível (ex.: projeto reaberto antes do
 * recorte ser refeito) vira foto inteira em vez de desenhar a foto retangular como se fosse um recorte.
 */
export function resolveStudioRenderDoc(doc: AdsProAdDocumentV1, cutoutAvailable: boolean): AdsProAdDocumentV1 {
  if (doc.photo.mode === "cutout" && !cutoutAvailable) return { ...doc, photo: { ...doc.photo, mode: "original" } };
  return doc;
}

/** Foto preparada (ajustes aplicados numa CÓPIA) + logo + fundo estático. Nunca lê nem grava o produto. */
export function buildStudioRenderAssets(input: BuildStudioRenderAssetsInput): AdsProRenderAssets {
  const useCutout = input.doc.photo.mode === "cutout" && input.cutout !== null;
  const image = useCutout ? input.cutout : input.original;
  return {
    photo: image ? prepareStudioPhoto(image, input.doc.photo.adjust, input.maxSide) : null,
    logo: input.doc.show.logo ? input.logo : null,
    backgroundImage: input.backgroundImage,
  };
}
