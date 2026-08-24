/**
 * PRO-07 — orquestração real de "Remover fundo": decodifica a foto do produto, roda a heurística local
 * (`product-cutout-local-heuristic.ts`), compõe o cutout pelo Pixel Preservation Gate já existente
 * (`shared/product-cutout.ts`) e, só quando o usuário confirma, envia pelo endpoint de upload já
 * existente (`server/uploads.ts`, kind "cutout") e persiste `product.approvedCutout`
 * (`shared/approved-product-cutout.ts`) — o mesmo campo que `MarketingProPanel`/Composer V2 já sabiam
 * ler, mas que nenhum fluxo real escrevia até agora.
 *
 * Nada aqui chama IA/provider externo — é 100% processamento local (canvas + pixels).
 */
import { getFirestore, doc, setDoc } from "firebase/firestore";
import { uploadImageViaServer, type ServerUploadResult } from "@/lib/server-upload";
import type { ResolvedMarketingImage } from "@/lib/marketing-image";
import { createProductAssetOriginal } from "@/lib/marketing-product-preservation";
import { removeBackgroundLocalHeuristic } from "@/lib/product-cutout-local-heuristic";
import { composeProductCutoutRgba, type ComposeProductCutoutRgbaResult } from "@shared/product-cutout";
import { buildApprovedProductCutoutForPersistence, type ApprovedProductCutout } from "@shared/approved-product-cutout";
import { PRODUCT_IMAGE_COORDINATE_SPACE_VERSION } from "@shared/product-image-coordinate-space";

export type DecodedRgbaImage = { readonly data: Uint8ClampedArray; readonly width: number; readonly height: number };
export type DecodeImageToRgba = (safeSrc: string) => Promise<DecodedRgbaImage | null>;

/** Decoder real (o único usado em produção): `new Image()` + canvas 2D — mesmo mecanismo que
 * `marketing-image.ts`/`product-image-metadata.ts` já usam para o resto do pipeline de produto. */
async function defaultDecodeImageToRgba(safeSrc: string): Promise<DecodedRgbaImage | null> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      const width = image.naturalWidth || image.width;
      const height = image.naturalHeight || image.height;
      if (!width || !height) {
        resolve(null);
        return;
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve(null);
        return;
      }
      ctx.drawImage(image, 0, 0, width, height);
      try {
        const imageData = ctx.getImageData(0, 0, width, height);
        resolve({ data: imageData.data, width, height });
      } catch {
        // canvas "tainted" por CORS — decodificação falhou, nunca produz um recorte a partir de lixo.
        resolve(null);
      }
    };
    image.onerror = () => resolve(null);
    image.src = safeSrc;
  });
}

export type ProductCutoutGenerationFailureReason = "decode-failed" | "background-not-detected" | "compose-rejected";

export type ProductCutoutGenerationResult =
  | {
      readonly ok: true;
      readonly composed: Extract<ComposeProductCutoutRgbaResult, { readonly accepted: true }>;
      readonly assetId: string;
      readonly width: number;
      readonly height: number;
    }
  | { readonly ok: false; readonly reason: ProductCutoutGenerationFailureReason };

/**
 * Gera o cutout em memória (nunca faz upload/persistência aqui — isso é `saveApprovedProductCutout`,
 * chamado só quando o usuário confirma "Usar no anúncio"). Permite preview/undo sem nenhum efeito
 * colateral de rede.
 */
export async function generateProductCutoutRgba(
  productId: string,
  resolvedImage: ResolvedMarketingImage,
  dependencies: { decodeImageToRgba?: DecodeImageToRgba } = {},
): Promise<ProductCutoutGenerationResult> {
  const decode = dependencies.decodeImageToRgba || defaultDecodeImageToRgba;
  const decoded = await decode(resolvedImage.safeSrc);
  if (!decoded) return { ok: false, reason: "decode-failed" };

  const asset = createProductAssetOriginal(productId, resolvedImage);
  const heuristic = removeBackgroundLocalHeuristic({ data: decoded.data, width: decoded.width, height: decoded.height });
  if (!heuristic.ok) return { ok: false, reason: "background-not-detected" };

  const composed = composeProductCutoutRgba({
    originalRgba: {
      data: decoded.data,
      width: decoded.width,
      height: decoded.height,
      sourceAssetId: asset.assetId,
      coordinateSpaceVersion: PRODUCT_IMAGE_COORDINATE_SPACE_VERSION,
    },
    mask: {
      data: heuristic.mask,
      width: decoded.width,
      height: decoded.height,
      coordinateSpaceVersion: PRODUCT_IMAGE_COORDINATE_SPACE_VERSION,
      sourceAssetId: asset.assetId,
    },
    width: decoded.width,
    height: decoded.height,
  });
  if (!composed.accepted) return { ok: false, reason: "compose-rejected" };

  return { ok: true, composed, assetId: asset.assetId, width: decoded.width, height: decoded.height };
}

/** Canvas -> PNG real (bytes de verdade, não um "preview fingido"). */
export async function renderCutoutRgbaToPngBlob(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
): Promise<Blob | null> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const imageData = new ImageData(new Uint8ClampedArray(rgba), width, height);
  ctx.putImageData(imageData, 0, 0);
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), "image/png"));
}

export interface SaveApprovedProductCutoutInput {
  readonly uid: string;
  readonly productId: string;
  readonly pngBlob: Blob;
  readonly token: string;
  readonly composed: Extract<ComposeProductCutoutRgbaResult, { readonly accepted: true }>;
  readonly sourceAssetId: string;
}

/**
 * Único ponto que faz rede/escrita: sobe o PNG pelo endpoint já existente (`kind: "cutout"`, quota e
 * validação de magic bytes já aplicadas server-side) e grava `product.approvedCutout` — NUNCA sobrescreve
 * `imageUrl`/`imageId`/`photoUrl` do produto original.
 */
export async function saveApprovedProductCutout(
  input: SaveApprovedProductCutoutInput,
  dependencies: { upload?: typeof uploadImageViaServer } = {},
): Promise<ApprovedProductCutout> {
  const upload = dependencies.upload || uploadImageViaServer;
  const uploadResult: ServerUploadResult = await upload({ kind: "cutout", targetId: input.productId, blob: input.pngBlob, token: input.token });

  const cutoutAssetId = `product-cutout-approved:${input.productId}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`;
  const cutout = buildApprovedProductCutoutForPersistence({
    composed: input.composed,
    sourceAssetId: input.sourceAssetId,
    cutoutAssetId,
    storagePath: uploadResult.storagePath,
    downloadUrl: uploadResult.downloadUrl,
    method: "local-heuristic",
    provider: "local-heuristic-v1",
  });

  const firestore = getFirestore();
  await setDoc(doc(firestore, "users", input.uid, "products", input.productId), { approvedCutout: cutout }, { merge: true });

  return cutout;
}
