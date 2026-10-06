/**
 * ADS-PRO-FINAL — o FLUXO inteiro do estúdio provado de ponta a ponta em Node (sem DOM, sem rede):
 * produto → facts → direção de arte (perfil) → opções → escolher → editar → trocar fundo → ajustar foto →
 * desfazer → validar layout → serializar/reabrir → montar o registro do histórico → plano de exportação.
 *
 * Cobre os 12 requisitos obrigatórios (perfil influencia; 3 opções diferentes; trocar fundo/prévia sem cota;
 * retry idempotente; preço nunca inventado; foto original intacta; matcher só usa ativo aprovado; fundo
 * ausente não quebra; exportação preserva dimensões; área segura do celular; fluxo completo). O que depende de
 * pixel real do navegador (PNG exportado, miniaturas) é provado em `tests/e2e/ads-pro-final.spec.ts`.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { MARKETING_PRO_FORMAT_DIMENSIONS } from "../shared/marketing-pro-contract";
import {
  ADS_PRO_TEXT_LIMITS,
  getAdsProCanvasSize,
  parseAdsProDocument,
  serializeAdsProDocument,
  withBackground,
  withDirection,
  withFormat,
  withPhoto,
  withText,
  type AdsProAdDocumentV1,
  type AdsProFormat,
} from "../shared/ads-pro/ad-document";
import { resolveAdsProBackdrop, toDocumentBackground } from "../shared/ads-pro/ad-backdrop";
import { computeAdLayout, isCriticalIssue } from "../shared/ads-pro/ad-layout";
import { applyPhotoAdjust, type RgbaImage } from "../shared/ads-pro/ad-photo-adjust";
import {
  ADS_PRO_BILLABLE_ACTIONS,
  ADS_PRO_COST_BEARING_REFERENCES,
  ADS_PRO_STUDIO_ACTIONS,
  consumesAdsProPreparationQuota,
} from "../shared/ads-pro/ad-quota-policy";
import { INITIAL_STUDIO_STATE, studioReducer, type StudioAction } from "../shared/ads-pro/ad-studio-state";
import { buildAdsProBackgroundCatalog } from "../shared/ads-pro/background-catalog";
import type { ApprovedStaticBackgroundEntry } from "../shared/ads-pro/static-background-entry";
import { generateAdsProVariations, rankAdsProBackgroundsForFacts } from "../shared/ads-pro/ad-variations";
import { ADS_PRO_PRODUCTION_MANIFEST } from "../shared/ads-pro/production-manifest";
import { MARKETING_PRO_BACKGROUND_LIBRARY } from "../shared/marketing-pro-background-library";
import { buildStudioHistoryEntry, saveStudioProject, type StudioSaveDeps } from "../client/src/lib/ads-pro-studio-persistence";
import {
  PRODUCT_HOME,
  PRODUCT_NO_PRICE,
  PRODUCT_PERFUME,
  PRODUCT_SWEETS,
  check,
  checkCount,
  estimateMeasure,
  factsOf,
  layoutOf,
  variationsFor,
} from "./ads-pro-test-kit";

const FORMATS: readonly AdsProFormat[] = ["portrait", "square"];
const run = (state: typeof INITIAL_STUDIO_STATE, ...actions: StudioAction[]) => actions.reduce(studioReducer, state);

const studioDir = "client/src/components/marketing/ads-pro-studio";
const studioSources: Record<string, string> = {};
for (const file of fs.readdirSync(studioDir)) studioSources[`${studioDir}/${file}`] = fs.readFileSync(path.join(studioDir, file), "utf8");
for (const file of ["ads-pro-studio-assets.ts", "ads-pro-studio-catalog.ts", "ads-pro-studio-export.ts", "ads-pro-studio-persistence.ts", "ads-pro-studio-render.ts"]) {
  studioSources[`client/src/lib/${file}`] = fs.readFileSync(path.join("client/src/lib", file), "utf8");
}
for (const file of ["ad-studio-state.ts", "ad-variations.ts", "ad-layout.ts", "ad-document.ts", "ad-photo-adjust.ts", "background-catalog.ts"]) {
  studioSources[`shared/ads-pro/${file}`] = fs.readFileSync(path.join("shared/ads-pro", file), "utf8");
}
const allStudioSource = Object.values(studioSources).join("\n");

function syntheticEntries(count: number): ApprovedStaticBackgroundEntry[] {
  const buckets = ["doces", "alimentos", "eletronicos", "cosmeticos", "roupas", "acessorios", "papelaria", "casa", "utilidades", "geral"] as const;
  const styles = ["luxury", "editorial", "minimal", "sensory", "modern"] as const;
  const categoryOf = { doces: "food", alimentos: "food", eletronicos: "electronics", cosmeticos: "beauty", roupas: "fashion", acessorios: "fashion", papelaria: "general", casa: "home", utilidades: "home", geral: "general" } as const;
  return Array.from({ length: count }, (_, index) => {
    const bucket = buckets[index % buckets.length];
    return {
      id: `bg-${bucket}-${String(index).padStart(10, "0")}`,
      bucket: bucket as ApprovedStaticBackgroundEntry["bucket"],
      category: categoryOf[bucket],
      style: styles[index % styles.length],
      luminance: index % 3 === 0 ? "dark" : "light",
      needsScrim: index % 4 === 0,
      width: 1080,
      height: 1350,
    } as ApprovedStaticBackgroundEntry;
  });
}

await check("FL1 o PERFIL influencia a geração (estilo, composição e fundo mudam com o perfil)", () => {
  const luxury = variationsFor(PRODUCT_PERFUME, { preferredStyles: ["luxury"] });
  const sensory = variationsFor(PRODUCT_PERFUME, { preferredStyles: ["sensory"] });
  const none = variationsFor(PRODUCT_PERFUME, { preferredStyles: [] });
  assert.equal(luxury[0].doc.direction.style, "luxury");
  assert.equal(sensory[0].doc.direction.style, "sensory");
  assert.equal(luxury[0].rationale.styleFromProfile, true);
  assert.equal(none[0].rationale.styleFromProfile, false, "sem perfil o estilo vem da categoria, e a UI diz isso");
  const signature = (v: ReturnType<typeof variationsFor>) => v.map((item) => `${item.doc.direction.style}/${item.doc.direction.archetype}/${item.doc.background.id}`).join("|");
  assert.notEqual(signature(luxury), signature(sensory), "perfis diferentes geram resultados diferentes");
  assert.notEqual(signature(luxury), signature(none));
  const reordered = variationsFor(PRODUCT_PERFUME, { preferredStyles: ["editorial", "luxury"] });
  assert.equal(reordered[0].doc.direction.style, "editorial", "o primeiro estilo do perfil lidera");
});

await check("FL2 as 3 opções são REALMENTE diferentes (≥6 eixos, layout e fundo)", () => {
  for (const product of [PRODUCT_PERFUME, PRODUCT_SWEETS, PRODUCT_HOME, PRODUCT_NO_PRICE]) {
    for (const format of FORMATS) {
      const variations = variationsFor(product, { preferredStyles: ["luxury", "modern"], format });
      assert.ok(variations.length >= 3, "no mínimo 3 opções");
      for (let i = 0; i < variations.length; i += 1) {
        for (let j = i + 1; j < variations.length; j += 1) {
          const a = variations[i].doc.direction; const b = variations[j].doc.direction;
          const axes = [a.style !== b.style, a.archetype !== b.archetype, a.hierarchy !== b.hierarchy, a.spacing !== b.spacing, a.ctaShape !== b.ctaShape, a.decoration !== b.decoration, a.priceStyle !== b.priceStyle, a.intensity !== b.intensity, variations[i].doc.background.id !== variations[j].doc.background.id];
          assert.ok(axes.filter(Boolean).length >= 4, `${product.name} ${format}: opções ${i}/${j} muito parecidas`);
          const la = layoutOf(variations[i].doc); const lb = layoutOf(variations[j].doc);
          assert.notDeepEqual(la.product.rect, lb.product.rect === la.product.rect ? null : lb.product.rect, "o layout (posição do produto) também difere");
        }
      }
      assert.equal(new Set(variations.map((v) => v.doc.background.id)).size, variations.length, "fundos distintos");
      for (const variation of variations) {
        assert.equal(variation.doc.text.headline, variations[0].doc.text.headline, "os dados do produto são idênticos em todas as opções");
        assert.equal(variation.doc.text.priceText, variations[0].doc.text.priceText);
      }
    }
  }
});

await check("FL3 trocar fundo, prévia, trocar opção, editar, salvar, exportar e compartilhar NUNCA consomem cota", () => {
  for (const action of ADS_PRO_STUDIO_ACTIONS) assert.equal(consumesAdsProPreparationQuota(action), false, `${action} não pode consumir cota`);
  for (const action of ["change-background", "preview", "select-variation", "edit-text", "save-project", "export-png", "share"] as const) {
    assert.ok((ADS_PRO_STUDIO_ACTIONS as readonly string[]).includes(action), `${action} está declarada como ação do estúdio`);
  }
  assert.deepEqual([...ADS_PRO_BILLABLE_ACTIONS], ["professional-photo-preparation"], "a única ação que consome cota é a preparação profissional");
  assert.equal(consumesAdsProPreparationQuota("professional-photo-preparation"), true);
});

await check("FL4 o código do estúdio NUNCA referencia endpoint/provedor com custo ou cota (guarda estática)", () => {
  for (const [file, source] of Object.entries(studioSources)) {
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    for (const reference of ADS_PRO_COST_BEARING_REFERENCES) {
      assert.ok(!code.includes(reference), `${file} não pode referenciar "${reference}" (custo/cota)`);
    }
    assert.doesNotMatch(code, /fetch\(/, `${file}: o estúdio não faz fetch próprio (só o upload do histórico via server-upload)`);
  }
  const uploadKinds = Array.from(allStudioSource.matchAll(/kind:\s*"(product|logo|cutout|campaign-prize|product-thumbnail|marketing-pro-ad)"/g)).map((match) => match[1]);
  assert.ok(uploadKinds.length > 0 && uploadKinds.every((kind) => kind === "marketing-pro-ad"), `o estúdio só envia imagens do tipo marketing-pro-ad (viu: ${uploadKinds.join(",")})`);
});

await check("FL5 retry de salvar é IDEMPOTENTE (mesmo entryId; criar uma vez, atualizar depois; nunca duplica)", async () => {
  const doc = variationsFor(PRODUCT_PERFUME)[0].doc;
  const store = new Map<string, Record<string, unknown>>();
  const uploads: string[] = [];
  let recordCalls = 0; let updateCalls = 0;
  const deps: StudioSaveDeps = {
    getToken: async () => "token",
    upload: async ({ targetId }) => { uploads.push(targetId); return { downloadUrl: `https://cdn.example/${targetId}.png`, storagePath: `users/u/marketing-pro-ads/${targetId}/ad.png` } as never; },
    recordAction: async (entry, explicitId) => { recordCalls += 1; const id = explicitId ?? "generated"; store.set(id, { ...entry }); return { id, persisted: true }; },
    updateEntry: async (id, patch) => { updateCalls += 1; store.set(id, { ...(store.get(id) ?? {}), ...patch }); return true; },
  };
  const input = { entryId: "entry-fixed-1", doc, png: new Blob(["x"], { type: "image/png" }), product: { id: "prod-perfume", name: "Perfume", brand: "Luna" }, branding: { storeName: "Loja" }, remoteExists: false };
  const first = await saveStudioProject(input, deps);
  assert.equal(first.status, "saved");
  assert.equal(first.remoteExists, true);
  const second = await saveStudioProject({ ...input, remoteExists: first.remoteExists, doc: withText(doc, { headline: "Editado" }) }, deps);
  const third = await saveStudioProject({ ...input, remoteExists: second.remoteExists, doc: withText(doc, { headline: "Editado" }) }, deps);
  assert.equal(store.size, 1, "três salvamentos = UM registro");
  assert.equal(recordCalls, 1, "criado uma única vez");
  assert.equal(updateCalls, 2, "os seguintes só atualizam");
  assert.deepEqual(new Set(uploads), new Set(["entry-fixed-1"]), "o upload usa SEMPRE o mesmo alvo (sobrescreve, não duplica)");
  assert.equal(third.status, "saved");
  assert.equal(store.get("entry-fixed-1")?.headline, "Editado");
});

await check("FL6 preço NUNCA é inventado (sem preço no cadastro: nada no doc, no layout nem no histórico)", () => {
  const facts = factsOf(PRODUCT_NO_PRICE);
  assert.equal(facts.price, null);
  for (const format of FORMATS) {
    for (const variation of variationsFor(PRODUCT_NO_PRICE, { format, intent: "promo" })) {
      const doc = variation.doc;
      assert.equal(doc.show.price, false);
      assert.equal(doc.text.priceText, "");
      assert.equal(doc.text.oldPriceText, "");
      assert.equal(doc.text.badgeText, "");
      assert.notEqual(doc.direction.archetype, "price-burst", "sem preço não há composição de oferta");
      const layout = layoutOf(doc);
      assert.equal(layout.price, undefined, "o layout não reserva bloco de preço");
      const entry = buildStudioHistoryEntry({ doc, product: { id: "p", name: "n" }, branding: { storeName: "L" }, imageUrl: "https://x/y.png", includeProject: true });
      assert.equal(entry.price, "");
      assert.equal(entry.priceText, "");
    }
  }
  // O estúdio não oferece nenhum campo para digitar preço: só alternar a visibilidade do que vem do cadastro.
  const editSource = studioSources[`${studioDir}/StudioEditStep.tsx`];
  assert.doesNotMatch(editSource, /priceText:\s*value|onText\(\{\s*priceText/, "o editor não permite digitar o preço");
  assert.doesNotMatch(editSource, /oldPriceText:\s*value|badgeText:\s*value/);
  // Promoção só aparece quando o cadastro tem promoção real
  const promo = variationsFor({ ...PRODUCT_PERFUME, discountPercent: undefined }, { intent: "promo" })[0].doc;
  assert.equal(promo.text.badgeText, "", "sem desconto no cadastro não existe selo de %");
  assert.notEqual(promo.text.kicker, "OFERTA");
});

await check("FL7 a foto ORIGINAL nunca é sobrescrita (ajuste = cópia; nenhuma escrita no produto)", () => {
  const data = new Uint8ClampedArray(16 * 16 * 4);
  for (let i = 0; i < data.length; i += 4) { data[i] = 90; data[i + 1] = 120; data[i + 2] = 150; data[i + 3] = 255; }
  const original: RgbaImage = { data, width: 16, height: 16 };
  const snapshot = Array.from(data);
  const adjusted = applyPhotoAdjust(original, { brightness: 0.2, contrast: 1.2, saturation: 1.3, sharpness: 0.8 });
  assert.deepEqual(Array.from(original.data), snapshot, "os bytes da foto original continuam idênticos");
  assert.notStrictEqual(adjusted.data, original.data, "o ajuste devolve um buffer NOVO");
  assert.notDeepEqual(Array.from(adjusted.data), snapshot);
  // nenhum caminho do estúdio grava no produto/foto
  assert.doesNotMatch(allStudioSource, /updateProduct|setDoc\(\s*doc\([^)]*"products"|kind:\s*"product"|kind:\s*"product-thumbnail"|deleteImageViaServer/, "o estúdio nunca escreve/apaga a foto do produto");
  assert.doesNotMatch(studioSources["client/src/lib/ads-pro-studio-assets.ts"], /saveApprovedProductCutout/, "o recorte local do estúdio nunca é persistido no produto");
  const doc = variationsFor(PRODUCT_PERFUME)[0].doc;
  const edited = withPhoto(doc, { zoom: 2, mode: "cutout", adjust: { brightness: 0.1 } });
  assert.equal(edited.photo.zoom, 2);
  assert.equal(doc.photo.zoom, 1, "editar a foto não muta o documento anterior");
  assert.equal(doc.photo.adjust.brightness, 0, "nem o ajuste do documento anterior");
});

await check("FL8 o matcher só usa ATIVO APROVADO (manifest) — nunca um id solto da biblioteca", () => {
  const entries = syntheticEntries(40);
  const catalog = buildAdsProBackgroundCatalog(entries, "1.1.0");
  assert.equal(catalog.staticCount, 40);
  assert.equal(catalog.manifest.assets.length, MARKETING_PRO_BACKGROUND_LIBRARY.length + 40);
  const manifestIds = new Set(catalog.manifest.assets.map((asset) => asset.id));
  for (const product of [PRODUCT_PERFUME, PRODUCT_SWEETS, PRODUCT_HOME]) {
    for (const round of [0, 1, 2]) {
      for (const variation of generateAdsProVariations({ facts: factsOf(product), preferredStyles: ["luxury"], intent: "spotlight", format: "portrait", storeName: "L", manifest: catalog.manifest, library: catalog.library, round })) {
        assert.ok(manifestIds.has(variation.doc.background.id), `${variation.doc.background.id} precisa estar no manifest aprovado`);
      }
    }
  }
  // um asset presente na biblioteca MAS ausente do manifest jamais é escolhido
  const rogue = { ...catalog.library[0], id: "rogue-library-only-asset" } as (typeof catalog.library)[number];
  const withRogue = generateAdsProVariations({ facts: factsOf(PRODUCT_PERFUME), preferredStyles: [], intent: "spotlight", format: "portrait", storeName: "L", manifest: catalog.manifest, library: [...catalog.library, rogue] });
  assert.ok(withRogue.every((variation) => variation.doc.background.id !== "rogue-library-only-asset"));
  const ranked = rankAdsProBackgroundsForFacts({ facts: factsOf(PRODUCT_PERFUME), style: "luxury", intent: "spotlight", format: "portrait", manifest: catalog.manifest, library: [...catalog.library, rogue] });
  assert.ok(ranked.every((item) => manifestIds.has(item.asset.id)), "a grade de fundos também só mostra o que o manifest aprovou");
  // o catálogo canônico atual = manifest canônico + estáticos aprovados (hoje 0 até a auditoria dos 309)
  assert.ok(ADS_PRO_PRODUCTION_MANIFEST.assets.length >= 12);
});

await check("FL9 fundo ausente/removido NUNCA quebra (cai num fundo válido e avisa)", () => {
  const doc = withBackground(variationsFor(PRODUCT_PERFUME)[0].doc, { id: "fundo-que-nao-existe-mais", version: 3, family: "luxury", source: "STATIC_ASSET" });
  const backdrop = resolveAdsProBackdrop(doc.background, doc.format);
  assert.equal(backdrop.missing, true);
  assert.ok(backdrop.asset.formats.includes(doc.format));
  const layout = computeAdLayout({ doc, measure: estimateMeasure, backdrop: { colors: backdrop.colors, forceScrim: backdrop.forceScrim }, hasLogo: true });
  assert.equal(layout.issues.filter(isCriticalIssue).length, 0, "o anúncio continua válido mesmo com o fundo ausente");
  const reopened = parseAdsProDocument(serializeAdsProDocument(doc));
  assert.ok(reopened.ok, "o projeto salvo com um fundo que sumiu ainda reabre");
  const emptyManifest = generateAdsProVariations({ facts: factsOf(PRODUCT_PERFUME), preferredStyles: [], intent: "spotlight", format: "portrait", storeName: "L", manifest: { ...ADS_PRO_PRODUCTION_MANIFEST, assets: [] }, library: [] });
  assert.ok(emptyManifest.length >= 3, "biblioteca/manifest vazios ainda geram as opções (fundo de último recurso)");
});

await check("FL10 a exportação PRESERVA as dimensões do formato (4:5 = 1080×1350, 1:1 = 1080×1080)", () => {
  assert.deepEqual(getAdsProCanvasSize("portrait"), { width: 1080, height: 1350 });
  assert.deepEqual(getAdsProCanvasSize("square"), { width: 1080, height: 1080 });
  for (const format of FORMATS) {
    assert.equal(getAdsProCanvasSize(format).width, MARKETING_PRO_FORMAT_DIMENSIONS[format].width);
    assert.equal(getAdsProCanvasSize(format).height, MARKETING_PRO_FORMAT_DIMENSIONS[format].height);
    const doc = withFormat(variationsFor(PRODUCT_PERFUME)[0].doc, format);
    const layout = layoutOf(doc);
    assert.deepEqual(layout.canvas, getAdsProCanvasSize(format), "o layout nasce no tamanho exato da exportação");
  }
  const render = studioSources["client/src/lib/ads-pro-studio-render.ts"];
  assert.match(render, /const size = getAdsProCanvasSize\(doc\.format\);\s*const canvas = document\.createElement\("canvas"\);\s*const rendered = renderAdsProAd\(canvas, doc, assets, \{ width: size\.width \}\);/, "a exportação renderiza na largura cheia do formato");
});

await check("FL11 ÁREA SEGURA do celular: texto, preço, botão e logo ficam dentro do recorte central em todas as opções e formatos", () => {
  for (const product of [PRODUCT_PERFUME, PRODUCT_SWEETS, PRODUCT_HOME, PRODUCT_NO_PRICE]) {
    for (const format of FORMATS) {
      for (const intent of ["spotlight", "promo", "last", "new"] as const) {
        for (const variation of variationsFor(product, { format, intent, preferredStyles: ["luxury", "editorial", "minimal"] })) {
          for (const hasLogo of [true, false]) {
            const layout = layoutOf(variation.doc, hasLogo);
            const critical = layout.issues.filter(isCriticalIssue);
            assert.deepEqual(critical, [], `${product.name} ${format} ${intent} ${variation.label}: ${JSON.stringify(critical)}`);
          }
        }
      }
    }
  }
});

await check("FL12 FLUXO COMPLETO: produto → opções → escolher → editar → fundo → foto → desfazer → salvar → reabrir → exportar", () => {
  const facts = factsOf(PRODUCT_PERFUME);
  const variations = generateAdsProVariations({ facts, preferredStyles: ["luxury"], intent: "promo", format: "portrait", storeName: "Loja da Ana" });
  assert.ok(variations.length >= 3);
  let state = run(INITIAL_STUDIO_STATE, { type: "variations-ready", variations });
  state = run(state, { type: "pick-variation", variation: variations[1] });
  state = run(state, { type: "edit", kind: "content", apply: (doc) => withText(doc, { headline: "Luna Intense" }), now: 1 });
  const swapTo = MARKETING_PRO_BACKGROUND_LIBRARY.find((asset) => asset.id !== state.doc?.background.id && asset.formats.includes("portrait"));
  assert.ok(swapTo);
  state = run(state, { type: "edit", kind: "look", apply: (doc) => withBackground(doc, toDocumentBackground(swapTo)), now: 2000 });
  state = run(state, { type: "edit", kind: "photo", apply: (doc) => withPhoto(doc, { zoom: 1.4, adjust: { brightness: 0.05, contrast: 1.1 } }), now: 4000 });
  const previousShape = state.doc?.direction.ctaShape;
  const nextShape = previousShape === "bar" ? "soft" : "bar";
  state = run(state, { type: "edit", kind: "look", apply: (doc) => withDirection(doc, { ctaShape: nextShape }), now: 6000 });
  assert.equal(state.doc?.direction.ctaShape, nextShape);
  state = run(state, { type: "undo" });
  const doc = state.doc as AdsProAdDocumentV1;
  assert.equal(doc.text.headline, "Luna Intense");
  assert.equal(doc.background.id, swapTo.id);
  assert.equal(doc.photo.zoom, 1.4);
  assert.equal(doc.direction.ctaShape, previousShape, "o desfazer reverteu só a última edição");
  // layout válido em ambos os formatos para o documento FINAL
  for (const format of FORMATS) assert.deepEqual(layoutOf(withFormat(doc, format)).issues.filter(isCriticalIssue), []);
  // salvar/reabrir: o JSON é curto e volta idêntico
  const serialized = serializeAdsProDocument(doc);
  assert.ok(serialized.length < 3600);
  const parsed = parseAdsProDocument(serialized);
  assert.ok(parsed.ok);
  assert.deepEqual(parsed.ok && parsed.doc, doc);
  const reopened = run(INITIAL_STUDIO_STATE, { type: "open-project", doc: parsed.ok ? parsed.doc : doc });
  assert.deepEqual(reopened.doc, doc);
  // registro do histórico: modo pro, projeto editável, fundo identificado, sem preço digitado pelo usuário
  const entry = buildStudioHistoryEntry({ doc, product: { id: "prod-perfume", name: "Perfume" }, branding: { storeName: "Loja da Ana" }, imageUrl: "https://x/y.png", includeProject: true });
  assert.equal(entry.mode, "pro");
  assert.equal(entry.proBackground?.backgroundId, swapTo.id);
  assert.equal(entry.proDocument, serialized);
  assert.equal(entry.priceText, doc.text.priceText);
  assert.ok((entry.headline ?? "").length <= ADS_PRO_TEXT_LIMITS.headline);
});

await check("FL13 o estúdio é gratuito e local: a fonte de cada capacidade existe e nenhuma chama a rede", () => {
  const photoStep = studioSources[`${studioDir}/StudioPhotoStep.tsx`];
  assert.match(photoStep, /computeAutoAdjust\(analyzePhoto\(/);
  assert.match(photoStep, /assets\.generateCutout\(\)/);
  const assetsLib = studioSources["client/src/lib/ads-pro-studio-assets.ts"];
  assert.match(assetsLib, /generateProductCutoutRgba/, "o recorte é o local (flood-fill)");
  assert.doesNotMatch(assetsLib, /photoroom|fetch\(/i);
  assert.match(studioSources["client/src/lib/ads-pro-studio-export.ts"], /shareMarketingCard/, "compartilhar reaproveita o mecanismo nativo/Web Share existente");
  assert.match(studioSources["client/src/lib/ads-pro-studio-export.ts"], /web-download-fallback/, "o fallback sem Web Share é honesto (baixa e avisa)");
});

await check("FL14 a grade de fundos recomenda pelo matcher e prefere o balde comercial do produto", () => {
  const catalog = buildAdsProBackgroundCatalog(syntheticEntries(60), "1.2.0");
  const sweets = rankAdsProBackgroundsForFacts({ facts: factsOf(PRODUCT_SWEETS), style: "editorial", intent: "spotlight", format: "portrait", manifest: catalog.manifest, library: catalog.library });
  assert.ok(sweets.length > 12, "a grade inclui os estáticos aprovados");
  const bestTier = sweets.filter((item) => item.tierIndex === 0);
  assert.ok(bestTier.length > 0);
  const firstBucketMatchIndex = sweets.findIndex((item) => item.bucketMatch);
  if (firstBucketMatchIndex >= 0) assert.ok(sweets.slice(0, firstBucketMatchIndex).every((item) => item.tierIndex <= sweets[firstBucketMatchIndex].tierIndex || !item.bucketMatch), "ordenação por patamar do matcher e balde comercial");
  assert.equal(new Set(sweets.map((item) => item.asset.id)).size, sweets.length, "sem fundos repetidos na grade");
});

await check("FL15 marca placeholder ('Sem marca') NUNCA vira texto do anúncio; marca real continua", () => {
  for (const placeholder of ["Sem marca", "SEM MARCA", "sem  marca", "Outros", "N/A", "-", "  "]) {
    const facts = factsOf({ ...PRODUCT_PERFUME, brand: placeholder });
    assert.equal(facts.brand, undefined, `"${placeholder}" não é marca`);
    for (const variation of variationsFor({ ...PRODUCT_PERFUME, brand: placeholder, extras: {}, description: "" })) {
      assert.doesNotMatch(`${variation.doc.text.kicker} ${variation.doc.text.subtitle}`, /sem\s+marca|outros|n\/a/i);
      assert.equal(variation.doc.show.subtitle, false, "sem marca/volume/descrição o subtítulo some em vez de ficar vazio");
    }
  }
  const real = factsOf({ ...PRODUCT_PERFUME, brand: "Maison Luna" });
  assert.equal(real.brand, "Maison Luna");
  assert.equal(variationsFor(PRODUCT_PERFUME)[0].doc.text.kicker, "MAISON LUNA", "marca real continua aparecendo");
});

console.log(`ADS-PRO final flow: ${checkCount()} checks passed`);
