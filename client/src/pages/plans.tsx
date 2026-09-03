import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { Check, Sparkles, Loader2 } from "lucide-react";
import { Layout } from "@/components/layout";
import { PageSkeleton } from "@/components/PageSkeleton";
import { usePlan } from "@/providers/PlanProvider";
import { usePlanPurchaseAvailability } from "@/hooks/usePlanPurchaseAvailability";
import { formatTrialDaysRemaining } from "@/lib/plan-helpers";
import { apiRequest, buildApiErrorDisplayMessage } from "@/lib/api-client";
import { PLANS, PLAN_CONFIG, PLAN_PRESENTATION, PLAN_PRICING, type PlanType } from "@shared/monetization";

/**
 * PLAN-IMPL-04A §10-§22 — a experiência comercial principal de planos: comparação Free/Pro/Premium,
 * plano atual (base — trial nunca aparece como "seu plano" real, §20), trial ativo com contador
 * (§21), CTA por disponibilidade real de compra (nunca hardcoded por componente, §15), sem nenhuma
 * promessa de recurso ainda não implementado (§7 — só consome PLAN_PRESENTATION.sellableHighlights,
 * nunca PLAN_CONFIG[plan].features, que é a lista mais antiga e mais otimista).
 */

const BILLING_CYCLES = ["monthly", "annual"] as const;
type BillingCycle = typeof BILLING_CYCLES[number];

function formatBRL(value: number): string {
  return value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** §45 — economia anual derivada só da tabela canônica, nunca um número guardado à parte. */
function annualSavingsPercent(plan: PlanType): number | null {
  const { monthly, annual } = PLAN_PRICING[plan];
  if (monthly <= 0 || annual <= 0) return null;
  const fullYear = monthly * 12;
  if (annual >= fullYear) return null;
  return Math.round((1 - annual / fullYear) * 100);
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
}: {
  plan: PlanType;
  cycle: BillingCycle;
  cardState: CardState;
  basePlanName: string;
  purchaseAvailable: boolean;
  hasPaidSubscription: boolean;
}) {
  const [, setLocation] = useLocation();
  const presentation = PLAN_PRESENTATION[plan];
  const price = PLAN_PRICING[plan];
  const savings = cycle === "annual" ? annualSavingsPercent(plan) : null;

  const isFree = plan === PLANS.FREE;
  const priceValue = cycle === "annual" ? price.annual : price.monthly;

  // PLAN-IMPL-04B §14/§34 — confirmação mínima (plano/cadência/preço) antes de chamar o endpoint real,
  // nunca um checkout disparado direto no primeiro clique. `billingCycle` sempre "monthly" no corpo da
  // requisição: anual nunca tem disponibilidade real (§29), então nunca chega a esta função com cycle
  // "annual" e purchaseAvailable true ao mesmo tempo — mas o servidor também recusa por conta própria
  // (§10), então esta tela nunca é a única linha de defesa.
  const [purchaseState, setPurchaseState] = useState<"idle" | "confirming" | "purchasing" | "error">("idle");
  const [purchaseError, setPurchaseError] = useState("");

  async function handleConfirmPurchase() {
    setPurchaseState("purchasing");
    setPurchaseError("");
    try {
      const data = await apiRequest<{ initPoint?: string }>("/api/subscriptions/create", {
        method: "POST",
        auth: true,
        body: { plan, billingCycle: "monthly" },
      });
      if (!data.initPoint) throw new Error("Link de checkout não retornado pela API.");
      window.location.href = data.initPoint;
    } catch (err) {
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
            <p className="text-3xl font-black text-foreground">
              R$ {formatBRL(priceValue)}
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
          purchaseAvailable ? (
            purchaseState === "confirming" || purchaseState === "purchasing" || purchaseState === "error" ? (
              <div className="rounded-2xl border border-primary/30 bg-primary/5 p-3 space-y-2" data-testid={`panel-confirm-purchase-${plan}`}>
                <p className="text-xs font-bold text-foreground text-center">
                  Confirmar {presentation.title} · R$ {formatBRL(price.monthly)}/mês
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
                onClick={() => setPurchaseState("confirming")}
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
  const { basePlan, trial, loading: planLoading, error: planError, planData, refresh } = usePlan();
  const { availability, loading: availabilityLoading } = usePlanPurchaseAvailability();
  const [cycle, setCycle] = useState<BillingCycle>("monthly");

  const trialActive = trial?.status === "active";
  const trialJustExpired = trial?.status === "expired";
  const hasPaidSubscription = Boolean(planData?.subscriptionId || planData?.billingProvider);

  const loading = planLoading || availabilityLoading;

  const basePlanName = useMemo(() => PLAN_CONFIG[basePlan].name, [basePlan]);

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
              key={plan}
              plan={plan}
              cycle={cycle}
              cardState={resolveCardState(plan, basePlan, trialActive, trial?.endsAt ?? null)}
              basePlanName={basePlanName}
              purchaseAvailable={plan === PLANS.PRO ? (availability?.pro.available ?? false) : plan === PLANS.PREMIUM ? (availability?.premium.available ?? false) : true}
              hasPaidSubscription={hasPaidSubscription}
            />
          ))}
        </div>

        {hasPaidSubscription && basePlan === PLANS.PREMIUM && (
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
