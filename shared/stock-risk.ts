/** Deterministic stock coverage from recent sale items and current product stock. */
export const STOCK_RISK_SALES_WINDOW_DAYS = 30;
export const STOCK_RISK_SALE_LIMIT = 500;
export const STOCK_RISK_PRODUCT_LIMIT = 30;
export const STOCK_RISK_MIN_SALE_DAYS = 2;
export const STOCK_RISK_MIN_UNITS_SOLD = 4;
export const STOCK_RISK_MEDIUM_DAYS_OF_COVER = 14;
export const STOCK_RISK_HIGH_DAYS_OF_COVER = 7;

const DAY = 86_400_000;
const SAFE_ID = /^[A-Za-z0-9_-]{1,100}$/;

export interface StockRiskProductInput {
  readonly productId: string;
  readonly stock: unknown;
  readonly name?: unknown;
  readonly active?: unknown;
  readonly published?: unknown;
  readonly planAccessState?: unknown;
}

export interface StockRiskCandidate {
  readonly productId: string;
  readonly unitsSoldInWindow: number;
  readonly saleDaysInWindow: number;
  readonly averageDailyUnitsSold: number;
  readonly daysOfCover: number;
  readonly roundedDaysOfCover: number;
  readonly currentStock: number;
  readonly latestSaleAt: string;
  readonly priority: "high" | "medium";
}

function isValidSale(sale: Record<string, unknown>, nowMs: number): sale is Record<string, unknown> & { date: string; products: readonly Record<string, unknown>[] } {
  if (sale.status !== undefined && !["completed", "paid"].includes(String(sale.status))) return false;
  if (["cancelled", "canceled", "refunded", "deleted", "cancelledAt", "canceledAt", "refundedAt", "deletedAt"].some(key => Boolean(sale[key]))) return false;
  if (Number(sale.refundAmount ?? 0) > 0 || Number(sale.refundedAmount ?? 0) > 0) return false;
  if (typeof sale.date !== "string") return false;
  const date = Date.parse(sale.date);
  if (!Number.isFinite(date) || new Date(date).toISOString() !== sale.date || date > nowMs || date < nowMs - STOCK_RISK_SALES_WINDOW_DAYS * DAY) return false;
  if (typeof sale.totalPrice !== "number" || !Number.isFinite(sale.totalPrice) || sale.totalPrice <= 0) return false;
  return Array.isArray(sale.products) && sale.products.length <= 100;
}

function isActiveProduct(product: StockRiskProductInput): boolean {
  if (product.planAccessState === "preserved") return false;
  if (product.active === false || product.published === false) return false;
  return true;
}

export function stockRiskCandidates(
  sales: readonly Record<string, unknown>[],
  products: readonly StockRiskProductInput[],
  nowMs: number,
): StockRiskCandidate[] {
  if (!Number.isFinite(nowMs)) return [];
  const productById = new Map(products.filter(product => SAFE_ID.test(product.productId)).map(product => [product.productId, product]));
  const rows = new Map<string, { units: number; days: Set<number>; latest: number }>();

  for (const sale of sales.slice(0, STOCK_RISK_SALE_LIMIT)) {
    if (!isValidSale(sale, nowMs)) continue;
    const saleMs = Date.parse(sale.date);
    const saleDay = Math.floor(saleMs / DAY);
    for (const item of sale.products) {
      if (!item || typeof item.productId !== "string" || !SAFE_ID.test(item.productId)) continue;
      if (!productById.has(item.productId)) continue;
      const quantity = Number(item.quantity);
      if (!Number.isFinite(quantity) || quantity <= 0) continue;
      let row = rows.get(item.productId);
      if (!row) { row = { units: 0, days: new Set(), latest: 0 }; rows.set(item.productId, row); }
      row.units += quantity;
      row.days.add(saleDay);
      row.latest = Math.max(row.latest, saleMs);
    }
  }

  const candidates: StockRiskCandidate[] = [];
  for (const [productId, row] of Array.from(rows.entries())) {
    const product = productById.get(productId);
    if (!product || !isActiveProduct(product)) continue;
    const stock = Number(product.stock);
    if (!Number.isFinite(stock) || stock <= 0) continue;
    if (row.units < STOCK_RISK_MIN_UNITS_SOLD || row.days.size < STOCK_RISK_MIN_SALE_DAYS) continue;
    const averageDailyUnitsSold = row.units / STOCK_RISK_SALES_WINDOW_DAYS;
    if (!Number.isFinite(averageDailyUnitsSold) || averageDailyUnitsSold <= 0) continue;
    const daysOfCover = stock / averageDailyUnitsSold;
    if (!Number.isFinite(daysOfCover) || daysOfCover <= 0 || daysOfCover > STOCK_RISK_MEDIUM_DAYS_OF_COVER) continue;
    candidates.push({
      productId,
      unitsSoldInWindow: row.units,
      saleDaysInWindow: row.days.size,
      averageDailyUnitsSold,
      daysOfCover,
      roundedDaysOfCover: Math.max(1, Math.round(daysOfCover)),
      currentStock: stock,
      latestSaleAt: new Date(row.latest).toISOString(),
      priority: daysOfCover <= STOCK_RISK_HIGH_DAYS_OF_COVER ? "high" : "medium",
    });
  }

  return candidates.sort((a, b) =>
    a.daysOfCover - b.daysOfCover ||
    b.unitsSoldInWindow - a.unitsSoldInWindow ||
    a.productId.localeCompare(b.productId),
  ).slice(0, STOCK_RISK_PRODUCT_LIMIT);
}
