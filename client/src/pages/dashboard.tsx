import { useState, useEffect, useMemo } from "react";
import { PageSkeleton } from "@/components/PageSkeleton";
import { useLocation } from "wouter";
import { Layout } from "@/components/layout";
import { ProductImageCard } from "@/components/ProductImageCard";
import {
  TrendingUp, Package, AlertCircle, Zap, Share2,
  Sparkles, ArrowRight, TrendingDown, Users, Bell as BellIcon
} from "lucide-react";
import { isToday, parseISO } from "date-fns";
import { useUserSettings } from "@/providers/UserSettingsProvider";
import { useClientsLiteData } from "@/hooks/useClientsLiteData";
import { useProductsData } from "@/hooks/useProductsData";
import { useSalesData } from "@/hooks/useSalesData";
import { useFeatureEnabled } from "@/lib/remote-config-context";
import {
  calculateDashboardInsights,
  calculateLowStockProducts,
  calculateMonthlyMetrics,
  calculateTopProducts,
  createClientMap,
  createProductMap,
} from "@/lib/dashboard-metrics";

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

export default function Dashboard() {
  // Call all hooks before any conditional returns
  const [, setLocation] = useLocation();
  const { onboarding_completed, loading: settingsLoading, settings } = useUserSettings();
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

  // Declare all memo hooks here
  const productById = useMemo(() => createProductMap(products), [products]);

  const clientById = useMemo(() => createClientMap(clients), [clients]);

  const monthlyDashboardData = useMemo(
    () => calculateMonthlyMetrics(sales, productById),
    [sales, productById]
  );

  const monthMetrics = monthlyDashboardData.monthMetrics;

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

      <div className="p-6">
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
