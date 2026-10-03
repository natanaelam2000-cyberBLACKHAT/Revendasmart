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

export function extractLogicalName(key, entry) {
  if (typeof entry?.name === "string" && entry.name.length > 0) {
    return entry.name;
  }
  if (typeof entry?.src === "string" && entry.src.length > 0) {
    return entry.src.replace(/\\/g, "/").split("/").pop().replace(/\.[^.]+$/, "");
  }
  const target = typeof key === "string" && key.length > 0 ? key : (entry?.file || "");
  const clean = target.replace(/^(?:client\/)?(?:assets\/|_|src\/pages\/)/, "").replace(/\.[^.]+$/, "");
  return clean.replace(/-[A-Za-z0-9_-]{8}$/, "");
}

/** Entradas de página lazy: manifest entries cujo `src` está em client/src/pages OU cujo chunk
 * name/chave corresponda exatamente a rotas registradas (ex.: `_dashboard-*` ou `_marketing-*`, emitidos
 * pelo Rollup quando há dynamic code-split/imports). O nome lógico vem de `entry.name` ou da extração canônica.
 * Helpers como `_dashboard-services-count-*` ou `marketing-share-*` possuem nomes lógicos distintos e
 * NUNCA casam rotas por prefixo genérico. Chunks vendor são explicitamente excluídos de routes. */
export function collectRouteEntries(manifest, config) {
  const routes = [];
  const seenFiles = new Set();
  const knownRoutes = config?.routes ? new Set(Object.keys(config.routes)) : new Set();

  for (const [key, entry] of Object.entries(manifest)) {
    if (!entry || !entry.file || !entry.file.endsWith(".js") || seenFiles.has(entry.file)) {
      continue;
    }

    const logicalName = extractLogicalName(key, entry);
    if (typeof logicalName === "string" && logicalName.startsWith("vendor-")) {
      continue;
    }

    const hasPagesSrc = typeof entry.src === "string" && (entry.src.startsWith("src/pages/") || entry.src.startsWith("client/src/pages/"));
    const isKnownRoute = Boolean(logicalName && knownRoutes.has(logicalName));

    if (hasPagesSrc || isKnownRoute) {
      seenFiles.add(entry.file);
      routes.push({ key, name: logicalName, file: entry.file });
    }
  }
  return routes;
}

/** Chunks vendor: manifest entries cujo nome lógico começa com "vendor-". */
export function collectVendorEntries(manifest) {
  const vendors = [];
  const seenFiles = new Set();
  for (const [key, entry] of Object.entries(manifest)) {
    if (!entry || !entry.file || !entry.file.endsWith(".js") || seenFiles.has(entry.file)) continue;
    const name = extractLogicalName(key, entry);
    if (typeof name === "string" && name.startsWith("vendor-")) {
      seenFiles.add(entry.file);
      vendors.push({ name, file: entry.file });
    }
  }
  return vendors;
}

/** Chunks compartilhados "comuns" — exclui explicitamente arquivos já categorizados como boot,
 * rotas ou vendors.
 *
 * NOTA DE GOVERNANÇA (§7):
 * - `routes`, `vendors` e `sharedChunks` são conjuntos mutuamente exclusivos de chunks.
 * - `initialBoot` é uma medição agregada (BFS de imports estáticos de index.html). Arquivos no boot
 *   (ex.: `vendor-react-core`) também são auditados individualmente em `vendors`. Isso é deliberado
 *   e faz parte da política original: o boot afere o custo inicial agregado da navegação SPA,
 *   enquanto os budgets de vendor contêm o crescimento de cada biblioteca específica. */
export function collectSharedChunkEntries(manifest, { bootFiles = new Set(), routeFiles = new Set(), vendorFiles = new Set(), config } = {}) {
  const shared = [];
  const seenFiles = new Set();
  const knownRoutes = config?.routes ? new Set(Object.keys(config.routes)) : new Set();

  for (const [key, entry] of Object.entries(manifest)) {
    if (!entry || !entry.file || !entry.file.endsWith(".js") || seenFiles.has(entry.file)) {
      continue;
    }
    if (bootFiles.has(entry.file) || routeFiles.has(entry.file) || vendorFiles.has(entry.file)) {
      continue;
    }

    const name = extractLogicalName(key, entry);
    if (typeof name === "string" && name.startsWith("vendor-")) continue;
    if (typeof entry.src === "string" && (entry.src.startsWith("src/pages/") || entry.src.startsWith("client/src/pages/"))) continue;
    if (name && knownRoutes.has(name)) continue;

    seenFiles.add(entry.file);
    shared.push({ name: name || key, file: entry.file });
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
  const routeEntries = collectRouteEntries(manifest, config);
  const routeFiles = new Set(routeEntries.map((r) => r.file));
  const routes = routeEntries.map(({ name, file }) => {
    const size = sizeOf(assetSizes, file);
    const rawKb = kb(size.rawBytes);
    const gzipKb = kb(size.gzipBytes);
    const explicit = config.routes[name];
    const budgetKb = explicit ?? config.defaultRouteBudgetKb;
    const budgetSource = explicit ? "explicit" : "default";
    const ok = size.rawBytes <= budgetKb * 1024;
    if (!ok) errors.push(`route ${name}: ${file} ${rawKb} kB > ${budgetKb} kB (${budgetSource} budget)`);
    return { name, file, rawKb, gzipKb, budgetKb, budgetSource, ok };
  }).sort((a, b) => b.rawKb - a.rawKb);

  // ===== 3. Vendor chunks =====
  const vendorEntries = collectVendorEntries(manifest);
  const vendorFiles = new Set(vendorEntries.map((v) => v.file));
  const vendors = vendorEntries.map(({ name, file }) => {
    const size = sizeOf(assetSizes, file);
    const rawKb = kb(size.rawBytes);
    const gzipKb = kb(size.gzipBytes);
    const explicit = config.vendor[name];
    const budgetKb = explicit ?? config.defaultVendorBudgetKb;
    const budgetSource = explicit ? "explicit" : "default";
    const ok = size.rawBytes <= budgetKb * 1024;
    if (!ok) errors.push(`vendor ${name}: ${file} ${rawKb} kB > ${budgetKb} kB (${budgetSource} budget)`);
    return { name, file, rawKb, gzipKb, budgetKb, budgetSource, ok };
  }).sort((a, b) => b.rawKb - a.rawKb);

  // ===== 4. Shared chunks — budget só nos explicitamente críticos; o resto só aparece no relatório quando
  // relevante (visibilidade de crescimento, sem virar uma regra frágil por arquivo pequeno). =====
  const sharedChunkEntries = collectSharedChunkEntries(manifest, { bootFiles, routeFiles, vendorFiles, config });
  const sharedChunks = sharedChunkEntries
    .map(({ name, file }) => {
      const size = sizeOf(assetSizes, file);
      const rawKb = kb(size.rawBytes);
      const gzipKb = kb(size.gzipBytes);
      const explicit = config.sharedChunks[name];
      const ok = typeof explicit === "number" ? size.rawBytes <= explicit * 1024 : true;
      if (typeof explicit === "number" && !ok) errors.push(`shared chunk ${name}: ${file} ${rawKb} kB > ${explicit} kB`);
      return { name, file, rawKb, gzipKb, budgetKb: explicit ?? null, ok };
    })
    .filter((entry) => entry.budgetKb !== null || entry.rawKb >= config.sharedChunkVisibilityThresholdKb)
    .sort((a, b) => b.rawKb - a.rawKb);

  // ===== 5. Total JS/gzip — safety ceiling, não o gate principal por feature =====
  const jsFiles = Object.entries(assetSizes).filter(([file]) => file.endsWith(".js"));
  const totalJsKb = kb(jsFiles.reduce((sum, [, size]) => sum + size.rawBytes, 0));
  const totalGzipKb = kb(jsFiles.reduce((sum, [, size]) => sum + size.gzipBytes, 0));
  if (jsFiles.reduce((sum, [, size]) => sum + size.rawBytes, 0) > config.totalSafetyCeiling.jsKb * 1024) errors.push(`total JS: ${totalJsKb} kB > ${config.totalSafetyCeiling.jsKb} kB safety ceiling`);
  if (jsFiles.reduce((sum, [, size]) => sum + size.gzipBytes, 0) > config.totalSafetyCeiling.gzipKb * 1024) errors.push(`total JS gzip: ${totalGzipKb} kB > ${config.totalSafetyCeiling.gzipKb} kB safety ceiling`);

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
