/**
 * ADS-PRO-03C — Harness Versionado e Reproduzível de Testes de Mutação da Persistência
 *
 * Princípios de Execução e Auditoria:
 * 1. Verificação Baseline: Executa a suíte sem mutação e exige exit code 0 antes de qualquer mutação.
 * 2. Isolamento Estrito: Cria um diretório temporário exclusivo para cada execução (.tmp/mutation-run-03c-XXXXXX).
 * 3. Limpeza Garantida: Bloco try/finally garante remoção apenas do diretório exclusivo criado, inclusive sob falha de preparação.
 * 4. Rigor na Classificação: Diferencia falhas de asserção esperadas (ASSERTION_FAILURE) de erro de processo, compilação ou timeout.
 * 5. Mutações Canônicas: Avalia 10 mutações semânticas críticas (MUT-01 a MUT-10) e exige 10/10 mortas por asserção.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

interface MutationDef {
  readonly id: string;
  readonly description: string;
  readonly file: "persistence" | "creativeProfile";
  readonly target: string;
  readonly replacement: string;
}

const MUTATIONS: readonly MutationDef[] = [
  {
    id: "MUT-01",
    description: "Aceitar style inválido no save (bypass de validação no save)",
    file: "persistence",
    target: `  const parseResult = parseAdsProCreativeProfile(profileInput);
  if (!parseResult.ok) {`,
    replacement: `  // MUT-01: Aceitar style inválido
  const parseResult = { ok: true, value: profileInput as any };
  if (false as boolean) {`,
  },
  {
    id: "MUT-02",
    description: "Aceitar unknown field no save",
    file: "persistence",
    target: `  const parseResult = parseAdsProCreativeProfile(profileInput);
  if (!parseResult.ok) {
    const errorMessages = parseResult.errors.map((e) => e.message).join("; ");
    throw new AdsProCreativeProfileError(
      "ADS_PRO_CREATIVE_PROFILE_INVALID",
      \`Falha na validação do Creative Profile antes da escrita: \${errorMessages}\`,
      parseResult.errors
    );
  }`,
    replacement: `  // MUT-02: Aceitar unknown field
  const parseResult = {
    ok: true,
    value: { schemaVersion: 1 as const, preferredStyles: (profileInput as any)?.preferredStyles ?? [] },
  };`,
  },
  {
    id: "MUT-03",
    description: "Permitir cross-tenant (hardcode de path compartilhado entre usuários)",
    file: "persistence",
    target: `export function getAdsProCreativeProfileDocPath(uid: string): string {
  return \`users/\${uid}/\${ADS_PRO_PROFILE_COLLECTION}/\${ADS_PRO_PROFILE_DOC_ID}\`;
}`,
    replacement: `export function getAdsProCreativeProfileDocPath(uid: string): string {
  // MUT-03: Permite cross-tenant
  return \`users/shared-tenant/\${ADS_PRO_PROFILE_COLLECTION}/\${ADS_PRO_PROFILE_DOC_ID}\`;
}`,
  },
  {
    id: "MUT-04",
    description: "Tratar documento corrompido como válido (retorna vazio em vez de lançar erro)",
    file: "persistence",
    target: `  if (!parseResult.ok) {
    const errorMessages = parseResult.errors.map((e) => e.message).join("; ");
    throw new AdsProCreativeProfileError(
      "ADS_PRO_CREATIVE_PROFILE_INVALID",
      \`Documento do Creative Profile persistido é inválido ou corrompido: \${errorMessages}\`,
      parseResult.errors
    );
  }`,
    replacement: `  // MUT-04: Tratar documento corrompido como válido
  if (!parseResult.ok) {
    return { schemaVersion: 1 as const, preferredStyles: [] };
  }`,
  },
  {
    id: "MUT-05",
    description: "Inserir default modern quando documento estiver ausente",
    file: "persistence",
    target: `  if (!exists) {
    return null;
  }`,
    replacement: `  // MUT-05: Inserir default modern quando documento ausente
  if (!exists) {
    return { schemaVersion: 1 as const, preferredStyles: ["modern"] } as any;
  }`,
  },
  {
    id: "MUT-06",
    description: "Perder ordem dos styles na persistência (sort alfabético)",
    file: "persistence",
    target: `  const canonicalPayload = {
    schemaVersion: parseResult.value.schemaVersion,
    preferredStyles: [...parseResult.value.preferredStyles],
  };`,
    replacement: `  // MUT-06: Perde ordem dos styles
  const canonicalPayload = {
    schemaVersion: parseResult.value.schemaVersion,
    preferredStyles: [...parseResult.value.preferredStyles].sort(),
  };`,
  },
  {
    id: "MUT-07",
    description: "Sobrescrever campo irmão em user_settings",
    file: "persistence",
    target: `export function getAdsProCreativeProfileDocPath(uid: string): string {
  return \`users/\${uid}/\${ADS_PRO_PROFILE_COLLECTION}/\${ADS_PRO_PROFILE_DOC_ID}\`;
}`,
    replacement: `export function getAdsProCreativeProfileDocPath(uid: string): string {
  // MUT-07: Sobrescreve campo irmão em user_settings
  return \`user_settings/\${uid}\`;
}`,
  },
  {
    id: "MUT-08",
    description: "Permitir styles sazonais legados fresh-* no save",
    file: "persistence",
    target: `export async function saveAdsProCreativeProfile(
  profileInput: unknown,
  options?: AdsProPersistenceOptions
): Promise<AdsProCreativeProfileV1> {
  const parseResult = parseAdsProCreativeProfile(profileInput);`,
    replacement: `export async function saveAdsProCreativeProfile(
  profileInput: unknown,
  options?: AdsProPersistenceOptions
): Promise<AdsProCreativeProfileV1> {
  // MUT-08: Permitir fresh-*
  const sanitizedInput = (profileInput && typeof profileInput === "object" && Array.isArray((profileInput as any).preferredStyles))
    ? { ...(profileInput as any), preferredStyles: (profileInput as any).preferredStyles.map((s: string) => s.startsWith("fresh-") ? "modern" : s) }
    : profileInput;
  const parseResult = parseAdsProCreativeProfile(sanitizedInput);`,
  },
  {
    id: "MUT-09",
    description: "Roundtrip altera category/intent na resolução de contexto",
    file: "creativeProfile",
    target: `  return Object.freeze({
    entityKind: requestContext.entityKind,
    format: requestContext.format,
    ...(requestContext.category !== undefined ? { category: requestContext.category } : {}),
    ...(requestContext.intent !== undefined ? { intent: requestContext.intent } : {}),
    preferredStyles,
  });`,
    replacement: `  // MUT-09: Profile altera category indevidamente
  return Object.freeze({
    entityKind: requestContext.entityKind,
    format: requestContext.format,
    ...(profile?.preferredStyles?.[0] ? { category: profile.preferredStyles[0] as any } : (requestContext.category !== undefined ? { category: requestContext.category } : {})),
    ...(requestContext.intent !== undefined ? { intent: requestContext.intent } : {}),
    preferredStyles,
  });`,
  },
  {
    id: "MUT-10",
    description: "Persistir quiz answers indevidamente no banco",
    file: "persistence",
    target: `  const canonicalPayload = {
    schemaVersion: parseResult.value.schemaVersion,
    preferredStyles: [...parseResult.value.preferredStyles],
  };`,
    replacement: `  // MUT-10: Persistir quiz answers indevidamente
  const canonicalPayload = {
    schemaVersion: parseResult.value.schemaVersion,
    preferredStyles: [...parseResult.value.preferredStyles],
    quizAnswers: { q1: "opt_minimal" },
  };`,
  },
];

type FailureKind = "ASSERTION_FAILURE" | "SURVIVED" | "COMPILATION_ERROR" | "PROCESS_ERROR" | "TIMEOUT";

function normalizeEol(str: string): string {
  return str.replace(/\r\n/g, "\n");
}

function runTestProcess(projectRoot: string, testPath: string) {
  return spawnSync(process.platform === "win32" ? "npx.cmd" : "npx", ["tsx", testPath], {
    cwd: projectRoot,
    env: { ...process.env },
    encoding: "utf8",
    timeout: 25000,
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
    fullOutput.includes("TypeError: Cannot assign to read only property") ||
    fullOutput.includes("Values have same structure but are not reference-equal") ||
    fullOutput.includes("Expected values to be strictly deep-equal") ||
    fullOutput.includes("Expected values to be strictly equal");

  if (isAssertion) {
    const lines = fullOutput
      .split("\n")
      .map((l) => l.trim())
      .filter(
        (l) =>
          l.startsWith("AssertionError") ||
          l.startsWith("TypeError") ||
          l.includes("Error:") ||
          l.includes("PASS") ||
          l.includes("FALHA")
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
    errorMessage: `Processo finalizou com erro sem AssertionError (exit code ${child.status}): ${fullOutput.slice(0, 200)}`,
  };
}

export function runMutationHarness() {
  console.log("=== INICIANDO MUTATION HARNESS VERSIONADO (ADS-PRO-03C) ===");
  console.log(`Total de mutações a avaliar: ${MUTATIONS.length}`);

  const projectRoot = process.cwd();
  let tempDir: string | null = null;

  try {
    // 1. Criar diretório temporário exclusivo nesta execução
    const tempBaseDir = path.resolve(projectRoot, ".tmp");
    fs.mkdirSync(tempBaseDir, { recursive: true });
    tempDir = fs.mkdtempSync(path.join(tempBaseDir, "mutation-run-03c-"));

    const tempClientDir = path.resolve(tempDir, "client/src/lib");
    const tempSharedDir = path.resolve(tempDir, "shared");
    const tempScriptDir = path.resolve(tempDir, "script");
    fs.mkdirSync(tempClientDir, { recursive: true });
    fs.mkdirSync(tempScriptDir, { recursive: true });

    // Copiar shared inteiro para manter consistência total de tipos e helpers
    fs.cpSync(path.resolve(projectRoot, "shared"), tempSharedDir, { recursive: true });

    // Copiar arquivos sob teste
    const originalPersistencePath = path.resolve(
      projectRoot,
      "client/src/lib/ads-pro-profile-persistence.ts"
    );
    const originalCreativeProfilePath = path.resolve(
      projectRoot,
      "shared/ads-pro/creative-profile.ts"
    );
    const originalTestPath = path.resolve(
      projectRoot,
      "script/ads-pro-03c-profile-persistence-tests.ts"
    );

    const tempPersistencePath = path.resolve(
      tempClientDir,
      "ads-pro-profile-persistence.ts"
    );
    const tempCreativeProfilePath = path.resolve(
      tempSharedDir,
      "ads-pro/creative-profile.ts"
    );
    const tempTestPath = path.resolve(
      tempScriptDir,
      "ads-pro-03c-profile-persistence-tests.ts"
    );

    fs.copyFileSync(originalPersistencePath, tempPersistencePath);
    fs.copyFileSync(originalTestPath, tempTestPath);

    const basePersistenceSource = normalizeEol(fs.readFileSync(originalPersistencePath, "utf8"));
    const baseCreativeProfileSource = normalizeEol(fs.readFileSync(originalCreativeProfilePath, "utf8"));

    // 2. Execução BASELINE: Exige exit code 0 contra a suíte sem mutação
    console.log("-> 1. Executando Baseline (suíte sem mutação)...");
    const baselineChild = runTestProcess(projectRoot, tempTestPath);
    if (baselineChild.status !== 0) {
      throw new Error(
        `Baseline falhou com exit code ${baselineChild.status}! A suíte deve passar sem mutação antes do harness.\n` +
          `Stderr: ${baselineChild.stderr}\nStdout: ${baselineChild.stdout}`
      );
    }
    console.log("[BASELINE] Suíte sem mutação executada com sucesso (Exit code 0).\n");

    // 3. Execução das 10 mutações com classificação rigorosa
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

      const targetPath =
        mutation.file === "creativeProfile"
          ? tempCreativeProfilePath
          : tempPersistencePath;
      const baseSource =
        mutation.file === "creativeProfile"
          ? baseCreativeProfileSource
          : basePersistenceSource;

      if (!baseSource.includes(normalizedTarget)) {
        throw new Error(
          `Alvo da mutação ${mutation.id} não encontrado no arquivo base (${mutation.file})!\n` +
            `Alvo procurado:\n${normalizedTarget}`
        );
      }

      const mutatedSource = baseSource.replace(normalizedTarget, normalizedReplacement);
      fs.writeFileSync(targetPath, mutatedSource, "utf8");

      try {
        const child = runTestProcess(projectRoot, tempTestPath);
        const classification = classifyResult(child);

        results.push({
          id: mutation.id,
          description: mutation.description,
          kind: classification.kind,
          killed: classification.killed,
          errorMessage: classification.errorMessage,
        });

        if (classification.killed) {
          console.log(`[PASS] ${mutation.id}: KILLED (${classification.kind}) - ${mutation.description}`);
        } else {
          console.error(`[FAIL] ${mutation.id}: SOBREVIVEU ou ERRO INVÁLIDO (${classification.kind}) - ${mutation.description}`);
          console.error(`       Detalhe: ${classification.errorMessage}`);
        }
      } finally {
        // Restaura arquivo temporário para estado base limpo antes da próxima mutação
        fs.writeFileSync(targetPath, baseSource, "utf8");
      }
    }

    console.log("\n==================================================");
    console.log("RELATÓRIO DO MUTATION HARNESS (ADS-PRO-03C)");
    console.log("==================================================");

    const killedCount = results.filter((r) => r.killed).length;
    console.log(`Mutações Mortas por ASSERTION_FAILURE: ${killedCount}/${MUTATIONS.length}`);

    for (const r of results) {
      console.log(`- ${r.id}: ${r.killed ? "KILLED" : "SURVIVED"} [${r.kind}] — ${r.description}`);
    }

    assert.equal(
      killedCount,
      MUTATIONS.length,
      `Harness incompleto: esperava ${MUTATIONS.length} mutações mortas por asserção, obteve ${killedCount}.`
    );

    console.log("\nMUTATION HARNESS CONCLUÍDO COM 100% DE EFICÁCIA (10/10).");
  } finally {
    // 4. Limpeza rigorosa: remove SOMENTE o diretório temporário exclusivo criado
    if (tempDir && fs.existsSync(tempDir)) {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch (cleanErr) {
        console.warn(`Aviso: falha ao remover diretório temporário ${tempDir}:`, cleanErr);
      }
    }
  }
}

if (process.argv[1]?.endsWith("ads-pro-03c-profile-persistence-mutation-tests.ts")) {
  try {
    runMutationHarness();
  } catch (err) {
    console.error("FALHA CRÍTICA NO HARNESS DE MUTAÇÃO:", err);
    process.exit(1);
  }
}
