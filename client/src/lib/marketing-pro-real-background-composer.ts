/**
 * PRO-08 — composição LOCAL final: approvedCutout (já aprovado, PRO-07K) + background real (PRO-08)
 * → canvas → preview/export. O produto entra SOMENTE aqui, depois que o background já terminou de ser
 * gerado — nunca antes, nunca no servidor (§9 da tarefa: "Sem approvedCutout: não compor. Fail closed.").
 *
 * Deliberadamente um compositor PRÓPRIO, mais simples que o Composer Premium V2
 * (`client/src/lib/marketing-pro-creative-v2-renderer.ts`), que desenha tokens determinísticos gerados
 * localmente — aqui o fundo é uma IMAGEM real baixada do provider, não um token. Reaproveita a mesma
 * geometria de "zona do produto" (`MARKETING_PRO_PRODUCT_ZONE`, shared/marketing-pro-contract.ts) para
 * que o produto caia na mesma área que o provider foi instruído a deixar vazia.
 */
import { MARKETING_PRO_FORMAT_DIMENSIONS, MARKETING_PRO_PRODUCT_ZONE, resolveMarketingProProductPlacement, type MarketingProFormat } from "@shared/marketing-pro-contract";
import type { CreativeConcept } from "@shared/marketing-pro-creative-intelligence";
import type { ProductTruth, ProductVisualUnderstanding } from "@shared/marketing-pro-creative-intelligence";

export class MarketingProRealBackgroundComposeError extends Error {}

/**
 * ADS-PRO-03 §10 — versão formal do composer canônico (`composeMarketingProProfessionalAdPreview`),
 * persistida por registro de histórico. Existe só para que um anúncio criado pelo composer v1 nunca seja
 * interpretado, no futuro, como se tivesse vindo de uma v2 com geometria/regras diferentes — não é um
 * framework de migração, só um inteiro que muda quando este arquivo muda de forma incompatível.
 */
export const MARKETING_PRO_COMPOSER_VERSION = 1 as const;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new MarketingProRealBackgroundComposeError(`Falha ao carregar imagem: ${src}`));
    img.src = src;
  });
}

/**
 * Desenha o background esticado para preencher o canvas (cover) e o cutout centralizado dentro da
 * `MARKETING_PRO_PRODUCT_ZONE` do formato, preservando a proporção original do cutout (nunca distorce
 * o produto). Fail-closed: exige as duas URLs — sem approvedCutout, o call site nunca deve chegar aqui.
 */
export async function composeMarketingProRealBackgroundPreview(input: {
  readonly backgroundImageSrc: string;
  readonly cutoutImageSrc: string;
  readonly format: MarketingProFormat;
}): Promise<HTMLCanvasElement> {
  const dimensions = MARKETING_PRO_FORMAT_DIMENSIONS[input.format];
  const zone = MARKETING_PRO_PRODUCT_ZONE[input.format];

  const [background, cutout] = await Promise.all([
    loadImage(input.backgroundImageSrc),
    loadImage(input.cutoutImageSrc),
  ]);

  const canvas = document.createElement("canvas");
  canvas.width = dimensions.width;
  canvas.height = dimensions.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new MarketingProRealBackgroundComposeError("Canvas 2D indisponível.");

  // Background: cover (preenche o canvas inteiro, recorta o excesso, nunca distorce).
  const bgScale = Math.max(canvas.width / background.width, canvas.height / background.height);
  const bgWidth = background.width * bgScale;
  const bgHeight = background.height * bgScale;
  ctx.drawImage(background, (canvas.width - bgWidth) / 2, (canvas.height - bgHeight) / 2, bgWidth, bgHeight);

  // Produto: contain dentro da zona reservada, proporção original preservada.
  const zoneX = zone.x * canvas.width;
  const zoneY = zone.y * canvas.height;
  const zoneWidth = zone.width * canvas.width;
  const zoneHeight = zone.height * canvas.height;
  const cutoutScale = Math.min(zoneWidth / cutout.width, zoneHeight / cutout.height);
  const cutoutWidth = cutout.width * cutoutScale;
  const cutoutHeight = cutout.height * cutoutScale;
  const cutoutX = zoneX + (zoneWidth - cutoutWidth) / 2;
  const cutoutY = zoneY + (zoneHeight - cutoutHeight) / 2;
  ctx.drawImage(cutout, cutoutX, cutoutY, cutoutWidth, cutoutHeight);

  return canvas;
}

export function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), "image/png"));
}

export interface MarketingProProfessionalAdLayout {
  readonly productRect: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
  readonly textAlign: CanvasTextAlign;
  readonly textX: number;
  readonly nameY: number;
  readonly priceY: number;
  readonly productScale: number;
  readonly accent: "line" | "circle" | "card" | "frame" | "none";
}

export interface MarketingProProductDrawBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly visibleAspectRatio: number;
  readonly productWidthShare: number;
}

/**
 * ADS-PRO-01/02 nota de auditoria: `productRect`/`productScale` abaixo são calculados por família mas,
 * em `composeMarketingProProfessionalAdPreview`, são imediatamente sobrescritos pelo retângulo/escala
 * reais de `resolveMarketingProProductPlacement` (shared/marketing-pro-contract.ts) — a autoridade
 * geométrica de fato é essa função, não este mapa. Deliberadamente NÃO removidos:
 * script/pro14g-hardening-tests.ts:96 lê `layout.productRect` diretamente
 * (`buildMarketingProProfessionalAdLayout`), então remover quebraria uma prova real existente; ADS-PRO-02
 * §19 pede documentar, não misturar essa limpeza num ticket de outra coisa. `textAlign`/`textX`/`nameY`/
 * `priceY`/`accent` continuam vivos e usados normalmente.
 */
const PROFESSIONAL_LAYOUTS: Record<CreativeConcept["creativeFamily"], MarketingProProfessionalAdLayout> = {
  luxury: { productRect: { x: 0.40, y: 0.18, width: 0.54, height: 0.69 }, textAlign: "left", textX: 0.08, nameY: 0.20, priceY: 0.72, productScale: 1, accent: "line" },
  editorial: { productRect: { x: 0.43, y: 0.14, width: 0.51, height: 0.72 }, textAlign: "left", textX: 0.07, nameY: 0.17, priceY: 0.76, productScale: 0.96, accent: "frame" },
  modern: { productRect: { x: 0.42, y: 0.19, width: 0.53, height: 0.65 }, textAlign: "left", textX: 0.07, nameY: 0.18, priceY: 0.72, productScale: 0.94, accent: "card" },
  minimal: { productRect: { x: 0.34, y: 0.22, width: 0.61, height: 0.65 }, textAlign: "left", textX: 0.07, nameY: 0.16, priceY: 0.79, productScale: 0.9, accent: "none" },
  sensory: { productRect: { x: 0.38, y: 0.20, width: 0.57, height: 0.68 }, textAlign: "left", textX: 0.07, nameY: 0.17, priceY: 0.75, productScale: 0.92, accent: "circle" },
  "fresh-premium": { productRect: { x: 0.44, y: 0.16, width: 0.50, height: 0.69 }, textAlign: "left", textX: 0.07, nameY: 0.18, priceY: 0.74, productScale: 0.94, accent: "line" },
  "fresh-sport": { productRect: { x: 0.38, y: 0.16, width: 0.58, height: 0.70 }, textAlign: "left", textX: 0.06, nameY: 0.18, priceY: 0.74, productScale: 1, accent: "circle" },
  "fresh-commercial": { productRect: { x: 0.46, y: 0.19, width: 0.48, height: 0.65 }, textAlign: "left", textX: 0.06, nameY: 0.18, priceY: 0.68, productScale: 0.95, accent: "card" },
};

/** Regras reutilizáveis por família; nenhum SKU aparece neste mapa. */
export function buildMarketingProProfessionalAdLayout(concept: Pick<CreativeConcept, "creativeFamily">): MarketingProProfessionalAdLayout {
  return PROFESSIONAL_LAYOUTS[concept.creativeFamily];
}

function readableTextColor(primaryColor?: string): string {
  return /^#[0-9a-f]{6}$/i.test(primaryColor || "") ? primaryColor!.toUpperCase() : "#111827";
}

function drawFamilyDecoration(ctx: CanvasRenderingContext2D, layout: MarketingProProfessionalAdLayout, color: string): void {
  ctx.save();
  ctx.globalAlpha = 0.18;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 8;
  if (layout.accent === "line") ctx.fillRect(72, 125, 8, 310);
  if (layout.accent === "circle") { ctx.beginPath(); ctx.arc(860, 185, 155, 0, Math.PI * 2); ctx.stroke(); }
  if (layout.accent === "frame") ctx.strokeRect(56, 56, 968, 968);
  if (layout.accent === "card") { ctx.beginPath(); ctx.roundRect(45, 635, 350, 300, 36); ctx.fill(); }
  ctx.restore();
}

function resolveVisibleImageBounds(image: HTMLImageElement): { readonly sx: number; readonly sy: number; readonly sw: number; readonly sh: number } {
  try {
    const scratch = document.createElement("canvas");
    scratch.width = image.width;
    scratch.height = image.height;
    const scratchCtx = scratch.getContext("2d", { willReadFrequently: true });
    if (!scratchCtx) return { sx: 0, sy: 0, sw: image.width, sh: image.height };
    scratchCtx.drawImage(image, 0, 0);
    const pixels = scratchCtx.getImageData(0, 0, image.width, image.height).data;
    let minX = image.width;
    let minY = image.height;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < image.height; y += 1) {
      for (let x = 0; x < image.width; x += 1) {
        if (pixels[(y * image.width + x) * 4 + 3] <= 12) continue;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
    if (maxX < minX || maxY < minY) return { sx: 0, sy: 0, sw: image.width, sh: image.height };
    const pad = 4;
    const sx = Math.max(0, minX - pad);
    const sy = Math.max(0, minY - pad);
    const ex = Math.min(image.width - 1, maxX + pad);
    const ey = Math.min(image.height - 1, maxY + pad);
    return { sx, sy, sw: ex - sx + 1, sh: ey - sy + 1 };
  } catch {
    return { sx: 0, sy: 0, sw: image.width, sh: image.height };
  }
}

function drawProductGrounding(ctx: CanvasRenderingContext2D, bounds: Pick<MarketingProProductDrawBounds, "x" | "y" | "width" | "height" | "visibleAspectRatio">): void {
  const horizontal = bounds.visibleAspectRatio >= 1.2;
  const cx = bounds.x + bounds.width / 2;
  const bottom = bounds.y + bounds.height;
  ctx.save();
  ctx.globalCompositeOperation = "multiply";
  ctx.fillStyle = "rgba(15, 23, 42, 0.22)";
  ctx.filter = "blur(22px)";
  ctx.beginPath();
  ctx.ellipse(cx, bottom + (horizontal ? 12 : 18), bounds.width * (horizontal ? 0.42 : 0.32), Math.max(16, bounds.height * 0.07), 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.filter = "blur(42px)";
  ctx.fillStyle = "rgba(15, 23, 42, 0.12)";
  ctx.beginPath();
  ctx.ellipse(cx, bottom + (horizontal ? 24 : 30), bounds.width * (horizontal ? 0.54 : 0.42), Math.max(24, bounds.height * 0.12), 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawContainedImage(ctx: CanvasRenderingContext2D, image: HTMLImageElement, rect: MarketingProProfessionalAdLayout["productRect"], scaleMultiplier: number, options?: { readonly grounding?: boolean; readonly productOrientation?: ProductVisualUnderstanding["observed"]["productOrientation"] }): MarketingProProductDrawBounds {
  const box = { x: rect.x * 1080, y: rect.y * 1080, width: rect.width * 1080, height: rect.height * 1080 };
  const source = resolveVisibleImageBounds(image);
  const visibleAspectRatio = source.sw / source.sh;
  const horizontal = options?.productOrientation === "landscape" || visibleAspectRatio >= 1.2;
  const targetHorizontalWidthShare = Math.min(0.70, Math.max(0.55, 0.58 * scaleMultiplier));
  const scale = horizontal
    ? Math.min((1080 * targetHorizontalWidthShare) / source.sw, (box.width * 0.98) / source.sw)
    : Math.min(
      Math.min(box.width / source.sw, box.height / source.sh) * scaleMultiplier,
      (box.width * 0.98) / source.sw,
      (box.height * 0.96) / source.sh,
    );
  const width = source.sw * scale;
  const height = source.sh * scale;
  const x = box.x + (box.width - width) / 2;
  const y = horizontal
    ? box.y + box.height - height * (visibleAspectRatio >= 1.2 ? 1.04 : 0.72)
    : box.y + (box.height - height) / 2;
  const bounds = { x, y, width, height, visibleAspectRatio, productWidthShare: width / 1080 };
  if (options?.grounding) drawProductGrounding(ctx, bounds);
  // ÚNICO desenho do approvedCutout: apenas escala e posição; os pixels-fonte não são editados.
  ctx.drawImage(image, source.sx, source.sy, source.sw, source.sh, x, y, width, height);
  return bounds;
}

function formatTruthPrice(value: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

function drawCommercialTruth(ctx: CanvasRenderingContext2D, truth: ProductTruth, concept: CreativeConcept, layout: MarketingProProfessionalAdLayout, color: string): void {
  const x = layout.textX * 1080;
  ctx.save();
  ctx.fillStyle = "#111827";
  ctx.textAlign = layout.textAlign;
  ctx.textBaseline = "top";
  ctx.font = concept.creativeFamily === "luxury" ? "600 54px Georgia, serif" : "800 52px Arial, sans-serif";
  const title = truth.name.length > 28 ? `${truth.name.slice(0, 27)}…` : truth.name;
  ctx.fillText(title, x, layout.nameY * 1080, 330);
  if (truth.brand) { ctx.font = "700 23px Arial, sans-serif"; ctx.fillStyle = color; ctx.fillText(truth.brand.toUpperCase().slice(0, 32), x, layout.nameY * 1080 + 68, 330); }
  if (typeof truth.salePrice === "number") {
    const promotional = typeof truth.promotionalPrice === "number" && truth.promotionalPrice > 0 && truth.promotionalPrice < truth.salePrice;
    const price = promotional ? truth.promotionalPrice! : truth.salePrice;
    if (promotional) {
      ctx.font = "500 23px Arial, sans-serif"; ctx.fillStyle = "#4B5563";
      ctx.fillText(`de ${formatTruthPrice(truth.salePrice)}`, x, layout.priceY * 1080 - 34, 330);
    }
    ctx.font = concept.priceTreatment === "highlight" ? "900 54px Arial, sans-serif" : "800 43px Arial, sans-serif";
    ctx.fillStyle = "#111827"; ctx.fillText(formatTruthPrice(price), x, layout.priceY * 1080, 340);
    if (promotional && concept.promotionTreatment !== "none") {
      const discount = Math.round((1 - price / truth.salePrice) * 100);
      ctx.fillStyle = color; ctx.beginPath(); ctx.roundRect(x, layout.priceY * 1080 + 72, 154, 46, 23); ctx.fill();
      ctx.fillStyle = "#FFFFFF"; ctx.font = "800 21px Arial, sans-serif"; ctx.fillText(`${discount}% OFF`, x + 20, layout.priceY * 1080 + 83, 120);
    }
  }
  ctx.restore();
}

/**
 * Arte Pro square real: fundo aprovado → decoração determinística → cutout intacto → ProductTruth → branding.
 * O background e o cutout são entradas separadas e jamais são persistidos um sobre o outro.
 */
export async function composeMarketingProProfessionalAdPreview(input: {
  readonly backgroundImageSrc: string;
  readonly cutoutImageSrc: string;
  readonly concept: CreativeConcept;
  readonly productTruth: ProductTruth;
  readonly productUnderstanding?: Pick<ProductVisualUnderstanding, "observed">;
  readonly branding?: { readonly storeName?: string; readonly primaryColor?: string; readonly logoUrl?: string };
}): Promise<HTMLCanvasElement> {
  const [background, cutout, logo] = await Promise.all([
    loadImage(input.backgroundImageSrc),
    loadImage(input.cutoutImageSrc),
    input.branding?.logoUrl ? loadImage(input.branding.logoUrl).catch(() => undefined) : Promise.resolve(undefined),
  ]);
  const canvas = document.createElement("canvas");
  canvas.width = 1080; canvas.height = 1080;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new MarketingProRealBackgroundComposeError("Canvas 2D indisponível.");
  const bgScale = Math.max(1080 / background.width, 1080 / background.height);
  const bgWidth = background.width * bgScale; const bgHeight = background.height * bgScale;
  ctx.drawImage(background, (1080 - bgWidth) / 2, (1080 - bgHeight) / 2, bgWidth, bgHeight);
  const cutoutVisibleBounds = resolveVisibleImageBounds(cutout);
  const cutoutAspectRatio = cutoutVisibleBounds.sw > 0 && cutoutVisibleBounds.sh > 0 ? cutoutVisibleBounds.sw / cutoutVisibleBounds.sh : undefined;
  const canonicalPlacement = resolveMarketingProProductPlacement({
    format: "square",
    creativeFamily: input.concept.creativeFamily,
    productUnderstanding: input.productUnderstanding,
    productAspectRatio: cutoutAspectRatio,
  });
  const layout = { ...buildMarketingProProfessionalAdLayout(input.concept), productRect: canonicalPlacement.rect, productScale: canonicalPlacement.scale };
  const brandColor = readableTextColor(input.branding?.primaryColor);
  drawFamilyDecoration(ctx, layout, brandColor);
  drawContainedImage(ctx, cutout, layout.productRect, layout.productScale, { grounding: true, productOrientation: input.productUnderstanding?.observed.productOrientation });
  drawCommercialTruth(ctx, input.productTruth, input.concept, layout, brandColor);
  ctx.save(); ctx.fillStyle = "#111827"; ctx.textAlign = "right"; ctx.font = "700 20px Arial, sans-serif";
  ctx.fillText((input.branding?.storeName || "RevendaSmart").slice(0, 42), 1010, 1014);
  if (logo) ctx.drawImage(logo, 930, 948, 64, 64);
  ctx.restore();
  return canvas;
}
