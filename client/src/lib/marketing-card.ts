import { getImage } from "@/lib/mock-data";
import { getMarketingAdImageCandidates, normalizeMarketingAdConfig, resolveMarketingAdTheme, resolveMarketingTemplate, type MarketingAdConfig, type MarketingAdInput } from "@/lib/marketing-ad";

export type MarketingCardPayload = MarketingAdInput;
const S = 1080, FONT = "Arial";
const loadImg = (src: string) => new Promise<HTMLImageElement | null>((resolve) => {
  const img = new Image(), timer = window.setTimeout(() => resolve(null), 9000);
  img.crossOrigin = "anonymous";
  img.onload = () => { window.clearTimeout(timer); resolve(img); };
  img.onerror = () => { window.clearTimeout(timer); resolve(null); };
  img.src = src;
});
async function resolveImage(config: MarketingAdConfig) {
  for (const src of getMarketingAdImageCandidates(config)) { const img = await loadImg(src); if (img) return img; }
  if (!config.imageId) return null;
  try { const src = await getImage(config.imageId); return src ? loadImg(src) : null; } catch { return null; }
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
export async function createMarketingCard(payload: MarketingCardPayload): Promise<Blob> {
  const config = normalizeMarketingAdConfig(payload), theme = resolveMarketingAdTheme(config.themeId, config.primaryColor), template = resolveMarketingTemplate(config.templateId);
  const canvas = document.createElement("canvas"), ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Não foi possível preparar a imagem");
  canvas.width = canvas.height = S;
  const grad = ctx.createLinearGradient(0, 0, S, S);
  grad.addColorStop(0, theme.soft); grad.addColorStop(.52, theme.accent); grad.addColorStop(1, theme.surface);
  ctx.fillStyle = config.backgroundStyle === "dark-premium" ? theme.dark : grad; ctx.fillRect(0, 0, S, S);
  ctx.globalAlpha = .18; for (const [x, y, r, fill] of [[1020, 80, 210, theme.cta], [70, 1030, 220, theme.accent]] as const) { ctx.fillStyle = fill; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); } ctx.globalAlpha = 1;
  ctx.shadowColor = "rgba(15,23,42,.18)"; ctx.shadowBlur = 42;
  rect(ctx, 74, 74, 932, 932, 72, config.backgroundStyle === "dark-premium" ? "rgba(15,23,42,.88)" : "rgba(255,255,255,.92)", theme.ring);
  ctx.shadowBlur = 0;
  const logo = config.storeLogoUrl ? await loadImg(config.storeLogoUrl) : null;
  rect(ctx, 122, 118, 92, 92, 30, "#fff", theme.ring);
  if (logo) fit(ctx, logo, 132, 128, 72, 72); else { ctx.fillStyle = theme.accent; font(ctx, 42); ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText((config.storeName || "R").slice(0, 1).toUpperCase(), 168, 165); }
  ctx.textAlign = "left"; ctx.textBaseline = "alphabetic"; ctx.fillStyle = theme.foreground; font(ctx, 38); wrap(ctx, config.storeName, 236, 157, 560, 42, 1);
  ctx.fillStyle = theme.muted; font(ctx, 18, 800); ctx.fillText("REVENDA SMART", 238, 190); font(ctx, 20); tag(ctx, `${template.emoji} Oferta`, 805, 140, theme.accent);
  rect(ctx, 142, 232, 796, 70, 35, theme.dark); ctx.fillStyle = "#fff"; font(ctx, 28); ctx.textAlign = "center"; ctx.textBaseline = "middle"; wrap(ctx, config.headline, 540, 276, 720, 32, 1);
  const product = await resolveImage(config); rect(ctx, 146, 330, 788, 330, 46, "#fff", theme.ring);
  if (product) fit(ctx, product, 185, 350, 710, 290); else { ctx.fillStyle = theme.accent; ctx.globalAlpha = .14; ctx.beginPath(); ctx.arc(540, 455, 86, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1; ctx.fillStyle = "#64748b"; font(ctx, 28); ctx.textAlign = "center"; ctx.fillText("Produto sem imagem", 540, 505); }
  let x = 146; font(ctx, 20);
  if (config.showStockStatus && config.stockStatus) x += tag(ctx, config.stockStatus, x, 700, theme.cta);
  if (config.showBrand && config.productBrand) x += tag(ctx, config.productBrand, x, 700, theme.soft, theme.dark);
  if (config.showVolume && config.productVolume) tag(ctx, config.productVolume, x, 700, theme.soft, theme.dark);
  ctx.textAlign = "left"; ctx.textBaseline = "alphabetic"; ctx.fillStyle = theme.foreground; font(ctx, 54); wrap(ctx, config.productName, 146, 810, 788, 58, 2);
  if (config.note) { ctx.fillStyle = theme.muted; font(ctx, 24, 800); wrap(ctx, config.note, 146, 902, 480, 28, 1); }
  ctx.fillStyle = theme.muted; font(ctx, 20); ctx.fillText("POR APENAS", 146, 940); ctx.fillStyle = theme.accent; font(ctx, 68); ctx.fillText(config.priceText, 146, 1000);
  if (config.showWhatsAppCta && config.ctaText) { rect(ctx, 650, 924, 286, 74, 30, theme.cta); ctx.fillStyle = "#fff"; font(ctx, 22); ctx.textAlign = "center"; ctx.textBaseline = "middle"; wrap(ctx, config.ctaText, 793, 966, 240, 24, 2); }
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("Não foi possível gerar o PNG")), "image/png", .95));
}
export function downloadMarketingCard(blob: Blob, productName: string) {
  const url = URL.createObjectURL(blob), link = document.createElement("a");
  link.download = `anuncio-${productName.toLowerCase().replace(/[^a-z0-9]+/gi, "-")}.png`; link.href = url; document.body.appendChild(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 3000);
}
