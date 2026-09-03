/**
 * PLAN-IMPL-04A §15/§49/§51, estendido por PLAN-IMPL-04B — autoridade mínima e server-derived para
 * "este plano pode ser comprado agora de verdade", separada da metadata de preço-alvo
 * (`PLAN_PRESENTATION`/`PLAN_PRICING`/`PLAN_PRICE_CENTS`, shared/monetization.ts). Nenhum componente
 * decide isso sozinho com um `if (plan === "pro")` hardcoded (§15) — todos leem esta única resposta.
 *
 * §38 — validação de configuração: credencial do provider + flag de ativação por tier + PRICE MATCH
 * GATE (§13) — o valor configurado para cobrança precisa bater exatamente `PLAN_PRICE_CENTS`, em
 * centavos (nunca float), ou a compra fica indisponível. Isto torna estruturalmente impossível a UI
 * mostrar R$79,90 e o checkout cobrar R$19,90: os dois só concordam em "disponível" quando os números
 * batem byte a byte.
 *
 * Lida os env vars de forma independente (nunca importa de server/subscriptions.ts) pelo mesmo motivo
 * já estabelecido em PLAN-IMPL-04A: este módulo não pode acoplar a código de pagamento.
 *
 * §59 — contrato de env vars exigido em produção para cada tier ativar (nomes reais, não placeholders):
 *   MERCADOPAGO_ACCESS_TOKEN       (já existe — credencial central do provider)
 *   PRO_SUBSCRIPTION_ENABLED       ("true" para habilitar Pro)
 *   PRO_PRICE_BRL_CENTS            (precisa ser exatamente "4990")
 *   PREMIUM_V2_SUBSCRIPTION_ENABLED ("true" para habilitar a nova precificação Premium)
 *   PREMIUM_V2_PRICE_BRL_CENTS     (precisa ser exatamente "7990")
 * Deliberadamente SEPARADO de `PREMIUM_PRICE_BRL` (a env var legada que server/subscriptions.ts's
 * endpoint antigo continua usando, intocada) — ativar Premium v2 é uma ação explícita e nova, nunca um
 * efeito colateral de alguém tocar a env var legada por outro motivo.
 */
import { PLAN_PRICE_CENTS, type PlanPurchaseAvailability, type PlanPurchaseAvailabilityEntry } from "../shared/monetization";

function isProviderCredentialConfigured(): boolean {
  return Boolean(process.env.MERCADOPAGO_ACCESS_TOKEN?.trim());
}

function isEnabledFlag(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === "true";
}

function resolveTierAvailability(params: {
  enabledEnvValue: string | undefined;
  configuredPriceCentsEnvValue: string | undefined;
  targetPriceCents: number;
  notActivatedReason: "provider_not_configured" | "pricing_v2_not_activated";
}): PlanPurchaseAvailabilityEntry {
  if (!isProviderCredentialConfigured()) {
    return { available: false, reason: "provider_not_configured" };
  }
  if (!isEnabledFlag(params.enabledEnvValue)) {
    return { available: false, reason: params.notActivatedReason };
  }
  const configuredCents = Number.parseInt(params.configuredPriceCentsEnvValue ?? "", 10);
  if (!Number.isFinite(configuredCents) || configuredCents !== params.targetPriceCents) {
    return { available: false, reason: "pricing_configuration_mismatch" };
  }
  return { available: true, reason: null };
}

export function getPlanPurchaseAvailability(): PlanPurchaseAvailability {
  return {
    pro: resolveTierAvailability({
      enabledEnvValue: process.env.PRO_SUBSCRIPTION_ENABLED,
      configuredPriceCentsEnvValue: process.env.PRO_PRICE_BRL_CENTS,
      targetPriceCents: PLAN_PRICE_CENTS.pro.monthly,
      notActivatedReason: "provider_not_configured",
    }),
    premium: resolveTierAvailability({
      enabledEnvValue: process.env.PREMIUM_V2_SUBSCRIPTION_ENABLED,
      configuredPriceCentsEnvValue: process.env.PREMIUM_V2_PRICE_BRL_CENTS,
      targetPriceCents: PLAN_PRICE_CENTS.premium.monthly,
      notActivatedReason: "pricing_v2_not_activated",
    }),
    // §29 — cadência anual: sem suporte nativo no Mercado Pago PreApproval (auto_recurring só documenta
    // frequency_type "days"/"months"). Nunca fica disponível nesta versão — a UI mostra o preço-alvo
    // anual só como referência comercial, nunca um checkout real.
    annual: { available: false, reason: "not_supported_by_provider" },
  };
}
