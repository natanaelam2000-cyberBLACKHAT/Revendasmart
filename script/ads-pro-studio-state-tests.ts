/**
 * ADS-PRO-FINAL — o estado do estúdio (reducer puro): escolher opção, editar, desfazer/refazer, novas opções.
 * Garantias: escolher uma opção nunca apaga o que o vendedor escreveu; opções novas não mudam o anúncio dele
 * de baixo dos dedos; nada aqui toca rede/quota; projeto reaberto nunca é sobrescrito.
 */
import assert from "node:assert/strict";
import {
  withBackground,
  withDirection,
  withFormat,
  withPhoto,
  withText,
  withVisibility,
  type AdsProAdDocumentV1,
} from "../shared/ads-pro/ad-document";
import { toDocumentBackground } from "../shared/ads-pro/ad-backdrop";
import {
  INITIAL_STUDIO_STATE,
  STUDIO_COALESCE_WINDOW_MS,
  STUDIO_HISTORY_LIMIT,
  carryStudioContent,
  hasUnsavedStudioChanges,
  isStudioEdited,
  studioReducer,
  type StudioAction,
  type StudioState,
} from "../shared/ads-pro/ad-studio-state";
import { MARKETING_PRO_BACKGROUND_LIBRARY } from "../shared/marketing-pro-background-library";
import { PRODUCT_NO_PRICE, PRODUCT_PERFUME, PRODUCT_SWEETS, check, checkCount, variationsFor } from "./ads-pro-test-kit";

const run = (state: StudioState, ...actions: StudioAction[]): StudioState => actions.reduce(studioReducer, state);
const edit = (kind: "content" | "look" | "photo" | "format", apply: (doc: AdsProAdDocumentV1) => AdsProAdDocumentV1, now = 0, key?: string): StudioAction => ({ type: "edit", kind, apply, now, key });

const variations = variationsFor(PRODUCT_PERFUME, { preferredStyles: ["luxury", "editorial"] });
const started = run(INITIAL_STUDIO_STATE, { type: "variations-ready", variations });
assert.ok(started.doc, "a primeira rodada de opções cria o anúncio");

await check("ST1 a primeira opção vira o anúncio e o histórico começa vazio", () => {
  assert.equal(started.selectedVariationId, variations[0].id);
  assert.deepEqual(started.doc, variations[0].doc);
  assert.equal(started.past.length, 0);
  assert.equal(isStudioEdited(started), false);
  assert.equal(started.staleVariations, false);
});

await check("ST2 escolher outra opção troca o VISUAL e mantém os textos editados e a foto", () => {
  const typed = run(started, edit("content", (doc) => withText(doc, { headline: "Meu título" })), edit("photo", (doc) => withPhoto(doc, { zoom: 1.5, adjust: { brightness: 0.1 } })));
  const picked = run(typed, { type: "pick-variation", variation: variations[1] });
  assert.equal(picked.doc?.text.headline, "Meu título", "o título digitado sobrevive à troca de opção");
  assert.equal(picked.doc?.photo.zoom, 1.5, "o enquadramento sobrevive");
  assert.equal(picked.doc?.photo.adjust.brightness, 0.1, "o ajuste de foto sobrevive");
  assert.equal(picked.doc?.direction.archetype, variations[1].doc.direction.archetype, "o visual vem da opção escolhida");
  assert.equal(picked.doc?.background.id, variations[1].doc.background.id);
  assert.equal(picked.selectedVariationId, variations[1].id);
});

await check("ST3 sem edições, escolher uma opção usa os textos da própria opção", () => {
  const picked = run(started, { type: "pick-variation", variation: variations[2] });
  assert.deepEqual(picked.doc?.text, variations[2].doc.text);
  assert.equal(picked.lookEdited, false);
});

await check("ST4 editar marca o tipo certo (conteúdo × visual × foto × formato)", () => {
  const content = run(started, edit("content", (doc) => withVisibility(doc, { cta: false })));
  assert.equal(content.contentEdited, true);
  assert.equal(content.lookEdited, false);
  const look = run(started, edit("look", (doc) => withDirection(doc, { ctaShape: "bar" })));
  assert.equal(look.lookEdited, true);
  assert.equal(look.contentEdited, false);
  const photo = run(started, edit("photo", (doc) => withPhoto(doc, { zoom: 2 })));
  assert.equal(isStudioEdited(photo), false, "ajustar a foto não impede opções novas de trocarem o anúncio");
  const format = run(started, edit("format", (doc) => withFormat(doc, "square")));
  assert.equal(isStudioEdited(format), false, "trocar o formato não conta como edição");
  assert.equal(format.doc?.format, "square");
});

await check("ST5 trocar o fundo é uma edição de visual, grátis e desfazível", () => {
  const other = MARKETING_PRO_BACKGROUND_LIBRARY.find((asset) => asset.id !== started.doc?.background.id);
  assert.ok(other);
  const swapped = run(started, edit("look", (doc) => withBackground(doc, toDocumentBackground(other))));
  assert.equal(swapped.doc?.background.id, other.id);
  assert.equal(swapped.lookEdited, true);
  const undone = run(swapped, { type: "undo" });
  assert.equal(undone.doc?.background.id, started.doc?.background.id);
});

await check("ST6 opções novas só trocam o anúncio enquanto o vendedor não editou", () => {
  const next = variationsFor(PRODUCT_PERFUME, { preferredStyles: ["luxury", "editorial"], round: 1 });
  const refreshed = run(started, { type: "variations-ready", variations: next });
  assert.equal(refreshed.doc?.background.id, next[0].doc.background.id, "sem edições, o anúncio acompanha a nova rodada");
  assert.equal(refreshed.staleVariations, false);

  const edited = run(started, edit("look", (doc) => withDirection(doc, { ctaShape: "bar" })));
  const kept = run(edited, { type: "variations-ready", variations: next });
  assert.deepEqual(kept.doc, edited.doc, "com edições, o anúncio NÃO muda");
  assert.equal(kept.staleVariations, true, "mas o vendedor é avisado de que há opções novas");
  const applied = run(kept, { type: "pick-variation", variation: next[1] });
  assert.equal(applied.staleVariations, false, "escolher uma opção encerra o aviso");
});

await check("ST7 a mesma rodada chegando de novo não muda nada (nem avisa)", () => {
  const edited = run(started, edit("content", (doc) => withText(doc, { headline: "X" })));
  const again = run(edited, { type: "variations-ready", variations });
  assert.equal(again.staleVariations, false);
  assert.deepEqual(again.doc, edited.doc);
});

await check("ST8 desfazer/refazer percorrem o histórico e limpam o futuro numa nova edição", () => {
  const one = run(started, edit("content", (doc) => withText(doc, { headline: "Um" })));
  const two = run(one, edit("content", (doc) => withText(doc, { headline: "Dois" })));
  const back = run(two, { type: "undo" });
  assert.equal(back.doc?.text.headline, "Um");
  assert.equal(back.future.length, 1);
  const forward = run(back, { type: "redo" });
  assert.equal(forward.doc?.text.headline, "Dois");
  const branch = run(back, edit("content", (doc) => withText(doc, { headline: "Três" })));
  assert.equal(branch.future.length, 0, "uma edição nova descarta o refazer");
  assert.equal(run(started, { type: "undo" }).doc, started.doc, "desfazer sem histórico não faz nada");
  assert.equal(run(started, { type: "redo" }).doc, started.doc);
});

await check("ST9 digitar seguido vira UM passo de desfazer (janela de coalescência)", () => {
  let state = started;
  for (let i = 1; i <= 8; i += 1) state = run(state, edit("content", (doc) => withText(doc, { headline: `Titulo ${i}` }), i * 50, "headline"));
  assert.equal(state.past.length, 1, "oito teclas = um passo");
  const slow = run(state, edit("content", (doc) => withText(doc, { headline: "Depois da pausa" }), 8 * 50 + STUDIO_COALESCE_WINDOW_MS + 10, "headline"));
  assert.equal(slow.past.length, 2, "depois da janela começa outro passo");
  const otherField = run(state, edit("content", (doc) => withText(doc, { subtitle: "Sub" }), 450, "subtitle"));
  assert.equal(otherField.past.length, 2, "campos diferentes não se misturam");
  assert.equal(run(slow, { type: "undo" }).doc?.text.headline, "Titulo 8");
});

await check("ST10 o histórico é limitado (sem crescer sem fim)", () => {
  let state = started;
  for (let i = 0; i < STUDIO_HISTORY_LIMIT + 25; i += 1) state = run(state, edit("content", (doc) => withText(doc, { headline: `T${i}` }), i * 5000));
  assert.equal(state.past.length, STUDIO_HISTORY_LIMIT);
});

await check("ST11 edição sem efeito (mesmo documento) não cria passo nem marca edição", () => {
  const same = run(started, edit("content", (doc) => withText(doc, { headline: doc.text.headline })));
  assert.equal(same, started);
});

await check("ST12 projeto reaberto nunca é sobrescrito por opções novas e não gera aviso", () => {
  const saved = run(started, edit("content", (doc) => withText(doc, { headline: "Projeto salvo" })));
  const reopened = run(INITIAL_STUDIO_STATE, { type: "open-project", doc: saved.doc as AdsProAdDocumentV1 });
  assert.equal(reopened.selectedVariationId, "saved");
  assert.equal(hasUnsavedStudioChanges(reopened), false, "recém-aberto = igual ao salvo");
  const next = variationsFor(PRODUCT_PERFUME, { round: 2 });
  const after = run(reopened, { type: "variations-ready", variations: next });
  assert.deepEqual(after.doc, reopened.doc, "o projeto continua exatamente como foi salvo");
  assert.equal(after.staleVariations, false, "sem alarde para projeto reaberto");
  const picked = run(after, { type: "pick-variation", variation: next[0] });
  assert.equal(picked.doc?.text.headline, "Projeto salvo", "escolher uma opção mantém o texto do projeto");
});

await check("ST13 alterações não salvas são detectadas e o salvar zera a diferença", () => {
  assert.equal(hasUnsavedStudioChanges(INITIAL_STUDIO_STATE), false);
  assert.equal(hasUnsavedStudioChanges(started), true, "anúncio novo ainda não foi salvo");
  const saved = run(started, { type: "mark-saved" });
  assert.equal(hasUnsavedStudioChanges(saved), false);
  const changed = run(saved, edit("content", (doc) => withText(doc, { headline: "Mudou" })));
  assert.equal(hasUnsavedStudioChanges(changed), true);
  assert.equal(hasUnsavedStudioChanges(run(changed, { type: "undo" })), false, "desfazer até o salvo volta a 'sem alterações'");
});

await check("ST14 trocar de PRODUTO substitui o anúncio mesmo com edições (nunca mistura produtos)", () => {
  const edited = run(started, edit("content", (doc) => withText(doc, { headline: "Perfume editado" })), edit("look", (doc) => withDirection(doc, { ctaShape: "bar" })));
  const sweets = variationsFor(PRODUCT_SWEETS);
  const switched = run(edited, { type: "variations-ready", variations: sweets });
  assert.equal(switched.doc?.productId, sweets[0].doc.productId);
  assert.notEqual(switched.doc?.text.headline, "Perfume editado");
  assert.equal(isStudioEdited(switched), false);
  assert.equal(switched.past.length, 0);
});

await check("ST15 produto sem preço: nenhuma opção tem preço e o estado nunca inventa um", () => {
  const noPrice = variationsFor(PRODUCT_NO_PRICE);
  const state = run(INITIAL_STUDIO_STATE, { type: "variations-ready", variations: noPrice });
  assert.equal(state.doc?.show.price, false);
  assert.equal(state.doc?.text.priceText, "");
  const picked = run(state, { type: "pick-variation", variation: noPrice[1] });
  assert.equal(picked.doc?.text.priceText, "");
  assert.equal(picked.doc?.show.price, false);
});

await check("ST16 carryStudioContent: foto/marca/formato sempre do vendedor; texto só se ele editou", () => {
  const current = withPhoto(withText(started.doc as AdsProAdDocumentV1, { headline: "Meu" }), { zoom: 2 });
  const target = variations[1].doc;
  const keepText = carryStudioContent(current, target, true);
  assert.equal(keepText.text.headline, "Meu");
  assert.equal(keepText.photo.zoom, 2);
  const takeText = carryStudioContent(current, target, false);
  assert.deepEqual(takeText.text, target.text);
  assert.equal(takeText.photo.zoom, 2, "a foto nunca é trocada por uma opção");
  assert.equal(carryStudioContent(null, target, true), target);
});

await check("ST17 reducer é puro: não muta o estado anterior nem os documentos", () => {
  const before = JSON.stringify(started);
  run(started, edit("content", (doc) => withText(doc, { headline: "Mutação?" })), { type: "pick-variation", variation: variations[1] }, { type: "undo" });
  assert.equal(JSON.stringify(started), before);
});

console.log(`ADS-PRO studio state: ${checkCount()} checks passed`);
