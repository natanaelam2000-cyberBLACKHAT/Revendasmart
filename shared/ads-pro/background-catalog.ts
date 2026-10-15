/**
 * ADS-PRO-FINAL — catálogo de fundos do ESTÚDIO: fundos gerados em código + fundos ESTÁTICOS aprovados pela
 * auditoria do acervo bruto (`script/ads-pro-background-audit.ts`), com o manifesto de produção que o matcher
 * usa como único insumo.
 *
 * Por que existe separado de `marketing-pro-background-library.ts`: a lista aprovada pode ter centenas de
 * entradas. Importá-la na biblioteca da rota de Anúncios a faria entrar no chunk dessa rota (budget de
 * bundle). Só o chunk lazy do estúdio importa este módulo.
 */
import {
  MARKETING_PRO_BACKGROUND_LIBRARY,
  type MarketingProBackgroundAsset,
  type MarketingProStaticBackgroundAsset,
} from "../marketing-pro-background-library";
import type { AssetLibraryManifest } from "./asset-dna";
import { ADS_PRO_APPROVED_STATIC_BACKGROUNDS, ADS_PRO_APPROVED_STATIC_BACKGROUNDS_VERSION } from "./approved-static-backgrounds";
import { AUDIT_BUCKET_SLUGS } from "./background-audit";
import { buildAdsProProductionManifest } from "./production-manifest";
import { staticBackgroundThumbnailUrl, staticBackgroundUrl, type ApprovedStaticBackgroundEntry } from "./static-background-entry";

/**
 * Categoria: o balde comercial vira a categoria canônica; "geral" vira universal (`[]`), compatível com tudo.
 * Só entra o que a auditoria aprovou — o acervo bruto nunca é lido em runtime.
 */
export function mapApprovedStaticBackground(entry: ApprovedStaticBackgroundEntry): MarketingProStaticBackgroundAsset {
  return {
    id: entry.id,
    version: 1,
    family: entry.style,
    categories: entry.bucket === "geral" ? [] : [entry.category],
    formats: ["square", "portrait"],
    tags: [`bucket:${AUDIT_BUCKET_SLUGS[entry.bucket]}`, entry.luminance, ...(entry.needsScrim ? ["scrim"] : [])],
    sourceType: "STATIC_ASSET",
    staticUrl: staticBackgroundUrl(entry.id),
    thumbnailUrl: staticBackgroundThumbnailUrl(entry.id),
    luminance: entry.luminance,
    needsScrim: entry.needsScrim,
  };
}

export interface AdsProBackgroundCatalog {
  /** Todos os fundos que o estúdio conhece: gerados + estáticos aprovados. */
  readonly library: readonly MarketingProBackgroundAsset[];
  /** Manifesto de produção correspondente — único insumo do matcher. */
  readonly manifest: AssetLibraryManifest;
  readonly staticCount: number;
}

export function buildAdsProBackgroundCatalog(
  entries: readonly ApprovedStaticBackgroundEntry[] = ADS_PRO_APPROVED_STATIC_BACKGROUNDS,
  version: string = ADS_PRO_APPROVED_STATIC_BACKGROUNDS_VERSION,
): AdsProBackgroundCatalog {
  const library: readonly MarketingProBackgroundAsset[] = Object.freeze([
    ...MARKETING_PRO_BACKGROUND_LIBRARY,
    ...entries.map(mapApprovedStaticBackground),
  ]);
  return Object.freeze({
    library,
    manifest: buildAdsProProductionManifest(library, entries.length === 0 ? "1.0.0" : version),
    staticCount: entries.length,
  });
}

/** Catálogo canônico do estúdio (gerado a partir de `approved-static-backgrounds.ts`). */
export const ADS_PRO_BACKGROUND_CATALOG: AdsProBackgroundCatalog = buildAdsProBackgroundCatalog();
