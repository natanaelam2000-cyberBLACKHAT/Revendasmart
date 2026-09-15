import type { Firestore } from "firebase-admin/firestore";
import { buildOpportunityFingerprint, buildOpportunityId, type Opportunity } from "../shared/opportunity-rules";
import { repeatPurchaseCandidates, REPEAT_HISTORY_DAYS, REPEAT_SALE_LIMIT, REPEAT_PAIR_LIMIT } from "../shared/repeat-purchase";

export async function detectRepeatPurchaseOpportunities(db: Firestore, uid: string, nowMs: number): Promise<Opportunity[]> {
  const owner = db.collection("users").doc(uid);
  const sales = await owner.collection("sales").where("date", ">=", new Date(nowMs-REPEAT_HISTORY_DAYS*86400000).toISOString())
    .where("date", "<=", new Date(nowMs).toISOString()).orderBy("date", "desc").limit(REPEAT_SALE_LIMIT).get();
  const candidates = repeatPurchaseCandidates(sales.docs.map(doc => doc.data()), nowMs).slice(0, REPEAT_PAIR_LIMIT);
  if (!candidates.length) return [];
  const clientIds = Array.from(new Set(candidates.map(item => item.clientId)));
  const productIds = Array.from(new Set(candidates.map(item => item.productId)));
  const snapshots = await db.getAll(...clientIds.map(id => owner.collection("clients").doc(id)), ...productIds.map(id => owner.collection("products").doc(id)));
  const clients = new Map(clientIds.map((id,index) => [id, snapshots[index].data()]));
  const products = new Map(productIds.map((id,index) => [id, snapshots[clientIds.length+index].data()]));
  return candidates.flatMap(candidate => {
    const client = clients.get(candidate.clientId), product = products.get(candidate.productId);
    if (!client || !product || client.planAccessState === "preserved" || product.planAccessState === "preserved") return [];
    if (typeof product.stock !== "number" || !Number.isFinite(product.stock) || product.stock <= 0) return [];
    // Tenant paths are authoritative; reject contradictory explicit ownership metadata too.
    if ([client, product].some(item => item.tenantUid !== undefined && item.tenantUid !== uid)) return [];
    const name = typeof client.name === "string" && client.name.trim() ? client.name.trim() : "Cliente";
    const productName = typeof product.name === "string" && product.name.trim() ? product.name.trim() : "Produto";
    const pairId = `${candidate.clientId.length}:${candidate.clientId}${candidate.productId}`;
    return [{ id: buildOpportunityId("repeat_purchase", pairId),
      fingerprint: buildOpportunityFingerprint("repeat_purchase", pairId, candidate.lastPurchaseAt),
      type: "repeat_purchase", priority: "medium",
      reason: `${name} costuma comprar ${productName} aproximadamente a cada ${Math.round(candidate.medianIntervalDays)} dias.`,
      evidence: { productId: candidate.productId, productName, medianIntervalDays: candidate.medianIntervalDays,
        lastPurchaseAt: candidate.lastPurchaseAt, expectedNextPurchaseDate: candidate.expectedNextPurchaseDate, purchaseCount: candidate.purchaseCount },
      action: { type: "contact_client", label: "Ver cliente" }, entityReference: { type: "client", id: candidate.clientId, name },
      magnitude: Math.max(0, (nowMs-Date.parse(candidate.expectedNextPurchaseDate))/86400000),
    } as Opportunity];
  });
}
