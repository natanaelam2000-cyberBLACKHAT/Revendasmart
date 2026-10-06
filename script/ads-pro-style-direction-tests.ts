/**
 * ADS-PRO-FINAL — o perfil de estilo INFLUENCIA a geração de forma observável e determinística.
 */
import assert from "node:assert/strict";
import { ensureReadableAccent, contrastRatio, readableOn, MIN_TEXT_CONTRAST } from "../shared/ads-pro/ad-contrast";
import {
  ADS_PRO_ADJACENT_STYLES,
  ADS_PRO_DEFAULT_STYLE_BY_CATEGORY,
  ADS_PRO_INTENSITY_SCALE,
  ADS_PRO_LAYOUT_ARCHETYPES,
  ADS_PRO_STYLE_RECIPES,
  resolveAdsProStyleDirection,
  type AdsProStyleDirection,
} from "../shared/ads-pro/ad-style-direction";
import { MARKETING_PRO_CATEGORY_VALUES, type MarketingProStyle } from "../shared/marketing-pro-contract";
import { check, checkCount, createRng, deepFreeze } from "./ads-pro-test-kit";

const STYLES: readonly MarketingProStyle[] = ["luxury", "editorial", "minimal", "sensory", "modern"];

/** Quantos eixos de ARTE dois resultados de direção diferem. */
function artAxesDifferent(a: AdsProStyleDirection, b: AdsProStyleDirection): string[] {
  const axes: string[] = [];
  if (a.archetypes[0] !== b.archetypes[0]) axes.push("composição");
  if (a.hierarchy !== b.hierarchy) axes.push("hierarquia");
  if (a.typography.headlineFont !== b.typography.headlineFont || a.typography.headlineWeight !== b.typography.headlineWeight || a.typography.headlineUppercase !== b.typography.headlineUppercase) axes.push("tipografia");
  if (a.spacing !== b.spacing) axes.push("espaçamento");
  if (a.cta.shape !== b.cta.shape || a.cta.size !== b.cta.size) axes.push("CTA");
  if (a.decorations[0] !== b.decorations[0]) axes.push("decoração");
  if (a.priceStyle !== b.priceStyle) axes.push("estilo do preço");
  if (a.intensity !== b.intensity) axes.push("intensidade");
  return axes;
}

async function main(): Promise<void> {
  await check("SD1 mesmo input => mesma direção (determinístico, sem aleatoriedade)", () => {
    const input = { preferredStyles: ["minimal", "editorial"] as MarketingProStyle[], intent: "spotlight" as const, category: "beauty" as const };
    assert.deepEqual(resolveAdsProStyleDirection(input), resolveAdsProStyleDirection({ ...input }));
  });

  await check("SD2 o perfil define estilo principal e secundários; sem perfil, a categoria só SUGERE (e diz que sugeriu)", () => {
    const withProfile = resolveAdsProStyleDirection({ preferredStyles: ["luxury", "minimal"], intent: "spotlight", category: "electronics" });
    assert.equal(withProfile.primaryStyle, "luxury");
    assert.deepEqual(withProfile.secondaryStyles, ["minimal"]);
    assert.equal(withProfile.styleSource, "profile");
    const none = resolveAdsProStyleDirection({ intent: "spotlight", category: "electronics" });
    assert.equal(none.styleSource, "category-default");
    assert.equal(none.primaryStyle, ADS_PRO_DEFAULT_STYLE_BY_CATEGORY.electronics);
    const neutral = resolveAdsProStyleDirection({ preferredStyles: [], intent: "spotlight", category: "food" });
    assert.equal(neutral.styleSource, "category-default");
    for (const category of MARKETING_PRO_CATEGORY_VALUES) assert.ok(STYLES.includes(ADS_PRO_DEFAULT_STYLE_BY_CATEGORY[category]));
  });

  await check("SD3 perfil minimalista != perfil promocional forte: >= 7 eixos de arte diferentes", () => {
    const minimal = resolveAdsProStyleDirection({ preferredStyles: ["minimal"], intent: "spotlight", category: "beauty" });
    const bold = resolveAdsProStyleDirection({ preferredStyles: ["modern"], intent: "promo", category: "beauty" });
    const axes = artAxesDifferent(minimal, bold);
    assert.ok(axes.length >= 7, `esperado >= 7 eixos, achou ${axes.length}: ${axes.join(", ")}`);
    assert.equal(minimal.intensity, 1);
    assert.equal(bold.intensity, 3);
    assert.equal(bold.hierarchy, "price-first");
    assert.equal(minimal.hierarchy, "product-first");
    assert.equal(bold.cta.size, "lg");
    assert.equal(minimal.cta.size, "sm");
    assert.equal(minimal.typography.headlineUppercase, false);
    assert.equal(bold.typography.headlineUppercase, true);
  });

  await check("SD4 os 5 estilos são duas a duas diferentes em >= 6 eixos (nenhum é variação cosmética do outro)", () => {
    for (let i = 0; i < STYLES.length; i += 1) {
      for (let j = i + 1; j < STYLES.length; j += 1) {
        const a = resolveAdsProStyleDirection({ preferredStyles: [STYLES[i]], intent: "spotlight", category: "general" });
        const b = resolveAdsProStyleDirection({ preferredStyles: [STYLES[j]], intent: "spotlight", category: "general" });
        const axes = artAxesDifferent(a, b);
        assert.ok(axes.length >= 6, `${STYLES[i]} x ${STYLES[j]}: só ${axes.length} eixos (${axes.join(", ")})`);
      }
    }
  });

  await check("SD5 o objetivo da campanha ACRESCENTA ênfase à receita do estilo, sem apagar a identidade dele", () => {
    for (const style of STYLES) {
      const calm = resolveAdsProStyleDirection({ preferredStyles: [style], intent: "spotlight", category: "general" });
      const promo = resolveAdsProStyleDirection({ preferredStyles: [style], intent: "promo", category: "general" });
      const last = resolveAdsProStyleDirection({ preferredStyles: [style], intent: "last", category: "general" });
      const novelty = resolveAdsProStyleDirection({ preferredStyles: [style], intent: "new", category: "general" });
      assert.ok(promo.intensity >= calm.intensity, `${style}: promo não pode ser mais calma que destaque`);
      assert.equal(promo.archetypes[0], "price-burst");
      assert.equal(promo.hierarchy, "price-first");
      assert.equal(promo.cta.size, "lg");
      assert.ok(promo.cta.shape !== "link" && promo.cta.shape !== "soft", `${style}: promo precisa de botão visível`);
      assert.equal(last.archetypes[0], "band-bottom");
      assert.equal(last.hierarchy, "price-first");
      assert.equal(last.cta.size, "lg");
      assert.equal(novelty.archetypes[0], "hero-center");
      assert.equal(novelty.decorations[0], "corner");
      for (const result of [calm, promo, last, novelty]) assert.equal(result.primaryStyle, style, "o objetivo nunca troca o estilo do perfil");
      for (const result of [calm, promo, last, novelty]) assert.equal(result.typography, ADS_PRO_STYLE_RECIPES[style].typography, "tipografia é do estilo, não do objetivo");
    }
    const minimalLast = resolveAdsProStyleDirection({ preferredStyles: ["minimal"], intent: "last", category: "general" });
    assert.equal(minimalLast.priceStyle, "plain", "minimalismo continua quieto mesmo com 'últimas unidades'");
    assert.equal(resolveAdsProStyleDirection({ preferredStyles: ["luxury"], intent: "promo", category: "general" }).priceStyle, "badge");
  });

  await check("SD6 overrides explícitos do estúdio (intensidade e estilo) são respeitados", () => {
    const forced = resolveAdsProStyleDirection({ preferredStyles: ["luxury"], intent: "spotlight", category: "beauty", intensityOverride: 3, styleOverride: "sensory" });
    assert.equal(forced.intensity, 3);
    assert.equal(forced.primaryStyle, "sensory");
    assert.equal(forced.typography.headlineItalic, true);
  });

  await check("SD7 estilos duplicados no perfil são deduplicados preservando a ordem", () => {
    const direction = resolveAdsProStyleDirection({ preferredStyles: ["editorial", "minimal", "editorial", "minimal", "modern"], intent: "spotlight", category: "general" });
    assert.equal(direction.primaryStyle, "editorial");
    assert.deepEqual(direction.secondaryStyles, ["minimal", "modern"]);
  });

  await check("SD8 receita completa por estilo: todos os arquétipos e campos presentes, sem estilo sem receita", () => {
    for (const style of STYLES) {
      const recipe = ADS_PRO_STYLE_RECIPES[style];
      assert.deepEqual([...recipe.archetypes].sort(), [...ADS_PRO_LAYOUT_ARCHETYPES].sort(), `${style}: ordem de arquétipos precisa conter todos`);
      assert.ok(recipe.decorations.length >= 2);
      assert.ok(ADS_PRO_ADJACENT_STYLES[style].length >= 2 && !ADS_PRO_ADJACENT_STYLES[style].includes(style));
      assert.ok(recipe.typography.headlineScale > 0.8 && recipe.typography.headlineScale < 1.3);
    }
  });

  await check("SD9 escala de intensidade é monotônica (mais forte = título/preço/decoração/CTA maiores)", () => {
    for (const key of ["headline", "price", "decoration", "cta"] as const) {
      assert.ok(ADS_PRO_INTENSITY_SCALE[1][key] < ADS_PRO_INTENSITY_SCALE[2][key], key);
      assert.ok(ADS_PRO_INTENSITY_SCALE[2][key] < ADS_PRO_INTENSITY_SCALE[3][key], key);
    }
  });

  await check("SD10 acento: texto sobre o acento sempre legível (AA), em todos os estilos e em cores de loja arbitrárias", () => {
    for (const style of STYLES) {
      const accent = ensureReadableAccent(ADS_PRO_STYLE_RECIPES[style].accent);
      assert.ok(contrastRatio(readableOn(accent), accent) >= MIN_TEXT_CONTRAST, `${style} ${accent}`);
    }
    const random = createRng(20261006);
    for (let i = 0; i < 400; i += 1) {
      const hex = `#${Math.floor(random() * 0xffffff).toString(16).padStart(6, "0")}`;
      const accent = ensureReadableAccent(hex);
      assert.ok(contrastRatio(readableOn(accent), accent) >= MIN_TEXT_CONTRAST, `${hex} -> ${accent}`);
    }
    assert.equal(ensureReadableAccent("não-é-cor"), "não-é-cor", "entrada inválida passa direto, sem lançar");
  });

  await check("SD11 entrada congelada não é mutada", () => {
    const input = deepFreeze({ preferredStyles: ["luxury", "sensory"] as MarketingProStyle[], intent: "last" as const, category: "food" as const });
    const result = resolveAdsProStyleDirection(input);
    assert.equal(result.primaryStyle, "luxury");
  });

  console.log(`ADS-PRO style direction tests passed: ${checkCount()} checks.`);
}

void main().catch((error) => { console.error(error); process.exit(1); });
