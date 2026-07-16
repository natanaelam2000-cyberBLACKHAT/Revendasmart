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
function wrap(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, w: number, lh: number, max = 2) {
  let line = "", lines: string[] = [];
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width <= w) line = next; else { if (line) lines.push(line); line = word; if (lines.length >= max - 1) break; }
  }
  if (line && lines.length < max) lines.push(line);
  lines.forEach((row, i) => ctx.fillText(row, x, y + i * lh));
}
function tag(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, fill: string, color = "#fff") {
  const w = Math.min(310, ctx.measureText(text).width + 42);
  rect(ctx, x, y, w, 46, 23, fill); ctx.fillStyle = color; ctx.textAlign = "center"; ctx.textBaseline = "middle"; font(ctx, 20); ctx.fillText(text, x + w / 2, y + 24); return w + 12;
}
export async function createMarketingCard(payload: MarketingAdInput, onImageFallback?: () => void): Promise<Blob> {
  let warned = false;
  const warn = () => { if (!warned) { warned = true; onImageFallback?.(); } };
  const model = buildMarketingAdVisualModel(payload), { config, theme, template, chips, ctaText } = model;
  const canvas = document.createElement("canvas"), ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Falha no PNG");
  canvas.width = canvas.height = S;
  const grad = ctx.createLinearGradient(0, 0, S, S);
  grad.addColorStop(0, theme.soft); grad.addColorStop(.52, theme.accent); grad.addColorStop(1, theme.surface);
  ctx.fillStyle = config.backgroundStyle === "dark-premium" ? theme.dark : grad; ctx.fillRect(0, 0, S, S);
  ctx.globalAlpha = .18; for (const [x, y, r, fill] of [[1020, 80, 210, theme.cta], [70, 1030, 220, theme.accent]] as const) { ctx.fillStyle = fill; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); } ctx.globalAlpha = 1;
  ctx.shadowColor = "rgba(15,23,42,.18)"; ctx.shadowBlur = 42;
  rect(ctx, 74, 74, 932, 932, 72, config.backgroundStyle === "dark-premium" ? "rgba(15,23,42,.88)" : "rgba(255,255,255,.92)", theme.ring);
  ctx.shadowBlur = 0;
  const logo = config.storeLogoUrl ? await loadExportableImage(config.storeLogoUrl) : null;
  if (config.storeLogoUrl && !logo) warn();
  rect(ctx, 122, 118, 92, 92, 30, "#fff", theme.ring);
  if (logo) fit(ctx, logo, 132, 128, 72, 72); else { ctx.fillStyle = theme.accent; font(ctx, 42); ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText((config.storeName || "R").slice(0, 1).toUpperCase(), 168, 165); }
  ctx.textAlign = "left"; ctx.textBaseline = "alphabetic"; ctx.fillStyle = theme.foreground; font(ctx, 38); wrap(ctx, config.storeName, 236, 157, 560, 42, 1);
  ctx.fillStyle = theme.muted; font(ctx, 18, 800); ctx.fillText("REVENDA SMART", 238, 190); font(ctx, 20); tag(ctx, `${template.emoji} Oferta`, 805, 140, theme.accent);
  rect(ctx, 142, 226, 796, 72, 36, theme.dark); ctx.fillStyle = "#fff"; font(ctx, 28); ctx.textAlign = "center"; ctx.textBaseline = "middle"; wrap(ctx, config.headline, 540, 272, 720, 32, 1);
  const product = await resolveImage(config, warn); rect(ctx, 118, 316, 844, 452, 56, "#fff", theme.ring);
  if (product) fit(ctx, product, 142, 338, 796, 408); else { ctx.fillStyle = theme.accent; ctx.globalAlpha = .14; ctx.beginPath(); ctx.arc(540, 535, 112, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1; ctx.fillStyle = "#64748b"; font(ctx, 30); ctx.textAlign = "center"; ctx.fillText("Produto sem imagem", 540, 560); }
  let x = 132; font(ctx, 20); for (const chip of chips) x += tag(ctx, chip[0], x, 790, chip[1] ? theme.cta : theme.soft, chip[1] ? "#fff" : theme.dark);
  ctx.textAlign = "left"; ctx.textBaseline = "alphabetic"; ctx.fillStyle = theme.foreground; font(ctx, config.productName.length > 48 ? 42 : 50); wrap(ctx, config.productName, 132, 872, 816, 50, 2);
  if (config.note) { ctx.fillStyle = theme.muted; font(ctx, 21, 800); wrap(ctx, config.note, 132, 940, 460, 26, 1); }
  ctx.fillStyle = theme.muted; font(ctx, 20); ctx.fillText("POR APENAS", 132, 966); ctx.fillStyle = theme.accent; font(ctx, 70); ctx.fillText(config.priceText, 132, 1028);
  if (ctaText) { rect(ctx, 632, 930, 328, 88, 34, theme.cta); ctx.fillStyle = "#fff"; font(ctx, 23); ctx.textAlign = "center"; ctx.textBaseline = "middle"; wrap(ctx, ctaText, 796, 978, 278, 26, 2); }
  return new Promise((resolve, reject) => { try { canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("Falha no PNG")), "image/png", .95); } catch { reject(new Error("Falha no PNG")); } });
}
export function downloadMarketingCard(blob: Blob, productName: string) {
  const url = URL.createObjectURL(blob), link = document.createElement("a");
  link.download = `anuncio-${productName.toLowerCase().replace(/[^a-z0-9]+/gi, "-")}.png`; link.href = url; document.body.appendChild(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 3000);
}
