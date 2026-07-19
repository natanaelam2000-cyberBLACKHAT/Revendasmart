import type { AppSettings, Client, Product, Sale } from "@/lib/mock-data";

export type HomeSummaryKpiId = "monthlyRevenue" | "monthlyProfit" | "averageTicket" | "activeClients";
export const HOME_SUMMARY_KPI_IDS: HomeSummaryKpiId[] = ["monthlyRevenue", "monthlyProfit", "averageTicket", "activeClients"];

export type HomeAccordionSectionId = "month" | "inventory" | "productPerformance" | "health" | "insights";
export const HOME_ACCORDION_SECTION_IDS: HomeAccordionSectionId[] = ["month", "inventory", "productPerformance", "health", "insights"];
export const HOME_ACCORDION_STORAGE_KEY = "revendasmart:home:accordion:v1";

type PriorityTone = "danger" | "warning" | "info" | "success";

export interface HomePriorityItem {
  id: string;
  label: string;
  detail: string;
  path: string;
  severity: number;
  tone: PriorityTone;
}

export interface HomeDashboardViewModel {
  summary: {
    monthlyRevenue: number;
    monthlyProfit: number;
    averageTicket: number | null;
    activeClients: number;
    monthlySalesCount: number;
  };
  month: {
    target: number;
    hasExplicitGoal: boolean;
    current: number;
    previousRevenue: number;
    projectedRevenue: number;
    remainingToGoal: number;
    requiredDailyRevenue: number;
    progressPercent: number;
    daysRemaining: number;
  };
  inventory: {
    totalProducts: number;
    outOfStockCount: number;
    lowStockCount: number;
    stagnantCount: number;
    totalInventoryValue: number;
    stagnantInventoryValue: number;
  };
  products: {
    champion: { product: Product; quantity: number; revenue: number } | null;
    stagnant: { product: Product; daysWithoutSale: number | null; stockValue: number; neverSold: boolean } | null;
    critical: Product[];
  };
  health: {
    score: number;
    label: string;
    areasNeedingAttention: number;
    domains: Array<{ label: string; score: number }>;
    mainOpportunity: string;
  };
  insights: {
    headline: string;
    top: Array<{ label: string; value: string; detail: string }>;
  };
  priorities: HomePriorityItem[];
}

interface HomeDashboardInput {
  products: Product[];
  clients: Client[];
  sales: Sale[];
  settings: Partial<AppSettings> & Record<string, unknown>;
  referenceDate?: Date;
}

const DAY_MS = 86_400_000;
const DEFAULT_MONTHLY_GOAL = 10_000;

export function formatHomeCurrency(value: number): string {
  const safe = Number.isFinite(value) ? value : 0;
  return safe.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function resolveHomeAccordionSectionId(value: unknown): HomeAccordionSectionId | null {
  return typeof value === "string" && (HOME_ACCORDION_SECTION_IDS as string[]).includes(value) ? value as HomeAccordionSectionId : null;
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

function daysInMonth(referenceDate: Date): number {
  return new Date(referenceDate.getFullYear(), referenceDate.getMonth() + 1, 0).getDate();
}

function resolveMonthlyGoal(settings: HomeDashboardInput["settings"]): { target: number; hasExplicitGoal: boolean } {
  const candidates = [settings.monthlyGoal, settings.monthlyRevenueGoal, settings.salesGoal];
  const explicit = candidates.map(safeNumber).find((value) => value > 0);
  return { target: explicit || DEFAULT_MONTHLY_GOAL, hasExplicitGoal: Boolean(explicit) };
}

function productStock(product: Product): number {
  return Math.max(0, safeNumber(product.stock));
}

function productCostValue(product: Product): number {
  return safeNumber(product.costPrice) * productStock(product);
}

function profitFromSaleItem(product: Product | undefined, quantity: number, price: number): number {
  if (!product) return 0;
  return quantity * (price - safeNumber(product.costPrice));
}

function scoreLabel(score: number): string {
  if (score >= 80) return "Saudável";
  if (score >= 60) return "Em evolução";
  return "Precisa de atenção";
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function bestRank(map: Map<string, number>): { label: string; value: number } | null {
  let best: { label: string; value: number } | null = null;
  map.forEach((value, label) => {
    if (!best || value > best.value) best = { label, value };
  });
  return best;
}

export function buildHomeDashboardViewModel({ products, clients, sales, settings, referenceDate = new Date() }: HomeDashboardInput): HomeDashboardViewModel {
  const threshold = safeNumber(settings.lowStockThreshold) > 0 ? safeNumber(settings.lowStockThreshold) : 3;
  const productsById = new Map(products.map((product) => [product.id, product]));
  const currentMonth = referenceDate;
  const previousMonth = previousMonthOf(referenceDate);
  const activeClientIds = new Set<string>();
  // Critério preservado: cliente ativo na Home é cliente com venda no mês atual.
  const lastSaleByClientId = new Map<string, Date>();
  const lastSaleByProductId = new Map<string, Date>();
  const monthlyProductStats = new Map<string, { product: Product; quantity: number; revenue: number; profit: number }>();
  const categoryProfit = new Map<string, number>();
  const brandProfit = new Map<string, number>();
  let monthlyRevenue = 0;
  let monthlyProfit = 0;
  let monthlySalesCount = 0;
  let previousRevenue = 0;

  for (const sale of sales) {
    const saleDate = parseSafeDate(sale.date);
    const saleTotal = safeNumber(sale.totalPrice ?? sale.total);
    if (sale.clientId && saleDate) {
      const current = lastSaleByClientId.get(sale.clientId);
      if (!current || saleDate > current) lastSaleByClientId.set(sale.clientId, saleDate);
    }

    const isCurrentMonth = Boolean(saleDate && sameMonth(saleDate, currentMonth));
    const isPreviousMonth = Boolean(saleDate && sameMonth(saleDate, previousMonth));
    if (isCurrentMonth) {
      monthlyRevenue += saleTotal;
      monthlySalesCount += 1;
      if (sale.clientId) activeClientIds.add(sale.clientId);
    } else if (isPreviousMonth) {
      previousRevenue += saleTotal;
    }

    for (const item of sale.products || []) {
      const product = productsById.get(item.productId);
      const quantity = safeNumber(item.quantity);
      const price = safeNumber(item.price);
      if (product && saleDate) {
        const currentLast = lastSaleByProductId.get(product.id);
        if (!currentLast || saleDate > currentLast) lastSaleByProductId.set(product.id, saleDate);
      }
      if (!isCurrentMonth || !product) continue;
      const revenue = quantity * price;
      const profit = profitFromSaleItem(product, quantity, price);
      monthlyProfit += profit;
      const row = monthlyProductStats.get(product.id) || { product, quantity: 0, revenue: 0, profit: 0 };
      row.quantity += quantity;
      row.revenue += revenue;
      row.profit += profit;
      monthlyProductStats.set(product.id, row);
      categoryProfit.set(product.category || "Sem categoria", (categoryProfit.get(product.category || "Sem categoria") || 0) + profit);
      brandProfit.set(product.brand || "Sem marca", (brandProfit.get(product.brand || "Sem marca") || 0) + profit);
    }
  }

  const { target, hasExplicitGoal } = resolveMonthlyGoal(settings);
  const dayOfMonth = Math.max(1, referenceDate.getDate());
  const totalDays = daysInMonth(referenceDate);
  const daysRemaining = Math.max(0, totalDays - dayOfMonth);
  const remainingToGoal = Math.max(0, target - monthlyRevenue);

  const outOfStockProducts = products.filter((product) => productStock(product) <= 0);
  const lowStockProducts = products.filter((product) => productStock(product) > 0 && productStock(product) <= threshold);
  const criticalProducts = [...outOfStockProducts, ...lowStockProducts]
    .sort((a, b) => productStock(a) - productStock(b) || a.name.localeCompare(b.name))
    .slice(0, 3);

  const stagnantProducts = products
    .filter((product) => productStock(product) > 0)
    .map((product) => {
      const lastSale = lastSaleByProductId.get(product.id) || parseSafeDate(product.lastSoldDate || null);
      const daysWithoutSale = lastSale ? Math.floor((referenceDate.getTime() - lastSale.getTime()) / DAY_MS) : null;
      const neverSold = daysWithoutSale === null;
      return { product, daysWithoutSale, stockValue: productCostValue(product), neverSold };
    })
    .filter((item) => item.neverSold || (item.daysWithoutSale ?? 0) > 90)
    .sort((a, b) => b.stockValue - a.stockValue || productStock(b.product) - productStock(a.product));

  const inactiveClientsCount = clients.filter((client) => {
    const lastSale = lastSaleByClientId.get(client.id);
    return Boolean(lastSale && Math.floor((referenceDate.getTime() - lastSale.getTime()) / DAY_MS) >= 60);
  }).length;

  const champion = Array.from(monthlyProductStats.values()).sort((a, b) => b.quantity - a.quantity || b.revenue - a.revenue)[0] || null;
  const topCategory = bestRank(categoryProfit);
  const topBrand = bestRank(brandProfit);
  const highestMarginProduct = products
    .filter((product) => safeNumber(product.salePrice) > 0)
    .map((product) => {
      const margin = safeNumber(product.salePrice) - safeNumber(product.costPrice);
      return { product, marginPercent: Math.round((margin / safeNumber(product.salePrice)) * 100) };
    })
    .sort((a, b) => b.marginPercent - a.marginPercent)[0] || null;

  const totalInventoryValue = products.reduce((sum, product) => sum + productCostValue(product), 0);
  const stagnantInventoryValue = stagnantProducts.reduce((sum, item) => sum + item.stockValue, 0);
  const catalogActive = settings.enablePublicCatalog !== false && Boolean(settings.catalogSlug || settings.catalog_slug);

  const priorities: HomePriorityItem[] = [];
  const addPriority = (when: boolean, item: HomePriorityItem) => { if (when) priorities.push(item); };
  addPriority(products.length === 0, { id: "no-products", label: "Nenhum produto cadastrado", detail: "Cadastre produtos para liberar vendas e catálogo.", path: "/add-product", severity: 0, tone: "danger" });
  addPriority(outOfStockProducts.length > 0, { id: "out-of-stock", label: `${outOfStockProducts.length} produtos sem estoque`, detail: "Reponha antes de divulgar.", path: "/products", severity: 0, tone: "danger" });
  addPriority(lowStockProducts.length > 0, { id: "low-stock", label: `${lowStockProducts.length} produtos com estoque baixo`, detail: `Limite atual: ${threshold} unidade(s).`, path: "/products", severity: 1, tone: "warning" });
  addPriority(inactiveClientsCount > 0, { id: "inactive-clients", label: `${inactiveClientsCount} clientes sem comprar há mais de 60 dias`, detail: "Vale chamar com oferta ou reposição.", path: "/clients", severity: 2, tone: "warning" });
  addPriority(monthlySalesCount === 0, { id: "no-sales", label: "Nenhuma venda registrada no mês", detail: "Registre uma venda para liberar indicadores.", path: "/sale", severity: 2, tone: "info" });
  addPriority(!catalogActive, { id: "catalog", label: "Catálogo público precisa de atenção", detail: "Configure o link antes de divulgar.", path: "/catalog", severity: 3, tone: "info" });

  const sortedPriorities = priorities.sort((a, b) => a.severity - b.severity || a.label.localeCompare(b.label)).slice(0, 3);
  if (sortedPriorities.length === 0) sortedPriorities.push({ id: "ok", label: "Nenhuma prioridade crítica agora", detail: "Acompanhe a loja diariamente.", path: "/dashboard", severity: 9, tone: "success" });

  const salesScore = clampScore(monthlySalesCount === 0 ? 25 : 55 + Math.min(45, monthlySalesCount * 5));
  const stockScore = products.length === 0 ? 50 : clampScore(100 - outOfStockProducts.length * 12 - lowStockProducts.length * 5);
  const catalogScore = clampScore((catalogActive ? 70 : 25) + (products.length > 0 ? 15 : 0) + (products.some((product) => product.imageUrl || product.thumbnailUrl) ? 15 : 0));
  const clientsScore = clampScore(clients.length === 0 ? 25 : 60 + Math.min(40, activeClientIds.size * 8));
  const organizationScore = clampScore((settings.storeName ? 35 : 0) + (settings.appTheme ? 25 : 0) + (settings.onboarding_completed ? 25 : 0) + (settings.whatsapp || settings.phone ? 15 : 0));
  const domains = [
    { label: "Vendas", score: salesScore },
    { label: "Estoque", score: stockScore },
    { label: "Catálogo", score: catalogScore },
    { label: "Clientes", score: clientsScore },
    { label: "Organização", score: organizationScore },
  ];
  const healthScore = clampScore(domains.reduce((sum, domain) => sum + domain.score, 0) / domains.length);
  const weakestDomain = [...domains].sort((a, b) => a.score - b.score)[0];
  const mainOpportunity = sortedPriorities.find((item) => item.id !== "ok")?.label || (weakestDomain ? `Melhorar ${weakestDomain.label.toLowerCase()}` : "Manter a rotina atual");

  const topInsights = [
    topCategory ? { label: "Categoria mais lucrativa", value: topCategory.label, detail: formatHomeCurrency(topCategory.value) } : null,
    topBrand ? { label: "Marca mais lucrativa", value: topBrand.label, detail: formatHomeCurrency(topBrand.value) } : null,
    highestMarginProduct ? { label: "Melhor margem", value: highestMarginProduct.product.name, detail: `${highestMarginProduct.marginPercent}%` } : null,
  ].filter((item): item is { label: string; value: string; detail: string } => Boolean(item)).slice(0, 3);

  return {
    summary: {
      monthlyRevenue,
      monthlyProfit,
      averageTicket: monthlySalesCount > 0 ? monthlyRevenue / monthlySalesCount : null,
      activeClients: activeClientIds.size,
      monthlySalesCount,
    },
    month: {
      target,
      hasExplicitGoal,
      current: monthlyRevenue,
      previousRevenue,
      projectedRevenue: (monthlyRevenue / dayOfMonth) * totalDays,
      remainingToGoal,
      requiredDailyRevenue: daysRemaining > 0 ? remainingToGoal / daysRemaining : remainingToGoal,
      progressPercent: target > 0 ? Math.min(999, Math.round((monthlyRevenue / target) * 100)) : 0,
      daysRemaining,
    },
    inventory: {
      totalProducts: products.length,
      outOfStockCount: outOfStockProducts.length,
      lowStockCount: lowStockProducts.length,
      stagnantCount: stagnantProducts.length,
      totalInventoryValue,
      stagnantInventoryValue,
    },
    products: {
      champion,
      stagnant: stagnantProducts[0] || null,
      critical: criticalProducts,
    },
    health: {
      score: healthScore,
      label: scoreLabel(healthScore),
      areasNeedingAttention: domains.filter((domain) => domain.score < 70).length,
      domains,
      mainOpportunity,
    },
    insights: {
      headline: topInsights[0] ? `${topInsights[0].value} é destaque comercial` : "Ainda não há dados suficientes para insights",
      top: topInsights,
    },
    priorities: sortedPriorities,
  };
}
