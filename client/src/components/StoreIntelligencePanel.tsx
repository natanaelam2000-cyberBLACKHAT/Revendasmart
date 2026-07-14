import { useMemo } from "react";
import type { AppSettings, Client, Product, Sale } from "@/lib/mock-data";
import { buildStoreIntelligence } from "@/lib/store-health";

interface StoreIntelligencePanelProps {
  products: Product[];
  clients: Client[];
  sales: Sale[];
  settings: AppSettings;
  lowStockThreshold?: number;
  formatMoney: (value: number) => string;
  onNavigate: (path: string) => void;
}

export default function StoreIntelligencePanel({ products, clients, sales, settings, lowStockThreshold, formatMoney, onNavigate }: StoreIntelligencePanelProps) {
  const data = useMemo(
    () => buildStoreIntelligence({ products, clients, sales, settings, lowStockThreshold }),
    [products, clients, sales, settings, lowStockThreshold]
  );
  const toneClass = data.health.tone === "success" ? "bg-emerald-100 text-emerald-700" : data.health.tone === "warning" ? "bg-amber-100 text-amber-700" : "bg-rose-100 text-rose-700";
  const cards = [
    ["Produto campeao", data.products.topSoldProduct?.product.name || "Sem vendas"],
    ["Cliente VIP", data.customers.vipClient?.client.name || "Sem historico"],
    ["Receita hoje", formatMoney(data.financial.todayRevenue)],
    ["Catalogo", data.catalog.active ? "Ativo" : "Pendente"],
  ];

  return (
    <section className="rounded-[2rem] border bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.16em] text-primary">Saude da loja</p>
          <h2 className="mt-1 text-3xl font-black">{data.health.score}<span className="text-base text-muted-foreground">/100</span></h2>
          <p className="text-xs text-muted-foreground">{data.health.label} - BI automatico com dados ja carregados.</p>
        </div>
        <span className={`rounded-full px-3 py-1 text-[10px] font-bold ${toneClass}`}>Sem IA - regras deterministicas</span>
      </div>
      <div className="mt-4 h-3 overflow-hidden rounded-full bg-secondary"><div className="h-full rounded-full bg-primary" style={{ width: `${data.health.score}%` }} /></div>
      <div className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
        {cards.map(([label, value]) => <div key={label} className="rounded-2xl bg-secondary/40 p-3"><p className="text-[10px] text-muted-foreground">{label}</p><p className="truncate text-xs font-black">{value}</p></div>)}
      </div>
      <div className="mt-4 grid gap-2 lg:grid-cols-3">
        {data.recommendations.slice(0, 3).map((item) => <button key={item.title} type="button" onClick={() => onNavigate(item.path)} className="rounded-2xl border px-3 py-2 text-left active:scale-[0.99]"><p className="text-xs font-black">{item.title}</p><p className="text-[11px] text-muted-foreground">{item.detail}</p></button>)}
      </div>
      <p className="mt-3 text-[10px] text-muted-foreground">Cobrancas nao entram neste score para nao criar novas leituras no Dashboard.</p>
    </section>
  );
}
