import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { evaluateBudgets } from "../scripts/performance/bundle-budget-core.mjs";

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
    routes: { "big-route": 50 },
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

  console.log("Bundle budget checker synthetic tests passed: initial boot regression fails independently (P1), a route exceeding its own explicit budget fails and never touches boot (P2), safe growth within every budget passes with boot unchanged (P3), a vendor regression fails in isolation from boot (P4), and a brand-new unregistered lazy route falls through to the default ceiling and still fails even with boot=0 and total JS comfortably inside the safety ceiling (P5).");

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
    assert.equal(result.ok, true, `P6: build real deve passar no checker real — ${result.errors.join("; ")}`);
    console.log(`P6: build real atual passou (JS ${result.totalJsKb}/${result.totalJsCeilingKb} kB, boot ${result.bootBytes}/${result.bootBudgetBytes} bytes).`);
  }
}

run();
