/**
 * PRO-07J — renderer real (canvas) do Premium Creative Composer V2. Porta para TypeScript a mesma
 * lógica de desenho já validada no harness isolado (PRO-07I,
 * `script/product-cutout-smoke/marketing-pro-creative-v2-harness.html`): mesma ordem de camadas, mesma
 * fórmula de gradiente, mesmo tratamento de grounding/decoração/CTA por família.
 *
 * ORDEM DE CAMADAS (§7, nunca reordenar): fundo -> decorações ambientais -> grounding
 * (glow/pedestal/sombra) -> PRODUTO (drawImage exato do ProductTransform) -> texto/preço/CTA.
 * Nenhuma decoração ou grounding é desenhada depois do produto — todas essas camadas terminam antes de
 * `ctx.drawImage(cutoutImage, ...)`. O produto nunca é lido de volta pixel a pixel neste arquivo — só
 * desenhado, com os valores exatos do ProductTransform aprovado.
 */
import type { MarketingProCreativeV2Payload } from "./marketing-pro-creative-v2";

const CANVAS_WIDTH = 1080;
const CANVAS_HEIGHT = 1350;

function rectPx(rect: { x: number; y: number; width: number; height: number }, width: number, height: number) {
  return { x: rect.x * width, y: rect.y * height, width: rect.width * width, height: rect.height * height };
}

function gradientToCanvas(
  ctx: CanvasRenderingContext2D,
  angleDeg: number,
  stops: readonly { readonly offset: number; readonly color: string }[],
  width: number,
  height: number,
): CanvasGradient {
  const angleRad = (angleDeg * Math.PI) / 180;
  const length = Math.abs(width * Math.sin(angleRad)) + Math.abs(height * Math.cos(angleRad));
  const cx = width / 2;
  const cy = height / 2;
  const half = length / 2;
  const x0 = cx - Math.sin(angleRad) * half;
  const y0 = cy + Math.cos(angleRad) * half;
  const x1 = cx + Math.sin(angleRad) * half;
  const y1 = cy - Math.cos(angleRad) * half;
  const gradient = ctx.createLinearGradient(x0, y0, x1, y1);
  for (const stop of stops) gradient.addColorStop(stop.offset, stop.color);
  return gradient;
}

function drawEnvironmentalDecorations(ctx: CanvasRenderingContext2D, payload: MarketingProCreativeV2Payload) {
  for (const decoration of payload.tokens.decorations) {
    const rect = rectPx(decoration.rect, CANVAS_WIDTH, CANVAS_HEIGHT);
    ctx.save();
    ctx.globalAlpha = decoration.opacity;
    ctx.fillStyle = decoration.color;
    if (decoration.kind === "line") {
      ctx.fillRect(rect.x, rect.y, rect.width, Math.max(rect.height, 1));
    } else if (decoration.kind === "arc") {
      ctx.beginPath();
      ctx.ellipse(rect.x + rect.width / 2, rect.y + rect.height / 2, rect.width / 2, rect.height / 2, 0, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
    }
    ctx.restore();
  }
}

function drawGrounding(ctx: CanvasRenderingContext2D, payload: MarketingProCreativeV2Payload, productBoxPx: { x: number; y: number; width: number; height: number }) {
  const grounding = payload.tokens.grounding;
  const footprintCenterX = payload.transform.translateX + payload.transform.targetWidth / 2;
  const footprintBottomY = payload.transform.translateY + payload.transform.targetHeight;
  const direction = payload.tokens.composition.glowDirection;
  const glowCenterY = direction === "top"
    ? payload.transform.translateY + payload.transform.targetHeight * 0.18
    : direction === "bottom"
      ? footprintBottomY - payload.transform.targetHeight * 0.1
      : payload.transform.translateY + payload.transform.targetHeight * 0.5;
  const glowCenterX = direction === "diagonal" ? footprintCenterX + payload.transform.targetWidth * 0.18 : footprintCenterX;

  ctx.save();
  const glowRadius = Math.max(payload.transform.targetWidth, payload.transform.targetHeight) * (0.7 + grounding.glowIntensity * 0.4);
  const glow = ctx.createRadialGradient(glowCenterX, glowCenterY, 0, glowCenterX, glowCenterY, glowRadius);
  const alphaHex = Math.round(grounding.glowIntensity * 255).toString(16).padStart(2, "0");
  glow.addColorStop(0, grounding.glowColor + alphaHex);
  glow.addColorStop(1, grounding.glowColor + "00");
  ctx.fillStyle = glow;
  ctx.fillRect(productBoxPx.x - 80, productBoxPx.y - 80, productBoxPx.width + 160, productBoxPx.height + 160);
  ctx.restore();

  if (grounding.pedestalStyle === "soft-radial") {
    ctx.save();
    ctx.globalAlpha = 0.5;
    const pedestal = ctx.createRadialGradient(footprintCenterX, footprintBottomY + 6, 2, footprintCenterX, footprintBottomY + 6, payload.transform.targetWidth * 0.55);
    pedestal.addColorStop(0, grounding.glowColor + "66");
    pedestal.addColorStop(1, grounding.glowColor + "00");
    ctx.fillStyle = pedestal;
    ctx.beginPath();
    ctx.ellipse(footprintCenterX, footprintBottomY + 6, payload.transform.targetWidth * 0.6, 24, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  } else if (grounding.pedestalStyle === "graphic-plate") {
    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.roundRect(footprintCenterX - payload.transform.targetWidth * 0.42, footprintBottomY - 6, payload.transform.targetWidth * 0.84, 14, 7);
    ctx.fill();
    ctx.restore();
  } else {
    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.strokeStyle = grounding.glowColor;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(footprintCenterX - payload.transform.targetWidth * 0.5, footprintBottomY + 2);
    ctx.lineTo(footprintCenterX + payload.transform.targetWidth * 0.5, footprintBottomY + 2);
    ctx.stroke();
    ctx.restore();
  }

  ctx.save();
  ctx.globalAlpha = grounding.shadowOpacity;
  ctx.fillStyle = "#000000";
  ctx.beginPath();
  ctx.ellipse(footprintCenterX, footprintBottomY + 10, payload.transform.targetWidth * 0.4, 15, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawCommercialOverlay(ctx: CanvasRenderingContext2D, payload: MarketingProCreativeV2Payload) {
  const typography = payload.tokens.typography;
  const align = payload.tokens.composition.textAlign;
  ctx.fillStyle = typography.foreground;
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = align;

  const storeBox = rectPx(payload.safeZones.store, CANVAS_WIDTH, CANVAS_HEIGHT);
  const storeX = align === "center" ? storeBox.x + storeBox.width / 2 : storeBox.x;
  ctx.font = "900 30px system-ui, sans-serif";
  ctx.fillText(payload.overlay.storeName, storeX, storeBox.y + storeBox.height * 0.7);

  const nameBox = rectPx(payload.safeZones.productName, CANVAS_WIDTH, CANVAS_HEIGHT);
  const nameX = align === "center" ? nameBox.x + nameBox.width / 2 : nameBox.x;
  ctx.font = "900 46px system-ui, sans-serif";
  ctx.fillText(payload.overlay.productName, nameX, nameBox.y + nameBox.height * 0.55);
  if (payload.overlay.brand) {
    ctx.font = "600 24px system-ui, sans-serif";
    ctx.fillStyle = typography.mutedForeground;
    ctx.fillText(payload.overlay.brand, nameX, nameBox.y + nameBox.height * 0.98);
    ctx.fillStyle = typography.foreground;
  }

  const priceBox = rectPx(payload.safeZones.price, CANVAS_WIDTH, CANVAS_HEIGHT);
  const priceX = align === "center" ? priceBox.x + priceBox.width / 2 : priceBox.x;
  ctx.font = "900 58px system-ui, sans-serif";
  ctx.fillText(payload.overlay.priceText, priceX, priceBox.y + priceBox.height * 0.85);

  const benefitsBox = rectPx(payload.safeZones.benefits, CANVAS_WIDTH, CANVAS_HEIGHT);
  const benefitsX = align === "center" ? benefitsBox.x + benefitsBox.width / 2 : benefitsBox.x;
  ctx.font = "600 22px system-ui, sans-serif";
  ctx.fillStyle = typography.mutedForeground;
  ctx.fillText(payload.overlay.benefits.join("  ·  "), benefitsX, benefitsBox.y + benefitsBox.height * 0.7);
  ctx.textAlign = "left";

  const cta = payload.tokens.cta;
  const ctaBox = rectPx(payload.safeZones.cta, CANVAS_WIDTH, CANVAS_HEIGHT);
  ctx.save();
  ctx.translate(ctaBox.x, ctaBox.y);
  ctx.beginPath();
  if (cta.strategy === "cyan-graphic-block") {
    ctx.rect(0, 0, ctaBox.width, ctaBox.height);
  } else {
    ctx.roundRect(0, 0, ctaBox.width, ctaBox.height, cta.strategy === "champagne-outline-pill" ? ctaBox.height / 2 : 6);
  }
  ctx.fillStyle = gradientToCanvas(ctx, cta.angleDeg, cta.stops, ctaBox.width, ctaBox.height);
  ctx.fill();
  if (cta.borderColor) {
    ctx.lineWidth = 2;
    ctx.strokeStyle = cta.borderColor;
    ctx.stroke();
  }
  ctx.fillStyle = cta.textColor;
  ctx.font = "900 28px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(payload.overlay.ctaLabel, ctaBox.width / 2, ctaBox.height / 2 + 10);
  ctx.textAlign = "left";
  ctx.restore();
}

/**
 * Preview e Export chamam esta MESMA função com o MESMO `payload` (§8) — nunca duas implementações,
 * nunca recalcula layout separadamente. `productImage` é o cutout aprovado já carregado (HTMLImageElement
 * ou equivalente desenhável), nunca decodificado/alterado aqui.
 */
export function renderPremiumCreativeV2(ctx: CanvasRenderingContext2D, payload: MarketingProCreativeV2Payload, productImage: CanvasImageSource): void {
  ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

  ctx.fillStyle = gradientToCanvas(ctx, payload.tokens.background.angleDeg, payload.tokens.background.stops, CANVAS_WIDTH, CANVAS_HEIGHT);
  ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

  drawEnvironmentalDecorations(ctx, payload);

  const productBoxPx = rectPx(payload.safeZones.product, CANVAS_WIDTH, CANVAS_HEIGHT);
  drawGrounding(ctx, payload, productBoxPx);

  // PRODUTO — geometria EXATA do ProductTransform aprovado (uniform-contain, allowCrop=false). Nunca
  // recalculado, nunca outro valor, nunca lido de volta pixel a pixel.
  ctx.drawImage(productImage, payload.transform.translateX, payload.transform.translateY, payload.transform.targetWidth, payload.transform.targetHeight);

  drawCommercialOverlay(ctx, payload);
}
