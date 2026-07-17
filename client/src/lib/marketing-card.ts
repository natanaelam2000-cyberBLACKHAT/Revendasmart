import { buildMarketingAdVisualModel, getMarketingAdImageCandidates, type MarketingAdConfig, type MarketingAdInput } from "@/lib/marketing-ad";

const S = 1080, FONT = "Arial";
const loadImg = (src: string) => new Promise<HTMLImageElement | null>((resolve) => {
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.onload = () => resolve(img);
  img.onerror = () => resolve(null);
  img.src = src;
});
async function loadExportableImage(src: string) {
  if (!src.startsWith("http")) return loadImg(src);
  try {
    const objectUrl = URL.createObjectURL(await (await fetch(src, { mode: "cors", credentials: "omit" })).blob()), img = await loadImg(objectUrl);
    URL.revokeObjectURL(objectUrl);
    return img;
  } catch {}
  return null;
}
async function resolveImage(config: MarketingAdConfig, warn: () => void) {
  const src = getMarketingAdImageCandidates(config)[0] || "";
  if (!src) return null;
  const img = await loadExportableImage(src);
  if (!img) warn();
  return img;
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
function circleIcon(ctx: CanvasRenderingContext2D, x: number, y: number, text: string, fill: string) {
  ctx.beginPath(); ctx.arc(x, y, 19, 0, Math.PI * 2); ctx.fillStyle = fill; ctx.fill();
  ctx.fillStyle = "#fff"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; font(ctx, 20, 900); ctx.fillText(text, x, y + 1);
}
export async function createMarketingCard(payload: MarketingAdInput, onImageFallback?: () => void): Promise<Blob> {
  let warned = false;
  const warn = () => { if (!warned) { warned = true; onImageFallback?.(); } };
  const model = buildMarketingAdVisualModel(payload), { config, theme, features, ctaText, description, badgeText } = model;
  const canvas = document.createElement("canvas"), ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Falha no PNG");
  canvas.width = canvas.height = S;

  const grad = ctx.createLinearGradient(0, 0, S, S);
  grad.addColorStop(0, "#ffffff"); grad.addColorStop(.55, "#f8fbff"); grad.addColorStop(1, "#eaf3ff");
  ctx.fillStyle = grad; ctx.fillRect(0, 0, S, S);
  ctx.globalAlpha = .18; ctx.fillStyle = "#2563eb"; ctx.beginPath(); ctx.arc(900, 540, 330, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;

  ctx.shadowColor = "rgba(15,23,42,.14)"; ctx.shadowBlur = 34; ctx.shadowOffsetY = 18;
  rect(ctx, 54, 54, 972, 972, 56, "rgba(255,255,255,.96)", "rgba(226,232,240,.95)");
  ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;

  const logo = config.storeLogoUrl ? await loadExportableImage(config.storeLogoUrl) : null;
  if (config.storeLogoUrl && !logo) warn();
  rect(ctx, 94, 96, 72, 72, 22, "#fff", theme.ring);
  if (logo) fit(ctx, logo, 104, 106, 52, 52); else { ctx.fillStyle = theme.accent; font(ctx, 34); ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText((config.storeName || "R").slice(0, 1).toUpperCase(), 130, 132); }
  ctx.textAlign = "left"; ctx.textBaseline = "alphabetic"; ctx.fillStyle = "#0f172a"; font(ctx, 32); drawWrapped(ctx, config.storeName, 186, 128, 430, 36, 1);
  ctx.fillStyle = "#64748b"; font(ctx, 16, 900); ctx.fillText("REVENDA SMART", 188, 158);
  rect(ctx, 790, 94, 182, 52, 26, theme.accent); ctx.fillStyle = "#fff"; font(ctx, 21); ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(badgeText.toUpperCase().slice(0, 18), 881, 121);

  ctx.textAlign = "left"; ctx.textBaseline = "alphabetic"; ctx.fillStyle = theme.accent; font(ctx, 22, 900); drawWrapped(ctx, config.headline, 92, 254, 430, 28, 1);
  ctx.fillStyle = "#0f172a"; font(ctx, config.productName.length > 42 ? 48 : 58, 900); drawWrapped(ctx, config.productName, 92, 334, 470, 62, 2);
  ctx.fillStyle = "#475569"; font(ctx, 24, 700); drawWrapped(ctx, description, 94, 468, 420, 32, 2);
  ctx.fillStyle = "#0f172a"; font(ctx, 78, 900); ctx.fillText(config.priceText, 92, 612);

  let rowY = 686;
  for (const feature of features) {
    circleIcon(ctx, 113, rowY - 8, feature.icon, feature.highlight ? "#22c55e" : "#2563eb");
    ctx.fillStyle = "#1e293b"; font(ctx, 24, 800); drawWrapped(ctx, feature.text, 148, rowY, 382, 28, 1);
    rowY += 54;
  }

  if (ctaText) {
    rect(ctx, 92, 866, 404, 88, 28, "#2563eb");
    ctx.fillStyle = "#fff"; font(ctx, 28); ctx.textAlign = "center"; ctx.textBaseline = "middle"; drawWrapped(ctx, ctaText, 294, 918, 338, 30, 1);
  }

  const product = await resolveImage(config, warn);
  rect(ctx, 570, 244, 388, 610, 48, "rgba(255,255,255,.72)", "rgba(37,99,235,.18)");
  if (product) fit(ctx, product, 604, 282, 320, 534);
  else { ctx.fillStyle = "#e0ecff"; ctx.beginPath(); ctx.arc(764, 540, 112, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = "#2563eb"; font(ctx, 28); ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText("Produto sem imagem", 764, 544); }

  return new Promise((resolve, reject) => { try { canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("Falha no PNG")), "image/png", .95); } catch { reject(new Error("Falha no PNG")); } });
}
export function downloadMarketingCard(blob: Blob, productName: string) {
  const url = URL.createObjectURL(blob), link = document.createElement("a");
  link.download = `anuncio-${productName.toLowerCase().replace(/[^a-z0-9]+/gi, "-")}.png`; link.href = url; document.body.appendChild(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 3000);
}
