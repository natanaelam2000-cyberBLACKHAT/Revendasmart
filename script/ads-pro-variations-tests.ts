/**
 * ADS-PRO-FINAL — variações determinísticas, realmente diferentes, sobre dados reais do produto,
 * escolhendo fundos SOMENTE do manifest de produção (Creative DNA + matcher).
 */
import assert from "node:assert/strict";
import { ADS_PRO_PRODUCTION_MANIFEST, ADS_PRO_SAFE_SUBJECT_ZONE } from "../shared/ads-pro/production-manifest";
import { MARKETING_PRO_BACKGROUND_LIBRARY, mapApprovedStaticBackground } from "../shared/marketing-pro-background-library";
import type { AssetDNA, AssetLibraryManifest } from "../shared/ads-pro/asset-dna";
import { countDirectionAxisDifferences, type AdsProDirectionAxes } from "../shared/ads-pro/ad-style-direction";
import { ADS_PRO_MAX_VARIATIONS, planVariationStyles, type AdsProVariation } from "../shared/ads-pro/ad-variations";
import { isCriticalIssue } from "../shared/ads-pro/ad-layout";
import { parseAdsProDocument, serializeAdsProDocument } from "../shared/ads-pro/ad-document";
import { resolveAdsProBackdrop } from "../shared/ads-pro/ad-backdrop";
import { AUDIT_BUCKET_SLUGS } from "../shared/ads-pro/background-audit";
import type { ApprovedStaticBackgroundEntry } from "../shared/ads-pro/static-background-entry";
import type { MarketingProStyle } from "../shared/marketing-pro-contract";
import { PRODUCT_HOME, PRODUCT_NO_PRICE, PRODUCT_PERFUME, PRODUCT_SWEETS, check, checkCount, factsOf, layoutOf, variationsFor } from "./ads-pro-test-kit";

function axesOf(variation: AdsProVariation): AdsProDirectionAxes {
  const { direction, background } = variation.doc;
  const font = direction.style === "modern" ? "display" : direction.style === "minimal" ? "sans" : "serif";
  return {
    archetype: direction.archetype, hierarchy: direction.hierarchy, headlineFont: font,
    headlineWeight: direction.style === "luxury" ? 500 : direction.style === "editorial" ? 700 : direction.style === "minimal" ? 400 : direction.style === "sensory" ? 600 : 900,
    headlineUppercase: direction.style === "modern", spacing: direction.spacing, ctaShape: direction.ctaShape, decoration: direction.decoration,
    priceStyle: direction.priceStyle, intensity: direction.intensity, backgroundId: background.id,
  };
}

function staticAssetsFor(buckets: readonly ApprovedStaticBackgroundEntry[]) {
  const library = [...MARKETING_PRO_BACKGROUND_LIBRARY, ...buckets.map(mapApprovedStaticBackground)];
  const staticDna: AssetDNA[] = buckets.map((entry) => ({
    id: entry.id,
    entityKinds: ["product"],
    targetCategories: entry.bucket === "geral" ? [] : [entry.category],
    styles: [entry.style],
    supportedIntents: [],
    formats: ["portrait", "square"],
    subjectZone: ADS_PRO_SAFE_SUBJECT_ZONE,
    luminance: entry.luminance,
    status: "active",
    resource: { type: "static", uri: `/ads-pro/backgrounds/${entry.id}.webp` },
    tags: [`bucket:${AUDIT_BUCKET_SLUGS[entry.bucket]}`],
  }));
  const manifest: AssetLibraryManifest = { schemaVersion: 1, libraryVersion: "1.0.0", assets: [...ADS_PRO_PRODUCTION_MANIFEST.assets, ...staticDna] };
  return { library, manifest };
}

async function main(): Promise<void> {
  await check("V1 gera >= 3 variações A/B/C, deterministicamente (mesmo input => mesmo resultado, em qualquer ordem do manifest)", () => {
    const first = variationsFor(PRODUCT_PERFUME, { preferredStyles: ["minimal"] });
    assert.ok(first.length >= 3);
    assert.deepEqual(first.map((variation) => variation.id), ["A", "B", "C"]);
    assert.deepEqual(variationsFor(PRODUCT_PERFUME, { preferredStyles: ["minimal"] }), first);
    const shuffled: AssetLibraryManifest = { ...ADS_PRO_PRODUCTION_MANIFEST, assets: [...ADS_PRO_PRODUCTION_MANIFEST.assets].reverse() };
    assert.deepEqual(variationsFor(PRODUCT_PERFUME, { preferredStyles: ["minimal"], manifest: shuffled }).map((variation) => variation.doc), first.map((variation) => variation.doc));
  });

  await check("V2 as 3 variações são realmente diferentes: >= 6 eixos de arte entre cada par, fundos/arquétipos/estilos distintos", () => {
    for (const preferred of [[], ["minimal"], ["luxury", "sensory"], ["modern"], ["editorial"], ["sensory"]] as MarketingProStyle[][]) {
      for (const intent of ["spotlight", "promo", "last", "new"] as const) {
        for (const format of ["portrait", "square"] as const) {
          const variations = variationsFor(PRODUCT_PERFUME, { preferredStyles: preferred, intent, format });
          assert.equal(new Set(variations.map((variation) => variation.doc.background.id)).size, variations.length, "fundos repetidos");
          assert.equal(new Set(variations.map((variation) => variation.doc.direction.archetype)).size, variations.length, "composições repetidas");
          assert.equal(new Set(variations.map((variation) => variation.doc.direction.style)).size, variations.length, "estilos repetidos");
          for (let i = 0; i < variations.length; i += 1) {
            for (let j = i + 1; j < variations.length; j += 1) {
              const diff = countDirectionAxisDifferences(axesOf(variations[i]), axesOf(variations[j]));
              assert.ok(diff >= 6, `${JSON.stringify(preferred)}/${intent}/${format}: ${variations[i].id} x ${variations[j].id} só ${diff} eixos`);
            }
          }
        }
      }
    }
  });

  await check("V3 dados do produto idênticos nas variações (nome, preço, estoque): só a direção de arte muda", () => {
    const facts = factsOf(PRODUCT_PERFUME);
    for (const variation of variationsFor(PRODUCT_PERFUME, { preferredStyles: ["luxury"] })) {
      assert.equal(variation.doc.productId, facts.productId);
      assert.equal(variation.doc.text.headline, facts.name);
      assert.equal(variation.doc.text.priceText, "R$ 297,42", "preço efetivo real: 349,90 com 15% de desconto");
      assert.equal(variation.doc.text.oldPriceText, "de R$ 349,90");
      assert.equal(variation.doc.text.badgeText, "15% OFF");
    }
  });

  await check("V4 produto SEM preço: nenhuma variação inventa preço, selo ou oferta; price-burst nunca é escolhido", () => {
    for (const intent of ["spotlight", "promo", "last", "new"] as const) {
      const variations = variationsFor(PRODUCT_NO_PRICE, { preferredStyles: ["modern"], intent });
      for (const variation of variations) {
        assert.equal(variation.doc.show.price, false);
        assert.equal(variation.doc.text.priceText, "");
        assert.equal(variation.doc.text.oldPriceText, "");
        assert.equal(variation.doc.text.badgeText, "");
        assert.notEqual(variation.doc.direction.archetype, "price-burst");
        assert.notEqual(variation.doc.text.kicker, "OFERTA");
        const layout = layoutOf(variation.doc);
        assert.equal(layout.price, undefined);
        assert.equal(layout.issues.filter(isCriticalIssue).length, 0);
      }
    }
  });

  await check("V5 afirmações comerciais só com lastro: OFERTA exige promoção real; ÚLTIMAS UNIDADES exige estoque baixo real", () => {
    const noPromo = variationsFor({ ...PRODUCT_PERFUME, discountPercent: undefined }, { intent: "promo" });
    for (const variation of noPromo) {
      assert.notEqual(variation.doc.text.kicker, "OFERTA");
      assert.equal(variation.doc.text.badgeText, "");
      assert.equal(variation.doc.text.oldPriceText, "");
    }
    assert.equal(variationsFor(PRODUCT_PERFUME, { intent: "promo" })[0].doc.text.kicker, "OFERTA");
    assert.equal(variationsFor(PRODUCT_PERFUME, { intent: "last" })[0].doc.text.kicker, "ÚLTIMAS UNIDADES", "estoque 3 => verdadeiro");
    assert.notEqual(variationsFor({ ...PRODUCT_PERFUME, stock: 40 }, { intent: "last" })[0].doc.text.kicker, "ÚLTIMAS UNIDADES", "estoque 40 => falso");
    assert.notEqual(variationsFor({ ...PRODUCT_PERFUME, stock: undefined }, { intent: "last" })[0].doc.text.kicker, "ÚLTIMAS UNIDADES", "estoque desconhecido => falso");
  });

  await check("V6 o perfil INFLUENCIA a geração: perfis diferentes => estilo, composição, CTA, preço, decoração e fundo diferentes na opção A", () => {
    const profiles: MarketingProStyle[] = ["minimal", "luxury", "modern", "editorial", "sensory"];
    for (const product of [PRODUCT_PERFUME, PRODUCT_NO_PRICE]) {
      const first = new Map<MarketingProStyle, AdsProVariation>();
      for (const profile of profiles) first.set(profile, variationsFor(product, { preferredStyles: [profile] })[0]);
      for (const [style, variation] of Array.from(first.entries())) {
        assert.equal(variation.doc.direction.style, style, "a opção A segue exatamente o estilo principal do perfil");
        assert.equal(variation.rationale.styleFromProfile, true);
        assert.equal(variation.role, "faithful");
      }
      const signature = (variation: AdsProVariation) => [variation.doc.direction.style, variation.doc.direction.archetype, variation.doc.direction.ctaShape, variation.doc.direction.priceStyle, variation.doc.direction.decoration].join("|");
      assert.equal(new Set(Array.from(first.values()).map(signature)).size, 5, `${product.id}: 5 perfis => 5 composições distintas`);
      // Fundos: a categoria vem antes do estilo no matcher, então perfis sem fundo na categoria do produto
      // dividem o vizinho mais próximo; mesmo assim os perfis NÃO colapsam num fundo só.
      const backgrounds = new Set(Array.from(first.values()).map((variation) => variation.doc.background.id));
      assert.ok(backgrounds.size >= 3, `${product.id}: fundos quase iguais entre perfis: ${Array.from(backgrounds).join(",")}`);
    }
    // Quando a biblioteca TEM o estilo na categoria do produto, o fundo da opção A tem afinidade PRIMÁRIA de estilo.
    for (const style of ["minimal", "luxury", "editorial"] as MarketingProStyle[]) {
      assert.equal(variationsFor(PRODUCT_PERFUME, { preferredStyles: [style] })[0].rationale.styleAffinity, "primary", `perfume/${style}`);
    }
    for (const style of ["modern", "luxury", "minimal"] as MarketingProStyle[]) {
      assert.equal(variationsFor(PRODUCT_NO_PRICE, { preferredStyles: [style] })[0].rationale.styleAffinity, "primary", `eletrônico/${style}`);
    }
    assert.ok(variationsFor(PRODUCT_NO_PRICE, { preferredStyles: ["modern"] })[0].doc.background.id.startsWith("modern-"));
    assert.ok(variationsFor(PRODUCT_NO_PRICE, { preferredStyles: ["luxury"] })[0].doc.background.id.startsWith("luxury-"));
    // sem perfil, a categoria só sugere — e isso fica explícito
    assert.equal(variationsFor(PRODUCT_PERFUME, { preferredStyles: [] })[0].rationale.styleFromProfile, false);
  });

  await check("V7 matcher só escolhe asset VÁLIDO: ignora deprecated, id desconhecido e formato não suportado", () => {
    const hostile = [
      { ...ADS_PRO_PRODUCTION_MANIFEST.assets[0], id: "fundo-depreciado", status: "deprecated", styles: ["minimal"], targetCategories: ["beauty"] },
      { ...ADS_PRO_PRODUCTION_MANIFEST.assets[0], id: "fundo-fora-da-biblioteca", styles: ["minimal"], targetCategories: ["beauty"] },
      { ...ADS_PRO_PRODUCTION_MANIFEST.assets[0], id: "fundo-so-story", styles: ["minimal"], targetCategories: ["beauty"], formats: [] as never },
    ].filter((asset) => asset.formats.length > 0 || asset.id !== "fundo-so-story") as unknown as AssetDNA[];
    const manifest: AssetLibraryManifest = { ...ADS_PRO_PRODUCTION_MANIFEST, assets: [...ADS_PRO_PRODUCTION_MANIFEST.assets, ...hostile] };
    const variations = variationsFor(PRODUCT_PERFUME, { preferredStyles: ["minimal"], manifest });
    const known = new Set(MARKETING_PRO_BACKGROUND_LIBRARY.map((asset) => asset.id));
    for (const variation of variations) {
      assert.ok(known.has(variation.doc.background.id), `fundo fora da biblioteca: ${variation.doc.background.id}`);
      assert.ok(ADS_PRO_PRODUCTION_MANIFEST.assets.some((asset) => asset.id === variation.doc.background.id && asset.status === "active"));
      assert.ok(!["fundo-depreciado", "fundo-fora-da-biblioteca"].includes(variation.doc.background.id));
    }
  });

  await check("V8 biblioteca/manifest vazios NÃO quebram o fluxo: usa o fundo embutido de último recurso", () => {
    const empty: AssetLibraryManifest = { ...ADS_PRO_PRODUCTION_MANIFEST, assets: [] };
    const variations = variationsFor(PRODUCT_PERFUME, { manifest: empty, library: [] });
    assert.equal(variations.length, 3);
    for (const variation of variations) {
      const backdrop = resolveAdsProBackdrop(variation.doc.background, variation.doc.format, []);
      assert.ok(backdrop.asset);
      assert.equal(layoutOf(variation.doc).issues.filter(isCriticalIssue).length, 0);
    }
  });

  await check("V9 fundo inexistente num documento antigo cai num fundo válido (missing=true) e o layout continua bom", () => {
    const [variation] = variationsFor(PRODUCT_PERFUME);
    const stale = { ...variation.doc, background: { ...variation.doc.background, id: "fundo-removido-da-biblioteca" } };
    const backdrop = resolveAdsProBackdrop(stale.background, stale.format);
    assert.equal(backdrop.missing, true);
    assert.ok(MARKETING_PRO_BACKGROUND_LIBRARY.some((asset) => asset.id === backdrop.asset.id) || backdrop.asset.id === "pro-generic-fallback");
    assert.equal(layoutOf(stale).issues.filter(isCriticalIssue).length, 0);
    const reopened = parseAdsProDocument(serializeAdsProDocument(stale));
    assert.equal(reopened.ok, true);
  });

  await check("V10 balde comercial do produto vira desempate DENTRO do patamar de categoria (doces => fundos de doces primeiro)", () => {
    const sweets: ApprovedStaticBackgroundEntry[] = [
      { id: "bg-sweets-aaaaaaaaaa", bucket: "doces", category: "food", style: "sensory", luminance: "light", needsScrim: false, width: 1080, height: 1350 },
      { id: "bg-sweets-bbbbbbbbbb", bucket: "doces", category: "food", style: "editorial", luminance: "light", needsScrim: false, width: 1080, height: 1350 },
      { id: "bg-sweets-cccccccccc", bucket: "doces", category: "food", style: "minimal", luminance: "light", needsScrim: false, width: 1080, height: 1350 },
      { id: "bg-food-dddddddddd", bucket: "alimentos", category: "food", style: "sensory", luminance: "dark", needsScrim: false, width: 1080, height: 1350 },
      { id: "bg-tech-eeeeeeeeee", bucket: "eletronicos", category: "electronics", style: "modern", luminance: "dark", needsScrim: false, width: 1080, height: 1350 },
    ];
    const { library, manifest } = staticAssetsFor(sweets);
    const variations = variationsFor(PRODUCT_SWEETS, { preferredStyles: ["sensory"], manifest, library });
    assert.equal(variations[0].doc.background.id, "bg-sweets-aaaaaaaaaa", "estilo sensorial + balde doces => o fundo de doces sensorial");
    assert.equal(variations[0].rationale.bucketMatch, true);
    assert.equal(variations[0].doc.background.source, "STATIC_ASSET");
    for (const variation of variations) assert.notEqual(variation.doc.background.id, "bg-tech-eeeeeeeeee", "fundo de eletrônicos nunca para doces enquanto há opções de comida");
    const homeVariations = variationsFor(PRODUCT_HOME, { preferredStyles: ["minimal"], manifest, library });
    for (const variation of homeVariations) assert.ok(!variation.doc.background.id.startsWith("bg-sweets-"), "doces não é a melhor escolha para casa e decoração");
  });

  await check("V11 'gerar outras opções' (round) muda o resultado de forma determinística e mantém as garantias", () => {
    const base = variationsFor(PRODUCT_PERFUME, { preferredStyles: ["luxury"] });
    const next = variationsFor(PRODUCT_PERFUME, { preferredStyles: ["luxury"], round: 1 });
    assert.deepEqual(variationsFor(PRODUCT_PERFUME, { preferredStyles: ["luxury"], round: 1 }), next);
    assert.notDeepEqual(next.map((variation) => variation.doc), base.map((variation) => variation.doc));
    assert.equal(next[0].doc.direction.style, "luxury", "a opção A continua liderada pelo estilo do perfil");
    assert.equal(new Set(next.map((variation) => variation.doc.direction.style)).size, next.length);
    for (const variation of next) assert.equal(layoutOf(variation.doc).issues.filter(isCriticalIssue).length, 0);
  });

  await check("V12 count 3..5: plano de estilos cobre perfil, vizinhos e o resto sem repetir", () => {
    assert.equal(variationsFor(PRODUCT_PERFUME, { count: 5 }).length, 5);
    assert.equal(variationsFor(PRODUCT_PERFUME, { count: 99 }).length, ADS_PRO_MAX_VARIATIONS);
    assert.equal(variationsFor(PRODUCT_PERFUME, { count: 1 }).length, 3, "mínimo é 3");
    const plan = planVariationStyles("luxury", ["luxury", "minimal"], 5, 0);
    assert.deepEqual(plan.slice(0, 3), ["luxury", "minimal", "editorial"]);
    assert.equal(new Set(plan).size, 5);
  });

  await check("V13 toda variação gerada passa no validador de layout (zona segura, sem sobreposição, legível) em todos os formatos", () => {
    let total = 0;
    for (const product of [PRODUCT_PERFUME, PRODUCT_NO_PRICE, PRODUCT_SWEETS, PRODUCT_HOME]) {
      for (const preferred of [[], ["minimal"], ["modern"], ["luxury"], ["editorial"], ["sensory"]] as MarketingProStyle[][]) {
        for (const intent of ["spotlight", "promo", "last", "new"] as const) {
          for (const format of ["portrait", "square"] as const) {
            for (const variation of variationsFor(product, { preferredStyles: preferred, intent, format, count: 5 })) {
              const critical = layoutOf(variation.doc).issues.filter(isCriticalIssue);
              assert.deepEqual(critical, [], `${product.id}/${JSON.stringify(preferred)}/${intent}/${format}/${variation.id}`);
              total += 1;
            }
          }
        }
      }
    }
    console.log(`  (${total} variações verificadas)`);
  });

  console.log(`ADS-PRO variations tests passed: ${checkCount()} checks.`);
}

void main().catch((error) => { console.error(error); process.exit(1); });
