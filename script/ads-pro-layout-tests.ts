/**
 * ADS-PRO-FINAL — motor de layout: zona segura, sem sobreposição, legibilidade, texto sempre dentro da caixa.
 * O mesmo `computeAdLayout` alimenta preview e exportação, então provar aqui vale para os dois.
 */
import assert from "node:assert/strict";
import { MARKETING_PRO_FORMAT_DIMENSIONS } from "../shared/marketing-pro-contract";
import { resolveMarketingProEssentialContentBounds } from "../client/src/lib/marketing-pro-real-background-composer";
import { MARKETING_PRO_GENERATED_BACKGROUND_LIBRARY } from "../shared/marketing-pro-background-library";
import { backdropColorsOfAsset, resolveAdsProBackdrop } from "../shared/ads-pro/ad-backdrop";
import { AD_INK_DARK, AD_INK_LIGHT, MIN_TEXT_CONTRAST, contrastRatio, resolveInkForBackdrop } from "../shared/ads-pro/ad-contrast";
import {
  createAdsProDocument,
  withText,
  withVisibility,
  type AdsProAdDocumentV1,
  type AdsProFormat,
} from "../shared/ads-pro/ad-document";
import { computeAdLayout, isCriticalIssue, rectContains, rectsIntersect, validateAdLayout, AD_MIN_FONT_PX, type AdLayout, type PlacedText } from "../shared/ads-pro/ad-layout";
import { ADS_PRO_CTA_SHAPES, ADS_PRO_DECORATIONS, ADS_PRO_LAYOUT_ARCHETYPES, ADS_PRO_PRICE_STYLES, ADS_PRO_SPACINGS, resolveAdsProStyleDirection } from "../shared/ads-pro/ad-style-direction";
import { fitText, type FontSpec } from "../shared/ads-pro/ad-text-fit";
import { toDocumentBackground } from "../shared/ads-pro/ad-backdrop";
import { buildAdsProProductFacts } from "../shared/ads-pro/ad-product-facts";
import type { MarketingProStyle } from "../shared/marketing-pro-contract";
import { PRODUCT_NO_PRICE, PRODUCT_PERFUME, check, checkCount, createRng, deepFreeze, estimateMeasure, factsOf, layoutOf } from "./ads-pro-test-kit";

const STYLES: readonly MarketingProStyle[] = ["luxury", "editorial", "minimal", "sensory", "modern"];
const FORMATS: readonly AdsProFormat[] = ["portrait", "square"];

function baseDoc(format: AdsProFormat, style: MarketingProStyle, archetype: AdsProAdDocumentV1["direction"]["archetype"], backgroundId = "luxury-onyx-spotlight", intent: "spotlight" | "promo" | "last" | "new" = "spotlight"): AdsProAdDocumentV1 {
  const facts = factsOf(PRODUCT_PERFUME);
  const direction = resolveAdsProStyleDirection({ preferredStyles: [style], intent, category: facts.category });
  const asset = MARKETING_PRO_GENERATED_BACKGROUND_LIBRARY.find((candidate) => candidate.id === backgroundId)!;
  return createAdsProDocument({ facts, direction, archetype, format, background: toDocumentBackground(asset), variationId: "A", storeName: "Loja da Ana" });
}

const TEXT_CASES: readonly { readonly name: string; readonly patch: Partial<AdsProAdDocumentV1["text"]>; readonly allowOverflow: boolean }[] = [
  { name: "normal", patch: {}, allowOverflow: false },
  { name: "curto", patch: { headline: "Vaso", subtitle: "", kicker: "", badgeText: "", oldPriceText: "" }, allowOverflow: false },
  { name: "longo", patch: { headline: "Perfume Luna Eau de Parfum Intense Edição Limitada Coleção Verão Brasil", subtitle: "Fragrância floral amadeirada de longa duração para todas as ocasiões", kicker: "ÚLTIMAS UNIDADES AGORA", ctaText: "Chame agora no WhatsApp e garanta", priceText: "R$ 12.999,90", oldPriceText: "de R$ 15.999,90", badgeText: "35% OFF" }, allowOverflow: true },
  { name: "palavra-sem-quebra", patch: { headline: "A".repeat(60), subtitle: "B".repeat(70), kicker: "C".repeat(26), ctaText: "D".repeat(34) }, allowOverflow: true },
  { name: "acentos-emoji", patch: { headline: "Chocolate Açaí Crocante 🍫 Edição Ç", subtitle: "Sem glúten · feito à mão" }, allowOverflow: false },
];

function textBlocks(layout: AdLayout): { name: string; block: PlacedText }[] {
  const out: { name: string; block: PlacedText }[] = [];
  const push = (name: string, block: PlacedText | undefined) => { if (block && block.lines.length > 0) out.push({ name, block }); };
  push("kicker", layout.kicker); push("headline", layout.headline); push("subtitle", layout.subtitle); push("price", layout.price?.main);
  push("oldPrice", layout.price?.old); push("badge", layout.price?.badge?.text); push("cta", layout.cta?.label); push("store", layout.store);
  return out;
}

async function main(): Promise<void> {
  // ---------------------------------------------------------------- fitText
  await check("L1 fitText: nunca devolve linha mais larga que a caixa; reduz o corpo antes de truncar; trunca com reticências", () => {
    const f: FontSpec = { kind: "sans", weight: 700, italic: false, px: 70, uppercase: false, trackingEm: 0 };
    const random = createRng(7);
    const words = ["Perfume", "Luna", "Eau", "de", "Parfum", "Intense", "Edição", "Limitada", "Supercalifragilisticexpialidocious", "ÇÃO", "a", "R$", "12,90"];
    for (let i = 0; i < 400; i += 1) {
      const text = Array.from({ length: 1 + Math.floor(random() * 14) }, () => words[Math.floor(random() * words.length)]).join(" ");
      const maxWidth = 200 + Math.floor(random() * 700);
      const maxLines = 1 + Math.floor(random() * 3);
      const result = fitText(text, f, { maxWidth, maxLines, minPx: 28, lineHeight: 1.1 }, estimateMeasure);
      assert.ok(result.lines.length <= maxLines, text);
      for (const line of result.lines) assert.ok(estimateMeasure(line, { ...f, px: result.px }) <= maxWidth + 0.5, `linha larga: "${line}"`);
      assert.ok(result.px >= 28 - 0.001 && result.px <= 70 + 0.001);
      if (!result.truncated) assert.equal(result.lines.join("").replace(/\s/g, ""), text.replace(/\s/g, ""), "sem truncar, nenhuma letra pode sumir");
      if (result.truncated) assert.ok(result.lines[result.lines.length - 1].endsWith("…"));
    }
    assert.deepEqual(fitText("   ", f, { maxWidth: 300, maxLines: 2, minPx: 20, lineHeight: 1.1 }, estimateMeasure).lines, []);
    const upper = fitText("olá mundo", { ...f, uppercase: true }, { maxWidth: 900, maxLines: 1, minPx: 20, lineHeight: 1 }, estimateMeasure);
    assert.deepEqual(upper.lines, ["OLÁ MUNDO"], "a caixa alta já vem aplicada nas linhas desenhadas");
  });

  // ---------------------------------------------------------------- matriz exaustiva
  await check("L2 matriz: nenhum problema crítico em formato x arquétipo x estilo x texto x preço x CTA x logo x fundo", () => {
    const backgrounds = ["luxury-onyx-spotlight", "editorial-paper-daylight", "modern-teal-graphic", "minimal-cloud-pedestal"];
    let layouts = 0;
    const failures: string[] = [];
    for (const format of FORMATS) {
      for (const archetype of ADS_PRO_LAYOUT_ARCHETYPES) {
        for (const style of STYLES) {
          for (const textCase of TEXT_CASES) {
            for (const withPrice of [true, false]) {
              for (const hasCta of [true, false]) {
                for (const intent of ["spotlight", "promo", "last", "new"] as const) {
                  const backgroundId = backgrounds[layouts % backgrounds.length];
                  let doc = withText(baseDoc(format, style, archetype, backgroundId, intent), textCase.patch);
                  doc = withVisibility(doc, { price: withPrice, cta: hasCta, logo: layouts % 2 === 0 });
                  const layout = layoutOf(doc, layouts % 2 === 0);
                  layouts += 1;
                  const critical = layout.issues.filter(isCriticalIssue);
                  if (critical.length > 0) failures.push(`${format}/${archetype}/${style}/${intent}/${textCase.name}/price=${withPrice}/cta=${hasCta}: ${critical.map((issue) => `${issue.code}:${issue.target}`).join(",")}`);
                  if (!textCase.allowOverflow) assert.ok(!layout.issues.some((issue) => issue.code === "TEXT_OVERFLOW"), `truncou texto normal: ${format}/${archetype}/${style}/${textCase.name}`);
                }
              }
            }
          }
        }
      }
    }
    assert.deepEqual(failures.slice(0, 12), [], `${failures.length} de ${layouts} layouts com problema crítico`);
    assert.ok(layouts >= 4000, `matriz pequena demais: ${layouts}`);
    console.log(`  (${layouts} layouts verificados)`);
  });

  await check("L3 varredura pseudo-aleatória das opções de arte (CTA x preço x decoração x espaçamento x intensidade) sem problema crítico", () => {
    const random = createRng(424242);
    const pick = <T,>(values: readonly T[]) => values[Math.floor(random() * values.length)];
    const failures: string[] = [];
    for (let i = 0; i < 2500; i += 1) {
      const format = pick(FORMATS);
      let doc = baseDoc(format, pick(STYLES), pick(ADS_PRO_LAYOUT_ARCHETYPES), pick(MARKETING_PRO_GENERATED_BACKGROUND_LIBRARY).id, pick(["spotlight", "promo", "last", "new"] as const));
      doc = {
        ...doc,
        direction: { ...doc.direction, ctaShape: pick(ADS_PRO_CTA_SHAPES), priceStyle: pick(ADS_PRO_PRICE_STYLES), decoration: pick(ADS_PRO_DECORATIONS), spacing: pick(ADS_PRO_SPACINGS), intensity: pick([1, 2, 3] as const) },
        brand: { storeName: "Loja", accent: `#${Math.floor(random() * 0xffffff).toString(16).padStart(6, "0")}` },
        photo: { ...doc.photo, mode: random() > 0.5 ? "cutout" : "original" },
      };
      doc = withText(doc, pick(TEXT_CASES).patch);
      const layout = layoutOf(doc, random() > 0.5);
      const critical = layout.issues.filter(isCriticalIssue);
      if (critical.length > 0) failures.push(`#${i} ${format}/${doc.direction.archetype}/${doc.direction.style}/${doc.direction.ctaShape}/${doc.direction.priceStyle}: ${critical.map((issue) => `${issue.code}:${issue.target}`).join(",")}`);
    }
    assert.deepEqual(failures.slice(0, 12), [], `${failures.length} falhas`);
  });

  // ---------------------------------------------------------------- geometria canônica
  await check("L4 4:5: conteúdo essencial fica dentro do recorte central quadrado do ADS-PRO-04 (grade do Instagram)", () => {
    const { width, height } = MARKETING_PRO_FORMAT_DIMENSIONS.portrait;
    const crop = resolveMarketingProEssentialContentBounds({ format: "portrait", concept: { creativeFamily: "luxury" } }).centralSquareCrop;
    const cropTop = crop.y * height; const cropBottom = (crop.y + crop.height) * height;
    assert.equal(Math.round(cropTop), 135);
    for (const archetype of ADS_PRO_LAYOUT_ARCHETYPES) {
      for (const style of STYLES) {
        const layout = layoutOf(baseDoc("portrait", style, archetype));
        assert.equal(layout.canvas.width, width);
        assert.equal(layout.canvas.height, height);
        assert.ok(layout.essential.y >= cropTop && layout.essential.y + layout.essential.h <= cropBottom, `${archetype}/${style}: essencial fora do recorte`);
        for (const { name, block } of textBlocks(layout)) {
          if (name === "cta") continue;
          assert.ok(block.rect.y >= cropTop - 0.75 && block.rect.y + block.rect.h <= cropBottom + 0.75, `${archetype}/${style}/${name} fora do recorte central`);
        }
        assert.ok(layout.product.rect.y >= cropTop - 0.75 && layout.product.rect.y + layout.product.rect.h <= cropBottom + 0.75, `${archetype}/${style}: produto fora do recorte`);
      }
    }
  });

  await check("L5 safe area mobile: margens >= 5% da largura nos dois formatos; CTA e produto dentro da área segura", () => {
    for (const format of FORMATS) {
      for (const spacing of ADS_PRO_SPACINGS) {
        for (const archetype of ADS_PRO_LAYOUT_ARCHETYPES) {
          const doc = baseDoc(format, "luxury", archetype);
          const layout = layoutOf({ ...doc, direction: { ...doc.direction, spacing } });
          assert.ok(layout.safe.x / layout.canvas.width >= 0.05, `${format}/${spacing}: margem lateral < 5%`);
          assert.ok(layout.safe.y / layout.canvas.height >= 0.04, `${format}/${spacing}: margem vertical < 4%`);
          assert.ok(rectContains(layout.safe, layout.product.rect), `${format}/${archetype}: produto fora da área segura`);
          if (layout.cta) assert.ok(rectContains(layout.safe, layout.cta.rect), `${format}/${archetype}: CTA fora da área segura`);
        }
      }
    }
  });

  await check("L6 os 5 arquétipos geram composições realmente diferentes (produto/título/preço em lugares distintos)", () => {
    for (const format of FORMATS) {
      const signatures = new Set<string>();
      for (const archetype of ADS_PRO_LAYOUT_ARCHETYPES) {
        const layout = layoutOf(baseDoc(format, "luxury", archetype));
        assert.equal(layout.archetype, archetype);
        const r = layout.product.rect;
        signatures.add([Math.round(r.x / 40), Math.round(r.y / 40), Math.round(r.w / 40), Math.round(r.h / 40), layout.headline?.align, layout.price?.style].join("|"));
      }
      assert.equal(signatures.size, 5, `${format}: arquétipos com geometria repetida`);
    }
  });

  // ---------------------------------------------------------------- legibilidade
  await check("L7 REGRESSÃO: fundo escuro nunca recebe tinta escura (luxo/moderno) e fundo claro nunca recebe tinta branca", () => {
    for (const asset of MARKETING_PRO_GENERATED_BACKGROUND_LIBRARY) {
      const ink = resolveInkForBackdrop(backdropColorsOfAsset(asset));
      assert.ok(ink.minContrast >= MIN_TEXT_CONTRAST, `${asset.id}: contraste ${ink.minContrast.toFixed(2)}`);
      assert.equal(ink.scrimNeeded, false, asset.id);
      const dark = asset.family === "luxury" || asset.family === "modern";
      assert.equal(ink.ink, dark ? AD_INK_LIGHT : AD_INK_DARK, `${asset.id}: tinta errada`);
      const layout = layoutOf(createAdsProDocument({
        facts: factsOf(PRODUCT_PERFUME),
        direction: resolveAdsProStyleDirection({ preferredStyles: [dark ? "luxury" : "minimal"], intent: "spotlight", category: "beauty" }),
        archetype: "hero-center", format: "portrait", background: toDocumentBackground(asset), variationId: "A", storeName: "Loja",
      }));
      assert.equal(layout.headline?.color, ink.ink);
      assert.ok(contrastRatio(layout.headline!.color, backdropColorsOfAsset(asset)[0]) >= MIN_TEXT_CONTRAST);
    }
  });

  await check("L8 fundo de cores mistas (nenhuma tinta chega a AA) ganha scrim atrás dos textos; fundo estático movimentado também", () => {
    const mixed = ["#101010", "#F0F0F0", "#808080"];
    const ink = resolveInkForBackdrop(mixed);
    assert.equal(ink.scrimNeeded, true);
    const doc = baseDoc("portrait", "luxury", "hero-center");
    const layout = computeAdLayout({ doc, measure: estimateMeasure, backdrop: { colors: mixed }, hasLogo: false });
    assert.ok(layout.scrims.length >= 1, "scrim ausente");
    assert.ok(!layout.issues.some((issue) => issue.code === "LOW_CONTRAST"));
    const busyStatic = computeAdLayout({ doc, measure: estimateMeasure, backdrop: { colors: ["#202020", "#101010"], forceScrim: true }, hasLogo: false });
    assert.ok(busyStatic.scrims.length >= 1, "fundo movimentado precisa de scrim");
    const calm = computeAdLayout({ doc, measure: estimateMeasure, backdrop: { colors: ["#202020", "#101010"] }, hasLogo: false });
    assert.equal(calm.scrims.length, 0);
  });

  // ---------------------------------------------------------------- dados reais
  await check("L9 produto SEM preço: nenhum bloco/linha de preço é desenhado, em nenhum arquétipo (preço nunca é inventado)", () => {
    const facts = buildAdsProProductFacts(PRODUCT_NO_PRICE);
    assert.equal(facts.price, null);
    for (const format of FORMATS) {
      for (const archetype of ADS_PRO_LAYOUT_ARCHETYPES) {
        const asset = MARKETING_PRO_GENERATED_BACKGROUND_LIBRARY[0];
        const doc = createAdsProDocument({
          facts, direction: resolveAdsProStyleDirection({ preferredStyles: ["modern"], intent: "promo", category: facts.category }),
          archetype, format, background: toDocumentBackground(asset), variationId: "A", storeName: "Loja",
        });
        assert.equal(doc.show.price, false);
        assert.equal(doc.text.priceText, "");
        const layout = layoutOf(doc);
        assert.equal(layout.price, undefined, `${format}/${archetype}: bloco de preço apareceu`);
        assert.notEqual(layout.archetype, "price-burst", "price-burst sem preço deve cair para a vitrine");
        const allLines = textBlocks(layout).flatMap(({ block }) => block.lines).join(" ");
        assert.ok(!/R\$|\d+,\d{2}/.test(allLines), `texto com preço inventado: ${allLines}`);
        assert.equal(layout.issues.filter(isCriticalIssue).length, 0);
      }
    }
  });

  await check("L10 esconder CTA/logo/subtítulo libera espaço sem criar problemas e sem deixar elementos fantasmas", () => {
    const doc = withVisibility(baseDoc("square", "editorial", "poster-top"), { cta: false, logo: false, subtitle: false, kicker: false });
    const layout = layoutOf(doc, true);
    assert.equal(layout.cta, undefined);
    assert.equal(layout.logo, undefined);
    assert.equal(layout.subtitle, undefined);
    assert.equal(layout.kicker, undefined);
    assert.equal(layout.issues.filter(isCriticalIssue).length, 0);
  });

  await check("L11 tamanhos mínimos de fonte respeitados (título 34, preço 44, CTA 24) mesmo com texto longo", () => {
    for (const format of FORMATS) {
      for (const archetype of ADS_PRO_LAYOUT_ARCHETYPES) {
        const doc = withText(baseDoc(format, "modern", archetype), TEXT_CASES[2].patch);
        const layout = layoutOf(doc);
        assert.ok((layout.headline?.font.px ?? 99) >= AD_MIN_FONT_PX.headline - 0.01);
        assert.ok((layout.price?.main.font.px ?? 99) >= AD_MIN_FONT_PX.price - 0.01);
        assert.ok((layout.cta?.label.font.px ?? 99) >= AD_MIN_FONT_PX.cta - 0.01);
      }
    }
  });

  // ---------------------------------------------------------------- pureza
  await check("L12 computeAdLayout é puro: entrada congelada não é mutada e o resultado é idêntico entre chamadas", () => {
    const doc = deepFreeze(baseDoc("portrait", "sensory", "band-bottom"));
    const backdrop = resolveAdsProBackdrop(doc.background, doc.format);
    const a = computeAdLayout({ doc, measure: estimateMeasure, backdrop: { colors: backdrop.colors }, hasLogo: true });
    const b = computeAdLayout({ doc, measure: estimateMeasure, backdrop: { colors: backdrop.colors }, hasLogo: true });
    assert.deepEqual(a, b);
    assert.ok(!rectsIntersect(a.product.rect, a.band!.rect, 1));
  });

  await check("L13 o validador NÃO é vacuoso: acusa área segura, sobreposição, fonte pequena, baixo contraste, produto minúsculo e recorte 4:5", () => {
    const layout = layoutOf(baseDoc("portrait", "luxury", "hero-center"));
    const { issues: _ignored, ...clean } = layout;
    void _ignored;
    assert.deepEqual(validateAdLayout(clean).filter(isCriticalIssue), []);
    const codes = (patch: Partial<typeof clean>) => validateAdLayout({ ...clean, ...patch }).map((issue) => issue.code);
    const headline = clean.headline!;
    assert.ok(codes({ headline: { ...headline, rect: { ...headline.rect, x: -40 } } }).includes("OUT_OF_SAFE_AREA"));
    assert.ok(codes({ headline: { ...headline, font: { ...headline.font, px: 12 } } }).includes("TEXT_TOO_SMALL"));
    assert.ok(codes({ product: { ...clean.product, rect: { ...clean.headline!.rect } } }).includes("OVERLAP"));
    assert.ok(codes({ product: { ...clean.product, rect: { x: 200, y: 600, w: 100, h: 100 } } }).includes("PRODUCT_TOO_SMALL"));
    assert.ok(codes({ product: { ...clean.product, rect: { ...clean.product.rect, y: 40 } } }).includes("OUT_OF_ESSENTIAL_AREA"));
    assert.ok(codes({ ink: { ...clean.ink, scrimNeeded: true }, scrims: [] }).includes("LOW_CONTRAST"));
    assert.ok(codes({ price: { ...clean.price!, rect: { ...clean.headline!.rect } } }).includes("OVERLAP"));
  });

  console.log(`ADS-PRO layout tests passed: ${checkCount()} checks.`);
}

void main().catch((error) => { console.error(error); process.exit(1); });
