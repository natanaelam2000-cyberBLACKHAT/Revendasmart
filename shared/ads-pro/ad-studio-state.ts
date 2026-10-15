/**
 * ADS-PRO-FINAL — estado PURO do estúdio (reducer): o anúncio em edição, histórico de desfazer/refazer e a
 * regra que decide quando novas opções (variações) podem substituir o anúncio atual.
 *
 * Princípios (provados em `script/ads-pro-studio-state-tests.ts`):
 *  - Escolher uma opção NUNCA apaga o que o vendedor já escreveu (textos/visibilidade) nem o ajuste/
 *    enquadramento da foto: a opção troca só o "visual" (composição, fundo, estilo).
 *  - Mudar o que gera opções (objetivo, intensidade, perfil, "outras opções") só troca o anúncio sozinho
 *    enquanto o vendedor ainda NÃO editou nada; depois disso as opções novas ficam disponíveis, mas o
 *    anúncio dele não muda de baixo dos dedos (`staleVariations`).
 *  - Nenhuma ação aqui toca rede, quota, Storage ou Firestore: trocar fundo/variação/editar é sempre de graça.
 *
 * Puro: sem DOM, sem relógio (o `now` entra na ação), sem Firebase.
 */
import { serializeAdsProDocument, type AdsProAdDocumentV1 } from "./ad-document";
import type { AdsProVariation } from "./ad-variations";

export const STUDIO_HISTORY_LIMIT = 40;
/** Edições seguidas da mesma "chave" dentro desta janela viram UM passo de desfazer (ex.: digitar um título). */
export const STUDIO_COALESCE_WINDOW_MS = 900;

/**
 * - content: textos e visibilidade (o que o anúncio DIZ);
 * - look: composição, fundo, decoração, preço/botão (como o anúncio PARECE);
 * - photo: ajuste/enquadramento/recorte da foto (sempre carregado entre opções);
 * - format: tamanho da tela (4:5 / 1:1) — não conta como edição.
 */
export type StudioEditKind = "content" | "look" | "photo" | "format";

export interface StudioState {
  readonly doc: AdsProAdDocumentV1 | null;
  readonly past: readonly AdsProAdDocumentV1[];
  readonly future: readonly AdsProAdDocumentV1[];
  /** Opção de origem ("A".."E"), "saved" para projeto reaberto ou null antes da primeira geração. */
  readonly selectedVariationId: string | null;
  readonly contentEdited: boolean;
  readonly lookEdited: boolean;
  /** Existem opções novas que NÃO foram aplicadas porque o vendedor já editou o anúncio. */
  readonly staleVariations: boolean;
  readonly lastEdit: { readonly key: string; readonly at: number } | null;
  /** Assinatura do documento no último salvamento (detecta "alterações não salvas"). */
  readonly savedSignature: string | null;
  /** Assinatura das últimas opções recebidas: a mesma rodada chegando de novo não muda nada. */
  readonly variationsSignature: string | null;
}

export const INITIAL_STUDIO_STATE: StudioState = Object.freeze({
  doc: null,
  past: [],
  future: [],
  selectedVariationId: null,
  contentEdited: false,
  lookEdited: false,
  staleVariations: false,
  lastEdit: null,
  savedSignature: null,
  variationsSignature: null,
});

export type StudioAction =
  | { readonly type: "variations-ready"; readonly variations: readonly AdsProVariation[] }
  | { readonly type: "pick-variation"; readonly variation: AdsProVariation }
  | { readonly type: "edit"; readonly kind: StudioEditKind; readonly apply: (doc: AdsProAdDocumentV1) => AdsProAdDocumentV1; readonly now: number; readonly key?: string }
  | { readonly type: "undo" }
  | { readonly type: "redo" }
  | { readonly type: "open-project"; readonly doc: AdsProAdDocumentV1 }
  | { readonly type: "mark-saved" }
  | { readonly type: "reset" };

export function isStudioEdited(state: StudioState): boolean {
  return state.contentEdited || state.lookEdited;
}

/** Há mudanças que ainda não foram salvas? */
export function hasUnsavedStudioChanges(state: StudioState): boolean {
  if (!state.doc) return false;
  return serializeAdsProDocument(state.doc) !== state.savedSignature;
}

/**
 * Aplica o VISUAL de `variationDoc` mantendo o que é do vendedor: a foto (sempre), a marca e — quando ele
 * editou — os textos e a visibilidade. Sem edição, os textos vêm da opção (acompanham o objetivo escolhido).
 */
export function carryStudioContent(current: AdsProAdDocumentV1 | null, variationDoc: AdsProAdDocumentV1, contentEdited: boolean): AdsProAdDocumentV1 {
  if (!current) return variationDoc;
  return {
    ...variationDoc,
    photo: current.photo,
    brand: current.brand,
    format: current.format,
    text: contentEdited ? current.text : variationDoc.text,
    show: contentEdited ? current.show : variationDoc.show,
  };
}

function pushHistory(state: StudioState, doc: AdsProAdDocumentV1): readonly AdsProAdDocumentV1[] {
  const past = [...state.past, doc];
  return past.length > STUDIO_HISTORY_LIMIT ? past.slice(past.length - STUDIO_HISTORY_LIMIT) : past;
}

function sameDoc(a: AdsProAdDocumentV1, b: AdsProAdDocumentV1): boolean {
  return serializeAdsProDocument(a) === serializeAdsProDocument(b);
}

export function studioReducer(state: StudioState, action: StudioAction): StudioState {
  switch (action.type) {
    case "reset":
      return INITIAL_STUDIO_STATE;

    case "variations-ready": {
      const variations = action.variations;
      if (variations.length === 0) return state;
      const signature = variations.map((variation) => serializeAdsProDocument(variation.doc)).join("|");
      const first = variations[0];
      // Sem anúncio em edição — ou o anúncio é de OUTRO produto — a primeira opção vira o anúncio.
      if (!state.doc || state.doc.productId !== first.doc.productId) {
        return { ...INITIAL_STUDIO_STATE, doc: first.doc, selectedVariationId: first.id, variationsSignature: signature };
      }
      if (signature === state.variationsSignature) return state;
      // Projeto reaberto é do vendedor: novas opções ficam disponíveis, sem alarde e sem tocar no anúncio.
      if (isStudioEdited(state)) {
        if (state.selectedVariationId === "saved") return { ...state, variationsSignature: signature };
        return { ...state, variationsSignature: signature, staleVariations: true };
      }
      // Sem edições do vendedor: o anúncio acompanha a mesma opção (A/B/C) da nova rodada.
      const match = variations.find((variation) => variation.id === state.selectedVariationId) ?? first;
      const next = carryStudioContent(state.doc, match.doc, false);
      return {
        ...state,
        doc: next,
        selectedVariationId: match.id,
        past: sameDoc(next, state.doc) ? state.past : pushHistory(state, state.doc),
        future: sameDoc(next, state.doc) ? state.future : [],
        staleVariations: false,
        lastEdit: null,
        variationsSignature: signature,
      };
    }

    case "pick-variation": {
      const next = carryStudioContent(state.doc, action.variation.doc, state.contentEdited);
      if (state.doc && sameDoc(next, state.doc) && state.selectedVariationId === action.variation.id) return state.staleVariations ? { ...state, staleVariations: false } : state;
      return {
        ...state,
        doc: next,
        selectedVariationId: action.variation.id,
        past: state.doc ? pushHistory(state, state.doc) : state.past,
        future: [],
        lookEdited: false,
        staleVariations: false,
        lastEdit: null,
      };
    }

    case "edit": {
      if (!state.doc) return state;
      const next = action.apply(state.doc);
      if (sameDoc(next, state.doc)) return state;
      const coalesce = action.key !== undefined
        && state.lastEdit !== null
        && state.lastEdit.key === action.key
        && action.now - state.lastEdit.at <= STUDIO_COALESCE_WINDOW_MS
        && state.past.length > 0;
      return {
        ...state,
        doc: next,
        past: coalesce ? state.past : pushHistory(state, state.doc),
        future: [],
        contentEdited: state.contentEdited || action.kind === "content",
        lookEdited: state.lookEdited || action.kind === "look",
        lastEdit: action.key !== undefined ? { key: action.key, at: action.now } : null,
      };
    }

    case "undo": {
      if (!state.doc || state.past.length === 0) return state;
      const previous = state.past[state.past.length - 1];
      return { ...state, doc: previous, past: state.past.slice(0, -1), future: [state.doc, ...state.future], lastEdit: null };
    }

    case "redo": {
      if (!state.doc || state.future.length === 0) return state;
      const [next, ...rest] = state.future;
      return { ...state, doc: next, past: pushHistory(state, state.doc), future: rest, lastEdit: null };
    }

    case "open-project":
      // Projeto reaberto é, por definição, "do vendedor": nenhuma geração automática o sobrescreve.
      return {
        ...INITIAL_STUDIO_STATE,
        doc: action.doc,
        selectedVariationId: "saved",
        contentEdited: true,
        lookEdited: true,
        savedSignature: serializeAdsProDocument(action.doc),
      };

    case "mark-saved":
      return state.doc ? { ...state, savedSignature: serializeAdsProDocument(state.doc) } : state;
  }
}
