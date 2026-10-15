import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { ArrowRight, CheckCircle2, Edit3, LineChart, Sparkles, Target, X } from "lucide-react";
import { LocalErrorBoundary } from "@/components/LocalErrorBoundary";
import { PageSkeleton } from "@/components/PageSkeleton";
import { Layout } from "@/components/layout";
import { SectionCard, SummaryTile, EmptyState, shortNumber } from "@/components/dashboard/dashboard-ui";
import { useClientsLiteData } from "@/hooks/useClientsLiteData";
import { useProductsData } from "@/hooks/useProductsData";
import { useSalesData } from "@/hooks/useSalesData";
import { buildHomeDashboardViewModel, formatHomeCurrency } from "@/lib/home-dashboard-view-model";
import { useUserSettings } from "@/providers/UserSettingsProvider";
import { usePlan } from "@/providers/PlanProvider";
import { runSaveMonthlyGoal, readOnboardingStripDismissed, writeOnboardingStripDismissed } from "@/lib/dashboard-helpers";

export function countDashboardPendingConfigurationSteps(input: {
  businessMode: "products" | "services" | "both" | null;
  settings: Record<string, any>;
  productsCount: number;
  salesCount: number;
  servicesCount: number;
  clientsCount: number;
}): number {
  const p = input.businessMode === "products" || input.businessMode === "both",
    s = input.businessMode === "services" || input.businessMode === "both",
    st = input.settings || {};
  return [
    !st.appTheme && !st.onboarding_theme_selected,
    !st.businessType,
    !st.storeName || String(st.storeName).trim() === "Minha loja",
    ...(p ? [!input.productsCount, !input.salesCount, st.enablePublicCatalog === false || (!st.catalogSlug && !st.catalog_slug)] : []),
    ...(s ? [!input.servicesCount] : []),
    !input.clientsCount,
  ].filter(Boolean).length;
}

export function resolveDashboardDataError(needsProductData: boolean, productsError?: string, salesError?: string, clientsError?: string): string | undefined {
  return (needsProductData ? productsError || salesError : undefined) || clientsError;
}

export function dashboardBusinessLabel(mode: "products" | "services" | "both" | null): "seu negócio" | "sua loja" {
  return mode === "services" ? "seu negócio" : "sua loja";
}

const TodayPriorities = lazy(() => import("@/components/opportunities/TodayPriorities"));
// HOTFIX-P0-D (rodada 2, code-split) — ver client/src/components/dashboard/ServicesOverviewSection.tsx:
// extraído para um arquivo próprio, carregado sob demanda, porque o tamanho desta página passou do teto
// de performance definido em scripts/performance. Quem vende só produto (a maioria) nunca baixa esse
// código, já que o <Suspense> abaixo só monta com needsServicesCount.
// O mesmo import() alimenta a seção e a contagem de serviços: um único chunk, baixado uma vez.
const loadServicesOverview = () => import("@/components/dashboard/ServicesOverviewSection");
const ServicesOverviewSection = lazy(loadServicesOverview);
const TrialBanner = lazy(() => import("@/components/dashboard/TrialBanner"));

// Shared presentation tokens keep repeated actions and supporting text consistent.
const primaryActionClassName = "rounded-2xl bg-primary px-4 py-3 text-xs font-black text-white";
const supportingTextClassName = "text-xs text-muted-foreground";
const focusRingClassName = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30";

export default function Dashboard() {
  const [, setLocation] = useLocation();
  const { onboarding_completed, loading: settingsLoading, settings, businessModeResolution, refresh: refreshSettings, userId } = useUserSettings();
  const { trial, hasPremiumAccess, loading: planLoading, planResolved } = usePlan();
  const resolvedBusinessMode = businessModeResolution.resolved ? businessModeResolution.mode : null;
  const needsProductData = resolvedBusinessMode === "products" || resolvedBusinessMode === "both";
  const { products, loading: productsLoading, error: productsError } = useProductsData({ enabled: needsProductData });
  const { sales, loading: salesLoading, error: salesError } = useSalesData({ enabled: needsProductData });
  const { clients, loading: clientsLoading, error: clientsError } = useClientsLiteData();
  const [isGoalEditorOpen, setIsGoalEditorOpen] = useState(false);
  const [monthlyGoalInput, setMonthlyGoalInput] = useState("");
  const [isSavingGoal, setIsSavingGoal] = useState(false);
  const [isOnboardingStripDismissed, setIsOnboardingStripDismissed] = useState(readOnboardingStripDismissed);

  // PLAN-IMPL-09-FINAL §31/§32 — só busca serviços quando o modo do negócio realmente usa esse dado
  // (evita uma leitura Firestore extra, sempre vazia, para a maioria dos donos que vende só produto).
  const needsServicesCount = resolvedBusinessMode === "services" || resolvedBusinessMode === "both";
  const [servicesCount, setServicesCount] = useState(0);
  const [servicesLoading, setServicesLoading] = useState(needsServicesCount);
  useEffect(() => {
    if (!needsServicesCount) return;
    let cancelled = false;
    setServicesLoading(true);
    // PRODUCT-QA-02 — mesmo motivo de service-agenda.tsx: sem esperar o Firebase Auth confirmar a sessão
    // restaurada primeiro, uma carga completa da página (não só troca de rota via SPA) podia disparar
    // listServices() antes do uid existir e lançar UNAUTHENTICATED, sem nenhum tratamento aqui além do
    // catch silencioso — nunca reproduzido antes porque o dashboard normalmente só é alcançado após um
    // login recém-concluído (uid já em memória), não numa carga fria direta.
    loadServicesOverview()
      .then((m) => m.fetchDashboardServicesCount())
      .then((count) => { if (!cancelled) setServicesCount(count); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setServicesLoading(false); });
    return () => { cancelled = true; };
  }, [needsServicesCount]);

  const dataLoading = productsLoading || salesLoading || clientsLoading || servicesLoading;
  const dataError = resolveDashboardDataError(needsProductData, productsError, salesError, clientsError);
  const home = useMemo(
    () => buildHomeDashboardViewModel({ products, clients, sales, settings: settings as any, servicesCount }),
    [clients, products, sales, settings, servicesCount],
  );
  const { summary, goal, priorities, hiddenPriorityCount, showProductMetrics, mainInsight: insight } = home;

  useEffect(() => {
    setMonthlyGoalInput(goal.hasExplicitGoal ? String(goal.target) : "");
  }, [goal.hasExplicitGoal, goal.target]);

  const pendingConfigurationSteps = countDashboardPendingConfigurationSteps({
    businessMode: resolvedBusinessMode,
    settings: settings as Record<string, any>,
    productsCount: products.length,
    salesCount: sales.length,
    servicesCount,
    clientsCount: clients.length,
  });

  const showOnboardingStrip = !onboarding_completed && pendingConfigurationSteps > 0 && !isOnboardingStripDismissed;
  const hasSales = summary.monthlySalesCount > 0;
  const goOnboarding = () => setLocation("/onboarding");

  const handleDismissOnboardingStrip = () => {
    writeOnboardingStripDismissed();
    setIsOnboardingStripDismissed(true);
  };

  const handleSaveMonthlyGoal = () => runSaveMonthlyGoal(
    monthlyGoalInput,
    settings as any,
    () => {
      setIsGoalEditorOpen(false);
      refreshSettings();
    },
    setIsSavingGoal,
  );

  if (settingsLoading || businessModeResolution.status === "loading" || dataLoading) {
    return <Layout><PageSkeleton variant="dashboard" /></Layout>;
  }

  if (businessModeResolution.status === "error" || dataError) {
    // Mesma estrutura para as duas falhas; cada uma mantém o layout/copy/ação que já tinha.
    const isModeErr = businessModeResolution.status === "error";
    return (
      <Layout>
        <div className={isModeErr ? "p-6 text-center" : "mx-auto max-w-3xl px-4 py-8 text-center"}>
          <p className="mb-2 font-bold text-destructive">{isModeErr ? "Não foi possível carregar as configurações do negócio." : "Ocorreu um erro temporário."}</p>
          <p className="mb-4 text-sm text-muted-foreground">{isModeErr ? "Verifique sua conexão e tente novamente para abrir a experiência correta." : "Não foi possível carregar sua visão geral."}</p>
          <button type="button" onClick={isModeErr ? refreshSettings : () => window.location.reload()} className={`rounded-xl bg-primary px-5 py-3 text-white ${isModeErr ? "text-xs font-semibold" : "text-sm font-bold"}`}>Tentar novamente</button>
        </div>
      </Layout>
    );
  }

  const cmp = summary.comparisonPercent;
  const isServicesMode = resolvedBusinessMode === "services";
  const progressPercentLabel = `${goal.progressPercent}%`;
  const hiddenPlural = hiddenPriorityCount === 1 ? "" : "s";

  return (
    <Layout>
      <div className="min-h-full bg-background pb-28 lg:pb-8">
        <header className="border-b border-primary/10 bg-gradient-to-br from-primary/8 via-card to-amber-50/60 dark:to-primary/5 px-4 py-5 sm:px-6 lg:px-8">
          <div className="mx-auto flex max-w-4xl items-center justify-between gap-4">
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-black uppercase tracking-[0.14em] text-primary">Visão geral</p>
              <h1 className="mt-1 line-clamp-2 break-words text-xl font-black tracking-tight text-foreground sm:text-2xl">{home.store.name}</h1>
              <p className="mt-1 text-xs font-semibold capitalize text-muted-foreground">{home.store.periodLabel}</p>
            </div>
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white text-primary shadow-sm" aria-hidden="true">
              <LineChart className="h-5 w-5" />
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-4xl space-y-3 px-4 py-4 sm:px-6 lg:px-8">
          {trial && (
            <LocalErrorBoundary fallback={null}>
              <Suspense fallback={null}>
                <TrialBanner trial={trial} />
              </Suspense>
            </LocalErrorBoundary>
          )}

          {showOnboardingStrip && (
            <section className="flex items-center justify-between gap-3 rounded-2xl border border-primary/10 bg-white px-4 py-3 shadow-sm" data-testid="home-onboarding-strip">
              <button type="button" onClick={goOnboarding} className="min-w-0 flex-1 text-left">
                <p className="truncate text-sm font-black text-foreground">
                  Finalize a configuração {isServicesMode ? "do negócio" : "da loja"} · Falta {pendingConfigurationSteps} etapa{pendingConfigurationSteps === 1 ? "" : "s"}
                </p>
                <p className={supportingTextClassName}>Continue quando quiser, sem bloquear seu uso.</p>
              </button>
              <button type="button" onClick={goOnboarding} className="rounded-xl bg-primary px-3 py-2 text-xs font-black text-white">Continuar</button>
              <button type="button" onClick={handleDismissOnboardingStrip} className={`rounded-xl p-2 text-muted-foreground hover:bg-secondary ${focusRingClassName}`} aria-label="Ocultar lembrete de configuração">
                <X className="h-4 w-4" />
              </button>
            </section>
          )}

          {!planLoading && planResolved && (hasPremiumAccess ? (
            <Suspense fallback={<div className="min-h-32 rounded-2xl bg-secondary/30 p-4" role="status">Carregando prioridades de hoje…</div>}>
              <TodayPriorities key={userId ?? "anonymous"} clients={clients} />
            </Suspense>
          ) : (
          <button
            type="button"
            onClick={() => setLocation("/opportunities")}
            className="flex w-full items-center gap-3 rounded-2xl border border-primary/20 bg-primary/[0.04] px-4 py-3.5 text-left active:scale-95 transition-all"
            data-testid="button-dashboard-opportunities"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Sparkles className="h-4.5 w-4.5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-black text-foreground">Oportunidades comerciais</span>
              <span className={`block ${supportingTextClassName}`}>O Premium identifica oportunidades comerciais para {dashboardBusinessLabel(resolvedBusinessMode)}.</span>
            </span>
            <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          </button>
          ))}

          {showProductMetrics && <SectionCard title="Resumo do período" eyebrow="Visão do negócio">
            {hasSales ? (
              <div className="grid grid-cols-2 gap-3" data-testid="home-summary-kpis">
                <SummaryTile label="Faturamento do mês" value={formatHomeCurrency(summary.monthlyRevenue)} detail="Total vendido no mês atual" />
                <SummaryTile label="Lucro estimado" value={formatHomeCurrency(summary.monthlyProfit)} detail="Com base no custo cadastrado" />
                <SummaryTile label="Vendas no mês" value={shortNumber(summary.monthlySalesCount)} detail="Pedidos registrados" />
                <SummaryTile label="Comparação" value={cmp === null ? "—" : `${cmp > 0 ? "+" : ""}${cmp}%`} detail={summary.comparisonLabel} />
              </div>
            ) : (
              <EmptyState>
                Ainda não há vendas neste período. Assim que uma venda for registrada, a visão do negócio aparece aqui.
              </EmptyState>
            )}
          </SectionCard>}



          {needsServicesCount && (
            <Suspense fallback={<div className="h-40 animate-pulse rounded-[1.5rem] bg-secondary/30" />}>
              <ServicesOverviewSection clients={clients} />
            </Suspense>
          )}

          <SectionCard title="O que precisa da sua atenção" eyebrow={`Organização ${isServicesMode ? "do negócio" : "da loja"}`}>
            {priorities.length > 0 ? (
              <div className="space-y-2">
                {priorities.map((priority) => (
                  <button key={priority.id} type="button" onClick={() => setLocation(priority.path)} className={`flex w-full items-start gap-3 rounded-2xl bg-secondary/35 px-3 py-3 text-left text-sm ${focusRingClassName}`}>
                    <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${priority.tone === "danger" ? "bg-red-500" : priority.tone === "warning" ? "bg-amber-500" : "bg-primary"}`} />
                    <span className="min-w-0 flex-1">
                      <span className="block font-black text-foreground">{priority.label}</span>
                      <span className={`mt-0.5 block ${supportingTextClassName}`}>{priority.detail}</span>
                    </span>
                    <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  </button>
                ))}
                {/* RELEASE-26: "Ver tudo" ia para /reports, que não lista prioridades — CTA redundante
                    com "Ver análise" (Insight principal, também /reports na maioria dos casos) e um
                    beco sem saída (nenhuma visão de "todas as prioridades" existe lá). Removido em vez
                    de criar uma página só para isso; o texto abaixo preserva a informação sem prometer
                    uma navegação que não cumpre o prometido. */}
                {hiddenPriorityCount > 0 && (
                  <p className="mt-2 text-center text-[11px] font-semibold text-muted-foreground" data-testid="text-hidden-priority-count">
                    +{hiddenPriorityCount} outra{hiddenPlural} prioridade{hiddenPlural}
                  </p>
                )}
              </div>
            ) : (
              <EmptyState>
                <span className="inline-flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-emerald-600" /> Tudo em ordem. Nenhuma prioridade crítica agora.</span>
              </EmptyState>
            )}
          </SectionCard>

          {showProductMetrics && <SectionCard title="Meta mensal" eyebrow="Objetivo" action={<Target className="h-5 w-5 text-primary" aria-hidden="true" />}>
            {goal.hasExplicitGoal ? (
              <div className="space-y-3">
                <div className="flex items-end justify-between gap-4">
                  <div>
                    <p className="text-2xl font-black text-foreground">{formatHomeCurrency(goal.current)}</p>
                    <p className={supportingTextClassName}>de {formatHomeCurrency(goal.target)} na meta</p>
                  </div>
                  <p className="text-lg font-black text-primary">{progressPercentLabel}</p>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-secondary">
                  <div className="h-full rounded-full bg-gradient-to-r from-primary to-violet-500 transition-[width] duration-200 motion-reduce:transition-none" style={{ width: progressPercentLabel }} />
                </div>
                <div className={`flex items-center justify-between gap-3 ${supportingTextClassName}`}>
                  <span>{goal.remainingToGoal > 0 ? `Faltam ${formatHomeCurrency(goal.remainingToGoal)}` : "Meta alcançada"}</span>
                  <button type="button" onClick={() => setIsGoalEditorOpen((current) => !current)} className={`inline-flex items-center gap-1 rounded-xl px-2 py-1 font-black text-primary ${focusRingClassName}`}><Edit3 className="h-3.5 w-3.5" /> Editar</button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <EmptyState>Defina uma meta mensal para acompanhar seu ritmo de vendas.</EmptyState>
                <button type="button" onClick={() => setIsGoalEditorOpen(true)} className={primaryActionClassName}>Definir</button>
              </div>
            )}

            {isGoalEditorOpen && (
              <div className="mt-4 grid grid-cols-[1fr_auto] gap-2 rounded-2xl bg-secondary/25 p-3">
                <input type="number" min="1" step="100" value={monthlyGoalInput} onChange={(e) => setMonthlyGoalInput(e.target.value)} className="min-w-0 rounded-2xl border border-border/60 bg-white px-4 py-3 text-sm font-semibold outline-none focus:ring-2 focus:ring-primary/20" aria-label="Meta de faturamento mensal" placeholder="Ex.: 10000" />
                <button type="button" onClick={() => void handleSaveMonthlyGoal()} disabled={isSavingGoal} className={`${primaryActionClassName} disabled:opacity-60`}>{isSavingGoal ? "Salvando..." : "Salvar"}</button>
              </div>
            )}
          </SectionCard>}

          {showProductMetrics && <SectionCard title="Insight principal" eyebrow="Análise automática">
            {insight ? (
              <div className="rounded-2xl bg-primary/5 p-4">
                <p className="text-xs font-black uppercase tracking-wide text-primary">{insight.title}</p>
                <p className="mt-1 text-xl font-black text-foreground">{insight.value}</p>
                <p className="mt-1 text-sm text-muted-foreground">{insight.detail}</p>
                {insight.path && <button type="button" onClick={() => setLocation(insight.path!)} className={`mt-4 inline-flex items-center gap-2 ${primaryActionClassName}`}>Ver análise <ArrowRight className="h-4 w-4" /></button>}
              </div>
            ) : (
              <EmptyState>Ainda não há dados suficientes para destacar um insight confiável.</EmptyState>
            )}
          </SectionCard>}
        </main>
      </div>
    </Layout>
  );
}
