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
    const saleDate = parseISO(sale.date);
    if (
      saleDate.getMonth() !== referenceDate.getMonth() ||
      saleDate.getFullYear() !== referenceDate.getFullYear()
    ) {
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

    const saleDate = parseISO(sale.date);
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
      differenceInDays(now, parseISO(product.lastSoldDate)) <= 2 &&
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

    if (product.lastSoldDate && differenceInDays(now, parseISO(product.lastSoldDate)) >= 30) {
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
