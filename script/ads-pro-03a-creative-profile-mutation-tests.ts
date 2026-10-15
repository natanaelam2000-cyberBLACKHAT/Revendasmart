/**
 * ADS-PRO-03A — Harness Versionado e Reproduzível de Testes de Mutação do Creative Profile V1
 *
 * Princípios de Execução e Auditoria:
 * 1. Verificação Baseline: Executa a suíte sem mutação e exige exit code 0 antes de qualquer mutação.
 * 2. Isolamento Estrito: Cria um diretório temporário exclusivo para cada execução (.tmp/mutation-run-03a-XXXXXX).
 * 3. Limpeza Garantida: Bloco try/finally garante remoção apenas do diretório exclusivo criado, inclusive sob falha de preparação.
 * 4. Rigor na Classificação: Diferencia falhas de asserção esperadas (ASSERTION_FAILURE) de erro de processo, compilação ou timeout.
 * 5. Mutações Canônicas: Avalia 9 mutações semânticas críticas (MUT-01 a MUT-09) e exige 9/9 mortas por asserção.
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
    description: "Aceitar schemaVersion !== 1 (ex: versão 2)",
    target: `  } else if (input.schemaVersion !== ADS_PRO_CREATIVE_PROFILE_SCHEMA_VERSION) {`,
    replacement: `  } else if (input.schemaVersion !== ADS_PRO_CREATIVE_PROFILE_SCHEMA_VERSION && input.schemaVersion !== 2) { // MUT-01`,
  },
  {
    id: "MUT-02",
    description: "Ignorar verificação de chaves desconhecidas (aceitar propriedades não documentadas)",
    target: `  // Verificação de chaves desconhecidas
  const allowedSet = new Set(ALLOWED_PROFILE_KEYS);
  for (const key of Object.keys(input)) {
    if (!allowedSet.has(key)) {
      errors.push({
        code: "UNKNOWN_KEY",
        path: \`$.\${key}\`,
        message: \`Chave não reconhecida "\${key}" em Creative Profile V1\`,
      });
    }
  }`,
    replacement: `  // MUT-02: Verificação de chaves desconhecidas desativada`,
  },
  {
    id: "MUT-03",
    description: "Aceitar estilos visuais arbitrários (não checar MarketingProStyle)",
    target: `      if (typeof item !== "string" || !isMarketingProStyle(item)) {`,
    replacement: `      if (typeof item !== "string") { // MUT-03: aceita qualquer string`,
  },
  {
    id: "MUT-04",
    description: "Permitir estilos duplicados na lista preferredStyles",
    target: `      if (seen.has(item)) {
        errors.push({
          code: "DUPLICATE_STYLE",
          path: itemPath,
          message: \`Estilo visual duplicado "\${item}" em \${itemPath}\`,
        });
        continue;
      }`,
    replacement: `      // MUT-04: Permite estilos duplicados`,
  },
  {
    id: "MUT-05",
    description: "Inverter a ordem de preferências visuais no resolver (violando primário vs secundário)",
    target: `  const preferredStyles = profile?.preferredStyles
    ? Object.freeze([...profile.preferredStyles])
    : Object.freeze([]);`,
    replacement: `  // MUT-05: Inverte a ordem das preferências
  const preferredStyles = profile?.preferredStyles
    ? Object.freeze([...profile.preferredStyles].reverse())
    : Object.freeze([]);`,
  },
  {
    id: "MUT-06",
    description: "Injetar estilo default 'modern' quando preferredStyles for vazio",
    target: `  const preferredStyles = profile?.preferredStyles
    ? Object.freeze([...profile.preferredStyles])
    : Object.freeze([]);`,
    replacement: `  // MUT-06: Injeta default quando vazio
  const preferredStyles = profile?.preferredStyles && profile.preferredStyles.length > 0
    ? Object.freeze([...profile.preferredStyles])
    : Object.freeze(["modern" as const]);`,
  },
  {
    id: "MUT-07",
    description: "Resolver descarta category do requestContext",
    target: `    ...(requestContext.category !== undefined ? { category: requestContext.category } : {}),`,
    replacement: `    // MUT-07: omite category`,
  },
  {
    id: "MUT-08",
    description: "Resolver permite que profile sobrescreva category e intent",
    target: `    ...(requestContext.category !== undefined ? { category: requestContext.category } : {}),
    ...(requestContext.intent !== undefined ? { intent: requestContext.intent } : {}),`,
    replacement: `    // MUT-08: profile sobrescreve category e intent
    category: (profile as Record<string, unknown> | undefined)?.category as any ?? requestContext.category,
    intent: (profile as Record<string, unknown> | undefined)?.intent as any ?? requestContext.intent,`,
  },
  {
    id: "MUT-09",
    description: "Fazer estilo do profile sobrepujar categoria no Matcher (descartando category se houver preferredStyles)",
    target: `  const catDiff = compareCategoryAffinity(a.breakdown.categoryAffinity, b.breakdown.categoryAffinity);
  if (catDiff !== 0) return catDiff;

  const intentDiff = compareIntentAffinity(a.breakdown.intentAffinity, b.breakdown.intentAffinity);
  if (intentDiff !== 0) return intentDiff;

  const styleDiff = compareStyleAffinity(a.breakdown.styleAffinity, b.breakdown.styleAffinity);
  if (styleDiff !== 0) return styleDiff;`,
    replacement: `  // MUT-09: estilo indevidamente precede categoria
  const styleDiff = compareStyleAffinity(a.breakdown.styleAffinity, b.breakdown.styleAffinity);
  if (styleDiff !== 0) return styleDiff;

  const catDiff = compareCategoryAffinity(a.breakdown.categoryAffinity, b.breakdown.categoryAffinity);
  if (catDiff !== 0) return catDiff;

  const intentDiff = compareIntentAffinity(a.breakdown.intentAffinity, b.breakdown.intentAffinity);
  if (intentDiff !== 0) return intentDiff;`,
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
  profilePath: string
): ReturnType<typeof spawnSync> {
  const tsxCliPath = path.resolve(projectRoot, "node_modules/tsx/dist/cli.mjs");
  if (fs.existsSync(tsxCliPath)) {
    return spawnSync(process.execPath, [tsxCliPath, testPath], {
      cwd: projectRoot,
      env: {
        ...process.env,
        ADS_PRO_CREATIVE_PROFILE_PATH: profilePath,
      },
      encoding: "utf8",
      timeout: 15000,
    });
  }

  return spawnSync(process.platform === "win32" ? "npx.cmd" : "npx", ["tsx", testPath], {
    cwd: projectRoot,
    env: {
      ...process.env,
      ADS_PRO_CREATIVE_PROFILE_PATH: profilePath,
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
    fullOutput.includes("TypeError: Cannot assign to read only property");

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
          l.includes("rejeitado") ||
          l.includes("vencer") ||
          l.includes("preservada")
      );
    return {
      kind: "ASSERTION_FAILURE",
      killed: true,
      errorMessage:
        lines.slice(0, 2).join(" | ") || `AssertionError capturado (exit code ${child.status})`,
    };
  }

  return {
    kind: "PROCESS_ERROR",
    killed: false,
    errorMessage: `Processo finalizou com erro sem AssertionError (exit code ${child.status})`,
  };
}

function runMutationHarness() {
  console.log("=== INICIANDO MUTATION HARNESS VERSIONADO (ADS-PRO-03A) ===");
  console.log(`Total de mutações a avaliar: ${MUTATIONS.length}`);

  const projectRoot = process.cwd();
  let tempDir: string | null = null;

  try {
    // 1. Criar diretório temporário exclusivo nesta execução
    const tempBaseDir = path.resolve(projectRoot, ".tmp");
    fs.mkdirSync(tempBaseDir, { recursive: true });
    tempDir = fs.mkdtempSync(path.join(tempBaseDir, "mutation-run-03a-"));

    const tempSharedDir = path.resolve(tempDir, "shared");
    const tempScriptDir = path.resolve(tempDir, "script");
    fs.mkdirSync(tempScriptDir, { recursive: true });

    // Copiar pasta shared completa para preservar todos os imports relativos do ecossistema
    fs.cpSync(path.resolve(projectRoot, "shared"), tempSharedDir, { recursive: true });

    // Copiar script de testes
    const originalTestPath = path.resolve(
      projectRoot,
      "script/ads-pro-03a-creative-profile-tests.ts"
    );
    const tempTestPath = path.resolve(tempScriptDir, "ads-pro-03a-creative-profile-tests.ts");
    fs.copyFileSync(originalTestPath, tempTestPath);

    const originalProfilePath = path.resolve(projectRoot, "shared/ads-pro/creative-profile.ts");
    const originalMatcherPath = path.resolve(projectRoot, "shared/ads-pro/asset-matcher.ts");
    const tempProfilePath = path.resolve(tempSharedDir, "ads-pro/creative-profile.ts");
    const tempMatcherPath = path.resolve(tempSharedDir, "ads-pro/asset-matcher.ts");

    const baseProfileSource = normalizeEol(fs.readFileSync(originalProfilePath, "utf8"));
    const baseMatcherSource = normalizeEol(fs.readFileSync(originalMatcherPath, "utf8"));

    // 2. Execução BASELINE: Exige exit code 0 contra a suíte sem mutação
    console.log("-> 1. Executando Baseline (suíte sem mutação)...");
    const baselineChild = runTestProcess(projectRoot, tempTestPath, tempProfilePath);
    if (baselineChild.status !== 0) {
      throw new Error(
        `Baseline falhou com exit code ${baselineChild.status}! A suíte deve passar sem mutação antes do harness.\n` +
          `Stderr: ${baselineChild.stderr}\nStdout: ${baselineChild.stdout}`
      );
    }
    console.log("[BASELINE] Suíte sem mutação executada com sucesso (Exit code 0).\n");

    // 3. Execução das 9 mutações com classificação rigorosa
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

      const sourcePath = mutation.id === "MUT-09" ? tempMatcherPath : tempProfilePath;
      const baseSource = mutation.id === "MUT-09" ? baseMatcherSource : baseProfileSource;

      if (!baseSource.includes(normalizedTarget)) {
        throw new Error(
          `Erro interno no harness: alvo da mutação ${mutation.id} não encontrado no código base.\nAlvo buscado:\n${normalizedTarget}`
        );
      }

      const mutatedSource = baseSource.replace(normalizedTarget, normalizedReplacement);
      if (mutation.id === "MUT-09") {
        fs.writeFileSync(tempProfilePath, baseProfileSource, "utf8");
      } else {
        fs.writeFileSync(tempMatcherPath, baseMatcherSource, "utf8");
      }
      fs.writeFileSync(sourcePath, mutatedSource, "utf8");

      const child = runTestProcess(projectRoot, tempTestPath, tempProfilePath);
      const { kind, killed, errorMessage } = classifyResult(child);

      results.push({
        id: mutation.id,
        description: mutation.description,
        kind,
        killed,
        errorMessage,
      });

      console.log(
        `[${killed ? "MORTA" : "FALHA"}] ${mutation.id} (${kind}): ${mutation.description}`
      );
      console.log(`   -> Diagnóstico: ${errorMessage}`);
    }

    console.log("\n=== RESUMO DAS MUTAÇÕES ===");
    const totalKilled = results.filter((r) => r.killed).length;
    console.log(`Total Mortas por Asserção: ${totalKilled}/${MUTATIONS.length}`);

    for (const r of results) {
      assert.strictEqual(
        r.killed,
        true,
        `Mutação ${r.id} (${r.description}) não foi morta por asserção! Status: ${r.kind}`
      );
    }

    console.log("\n[SUCESSO] Todas as mutações semânticas foram mortas por asserções legítimas.");
  } finally {
    // 4. Limpeza garantida apenas do diretório exclusivo criado nesta execução
    if (tempDir && fs.existsSync(tempDir)) {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
        console.log(`[LIMPEZA] Diretório temporário exclusivo removido: ${tempDir}`);
      } catch (err) {
        console.warn(`[WARN] Falha ao remover diretório temporário ${tempDir}:`, err);
      }
    }
  }
}

runMutationHarness();
