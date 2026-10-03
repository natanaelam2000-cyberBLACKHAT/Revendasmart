import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import {
  evaluateBudgets,
  extractLogicalName,
  collectRouteEntries,
  collectVendorEntries,
  collectSharedChunkEntries,
  computeBootFiles,
} from "../scripts/performance/bundle-budget-core.mjs";

/**
 * PERF-BUDGET-ARCH-01 §13 — testa a lógica PURA do novo checker (scripts/performance/bundle-budget-core.mjs)
 * contra manifests/tamanhos sintéticos, sem precisar rodar um build real do Vite para P1-P5 (P6 é a exceção
 * deliberada: valida o build REAL já gerado em dist/public, a mesma árvore que `npm run
 * performance:bundle-check` usa). Mesmo padrão de script/*-tests.ts já usado no resto do repo (node:assert,
 * run()/console.log/catch), mas sem emulador — é lógica pura de Node, roda com `tsx` direto.
 */

const KB = 1024;

function baseConfig(overrides: Partial<Parameters<typeof evaluateBudgets>[0]["config"]> = {}) {
  return {
    initialBoot: { baselineBytes: 100 * KB, budgetBytes: 110 * KB },
    routes: { "big-route": 50, dashboard: 15, marketing: 236 },
    defaultRouteBudgetKb: 20,
    vendor: { "vendor-core": 100 },
    defaultVendorBudgetKb: 30,
    sharedChunks: { "critical-helper": 25 },
    sharedChunkVisibilityThresholdKb: 8,
    totalSafetyCeiling: { jsKb: 500, gzipKb: 150 },
    maxSingleAssetKb: 500,
    forbiddenFrontendChunks: [{ label: "date-fns frontend vendor", match: (name: string) => name === "vendor-date-fns" }],
    ...overrides,
  };
}

/** Manifest sintético mínimo: index.html -> (imports) entry.js + vendor-core (boot); (dynamicImports)
 * big-route.js (só carrega quando navegado, nunca no boot) que por sua vez importa staticamente um shared
 * chunk crítico. Espelha a forma real do manifest do Vite (chaves "_"-prefixed para chunks, name lógico). */
function baseManifest() {
  return {
    "index.html": {
      file: "assets/entry.js",
      name: "index",
      isEntry: true,
      imports: ["_vendor-core.js"],
      dynamicImports: ["src/pages/big-route.tsx"],
    },
    "_vendor-core.js": {
      file: "assets/vendor-core.js",
      name: "vendor-core",
    },
    "src/pages/big-route.tsx": {
      file: "assets/big-route.js",
      name: "big-route",
      src: "src/pages/big-route.tsx",
      isDynamicEntry: true,
      imports: ["_critical-helper.js"],
    },
    "_critical-helper.js": {
      file: "assets/critical-helper.js",
      name: "critical-helper",
    },
  };
}

function sizes(overrides: Record<string, number> = {}) {
  const defaults: Record<string, number> = {
    "assets/entry.js": 5 * KB,
    "assets/vendor-core.js": 40 * KB,
    "assets/big-route.js": 30 * KB,
    "assets/critical-helper.js": 10 * KB,
  };
  const merged = { ...defaults, ...overrides };
  const assetSizes: Record<string, { rawBytes: number; gzipBytes: number }> = {};
  for (const [file, rawBytes] of Object.entries(merged)) {
    assetSizes[file] = { rawBytes, gzipBytes: Math.round(rawBytes * 0.3) };
  }
  return assetSizes;
}

function run() {
  // ===== P1 — BOOT REGRESSION: initial boot > budget deve FAIL, mesmo com rotas/vendor/total dentro do teto =====
  {
    // entry(5kB) + vendor-core(120kB) > budget de 110kB — só o boot estoura.
    const result = evaluateBudgets({ manifest: baseManifest(), assetSizes: sizes({ "assets/vendor-core.js": 120 * KB }), config: baseConfig() });
    assert.equal(result.ok, false, "P1: boot acima do budget deve reprovar");
    assert.ok(result.errors.some((error) => error.includes("initial boot")), "P1: o erro deve identificar o initial boot como a causa");
  }

  // ===== P2 — ROUTE REGRESSION: uma rota lazy excede o PRÓPRIO budget explícito =====
  {
    const result = evaluateBudgets({ manifest: baseManifest(), assetSizes: sizes({ "assets/big-route.js": 60 * KB }), config: baseConfig() });
    assert.equal(result.ok, false, "P2: rota acima do budget explícito deve reprovar");
    assert.ok(result.errors.some((error) => error.includes("route big-route")), "P2: o erro deve identificar a rota específica");
    // O boot não é afetado (big-route só é alcançável via dynamicImports) — confirma que o motivo do FAIL é
    // mesmo a rota, não um efeito colateral no boot.
    assert.equal(result.bootBytes, sizes()["assets/entry.js"].rawBytes + sizes()["assets/vendor-core.js"].rawBytes, "P2: boot não muda quando só a rota cresce");
  }

  // ===== P3 — TOTAL GROWS SAFELY: total JS cresce dentro do safety ceiling, boot não muda, todas as rotas
  // dentro dos budgets -> PASS =====
  {
    const config = baseConfig({ totalSafetyCeiling: { jsKb: 500, gzipKb: 150 } });
    const result = evaluateBudgets({ manifest: baseManifest(), assetSizes: sizes({ "assets/critical-helper.js": 15 * KB }), config });
    assert.equal(result.ok, true, "P3: crescimento dentro de todos os budgets deve passar");
    assert.equal(result.bootBytes, 45 * KB, "P3: initial boot permanece exatamente o mesmo");
  }

  // ===== P4 — VENDOR REGRESSION: um vendor crítico excede o budget =====
  {
    const manifest = baseManifest();
    // vendor-core cresce, mas ainda dentro do boot budget (110kB) — isola a causa da falha no vendor budget
    // (100kB), não no boot.
    const result = evaluateBudgets({ manifest, assetSizes: sizes({ "assets/vendor-core.js": 105 * KB }), config: baseConfig() });
    assert.equal(result.ok, false, "P4: vendor acima do budget deve reprovar");
    assert.ok(result.errors.some((error) => error.includes("vendor vendor-core")), "P4: o erro deve identificar o vendor específico");
    assert.ok(!result.errors.some((error) => error.includes("initial boot")), "P4: 105kB ainda cabe no boot budget de 110kB — a falha é só do vendor");
  }

  // ===== P5 — NEW LARGE ROUTE: uma rota nova SEM budget explícito, excessivamente grande, cai no teto
  // default e ainda assim reprova (nunca passa só porque o total global cabe) =====
  {
    const manifest = baseManifest();
    (manifest as any)["index.html"].dynamicImports.push("src/pages/huge-new-route.tsx");
    (manifest as any)["src/pages/huge-new-route.tsx"] = {
      file: "assets/huge-new-route.js",
      name: "huge-new-route",
      src: "src/pages/huge-new-route.tsx",
      isDynamicEntry: true,
    };
    const assetSizes = sizes({ "assets/huge-new-route.js": 80 * KB });
    // Total ainda cabe folgado no safety ceiling (500kB) — prova que o FAIL vem do teto default de rota, não do total.
    const config = baseConfig({ totalSafetyCeiling: { jsKb: 500, gzipKb: 150 } });
    const result = evaluateBudgets({ manifest, assetSizes, config });
    assert.equal(result.ok, false, "P5: rota nova gigante deve reprovar mesmo com boot=0 e total dentro do ceiling");
    assert.ok(result.errors.some((error) => error.includes("route huge-new-route") && error.includes("default budget")), "P5: a rejeição deve vir do teto DEFAULT (rota sem budget explícito)");
    assert.equal(result.bootBytes, 45 * KB, "P5: a rota lazy nova não afeta o boot (isEntry ausente = nunca é boot)");
  }

  // ===== P7 — DASHBOARD HASHED CHUNK RESOLUTION & BUDGET ENFORCEMENT =====
  // Valida que chunks dinâmicos como `_dashboard-[hash].js` (sem `entry.src`) são corretamente
  // mapeados para a rota `dashboard` e seus budgets são rigorosamente aplicados:
  // - dashboard 15.1 kB => FAIL
  // - dashboard 14.9 kB => PASS
  {
    const manifest = {
      ...baseManifest(),
      "_dashboard-ebInHqkk.js": {
        file: "assets/dashboard-ebInHqkk.js",
        name: "dashboard",
        isDynamicEntry: true,
      },
    };

    // 15.1 kB = Math.round(15.1 * 1024) = 15462 bytes -> deve FAIL
    const failSizes = sizes({ "assets/dashboard-ebInHqkk.js": Math.round(15.1 * KB) });
    const failResult = evaluateBudgets({ manifest, assetSizes: failSizes, config: baseConfig() });
    assert.equal(failResult.ok, false, "P7: dashboard a 15.1 kB deve falhar (> 15 kB)");
    assert.ok(
      failResult.errors.some((err) => err.includes("route dashboard") && err.includes("15.1 kB > 15 kB")),
      "P7: erro deve apontar especificamente a rota dashboard excedendo 15 kB"
    );
    assert.ok(
      failResult.routes.some((r) => r.name === "dashboard" && r.file === "assets/dashboard-ebInHqkk.js"),
      "P7: _dashboard-*.js deve estar presente em routes"
    );
    assert.ok(
      !failResult.sharedChunks.some((s) => s.file === "assets/dashboard-ebInHqkk.js"),
      "P7: _dashboard-*.js NÃO deve ser classificado como shared chunk"
    );

    // 14.9 kB = Math.round(14.9 * 1024) = 15258 bytes -> deve PASS
    const passSizes = sizes({ "assets/dashboard-ebInHqkk.js": Math.round(14.9 * KB) });
    const passResult = evaluateBudgets({ manifest, assetSizes: passSizes, config: baseConfig() });
    assert.equal(passResult.ok, true, "P7: dashboard a 14.9 kB deve passar (<= 15 kB)");
    const dashboardEntry = passResult.routes.find((r) => r.name === "dashboard");
    assert.ok(dashboardEntry, "P7: rota dashboard deve estar na lista de rotas");
    assert.equal(dashboardEntry.ok, true, "P7: dashboard 14.9 kB deve ter ok=true");
    assert.equal(dashboardEntry.budgetKb, 15, "P7: budget de dashboard deve ser 15 kB");

    // Fronteira exata em bytes (sem arredondamento para kB): 15360 PASS, 15361 FAIL.
    const atLimit = evaluateBudgets({ manifest, assetSizes: sizes({ "assets/dashboard-ebInHqkk.js": 15 * KB }), config: baseConfig() });
    assert.equal(atLimit.ok, true, "P7: dashboard com 15360 bytes deve passar");
    const overByOne = evaluateBudgets({ manifest, assetSizes: sizes({ "assets/dashboard-ebInHqkk.js": 15 * KB + 1 }), config: baseConfig() });
    assert.equal(overByOne.ok, false, "P7: dashboard com 15361 bytes deve falhar (sem falso verde por arredondamento)");
  }

  // ===== P8 — MARKETING HASHED CHUNK RESOLUTION & BUDGET ENFORCEMENT =====
  // Valida que chunks dinâmicos como `_marketing-[hash].js` (sem `entry.src`) são corretamente
  // mapeados para a rota `marketing` e seus budgets são rigorosamente aplicados:
  // - marketing 236.1 kB => FAIL
  // - marketing 235.9 kB => PASS
  {
    const manifest = {
      ...baseManifest(),
      "_marketing-BFEy7KMu.js": {
        file: "assets/marketing-BFEy7KMu.js",
        name: "marketing",
        isDynamicEntry: true,
      },
    };

    // 236.1 kB = Math.round(236.1 * 1024) = 241766 bytes -> deve FAIL
    const failSizes = sizes({ "assets/marketing-BFEy7KMu.js": Math.round(236.1 * KB) });
    const failResult = evaluateBudgets({ manifest, assetSizes: failSizes, config: baseConfig({ totalSafetyCeiling: { jsKb: 1000, gzipKb: 300 } }) });
    assert.equal(failResult.ok, false, "P8: marketing a 236.1 kB deve falhar (> 236 kB)");
    assert.ok(
      failResult.errors.some((err) => err.includes("route marketing") && err.includes("236.1 kB > 236 kB")),
      "P8: erro deve apontar especificamente a rota marketing excedendo 236 kB"
    );
    assert.ok(
      failResult.routes.some((r) => r.name === "marketing" && r.file === "assets/marketing-BFEy7KMu.js"),
      "P8: _marketing-*.js deve estar presente em routes"
    );
    assert.ok(
      !failResult.sharedChunks.some((s) => s.file === "assets/marketing-BFEy7KMu.js"),
      "P8: _marketing-*.js NÃO deve ser classificado como shared chunk"
    );

    // 235.9 kB = Math.round(235.9 * 1024) = 241562 bytes -> deve PASS
    const passSizes = sizes({ "assets/marketing-BFEy7KMu.js": Math.round(235.9 * KB) });
    const passResult = evaluateBudgets({ manifest, assetSizes: passSizes, config: baseConfig({ totalSafetyCeiling: { jsKb: 1000, gzipKb: 300 } }) });
    assert.equal(passResult.ok, true, "P8: marketing a 235.9 kB deve passar (<= 236 kB)");
    const marketingEntry = passResult.routes.find((r) => r.name === "marketing");
    assert.ok(marketingEntry, "P8: rota marketing deve estar na lista de rotas");
    assert.equal(marketingEntry.ok, true, "P8: marketing 235.9 kB deve ter ok=true");
    assert.equal(marketingEntry.budgetKb, 236, "P8: budget de marketing deve ser 236 kB");
  }

  // ===== P9 — CHECKER ROBUSTNESS, STRUCTURAL RESOLUTION & MUTUAL EXCLUSIVITY (GOVERNANCE §§6, 7) =====
  {
    // --- 1. extractLogicalName canônico e robustez de hash ---
    // Hashes reais observados em produção (8 caracteres base64url com ou sem hífens/underscores)
    assert.equal(extractLogicalName("_dashboard-M-B5EaYr.js", {}), "dashboard", "P9: extractLogicalName deve resolver dashboard com hash contendo hífen");
    assert.equal(extractLogicalName("assets/dashboard-M-B5EaYr.js", {}), "dashboard", "P9: extractLogicalName com prefixo assets/");
    assert.equal(extractLogicalName("_marketing-DjTyHB8X.js", {}), "marketing", "P9: extractLogicalName deve resolver marketing");
    assert.equal(extractLogicalName("assets/catalog--UYgGww_.js", {}), "catalog", "P9: extractLogicalName com duplo hífen inicial no hash");
    assert.equal(extractLogicalName("assets/offline-sales-queue-qKbDFk-E.js", {}), "offline-sales-queue", "P9: extractLogicalName rota com múltiplos hífens no nome");
    assert.equal(extractLogicalName("assets/service-work-detail-y1lvNaxx.js", {}), "service-work-detail", "P9: rota composta service-work-detail");

    // Helpers com prefixo parecido NÃO podem ter o nome comido pelo regex de hash
    assert.equal(extractLogicalName("_dashboard-services-count-uClvfFF1.js", {}), "dashboard-services-count", "P9: helper _dashboard-services-count não deve virar dashboard");
    assert.equal(extractLogicalName("marketing-share-BsXZWX2H.js", {}), "marketing-share", "P9: helper marketing-share sem _ inicial não deve virar marketing");
    assert.equal(extractLogicalName("_marketing-share-BsXZWX2H.js", {}), "marketing-share", "P9: helper _marketing-share com _ não deve virar marketing");

    // Vendors sem name preservam prefixo vendor-
    assert.equal(extractLogicalName("_vendor-firebase-auth-BkFrT5qb.js", {}), "vendor-firebase-auth", "P9: vendor chunk sem name preserva vendor-*");

    // Prioridade de name e src
    assert.equal(extractLogicalName("qualquer-chave", { name: "meu-nome-explicito" }), "meu-nome-explicito", "P9: entry.name tem precedência máxima");
    assert.equal(extractLogicalName("chave-qualquer", { src: "src/pages/dashboard.tsx" }), "dashboard", "P9: entry.src de páginas resolve rota");
    assert.equal(extractLogicalName("chave-qualquer", { src: "client/src/pages/dashboard.tsx" }), "dashboard", "P9: entry.src com client/ resolve rota");
    assert.equal(extractLogicalName("chave-qualquer", { src: "src/lib/dashboard-services-count.ts" }), "dashboard-services-count", "P9: entry.src de lib não vira rota");

    // --- 2. Manifest sintético abrangente sem `name` cobrindo §§6 e 7 ---
    const robustConfig = baseConfig({
      routes: { dashboard: 15, marketing: 236, catalog: 16 },
      vendor: { "vendor-core": 100, "vendor-firebase-auth": 82 },
      sharedChunks: { "critical-helper": 25, "marketing-share": 15 },
      totalSafetyCeiling: { jsKb: 2000, gzipKb: 600 },
    });

    const manifestNoNames: Record<string, any> = {
      // Boot entry
      "index.html": {
        file: "assets/entry.js",
        isEntry: true,
        imports: ["_vendor-core.js"],
        dynamicImports: [
          "_dashboard-M-B5EaYr.js",
          "_marketing-DjTyHB8X.js",
          "_dashboard-services-count-uClvfFF1.js",
          "_marketing-share-BsXZWX2H.js",
          "_vendor-firebase-auth-BkFrT5qb.js",
        ],
      },
      // Vendor no boot (tem budget vendor e é medido no boot)
      "_vendor-core.js": {
        file: "assets/vendor-core.js",
        // sem name
      },
      // Rota dashboard sem name e sem src
      "_dashboard-M-B5EaYr.js": {
        file: "assets/dashboard-M-B5EaYr.js",
        isDynamicEntry: true,
        // sem name, sem src
      },
      // Rota marketing sem name e sem src
      "_marketing-DjTyHB8X.js": {
        file: "assets/marketing-DjTyHB8X.js",
        isDynamicEntry: true,
        // sem name, sem src
      },
      // Helper dashboard-services-count sem name e sem src
      "_dashboard-services-count-uClvfFF1.js": {
        file: "assets/dashboard-services-count-uClvfFF1.js",
        // sem name, sem src
      },
      // Helper marketing-share sem name e sem src
      "_marketing-share-BsXZWX2H.js": {
        file: "assets/marketing-share-BsXZWX2H.js",
        // sem name, sem src
      },
      // Helper marketing-share sem prefixo "_" no key e sem name
      "marketing-share-BsXZWX2H.js": {
        file: "assets/marketing-share-plain.js",
        // sem name, sem src
      },
      // Vendor lazy sem name e sem src
      "_vendor-firebase-auth-BkFrT5qb.js": {
        file: "assets/vendor-firebase-auth-BkFrT5qb.js",
        // sem name, sem src
      },
      // Rota com src presente mas sem name
      "src/pages/catalog.tsx": {
        file: "assets/catalog--UYgGww_.js",
        src: "src/pages/catalog.tsx",
        isDynamicEntry: true,
        // sem name
      },
    };

    // --- 3. Teste de isolamento estrutural e mútua exclusividade ---
    const routeList = collectRouteEntries(manifestNoNames, robustConfig);
    const vendorList = collectVendorEntries(manifestNoNames);
    const bootFiles = computeBootFiles(manifestNoNames);
    const sharedList = collectSharedChunkEntries(manifestNoNames, {
      bootFiles,
      routeFiles: new Set(routeList.map((r) => r.file)),
      vendorFiles: new Set(vendorList.map((v) => v.file)),
      config: robustConfig,
    });

    const routeFilesSet = new Set(routeList.map((r) => r.file));
    const vendorFilesSet = new Set(vendorList.map((v) => v.file));
    const sharedFilesSet = new Set(sharedList.map((s) => s.file));

    // A. Mútua exclusividade estrita (§7)
    for (const file of routeFilesSet) {
      assert.ok(!vendorFilesSet.has(file), `P9: arquivo de rota ${file} não pode estar em vendors`);
      assert.ok(!sharedFilesSet.has(file), `P9: arquivo de rota ${file} não pode estar em sharedChunks`);
    }
    for (const file of vendorFilesSet) {
      assert.ok(!routeFilesSet.has(file), `P9: arquivo vendor ${file} não pode estar em routes`);
      assert.ok(!sharedFilesSet.has(file), `P9: arquivo vendor ${file} não pode estar em sharedChunks`);
    }
    for (const file of sharedFilesSet) {
      assert.ok(!routeFilesSet.has(file), `P9: arquivo compartilhado ${file} não pode estar em routes`);
      assert.ok(!vendorFilesSet.has(file), `P9: arquivo compartilhado ${file} não pode estar em vendors`);
    }

    // B. Não permitir helper colidir com rota por prefixo genérico (§6)
    assert.ok(routeFilesSet.has("assets/dashboard-M-B5EaYr.js"), "P9: dashboard hashed sem name deve ser classificado como rota");
    assert.ok(routeFilesSet.has("assets/marketing-DjTyHB8X.js"), "P9: marketing hashed sem name deve ser classificado como rota");
    assert.ok(routeFilesSet.has("assets/catalog--UYgGww_.js"), "P9: catalog com src presente deve ser classificado como rota");

    assert.ok(!routeFilesSet.has("assets/dashboard-services-count-uClvfFF1.js"), "P9: _dashboard-services-count-* NUNCA deve ser rota dashboard");
    assert.ok(sharedFilesSet.has("assets/dashboard-services-count-uClvfFF1.js"), "P9: _dashboard-services-count-* deve ser classificado em sharedChunks");

    assert.ok(!routeFilesSet.has("assets/marketing-share-BsXZWX2H.js"), "P9: _marketing-share-* NUNCA deve ser rota marketing");
    assert.ok(sharedFilesSet.has("assets/marketing-share-BsXZWX2H.js"), "P9: _marketing-share-* deve ser classificado em sharedChunks");

    assert.ok(!routeFilesSet.has("assets/marketing-share-plain.js"), "P9: marketing-share-* NUNCA deve ser rota marketing");
    assert.ok(sharedFilesSet.has("assets/marketing-share-plain.js"), "P9: marketing-share-* deve ser classificado em sharedChunks");

    // C. Vendor sem name preservado
    assert.ok(vendorFilesSet.has("assets/vendor-firebase-auth-BkFrT5qb.js"), "P9: _vendor-firebase-auth-* sem name deve ser classificado em vendors");
    assert.ok(!routeFilesSet.has("assets/vendor-firebase-auth-BkFrT5qb.js"), "P9: vendor chunk sem name nunca cai em routes");
    assert.ok(!sharedFilesSet.has("assets/vendor-firebase-auth-BkFrT5qb.js"), "P9: vendor chunk sem name nunca cai em sharedChunks");

    // D. Initial boot agregado (§7)
    // vendor-core está no boot via import de index.html
    assert.ok(bootFiles.has("assets/vendor-core.js"), "P9: vendor-core.js está presente no bootFiles agregado");
    assert.ok(vendorFilesSet.has("assets/vendor-core.js"), "P9: vendor-core.js também é avaliado individualmente em vendors");
    assert.ok(!sharedFilesSet.has("assets/vendor-core.js"), "P9: arquivo presente no boot é excluído de sharedChunks");

    // --- 4. Budget exact pass/fail com chunks sem name ---
    // Dashboard 15.1 FAIL / 14.9 PASS sem name no manifest
    const dashFailSizes = sizes({
      "assets/entry.js": 5 * KB,
      "assets/vendor-core.js": 40 * KB,
      "assets/dashboard-M-B5EaYr.js": Math.round(15.1 * KB),
      "assets/marketing-DjTyHB8X.js": 100 * KB,
      "assets/dashboard-services-count-uClvfFF1.js": 4 * KB,
      "assets/marketing-share-BsXZWX2H.js": 5 * KB,
      "assets/marketing-share-plain.js": 5 * KB,
      "assets/vendor-firebase-auth-BkFrT5qb.js": 20 * KB,
      "assets/catalog--UYgGww_.js": 10 * KB,
    });
    const dashFailEval = evaluateBudgets({ manifest: manifestNoNames, assetSizes: dashFailSizes, config: robustConfig });
    assert.equal(dashFailEval.ok, false, "P9: dashboard sem name a 15.1 kB deve falhar (> 15 kB)");
    assert.ok(dashFailEval.errors.some((e) => e.includes("route dashboard") && e.includes("15.1 kB > 15 kB")), "P9: erro deve identificar route dashboard 15.1 kB > 15 kB");

    const dashPassSizes = { ...dashFailSizes, "assets/dashboard-M-B5EaYr.js": { rawBytes: Math.round(14.9 * KB), gzipBytes: Math.round(14.9 * KB * 0.3) } };
    const dashPassEval = evaluateBudgets({ manifest: manifestNoNames, assetSizes: dashPassSizes, config: robustConfig });
    assert.equal(dashPassEval.ok, true, `P9: dashboard sem name a 14.9 kB deve passar (<= 15 kB): ${dashPassEval.errors.join("; ")}`);
    const dashEntry = dashPassEval.routes.find((r) => r.name === "dashboard");
    assert.ok(dashEntry, "P9: rota dashboard deve constar na avaliação");
    assert.equal(dashEntry.ok, true, "P9: dashboard a 14.9 kB deve ter ok=true");

    // Marketing 236.1 FAIL / 235.9 PASS sem name no manifest
    const mktFailSizes = {
      ...dashPassSizes,
      "assets/marketing-DjTyHB8X.js": { rawBytes: Math.round(236.1 * KB), gzipBytes: Math.round(236.1 * KB * 0.3) },
    };
    const mktFailEval = evaluateBudgets({ manifest: manifestNoNames, assetSizes: mktFailSizes, config: robustConfig });
    assert.equal(mktFailEval.ok, false, "P9: marketing sem name a 236.1 kB deve falhar (> 236 kB)");
    assert.ok(mktFailEval.errors.some((e) => e.includes("route marketing") && e.includes("236.1 kB > 236 kB")), "P9: erro deve identificar route marketing 236.1 kB > 236 kB");

    const mktPassSizes = {
      ...dashPassSizes,
      "assets/marketing-DjTyHB8X.js": { rawBytes: Math.round(235.9 * KB), gzipBytes: Math.round(235.9 * KB * 0.3) },
    };
    const mktPassEval = evaluateBudgets({ manifest: manifestNoNames, assetSizes: mktPassSizes, config: robustConfig });
    assert.equal(mktPassEval.ok, true, `P9: marketing sem name a 235.9 kB deve passar (<= 236 kB): ${mktPassEval.errors.join("; ")}`);
    const mktEntry = mktPassEval.routes.find((r) => r.name === "marketing");
    assert.ok(mktEntry, "P9: rota marketing deve constar na avaliação");
    assert.equal(mktEntry.ok, true, "P9: marketing a 235.9 kB deve ter ok=true");
  }

  console.log("Bundle budget checker synthetic tests passed: initial boot regression fails independently (P1), a route exceeding its own explicit budget fails and never touches boot (P2), safe growth within every budget passes with boot unchanged (P3), a vendor regression fails in isolation from boot (P4), a brand-new unregistered lazy route falls through to the default ceiling (P5), dashboard hashed chunks enforce 15 kB (15.1 FAIL / 14.9 PASS) (P7), marketing hashed chunks enforce 236 kB (236.1 FAIL / 235.9 PASS) (P8), and robust name/hash/helper/vendor/mutual-exclusivity fixtures passed (P9).");

  // RUNTIME_REAL: execute the production classifier and evaluator with nameless page entries.
  {
    const routes = { "service-agenda": 20, "public-catalog": 35, "add-product": 36, "service-work-detail": 29 };
    for (const [name, budget] of Object.entries(routes)) {
      for (const delta of [-0.1, 0.1]) {
        const file = `assets/${name}-ABCDEFGH.js`;
        const manifest = { ...baseManifest(), [`src/pages/${name}.tsx`]: { file, src: `src/pages/${name}.tsx` } };
        assert.equal(extractLogicalName(`src/pages/${name}.tsx`, manifest[`src/pages/${name}.tsx`]), name);
        const result = evaluateBudgets({ manifest, assetSizes: sizes({ [file]: Math.round((budget + delta) * KB) }), config: baseConfig({ routes: { ...routes, "big-route": 50 } }) });
        assert.equal(result.ok, delta < 0, `${name}: ${budget + delta} kB`);
        assert.equal(result.routes.find(route => route.name === name)?.budgetKb, budget);
      }
    }
    for (const name of ["dashboard-services-count", "dashboard-helper", "marketing-share", "marketing-helper"]) {
      const file = `assets/${name}.js`;
      const entry = { file };
      assert.equal(extractLogicalName(file, entry), name);
      assert.equal(collectRouteEntries({ [file]: entry }, baseConfig()).length, 0);
    }
    for (const name of ["dashboard", "marketing"]) {
      const budget = name === "dashboard" ? 15 : 236;
      const file = `assets/${name}-ABCDEFGH.js`;
      const result = evaluateBudgets({ manifest: { [file]: { file } }, assetSizes: sizes({ [file]: budget * KB + 1 }), config: baseConfig() });
      assert.equal(result.routes.find(route => route.name === name)?.ok, false, `${name} must fail even one byte over budget`);
    }
    const manifest = baseManifest();
    const bootFiles = computeBootFiles(manifest);
    const routeFiles = new Set(collectRouteEntries(manifest, baseConfig()).map(entry => entry.file));
    const vendorFiles = new Set(collectVendorEntries(manifest).map(entry => entry.file));
    const sharedFiles = new Set(collectSharedChunkEntries(manifest, { bootFiles, routeFiles, vendorFiles, config: baseConfig() }).map(entry => entry.file));
    for (const file of routeFiles) assert.ok(!vendorFiles.has(file) && !sharedFiles.has(file));
    for (const file of vendorFiles) assert.ok(!sharedFiles.has(file));
    assert.ok(bootFiles.has("assets/vendor-core.js") && vendorFiles.has("assets/vendor-core.js"), "Boot deliberately aggregates vendor bytes while route/vendor/shared stay exclusive");
  }

  // ===== P6 — CURRENT BUILD: o build real já gerado em dist/public deve passar no checker real =====
  {
    const distDir = path.resolve(import.meta.dirname, "..", "dist", "public");
    const assetsDir = path.join(distDir, "assets");
    const manifestPath = path.join(distDir, ".vite", "manifest.json");
    if (!fs.existsSync(assetsDir) || !fs.existsSync(manifestPath)) {
      console.log("P6: dist/public ausente (rode `npm run build` antes) — pulado sem falhar o resto da suíte.");
      return;
    }
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    const files = fs.readdirSync(assetsDir).filter((name) => name.endsWith(".js") || name.endsWith(".css"));
    const assetSizes: Record<string, { rawBytes: number; gzipBytes: number }> = {};
    for (const name of files) {
      const raw = fs.readFileSync(path.join(assetsDir, name));
      assetSizes[`assets/${name}`] = { rawBytes: raw.length, gzipBytes: zlib.gzipSync(raw).length };
    }
    // Config real do checker (mantida em sincronia manualmente com check-bundle-budgets.mjs — se este teste
    // começar a falhar sozinho enquanto o comando real passa, é sinal de que os dois divergiram).
    const realConfig = {
      initialBoot: { baselineBytes: 484827, budgetBytes: 492000 },
      routes: {
        marketing: 236, settings: 60, "add-product": 36, "public-catalog": 35, reports: 29,
        onboarding: 29, "service-work-detail": 29, "service-agenda": 20, catalog: 16,
        "service-availability-settings": 15, dashboard: 15,
      },
      defaultRouteBudgetKb: 40,
      vendor: {
        "vendor-recharts": 352, "vendor-firebase-firestore": 286, "vendor-react-core": 204, "vendor-misc": 198,
        "vendor-scanner": 163, "vendor-firebase-core": 91, "vendor-firebase-auth": 82,
        "vendor-firebase-observability": 60, "vendor-radix": 40, "vendor-ui": 36, "vendor-lucide": 35, "vendor-qrcode": 20,
      },
      defaultVendorBudgetKb: 40,
      sharedChunks: { PrivateRouter: 44, CatalogShowcase: 29, "service-agenda-helpers": 28 },
      sharedChunkVisibilityThresholdKb: 8,
      totalSafetyCeiling: { jsKb: 2600, gzipKb: 800 },
      maxSingleAssetKb: 500,
      forbiddenFrontendChunks: [{ label: "date-fns frontend vendor", match: (name: string) => name === "vendor-date-fns" }],
    };
    const result = evaluateBudgets({ manifest, assetSizes, config: realConfig });
    for (const [name, budget] of [["dashboard", 15], ["marketing", 236]] as const) {
      const route = result.routes.find(entry => entry.name === name);
      assert.ok(route, `Real manifest must classify ${name}`);
      for (const delta of [-0.1, 0.1]) {
        const changed = { ...assetSizes, [route.file]: { rawBytes: Math.round((budget + delta) * KB), gzipBytes: 1 } };
        const evaluated = evaluateBudgets({ manifest, assetSizes: changed, config: realConfig });
        assert.equal(evaluated.routes.find(entry => entry.name === name)?.ok, delta < 0);
        if (delta > 0) assert.equal(evaluated.ok, false);
      }
    }
    assert.equal(result.ok, true, `P6: build real deve passar no checker real — ${result.errors.join("; ")}`);
    console.log(`P6: build real atual passou (JS ${result.totalJsKb}/${result.totalJsCeilingKb} kB, boot ${result.bootBytes}/${result.bootBudgetBytes} bytes).`);
  }
}

run();
