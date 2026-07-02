import { differenceInDays, format, parseISO } from "date-fns";
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

export interface ClientCrmMetrics {
  summary: ClientPurchaseSummary;
  classification: ClientClassificationResult;
  timeline: ClientTimelineItem[];
  favoriteCategories: ClientPreferenceItem[];
  favoriteBrands: ClientPreferenceItem[];
  monthlyEvolution: ClientMonthlyEvolutionItem[];
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

export function calculateClientPreferences(clientSales: Sale[], productById: Map<string, Product>): { favoriteCategories: ClientPreferenceItem[]; favoriteBrands: ClientPreferenceItem[] } {
  const categories = new Map<string, { quantity: number; revenue: number }>();
  const brands = new Map<string, { quantity: number; revenue: number }>();

  for (const sale of clientSales) {
    for (const soldProduct of sale.products || []) {
      const product = productById.get(soldProduct.productId);
      const quantity = Number(soldProduct.quantity || 0);
      const revenue = quantity * Number(soldProduct.price || 0);
      const category = product?.category || "Sem categoria";
      const brand = product?.brand || "Sem marca";
      const categoryCurrent = categories.get(category) || { quantity: 0, revenue: 0 };
      categories.set(category, { quantity: categoryCurrent.quantity + quantity, revenue: categoryCurrent.revenue + revenue });
      const brandCurrent = brands.get(brand) || { quantity: 0, revenue: 0 };
      brands.set(brand, { quantity: brandCurrent.quantity + quantity, revenue: brandCurrent.revenue + revenue });
    }
  }

  return { favoriteCategories: buildPreferenceList(categories), favoriteBrands: buildPreferenceList(brands) };
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

export function calculateClientCrmMetrics(clientSales: Sale[], productById: Map<string, Product>, referenceDate = new Date()): ClientCrmMetrics {
  const summary = calculateClientPurchaseSummary(clientSales, referenceDate);
  const preferences = calculateClientPreferences(clientSales, productById);
  return {
    summary,
    classification: classifyClient(summary),
    timeline: buildClientTimeline(clientSales, productById),
    favoriteCategories: preferences.favoriteCategories,
    favoriteBrands: preferences.favoriteBrands,
    monthlyEvolution: calculateClientMonthlyEvolution(clientSales),
  };
}
