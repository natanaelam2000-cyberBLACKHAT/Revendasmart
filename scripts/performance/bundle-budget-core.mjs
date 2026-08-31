// PERF-BUDGET-ARCH-01 — lógica pura de avaliação dos budgets de bundle, sem tocar `fs`/`process`, para poder
// ser testada com manifests/tamanhos sintéticos (script/performance-bundle-budget-tests.ts) sem precisar de
// um build real do Vite. O wrapper de CLI (check-bundle-budgets.mjs) lê o disco e chama só `evaluateBudgets`.
//
// GOVERNANÇA (ver também os comentários ao lado de cada seção do config em check-bundle-budgets.mjs):
// 1. Initial boot é gate rígido — a árvore de `imports` estáticos do entry (nunca `dynamicImports`).
// 2. Cada rota lazy tem budget explícito por nome lógico (manifest `name`, nunca regex de filename+hash);
//    uma rota sem budget explícito cai no teto default — nenhuma rota nova passa "de graça".
// 3. Vendor chunks relevantes têm budget pelo mesmo motivo/mecanismo.
// 4. Total JS/gzip viram safety ceilings (crescimento absurdo do artefato inteiro), não o gate principal.
// 5. Nenhum budget deve subir automaticamente num ticket de feature — só após auditoria real mostrando que
//    não há economia segura (mesmo processo já usado nas rodadas SERV-UI-01/02/03).

export function kb(bytes) {
  return Math.round((bytes / 1024) * 100) / 100;
}

/** BFS pelos `imports` estáticos do entry `index.html` — nunca segue `dynamicImports` (é exatamente isso
 * que separa "precisa estar pronto antes de navegar" de "carrega sob demanda quando uma rota lazy abre"). */
export function computeBootFiles(manifest, entryKey = "index.html") {
  const visited = new Set();
  const files = new Set();
  function visit(key) {
    if (visited.has(key) || !manifest[key]) return;
    visited.add(key);
    const entry = manifest[key];
    if (entry.file) files.add(entry.file);
    for (const imp of entry.imports || []) visit(imp);
  }
  visit(entryKey);
  return files;
}

function sizeOf(assetSizes, file) {
  return assetSizes[file] ?? { rawBytes: 0, gzipBytes: 0 };
}

/** Entradas de página lazy: manifest entries cujo `src` está em client/src/pages (dynamic entries reais,
 * nunca chunks compartilhados/vendor). O nome lógico vem de `entry.name` (o nome do manualChunk/entry point
 * do Rollup), nunca do filename com hash. */
function collectRouteEntries(manifest) {
  const routes = [];
  for (const [key, entry] of Object.entries(manifest)) {
    if (typeof entry.src === "string" && entry.src.startsWith("src/pages/") && entry.file) {
      routes.push({ key, name: entry.name, file: entry.file });
    }
  }
  return routes;
}

/** Chunks vendor: manifest entries (sempre chunks, nunca entries de página) cujo nome lógico começa com
 * "vendor-" — mesmo prefixo já usado pelo manualChunks() de vite.config.ts. */
function collectVendorEntries(manifest) {
  const vendors = [];
  const seenFiles = new Set();
  for (const entry of Object.values(manifest)) {
    if (typeof entry.name === "string" && entry.name.startsWith("vendor-") && entry.file && !seenFiles.has(entry.file)) {
      seenFiles.add(entry.file);
      vendors.push({ name: entry.name, file: entry.file });
    }
  }
  return vendors;
}

/** Chunks compartilhados "comuns" — nem rota de página, nem vendor: helpers/componentes reaproveitados
 * entre várias rotas lazy (ex.: service-agenda-helpers, CatalogShowcase). Usado só para visibilidade +
 * budgets pontuais nos poucos chunks realmente críticos (ver §8 do ticket — não uma regra por arquivo). */
function collectSharedChunkEntries(manifest) {
  const shared = [];
  const seenFiles = new Set();
  for (const entry of Object.values(manifest)) {
    if (
      typeof entry.name === "string"
      && !entry.name.startsWith("vendor-")
      && entry.file
      && !seenFiles.has(entry.file)
      && !(typeof entry.src === "string" && entry.src.startsWith("src/pages/"))
    ) {
      seenFiles.add(entry.file);
      shared.push({ name: entry.name, file: entry.file });
    }
  }
  return shared;
}

/**
 * @param {object} params
 * @param {Record<string, any>} params.manifest — conteúdo de dist/public/.vite/manifest.json (parseado).
 * @param {Record<string, {rawBytes: number, gzipBytes: number}>} params.assetSizes — tamanhos por `file`
 *   relativo (o mesmo valor de `entry.file` no manifest, ex.: "assets/catalog-XXXX.js").
 * @param {object} params.config — ver a config real em check-bundle-budgets.mjs.
 */
export function evaluateBudgets({ manifest, assetSizes, config }) {
  const errors = [];

  // ===== 1. Initial boot =====
  const bootFiles = computeBootFiles(manifest);
  let bootBytes = 0;
  for (const file of bootFiles) {
    if (file.endsWith(".js")) bootBytes += sizeOf(assetSizes, file).rawBytes;
  }
  if (bootBytes > config.initialBoot.budgetBytes) {
    errors.push(`initial boot: ${bootBytes} bytes > ${config.initialBoot.budgetBytes} bytes (baseline ${config.initialBoot.baselineBytes})`);
  }

  // ===== 2. Rotas lazy =====
  const routeEntries = collectRouteEntries(manifest);
  const routes = routeEntries.map(({ name, file }) => {
    const size = sizeOf(assetSizes, file);
    const rawKb = kb(size.rawBytes);
    const gzipKb = kb(size.gzipBytes);
    const explicit = config.routes[name];
    const budgetKb = explicit ?? config.defaultRouteBudgetKb;
    const budgetSource = explicit ? "explicit" : "default";
    const ok = rawKb <= budgetKb;
    if (!ok) errors.push(`route ${name}: ${file} ${rawKb} kB > ${budgetKb} kB (${budgetSource} budget)`);
    return { name, file, rawKb, gzipKb, budgetKb, budgetSource, ok };
  }).sort((a, b) => b.rawKb - a.rawKb);

  // ===== 3. Vendor chunks =====
  const vendorEntries = collectVendorEntries(manifest);
  const vendors = vendorEntries.map(({ name, file }) => {
    const size = sizeOf(assetSizes, file);
    const rawKb = kb(size.rawBytes);
    const gzipKb = kb(size.gzipBytes);
    const explicit = config.vendor[name];
    const budgetKb = explicit ?? config.defaultVendorBudgetKb;
    const budgetSource = explicit ? "explicit" : "default";
    const ok = rawKb <= budgetKb;
    if (!ok) errors.push(`vendor ${name}: ${file} ${rawKb} kB > ${budgetKb} kB (${budgetSource} budget)`);
    return { name, file, rawKb, gzipKb, budgetKb, budgetSource, ok };
  }).sort((a, b) => b.rawKb - a.rawKb);

  // ===== 4. Shared chunks — budget só nos explicitamente críticos; o resto só aparece no relatório quando
  // relevante (visibilidade de crescimento, sem virar uma regra frágil por arquivo pequeno). =====
  const sharedChunkEntries = collectSharedChunkEntries(manifest);
  const sharedChunks = sharedChunkEntries
    .map(({ name, file }) => {
      const size = sizeOf(assetSizes, file);
      const rawKb = kb(size.rawBytes);
      const gzipKb = kb(size.gzipBytes);
      const explicit = config.sharedChunks[name];
      const ok = typeof explicit === "number" ? rawKb <= explicit : true;
      if (typeof explicit === "number" && !ok) errors.push(`shared chunk ${name}: ${file} ${rawKb} kB > ${explicit} kB`);
      return { name, file, rawKb, gzipKb, budgetKb: explicit ?? null, ok };
    })
    .filter((entry) => entry.budgetKb !== null || entry.rawKb >= config.sharedChunkVisibilityThresholdKb)
    .sort((a, b) => b.rawKb - a.rawKb);

  // ===== 5. Total JS/gzip — safety ceiling, não o gate principal por feature =====
  const jsFiles = Object.entries(assetSizes).filter(([file]) => file.endsWith(".js"));
  const totalJsKb = kb(jsFiles.reduce((sum, [, size]) => sum + size.rawBytes, 0));
  const totalGzipKb = kb(jsFiles.reduce((sum, [, size]) => sum + size.gzipBytes, 0));
  if (totalJsKb > config.totalSafetyCeiling.jsKb) errors.push(`total JS: ${totalJsKb} kB > ${config.totalSafetyCeiling.jsKb} kB safety ceiling`);
  if (totalGzipKb > config.totalSafetyCeiling.gzipKb) errors.push(`total JS gzip: ${totalGzipKb} kB > ${config.totalSafetyCeiling.gzipKb} kB safety ceiling`);

  // ===== 6. Safety net por asset individual + chunks proibidos no frontend (preservados do checker antigo) ====
  for (const [file, size] of Object.entries(assetSizes)) {
    if ((file.endsWith(".js") || file.endsWith(".css")) && kb(size.rawBytes) > config.maxSingleAssetKb) {
      errors.push(`${file}: ${kb(size.rawBytes)} kB > ${config.maxSingleAssetKb} kB por asset individual`);
    }
  }
  for (const vendor of vendors) {
    for (const forbidden of config.forbiddenFrontendChunks) {
      if (forbidden.match(vendor.name)) errors.push(`${forbidden.label}: ${vendor.file} não deve voltar ao bundle do frontend`);
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    bootBytes,
    bootBudgetBytes: config.initialBoot.budgetBytes,
    totalJsKb,
    totalGzipKb,
    totalJsCeilingKb: config.totalSafetyCeiling.jsKb,
    totalGzipCeilingKb: config.totalSafetyCeiling.gzipKb,
    routes,
    vendors,
    sharedChunks,
  };
}
