/**
 * ADS-PRO-03E2 — Manifesto de Produção Canônico do Anúncios Pro
 *
 * Derivado determinística e puramente de MARKETING_PRO_BACKGROUND_LIBRARY.
 * Mantém a biblioteca visual como única fonte da verdade, transpondo os
 * cenários produtivos existentes para o contrato formal AssetDNA.
 */

import type { AssetDNA, AssetLibraryManifest, NormalizedRect } from "./asset-dna";
import { parseAssetLibrary } from "./asset-parser";
import { resolveMarketingProStyleForCreativeFamily } from "../marketing-pro-art-direction";
import { MARKETING_PRO_BACKGROUND_LIBRARY } from "../marketing-pro-background-library";

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
 * Constrói o manifesto de produção do Anúncios Pro derivando os assets
 * diretamente da biblioteca visual canônica e validando contra o parser formal.
 */
export function buildAdsProProductionManifest(): AssetLibraryManifest {
  const rawAssets = MARKETING_PRO_BACKGROUND_LIBRARY.map((bg) => ({
    id: bg.id,
    entityKinds: ["product"] as const,
    targetCategories: bg.categories,
    styles: [resolveMarketingProStyleForCreativeFamily(bg.family)],
    supportedIntents: [] as const,
    formats: bg.formats,
    subjectZone: ADS_PRO_SAFE_SUBJECT_ZONE,
    status: "active" as const,
    resource: {
      type: "generated" as const,
      uri: `generated:${bg.id}`,
    },
    ...(bg.tags && bg.tags.length > 0 ? { tags: bg.tags } : {}),
  }));

  const parseResult = parseAssetLibrary({
    schemaVersion: 1,
    libraryVersion: "1.0.0",
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
 * Manifesto canônico congelado de produção do Anúncios Pro.
 * Contém exatamente os 12 backgrounds produtivos derivados.
 */
export const ADS_PRO_PRODUCTION_MANIFEST: AssetLibraryManifest = Object.freeze(
  buildAdsProProductionManifest()
);
