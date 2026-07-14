#!/usr/bin/env tsx
import fs from "node:fs";
import path from "node:path";
import {
  PRODUCT_SEARCH_SCHEMA_VERSION,
  buildProductSearchBackfillPatch,
  getProductSearchIndexStatus,
  type ProductSearchInput,
} from "../../client/src/lib/product-search";

interface ProductFixture extends ProductSearchInput {
  id?: string;
  [key: string]: unknown;
}

interface Options {
  uid?: string;
  project?: string;
  environment?: string;
  source?: string;
  output?: string;
  fixture: boolean;
  dryRun: boolean;
  apply: boolean;
  pageSize: number;
  cursor: number;
  help: boolean;
}

const BLOCKED_PROJECTS = new Set(["production", "prod", "revenda-smart", "revendasmart-prod", "revendasmart-backend-prod"]);

function parseArgs(argv: string[]): Options {
  const options: Options = { fixture: false, dryRun: true, apply: false, pageSize: 50, cursor: 0, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--fixture") options.fixture = true;
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--apply") { options.apply = true; options.dryRun = false; }
    else if (arg === "--uid") options.uid = argv[++index];
    else if (arg === "--project") options.project = argv[++index];
    else if (arg === "--environment") options.environment = argv[++index];
    else if (arg === "--source") options.source = argv[++index];
    else if (arg === "--output") options.output = argv[++index];
    else if (arg === "--page-size") options.pageSize = Number(argv[++index]);
    else if (arg === "--cursor") options.cursor = Number(argv[++index]);
    else throw new Error(`Argumento desconhecido: ${arg}`);
  }
  return options;
}

function usage(): string {
  return `Uso seguro:
  npx tsx scripts/search/backfill-search-fields.ts --fixture --uid synthetic-user --project demo-revendasmart --environment emulator --dry-run
  FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 npx tsx scripts/search/backfill-search-fields.ts --source ./fixture.json --output ./out.json --uid synthetic-user --project demo-revendasmart --environment emulator --apply

Este script processa fixture sintetica/local. Ele nao conecta no Firebase real nesta sprint.`;
}

function assertSafe(options: Options): void {
  if (!options.uid || !/^[A-Za-z0-9_-]{6,128}$/.test(options.uid)) throw new Error("--uid obrigatorio e deve ser um tenant valido");
  if (!options.project) throw new Error("--project obrigatorio");
  if (!options.environment) throw new Error("--environment obrigatorio");
  const project = options.project.toLowerCase();
  const env = options.environment.toLowerCase();
  const firebaseConfig = String(process.env.FIREBASE_CONFIG || "").toLowerCase();
  const gcloudProject = String(process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || "").toLowerCase();
  if (BLOCKED_PROJECTS.has(project) || BLOCKED_PROJECTS.has(env) || BLOCKED_PROJECTS.has(gcloudProject) || firebaseConfig.includes("revenda-smart")) {
    throw new Error("Protecao ativa: backfill de busca bloqueado para projeto/ambiente de producao");
  }
  if (!Number.isFinite(options.pageSize) || options.pageSize < 1 || options.pageSize > 100) throw new Error("--page-size deve estar entre 1 e 100");
  if (!Number.isFinite(options.cursor) || options.cursor < 0) throw new Error("--cursor invalido");
  if (options.apply) {
    if (env !== "emulator") throw new Error("--apply permitido apenas com --environment emulator");
    if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error("--apply exige FIRESTORE_EMULATOR_HOST para evitar fallback para producao");
    if (!options.output) throw new Error("--apply exige --output para fixture transformada");
  }
}

function fixtureProducts(): ProductFixture[] {
  return [
    { id: "p1", name: "Perfume Águas de Verão", brand: "Natura", category: "Perfumes", barcode: "0012345678905", productType: "Cosméticos" },
    { id: "p2", name: "Kit 2-em-1", brand: "Marca", category: "Kits", barcode: "", productType: "Geral", searchSchemaVersion: PRODUCT_SEARCH_SCHEMA_VERSION, searchTokens: ["stale"] },
  ];
}

function readProducts(options: Options): ProductFixture[] {
  if (options.fixture) return fixtureProducts();
  if (!options.source) throw new Error("Informe --fixture ou --source");
  const parsed = JSON.parse(fs.readFileSync(path.resolve(options.source), "utf8"));
  const products = Array.isArray(parsed) ? parsed : parsed.products;
  if (!Array.isArray(products)) throw new Error("Fixture deve ser array ou objeto { products: [] }");
  return products as ProductFixture[];
}

function publicProductId(product: ProductFixture, index: number): string {
  return typeof product.id === "string" && product.id.trim() ? product.id.slice(0, 24) : `row-${index}`;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  assertSafe(options);
  const products = readProducts(options);
  const page = products.slice(options.cursor, options.cursor + options.pageSize);
  const transformed = products.map((product) => ({ ...product }));
  const changedIds: string[] = [];
  let alreadyUpdated = 0;
  let needsUpdate = 0;
  let partial = 0;
  let missing = 0;
  let futureSchema = 0;
  let legacySchema = 0;
  let errors = 0;

  page.forEach((product, localIndex) => {
    const absoluteIndex = options.cursor + localIndex;
    try {
      const status = getProductSearchIndexStatus(product);
      if (status === "indexed") alreadyUpdated += 1;
      if (status === "partial") partial += 1;
      if (status === "missing") missing += 1;
      if (status === "future_schema") futureSchema += 1;
      if (status === "legacy_schema") legacySchema += 1;
      const patch = buildProductSearchBackfillPatch(product);
      if (patch) {
        needsUpdate += 1;
        changedIds.push(publicProductId(product, absoluteIndex));
        transformed[absoluteIndex] = { ...transformed[absoluteIndex], ...patch };
      }
    } catch {
      errors += 1;
    }
  });

  if (options.apply && options.output) {
    fs.writeFileSync(path.resolve(options.output), `${JSON.stringify({ products: transformed }, null, 2)}\n`);
  }

  const nextCursor = options.cursor + page.length < products.length ? options.cursor + page.length : null;
  console.log(JSON.stringify({
    dryRun: options.dryRun,
    apply: options.apply,
    writeTarget: options.apply ? "fixture_output_only" : "none",
    uid: options.uid,
    project: options.project,
    environment: options.environment,
    schemaVersion: PRODUCT_SEARCH_SCHEMA_VERSION,
    analyzed: page.length,
    totalFixtureProducts: products.length,
    alreadyUpdated,
    needsUpdate,
    partial,
    missing,
    futureSchema,
    legacySchema,
    errors,
    nextCursor,
    changedIds,
  }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ error: error instanceof Error ? error.message : "unknown_error", dryRunOnly: true }, null, 2));
  process.exit(1);
});
