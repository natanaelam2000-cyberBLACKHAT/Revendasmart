import type { Firestore } from "firebase-admin/firestore";
import { buildOpportunityFingerprint, buildOpportunityId, type Opportunity } from "../shared/opportunity-rules";
import {
  stockRiskCandidates,
  STOCK_RISK_PRODUCT_LIMIT,
  STOCK_RISK_SALES_WINDOW_DAYS,
  STOCK_RISK_SALE_LIMIT,
} from "../shared/stock-risk";

const STOCK_RISK_PRODUCT_LOOKUP_LIMIT = STOCK_RISK_PRODUCT_LIMIT * 2;

export async function detectStockRiskOpportunities(db: Firestore, uid: string, nowMs: number): Promise<Opportunity[]> {
  const owner = db.collection("users").doc(uid);
  const sales = await owner.collection("sales")
    .where("date", ">=", new Date(nowMs - STOCK_RISK_SALES_WINDOW_DAYS * 86_400_000).toISOString())
    .where("date", "<=", new Date(nowMs).toISOString())
    .orderBy("date", "desc")
    .limit(STOCK_RISK_SALE_LIMIT)
    .get();

  if (sales.empty) return [];

  const productIds = Array.from(new Set(sales.docs.flatMap(doc => {
    const products = doc.data().products;
    return Array.isArray(products) ? products.map(item => String(item?.productId ?? "")).filter(Boolean) : [];
  }))).slice(0, STOCK_RISK_PRODUCT_LOOKUP_LIMIT);
  if (!productIds.length) return [];

  const productSnaps = await db.getAll(...productIds.map(id => owner.collection("products").doc(id)));
  const products = productIds.flatMap((id, index) => {
    const data = productSnaps[index].data();
    if (!data) return [];
    if (data.tenantUid !== undefined && data.tenantUid !== uid) return [];
    return [{ productId: id, stock: data.stock, name: data.name, active: data.active, published: data.published, planAccessState: data.planAccessState }];
  });

  return stockRiskCandidates(sales.docs.map(doc => doc.data()), products, nowMs).map(candidate => {
    const product = products.find(item => item.productId === candidate.productId);
    const name = typeof product?.name === "string" && product.name.trim() ? product.name.trim() : "Produto";
    return {
      id: buildOpportunityId("stock_risk", candidate.productId),
      fingerprint: buildOpportunityFingerprint("stock_risk", candidate.productId, `${candidate.currentStock}:${candidate.latestSaleAt}`),
      type: "stock_risk",
      priority: candidate.priority,
      reason: `${name} vendeu ${candidate.unitsSoldInWindow} unidade(s) nos últimos ${STOCK_RISK_SALES_WINDOW_DAYS} dias e o estoque cobre aproximadamente ${candidate.roundedDaysOfCover} dia(s).`,
      evidence: {
        unitsSoldInWindow: candidate.unitsSoldInWindow,
        saleDaysInWindow: candidate.saleDaysInWindow,
        averageDailyUnitsSold: Number(candidate.averageDailyUnitsSold.toFixed(2)),
        daysOfCover: candidate.roundedDaysOfCover,
        currentStock: candidate.currentStock,
        latestSaleAt: candidate.latestSaleAt,
        salesWindowDays: STOCK_RISK_SALES_WINDOW_DAYS,
      },
      action: { type: "open_product", label: "Repor estoque" },
      entityReference: { type: "product", id: candidate.productId, name },
      magnitude: Math.max(0, 14 - candidate.daysOfCover),
    } as Opportunity & { magnitude: number };
  });
}
