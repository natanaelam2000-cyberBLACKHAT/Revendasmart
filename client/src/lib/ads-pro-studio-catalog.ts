/**
 * ADS-PRO-FINAL — o estúdio enxerga SEMPRE o catálogo completo (fundos gerados + estáticos aprovados na
 * auditoria). Um único ponto de resolução evita que preview, miniatura e exportação consultem bibliotecas
 * diferentes.
 */
import { resolveAdsProBackdrop, type ResolvedAdsProBackdrop } from "@shared/ads-pro/ad-backdrop";
import type { AdsProAdDocumentV1, AdsProDocumentBackground } from "@shared/ads-pro/ad-document";
import { ADS_PRO_BACKGROUND_CATALOG } from "@shared/ads-pro/background-catalog";

export const STUDIO_BACKGROUND_CATALOG = ADS_PRO_BACKGROUND_CATALOG;

export function resolveStudioBackdrop(background: Pick<AdsProDocumentBackground, "id">, format: AdsProAdDocumentV1["format"]): ResolvedAdsProBackdrop {
  return resolveAdsProBackdrop(background, format, STUDIO_BACKGROUND_CATALOG.library);
}
