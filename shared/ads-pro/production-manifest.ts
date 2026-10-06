/**
 * ADS-PRO-03E2 — Manifesto de Produção Canônico do Anúncios Pro
 *
 * Derivado determinística e puramente de MARKETING_PRO_BACKGROUND_LIBRARY.
 * Mantém a biblioteca visual como única fonte da verdade, transpondo os
 * cenários produtivos existentes para o contrato formal AssetDNA.
 *
 * ADS-PRO-FINAL: o construtor aceita qualquer biblioteca — o catálogo do estúdio (`background-catalog.ts`) o
 * alimenta com fundos gerados em código + fundos ESTÁTICOS APROVADOS pela auditoria do acervo bruto
 * (`approved-static-backgrounds.ts`, gerado). Este manifesto é o ÚNICO insumo do matcher: nada que não tenha
 * sido aprovado na auditoria chega a ser escolhido. Cada entrada declara `luminance` (medida do cenário)
 * para que o compositor escolha a cor de tinta legível.
 */

import type { AssetDNA, AssetLibraryManifest, NormalizedRect } from "./asset-dna";
import { parseAssetLibrary } from "./asset-parser";
import { resolveMarketingProStyleForCreativeFamily } from "../marketing-pro-art-direction";
import { MARKETING_PRO_BACKGROUND_LIBRARY, type MarketingProBackgroundAsset } from "../marketing-pro-background-library";
import { backdropColorsOfGenerated, classifyBackdropLuminance } from "./ad-contrast";

/**
 * Interseção segura normalizada entre MARKETING_PRO_PRODUCT_ZONE.portrait e square.
 * Geometria auditada na frente ADS-PRO-03E2-GATE / GATE-FIX:
 * x: 0.10, y: 0.17, width: 0.80, height: 0.42 (área 0.3360).
 * Totalmente contida em portrait e 100% coincidente com square.
 */
export const ADS_PRO_SAFE_SUBJECT_ZONE: NormalizedRect = Object.freeze({
  x: 0.10,
  y: 0.17,
  width: 0.80,
  height: 0.42,
});

/**
 * Luminância do cenário para o AssetDNA: medida na auditoria (estáticos) ou derivada das cores do
 * gradiente (gerados). O compositor usa isso para escolher tinta clara/escura — antes, texto escuro era
 * desenhado sobre fundos quase pretos.
 */
function resolveLuminanceField(bg: MarketingProBackgroundAsset): { readonly luminance?: "dark" | "light" } {
  if (bg.luminance) return { luminance: bg.luminance };
  if (bg.sourceType === "GENERATED_DETERMINISTIC") return { luminance: classifyBackdropLuminance(backdropColorsOfGenerated(bg.generated)) };
  return {};
}

/**
 * Constrói o manifesto de produção do Anúncios Pro derivando os assets
 * diretamente da biblioteca visual canônica e validando contra o parser formal.
 */
export function buildAdsProProductionManifest(
  library: readonly MarketingProBackgroundAsset[] = MARKETING_PRO_BACKGROUND_LIBRARY,
  libraryVersion: string = "1.0.0",
): AssetLibraryManifest {
  const rawAssets = library.map((bg) => ({
    id: bg.id,
    entityKinds: ["product"] as const,
    targetCategories: bg.categories,
    styles: [resolveMarketingProStyleForCreativeFamily(bg.family)],
    supportedIntents: [] as const,
    formats: bg.formats,
    subjectZone: ADS_PRO_SAFE_SUBJECT_ZONE,
    status: "active" as const,
    ...resolveLuminanceField(bg),
    resource: bg.sourceType === "STATIC_ASSET" ? { type: "static" as const, uri: bg.staticUrl } : {
      type: "generated" as const,
      uri: `generated:${bg.id}`,
    },
    ...(bg.tags && bg.tags.length > 0 ? { tags: bg.tags } : {}),
  }));

  const parseResult = parseAssetLibrary({
    schemaVersion: 1,
    libraryVersion,
    assets: rawAssets,
  });

  if (!parseResult.ok) {
    throw new Error(
      `Falha estrutural ao compilar manifesto de produção do Ads Pro: ${JSON.stringify(parseResult.errors)}`
    );
  }

  const manifest = parseResult.value;

  return Object.freeze({
    schemaVersion: manifest.schemaVersion,
    libraryVersion: manifest.libraryVersion,
    assets: Object.freeze(manifest.assets.map((asset: AssetDNA) => Object.freeze(asset))),
  });
}

/**
 * Manifesto canônico congelado dos fundos GERADOS em código (12). O manifesto completo do estúdio — com os
 * estáticos aprovados na auditoria — é `ADS_PRO_CATALOG_MANIFEST` (`background-catalog.ts`).
 */
export const ADS_PRO_PRODUCTION_MANIFEST: AssetLibraryManifest = Object.freeze(
  buildAdsProProductionManifest()
);
