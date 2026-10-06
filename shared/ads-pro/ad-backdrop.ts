/**
 * ADS-PRO-FINAL — resolve o fundo de um documento para o que o layout/renderizador precisam.
 *
 * Um fundo inexistente (id velho no histórico, asset removido da biblioteca) NUNCA quebra o fluxo: cai,
 * de forma determinística, num fundo válido da biblioteca e avisa via `missing: true`.
 */
import {
  MARKETING_PRO_BACKGROUND_LIBRARY,
  resolveMarketingProBackground,
  type MarketingProBackgroundAsset,
} from "../marketing-pro-background-library";
import { backdropColorsOfGenerated } from "./ad-contrast";
import type { AdsProAdDocumentV1, AdsProDocumentBackground } from "./ad-document";

export interface ResolvedAdsProBackdrop {
  readonly asset: MarketingProBackgroundAsset;
  /** Cores do cenário usadas para decidir a tinta do texto. */
  readonly colors: readonly string[];
  readonly forceScrim: boolean;
  /** true => o id pedido não existe/não suporta o formato e um fundo válido foi usado no lugar. */
  readonly missing: boolean;
}

const DARK_STATIC_BACKDROP = ["#14171C", "#0B0D11"] as const;
const LIGHT_STATIC_BACKDROP = ["#F4F4F1", "#E7E7E3"] as const;

export function backdropColorsOfAsset(asset: MarketingProBackgroundAsset): readonly string[] {
  if (asset.sourceType === "GENERATED_DETERMINISTIC") return backdropColorsOfGenerated(asset.generated);
  return asset.luminance === "dark" ? DARK_STATIC_BACKDROP : LIGHT_STATIC_BACKDROP;
}

export function resolveAdsProBackdrop(
  background: Pick<AdsProDocumentBackground, "id">,
  format: AdsProAdDocumentV1["format"],
  library: readonly MarketingProBackgroundAsset[] = MARKETING_PRO_BACKGROUND_LIBRARY,
): ResolvedAdsProBackdrop {
  const found = library.find((asset) => asset.id === background.id && asset.formats.includes(format));
  const asset = found ?? resolveMarketingProBackground({ creativeFamily: "minimal", format, seed: background.id, library }).asset;
  return {
    asset,
    colors: backdropColorsOfAsset(asset),
    forceScrim: asset.sourceType === "STATIC_ASSET" && asset.needsScrim === true,
    missing: !found,
  };
}

/** Referência gravável no documento (id/versão/família/origem) a partir de um asset da biblioteca. */
export function toDocumentBackground(asset: MarketingProBackgroundAsset): AdsProDocumentBackground {
  return { id: asset.id, version: asset.version, family: asset.family, source: asset.sourceType === "STATIC_ASSET" ? "STATIC_ASSET" : "GENERATED_DETERMINISTIC" };
}
