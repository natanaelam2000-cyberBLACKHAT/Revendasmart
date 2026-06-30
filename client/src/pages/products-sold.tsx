import { useState, useMemo } from "react";
import { useLocation } from "wouter";
import { Layout } from "@/components/layout";
import { ProductImageCard } from "@/components/ProductImageCard";
import { ChevronLeft, Package, PlusCircle } from "lucide-react";
import { useDashboardData } from "@/hooks/useDashboardData";
import { parseISO } from "date-fns";

export default function ProductsSold() {
  const [, setLocation] = useLocation();
  const { products, sales, loading, error } = useDashboardData();

  // Aggregate products sold in current month
  const productsSoldMetrics = useMemo(() => {
    const now = new Date();
    const monthSales = sales.filter(s => {
      const saleDate = parseISO(s.date);
      return saleDate.getMonth() === now.getMonth() && saleDate.getFullYear() === now.getFullYear();
    });

    const metricsMap = new Map<string, { quantity: number; revenue: number }>();

    monthSales.forEach(sale => {
      sale.products?.forEach((sp: any) => {
        const existing = metricsMap.get(sp.productId) || { quantity: 0, revenue: 0 };
        metricsMap.set(sp.productId, {
          quantity: existing.quantity + sp.quantity,
          revenue: existing.revenue + (sp.quantity * sp.price)
        });
      });
    });

    return Array.from(metricsMap.entries())
      .map(([productId, metrics]) => {
        const product = products.find(p => p.id === productId);
        return {
          ...product,
          quantitySold: metrics.quantity,
          totalRevenue: metrics.revenue
        };
      })
      .filter(p => p && p.quantitySold > 0)
      .sort((a, b) => b.quantitySold - a.quantitySold);
  }, [sales, products]);

  if (loading) {
    return (
      <Layout>
        <div className="flex flex-col items-center justify-center py-12">
          <div className="w-12 h-12 rounded-full border-4 border-primary/20 border-t-primary animate-spin"></div>
          <p className="text-muted-foreground mt-4">Carregando produtos vendidos...</p>
        </div>
      </Layout>
    );
  }

  if (error) {
    return (
      <Layout>
        <div className="p-6 text-center">
          <p className="text-destructive font-bold mb-2">Erro ao carregar dados</p>
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
          <h1 className="text-2xl font-bold">Produtos Vendidos</h1>
        </div>

        {/* Products List */}
        <div className="space-y-3 pb-8">
          {productsSoldMetrics.length === 0 ? (
            <div className="rounded-[2rem] border border-dashed border-border/60 bg-white px-6 py-12 text-center flex flex-col items-center">
              <div className="mb-4 flex h-20 w-20 items-center justify-center rounded-[2rem] bg-primary/10">
                <Package className="h-9 w-9 text-primary/45" />
              </div>
              <p className="font-black text-foreground">Nenhum produto vendido neste mês</p>
              <p className="mt-2 max-w-[260px] text-xs leading-relaxed text-muted-foreground">Assim que uma venda for registrada, seus campeões do mês aparecerão aqui.</p>
              <button onClick={() => setLocation("/sale")} className="rs-pressable mt-5 flex items-center gap-2 rounded-2xl bg-primary px-5 py-3 text-xs font-black uppercase text-white"><PlusCircle className="h-4 w-4"/>Registrar venda</button>
            </div>
          ) : (
            productsSoldMetrics.map((product) => (
              <div
                key={product.id}
                className="bg-white p-4 rounded-2xl border border-border/50 shadow-sm flex gap-4 items-start"
                data-testid={`card-product-sold-${product.id}`}
              >
                <ProductImageCard product={product} size="md" />
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-foreground text-sm mb-1" data-testid={`text-product-name-${product.id}`}>
                    {product.name}
                  </p>
                  <p className="text-[12px] text-muted-foreground mb-2">
                    <span data-testid={`text-qty-${product.id}`}>{product.quantitySold}x vendido</span>
                  </p>
                  <p className="text-lg font-bold text-primary" data-testid={`text-revenue-${product.id}`}>
                    R$ {product.totalRevenue.toFixed(2)}
                  </p>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </Layout>
  );
}
