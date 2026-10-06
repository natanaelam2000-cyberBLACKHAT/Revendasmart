import { useCallback, useEffect, useRef, useState } from "react";
import { getProductImage, type Product } from "@/lib/mock-data";
import type { ResolvedMarketingImage } from "@/lib/marketing-image";
import {
  STUDIO_CUTOUT_FAILURE_MESSAGES,
  generateStudioLocalCutout,
  loadStudioApprovedCutout,
  loadStudioLogo,
  loadStudioProductPhoto,
  loadStudioStaticBackground,
  readStudioImagePixels,
  type StudioImage,
} from "@/lib/ads-pro-studio-assets";
import type { RgbaImage } from "@shared/ads-pro/ad-photo-adjust";
import type { MarketingProBackgroundAsset } from "@shared/marketing-pro-background-library";

export type StudioPhotoStatus = "loading" | "ready" | "no-image" | "load-failed";

export interface StudioAssetsApi {
  readonly photoStatus: StudioPhotoStatus;
  /** Foto original do produto (decodificada). Nunca é alterada: os ajustes vivem numa cópia. */
  readonly original: StudioImage | null;
  readonly cutout: StudioImage | null;
  readonly cutoutSource: "approved" | "local" | null;
  readonly cutoutBusy: boolean;
  /** Mensagem da última tentativa de recorte que não funcionou (null = nenhuma falha). */
  readonly cutoutFailure: string | null;
  readonly logo: CanvasImageSource | null;
  /** Gera o recorte LOCAL (grátis, no aparelho). Nunca lança; `false` = segue com a foto original. */
  readonly generateCutout: () => Promise<boolean>;
  readonly readPixels: () => RgbaImage | null;
}

function imageSignature(product: Product | undefined): string {
  if (!product) return "";
  return `${product.id}|${getProductImage(product) ?? ""}|${product.imageId ?? ""}|${product.approvedCutout?.cutoutAssetId ?? ""}`;
}

/** Carrega foto, recorte aprovado e logo; expõe o recorte local sob demanda. Nada aqui chama API paga. */
export function useStudioAssets(product: Product | undefined, logoUrl: string | undefined): StudioAssetsApi {
  const [photoStatus, setPhotoStatus] = useState<StudioPhotoStatus>("loading");
  const [original, setOriginal] = useState<StudioImage | null>(null);
  const [cutout, setCutout] = useState<StudioImage | null>(null);
  const [cutoutSource, setCutoutSource] = useState<"approved" | "local" | null>(null);
  const [cutoutBusy, setCutoutBusy] = useState(false);
  const [cutoutFailure, setCutoutFailure] = useState<string | null>(null);
  const [logo, setLogo] = useState<CanvasImageSource | null>(null);
  const resolvedRef = useRef<ResolvedMarketingImage | null>(null);
  const productRef = useRef<Product | undefined>(product);
  const busyRef = useRef(false);
  const signature = imageSignature(product);

  productRef.current = product;

  useEffect(() => {
    let cancelled = false;
    const current = productRef.current;
    resolvedRef.current = null;
    setOriginal(null);
    setCutout(null);
    setCutoutSource(null);
    setCutoutFailure(null);
    if (!current) {
      setPhotoStatus("no-image");
      return () => { cancelled = true; };
    }
    setPhotoStatus("loading");
    void (async () => {
      const loaded = await loadStudioProductPhoto(current);
      if (cancelled) return;
      if (!loaded.ok) {
        setPhotoStatus(loaded.reason === "no-image" ? "no-image" : "load-failed");
        return;
      }
      resolvedRef.current = loaded.resolved;
      setOriginal(loaded.image);
      setPhotoStatus("ready");
      const approved = await loadStudioApprovedCutout(current);
      if (cancelled || !approved) return;
      setCutout(approved);
      setCutoutSource("approved");
    })();
    return () => { cancelled = true; };
  }, [signature]);

  useEffect(() => {
    let cancelled = false;
    setLogo(null);
    void loadStudioLogo(logoUrl).then((image) => { if (!cancelled) setLogo(image); });
    return () => { cancelled = true; };
  }, [logoUrl]);

  const generateCutout = useCallback(async (): Promise<boolean> => {
    const current = productRef.current;
    const resolved = resolvedRef.current;
    if (busyRef.current || !current) return false;
    if (!resolved) {
      setCutoutFailure(STUDIO_CUTOUT_FAILURE_MESSAGES["no-image"]);
      return false;
    }
    busyRef.current = true;
    setCutoutBusy(true);
    setCutoutFailure(null);
    try {
      const result = await generateStudioLocalCutout(current, resolved);
      if (productRef.current?.id !== current.id) return false; // trocou de produto no meio: descarta
      if (!result.ok) {
        setCutoutFailure(STUDIO_CUTOUT_FAILURE_MESSAGES[result.reason]);
        return false;
      }
      setCutout(result.image);
      setCutoutSource("local");
      return true;
    } catch {
      setCutoutFailure(STUDIO_CUTOUT_FAILURE_MESSAGES["decode-failed"]);
      return false;
    } finally {
      busyRef.current = false;
      setCutoutBusy(false);
    }
  }, []);

  const readPixels = useCallback((): RgbaImage | null => {
    if (!original) return null;
    try {
      return readStudioImagePixels(original);
    } catch {
      return null;
    }
  }, [original]);

  return { photoStatus, original, cutout, cutoutSource, cutoutBusy, cutoutFailure, logo, generateCutout, readPixels };
}

export type StudioBackgroundImageStatus = "none" | "loading" | "ready" | "failed";

/**
 * Imagem do fundo ESTÁTICO do anúncio. Falhar não derruba nada: o renderizador usa um degradê neutro.
 * `variant: "thumbnail"` carrega a miniatura leve (grade de escolha) em vez da imagem inteira.
 */
export function useStaticBackgroundImage(
  asset: MarketingProBackgroundAsset | undefined,
  variant: "full" | "thumbnail" = "full",
): { readonly image: HTMLImageElement | null; readonly status: StudioBackgroundImageStatus } {
  const [state, setState] = useState<{ readonly url: string; readonly image: HTMLImageElement | null; readonly status: StudioBackgroundImageStatus }>({ url: "", image: null, status: "none" });
  const url = asset && asset.sourceType === "STATIC_ASSET" ? (variant === "thumbnail" ? asset.thumbnailUrl ?? asset.staticUrl : asset.staticUrl) : "";

  useEffect(() => {
    if (!url) {
      setState({ url: "", image: null, status: "none" });
      return;
    }
    let cancelled = false;
    setState({ url, image: null, status: "loading" });
    void loadStudioStaticBackground(url).then((image) => {
      if (!cancelled) setState({ url, image, status: image ? "ready" : "failed" });
    });
    return () => { cancelled = true; };
  }, [url]);

  // Enquanto a URL do estado ainda é a do fundo anterior, nada é entregue (nunca desenha o fundo errado).
  if (state.url !== url) return { image: null, status: url ? "loading" : "none" };
  return { image: state.image, status: state.status };
}
