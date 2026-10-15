/**
 * ADS-PRO-FINAL — foto de produto SINTÉTICA porém realista (frasco de perfume em fundo liso de estúdio), para
 * as provas de runtime conferirem recorte, enquadramento e arte final com algo que se parece com um produto de
 * verdade (e não com um retângulo). Gerada com `sharp` a partir de um SVG: nada é baixado nem fica versionado.
 */
import sharp from "sharp";

export async function generatePerfumeBottlePng(size = 900, background = "#EFEDE7"): Promise<Buffer> {
  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 900 900">
  <defs>
    <linearGradient id="glass" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#7a3b12"/>
      <stop offset="0.28" stop-color="#d98a3b"/>
      <stop offset="0.5" stop-color="#f3c27a"/>
      <stop offset="0.78" stop-color="#c9772a"/>
      <stop offset="1" stop-color="#5e2b0b"/>
    </linearGradient>
    <linearGradient id="cap" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#8a6a1f"/>
      <stop offset="0.45" stop-color="#f1d37a"/>
      <stop offset="1" stop-color="#7a5a14"/>
    </linearGradient>
  </defs>
  <rect width="900" height="900" fill="${background}"/>
  <rect x="300" y="250" width="300" height="470" rx="46" fill="url(#glass)"/>
  <rect x="402" y="150" width="96" height="110" rx="10" fill="#c9a24b"/>
  <rect x="372" y="86" width="156" height="92" rx="16" fill="url(#cap)"/>
  <rect x="345" y="420" width="210" height="190" rx="10" fill="#fbf7ee"/>
  <rect x="372" y="458" width="156" height="14" rx="4" fill="#2b2118"/>
  <rect x="396" y="492" width="108" height="9" rx="3" fill="#8b7355"/>
  <rect x="384" y="524" width="132" height="9" rx="3" fill="#8b7355"/>
  <rect x="408" y="556" width="84" height="9" rx="3" fill="#8b7355"/>
  <rect x="322" y="276" width="26" height="410" rx="13" fill="#ffffff" opacity="0.28"/>
</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}
