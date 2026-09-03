import { AlertCircle } from "lucide-react";
import { useLocation } from "wouter";
import { PLAN_PRESENTATION, type PlanType } from "@shared/monetization";
import { buildLimitReachedCopy, type PaywallResource } from "@/lib/plan-paywall-copy";

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
          onClick={() => setLocation("/plans")}
          className="flex-1 bg-primary text-white font-bold py-3 rounded-xl"
          data-testid="button-plan-limit-cta"
        >
          {copy.ctaLabel}
        </button>
      </div>
    </div>
  );
}
