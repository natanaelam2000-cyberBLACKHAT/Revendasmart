/**
 * ADS-PRO-03D — Camada de Apresentação dos Estilos Visuais do Ads Pro
 *
 * Mapeamentos limpos, estritamente de apresentação em português (PT-BR),
 * para os 5 estilos canônicos do Ads Pro (MarketingProStyle).
 *
 * Princípios:
 * - Não altera os IDs do domínio (luxury, editorial, minimal, sensory, modern).
 * - Não faz promessas comerciais ("vende mais", "gera conversão"). A preferência é estética.
 * - Opera exclusivamente sobre MarketingProStyle sem estilos legados sazonais.
 * - Funções puras, imutáveis e determinísticas.
 */

import type { MarketingProStyle } from "@shared/marketing-pro-contract";

export interface AdsProStylePresentation {
  readonly id: MarketingProStyle;
  readonly label: string;
  readonly description: string;
  readonly badgeBg: string;
  readonly badgeText: string;
}

export const ADS_PRO_STYLE_PRESENTATION: Record<MarketingProStyle, AdsProStylePresentation> = Object.freeze({
  luxury: Object.freeze({
    id: "luxury",
    label: "Luxo",
    description: "Visual sofisticado com acabamento premium, elegância clássica e foco nos detalhes nobres.",
    badgeBg: "bg-amber-100",
    badgeText: "text-amber-800",
  }),
  editorial: Object.freeze({
    id: "editorial",
    label: "Editorial",
    description: "Visual limpo, equilibrado e elegante, inspirado na direção de arte refinada de editoriais e revistas.",
    badgeBg: "bg-purple-100",
    badgeText: "text-purple-800",
  }),
  minimal: Object.freeze({
    id: "minimal",
    label: "Minimalista",
    description: "Visual calmo, essencial e desobstruído, com bastante respiro em branco e destaque total para o produto.",
    badgeBg: "bg-slate-100",
    badgeText: "text-slate-800",
  }),
  sensory: Object.freeze({
    id: "sensory",
    label: "Sensorial",
    description: "Visual acolhedor com luz suave, texturas orgânicas e calor humano, despertando sensações táteis.",
    badgeBg: "bg-rose-100",
    badgeText: "text-rose-800",
  }),
  modern: Object.freeze({
    id: "modern",
    label: "Moderno",
    description: "Visual dinâmico, estruturado e contemporâneo, com energia gráfica, contrastes firmes e presença forte.",
    badgeBg: "bg-blue-100",
    badgeText: "text-blue-800",
  }),
});

/**
 * Retorna o rótulo amigável em português para um estilo visual do Ads Pro.
 */
export function getAdsProStyleLabel(style: MarketingProStyle): string {
  return ADS_PRO_STYLE_PRESENTATION[style]?.label ?? style;
}

/**
 * Retorna a descrição de direção de arte para um estilo visual do Ads Pro.
 */
export function getAdsProStyleDescription(style: MarketingProStyle): string {
  return ADS_PRO_STYLE_PRESENTATION[style]?.description ?? "";
}

/**
 * Formata uma lista de estilos em texto legível para UI (ex: "Minimalista, Moderno").
 */
export function formatAdsProStyleSummary(styles: readonly MarketingProStyle[]): string {
  if (!styles || styles.length === 0) {
    return "Nenhum estilo definido";
  }
  return styles.map((s) => getAdsProStyleLabel(s)).join(", ");
}
