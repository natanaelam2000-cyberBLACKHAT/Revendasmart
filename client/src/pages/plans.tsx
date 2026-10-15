import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { Check, Sparkles, Loader2 } from "lucide-react";
import { Layout } from "@/components/layout";
import { PageSkeleton } from "@/components/PageSkeleton";
import { usePlan } from "@/providers/PlanProvider";
import { usePlanPurchaseAvailability } from "@/hooks/usePlanPurchaseAvailability";
import { formatTrialDaysRemaining } from "@/lib/plan-helpers";
import { apiRequest, buildApiErrorDisplayMessage, ApiError } from "@/lib/api-client";
import { PLANS, PLAN_CONFIG, PLAN_PRESENTATION, PLAN_PRICING, type PlanType, type BillingCycle, type PlanPurchaseAvailabilityEntry } from "@shared/monetization";
import { annualSavings } from "@shared/subscription-pricing";
import { trackAnalyticsEvent, type AnalyticsCheckoutFailureReason, type AnalyticsSource } from "@/lib/firebase";
import { markPendingSubscriptionActivation } from "@/lib/subscription-activation-marker";
import { getAndroidPlayOffers, isAndroidNativeApp, openAndroidSubscriptionManagement, purchasePlanViaGooglePlay, restoreAndroidPurchases, type PlayBillingProductOffer } from "@/lib/play-billing";
import { getFirebaseAuth } from "@/lib/firebase";

/** PLAN-IMPL-06 §27 — mapeia os códigos REAIS de erro (server/subscriptions.ts's createSubscriptionCommand,
 * PLAN-IMPL-04B) para o enum fechado — nunca a string de erro bruta da API. */
function toCheckoutFailureReason(error: unknown): AnalyticsCheckoutFailureReason {
  if (!(error instanceof ApiError)) return "unknown";
  switch (error.code) {
    case "PLAN_PURCHASE_UNAVAILABLE": return "purchase_unavailable";
    case "INVALID_PLAN":
    case "UNSUPPORTED_BILLING_CYCLE": return "configuration_error";
    case "UNAUTHORIZED": return "authorization";
    case "TIMEOUT":
    case "NETWORK_ERROR": return "temporary_error";
    case "EXTERNAL_SERVICE_ERROR": return "provider_unavailable";
    default: return "unknown";
  }
}

/** PLAN-IMPL-06 §24 — lê `?source=` sem nunca repassar a URL inteira/arbitrária (§24: "Do not include
 * arbitrary URL") — um valor fora do enum fechado cai em "direct", nunca uma string livre. */
function readPlansSourceFromLocation(): AnalyticsSource {
  if (typeof window === "undefined") return "direct";
  const value = new URLSearchParams(window.location.search).get("source");
  const known: readonly AnalyticsSource[] = ["dashboard", "settings", "plan_usage", "product_limit", "client_limit", "booking_limit", "ads_pro_preparation_limit", "direct"];
  return (known as readonly string[]).includes(value ?? "") ? (value as AnalyticsSource) : "direct";
}

/**
 * PLAN-IMPL-04A §10-§22 — a experiência comercial principal de planos: comparação Free/Pro/Premium,
 * plano atual (base — trial nunca aparece como "seu plano" real, §20), trial ativo com contador
 * (§21), CTA por disponibilidade real de compra (nunca hardcoded por componente, §15), sem nenhuma
 * promessa de recurso ainda não implementado (§7 — só consome PLAN_PRESENTATION.sellableHighlights,
 * nunca PLAN_CONFIG[plan].features, que é a lista mais antiga e mais otimista).
 */

const BILLING_CYCLES = ["monthly", "annual"] as const;


function formatBRL(value: number): string {
  return value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** §45 — economia anual derivada só da tabela canônica, nunca um número guardado à parte. */

async function fetchCurrentPurchaseOffer(plan: PlanType, cycle: BillingCycle): Promise<PlanPurchaseAvailabilityEntry | null> {
  const availability = await apiRequest<import("@shared/monetization").PlanPurchaseAvailability>("/api/plans/purchase-availability?channel=web", {
    auth: true,
  });
  return availability.offers?.[plan === PLANS.PRO ? PLANS.PRO : PLANS.PREMIUM]?.[cycle] ?? null;
}

type CardState =
  | { kind: "current" }
  | { kind: "trial_active"; daysRemainingLabel: string | null }
  | { kind: "not_current" };

function resolveCardState(plan: PlanType, basePlan: PlanType, trialActive: boolean, trialEndsAt: string | null): CardState {
  if (plan === PLANS.PREMIUM && trialActive && basePlan !== PLANS.PREMIUM) {
    return { kind: "trial_active", daysRemainingLabel: formatTrialDaysRemaining(trialEndsAt) };
  }
  if (plan === basePlan) return { kind: "current" };
  return { kind: "not_current" };
}

function PlanCard({
  plan,
  cycle,
  cardState,
  basePlanName,
  purchaseAvailable,
  hasPaidSubscription,
  currentPlan,
  isTrial,
  purchaseOffer,
  monthlyOffer,
  nativeOffer,
  nativeMode,
  nativeState,
  onNativePurchase,
  platformState,
}: {
  plan: PlanType;
  cycle: BillingCycle;
  cardState: CardState;
  basePlanName: string;
  purchaseAvailable: boolean;
  hasPaidSubscription: boolean;
  /** PLAN-IMPL-06 §25 — params de plan_selected: o plano BASE atual (nunca o efetivo/trial-boosted, §32
   * já usa essa mesma distinção em outro contexto — aqui é só o que "current_plan" honestamente significa). */
  currentPlan: PlanType;
  isTrial: boolean;
  purchaseOffer?: PlanPurchaseAvailabilityEntry;
  monthlyOffer?: PlanPurchaseAvailabilityEntry;
  nativeOffer?: PlayBillingProductOffer;
  nativeMode: boolean;
  nativeState: "idle" | "purchasing" | "pending" | "error";
  onNativePurchase: () => void;
  platformState: "unknown" | "android" | "web" | "error";
}) {
  const [, setLocation] = useLocation();
  const presentation = PLAN_PRESENTATION[plan];
  const price = PLAN_PRICING[plan];
  const offer = purchaseOffer?.offer;
  const savings = cycle === "annual" && monthlyOffer?.offer && offer
    ? Math.round(annualSavings(monthlyOffer.offer.subscribedPriceCents, offer.subscribedPriceCents).percent) : null;

  const isFree = plan === PLANS.FREE;
  const priceValue = offer ? offer.subscribedPriceCents / 100 : price[cycle];
  const displayPrice = nativeOffer?.formattedPrice ?? `R$ ${formatBRL(priceValue)}`;

  // Confirmação mínima antes de chamar o provider. O servidor continua sendo a autoridade de preço; a
  // UI só envia a oferta esperada como condição de consistência para evitar checkout com tela desatualizada.
  const [purchaseState, setPurchaseState] = useState<"idle" | "confirming" | "purchasing" | "error">("idle");
  const [purchaseError, setPurchaseError] = useState("");

  // PLAN-IMPL-06 §25 — plan_selected: o usuário decidiu deliberadamente este plano/CTA (nunca a mera
  // impressão de um card indisponível, §25 — este handler só existe no branch purchaseAvailable true).
  function handleSelectPlan() {
    if (platformState !== "web") return;
    trackAnalyticsEvent("plan_selected", { selected_plan: plan, billing_cycle: cycle, current_plan: currentPlan, is_trial: isTrial });
    setPurchaseState("confirming");
  }

  async function handleConfirmPurchase() {
    if (platformState !== "web") {
      setPurchaseState("idle");
      return;
    }
    setPurchaseState("purchasing");
    setPurchaseError("");
    // PLAN-IMPL-06 §26 — só agora, imediatamente antes de invocar o endpoint real, nunca no clique do
    // CTA "Assinar" (que só abre o painel de confirmação, ainda pode ser cancelado via "Voltar").
    trackAnalyticsEvent("checkout_started", { plan, billing_cycle: cycle, pricing_version: "v2" });
    try {
      const currentOffer = await fetchCurrentPurchaseOffer(plan, cycle);
      if (!currentOffer?.available || !currentOffer.offer) {
        throw new ApiError({ status: 409, code: "PLAN_PURCHASE_UNAVAILABLE", message: "Este plano não está disponível para assinatura agora." });
      }
      const expectedPriceCents = Math.round(priceValue * 100);
      const displayedOfferId = offer?.offerId ?? "standard";
      const offerChanged = currentOffer.offer.offerId !== displayedOfferId
        || currentOffer.offer.subscribedPriceCents !== expectedPriceCents;
      if (offerChanged && !window.confirm(`Preço atualizado: R$ ${formatBRL(currentOffer.offer.subscribedPriceCents / 100)}/${cycle === "annual" ? "ano" : "mês"}. Continuar?`)) {
        setPurchaseState("idle");
        return;
      }
      const data = await apiRequest<{ initPoint?: string; priceCents: number; billingCycle: BillingCycle }>("/api/subscriptions/create", {
        method: "POST",
        auth: true,
        body: {
          plan,
          billingCycle: cycle,
          expectedPricingVersion: currentOffer.offer.pricingVersion,
          expectedOfferId: currentOffer.offer.offerId,
        },
      });
      if (!data.initPoint) throw new Error("Link de checkout não retornado pela API.");
      // PLAN-IMPL-06 §29 — marca a tentativa ANTES do redirect (sobrevive à ida-e-volta ao Mercado
      // Pago); PlanProvider.tsx consome isto para disparar subscription_activated quando a ativação
      // real (assíncrona, via webhook) for observada.
      markPendingSubscriptionActivation(plan, cycle);
      window.location.href = data.initPoint;
    } catch (err) {
      trackAnalyticsEvent("checkout_failed", { plan, reason: toCheckoutFailureReason(err) });
      setPurchaseError(buildApiErrorDisplayMessage(err, "Não foi possível iniciar a assinatura agora. Tente novamente."));
      setPurchaseState("error");
    }
  }

  return (
    <section
      className={`relative rounded-3xl border bg-white p-5 flex flex-col gap-4 ${
        presentation.highlighted ? "border-primary shadow-md ring-1 ring-primary/20" : "border-border/60 shadow-sm"
      }`}
      data-testid={`card-plan-${plan}`}
      aria-labelledby={`plan-title-${plan}`}
    >
      {presentation.badge && (
        <span className="absolute -top-2 left-5 rounded-full bg-primary px-3 py-1 text-[10px] font-black uppercase tracking-widest text-white shadow-sm">
          {presentation.badge}
        </span>
      )}

      <div className="space-y-1">
        <h2 id={`plan-title-${plan}`} className="text-lg font-black text-foreground">{presentation.title}</h2>
        <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide">{presentation.positioning}</p>
      </div>

      <div className="space-y-0.5">
        {isFree ? (
          <p className="text-3xl font-black text-foreground">R$ 0</p>
        ) : (
          <>
            {offer?.offerId === "launch" && (
              <p className="text-xs text-muted-foreground"><s>De R$ {formatBRL(offer.referencePriceCents / 100)}</s> · Preço de lançamento</p>
            )}
            <p className="text-3xl font-black text-foreground">
              {displayPrice}
              <span className="text-sm font-bold text-muted-foreground">{cycle === "annual" ? "/ano" : "/mês"}</span>
            </p>
            {savings !== null && (
              <p className="text-[11px] font-bold text-green-600">Economize {savings}% no anual</p>
            )}
          </>
        )}
      </div>

      <ul className="space-y-2 flex-1">
        {presentation.sellableHighlights.map((highlight) => (
          <li key={highlight} className="flex items-start gap-2 text-sm text-foreground">
            <Check className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />
            <span>{highlight}</span>
          </li>
        ))}
      </ul>

      <div className="pt-1">
        {cardState.kind === "current" && (
          <div className="rounded-2xl bg-primary/10 text-primary text-center py-3 text-xs font-black uppercase tracking-widest" data-testid={`badge-current-plan-${plan}`}>
            Seu plano atual
            {hasPaidSubscription && <p className="text-xs font-normal normal-case">Preços acima são para novas assinaturas. Seu contrato atual permanece preservado.</p>}
          </div>
        )}

        {cardState.kind === "trial_active" && (
          <div className="rounded-2xl bg-amber-50 border border-amber-200 p-3 text-center space-y-1" data-testid={`badge-trial-active-${plan}`}>
            <p className="text-xs font-black text-amber-700 flex items-center justify-center gap-1">
              <Sparkles className="w-3.5 h-3.5" /> Premium de teste ativo
            </p>
            {/* §21 — mesmo contador já usado no banner do dashboard (formatTrialDaysRemaining),
                nunca um segundo cálculo de dias paralelo. */}
            {cardState.daysRemainingLabel && (
              <p className="text-[11px] text-amber-700 font-bold" data-testid={`text-trial-countdown-${plan}`}>{cardState.daysRemainingLabel}</p>
            )}
            <p className="text-[11px] text-amber-600">Seu plano base é {basePlanName}.</p>
            <p className="text-[11px] text-amber-600 font-semibold">Nenhuma cobrança automática ao final.</p>
          </div>
        )}

        {cardState.kind === "not_current" && isFree && (
          <div className="rounded-2xl border border-border/60 text-center py-3 text-xs font-bold text-muted-foreground" data-testid="text-free-always-available">
            Sempre disponível · sem cartão
          </div>
        )}

        {cardState.kind === "not_current" && !isFree && plan === PLANS.PREMIUM && hasPaidSubscription && (
          <button
            type="button"
            onClick={() => setLocation("/subscribe")}
            className="w-full min-h-11 rounded-2xl bg-primary text-white font-black py-3 text-sm active:scale-95 transition-all"
            data-testid={`button-manage-plan-${plan}`}
          >
            Gerenciar assinatura
          </button>
        )}

        {cardState.kind === "not_current" && !isFree && !(plan === PLANS.PREMIUM && hasPaidSubscription) && (
          platformState === "unknown" || platformState === "error" ? (
            <div className="w-full min-h-11 rounded-2xl border border-border/60 text-center py-3 text-xs font-bold text-muted-foreground" data-testid={`text-platform-unavailable-${plan}`}>
              Não foi possível identificar a plataforma de pagamento.
            </div>
          ) : nativeMode ? (
            nativeOffer ? (
              <button type="button" onClick={onNativePurchase} disabled={nativeState === "purchasing"} className="w-full min-h-11 rounded-2xl bg-primary text-white font-black py-3 text-sm disabled:opacity-60" data-testid={`button-play-purchase-${plan}`}>
                {nativeState === "purchasing" ? "Abrindo Google Play…" : nativeState === "pending" ? "Pagamento pendente" : `Assinar ${presentation.title}`}
              </button>
            ) : (
              <div className="w-full min-h-11 rounded-2xl border border-border/60 text-center py-3 text-xs font-bold text-muted-foreground" data-testid={`text-play-unavailable-${plan}`}>Google Play indisponível</div>
            )
          ) : purchaseAvailable ? (
            purchaseState === "confirming" || purchaseState === "purchasing" || purchaseState === "error" ? (
              <div className="rounded-2xl border border-primary/30 bg-primary/5 p-3 space-y-2" data-testid={`panel-confirm-purchase-${plan}`}>
                <p className="text-xs font-bold text-foreground text-center">
                  Confirmar {presentation.title} · R$ {formatBRL(priceValue)}{cycle === "annual" ? "/ano" : "/mês"}
                </p>
                {purchaseError && (
                  <p className="text-[11px] text-red-600 text-center" data-testid={`text-purchase-error-${plan}`}>{purchaseError}</p>
                )}
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => { setPurchaseState("idle"); setPurchaseError(""); }}
                    disabled={purchaseState === "purchasing"}
                    className="flex-1 min-h-11 rounded-xl bg-white border border-border/60 text-foreground font-bold text-xs disabled:opacity-60"
                    data-testid={`button-cancel-purchase-${plan}`}
                  >
                    Voltar
                  </button>
                  <button
                    type="button"
                    onClick={handleConfirmPurchase}
                    disabled={purchaseState === "purchasing"}
                    className="flex-1 min-h-11 rounded-xl bg-primary text-white font-black text-xs disabled:opacity-60 flex items-center justify-center gap-1.5"
                    data-testid={`button-confirm-purchase-${plan}`}
                  >
                    {purchaseState === "purchasing" && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    Confirmar
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={handleSelectPlan}
                className="w-full min-h-11 rounded-2xl bg-primary text-white font-black py-3 text-sm active:scale-95 transition-all"
                data-testid={`button-subscribe-plan-${plan}`}
              >
                Assinar {presentation.title}
              </button>
            )
          ) : (
            <div
              className="w-full min-h-11 rounded-2xl border border-border/60 text-center py-3 text-xs font-bold text-muted-foreground flex items-center justify-center"
              data-testid={`text-unavailable-${plan}`}
            >
              {plan === PLANS.PRO ? "Assinatura em preparação" : "Disponibilidade em preparação"}
            </div>
          )
        )}
      </div>
    </section>
  );
}

export default function Plans() {
  const [, setLocation] = useLocation();
  const { basePlan, activePlan, trial, loading: planLoading, error: planError, planData, refresh } = usePlan();
  const { availability, loading: availabilityLoading } = usePlanPurchaseAvailability();
  const [cycle, setCycle] = useState<BillingCycle>("monthly");
  const [platformState, setPlatformState] = useState<"unknown" | "android" | "web" | "error">("unknown");
  const [playOffers, setPlayOffers] = useState<PlayBillingProductOffer[]>([]);
  const [playState, setPlayState] = useState<"idle" | "purchasing" | "pending" | "error">("idle");
  const [restoreState, setRestoreState] = useState<"idle" | "restoring" | "done" | "error">("idle");

  const resolvePlatform = useCallback(async () => {
    setPlatformState("unknown");
    try {
      const native = await isAndroidNativeApp();
      setPlatformState(native ? "android" : "web");
      if (native) {
        const offers = await getAndroidPlayOffers();
        setPlayOffers(offers);
      }
    } catch {
      setPlayOffers([]);
      setPlatformState("error");
    }
  }, []);

  useEffect(() => {
    void resolvePlatform();
  }, [resolvePlatform]);

  const nativePurchase = async (plan: PlanType) => {
    if (platformState !== "android") return;
    const user = getFirebaseAuth()?.currentUser;
    if (!user || (plan !== PLANS.PRO && plan !== PLANS.PREMIUM)) return;
    setPlayState("purchasing");
    try {
      const result = await purchasePlanViaGooglePlay({ plan, interval: cycle === "annual" ? "yearly" : "monthly", token: await user.getIdToken(), firebaseUid: user.uid });
      if (result.kind === "pending") setPlayState("pending");
      else if (result.kind === "activated") { setPlayState("idle"); await refresh(); }
      else if (result.kind === "cancelled") setPlayState("idle");
      else setPlayState("error");
    } catch { setPlayState("error"); }
  };

  const restorePlay = async () => {
    const user = getFirebaseAuth()?.currentUser;
    if (!user) return;
    setRestoreState("restoring");
    try {
      const result = await restoreAndroidPurchases(await user.getIdToken(), user.uid);
      await refresh();
      setRestoreState(result.some((entry) => entry.premiumActive) ? "done" : "idle");
    } catch { setRestoreState("error"); }
  };

  const managePlay = async () => {
    try { await openAndroidSubscriptionManagement(); } catch { setPlayState("error"); }
  };

  const android = platformState === "android";

  const trialActive = trial?.status === "active";
  const trialJustExpired = trial?.status === "expired";
  const hasPaidSubscription = Boolean((basePlan !== PLANS.FREE || planData?.subscriptionStatus === "pending") && (planData?.subscriptionId || planData?.billingProvider));

  const loading = planLoading || availabilityLoading;

  const basePlanName = useMemo(() => PLAN_CONFIG[basePlan].name, [basePlan]);

  // PLAN-IMPL-06 §24 — dispara quando /plans passa a ser mostrado com sucesso (nunca durante
  // loading/erro) — deps `[loading, planError]` de propósito, nunca os valores do plano em si: uma
  // troca de ciclo (mensal/anual) ou uma atualização de basePlan/activePlan/trialActive em segundo
  // plano não é uma nova "visualização" da página, só a transição loading/erro -> sucesso é.
  useEffect(() => {
    if (loading || planError) return;
    trackAnalyticsEvent("plans_viewed", {
      current_plan: basePlan, effective_plan: activePlan, is_trial: trialActive, source: readPlansSourceFromLocation(),
    });
  }, [loading, planError]);

  if (loading) {
    return (
      <Layout title="Planos">
        <PageSkeleton variant="settings" />
      </Layout>
    );
  }

  if (planError) {
    return (
      <Layout title="Planos">
        <div className="px-6 py-10 flex flex-col items-center justify-center min-h-[80vh] gap-4 text-center">
          <p className="text-sm font-bold text-foreground">Não foi possível carregar as informações do plano.</p>
          <button type="button" onClick={() => refresh()} className="min-h-11 px-6 rounded-2xl bg-primary text-white font-bold text-sm" data-testid="button-retry-plans">
            Tentar novamente
          </button>
        </div>
      </Layout>
    );
  }

  return (
    <Layout title="Planos">
      <div className="px-4 sm:px-6 pt-6 pb-16 max-w-5xl mx-auto space-y-6">
        <header className="text-center space-y-2 max-w-lg mx-auto">
          <h1 className="text-2xl font-black text-foreground">Organize seu negócio e transforme oportunidades em vendas</h1>
          <p className="text-sm text-muted-foreground">Free continua disponível para sempre, sem cartão. Evolua quando fizer sentido para o seu negócio.</p>
        </header>

        {trialJustExpired && (
          <div className="max-w-lg mx-auto rounded-2xl border border-border/60 bg-white p-4 text-center space-y-1" data-testid="card-trial-ended-plans">
            <p className="text-sm font-bold text-foreground">Seu Premium de teste terminou.</p>
            <p className="text-xs text-muted-foreground">Você pode continuar usando o {basePlanName} — seus dados continuam seguros.</p>
          </div>
        )}

        <div className="flex justify-center">
          <div className="inline-flex rounded-2xl border border-border/60 bg-white p-1" role="tablist" aria-label="Ciclo de cobrança">
            {BILLING_CYCLES.map((option) => (
              <button
                key={option}
                type="button"
                role="tab"
                aria-selected={cycle === option}
                onClick={() => setCycle(option)}
                className={`min-h-11 px-5 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${
                  cycle === option ? "bg-primary text-white" : "text-muted-foreground"
                }`}
                data-testid={`button-cycle-${option}`}
              >
                {option === "monthly" ? "Mensal" : "Anual"}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {([PLANS.FREE, PLANS.PRO, PLANS.PREMIUM] as const).map((plan) => (
            <PlanCard
              key={`${plan}-${cycle}`}
              plan={plan}
              cycle={cycle}
              cardState={resolveCardState(plan, basePlan, trialActive, trial?.endsAt ?? null)}
              basePlanName={basePlanName}
              purchaseAvailable={platformState === "web" && plan !== PLANS.FREE && !hasPaidSubscription && (availability?.offers?.[plan]?.[cycle]?.available ?? false)}
              purchaseOffer={platformState === "web" ? (plan === PLANS.FREE ? undefined : availability?.offers?.[plan]?.[cycle]) : undefined}
              monthlyOffer={plan === PLANS.FREE ? undefined : availability?.offers?.[plan]?.monthly}
              nativeMode={android}
              nativeOffer={playOffers.find((entry) => entry.plan === plan && entry.billingCycle === cycle)}
              nativeState={playState}
              onNativePurchase={() => void nativePurchase(plan)}
              platformState={platformState}
              hasPaidSubscription={hasPaidSubscription}
              currentPlan={basePlan}
              isTrial={trialActive}
            />
          ))}
        </div>

        {platformState === "error" && (
          <div className="flex flex-col items-center gap-2 text-center">
            <p className="text-xs text-muted-foreground">Não foi possível identificar a plataforma de pagamento. Tente novamente.</p>
            <button type="button" onClick={() => void resolvePlatform()} className="underline font-semibold text-xs text-muted-foreground" data-testid="button-retry-platform-detection">Tentar novamente</button>
          </div>
        )}

        {android && (
          <div className="flex flex-col sm:flex-row justify-center gap-2 text-center">
            <button type="button" onClick={() => void restorePlay()} disabled={restoreState === "restoring"} className="underline font-semibold text-xs text-muted-foreground disabled:opacity-60" data-testid="button-restore-play">
              {restoreState === "restoring" ? "Restaurando…" : restoreState === "done" ? "Assinatura restaurada" : "Restaurar compras Google Play"}
            </button>
            {planData?.billingProvider === "google_play" && (
              <button type="button" onClick={() => void managePlay()} className="underline font-semibold text-xs text-muted-foreground" data-testid="button-manage-play">Gerenciar no Google Play</button>
            )}
          </div>
        )}

        {!android && hasPaidSubscription && (
          <p className="text-center text-xs text-muted-foreground">
            <button type="button" onClick={() => setLocation("/subscribe")} className="underline font-semibold" data-testid="link-manage-subscription-footer">
              Gerenciar ou cancelar assinatura
            </button>
          </p>
        )}
      </div>
    </Layout>
  );
}
