import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useLocation } from "wouter";
import { AlertCircle, ArrowRight, ChevronDown, CreditCard, Globe2, PackagePlus, Palette, ShoppingCart, Sparkles, Users } from "lucide-react";
import { PageSkeleton } from "@/components/PageSkeleton";
import { OnboardingChecklist, type OnboardingChecklistItem } from "@/components/OnboardingChecklist";
import { Layout } from "@/components/layout";
import { useUserSettings } from "@/providers/UserSettingsProvider";
import { getApiUrl } from "@/lib/api-config";
import { getFirebaseAuth } from "@/lib/firebase";
import { notifyError, notifySuccess } from "@/lib/notify";
import { useClientsLiteData } from "@/hooks/useClientsLiteData";
import { useProductsData } from "@/hooks/useProductsData";
import { useSalesData } from "@/hooks/useSalesData";
import {
  HOME_ACCORDION_STORAGE_KEY,
  type HomeAccordionSectionId,
  buildHomeDashboardViewModel,
  formatHomeCurrency,
  resolveHomeAccordionSectionId,
} from "@/lib/home-dashboard-view-model";

type OnboardingChecklistUi = { collapsed: boolean; dismissed: boolean };
type AccordionSection = { id: HomeAccordionSectionId; title: string; summary: string; badge?: string; body: ReactNode; };
const ONBOARDING_CHECKLIST_STORAGE_KEY = "rs:onboarding-checklist-ui";

function readOnboardingChecklistUi(): OnboardingChecklistUi {
  if (typeof window === "undefined") return { collapsed: false, dismissed: false };
  try {
    const stored = window.localStorage.getItem(ONBOARDING_CHECKLIST_STORAGE_KEY);
    if (!stored) return { collapsed: false, dismissed: false };
    const parsed = JSON.parse(stored) as Partial<OnboardingChecklistUi>;
    return { collapsed: parsed.collapsed === true, dismissed: parsed.dismissed === true };
  } catch { return { collapsed: false, dismissed: false }; }
}

function writeOnboardingChecklistUi(next: OnboardingChecklistUi) {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(ONBOARDING_CHECKLIST_STORAGE_KEY, JSON.stringify(next)); } catch {
    // localStorage can be unavailable in private mode or restricted WebViews.
  }
}

function readHomeOpenSection(): HomeAccordionSectionId | null {
  if (typeof window === "undefined") return null;
  try { return resolveHomeAccordionSectionId(window.localStorage.getItem(HOME_ACCORDION_STORAGE_KEY)); } catch { return null; }
}

function writeHomeOpenSection(sectionId: HomeAccordionSectionId | null) {
  if (typeof window === "undefined") return;
  try {
    if (sectionId) window.localStorage.setItem(HOME_ACCORDION_STORAGE_KEY, sectionId);
    else window.localStorage.removeItem(HOME_ACCORDION_STORAGE_KEY);
  } catch {
    // localStorage can be unavailable in private mode or restricted WebViews.
  }
}

function monthLabel(date = new Date()) { return date.toLocaleDateString("pt-BR", { month: "long" }); }
function greeting(date = new Date()) { const hour = date.getHours(); return hour < 12 ? "Bom dia" : hour < 18 ? "Boa tarde" : "Boa noite"; }
function compactNumber(value: number) { return value.toLocaleString("pt-BR", { maximumFractionDigits: 0 }); }

function KpiCard({ label, value, detail, onClick }: { label: string; value: string; detail: string; onClick?: () => void }) {
  const content = <><p className="text-[10px] font-black uppercase tracking-wide text-muted-foreground">{label}</p><p className="mt-2 text-lg font-black text-foreground">{value}</p><p className="mt-1 text-[11px] text-muted-foreground leading-snug">{detail}</p></>;
  const className = "rounded-2xl border border-border/50 bg-white p-4 text-left shadow-sm";
  return onClick ? <button type="button" onClick={onClick} className={`${className} rs-pressable`}>{content}</button> : <div className={className}>{content}</div>;
}

function AccordionCard({ section, isOpen, onToggle }: { section: AccordionSection; isOpen: boolean; onToggle: () => void }) {
  const panelId = `home-section-${section.id}`;
  return (
    <section className="overflow-hidden rounded-[1.75rem] border border-border/50 bg-white shadow-sm" data-home-accordion-section={section.id}>
      <button type="button" onClick={onToggle} className="flex w-full items-center justify-between gap-4 p-5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40" aria-expanded={isOpen} aria-controls={panelId}>
        <span className="min-w-0"><span className="block text-sm font-black text-foreground">{section.title}</span><span className="mt-1 block text-xs text-muted-foreground">{section.summary}</span></span>
        <span className="flex shrink-0 items-center gap-2 text-xs font-black text-primary">{section.badge && <span>{section.badge}</span>}<ChevronDown className={`h-4 w-4 transition-transform motion-reduce:transition-none ${isOpen ? "rotate-180" : ""}`} /></span>
      </button>
      {isOpen && <div id={panelId} className="border-t border-border/50 px-5 pb-5 pt-4" data-home-accordion-panel={section.id}>{section.body}</div>}
    </section>
  );
}

function MetricRow({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return <div className="rounded-2xl bg-secondary/35 p-3"><p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{label}</p><p className="mt-1 text-sm font-black text-foreground">{value}</p>{hint && <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>}</div>;
}

export default function Dashboard() {
  const [, setLocation] = useLocation();
  const { onboarding_completed, loading: settingsLoading, settings, refresh: refreshSettings } = useUserSettings();
  const { products, loading: productsLoading, error: productsError } = useProductsData();
  const { sales, loading: salesLoading, error: salesError } = useSalesData();
  const { clients, loading: clientsLoading, error: clientsError } = useClientsLiteData();
  const dataLoading = productsLoading || salesLoading || clientsLoading;
  const dataError = productsError || salesError || clientsError;
  const [showFirstProductCTA, setShowFirstProductCTA] = useState(false);
  const [monthlyGoalInput, setMonthlyGoalInput] = useState("10000");
  const [isSavingGoal, setIsSavingGoal] = useState(false);
  const [openSection, setOpenSection] = useState<HomeAccordionSectionId | null>(() => readHomeOpenSection());
  const [onboardingChecklistUi, setOnboardingChecklistUi] = useState<OnboardingChecklistUi>(() => readOnboardingChecklistUi());

  useEffect(() => {
    if (typeof window === "undefined" || showFirstProductCTA) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("action") !== "first_product") return;
    setShowFirstProductCTA(true);
    const newUrl = window.location.pathname + window.location.hash;
    window.history.replaceState({ path: newUrl }, "", newUrl);
  }, [showFirstProductCTA]);

  const home = useMemo(() => buildHomeDashboardViewModel({ products, clients, sales, settings: settings as any }), [clients, products, sales, settings]);
  useEffect(() => { setMonthlyGoalInput(String(home.month.target)); }, [home.month.target]);

  const toggleSection = (sectionId: HomeAccordionSectionId) => {
    setOpenSection((current) => {
      const next = current === sectionId ? null : sectionId;
      writeHomeOpenSection(next);
      return next;
    });
  };

  const handleSaveMonthlyGoal = async () => {
    const nextGoal = Number(monthlyGoalInput);
    if (!Number.isFinite(nextGoal) || nextGoal <= 0) { notifyError("Informe uma meta válida."); return; }
    const user = getFirebaseAuth()?.currentUser;
    if (!user) { notifyError("Sessão expirada. Faça login novamente."); return; }
    setIsSavingGoal(true);
    try {
      const token = await user.getIdToken();
      const response = await fetch(getApiUrl(`/api/user/settings/${user.uid}`), { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ ...settings, monthlyGoal: nextGoal }) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      notifySuccess("Meta mensal salva.");
      refreshSettings();
    } catch (error) {
      console.error("[dashboard] Failed to save monthly goal:", error);
      notifyError("Erro ao salvar meta mensal.");
    } finally { setIsSavingGoal(false); }
  };

  const updateOnboardingChecklistUi = (patch: Partial<OnboardingChecklistUi>) => {
    setOnboardingChecklistUi((current) => {
      const next = { ...current, ...patch };
      writeOnboardingChecklistUi(next);
      return next;
    });
  };

  const onboardingChecklistItems = useMemo<OnboardingChecklistItem[]>(() => [
    { id: "theme", label: "Escolher tema", description: "Personalize as cores da sua loja.", done: Boolean(settings.appTheme || settings.onboarding_theme_selected), path: "/onboarding", icon: Palette },
    { id: "product", label: "Cadastrar primeiro produto", description: "Inclua um item para começar a vender.", done: products.length > 0, path: "/add-product", icon: PackagePlus },
    { id: "client", label: "Cadastrar primeiro cliente", description: "Organize seus contatos de venda.", done: clients.length > 0, path: "/clients", icon: Users },
    { id: "sale", label: "Fazer primeira venda", description: "Registre uma venda para liberar métricas.", done: sales.length > 0, path: "/sell", icon: ShoppingCart },
    { id: "catalog", label: "Ativar catálogo", description: "Deixe sua vitrine pronta para compartilhar.", done: settings.enablePublicCatalog !== false && Boolean(settings.catalogSlug || settings.catalog_slug), path: "/catalog", icon: Globe2 },
    { id: "payments", label: "Configurar cobrança", description: "Prepare Pix, links ou integrações quando necessário.", done: Boolean(settings.pixKey || settings.paymentLink), path: "/settings/mercadopago", icon: CreditCard },
  ], [clients.length, products.length, sales.length, settings]);

  const showOnboardingChecklist = !onboarding_completed && !onboardingChecklistUi.dismissed;
  const displayName = String(settings.sellerName || settings.storeName || "revendedora").trim();
  const currentMonthLabel = monthLabel();
  const summaryKpis = [
    { id: "monthlyRevenue", label: "Faturamento do mês", value: formatHomeCurrency(home.summary.monthlyRevenue), detail: `Resumo de ${currentMonthLabel}`, path: "/monthly-sales" },
    { id: "monthlyProfit", label: "Lucro estimado", value: formatHomeCurrency(home.summary.monthlyProfit), detail: "Com base no custo cadastrado" },
    { id: "averageTicket", label: "Ticket médio", value: home.summary.averageTicket === null ? "—" : formatHomeCurrency(home.summary.averageTicket), detail: home.summary.averageTicket === null ? "Registre uma venda para calcular" : "Valor médio por venda" },
    { id: "activeClients", label: "Clientes ativos", value: String(home.summary.activeClients), detail: "Com venda no mês atual", path: "/clients" },
  ];

  const sections: AccordionSection[] = [
    { id: "month", title: "Desempenho do mês", summary: `${formatHomeCurrency(home.month.current)} de ${formatHomeCurrency(home.month.target)} na meta`, badge: `${home.month.progressPercent}%`, body: <div className="space-y-4"><div className="grid grid-cols-2 gap-3"><MetricRow label="Meta" value={formatHomeCurrency(home.month.target)} hint={home.month.hasExplicitGoal ? "Meta configurada" : "Referência padrão"} /><MetricRow label="Faturado" value={formatHomeCurrency(home.month.current)} /><MetricRow label="Faltam" value={formatHomeCurrency(home.month.remainingToGoal)} /><MetricRow label="Ritmo necessário" value={`${formatHomeCurrency(home.month.requiredDailyRevenue)} por dia`} /><MetricRow label="Mês anterior" value={formatHomeCurrency(home.month.previousRevenue)} /><MetricRow label="Projeção atual" value={formatHomeCurrency(home.month.projectedRevenue)} hint={`${home.month.daysRemaining} dias restantes`} /></div><div className="grid grid-cols-[1fr_auto] gap-2"><input type="number" min="1" step="100" value={monthlyGoalInput} onChange={(event) => setMonthlyGoalInput(event.target.value)} className="min-w-0 rounded-2xl border border-border/60 bg-secondary/30 px-4 py-3 text-sm font-semibold outline-none focus:ring-2 focus:ring-primary/20" aria-label="Meta de vendas do mês" /><button type="button" onClick={() => void handleSaveMonthlyGoal()} disabled={isSavingGoal} className="rounded-2xl bg-primary px-4 py-3 text-xs font-semibold text-white disabled:opacity-60">{isSavingGoal ? "Salvando..." : "Editar meta"}</button></div></div> },
    { id: "inventory", title: "Produtos e estoque", summary: `${compactNumber(home.inventory.totalProducts)} produtos · ${compactNumber(home.inventory.outOfStockCount)} esgotados · ${compactNumber(home.inventory.lowStockCount)} acabando`, body: <div className="grid grid-cols-2 gap-3"><MetricRow label="Produtos cadastrados" value={compactNumber(home.inventory.totalProducts)} /><MetricRow label="Sem estoque" value={compactNumber(home.inventory.outOfStockCount)} /><MetricRow label="Estoque baixo" value={compactNumber(home.inventory.lowStockCount)} /><MetricRow label="Sem vendas há mais de 90 dias" value={compactNumber(home.inventory.stagnantCount)} /><MetricRow label="Valor total em estoque" value={formatHomeCurrency(home.inventory.totalInventoryValue)} /><MetricRow label="Valor parado" value={formatHomeCurrency(home.inventory.stagnantInventoryValue)} /><button type="button" onClick={() => setLocation("/products")} className="col-span-2 rounded-2xl bg-primary/10 px-4 py-3 text-xs font-black text-primary">Ver lista de produtos</button></div> },
    { id: "productPerformance", title: "Desempenho dos produtos", summary: "Destaques, produto parado e itens críticos", body: <div className="space-y-4"><div className="rounded-2xl bg-amber-50 p-4 text-amber-900"><p className="text-[10px] font-black uppercase tracking-wide">Produto campeão</p>{home.products.champion ? <div className="mt-2 space-y-1"><p className="text-sm font-black">{home.products.champion.product.name}</p><p className="text-xs">Quantidade vendida: {compactNumber(home.products.champion.quantity)}</p><p className="text-xs">Faturamento: {formatHomeCurrency(home.products.champion.revenue)}</p></div> : <p className="mt-2 text-xs font-semibold">Ainda não há vendas suficientes</p>}</div><div className="rounded-2xl bg-orange-50 p-4 text-orange-900"><p className="text-[10px] font-black uppercase tracking-wide">Produto parado</p>{home.products.stagnant ? <div className="mt-2 space-y-2"><p className="text-sm font-black">{home.products.stagnant.product.name}</p><p className="text-xs">{compactNumber(home.products.stagnant.product.stock)} unidade(s) em estoque</p><p className="text-xs">{home.products.stagnant.neverSold ? "Nunca vendido" : `Sem vendas há ${home.products.stagnant.daysWithoutSale} dias`}</p><p className="text-xs">Valor parado: {formatHomeCurrency(home.products.stagnant.stockValue)}</p><div className="grid grid-cols-2 gap-2 pt-1"><button type="button" onClick={() => setLocation(`/edit-product/${home.products.stagnant!.product.id}`)} className="rounded-xl bg-white px-3 py-2 text-[11px] font-black text-primary">Ver produto</button><button type="button" onClick={() => setLocation("/marketing")} className="rounded-xl bg-primary px-3 py-2 text-[11px] font-black text-white">Criar promoção</button></div></div> : <p className="mt-2 text-xs font-semibold">Nenhum produto parado no momento</p>}</div><div><p className="text-xs font-black text-foreground">Produtos com estoque crítico</p>{home.products.critical.length === 0 ? <p className="mt-2 text-xs text-muted-foreground">Nenhum produto crítico no momento</p> : <div className="mt-2 space-y-2">{home.products.critical.map((product) => <button key={product.id} type="button" onClick={() => setLocation(`/edit-product/${product.id}`)} className="flex w-full items-center justify-between rounded-2xl bg-secondary/35 px-3 py-2 text-left text-xs"><span className="font-semibold truncate">{product.name}</span><span className="font-black text-primary">{compactNumber(product.stock)} un</span></button>)}<button type="button" onClick={() => setLocation("/products")} className="w-full rounded-2xl border border-primary/20 px-3 py-2 text-xs font-black text-primary">Ver todos</button></div>}</div></div> },
    { id: "health", title: "Saúde da loja", summary: `${home.health.label} · ${home.health.areasNeedingAttention} áreas precisam de atenção`, badge: `${home.health.score}/100`, body: <div className="space-y-4"><div className="rounded-2xl bg-primary/5 p-4"><p className="text-xl font-black text-primary">{home.health.score}/100 · {home.health.label}</p><p className="mt-1 text-xs text-muted-foreground">Análise automática da sua loja</p></div><div className="space-y-2">{home.health.domains.map((domain) => <div key={domain.label} className="flex items-center justify-between rounded-2xl bg-secondary/35 px-3 py-2 text-xs"><span className="font-semibold">{domain.label}</span><span className="font-black text-primary">{domain.score}/100</span></div>)}</div><div className="rounded-2xl border border-primary/10 p-4"><p className="text-[10px] font-black uppercase tracking-wide text-muted-foreground">Principal oportunidade</p><p className="mt-1 text-sm font-black">{home.health.mainOpportunity}</p></div><button type="button" onClick={() => setLocation("/reports")} className="w-full rounded-2xl bg-primary px-4 py-3 text-xs font-black text-white">Ver diagnóstico completo</button></div> },
    { id: "insights", title: "Insights comerciais", summary: home.insights.headline, body: <div className="space-y-3">{home.insights.top.length === 0 ? <p className="text-xs text-muted-foreground">Ainda não há dados suficientes para gerar insights comerciais.</p> : home.insights.top.map((item) => <div key={item.label} className="rounded-2xl bg-secondary/35 p-3"><p className="text-[10px] font-black uppercase tracking-wide text-muted-foreground">{item.label}</p><p className="mt-1 text-sm font-black text-foreground">{item.value}</p><p className="text-xs font-semibold text-primary">{item.detail}</p></div>)}<button type="button" onClick={() => setLocation("/reports")} className="w-full rounded-2xl border border-primary/20 px-4 py-3 text-xs font-black text-primary">Ver relatório completo</button></div> },
  ];

  if (settingsLoading || dataLoading) return <Layout><PageSkeleton variant="dashboard" /></Layout>;
  if (dataError) return <Layout><div className="p-6 text-center"><p className="mb-2 font-bold text-destructive">Ocorreu um erro temporário.</p><p className="mb-4 text-sm text-muted-foreground">Não foi possível carregar seu resumo.</p><button onClick={() => window.location.reload()} className="rounded-xl bg-primary px-5 py-3 text-sm font-bold text-white">Tentar novamente</button></div></Layout>;

  return <Layout><div className="min-h-full bg-slate-50 pb-28 lg:pb-8"><header className="bg-primary/5 rounded-b-[2.25rem] px-4 pb-5 pt-[max(2rem,env(safe-area-inset-top))] sm:px-6 lg:px-8"><div className="mx-auto max-w-6xl"><p className="text-xs font-semibold text-primary">{greeting()}, {displayName}</p><h1 className="mt-1 text-2xl font-black tracking-tight text-foreground">Resumo de {currentMonthLabel}</h1><p className="mt-1 text-sm text-muted-foreground">Poucas informações, decisões mais rápidas.</p></div></header><main className="mx-auto max-w-6xl space-y-5 px-4 py-5 sm:px-6 lg:px-8">{showOnboardingChecklist && <OnboardingChecklist items={onboardingChecklistItems} collapsed={onboardingChecklistUi.collapsed} onToggleCollapsed={() => updateOnboardingChecklistUi({ collapsed: !onboardingChecklistUi.collapsed })} onDismiss={() => updateOnboardingChecklistUi({ dismissed: true })} onGoTo={setLocation} />}<section className="grid grid-cols-2 gap-3" aria-label="Resumo comercial" data-testid="home-summary-kpis">{summaryKpis.map((kpi) => <KpiCard key={kpi.id} label={kpi.label} value={kpi.value} detail={kpi.detail} onClick={kpi.path ? () => setLocation(kpi.path) : undefined} />)}</section><section className="rounded-[1.75rem] border border-primary/10 bg-white p-5 shadow-sm" data-testid="home-attention-card"><div className="mb-4 flex items-start justify-between gap-4"><div><p className="text-[10px] font-black uppercase tracking-[0.16em] text-primary">O que precisa da sua atenção</p><h2 className="mt-1 text-lg font-black text-foreground">Prioridades da loja</h2></div><AlertCircle className="h-5 w-5 shrink-0 text-primary" /></div><div className="space-y-2">{home.priorities.map((priority) => <button key={priority.id} type="button" onClick={() => priority.path === "/dashboard" ? setOpenSection("health") : setLocation(priority.path)} className="flex w-full items-start gap-3 rounded-2xl bg-secondary/35 px-3 py-3 text-left text-xs"><span className={`mt-0.5 h-2.5 w-2.5 rounded-full ${priority.tone === "danger" ? "bg-red-500" : priority.tone === "warning" ? "bg-amber-500" : priority.tone === "success" ? "bg-emerald-500" : "bg-primary"}`} /><span className="min-w-0"><span className="block font-black text-foreground">{priority.label}</span><span className="mt-0.5 block text-muted-foreground">{priority.detail}</span></span></button>)}</div><button type="button" onClick={() => toggleSection("health")} className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-primary px-4 py-3 text-xs font-black text-white">Ver todas as ações <ArrowRight className="h-4 w-4" /></button></section><div className="space-y-3" data-testid="home-accordion">{sections.map((section) => <AccordionCard key={section.id} section={section} isOpen={openSection === section.id} onToggle={() => toggleSection(section.id)} />)}</div>{showFirstProductCTA && <section className="rounded-[1.75rem] border border-primary/10 bg-primary/5 p-5 text-center"><Sparkles className="mx-auto mb-3 h-8 w-8 text-primary" /><h2 className="text-lg font-black">Vamos cadastrar seu primeiro produto?</h2><p className="mt-1 text-sm text-muted-foreground">Esse é o próximo passo para liberar vendas e catálogo.</p><div className="mt-4 grid grid-cols-2 gap-3"><button type="button" onClick={() => setLocation("/add-product")} className="rounded-2xl bg-primary px-4 py-3 text-xs font-black text-white">Cadastrar</button><button type="button" onClick={() => setShowFirstProductCTA(false)} className="rounded-2xl bg-white px-4 py-3 text-xs font-black text-muted-foreground">Depois</button></div></section>}</main></div></Layout>;
}
