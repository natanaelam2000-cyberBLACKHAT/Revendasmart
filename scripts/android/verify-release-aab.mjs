#!/usr/bin/env node
/**
 * RELEASE-08 — verificação do Android App Bundle de release, no mesmo espírito de rigor de
 * verify-debug-apk.mjs: nunca aceita "o Gradle disse que terminou" como prova — reabre o artefato e
 * confere estrutura, freshness e conteúdo.
 *
 * O .aab é um ZIP, mas o manifest dentro dele (base/manifest/AndroidManifest.xml) é um protobuf
 * binário que o `aapt` clássico não lê — só o `bundletool` da Google (não instalado neste ambiente,
 * fora do escopo desta tarefa baixar). Em vez disso: valida a ESTRUTURA do .aab diretamente (é só um
 * ZIP, extraído com `jar` como o APK), e valida package/versionCode/versionName/debuggable no APK
 * IRMÃO (`assembleRelease`, mesma signingConfig/buildType/versão) com o `aapt` já usado no APK debug.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  ANDROID_PACKAGE_NAME,
  ANDROID_WEB_DIR,
  BUILD_MANIFEST_FILE,
  RELEASE_AAB_RELATIVE_PATH,
  RELEASE_APK_RELATIVE_PATH,
  RELEASE_PROVENANCE_RELATIVE_PATH,
  aggregateDirectoryHash,
  assertRevendaSmartRepository,
  buildDirectoryHashMap,
  compareDirectoryHashMaps,
  extractZipArchive,
  getGitSnapshot,
  inspectApkBadging,
  repositoryLabel,
  resolveRepositoryRoot,
  sha256File,
  validateBuildManifest,
  walkFiles,
} from "./build-provenance.mjs";
import { REQUIRED_APK_MARKERS, FORBIDDEN_APK_MARKERS, isApkFresh, assertFirebaseConfigPresentInManifest } from "./verify-debug-apk.mjs";

function fail(message) { throw new Error(message); }
function formatBytes(value) { return `${(value / 1024 / 1024).toFixed(2)} MiB`; }

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
  const entries = walkFiles(join(webRoot, "assets")).filter((file) => /^index-[A-Za-z0-9_-]+\.js$/.test(basename(file)));
  if (entries.length !== 1) fail(`o bundle contém ${entries.length} entradas JavaScript da aplicação; esperado exatamente 1.`);
  const indexHtml = readFileSync(join(webRoot, "index.html"), "utf8");
  if (!indexHtml.includes(`assets/${basename(entries[0])}`)) fail("a entrada JavaScript única não é a referenciada pelo index.html.");
}

/** §8: presença dos diretórios/arquivos que só existem num Android App Bundle de verdade — nunca um
 * APK renomeado, nunca um ZIP arbitrário. */
function assertAabModuleStructure(extractedRoot) {
  const required = [
    "BundleConfig.pb",
    join("base", "manifest", "AndroidManifest.xml"),
    join("base", "resources.pb"),
  ];
  for (const relativePath of required) {
    if (!existsSync(join(extractedRoot, relativePath))) fail(`estrutura de AAB inválida: ${relativePath} ausente.`);
  }
  const dexFiles = walkFiles(join(extractedRoot, "base")).filter((file) => /\.dex$/i.test(file));
  if (dexFiles.length === 0) fail("estrutura de AAB inválida: nenhum classes*.dex em base/dex.");
  const resDir = join(extractedRoot, "base", "res");
  if (!existsSync(resDir) || walkFiles(resDir).length === 0) fail("estrutura de AAB inválida: base/res está ausente ou vazio.");
}

function parseCliArgs(args) {
  const parsed = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--build-start") parsed.buildStartedAt = args[++index];
    else fail(`argumento desconhecido: ${arg}`);
  }
  return parsed;
}

export function verifyReleaseAab(options = {}) {
  const root = resolveRepositoryRoot(options.cwd || process.cwd());
  assertRevendaSmartRepository(root);
  const snapshot = getGitSnapshot(root);

  const aabPath = resolve(root, RELEASE_AAB_RELATIVE_PATH);
  if (!existsSync(aabPath)) fail(`AAB de release não encontrado em ${RELEASE_AAB_RELATIVE_PATH}. Rode bundleRelease antes.`);
  const aabStat = statSync(aabPath);
  if (!aabStat.isFile() || aabStat.size === 0) fail("o AAB de release está vazio ou não é um arquivo.");

  const apkPath = resolve(root, RELEASE_APK_RELATIVE_PATH);
  if (!existsSync(apkPath)) fail(`APK irmão de release não encontrado em ${RELEASE_APK_RELATIVE_PATH}. Rode assembleRelease antes (mesma signingConfig do AAB).`);
  const apkStat = statSync(apkPath);
  if (!apkStat.isFile() || apkStat.size === 0) fail("o APK irmão de release está vazio ou não é um arquivo.");

  const temporaryDirectory = mkdtempSync(join(tmpdir(), "revendasmart-release-aab-"));
  try {
    // --- 1) Estrutura do próprio .aab (ZIP + módulo base válido) ---
    extractZipArchive(aabPath, temporaryDirectory);
    assertAabModuleStructure(temporaryDirectory);

    const expectedWebRoot = join(temporaryDirectory, "base", "assets", "public");
    const manifestFiles = walkFiles(temporaryDirectory).filter((file) => file.endsWith(BUILD_MANIFEST_FILE));
    if (manifestFiles.length !== 1 || manifestFiles[0] !== join(expectedWebRoot, BUILD_MANIFEST_FILE)) {
      fail(`o AAB deve conter exatamente um ${BUILD_MANIFEST_FILE} em base/assets/public.`);
    }
    const applicationRoots = findApplicationWebRoots(temporaryDirectory);
    if (applicationRoots.length !== 1 || applicationRoots[0] !== expectedWebRoot) {
      fail("bundle da aplicação web ausente ou duplicado dentro do AAB.");
    }
    assertSingleApplicationBundle(expectedWebRoot);

    let manifest;
    try { manifest = JSON.parse(readFileSync(manifestFiles[0], "utf8")); }
    catch { fail(`${BUILD_MANIFEST_FILE} não contém JSON válido.`); }
    validateBuildManifest(manifest, snapshot);
    assertFirebaseConfigPresentInManifest(manifest);
    if (!isApkFresh(aabStat.mtimeMs, manifest.generatedAt, options.buildStartedAt || manifest.buildStartedAt)) {
      fail("o AAB foi gerado antes do build web/sync atual.");
    }

    const bundleFiles = readableBundleFiles(expectedWebRoot);
    const filesOutsideManifest = bundleFiles.filter((file) => file !== manifestFiles[0]);
    if (markerLocations(filesOutsideManifest, snapshot.gitShortCommit).length === 0) {
      fail("o build ID interno do aplicativo não corresponde ao HEAD atual.");
    }
    for (const marker of REQUIRED_APK_MARKERS) {
      if (markerLocations(filesOutsideManifest, marker).length === 0) fail(`marcador obrigatório ausente no AAB: ${marker}`);
    }
    for (const marker of FORBIDDEN_APK_MARKERS) {
      if (markerLocations(filesOutsideManifest, marker).length > 0) fail(`marcador legado encontrado no AAB: ${marker}`);
    }

    const sourceHashes = buildDirectoryHashMap(resolve(root, ANDROID_WEB_DIR));
    const aabHashes = buildDirectoryHashMap(expectedWebRoot);
    const comparison = compareDirectoryHashMaps(sourceHashes, aabHashes);
    if (comparison.missing.length || comparison.unexpected.length || comparison.mismatched.length) {
      fail([
        "os assets web do AAB divergem de android/app/src/main/assets/public.",
        comparison.missing.length ? `ausentes=${comparison.missing.join(",")}` : "",
        comparison.unexpected.length ? `inesperados=${comparison.unexpected.join(",")}` : "",
        comparison.mismatched.length ? `hash-divergente=${comparison.mismatched.join(",")}` : "",
      ].filter(Boolean).join(" "));
    }

    // --- 2) Semântica (package/versionCode/versionName/debuggable) via o APK IRMÃO, mesma config ---
    const badging = inspectApkBadging(apkPath);
    if (badging.packageName !== ANDROID_PACKAGE_NAME) {
      fail(`package do APK irmão é ${badging.packageName}; esperado ${ANDROID_PACKAGE_NAME}.`);
    }
    if (badging.debuggable) {
      fail("o APK irmão de release está com android:debuggable=true — release nunca pode ser debuggable.");
    }
    const versionProps = readFileSync(resolve(root, "android/version.properties"), "utf8");
    const expectedVersionCode = versionProps.match(/^androidVersionCode=(.+)$/m)?.[1]?.trim();
    const expectedVersionName = versionProps.match(/^androidVersionName=(.+)$/m)?.[1]?.trim();
    if (!expectedVersionCode || badging.versionCode !== expectedVersionCode) {
      fail(`versionCode do APK irmão é '${badging.versionCode}'; esperado '${expectedVersionCode}' (android/version.properties).`);
    }
    if (!expectedVersionName || badging.versionName !== expectedVersionName) {
      fail(`versionName do APK irmão é '${badging.versionName}'; esperado '${expectedVersionName}' (android/version.properties).`);
    }

    // testOnly: aapt badging imprime "testOnly='1'" só quando android:testOnly="true" — nunca deve
    // aparecer num release de verdade (é uma flag que o próprio AGP usa para builds instrumentados).
    if (/testOnly='1'/.test(badging.rawOutput)) {
      fail("o APK irmão de release está marcado como testOnly — nunca pode ir para o Play Store assim.");
    }

    const aabSha256 = sha256File(aabPath);
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
      packageName: badging.packageName,
      versionCode: badging.versionCode,
      versionName: badging.versionName,
      debuggable: badging.debuggable,
      buildType: "release",
      aabPath: RELEASE_AAB_RELATIVE_PATH,
      aabSha256,
      aabSizeBytes: aabStat.size,
      siblingApkPath: RELEASE_APK_RELATIVE_PATH,
      siblingApkSha256: apkSha256,
      buildGeneratedAt: manifest.generatedAt,
      verifiedAt: new Date().toISOString(),
      assetCount: aabHashes.size,
      assetsSha256: aggregateDirectoryHash(aabHashes),
    };
    writeFileSync(resolve(root, RELEASE_PROVENANCE_RELATIVE_PATH), `${JSON.stringify(report, null, 2)}\n`, "utf8");

    console.log("AAB de release verificado com proveniência completa.");
    console.log(`Repositório: ${root}`);
    console.log(`Branch/HEAD: ${snapshot.branch} @ ${snapshot.gitShortCommit}`);
    console.log(`Worktree: ${snapshot.worktreeClean ? "limpo" : "com alterações registradas no manifesto"}`);
    console.log(`Package: ${badging.packageName}`);
    console.log(`versionCode/versionName: ${badging.versionCode} / ${badging.versionName}`);
    console.log(`debuggable: ${badging.debuggable}`);
    console.log(`AAB: ${RELEASE_AAB_RELATIVE_PATH} (${formatBytes(aabStat.size)})`);
    console.log(`SHA-256 (AAB): ${aabSha256}`);
    console.log(`SHA-256 (APK irmão): ${apkSha256}`);
    console.log(`Assets: ${aabHashes.size} arquivos, hashes idênticos ao sync Android`);
    console.log(`Proveniência: ${RELEASE_PROVENANCE_RELATIVE_PATH}`);
    return report;
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { verifyReleaseAab(parseCliArgs(process.argv.slice(2))); }
  catch (error) {
    console.error(`Verificação do AAB de release bloqueada: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
