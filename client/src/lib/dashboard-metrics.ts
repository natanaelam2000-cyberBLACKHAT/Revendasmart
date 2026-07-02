import type { LucideIcon } from "lucide-react";
import { differenceInDays, parseISO } from "date-fns";
import type { Client, Product, Sale } from "@/lib/mock-data";

export interface DashboardInsight {
  title: string;
  desc: string;
  icon: LucideIcon;
  color: string;
  action: string;
  link: string;
  priority: number;
}

export interface TopProductMetric {
  product: Product;
  quantity: number;
  revenue: number;
  profit: number;
}

export interface MonthMetrics {
  revenue: number;
  profit: number;
  products: number;
  activeClients: number;
}

export interface MonthlyDashboardData {
  monthMetrics: MonthMetrics;
  productQuantities: Map<string, number>;
}


export interface ExecutiveSummaryMetrics {
  revenue: number;
  profit: number;
  productsSold: number;
  averageTicket: number;
  activeClients: number;
  averageMargin: number;
}

export interface MonthlyGoalMetric {
  target: number;
  current: number;
  percent: number;
  color: "red" | "yellow" | "green";
}

export interface StockExecutiveMetrics {
  outOfStockCount: number;
  lowStockCount: number;
  inventoryValue: number;
  highestStockProduct: Product | null;
}

export interface AttentionItem {
  label: string;
  tone: "warning" | "success";
}

export interface DashboardPremiumIndicator {
  label: string;
  value: number;
  kind: "currency" | "number" | "percent";
  detail: string;
  tone: "positive" | "negative" | "neutral";
  direction: "up" | "down" | "flat";
}

export interface WorstProductMetric {
  product: Product;
  daysWithoutSale: number | null;
  statusLabel: string;
}

function safeParseDate(value?: string | null): Date | null {
  if (!value) return null;
  const parsed = parseISO(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isSameMonth(date: Date, referenceDate: Date): boolean {
  return date.getMonth() === referenceDate.getMonth() && date.getFullYear() === referenceDate.getFullYear();
}

export interface DashboardInsightIcons {
  AlertCircle: LucideIcon;
  Zap: LucideIcon;
  TrendingDown: LucideIcon;
  Users: LucideIcon;
  Share2: LucideIcon;
}

export interface DashboardInsightInput {
  products: Product[];
  sales: Sale[];
  clientById: Map<string, Client>;
  lowStockThreshold: number;
  enableReferralProgram: boolean;
  icons: DashboardInsightIcons;
}

export function createProductMap(products: Product[]): Map<string, Product> {
  const map = new Map<string, Product>();
  for (const product of products) {
    map.set(product.id, product);
  }
  return map;
}

export function createClientMap(clients: Client[]): Map<string, Client> {
  const map = new Map<string, Client>();
  for (const client of clients) {
    map.set(client.id, client);
  }
  return map;
}

export function calculateMonthlyMetrics(
  sales: Sale[],
  productById: Map<string, Product>,
  referenceDate = new Date()
): MonthlyDashboardData {
  const activeClientIds = new Set<string>();
  const productQuantities = new Map<string, number>();
  let totalRevenue = 0;
  let totalProfit = 0;
  let totalProducts = 0;

  for (const sale of sales) {
    const saleDate = safeParseDate(sale.date);
    if (!saleDate || !isSameMonth(saleDate, referenceDate)) {
      continue;
    }

    totalRevenue += sale.totalPrice;
    activeClientIds.add(sale.clientId);

    for (const soldProduct of sale.products || []) {
      totalProducts += soldProduct.quantity;
      productQuantities.set(
        soldProduct.productId,
        (productQuantities.get(soldProduct.productId) || 0) + soldProduct.quantity
      );

      const product = productById.get(soldProduct.productId);
      if (product && product.costPrice) {
        totalProfit += (soldProduct.price - product.costPrice) * soldProduct.quantity;
      }
    }
  }

  return {
    monthMetrics: {
      revenue: totalRevenue,
      profit: totalProfit,
      products: totalProducts,
      activeClients: activeClientIds.size,
    },
    productQuantities,
  };
}

export function calculateTopProducts(
  productQuantities: Map<string, number>,
  productById: Map<string, Product>
): TopProductMetric[] {
  return Array.from(productQuantities.entries())
    .map(([productId, quantity]) => {
      const product = productById.get(productId);
      if (!product) return null;

      const revenue = product.salePrice * quantity;
      const profit = (product.salePrice - (product.costPrice || 0)) * quantity;
      return { product, quantity, revenue, profit };
    })
    .filter((item): item is TopProductMetric => item !== null)
    .sort((a, b) => b.quantity - a.quantity)
    .slice(0, 5);
}

export function calculateLowStockProducts(
  products: Product[],
  lowStockThreshold: number
): Product[] {
  return products
    .filter((product) => product.stock > 0 && product.stock <= lowStockThreshold)
    .sort((a, b) => a.stock - b.stock)
    .slice(0, 3);
}

export function calculateDashboardInsights({
  products,
  sales,
  clientById,
  lowStockThreshold,
  enableReferralProgram,
  icons,
}: DashboardInsightInput): DashboardInsight[] {
  const list: DashboardInsight[] = [];
  const now = new Date();
  const lastSaleDateByClientId = new Map<string, Date>();

  for (const sale of sales) {
    if (!sale.clientId) continue;

    const saleDate = safeParseDate(sale.date);
    if (!saleDate) continue;
    const currentLastSaleDate = lastSaleDateByClientId.get(sale.clientId);
    if (!currentLastSaleDate || saleDate > currentLastSaleDate) {
      lastSaleDateByClientId.set(sale.clientId, saleDate);
    }
  }

  products.forEach((product) => {
    if (product.stock > 0 && product.stock <= lowStockThreshold) {
      list.push({
        title: "Alerta de Estoque Baixo",
        desc: `${product.name} tem apenas ${product.stock} unidades. Repor em breve?`,
        icon: icons.AlertCircle,
        color: "destructive",
        action: "Ver Produto",
        link: "/products",
        priority: 1,
      });
    }

    if (
      product.lastSoldDate &&
      safeParseDate(product.lastSoldDate) &&
      differenceInDays(now, safeParseDate(product.lastSoldDate)!) <= 2 &&
      product.stock < 5
    ) {
      list.push({
        title: "Vendendo Rápido! 🔥",
        desc: `${product.name} está com alta saída. Considere aumentar o estoque.`,
        icon: icons.Zap,
        color: "green",
        action: "Repor Agora",
        link: "/add",
        priority: 2,
      });
    }

    if (product.lastSoldDate && safeParseDate(product.lastSoldDate) && differenceInDays(now, safeParseDate(product.lastSoldDate)!) >= 30) {
      list.push({
        title: "Produto Parado (+30 dias)",
        desc: `${product.name} não vende há um mês. Criar uma oferta?`,
        icon: icons.TrendingDown,
        color: "orange",
        action: "Criar Promo",
        link: "/marketing",
        priority: 3,
      });
    }
  });

  clientById.forEach((client) => {
    const lastSale = lastSaleDateByClientId.get(client.id) || new Date(0);

    if (differenceInDays(now, lastSale) >= 60) {
      list.push({
        title: "Cliente Inativo",
        desc: `${client.name} não compra há 60 dias. Que tal um "oi"?`,
        icon: icons.Users,
        color: "primary",
        action: "Mensagem",
        link: "/clients",
        priority: 4,
      });
    }
  });

  const monthlyData = calculateMonthlyMetrics(sales, createProductMap(products), now);
  const summary = calculateExecutiveSummary(monthlyData.monthMetrics);
  const stock = calculateStockExecutiveMetrics(products, lowStockThreshold);
  if (summary.averageMargin >= 40) {
    list.push({
      title: "Margem Saudável",
      desc: `Sua margem média está em ${summary.averageMargin.toFixed(0)}%. Continue priorizando produtos lucrativos.`,
      icon: icons.Zap,
      color: "green",
      action: "Ver vendas",
      link: "/monthly-sales",
      priority: 4,
    });
  }
  if (stock.lowStockCount === 0 && stock.outOfStockCount === 0 && products.length > 0) {
    list.push({
      title: "Estoque saudável",
      desc: "Nenhum produto crítico no momento. Bom controle de reposição.",
      icon: icons.Zap,
      color: "green",
      action: "Ver estoque",
      link: "/products",
      priority: 4,
    });
  }
  if (new Set(products.map((product) => product.category).filter(Boolean)).size >= 4) {
    list.push({
      title: "Boa diversidade",
      desc: "Seu catálogo tem variedade para diferentes perfis de cliente.",
      icon: icons.Share2,
      color: "primary",
      action: "Abrir catálogo",
      link: "/catalog",
      priority: 5,
    });
  }

  if (enableReferralProgram && products.length > 2) {
    list.push({
      title: "Crescimento Ligado!",
      desc: "Você está pronta para crescer. Ative programa de indicação.",
      icon: icons.Share2,
      color: "primary",
      action: "Indicar",
      link: "/settings?tab=growth",
      priority: 5,
    });
  }

  return list.sort((a, b) => a.priority - b.priority).slice(0, 4);
}


export function calculateExecutiveSummary(monthMetrics: MonthMetrics): ExecutiveSummaryMetrics {
  const averageTicket = monthMetrics.activeClients > 0 ? monthMetrics.revenue / monthMetrics.activeClients : 0;
  const averageMargin = monthMetrics.revenue > 0 ? (monthMetrics.profit / monthMetrics.revenue) * 100 : 0;
  return {
    revenue: monthMetrics.revenue,
    profit: monthMetrics.profit,
    productsSold: monthMetrics.products,
    averageTicket,
    activeClients: monthMetrics.activeClients,
    averageMargin,
  };
}

export function calculateMonthlyGoal(currentRevenue: number, configuredGoal?: number | null): MonthlyGoalMetric {
  const target = configuredGoal && configuredGoal > 0 ? configuredGoal : 10000;
  const percent = Math.min(100, Math.round((currentRevenue / target) * 100));
  const color = percent >= 80 ? "green" : percent >= 50 ? "yellow" : "red";
  return { target, current: currentRevenue, percent, color };
}

export function calculateStockExecutiveMetrics(products: Product[], lowStockThreshold: number): StockExecutiveMetrics {
  let outOfStockCount = 0;
  let lowStockCount = 0;
  let inventoryValue = 0;
  let highestStockProduct: Product | null = null;

  for (const product of products) {
    if (product.stock === 0) outOfStockCount += 1;
    if (product.stock > 0 && product.stock <= lowStockThreshold) lowStockCount += 1;
    inventoryValue += (product.costPrice || 0) * product.stock;
    if (!highestStockProduct || product.stock > highestStockProduct.stock) highestStockProduct = product;
  }

  return { outOfStockCount, lowStockCount, inventoryValue, highestStockProduct };
}

export function calculateWorstProduct(products: Product[], referenceDate = new Date()): WorstProductMetric | null {
  let worst: WorstProductMetric | null = null;

  for (const product of products) {
    if (product.stock <= 0) continue;
    const lastSoldDate = safeParseDate(product.lastSoldDate);
    const daysWithoutSale = lastSoldDate ? differenceInDays(referenceDate, lastSoldDate) : null;
    const score = daysWithoutSale ?? Number.MAX_SAFE_INTEGER;
    const worstScore = worst?.daysWithoutSale ?? Number.MAX_SAFE_INTEGER;
    if (!worst || score > worstScore || (score === worstScore && product.stock > worst.product.stock)) {
      worst = {
        product,
        daysWithoutSale,
        statusLabel: daysWithoutSale === null ? "Ainda não vendido" : `${daysWithoutSale} dias`,
      };
    }
  }

  return worst;
}

export function calculateInactiveClientCount(
  clients: Client[],
  sales: Sale[],
  inactiveDays = 60,
  referenceDate = new Date()
): number {
  const lastSaleDateByClientId = new Map<string, Date>();
  for (const sale of sales) {
    if (!sale.clientId) continue;
    const saleDate = safeParseDate(sale.date);
    if (!saleDate) continue;
    const current = lastSaleDateByClientId.get(sale.clientId);
    if (!current || saleDate > current) lastSaleDateByClientId.set(sale.clientId, saleDate);
  }

  let count = 0;
  for (const client of clients) {
    const lastSale = lastSaleDateByClientId.get(client.id);
    if (!lastSale || differenceInDays(referenceDate, lastSale) >= inactiveDays) count += 1;
  }
  return count;
}

export function calculateAttentionItems(input: {
  lowStockCount: number;
  overdueChargesCount: number;
  inactiveClientCount: number;
  monthlyGoal: MonthlyGoalMetric;
}): AttentionItem[] {
  const items: AttentionItem[] = [];
  if (input.lowStockCount > 0) items.push({ label: `${input.lowStockCount} produtos com estoque baixo`, tone: "warning" });
  if (input.overdueChargesCount > 0) items.push({ label: `${input.overdueChargesCount} cobranças vencidas`, tone: "warning" });
  if (input.inactiveClientCount > 0) items.push({ label: `${input.inactiveClientCount} clientes sem comprar há mais de 60 dias`, tone: "warning" });
  if (input.monthlyGoal.percent >= 80 && input.monthlyGoal.percent < 100) items.push({ label: `Meta do mês em ${input.monthlyGoal.percent}%`, tone: "warning" });
  if (items.length === 0) items.push({ label: "Está tudo em dia.", tone: "success" });
  return items;
}

export function calculateDashboardPremiumIndicators(
  summary: ExecutiveSummaryMetrics,
  monthlyGoal: MonthlyGoalMetric,
  stock: StockExecutiveMetrics
): DashboardPremiumIndicator[] {
  return [
    {
      label: "Receita do mês",
      value: summary.revenue,
      kind: "currency",
      detail: monthlyGoal.percent >= 100 ? "Meta batida" : `${monthlyGoal.percent}% da meta`,
      tone: monthlyGoal.percent >= 80 ? "positive" : monthlyGoal.percent >= 50 ? "neutral" : "negative",
      direction: monthlyGoal.percent >= 80 ? "up" : monthlyGoal.percent >= 50 ? "flat" : "down",
    },
    {
      label: "Lucro estimado",
      value: summary.profit,
      kind: "currency",
      detail: `${summary.averageMargin.toFixed(0)}% de margem`,
      tone: summary.profit > 0 ? "positive" : "neutral",
      direction: summary.profit > 0 ? "up" : "flat",
    },
    {
      label: "Clientes ativos",
      value: summary.activeClients,
      kind: "number",
      detail: "Compraram no mês",
      tone: summary.activeClients > 0 ? "positive" : "neutral",
      direction: summary.activeClients > 0 ? "up" : "flat",
    },
    {
      label: "Estoque crítico",
      value: stock.lowStockCount + stock.outOfStockCount,
      kind: "number",
      detail: "Precisam atenção",
      tone: stock.lowStockCount + stock.outOfStockCount > 0 ? "negative" : "positive",
      direction: stock.lowStockCount + stock.outOfStockCount > 0 ? "down" : "up",
    },
  ];
}
