import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { Layout } from "@/components/layout";
import { PageSkeleton } from "@/components/PageSkeleton";
import { EmptyState } from "@/components/EmptyState";
import { useClientsLiteData } from "@/hooks/useClientsLiteData";
import { useProductsData } from "@/hooks/useProductsData";
import { useSalesData } from "@/hooks/useSalesData";
import { usePlan } from "@/providers/PlanProvider";
import {
  BarChart3,
  DollarSign,
  FileSpreadsheet,
  Lock,
  Printer,
  ReceiptText,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import {
  calculateComparisons,
  calculateFinancialSummary,
  calculateIndicators,
  calculateRanking,
  calculateReportCharts,
  PROFIT_UNAVAILABLE,
} from "@/lib/report-metrics";
import { exportReportToExcel, exportReportToPdf, printReport } from "@/lib/report-export";
import { notifyError, notifySuccess } from "@/lib/notify";
import { fetchStrategicSummary, type OpportunitySummary } from "@/lib/reports-strategic-summary-client";
import type { OpportunityType } from "@shared/opportunity-rules";

// PLAN-IMPL-07B-VERIFY-FINAL §31 — o bloco OPERATIONAL (comparativos/gráficos/rankings/estoque/export,
// reports-operational.tsx) é a maior fatia de JSX da rota e só renderiza para Pro/Premium; lazy-load
// tira esse peso do chunk "reports" sem tocar no orçamento (Free nunca baixa este chunk extra).
const LazyOperationalSection = lazy(() => import("./reports-operational"));

// PLAN-IMPL-07B-VERIFY-FINAL §3/§4 — null = custo insuficientemente confiável no período/item (nunca
// fabrica lucro/margem a partir de custo ausente tratado como 0; ver isTrustedCost em report-metrics.ts).
// Aceita null só para lucro/margem — os demais call-sites (receita, ticket médio, etc.) nunca passam null.
export const formatCurrency = (value: number | null) =>
  value === null ? PROFIT_UNAVAILABLE : value.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

export const formatDecimal = (value: number, digits = 1) =>
  value.toLocaleString("pt-BR", { maximumFractionDigits: digits });

export function SummaryCard({ title, value, subtitle, tone = "neutral" }: { title: string; value: string; subtitle?: string; tone?: "neutral" | "green" | "rose" }) {
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

// PLAN-IMPL-07B §29/§30 — a seção estratégica é um RESUMO do que já existe em /opportunities (PLAN-
// IMPL-07A), nunca uma segunda leitura/ordenação: contagens + o "strongest" já vêm prontos do servidor
// (server/opportunity-engine.ts's summarizeOpportunities), esta seção só formata.
const OPPORTUNITY_TYPES: [OpportunityType, string][] = [
  ["inactive_client", "Clientes inativos"],
  ["stalled_product", "Produtos parados"],
  ["idle_schedule", "Agenda ociosa"],
];

function StrategicSummarySection({ summary }: { summary: OpportunitySummary }) {
  const [, setLocation] = useLocation();
  return (
    <section className="rounded-[2rem] border border-primary/10 bg-white p-5 sm:p-6 shadow-sm">
      <div className="mb-4 flex items-center gap-2">
        <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-primary/10 text-primary"><Sparkles className="h-4 w-4" /></span>
        <h2 className="text-sm font-black text-foreground">Leitura estratégica</h2>
      </div>
      {summary.totalCount === 0 ? (
        <EmptyState
          className="!p-6"
          icon={<Sparkles className="h-8 w-8 text-emerald-500/60" />}
          title="Nenhuma oportunidade prioritária encontrada agora"
          description="Assim que uma condição real do seu negócio pedir atenção, ela aparece aqui."
        />
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3">
            {OPPORTUNITY_TYPES.map(([type, label]) => (
              <div key={type} className="rounded-2xl bg-secondary/30 px-3 py-3 text-center">
                <p className="text-xl font-black text-foreground">{summary.countsByType[type]}</p>
                <p className="mt-1 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{label}</p>
              </div>
            ))}
          </div>
          {summary.strongest && (
            <p className="mt-4 rounded-2xl bg-secondary/30 px-4 py-3 text-sm font-bold text-foreground">{summary.strongest.reason}</p>
          )}
          <button
            type="button"
            onClick={() => setLocation("/opportunities")}
            className="mt-4 w-full rounded-xl bg-primary/10 text-primary text-xs font-black py-2.5 active:scale-95 transition-all"
            data-testid="button-view-opportunities"
          >
            Ver oportunidades
          </button>
        </>
      )}
    </section>
  );
}

// §31 — nunca resultado real (contagens) para quem não tem acesso; só a capacidade, genérica.
// §8/§9/§31 — um único componente parametrizado para os dois teasers (Free->Pro, Free|Pro->Premium):
// mesma estrutura/estilo, só ícone/copy mudam. Nunca contagens/resultado real (§31/§32) — só copy fixa.
function UpgradeTeaser({ icon, title, description, buttonLabel, testId }: {
  icon: React.ReactNode; title: string; description: string; buttonLabel: string; testId: string;
}) {
  const [, setLocation] = useLocation();
  return (
    <section className="rounded-[2rem] border border-primary/10 bg-white p-5 sm:p-6 shadow-sm">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">{icon}</span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-black text-foreground">{title}</h2>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</p>
          <button
            type="button"
            onClick={() => setLocation("/plans")}
            className="mt-3 rounded-xl bg-primary px-4 py-2 text-xs font-black text-white active:scale-95 transition-all"
            data-testid={testId}
          >
            {buttonLabel}
          </button>
        </div>
      </div>
    </section>
  );
}

export default function Reports() {
  const { products, loading: productsLoading, error: productsError } = useProductsData();
  const { sales, loading: salesLoading, error: salesError } = useSalesData();
  const { clients, loading: clientsLoading, error: clientsError } = useClientsLiteData();
  const { activePlan, hasPremiumAccess, loading: planLoading } = usePlan();
  const loading = productsLoading || salesLoading || clientsLoading;
  const dataError = productsError || salesError || clientsError;
  // §8/§9 — Pro E Premium têm a camada operacional completa; só Premium ganha a seção estratégica nova.
  const hasOperationalAccess = activePlan === "pro" || activePlan === "premium";

  const [strategicSummary, setStrategicSummary] = useState<OpportunitySummary | null>(null);
  const [strategicLoading, setStrategicLoading] = useState(true);
  const [strategicError, setStrategicError] = useState(false);

  // §22/§32 — mesmo padrão de opportunities.tsx: só chama a rota real quando já se sabe (via usePlan())
  // que o tenant tem acesso — nunca busca o resultado real para esconder depois.
  useEffect(() => {
    if (planLoading) return;
    if (!hasPremiumAccess) { setStrategicLoading(false); return; }
    let cancelled = false;
    setStrategicLoading(true);
    setStrategicError(false);
    fetchStrategicSummary()
      .then((result) => { if (!cancelled) setStrategicSummary(result); })
      .catch(() => { if (!cancelled) setStrategicError(true); })
      .finally(() => { if (!cancelled) setStrategicLoading(false); });
    return () => { cancelled = true; };
  }, [planLoading, hasPremiumAccess]);

  const summary = useMemo(() => calculateFinancialSummary(sales), [sales]);
  const rankings = useMemo(() => calculateRanking(sales, products, clients), [sales, products, clients]);
  const comparisons = useMemo(() => calculateComparisons(sales), [sales]);
  const charts = useMemo(() => calculateReportCharts(sales, products), [sales, products]);
  const indicators = useMemo(() => calculateIndicators(sales, products), [sales, products]);
  const margin = indicators.averageMargin;
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

  // §40 — espera o plano resolver ANTES de renderizar qualquer seção com gate, para nunca piscar
  // conteúdo Free e depois trocar para Pro/Premium (ou vice-versa) assim que usePlan() responde.
  if (loading || planLoading) {
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
              <h1 className="mt-4 text-3xl sm:text-4xl font-black tracking-tight text-foreground">Relatórios</h1>
              <p className="mt-2 max-w-2xl text-sm font-medium leading-relaxed text-muted-foreground">
                {/* PLAN-IMPL-07B §UI4 — copy honesta por plano: nunca promete lucro/rankings/comparativos
                    a quem não vai vê-los nesta carga (o gate já resolveu antes de chegar aqui, §40). */}
                {hasOperationalAccess
                  ? "Acompanhe faturamento, lucro, rankings, estoque e comparativos usando os dados já registrados no Revenda Smart."
                  : "Acompanhe seu faturamento e volume de vendas no Revenda Smart."}
              </p>
            </div>
            {/* §9/§28 — exportação é uma capacidade operacional (Pro+); Free não vê os botões, nunca um
                export parcial/inconsistente com o que a tela mostra. */}
            {hasOperationalAccess && (
              <div className="grid grid-cols-3 gap-2">
                <button type="button" onClick={handleExportExcel} className="min-h-12 rounded-2xl bg-white px-3 text-[11px] font-black text-primary shadow-sm transition-all active:scale-95" title="Exportar planilha CSV compatível com Excel"><FileSpreadsheet className="mx-auto mb-1 h-4 w-4" /> Excel</button>
                <button type="button" onClick={handleExportPdf} className="min-h-12 rounded-2xl bg-white px-3 text-[11px] font-black text-primary shadow-sm transition-all active:scale-95" title="Gerar visual de PDF para impressão"><ReceiptText className="mx-auto mb-1 h-4 w-4" /> PDF</button>
                <button type="button" onClick={handlePrintReport} className="min-h-12 rounded-2xl bg-white px-3 text-[11px] font-black text-primary shadow-sm transition-all active:scale-95" title="Imprimir relatório"><Printer className="mx-auto mb-1 h-4 w-4" /> Imprimir</button>
              </div>
            )}
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
          {/* §8 — BASIC: sempre visível, em qualquer plano. Receita e volume, nunca lucro/margem (julgamento
              profissional, §9) — o que o Free já tinha antes desta ticket nunca foi removido. */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-6">
            <SummaryCard title="Receita hoje" value={formatCurrency(summary.today.revenue)} />
            <SummaryCard title="Receita semana" value={formatCurrency(summary.week.revenue)} />
            <SummaryCard title="Receita mês" value={formatCurrency(summary.month.revenue)} />
            <SummaryCard title="Receita ano" value={formatCurrency(summary.year.revenue)} />
            <SummaryCard title="Ticket médio" value={formatCurrency(summary.averageTicket)} subtitle="Por venda" />
            <SummaryCard title="Produtos vendidos" value={formatDecimal(summary.totalProductsSold, 0)} subtitle="Unidades" />
            {/* §9 — OPERATIONAL: lucro/margem/clientes ativos, Pro+, mesma grade do BASIC acima. */}
            {hasOperationalAccess && (
              <>
                <SummaryCard title="Lucro hoje" value={formatCurrency(summary.today.profit)} tone="green" />
                <SummaryCard title="Lucro semana" value={formatCurrency(summary.week.profit)} tone="green" />
                <SummaryCard title="Lucro mês" value={formatCurrency(summary.month.profit)} tone="green" />
                <SummaryCard title="Lucro ano" value={formatCurrency(summary.year.profit)} tone="green" />
                <SummaryCard title="Clientes ativos" value={String(summary.activeClients)} subtitle="Com compras" />
                <SummaryCard title="Margem média" value={margin === null ? PROFIT_UNAVAILABLE : `${margin}%`} tone={margin !== null && margin >= 30 ? "green" : "rose"} />
              </>
            )}
          </div>
        </section>

        {!hasOperationalAccess && (
          <UpgradeTeaser
            icon={<TrendingUp className="h-5 w-5" />}
            title="Relatórios operacionais completos no Pro"
            description="Lucro, margem, comparativos, rankings e indicadores de estoque no Pro."
            buttonLabel="Conhecer os planos"
            testId="button-upgrade-pro"
          />
        )}

        {/* §9 — OPERATIONAL: comparativos, gráficos, rankings e indicadores de estoque, Pro+. Todo este
            bloco já existia sem gate nenhum antes desta ticket; agora exige Pro ou Premium. Lazy-loaded
            (reports-operational.tsx) — ver §31 acima. */}
        {hasOperationalAccess && (
          <Suspense fallback={<PageSkeleton variant="cards" />}>
            <LazyOperationalSection comparisons={comparisons} charts={charts} rankings={rankings} indicators={indicators} />
          </Suspense>
        )}

        {/* PLAN-IMPL-07B §10/§29 — STRATEGIC: só Premium (efetivo, trial incluso via hasPremiumAccess).
            §40 — nunca pisca: strategicLoading já respeitou planLoading antes de resolver. */}
        {hasPremiumAccess ? (
          strategicLoading ? (
            <PageSkeleton variant="cards" />
          ) : strategicError ? (
            <p className="rounded-[2rem] border border-border/50 bg-white px-6 py-8 text-center text-sm font-bold text-destructive">Não foi possível carregar este relatório.</p>
          ) : strategicSummary ? (
            <StrategicSummarySection summary={strategicSummary} />
          ) : null
        ) : (
          <UpgradeTeaser
            icon={<Lock className="h-4.5 w-4.5" />}
            title="Leitura estratégica é um recurso Premium"
            description="Encontre automaticamente oportunidades comerciais no Premium."
            buttonLabel="Conhecer o Premium"
            testId="button-upgrade-premium"
          />
        )}
      </div>
    </Layout>
  );
}
