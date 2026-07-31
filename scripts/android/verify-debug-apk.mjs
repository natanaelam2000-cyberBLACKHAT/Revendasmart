#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, delimiter, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  ANDROID_PACKAGE_NAME,
  ANDROID_WEB_DIR,
  BUILD_MANIFEST_FILE,
  DEBUG_APK_RELATIVE_PATH,
  DEBUG_PROVENANCE_RELATIVE_PATH,
  aggregateDirectoryHash,
  assertRevendaSmartRepository,
  buildDirectoryHashMap,
  compareDirectoryHashMaps,
  getGitSnapshot,
  repositoryLabel,
  resolveRepositoryRoot,
  sha256File,
  validateBuildManifest,
  walkFiles,
} from "./build-provenance.mjs";

export const REQUIRED_APK_MARKERS = [
  "Chamar no WhatsApp",
  "Resumo do per\u00edodo",
  "O que precisa da sua aten\u00e7\u00e3o",
];
export const FORBIDDEN_APK_MARKERS = [
  "\u00daltimos 7 dias",
  "Imagem omitida; arte gerada sem ela.",
  "Produto selecionado para voc\u00ea pedir direto pelo WhatsApp.",
  "Pe\u00e7a pelo WhatsApp",
];

function fail(message) { throw new Error(message); }
function normalizeExecutable(value) { return String(value || "").trim().replace(/^['\"]|['\"]$/g, ""); }
function executableNames(name) { return process.platform === "win32" ? [`${name}.exe`, `${name}.cmd`, `${name}.bat`, name] : [name]; }
function executableCandidatesFromPath(name) {
  const candidates = [];
  for (const directory of String(process.env.PATH || "").split(delimiter).filter(Boolean)) {
    for (const executable of executableNames(name)) candidates.push(join(directory, executable));
  }
  return candidates;
}
function firstExistingExecutable(candidates) {
  for (const candidate of candidates.map(normalizeExecutable).filter(Boolean)) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return "";
}
function resolveJarExecutable() {
  const javaHome = normalizeExecutable(process.env.JAVA_HOME);
  const candidate = firstExistingExecutable([
    javaHome ? join(javaHome, "bin", process.platform === "win32" ? "jar.exe" : "jar") : "",
    ...executableCandidatesFromPath("jar"),
  ]);
  if (!candidate) fail("jar não foi encontrado; configure JAVA_HOME para o JDK usado no build Android.");
  return candidate;
}
function sdkRoots() {
  return [...new Set([process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT].map(normalizeExecutable).filter(Boolean))];
}
function aaptCandidates() {
  const candidates = [process.env.AAPT_PATH];
  for (const sdkRoot of sdkRoots()) {
    const buildTools = join(sdkRoot, "build-tools");
    if (!existsSync(buildTools)) continue;
    candidates.push(...walkFiles(buildTools)
      .filter((file) => /[/\\]aapt(?:\.exe)?$/i.test(file))
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true })));
  }
  candidates.push(...executableCandidatesFromPath("aapt"));
  return [...new Set(candidates.map(normalizeExecutable).filter(Boolean))];
}

export function parseAaptPackageName(output) {
  return String(output || "").match(/^package:\s+name='([^']+)'/m)?.[1] || "";
}

function inspectApkPackage(apkPath) {
  let attempted = 0;
  for (const candidate of aaptCandidates()) {
    if (!existsSync(candidate)) continue;
    attempted += 1;
    const result = spawnSync(candidate, ["dump", "badging", apkPath], {
      encoding: "utf8",
      shell: false,
      maxBuffer: 16 * 1024 * 1024,
    });
    if (result.status === 0) {
      const packageName = parseAaptPackageName(result.stdout);
      if (packageName) return { packageName, inspector: candidate };
    }
  }
  fail(`não foi possível inspecionar o package dentro do APK com aapt${attempted ? ` (${attempted} candidato(s) testado(s))` : ""}.`);
}

function extractApk(apkPath, outputDirectory) {
  const result = spawnSync(resolveJarExecutable(), ["xf", apkPath], {
    cwd: outputDirectory,
    encoding: "utf8",
    shell: false,
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || "").trim();
    fail(`não foi possível extrair o APK${detail ? `: ${detail}` : "."}`);
  }
}

function readableBundleFiles(root) {
  return walkFiles(root).filter((file) => /\.(?:html|js|css|json|map|txt)$/i.test(file));
}
function markerLocations(files, marker) {
  return files.filter((file) => readFileSync(file, "utf8").includes(marker));
}
function findApplicationWebRoots(extractedRoot) {
  const roots = [];
  for (const file of walkFiles(extractedRoot).filter((candidate) => candidate.endsWith("index.html"))) {
    const html = readFileSync(file, "utf8");
    if (/id=["']root["']/.test(html) && /(?:src|href)=["'][^"']*assets\//.test(html)) roots.push(dirname(file));
  }
  return roots;
}

function assertSingleApplicationBundle(webRoot) {
  const entries = walkFiles(join(webRoot, "assets"))
    .filter((file) => /^index-[A-Za-z0-9_-]+\.js$/.test(basename(file)));
  if (entries.length !== 1) fail(`o APK contém ${entries.length} entradas JavaScript da aplicação; esperado exatamente 1.`);
  const indexHtml = readFileSync(join(webRoot, "index.html"), "utf8");
  if (!indexHtml.includes(`assets/${basename(entries[0])}`)) fail("a entrada JavaScript única não é a referenciada pelo index.html.");
}

export function isApkFresh(apkModifiedAtMs, generatedAt, buildStartedAt) {
  const generatedAtMs = Date.parse(String(generatedAt || ""));
  const buildStartedAtMs = Date.parse(String(buildStartedAt || ""));
  if (!Number.isFinite(generatedAtMs) || !Number.isFinite(buildStartedAtMs)) return false;
  const toleranceMs = 2_000;
  return generatedAtMs + toleranceMs >= buildStartedAtMs && apkModifiedAtMs + toleranceMs >= generatedAtMs;
}

export function assertFirebaseConfigPresentInManifest(manifest) {
  if (manifest?.firebaseConfigPresent !== true) {
    fail("o APK foi gerado sem configuração Firebase validada.");
  }
  return true;
}

function formatBytes(value) { return `${(value / 1024 / 1024).toFixed(2)} MiB`; }
function canonicalRequestedApk(root, requestedPath) {
  const canonical = resolve(root, DEBUG_APK_RELATIVE_PATH);
  if (!requestedPath) return canonical;
  if (resolve(root, requestedPath) !== canonical) fail(`somente o APK canônico pode ser verificado: ${DEBUG_APK_RELATIVE_PATH}.`);
  return canonical;
}
function parseCliArgs(args) {
  const parsed = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--apk") parsed.apkPath = args[++index];
    else if (arg === "--build-start") parsed.buildStartedAt = args[++index];
    else fail(`argumento desconhecido: ${arg}`);
  }
  return parsed;
}

export function verifyDebugApk(options = {}) {
  const root = resolveRepositoryRoot(options.cwd || process.cwd());
  assertRevendaSmartRepository(root);
  const snapshot = getGitSnapshot(root);
  const apkPath = canonicalRequestedApk(root, options.apkPath);
  if (!existsSync(apkPath)) fail(`APK debug não encontrado em ${DEBUG_APK_RELATIVE_PATH}.`);
  const apkStat = statSync(apkPath);
  if (!apkStat.isFile() || apkStat.size === 0) fail("o APK debug está vazio ou não é um arquivo.");

  const temporaryDirectory = mkdtempSync(join(tmpdir(), "revendasmart-debug-apk-"));
  try {
    extractApk(apkPath, temporaryDirectory);
    const expectedWebRoot = join(temporaryDirectory, "assets", "public");
    const manifestFiles = walkFiles(temporaryDirectory).filter((file) => file.endsWith(BUILD_MANIFEST_FILE));
    if (manifestFiles.length !== 1 || manifestFiles[0] !== join(expectedWebRoot, BUILD_MANIFEST_FILE)) {
      fail(`o APK deve conter exatamente um ${BUILD_MANIFEST_FILE} em assets/public.`);
    }
    const applicationRoots = findApplicationWebRoots(temporaryDirectory);
    if (applicationRoots.length !== 1 || applicationRoots[0] !== expectedWebRoot) {
      fail("bundle da aplicação ausente ou duplicado dentro do APK.");
    }
    assertSingleApplicationBundle(expectedWebRoot);

    let manifest;
    try { manifest = JSON.parse(readFileSync(manifestFiles[0], "utf8")); }
    catch { fail(`${BUILD_MANIFEST_FILE} não contém JSON válido.`); }
    validateBuildManifest(manifest, snapshot);
    assertFirebaseConfigPresentInManifest(manifest);
    if (!isApkFresh(apkStat.mtimeMs, manifest.generatedAt, options.buildStartedAt || manifest.buildStartedAt)) {
      fail("o APK foi gerado antes do build web/sync atual.");
    }

    const packageInspection = inspectApkPackage(apkPath);
    if (packageInspection.packageName !== ANDROID_PACKAGE_NAME) {
      fail(`package do APK é ${packageInspection.packageName}; esperado ${ANDROID_PACKAGE_NAME}.`);
    }

    const bundleFiles = readableBundleFiles(expectedWebRoot);
    const filesOutsideManifest = bundleFiles.filter((file) => file !== manifestFiles[0]);
    if (markerLocations(filesOutsideManifest, snapshot.gitShortCommit).length === 0) {
      fail("o build ID interno do aplicativo não corresponde ao HEAD atual.");
    }
    for (const marker of REQUIRED_APK_MARKERS) {
      if (markerLocations(filesOutsideManifest, marker).length === 0) fail(`marcador obrigatório ausente no APK: ${marker}`);
    }
    for (const marker of FORBIDDEN_APK_MARKERS) {
      if (markerLocations(filesOutsideManifest, marker).length > 0) fail(`marcador legado encontrado no APK: ${marker}`);
    }

    const sourceHashes = buildDirectoryHashMap(resolve(root, ANDROID_WEB_DIR));
    const apkHashes = buildDirectoryHashMap(expectedWebRoot);
    const comparison = compareDirectoryHashMaps(sourceHashes, apkHashes);
    if (comparison.missing.length || comparison.unexpected.length || comparison.mismatched.length) {
      fail([
        "os assets web do APK divergem de android/app/src/main/assets/public.",
        comparison.missing.length ? `ausentes=${comparison.missing.join(",")}` : "",
        comparison.unexpected.length ? `inesperados=${comparison.unexpected.join(",")}` : "",
        comparison.mismatched.length ? `hash-divergente=${comparison.mismatched.join(",")}` : "",
      ].filter(Boolean).join(" "));
    }

    const apkSha256 = sha256File(apkPath);
    const report = {
      schemaVersion: 1,
      repository: repositoryLabel(root),
      branch: snapshot.branch,
      gitCommit: snapshot.gitCommit,
      gitShortCommit: snapshot.gitShortCommit,
      worktreeClean: snapshot.worktreeClean,
      worktreeStatus: snapshot.worktreeStatus.trim() ? snapshot.worktreeStatus.trimEnd().split(/\r?\n/) : [],
      worktreeFingerprint: snapshot.worktreeFingerprint,
      packageName: packageInspection.packageName,
      buildType: "debug",
      apkPath: DEBUG_APK_RELATIVE_PATH,
      apkSha256,
      sizeBytes: apkStat.size,
      apkModifiedAt: apkStat.mtime.toISOString(),
      buildGeneratedAt: manifest.generatedAt,
      verifiedAt: new Date().toISOString(),
      assetCount: apkHashes.size,
      assetsSha256: aggregateDirectoryHash(apkHashes),
    };
    writeFileSync(resolve(root, DEBUG_PROVENANCE_RELATIVE_PATH), `${JSON.stringify(report, null, 2)}\n`, "utf8");

    console.log("APK debug verificado com proveniência completa.");
    console.log(`Repositório: ${root}`);
    console.log(`Branch/HEAD: ${snapshot.branch} @ ${snapshot.gitShortCommit}`);
    console.log(`Worktree: ${snapshot.worktreeClean ? "limpo" : "com alterações registradas no manifesto"}`);
    if (!snapshot.worktreeClean) console.log(snapshot.worktreeStatus.trimEnd());
    console.log(`Package: ${packageInspection.packageName}`);
    console.log(`APK: ${DEBUG_APK_RELATIVE_PATH} (${formatBytes(apkStat.size)})`);
    console.log(`SHA-256: ${apkSha256}`);
    console.log(`Assets: ${apkHashes.size} arquivos, hashes idênticos ao sync Android`);
    console.log(`Proveniência: ${DEBUG_PROVENANCE_RELATIVE_PATH}`);
    return report;
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { verifyDebugApk(parseCliArgs(process.argv.slice(2))); }
  catch (error) {
    console.error(`Verificação do APK debug bloqueada: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
