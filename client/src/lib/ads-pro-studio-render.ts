/**
 * ADS-PRO-FINAL — renderizador canvas do estúdio. Preview, miniaturas e exportação usam a MESMA função
 * (`renderAdsProAd`) sobre a MESMA geometria (`computeAdLayout`): o PNG exportado é exatamente o que o
 * vendedor vê, só em outra resolução. Nada aqui chama rede — imagens chegam já carregadas.
 */
import type { MarketingProBackgroundAsset, MarketingProBackgroundGeneratedSpec } from "@shared/marketing-pro-background-library";
import { resolveStudioBackdrop } from "@/lib/ads-pro-studio-catalog";
import { getAdsProCanvasSize, type AdsProAdDocumentV1 } from "@shared/ads-pro/ad-document";
import {
  computeAdLayout,
  type AdLayout,
  type CtaPlacement,
  type DecorationShape,
  type PlacedText,
  type PlateShape,
  type PricePlacement,
  type Rect,
} from "@shared/ads-pro/ad-layout";
import { createEstimateMeasurer, fontCss, type FontSpec, type TextMeasurer } from "@shared/ads-pro/ad-text-fit";

/** Foto do produto já preparada (ajustes aplicados) pronta para ser desenhada. */
export interface AdsProPreparedPhoto {
  readonly source: CanvasImageSource;
  readonly width: number;
  readonly height: number;
  /** Cor média das bordas: preenche o cartão atrás da foto para o enquadramento ficar contínuo. */
  readonly edgeColor: string;
}

export interface AdsProRenderAssets {
  readonly photo?: AdsProPreparedPhoto | null;
  readonly logo?: CanvasImageSource | null;
  /** Imagem do fundo ESTÁTICO aprovado (quando o fundo é estático e já carregou). */
  readonly backgroundImage?: CanvasImageSource | null;
}

// ---------------------------------------------------------------------------------------------
// Medição de texto com o canvas real (mesma fonte que será desenhada)
// ---------------------------------------------------------------------------------------------

let measureContext: CanvasRenderingContext2D | null | undefined;

function getMeasureContext(): CanvasRenderingContext2D | null {
  if (measureContext !== undefined) return measureContext;
  try {
    measureContext = typeof document === "undefined" ? null : document.createElement("canvas").getContext("2d");
  } catch {
    measureContext = null;
  }
  return measureContext;
}

function supportsLetterSpacing(ctx: CanvasRenderingContext2D): boolean {
  return "letterSpacing" in ctx;
}

function applyFont(ctx: CanvasRenderingContext2D, font: FontSpec): void {
  ctx.font = fontCss(font);
  if (supportsLetterSpacing(ctx)) (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${(font.trackingEm * font.px).toFixed(2)}px`;
}

export function getCanvasMeasurer(): TextMeasurer {
  const ctx = getMeasureContext();
  if (!ctx) return createEstimateMeasurer();
  return (text, font) => {
    applyFont(ctx, font);
    const width = ctx.measureText(text).width;
    // Com letterSpacing nativo o canvas soma o espaço depois de CADA letra, inclusive da última.
    if (supportsLetterSpacing(ctx)) return Math.max(0, width - font.trackingEm * font.px);
    return width + Math.max(0, text.length - 1) * font.trackingEm * font.px;
  };
}

// ---------------------------------------------------------------------------------------------
// Primitivas de desenho
// ---------------------------------------------------------------------------------------------

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, radius: number): void {
  const r = Math.max(0, Math.min(radius, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

function hexWithAlpha(hex: string, alpha: number): string {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match) return hex;
  const n = parseInt(match[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

/** Mesma geometria do SVG da biblioteca (`linearGradientAxis`), desenhada nativamente: troca de fundo é instantânea. */
function drawGeneratedBackground(ctx: CanvasRenderingContext2D, spec: MarketingProBackgroundGeneratedSpec, width: number, height: number): void {
  const angle = (spec.angleDeg * Math.PI) / 180;
  const length = Math.abs(width * Math.sin(angle)) + Math.abs(height * Math.cos(angle));
  const cx = width / 2; const cy = height / 2; const half = length / 2;
  const gradient = ctx.createLinearGradient(cx - Math.sin(angle) * half, cy + Math.cos(angle) * half, cx + Math.sin(angle) * half, cy - Math.cos(angle) * half);
  for (const stop of spec.stops) gradient.addColorStop(Math.min(1, Math.max(0, stop.offset)), stop.color);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
  if (spec.vignette) {
    ctx.save();
    ctx.scale(width, height);
    const radial = ctx.createRadialGradient(0.5, 0.42, 0, 0.5, 0.42, 0.75);
    radial.addColorStop(0.55, hexWithAlpha(spec.vignette.color, 0));
    radial.addColorStop(1, hexWithAlpha(spec.vignette.color, spec.vignette.opacity));
    ctx.fillStyle = radial;
    ctx.fillRect(0, 0, 1, 1);
    ctx.restore();
  }
  if (spec.pedestal) {
    ctx.save();
    ctx.globalAlpha = spec.pedestal.opacity;
    ctx.fillStyle = spec.pedestal.color;
    ctx.beginPath();
    ctx.ellipse(width / 2, height * 0.94, width * 0.4, height * 0.06, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

function drawCover(ctx: CanvasRenderingContext2D, image: CanvasImageSource & { width?: number; height?: number }, width: number, height: number): void {
  const iw = Number((image as { width?: number }).width) || width;
  const ih = Number((image as { height?: number }).height) || height;
  const scale = Math.max(width / iw, height / ih);
  const dw = iw * scale; const dh = ih * scale;
  ctx.drawImage(image, (width - dw) / 2, (height - dh) / 2, dw, dh);
}

function drawBackground(ctx: CanvasRenderingContext2D, asset: MarketingProBackgroundAsset, assets: AdsProRenderAssets, width: number, height: number): void {
  if (asset.sourceType === "GENERATED_DETERMINISTIC") {
    drawGeneratedBackground(ctx, asset.generated, width, height);
    return;
  }
  // Fundo estático: se a imagem ainda não carregou (ou falhou), um degradê neutro da mesma luminância
  // mantém o anúncio legível — um fundo quebrado nunca derruba nem esvazia a arte.
  if (assets.backgroundImage) {
    drawCover(ctx, assets.backgroundImage as CanvasImageSource & { width?: number; height?: number }, width, height);
    return;
  }
  const dark = asset.luminance === "dark";
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, dark ? "#1b1f27" : "#f6f6f3");
  gradient.addColorStop(1, dark ? "#0b0d11" : "#e3e3de");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
}

function drawDecoration(ctx: CanvasRenderingContext2D, shape: DecorationShape): void {
  ctx.save();
  switch (shape.kind) {
    case "rect":
      roundRectPath(ctx, shape.rect.x, shape.rect.y, shape.rect.w, shape.rect.h, shape.radius);
      ctx.fillStyle = shape.fill;
      ctx.fill();
      break;
    case "circle":
      ctx.beginPath();
      ctx.arc(shape.cx, shape.cy, shape.r, 0, Math.PI * 2);
      if (shape.fill) { ctx.fillStyle = shape.fill; ctx.fill(); }
      if (shape.stroke) { ctx.strokeStyle = shape.stroke; ctx.lineWidth = shape.strokeWidth; ctx.stroke(); }
      break;
    case "frame":
      ctx.strokeStyle = shape.stroke;
      ctx.lineWidth = shape.strokeWidth;
      ctx.strokeRect(shape.rect.x, shape.rect.y, shape.rect.w, shape.rect.h);
      break;
    case "triangle":
      ctx.beginPath();
      shape.points.forEach(([px, py], index) => (index === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)));
      ctx.closePath();
      ctx.fillStyle = shape.fill;
      ctx.fill();
      break;
  }
  ctx.restore();
}

function drawText(ctx: CanvasRenderingContext2D, block: PlacedText | undefined): void {
  if (!block || block.lines.length === 0) return;
  ctx.save();
  applyFont(ctx, block.font);
  ctx.fillStyle = block.color;
  ctx.textAlign = block.align;
  ctx.textBaseline = "middle";
  const manualTracking = !supportsLetterSpacing(ctx) && block.font.trackingEm > 0;
  block.lines.forEach((line, index) => {
    const y = block.rect.y + block.lineHeightPx * index + block.lineHeightPx / 2;
    if (manualTracking) {
      // Navegador sem letterSpacing no canvas: desenha letra a letra, respeitando o alinhamento.
      const spacing = block.font.trackingEm * block.font.px;
      const widths = Array.from(line).map((char) => ctx.measureText(char).width + spacing);
      const total = widths.reduce((sum, w) => sum + w, 0) - spacing;
      let x = block.align === "left" ? block.anchorX : block.align === "center" ? block.anchorX - total / 2 : block.anchorX - total;
      ctx.textAlign = "left";
      Array.from(line).forEach((char, i) => { ctx.fillText(char, x, y); x += widths[i]; });
    } else {
      ctx.fillText(line, block.anchorX, y);
    }
    if (block.strike) {
      const measured = Math.max(...block.lines.map((l) => ctx.measureText(l).width));
      const left = block.align === "left" ? block.anchorX : block.align === "center" ? block.anchorX - measured / 2 : block.anchorX - measured;
      ctx.fillRect(left, y, measured, Math.max(2, block.font.px * 0.07));
    }
  });
  ctx.restore();
}

function drawPlate(ctx: CanvasRenderingContext2D, plate: PlateShape): void {
  ctx.save();
  ctx.fillStyle = plate.fill;
  if (plate.kind === "ellipse") {
    ctx.shadowColor = "rgba(0,0,0,0.28)";
    ctx.shadowBlur = 28;
    ctx.shadowOffsetY = 10;
    ctx.beginPath();
    ctx.ellipse(plate.rect.x + plate.rect.w / 2, plate.rect.y + plate.rect.h / 2, plate.rect.w / 2, plate.rect.h / 2, 0, 0, Math.PI * 2);
    ctx.fill();
  } else {
    roundRectPath(ctx, plate.rect.x, plate.rect.y, plate.rect.w, plate.rect.h, plate.radius);
    ctx.fill();
  }
  ctx.restore();
}

function drawPrice(ctx: CanvasRenderingContext2D, price: PricePlacement): void {
  if (price.plate) drawPlate(ctx, price.plate);
  if (price.badge && price.badge.plate.fill !== "rgba(0,0,0,0)") drawPlate(ctx, price.badge.plate);
  if (price.underline) {
    ctx.save();
    ctx.fillStyle = price.underlineColor ?? "#000";
    roundRectPath(ctx, price.underline.x, price.underline.y, price.underline.w, price.underline.h, 4);
    ctx.fill();
    ctx.restore();
  }
  drawText(ctx, price.old);
  drawText(ctx, price.main);
  drawText(ctx, price.badge?.text);
}

function drawCta(ctx: CanvasRenderingContext2D, cta: CtaPlacement): void {
  ctx.save();
  if (cta.shape !== "link") {
    roundRectPath(ctx, cta.rect.x, cta.rect.y, cta.rect.w, cta.rect.h, cta.radius);
    if (cta.fill) {
      ctx.shadowColor = "rgba(0,0,0,0.18)";
      ctx.shadowBlur = 16;
      ctx.shadowOffsetY = 6;
      ctx.fillStyle = cta.fill;
      ctx.fill();
    }
    if (cta.stroke) { ctx.shadowColor = "transparent"; ctx.strokeStyle = cta.stroke; ctx.lineWidth = cta.strokeWidth; ctx.stroke(); }
  } else if (cta.underline) {
    ctx.fillStyle = cta.label.color;
    ctx.fillRect(cta.underline.x, cta.underline.y, cta.underline.w, cta.underline.h);
  }
  ctx.restore();
  drawText(ctx, cta.label);
}

function fillRoundedRect(ctx: CanvasRenderingContext2D, r: Rect, radius: number, fill: string): void {
  ctx.save();
  roundRectPath(ctx, r.x, r.y, r.w, r.h, radius);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.restore();
}

/** Enquadramento: zoom e deslocamento dentro da caixa do produto (a foto original nunca é recortada de verdade). */
function framedImageRect(box: Rect, photo: AdsProPreparedPhoto, doc: AdsProAdDocumentV1, inset: number): Rect {
  const inner = { x: box.x + inset, y: box.y + inset, w: box.w - inset * 2, h: box.h - inset * 2 };
  const base = Math.min(inner.w / photo.width, inner.h / photo.height);
  const scale = base * doc.photo.zoom;
  const w = photo.width * scale; const h = photo.height * scale;
  const panX = Math.max(0, (w - inner.w) / 2) + inner.w * 0.12;
  const panY = Math.max(0, (h - inner.h) / 2) + inner.h * 0.12;
  return {
    x: inner.x + (inner.w - w) / 2 + doc.photo.offsetX * panX,
    y: inner.y + (inner.h - h) / 2 + doc.photo.offsetY * panY,
    w,
    h,
  };
}

function drawProduct(ctx: CanvasRenderingContext2D, layout: AdLayout, doc: AdsProAdDocumentV1, photo: AdsProPreparedPhoto | null | undefined): void {
  const box = layout.product.rect;
  if (box.w <= 0 || box.h <= 0) return;
  ctx.save();
  if (layout.product.presentation === "card") {
    ctx.shadowColor = "rgba(0,0,0,0.30)";
    ctx.shadowBlur = 44;
    ctx.shadowOffsetY = 16;
    fillRoundedRect(ctx, box, layout.product.radius, photo?.edgeColor ?? "#FFFFFF");
    ctx.shadowColor = "transparent";
    roundRectPath(ctx, box.x, box.y, box.w, box.h, layout.product.radius);
    ctx.clip();
    if (photo) {
      const target = framedImageRect(box, photo, doc, 14);
      ctx.drawImage(photo.source, target.x, target.y, target.w, target.h);
    }
  } else if (photo) {
    // Recorte (sem fundo): sombra de apoio sob o produto, depois a imagem, sempre dentro da caixa.
    ctx.beginPath();
    ctx.rect(box.x - 40, box.y - 20, box.w + 80, box.h + 60);
    ctx.clip();
    const target = framedImageRect(box, photo, doc, 0);
    ctx.save();
    ctx.fillStyle = "rgba(15,23,42,0.22)";
    ctx.filter = "blur(22px)";
    ctx.beginPath();
    ctx.ellipse(target.x + target.w / 2, Math.min(target.y + target.h, box.y + box.h) + 10, target.w * 0.36, Math.max(14, target.h * 0.05), 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.beginPath();
    ctx.rect(box.x, box.y, box.w, box.h);
    ctx.clip();
    ctx.drawImage(photo.source, target.x, target.y, target.w, target.h);
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------------------------

export interface RenderAdsProOptions {
  /** Largura em pixels do canvas de saída (a altura segue a proporção do formato). */
  readonly width: number;
  readonly measure?: TextMeasurer;
}

export interface RenderedAdsProAd {
  readonly layout: AdLayout;
  readonly width: number;
  readonly height: number;
  readonly backgroundMissing: boolean;
}

/** Calcula o layout do documento com a medição do canvas real. Puro em relação ao desenho. */
export function layoutAdsProDocument(doc: AdsProAdDocumentV1, assets: AdsProRenderAssets, measure: TextMeasurer = getCanvasMeasurer()): { layout: AdLayout; asset: MarketingProBackgroundAsset; missing: boolean } {
  const backdrop = resolveStudioBackdrop(doc.background, doc.format);
  const layout = computeAdLayout({ doc, measure, backdrop: { colors: backdrop.colors, forceScrim: backdrop.forceScrim }, hasLogo: Boolean(assets.logo) });
  return { layout, asset: backdrop.asset, missing: backdrop.missing };
}

export function renderAdsProAd(canvas: HTMLCanvasElement, doc: AdsProAdDocumentV1, assets: AdsProRenderAssets, options: RenderAdsProOptions): RenderedAdsProAd {
  const size = getAdsProCanvasSize(doc.format);
  const width = Math.max(120, Math.round(options.width));
  const height = Math.round((width * size.height) / size.width);
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D indisponível.");
  const { layout, asset, missing } = layoutAdsProDocument(doc, assets, options.measure);

  ctx.save();
  ctx.clearRect(0, 0, width, height);
  ctx.scale(width / size.width, height / size.height);
  drawBackground(ctx, asset, assets, size.width, size.height);
  for (const decoration of layout.decorations) drawDecoration(ctx, decoration);
  if (layout.band) {
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.22)";
    ctx.shadowBlur = 36;
    ctx.shadowOffsetY = -8;
    roundRectPath(ctx, layout.band.rect.x, layout.band.rect.y, layout.band.rect.w, layout.band.rect.h + layout.band.radius, layout.band.radius);
    ctx.fillStyle = layout.band.fill;
    ctx.fill();
    ctx.restore();
  }
  for (const scrim of layout.scrims) fillRoundedRect(ctx, scrim, 30, layout.scrimColor);
  drawProduct(ctx, layout, doc, assets.photo);
  drawText(ctx, layout.store);
  drawText(ctx, layout.kicker);
  drawText(ctx, layout.headline);
  drawText(ctx, layout.subtitle);
  if (layout.price) drawPrice(ctx, layout.price);
  if (layout.cta) drawCta(ctx, layout.cta);
  if (layout.logo && assets.logo) ctx.drawImage(assets.logo, layout.logo.x, layout.logo.y, layout.logo.w, layout.logo.h);
  ctx.restore();
  return { layout, width, height, backgroundMissing: missing };
}

/** Miniatura só do fundo (grade "Fundo"): mesma função de desenho do anúncio, sem produto nem texto. */
export function renderAdsProBackgroundSwatch(
  canvas: HTMLCanvasElement,
  asset: MarketingProBackgroundAsset,
  format: AdsProAdDocumentV1["format"],
  backgroundImage: CanvasImageSource | null,
  width: number,
): void {
  const size = getAdsProCanvasSize(format);
  const outWidth = Math.max(40, Math.round(width));
  const outHeight = Math.round((outWidth * size.height) / size.width);
  if (canvas.width !== outWidth) canvas.width = outWidth;
  if (canvas.height !== outHeight) canvas.height = outHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.save();
  ctx.clearRect(0, 0, outWidth, outHeight);
  ctx.scale(outWidth / size.width, outHeight / size.height);
  drawBackground(ctx, asset, { backgroundImage }, size.width, size.height);
  ctx.restore();
}

export interface ExportedAdsProImage {
  readonly blob: Blob;
  readonly width: number;
  readonly height: number;
  readonly layout: AdLayout;
}

/** Exportação: renderiza em resolução cheia (1080 de largura) e codifica em PNG. */
export async function exportAdsProAdAsPng(doc: AdsProAdDocumentV1, assets: AdsProRenderAssets): Promise<ExportedAdsProImage> {
  const size = getAdsProCanvasSize(doc.format);
  const canvas = document.createElement("canvas");
  const rendered = renderAdsProAd(canvas, doc, assets, { width: size.width });
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob((value) => resolve(value), "image/png"));
  if (!blob) throw new Error("Não foi possível gerar o arquivo PNG do anúncio.");
  return { blob, width: rendered.width, height: rendered.height, layout: rendered.layout };
}
