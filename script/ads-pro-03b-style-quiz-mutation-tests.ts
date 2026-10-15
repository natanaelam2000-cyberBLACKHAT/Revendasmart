/**
 * ADS-PRO-03B — Harness Versionado e Reproduzível de Testes de Mutação do Style Quiz V1
 *
 * Princípios de Execução e Auditoria:
 * 1. Verificação Baseline: Executa a suíte sem mutação e exige exit code 0 antes de qualquer mutação.
 * 2. Isolamento Estrito: Cria um diretório temporário exclusivo para cada execução (.tmp/mutation-run-03b-XXXXXX).
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
    description: "Aceitar mesma pergunta respondida mais de uma vez (duplicate question)",
    target: `    // 2. Não permitir duplicata da mesma pergunta
    if (seenQuestions.has(questionId)) {
      errors.push({
        code: "DUPLICATE_QUESTION",
        path: \`\${itemPath}.questionId\`,
        message: \`Pergunta "\${questionId}" respondida mais de uma vez\`,
      });
      continue;
    }`,
    replacement: `    // MUT-01: Permite duplicatas da mesma pergunta
    if (false as boolean) {
      errors.push({
        code: "DUPLICATE_QUESTION",
        path: \`\${itemPath}.questionId\`,
        message: \`Pergunta "\${questionId}" respondida mais de uma vez\`,
      });
      continue;
    }`,
  },
  {
    id: "MUT-02",
    description: "Aceitar option pertencente a outra pergunta",
    target: `    // 3. Opção precisa pertencer à pergunta informada
    const optionDef = questionDef.options.find((opt) => opt.id === optionId);
    if (!optionDef) {
      errors.push({
        code: "INVALID_OPTION_FOR_QUESTION",
        path: \`\${itemPath}.optionId\`,
        message: \`Opção "\${optionId}" não pertence à pergunta "\${questionId}"\`,
      });
      continue;
    }`,
    replacement: `    // MUT-02: Aceita option de qualquer pergunta
    const optionDef = Array.from(questionMap.values()).flatMap((q) => q.options).find((opt) => opt.id === optionId);
    if (!optionDef) {
      errors.push({
        code: "INVALID_OPTION_FOR_QUESTION",
        path: \`\${itemPath}.optionId\`,
        message: \`Opção "\${optionId}" não pertence à pergunta "\${questionId}"\`,
      });
      continue;
    }`,
  },
  {
    id: "MUT-03",
    description: "Aceitar questionId desconhecido na definição",
    target: `    // 1. Pergunta conhecida na definição
    const questionDef = questionMap.get(questionId);
    if (!questionDef) {
      errors.push({
        code: "UNKNOWN_QUESTION",
        path: \`\${itemPath}.questionId\`,
        message: \`Pergunta desconhecida "\${questionId}"\`,
      });
      continue;
    }`,
    replacement: `    // MUT-03: Não valida se questionId é conhecido
    const questionDef = questionMap.get(questionId) ?? { id: questionId as any, title: "", subtitle: "", options: [] };`,
  },
  {
    id: "MUT-04",
    description: "Ignorar validação de chaves desconhecidas e aceitar preferredStyles vindo do payload",
    target: `  } else if (isPlainObject(input)) {
    // Rejeição de chaves desconhecidas no topo (incluindo tentativas de injetar score ou preferredStyles)
    for (const key of Object.keys(input)) {
      if (!ALLOWED_SUBMISSION_KEYS.has(key)) {
        errors.push({
          code: "UNKNOWN_KEY",
          path: \`$.\${key}\`,
          message: \`Chave não permitida "\${key}" na submissão do Quiz\`,
        });
      }
    }`,
    replacement: `  } else if (isPlainObject(input)) {
    // MUT-04: Ignora chaves desconhecidas
    if (false as boolean) {
      for (const key of Object.keys(input)) {
        if (!ALLOWED_SUBMISSION_KEYS.has(key)) {
          errors.push({
            code: "UNKNOWN_KEY",
            path: \`$.\${key}\`,
            message: \`Chave não permitida "\${key}" na submissão do Quiz\`,
          });
        }
      }
    }`,
  },
  {
    id: "MUT-05",
    description: "Injetar estilo default 'modern' quando preferredStyles for vazio",
    target: `  const rankedStyles: MarketingProStyle[] = positiveStyles.map((item) => item.style);`,
    replacement: `  // MUT-05: Injeta default modern quando vazio
  const rankedStyles: MarketingProStyle[] = positiveStyles.length > 0
    ? positiveStyles.map((item) => item.style)
    : ["modern" as MarketingProStyle];`,
  },
  {
    id: "MUT-06",
    description: "Inverter ranking dos styles derivados (menor score primeiro)",
    target: `  // Ordenação lexicográfica de ranking: 1. Maior score primeiro; 2. Desempate canônico pré-definido
  positiveStyles.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    const indexA = tieBreakIndexMap.get(a.style) ?? 0;
    const indexB = tieBreakIndexMap.get(b.style) ?? 0;
    return indexA - indexB;
  });`,
    replacement: `  // MUT-06: Inverte a ordenação de pontuação
  positiveStyles.sort((a, b) => {
    if (b.score !== a.score) {
      return a.score - b.score;
    }
    const indexA = tieBreakIndexMap.get(a.style) ?? 0;
    const indexB = tieBreakIndexMap.get(b.style) ?? 0;
    return indexA - indexB;
  });`,
  },
  {
    id: "MUT-07",
    description: "Fazer ordem das respostas alterar o score acumulado",
    target: `  // Processamento cumulativo determinístico das respostas válidas
  for (const answer of submission.answers) {
    const question = questionMap.get(answer.questionId);
    if (!question) continue;

    const option = question.options.find((opt) => opt.id === answer.optionId);
    if (!option) continue;

    for (const award of option.awards) {
      scores[award.style] += award.points;
    }`,
    replacement: `  // MUT-07: Pondera pontos de acordo com a ordem de chegada
  for (let ansIdx = 0; ansIdx < submission.answers.length; ansIdx += 1) {
    const answer = submission.answers[ansIdx];
    const question = questionMap.get(answer.questionId);
    if (!question) continue;

    const option = question.options.find((opt) => opt.id === answer.optionId);
    if (!option) continue;

    for (const award of option.awards) {
      scores[award.style] += award.points * (ansIdx + 1);
    }`,
  },
  {
    id: "MUT-08",
    description: "Incluir styles sem evidência positiva (score 0) no profile",
    target: `  // Filtragem e ordenação determinística dos estilos com evidência estritamente positiva (> 0)
  const positiveStyles: { style: MarketingProStyle; score: number }[] = [];
  for (const style of [...QUIZ_STYLE_TIE_BREAK_ORDER].reverse()) {
    const score = scores[style];
    if (score > 0) {
      positiveStyles.push({ style, score });
    }
  }`,
    replacement: `  // MUT-08: Inclui estilos sem evidência positiva (score >= 0)
  const positiveStyles: { style: MarketingProStyle; score: number }[] = [];
  for (const style of [...QUIZ_STYLE_TIE_BREAK_ORDER].reverse()) {
    const score = scores[style];
    if (score >= 0) {
      positiveStyles.push({ style, score });
    }
  }`,
  },
  {
    id: "MUT-09",
    description: "Permitir CreativeFamily sazonal ('fresh-premium') no mapping de opções",
    target: `        {
          id: "comp_dynamic",
          label: "Geometria Contemporânea",
          description: "Linhas modernas, enquadramento dinâmico e ritmo visual funcional.",
          awards: [{ style: "modern", points: 2 }],
        },`,
    replacement: `        {
          id: "comp_dynamic",
          label: "Geometria Contemporânea",
          description: "Linhas modernas, enquadramento dinâmico e ritmo visual funcional.",
          awards: [{ style: "fresh-premium" as any, points: 2 }],
        },`,
  },
  {
    id: "MUT-10",
    description: "Fazer estilo do quiz superar category no comparador do Matcher",
    target: `  const catDiff = compareCategoryAffinity(a.breakdown.categoryAffinity, b.breakdown.categoryAffinity);
  if (catDiff !== 0) return catDiff;

  const intentDiff = compareIntentAffinity(a.breakdown.intentAffinity, b.breakdown.intentAffinity);
  if (intentDiff !== 0) return intentDiff;

  const styleDiff = compareStyleAffinity(a.breakdown.styleAffinity, b.breakdown.styleAffinity);
  if (styleDiff !== 0) return styleDiff;`,
    replacement: `  // MUT-10: estilo indevidamente precede category
  const styleDiff = compareStyleAffinity(a.breakdown.styleAffinity, b.breakdown.styleAffinity);
  if (styleDiff !== 0) return styleDiff;

  const catDiff = compareCategoryAffinity(a.breakdown.categoryAffinity, b.breakdown.categoryAffinity);
  if (catDiff !== 0) return catDiff;

  const intentDiff = compareIntentAffinity(a.breakdown.intentAffinity, b.breakdown.intentAffinity);
  if (intentDiff !== 0) return intentDiff;`,
  },
  {
    id: "MUT-11",
    description: "Fazer estilo do quiz superar intent no comparador do Matcher",
    target: `  const catDiff = compareCategoryAffinity(a.breakdown.categoryAffinity, b.breakdown.categoryAffinity);
  if (catDiff !== 0) return catDiff;

  const intentDiff = compareIntentAffinity(a.breakdown.intentAffinity, b.breakdown.intentAffinity);
  if (intentDiff !== 0) return intentDiff;

  const styleDiff = compareStyleAffinity(a.breakdown.styleAffinity, b.breakdown.styleAffinity);
  if (styleDiff !== 0) return styleDiff;`,
    replacement: `  // MUT-11: estilo indevidamente precede intent, mantendo category primeiro
  const catDiff = compareCategoryAffinity(a.breakdown.categoryAffinity, b.breakdown.categoryAffinity);
  if (catDiff !== 0) return catDiff;

  const styleDiff = compareStyleAffinity(a.breakdown.styleAffinity, b.breakdown.styleAffinity);
  if (styleDiff !== 0) return styleDiff;

  const intentDiff = compareIntentAffinity(a.breakdown.intentAffinity, b.breakdown.intentAffinity);
  if (intentDiff !== 0) return intentDiff;`,
  },
  {
    id: "MUT-12",
    description: "Remover desempate determinístico (retornar 0 para scores iguais)",
    target: `  // Ordenação lexicográfica de ranking: 1. Maior score primeiro; 2. Desempate canônico pré-definido
  positiveStyles.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    const indexA = tieBreakIndexMap.get(a.style) ?? 0;
    const indexB = tieBreakIndexMap.get(b.style) ?? 0;
    return indexA - indexB;
  });`,
    replacement: `  // MUT-12: Remove desempate determinístico
  positiveStyles.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    return 0; // MUT-12
  });`,
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
  quizModulePath: string
): ReturnType<typeof spawnSync> {
  const tsxCliPath = path.resolve(projectRoot, "node_modules/tsx/dist/cli.mjs");
  if (fs.existsSync(tsxCliPath)) {
    return spawnSync(process.execPath, [tsxCliPath, testPath], {
      cwd: projectRoot,
      env: {
        ...process.env,
        ADS_PRO_STYLE_QUIZ_PATH: quizModulePath,
      },
      encoding: "utf8",
      timeout: 15000,
    });
  }

  return spawnSync(process.platform === "win32" ? "npx.cmd" : "npx", ["tsx", testPath], {
    cwd: projectRoot,
    env: {
      ...process.env,
      ADS_PRO_STYLE_QUIZ_PATH: quizModulePath,
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
          l.includes("rejeitada") ||
          l.includes("vencer") ||
          l.includes("esperado")
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
  console.log("=== INICIANDO MUTATION HARNESS VERSIONADO (ADS-PRO-03B) ===");
  console.log(`Total de mutações a avaliar: ${MUTATIONS.length}`);

  const projectRoot = process.cwd();
  let tempDir: string | null = null;

  try {
    // 1. Criar diretório temporário exclusivo nesta execução
    const tempBaseDir = path.resolve(projectRoot, ".tmp");
    fs.mkdirSync(tempBaseDir, { recursive: true });
    tempDir = fs.mkdtempSync(path.join(tempBaseDir, "mutation-run-03b-"));

    const tempSharedDir = path.resolve(tempDir, "shared");
    const tempScriptDir = path.resolve(tempDir, "script");
    fs.mkdirSync(tempScriptDir, { recursive: true });

    // Copiar pasta shared completa para preservar todos os imports relativos do ecossistema
    fs.cpSync(path.resolve(projectRoot, "shared"), tempSharedDir, { recursive: true });

    // Copiar script de testes
    const originalTestPath = path.resolve(
      projectRoot,
      "script/ads-pro-03b-style-quiz-tests.ts"
    );
    const tempTestPath = path.resolve(tempScriptDir, "ads-pro-03b-style-quiz-tests.ts");
    fs.copyFileSync(originalTestPath, tempTestPath);

    const originalQuizPath = path.resolve(projectRoot, "shared/ads-pro/style-quiz.ts");
    const tempQuizPath = path.resolve(tempSharedDir, "ads-pro/style-quiz.ts");
    const originalMatcherPath = path.resolve(projectRoot, "shared/ads-pro/asset-matcher.ts");
    const tempMatcherPath = path.resolve(tempSharedDir, "ads-pro/asset-matcher.ts");

    const baseQuizSource = normalizeEol(fs.readFileSync(originalQuizPath, "utf8"));
    const baseMatcherSource = normalizeEol(fs.readFileSync(originalMatcherPath, "utf8"));

    // 2. Execução BASELINE: Exige exit code 0 contra a suíte sem mutação
    console.log("-> 1. Executando Baseline (suíte sem mutação)...");
    const baselineChild = runTestProcess(projectRoot, tempTestPath, tempQuizPath);
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

      const mutatesMatcher = mutation.id === "MUT-10" || mutation.id === "MUT-11";
      const sourcePath = mutatesMatcher ? tempMatcherPath : tempQuizPath;
      const baseSource = mutatesMatcher ? baseMatcherSource : baseQuizSource;

      if (!baseSource.includes(normalizedTarget)) {
        throw new Error(
          `Erro interno no harness: alvo da mutação ${mutation.id} não encontrado no código base.\nAlvo buscado:\n${normalizedTarget}`
        );
      }

      const mutatedSource = baseSource.replace(normalizedTarget, normalizedReplacement);
      if (mutatesMatcher) {
        fs.writeFileSync(tempQuizPath, baseQuizSource, "utf8");
      } else {
        fs.writeFileSync(tempMatcherPath, baseMatcherSource, "utf8");
      }
      fs.writeFileSync(sourcePath, mutatedSource, "utf8");

      const child = runTestProcess(projectRoot, tempTestPath, tempQuizPath);
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

    console.log("\n[SUCESSO] Todas as 12 mutações semânticas foram mortas por asserções legítimas.");
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
