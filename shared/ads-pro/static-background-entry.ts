/**
 * ADS-PRO-FINAL — contrato do fundo ESTÁTICO aprovado pela auditoria da biblioteca.
 *
 * O arquivo `approved-static-backgrounds.ts` é GERADO por `script/ads-pro-background-audit.ts --write`
 * e contém somente entradas deste formato. O acervo bruto (`source-assets/`) nunca é referenciado em
 * runtime: o produto só enxerga os WebP otimizados que a auditoria publicou em
 * `client/public/ads-pro/backgrounds/`.
 */
import type { MarketingProCategory } from "../marketing-pro-contract";
import type { AuditBucket, AuditStyle } from "./background-audit";

export interface ApprovedStaticBackgroundEntry {
  /** Id canônico do AssetDNA (`bg-<balde>-<sha256[0..10]>`). */
  readonly id: string;
  readonly bucket: AuditBucket;
  readonly category: MarketingProCategory;
  readonly style: AuditStyle;
  readonly luminance: "dark" | "light";
  /** true => zonas de texto movimentadas: o compositor aplica scrim atrás do texto. */
  readonly needsScrim: boolean;
  /** Dimensões do WebP otimizado publicado (não do original bruto). */
  readonly width: number;
  readonly height: number;
}

/** Pasta pública (servida como qualquer asset de `client/public/`) dos fundos aprovados. */
export const ADS_PRO_STATIC_BACKGROUND_PUBLIC_DIR = "/ads-pro/backgrounds" as const;

export function staticBackgroundUrl(id: string): string {
  return `${ADS_PRO_STATIC_BACKGROUND_PUBLIC_DIR}/${id}.webp`;
}

export function staticBackgroundThumbnailUrl(id: string): string {
  return `${ADS_PRO_STATIC_BACKGROUND_PUBLIC_DIR}/thumbs/${id}.webp`;
}
