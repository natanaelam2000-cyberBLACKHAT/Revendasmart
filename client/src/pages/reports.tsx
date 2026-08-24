import { useCallback, useMemo } from "react";
import { Layout } from "@/components/layout";
import { PageSkeleton } from "@/components/PageSkeleton";
import { useClientsLiteData } from "@/hooks/useClientsLiteData";
import { useProductsData } from "@/hooks/useProductsData";
import { useSalesData } from "@/hooks/useSalesData";
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
  FileSpreadsheet,
  Package,
  PieChart as PieChartIcon,
  Printer,
  ReceiptText,
  TrendingUp,
  Users,
} from "lucide-react";
import {
  calculateComparisons,
  calculateFinancialSummary,
  calculateIndicators,
  calculateRanking,
  calculateReportCharts,
  type ComparisonMetric,
  type RankingItem,
} from "@/lib/report-metrics";
import { exportReportToExcel, exportReportToPdf, printReport } from "@/lib/report-export";
import { notifyError, notifySuccess } from "@/lib/notify";

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

const formatCurrency = (value: number) =>
  value.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

const formatDecimal = (value: number, digits = 1) =>
  value.toLocaleString("pt-BR", { maximumFractionDigits: digits });

function SummaryCard({ title, value, subtitle, tone = "neutral" }: { title: string; value: string; subtitle?: string; tone?: "neutral" | "green" | "rose" }) {
  const toneClass = tone === "green" ? "text-emerald-600 bg-emerald-50" : tone === "rose" ? "text-rose-600 bg-rose-50" : "text-primary bg-primary/10";
  return (
    <div className="rounded-[1.5rem] border border-border/50 bg-white p-4 shadow-sm">
      <div className={`mb-3 flex h-9 w-9 items-center justify-center rounded-2xl ${toneClass}`}>
        <DollarSign className="h-4 w-4" />
      </div>
      <p className="text-[10px] font-black uppercase tracking-[0.14em] text-muted-foreground">{title}</p>
      <p className="mt-1 text-xl font-black tracking-tight text-foreground">{value}</p>
      {subtitle && <p className="mt-1 text-[11px] font-semibold text-muted-foreground">{subtitle}</p>}
    </div>
  );
}

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

export default function Reports() {
  const { products, loading: productsLoading, error: productsError } = useProductsData();
  const { sales, loading: salesLoading, error: salesError } = useSalesData();
  const { clients, loading: clientsLoading, error: clientsError } = useClientsLiteData();
  const loading = productsLoading || salesLoading || clientsLoading;
  const dataError = productsError || salesError || clientsError;

  const summary = useMemo(() => calculateFinancialSummary(sales, products), [sales, products]);
  const rankings = useMemo(() => calculateRanking(sales, products, clients), [sales, products, clients]);
  const comparisons = useMemo(() => calculateComparisons(sales, products), [sales, products]);
  const charts = useMemo(() => calculateReportCharts(sales, products), [sales, products]);
  const indicators = useMemo(() => calculateIndicators(sales, products), [sales, products]);
  const exportPayload = useMemo(() => ({
    storeName: "Revenda Smart",
    periodLabel: "Dados consolidados do sistema",
    generatedAt: new Date(),
    summary,
    rankings,
    comparisons,
    indicators,
  }), [summary, rankings, comparisons, indicators]);

  const handleExportPdf = useCallback(() => {
    const opened = exportReportToPdf(exportPayload);
    if (opened) notifySuccess("Relatório PDF preparado.");
    else notifyError("Não foi possível abrir a janela de impressão.");
  }, [exportPayload]);

  const handleExportExcel = useCallback(() => {
    exportReportToExcel(exportPayload);
    notifySuccess("Relatório Excel gerado.");
  }, [exportPayload]);

  const handlePrintReport = useCallback(() => {
    const opened = printReport(exportPayload);
    if (opened) notifySuccess("Relatório enviado para impressão.");
    else notifyError("Não foi possível abrir a impressão.");
  }, [exportPayload]);

  const hasReportData = products.length > 0 || clients.length > 0 || sales.length > 0;

  if (loading) {
    return (
      <Layout title="Relatórios">
        <PageSkeleton variant="cards" />
      </Layout>
    );
  }

  // P1-03: antes, uma falha de leitura renderizava os gráficos vazios em silêncio — indistinguível de
  // "sem dados ainda". Mesmo padrão de erro+retry já usado em dashboard.tsx.
  if (dataError) {
    return (
      <Layout title="Relatórios">
        <div className="mx-auto max-w-3xl px-4 py-8 text-center">
          <p className="mb-2 font-bold text-destructive">Ocorreu um erro temporário.</p>
          <p className="mb-4 text-sm text-muted-foreground">Não foi possível carregar seus relatórios.</p>
          <button type="button" onClick={() => window.location.reload()} className="rounded-xl bg-primary px-5 py-3 text-sm font-bold text-white">Tentar novamente</button>
        </div>
      </Layout>
    );
  }

  return (
    <Layout title="Relatórios">
      <div className="px-4 sm:px-6 lg:px-8 py-6 pb-32 max-w-7xl mx-auto space-y-6">
        <section className="rounded-[2rem] border border-primary/10 bg-gradient-to-br from-primary/12 via-card to-rose-50 dark:to-primary/5 p-5 sm:p-7 shadow-sm">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <span className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.16em] text-primary shadow-sm">
                <BarChart3 className="h-3.5 w-3.5" /> Painel executivo
              </span>
              <h1 className="mt-4 text-3xl sm:text-4xl font-black tracking-tight text-foreground">Relatórios Premium</h1>
              <p className="mt-2 max-w-2xl text-sm font-medium leading-relaxed text-muted-foreground">
                Acompanhe faturamento, lucro, rankings, estoque e comparativos usando os dados já registrados no Revenda Smart.
              </p>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <button type="button" onClick={handleExportExcel} className="min-h-12 rounded-2xl bg-white px-3 text-[11px] font-black text-primary shadow-sm transition-all active:scale-95" title="Exportar planilha CSV compatível com Excel"><FileSpreadsheet className="mx-auto mb-1 h-4 w-4" /> Excel</button>
              <button type="button" onClick={handleExportPdf} className="min-h-12 rounded-2xl bg-white px-3 text-[11px] font-black text-primary shadow-sm transition-all active:scale-95" title="Gerar visual de PDF para impressão"><ReceiptText className="mx-auto mb-1 h-4 w-4" /> PDF</button>
              <button type="button" onClick={handlePrintReport} className="min-h-12 rounded-2xl bg-white px-3 text-[11px] font-black text-primary shadow-sm transition-all active:scale-95" title="Imprimir relatório"><Printer className="mx-auto mb-1 h-4 w-4" /> Imprimir</button>
            </div>
          </div>
        </section>

        {!hasReportData && (
          <div className="rounded-[2rem] border border-dashed border-border/60 bg-white px-6 py-12 text-center flex flex-col items-center">
            <div className="mb-4 flex h-20 w-20 items-center justify-center rounded-[2rem] bg-primary/10">
              <BarChart3 className="h-9 w-9 text-primary/45" />
            </div>
            <p className="font-black text-foreground">Relatórios em preparação</p>
            <p className="mt-2 max-w-[340px] text-sm leading-relaxed text-muted-foreground">Cadastre produtos, clientes e vendas para visualizar indicadores executivos, rankings e gráficos comerciais.</p>
          </div>
        )}

        <section className="space-y-3">
          <h2 className="text-lg font-black text-foreground">Visão do negócio</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-6">
            <SummaryCard title="Receita hoje" value={formatCurrency(summary.today.revenue)} />
            <SummaryCard title="Receita semana" value={formatCurrency(summary.week.revenue)} />
            <SummaryCard title="Receita mês" value={formatCurrency(summary.month.revenue)} />
            <SummaryCard title="Receita ano" value={formatCurrency(summary.year.revenue)} />
            <SummaryCard title="Lucro hoje" value={formatCurrency(summary.today.profit)} tone="green" />
            <SummaryCard title="Lucro semana" value={formatCurrency(summary.week.profit)} tone="green" />
            <SummaryCard title="Lucro mês" value={formatCurrency(summary.month.profit)} tone="green" />
            <SummaryCard title="Lucro ano" value={formatCurrency(summary.year.profit)} tone="green" />
            <SummaryCard title="Ticket médio" value={formatCurrency(summary.averageTicket)} subtitle="Por venda" />
            <SummaryCard title="Clientes ativos" value={String(summary.activeClients)} subtitle="Com compras" />
            <SummaryCard title="Produtos vendidos" value={formatDecimal(summary.totalProductsSold, 0)} subtitle="Unidades" />
            <SummaryCard title="Margem média" value={`${indicators.averageMargin}%`} tone={indicators.averageMargin >= 30 ? "green" : "rose"} />
          </div>
        </section>

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
      </div>
    </Layout>
  );
}
