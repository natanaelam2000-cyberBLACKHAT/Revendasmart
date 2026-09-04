import {
  endOfDay,
  endOfMonth,
  endOfWeek,
  endOfYear,
  format,
  isWithinInterval,
  parseISO,
  startOfDay,
  startOfMonth,
  startOfWeek,
  startOfYear,
  subDays,
  subMonths,
  subWeeks,
  subYears,
} from "@/lib/date-utils";
import type { Client, Product, Sale } from "@/lib/mock-data";
import { STALLED_PRODUCT_THRESHOLD_DAYS } from "@shared/opportunity-rules";

export const PROFIT_UNAVAILABLE = "Indisponível";

export interface PeriodFinancialMetric {
  revenue: number;
  /** null = custo insuficientemente confiável no período (nunca 0 fabricado — ver isTrustedCost). */
  profit: number | null;
  salesCount: number;
  productsSold: number;
  activeClients: number;
}

export interface FinancialSummary {
  today: PeriodFinancialMetric;
  week: PeriodFinancialMetric;
  month: PeriodFinancialMetric;
  year: PeriodFinancialMetric;
  averageTicket: number;
  activeClients: number;
  totalProductsSold: number;
}

export interface RankingItem {
  id: string;
  label: string;
  revenue: number;
  profit: number | null;
  quantity: number;
  salesCount: number;
}

export interface ComparisonMetric {
  label: string;
  current: number;
  previous: number;
  changePercent: number;
  direction: "up" | "down" | "flat";
}

export interface ReportComparisons {
  today: ComparisonMetric;
  week: ComparisonMetric;
  month: ComparisonMetric;
  year: ComparisonMetric;
}

export interface MonthlyChartItem {
  label: string;
  revenue: number;
  profit: number | null;
}

export interface SimpleChartItem {
  name: string;
  revenue: number;
  profit?: number;
  quantity?: number;
}

export interface ReportCharts {
  revenueByMonth: MonthlyChartItem[];
  profitByMonth: MonthlyChartItem[];
  salesByCategory: SimpleChartItem[];
  salesByBrand: SimpleChartItem[];
  topProducts: SimpleChartItem[];
}

export interface ReportIndicators {
  averageMargin: number | null;
  averageQuantityPerSale: number;
  averageInventoryValue: number;
  productsWithoutTurnover: Product[];
  criticalProducts: Product[];
}

export interface ReportRankings {
  topSellingProducts: RankingItem[];
  mostProfitableProducts: RankingItem[];
  mostProfitableCategories: RankingItem[];
  mostProfitableBrands: RankingItem[];
  clientsByPurchases: RankingItem[];
  clientsByRevenue: RankingItem[];
}

function safeParseDate(value?: string | null): Date | null {
  if (!value) return null;
  const parsed = parseISO(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function saleTotal(sale: Sale): number {
  const total = Number(sale.total ?? sale.totalPrice ?? 0);
  return Number.isFinite(total) ? total : 0;
}

function createProductMap(products: Product[]): Map<string, Product> {
  return new Map(products.map(product => [product.id, product]));
}

function createClientMap(clients: Client[]): Map<string, Client> {
  return new Map(clients.map(client => [client.id, client]));
}

/**
 * PLAN-IMPL-07B-COST-SNAPSHOT-FINAL — a autoridade de custo é o snapshot gravado no momento da venda
 * (sale.products[].costPriceAtSale, server/sale-finalize-transaction.ts), nunca o Product.costPrice
 * atual: se o lojista editar o custo depois, vendas passadas não podem "reescrever" seu próprio lucro
 * histórico. Ausente = venda legada (anterior a este snapshot) ou custo não confiável no momento da
 * venda — em ambos os casos o item fica permanentemente indisponível, nunca recalculado a partir do
 * custo atual do produto (isso seria exatamente o bug que este ticket corrige).
 */
function isTrustedSaleCost(item: { costPriceAtSale?: number }): item is { costPriceAtSale: number } {
  return typeof item.costPriceAtSale === "number" && item.costPriceAtSale > 0;
}

function addRankingValue(map: Map<string, RankingItem>, id: string, label: string, revenue: number, profit: number | null, quantity: number) {
  const current = map.get(id) || { id, label, revenue: 0, profit: 0, quantity: 0, salesCount: 0 };
  current.revenue += revenue;
  current.profit = current.profit !== null && profit !== null ? current.profit + profit : null;
  current.quantity += quantity;
  current.salesCount += 1;
  map.set(id, current);
}

/**
 * RELEASE-26: custo dos itens de UMA venda — nunca "receita do item menos custo". `sale.products[].price`
 * é o preço por unidade ANTES do desconto do carrinho; `saleTotal()`/`sale.total` (usado como "receita"
 * em todo este arquivo) já é o valor final COM desconto. A versão antiga somava
 * quantidade × (preço-sem-desconto − custo) e chamava isso de lucro — base maior que a receita
 * exibida, então o lucro period podia superar a receita do período sempre que houvesse desconto
 * relevante (mesma causa raiz corrigida em home-dashboard-view-model.ts).
 *
 * Ranking por produto/categoria/marca (calculateRanking, mais abaixo) continua usando o preço do item
 * diretamente — aquilo é outro problema (ratear um desconto de carrinho entre itens), fora do escopo
 * desta correção; documentado, não corrigido aqui.
 */
function getSaleItemMetrics(sale: Sale) {
  let cost: number | null = 0;
  let quantity = 0;

  for (const item of sale.products || []) {
    const itemQuantity = Number(item.quantity || 0);
    if (cost !== null) cost = isTrustedSaleCost(item) ? cost + itemQuantity * item.costPriceAtSale : null;
    quantity += itemQuantity;
  }

  return { cost, quantity };
}

function calculatePeriod(
  sales: Sale[],
  start: Date,
  end: Date
): PeriodFinancialMetric {
  const activeClients = new Set<string>();
  let revenue = 0;
  let profit: number | null = 0;
  let productsSold = 0;
  let salesCount = 0;

  for (const sale of sales) {
    const date = safeParseDate(sale.date);
    if (!date || !isWithinInterval(date, { start, end })) continue;

    const itemMetrics = getSaleItemMetrics(sale);
    const saleRevenue = saleTotal(sale);
    revenue += saleRevenue;
    profit = profit !== null && itemMetrics.cost !== null ? profit + saleRevenue - itemMetrics.cost : null;
    productsSold += itemMetrics.quantity;
    salesCount += 1;
    if (sale.clientId) activeClients.add(sale.clientId);
  }

  return { revenue, profit, salesCount, productsSold, activeClients: activeClients.size };
}

function changePercent(current: number, previous: number): number {
  if (previous === 0) return current > 0 ? 100 : 0;
  const result = Math.round(((current - previous) / previous) * 100);
  return Number.isFinite(result) ? result : 0;
}

function comparison(label: string, current: number, previous: number): ComparisonMetric {
  const change = changePercent(current, previous);
  return {
    label,
    current,
    previous,
    changePercent: change,
    direction: change > 0 ? "up" : change < 0 ? "down" : "flat",
  };
}

export function calculateFinancialSummary(
  sales: Sale[],
  referenceDate = new Date()
): FinancialSummary {
  const today = calculatePeriod(sales, startOfDay(referenceDate), endOfDay(referenceDate));
  const week = calculatePeriod(sales, startOfWeek(referenceDate, { weekStartsOn: 1 }), endOfWeek(referenceDate, { weekStartsOn: 1 }));
  const month = calculatePeriod(sales, startOfMonth(referenceDate), endOfMonth(referenceDate));
  const year = calculatePeriod(sales, startOfYear(referenceDate), endOfYear(referenceDate));
  const allRevenue = sales.reduce((sum, sale) => sum + saleTotal(sale), 0);
  const activeClients = new Set(sales.map(sale => sale.clientId).filter(Boolean));
  const totalProductsSold = sales.reduce((sum, sale) => sum + getSaleItemMetrics(sale).quantity, 0);

  return {
    today,
    week,
    month,
    year,
    averageTicket: sales.length > 0 ? allRevenue / sales.length : 0,
    activeClients: activeClients.size,
    totalProductsSold,
  };
}

export function calculateRanking(
  sales: Sale[],
  products: Product[],
  clients: Client[]
): ReportRankings {
  const productById = createProductMap(products);
  const clientById = createClientMap(clients);
  const productMap = new Map<string, RankingItem>();
  const categoryMap = new Map<string, RankingItem>();
  const brandMap = new Map<string, RankingItem>();
  const clientMap = new Map<string, RankingItem>();

  for (const sale of sales) {
    const saleRevenue = saleTotal(sale);
    const saleMetrics = getSaleItemMetrics(sale);
    const clientName = clientById.get(sale.clientId)?.name || sale.clientName || "Cliente não identificado";
    const clientProfit = saleMetrics.cost !== null ? saleRevenue - saleMetrics.cost : null;
    addRankingValue(clientMap, sale.clientId || "unknown", clientName, saleRevenue, clientProfit, saleMetrics.quantity);

    for (const item of sale.products || []) {
      const product = productById.get(item.productId);
      const quantity = Number(item.quantity || 0);
      const revenue = quantity * Number(item.price || 0);
      const profit = isTrustedSaleCost(item) ? quantity * (Number(item.price || 0) - item.costPriceAtSale) : null;
      const productName = product?.name || "Produto n?o dispon?vel";
      addRankingValue(productMap, item.productId, productName, revenue, profit, quantity);
      addRankingValue(categoryMap, product?.category || "Sem categoria", product?.category || "Sem categoria", revenue, profit, quantity);
      addRankingValue(brandMap, product?.brand || "Sem marca", product?.brand || "Sem marca", revenue, profit, quantity);
    }
  }

  const byQuantity = (a: RankingItem, b: RankingItem) => b.quantity - a.quantity;
  const byProfit = (a: RankingItem, b: RankingItem) => (b.profit ?? 0) - (a.profit ?? 0);
  const byRevenue = (a: RankingItem, b: RankingItem) => b.revenue - a.revenue;
  const byPurchases = (a: RankingItem, b: RankingItem) => b.salesCount - a.salesCount;

  return {
    topSellingProducts: Array.from(productMap.values()).sort(byQuantity).slice(0, 10),
    mostProfitableProducts: Array.from(productMap.values()).sort(byProfit).slice(0, 10),
    mostProfitableCategories: Array.from(categoryMap.values()).sort(byProfit).slice(0, 10),
    mostProfitableBrands: Array.from(brandMap.values()).sort(byProfit).slice(0, 10),
    clientsByPurchases: Array.from(clientMap.values()).sort(byPurchases).slice(0, 10),
    clientsByRevenue: Array.from(clientMap.values()).sort(byRevenue).slice(0, 10),
  };
}

export function calculateComparisons(
  sales: Sale[],
  referenceDate = new Date()
): ReportComparisons {
  const currentDay = calculatePeriod(sales, startOfDay(referenceDate), endOfDay(referenceDate));
  const previousDayDate = subDays(referenceDate, 1);
  const previousDay = calculatePeriod(sales, startOfDay(previousDayDate), endOfDay(previousDayDate));

  const currentWeek = calculatePeriod(sales, startOfWeek(referenceDate, { weekStartsOn: 1 }), endOfWeek(referenceDate, { weekStartsOn: 1 }));
  const previousWeekDate = subWeeks(referenceDate, 1);
  const previousWeek = calculatePeriod(sales, startOfWeek(previousWeekDate, { weekStartsOn: 1 }), endOfWeek(previousWeekDate, { weekStartsOn: 1 }));

  const currentMonth = calculatePeriod(sales, startOfMonth(referenceDate), endOfMonth(referenceDate));
  const previousMonthDate = subMonths(referenceDate, 1);
  const previousMonth = calculatePeriod(sales, startOfMonth(previousMonthDate), endOfMonth(previousMonthDate));

  const currentYear = calculatePeriod(sales, startOfYear(referenceDate), endOfYear(referenceDate));
  const previousYearDate = subYears(referenceDate, 1);
  const previousYear = calculatePeriod(sales, startOfYear(previousYearDate), endOfYear(previousYearDate));

  return {
    today: comparison("Hoje x ontem", currentDay.revenue, previousDay.revenue),
    week: comparison("Semana atual x anterior", currentWeek.revenue, previousWeek.revenue),
    month: comparison("Mês atual x anterior", currentMonth.revenue, previousMonth.revenue),
    year: comparison("Ano atual x anterior", currentYear.revenue, previousYear.revenue),
  };
}

export function calculateReportCharts(
  sales: Sale[],
  products: Product[],
  referenceDate = new Date()
): ReportCharts {
  const months = Array.from({ length: 12 }, (_, index) => startOfMonth(subMonths(referenceDate, 11 - index)));
  const revenueByMonth = months.map(month => {
    const period = calculatePeriod(sales, startOfMonth(month), endOfMonth(month));
    return {
      label: format(month, "MM/yy"),
      revenue: period.revenue,
      profit: period.profit,
    };
  });
  const rankings = calculateRanking(sales, products, []);

  return {
    revenueByMonth,
    profitByMonth: revenueByMonth,
    salesByCategory: rankings.mostProfitableCategories.slice(0, 8).map(item => ({ name: item.label, revenue: item.revenue, quantity: item.quantity })),
    salesByBrand: rankings.mostProfitableBrands.slice(0, 8).map(item => ({ name: item.label, revenue: item.revenue, quantity: item.quantity })),
    topProducts: rankings.topSellingProducts.slice(0, 10).map(item => ({ name: item.label, revenue: item.revenue, quantity: item.quantity })),
  };
}

export function calculateIndicators(
  sales: Sale[],
  products: Product[],
  referenceDate = new Date(),
  lowStockThreshold = 3
): ReportIndicators {
  let totalProfit: number | null = 0;
  let totalRevenue = 0;
  let totalQuantity = 0;

  for (const sale of sales) {
    const saleRevenue = saleTotal(sale);
    totalRevenue += saleRevenue;
    const metrics = getSaleItemMetrics(sale);
    totalProfit = totalProfit !== null && metrics.cost !== null ? totalProfit + saleRevenue - metrics.cost : null;
    totalQuantity += metrics.quantity;
  }

  const inventoryValue = products.reduce((sum, product) => sum + Number(product.costPrice || 0) * Number(product.stock || 0), 0);
  // PLAN-IMPL-07B §12 — antes usava um limiar de 90 dias próprio, redeclarado aqui e conceitualmente
  // idêntico ao "produto parado" já canonizado em shared/opportunity-rules.ts (PLAN-IMPL-07A) — mesma
  // regra (stock > 0 + sem vender há N dias), duas fontes divergentes. Consolidado para o limiar único
  // (60 dias): o número exibido em "Sem giro" muda (mostra mais produtos que antes, já que 60 é um teto
  // mais baixo que 90), mudança intencional desta ticket, nunca um efeito colateral escondido.
  const productsWithoutTurnover = products.filter(product => {
    const lastSold = safeParseDate(product.lastSoldDate);
    if (!lastSold) return Number(product.stock || 0) > 0;
    return Number(product.stock || 0) > 0 && isWithinInterval(lastSold, { start: new Date(0), end: subDays(referenceDate, STALLED_PRODUCT_THRESHOLD_DAYS) });
  });

  return {
    averageMargin: totalProfit === null ? null : totalRevenue > 0 ? Math.round((totalProfit / totalRevenue) * 100) : 0,
    averageQuantityPerSale: sales.length > 0 ? totalQuantity / sales.length : 0,
    averageInventoryValue: products.length > 0 ? inventoryValue / products.length : 0,
    productsWithoutTurnover,
    criticalProducts: products
      .filter(product => Number(product.stock || 0) <= lowStockThreshold)
      .sort((a, b) => Number(a.stock || 0) - Number(b.stock || 0))
      .slice(0, 10),
  };
}
