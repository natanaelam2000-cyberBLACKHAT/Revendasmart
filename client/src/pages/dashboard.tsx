import { useState, useEffect, useMemo } from "react";
import { PageSkeleton } from "@/components/PageSkeleton";
import { useLocation } from "wouter";
import { Layout } from "@/components/layout";
import { ProductImageCard } from "@/components/ProductImageCard";
import {
  TrendingUp, Package, AlertCircle, Zap, Share2,
  Sparkles, ArrowRight, TrendingDown, Users, Bell as BellIcon,
  Plus, ShoppingCart, Receipt, Megaphone, BookOpen
} from "lucide-react";
import { isToday, parseISO } from "date-fns";
import { useUserSettings } from "@/providers/UserSettingsProvider";
import { getApiUrl } from "@/lib/api-config";
import { getFirebaseAuth } from "@/lib/firebase";
import { notifyError, notifySuccess } from "@/lib/notify";
import { useClientsLiteData } from "@/hooks/useClientsLiteData";
import { useProductsData } from "@/hooks/useProductsData";
import { useSalesData } from "@/hooks/useSalesData";
import { useFeatureEnabled } from "@/lib/remote-config-context";
import {
  calculateAttentionItems,
  calculateDashboardInsights,
  calculateDashboardPremiumIndicators,
  calculateExecutiveSummary,
  calculateInactiveClientCount,
  calculateLowStockProducts,
  calculateMonthlyGoal,
  calculateMonthlyMetrics,
  calculateStockExecutiveMetrics,
  calculateTopProducts,
  calculateWorstProduct,
  createClientMap,
  createProductMap,
} from "@/lib/dashboard-metrics";
import {
  calculateBusinessInsights,
  calculateMonthlyComparison,
  calculateMonthlyProjection,
  calculateStockMetrics,
} from "@/lib/business-insights";

// Helper: Get stock badge for low stock products
const getStockBadge = (stock: number) => {
  if (stock === 0) {
    return { icon: "🔴", label: "Esgotado", color: "bg-red-100 text-red-700" };
  } else if (stock <= 3) {
    return { icon: "🟠", label: "Restam poucas", color: "bg-orange-100 text-orange-700" };
  } else if (stock <= 5) {
    return { icon: "🟡", label: "Atenção", color: "bg-yellow-100 text-yellow-700" };
  }
  return null;
};

// Helper: Get sales ranking badge
const getSalesRankBadge = (index: number) => {
  if (index === 0) {
    return { icon: "🏆", label: "Mais vendido", color: "bg-yellow-100 text-yellow-700" };
  } else if (index === 1) {
    return { icon: "🥈", label: "Top venda", color: "bg-gray-100 text-gray-700" };
  } else if (index === 2) {
    return { icon: "🥉", label: "Destaque", color: "bg-orange-100 text-orange-700" };
  }
  return null;
};

const money = (value: number) => `R$ ${value.toFixed(2)}`;

const percentLabel = (value?: number) => {
  const safeValue = Number.isFinite(value) ? Number(value) : 0;
  return `${safeValue > 0 ? "+" : ""}${safeValue}%`;
};

const formatPremiumIndicatorValue = (value: number, kind: "currency" | "number" | "percent") => {
  if (kind === "currency") return money(value);
  if (kind === "percent") return `${value.toFixed(0)}%`;
  return value.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
};

const premiumToneClasses = {
  positive: "border-emerald-100 bg-emerald-50/70 text-emerald-700",
  negative: "border-rose-100 bg-rose-50/70 text-rose-700",
  neutral: "border-border/60 bg-white text-muted-foreground",
};

const directionSymbol = { up: "↑", down: "↓", flat: "→" };

export default function Dashboard() {
  // Call all hooks before any conditional returns
  const [, setLocation] = useLocation();
  const { onboarding_completed, loading: settingsLoading, settings, refresh: refreshSettings } = useUserSettings();
  const { products, loading: productsLoading, error: productsError } = useProductsData();
  const { sales, loading: salesLoading, error: salesError } = useSalesData();
  const { clients, loading: clientsLoading, error: clientsError } = useClientsLiteData();
  const dataLoading = productsLoading || salesLoading || clientsLoading;
  const dataError = productsError || salesError || clientsError;
  const showInsights = useFeatureEnabled("insights_enabled");
  const enableReferralProgram = useFeatureEnabled("referral_program_enabled");

  // Declare all state hooks here (billings, posts still from Firestore will be added later if needed)
  const [billings] = useState<any[]>([]);
  const [posts] = useState<any[]>([]);

  const [showFirstProductCTA, setShowFirstProductCTA] = useState<boolean>(false);
  const [monthlyGoalInput, setMonthlyGoalInput] = useState("10000");
  const [isSavingGoal, setIsSavingGoal] = useState(false);

  // Declare all effect hooks here
  useEffect(() => {
    if (!settingsLoading && !onboarding_completed) {
      setLocation("/onboarding");
    }
  }, [settingsLoading, onboarding_completed, setLocation]);

  // Handle first product CTA from onboarding - consume the query param once
  useEffect(() => {
    if (typeof window !== 'undefined' && !showFirstProductCTA) {
      const params = new URLSearchParams(window.location.search);
      const action = params.get('action');

      if (action === 'first_product') {
        // Mark CTA as shown
        setShowFirstProductCTA(true);

        // Remove the action param from URL to prevent re-triggering on refresh
        const newUrl = window.location.pathname + window.location.hash;
        window.history.replaceState({ path: newUrl }, '', newUrl);
      }
    }
  }, [showFirstProductCTA]);

  useEffect(() => {
    const configuredGoal = Number(
      (settings as typeof settings & { monthlyGoal?: number; monthlyRevenueGoal?: number; salesGoal?: number }).monthlyGoal ||
      (settings as typeof settings & { monthlyGoal?: number; monthlyRevenueGoal?: number; salesGoal?: number }).monthlyRevenueGoal ||
      (settings as typeof settings & { monthlyGoal?: number; monthlyRevenueGoal?: number; salesGoal?: number }).salesGoal ||
      10000
    );
    setMonthlyGoalInput(String(configuredGoal));
  }, [settings]);

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
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ ...settings, monthlyGoal: nextGoal }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      notifySuccess("Meta mensal salva.");
      refreshSettings();
    } catch (error) {
      console.error("[dashboard] Failed to save monthly goal:", error);
      notifyError("Erro ao salvar meta mensal.");
    } finally {
      setIsSavingGoal(false);
    }
  };

  // Declare all memo hooks here
  const productById = useMemo(() => createProductMap(products), [products]);

  const clientById = useMemo(() => createClientMap(clients), [clients]);

  const monthlyDashboardData = useMemo(
    () => calculateMonthlyMetrics(sales, productById),
    [sales, productById]
  );

  const monthMetrics = monthlyDashboardData.monthMetrics;

  const monthlyGoalTarget = Number(
    (settings as typeof settings & { monthlyGoal?: number; monthlyRevenueGoal?: number; salesGoal?: number }).monthlyGoal ||
    (settings as typeof settings & { monthlyGoal?: number; monthlyRevenueGoal?: number; salesGoal?: number }).monthlyRevenueGoal ||
    (settings as typeof settings & { monthlyGoal?: number; monthlyRevenueGoal?: number; salesGoal?: number }).salesGoal ||
    10000
  );

  const executiveSummary = useMemo(
    () => calculateExecutiveSummary(monthMetrics),
    [monthMetrics]
  );

  const monthlyGoal = useMemo(
    () => calculateMonthlyGoal(monthMetrics.revenue, monthlyGoalTarget),
    [monthMetrics.revenue, monthlyGoalTarget]
  );

  const monthlyComparison = useMemo(
    () => calculateMonthlyComparison(sales, productById),
    [sales, productById]
  );

  const monthlyProjection = useMemo(
    () => calculateMonthlyProjection(monthMetrics.revenue, monthMetrics.profit, monthlyGoalTarget),
    [monthMetrics.revenue, monthMetrics.profit, monthlyGoalTarget]
  );

  const businessInsights = useMemo(
    () => calculateBusinessInsights(products, sales, clients, productById),
    [products, sales, clients, productById]
  );

  const smartStock = useMemo(
    () => calculateStockMetrics(products, settings.lowStockThreshold),
    [products, settings.lowStockThreshold]
  );

  const stockExecutive = useMemo(
    () => calculateStockExecutiveMetrics(products, settings.lowStockThreshold),
    [products, settings.lowStockThreshold]
  );

  const premiumIndicators = useMemo(
    () => calculateDashboardPremiumIndicators(executiveSummary, monthlyGoal, stockExecutive),
    [executiveSummary, monthlyGoal, stockExecutive]
  );

  const inactiveClientCount = useMemo(
    () => calculateInactiveClientCount(clients, sales),
    [clients, sales]
  );

  const worstProduct = useMemo(
    () => calculateWorstProduct(products),
    [products]
  );

  // Smart Suggestions Logic - Prioritized & Actionable
  const insights = useMemo(
    () => calculateDashboardInsights({
      products,
      sales,
      clientById,
      lowStockThreshold: settings.lowStockThreshold,
      enableReferralProgram,
      icons: {
        AlertCircle,
        Zap,
        TrendingDown,
        Users,
        Share2,
      },
    }),
    [products, sales, clientById, settings.lowStockThreshold, enableReferralProgram]
  );

  // Compute derived values after all hooks
  const todayBillings = billings.filter(b => isToday(parseISO(b.dueDate)) && b.status !== 'paid');
  const todayPosts = posts.filter(p => isToday(parseISO(p.scheduledDate)) && p.status !== 'posted');

  // Top selling products in current month
  const topProducts = useMemo(
    () => calculateTopProducts(monthlyDashboardData.productQuantities, productById),
    [monthlyDashboardData.productQuantities, productById]
  );

  // Low stock alert products
  const lowStockProducts = useMemo(
    () => calculateLowStockProducts(products, settings.lowStockThreshold),
    [products, settings.lowStockThreshold]
  );

  const attentionItems = useMemo(
    () => calculateAttentionItems({
      lowStockCount: stockExecutive.lowStockCount,
      overdueChargesCount: billings.filter(b => parseISO(b.dueDate) < new Date() && b.status !== 'paid').length,
      inactiveClientCount,
      monthlyGoal,
    }),
    [billings, inactiveClientCount, monthlyGoal, stockExecutive.lowStockCount]
  );

  const comparisonCards = [
    { label: "Receita", value: money(monthlyComparison.revenue.current), previous: money(monthlyComparison.revenue.previous), change: monthlyComparison.revenue.changePercent, direction: monthlyComparison.revenue.direction },
    { label: "Lucro", value: money(monthlyComparison.profit.current), previous: money(monthlyComparison.profit.previous), change: monthlyComparison.profit.changePercent, direction: monthlyComparison.profit.direction },
    { label: "Produtos", value: String(monthlyComparison.productsSold.current), previous: String(monthlyComparison.productsSold.previous), change: monthlyComparison.productsSold.changePercent, direction: monthlyComparison.productsSold.direction },
    { label: "Clientes", value: String(monthlyComparison.activeClients.current), previous: String(monthlyComparison.activeClients.previous), change: monthlyComparison.activeClients.changePercent, direction: monthlyComparison.activeClients.direction },
  ];

  const commercialInsightCards = [
    { label: "Categoria mais lucrativa", value: businessInsights.mostProfitableCategory?.label || "Sem dados", detail: businessInsights.mostProfitableCategory ? money(businessInsights.mostProfitableCategory.profit) : "" },
    { label: "Marca mais lucrativa", value: businessInsights.mostProfitableBrand?.label || "Sem dados", detail: businessInsights.mostProfitableBrand ? money(businessInsights.mostProfitableBrand.profit) : "" },
    { label: "Maior faturamento", value: businessInsights.topRevenueCategory?.label || "Sem dados", detail: businessInsights.topRevenueCategory ? money(businessInsights.topRevenueCategory.revenue) : "" },
    { label: "Maior margem", value: businessInsights.highestMarginProduct?.product.name || "Sem dados", detail: businessInsights.highestMarginProduct ? `${businessInsights.highestMarginProduct.marginPercent}%` : "" },
    { label: "Menor margem", value: businessInsights.lowestMarginProduct?.product.name || "Sem dados", detail: businessInsights.lowestMarginProduct ? `${businessInsights.lowestMarginProduct.marginPercent}%` : "" },
    { label: "Mais cresceu", value: businessInsights.productMostGrew?.product.name || "Sem dados", detail: businessInsights.productMostGrew?.changePercent !== undefined ? percentLabel(businessInsights.productMostGrew.changePercent) : "" },
    { label: "Mais caiu", value: businessInsights.productMostDropped?.product.name || "Sem dados", detail: businessInsights.productMostDropped?.changePercent !== undefined ? percentLabel(businessInsights.productMostDropped.changePercent) : "" },
    { label: "Maior giro", value: businessInsights.highestTurnoverProduct?.product.name || "Sem dados", detail: businessInsights.highestTurnoverProduct ? `${businessInsights.highestTurnoverProduct.quantity} un` : "" },
    { label: "Menor giro", value: businessInsights.lowestTurnoverProduct?.product.name || "Sem dados", detail: businessInsights.lowestTurnoverProduct ? `${businessInsights.lowestTurnoverProduct.quantity} un` : "" },
  ];

  const quickActions = [
    { label: "Cadastrar produto", path: "/add-product", icon: Plus },
    { label: "Registrar venda", path: "/sale", icon: ShoppingCart },
    { label: "Nova cobrança", path: "/billings", icon: Receipt },
    { label: "Gerar anúncio", path: "/marketing", icon: Megaphone },
    { label: "Abrir catálogo", path: "/catalog", icon: BookOpen },
  ];

  // Show loading while checking onboarding status
  if (settingsLoading || dataLoading) {
    return <Layout><PageSkeleton variant="dashboard" /></Layout>;
  }

  // If not completed onboarding, don't render anything (will redirect above)
  if (!onboarding_completed) {
    return null;
  }

  // Show error if data failed to load
  if (dataError) {
    return (
      <Layout>
        <div className="p-6 text-center">
          <p className="text-destructive font-bold mb-2">Ocorreu um erro temporário.</p>
          <p className="text-muted-foreground text-sm mb-4">Não foi possível carregar seu resumo.</p>
          <button onClick={() => window.location.reload()} className="bg-primary text-white px-5 py-3 rounded-xl text-sm font-bold">Tentar novamente</button>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="px-6 pt-12 pb-6 bg-primary/5 rounded-b-[2.5rem] relative">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h1 className="text-xl font-semibold text-foreground">{settings.storeName}</h1>
            <p className="text-xs text-muted-foreground">Resumo deste mês</p>
          </div>
          {(todayBillings.length > 0 || todayPosts.length > 0) && (
            <div className="relative w-9 h-9 bg-white rounded-xl flex items-center justify-center border border-primary/20">
              <BellIcon className="w-4 h-4 text-primary" />
              <span className="absolute -top-1 -right-1 bg-primary text-white text-[9px] font-bold w-5 h-5 rounded-full flex items-center justify-center border-2 border-white">
                {todayBillings.length + todayPosts.length}
              </span>
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => setLocation("/monthly-sales")} className="bg-white p-3 rounded-2xl border border-border/50 text-left">
            <p className="text-[10px] text-muted-foreground font-medium">Vendas</p>
            <p className="text-base font-semibold">R$ {monthMetrics.revenue.toFixed(2)}</p>
          </button>
          <div className="bg-white p-3 rounded-2xl border border-border/50">
            <p className="text-[10px] text-muted-foreground font-medium">Lucro</p>
            <p className="text-base font-semibold text-green-600">R$ {monthMetrics.profit.toFixed(2)}</p>
          </div>
          <div className="bg-white p-3 rounded-2xl border border-border/50">
            <p className="text-[10px] text-muted-foreground font-medium">Clientes</p>
            <p className="text-base font-semibold">{monthMetrics.activeClients}</p>
          </div>
          <button onClick={() => setLocation("/products")} className="bg-white p-3 rounded-2xl border border-border/50 text-left">
            <p className="text-[10px] text-muted-foreground font-medium">Estoque baixo</p>
            <p className="text-base font-semibold text-orange-600">{lowStockProducts.length}</p>
          </button>
          <button onClick={() => setLocation("/products-sold")} className="col-span-2 bg-white p-3 rounded-2xl border border-amber-200 flex items-center gap-3 text-left">
            <div className="w-9 h-9 rounded-xl bg-amber-100 flex items-center justify-center text-lg">🏆</div>
            <div className="flex-1 min-w-0"><p className="text-[10px] text-amber-700 font-semibold">Campeão de vendas</p><p className="text-sm font-semibold truncate">{topProducts[0]?.product?.name || "Sem vendas no mês"}</p></div>
            <div className="text-right flex-shrink-0"><p className="text-xs font-semibold text-primary">{topProducts[0]?.quantity || 0} un</p><p className="text-[10px] text-muted-foreground">R$ {topProducts[0]?.revenue.toFixed(2) || "0,00"}</p></div>
          </button>
        </div>      </div>

      <div className="p-6 space-y-6">
        <section className="rounded-[2rem] border border-primary/10 bg-gradient-to-br from-white via-primary/5 to-rose-50 p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.16em] text-primary">Mini resumo executivo</p>
              <h2 className="mt-1 text-lg font-black tracking-tight text-foreground">Saúde comercial do mês</h2>
            </div>
            <span className="rounded-full bg-white px-3 py-1 text-[10px] font-bold text-muted-foreground shadow-sm">Premium 2.0</span>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {premiumIndicators.map((item) => (
              <div key={item.label} className={`rounded-2xl border p-4 shadow-sm ${premiumToneClasses[item.tone]}`}>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[10px] font-black uppercase tracking-wide opacity-80">{item.label}</p>
                  <span className="text-sm font-black">{directionSymbol[item.direction]}</span>
                </div>
                <p className="mt-2 text-lg font-black text-foreground">{formatPremiumIndicatorValue(item.value, item.kind)}</p>
                <p className="mt-1 text-[11px] font-semibold opacity-80">{item.detail}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="bg-white rounded-[2rem] border border-border/50 p-5 shadow-sm">
          <div className="flex items-center justify-between gap-3 mb-3">
            <h2 className="text-xs font-semibold text-primary flex items-center gap-2"><AlertCircle className="w-4 h-4" /> Atenção hoje</h2>
            <span className="text-[10px] text-muted-foreground font-semibold">Prioridades</span>
          </div>
          <div className="space-y-2">
            {attentionItems.map((item) => (
              <div key={item.label} className={`flex items-center gap-2 rounded-2xl px-3 py-2 text-xs font-semibold ${item.tone === "success" ? "bg-green-50 text-green-700" : "bg-amber-50 text-amber-700"}`}>
                <span>{item.tone === "success" ? "✅" : "⚠"}</span>
                <span>{item.label}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="grid grid-cols-1 lg:grid-cols-[1.1fr_1fr] gap-4">
          <div className="bg-white rounded-[2rem] border border-border/50 p-5 shadow-sm">
            <div className="flex items-start justify-between gap-4 mb-4">
              <div>
                <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wide">Meta mensal</p>
                <p className="text-2xl font-semibold mt-1">R$ {monthlyGoal.current.toLocaleString('pt-BR', { minimumFractionDigits: 0 })} <span className="text-sm text-muted-foreground">/ R$ {monthlyGoal.target.toLocaleString('pt-BR', { minimumFractionDigits: 0 })}</span></p>
              </div>
              <span className={`rounded-full px-3 py-1 text-xs font-bold ${monthlyGoal.color === "green" ? "bg-green-100 text-green-700" : monthlyGoal.color === "yellow" ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700"}`}>{monthlyGoal.percent}%</span>
            </div>
            <div className="h-3 rounded-full bg-secondary overflow-hidden">
              <div className={`h-full rounded-full transition-all ${monthlyGoal.color === "green" ? "bg-green-500" : monthlyGoal.color === "yellow" ? "bg-amber-500" : "bg-red-500"}`} style={{ width: `${monthlyGoal.percent}%` }} />
            </div>
            <div className="mt-4 grid grid-cols-[1fr_auto] gap-2">
              <input
                type="number"
                min="1"
                step="100"
                value={monthlyGoalInput}
                onChange={(event) => setMonthlyGoalInput(event.target.value)}
                className="min-w-0 rounded-2xl border border-border/60 bg-secondary/30 px-4 py-3 text-sm font-semibold outline-none focus:ring-2 focus:ring-primary/20"
                aria-label="Meta de vendas do mês"
              />
              <button
                type="button"
                onClick={() => void handleSaveMonthlyGoal()}
                disabled={isSavingGoal}
                className="rounded-2xl bg-primary px-4 py-3 text-xs font-semibold text-white disabled:opacity-60"
              >
                {isSavingGoal ? "Salvando..." : "Salvar"}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {[
              ["Receita", `R$ ${executiveSummary.revenue.toFixed(2)}`],
              ["Lucro", `R$ ${executiveSummary.profit.toFixed(2)}`],
              ["Produtos vendidos", String(executiveSummary.productsSold)],
              ["Ticket médio", `R$ ${executiveSummary.averageTicket.toFixed(2)}`],
              ["Clientes ativos", String(executiveSummary.activeClients)],
              ["Margem média", `${executiveSummary.averageMargin.toFixed(0)}%`],
            ].map(([label, value]) => (
              <div key={label} className="bg-white rounded-2xl border border-border/50 p-3 shadow-sm">
                <p className="text-[10px] text-muted-foreground font-medium">{label}</p>
                <p className="text-sm font-semibold mt-1">{value}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-xs font-semibold text-primary flex items-center gap-2"><TrendingUp className="w-4 h-4" /> Inteligência comercial</h2>
            <span className="text-[10px] font-semibold text-muted-foreground">Mês atual x anterior</span>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
            {comparisonCards.map((card) => (
              <div key={card.label} className="bg-white rounded-2xl border border-border/50 p-3 shadow-sm">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[10px] text-muted-foreground font-medium">{card.label}</p>
                  <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold ${card.direction === "up" ? "bg-green-100 text-green-700" : card.direction === "down" ? "bg-red-100 text-red-700" : "bg-secondary text-muted-foreground"}`}>{percentLabel(card.change)}</span>
                </div>
                <p className="text-sm font-semibold mt-1">{card.value}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">Anterior: {card.previous}</p>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
            <div className="bg-white rounded-2xl border border-border/50 p-3 shadow-sm"><p className="text-[10px] text-muted-foreground font-medium">Projeção faturamento</p><p className="text-sm font-semibold mt-1">{money(monthlyProjection.projectedRevenue)}</p></div>
            <div className="bg-white rounded-2xl border border-border/50 p-3 shadow-sm"><p className="text-[10px] text-muted-foreground font-medium">Projeção lucro</p><p className="text-sm font-semibold mt-1 text-green-600">{money(monthlyProjection.projectedProfit)}</p></div>
            <div className="bg-white rounded-2xl border border-border/50 p-3 shadow-sm"><p className="text-[10px] text-muted-foreground font-medium">Ritmo necessário</p><p className="text-sm font-semibold mt-1">{money(monthlyProjection.requiredDailyRevenue)}/dia</p></div>
            <div className="bg-white rounded-2xl border border-border/50 p-3 shadow-sm"><p className="text-[10px] text-muted-foreground font-medium">Meta atingida</p><p className="text-sm font-semibold mt-1 text-primary">{monthlyProjection.goalPercent}%</p><p className="text-[10px] text-muted-foreground">{monthlyProjection.daysRemaining} dias restantes</p></div>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            <div className="lg:col-span-2 bg-white rounded-[2rem] border border-border/50 p-5 shadow-sm">
              <h3 className="text-xs font-semibold text-primary mb-3 flex items-center gap-2"><Sparkles className="w-4 h-4" /> Insights automáticos</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {commercialInsightCards.map((card) => (
                  <div key={card.label} className="rounded-2xl bg-secondary/30 p-3 min-w-0">
                    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">{card.label}</p>
                    <p className="text-xs font-bold mt-1 truncate">{card.value}</p>
                    {card.detail && <p className="text-[10px] text-primary font-semibold mt-1">{card.detail}</p>}
                  </div>
                ))}
              </div>
            </div>
            <div className="bg-white rounded-[2rem] border border-border/50 p-5 shadow-sm space-y-3">
              <h3 className="text-xs font-semibold text-primary flex items-center gap-2"><Package className="w-4 h-4" /> Estoque inteligente</h3>
              <div className="rounded-2xl bg-secondary/30 p-3"><p className="text-[10px] text-muted-foreground">Valor total</p><p className="text-sm font-bold">{money(smartStock.totalInventoryValue)}</p></div>
              <div className="rounded-2xl bg-orange-50 p-3"><p className="text-[10px] text-orange-700">Estoque parado</p><p className="text-sm font-bold text-orange-700">{money(smartStock.stagnantInventoryValue)}</p></div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-2xl bg-red-50 p-3"><p className="font-bold text-red-700">{smartStock.outOfStockProducts.length}</p><p className="text-muted-foreground">Sem estoque</p></div>
                <div className="rounded-2xl bg-amber-50 p-3"><p className="font-bold text-amber-700">{smartStock.lowStockProducts.length}</p><p className="text-muted-foreground">Acabando</p></div>
              </div>
              <p className="text-[11px] text-muted-foreground">{smartStock.unsoldOver90Days.length} produto(s) sem venda há mais de 90 dias.</p>
            </div>
          </div>
        </section>

        <section className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
          {quickActions.map((action) => {
            const Icon = action.icon;
            return (
              <button key={action.path} onClick={() => setLocation(action.path)} className="rs-card-interactive bg-white rounded-2xl border border-border/50 p-4 text-left shadow-sm min-h-[88px] flex flex-col justify-between">
                <Icon className="w-5 h-5 text-primary" />
                <span className="text-xs font-semibold leading-tight">{action.label}</span>
              </button>
            );
          })}
        </section>

        <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="bg-white rounded-[2rem] border border-border/50 p-5 shadow-sm space-y-3">
            <h2 className="text-xs font-semibold text-primary flex items-center gap-2"><Package className="w-4 h-4" /> Estoque</h2>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-2xl bg-red-50 p-3"><p className="text-red-700 font-bold">{stockExecutive.outOfStockCount}</p><p className="text-muted-foreground">Sem estoque</p></div>
              <div className="rounded-2xl bg-amber-50 p-3"><p className="text-amber-700 font-bold">{stockExecutive.lowStockCount}</p><p className="text-muted-foreground">Acabando</p></div>
            </div>
            <div className="rounded-2xl bg-secondary/40 p-3 text-xs"><p className="text-muted-foreground">Valor parado em estoque</p><p className="font-semibold">R$ {stockExecutive.inventoryValue.toFixed(2)}</p></div>
            <div className="rounded-2xl bg-secondary/40 p-3 text-xs"><p className="text-muted-foreground">Maior estoque</p><p className="font-semibold truncate">{stockExecutive.highestStockProduct?.name || "Sem produtos"}</p></div>
          </div>

          <button onClick={() => setLocation("/products-sold")} className="bg-white rounded-[2rem] border border-amber-200 p-5 shadow-sm text-left space-y-3">
            <h2 className="text-xs font-semibold text-amber-700">🏆 Produto campeão</h2>
            <p className="text-base font-semibold truncate">{topProducts[0]?.product.name || "Sem vendas no mês"}</p>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div><p className="text-muted-foreground">Quantidade</p><p className="font-bold text-primary">{topProducts[0]?.quantity || 0} un</p></div>
              <div><p className="text-muted-foreground">Receita</p><p className="font-bold text-green-600">R$ {topProducts[0]?.revenue.toFixed(2) || "0,00"}</p></div>
            </div>
          </button>

          <button onClick={() => setLocation("/marketing")} className="bg-white rounded-[2rem] border border-border/50 p-5 shadow-sm text-left space-y-3">
            <h2 className="text-xs font-semibold text-orange-700">📉 Produto parado</h2>
            <p className="text-base font-semibold truncate">{worstProduct?.product.name || "Nenhum produto parado"}</p>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div><p className="text-muted-foreground">Sem vender</p><p className="font-bold">{worstProduct?.statusLabel || "—"}</p></div>
              <div><p className="text-muted-foreground">Estoque</p><p className="font-bold">{worstProduct?.product.stock || 0} un</p></div>
            </div>
            {worstProduct && <p className="text-[11px] text-muted-foreground">Considere fazer uma promoção.</p>}
          </button>
        </section>

        {/* First Product CTA - Show if triggered and not dismissed */}
        {showFirstProductCTA && (
          <div className="mb-8 p-5 bg-primary/5 rounded-[2rem] border-2 border-primary/30 space-y-4 animate-in fade-in slide-in-from-top-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 space-y-2">
                <h3 className="text-sm font-semibold text-primary flex items-center gap-2">
                  <Package className="w-5 h-5" /> Comece agora! 🚀
                </h3>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  Você está pronta! Cadastre seu primeiro produto agora e comece a vender. Leva menos de 1 minuto.
                </p>
              </div>
              <button
                onClick={() => setShowFirstProductCTA(false)}
                className="text-muted-foreground hover:text-foreground transition-colors active:scale-95"
                data-testid="button-dismiss-first-product-cta"
              >
                ✕
              </button>
            </div>
            <button
              onClick={() => setLocation("/add")}
              className="w-full bg-primary text-white font-semibold px-6 py-4 rounded-[2rem] text-xs flex items-center justify-center gap-2 active:scale-95 transition-all shadow-lg shadow-primary/20 hover:shadow-xl"
              data-testid="button-create-first-product"
            >
              <Package className="w-4 h-4" /> Criar Primeiro Produto
            </button>
          </div>
        )}

        {/* Smart Suggestions Section - Controlled by insights_enabled flag */}
        {showInsights && (
          <div className="mb-8 space-y-4">
            <h2 className="text-xs font-semibold text-primary flex items-center gap-2">
              <Sparkles className="w-3.5 h-3.5" /> Sugestões Inteligentes
            </h2>
            {insights.length > 0 ? (
            <div className="flex gap-4 overflow-x-auto pb-4 hide-scrollbar">
              {insights.map((insight, i) => (
                <div
                  key={i}
                  onClick={() => setLocation(insight.link)}
                  className={`min-w-[280px] p-5 rounded-[2rem] border bg-white shadow-sm flex flex-col gap-3 active:scale-95 transition-all cursor-pointer hover:shadow-md`}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      setLocation(insight.link);
                    }
                  }}
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-2xl flex items-center justify-center ${
                      insight.color === 'destructive' ? 'bg-destructive/10 text-destructive' :
                      insight.color === 'orange' ? 'bg-orange-100 text-orange-600' :
                      insight.color === 'primary' ? 'bg-primary/10 text-primary' : 'bg-green-100 text-green-600'
                    }`}>
                      <insight.icon className="w-5 h-5" />
                    </div>
                    <h3 className="text-xs font-bold leading-tight">{insight.title}</h3>
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">{insight.desc}</p>
                  <div className="flex items-center text-primary text-[10px] font-semibold mt-1">
                    {insight.action} <ArrowRight className="w-3 h-3 ml-2" />
                  </div>
                </div>
              ))}
            </div>
            ) : (
              <div className="bg-white p-6 rounded-[2rem] border border-dashed border-border/60 text-center">
                <p className="text-[11px] text-muted-foreground">Ainda não há dados suficientes para sugestões.</p>
              </div>
            )}
          </div>
        )}

        {/* Top Selling Products Section - Compact Premium */}
        {topProducts.length > 0 && (
          <div className="mb-8 space-y-4">
            <h2 className="text-xs font-semibold text-primary flex items-center gap-2">
              <TrendingUp className="w-3.5 h-3.5" /> Campeões de Venda
            </h2>
            <div className="flex gap-3 overflow-x-auto pb-2 hide-scrollbar -mx-6 px-6">
              {topProducts.map(({ product, quantity, revenue, profit }, index) => {
                const badge = getSalesRankBadge(index);
                return product ? (
                  <div
                    key={product.id}
                    className="min-w-[250px] bg-white rounded-2xl border border-border/50 shadow-sm overflow-hidden hover:shadow-md transition-all active:scale-95 flex items-center group"
                  >
                    {/* Image Container - Compacto */}
                    <div className="relative w-20 h-20 m-3 rounded-xl flex-shrink-0 bg-gradient-to-br from-primary/5 to-primary/10 flex items-center justify-center overflow-hidden group-hover:from-primary/10 group-hover:to-primary/15 transition-colors">
                      <ProductImageCard product={product} size="full" objectFit="contain" className="!rounded-none group-hover:scale-110 transition-transform duration-300" />

                      {/* Sales Rank Badge - Floating */}
                      {badge && (
                        <div className={`absolute top-2 right-2 ${badge.color} px-2 py-1 rounded-full text-[10px] font-bold flex items-center gap-1 shadow-md backdrop-blur-sm`}>
                          <span className="text-base leading-none">{badge.icon}</span>
                        </div>
                      )}
                    </div>

                    {/* Info Container - Compacto */}
                    <div className="p-3 pl-0 flex-1 min-w-0 flex flex-col justify-between">
                      <div className="min-h-[3rem] flex flex-col justify-center">
                        <p className="text-[10px] font-semibold text-primary mb-0.5 truncate">{product.brand}</p>
                        <p className="text-[10px] font-bold text-foreground truncate line-clamp-2">{product.name}</p>
                      </div>

                      {/* Stats Compactos */}
                      <div className="space-y-1 border-t border-border/30 pt-2">
                        <div className="flex justify-between items-center text-[9px]">
                          <span className="text-muted-foreground">Vendas</span>
                          <span className="font-bold text-primary">{quantity}x</span>
                        </div>
                        <div className="flex justify-between items-center text-[9px]">
                          <span className="text-muted-foreground">Faturamento</span>
                          <span className="font-bold text-green-600">R$ {revenue.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between items-center text-[9px]"><span className="text-muted-foreground">Lucro</span><span className="font-bold text-emerald-600">R$ {profit.toFixed(2)}</span></div>
                      </div>
                    </div>
                  </div>
                ) : null;
              })}
            </div>
          </div>
        )}

        {/* Low Stock Alerts Section - Premium Horizontal Scroll */}
        {lowStockProducts.length > 0 && (
          <div className="mb-8 space-y-4">
            <h2 className="text-xs font-semibold text-destructive flex items-center gap-2">
              <AlertCircle className="w-3.5 h-3.5" /> Estoque Baixo
            </h2>
            <div className="flex gap-3 overflow-x-auto pb-2 hide-scrollbar -mx-6 px-6">
              {lowStockProducts.map(product => {
                const badge = getStockBadge(product.stock);
                return (
                  <div
                    key={product.id}
                    className="min-w-[160px] bg-white rounded-[1.5rem] border border-destructive/20 shadow-sm overflow-hidden hover:shadow-md transition-all active:scale-95 flex flex-col"
                  >
                    {/* Image Container - Larger & Prominent */}
                    <div className="relative w-full aspect-square bg-gradient-to-br from-destructive/5 to-destructive/10 flex items-center justify-center overflow-hidden">
                      <ProductImageCard product={product} size="full" objectFit="contain" className="!rounded-none" />

                      {/* Stock Badge - Floating */}
                      {badge && (
                        <div className={`absolute top-2 right-2 ${badge.color} px-2 py-1 rounded-full text-[10px] font-bold flex items-center gap-1 shadow-sm`}>
                          <span>{badge.icon}</span>
                          <span className="hidden sm:inline">{badge.label}</span>
                        </div>
                      )}
                    </div>

                    {/* Info Container */}
                    <div className="p-3 flex-1 flex flex-col justify-between">
                      <div>
                        <p className="text-[10px] font-semibold text-primary mb-1 truncate">{product.brand}</p>
                        <p className="text-xs font-bold text-foreground truncate mb-2">{product.name}</p>
                      </div>

                      {/* Stats */}
                      <div className="space-y-1.5 border-t border-destructive/20 pt-2">
                        <div className="flex justify-between items-center">
                          <span className="text-[9px] text-muted-foreground">Estoque</span>
                          <span className="text-xs font-bold text-destructive">{product.stock} un</span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-[9px] text-muted-foreground">Preço</span>
                          <span className="text-xs font-bold text-foreground">R$ {product.salePrice.toFixed(0)}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
