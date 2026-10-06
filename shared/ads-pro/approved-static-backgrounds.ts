/**
 * GERADO por `script/ads-pro-background-audit.ts --write` — NÃO edite à mão.
 *
 * Fundos ESTÁTICOS aprovados pela auditoria do acervo bruto
 * (`source-assets/ads-pro-backgrounds/`). Vazio enquanto o acervo de 309 imagens não for auditado
 * nesta árvore: o Ads Pro funciona com os fundos determinísticos gerados em código
 * (`MARKETING_PRO_BACKGROUND_LIBRARY`) e passa a incluir estes automaticamente quando a lista for
 * preenchida pela auditoria.
 */
import type { ApprovedStaticBackgroundEntry } from "./static-background-entry";

export const ADS_PRO_APPROVED_STATIC_BACKGROUNDS_VERSION = "0.0.0" as const;

export const ADS_PRO_APPROVED_STATIC_BACKGROUNDS: readonly ApprovedStaticBackgroundEntry[] = [];
