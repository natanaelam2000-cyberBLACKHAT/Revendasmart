/**
 * Tradução CANÔNICA de MarketingProProviderArtDirection → descrição neutra — PRO-06B1 §10/§11.
 * Hardening PRO-06B2.8: remove qualquer termo que nomeie zonas por FUNÇÃO comercial (texto/CTA/rótulo).
 *
 * Uma única função constrói a descrição semântica; cada adapter de provider só adapta SINTAXE (como
 * empacotar o texto no request), nunca reescreve o conteúdo. Isso garante que os 3 providers recebem a
 * mesma instrução, palavra por palavra na parte estrutural — não "três prompts criativos diferentes".
 *
 * Fundamental (§7): o texto deixa explícito que é SÓ CENÁRIO/FUNDO — sem produto, embalagem, marca,
 * preço, texto, logotipo ou CTA — e que o resultado será usado ATRÁS do produto real pelo compositor
 * do RevendaSmart. Isso é o que se está comparando: capacidade de gerar fundo, não de recriar produto.
 *
 * PRO-06B2.8 — causa raiz de um vazamento semântico real (não técnico): a primeira rodada de smoke
 * real produziu 2 imagens do mesmo caso (beauty-luxury-01); uma saiu limpa, a outra veio com texto
 * renderizado ("PRIMARY HERE", "SECONDARY TEXTEM", "SHOP NOW"). O prompt anterior tinha uma restrição
 * explícita no topo ("Do NOT include any... text... call-to-action"), mas a seção de safe zones
 * REINTRODUZIA exatamente esses conceitos como SUBSTANTIVOS a serem "mantidos calmos": "the primary
 * text area (name/price)", "the secondary text area (store identity)", "the call-to-action area". Um
 * modelo de imagem lê "text area" e "call-to-action" como conceito a representar, não só como região a
 * evitar — "SHOP NOW" é quase uma leitura literal de "the call-to-action area". A frase de abertura
 * ("product advertisement") reforça esse viés, porque anúncios comerciais tipicamente têm texto no
 * conjunto de treino do modelo.
 *
 * Correção: as safe zones agora são descritas em linguagem PURAMENTE espacial, derivada da geometria
 * (`describeSpatialRegion`) — nunca do nome da região (`region: "primaryText"` etc. continua existindo
 * no tipo/contrato, só não vira mais texto no prompt). A abertura não usa mais "advertisement". A lista
 * de restrições ficou exaustiva (palavra, letra, número, tipografia, logotipo, rótulo, botão, CTA,
 * placeholder, caixa de texto, painel, interface, card, template gráfico, moldura para texto,
 * simulação de anúncio pronto, produto/embalagem real ou fictícia).
 */

import type { MarketingProProviderArtDirection, MarketingProRect } from "../../shared/marketing-pro-contract";

export const MARKETING_PRO_BENCHMARK_PROMPT_VERSION = "marketing-pro-benchmark-v1";

const LIGHTING_TEXT: Record<string, string> = {
  soft: "soft, diffused lighting",
  dramatic: "dramatic lighting with deep, controlled shadows",
  studio: "clean studio lighting",
  cinematic: "cinematic lighting with directional highlights",
  natural: "natural, even daylight-style lighting",
};

const SURFACE_TEXT: Record<string, string> = {
  clean: "a clean, unobtrusive surface",
  reflective: "a subtly reflective surface",
  matte: "a soft matte surface",
  textured: "a gently textured surface",
  pedestal: "a minimal pedestal-style surface",
};

const ATMOSPHERE_TEXT: Record<string, string> = {
  refined: "a refined, restrained atmosphere",
  structured: "a structured, editorial atmosphere",
  quiet: "a quiet, minimal atmosphere",
  tactile: "a soft, tactile atmosphere",
  energetic: "a clean, energetic atmosphere",
};

/**
 * Converte um retângulo fracionário (0..1) numa posição puramente espacial ("upper-center",
 * "lower-right"...) — nunca no NOME da região (`primaryText`/`callToAction`/...). É essa troca que
 * fecha o vazamento semântico: a geometria não carrega intenção comercial, só o nome carregava.
 */
function describeSpatialRegion(rect: MarketingProRect): string {
  const centerY = rect.y + rect.height / 2;
  const centerX = rect.x + rect.width / 2;
  const vertical = centerY < 0.34 ? "upper" : centerY > 0.66 ? "lower" : "center";
  const horizontal = centerX < 0.34 ? "left" : centerX > 0.66 ? "right" : "center";
  if (vertical === "center" && horizontal === "center") return "center";
  if (horizontal === "center") return `${vertical}-center`;
  if (vertical === "center") return `center-${horizontal}`;
  return `${vertical}-${horizontal}`;
}

/**
 * Descrição textual neutra do caso — determinística (mesma entrada, mesma saída), sem nenhum dado
 * comercial porque `MarketingProProviderArtDirection` estruturalmente não carrega nenhum (garantido por
 * tipo em shared/marketing-pro-contract.ts, ver `AssertNoForbiddenProviderFields`). PRO-06B2.8: também
 * sem nenhuma palavra que nomeie zonas por função comercial (texto/CTA/rótulo) — só geometria.
 */
export function buildMarketingProBenchmarkPromptText(artDirection: MarketingProProviderArtDirection): string {
  const paletteText = artDirection.palette.join(", ");
  const safeZoneText = artDirection.requestedSafeZones
    .map((zone) => `- Keep the ${describeSpatialRegion(zone.rect)} area visually quiet and uncluttered: avoid strong focal objects, sharp edges, or busy detail there (spatial guidance only, not a guaranteed mask).`)
    .join("\n");

  return [
    `Generate a background scene only — a photographic backdrop for a ${artDirection.category} product photo, in a ${artDirection.style} visual style.`,
    `Lighting: ${LIGHTING_TEXT[artDirection.lighting] ?? artDirection.lighting}.`,
    `Surface: ${SURFACE_TEXT[artDirection.surface] ?? artDirection.surface}.`,
    `Atmosphere: ${ATMOSPHERE_TEXT[artDirection.atmosphere] ?? artDirection.atmosphere}.`,
    `Color palette to draw from: ${paletteText}.`,
    "",
    "Strict constraints — this is a plain photographic background, NOT an advertisement mockup:",
    "- Do NOT render any word, letter, number, or typography of any kind, in any language.",
    "- Do NOT render any logo, watermark, brand mark, or icon.",
    "- Do NOT render any label, badge, button, CTA, or call-to-action.",
    "- Do NOT render any placeholder, text box, panel, card, banner, or frame intended to hold text.",
    "- Do NOT render any user-interface element or graphic ad template of any kind.",
    "- Do NOT render any finished advertisement layout or mockup of a finished ad.",
    "- Do NOT render any product, packaging, or object resembling a product — real or fictional.",
    "- Do NOT render any people, hands, or packaging mockups.",
    "- This is a BACKGROUND ONLY: plain environment, surface, lighting, and atmosphere. A real product photo and all commercial elements will be composited on top of this image afterwards, by a separate rendering pipeline — none of that belongs in this image.",
    "- Preserve open, uncluttered negative space in the spatial regions below:",
    safeZoneText,
  ].join("\n");
}
