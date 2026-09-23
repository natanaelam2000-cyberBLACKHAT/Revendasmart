import assert from "node:assert/strict";
import { buildHomeDashboardViewModel } from "../client/src/lib/home-dashboard-view-model";

const referenceDate = new Date("2026-09-23T12:00:00Z");
const product = { id: "p1", name: "Produto", stock: 0, category: "Geral" } as any;
const sale = { id: "sale-1", date: "2026-09-10T12:00:00Z", totalPrice: 100, products: [{ productId: "p1", quantity: 1, price: 100 }] } as any;
const base = { storeName: "Loja", monthlyGoal: 1000, enablePublicCatalog: true, catalogSlug: "loja" } as any;

const products = buildHomeDashboardViewModel({
  settings: { ...base, businessMode: "products" },
  products: [product], clients: [], sales: [sale], referenceDate,
});
assert.equal(products.showProductMetrics, true);
assert.ok(products.priorities.some((item) => item.id === "out-of-stock"));
assert.equal(products.summary.monthlySalesCount, 1);

const services = buildHomeDashboardViewModel({
  settings: { ...base, businessMode: "services" },
  products: [product], clients: [], sales: [sale], servicesCount: 1, referenceDate,
});
assert.equal(services.showProductMetrics, false);
assert.equal(services.mainInsight, null);
assert.ok(!services.priorities.some((item) => ["no-products", "out-of-stock", "low-stock", "products-without-image"].includes(item.id)));
assert.ok(!services.priorities.some((item) => /produto|estoque|venda|faturamento/i.test(`${item.label} ${item.detail}`)));

const both = buildHomeDashboardViewModel({
  settings: { ...base, businessMode: "both" },
  products: [product], clients: [], sales: [sale], servicesCount: 1, referenceDate,
});
assert.equal(both.showProductMetrics, true);
assert.ok(both.priorities.some((item) => item.id === "out-of-stock"));

const unresolved = buildHomeDashboardViewModel({
  settings: { ...base }, products: [], clients: [], sales: [], referenceDate,
});
assert.equal(unresolved.showProductMetrics, true, "unresolved UI is gated by UserSettings/PrivateRouter");

console.log("SERVICES-UX-01 dashboard view model tests passed.");
