/**
 * ADS-PRO-FINAL — a regra comercial de COTA do Ads Pro, escrita como código verificável.
 *
 * Regra EXISTENTE (não é uma política nova — vem de PLAN-IMPL-05, `server/ads-pro-preparation-quota.ts` e
 * `PLAN_CONFIG[plan].limits.proAdPreparationsMonthly` em `shared/monetization.ts`):
 *
 *   - A ÚNICA operação que consome cota é a "preparação profissional" de produto: o recorte real via
 *     provedor externo (PhotoRoom), feito no cadastro/edição do produto. É cara, reutilizável e já
 *     idempotente no servidor (reserva atômica por produto/mês, `generationRequestId`, devolução da vaga em
 *     falha, reuso do recorte já aprovado sem novo consumo).
 *   - NUNCA consomem cota: gerar/visualizar o anúncio, trocar fundo/estilo/layout/proporção, escolher entre
 *     variações já geradas, editar textos/enquadramento, melhorar a foto localmente, recortar localmente,
 *     salvar, exportar, compartilhar ou reabrir do histórico. (Isso é reuso puro do que já foi preparado.)
 *
 * O estúdio do Ads Pro é 100% LOCAL: nenhuma de suas ações chama o provedor externo, então nenhuma delas
 * consome cota por construção. Este módulo existe para que essa afirmação seja TESTÁVEL (e para que um
 * futuro botão "recorte profissional" tenha de declarar a ação aqui antes de existir).
 */

export const ADS_PRO_STUDIO_ACTIONS = [
  "preview",
  "change-background",
  "change-style",
  "change-layout",
  "change-format",
  "generate-variations",
  "select-variation",
  "compare-variations",
  "edit-text",
  "edit-photo-framing",
  "adjust-photo",
  "remove-background-local",
  "save-project",
  "reopen-project",
  "export-png",
  "share",
] as const;
export type AdsProStudioAction = (typeof ADS_PRO_STUDIO_ACTIONS)[number];

/** Ações FORA do estúdio que a regra existente mede (única fonte de consumo de cota do Ads Pro). */
export const ADS_PRO_BILLABLE_ACTIONS = ["professional-photo-preparation"] as const;
export type AdsProBillableAction = (typeof ADS_PRO_BILLABLE_ACTIONS)[number];

export type AdsProAction = AdsProStudioAction | AdsProBillableAction;

export function consumesAdsProPreparationQuota(action: AdsProAction): boolean {
  return (ADS_PRO_BILLABLE_ACTIONS as readonly string[]).includes(action);
}

/** Endpoints/módulos que consomem cota ou custo variável: o código do estúdio nunca pode referenciá-los. */
export const ADS_PRO_COST_BEARING_REFERENCES = [
  "/api/ads-pro/preparation-quota",
  "photoroom-cutout",
  "product-cutout-photoroom",
  "ads-pro-preparation-quota",
  "enhance-photo",
  "product-photo-enhancement",
  "generateMarketingProBackgroundAndWait",
  "@/lib/marketing-pro-real-background\"",
  "/api/marketing/pro",
  "openai",
  "gemini",
  "replicate",
  "stability",
  "anthropic",
] as const;

export const ADS_PRO_QUOTA_RULE_SUMMARY =
  "Só a preparação profissional de produto (recorte real via provedor externo, no cadastro do produto) consome a cota mensal; " +
  "gerar, visualizar, trocar fundo, escolher variação, editar, salvar, exportar e compartilhar nunca consomem.";
