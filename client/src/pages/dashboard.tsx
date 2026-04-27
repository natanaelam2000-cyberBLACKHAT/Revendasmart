import { useState, useEffect, useMemo } from "react";
import { useLocation } from "wouter";
import { 
  Product, APP_VERSION
} from "@/lib/mock-data";
import { Layout } from "@/components/layout";
import { ProductImageCard } from "@/components/ProductImageCard";
import { PlanStatusBadge } from "@/components/PlanStatusBadge";
import { 
  Search, TrendingUp, Package, AlertCircle, Filter, Zap, Share2, 
  Sparkles, ArrowRight, TrendingDown, Users, ShoppingCart, DollarSign, Bell as BellIcon
} from "lucide-react";
import { Link } from "wouter";
import { differenceInDays, isToday, parseISO } from "date-fns";
import { useUserSettings } from "@/hooks/useUserSettings";
import { useDashboardData } from "@/hooks/useDashboardData";
import { usePlanData } from "@/hooks/usePlanData";
import { getFirebaseAuth } from "@/lib/firebase";
import { useFeatureEnabled } from "@/lib/remote-config-context";

export default function Dashboard() {
  // Call all hooks before any conditional returns
  const [location, setLocation] = useLocation();
  const { onboarding_completed, loading: settingsLoading, settings } = useUserSettings();
  const { products, sales, clients, loading: dataLoading, error: dataError } = useDashboardData();
  const { hasPremiumAccess } = usePlanData();
  const showSalesDashboard = useFeatureEnabled("sales_dashboard_enabled");
  const showInsights = useFeatureEnabled("insights_enabled");
  const enableReferralProgram = useFeatureEnabled("referral_program_enabled");

  // Declare all state hooks here (billings, posts still from Firestore will be added later if needed)
  const [billings] = useState<any[]>([]);
  const [posts] = useState<any[]>([]);
  
  const [search, setSearch] = useState("");
  const [filterBrand, setFilterBrand] = useState<string>("All");
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
  const currentMonthSales = useMemo(() => {
    const now = new Date();
    return sales.filter(s => {
      const saleDate = parseISO(s.date);
      return saleDate.getMonth() === now.getMonth() && saleDate.getFullYear() === now.getFullYear();
    });
  }, [sales]);

  const monthMetrics = useMemo(() => {
    let totalRevenue = 0;
    let totalProfit = 0;
    let totalProducts = 0;

    currentMonthSales.forEach(sale => {
      totalRevenue += sale.totalPrice;
      sale.products.forEach((sp: any) => {
        totalProducts += sp.quantity;
        const product = products.find(p => p.id === sp.productId);
        if (product && product.costPrice) {
          totalProfit += (sp.price - product.costPrice) * sp.quantity;
        }
      });
    });

    return {
      revenue: totalRevenue,
      profit: totalProfit,
      products: totalProducts,
      activeClients: new Set(currentMonthSales.map(s => s.clientId)).size
    };
  }, [currentMonthSales, products]);

  const totalStockValue = products.reduce((acc, p) => acc + (p.costPrice * p.stock), 0);
  const totalExpectedProfit = products.reduce((acc, p) => acc + ((p.salePrice - p.costPrice) * p.stock), 0);
  
  // Smart Suggestions Logic - Prioritized & Actionable
  const insights = useMemo(() => {
    const list: { title: string, desc: string, icon: any, color: string, action: string, link: string, priority: number }[] = [];

    products.forEach(p => {
      // Low Stock (Priority 1 - highest urgency)
      if (p.stock > 0 && p.stock <= settings.lowStockThreshold) {
        list.push({
          title: "Alerta de Estoque Baixo",
          desc: `${p.name} tem apenas ${p.stock} unidades. Repor em breve?`,
          icon: AlertCircle,
          color: "destructive",
          action: "Ver Produto",
          link: "/products",
          priority: 1
        });
      }

      // Fast Selling (Priority 2 - high opportunity)
      if (p.lastSoldDate && differenceInDays(new Date(), parseISO(p.lastSoldDate)) <= 2 && p.stock < 5) {
        list.push({
          title: "Vendendo Rápido! 🔥",
          desc: `${p.name} está com alta saída. Considere aumentar o estoque.`,
          icon: Zap,
          color: "green",
          action: "Repor Agora",
          link: "/add",
          priority: 2
        });
      }

      // Stagnant products (Priority 3 - medium attention)
      if (p.lastSoldDate && differenceInDays(new Date(), parseISO(p.lastSoldDate)) >= 30) {
        list.push({
          title: "Produto Parado (+30 dias)",
          desc: `${p.name} não vende há um mês. Criar uma oferta?`,
          icon: TrendingDown,
          color: "orange",
          action: "Criar Promo",
          link: "/marketing",
          priority: 3
        });
      }
  });

  // Inactive Clients (Priority 4 - medium attention)
  clients.forEach(c => {
    const clientSales = sales.filter(s => s.clientId === c.id);
    const lastSale = clientSales.length > 0 
      ? clientSales.reduce((latest, s) => {
          const d = parseISO(s.date);
          return d > latest ? d : latest;
        }, new Date(0))
      : new Date(0);

    if (differenceInDays(new Date(), lastSale) >= 60) {
      list.push({
        title: "Cliente Inativo",
        desc: `${c.name} não compra há 60 dias. Que tal um "oi"?`,
        icon: Users,
        color: "primary",
        action: "Mensagem",
        link: "/clients",
        priority: 4
      });
    }
  });

  // Growth suggestion (only if referral_program_enabled)
  if (enableReferralProgram && products.length > 2) {
    list.push({
      title: "Crescimento Ligado!",
      desc: "Você está pronta para crescer. Ative programa de indicação.",
      icon: Share2,
      color: "primary",
      action: "Indicar",
      link: "/settings?tab=growth",
      priority: 5
    });
  }

  // Sort by priority, take top 4
  return list.sort((a, b) => a.priority - b.priority).slice(0, 4);
}, [products, settings, sales, clients]);

  // Compute derived values after all hooks
  const todayBillings = billings.filter(b => isToday(parseISO(b.dueDate)) && b.status !== 'paid');
  const todayPosts = posts.filter(p => isToday(parseISO(p.scheduledDate)) && p.status !== 'posted');
  
  const filteredProducts = products.filter(p => {
    const matchesSearch = p.name.toLowerCase().includes(search.toLowerCase());
    const matchesBrand = filterBrand === "All" || p.brand === filterBrand;
    return matchesSearch && matchesBrand;
  });

  const brands = ["All", ...Array.from(new Set(products.map(p => p.brand)))];

  // Top selling products in current month
  const topProducts = useMemo(() => {
    const productMetrics = new Map<string, number>();
    currentMonthSales.forEach(sale => {
      sale.products?.forEach((sp: any) => {
        const current = productMetrics.get(sp.productId) || 0;
        productMetrics.set(sp.productId, current + sp.quantity);
      });
    });

    return Array.from(productMetrics.entries())
      .map(([productId, qty]) => ({ product: products.find(p => p.id === productId), quantity: qty }))
      .filter(item => item.product)
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, 3);
  }, [currentMonthSales, products]);

  // Low stock alert products
  const lowStockProducts = useMemo(() => {
    return products
      .filter(p => p.stock > 0 && p.stock <= settings.lowStockThreshold)
      .sort((a, b) => a.stock - b.stock)
      .slice(0, 3);
  }, [products, settings.lowStockThreshold]);
const handleSubscribe = async () => {
  try {
    const user = getFirebaseAuth().currentUser;

    if (!user) {
      alert("Usuário não autenticado");
      return;
    }

    const token = await user.getIdToken();

    const res = await fetch(
      "https://revendasmart-backend-164193806378.us-central1.run.app/api/app-subscription/create",
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
        },
      }
    );

    const data = await res.json();

    if (data.checkoutUrl) {
      window.location.href = data.checkoutUrl;
    } else {
      console.error(data);
      alert("Erro ao iniciar pagamento");
    }
  } catch (err) {
    console.error(err);
    alert("Erro ao conectar com servidor");
  }
};
  // Total stock value and quantity
  const stockSummary = useMemo(() => {
    let totalValue = 0;
    let totalSaleValue = 0;
    let totalQuantity = 0;
    products.forEach(p => {
      totalValue += p.costPrice * p.stock;
      totalSaleValue += p.salePrice * p.stock;
      totalQuantity += p.stock;
    });
    return { totalValue, totalSaleValue, totalQuantity };
  }, [products]);

  // Show loading while checking onboarding status
  if (settingsLoading || dataLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center space-y-4">
          <div className="w-12 h-12 rounded-full border-4 border-primary/20 border-t-primary animate-spin mx-auto"></div>
          <p className="text-muted-foreground">Carregando...</p>
        </div>
      </div>
    );
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
          <p className="text-destructive font-bold mb-2">Erro ao carregar dados</p>
          <p className="text-muted-foreground text-sm">{dataError}</p>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="px-6 pt-12 pb-6 bg-primary/5 rounded-b-[2.5rem] relative">
        <div className="absolute top-4 right-6">
          <span className="text-[8px] font-black text-primary/40 uppercase tracking-widest">{APP_VERSION}</span>
        </div>
        
        {/* Plan Status Badge */}
        <div className="mb-6">
          <PlanStatusBadge />
          {hasPremiumAccess && <div className="mt-3 text-sm font-bold text-green-700" data-testid="text-premium-active">Premium ativo</div>}
        </div>
{!hasPremiumAccess && (
  <div className="mt-4 p-4 bg-green-50 border border-green-200 rounded-xl text-center">
    <p className="text-sm font-semibold text-green-800 mb-2">
      Desbloqueie todos os recursos 🚀
    </p>

    <button
      onClick={handleSubscribe}
      className="w-full bg-green-600 hover:bg-green-700 text-white font-bold py-3 rounded-xl shadow-md transition-all active:scale-95"
    >
      Assinar Premium por R$ {import.meta.env.VITE_PREMIUM_PRICE_BRL || "19,90"}
    </button>
  </div>
)}
        <div className="flex justify-between items-start mb-1">
          <div>
            <h1 className="text-2xl font-bold text-foreground">{settings.storeName}</h1>
            <p className="text-sm text-muted-foreground mb-6">Boas vendas, {settings.sellerName}!</p>
          </div>
          {(todayBillings.length > 0 || todayPosts.length > 0) && (
            <div className="relative">
              <div className="w-10 h-10 bg-white rounded-2xl flex items-center justify-center shadow-sm border border-primary/20">
                <BellIcon className="w-5 h-5 text-primary animate-pulse" />
              </div>
              <span className="absolute -top-1 -right-1 bg-primary text-white text-[10px] font-bold w-5 h-5 rounded-full flex items-center justify-center border-2 border-white">
                {todayBillings.length + todayPosts.length}
              </span>
            </div>
          )}
        </div>
        
        {showSalesDashboard && (
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div 
              onClick={() => setLocation("/monthly-sales")}
              className="bg-white p-4 rounded-3xl shadow-sm border border-border/50 cursor-pointer hover:shadow-md hover:border-primary/30 transition-all active:scale-95"
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  setLocation("/monthly-sales");
                }
              }}
              data-testid="card-monthly-sales"
            >
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center mb-3">
                <DollarSign className="w-4 h-4 text-primary" />
              </div>
              <p className="text-[10px] text-muted-foreground font-black uppercase mb-1">Vendas do Mês</p>
              <p className="text-lg font-bold">R$ {monthMetrics.revenue.toFixed(2)}</p>
            </div>
            <div className="bg-white p-4 rounded-3xl shadow-sm border border-border/50">
              <div className="w-8 h-8 rounded-full bg-green-500/10 flex items-center justify-center mb-3">
                <TrendingUp className="w-4 h-4 text-green-600" />
              </div>
              <p className="text-[10px] text-muted-foreground font-black uppercase mb-1">Lucro Estimado</p>
              <p className="text-lg font-bold text-green-600">R$ {monthMetrics.profit.toFixed(2)}</p>
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-4 mb-4">
          <div 
            onClick={() => setLocation("/products-sold")}
            className="bg-white p-4 rounded-3xl shadow-sm border border-border/50 cursor-pointer hover:shadow-md hover:border-primary/30 transition-all active:scale-95"
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                setLocation("/products-sold");
              }
            }}
            data-testid="card-products-sold"
          >
            <div className="w-8 h-8 rounded-full bg-orange-500/10 flex items-center justify-center mb-3">
              <ShoppingCart className="w-4 h-4 text-orange-600" />
            </div>
            <p className="text-[10px] text-muted-foreground font-black uppercase mb-1">Produtos Vendidos</p>
            <p className="text-lg font-bold">{monthMetrics.products}</p>
          </div>
          <div className="bg-white p-4 rounded-3xl shadow-sm border border-border/50">
            <div className="w-8 h-8 rounded-full bg-blue-500/10 flex items-center justify-center mb-3">
              <Users className="w-4 h-4 text-blue-600" />
            </div>
            <p className="text-[10px] text-muted-foreground font-black uppercase mb-1">Clientes Ativos</p>
            <p className="text-lg font-bold">{monthMetrics.activeClients}</p>
          </div>
          <div className="bg-white p-4 rounded-3xl shadow-sm border border-border/50">
            <div className="w-8 h-8 rounded-full bg-purple-500/10 flex items-center justify-center mb-3">
              <Package className="w-4 h-4 text-purple-600" />
            </div>
            <p className="text-[10px] text-muted-foreground font-black uppercase mb-2">Estoque Total</p>
            <p className="text-lg font-bold text-purple-600 mb-1">R$ {stockSummary.totalSaleValue.toFixed(2)}</p>
            <div className="space-y-0.5 text-[11px] text-muted-foreground">
              <div className="flex justify-between">
                <span>Custo:</span>
                <span className="font-semibold">R$ {stockSummary.totalValue.toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span>Itens:</span>
                <span className="font-semibold">{stockSummary.totalQuantity} un</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="p-6">
        {/* First Product CTA - Show if triggered and not dismissed */}
        {showFirstProductCTA && (
          <div className="mb-8 p-5 bg-primary/5 rounded-[2rem] border-2 border-primary/30 space-y-4 animate-in fade-in slide-in-from-top-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 space-y-2">
                <h3 className="text-sm font-black text-primary uppercase tracking-widest flex items-center gap-2">
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
              className="w-full bg-primary text-white font-black px-6 py-4 rounded-[2rem] uppercase text-xs flex items-center justify-center gap-2 active:scale-95 transition-all shadow-lg shadow-primary/20 hover:shadow-xl"
              data-testid="button-create-first-product"
            >
              <Package className="w-4 h-4" /> Criar Primeiro Produto
            </button>
          </div>
        )}

        {/* Smart Suggestions Section - Controlled by insights_enabled flag */}
        {showInsights && (
          <div className="mb-8 space-y-4">
            <h2 className="text-[10px] font-black text-primary uppercase tracking-[0.2em] flex items-center gap-2">
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
                  <div className="flex items-center text-primary text-[10px] font-black uppercase tracking-widest mt-1">
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

        {/* Top Selling Products Section */}
        {products.length === 0 ? (
          <div className="mb-8 bg-white p-8 rounded-[2rem] border border-dashed border-border/60 text-center space-y-4" data-testid="empty-state-no-products">
            <div className="w-16 h-16 bg-primary/10 rounded-2xl flex items-center justify-center mx-auto">
              <Package className="w-8 h-8 text-primary/40" />
            </div>
            <div>
              <p className="font-bold text-foreground mb-1">Nenhum produto cadastrado</p>
              <p className="text-[11px] text-muted-foreground">Comece adicionando seus produtos para ver as análises aqui</p>
            </div>
          </div>
        ) : topProducts.length > 0 ? (
          <div className="mb-8 space-y-4">
            <h2 className="text-[10px] font-black text-primary uppercase tracking-[0.2em] flex items-center gap-2">
              <TrendingUp className="w-3.5 h-3.5" /> Campeões de Venda
            </h2>
            <div className="space-y-3">
              {topProducts.map(({ product, quantity }) => product && (
                <div key={product.id} className="bg-white p-4 rounded-2xl border border-border/50 shadow-sm flex gap-3 items-start">
                  <ProductImageCard product={product} size="md" />
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] font-black text-primary uppercase mb-1">{product.brand}</p>
                    <p className="text-sm font-bold truncate mb-1">{product.name}</p>
                    <p className="text-xs text-muted-foreground">{quantity}x vendido</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-sm font-bold">R$ {(product.salePrice * quantity).toFixed(2)}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {/* Low Stock Alerts Section */}
        {lowStockProducts.length > 0 && (
          <div className="mb-8 space-y-4">
            <h2 className="text-[10px] font-black text-destructive uppercase tracking-[0.2em] flex items-center gap-2">
              <AlertCircle className="w-3.5 h-3.5" /> Estoque Baixo
            </h2>
            <div className="space-y-3">
              {lowStockProducts.map(product => (
                <div key={product.id} className="bg-white p-4 rounded-2xl border border-destructive/20 shadow-sm flex gap-3 items-start">
                  <ProductImageCard product={product} size="md" />
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] font-black text-primary uppercase mb-1">{product.brand}</p>
                    <p className="text-sm font-bold truncate mb-1">{product.name}</p>
                    <p className="text-xs text-destructive font-semibold">{product.stock} un</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <span className="text-[10px] font-bold bg-destructive/10 text-destructive px-2 py-1 rounded-full">Repor!</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex gap-3 mb-6">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input 
              type="text" 
              placeholder="Buscar no estoque..." 
              className="w-full bg-white border border-border rounded-full py-3 pl-11 pr-4 text-sm focus:outline-none"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="bg-white border border-border rounded-full h-[46px] w-[46px] flex items-center justify-center relative">
            <Filter className="w-4 h-4" />
            <select className="absolute inset-0 opacity-0" value={filterBrand} onChange={(e) => setFilterBrand(e.target.value)}>
              {brands.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>
        </div>

        <div className="space-y-4">
          {filteredProducts.map(product => (
            <div key={product.id} className="bg-white p-3 rounded-3xl flex gap-4 shadow-sm border border-border/40 items-center">
              <ProductImageCard product={product} size="md" />
              <div className="flex-1 min-w-0">
                <div className="flex justify-between items-start mb-1">
                  <span className="text-[10px] font-black text-primary tracking-wider uppercase">{product.brand}</span>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${product.stock <= settings.lowStockThreshold ? 'bg-destructive/10 text-destructive' : 'bg-green-100 text-green-700'}`}>
                    {product.stock} un
                  </span>
                </div>
                <h3 className="text-sm font-bold truncate mb-1">{product.name}</h3>
                <div className="flex items-end gap-2">
                  <span className="text-sm font-black">R$ {product.salePrice.toFixed(2)}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </Layout>
  );
}
