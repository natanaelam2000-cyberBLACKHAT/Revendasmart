import type { AppSettings, Client, Product, Sale } from "@/lib/mock-data";

export type HomeSummaryKpiId = "monthlyRevenue" | "monthlyProfit" | "monthlySalesCount" | "monthComparison";
export const HOME_SUMMARY_KPI_IDS: HomeSummaryKpiId[] = ["monthlyRevenue", "monthlyProfit", "monthlySalesCount", "monthComparison"];

type PriorityTone = "danger" | "warning" | "info";
type InsightTone = "success" | "warning" | "info";

export interface HomePriorityItem {
  id: string;
  label: string;
  detail: string;
  path: string;
  severity: number;
  tone: PriorityTone;
}

export interface HomePerformancePoint {
  key: string;
  label: string;
  revenue: number;
  salesCount: number;
}

export interface HomeMainInsight {
  title: string;
  value: string;
  detail: string;
  path?: string;
  tone: InsightTone;
}

export interface HomeDashboardViewModel {
  store: {
    name: string;
    periodLabel: string;
  };
  summary: {
    monthlyRevenue: number;
    monthlyProfit: number;
    monthlySalesCount: number;
    previousRevenue: number;
    comparisonPercent: number | null;
    comparisonLabel: string;
    comparisonTone: "up" | "down" | "flat" | "neutral";
  };
  performance: {
    label: string;
    points: HomePerformancePoint[];
    maxValue: number;
    hasData: boolean;
  };
  goal: {
    target: number;
    hasExplicitGoal: boolean;
    current: number;
    remainingToGoal: number;
    progressPercent: number;
  };
  priorities: HomePriorityItem[];
  priorityTotalCount: number;
  hiddenPriorityCount: number;
  mainInsight: HomeMainInsight | null;
}

interface HomeDashboardInput {
  products: Product[];
  clients: Client[];
  sales: Sale[];
  settings: Partial<AppSettings> & Record<string, unknown>;
  referenceDate?: Date;
}

const DAY_MS = 86_400_000;
const PERFORMANCE_DAYS = 7;

export function formatHomeCurrency(value: number): string {
  const safe = Number.isFinite(value) ? value : 0;
  return safe.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function safeNumber(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseSafeDate(value?: string | null): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function sameMonth(date: Date, referenceDate: Date): boolean {
  return date.getFullYear() === referenceDate.getFullYear() && date.getMonth() === referenceDate.getMonth();
}

function previousMonthOf(referenceDate: Date): Date {
  return new Date(referenceDate.getFullYear(), referenceDate.getMonth() - 1, 1);
}

function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function productStock(product: Product): number {
  return Math.max(0, safeNumber(product.stock));
}

function resolveMonthlyGoal(settings: HomeDashboardInput["settings"]): { target: number; hasExplicitGoal: boolean } {
  const candidates = [settings.monthlyGoal, settings.monthlyRevenueGoal, settings.salesGoal];
  const explicit = candidates.map(safeNumber).find((value) => value > 0) || 0;
  return { target: explicit, hasExplicitGoal: explicit > 0 };
}

function saleTotal(sale: Sale): number {
  return safeNumber(sale.totalPrice ?? sale.total ?? sale.subtotal);
}

function saleProfit(sale: Sale, productsById: Map<string, Product>): number {
  return (sale.products || []).reduce((sum, item) => {
    const product = productsById.get(item.productId);
    if (!product) return sum;
    const quantity = safeNumber(item.quantity);
    const price = safeNumber(item.price);
    return sum + quantity * (price - safeNumber(product.costPrice));
  }, 0);
}

function buildComparison(currentRevenue: number, previousRevenue: number): Pick<HomeDashboardViewModel["summary"], "comparisonPercent" | "comparisonLabel" | "comparisonTone"> {
  if (currentRevenue === 0 && previousRevenue === 0) {
    return { comparisonPercent: null, comparisonLabel: "Sem histórico anterior", comparisonTone: "neutral" };
  }
  if (previousRevenue <= 0) {
    return {
      comparisonPercent: null,
      comparisonLabel: currentRevenue > 0 ? "Novo mês com vendas" : "Abaixo do mês anterior",
      comparisonTone: currentRevenue > 0 ? "up" : "down",
    };
  }
  const percent = Math.round(((currentRevenue - previousRevenue) / previousRevenue) * 100);
  return {
    comparisonPercent: percent,
    comparisonLabel: percent === 0 ? "Estável vs. mês anterior" : `${percent > 0 ? "+" : ""}${percent}% vs. mês anterior`,
    comparisonTone: percent > 0 ? "up" : percent < 0 ? "down" : "flat",
  };
}

function buildPerformancePoints(referenceDate: Date, sales: Sale[]): HomeDashboardViewModel["performance"] {
  const points: HomePerformancePoint[] = [];
  const totals = new Map<string, { revenue: number; salesCount: number }>();

  for (const sale of sales) {
    const parsed = parseSafeDate(sale.date);
    if (!parsed) continue;
    const key = dateKey(parsed);
    const current = totals.get(key) || { revenue: 0, salesCount: 0 };
    current.revenue += saleTotal(sale);
    current.salesCount += 1;
    totals.set(key, current);
  }

  for (let offset = PERFORMANCE_DAYS - 1; offset >= 0; offset -= 1) {
    const day = new Date(referenceDate);
    day.setHours(12, 0, 0, 0);
    day.setDate(referenceDate.getDate() - offset);
    const key = dateKey(day);
    const total = totals.get(key) || { revenue: 0, salesCount: 0 };
    points.push({
      key,
      label: day.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }),
      revenue: total.revenue,
      salesCount: total.salesCount,
    });
  }

  const maxValue = Math.max(0, ...points.map((point) => point.revenue));
  return { label: "Últimos 7 dias", points, maxValue, hasData: points.some((point) => point.salesCount > 0) };
}

function topEntry(map: Map<string, number>): { label: string; value: number } | null {
  let best: { label: string; value: number } | null = null;
  map.forEach((value, label) => {
    if (!best || value > best.value) best = { label, value };
  });
  return best;
}

function buildMainInsight(args: {
  monthlyRevenue: number;
  monthlySalesCount: number;
  previousRevenue: number;
  categoryRevenue: Map<string, number>;
  products: Product[];
  outOfStockCount: number;
  lowStockCount: number;
}): HomeMainInsight | null {
  const topCategory = topEntry(args.categoryRevenue);
  if (topCategory && topCategory.value > 0) {
    return {
      title: "Categoria em destaque",
      value: topCategory.label,
      detail: `${formatHomeCurrency(topCategory.value)} faturados no mês`,
      path: "/reports",
      tone: "success",
    };
  }

  if (args.monthlyRevenue > args.previousRevenue && args.previousRevenue > 0) {
    return {
      title: "Mês em crescimento",
      value: formatHomeCurrency(args.monthlyRevenue - args.previousRevenue),
      detail: "Acima do faturamento do mês anterior até agora.",
      path: "/monthly-sales",
      tone: "success",
    };
  }

  if (args.outOfStockCount + args.lowStockCount > 0) {
    return {
      title: "Estoque pede atenção",
      value: `${args.outOfStockCount + args.lowStockCount} produto(s) críticos`,
      detail: "Repor itens importantes evita perder vendas.",
      path: "/products",
      tone: "warning",
    };
  }

  if (args.products.length > 0 && args.monthlySalesCount === 0) {
    return {
      title: "Pronta para vender",
      value: `${args.products.length} produto(s) cadastrados`,
      detail: "Divulgue o catálogo ou registre a primeira venda do mês.",
      path: "/catalog",
      tone: "info",
    };
  }

  return null;
}

export function buildHomeDashboardViewModel({ products, clients, sales, settings, referenceDate = new Date() }: HomeDashboardInput): HomeDashboardViewModel {
  const productsById = new Map(products.map((product) => [product.id, product]));
  const previousMonth = previousMonthOf(referenceDate);
  const lowStockThreshold = safeNumber(settings.lowStockThreshold) > 0 ? safeNumber(settings.lowStockThreshold) : 3;
  const lastSaleByClientId = new Map<string, Date>();
  // Critério preservado: cliente ativo na Home é cliente com venda recente registrada no histórico usado pela tela.
  const categoryRevenue = new Map<string, number>();

  let monthlyRevenue = 0;
  let monthlyProfit = 0;
  let monthlySalesCount = 0;
  let previousRevenue = 0;

  for (const sale of sales) {
    const parsedDate = parseSafeDate(sale.date);
    if (!parsedDate) continue;
    if (sale.clientId) {
      const currentLastSale = lastSaleByClientId.get(sale.clientId);
      if (!currentLastSale || parsedDate > currentLastSale) lastSaleByClientId.set(sale.clientId, parsedDate);
    }

    if (sameMonth(parsedDate, referenceDate)) {
      monthlySalesCount += 1;
      monthlyRevenue += saleTotal(sale);
      monthlyProfit += saleProfit(sale, productsById);
      for (const item of sale.products || []) {
        const product = productsById.get(item.productId);
        if (!product) continue;
        const revenue = safeNumber(item.quantity) * safeNumber(item.price);
        const category = product.category || "Sem categoria";
        categoryRevenue.set(category, (categoryRevenue.get(category) || 0) + revenue);
      }
    } else if (sameMonth(parsedDate, previousMonth)) {
      previousRevenue += saleTotal(sale);
    }
  }

  const comparison = buildComparison(monthlyRevenue, previousRevenue);
  const goal = resolveMonthlyGoal(settings);
  const outOfStockProducts = products.filter((product) => productStock(product) <= 0);
  const lowStockProducts = products.filter((product) => productStock(product) > 0 && productStock(product) <= lowStockThreshold);
  const productsWithoutImage = products.filter((product) => !product.imageUrl && !product.thumbnailUrl);
  const inactiveClientsCount = clients.filter((client) => {
    const lastSale = lastSaleByClientId.get(client.id);
    return Boolean(lastSale && Math.floor((referenceDate.getTime() - lastSale.getTime()) / DAY_MS) >= 60);
  }).length;
  const storeName = String(settings.storeName || settings.storeIdentity?.name || "Minha loja").trim() || "Minha loja";
  const catalogActive = settings.enablePublicCatalog !== false && Boolean(settings.catalogSlug || settings.catalog_slug);

  const allPriorities: HomePriorityItem[] = [];
  const addPriority = (condition: boolean, item: HomePriorityItem) => {
    if (condition) allPriorities.push(item);
  };

  addPriority(products.length === 0, {
    id: "no-products",
    label: "Nenhum produto cadastrado",
    detail: "Cadastre produtos para começar a vender.",
    path: "/add-product",
    severity: 0,
    tone: "danger",
  });
  addPriority(outOfStockProducts.length > 0, {
    id: "out-of-stock",
    label: `${outOfStockProducts.length} produto(s) sem estoque`,
    detail: "Reponha antes de divulgar.",
    path: "/products",
    severity: 1,
    tone: "danger",
  });
  addPriority(lowStockProducts.length > 0, {
    id: "low-stock",
    label: `${lowStockProducts.length} produto(s) acabando`,
    detail: `Limite atual: ${lowStockThreshold} unidade(s).`,
    path: "/products",
    severity: 2,
    tone: "warning",
  });
  addPriority(inactiveClientsCount > 0, {
    id: "inactive-clients",
    label: `${inactiveClientsCount} cliente(s) sem comprar há mais de 60 dias`,
    detail: "Considere uma abordagem de relacionamento.",
    path: "/clients",
    severity: 3,
    tone: "warning",
  });
  addPriority(products.length > 0 && productsWithoutImage.length > 0, {
    id: "products-without-image",
    label: `${productsWithoutImage.length} produto(s) sem imagem`,
    detail: "Imagens ajudam no catálogo e nas divulgações.",
    path: "/products",
    severity: 4,
    tone: "info",
  });
  addPriority(!catalogActive, {
    id: "catalog",
    label: "Catálogo público não está pronto",
    detail: "Ative ou revise o link antes de compartilhar.",
    path: "/catalog",
    severity: 5,
    tone: "info",
  });
  addPriority(storeName === "Minha loja", {
    id: "store-name",
    label: "Nome da loja pendente",
    detail: "Complete a identidade da loja nas configurações.",
    path: "/settings",
    severity: 6,
    tone: "info",
  });

  allPriorities.sort((a, b) => a.severity - b.severity || a.label.localeCompare(b.label));

  return {
    store: {
      name: storeName,
      periodLabel: referenceDate.toLocaleDateString("pt-BR", { month: "long", year: "numeric" }),
    },
    summary: {
      monthlyRevenue,
      monthlyProfit,
      monthlySalesCount,
      previousRevenue,
      ...comparison,
    },
    performance: buildPerformancePoints(referenceDate, sales),
    goal: {
      target: goal.target,
      hasExplicitGoal: goal.hasExplicitGoal,
      current: monthlyRevenue,
      remainingToGoal: goal.hasExplicitGoal ? Math.max(0, goal.target - monthlyRevenue) : 0,
      progressPercent: goal.hasExplicitGoal ? Math.min(100, Math.round((monthlyRevenue / goal.target) * 100)) : 0,
    },
    priorities: allPriorities.slice(0, 3),
    priorityTotalCount: allPriorities.length,
    hiddenPriorityCount: Math.max(0, allPriorities.length - 3),
    mainInsight: buildMainInsight({
      monthlyRevenue,
      monthlySalesCount,
      previousRevenue,
      categoryRevenue,
      products,
      outOfStockCount: outOfStockProducts.length,
      lowStockCount: lowStockProducts.length,
    }),
  };
}
