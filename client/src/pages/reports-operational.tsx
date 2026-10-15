import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  Boxes,
  CalendarDays,
  Crown,
  DollarSign,
  Package,
  PieChart as PieChartIcon,
  TrendingUp,
  Users,
} from "lucide-react";
import type {
  ComparisonMetric,
  RankingItem,
  ReportCharts,
  ReportComparisons,
  ReportIndicators,
  ReportRankings,
} from "@/lib/report-metrics";
import { formatCurrency, formatDecimal, SummaryCard } from "./reports";

const COLORS = ["#ec4899", "#f43f5e", "#fb7185", "#fda4af", "#be5363", "#9f4150"];

// RC-04 P0/P1-01 — o tooltip padrão do Recharts usa background branco fixo via inline style da própria
// lib (não é classe Tailwind, então a regra global `.dark .bg-white` não alcança). `contentStyle` vira
// inline style de verdade, então usar var(--x) aqui resolve contra o token ativo no momento do hover —
// acompanha claro/escuro sem precisar recriar o objeto quando o tema muda.
const RECHARTS_TOOLTIP_STYLE = {
  backgroundColor: "hsl(var(--card))",
  borderColor: "hsl(var(--border))",
  borderRadius: "0.75rem",
  color: "hsl(var(--foreground))",
  fontSize: "12px",
} as const;

function ComparisonCard({ item }: { item: ComparisonMetric }) {
  const isDown = item.direction === "down";
  const Icon = isDown ? ArrowDownRight : ArrowUpRight;
  const tone = item.direction === "flat" ? "text-muted-foreground bg-secondary" : isDown ? "text-rose-600 bg-rose-50" : "text-emerald-600 bg-emerald-50";
  return (
    <div className="rounded-[1.5rem] border border-border/50 bg-white p-4 shadow-sm">
      <p className="text-xs font-black text-foreground">{item.label}</p>
      <div className="mt-3 flex items-center justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold text-muted-foreground">Atual</p>
          <p className="text-base font-black text-foreground">{formatCurrency(item.current)}</p>
        </div>
        <div className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-black ${tone}`}>
          <Icon className="h-3.5 w-3.5" />
          {item.changePercent}%
        </div>
      </div>
      <p className="mt-2 text-[11px] font-semibold text-muted-foreground">Anterior: {formatCurrency(item.previous)}</p>
    </div>
  );
}

function RankingList({ title, icon: Icon, items, valueType }: { title: string; icon: typeof Crown; items: RankingItem[]; valueType: "quantity" | "profit" | "revenue" | "sales" }) {
  const formatValue = (item: RankingItem) => {
    if (valueType === "quantity") return `${formatDecimal(item.quantity, 0)} un.`;
    if (valueType === "sales") return `${item.salesCount} compra${item.salesCount === 1 ? "" : "s"}`;
    return formatCurrency(valueType === "profit" ? item.profit : item.revenue);
  };

  return (
    <section className="rounded-[2rem] border border-border/50 bg-white p-4 shadow-sm">
      <div className="mb-4 flex items-center gap-2">
        <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-primary/10 text-primary"><Icon className="h-4 w-4" /></span>
        <h3 className="text-sm font-black text-foreground">{title}</h3>
      </div>
      {items.length === 0 ? (
        <p className="rounded-2xl bg-secondary/40 p-4 text-center text-xs font-semibold text-muted-foreground">Sem dados suficientes.</p>
      ) : (
        <div className="space-y-2">
          {items.slice(0, 5).map((item, index) => (
            <div key={`${title}-${item.id}-${index}`} className="flex items-center justify-between gap-3 rounded-2xl bg-secondary/30 px-3 py-3">
              <div className="min-w-0">
                <p className="truncate text-xs font-black text-foreground">{index + 1}. {item.label}</p>
                <p className="text-[10px] font-semibold text-muted-foreground">{formatDecimal(item.quantity, 0)} itens · {formatCurrency(item.revenue)}</p>
              </div>
              <span className="shrink-0 text-xs font-black text-primary">{formatValue(item)}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * PLAN-IMPL-07B-VERIFY-FINAL §31 — bloco OPERATIONAL (comparativos/gráficos/rankings/estoque/export)
 * extraído para chunk lazy-loaded (React.lazy em reports.tsx): é a maior fatia de JSX da rota, só
 * renderiza para Pro/Premium, e o profit-safety fix (report-metrics.ts) já deixou a rota sem folga de
 * budget. Free nunca baixa este chunk. Nenhuma mudança de layout/comportamento — mesmo JSX de antes,
 * só movido de arquivo.
 */
export default function OperationalSection({ comparisons, charts, rankings, indicators }: {
  comparisons: ReportComparisons;
  charts: ReportCharts;
  rankings: ReportRankings;
  indicators: ReportIndicators;
}) {
  return (
    <>
      <section className="space-y-3">
        <h2 className="text-lg font-black text-foreground">Comparativos</h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <ComparisonCard item={comparisons.today} />
          <ComparisonCard item={comparisons.week} />
          <ComparisonCard item={comparisons.month} />
          <ComparisonCard item={comparisons.year} />
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
        <div className="rounded-[2rem] border border-border/50 bg-white p-4 sm:p-6 shadow-sm">
          <div className="mb-5 flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-primary/10 text-primary"><TrendingUp className="h-4 w-4" /></span>
            <h3 className="text-sm font-black text-foreground">Receita e lucro por mês</h3>
          </div>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={charts.revenueByMonth}>
                <defs>
                  <linearGradient id="revenueGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#ec4899" stopOpacity={0.28} />
                    <stop offset="95%" stopColor="#ec4899" stopOpacity={0.02} />
                  </linearGradient>
                  <linearGradient id="profitGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="label" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                <Tooltip formatter={(value: number) => formatCurrency(value)} contentStyle={RECHARTS_TOOLTIP_STYLE} />
                <Area type="monotone" dataKey="revenue" name="Receita" stroke="#ec4899" fill="url(#revenueGradient)" strokeWidth={3} />
                <Area type="monotone" dataKey="profit" name="Lucro" stroke="#10b981" fill="url(#profitGradient)" strokeWidth={3} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-[2rem] border border-border/50 bg-white p-4 shadow-sm sm:p-5">
          <div className="mb-3 flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-primary/10 text-primary"><PieChartIcon className="h-4 w-4" /></span>
            <h3 className="text-sm font-black text-foreground">Vendas por categoria</h3>
          </div>
          <div className="h-56 sm:h-60">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={charts.salesByCategory} dataKey="revenue" nameKey="name" innerRadius={46} outerRadius={74} paddingAngle={4}>
                  {charts.salesByCategory.map((entry, index) => <Cell key={entry.name} fill={COLORS[index % COLORS.length]} />)}
                </Pie>
                <Tooltip formatter={(value: number) => formatCurrency(value)} contentStyle={RECHARTS_TOOLTIP_STYLE} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        <RankingList title="Produtos mais vendidos" icon={Package} items={rankings.topSellingProducts} valueType="quantity" />
        <RankingList title="Produtos mais lucrativos" icon={TrendingUp} items={rankings.mostProfitableProducts} valueType="profit" />
        <RankingList title="Categorias mais lucrativas" icon={PieChartIcon} items={rankings.mostProfitableCategories} valueType="profit" />
        <RankingList title="Marcas mais lucrativas" icon={Crown} items={rankings.mostProfitableBrands} valueType="profit" />
        <RankingList title="Clientes que mais compraram" icon={Users} items={rankings.clientsByPurchases} valueType="sales" />
        <RankingList title="Clientes que mais gastaram" icon={DollarSign} items={rankings.clientsByRevenue} valueType="revenue" />
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-[2rem] border border-border/50 bg-white p-4 shadow-sm sm:p-5">
          <div className="mb-3 flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-primary/10 text-primary"><BarChart3 className="h-4 w-4" /></span>
            <h3 className="text-sm font-black text-foreground">Top 10 produtos</h3>
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={charts.topProducts} layout="vertical" margin={{ left: 8, right: 8 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
                <XAxis type="number" hide />
                <YAxis dataKey="name" type="category" width={124} tick={{ fontSize: 10 }} tickFormatter={(value) => String(value).length > 20 ? `${String(value).slice(0, 20)}?` : String(value)} />
                <Tooltip formatter={(value: number) => formatCurrency(value)} labelFormatter={(label) => String(label)} contentStyle={RECHARTS_TOOLTIP_STYLE} />
                <Bar dataKey="revenue" name="Receita" fill="#ec4899" radius={[0, 10, 10, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-[2rem] border border-border/50 bg-white p-4 sm:p-6 shadow-sm">
          <div className="mb-5 flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-primary/10 text-primary"><Boxes className="h-4 w-4" /></span>
            <h3 className="text-sm font-black text-foreground">Indicadores de estoque</h3>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <SummaryCard title="Qtd. média/venda" value={formatDecimal(indicators.averageQuantityPerSale)} />
            <SummaryCard title="Estoque médio" value={formatCurrency(indicators.averageInventoryValue)} />
            <SummaryCard title="Sem giro" value={String(indicators.productsWithoutTurnover.length)} tone="rose" />
            <SummaryCard title="Críticos" value={String(indicators.criticalProducts.length)} tone="rose" />
          </div>
          <div className="mt-4 rounded-2xl bg-amber-50 p-4">
            <div className="flex items-center gap-2 text-amber-700">
              <AlertTriangle className="h-4 w-4" />
              <p className="text-xs font-black">Produtos críticos</p>
            </div>
            <p className="mt-2 text-xs font-semibold text-amber-800">
              {indicators.criticalProducts.length > 0
                ? indicators.criticalProducts.slice(0, 3).map(product => product.name).join(", ")
                : "Nenhum produto crítico no momento."}
            </p>
          </div>
        </div>
      </section>

      <section className="rounded-[2rem] border border-dashed border-border/60 bg-white p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-secondary text-muted-foreground"><CalendarDays className="h-5 w-5" /></span>
          <div>
            <h3 className="text-sm font-black text-foreground">Exportação profissional preparada</h3>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              Exportação client-side preparada com cabeçalho, resumo financeiro e tabelas profissionais. O PDF usa o fluxo de impressão do navegador e o Excel baixa uma planilha CSV compatível.
            </p>
          </div>
        </div>
      </section>
    </>
  );
}
