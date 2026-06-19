import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path: string) => fs.readFileSync(path, "utf8");
const routes = read("server/routes.ts");
const publicCatalog = read("client/src/pages/public-catalog.tsx");
const layout = read("client/src/components/layout.tsx");
const settings = read("client/src/pages/settings.tsx");
const images = read("client/src/components/ProductImageCard.tsx");
const subscribe = read("client/src/pages/subscribe.tsx");
const dashboard = read("client/src/pages/dashboard.tsx");
const vercel = JSON.parse(read("vercel.json"));

assert.match(routes, /catalogSlug.*catalog_slug.*userSlug.*slug/);
assert.match(routes, /catalogEnabled/);
assert.match(publicCatalog, /catalogEnabled === false/);
assert.match(images, /photoUrl/);
assert.match(images, /onError/);
assert.match(images, /Sem foto/);
for (const label of ["Início", "Produtos", "Vendas", "Catálogo", "Anúncios", "Conta"]) assert.ok(layout.includes(`label:"${label}"`));
for (const path of ["/clients", "/billings", "/subscribe"]) assert.ok(settings.includes(`path: "${path}"`));
assert.match(subscribe, /Plano atual/);
assert.match(subscribe, /Number\.isNaN/);
assert.match(dashboard, /slice\(0, 5\)/);
assert.match(dashboard, /Lucro/);
assert.ok(vercel.rewrites.some((rule: any) => rule.source === "/u/:storeSlug" && rule.destination === "/index.html"));

const response = await fetch("https://revendasmart-backend-cc2743rkmq-uc.a.run.app/api/public/catalog/adriana-perfumes");
assert.equal(response.status, 200);
const catalog = await response.json() as any;
assert.ok(catalog.settings?.storeName);
assert.ok(Array.isArray(catalog.products));
console.log("Smoke tests passed: catalog, images, navigation, modules, subscription and ranking.");