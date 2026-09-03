/**
 * PLAN-IMPL-04A §15/§49/§51 — autoridade mínima e server-derived para "este plano pode ser comprado
 * agora de verdade", separada da metadata de preço-alvo (`PLAN_PRESENTATION`/`PLAN_PRICING`,
 * shared/monetization.ts). Nenhum componente decide isso sozinho com um `if (plan === "pro")`
 * hardcoded (§15) — todos leem esta única resposta.
 *
 * Pro: hoje não existe NENHUM caminho de código que crie uma assinatura/produto Pro no Mercado Pago
 * (confirmado por auditoria: `server/subscriptions.ts` só conhece Premium) — `available: false` aqui é
 * um fato estrutural, não um placeholder a ser "adivinhado". PLAN-IMPL-04B precisaria adicionar esse
 * caminho antes que isto pudesse mudar (§51 — o hook para o futuro é justamente este arquivo).
 *
 * Premium: o preço realmente cobrado (`PREMIUM_PRICE_BRL`, mesma env var que `server/subscriptions.ts`
 * usa para criar a cobrança real, lida aqui de forma independente para não acoplar a este módulo a
 * código de pagamento) é comparado ao preço-alvo comercial (`PLAN_PRICING.premium.monthly`, R$79,90).
 * Só quando os dois já baterem — ou seja, quando a env var de produção for atualizada para a nova
 * precificação — é que a compra V2 passa a ficar disponível, sem precisar de deploy de código
 * (§51: a ativação de PLAN-IMPL-04B pode ser só uma mudança de configuração).
 */
import { PLAN_PRICING, type PlanPurchaseAvailability } from "../shared/monetization";

const PRICE_MATCH_EPSILON = 0.01;

function currentPremiumChargedPrice(): number {
  return parseFloat(process.env.PREMIUM_PRICE_BRL ?? "19.90");
}

export function getPlanPurchaseAvailability(): PlanPurchaseAvailability {
  const chargedPremiumPrice = currentPremiumChargedPrice();
  const premiumPricingV2Activated =
    Number.isFinite(chargedPremiumPrice) &&
    Math.abs(chargedPremiumPrice - PLAN_PRICING.premium.monthly) < PRICE_MATCH_EPSILON;

  return {
    pro: { available: false, reason: "provider_not_configured" },
    premium: premiumPricingV2Activated
      ? { available: true, reason: null }
      : { available: false, reason: "pricing_v2_not_activated" },
  };
}
