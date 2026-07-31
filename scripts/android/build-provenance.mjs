#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readlinkSync, readdirSync } from "node:fs";
import { basename, join, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";

export const ANDROID_PACKAGE_NAME = "com.revendasmart.app";
export const ANDROID_BUILD_TYPE = "debug";
export const ANDROID_WEB_DIR = "android/app/src/main/assets/public";
export const WEB_BUILD_DIR = "dist/public";
export const BUILD_MANIFEST_FILE = "build-manifest.json";
export const DEBUG_APK_RELATIVE_PATH = "android/app/build/outputs/apk/debug/app-debug.apk";
export const DEBUG_PROVENANCE_RELATIVE_PATH = "android/app/build/outputs/apk/debug/app-debug.provenance.json";

function runGit(args, cwd, encoding = "utf8") {
  const result = spawnSync("git", args, { cwd, encoding, shell: false, maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || "").trim();
    throw new Error(`git ${args.join(" ")} falhou${detail ? `: ${detail}` : "."}`);
  }
  return result.stdout;
}

export function resolveRepositoryRoot(startDirectory = process.cwd()) {
  const result = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd: startDirectory, encoding: "utf8", shell: false });
  if (result.status !== 0) throw new Error("o diretório atual não pertence a um repositório Git.");
  const root = String(result.stdout || "").trim();
  if (!root) throw new Error("não foi possível determinar a raiz Git.");
  return resolve(root);
}

export function assertRevendaSmartRepository(root) {
  for (const file of ["package.json", "capacitor.config.ts", "android/app/build.gradle"]) {
    if (!existsSync(join(root, file))) throw new Error(`repositório inválido: ${file} não foi encontrado.`);
  }
  const capacitorConfig = readFileSync(join(root, "capacitor.config.ts"), "utf8");
  const androidBuild = readFileSync(join(root, "android/app/build.gradle"), "utf8");
  if (!capacitorConfig.includes(`appId: "${ANDROID_PACKAGE_NAME}"`)) {
    throw new Error(`repositório inválido: capacitor.config.ts não declara ${ANDROID_PACKAGE_NAME}.`);
  }
  if (!androidBuild.includes(`applicationId "${ANDROID_PACKAGE_NAME}"`)) {
    throw new Error(`repositório inválido: applicationId Android não é ${ANDROID_PACKAGE_NAME}.`);
  }
}

function hashUntrackedFile(hash, root, file) {
  const absolutePath = join(root, file);
  const stat = lstatSync(absolutePath);
  hash.update("\0untracked\0");
  hash.update(file);
  hash.update("\0");
  if (stat.isSymbolicLink()) hash.update(readlinkSync(absolutePath));
  else if (stat.isFile()) hash.update(readFileSync(absolutePath));
}

export function getGitSnapshot(root = resolveRepositoryRoot()) {
  assertRevendaSmartRepository(root);
  const gitCommit = String(runGit(["rev-parse", "HEAD"], root)).trim();
  if (!/^[a-f0-9]{40}$/i.test(gitCommit)) throw new Error("HEAD Git inválido.");
  const branchResult = spawnSync("git", ["branch", "--show-current"], { cwd: root, encoding: "utf8", shell: false });
  if (branchResult.status !== 0) throw new Error("não foi possível determinar a branch atual.");
  const branch = String(branchResult.stdout || "").trim() || "DETACHED";
  const status = String(runGit(["status", "--porcelain=v1", "--untracked-files=all"], root));
  const fingerprint = createHash("sha256");
  fingerprint.update(`commit\0${gitCommit}\0`);
  const diff = runGit(["diff", "--binary", "HEAD", "--", "."], root, null);
  fingerprint.update(Buffer.isBuffer(diff) ? diff : Buffer.from(diff || ""));
  const untrackedOutput = runGit(["ls-files", "--others", "--exclude-standard", "-z"], root, null);
  const untrackedFiles = Buffer.from(untrackedOutput || "").toString("utf8").split("\0").filter(Boolean).sort();
  for (const file of untrackedFiles) hashUntrackedFile(fingerprint, root, file);
  return {
    root,
    branch,
    gitCommit,
    gitShortCommit: gitCommit.slice(0, 12),
    worktreeClean: status.length === 0,
    worktreeStatus: status,
    worktreeFingerprint: fingerprint.digest("hex"),
  };
}

export function createBuildManifest(snapshot, options = {}) {
  const generatedAt = options.generatedAt || new Date().toISOString();
  const buildStartedAt = options.buildStartedAt || generatedAt;
  return {
    schemaVersion: 1,
    gitCommit: snapshot.gitCommit,
    gitShortCommit: snapshot.gitShortCommit,
    branch: snapshot.branch,
    generatedAt,
    buildStartedAt,
    packageName: ANDROID_PACKAGE_NAME,
    buildType: ANDROID_BUILD_TYPE,
    firebaseConfigPresent: options.firebaseConfigPresent === true,
    worktreeClean: snapshot.worktreeClean,
    worktreeFingerprint: snapshot.worktreeFingerprint,
  };
}

export function validateBuildManifest(manifest, expected = {}) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) throw new Error("build-manifest.json não contém um objeto JSON válido.");
  if (manifest.schemaVersion !== 1) throw new Error("schemaVersion do build-manifest.json não é suportado.");
  if (!/^[a-f0-9]{40}$/i.test(String(manifest.gitCommit || ""))) throw new Error("gitCommit do manifesto é inválido.");
  if (!/^[a-f0-9]{7,40}$/i.test(String(manifest.gitShortCommit || ""))) throw new Error("gitShortCommit do manifesto é inválido.");
  if (!manifest.gitCommit.startsWith(manifest.gitShortCommit)) throw new Error("gitShortCommit não corresponde ao gitCommit.");
  if (!String(manifest.branch || "").trim()) throw new Error("branch ausente no manifesto.");
  if (!Number.isFinite(Date.parse(String(manifest.generatedAt || "")))) throw new Error("generatedAt inválido no manifesto.");
  if (!Number.isFinite(Date.parse(String(manifest.buildStartedAt || "")))) throw new Error("buildStartedAt inválido no manifesto.");
  if (manifest.packageName !== ANDROID_PACKAGE_NAME) throw new Error(`packageName do manifesto não é ${ANDROID_PACKAGE_NAME}.`);
  if (manifest.buildType !== ANDROID_BUILD_TYPE) throw new Error("o manifesto não pertence a um build debug.");
  if (!/^[a-f0-9]{64}$/i.test(String(manifest.worktreeFingerprint || ""))) throw new Error("worktreeFingerprint ausente ou inválido no manifesto.");
  if (typeof manifest.firebaseConfigPresent !== "boolean") throw new Error("firebaseConfigPresent ausente no manifesto.");
  if (typeof manifest.worktreeClean !== "boolean") throw new Error("worktreeClean ausente no manifesto.");
  for (const field of ["gitCommit", "gitShortCommit", "branch", "worktreeFingerprint"]) {
    if (expected[field] !== undefined && manifest[field] !== expected[field]) throw new Error(`${field} do manifesto não corresponde ao estado atual.`);
  }
  return manifest;
}

export function walkFiles(root) {
  const files = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...walkFiles(path));
    else if (entry.isFile()) files.push(path);
  }
  return files.sort();
}

export function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function portableRelative(root, file) {
  return relative(root, file).split(sep).join("/");
}

export function buildDirectoryHashMap(root) {
  if (!existsSync(root)) throw new Error(`diretório de assets não encontrado: ${root}`);
  return new Map(walkFiles(root).map((file) => [portableRelative(root, file), sha256File(file)]));
}

export function compareDirectoryHashMaps(expected, actual) {
  const missing = [], unexpected = [], mismatched = [];
  for (const [file, hash] of expected) {
    if (!actual.has(file)) missing.push(file);
    else if (actual.get(file) !== hash) mismatched.push(file);
  }
  for (const file of actual.keys()) if (!expected.has(file)) unexpected.push(file);
  return { missing: missing.sort(), unexpected: unexpected.sort(), mismatched: mismatched.sort() };
}

export function aggregateDirectoryHash(hashMap) {
  const hash = createHash("sha256");
  for (const [file, fileHash] of [...hashMap.entries()].sort(([a], [b]) => a.localeCompare(b))) hash.update(`${file}\0${fileHash}\n`);
  return hash.digest("hex");
}

export function repositoryLabel(root) {
  return basename(root);
}
