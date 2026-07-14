import type { AppSettings, Client, Product, Sale } from "@/lib/mock-data";

export type StoreHealthTone = "success" | "warning" | "danger";
export type RecommendationPriority = "high" | "medium" | "low";

export interface StoreHealthReason { label: string; points: number; detail: string; }
export interface StoreIntelligenceRecommendation { title: string; detail: string; path: string; priority: RecommendationPriority; }
export interface StoreIntelligenceResult {
  health: { score: number; label: string; tone: StoreHealthTone; gained: StoreHealthReason[]; missing: StoreHealthReason[]; };
  products: {
    topSoldProduct: { product: Product; quantity: number; revenue: number } | null;
    mostProfitableProduct: { product: Product; profit: number; revenue: number } | null;
    lowStockProducts: Product[];
    criticalStockProducts: Product[];
    unsoldProducts: Product[];
    productsWithoutImage: Product[];
    productsWithoutDescription: Product[];
    bestCategory: { label: string; quantity: number; revenue: number } | null;
    bestBrand: { label: string; quantity: number; revenue: number } | null;
    publishedProductsCount: number;
    publishedCategoriesCount: number;
  };
  customers: {
    vipClient: { client: Client; revenue: number; purchases: number } | null;
    mostFrequentClient: { client: Client; revenue: number; purchases: number } | null;
    inactiveClients: Client[];
    clientsWithoutSales: Client[];
    recurringClientsCount: number;
  };
  financial: { todayRevenue: number; monthRevenue: number; previousMonthRevenue: number; revenueChangePercent: number; monthSalesCount: number; averageTicket: number; estimatedProfit: number; };
  catalog: { active: boolean; slugConfigured: boolean; productsPublished: number; categoriesPublished: number; productsWithoutImage: number; productsWithoutDescription: number; };
  recommendations: StoreIntelligenceRecommendation[];
  dataLimitations: string[];
}

interface StoreIntelligenceInput { products: Product[]; clients: Client[]; sales: Sale[]; settings: AppSettings; lowStockThreshold?: number; referenceDate?: Date; }

type ProductStat = { product: Product; quantity: number; revenue: number; profit: number };
type ClientStat = { client: Client; revenue: number; purchases: number };
type Rank = { quantity: number; revenue: number };
const DAY_MS = 86400000;
const prio: Record<RecommendationPriority, number> = { high: 0, medium: 1, low: 2 };
const totalOf = (sale: Sale) => Number(sale.totalPrice ?? sale.total ?? 0) || 0;
const validDate = (value?: string | null) => { const date = value ? new Date(value) : null; return date && !Number.isNaN(date.getTime()) ? date : null; };
const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const sameMonth = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
const pct = (current: number, previous: number) => previous === 0 ? (current > 0 ? 100 : 0) : Math.round(((current - previous) / previous) * 100);
const hasImg = (p: Product) => Boolean(p.thumbnailUrl || p.imageUrl || p.storagePath || p.thumbnailStoragePath || p.imageId);
const hasCatalog = (s: AppSettings) => s.enablePublicCatalog !== false && !s.disablePublicCatalog && Boolean(s.catalogSlug || s.catalog_slug);
const hasPay = (s: AppSettings) => Boolean(s.pixKey?.trim() || s.paymentLink?.trim());

function addRank(map: Map<string, Rank>, key: string, quantity: number, revenue: number) {
  const row = map.get(key) || { quantity: 0, revenue: 0 };
  row.quantity += quantity;
  row.revenue += revenue;
  map.set(key, row);
}

function bestRank(map: Map<string, Rank>) {
  let best: { label: string; quantity: number; revenue: number } | null = null;
  map.forEach((value, label) => { if (!best || value.revenue > best.revenue) best = { label, ...value }; });
  return best;
}

function bestBy<T>(items: T[], score: (item: T) => number) {
  return items.reduce<T | null>((best, item) => !best || score(item) > score(best) ? item : best, null);
}

export function buildStoreIntelligence({ products, clients, sales, settings, lowStockThreshold = 3, referenceDate = new Date() }: StoreIntelligenceInput): StoreIntelligenceResult {
  const threshold = Number.isFinite(Number(lowStockThreshold)) ? Number(lowStockThreshold) : 3;
  const productsById = new Map(products.map((product) => [product.id, product]));
  const clientsById = new Map(clients.map((client) => [client.id, client]));
  const productStats = new Map<string, ProductStat>();
  const clientStats = new Map<string, ClientStat>();
  const lastSale = new Map<string, Date>();
  const categoryRank = new Map<string, Rank>();
  const brandRank = new Map<string, Rank>();
  const previousMonth = new Date(referenceDate.getFullYear(), referenceDate.getMonth() - 1, 1);
  let todayRevenue = 0, monthRevenue = 0, previousMonthRevenue = 0, estimatedProfit = 0, monthSalesCount = 0;

  for (const sale of sales) {
    const date = validDate(sale.date);
    const total = totalOf(sale);
    if (sale.clientId) {
      const client = clientsById.get(sale.clientId);
      if (client) {
        const row = clientStats.get(sale.clientId) || { client, revenue: 0, purchases: 0 };
        row.revenue += total;
        row.purchases += 1;
        clientStats.set(sale.clientId, row);
      }
      if (date && (!lastSale.get(sale.clientId) || date > lastSale.get(sale.clientId)!)) lastSale.set(sale.clientId, date);
    }
    if (date && sameDay(date, referenceDate)) todayRevenue += total;
    if (date && sameMonth(date, referenceDate)) { monthRevenue += total; monthSalesCount += 1; }
    if (date && sameMonth(date, previousMonth)) previousMonthRevenue += total;

    for (const item of sale.products || []) {
      const product = productsById.get(item.productId);
      if (!product) continue;
      const quantity = Number(item.quantity || 0);
      const price = Number(item.price || 0);
      const revenue = quantity * price;
      const profit = quantity * (price - Number(product.costPrice || 0));
      const row = productStats.get(product.id) || { product, quantity: 0, revenue: 0, profit: 0 };
      row.quantity += quantity;
      row.revenue += revenue;
      row.profit += profit;
      productStats.set(product.id, row);
      if (date && sameMonth(date, referenceDate)) estimatedProfit += profit;
      addRank(categoryRank, product.category || "Sem categoria", quantity, revenue);
      addRank(brandRank, product.brand || "Sem marca", quantity, revenue);
    }
  }

  const soldIds = new Set(productStats.keys());
  const productRows = Array.from(productStats.values());
  const clientRows = Array.from(clientStats.values());
  const lowStockProducts = products.filter((product) => product.stock > 0 && product.stock <= threshold);
  const criticalStockProducts = products.filter((product) => product.stock <= 0);
  const productsWithoutImage = products.filter((product) => !hasImg(product));
  const productsWithoutDescription = products.filter((product) => !product.description?.trim());
  const publishedProducts = products.filter((product) => product.stock > 0);
  const inactiveClients = clients.filter((client) => { const date = lastSale.get(client.id); return Boolean(date && (referenceDate.getTime() - date.getTime()) / DAY_MS >= 60); });
  const catalog = {
    active: hasCatalog(settings),
    slugConfigured: Boolean(settings.catalogSlug || settings.catalog_slug),
    productsPublished: publishedProducts.length,
    categoriesPublished: new Set(publishedProducts.map((product) => product.category).filter(Boolean)).size,
    productsWithoutImage: productsWithoutImage.length,
    productsWithoutDescription: productsWithoutDescription.length,
  };
  const storeName = settings.storeName?.trim();
  const checks = [
    [Boolean(storeName && storeName !== "Minha Revenda"), 10, "Nome da loja"],
    [Boolean(settings.onboarding_theme_selected || settings.appTheme), 8, "Tema visual"],
    [catalog.active, 12, "Catalogo ativo"],
    [products.length > 0, 12, "Produtos cadastrados"],
    [clients.length > 0, 10, "Clientes cadastrados"],
    [sales.length > 0, 14, "Primeira venda"],
    [criticalStockProducts.length === 0, 10, "Sem ruptura"],
    [lowStockProducts.length === 0, 8, "Estoque saudavel"],
    [Boolean(settings.onboarding_completed || settings.onboarding_completed_at), 8, "Configuracao concluida"],
    [hasPay(settings), 8, "Cobranca configurada"],
  ] as const;
  const gained = checks.filter(([ok]) => ok).map(([, points, label]) => ({ label, points, detail: "OK" }));
  const missing = checks.filter(([ok]) => !ok).map(([, points, label]) => ({ label, points, detail: "Pendente" }));
  const score = Math.min(100, gained.reduce((sum, item) => sum + item.points, 0));
  const rec: StoreIntelligenceRecommendation[] = [];
  const add = (when: boolean, title: string, detail: string, path: string, priority: RecommendationPriority) => { if (when) rec.push({ title, detail, path, priority }); };
  add(!storeName || storeName === "Minha Revenda", "Complete o nome da loja", "Melhora a confianca no catalogo.", "/settings", "high");
  add(products.length === 0, "Cadastre seu primeiro produto", "Libera catalogo, estoque e vendas.", "/add-product", "high");
  add(clients.length === 0, "Cadastre seus primeiros clientes", "Libera CRM e recorrencia.", "/clients", "medium");
  add(sales.length === 0, "Registre a primeira venda", "Os indicadores aparecem com vendas reais.", "/sale", "high");
  add(!catalog.active, "Ative o catalogo publico", "Deixe um link pronto para compartilhar.", "/catalog", "medium");
  add(productsWithoutImage.length > 0, "Adicione fotos aos produtos", `${productsWithoutImage.length} produto(s) sem imagem.`, "/products", "medium");
  add(productsWithoutDescription.length > 0, "Complete descricoes", `${productsWithoutDescription.length} produto(s) sem descricao.`, "/products", "low");
  add(criticalStockProducts.length > 0, "Reponha produtos esgotados", `${criticalStockProducts.length} produto(s) sem estoque.`, "/products", "high");
  add(lowStockProducts.length > 0, "Acompanhe estoque baixo", `${lowStockProducts.length} produto(s) abaixo do limite.`, "/products", "medium");
  add(inactiveClients.length > 0, "Reative clientes parados", `${inactiveClients.length} cliente(s) ha 60+ dias sem comprar.`, "/clients", "medium");
  add(productRows.length < products.length && sales.length > 0, "Crie campanha para produtos sem venda", "Ha produtos cadastrados que ainda nao venderam.", "/marketing", "low");
  add(!hasPay(settings), "Configure uma forma de cobranca", "Pix ou link aceleram o fechamento.", "/settings/mercadopago", "low");
  if (rec.length === 0 && score >= 80) rec.push({ title: "Loja em bom ritmo", detail: "Acompanhe estoque, clientes e catalogo semanalmente.", path: "/dashboard", priority: "low" });

  return {
    health: { score, label: score >= 80 ? "Saudavel" : score >= 55 ? "Em evolucao" : "Precisa de atencao", tone: score >= 80 ? "success" : score >= 55 ? "warning" : "danger", gained, missing },
    products: {
      topSoldProduct: bestBy(productRows, (row) => row.quantity),
      mostProfitableProduct: bestBy(productRows.filter((row) => row.revenue > 0), (row) => row.profit),
      lowStockProducts,
      criticalStockProducts,
      unsoldProducts: products.filter((product) => !soldIds.has(product.id)),
      productsWithoutImage,
      productsWithoutDescription,
      bestCategory: bestRank(categoryRank),
      bestBrand: bestRank(brandRank),
      publishedProductsCount: catalog.productsPublished,
      publishedCategoriesCount: catalog.categoriesPublished,
    },
    customers: {
      vipClient: bestBy(clientRows, (row) => row.revenue),
      mostFrequentClient: bestBy(clientRows, (row) => row.purchases),
      inactiveClients,
      clientsWithoutSales: clients.filter((client) => !clientStats.has(client.id)),
      recurringClientsCount: clientRows.filter((client) => client.purchases >= 2).length,
    },
    financial: { todayRevenue, monthRevenue, previousMonthRevenue, revenueChangePercent: pct(monthRevenue, previousMonthRevenue), monthSalesCount, averageTicket: monthSalesCount ? monthRevenue / monthSalesCount : 0, estimatedProfit },
    catalog,
    recommendations: rec.sort((a, b) => prio[a.priority] - prio[b.priority]).slice(0, 6),
    dataLimitations: [
      "Cobrancas nao entram no score do Dashboard porque esta tela nao carrega cobrancas, evitando novas leituras Firestore.",
      "Clientes/produtos recem-cadastrados so podem ser identificados quando houver campo de data confiavel nos documentos.",
    ],
  };
}
