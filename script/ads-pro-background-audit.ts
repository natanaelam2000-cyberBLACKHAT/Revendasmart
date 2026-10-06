/**
 * ADS-PRO-FINAL — CLI da auditoria da biblioteca de fundos.
 *
 *   tsx script/ads-pro-background-audit.ts [--source <dir>] [--report-dir <dir>] [--write]
 *        [--min-short-side 600] [--dhash-distance 5]
 *
 * Lê o acervo BRUTO (`source-assets/ads-pro-backgrounds/images/` + `inventory.json`), nunca o altera nem
 * apaga, e imprime o resumo em chaves `CHAVE=valor`. Com `--write` publica, para os fundos APROVADOS:
 *   - `client/public/ads-pro/backgrounds/<id>.webp` (+ `thumbs/<id>.webp`)
 *   - `shared/ads-pro/approved-static-backgrounds.ts` (manifest de produção, separado do inventário bruto)
 *   - `docs/ads-pro/background-audit/{report.json,REPORT.md}`
 * Sem `--write` é somente leitura (dry-run) e escreve apenas o relatório quando `--report-dir` é passado.
 *
 * Curadoria manual opcional: `source-assets/ads-pro-backgrounds/curation.json`
 *   { "pasta/arquivo.jpg": { "reject": true, "reason": "tem produto" }, "outra.jpg": { "bucket": "doces", "style": "luxury" } }
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import {
  AUDIT_BUCKETS,
  AUDIT_BUCKET_LABELS,
  DEFAULT_AUDIT_OPTIONS,
  aHashFromGray8x8,
  auditBackgrounds,
  dHashFromGray9x8,
  sampleColorStats,
  type AuditBucket,
  type AuditOptions,
  type AuditResult,
  type BackgroundFileFacts,
  type CurationOverrides,
} from "../shared/ads-pro/background-audit";
import type { ApprovedStaticBackgroundEntry } from "../shared/ads-pro/static-background-entry";

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".avif", ".gif", ".bmp", ".tif", ".tiff", ".heic", ".heif"]);
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export interface LoadedSource {
  readonly files: readonly { readonly relativePath: string; readonly absolutePath: string }[];
  readonly inventoryEntries: number;
  readonly inventoryHints: ReadonlyMap<string, readonly string[]>;
  readonly inventoryMissingFiles: readonly string[];
  readonly filesNotInInventory: readonly string[];
}

function toPosix(value: string): string {
  return value.replace(/\\/g, "/");
}

function walkImages(root: string): string[] {
  if (!existsSync(root)) return [];
  const found: string[] = [];
  const visit = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const full = join(directory, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile()) {
        const lower = entry.name.toLowerCase();
        const dot = lower.lastIndexOf(".");
        if (dot >= 0 && IMAGE_EXTENSIONS.has(lower.slice(dot))) found.push(full);
      }
    }
  };
  visit(root);
  return found.sort();
}

const PATH_KEYS = ["relativePath", "path", "file", "filename", "fileName", "name", "src", "image"];

/** Leitura TOLERANTE do inventário bruto: array, ou objeto com images/files/items/assets; campos de texto viram dicas. */
export function parseInventory(raw: unknown): { entries: { path: string; hints: string[] }[] } {
  const list: unknown[] = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object"
      ? ((["images", "files", "items", "assets", "entries"] as const).map((key) => (raw as Record<string, unknown>)[key]).find(Array.isArray) as unknown[] | undefined) ?? []
      : [];
  const entries: { path: string; hints: string[] }[] = [];
  for (const item of list) {
    if (typeof item === "string") {
      entries.push({ path: toPosix(item), hints: [item] });
      continue;
    }
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const pathKey = PATH_KEYS.find((key) => typeof record[key] === "string");
    if (!pathKey) continue;
    const hints: string[] = [];
    for (const value of Object.values(record)) {
      if (typeof value === "string") hints.push(value);
      else if (Array.isArray(value)) for (const inner of value) if (typeof inner === "string") hints.push(inner);
    }
    entries.push({ path: toPosix(record[pathKey] as string), hints });
  }
  return { entries };
}

export function loadSource(sourceDir: string): LoadedSource {
  const imagesDir = join(sourceDir, "images");
  const absolutePaths = walkImages(imagesDir);
  const files = absolutePaths.map((absolutePath) => ({ absolutePath, relativePath: toPosix(relative(imagesDir, absolutePath)) }));

  const inventoryPath = join(sourceDir, "inventory.json");
  const hintsByKey = new Map<string, string[]>();
  let inventoryEntries = 0;
  const inventoryMissingFiles: string[] = [];
  if (existsSync(inventoryPath)) {
    try {
      const parsed = parseInventory(JSON.parse(readFileSync(inventoryPath, "utf8")));
      inventoryEntries = parsed.entries.length;
      const byLowerPath = new Map(files.map((file) => [file.relativePath.toLowerCase(), file.relativePath] as const));
      const byBase = new Map<string, string[]>();
      for (const file of files) {
        const key = basename(file.relativePath).toLowerCase();
        byBase.set(key, [...(byBase.get(key) ?? []), file.relativePath]);
      }
      for (const entry of parsed.entries) {
        const normalized = entry.path.replace(/^\.?\/?(source-assets\/ads-pro-backgrounds\/)?(images\/)?/i, "").toLowerCase();
        let target = byLowerPath.get(normalized);
        if (!target) {
          const candidates = byBase.get(basename(normalized));
          if (candidates && candidates.length === 1) target = candidates[0];
        }
        if (!target) { inventoryMissingFiles.push(entry.path); continue; }
        hintsByKey.set(target, [...(hintsByKey.get(target) ?? []), ...entry.hints]);
      }
    } catch {
      // inventário ilegível não bloqueia a auditoria: o diretório de imagens é a verdade.
    }
  }
  const inInventory = new Set(hintsByKey.keys());
  return {
    files,
    inventoryEntries,
    inventoryHints: hintsByKey,
    inventoryMissingFiles,
    filesNotInInventory: inventoryEntries > 0 ? files.map((file) => file.relativePath).filter((path) => !inInventory.has(path)) : [],
  };
}

async function extractFacts(file: { relativePath: string; absolutePath: string }, inventoryHints: readonly string[]): Promise<BackgroundFileFacts> {
  const bytes = readFileSync(file.absolutePath);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const folderHints = toPosix(file.relativePath).split("/");
  const hints = [...folderHints, ...inventoryHints];
  const base = { relativePath: file.relativePath, bytes: bytes.length, sha256, hints } as const;
  if (bytes.length === 0) return { ...base, width: 0, height: 0, format: "unknown", hasAlpha: false, decodeOk: false, decodeError: "empty" };
  try {
    const pipeline = () => sharp(bytes, { failOn: "error", limitInputPixels: 120_000_000 }).rotate();
    const metadata = await sharp(bytes, { failOn: "error", limitInputPixels: 120_000_000 }).metadata();
    const swap = (metadata.orientation ?? 1) >= 5;
    const width = (swap ? metadata.height : metadata.width) ?? 0;
    const height = (swap ? metadata.width : metadata.height) ?? 0;
    // Decodifica de verdade (detecta truncamento): as amostras pequenas abaixo forçam a leitura completa.
    const rgb = await pipeline().flatten({ background: "#ffffff" }).resize(32, 40, { fit: "fill" }).removeAlpha().raw().toBuffer();
    const gray9x8 = await pipeline().flatten({ background: "#ffffff" }).greyscale().resize(9, 8, { fit: "fill" }).raw().toBuffer();
    const gray8x8 = await pipeline().flatten({ background: "#ffffff" }).greyscale().resize(8, 8, { fit: "fill" }).raw().toBuffer();
    return {
      ...base,
      width,
      height,
      format: metadata.format ?? "unknown",
      hasAlpha: Boolean(metadata.hasAlpha),
      decodeOk: width > 0 && height > 0,
      dHash: dHashFromGray9x8(gray9x8),
      aHash: aHashFromGray8x8(gray8x8),
      color: sampleColorStats(rgb, 32, 40),
    };
  } catch (error) {
    return { ...base, width: 0, height: 0, format: "unknown", hasAlpha: false, decodeOk: false, decodeError: error instanceof Error ? error.message.slice(0, 160) : "decode-failed" };
  }
}

export async function collectFacts(source: LoadedSource): Promise<BackgroundFileFacts[]> {
  const facts: BackgroundFileFacts[] = [];
  for (const file of source.files) facts.push(await extractFacts(file, source.inventoryHints.get(file.relativePath) ?? []));
  return facts;
}

export function readCuration(sourceDir: string): CurationOverrides {
  const path = join(sourceDir, "curation.json");
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    const result: Record<string, CurationOverrides[string]> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (!value || typeof value !== "object") continue;
      const record = value as Record<string, unknown>;
      result[toPosix(key)] = {
        ...(record.reject === true ? { reject: true } : {}),
        ...(typeof record.reason === "string" ? { reason: record.reason } : {}),
        ...(typeof record.bucket === "string" && (AUDIT_BUCKETS as readonly string[]).includes(record.bucket) ? { bucket: record.bucket as AuditBucket } : {}),
        ...(typeof record.style === "string" && ["luxury", "editorial", "minimal", "sensory", "modern"].includes(record.style) ? { style: record.style as "luxury" } : {}),
      };
    }
    return result;
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------------------------
// Publicação dos aprovados
// ---------------------------------------------------------------------------------------------

const OPTIMIZED_MAX_SIDE = 1350;
const THUMB_WIDTH = 200;

export async function publishApproved(
  source: LoadedSource,
  result: AuditResult,
  outputs: { readonly publicDir: string; readonly manifestPath: string },
): Promise<ApprovedStaticBackgroundEntry[]> {
  const absoluteByRelative = new Map(source.files.map((file) => [file.relativePath, file.absolutePath] as const));
  mkdirSync(join(outputs.publicDir, "thumbs"), { recursive: true });
  const entries: ApprovedStaticBackgroundEntry[] = [];
  const usedIds = new Set<string>();
  for (const decision of result.approved) {
    if (usedIds.has(decision.id)) throw new Error(`Id de fundo duplicado no manifest: ${decision.id}`);
    usedIds.add(decision.id);
    const absolute = absoluteByRelative.get(decision.relativePath) as string;
    const optimized = await sharp(readFileSync(absolute), { failOn: "error" })
      .rotate()
      .flatten({ background: "#ffffff" })
      .resize({ width: OPTIMIZED_MAX_SIDE, height: OPTIMIZED_MAX_SIDE, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 76, effort: 4 })
      .toBuffer({ resolveWithObject: true });
    writeFileSync(join(outputs.publicDir, `${decision.id}.webp`), optimized.data);
    const thumb = await sharp(optimized.data).resize({ width: THUMB_WIDTH, height: Math.round(THUMB_WIDTH * 1.25), fit: "cover" }).webp({ quality: 62, effort: 4 }).toBuffer();
    writeFileSync(join(outputs.publicDir, "thumbs", `${decision.id}.webp`), thumb);
    entries.push({
      id: decision.id,
      bucket: decision.bucket,
      category: decision.category,
      style: decision.style,
      luminance: decision.luminance,
      needsScrim: decision.needsScrim,
      width: optimized.info.width,
      height: optimized.info.height,
    });
  }
  entries.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const version = `1.${entries.length}.0`;
  const body = entries.map((entry) => `  ${JSON.stringify(entry)},`).join("\n");
  writeFileSync(
    outputs.manifestPath,
    `/**
 * GERADO por \`script/ads-pro-background-audit.ts --write\` — NÃO edite à mão.
 *
 * Fundos ESTÁTICOS aprovados pela auditoria do acervo bruto (\`source-assets/ads-pro-backgrounds/\`).
 * ${entries.length} fundos aprovados. O matcher do Ads Pro só enxerga o que está nesta lista.
 */
import type { ApprovedStaticBackgroundEntry } from "./static-background-entry";

export const ADS_PRO_APPROVED_STATIC_BACKGROUNDS_VERSION = ${JSON.stringify(version)} as const;

export const ADS_PRO_APPROVED_STATIC_BACKGROUNDS: readonly ApprovedStaticBackgroundEntry[] = [
${body}
];
`,
  );
  return entries;
}

export function renderMarkdownReport(source: LoadedSource, result: AuditResult): string {
  const s = result.summary;
  const lines: string[] = [];
  lines.push("# Auditoria da biblioteca de fundos — Ads Pro", "");
  lines.push("Gerado por `script/ads-pro-background-audit.ts`. O acervo bruto não é alterado.", "");
  lines.push("## Resumo", "", "| Métrica | Valor |", "|---|---|");
  lines.push(`| SOURCE_BACKGROUND_COUNT | ${s.SOURCE_BACKGROUND_COUNT} |`);
  lines.push(`| EXACT_DUPLICATES | ${s.EXACT_DUPLICATES} |`);
  lines.push(`| VISUAL_DUPLICATES | ${s.VISUAL_DUPLICATES} |`);
  lines.push(`| CORRUPTED_FILES | ${s.CORRUPTED_FILES} |`);
  lines.push(`| VALID_BACKGROUNDS | ${s.VALID_BACKGROUNDS} |`);
  lines.push(`| REJECTED_BACKGROUNDS | ${s.REJECTED_BACKGROUNDS} |`);
  lines.push(`| Entradas no inventory.json | ${source.inventoryEntries} |`);
  lines.push(`| Inventário apontando para arquivo inexistente | ${source.inventoryMissingFiles.length} |`);
  lines.push(`| Arquivos fora do inventário | ${source.filesNotInInventory.length} |`);
  lines.push("", "## Válidos por categoria", "", "| Categoria | Quantidade |", "|---|---|");
  for (const bucket of AUDIT_BUCKETS) lines.push(`| ${AUDIT_BUCKET_LABELS[bucket]} | ${s.byBucket[bucket]} |`);
  lines.push("", `Aprovados sem dica de categoria (caíram em geral/outros por falta de evidência): ${s.unclassifiedApproved}.`);
  lines.push("", "## Rejeitados por motivo", "", "| Motivo | Quantidade |", "|---|---|");
  for (const [reason, count] of Object.entries(s.rejectedByReason)) lines.push(`| ${reason} | ${count} |`);
  if (result.rejected.length > 0) {
    lines.push("", "## Lista de rejeitados", "", "| Arquivo | Motivo | Detalhe |", "|---|---|---|");
    for (const decision of result.rejected) lines.push(`| ${decision.relativePath} | ${decision.rejection!.reason} | ${decision.rejection!.detail.replace(/\|/g, "/")} |`);
  }
  lines.push("");
  return lines.join("\n");
}

export function printSummary(result: AuditResult): void {
  const s = result.summary;
  console.log(`SOURCE_BACKGROUND_COUNT=${s.SOURCE_BACKGROUND_COUNT}`);
  console.log(`EXACT_DUPLICATES=${s.EXACT_DUPLICATES}`);
  console.log(`VISUAL_DUPLICATES=${s.VISUAL_DUPLICATES}`);
  console.log(`CORRUPTED_FILES=${s.CORRUPTED_FILES}`);
  console.log(`VALID_BACKGROUNDS=${s.VALID_BACKGROUNDS}`);
  console.log(`REJECTED_BACKGROUNDS=${s.REJECTED_BACKGROUNDS}`);
  for (const bucket of AUDIT_BUCKETS) console.log(`VALID_${bucket.toUpperCase().replace(/-/g, "_")}=${s.byBucket[bucket]}`);
  console.log(`VALID_UNCLASSIFIED_FALLBACK_GERAL=${s.unclassifiedApproved}`);
}

function parseArgs(argv: readonly string[]): { source: string; reportDir?: string; write: boolean; options: Partial<AuditOptions> } {
  const args = { source: join(REPO_ROOT, "source-assets", "ads-pro-backgrounds"), reportDir: undefined as string | undefined, write: false, options: {} as Partial<AuditOptions> };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--write") args.write = true;
    else if (arg === "--source") args.source = resolve(argv[++i]);
    else if (arg === "--report-dir") args.reportDir = resolve(argv[++i]);
    else if (arg === "--min-short-side") args.options = { ...args.options, minShortSide: Number(argv[++i]) };
    else if (arg === "--dhash-distance") args.options = { ...args.options, maxDHashDistance: Number(argv[++i]) };
    else throw new Error(`Argumento desconhecido: ${arg}`);
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const source = loadSource(args.source);
  if (source.files.length === 0) {
    console.log("SOURCE_BACKGROUND_COUNT=0");
    console.log(`SOURCE_FOLDER_MISSING_OR_EMPTY=${toPosix(relative(REPO_ROOT, join(args.source, "images")))}`);
    process.exitCode = 2;
    return;
  }
  const facts = await collectFacts(source);
  const result = auditBackgrounds(facts, { ...DEFAULT_AUDIT_OPTIONS, ...args.options }, readCuration(args.source));
  printSummary(result);

  const reportDir = args.reportDir ?? (args.write ? join(REPO_ROOT, "docs", "ads-pro", "background-audit") : undefined);
  if (reportDir) {
    mkdirSync(reportDir, { recursive: true });
    writeFileSync(join(reportDir, "report.json"), `${JSON.stringify({ summary: result.summary, exactDuplicateGroups: result.exactDuplicateGroups, visualDuplicateGroups: result.visualDuplicateGroups, decisions: result.decisions }, null, 2)}\n`);
    writeFileSync(join(reportDir, "REPORT.md"), renderMarkdownReport(source, result));
  }
  if (args.write) {
    const entries = await publishApproved(source, result, {
      publicDir: join(REPO_ROOT, "client", "public", "ads-pro", "backgrounds"),
      manifestPath: join(REPO_ROOT, "shared", "ads-pro", "approved-static-backgrounds.ts"),
    });
    console.log(`PUBLISHED_STATIC_BACKGROUNDS=${entries.length}`);
  }
}

if (process.argv[1] && /ads-pro-background-audit\.(ts|js|mjs|cjs)$/.test(process.argv[1])) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
