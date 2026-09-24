/**
 * ADS-PRO-03E2 — Harness de Testes de Mutação do Manifesto de Produção e Background Bridge
 *
 * Mutações Avaliadas:
 * M01: Manifest omite um asset (não deriva 100% da library).
 * M02: entityKinds alterado para ["service"].
 * M03: targetCategories forçado para array vazio [].
 * M04: styles forçado para ["modern"] constante.
 * M05: supportedIntents forçado para intent específica ["launch"].
 * M06: formats hardcoded para ["portrait"] ignorando bg.formats.
 * M07: subjectZone alterado para zona pura portrait em vez da interseção segura.
 * M08: resource.uri gerado com ID estático divergente.
 * M09: bridge retorna fallback para ID desconhecido em vez de lançar erro.
 * M10: fallback procedural inserido diretamente no manifesto de produção.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

interface MutationDef {
  readonly id: string;
  readonly description: string;
  readonly file: string;
  readonly target: string;
  readonly replacement: string;
}

const MUTATIONS: readonly MutationDef[] = [
  {
    id: "MUT-01",
    description: "Manifest omite um asset (slice de 11 em vez de 12)",
    file: "shared/ads-pro/production-manifest.ts",
    target: `const rawAssets = MARKETING_PRO_BACKGROUND_LIBRARY.map((bg) => ({`,
    replacement: `const rawAssets = MARKETING_PRO_BACKGROUND_LIBRARY.slice(0, 11).map((bg) => ({ // MUT-01`,
  },
  {
    id: "MUT-02",
    description: "entityKinds alterado para ['service']",
    file: "shared/ads-pro/production-manifest.ts",
    target: `entityKinds: ["product"] as const,`,
    replacement: `entityKinds: ["service"] as const, // MUT-02`,
  },
  {
    id: "MUT-03",
    description: "targetCategories forçado para array vazio []",
    file: "shared/ads-pro/production-manifest.ts",
    target: `targetCategories: bg.categories,`,
    replacement: `targetCategories: [] as const, // MUT-03`,
  },
  {
    id: "MUT-04",
    description: "styles forçado para ['modern'] ignorando família visual",
    file: "shared/ads-pro/production-manifest.ts",
    target: `styles: [resolveMarketingProStyleForCreativeFamily(bg.family)],`,
    replacement: `styles: ["modern" as const], // MUT-04`,
  },
  {
    id: "MUT-05",
    description: "supportedIntents recebe intent específica ['launch']",
    file: "shared/ads-pro/production-manifest.ts",
    target: `supportedIntents: [] as const,`,
    replacement: `supportedIntents: ["launch" as const], // MUT-05`,
  },
  {
    id: "MUT-06",
    description: "formats hardcoded para ['portrait'] ignorando bg.formats",
    file: "shared/ads-pro/production-manifest.ts",
    target: `formats: bg.formats,`,
    replacement: `formats: ["portrait" as const], // MUT-06`,
  },
  {
    id: "MUT-07",
    description: "subjectZone alterado para portrait puro em vez da safe intersection",
    file: "shared/ads-pro/production-manifest.ts",
    target: `subjectZone: ADS_PRO_SAFE_SUBJECT_ZONE,`,
    replacement: `subjectZone: { x: 0.08, y: 0.16, width: 0.84, height: 0.46 }, // MUT-07`,
  },
  {
    id: "MUT-08",
    description: "resource.uri aponta para id estático divergente",
    file: "shared/ads-pro/production-manifest.ts",
    target: `uri: \`generated:\${bg.id}\`,`,
    replacement: `uri: "generated:static-divergent-id", // MUT-08`,
  },
  {
    id: "MUT-09",
    description: "Bridge retorna fallback silencioso para ID desconhecido em vez de erro",
    file: "shared/ads-pro/background-bridge.ts",
    target: `  if (!bg) {
    throw new BackgroundNotFoundError(asset.id);
  }`,
    replacement: `  if (!bg) {
    return MARKETING_PRO_BACKGROUND_LIBRARY[0]; // MUT-09: fallback silencioso
  }`,
  },
  {
    id: "MUT-10",
    description: "Fallback procedural inserido no manifesto de produção",
    file: "shared/ads-pro/production-manifest.ts",
    target: `  const rawAssets = MARKETING_PRO_BACKGROUND_LIBRARY.map((bg) => ({`,
    replacement: `  const rawAssets = [...MARKETING_PRO_BACKGROUND_LIBRARY, { id: "pro-generic-fallback", version: 1, family: "minimal", categories: [], formats: ["portrait", "square"], tags: [], sourceType: "GENERATED_DETERMINISTIC", generated: { angleDeg: 0, stops: [] } } as any].map((bg) => ({ // MUT-10`,
  },
];

const ROOT_DIR = process.cwd();
const TEST_SCRIPT = path.join(ROOT_DIR, "script", "ads-pro-03e2-manifest-tests.ts");

function runTest(): { status: number | null; output: string } {
  const result = spawnSync("npx", ["tsx", TEST_SCRIPT], {
    cwd: ROOT_DIR,
    encoding: "utf-8",
    shell: true,
  });
  return {
    status: result.status,
    output: (result.stdout || "") + (result.stderr || ""),
  };
}

console.log("\n=== ADS-PRO-03E2: MUTATION TEST HARNESS ===\n");

// 1. Baseline Run
console.log("Verificando baseline sem mutações...");
const baseline = runTest();
assert.equal(baseline.status, 0, `Baseline falhou com status ${baseline.status}:\n${baseline.output}`);
console.log("  ✓ Baseline PASS (código original 100% verde)\n");

let killedMutations = 0;

for (const mut of MUTATIONS) {
  const filePath = path.join(ROOT_DIR, mut.file);
  const originalContent = fs.readFileSync(filePath, "utf-8");

  assert.ok(
    originalContent.includes(mut.target),
    `Alvo da mutação ${mut.id} não encontrado em ${mut.file}`
  );

  const mutatedContent = originalContent.replace(mut.target, mut.replacement);
  fs.writeFileSync(filePath, mutatedContent, "utf-8");

  try {
    const mutResult = runTest();
    if (mutResult.status !== 0) {
      killedMutations++;
      console.log(`  ✓ [KILLED] ${mut.id}: ${mut.description}`);
    } else {
      console.error(`  ✗ [SURVIVED] ${mut.id}: ${mut.description}`);
      console.error(`Output do teste:\n${mutResult.output}`);
    }
  } finally {
    fs.writeFileSync(filePath, originalContent, "utf-8");
  }
}

console.log(`\nResultado da Mutação: ${killedMutations}/${MUTATIONS.length} mutações mortas.`);
assert.equal(
  killedMutations,
  MUTATIONS.length,
  `Nem todas as mutações foram mortas (${killedMutations}/${MUTATIONS.length})`
);
console.log("Harness de mutação 03E2 concluído com 100% de eficácia!\n");
