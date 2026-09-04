import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Sparkles, Users, Package, CalendarClock, ArrowRight, Lock } from "lucide-react";
import { Layout } from "@/components/layout";
import { PageSkeleton } from "@/components/PageSkeleton";
import { EmptyState } from "@/components/EmptyState";
import { usePlan } from "@/providers/PlanProvider";
import { fetchOpportunities } from "@/lib/opportunities-client";
import { resolveOpportunityActionRoute } from "@/lib/opportunity-actions";
import { trackAnalyticsEvent } from "@/lib/firebase";
import type { PlanType } from "@shared/monetization";
import type { Opportunity, OpportunityType } from "@shared/opportunity-rules";

/**
 * PLAN-IMPL-07A §34 — rota canônica única desta engine (nenhuma /intelligence ou /tasks paralela).
 * §33 — página dedicada e pesada fica FORA do dashboard (lazy, só carrega quando visitada); o dashboard
 * continua só com o cartão "Prioridades" leve já existente (home-dashboard-view-model.ts, inalterado).
 * §22/§23 — entitlement é sempre revalidado pelo servidor (opportunity-engine.ts); esta página só decide
 * SE chama a API com base em usePlan() (evita uma chamada/403 previsível no caminho comum), nunca
 * computa o resultado real e o esconde depois — quem não tem acesso nunca recebe a lista.
 */

const TYPE_ICON: Record<OpportunityType, typeof Users> = {
  inactive_client: Users,
  stalled_product: Package,
  idle_schedule: CalendarClock,
};

const TYPE_LABEL: Record<OpportunityType, string> = {
  inactive_client: "Cliente inativo",
  stalled_product: "Produto parado",
  idle_schedule: "Agenda ociosa",
};

function OpportunityCard({ opportunity }: { opportunity: Opportunity }) {
  const [, setLocation] = useLocation();
  const Icon = TYPE_ICON[opportunity.type];
  const isHigh = opportunity.priority === "high";
  return (
    <div className="rounded-2xl border border-border/60 bg-white p-4 space-y-3" data-testid={`card-opportunity-${opportunity.id}`}>
      <div className="flex items-start gap-3">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${isHigh ? "bg-red-100 text-red-600" : "bg-amber-100 text-amber-600"}`}>
          <Icon className="w-5 h-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">{TYPE_LABEL[opportunity.type]}</p>
            {isHigh && <span className="text-[9px] font-black uppercase tracking-wide text-red-600 bg-red-50 px-1.5 py-0.5 rounded-full">Prioridade alta</span>}
          </div>
          <p className="font-bold text-foreground truncate">{opportunity.entityReference.name}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{opportunity.reason}</p>
        </div>
      </div>
      <button
        type="button"
        onClick={() => setLocation(resolveOpportunityActionRoute(opportunity.action.type, opportunity.entityReference))}
        className="w-full flex items-center justify-center gap-1.5 rounded-xl bg-primary/10 text-primary text-xs font-black py-2.5 active:scale-95 transition-all"
        data-testid={`button-opportunity-action-${opportunity.id}`}
      >
        {opportunity.action.label}
        <ArrowRight className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

// PLAN-IMPL-08 §34/§35 — mesmo padrão de reports.tsx's UpgradeTeaser: view uma vez por montagem real.
function PremiumUpsell({ currentPlan }: { currentPlan: PlanType }) {
  const [, setLocation] = useLocation();
  useEffect(() => {
    trackAnalyticsEvent("house_promotion_viewed", { promotion_id: "opportunities_premium_upgrade", placement: "opportunities", current_plan: currentPlan, recommended_plan: "premium" });
  }, []);
  const handleClick = () => {
    trackAnalyticsEvent("house_promotion_clicked", { promotion_id: "opportunities_premium_upgrade", placement: "opportunities", current_plan: currentPlan, recommended_plan: "premium" });
    setLocation("/plans");
  };
  return (
    <EmptyState
      icon={<Lock className="w-10 h-10 text-primary/60" />}
      title="Oportunidades é um recurso Premium"
      // §23/§36 — nunca promete IA/previsão/receita garantida; só o que este runtime de fato entrega.
      description="Encontre automaticamente clientes inativos, produtos parados e horários ociosos na sua agenda no plano Premium."
      action={
        <button
          type="button"
          onClick={handleClick}
          className="w-full rounded-xl bg-primary text-white text-xs font-black py-2.5 active:scale-95 transition-all"
          data-testid="button-opportunities-upgrade"
        >
          Conhecer o Premium
        </button>
      }
    />
  );
}

export default function Opportunities() {
  const { activePlan, hasPremiumAccess, loading: planLoading } = usePlan();
  const [opportunities, setOpportunities] = useState<Opportunity[] | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (planLoading) return;
    if (!hasPremiumAccess) { setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    setError(false);
    fetchOpportunities()
      .then((result) => { if (!cancelled) setOpportunities(result.opportunities); })
      .catch(() => { if (!cancelled) setError(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [planLoading, hasPremiumAccess]);

  return (
    <Layout title="Oportunidades">
      <div className="px-4 py-4 space-y-4 max-w-2xl mx-auto" data-testid="page-opportunities">
        {planLoading || loading ? (
          <PageSkeleton variant="list" count={4} />
        ) : !hasPremiumAccess ? (
          <PremiumUpsell currentPlan={activePlan} />
        ) : error ? (
          <EmptyState
            icon={<Sparkles className="w-10 h-10 text-muted-foreground/40" />}
            title="Não foi possível carregar agora"
            description="Tente novamente em instantes."
          />
        ) : !opportunities || opportunities.length === 0 ? (
          <EmptyState
            icon={<Sparkles className="w-10 h-10 text-emerald-500/60" />}
            title="Nenhuma oportunidade prioritária encontrada agora"
            description="Assim que uma condição real do seu negócio pedir atenção — cliente sem comprar, produto parado ou agenda livre — ela aparece aqui."
          />
        ) : (
          <div className="space-y-3">
            {opportunities.map((opportunity) => (
              <OpportunityCard key={opportunity.id} opportunity={opportunity} />
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}
