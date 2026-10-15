import type { MarketingProStyle } from "@shared/marketing-pro-contract";
import type { MarketingCampaignIntentId } from "@shared/marketing-pro-creative-intelligence";
import type { AdsProPhotoAdjust, AdsProPhotoState } from "@shared/ads-pro/ad-document";
import type { AdsProCtaShape, AdsProDecoration, AdsProPriceStyle } from "@shared/ads-pro/ad-style-direction";

export type StudioStepId = "photo" | "style" | "options" | "background" | "edit" | "save";

/**
 * Ordem do fluxo: foto → estilo → opções (cada uma já recebe um fundo do matcher) → fundo (refinar o da opção
 * escolhida) → editar → salvar/exportar/compartilhar. "Opções" vem ANTES de "Fundo" de propósito: escolher
 * uma opção troca o visual, então refinar o fundo só faz sentido depois dela.
 */
export const STUDIO_STEPS: readonly { readonly id: StudioStepId; readonly label: string }[] = [
  { id: "photo", label: "Foto" },
  { id: "style", label: "Estilo" },
  { id: "options", label: "Opções" },
  { id: "background", label: "Fundo" },
  { id: "edit", label: "Editar" },
  { id: "save", label: "Salvar" },
];

export function nextStudioStep(step: StudioStepId): StudioStepId {
  const index = STUDIO_STEPS.findIndex((item) => item.id === step);
  return STUDIO_STEPS[Math.min(STUDIO_STEPS.length - 1, index + 1)].id;
}

/** Objetivos oferecidos ao vendedor (subconjunto dos objetivos do motor criativo). */
export const STUDIO_INTENTS: readonly { readonly id: MarketingCampaignIntentId; readonly label: string }[] = [
  { id: "spotlight", label: "Destaque" },
  { id: "promo", label: "Promoção" },
  { id: "new", label: "Novidade" },
  { id: "last", label: "Últimas unidades" },
  { id: "bestseller", label: "Mais vendido" },
  { id: "catalog", label: "Catálogo" },
];

export const STUDIO_STYLES: readonly MarketingProStyle[] = ["luxury", "editorial", "minimal", "sensory", "modern"];

export type StudioStyleChoice = "profile" | MarketingProStyle;

export type StudioPhotoPatch = Omit<Partial<AdsProPhotoState>, "adjust"> & { readonly adjust?: Partial<AdsProPhotoAdjust> };

export const PRICE_STYLE_LABELS: Readonly<Record<AdsProPriceStyle, string>> = Object.freeze({
  plain: "Simples",
  underline: "Sublinhado",
  badge: "Selo",
  stamp: "Carimbo",
  burst: "Explosão",
});

export const CTA_SHAPE_LABELS: Readonly<Record<AdsProCtaShape, string>> = Object.freeze({
  pill: "Pílula",
  outline: "Contorno",
  bar: "Barra",
  link: "Link",
  soft: "Suave",
});

export const DECORATION_LABELS: Readonly<Record<AdsProDecoration, string>> = Object.freeze({
  none: "Nenhuma",
  line: "Linha",
  frame: "Moldura",
  circle: "Círculo",
  corner: "Canto",
});
