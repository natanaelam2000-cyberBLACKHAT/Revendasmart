import { useEffect } from "react";
import { AlertCircle } from "lucide-react";
import { useLocation } from "wouter";
import { PLAN_PRESENTATION, type PlanType } from "@shared/monetization";
import { buildLimitReachedCopy, type PaywallResource } from "@/lib/plan-paywall-copy";
import { trackAnalyticsEvent, type AnalyticsPaywallReason, type AnalyticsSource } from "@/lib/firebase";

/** PLAN-IMPL-06 §21/§47 — mesmo domínio de recurso já usado pela cópia (PaywallResource), mapeado para
 * os enums fechados de analytics — nunca uma string solta montada em cada call site. */
const RESOURCE_TO_PAYWALL_REASON: Record<PaywallResource, AnalyticsPaywallReason> = {
  products: "product_limit",
  clients: "client_limit",
  services: "service_limit",
  bookings: "booking_limit",
  adsProPreparations: "ads_pro_preparation_limit",
};
const RESOURCE_TO_SOURCE: Record<PaywallResource, AnalyticsSource> = {
  products: "product_limit",
  clients: "client_limit",
  // §47 — sem UI real de criação de Service (PW2, PLAN-IMPL-04A/05): nunca alcançado na prática. "direct"
  // é o fallback neutro já existente no enum, nunca um valor que fingiria uma origem que não existe.
  services: "direct",
  bookings: "booking_limit",
  adsProPreparations: "ads_pro_preparation_limit",
};

/**
 * PLAN-IMPL-04A §23/§25/§27/§28/§32 — componente ÚNICO para "limite de criação atingido", full-page.
 * Substitui os modais que `add-product.tsx` e `clients.tsx` tinham cada um o seu (mesmo layout, textos
 * diferentes e ambos desatualizados — "ilimitados", upgrade direto pra Premium, CTA para o checkout
 * legado) e cobre Services, que não tinha nenhum. Nunca decide sozinho SE o limite foi atingido — quem
 * chama só renderiza isto depois que o servidor já recusou a criação (§24 — paywall nunca é a
 * autoridade, só a superfície).
 */
export function PlanLimitPrompt({
  resource,
  currentPlan,
  usedOverride,
  onClose,
}: {
  resource: PaywallResource;
  currentPlan: PlanType;
  /** §32 — só quando o bloqueio vem de um downgrade (já existem mais itens que o novo teto), não de uma
   * tentativa de criação nova. */
  usedOverride?: number;
  onClose: () => void;
}) {
  const [, setLocation] = useLocation();
  const copy = buildLimitReachedCopy(resource, currentPlan, usedOverride);
  const reason = RESOURCE_TO_PAYWALL_REASON[resource];
  const source = RESOURCE_TO_SOURCE[resource];

  // PLAN-IMPL-06 §22 — este componente só existe no DOM enquanto o paywall deve estar visível (quem
  // chama monta/desmonta condicionalmente, nunca o mantém oculto via CSS) — `useEffect` com deps vazias
  // dispara exatamente uma vez por montagem real, nunca a cada re-render de uma instância já visível.
  useEffect(() => {
    trackAnalyticsEvent("paywall_viewed", {
      reason, resource_type: resource, source, current_plan: currentPlan,
      ...(copy.recommendedPlan ? { recommended_plan: copy.recommendedPlan } : {}),
    });
  }, []);

  const handleCtaClick = () => {
    trackAnalyticsEvent("paywall_cta_clicked", {
      reason, resource_type: resource, source, current_plan: currentPlan,
      ...(copy.recommendedPlan ? { recommended_plan: copy.recommendedPlan } : {}),
    });
    // PLAN-IMPL-06 §46 — propaga a MESMA source do clique até plans_viewed, para o funil
    // paywall_viewed -> paywall_cta_clicked -> plans_viewed manter um `source` consistente ponta a ponta.
    setLocation(`/plans?source=${source}`);
  };

  return (
    <div className="px-6 py-8 flex flex-col items-center justify-center min-h-screen gap-6">
      <div className="w-20 h-20 bg-amber-100 rounded-full flex items-center justify-center">
        <AlertCircle className="w-12 h-12 text-amber-600" />
      </div>

      <div className="text-center space-y-3">
        <h2 className="text-2xl font-bold text-foreground" data-testid="text-plan-limit-title">{copy.title}</h2>
        {copy.benefitLine && (
          <p className="text-sm text-muted-foreground" data-testid="text-plan-limit-benefit">{copy.benefitLine}</p>
        )}
      </div>

      {copy.recommendedPlan && (
        <div className="bg-blue-50 border border-blue-200 rounded-3xl p-4 w-full space-y-2">
          <p className="text-xs text-blue-700 font-bold">
            {PLAN_PRESENTATION[copy.recommendedPlan].title} inclui:
          </p>
          <ul className="text-xs text-blue-600 space-y-1 list-disc list-inside">
            {PLAN_PRESENTATION[copy.recommendedPlan].sellableHighlights.slice(0, 4).map((highlight) => (
              <li key={highlight}>{highlight}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex gap-3 w-full">
        <button
          onClick={onClose}
          className="flex-1 bg-secondary text-foreground font-bold py-3 rounded-xl"
          data-testid="button-close-limit-modal"
        >
          Entendi
        </button>
        <button
          onClick={handleCtaClick}
          className="flex-1 bg-primary text-white font-bold py-3 rounded-xl"
          data-testid="button-plan-limit-cta"
        >
          {copy.ctaLabel}
        </button>
      </div>
    </div>
  );
}
