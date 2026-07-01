import { useState, useMemo } from "react";
import { useLocation } from "wouter";
import { Layout } from "@/components/layout";
import { ChevronLeft, DollarSign, Package, PlusCircle } from "lucide-react";
import { useProductsData } from "@/hooks/useProductsData";
import { useSalesData } from "@/hooks/useSalesData";
import { parseISO } from "date-fns";

export default function MonthlySales() {
  const [, setLocation] = useLocation();
  const { products, loading: productsLoading, error: productsError } = useProductsData();
  const { sales, loading: salesLoading, error: salesError } = useSalesData();
  const loading = productsLoading || salesLoading;
  const error = productsError || salesError;

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
            <div className="rounded-[2rem] border border-dashed border-border/60 bg-white px-6 py-12 text-center flex flex-col items-center">
              <div className="mb-4 flex h-20 w-20 items-center justify-center rounded-[2rem] bg-primary/10">
                <Package className="h-9 w-9 text-primary/45" />
              </div>
              <p className="font-black text-foreground">Nenhuma venda neste mês</p>
              <p className="mt-2 max-w-[260px] text-xs leading-relaxed text-muted-foreground">Registre uma venda para acompanhar faturamento, produtos vendidos e estoque.</p>
              <button onClick={() => setLocation("/sale")} className="rs-pressable mt-5 flex items-center gap-2 rounded-2xl bg-primary px-5 py-3 text-xs font-black uppercase text-white"><PlusCircle className="h-4 w-4"/>Registrar venda</button>
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
