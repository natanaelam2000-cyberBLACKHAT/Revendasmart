/**
 * ADS-PRO-FINAL — documento do anúncio: dados reais, edições puras, serialização estrita e reabertura segura.
 */
import assert from "node:assert/strict";
import {
  ADS_PRO_DOCUMENT_MAX_SERIALIZED_LENGTH,
  ADS_PRO_TEXT_LIMITS,
  NEUTRAL_PHOTO_ADJUST,
  PHOTO_ADJUST_LIMITS,
  PHOTO_FRAMING_LIMITS,
  clampPhotoAdjust,
  getAdsProCanvasSize,
  normalizeAdText,
  parseAdsProDocument,
  resolveEffectiveArchetype,
  resolveRenderableText,
  sanitizeAdTextInput,
  serializeAdsProDocument,
  withArchetype,
  withBackground,
  withFormat,
  withIntensity,
  withPhoto,
  withText,
  withVisibility,
  type AdsProAdDocumentV1,
} from "../shared/ads-pro/ad-document";
import { buildAdsProProductFacts, defaultSubtitle, formatBrlFromCents } from "../shared/ads-pro/ad-product-facts";
import { MARKETING_PRO_FORMAT_DIMENSIONS } from "../shared/marketing-pro-contract";
import { PRODUCT_NO_PRICE, PRODUCT_PERFUME, check, checkCount, deepFreeze, factsOf, variationsFor } from "./ads-pro-test-kit";

function sampleDoc(): AdsProAdDocumentV1 {
  return variationsFor(PRODUCT_PERFUME, { preferredStyles: ["luxury"], intent: "promo" })[0].doc;
}

async function main(): Promise<void> {
  await check("D1 fatos do produto: preço real em centavos, promoção só quando existe, desconto derivado dos dados", () => {
    const facts = factsOf(PRODUCT_PERFUME);
    assert.equal(facts.price?.regularCents, 34990);
    assert.equal(facts.price?.effectiveCents, 29742);
    assert.equal(facts.price?.hasPromotion, true);
    assert.equal(facts.price?.discountPercent, 15);
    assert.equal(facts.category, "beauty");
    assert.equal(facts.availability, "in_stock");
    const plain = buildAdsProProductFacts({ id: "x", name: "Item", salePrice: 100 });
    assert.equal(plain.price?.hasPromotion, false);
    assert.equal(plain.price?.discountPercent, null);
    const promotionalPrice = buildAdsProProductFacts({ id: "x", name: "Item", salePrice: 100, promotionalPrice: 80 });
    assert.equal(promotionalPrice.price?.effectiveCents, 8000);
    assert.equal(promotionalPrice.price?.discountPercent, 20);
    assert.equal(formatBrlFromCents(129990), "R$ 1.299,90");
    assert.ok(!formatBrlFromCents(5).includes(String.fromCharCode(160)), "sem NBSP");
  });

  await check("D2 preço ausente/zero/inválido NUNCA vira número: price=null e o documento não tem preço nem promoção", () => {
    for (const salePrice of [undefined, null, 0, -5, Number.NaN, "89,90", "abc", Number.POSITIVE_INFINITY]) {
      const facts = buildAdsProProductFacts({ id: "p", name: "Sem preço", salePrice, promotionalPrice: 10, discountPercent: 30 });
      assert.equal(facts.price, null, `salePrice=${String(salePrice)} deveria ficar sem preço`);
    }
    const [variation] = variationsFor(PRODUCT_NO_PRICE, { intent: "promo" });
    assert.equal(variation.doc.show.price, false);
    assert.equal(variation.doc.text.priceText, "");
    assert.ok(!/R\$|\d/.test(variation.doc.text.oldPriceText + variation.doc.text.badgeText));
    assert.equal(resolveRenderableText(variation.doc).hasPrice, false);
    assert.ok(!serializeAdsProDocument(variation.doc).includes("R$"), "nenhum valor monetário no documento salvo");
  });

  await check("D3 textos padrão vêm só de dados reais; subtítulo não repete a marca já usada no kicker", () => {
    const facts = factsOf(PRODUCT_PERFUME);
    assert.equal(defaultSubtitle(facts), "Maison Luna · 100 ml");
    const spotlight = variationsFor(PRODUCT_PERFUME, { intent: "spotlight" })[0].doc.text;
    assert.equal(spotlight.kicker, "MAISON LUNA");
    assert.equal(spotlight.subtitle, "100 ml", "marca já está no kicker");
    assert.equal(spotlight.ctaText, "Ver no catálogo");
    const noBrand = buildAdsProProductFacts({ id: "n", name: "Item", description: "Descrição real do produto. Segunda frase que não entra." });
    assert.equal(defaultSubtitle(noBrand), "Descrição real do produto");
  });

  await check("D4 edições são puras (não mutam o original) e limitam o tamanho dos textos", () => {
    const doc = deepFreeze(sampleDoc());
    const edited = withText(doc, { headline: "x".repeat(500), ctaText: "Comprar agora" });
    assert.equal(edited.text.headline.length, ADS_PRO_TEXT_LIMITS.headline);
    assert.equal(edited.text.ctaText, "Comprar agora");
    assert.notEqual(edited, doc);
    assert.equal(doc.text.ctaText, "Aproveite agora");
    assert.equal(withArchetype(doc, "split-side").direction.archetype, "split-side");
    assert.equal(withIntensity(doc, 1).direction.intensity, 1);
    assert.equal(withFormat(doc, "square").format, "square");
    assert.equal(withVisibility(doc, { cta: false }).show.cta, false);
    assert.equal(withBackground(doc, { id: "minimal-cloud-pedestal", version: 1, family: "minimal", source: "GENERATED_DETERMINISTIC" }).background.id, "minimal-cloud-pedestal");
  });

  await check("D5 digitação preserva espaços (não dá para apará-los enquanto o usuário digita); render e salvar aparam e colapsam", () => {
    assert.equal(sanitizeAdTextInput("Caixa de ", 80), "Caixa de ");
    assert.equal(sanitizeAdTextInput("a\u0000b\nc\u007fd", 80), "a b c d");
    const typing = withText(sampleDoc(), { headline: "Caixa  de   som " });
    assert.equal(typing.text.headline, "Caixa  de   som ");
    assert.equal(resolveRenderableText(typing).headline, "Caixa de som");
    assert.equal(normalizeAdText("  muito    espaço  ", 80), "muito espaço");
  });

  await check("D6 foto: ajustes e enquadramento sempre dentro dos limites seguros (nada de exagero, nem com valores absurdos)", () => {
    const extreme = clampPhotoAdjust({ brightness: 99, contrast: 99, saturation: 99, sharpness: 99 });
    assert.deepEqual(extreme, { brightness: PHOTO_ADJUST_LIMITS.brightness.max, contrast: PHOTO_ADJUST_LIMITS.contrast.max, saturation: PHOTO_ADJUST_LIMITS.saturation.max, sharpness: PHOTO_ADJUST_LIMITS.sharpness.max });
    const low = clampPhotoAdjust({ brightness: -99, contrast: -99, saturation: -99, sharpness: -99 });
    assert.equal(low.brightness, PHOTO_ADJUST_LIMITS.brightness.min);
    assert.equal(low.contrast, PHOTO_ADJUST_LIMITS.contrast.min);
    assert.deepEqual(clampPhotoAdjust({}), NEUTRAL_PHOTO_ADJUST);
    assert.deepEqual(clampPhotoAdjust({ brightness: Number.NaN, contrast: Number.NaN }), clampPhotoAdjust({ brightness: PHOTO_ADJUST_LIMITS.brightness.min, contrast: PHOTO_ADJUST_LIMITS.contrast.min }));
    const framed = withPhoto(sampleDoc(), { zoom: 50, offsetX: -9, offsetY: 9, adjust: { sharpness: 5 } });
    assert.equal(framed.photo.zoom, PHOTO_FRAMING_LIMITS.zoom.max);
    assert.equal(framed.photo.offsetX, PHOTO_FRAMING_LIMITS.offset.min);
    assert.equal(framed.photo.offsetY, PHOTO_FRAMING_LIMITS.offset.max);
    assert.equal(framed.photo.adjust.sharpness, PHOTO_ADJUST_LIMITS.sharpness.max);
    assert.equal(withPhoto(sampleDoc(), { zoom: 0.2 }).photo.zoom, PHOTO_FRAMING_LIMITS.zoom.min);
  });

  await check("D7 o documento guarda DECISÕES, nunca pixels: sem data URI/base64/blob e muito abaixo do limite do histórico", () => {
    const worst = withText(sampleDoc(), Object.fromEntries(Object.entries(ADS_PRO_TEXT_LIMITS).filter(([key]) => key !== "storeName").map(([key, limit]) => [key, "W".repeat(limit)])));
    const json = serializeAdsProDocument(withPhoto(worst, { mode: "cutout", zoom: 2.5, offsetX: 0.123, offsetY: -0.456, adjust: { brightness: 0.2, contrast: 1.2, saturation: 1.3, sharpness: 0.9 } }));
    assert.ok(json.length <= ADS_PRO_DOCUMENT_MAX_SERIALIZED_LENGTH, `${json.length} bytes`);
    assert.ok(json.length < 2600, `pior caso muito grande: ${json.length}`);
    assert.ok(!/data:|base64|blob:|https?:/i.test(json), "documento não pode carregar pixels nem URLs");
  });

  await check("D8 ida e volta: serializar -> parsear devolve o MESMO documento, em qualquer variação/estilo/formato", () => {
    for (const style of ["luxury", "editorial", "minimal", "sensory", "modern"] as const) {
      for (const format of ["portrait", "square"] as const) {
        for (const variation of variationsFor(PRODUCT_PERFUME, { preferredStyles: [style], format, intent: "last" })) {
          const parsed = parseAdsProDocument(serializeAdsProDocument(variation.doc));
          assert.equal(parsed.ok, true);
          if (parsed.ok) assert.deepEqual(parsed.doc, variation.doc);
        }
      }
    }
  });

  await check("D9 parser estrito: rejeita versão, formato, enums e fundo inválidos; aceita lixo extra ignorando-o; corrige números", () => {
    const base = JSON.parse(serializeAdsProDocument(sampleDoc())) as Record<string, any>;
    const reason = (value: unknown) => { const result = parseAdsProDocument(value); return result.ok ? "ok" : result.reason; };
    assert.equal(reason({ ...base, v: 2 }), "unsupported-version");
    assert.equal(reason({ ...base, format: "story" }), "invalid-format", "story não existe no compositor");
    assert.equal(reason({ ...base, productId: "" }), "invalid-product-id");
    assert.equal(reason({ ...base, direction: { ...base.direction, archetype: "inventado" } }), "invalid-direction");
    assert.equal(reason({ ...base, direction: { ...base.direction, style: "fresh-premium" } }), "invalid-direction");
    assert.equal(reason({ ...base, direction: { ...base.direction, intensity: 7 } }), "invalid-direction");
    assert.equal(reason({ ...base, background: { ...base.background, id: "Fundo Com Espaço" } }), "invalid-background");
    assert.equal(reason({ ...base, background: { ...base.background, source: "AI_GENERATED" } }), "invalid-background", "IA não é fonte de fundo do estúdio");
    assert.equal(reason("{ quebrado"), "invalid-json");
    assert.equal(reason("x".repeat(ADS_PRO_DOCUMENT_MAX_SERIALIZED_LENGTH + 1)), "too-large");
    assert.equal(reason(null), "not-an-object");
    assert.equal(reason([]), "not-an-object");
    const tolerant = parseAdsProDocument({ ...base, extra: "ignorado", photo: { zoom: 99, offsetX: "x", adjust: { contrast: 50 } }, text: { ...base.text, headline: 42 }, show: { price: "sim" } });
    assert.equal(tolerant.ok, true);
    if (tolerant.ok) {
      assert.equal(tolerant.doc.photo.zoom, PHOTO_FRAMING_LIMITS.zoom.max);
      assert.equal(tolerant.doc.photo.offsetX, 0);
      assert.equal(tolerant.doc.photo.adjust.contrast, PHOTO_ADJUST_LIMITS.contrast.max);
      assert.equal(tolerant.doc.text.headline, "");
      assert.equal(tolerant.doc.show.price, true, "booleano inválido volta ao padrão");
      assert.ok(!("extra" in tolerant.doc));
    }
  });

  await check("D10 price-burst sem preço cai deterministicamente para a vitrine; com preço permanece", () => {
    const burst = withArchetype(sampleDoc(), "price-burst");
    assert.equal(resolveEffectiveArchetype(burst), "price-burst");
    assert.equal(resolveEffectiveArchetype(withVisibility(burst, { price: false })), "hero-center");
    assert.equal(resolveEffectiveArchetype(withText(burst, { priceText: "" })), "hero-center");
  });

  await check("D11 dimensões de exportação = as dimensões canônicas existentes do Pro (4:5 = 1080x1350, 1:1 = 1080x1080)", () => {
    assert.deepEqual(getAdsProCanvasSize("portrait"), { width: MARKETING_PRO_FORMAT_DIMENSIONS.portrait.width, height: MARKETING_PRO_FORMAT_DIMENSIONS.portrait.height });
    assert.deepEqual(getAdsProCanvasSize("square"), { width: 1080, height: 1080 });
    assert.deepEqual(getAdsProCanvasSize("portrait"), { width: 1080, height: 1350 });
  });

  console.log(`ADS-PRO document tests passed: ${checkCount()} checks.`);
}

void main().catch((error) => { console.error(error); process.exit(1); });
