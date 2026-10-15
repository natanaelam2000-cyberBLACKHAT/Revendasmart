#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import process from "node:process";
import zlib from "node:zlib";

const root = process.cwd();
const distDir = path.join(root, "dist", "public");
const assetsDir = path.join(distDir, "assets");
const viteDir = path.join(distDir, ".vite");
const manifestPath = path.join(viteDir, "manifest.json");
const lockfilePath = path.join(root, "package-lock.json");
const outputPath = path.join(viteDir, "bundle-diagnostics.json");

function requireFile(filePath, label) {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    throw new Error(`${label} não encontrado: ${path.relative(root, filePath)}`);
  }
}

requireFile(manifestPath, "Manifest Vite");
requireFile(lockfilePath, "package-lock.json");
if (!fs.existsSync(assetsDir) || !fs.statSync(assetsDir).isDirectory()) {
  throw new Error(`Diretório de assets não encontrado: ${path.relative(root, assetsDir)}`);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const testedSha = process.env.GITHUB_SHA || execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const lockSha256 = crypto.createHash("sha256").update(fs.readFileSync(lockfilePath)).digest("hex");

function walkFiles(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walkFiles(filePath));
    else if (entry.isFile()) files.push(filePath);
  }
  return files;
}

function logicalName(key, entry) {
  if (typeof entry?.name === "string" && entry.name) return entry.name;
  if (typeof entry?.src === "string" && entry.src) return path.basename(entry.src).replace(/\.[^.]+$/, "");
  return path.basename(key).replace(/\.[^.]+$/, "").replace(/-[A-Za-z0-9_-]{8}$/, "");
}

const assetFiles = walkFiles(assetsDir).map((filePath) => {
  const relative = path.relative(distDir, filePath).replaceAll(path.sep, "/");
  const bytes = fs.readFileSync(filePath);
  return {
    file: relative,
    extension: path.extname(filePath).slice(1),
    rawBytes: bytes.length,
    gzipBytes: zlib.gzipSync(bytes).length,
  };
});
const assetByFile = new Map(assetFiles.map((asset) => [asset.file, asset]));

const manifestEntries = Object.entries(manifest).map(([key, entry]) => ({
  key,
  file: entry.file || null,
  name: logicalName(key, entry),
  src: entry.src || null,
  imports: Array.isArray(entry.imports) ? entry.imports : [],
  dynamicImports: Array.isArray(entry.dynamicImports) ? entry.dynamicImports : [],
}));
const logicalNamesByFile = new Map();
for (const entry of manifestEntries) {
  if (!entry.file) continue;
  const names = logicalNamesByFile.get(entry.file) || [];
  names.push(entry.name);
  logicalNamesByFile.set(entry.file, names);
}
for (const asset of assetFiles) {
  asset.logicalNames = logicalNamesByFile.get(asset.file) || [];
}

const bootKeys = new Set();
const bootFiles = new Set();
function visitBoot(key) {
  if (bootKeys.has(key)) return;
  bootKeys.add(key);
  const entry = manifest[key];
  if (!entry) return;
  if (entry.file) bootFiles.add(entry.file);
  for (const imported of entry.imports || []) visitBoot(imported);
}
visitBoot("index.html");

const routeNames = new Set(["marketing", "dashboard", "onboarding"]);
const classifications = manifestEntries.map((entry) => {
  const vendor = entry.name.startsWith("vendor-");
  const route = !vendor && (entry.src?.includes("/pages/") || routeNames.has(entry.name));
  const boot = bootFiles.has(entry.file);
  const category = vendor ? "vendor" : route ? "route-lazy" : boot ? "boot" : "shared";
  return { key: entry.key, file: entry.file, name: entry.name, category, isInitialBoot: boot };
});

const manifestFiles = new Set(manifestEntries.map((entry) => entry.file).filter(Boolean));
const emittedFiles = new Set(assetFiles.map((asset) => asset.file));
const manifestMissingAssets = [...manifestFiles].filter((file) => !emittedFiles.has(file));
const emittedNotInManifest = [...emittedFiles].filter((file) => !manifestFiles.has(file));
if (manifestMissingAssets.length > 0) {
  throw new Error(`Manifest referencia assets ausentes: ${manifestMissingAssets.join(", ")}`);
}

const jsAssets = assetFiles.filter((asset) => asset.extension === "js");
const cssAssets = assetFiles.filter((asset) => asset.extension === "css");
const sum = (items, field) => items.reduce((total, item) => total + item[field], 0);
const principalCss = cssAssets.filter((asset) => /^index-.*\.css$/.test(path.basename(asset.file)));
const onboarding = classifications.find((entry) => entry.name === "onboarding" || entry.key.includes("onboarding"));
const onboardingAsset = onboarding?.file ? assetByFile.get(onboarding.file) : null;

const report = {
  schemaVersion: 1,
  testedCommit: testedSha,
  nodeVersion: process.version,
  packageLockSha256: lockSha256,
  manifest,
  assets: assetFiles,
  manifestEntries,
  classifications,
  importGraph: manifestEntries.map(({ key, file, imports, dynamicImports }) => ({ key, file, imports, dynamicImports })),
  totals: {
    jsRawBytes: sum(jsAssets, "rawBytes"),
    jsGzipBytes: sum(jsAssets, "gzipBytes"),
    cssRawBytes: sum(cssAssets, "rawBytes"),
    cssGzipBytes: sum(cssAssets, "gzipBytes"),
  },
  principalCss: principalCss.map((asset) => asset.file),
  onboarding: onboardingAsset || null,
  consistency: {
    manifestMissingAssets,
    emittedNotInManifest,
    manifestAssetCount: manifestFiles.size,
    emittedAssetCount: emittedFiles.size,
    ok: manifestMissingAssets.length === 0,
  },
};

fs.mkdirSync(viteDir, { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(`Bundle evidence written to ${path.relative(root, outputPath)}`);
