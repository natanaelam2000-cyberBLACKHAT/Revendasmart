import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { getAdsProCanvasSize, type AdsProAdDocumentV1 } from "@shared/ads-pro/ad-document";
import { isCriticalIssue, type AdLayoutIssue } from "@shared/ads-pro/ad-layout";
import type { MarketingProBackgroundAsset } from "@shared/marketing-pro-background-library";
import { renderAdsProAd, renderAdsProBackgroundSwatch, type AdsProRenderAssets } from "@/lib/ads-pro-studio-render";

export interface StudioCanvasReport {
  readonly issues: readonly AdLayoutIssue[];
  readonly criticalIssues: number;
  readonly width: number;
  readonly height: number;
  readonly backgroundMissing: boolean;
  readonly textScale: number;
}

/** Largura (em px CSS) de um elemento, acompanhando redimensionamento. Antes de medir usa `fallback`. */
export function useElementWidth<T extends HTMLElement>(fallback: number): { readonly ref: React.RefObject<T | null>; readonly width: number } {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(fallback);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => {
      const next = Math.round(element.getBoundingClientRect().width);
      if (next > 0) setWidth((current) => (current === next ? current : next));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}

/** Pixels reais do canvas: largura CSS × densidade do aparelho, limitada ao tamanho de exportação (1080). */
export function resolveRenderWidth(cssWidth: number, format: AdsProAdDocumentV1["format"]): number {
  const dpr = typeof window === "undefined" ? 1 : Math.min(2, window.devicePixelRatio || 1);
  return Math.max(120, Math.min(getAdsProCanvasSize(format).width, Math.round(cssWidth * dpr)));
}

export function AdsProStudioCanvas({
  doc,
  assets,
  renderWidth,
  ariaLabel,
  testId,
  className = "",
  maxHeight,
  onRendered,
}: {
  readonly doc: AdsProAdDocumentV1;
  readonly assets: AdsProRenderAssets;
  readonly renderWidth: number;
  readonly ariaLabel: string;
  readonly testId?: string;
  readonly className?: string;
  /** Limita a altura em CSS (preview sticky no celular); a largura acompanha a proporção. */
  readonly maxHeight?: string;
  readonly onRendered?: (report: StudioCanvasReport) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const onRenderedRef = useRef(onRendered);
  const [report, setReport] = useState<StudioCanvasReport | null>(null);
  onRenderedRef.current = onRendered;
  const size = getAdsProCanvasSize(doc.format);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      const rendered = renderAdsProAd(canvas, doc, assets, { width: renderWidth });
      const next: StudioCanvasReport = {
        issues: rendered.layout.issues,
        criticalIssues: rendered.layout.issues.filter(isCriticalIssue).length,
        width: rendered.width,
        height: rendered.height,
        backgroundMissing: rendered.backgroundMissing,
        textScale: rendered.layout.textScale,
      };
      setReport(next);
      onRenderedRef.current?.(next);
    } catch {
      setReport(null);
    }
  }, [doc, assets, renderWidth]);

  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label={ariaLabel}
      data-testid={testId}
      data-ads-pro-canvas="true"
      data-format={doc.format}
      data-style={doc.direction.style}
      data-archetype={doc.direction.archetype}
      data-background-id={doc.background.id}
      data-render-width={report?.width}
      data-render-height={report?.height}
      data-layout-issues={report?.criticalIssues}
      className={`block h-auto w-auto max-w-full select-none rounded-2xl bg-white shadow-sm ${className}`}
      style={{ aspectRatio: `${size.width} / ${size.height}`, maxHeight }}
    />
  );
}

/** Miniatura de um fundo (só cenário). Estático que falha em carregar mostra o degradê neutro — nunca quebra a grade. */
export function StudioBackgroundSwatch({
  asset,
  format,
  image,
  width,
}: {
  readonly asset: MarketingProBackgroundAsset;
  readonly format: AdsProAdDocumentV1["format"];
  readonly image: CanvasImageSource | null;
  readonly width: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const size = getAdsProCanvasSize(format);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      renderAdsProBackgroundSwatch(canvas, asset, format, image, width);
    } catch {
      /* miniatura é decorativa: falhar aqui nunca interrompe a escolha */
    }
  }, [asset, format, image, width]);
  return <canvas ref={canvasRef} aria-hidden="true" className="block h-auto w-full rounded-lg" style={{ aspectRatio: `${size.width} / ${size.height}` }} />;
}
