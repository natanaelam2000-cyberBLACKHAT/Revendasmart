import { differenceInCalendarDays, endOfMonth, getDate, isSameMonth, parseISO } from "@/lib/date-utils";
import type { Client, Product, Sale } from "@/lib/mock-data";

export interface MetricComparison {
  current: number;
  previous: number;
  changePercent: number;
  direction: "up" | "down" | "flat";
}

export interface MonthlyComparison {
  revenue: MetricComparison;
  profit: MetricComparison;
  productsSold: MetricComparison;
  activeClients: MetricComparison;
}

export interface RankingItem {
  label: string;
  revenue: number;
  profit: number;
  quantity: number;
  marginPercent: number;
}

export interface ProductInsightItem {
  product: Product;
  revenue: number;
  profit: number;
  quantity: number;
  marginPercent: number;
  changePercent?: number;
}

export interface MonthlyProjection {
  projectedRevenue: number;
  projectedProfit: number;
  requiredDailyRevenue: number;
  goalPercent: number;
  daysRemaining: number;
}

export interface SmartStockMetrics {
  totalInventoryValue: number;
  stagnantInventoryValue: number;
  criticalProducts: Product[];
  unsoldOver90Days: Product[];
  lowStockProducts: Product[];
  outOfStockProducts: Product[];
}

export interface BusinessInsights {
  categoryRanking: RankingItem[];
  brandRanking: RankingItem[];
  mostProfitableCategory: RankingItem | null;
  mostProfitableBrand: RankingItem | null;
  topRevenueCategory: RankingItem | null;
  highestMarginProduct: ProductInsightItem | null;
  lowestMarginProduct: ProductInsightItem | null;
  productMostGrew: ProductInsightItem | null;
  productMostDropped: ProductInsightItem | null;
  highestTurnoverProduct: ProductInsightItem | null;
  lowestTurnoverProduct: ProductInsightItem | null;
}

interface PeriodMetrics {
  revenue: number;
  profit: number;
  productsSold: number;
  activeClientIds: Set<string>;
  productQuantityById: Map<string, number>;
  productRevenueById: Map<string, number>;
  productProfitById: Map<string, number>;
}

function safeParseDate(value?: string | null): Date | null {
  if (!value) return null;
  const parsed = parseISO(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function saleTotal(sale: Sale): number {
  const total = Number(sale.totalPrice ?? sale.total ?? 0);
  return Number.isFinite(total) ? total : 0;
}

function changePercent(current: number, previous: number): number {
  if (previous === 0) return current > 0 ? 100 : 0;
  return Math.round(((current - previous) / previous) * 100);
}

function comparison(current: number, previous: number): MetricComparison {
  const change = changePercent(current, previous);
  return {
    current,
    previous,
    changePercent: change,
    direction: change > 0 ? "up" : change < 0 ? "down" : "flat",
  };
}

function addToMap(map: Map<string, number>, key: string, value: number) {
  map.set(key, (map.get(key) || 0) + value);
}

function calculatePeriodMetrics(
  sales: Sale[],
  productById: Map<string, Product>,
  predicate: (date: Date) => boolean
): PeriodMetrics {
  const result: PeriodMetrics = {
    revenue: 0,
    profit: 0,
    productsSold: 0,
    activeClientIds: new Set<string>(),
    productQuantityById: new Map<string, number>(),
    productRevenueById: new Map<string, number>(),
    productProfitById: new Map<string, number>(),
  };

  for (const sale of sales) {
    const date = safeParseDate(sale.date);
    if (!date || !predicate(date)) continue;

    result.revenue += saleTotal(sale);
    if (sale.clientId) result.activeClientIds.add(sale.clientId);

    for (const soldProduct of sale.products || []) {
      const product = productById.get(soldProduct.productId);
      const quantity = Number(soldProduct.quantity || 0);
      const price = Number(soldProduct.price || 0);
      const revenue = quantity * price;
      const profit = product ? quantity * (price - Number(product.costPrice || 0)) : 0;
      result.productsSold += quantity;
      result.profit += profit;
      addToMap(result.productQuantityById, soldProduct.productId, quantity);
      addToMap(result.productRevenueById, soldProduct.productId, revenue);
      addToMap(result.productProfitById, soldProduct.productId, profit);
    }
  }

  return result;
}

export function calculateMonthlyComparison(
  sales: Sale[],
  productById: Map<string, Product>,
  referenceDate = new Date()
): MonthlyComparison {
  const previousMonth = new Date(referenceDate.getFullYear(), referenceDate.getMonth() - 1, 1);
  const current = calculatePeriodMetrics(sales, productById, date => isSameMonth(date, referenceDate));
  const previous = calculatePeriodMetrics(sales, productById, date => isSameMonth(date, previousMonth));

  return {
    revenue: comparison(current.revenue, previous.revenue),
    profit: comparison(current.profit, previous.profit),
    productsSold: comparison(current.productsSold, previous.productsSold),
    activeClients: comparison(current.activeClientIds.size, previous.activeClientIds.size),
  };
}

function buildRanking(
  sales: Sale[],
  productById: Map<string, Product>,
  getLabel: (product: Product) => string
): RankingItem[] {
  const map = new Map<string, RankingItem>();

  for (const sale of sales) {
    for (const soldProduct of sale.products || []) {
      const product = productById.get(soldProduct.productId);
      if (!product) continue;
      const label = getLabel(product) || "Sem classificação";
      const quantity = Number(soldProduct.quantity || 0);
      const revenue = quantity * Number(soldProduct.price || 0);
      const profit = quantity * (Number(soldProduct.price || 0) - Number(product.costPrice || 0));
      const current = map.get(label) || { label, revenue: 0, profit: 0, quantity: 0, marginPercent: 0 };
      current.revenue += revenue;
      current.profit += profit;
      current.quantity += quantity;
      current.marginPercent = current.revenue > 0 ? Math.round((current.profit / current.revenue) * 100) : 0;
      map.set(label, current);
    }
  }

  return Array.from(map.values()).sort((a, b) => b.revenue - a.revenue).slice(0, 6);
}

export function calculateCategoryRanking(sales: Sale[], productById: Map<string, Product>): RankingItem[] {
  return buildRanking(sales, productById, product => product.category || "Sem categoria");
}

export function calculateBrandRanking(sales: Sale[], productById: Map<string, Product>): RankingItem[] {
  return buildRanking(sales, productById, product => product.brand || "Sem marca");
}

function buildProductInsights(metrics: PeriodMetrics, productById: Map<string, Product>): ProductInsightItem[] {
  return Array.from(metrics.productQuantityById.entries())
    .map(([productId, quantity]) => {
      const product = productById.get(productId);
      if (!product) return null;
      const revenue = metrics.productRevenueById.get(productId) || 0;
      const profit = metrics.productProfitById.get(productId) || 0;
      return {
        product,
        quantity,
        revenue,
        profit,
        marginPercent: revenue > 0 ? Math.round((profit / revenue) * 100) : 0,
      } satisfies ProductInsightItem;
    })
    .filter((item): item is ProductInsightItem => item !== null);
}

export function calculateMonthlyProjection(
  currentRevenue: number,
  currentProfit: number,
  monthlyGoal: number,
  referenceDate = new Date()
): MonthlyProjection {
  const day = Math.max(1, getDate(referenceDate));
  const totalDays = getDate(endOfMonth(referenceDate));
  const daysRemaining = Math.max(0, differenceInCalendarDays(endOfMonth(referenceDate), referenceDate));
  const projectedRevenue = (currentRevenue / day) * totalDays;
  const projectedProfit = (currentProfit / day) * totalDays;
  const remainingGoal = Math.max(0, monthlyGoal - currentRevenue);

  return {
    projectedRevenue,
    projectedProfit,
    requiredDailyRevenue: daysRemaining > 0 ? remainingGoal / daysRemaining : remainingGoal,
    goalPercent: monthlyGoal > 0 ? Math.min(999, Math.round((currentRevenue / monthlyGoal) * 100)) : 0,
    daysRemaining,
  };
}

export function calculateStockMetrics(
  products: Product[],
  lowStockThreshold: number,
  referenceDate = new Date()
): SmartStockMetrics {
  const lowStockProducts = products.filter(product => product.stock > 0 && product.stock <= lowStockThreshold);
  const outOfStockProducts = products.filter(product => product.stock <= 0);
  const unsoldOver90Days = products.filter(product => {
    const lastSold = safeParseDate(product.lastSoldDate);
    return !lastSold || differenceInCalendarDays(referenceDate, lastSold) > 90;
  });
  const criticalProducts = [...outOfStockProducts, ...lowStockProducts].slice(0, 8);

  return {
    totalInventoryValue: products.reduce((sum, product) => sum + Number(product.costPrice || 0) * Number(product.stock || 0), 0),
    stagnantInventoryValue: unsoldOver90Days.reduce((sum, product) => sum + Number(product.costPrice || 0) * Number(product.stock || 0), 0),
    criticalProducts,
    unsoldOver90Days,
    lowStockProducts,
    outOfStockProducts,
  };
}

export function calculateBusinessInsights(
  products: Product[],
  sales: Sale[],
  clients: Client[],
  productById: Map<string, Product>,
  referenceDate = new Date()
): BusinessInsights {
  void clients;
  const currentMetrics = calculatePeriodMetrics(sales, productById, date => isSameMonth(date, referenceDate));
  const previousDate = new Date(referenceDate.getFullYear(), referenceDate.getMonth() - 1, 1);
  const previousMetrics = calculatePeriodMetrics(sales, productById, date => isSameMonth(date, previousDate));
  const comparedProductIds = new Set<string>([
    ...Array.from(currentMetrics.productQuantityById.keys()),
    ...Array.from(previousMetrics.productQuantityById.keys()),
  ]);

  const growthProducts = Array.from(comparedProductIds)
    .map((productId): ProductInsightItem | null => {
      const product = productById.get(productId);
      if (!product) return null;

      const quantity = currentMetrics.productQuantityById.get(productId) || 0;
      const previousQuantity = previousMetrics.productQuantityById.get(productId) || 0;
      const revenue = currentMetrics.productRevenueById.get(productId) || 0;
      const profit = currentMetrics.productProfitById.get(productId) || 0;

      return {
        product,
        quantity,
        revenue,
        profit,
        marginPercent: revenue > 0 ? Math.round((profit / revenue) * 100) : 0,
        changePercent: changePercent(quantity, previousQuantity),
      };
    })
    .filter((item): item is ProductInsightItem => item !== null);

  const currentProducts = growthProducts.filter(item => item.quantity > 0);

  const allProductsWithMargins = products.map(product => {
    const margin = Number(product.salePrice || 0) - Number(product.costPrice || 0);
    const marginPercent = product.salePrice > 0 ? Math.round((margin / product.salePrice) * 100) : 0;
    const quantity = currentMetrics.productQuantityById.get(product.id) || 0;
    const revenue = currentMetrics.productRevenueById.get(product.id) || 0;
    const profit = currentMetrics.productProfitById.get(product.id) || 0;
    return { product, quantity, revenue, profit, marginPercent };
  });

  const categoryRanking = calculateCategoryRanking(sales, productById);
  const brandRanking = calculateBrandRanking(sales, productById);
  const sortByProfit = (items: RankingItem[]) => [...items].sort((a, b) => b.profit - a.profit);

  return {
    categoryRanking,
    brandRanking,
    mostProfitableCategory: sortByProfit(categoryRanking)[0] || null,
    mostProfitableBrand: sortByProfit(brandRanking)[0] || null,
    topRevenueCategory: categoryRanking[0] || null,
    highestMarginProduct: [...allProductsWithMargins].sort((a, b) => b.marginPercent - a.marginPercent)[0] || null,
    lowestMarginProduct: [...allProductsWithMargins].filter(item => item.product.salePrice > 0).sort((a, b) => a.marginPercent - b.marginPercent)[0] || null,
    productMostGrew: [...growthProducts]
      .filter(item => (item.changePercent || 0) > 0)
      .sort((a, b) => (b.changePercent || 0) - (a.changePercent || 0))[0] || null,
    productMostDropped: [...growthProducts]
      .filter(item => (item.changePercent || 0) < 0)
      .sort((a, b) => (a.changePercent || 0) - (b.changePercent || 0))[0] || null,
    highestTurnoverProduct: [...currentProducts].sort((a, b) => b.quantity - a.quantity)[0] || null,
    lowestTurnoverProduct: [...allProductsWithMargins].filter(item => item.product.stock > 0).sort((a, b) => a.quantity - b.quantity)[0] || null,
  };
}
