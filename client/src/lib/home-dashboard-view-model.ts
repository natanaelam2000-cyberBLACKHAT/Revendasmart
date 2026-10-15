import type { AppSettings, Client, Product, Sale } from "@/lib/mock-data";
import { buildLastSaleByClientId, isClientInactive } from "@/lib/client-activity";

export type HomeSummaryKpiId = "monthlyRevenue" | "monthlyProfit" | "monthlySalesCount" | "monthComparison";
export const HOME_SUMMARY_KPI_IDS: HomeSummaryKpiId[] = ["monthlyRevenue", "monthlyProfit", "monthlySalesCount", "monthComparison"];

type PriorityTone = "danger" | "warning" | "info";
type InsightTone = "success" | "warning" | "info";

/**
 * RELEASE-26: nome do query param que carrega o contexto do card de Prioridades até o destino
 * (`/products?priority=out-of-stock`, `/clients?priority=inactive-clients`). Os VALORES são os
 * próprios `id` de HomePriorityItem — um só vocabulário, nunca uma segunda lista de strings que
 * pudesse desalinhar do que o card realmente representa. products.tsx/clients.tsx leem este mesmo
 * nome de param para aplicar o filtro correspondente.
 */
export const PRIORITY_QUERY_PARAM = "priority";

export interface HomePriorityItem {
  id: string;
  label: string;
  detail: string;
  path: string;
  severity: number;
  tone: PriorityTone;
}


export interface HomeMainInsight {
  title: string;
  value: string;
  detail: string;
  path?: string;
  tone: InsightTone;
}

export interface HomeDashboardViewModel {
  showProductMetrics: boolean;
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
  /** PLAN-IMPL-09-FINAL §31/§32 — só a contagem (nunca a lista): a prioridade "sem serviço" só precisa
   * saber se é zero. Ausência de fetch (modo products) chega aqui como 0, o que é seguro porque essa
   * prioridade já é condicionada a businessMode "services"/"both" abaixo, nunca só à contagem. */
  servicesCount?: number;
  referenceDate?: Date;
}

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

/**
 * RELEASE-26: custo dos itens de UMA venda — nunca "receita do item menos custo". A receita exibida
 * (`saleTotal`, `sale.totalPrice`) já é o valor final COM desconto do carrinho aplicado; os preços de
 * `sale.products[].price` são por unidade, ANTES desse desconto. A versão antiga somava
 * quantidade × (preço-do-item SEM desconto − custo) e chamava isso de "lucro do mês" — uma base maior
 * que a receita exibida, então o lucro podia ficar MAIOR que o faturamento sempre que houvesse
 * desconto relevante (o "R$ 400,00 de faturamento / R$ 403,90 de lucro" observado em produção).
 *
 * Correção: lucro = receita (já com desconto) − custo (soma de quantidade × custo cadastrado do
 * produto, o desconto do carrinho não muda quanto o produto custou). Produto sem `costPrice` continua
 * contribuindo custo 0 — nunca um custo inventado. Produto excluído do catálogo depois da venda
 * também continua contribuindo custo 0 (mesmo comportamento de antes: sem dado, sem suposição).
 */
function saleCost(sale: Sale, productsById: Map<string, Product>): number {
  return (sale.products || []).reduce((sum, item) => {
    const product = productsById.get(item.productId);
    if (!product) return sum;
    const quantity = safeNumber(item.quantity);
    return sum + quantity * safeNumber(product.costPrice);
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

export function buildHomeDashboardViewModel({ products, clients, sales, settings, servicesCount = 0, referenceDate = new Date() }: HomeDashboardInput): HomeDashboardViewModel {
  const productsById = new Map(products.map((product) => [product.id, product]));
  const previousMonth = previousMonthOf(referenceDate);
  const lowStockThreshold = safeNumber(settings.lowStockThreshold) > 0 ? safeNumber(settings.lowStockThreshold) : 3;
  // RELEASE-26: extraído para client-activity.ts — é o MESMO critério que /clients usa para aplicar o
  // filtro "clientes inativos" quando o card de Prioridades leva o usuário até lá. Duas implementações
  // do mesmo cálculo poderiam divergir (o card diz "24" e a lista filtrada mostra outro número).
  const lastSaleByClientId = buildLastSaleByClientId(sales);
  const categoryRevenue = new Map<string, number>();

  let monthlyRevenue = 0;
  let monthlyProfit = 0;
  let monthlySalesCount = 0;
  let previousRevenue = 0;

  for (const sale of sales) {
    const parsedDate = parseSafeDate(sale.date);
    if (!parsedDate) continue;

    if (sameMonth(parsedDate, referenceDate)) {
      monthlySalesCount += 1;
      const monthlySaleRevenue = saleTotal(sale);
      monthlyRevenue += monthlySaleRevenue;
      monthlyProfit += monthlySaleRevenue - saleCost(sale, productsById);
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
  const inactiveClientsCount = clients.filter((client) => isClientInactive(lastSaleByClientId.get(client.id), referenceDate)).length;
  const storeName = String(settings.storeName || settings.storeIdentity?.name || "Minha loja").trim() || "Minha loja";
  const catalogActive = settings.enablePublicCatalog !== false && Boolean(settings.catalogSlug || settings.catalog_slug);

  const allPriorities: HomePriorityItem[] = [];
  const addPriority = (condition: boolean, item: HomePriorityItem) => {
    if (condition) allPriorities.push(item);
  };

  // PLAN-IMPL-09-FINAL §31/§32 — "sem produto" nunca é prioridade para quem opera só serviços (zero
  // produto é o estado ESPERADO desse perfil, não um problema); undefined preserva o comportamento
  // anterior ao ticket (sempre produto), já que só usuários que passaram pelo onboarding adaptativo ou
  // mudaram em Configurações têm businessMode "services" explícito.
  const businessMode = settings.businessMode as AppSettings["businessMode"];
  const showProductMetrics = businessMode !== "services";
  addPriority(businessMode !== "services" && products.length === 0, {
    id: "no-products",
    label: "Nenhum produto cadastrado",
    detail: "Cadastre produtos para começar a vender.",
    path: "/add-product",
    severity: 0,
    tone: "danger",
  });
  addPriority((businessMode === "services" || businessMode === "both") && servicesCount === 0, {
    id: "no-services",
    label: "Nenhum serviço cadastrado",
    detail: "Cadastre serviços para começar a receber agendamentos.",
    path: "/servicos/novo",
    severity: 0,
    tone: "danger",
  });
  addPriority(showProductMetrics && outOfStockProducts.length > 0, {
    id: "out-of-stock",
    label: `${outOfStockProducts.length} produto(s) sem estoque`,
    detail: "Reponha antes de divulgar.",
    path: `/products?${PRIORITY_QUERY_PARAM}=out-of-stock`,
    severity: 1,
    tone: "danger",
  });
  addPriority(showProductMetrics && lowStockProducts.length > 0, {
    id: "low-stock",
    label: `${lowStockProducts.length} produto(s) acabando`,
    detail: `Limite atual: ${lowStockThreshold} unidade(s).`,
    path: `/products?${PRIORITY_QUERY_PARAM}=low-stock`,
    severity: 2,
    tone: "warning",
  });
  addPriority(inactiveClientsCount > 0, {
    id: "inactive-clients",
    label: `${inactiveClientsCount} cliente(s) sem comprar há mais de 60 dias`,
    detail: "Considere uma abordagem de relacionamento.",
    path: `/clients?${PRIORITY_QUERY_PARAM}=inactive-clients`,
    severity: 3,
    tone: "warning",
  });
  addPriority(showProductMetrics && products.length > 0 && productsWithoutImage.length > 0, {
    id: "products-without-image",
    label: `${productsWithoutImage.length} produto(s) sem imagem`,
    detail: "Imagens ajudam no catálogo e nas divulgações.",
    path: `/products?${PRIORITY_QUERY_PARAM}=products-without-image`,
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
    showProductMetrics,
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
    mainInsight: showProductMetrics ? buildMainInsight({
      monthlyRevenue,
      monthlySalesCount,
      previousRevenue,
      categoryRevenue,
      products,
      outOfStockCount: outOfStockProducts.length,
      lowStockCount: lowStockProducts.length,
    }) : null,
  };
}
