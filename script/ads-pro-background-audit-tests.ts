/**
 * ADS-PRO-FINAL — testes da auditoria de fundos (pura + CLI) com imagens SINTÉTICAS geradas no teste.
 * O acervo real de 309 imagens não é necessário aqui: o que se prova é o pipeline (contagens, duplicatas,
 * corrompidos, classificação, curadoria manual, publicação e NÃO-destrutividade do acervo bruto).
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import sharp from "sharp";
import {
  AUDIT_BUCKETS,
  AUDIT_BUCKET_TO_CATEGORY,
  aHashFromGray8x8,
  auditBackgrounds,
  buildBackgroundId,
  classifyBucket,
  classifyStyleHint,
  dHashFromGray9x8,
  hammingDistanceHex,
  sampleColorStats,
  tokenizeHints,
  type AuditDecision,
} from "../shared/ads-pro/background-audit";
import { collectFacts, loadSource, parseInventory, publishApproved, readCuration, renderMarkdownReport } from "./ads-pro-background-audit";

let checks = 0;
function check(name: string, run: () => void | Promise<void>): Promise<void> {
  return Promise.resolve(run()).then(() => { checks += 1; console.log(`PASS ${name}`); });
}

type Rgb = readonly [number, number, number];

function gradient(width: number, height: number, from: Rgb, to: Rgb, angleDeg: number): Buffer {
  const out = Buffer.alloc(width * height * 3);
  const rad = (angleDeg * Math.PI) / 180;
  const dx = Math.sin(rad); const dy = -Math.cos(rad);
  const span = Math.abs(width * dx) + Math.abs(height * dy) || 1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const t = Math.min(1, Math.max(0, ((x - width / 2) * dx + (y - height / 2) * dy) / span + 0.5));
      const o = (y * width + x) * 3;
      out[o] = Math.round(from[0] + (to[0] - from[0]) * t);
      out[o + 1] = Math.round(from[1] + (to[1] - from[1]) * t);
      out[o + 2] = Math.round(from[2] + (to[2] - from[2]) * t);
    }
  }
  return out;
}

async function jpeg(width: number, height: number, from: Rgb, to: Rgb, angle: number): Promise<Buffer> {
  return sharp(gradient(width, height, from, to, angle), { raw: { width, height, channels: 3 } }).jpeg({ quality: 90 }).toBuffer();
}
async function png(width: number, height: number, from: Rgb, to: Rgb, angle: number): Promise<Buffer> {
  return sharp(gradient(width, height, from, to, angle), { raw: { width, height, channels: 3 } }).png().toBuffer();
}

function sha(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}
function listAll(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...listAll(full)); else found.push(full);
  }
  return found.sort();
}

async function buildSyntheticSource(root: string): Promise<{ expectedValid: number; total: number }> {
  const images = join(root, "images");
  const put = (relative: string, data: Buffer) => {
    const full = join(images, relative);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, data);
  };
  const bolo = await jpeg(1080, 1350, [250, 205, 220], [240, 150, 185], 160);
  put("Doces/bolo-rosa.jpg", bolo);
  put("Doces/bolo-rosa-copia.jpg", bolo); // duplicata EXATA
  put("Doces/bolo-rosa-reexport.webp", await sharp(bolo).resize(900, 1125).webp({ quality: 80 }).toBuffer()); // duplicata VISUAL
  put("Alimentos/pizza-quente.jpg", await jpeg(1080, 1350, [120, 60, 20], [240, 170, 60], 20));
  put("Eletronicos/tech-azul.png", await png(1200, 1200, [8, 20, 60], [30, 120, 200], 120));
  put("Cosmeticos e Perfumes/perfume-dourado.jpg", await jpeg(1080, 1350, [12, 10, 8], [90, 70, 30], 200));
  put("Roupas/moda-bege.jpg", await jpeg(1080, 1350, [245, 235, 215], [205, 185, 150], 90));
  put("Acessorios/bolsa-verde.jpg", await jpeg(1080, 1350, [20, 90, 70], [120, 190, 150], 45));
  put("Papelaria/caderno-lilas.jpg", await jpeg(1080, 1350, [200, 180, 240], [120, 90, 190], 300));
  put("Casa e Decoracao/sala-cinza.jpg", await jpeg(1080, 1350, [225, 228, 232], [170, 176, 184], 180));
  put("Utilidades/organizador-azul-claro.jpg", await jpeg(1080, 1350, [190, 225, 245], [90, 165, 215], 70));
  put("liso-branco.jpg", await jpeg(1080, 1350, [253, 253, 253], [250, 250, 250], 0)); // sem dica -> geral
  // Rejeitados
  const valid = await jpeg(1080, 1350, [10, 60, 20], [200, 220, 120], 135);
  put("quebrado/corrompido.jpg", valid.subarray(0, Math.floor(valid.length * 0.45)));
  put("quebrado/vazio.jpg", Buffer.alloc(0));
  put("pequeno/mini.png", await png(200, 200, [200, 40, 40], [250, 120, 90], 10));
  put("panorama.jpg", await jpeg(3600, 900, [30, 30, 90], [200, 120, 200], 90));
  put("LEIAME.txt", Buffer.from("não é imagem"));
  writeFileSync(join(root, "inventory.json"), JSON.stringify({
    images: [
      { file: "images/Doces/bolo-rosa.jpg", category: "Doces" },
      { file: "Alimentos/pizza-quente.jpg", categoria: "Alimentos", tags: ["pizza"] },
      { file: "images/nao-existe.jpg", category: "Utilidades" },
    ],
  }));
  return { total: 16, expectedValid: 10 };
}

async function main(): Promise<void> {
  // ---- puros ----
  await check("A1 classifica os 10 baldes por pasta/nome, sem acento e sem depender de caixa", () => {
    assert.equal(classifyBucket(["Doces", "bolo.jpg"]).bucket, "doces");
    assert.equal(classifyBucket(["Alimentos"]).bucket, "alimentos");
    assert.equal(classifyBucket(["Eletrônicos"]).bucket, "eletronicos");
    assert.equal(classifyBucket(["Cosméticos e Perfumes"]).bucket, "cosmeticos-perfumes");
    assert.equal(classifyBucket(["ROUPAS/vestido"]).bucket, "roupas");
    assert.equal(classifyBucket(["Acessórios"]).bucket, "acessorios");
    assert.equal(classifyBucket(["Papelaria"]).bucket, "papelaria");
    assert.equal(classifyBucket(["Casa e Decoração"]).bucket, "casa-decoracao");
    assert.equal(classifyBucket(["Utilidades"]).bucket, "utilidades");
    assert.equal(classifyBucket(["Geral"]).bucket, "geral");
    assert.deepEqual([...AUDIT_BUCKETS].sort(), Object.keys(AUDIT_BUCKET_TO_CATEGORY).sort());
  });

  await check("A2 sem dica reconhecida cai em geral com confident=false (nunca inventa categoria)", () => {
    const result = classifyBucket(["IMG_0042.jpg", "x7f3"]);
    assert.equal(result.bucket, "geral");
    assert.equal(result.confident, false);
    assert.deepEqual(tokenizeHints(["Cosméticos/Perfumes"]), ["cosmeticos", "perfumes"]);
  });

  await check("A3 baldes mapeiam apenas para as 6 categorias canônicas do contrato", () => {
    const allowed = new Set(["beauty", "electronics", "fashion", "home", "food", "general"]);
    for (const bucket of AUDIT_BUCKETS) assert.ok(allowed.has(AUDIT_BUCKET_TO_CATEGORY[bucket]), bucket);
    assert.equal(AUDIT_BUCKET_TO_CATEGORY.doces, "food");
    assert.equal(AUDIT_BUCKET_TO_CATEGORY.acessorios, "fashion");
    assert.equal(AUDIT_BUCKET_TO_CATEGORY.utilidades, "home");
  });

  await check("A4 hashes perceptuais e Hamming são determinísticos", () => {
    const flat = new Uint8Array(72).fill(100);
    const ramp = Uint8Array.from({ length: 72 }, (_, i) => (i % 9) * 20);
    assert.equal(dHashFromGray9x8(flat), "0000000000000000");
    assert.equal(dHashFromGray9x8(ramp), "ffffffffffffffff");
    assert.equal(hammingDistanceHex("ffffffffffffffff", "0000000000000000"), 64);
    assert.equal(hammingDistanceHex("0f", "0e"), 1);
    assert.equal(aHashFromGray8x8(new Uint8Array(64).fill(7)), "ffffffffffffffff");
    assert.throws(() => dHashFromGray9x8([1, 2, 3]));
  });

  await check("A5 estatísticas de cor: luminância, saturação e zonas", () => {
    const w = 8; const h = 10;
    const dark = new Uint8Array(w * h * 3).fill(10);
    const stats = sampleColorStats(dark, w, h);
    assert.ok(stats.meanLuma < 0.01);
    assert.equal(stats.meanHue, null);
    const red = new Uint8Array(w * h * 3);
    for (let i = 0; i < w * h; i += 1) { red[i * 3] = 220; red[i * 3 + 1] = 30; red[i * 3 + 2] = 30; }
    const redStats = sampleColorStats(red, w, h);
    assert.ok(redStats.meanSaturation > 0.8);
    assert.ok(redStats.meanHue !== null && (redStats.meanHue < 10 || redStats.meanHue > 350));
    assert.ok(stats.zones.top.lumaStd < 1e-6);
  });

  await check("A6 estilo explícito na pasta tem precedência; id estável por conteúdo", () => {
    assert.equal(classifyStyleHint(["Minimalista", "doces"]), "minimal");
    assert.equal(classifyStyleHint(["IMG_1"]), null);
    assert.equal(buildBackgroundId("doces", "abcdef0123456789"), "bg-sweets-abcdef0123");
    assert.equal(buildBackgroundId("cosmeticos-perfumes", "abcdef0123456789"), "bg-cosmetics-abcdef0123");
    assert.match(buildBackgroundId("cosmeticos-perfumes", "00ff00ff00ff"), /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/);
  });

  await check("A7 inventário tolerante: array, objeto com images/files e strings", () => {
    assert.equal(parseInventory([{ path: "a/b.jpg" }, "c.png", 7, null]).entries.length, 2);
    assert.equal(parseInventory({ images: [{ filename: "x.jpg", category: "Doces", tags: ["bolo"] }] }).entries[0].hints.includes("bolo"), true);
    assert.equal(parseInventory({ nada: true }).entries.length, 0);
    assert.equal(parseInventory("quebrado").entries.length, 0);
  });

  // ---- pipeline com imagens sintéticas ----
  const root = mkdtempSync(join(tmpdir(), "ads-pro-audit-"));
  const source = join(root, "source");
  const publicOut = join(root, "public", "ads-pro", "backgrounds");
  const manifestOut = join(root, "approved-static-backgrounds.ts");
  try {
    mkdirSync(source, { recursive: true });
    const { total, expectedValid } = await buildSyntheticSource(source);
    const before = listAll(source).map((path) => [path, sha(path)] as const);

    const loaded = loadSource(source);
    const facts = await collectFacts(loaded);

    await check("B1 conta só imagens (ignora LEIAME.txt) e reconcilia inventário x arquivos", () => {
      assert.equal(loaded.files.length, total);
      assert.equal(loaded.inventoryEntries, 3);
      assert.deepEqual(loaded.inventoryMissingFiles, ["images/nao-existe.jpg"]);
      assert.equal(loaded.filesNotInInventory.length, total - 2);
    });

    const result = auditBackgrounds(facts, {}, readCuration(source));
    const decisionByPath = new Map(result.decisions.map((d) => [d.relativePath, d] as const));

    await check("B2 detecta duplicata exata, duplicata visual, corrompidos, baixa resolução e proporção extrema", () => {
      const s = result.summary;
      assert.equal(s.SOURCE_BACKGROUND_COUNT, total);
      assert.equal(s.EXACT_DUPLICATES, 1);
      assert.equal(decisionByPath.get("Doces/bolo-rosa-copia.jpg")!.rejection!.reason, "exact-duplicate");
      assert.equal(s.VISUAL_DUPLICATES, 1);
      const visual = decisionByPath.get("Doces/bolo-rosa-reexport.webp")!;
      assert.equal(visual.rejection!.reason, "visual-duplicate");
      assert.equal(visual.rejection!.duplicateOf, "Doces/bolo-rosa.jpg");
      assert.equal(s.CORRUPTED_FILES, 2);
      assert.equal(decisionByPath.get("quebrado/corrompido.jpg")!.rejection!.reason, "corrupted");
      assert.equal(decisionByPath.get("quebrado/vazio.jpg")!.rejection!.reason, "empty-file");
      assert.equal(decisionByPath.get("pequeno/mini.png")!.rejection!.reason, "low-resolution");
      assert.equal(decisionByPath.get("panorama.jpg")!.rejection!.reason, "extreme-aspect-ratio");
      assert.equal(s.VALID_BACKGROUNDS, expectedValid);
      assert.equal(s.VALID_BACKGROUNDS + s.REJECTED_BACKGROUNDS, total);
    });

    await check("B3 classificação dos válidos por pasta e fallback honesto para geral", () => {
      const bucketOf = (path: string) => decisionByPath.get(path)!.bucket;
      assert.equal(bucketOf("Doces/bolo-rosa.jpg"), "doces");
      assert.equal(bucketOf("Alimentos/pizza-quente.jpg"), "alimentos");
      assert.equal(bucketOf("Eletronicos/tech-azul.png"), "eletronicos");
      assert.equal(bucketOf("Cosmeticos e Perfumes/perfume-dourado.jpg"), "cosmeticos-perfumes");
      assert.equal(bucketOf("Roupas/moda-bege.jpg"), "roupas");
      assert.equal(bucketOf("Acessorios/bolsa-verde.jpg"), "acessorios");
      assert.equal(bucketOf("Papelaria/caderno-lilas.jpg"), "papelaria");
      assert.equal(bucketOf("Casa e Decoracao/sala-cinza.jpg"), "casa-decoracao");
      assert.equal(bucketOf("Utilidades/organizador-azul-claro.jpg"), "utilidades");
      assert.equal(bucketOf("liso-branco.jpg"), "geral");
      assert.equal(decisionByPath.get("liso-branco.jpg")!.bucketConfident, false);
      assert.equal(result.summary.unclassifiedApproved, 1);
      assert.equal(Object.values(result.summary.byBucket).reduce((a, b) => a + b, 0), expectedValid);
    });

    await check("B4 luminância e estilo derivam da cor real; escuros pedem tinta clara", () => {
      assert.equal(decisionByPath.get("Eletronicos/tech-azul.png")!.luminance, "dark");
      assert.equal(decisionByPath.get("Cosmeticos e Perfumes/perfume-dourado.jpg")!.luminance, "dark");
      assert.equal(decisionByPath.get("Roupas/moda-bege.jpg")!.luminance, "light");
      assert.equal(decisionByPath.get("liso-branco.jpg")!.style, "minimal");
    });

    await check("B5 auditoria é determinística e independe da ordem de entrada", () => {
      const again = auditBackgrounds([...facts].reverse(), {}, readCuration(source));
      assert.deepEqual(again.decisions, result.decisions);
      assert.deepEqual(again.summary, result.summary);
    });

    await check("B6 curadoria manual rejeita ou reclassifica sem tocar no acervo", () => {
      const overrides = {
        "Roupas/moda-bege.jpg": { reject: true, reason: "tem modelo" },
        "liso-branco.jpg": { bucket: "papelaria" as const, style: "luxury" as const },
      };
      const curated = auditBackgrounds(facts, {}, overrides);
      const byPath = new Map(curated.decisions.map((d) => [d.relativePath, d] as const));
      assert.equal(byPath.get("Roupas/moda-bege.jpg")!.status, "rejected");
      assert.equal(byPath.get("Roupas/moda-bege.jpg")!.rejection!.reason, "manual-curation");
      assert.equal(byPath.get("liso-branco.jpg")!.bucket, "papelaria");
      assert.equal(byPath.get("liso-branco.jpg")!.style, "luxury");
      assert.equal(byPath.get("liso-branco.jpg")!.bucketConfident, true);
      assert.equal(curated.summary.VALID_BACKGROUNDS, expectedValid - 1);
    });

    await check("B7 publica só os APROVADOS (webp + thumb + manifest) e não altera o acervo bruto", async () => {
      const entries = await publishApproved(loaded, result, { publicDir: publicOut, manifestPath: manifestOut });
      assert.equal(entries.length, expectedValid);
      const published = readdirSync(publicOut).filter((name) => name.endsWith(".webp"));
      assert.equal(published.length, expectedValid);
      assert.equal(readdirSync(join(publicOut, "thumbs")).length, expectedValid);
      for (const entry of entries) {
        assert.ok(statSync(join(publicOut, `${entry.id}.webp`)).size > 0, entry.id);
        assert.match(entry.id, /^bg-[a-z0-9-]+-[0-9a-f]{10}$/);
        const meta = await sharp(join(publicOut, `${entry.id}.webp`)).metadata();
        assert.equal(meta.format, "webp");
        assert.ok(Math.max(meta.width ?? 0, meta.height ?? 0) <= 1350);
        assert.equal(meta.width, entry.width);
      }
      const approvedHashes = new Set(result.approved.map((d) => d.sha256));
      const rejectedOnlyHashes = result.rejected.map((d) => d.sha256).filter((hash) => !approvedHashes.has(hash));
      assert.equal(entries.filter((entry) => rejectedOnlyHashes.includes(result.approved.find((d) => d.id === entry.id)!.sha256)).length, 0, "nenhum rejeitado pode ser publicado");
      const after = listAll(source).map((path) => [path, sha(path)] as const);
      assert.deepEqual(after, before);
    });

    await check("B8 manifest gerado é um módulo TS válido, ordenado e sem ids repetidos", async () => {
      const mod = await import(pathToFileURL(manifestOut).href) as { ADS_PRO_APPROVED_STATIC_BACKGROUNDS: readonly { id: string; bucket: string }[]; ADS_PRO_APPROVED_STATIC_BACKGROUNDS_VERSION: string };
      assert.equal(mod.ADS_PRO_APPROVED_STATIC_BACKGROUNDS.length, expectedValid);
      const ids = mod.ADS_PRO_APPROVED_STATIC_BACKGROUNDS.map((entry) => entry.id);
      assert.deepEqual(ids, [...ids].sort());
      assert.equal(new Set(ids).size, ids.length);
      assert.match(mod.ADS_PRO_APPROVED_STATIC_BACKGROUNDS_VERSION, /^1\.\d+\.0$/);
    });

    await check("B9 relatório Markdown traz as chaves exigidas e a tabela por categoria", () => {
      const markdown = renderMarkdownReport(loaded, result);
      for (const key of ["SOURCE_BACKGROUND_COUNT", "EXACT_DUPLICATES", "VISUAL_DUPLICATES", "CORRUPTED_FILES", "VALID_BACKGROUNDS", "REJECTED_BACKGROUNDS"]) assert.ok(markdown.includes(key), key);
      assert.ok(markdown.includes("Cosméticos e perfumes"));
      assert.ok(markdown.includes("quebrado/corrompido.jpg"));
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }

  await check("B10 pasta de origem inexistente não quebra: 0 arquivos", () => {
    const empty = loadSource(join(tmpdir(), "ads-pro-nao-existe-xyz"));
    assert.equal(empty.files.length, 0);
    assert.equal(auditBackgrounds([]).summary.SOURCE_BACKGROUND_COUNT, 0);
  });

  console.log(`ADS-PRO background audit tests passed: ${checks} checks.`);
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});

export type { AuditDecision };
