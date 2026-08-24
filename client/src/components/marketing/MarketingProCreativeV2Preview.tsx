import { useEffect, useRef, useState } from "react";
import type { MarketingProCreativeV2Payload } from "@/lib/marketing-pro-creative-v2";
import { renderPremiumCreativeV2 } from "@/lib/marketing-pro-creative-v2-renderer";

const CANVAS_WIDTH = 1080;
const CANVAS_HEIGHT = 1350;

type MarketingProCreativeV2PreviewProps = {
  payload: MarketingProCreativeV2Payload;
  /** Referência opaca ao cutout aprovado (nunca `.tmp`, nunca base64 grande) — a MESMA fonte usada por `payload.asset`. */
  productImageSrc: string;
};

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Não foi possível carregar o cutout aprovado."));
    image.src = src;
  });
}

/**
 * Preview real (canvas) do Premium Creative Composer V2. Export usa a MESMA função de desenho
 * (`renderPremiumCreativeV2`) com o MESMO `payload` recebido via props — nunca recalcula layout, nunca
 * duas implementações (§8 da integração PRO-07J).
 */
export function MarketingProCreativeV2Preview({ payload, productImageSrc }: MarketingProCreativeV2PreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [productImage, setProductImage] = useState<HTMLImageElement | null>(null);
  const [loadError, setLoadError] = useState("");
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");

  useEffect(() => {
    let active = true;
    setProductImage(null);
    setLoadError("");
    loadImage(productImageSrc)
      .then((image) => { if (active) setProductImage(image); })
      .catch((error: unknown) => { if (active) setLoadError(error instanceof Error ? error.message : "Falha ao carregar o cutout."); });
    return () => { active = false; };
  }, [productImageSrc]);

  useEffect(() => {
    if (!productImage) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!ctx) return;
    renderPremiumCreativeV2(ctx, payload, productImage);
  }, [payload, productImage]);

  const handleExportPng = async () => {
    if (!productImage || exporting) return;
    setExporting(true);
    setExportError("");
    try {
      const exportCanvas = document.createElement("canvas");
      exportCanvas.width = CANVAS_WIDTH;
      exportCanvas.height = CANVAS_HEIGHT;
      const exportCtx = exportCanvas.getContext("2d");
      if (!exportCtx) throw new Error("Canvas de export indisponível.");
      // MESMA função, MESMO payload do preview acima — só o canvas de destino muda.
      renderPremiumCreativeV2(exportCtx, payload, productImage);
      const blob = await new Promise<Blob | null>((resolve) => exportCanvas.toBlob(resolve, "image/png"));
      if (!blob) throw new Error("Não foi possível gerar o PNG.");
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${payload.overlay.productName || "anuncio"}-${payload.family}-v2.png`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      setExportError(error instanceof Error ? error.message : "Não foi possível exportar o PNG.");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="min-w-0" data-testid="marketing-pro-creative-v2-preview" data-pro-creative-family={payload.family}>
      <div className="relative mx-auto aspect-[4/5] w-full max-w-[540px] overflow-hidden rounded-[28px] border border-black/10 shadow-xl">
        <canvas ref={canvasRef} width={CANVAS_WIDTH} height={CANVAS_HEIGHT} className="h-full w-full" data-testid="marketing-pro-creative-v2-canvas" />
      </div>
      {loadError && (
        <p className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800" role="status">{loadError}</p>
      )}
      {exportError && (
        <p className="mt-2 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs font-semibold text-destructive" role="status">{exportError}</p>
      )}
      <button
        type="button"
        onClick={() => void handleExportPng()}
        disabled={!productImage || exporting}
        className="mt-3 min-h-11 w-full rounded-xl bg-primary px-4 text-xs font-black text-white shadow-sm transition disabled:opacity-50"
        data-testid="marketing-pro-creative-v2-export"
      >
        {exporting ? "Gerando PNG..." : "Baixar PNG (Composer V2 · beta)"}
      </button>
    </div>
  );
}
