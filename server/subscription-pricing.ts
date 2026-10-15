import { LAUNCH_PRICE_CENTS, STANDARD_PRICE_CENTS, type BillingCycle, type CommercialOffer, type PaidPlan, type PurchaseChannel } from "../shared/subscription-pricing";

/** Missing, invalid or unbounded campaign configuration never enables a discount. */
export function resolveCommercialOffer({ plan, billingCycle, channel, now = new Date() }: {
  plan: PaidPlan; billingCycle: BillingCycle; channel: PurchaseChannel; now?: Date;
}): CommercialOffer {
  const start = Date.parse(process.env.LAUNCH_OFFER_START ?? "");
  const end = Date.parse(process.env.LAUNCH_OFFER_END ?? "");
  const launch = channel === "web" && process.env.LAUNCH_OFFER_ENABLED === "true"
    && Number.isFinite(start) && Number.isFinite(end) && start < end
    && now.getTime() >= start && now.getTime() < end;
  return {
    pricingVersion: "v2", offerId: launch ? "launch" : "standard", plan, billingCycle,
    subscribedPriceCents: (launch ? LAUNCH_PRICE_CENTS : STANDARD_PRICE_CENTS)[plan][billingCycle],
    referencePriceCents: STANDARD_PRICE_CENTS[plan][billingCycle],
  };
}
