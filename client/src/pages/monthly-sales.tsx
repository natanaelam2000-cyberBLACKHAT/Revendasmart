import { useState, useMemo } from "react";
import { useLocation } from "wouter";
import { Layout } from "@/components/layout";
import { ChevronLeft, DollarSign, Package } from "lucide-react";
import { useDashboardData } from "@/hooks/useDashboardData";
import { parseISO } from "date-fns";

export default function MonthlySales() {
  const [, setLocation] = useLocation();
  const { products, sales, loading, error } = useDashboardData();

  // Filter sales for current month
  const currentMonthSales = useMemo(() => {
    const now = new Date();
    return sales.filter(s => {
      const saleDate = parseISO(s.date);
      return saleDate.getMonth() === now.getMonth() && saleDate.getFullYear() === now.getFullYear();
    }).sort((a, b) => parseISO(b.date).getTime() - parseISO(a.date).getTime());
  }, [sales]);

  // Calculate metrics
  const monthMetrics = useMemo(() => {
    let totalRevenue = 0;
    let totalProductCount = 0;

    currentMonthSales.forEach(sale => {
      totalRevenue += sale.totalPrice;
      sale.products?.forEach((sp: any) => {
        totalProductCount += sp.quantity;
      });
    });

    return {
      revenue: totalRevenue,
      transactionCount: currentMonthSales.length,
      productCount: totalProductCount
    };
  }, [currentMonthSales]);

  const getProductName = (productId: string): string => {
    const product = products.find(p => p.id === productId);
    return product?.name || "Produto desconhecido";
  };

  if (loading) {
    return (
      <Layout>
        <div className="flex flex-col items-center justify-center py-12">
          <div className="w-12 h-12 rounded-full border-4 border-primary/20 border-t-primary animate-spin"></div>
          <p className="text-muted-foreground mt-4">Carregando vendas...</p>
        </div>
      </Layout>
    );
  }

  if (error) {
    return (
      <Layout>
        <div className="p-6 text-center">
          <p className="text-destructive font-bold mb-2">Erro ao carregar vendas</p>
          <p className="text-muted-foreground text-sm">{error}</p>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="px-6 pt-6 pb-4">
        <div className="flex items-center gap-3 mb-6">
          <button
            onClick={() => setLocation("/")}
            className="flex items-center justify-center w-10 h-10 rounded-2xl bg-white border border-border/50 hover:bg-primary/5 transition-all"
            data-testid="button-back"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <h1 className="text-2xl font-bold">Vendas do Mês</h1>
        </div>

        {/* Summary Card */}
        <div className="bg-gradient-to-br from-primary to-primary/80 text-white p-6 rounded-3xl mb-6 shadow-md">
          <div className="flex justify-between items-start mb-6">
            <div>
              <p className="text-white/80 text-[10px] font-black uppercase mb-2">Total do Mês</p>
              <p className="text-4xl font-black">R$ {monthMetrics.revenue.toFixed(2)}</p>
            </div>
            <div className="w-14 h-14 bg-white/20 rounded-2xl flex items-center justify-center">
              <DollarSign className="w-7 h-7" />
            </div>
          </div>
          <div className="flex gap-4">
            <div>
              <p className="text-white/60 text-[9px] uppercase font-bold">Transações</p>
              <p className="text-2xl font-bold">{monthMetrics.transactionCount}</p>
            </div>
            <div>
              <p className="text-white/60 text-[9px] uppercase font-bold">Produtos</p>
              <p className="text-2xl font-bold">{monthMetrics.productCount}</p>
            </div>
          </div>
        </div>

        {/* Sales List */}
        <div className="space-y-4 pb-8">
          {currentMonthSales.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Package className="w-12 h-12 mx-auto opacity-20 mb-2" />
              <p>Nenhuma venda neste mês</p>
            </div>
          ) : (
            currentMonthSales.map((sale) => (
              <div key={sale.id} className="bg-white p-4 rounded-2xl border border-border/50 shadow-sm">
                {/* Sale Header */}
                <div className="flex justify-between items-start mb-4 pb-4 border-b border-border/30">
                  <div>
                    <p className="font-bold text-foreground text-sm mb-1" data-testid={`text-client-${sale.clientId}`}>
                      {sale.clientName || "Cliente"}
                    </p>
                    <p className="text-[12px] text-muted-foreground" data-testid={`text-date-${sale.id}`}>
                      {new Date(sale.date).toLocaleDateString("pt-BR")} às{" "}
                      {new Date(sale.date).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-bold text-primary" data-testid={`text-total-${sale.id}`}>
                      R$ {sale.totalPrice.toFixed(2)}
                    </p>
                  </div>
                </div>

                {/* Products Section */}
                <div>
                  <p className="text-[10px] font-black uppercase text-muted-foreground mb-3">
                    Produtos ({sale.products?.length || 0})
                  </p>
                  <div className="space-y-2">
                    {sale.products?.map((sp: any, idx: number) => (
                      <div key={idx} className="flex justify-between items-center text-sm">
                        <div>
                          <p className="font-medium text-foreground" data-testid={`text-product-${sale.id}-${idx}`}>
                            {getProductName(sp.productId)}
                          </p>
                          <p className="text-[12px] text-muted-foreground" data-testid={`text-qty-${sale.id}-${idx}`}>
                            {sp.quantity}x R$ {(sp.price).toFixed(2)}
                          </p>
                        </div>
                        <p className="font-bold" data-testid={`text-subtotal-${sale.id}-${idx}`}>
                          R$ {(sp.quantity * sp.price).toFixed(2)}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </Layout>
  );
}
