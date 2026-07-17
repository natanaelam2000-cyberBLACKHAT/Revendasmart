import { differenceInDays, format, parseISO } from "@/lib/date-utils";
import type { Product, Sale } from "@/lib/mock-data";

export type ClientClassification = "Novo Cliente" | "Cliente Frequente" | "Cliente VIP" | "Cliente Inativo";
export type ClientClassificationTone = "blue" | "green" | "purple" | "amber";

export interface ClientPurchaseSummary {
  totalSpent: number;
  averageTicket: number;
  purchaseCount: number;
  firstPurchaseDate: Date | null;
  lastPurchaseDate: Date | null;
  daysWithoutPurchase: number | null;
  biggestPurchase: Sale | null;
  smallestPurchase: Sale | null;
}

export interface ClientClassificationResult {
  label: ClientClassification;
  tone: ClientClassificationTone;
  description: string;
  isInactive: boolean;
}

export interface ClientTimelineProduct {
  productId: string;
  name: string;
  brand: string;
  category: string;
  quantity: number;
  price: number;
}

export interface ClientTimelineItem {
  sale: Sale;
  date: Date | null;
  products: ClientTimelineProduct[];
}

export interface ClientPreferenceItem {
  label: string;
  quantity: number;
  revenue: number;
}

export interface ClientMonthlyEvolutionItem {
  monthKey: string;
  monthLabel: string;
  total: number;
  purchases: number;
}

export interface ClientTimelineMonthGroup {
  monthKey: string;
  monthLabel: string;
  items: ClientTimelineItem[];
}

export interface ClientBehaviorItem {
  title: string;
  description: string;
  tone: "green" | "purple" | "amber" | "blue";
}

export interface ClientCrmMetrics {
  summary: ClientPurchaseSummary;
  classification: ClientClassificationResult;
  timeline: ClientTimelineItem[];
  favoriteProducts: ClientPreferenceItem[];
  favoriteCategories: ClientPreferenceItem[];
  favoriteBrands: ClientPreferenceItem[];
  monthlyEvolution: ClientMonthlyEvolutionItem[];
  timelineByMonth: ClientTimelineMonthGroup[];
  behaviorSummary: ClientBehaviorItem[];
}

const INACTIVE_DAYS = 60;
const VIP_MIN_TOTAL = 1000;
const VIP_MIN_PURCHASES = 5;
const FREQUENT_MIN_PURCHASES = 3;

function safeParseDate(value?: string | null): Date | null {
  if (!value) return null;
  const parsed = parseISO(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function saleTotal(sale: Sale): number {
  const total = Number(sale.totalPrice ?? sale.total ?? 0);
  return Number.isFinite(total) ? total : 0;
}

function buildPreferenceList(entries: Map<string, { quantity: number; revenue: number }>): ClientPreferenceItem[] {
  return Array.from(entries.entries())
    .map(([label, value]) => ({ label, ...value }))
    .filter(item => item.label.trim().length > 0 && item.quantity > 0)
    .sort((a, b) => b.quantity - a.quantity || b.revenue - a.revenue)
    .slice(0, 5);
}

export function filterClientSales(sales: Sale[], clientId?: string): Sale[] {
  if (!clientId) return [];
  return sales.filter(sale => sale.clientId === clientId);
}

export function calculateClientPurchaseSummary(clientSales: Sale[], referenceDate = new Date()): ClientPurchaseSummary {
  const datedSales = clientSales
    .map(sale => ({ sale, date: safeParseDate(sale.date), total: saleTotal(sale) }))
    .sort((a, b) => {
      const aTime = a.date?.getTime() ?? 0;
      const bTime = b.date?.getTime() ?? 0;
      return aTime - bTime;
    });

  const purchaseCount = datedSales.length;
  const totalSpent = datedSales.reduce((sum, item) => sum + item.total, 0);
  const averageTicket = purchaseCount > 0 ? totalSpent / purchaseCount : 0;
  const firstPurchaseDate = datedSales.find(item => item.date)?.date ?? null;
  const lastPurchaseDate = [...datedSales].reverse().find(item => item.date)?.date ?? null;
  const daysWithoutPurchase = lastPurchaseDate ? Math.max(0, differenceInDays(referenceDate, lastPurchaseDate)) : null;
  const sortedByTotal = [...datedSales].sort((a, b) => b.total - a.total);

  return {
    totalSpent,
    averageTicket,
    purchaseCount,
    firstPurchaseDate,
    lastPurchaseDate,
    daysWithoutPurchase,
    biggestPurchase: sortedByTotal[0]?.sale ?? null,
    smallestPurchase: sortedByTotal.length > 0 ? sortedByTotal[sortedByTotal.length - 1].sale : null,
  };
}

export function classifyClient(summary: ClientPurchaseSummary): ClientClassificationResult {
  if (summary.daysWithoutPurchase !== null && summary.daysWithoutPurchase >= INACTIVE_DAYS) {
    return { label: "Cliente Inativo", tone: "amber", description: `Sem comprar há ${summary.daysWithoutPurchase} dias.`, isInactive: true };
  }
  if (summary.totalSpent >= VIP_MIN_TOTAL || summary.purchaseCount >= VIP_MIN_PURCHASES) {
    return { label: "Cliente VIP", tone: "purple", description: "Cliente de alto valor para a loja.", isInactive: false };
  }
  if (summary.purchaseCount >= FREQUENT_MIN_PURCHASES) {
    return { label: "Cliente Frequente", tone: "green", description: "Compra com recorrência.", isInactive: false };
  }
  return {
    label: "Novo Cliente",
    tone: "blue",
    description: summary.purchaseCount === 0 ? "Ainda sem compras registradas." : "Relacionamento em início.",
    isInactive: false,
  };
}

export function buildClientTimeline(clientSales: Sale[], productById: Map<string, Product>): ClientTimelineItem[] {
  return clientSales
    .map(sale => ({
      sale,
      date: safeParseDate(sale.date),
      products: (sale.products || []).map(soldProduct => {
        const product = productById.get(soldProduct.productId);
        return {
          productId: soldProduct.productId,
          name: product?.name || "Produto",
          brand: product?.brand || "Sem marca",
          category: product?.category || "Sem categoria",
          quantity: soldProduct.quantity,
          price: soldProduct.price,
        };
      }),
    }))
    .sort((a, b) => (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0));
}

export function calculateClientPreferences(clientSales: Sale[], productById: Map<string, Product>): { favoriteProducts: ClientPreferenceItem[]; favoriteCategories: ClientPreferenceItem[]; favoriteBrands: ClientPreferenceItem[] } {
  const products = new Map<string, { quantity: number; revenue: number }>();
  const categories = new Map<string, { quantity: number; revenue: number }>();
  const brands = new Map<string, { quantity: number; revenue: number }>();

  for (const sale of clientSales) {
    for (const soldProduct of sale.products || []) {
      const product = productById.get(soldProduct.productId);
      const quantity = Number(soldProduct.quantity || 0);
      const revenue = quantity * Number(soldProduct.price || 0);
      const productName = product?.name || "Produto removido";
      const category = product?.category || "Sem categoria";
      const brand = product?.brand || "Sem marca";
      const productCurrent = products.get(productName) || { quantity: 0, revenue: 0 };
      products.set(productName, { quantity: productCurrent.quantity + quantity, revenue: productCurrent.revenue + revenue });
      const categoryCurrent = categories.get(category) || { quantity: 0, revenue: 0 };
      categories.set(category, { quantity: categoryCurrent.quantity + quantity, revenue: categoryCurrent.revenue + revenue });
      const brandCurrent = brands.get(brand) || { quantity: 0, revenue: 0 };
      brands.set(brand, { quantity: brandCurrent.quantity + quantity, revenue: brandCurrent.revenue + revenue });
    }
  }

  return { favoriteProducts: buildPreferenceList(products), favoriteCategories: buildPreferenceList(categories), favoriteBrands: buildPreferenceList(brands) };
}

export function calculateClientMonthlyEvolution(clientSales: Sale[]): ClientMonthlyEvolutionItem[] {
  const monthly = new Map<string, { monthLabel: string; total: number; purchases: number }>();
  for (const sale of clientSales) {
    const date = safeParseDate(sale.date);
    if (!date) continue;
    const monthKey = format(date, "yyyy-MM");
    const current = monthly.get(monthKey) || { monthLabel: format(date, "MMM/yy"), total: 0, purchases: 0 };
    monthly.set(monthKey, { ...current, total: current.total + saleTotal(sale), purchases: current.purchases + 1 });
  }
  return Array.from(monthly.entries())
    .map(([monthKey, value]) => ({ monthKey, ...value }))
    .sort((a, b) => a.monthKey.localeCompare(b.monthKey))
    .slice(-6);
}

export function groupClientTimelineByMonth(timeline: ClientTimelineItem[]): ClientTimelineMonthGroup[] {
  const groups = new Map<string, ClientTimelineMonthGroup>();
  for (const item of timeline) {
    const key = item.date ? format(item.date, "yyyy-MM") : "sem-data";
    const label = item.date ? format(item.date, "MMMM yyyy") : "Sem data";
    const current = groups.get(key) || { monthKey: key, monthLabel: label, items: [] };
    current.items.push(item);
    groups.set(key, current);
  }
  return Array.from(groups.values()).sort((a, b) => b.monthKey.localeCompare(a.monthKey));
}

export function calculateClientBehaviorSummary(summary: ClientPurchaseSummary, monthlyEvolution: ClientMonthlyEvolutionItem[]): ClientBehaviorItem[] {
  const items: ClientBehaviorItem[] = [];
  if (summary.purchaseCount >= FREQUENT_MIN_PURCHASES) {
    items.push({ title: "Compra frequentemente", description: `${summary.purchaseCount} compras registradas.`, tone: "green" });
  }
  if (summary.averageTicket >= 200 || summary.totalSpent >= VIP_MIN_TOTAL) {
    items.push({ title: "Compra alto valor", description: `Ticket médio de R$ ${summary.averageTicket.toFixed(2)}.`, tone: "purple" });
  }
  if (monthlyEvolution.length >= 3) {
    items.push({ title: "Compra sazonal", description: "Há compras distribuídas em diferentes meses.", tone: "blue" });
  }
  if (summary.daysWithoutPurchase !== null && summary.daysWithoutPurchase >= INACTIVE_DAYS) {
    items.push({ title: "Cliente em risco", description: `Sem comprar há ${summary.daysWithoutPurchase} dias.`, tone: "amber" });
  }
  if (items.length === 0) {
    items.push({ title: "Relacionamento em construção", description: "Ainda há poucos dados para detectar padrões.", tone: "blue" });
  }
  return items;
}

export function calculateClientCrmMetrics(clientSales: Sale[], productById: Map<string, Product>, referenceDate = new Date()): ClientCrmMetrics {
  const summary = calculateClientPurchaseSummary(clientSales, referenceDate);
  const preferences = calculateClientPreferences(clientSales, productById);
  const timeline = buildClientTimeline(clientSales, productById);
  const monthlyEvolution = calculateClientMonthlyEvolution(clientSales);
  return {
    summary,
    classification: classifyClient(summary),
    timeline,
    favoriteProducts: preferences.favoriteProducts,
    favoriteCategories: preferences.favoriteCategories,
    favoriteBrands: preferences.favoriteBrands,
    monthlyEvolution,
    timelineByMonth: groupClientTimelineByMonth(timeline),
    behaviorSummary: calculateClientBehaviorSummary(summary, monthlyEvolution),
  };
}
