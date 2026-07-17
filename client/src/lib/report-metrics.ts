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

export interface PeriodFinancialMetric {
  revenue: number;
  profit: number;
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
  profit: number;
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
  profit: number;
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
  averageMargin: number;
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

function addRankingValue(map: Map<string, RankingItem>, id: string, label: string, revenue: number, profit: number, quantity: number) {
  const current = map.get(id) || { id, label, revenue: 0, profit: 0, quantity: 0, salesCount: 0 };
  current.revenue += revenue;
  current.profit += profit;
  current.quantity += quantity;
  current.salesCount += 1;
  map.set(id, current);
}

function getSaleItemMetrics(sale: Sale, productById: Map<string, Product>) {
  let profit = 0;
  let quantity = 0;

  for (const item of sale.products || []) {
    const itemQuantity = Number(item.quantity || 0);
    const price = Number(item.price || 0);
    const product = productById.get(item.productId);
    profit += product ? itemQuantity * (price - Number(product.costPrice || 0)) : 0;
    quantity += itemQuantity;
  }

  return { profit, quantity };
}

function calculatePeriod(
  sales: Sale[],
  productById: Map<string, Product>,
  start: Date,
  end: Date
): PeriodFinancialMetric {
  const activeClients = new Set<string>();
  let revenue = 0;
  let profit = 0;
  let productsSold = 0;
  let salesCount = 0;

  for (const sale of sales) {
    const date = safeParseDate(sale.date);
    if (!date || !isWithinInterval(date, { start, end })) continue;

    const itemMetrics = getSaleItemMetrics(sale, productById);
    revenue += saleTotal(sale);
    profit += itemMetrics.profit;
    productsSold += itemMetrics.quantity;
    salesCount += 1;
    if (sale.clientId) activeClients.add(sale.clientId);
  }

  return {
    revenue,
    profit,
    salesCount,
    productsSold,
    activeClients: activeClients.size,
  };
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
  products: Product[],
  referenceDate = new Date()
): FinancialSummary {
  const productById = createProductMap(products);
  const today = calculatePeriod(sales, productById, startOfDay(referenceDate), endOfDay(referenceDate));
  const week = calculatePeriod(sales, productById, startOfWeek(referenceDate, { weekStartsOn: 1 }), endOfWeek(referenceDate, { weekStartsOn: 1 }));
  const month = calculatePeriod(sales, productById, startOfMonth(referenceDate), endOfMonth(referenceDate));
  const year = calculatePeriod(sales, productById, startOfYear(referenceDate), endOfYear(referenceDate));
  const allRevenue = sales.reduce((sum, sale) => sum + saleTotal(sale), 0);
  const activeClients = new Set(sales.map(sale => sale.clientId).filter(Boolean));
  const totalProductsSold = sales.reduce((sum, sale) => sum + getSaleItemMetrics(sale, productById).quantity, 0);

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
    const saleMetrics = getSaleItemMetrics(sale, productById);
    const clientName = clientById.get(sale.clientId)?.name || sale.clientName || "Cliente não identificado";
    addRankingValue(clientMap, sale.clientId || "unknown", clientName, saleRevenue, saleMetrics.profit, saleMetrics.quantity);

    for (const item of sale.products || []) {
      const product = productById.get(item.productId);
      const quantity = Number(item.quantity || 0);
      const revenue = quantity * Number(item.price || 0);
      const profit = product ? quantity * (Number(item.price || 0) - Number(product.costPrice || 0)) : 0;
      const productName = product?.name || "Produto removido";
      addRankingValue(productMap, item.productId, productName, revenue, profit, quantity);
      addRankingValue(categoryMap, product?.category || "Sem categoria", product?.category || "Sem categoria", revenue, profit, quantity);
      addRankingValue(brandMap, product?.brand || "Sem marca", product?.brand || "Sem marca", revenue, profit, quantity);
    }
  }

  const byQuantity = (a: RankingItem, b: RankingItem) => b.quantity - a.quantity;
  const byProfit = (a: RankingItem, b: RankingItem) => b.profit - a.profit;
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
  products: Product[],
  referenceDate = new Date()
): ReportComparisons {
  const productById = createProductMap(products);
  const currentDay = calculatePeriod(sales, productById, startOfDay(referenceDate), endOfDay(referenceDate));
  const previousDayDate = subDays(referenceDate, 1);
  const previousDay = calculatePeriod(sales, productById, startOfDay(previousDayDate), endOfDay(previousDayDate));

  const currentWeek = calculatePeriod(sales, productById, startOfWeek(referenceDate, { weekStartsOn: 1 }), endOfWeek(referenceDate, { weekStartsOn: 1 }));
  const previousWeekDate = subWeeks(referenceDate, 1);
  const previousWeek = calculatePeriod(sales, productById, startOfWeek(previousWeekDate, { weekStartsOn: 1 }), endOfWeek(previousWeekDate, { weekStartsOn: 1 }));

  const currentMonth = calculatePeriod(sales, productById, startOfMonth(referenceDate), endOfMonth(referenceDate));
  const previousMonthDate = subMonths(referenceDate, 1);
  const previousMonth = calculatePeriod(sales, productById, startOfMonth(previousMonthDate), endOfMonth(previousMonthDate));

  const currentYear = calculatePeriod(sales, productById, startOfYear(referenceDate), endOfYear(referenceDate));
  const previousYearDate = subYears(referenceDate, 1);
  const previousYear = calculatePeriod(sales, productById, startOfYear(previousYearDate), endOfYear(previousYearDate));

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
  const productById = createProductMap(products);
  const months = Array.from({ length: 12 }, (_, index) => startOfMonth(subMonths(referenceDate, 11 - index)));
  const revenueByMonth = months.map(month => {
    const period = calculatePeriod(sales, productById, startOfMonth(month), endOfMonth(month));
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
    salesByCategory: rankings.mostProfitableCategories.slice(0, 8).map(item => ({ name: item.label, revenue: item.revenue, profit: item.profit, quantity: item.quantity })),
    salesByBrand: rankings.mostProfitableBrands.slice(0, 8).map(item => ({ name: item.label, revenue: item.revenue, profit: item.profit, quantity: item.quantity })),
    topProducts: rankings.topSellingProducts.slice(0, 10).map(item => ({ name: item.label, revenue: item.revenue, profit: item.profit, quantity: item.quantity })),
  };
}

export function calculateIndicators(
  sales: Sale[],
  products: Product[],
  referenceDate = new Date(),
  lowStockThreshold = 3
): ReportIndicators {
  const productById = createProductMap(products);
  let totalProfit = 0;
  let totalRevenue = 0;
  let totalQuantity = 0;

  for (const sale of sales) {
    totalRevenue += saleTotal(sale);
    const metrics = getSaleItemMetrics(sale, productById);
    totalProfit += metrics.profit;
    totalQuantity += metrics.quantity;
  }

  const inventoryValue = products.reduce((sum, product) => sum + Number(product.costPrice || 0) * Number(product.stock || 0), 0);
  const productsWithoutTurnover = products.filter(product => {
    const lastSold = safeParseDate(product.lastSoldDate);
    if (!lastSold) return Number(product.stock || 0) > 0;
    return Number(product.stock || 0) > 0 && isWithinInterval(lastSold, { start: new Date(0), end: subDays(referenceDate, 90) });
  });

  return {
    averageMargin: totalRevenue > 0 ? Math.round((totalProfit / totalRevenue) * 100) : 0,
    averageQuantityPerSale: sales.length > 0 ? totalQuantity / sales.length : 0,
    averageInventoryValue: products.length > 0 ? inventoryValue / products.length : 0,
    productsWithoutTurnover,
    criticalProducts: products
      .filter(product => Number(product.stock || 0) <= lowStockThreshold)
      .sort((a, b) => Number(a.stock || 0) - Number(b.stock || 0))
      .slice(0, 10),
  };
}
