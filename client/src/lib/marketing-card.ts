import { buildMarketingAdVisualModel, getMarketingAdImageCandidates, normalizeMarketingAdConfig, type MarketingAdConfig, type MarketingAdInput } from "@/lib/marketing-ad";
import { MARKETING_IMAGE_ERROR_MESSAGE, MarketingImageResolutionError, resolveMarketingImageCandidates, resolveMarketingProductImage, type ResolvedMarketingImage } from "@/lib/marketing-image";

const S = 1080;
const FONT = "Arial";
export const MARKETING_CARD_IMAGE_ERROR_MESSAGE = MARKETING_IMAGE_ERROR_MESSAGE;
export const MARKETING_CARD_RENDER_ERROR_MESSAGE = "Não foi possível finalizar o PNG do card. Tente novamente.";

export class MarketingCardImageError extends Error {
  readonly code = "marketing-image-decode-failed";

  constructor() {
    super(MARKETING_CARD_IMAGE_ERROR_MESSAGE);
    this.name = "MarketingCardImageError";
  }
}

export class MarketingCardRenderError extends Error {
  readonly code: "canvas-context" | "canvas-encode";

  constructor(code: "canvas-context" | "canvas-encode", cause?: unknown) {
    super(MARKETING_CARD_RENDER_ERROR_MESSAGE, { cause });
    this.name = "MarketingCardRenderError";
    this.code = code;
  }
}

const loadImg = (src: string) => new Promise<HTMLImageElement | null>((resolve) => {
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.onload = () => resolve(img);
  img.onerror = () => resolve(null);
  img.src = src;
});

async function loadOptionalVisualAsset(src: string) {
  if (!src) return null;
  try {
    const resolved = await resolveMarketingImageCandidates([src]);
    return resolved ? loadImg(resolved.safeSrc) : null;
  } catch {
    return null;
  }
}

async function resolveProductImage(config: MarketingAdConfig, supplied?: ResolvedMarketingImage | null) {
  const candidates = getMarketingAdImageCandidates(config);
  if (!candidates.length) return null;
  if (supplied && !candidates.includes(supplied.sourceUrl)) throw new MarketingImageResolutionError(candidates.length);
  const resolved = supplied || await resolveMarketingProductImage(config);
  if (!resolved) throw new MarketingImageResolutionError(candidates.length);
  const image = await loadImg(resolved.safeSrc);
  if (!image) throw new MarketingCardImageError();
  return { image, resolved };
}

const font = (ctx: CanvasRenderingContext2D, size: number, weight = 900) => { ctx.font = `${weight} ${size}px ${FONT}`; };
function rect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, fill: string, stroke?: string) {
  ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.fillStyle = fill; ctx.fill();
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 3; ctx.stroke(); }
}
function fit(ctx: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, w: number, h: number) {
  const ratio = Math.min(w / img.naturalWidth, h / img.naturalHeight), iw = img.naturalWidth * ratio, ih = img.naturalHeight * ratio;
  ctx.drawImage(img, x + (w - iw) / 2, y + (h - ih) / 2, iw, ih);
}
function wrapLines(ctx: CanvasRenderingContext2D, text: string, w: number, max = 2) {
  const words = text.split(/\s+/).filter(Boolean), lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width <= w) line = next;
    else {
      if (line) lines.push(line);
      line = word;
      if (lines.length >= max - 1) break;
    }
  }
  if (line && lines.length < max) lines.push(line);
  return lines;
}
function drawWrapped(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, w: number, lh: number, max = 2) {
  wrapLines(ctx, text, w, max).forEach((row, i) => ctx.fillText(row, x, y + i * lh));
}
function fitFontForLines(ctx: CanvasRenderingContext2D, text: string, w: number, maxLines: number, startSize: number, minSize: number) {
  for (let size = startSize; size >= minSize; size -= 2) {
    font(ctx, size, 900);
    const lines = wrapLines(ctx, text, w, maxLines);
    if (lines.join(" ").length >= text.replace(/\s+/g, " ").trim().length - 2) return { size, lines };
  }
  font(ctx, minSize, 900);
  return { size: minSize, lines: wrapLines(ctx, text, w, maxLines) };
}
function circleIcon(ctx: CanvasRenderingContext2D, x: number, y: number, text: string, fill: string) {
  ctx.beginPath(); ctx.arc(x, y, 19, 0, Math.PI * 2); ctx.fillStyle = fill; ctx.fill();
  ctx.fillStyle = "#fff"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; font(ctx, 20, 900); ctx.fillText(text, x, y + 1);
}

export type CreateMarketingCardOptions = {
  resolvedProductImage?: ResolvedMarketingImage | null;
};

export async function createMarketingCard(payload: MarketingAdInput, options: CreateMarketingCardOptions = {}): Promise<Blob> {
  const normalizedConfig = normalizeMarketingAdConfig(payload);
  const [logo, productResult, signatureLogo] = await Promise.all([
    loadOptionalVisualAsset(normalizedConfig.storeLogoUrl || ""),
    resolveProductImage(normalizedConfig, options.resolvedProductImage),
    loadOptionalVisualAsset("/logo-revenda-smart-symbol.png"),
  ]);
  const resolvedProductImage = productResult?.resolved || null;
  const product = productResult?.image || null;
  const model = buildMarketingAdVisualModel(normalizedConfig, { resolvedImageSrc: resolvedProductImage?.safeSrc || "" });
  const { config, theme, features, ctaText, description, badgeText } = model;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = S;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new MarketingCardRenderError("canvas-context");

  const grad = ctx.createLinearGradient(0, 0, S, S);
  grad.addColorStop(0, "#ffffff"); grad.addColorStop(.55, "#f8fbff"); grad.addColorStop(1, "#eaf3ff");
  ctx.fillStyle = grad; ctx.fillRect(0, 0, S, S);
  ctx.globalAlpha = .14; ctx.fillStyle = "#2563eb"; ctx.beginPath(); ctx.arc(905, 540, 348, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;

  ctx.shadowColor = "rgba(15,23,42,.13)"; ctx.shadowBlur = 30; ctx.shadowOffsetY = 16;
  rect(ctx, 34, 34, 1012, 1012, 54, "rgba(255,255,255,.96)", "rgba(226,232,240,.92)");
  ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;

  rect(ctx, 70, 70, 72, 72, 22, "#fff", theme.ring);
  if (logo) fit(ctx, logo, 80, 80, 52, 52);
  else { ctx.fillStyle = theme.accent; font(ctx, 34); ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText((config.storeName || "M").slice(0, 1).toUpperCase(), 106, 106); }
  ctx.textAlign = "left"; ctx.textBaseline = "alphabetic"; ctx.fillStyle = "#0f172a"; font(ctx, 31); drawWrapped(ctx, config.storeName, 162, 104, 420, 34, 1);
  ctx.fillStyle = "#64748b"; font(ctx, 15, 900); ctx.fillText("LOJA OFICIAL", 164, 132);
  rect(ctx, 814, 70, 176, 52, 26, theme.accent); ctx.fillStyle = "#fff"; font(ctx, 20); ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(badgeText.toUpperCase().slice(0, 18), 902, 97);

  ctx.textAlign = "left"; ctx.textBaseline = "alphabetic"; ctx.fillStyle = theme.accent; font(ctx, 21, 900); drawWrapped(ctx, config.headline, 70, 218, 390, 28, 1);
  ctx.fillStyle = "#0f172a";
  const fittedTitle = fitFontForLines(ctx, config.productName, 390, 2, config.productName.length > 42 ? 46 : 58, 38);
  font(ctx, fittedTitle.size, 900);
  fittedTitle.lines.forEach((row, i) => ctx.fillText(row, 70, 292 + i * 58));
  let nextY = 292 + fittedTitle.lines.length * 58 + 18;
  if (description) {
    ctx.fillStyle = "#475569"; font(ctx, 22, 700); drawWrapped(ctx, description, 72, nextY, 382, 30, 2);
    nextY += 66;
  }
  ctx.fillStyle = "#0f172a"; font(ctx, 70, 900); ctx.fillText(config.priceText, 70, nextY + 82);

  let rowY = nextY + 144;
  for (const feature of features) {
    circleIcon(ctx, 91, rowY - 8, feature.icon, feature.highlight ? "#22c55e" : "#2563eb");
    ctx.fillStyle = "#1e293b"; font(ctx, 23, 800); drawWrapped(ctx, feature.text, 126, rowY, 328, 28, 1);
    rowY += 50;
  }

  if (ctaText) {
    rect(ctx, 70, 850, 390, 88, 28, "#2563eb");
    ctx.fillStyle = "#fff"; font(ctx, 28); ctx.textAlign = "center"; ctx.textBaseline = "middle"; drawWrapped(ctx, ctaText, 265, 903, 350, 30, 1);
  }

  rect(ctx, 480, 168, 530, 744, 50, "rgba(255,255,255,.72)", "rgba(37,99,235,.18)");
  if (product) fit(ctx, product, 496, 184, 498, 712);
  else { ctx.fillStyle = "#e0ecff"; ctx.beginPath(); ctx.arc(745, 540, 116, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = "#2563eb"; font(ctx, 28); ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText("Produto sem imagem", 745, 544); }

  ctx.textAlign = "right"; ctx.textBaseline = "middle"; ctx.fillStyle = "#94a3b8"; font(ctx, 16, 900);
  ctx.fillText("Criado com Revenda Smart", 990, 976);
  if (signatureLogo) fit(ctx, signatureLogo, 738, 958, 30, 30);

  return canvasToPngBlob(canvas);
}

export function canvasToPngBlob(canvas: Pick<HTMLCanvasElement, "toBlob">): Promise<Blob> {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(new MarketingCardRenderError("canvas-encode")), "image/png", 0.95);
    } catch (error) {
      reject(new MarketingCardRenderError("canvas-encode", error));
    }
  });
}
