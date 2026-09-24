/**
 * ADS-PRO-02B — Harness Versionado e Reproduzível de Testes de Mutação do Matcher
 *
 * Princípios de Execução e Auditoria:
 * 1. Verificação Baseline: Executa a suíte sem mutação e exige exit code 0 antes de qualquer mutação.
 * 2. Isolamento Estrito: Cria um diretório temporário exclusivo para cada execução (.tmp/mutation-run-XXXXXX).
 * 3. Limpeza Garantida: Bloco try/finally garante remoção apenas do diretório exclusivo criado, inclusive sob falha de preparação.
 * 4. Rigor na Classificação: Diferencia falhas de asserção esperadas (ASSERTION_FAILURE) de erro de processo, compilação ou timeout.
 * 5. Mutações Canônicas: Avalia 12 mutações semânticas críticas (MUT-01 a MUT-12) e exige 12/12 mortas por asserção.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

interface MutationDef {
  readonly id: string;
  readonly description: string;
  readonly target: string;
  readonly replacement: string;
}

const MUTATIONS: readonly MutationDef[] = [
  {
    id: "MUT-01",
    description: "Remover filtro de status active em isAssetEligible",
    target: `  if (asset.status !== "active") {
    return false;
  }`,
    replacement: `  // MUT-01: status active filter removed`,
  },
  {
    id: "MUT-02",
    description: "Remover filtro de entityKind em isAssetEligible",
    target: `  if (!asset.entityKinds.includes(context.entityKind)) {
    return false;
  }`,
    replacement: `  // MUT-02: entityKind filter removed`,
  },
  {
    id: "MUT-03",
    description: "Remover filtro de format em isAssetEligible",
    target: `  if (!asset.formats.includes(context.format)) {
    return false;
  }`,
    replacement: `  // MUT-03: format filter removed`,
  },
  {
    id: "MUT-04",
    description: "Remover filtro de intenção comercial incompatível em isAssetEligible",
    target: `  if (context.intent !== undefined && asset.supportedIntents.length > 0) {
    if (!asset.supportedIntents.includes(context.intent)) {
      return false;
    }
  }`,
    replacement: `  // MUT-04: intent filter removed`,
  },
  {
    id: "MUT-05",
    description: "Inverter prioridade categórica (universal > exact)",
    target: `const CATEGORY_PRIORITY: Record<CategoryAffinity, number> = {
  exact: 0,
  universal: 1,
  neutral: 2,
  mismatch: 3,
};`,
    replacement: `const CATEGORY_PRIORITY: Record<CategoryAffinity, number> = {
  exact: 1,
  universal: 0,
  neutral: 2,
  mismatch: 3,
};`,
  },
  {
    id: "MUT-06",
    description: "Remover comparação de styleAffinity em compareMatchResults",
    target: `  const styleDiff = compareStyleAffinity(a.breakdown.styleAffinity, b.breakdown.styleAffinity);
  if (styleDiff !== 0) return styleDiff;`,
    replacement: `  // MUT-06: style comparison removed`,
  },
  {
    id: "MUT-07",
    description: "Remover desempate final por AssetId ASCII",
    target: `  return compareAssetIdAscii(a.asset.id, b.asset.id);`,
    replacement: `  return 0; // MUT-07`,
  },
  {
    id: "MUT-08",
    description: "Omitir ordenação determinística e preservar ordem de input",
    target: `  // 3. Ordenação determinística lexicográfica
  results.sort(compareMatchResults);`,
    replacement: `  // MUT-08: results.sort(compareMatchResults);`,
  },
  {
    id: "MUT-09",
    description: "Mutação in-place em manifest.assets (violando imutabilidade)",
    target: `  // 1. Filtragem com Hard Filters (sem mutação do manifesto de entrada)
  const eligibleAssets: AssetDNA[] = [];`,
    replacement: `  // MUT-09: Mutação in-place proibida
  (manifest.assets as unknown as unknown[]).reverse();
  const eligibleAssets: AssetDNA[] = [];`,
  },
  {
    id: "MUT-10",
    description: "Inverter hierarquia lexicográfica (Style antes de Intent)",
    target: `  const intentDiff = compareIntentAffinity(a.breakdown.intentAffinity, b.breakdown.intentAffinity);
  if (intentDiff !== 0) return intentDiff;

  const styleDiff = compareStyleAffinity(a.breakdown.styleAffinity, b.breakdown.styleAffinity);
  if (styleDiff !== 0) return styleDiff;`,
    replacement: `  // MUT-10: Inverter prioridade semântica
  const styleDiff = compareStyleAffinity(a.breakdown.styleAffinity, b.breakdown.styleAffinity);
  if (styleDiff !== 0) return styleDiff;

  const intentDiff = compareIntentAffinity(a.breakdown.intentAffinity, b.breakdown.intentAffinity);
  if (intentDiff !== 0) return intentDiff;`,
  },
  {
    id: "MUT-11",
    description: "Fazer category undefined voltar a ser mismatch em vez de neutral",
    target: `  // context.category === undefined
  if (asset.targetCategories.length === 0) {
    return "universal";
  }
  return "neutral";`,
    replacement: `  // context.category === undefined
  if (asset.targetCategories.length === 0) {
    return "universal";
  }
  return "mismatch"; // MUT-11`,
  },
  {
    id: "MUT-12",
    description: "Fazer matchedStyles.length voltar a influenciar ranking antes do AssetId",
    target: `  const styleDiff = compareStyleAffinity(a.breakdown.styleAffinity, b.breakdown.styleAffinity);
  if (styleDiff !== 0) return styleDiff;

  return compareAssetIdAscii(a.asset.id, b.asset.id);`,
    replacement: `  const styleDiff = compareStyleAffinity(a.breakdown.styleAffinity, b.breakdown.styleAffinity);
  if (styleDiff !== 0) return styleDiff;

  // MUT-12: matchedStyles.length influencia ranking
  const countDiff = b.breakdown.matchedStyles.length - a.breakdown.matchedStyles.length;
  if (countDiff !== 0) return countDiff;

  return compareAssetIdAscii(a.asset.id, b.asset.id);`,
  },
];

type FailureKind =
  | "ASSERTION_FAILURE"
  | "COMPILATION_ERROR"
  | "TIMEOUT"
  | "PROCESS_ERROR"
  | "SURVIVED";

function normalizeEol(str: string): string {
  return str.replace(/\r\n/g, "\n");
}

function runTestProcess(
  projectRoot: string,
  testPath: string,
  matcherPath: string
): ReturnType<typeof spawnSync> {
  const tsxCliPath = path.resolve(projectRoot, "node_modules/tsx/dist/cli.mjs");
  if (fs.existsSync(tsxCliPath)) {
    return spawnSync(process.execPath, [tsxCliPath, testPath], {
      cwd: projectRoot,
      env: {
        ...process.env,
        ADS_PRO_MATCHER_PATH: matcherPath,
      },
      encoding: "utf8",
      timeout: 15000,
    });
  }

  return spawnSync(process.platform === "win32" ? "npx.cmd" : "npx", ["tsx", testPath], {
    cwd: projectRoot,
    env: {
      ...process.env,
      ADS_PRO_MATCHER_PATH: matcherPath,
    },
    encoding: "utf8",
    timeout: 15000,
    shell: true,
  });
}

function classifyResult(child: ReturnType<typeof spawnSync>): {
  kind: FailureKind;
  killed: boolean;
  errorMessage: string;
} {
  if (child.error) {
    const isTimeout = (child.error as { code?: string }).code === "ETIMEDOUT";
    return {
      kind: isTimeout ? "TIMEOUT" : "PROCESS_ERROR",
      killed: false,
      errorMessage: `Erro de processo (${child.error.message})`,
    };
  }

  if (child.status === 0) {
    return {
      kind: "SURVIVED",
      killed: false,
      errorMessage: "SOBREVIVEU (Exit code 0 inesperado!)",
    };
  }

  const fullOutput = (child.stderr || "") + "\n" + (child.stdout || "");

  // Detectar falhas de compilação / sintaxe / esbuild
  if (
    fullOutput.includes("Transform failed") ||
    fullOutput.includes("TransformError") ||
    fullOutput.includes("SyntaxError") ||
    fullOutput.includes("Cannot find module") ||
    fullOutput.includes("ERR_MODULE_NOT_FOUND")
  ) {
    return {
      kind: "COMPILATION_ERROR",
      killed: false,
      errorMessage: "Erro de compilação ou transformação sintática (não é falha semântica de teste)",
    };
  }

  // Detectar falhas de asserção legítimas capturadas pela suíte
  const isAssertion =
    fullOutput.includes("AssertionError") ||
    fullOutput.includes("TypeError: Cannot assign to read only property"); // MUT-09 deepFreeze

  if (isAssertion) {
    const lines = fullOutput
      .split("\n")
      .map((l) => l.trim())
      .filter(
        (l) =>
          l.startsWith("AssertionError") ||
          l.startsWith("TypeError") ||
          l.includes("Error:") ||
          l.includes("deve") ||
          l.includes("excluído") ||
          l.includes("vencer") ||
          l.includes("desempatar")
      );
    return {
      kind: "ASSERTION_FAILURE",
      killed: true,
      errorMessage: lines.slice(0, 2).join(" | ") || `AssertionError capturado (exit code ${child.status})`,
    };
  }

  return {
    kind: "PROCESS_ERROR",
    killed: false,
    errorMessage: `Processo finalizou com erro sem AssertionError (exit code ${child.status})`,
  };
}

function runMutationHarness() {
  console.log("=== INICIANDO MUTATION HARNESS VERSIONADO (ADS-PRO-02B) ===");
  console.log(`Total de mutações a avaliar: ${MUTATIONS.length}`);

  const projectRoot = process.cwd();
  let tempDir: string | null = null;

  try {
    // 1. Criar diretório temporário exclusivo nesta execução
    const tempBaseDir = path.resolve(projectRoot, ".tmp");
    fs.mkdirSync(tempBaseDir, { recursive: true });
    tempDir = fs.mkdtempSync(path.join(tempBaseDir, "mutation-run-"));

    const tempSharedDir = path.resolve(tempDir, "shared");
    const tempScriptDir = path.resolve(tempDir, "script");
    fs.mkdirSync(tempScriptDir, { recursive: true });

    // Copiar pasta shared completa para preservar todos os imports relativos do ecossistema
    fs.cpSync(path.resolve(projectRoot, "shared"), tempSharedDir, { recursive: true });

    // Copiar script de testes
    const originalTestPath = path.resolve(projectRoot, "script/ads-pro-02-matcher-tests.ts");
    const tempTestPath = path.resolve(tempScriptDir, "ads-pro-02-matcher-tests.ts");
    fs.copyFileSync(originalTestPath, tempTestPath);

    const originalMatcherPath = path.resolve(projectRoot, "shared/ads-pro/asset-matcher.ts");
    const tempMatcherPath = path.resolve(tempSharedDir, "ads-pro/asset-matcher.ts");

    const baseMatcherSource = normalizeEol(fs.readFileSync(originalMatcherPath, "utf8"));

    // 2. Execução BASELINE: Exige exit code 0 contra a suíte sem mutação
    console.log("-> 1. Executando Baseline (suíte sem mutação)...");
    const baselineChild = runTestProcess(projectRoot, tempTestPath, tempMatcherPath);
    if (baselineChild.status !== 0) {
      throw new Error(
        `Baseline falhou com exit code ${baselineChild.status}! A suíte deve passar sem mutação antes do harness.\n` +
          `Stderr: ${baselineChild.stderr}\nStdout: ${baselineChild.stdout}`
      );
    }
    console.log("[BASELINE] Suíte sem mutação executada com sucesso (Exit code 0).\n");

    // 3. Execução das 12 mutações com classificação rigorosa
    console.log("-> 2. Executando Mutações Semânticas...");
    const results: {
      id: string;
      description: string;
      kind: FailureKind;
      killed: boolean;
      errorMessage: string;
    }[] = [];

    for (const mutation of MUTATIONS) {
      const normalizedTarget = normalizeEol(mutation.target);
      const normalizedReplacement = normalizeEol(mutation.replacement);

      if (!baseMatcherSource.includes(normalizedTarget)) {
        throw new Error(
          `Erro interno no harness: alvo da mutação ${mutation.id} não encontrado no código base.\nAlvo buscado:\n${normalizedTarget}`
        );
      }

      const mutatedSource = baseMatcherSource.replace(normalizedTarget, normalizedReplacement);
      fs.writeFileSync(tempMatcherPath, mutatedSource, "utf8");

      const child = runTestProcess(projectRoot, tempTestPath, tempMatcherPath);
      const { kind, killed, errorMessage } = classifyResult(child);

      results.push({
        id: mutation.id,
        description: mutation.description,
        kind,
        killed,
        errorMessage,
      });

      console.log(`[${killed ? "MORTA" : "FALHA"}] ${mutation.id} (${kind}): ${mutation.description}`);
      console.log(`   -> Diagnóstico: ${errorMessage}`);
    }

    console.log("\n=== RESUMO DAS MUTAÇÕES ===");
    const totalKilled = results.filter((r) => r.killed).length;
    console.log(`Total Mortas por Asserção: ${totalKilled}/${MUTATIONS.length}`);

    for (const r of results) {
      assert.strictEqual(
        r.killed,
        true,
        `Mutação ${r.id} não foi morta por asserção legítima! Classificação: ${r.kind}. Motivo: ${r.errorMessage}`
      );
    }

    console.log("=== TODAS AS 12 MUTAÇÕES FORAM MORTAS COM SUCESSO POR ASSERÇÃO! ===");
  } finally {
    // 4. Limpeza estrita garantida: remove somente o diretório exclusivo desta execução
    if (tempDir && fs.existsSync(tempDir)) {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // Ignora erro eventual de lock no filesystem
      }
    }
  }
}

runMutationHarness();
