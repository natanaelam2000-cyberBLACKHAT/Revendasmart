import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useLocation } from "wouter";
import { ArrowRight, CheckCircle2, Edit3, LineChart, Target, X } from "lucide-react";
import { PageSkeleton } from "@/components/PageSkeleton";
import { Layout } from "@/components/layout";
import { useClientsLiteData } from "@/hooks/useClientsLiteData";
import { useProductsData } from "@/hooks/useProductsData";
import { useSalesData } from "@/hooks/useSalesData";
import { getApiUrl } from "@/lib/api-config";
import { getFirebaseAuth } from "@/lib/firebase";
import { buildHomeDashboardViewModel, formatHomeCurrency } from "@/lib/home-dashboard-view-model";
import { notifyError, notifySuccess } from "@/lib/notify";
import { useUserSettings } from "@/providers/UserSettingsProvider";

const HOME_ONBOARDING_STRIP_STORAGE_KEY = "revendasmart:home:onboarding-strip:v1";

function readOnboardingStripDismissed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(HOME_ONBOARDING_STRIP_STORAGE_KEY) === "dismissed";
  } catch {
    return false;
  }
}

function writeOnboardingStripDismissed() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(HOME_ONBOARDING_STRIP_STORAGE_KEY, "dismissed");
  } catch {
    // localStorage can be unavailable in private mode or restricted WebViews.
  }
}

function shortNumber(value: number): string {
  return value.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
}

function SectionCard({ title, eyebrow, children, action }: { title: string; eyebrow?: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="rounded-[1.5rem] border border-border/50 bg-white p-4 shadow-sm sm:p-5">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div className="min-w-0">
          {eyebrow && <p className="text-[10px] font-black uppercase tracking-[0.16em] text-primary">{eyebrow}</p>}
          <h2 className="mt-1 text-base font-black text-foreground">{title}</h2>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function SummaryTile({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="rounded-2xl bg-secondary/35 p-3">
      <p className="text-[10px] font-black uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-black text-foreground">{value}</p>
      {detail && <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{detail}</p>}
    </div>
  );
}

function EmptyState({ children }: { children: ReactNode }) {
  return <div className="rounded-2xl border border-dashed border-border/70 bg-secondary/20 px-4 py-5 text-sm font-semibold text-muted-foreground">{children}</div>;
}


export default function Dashboard() {
  const [, setLocation] = useLocation();
  const { onboarding_completed, loading: settingsLoading, settings, refresh: refreshSettings } = useUserSettings();
  const { products, loading: productsLoading, error: productsError } = useProductsData();
  const { sales, loading: salesLoading, error: salesError } = useSalesData();
  const { clients, loading: clientsLoading, error: clientsError } = useClientsLiteData();
  const [isGoalEditorOpen, setIsGoalEditorOpen] = useState(false);
  const [monthlyGoalInput, setMonthlyGoalInput] = useState("");
  const [isSavingGoal, setIsSavingGoal] = useState(false);
  const [isOnboardingStripDismissed, setIsOnboardingStripDismissed] = useState(readOnboardingStripDismissed);
  const dataLoading = productsLoading || salesLoading || clientsLoading;
  const dataError = productsError || salesError || clientsError;
  const home = useMemo(() => buildHomeDashboardViewModel({ products, clients, sales, settings: settings as any }), [clients, products, sales, settings]);


  useEffect(() => {
    setMonthlyGoalInput(home.goal.hasExplicitGoal ? String(home.goal.target) : "");
  }, [home.goal.hasExplicitGoal, home.goal.target]);

  const pendingConfigurationSteps = useMemo(() => {
    const catalogReady = settings.enablePublicCatalog !== false && Boolean(settings.catalogSlug || settings.catalog_slug);
    return [
      !settings.businessType,
      !settings.appTheme && !settings.onboarding_theme_selected,
      !settings.storeName || String(settings.storeName).trim() === "Minha loja",
      !settings.storeLogo && !settings.storeIdentity?.logoUrl,
      products.length === 0,
      clients.length === 0,
      sales.length === 0,
      !catalogReady,
    ].filter(Boolean).length;
  }, [clients.length, products.length, sales.length, settings]);

  const showOnboardingStrip = !onboarding_completed && pendingConfigurationSteps > 0 && !isOnboardingStripDismissed;
  const hasSales = home.summary.monthlySalesCount > 0;

  const handleDismissOnboardingStrip = () => {
    writeOnboardingStripDismissed();
    setIsOnboardingStripDismissed(true);
  };

  const handleSaveMonthlyGoal = async () => {
    const nextGoal = Number(monthlyGoalInput);
    if (!Number.isFinite(nextGoal) || nextGoal <= 0) {
      notifyError("Informe uma meta válida.");
      return;
    }
    const user = getFirebaseAuth()?.currentUser;
    if (!user) {
      notifyError("Sessão expirada. Faça login novamente.");
      return;
    }

    setIsSavingGoal(true);
    try {
      const token = await user.getIdToken();
      const response = await fetch(getApiUrl(`/api/user/settings/${user.uid}`), {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ...settings, monthlyGoal: nextGoal }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      notifySuccess("Meta mensal salva.");
      setIsGoalEditorOpen(false);
      refreshSettings();
    } catch (error) {
      console.error("[dashboard] Failed to save monthly goal:", error);
      notifyError("Erro ao salvar meta mensal.");
    } finally {
      setIsSavingGoal(false);
    }
  };

  if (settingsLoading || dataLoading) {
    return <Layout><PageSkeleton variant="dashboard" /></Layout>;
  }

  if (dataError) {
    return (
      <Layout>
        <div className="mx-auto max-w-3xl px-4 py-8 text-center">
          <p className="mb-2 font-bold text-destructive">Ocorreu um erro temporário.</p>
          <p className="mb-4 text-sm text-muted-foreground">Não foi possível carregar sua visão geral.</p>
          <button type="button" onClick={() => window.location.reload()} className="rounded-xl bg-primary px-5 py-3 text-sm font-bold text-white">Tentar novamente</button>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="min-h-full bg-slate-50 pb-28 lg:pb-8">
        <header className="border-b border-primary/10 bg-gradient-to-br from-primary/8 via-white to-amber-50/60 px-4 py-5 sm:px-6 lg:px-8">
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
          {showOnboardingStrip && (
            <section className="flex items-center justify-between gap-3 rounded-2xl border border-primary/10 bg-white px-4 py-3 shadow-sm" data-testid="home-onboarding-strip">
              <button type="button" onClick={() => setLocation("/onboarding")} className="min-w-0 flex-1 text-left">
                <p className="truncate text-sm font-black text-foreground">Finalize a configuração da loja · Falta {pendingConfigurationSteps} etapa{pendingConfigurationSteps === 1 ? "" : "s"}</p>
                <p className="text-xs text-muted-foreground">Continue quando quiser, sem bloquear seu uso.</p>
              </button>
              <button type="button" onClick={() => setLocation("/onboarding")} className="rounded-xl bg-primary px-3 py-2 text-xs font-black text-white">Continuar</button>
              <button type="button" onClick={handleDismissOnboardingStrip} className="rounded-xl p-2 text-muted-foreground hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30" aria-label="Ocultar lembrete de configuração">
                <X className="h-4 w-4" />
              </button>
            </section>
          )}

          <SectionCard title="Resumo do período" eyebrow="Resumo executivo">
            {hasSales ? (
              <div className="grid grid-cols-2 gap-3" data-testid="home-summary-kpis">
                <SummaryTile label="Faturamento do mês" value={formatHomeCurrency(home.summary.monthlyRevenue)} detail="Total vendido no mês atual" />
                <SummaryTile label="Lucro estimado" value={formatHomeCurrency(home.summary.monthlyProfit)} detail="Com base no custo cadastrado" />
                <SummaryTile label="Vendas no mês" value={shortNumber(home.summary.monthlySalesCount)} detail="Pedidos registrados" />
                <SummaryTile label="Comparação" value={home.summary.comparisonPercent === null ? "—" : `${home.summary.comparisonPercent > 0 ? "+" : ""}${home.summary.comparisonPercent}%`} detail={home.summary.comparisonLabel} />
              </div>
            ) : (
              <EmptyState>
                Ainda não há vendas neste período. Assim que uma venda for registrada, o resumo executivo aparece aqui.
              </EmptyState>
            )}
          </SectionCard>



          <SectionCard title="O que precisa da sua atenção" eyebrow="Prioridades">
            {home.priorities.length > 0 ? (
              <div className="space-y-2">
                {home.priorities.map((priority) => (
                  <button key={priority.id} type="button" onClick={() => setLocation(priority.path)} className="flex w-full items-start gap-3 rounded-2xl bg-secondary/35 px-3 py-3 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30">
                    <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${priority.tone === "danger" ? "bg-red-500" : priority.tone === "warning" ? "bg-amber-500" : "bg-primary"}`} />
                    <span className="min-w-0 flex-1">
                      <span className="block font-black text-foreground">{priority.label}</span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">{priority.detail}</span>
                    </span>
                    <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  </button>
                ))}
                {home.hiddenPriorityCount > 0 && (
                  <button type="button" onClick={() => setLocation("/reports")} className="mt-2 w-full rounded-2xl border border-primary/20 px-4 py-3 text-xs font-black text-primary">Ver tudo</button>
                )}
              </div>
            ) : (
              <EmptyState>
                <span className="inline-flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-emerald-600" /> Tudo em ordem. Nenhuma prioridade crítica agora.</span>
              </EmptyState>
            )}
          </SectionCard>

          <SectionCard title="Meta mensal" eyebrow="Objetivo" action={<Target className="h-5 w-5 text-primary" aria-hidden="true" />}>
            {home.goal.hasExplicitGoal ? (
              <div className="space-y-3">
                <div className="flex items-end justify-between gap-4">
                  <div>
                    <p className="text-2xl font-black text-foreground">{formatHomeCurrency(home.goal.current)}</p>
                    <p className="text-xs text-muted-foreground">de {formatHomeCurrency(home.goal.target)} na meta</p>
                  </div>
                  <p className="text-lg font-black text-primary">{home.goal.progressPercent}%</p>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-secondary">
                  <div className="h-full rounded-full bg-gradient-to-r from-primary to-violet-500 transition-[width] duration-200 motion-reduce:transition-none" style={{ width: `${home.goal.progressPercent}%` }} />
                </div>
                <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                  <span>{home.goal.remainingToGoal > 0 ? `Faltam ${formatHomeCurrency(home.goal.remainingToGoal)}` : "Meta alcançada"}</span>
                  <button type="button" onClick={() => setIsGoalEditorOpen((current) => !current)} className="inline-flex items-center gap-1 rounded-xl px-2 py-1 font-black text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"><Edit3 className="h-3.5 w-3.5" /> Editar</button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <EmptyState>Defina uma meta mensal para acompanhar seu ritmo de vendas.</EmptyState>
                <button type="button" onClick={() => setIsGoalEditorOpen(true)} className="rounded-2xl bg-primary px-4 py-3 text-xs font-black text-white">Definir</button>
              </div>
            )}

            {isGoalEditorOpen && (
              <div className="mt-4 grid grid-cols-[1fr_auto] gap-2 rounded-2xl bg-secondary/25 p-3">
                <input type="number" min="1" step="100" value={monthlyGoalInput} onChange={(event) => setMonthlyGoalInput(event.target.value)} className="min-w-0 rounded-2xl border border-border/60 bg-white px-4 py-3 text-sm font-semibold outline-none focus:ring-2 focus:ring-primary/20" aria-label="Meta de faturamento mensal" placeholder="Ex.: 10000" />
                <button type="button" onClick={() => void handleSaveMonthlyGoal()} disabled={isSavingGoal} className="rounded-2xl bg-primary px-4 py-3 text-xs font-black text-white disabled:opacity-60">{isSavingGoal ? "Salvando..." : "Salvar"}</button>
              </div>
            )}
          </SectionCard>

          <SectionCard title="Insight principal" eyebrow="Análise automática">
            {home.mainInsight ? (
              <div className="rounded-2xl bg-primary/5 p-4">
                <p className="text-xs font-black uppercase tracking-wide text-primary">{home.mainInsight.title}</p>
                <p className="mt-1 text-xl font-black text-foreground">{home.mainInsight.value}</p>
                <p className="mt-1 text-sm text-muted-foreground">{home.mainInsight.detail}</p>
                {home.mainInsight.path && <button type="button" onClick={() => setLocation(home.mainInsight!.path!)} className="mt-4 inline-flex items-center gap-2 rounded-2xl bg-primary px-4 py-3 text-xs font-black text-white">Ver análise <ArrowRight className="h-4 w-4" /></button>}
              </div>
            ) : (
              <EmptyState>Ainda não há dados suficientes para destacar um insight confiável.</EmptyState>
            )}
          </SectionCard>
        </main>
      </div>
    </Layout>
  );
}
