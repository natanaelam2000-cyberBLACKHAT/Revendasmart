/** Conservative cadence from authoritative sale records; no customer/product lookup or writes here. */
export const REPEAT_HISTORY_DAYS = 365;
export const REPEAT_SALE_LIMIT = 500;
export const REPEAT_PAIR_LIMIT = 30;
const DAY = 86_400_000;
const SAFE_ID = /^[A-Za-z0-9_-]{1,100}$/;
export interface RepeatPurchaseCandidate {
  clientId: string; productId: string; lastPurchaseAt: string;
  medianIntervalDays: number; expectedNextPurchaseDate: string; purchaseCount: number;
}

export function repeatPurchaseCandidates(sales: readonly Record<string, unknown>[], nowMs: number): RepeatPurchaseCandidate[] {
  if (!Number.isFinite(nowMs)) return [];
  const pairs = new Map<string, { clientId: string; productId: string; dates: Map<number, number> }>();
  for (const sale of sales.slice(0, REPEAT_SALE_LIMIT)) {
    // The current finalizer omits status. Unknown lifecycle states are conservatively excluded.
    if (sale.status !== undefined && !["completed", "paid"].includes(String(sale.status))) continue;
    if (["cancelled", "canceled", "refunded", "deleted", "cancelledAt", "canceledAt", "refundedAt", "deletedAt"].some(key => Boolean(sale[key]))) continue;
    if (Number(sale.refundAmount ?? 0) > 0 || Number(sale.refundedAmount ?? 0) > 0) continue;
    if (typeof sale.clientId !== "string" || !SAFE_ID.test(sale.clientId)) continue;
    if (typeof sale.date !== "string") continue;
    const date = Date.parse(sale.date);
    if (!Number.isFinite(date) || new Date(date).toISOString() !== sale.date || date > nowMs || date < nowMs - REPEAT_HISTORY_DAYS * DAY) continue;
    if (typeof sale.totalPrice !== "number" || !Number.isFinite(sale.totalPrice) || sale.totalPrice <= 0) continue;
    if (!Array.isArray(sale.products) || sale.products.length > 100) continue;
    for (const item of sale.products) {
      if (!item || typeof item.productId !== "string" || !SAFE_ID.test(item.productId) || !Number.isFinite(item.quantity) || item.quantity <= 0) continue;
      const key = JSON.stringify([sale.clientId, item.productId]);
      let pair = pairs.get(key);
      if (!pair) { pair = { clientId: sale.clientId, productId: item.productId, dates: new Map() }; pairs.set(key, pair); }
      // Split transactions/duplicate line items on a UTC day count as one purchase day.
      const day = Math.floor(date / DAY);
      pair.dates.set(day, Math.max(date, pair.dates.get(day) ?? 0));
    }
  }
  const candidates: RepeatPurchaseCandidate[] = [];
  for (const pair of Array.from(pairs.values())) {
    const dates = Array.from(pair.dates.values()).sort((a,b) => a-b).slice(-6);
    if (dates.length < 3) continue;
    const intervals = dates.slice(1).map((date,index) => (date-dates[index])/DAY);
    if (intervals.some(days => days < 7 || days > 90)) continue;
    const sorted = [...intervals].sort((a,b) => a-b);
    const middle = Math.floor(sorted.length/2);
    const median = sorted.length % 2 ? sorted[middle] : (sorted[middle-1]+sorted[middle])/2;
    // ±25% accommodates month lengths; two days minimum allows ordinary calendar variation.
    if (intervals.some(days => Math.abs(days-median) > Math.max(2, median*0.25))) continue;
    const last = dates[dates.length-1];
    const expected = last + median*DAY;
    // Never early; do not present an old missed cycle as a timely reorder opportunity.
    if (nowMs < expected || nowMs > expected + Math.max(7, median*0.25)*DAY) continue;
    candidates.push({ clientId: pair.clientId, productId: pair.productId, lastPurchaseAt: new Date(last).toISOString(),
      medianIntervalDays: median, expectedNextPurchaseDate: new Date(expected).toISOString(), purchaseCount: dates.length });
  }
  return candidates.sort((a,b) => a.expectedNextPurchaseDate.localeCompare(b.expectedNextPurchaseDate) || a.clientId.localeCompare(b.clientId) || a.productId.localeCompare(b.productId));
}
