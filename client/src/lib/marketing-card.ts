export interface MarketingCardPayload {
  productName: string;
  imageUrl?: string;
  price: string;
  headline: string;
  storeName: string;
  primaryColor: string;
}
const loadImage = (url?: string) => new Promise<HTMLImageElement | null>(resolve => {
  if (!url) return resolve(null);
  const image = new Image();
  image.crossOrigin = "anonymous";
  image.onload = () => resolve(image);
  image.onerror = () => resolve(null);
  image.src = url;
});
export async function createMarketingCard(payload: MarketingCardPayload): Promise<Blob> {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Não foi possível preparar a imagem");
  canvas.width = 1080; canvas.height = 1080;
  const gradient = ctx.createLinearGradient(0, 0, 1080, 1080);
  gradient.addColorStop(0, payload.primaryColor || "#ec4899"); gradient.addColorStop(1, "#ffffff");
  ctx.fillStyle = gradient; ctx.fillRect(0, 0, 1080, 1080);
  ctx.fillStyle = "#ffffff"; ctx.shadowColor = "rgba(0,0,0,.12)"; ctx.shadowBlur = 50;
  ctx.beginPath(); ctx.roundRect(100, 100, 880, 880, 80); ctx.fill(); ctx.shadowBlur = 0;
  ctx.fillStyle = payload.primaryColor || "#ec4899"; ctx.font = "900 40px sans-serif"; ctx.textAlign = "center";
  ctx.fillText((payload.storeName || "RevendaSmart").toUpperCase().slice(0, 35), 540, 190);
  const image = await loadImage(payload.imageUrl);
  if (image) {
    const ratio = Math.min(500 / image.width, 500 / image.height);
    const width = image.width * ratio, height = image.height * ratio;
    ctx.drawImage(image, 540 - width / 2, 475 - height / 2, width, height);
  }
  ctx.fillStyle = payload.primaryColor || "#ec4899"; ctx.beginPath(); ctx.roundRect(260, 740, 560, 82, 41); ctx.fill();
  ctx.fillStyle = "#ffffff"; ctx.font = "900 30px sans-serif"; ctx.fillText(payload.headline.slice(0, 34), 540, 792);
  ctx.fillStyle = "#1f2937"; ctx.font = "900 48px sans-serif"; ctx.fillText(payload.productName.slice(0, 32), 540, 900);
  ctx.fillStyle = payload.primaryColor || "#ec4899"; ctx.font = "900 72px sans-serif"; ctx.fillText(`R$ ${payload.price}`, 540, 990);
  return await new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("Não foi possível gerar o PNG")), "image/png", 0.92));
}
export function downloadMarketingCard(blob: Blob, productName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.download = `anuncio-${productName.toLowerCase().replace(/[^a-z0-9]+/gi, "-")}.png`;
  link.href = url; document.body.appendChild(link); link.click(); link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}
