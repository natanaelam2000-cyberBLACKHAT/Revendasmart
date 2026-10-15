import type { PlanPurchaseAvailability, PlanPurchaseAvailabilityEntry } from "../shared/monetization";
import type { BillingCycle, PurchaseChannel, PaidPlan } from "../shared/subscription-pricing";
import { resolveCommercialOffer } from "./subscription-pricing";

export function getPurchaseOffer(plan: PaidPlan, billingCycle: BillingCycle, channel: PurchaseChannel = "web", now = new Date()): PlanPurchaseAvailabilityEntry {
  const offer = resolveCommercialOffer({ plan, billingCycle, channel, now });
  const unavailable = (reason: NonNullable<PlanPurchaseAvailabilityEntry["reason"]>): PlanPurchaseAvailabilityEntry => ({ available: false, reason, offer });
  if (channel !== "web") return unavailable("not_supported_by_provider");
  if (!process.env.MERCADOPAGO_ACCESS_TOKEN?.trim()) return unavailable("provider_not_configured");
  const prefix = plan === "pro" ? "PRO" : "PREMIUM_V2";
  if (process.env[`${prefix}_SUBSCRIPTION_ENABLED`]?.trim().toLowerCase() !== "true") return unavailable(plan === "pro" ? "provider_not_configured" : "pricing_v2_not_activated");
  if (billingCycle === "annual" && process.env[`${prefix}_ANNUAL_SUBSCRIPTION_ENABLED`] !== "true") return unavailable("not_supported_by_provider");
  const priceKey = `${prefix}_${offer.offerId === "launch" ? "LAUNCH_" : ""}${billingCycle === "annual" ? "ANNUAL_" : ""}PRICE_BRL_CENTS`;
  const raw = process.env[priceKey] ?? "";
  if (!/^\d+$/.test(raw) || Number(raw) !== offer.subscribedPriceCents) return unavailable("pricing_configuration_mismatch");
  return { available: true, reason: null, offer };
}

export function getPlanPurchaseAvailability(channel: PurchaseChannel = "web"): PlanPurchaseAvailability {
  const now = new Date();
  const offers = {
    pro: { monthly: getPurchaseOffer("pro", "monthly", channel, now), annual: getPurchaseOffer("pro", "annual", channel, now) },
    premium: { monthly: getPurchaseOffer("premium", "monthly", channel, now), annual: getPurchaseOffer("premium", "annual", channel, now) },
  };
  return {
    pro: offers.pro.monthly, premium: offers.premium.monthly,
    annual: { available: offers.pro.annual.available && offers.premium.annual.available, reason: offers.pro.annual.reason ?? offers.premium.annual.reason },
    offers,
  };
}
