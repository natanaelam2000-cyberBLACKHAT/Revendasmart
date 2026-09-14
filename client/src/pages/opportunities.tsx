import { useCallback, useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Sparkles, Users, Package, CalendarClock, Receipt, ArrowRight, Lock, Check, X as XIcon, History as HistoryIcon } from "lucide-react";
import { Layout } from "@/components/layout";
import { PageSkeleton } from "@/components/PageSkeleton";
import { EmptyState } from "@/components/EmptyState";
import { usePlan } from "@/providers/PlanProvider";
import { fetchOpportunities, fetchOpportunityHistory, markOpportunityAction } from "@/lib/opportunities-client";
import { resolveOpportunityActionRoute } from "@/lib/opportunity-actions";
import { trackAnalyticsEvent } from "@/lib/firebase";
import { notifyError, notifySuccess } from "@/lib/notify";
import type { PlanType } from "@shared/monetization";
import type { Opportunity, OpportunityActionRecord, OpportunityActionStatus, OpportunityType } from "@shared/opportunity-rules";

/**
 * PLAN-IMPL-07A §34 — rota canônica única desta engine (nenhuma /intelligence ou /tasks paralela).
 * §33 — página dedicada e pesada fica FORA do dashboard (lazy, só carrega quando visitada); o dashboard
 * continua só com o cartão "Prioridades" leve já existente (home-dashboard-view-model.ts, inalterado).
 * §22/§23 — entitlement é sempre revalidado pelo servidor (opportunity-engine.ts); esta página só decide
 * SE chama a API com base em usePlan() (evita uma chamada/403 previsível no caminho comum), nunca
 * computa o resultado real e o esconde depois — quem não tem acesso nunca recebe a lista.
 *
 * PRODUCT-GROWTH-05 — adiciona o lifecycle (marcar feito/dispensar) e a aba Histórico. Mark-acted/Dismiss
 * SÓ acontecem por clique explícito nesses dois botões (§8: nunca automático por abrir a página/clicar no
 * CTA principal) — o CTA principal (§8/§9) continua abrindo a rota real do tipo, sem marcar nada sozinho.
 */

const TYPE_ICON: Record<OpportunityType, typeof Users> = {
  inactive_client: Users,
  stalled_product: Package,
  idle_schedule: CalendarClock,
  overdue_receivable: Receipt,
};

const TYPE_LABEL: Record<OpportunityType, string> = {
  inactive_client: "Cliente inativo",
  stalled_product: "Produto parado",
  idle_schedule: "Agenda ociosa",
  overdue_receivable: "Parcela em atraso",
};

function formatHistoryDate(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  return new Date(ms).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

interface OpportunityCardProps {
  opportunity: Opportunity;
  pending: boolean;
  onAct: (opportunity: Opportunity) => void;
  onDismiss: (opportunity: Opportunity) => void;
}

function OpportunityCard({ opportunity, pending, onAct, onDismiss }: OpportunityCardProps) {
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
      {/* PRODUCT-GROWTH-05 §8 — ações de lifecycle, separadas do CTA comercial acima: só disparam por
          clique explícito aqui, nunca como efeito colateral do CTA principal. */}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => onAct(opportunity)}
          className="flex-1 flex items-center justify-center gap-1.5 rounded-xl bg-emerald-50 text-emerald-700 text-[11px] font-bold py-2 active:scale-95 transition-all disabled:opacity-50"
          data-testid={`button-opportunity-mark-acted-${opportunity.id}`}
        >
          <Check className="w-3.5 h-3.5" />
          Marcar como feito
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => onDismiss(opportunity)}
          className="flex-1 flex items-center justify-center gap-1.5 rounded-xl bg-secondary text-muted-foreground text-[11px] font-bold py-2 active:scale-95 transition-all disabled:opacity-50"
          data-testid={`button-opportunity-dismiss-${opportunity.id}`}
        >
          <XIcon className="w-3.5 h-3.5" />
          Dispensar
        </button>
      </div>
    </div>
  );
}

function HistoryItemCard({ item }: { item: OpportunityActionRecord }) {
  const Icon = TYPE_ICON[item.opportunityType] ?? Sparkles;
  const isActed = item.status === "acted";
  const dateIso = isActed ? item.actedAt : item.dismissedAt;
  return (
    <div className="rounded-2xl border border-border/60 bg-white p-4" data-testid={`card-history-${item.fingerprint}`}>
      <div className="flex items-start gap-3">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${isActed ? "bg-emerald-100 text-emerald-600" : "bg-secondary text-muted-foreground"}`}>
          <Icon className="w-5 h-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">{TYPE_LABEL[item.opportunityType] ?? item.opportunityType}</p>
            <span className={`text-[9px] font-black uppercase tracking-wide px-1.5 py-0.5 rounded-full ${isActed ? "text-emerald-700 bg-emerald-50" : "text-muted-foreground bg-secondary"}`}>
              {isActed ? "Feito" : "Dispensada"}
            </span>
          </div>
          <p className="font-bold text-foreground truncate">{item.title}</p>
          {item.reasonSnapshot && <p className="text-xs text-muted-foreground mt-0.5">{item.reasonSnapshot}</p>}
          {dateIso && <p className="text-[10px] text-muted-foreground/70 mt-1">{formatHistoryDate(dateIso)}</p>}
        </div>
      </div>
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
      description="Encontre automaticamente clientes inativos, produtos parados, parcelas em atraso e horários ociosos na sua agenda no plano Premium."
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

type ViewTab = "active" | "history";

export default function Opportunities() {
  const { activePlan, hasPremiumAccess, loading: planLoading, planResolved } = usePlan();
  const [tab, setTab] = useState<ViewTab>("active");
  const [opportunities, setOpportunities] = useState<Opportunity[] | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [reloadToken, setReloadToken] = useState(0);
  const [history, setHistory] = useState<OpportunityActionRecord[] | null>(null);
  const [historyError, setHistoryError] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyReloadToken, setHistoryReloadToken] = useState(0);
  // PRODUCT-GROWTH-05 §9 — impede double-submit: um fingerprint em voo desabilita os dois botões daquele
  // card específico, nunca a página inteira (outros cards continuam acionáveis).
  const [pendingFingerprints, setPendingFingerprints] = useState<Set<string>>(new Set());

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
  }, [planLoading, hasPremiumAccess, reloadToken]);

  useEffect(() => {
    if (tab !== "history" || planLoading || !hasPremiumAccess) return;
    let cancelled = false;
    setHistoryLoading(true);
    setHistoryError(false);
    fetchOpportunityHistory()
      .then((result) => { if (!cancelled) setHistory(result.items); })
      .catch(() => { if (!cancelled) setHistoryError(true); })
      .finally(() => { if (!cancelled) setHistoryLoading(false); });
    return () => { cancelled = true; };
  }, [tab, planLoading, hasPremiumAccess, historyReloadToken]);

  const handleLifecycleAction = useCallback((opportunity: Opportunity, status: OpportunityActionStatus) => {
    if (pendingFingerprints.has(opportunity.fingerprint)) return;
    setPendingFingerprints((prev) => new Set(prev).add(opportunity.fingerprint));
    markOpportunityAction(opportunity.fingerprint, status, {
      type: opportunity.type,
      reason: opportunity.reason,
      title: opportunity.entityReference.name,
    })
      .then(() => {
        // §9 — atualiza a lista sem recarregar a página inteira; a próxima visita ao Histórico busca de
        // novo do zero (historyReloadToken), nunca reaproveita um cache potencialmente desatualizado.
        setOpportunities((prev) => (prev ? prev.filter((item) => item.fingerprint !== opportunity.fingerprint) : prev));
        setHistory(null);
        notifySuccess(status === "acted" ? "Marcado como feito." : "Oportunidade dispensada.");
      })
      .catch((err) => {
        notifyError(err instanceof Error && err.message ? err.message : "Não foi possível concluir. Tente novamente.");
      })
      .finally(() => {
        setPendingFingerprints((prev) => {
          const next = new Set(prev);
          next.delete(opportunity.fingerprint);
          return next;
        });
      });
  }, [pendingFingerprints]);

  const handleAct = useCallback((opportunity: Opportunity) => handleLifecycleAction(opportunity, "acted"), [handleLifecycleAction]);
  const handleDismiss = useCallback((opportunity: Opportunity) => handleLifecycleAction(opportunity, "dismissed"), [handleLifecycleAction]);

  const activeTabButton = (
    <button
      type="button"
      onClick={() => setTab("active")}
      className={`flex-1 py-2.5 rounded-2xl text-xs font-semibold transition-all ${tab === "active" ? "bg-primary text-white shadow-sm" : "bg-secondary text-muted-foreground"}`}
      data-testid="tab-opportunities-active"
    >
      Ativas
    </button>
  );
  const historyTabButton = (
    <button
      type="button"
      onClick={() => setTab("history")}
      className={`flex-1 py-2.5 rounded-2xl text-xs font-semibold transition-all ${tab === "history" ? "bg-primary text-white shadow-sm" : "bg-secondary text-muted-foreground"}`}
      data-testid="tab-opportunities-history"
    >
      Histórico
    </button>
  );

  return (
    <Layout title="Oportunidades">
      <div className="px-4 py-4 space-y-4 max-w-2xl mx-auto" data-testid="page-opportunities">
        {planLoading ? (
          <PageSkeleton variant="list" count={4} />
        ) : !planResolved ? (
          // PLAN-IMPL-08-VERIFY-FINAL §3/§6 — erro real de usePlan() (loading já terminou, mas o plano
          // não pôde ser confirmado): nunca mostra PremiumUpsell (anunciaria upgrade para um pagante real
          // durante uma falha transitória) nem cai no ramo "nenhuma oportunidade encontrada" abaixo (que
          // mentiria — o motivo é falha de rede, não ausência real de oportunidades). Mesmo placeholder
          // neutro do estado de loading — do ponto de vista do usuário, "ainda não sabemos" é a mesma
          // coisa nos dois casos.
          <PageSkeleton variant="list" count={4} />
        ) : !hasPremiumAccess ? (
          <PremiumUpsell currentPlan={activePlan} />
        ) : (
          <>
            <div className="flex gap-2">
              {activeTabButton}
              {historyTabButton}
            </div>
            {tab === "active" ? (
              loading ? (
                <PageSkeleton variant="list" count={4} />
              ) : error ? (
                <EmptyState
                  icon={<Sparkles className="w-10 h-10 text-muted-foreground/40" />}
                  title="Não foi possível carregar agora"
                  description="Tente novamente em instantes."
                  action={
                    <button type="button" onClick={() => setReloadToken((n) => n + 1)} className="w-full rounded-xl bg-primary/10 text-primary text-xs font-black py-2.5 active:scale-95 transition-all" data-testid="button-opportunities-retry">
                      Tentar novamente
                    </button>
                  }
                />
              ) : !opportunities || opportunities.length === 0 ? (
                <EmptyState
                  icon={<Sparkles className="w-10 h-10 text-emerald-500/60" />}
                  title="Nenhuma oportunidade prioritária encontrada agora"
                  description="Assim que uma condição real do seu negócio pedir atenção — cliente sem comprar, produto parado, parcela vencida ou agenda livre — ela aparece aqui."
                />
              ) : (
                <div className="space-y-3">
                  {opportunities.map((opportunity) => (
                    <OpportunityCard
                      key={opportunity.id}
                      opportunity={opportunity}
                      pending={pendingFingerprints.has(opportunity.fingerprint)}
                      onAct={handleAct}
                      onDismiss={handleDismiss}
                    />
                  ))}
                </div>
              )
            ) : historyLoading ? (
              <PageSkeleton variant="list" count={3} />
            ) : historyError ? (
              <EmptyState
                icon={<HistoryIcon className="w-10 h-10 text-muted-foreground/40" />}
                title="Não foi possível carregar o histórico"
                description="Tente novamente em instantes."
                action={
                  <button type="button" onClick={() => setHistoryReloadToken((n) => n + 1)} className="w-full rounded-xl bg-primary/10 text-primary text-xs font-black py-2.5 active:scale-95 transition-all" data-testid="button-opportunities-history-retry">
                    Tentar novamente
                  </button>
                }
              />
            ) : !history || history.length === 0 ? (
              <EmptyState
                icon={<HistoryIcon className="w-10 h-10 text-muted-foreground/40" />}
                title="Nenhuma ação registrada ainda"
                description="Oportunidades marcadas como feitas ou dispensadas aparecem aqui."
              />
            ) : (
              <div className="space-y-3">
                {history.map((item) => (
                  <HistoryItemCard key={item.fingerprint} item={item} />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </Layout>
  );
}
