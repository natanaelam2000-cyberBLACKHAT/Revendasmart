/**
 * ADS-PRO-FINAL — Auditoria determinística da biblioteca de fundos (acervo bruto -> manifest de produção).
 *
 * Este módulo é PURO: sem fs, sem sharp, sem rede, sem relógio. Recebe "fatos" já extraídos de cada
 * arquivo (hash, dimensões, estatísticas de cor, hashes perceptuais — quem extrai é
 * `script/ads-pro-background-audit.ts`) e decide, de forma reproduzível, quais fundos podem entrar no
 * manifest de produção e por que os demais foram rejeitados.
 *
 * O acervo bruto (`source-assets/ads-pro-backgrounds/`) NUNCA é a fonte do produto: só assets
 * APROVADOS por esta auditoria viram `ADS_PRO_APPROVED_STATIC_BACKGROUNDS` e, portanto, só eles podem
 * ser escolhidos pelo matcher do Ads Pro.
 *
 * Limitação declarada: nenhuma heurística daqui "enxerga" o conteúdo semântico da imagem (produto,
 * pessoa, logo, texto). A classificação comercial vem das dicas de organização do acervo (pasta,
 * nome, inventário) e o que não tem dica confiável cai em "geral" — nunca é inventado.
 */

import type { MarketingProCategory } from "../marketing-pro-contract";

/** Os 10 baldes comerciais pedidos para a auditoria. O matcher continua usando as 6 categorias canônicas. */
export const AUDIT_BUCKETS = [
  "doces",
  "alimentos",
  "eletronicos",
  "cosmeticos-perfumes",
  "roupas",
  "acessorios",
  "papelaria",
  "casa-decoracao",
  "utilidades",
  "geral",
] as const;
export type AuditBucket = (typeof AUDIT_BUCKETS)[number];

export const AUDIT_BUCKET_LABELS: Readonly<Record<AuditBucket, string>> = Object.freeze({
  doces: "Doces",
  alimentos: "Alimentos",
  eletronicos: "Eletrônicos",
  "cosmeticos-perfumes": "Cosméticos e perfumes",
  roupas: "Roupas",
  acessorios: "Acessórios",
  papelaria: "Papelaria",
  "casa-decoracao": "Casa e decoração",
  utilidades: "Utilidades",
  geral: "Geral / outros",
});

/**
 * Slug NEUTRO (inglês) de cada balde, usado em ids e tags do manifest. A biblioteca de fundos nunca pode
 * carregar metadado que pareça o produto anunciado (BG10 em marketing-pro-background-library-tests.ts):
 * por isso o id de um fundo de cosméticos é `bg-cosmetics-…`, nunca algo com o nome do produto.
 */
export const AUDIT_BUCKET_SLUGS: Readonly<Record<AuditBucket, string>> = Object.freeze({
  doces: "sweets",
  alimentos: "food",
  eletronicos: "tech",
  "cosmeticos-perfumes": "cosmetics",
  roupas: "apparel",
  acessorios: "accessories",
  papelaria: "stationery",
  "casa-decoracao": "home-decor",
  utilidades: "utilities",
  geral: "general",
});

/** Ponte dos 10 baldes para as 6 categorias canônicas do contrato (MarketingProCategory não cresce aqui). */
export const AUDIT_BUCKET_TO_CATEGORY: Readonly<Record<AuditBucket, MarketingProCategory>> = Object.freeze({
  doces: "food",
  alimentos: "food",
  eletronicos: "electronics",
  "cosmeticos-perfumes": "beauty",
  roupas: "fashion",
  acessorios: "fashion",
  papelaria: "general",
  "casa-decoracao": "home",
  utilidades: "home",
  geral: "general",
});

export const AUDIT_STYLES = ["luxury", "editorial", "minimal", "sensory", "modern"] as const;
export type AuditStyle = (typeof AUDIT_STYLES)[number];

/** Vocabulário PT-BR/EN (já normalizado: minúsculo, sem acento) por balde. A ordem de AUDIT_BUCKETS desempata. */
const BUCKET_LEXICON: Readonly<Record<Exclude<AuditBucket, "geral">, readonly string[]>> = Object.freeze({
  doces: ["doce", "doces", "bolo", "bolos", "brigadeiro", "chocolate", "sobremesa", "confeitaria", "cupcake", "bombom", "candy", "sweet", "sweets", "dessert", "bala", "balas", "pirulito", "sorvete", "cake", "docinho", "docinhos", "trufa", "brownie"],
  alimentos: ["alimento", "alimentos", "comida", "food", "lanche", "marmita", "salgado", "salgados", "pizza", "hamburguer", "burger", "padaria", "pao", "fruta", "frutas", "verdura", "restaurante", "bebida", "bebidas", "cafe", "coffee", "suco", "drink", "mercado", "cozinha", "gourmet"],
  eletronicos: ["eletronico", "eletronicos", "electronic", "electronics", "tech", "tecnologia", "celular", "smartphone", "fone", "fones", "headphone", "speaker", "notebook", "computador", "gamer", "game", "carregador", "cabo", "gadget", "camera", "tv", "som"],
  "cosmeticos-perfumes": ["cosmetico", "cosmeticos", "perfume", "perfumes", "beleza", "beauty", "maquiagem", "makeup", "skincare", "creme", "batom", "shampoo", "hidratante", "fragrancia", "colonia", "esmalte", "spa", "cabelo"],
  roupas: ["roupa", "roupas", "moda", "fashion", "vestido", "camiseta", "camisa", "calca", "jeans", "blusa", "saia", "moletom", "lingerie", "pijama", "biquini", "confeccao", "look", "vestuario", "feminina", "masculina"],
  acessorios: ["acessorio", "acessorios", "bolsa", "bolsas", "bijuteria", "bijuterias", "joia", "joias", "relogio", "relogios", "oculos", "cinto", "colar", "brinco", "brincos", "anel", "pulseira", "carteira", "mochila", "bone", "chapeu", "lenco"],
  papelaria: ["papelaria", "caderno", "cadernos", "caneta", "canetas", "lapis", "agenda", "planner", "papel", "escritorio", "escolar", "estojo", "canetinha", "adesivo", "adesivos", "sticker", "stationery"],
  "casa-decoracao": ["casa", "decoracao", "decor", "home", "sala", "quarto", "vaso", "vasos", "quadro", "quadros", "almofada", "tapete", "cortina", "luminaria", "cama", "banho", "enfeite", "enfeites", "planta", "plantas", "mesa"],
  utilidades: ["utilidade", "utilidades", "ferramenta", "ferramentas", "limpeza", "organizador", "organizadores", "organizacao", "pote", "potes", "garrafa", "garrafas", "armazenamento", "bazar", "descartavel", "utensilio", "utensilios", "plastico"],
});

/** Dicas de estilo explícitas (pasta/nome/inventário) — têm precedência sobre a heurística de cor. */
const STYLE_LEXICON: Readonly<Record<AuditStyle, readonly string[]>> = Object.freeze({
  luxury: ["luxo", "luxury", "premium", "gold", "dourado", "elegante", "sofisticado"],
  editorial: ["editorial", "revista", "magazine", "classico"],
  minimal: ["minimal", "minimalista", "clean", "limpo", "liso", "branco", "simples"],
  sensory: ["sensorial", "sensory", "organico", "pastel", "rosa", "aconchegante", "natural", "suave"],
  modern: ["moderno", "modern", "tech", "neon", "grafico", "geometrico", "vibrante"],
});

export function normalizeHint(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

export function tokenizeHints(hints: readonly string[]): readonly string[] {
  const tokens: string[] = [];
  for (const hint of hints) {
    for (const token of normalizeHint(hint).split(/[^a-z0-9]+/)) {
      if (token) tokens.push(token);
    }
  }
  return tokens;
}

export interface BucketClassification {
  readonly bucket: AuditBucket;
  /** false => nenhuma dica reconhecida; caiu em "geral" por falta de evidência (nunca por palpite). */
  readonly confident: boolean;
  readonly matchedTokens: readonly string[];
}

export function classifyBucket(hints: readonly string[]): BucketClassification {
  const tokens = new Set(tokenizeHints(hints));
  let best: { bucket: AuditBucket; score: number; matched: string[] } | null = null;
  for (const bucket of AUDIT_BUCKETS) {
    if (bucket === "geral") continue;
    const matched = BUCKET_LEXICON[bucket].filter((word) => tokens.has(word));
    if (matched.length === 0) continue;
    if (!best || matched.length > best.score) best = { bucket, score: matched.length, matched };
  }
  if (best) return { bucket: best.bucket, confident: true, matchedTokens: best.matched };
  const geral = ["geral", "outros", "other", "general", "misc"].filter((word) => tokens.has(word));
  return { bucket: "geral", confident: geral.length > 0, matchedTokens: geral };
}

export function classifyStyleHint(hints: readonly string[]): AuditStyle | null {
  const tokens = new Set(tokenizeHints(hints));
  for (const style of AUDIT_STYLES) {
    if (STYLE_LEXICON[style].some((word) => tokens.has(word))) return style;
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Hashes perceptuais e estatísticas de cor (entradas minúsculas e determinísticas)
// ---------------------------------------------------------------------------------------------

/** dHash 64 bits a partir de 72 amostras de cinza (9 colunas x 8 linhas). */
export function dHashFromGray9x8(gray: ArrayLike<number>): string {
  if (gray.length !== 72) throw new Error("dHash exige 72 amostras (9x8).");
  let bits = "";
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      bits += gray[y * 9 + x] < gray[y * 9 + x + 1] ? "1" : "0";
    }
  }
  return bitsToHex(bits);
}

/** aHash 64 bits a partir de 64 amostras de cinza (8x8). */
export function aHashFromGray8x8(gray: ArrayLike<number>): string {
  if (gray.length !== 64) throw new Error("aHash exige 64 amostras (8x8).");
  let sum = 0;
  for (let i = 0; i < 64; i += 1) sum += gray[i];
  const mean = sum / 64;
  let bits = "";
  for (let i = 0; i < 64; i += 1) bits += gray[i] >= mean ? "1" : "0";
  return bitsToHex(bits);
}

function bitsToHex(bits: string): string {
  let hex = "";
  for (let i = 0; i < bits.length; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  return hex;
}

export function hammingDistanceHex(a: string, b: string): number {
  if (a.length !== b.length) return Number.POSITIVE_INFINITY;
  let distance = 0;
  for (let i = 0; i < a.length; i += 1) {
    let xor = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    while (xor) { distance += xor & 1; xor >>= 1; }
  }
  return distance;
}

export interface ColorSample {
  readonly meanRgb: readonly [number, number, number];
  /** 0..1 */
  readonly meanLuma: number;
  /** desvio-padrão da luminância, 0..1 */
  readonly lumaStd: number;
  /** 0..1 (HSV) */
  readonly meanSaturation: number;
  /** graus 0..360 do vetor médio de matiz ponderado por saturação; null quando praticamente cinza */
  readonly meanHue: number | null;
  readonly zones: Readonly<{ top: ZoneStats; center: ZoneStats; bottom: ZoneStats }>;
}

export interface ZoneStats {
  readonly meanLuma: number;
  readonly lumaStd: number;
}

function srgbToLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** Luminância relativa WCAG de um pixel sRGB 0..255. */
export function pixelLuminance(r: number, g: number, b: number): number {
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

/**
 * Estatísticas de cor sobre uma amostra RGB pequena (ex.: 32x40, 3 canais intercalados). As zonas
 * seguem a geometria dos arquétipos do Ads Pro: texto no terço superior e inferior, produto no centro.
 */
export function sampleColorStats(rgb: ArrayLike<number>, width: number, height: number): ColorSample {
  if (width <= 0 || height <= 0 || rgb.length < width * height * 3) throw new Error("Amostra RGB inválida.");
  let sumR = 0; let sumG = 0; let sumB = 0;
  let sumLuma = 0; let sumLumaSq = 0;
  let sumSat = 0;
  let hueX = 0; let hueY = 0;
  const zoneSums = { top: [0, 0, 0], center: [0, 0, 0], bottom: [0, 0, 0] } as Record<"top" | "center" | "bottom", number[]>;
  for (let y = 0; y < height; y += 1) {
    const zone: "top" | "center" | "bottom" = y < height * 0.3 ? "top" : y >= height * 0.65 ? "bottom" : "center";
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 3;
      const r = rgb[offset]; const g = rgb[offset + 1]; const b = rgb[offset + 2];
      const luma = pixelLuminance(r, g, b);
      sumR += r; sumG += g; sumB += b;
      sumLuma += luma; sumLumaSq += luma * luma;
      const max = Math.max(r, g, b); const min = Math.min(r, g, b);
      const saturation = max === 0 ? 0 : (max - min) / max;
      sumSat += saturation;
      if (max !== min) {
        let hue: number;
        const delta = max - min;
        if (max === r) hue = ((g - b) / delta) % 6;
        else if (max === g) hue = (b - r) / delta + 2;
        else hue = (r - g) / delta + 4;
        const radians = (hue * 60 * Math.PI) / 180;
        hueX += Math.cos(radians) * saturation;
        hueY += Math.sin(radians) * saturation;
      }
      const z = zoneSums[zone];
      z[0] += 1; z[1] += luma; z[2] += luma * luma;
    }
  }
  const count = width * height;
  const meanLuma = sumLuma / count;
  const variance = Math.max(0, sumLumaSq / count - meanLuma * meanLuma);
  const hueMagnitude = Math.hypot(hueX, hueY) / count;
  let meanHue: number | null = null;
  if (hueMagnitude > 0.02) {
    meanHue = (Math.atan2(hueY, hueX) * 180) / Math.PI;
    if (meanHue < 0) meanHue += 360;
  }
  const zoneStats = (key: "top" | "center" | "bottom"): ZoneStats => {
    const [n, s, sq] = zoneSums[key];
    if (n === 0) return { meanLuma, lumaStd: Math.sqrt(variance) };
    const m = s / n;
    return { meanLuma: m, lumaStd: Math.sqrt(Math.max(0, sq / n - m * m)) };
  };
  return {
    meanRgb: [sumR / count, sumG / count, sumB / count],
    meanLuma,
    lumaStd: Math.sqrt(variance),
    meanSaturation: sumSat / count,
    meanHue,
    zones: { top: zoneStats("top"), center: zoneStats("center"), bottom: zoneStats("bottom") },
  };
}

// ---------------------------------------------------------------------------------------------
// Decisão de auditoria
// ---------------------------------------------------------------------------------------------

export interface BackgroundFileFacts {
  /** Caminho relativo a `images/`, sempre com "/" (estável entre sistemas operacionais). */
  readonly relativePath: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly width: number;
  readonly height: number;
  readonly format: string;
  readonly hasAlpha: boolean;
  readonly decodeOk: boolean;
  readonly decodeError?: string;
  readonly dHash?: string;
  readonly aHash?: string;
  readonly color?: ColorSample;
  /** Dicas de organização do acervo: pastas, nome do arquivo, campos do inventário. */
  readonly hints: readonly string[];
}

export interface AuditOptions {
  /** Menor lado aceito, em px. Fundos menores ficam borrados ao cobrir o canvas 1080 do anúncio. */
  readonly minShortSide: number;
  /** Proporção largura/altura aceita: fora disso o corte "cover" para 4:5/1:1 descarta o cenário. */
  readonly minAspect: number;
  readonly maxAspect: number;
  /** Distância de Hamming máxima do dHash para considerar "visualmente igual". */
  readonly maxDHashDistance: number;
  /** Distância máxima (por canal médio) entre cores médias para confirmar duplicata visual. */
  readonly maxMeanColorDistance: number;
  /** Desvio-padrão de luminância nas zonas de texto acima do qual o fundo exige scrim. */
  readonly busyZoneStd: number;
}

export const DEFAULT_AUDIT_OPTIONS: AuditOptions = Object.freeze({
  minShortSide: 600,
  minAspect: 0.5,
  maxAspect: 2,
  maxDHashDistance: 5,
  maxMeanColorDistance: 14,
  busyZoneStd: 0.2,
});

export interface CurationOverride {
  readonly reject?: boolean;
  readonly reason?: string;
  readonly bucket?: AuditBucket;
  readonly style?: AuditStyle;
}

export type CurationOverrides = Readonly<Record<string, CurationOverride>>;

export type RejectionReason =
  | "corrupted"
  | "empty-file"
  | "exact-duplicate"
  | "visual-duplicate"
  | "low-resolution"
  | "extreme-aspect-ratio"
  | "manual-curation";

export interface AuditDecision {
  readonly id: string;
  readonly relativePath: string;
  readonly status: "approved" | "rejected";
  readonly rejection?: { readonly reason: RejectionReason; readonly detail: string; readonly duplicateOf?: string };
  readonly bucket: AuditBucket;
  readonly bucketConfident: boolean;
  readonly category: MarketingProCategory;
  readonly style: AuditStyle;
  readonly styleSource: "hint" | "color" | "default";
  readonly luminance: "dark" | "light";
  /** true => zonas de texto muito movimentadas: o compositor deve aplicar scrim atrás do texto. */
  readonly needsScrim: boolean;
  readonly width: number;
  readonly height: number;
  readonly sha256: string;
}

export interface AuditSummary {
  readonly SOURCE_BACKGROUND_COUNT: number;
  readonly EXACT_DUPLICATES: number;
  readonly VISUAL_DUPLICATES: number;
  readonly CORRUPTED_FILES: number;
  readonly VALID_BACKGROUNDS: number;
  readonly REJECTED_BACKGROUNDS: number;
  readonly byBucket: Readonly<Record<AuditBucket, number>>;
  readonly unclassifiedApproved: number;
  readonly rejectedByReason: Readonly<Partial<Record<RejectionReason, number>>>;
}

export interface AuditResult {
  readonly decisions: readonly AuditDecision[];
  readonly approved: readonly AuditDecision[];
  readonly rejected: readonly AuditDecision[];
  readonly exactDuplicateGroups: readonly (readonly string[])[];
  readonly visualDuplicateGroups: readonly (readonly string[])[];
  readonly summary: AuditSummary;
}

/** Id estável e válido para o AssetDNA (`^[a-z0-9]+(?:[-_][a-z0-9]+)*$`), derivado do conteúdo — não do nome. */
export function buildBackgroundId(bucket: AuditBucket, sha256: string): string {
  return `bg-${AUDIT_BUCKET_SLUGS[bucket]}-${sha256.slice(0, 10)}`;
}

function inferStyleFromColor(color: ColorSample | undefined): AuditStyle {
  if (!color) return "editorial";
  const { meanLuma, meanSaturation, meanHue } = color;
  const warm = meanHue !== null && (meanHue <= 60 || meanHue >= 320);
  const cool = meanHue !== null && meanHue >= 160 && meanHue <= 280;
  if (meanLuma < 0.08) return meanSaturation >= 0.35 ? "modern" : "luxury";
  if (meanLuma < 0.25) return cool && meanSaturation >= 0.35 ? "modern" : "luxury";
  if (meanLuma > 0.62) {
    if (meanSaturation < 0.1) return "minimal";
    return warm ? "sensory" : "editorial";
  }
  if (meanSaturation >= 0.45) return cool ? "modern" : "sensory";
  return warm ? "sensory" : "editorial";
}

function colorDistance(a: readonly [number, number, number], b: readonly [number, number, number]): number {
  return (Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2])) / 3;
}

function betterQualityFirst(a: BackgroundFileFacts, b: BackgroundFileFacts): number {
  const pixelsDiff = b.width * b.height - a.width * a.height;
  if (pixelsDiff !== 0) return pixelsDiff;
  if (b.bytes !== a.bytes) return b.bytes - a.bytes;
  return a.relativePath < b.relativePath ? -1 : a.relativePath > b.relativePath ? 1 : 0;
}

class UnionFind {
  private readonly parent: number[];
  constructor(size: number) { this.parent = Array.from({ length: size }, (_, i) => i); }
  find(index: number): number {
    let root = index;
    while (this.parent[root] !== root) root = this.parent[root];
    let cursor = index;
    while (this.parent[cursor] !== root) { const next = this.parent[cursor]; this.parent[cursor] = root; cursor = next; }
    return root;
  }
  union(a: number, b: number): void {
    const rootA = this.find(a); const rootB = this.find(b);
    if (rootA !== rootB) this.parent[Math.max(rootA, rootB)] = Math.min(rootA, rootB);
  }
}

export function auditBackgrounds(
  facts: readonly BackgroundFileFacts[],
  options: Partial<AuditOptions> = {},
  overrides: CurationOverrides = {},
): AuditResult {
  const opts: AuditOptions = { ...DEFAULT_AUDIT_OPTIONS, ...options };
  const sorted = [...facts].sort((a, b) => (a.relativePath < b.relativePath ? -1 : a.relativePath > b.relativePath ? 1 : 0));

  const rejections = new Map<string, NonNullable<AuditDecision["rejection"]>>();
  const reject = (file: BackgroundFileFacts, reason: RejectionReason, detail: string, duplicateOf?: string) => {
    if (!rejections.has(file.relativePath)) rejections.set(file.relativePath, { reason, detail, ...(duplicateOf ? { duplicateOf } : {}) });
  };

  // 1) Arquivos que nem decodificam (ou vazios) saem primeiro: não participam de nenhum cálculo de duplicata.
  const decodable: BackgroundFileFacts[] = [];
  for (const file of sorted) {
    if (file.bytes <= 0) reject(file, "empty-file", "Arquivo com 0 bytes.");
    else if (!file.decodeOk || file.width <= 0 || file.height <= 0) reject(file, "corrupted", file.decodeError || "Falha ao decodificar a imagem.");
    else decodable.push(file);
  }

  // 2) Duplicatas exatas (mesmo SHA-256): fica o primeiro caminho em ordem alfabética.
  const bySha = new Map<string, BackgroundFileFacts[]>();
  for (const file of decodable) bySha.set(file.sha256, [...(bySha.get(file.sha256) ?? []), file]);
  const exactDuplicateGroups: string[][] = [];
  for (const original of Array.from(bySha.values())) {
    if (original.length < 2) continue;
    // Mantém o caminho mais curto (cópias costumam ganhar sufixo: "-copia", "(1)"); empate -> ordem alfabética.
    const group = [...original].sort((a, b) => a.relativePath.length - b.relativePath.length || (a.relativePath < b.relativePath ? -1 : 1));
    exactDuplicateGroups.push(group.map((file) => file.relativePath));
    for (const file of group.slice(1)) reject(file, "exact-duplicate", `Idêntico byte a byte a ${group[0].relativePath}.`, group[0].relativePath);
  }

  // 3) Critérios de qualidade objetivos.
  for (const file of decodable) {
    if (rejections.has(file.relativePath)) continue;
    const shortSide = Math.min(file.width, file.height);
    if (shortSide < opts.minShortSide) {
      reject(file, "low-resolution", `Menor lado ${shortSide}px < ${opts.minShortSide}px.`);
      continue;
    }
    const aspect = file.width / file.height;
    if (aspect < opts.minAspect || aspect > opts.maxAspect) {
      reject(file, "extreme-aspect-ratio", `Proporção ${aspect.toFixed(2)} fora de ${opts.minAspect}-${opts.maxAspect}.`);
    }
  }

  // 4) Duplicatas visuais entre os que sobraram: hash perceptual PERTO + cor média PERTA (evita juntar
  //    gradientes lisos de cores diferentes, que têm dHash quase idêntico).
  const survivors = decodable.filter((file) => !rejections.has(file.relativePath) && file.dHash && file.color);
  const union = new UnionFind(survivors.length);
  for (let i = 0; i < survivors.length; i += 1) {
    for (let j = i + 1; j < survivors.length; j += 1) {
      const a = survivors[i]; const b = survivors[j];
      if (hammingDistanceHex(a.dHash as string, b.dHash as string) > opts.maxDHashDistance) continue;
      if (colorDistance(a.color!.meanRgb, b.color!.meanRgb) > opts.maxMeanColorDistance) continue;
      union.union(i, j);
    }
  }
  const visualGroupsMap = new Map<number, BackgroundFileFacts[]>();
  survivors.forEach((file, index) => {
    const root = union.find(index);
    visualGroupsMap.set(root, [...(visualGroupsMap.get(root) ?? []), file]);
  });
  const visualDuplicateGroups: string[][] = [];
  for (const group of Array.from(visualGroupsMap.values())) {
    if (group.length < 2) continue;
    const ranked = [...group].sort(betterQualityFirst);
    visualDuplicateGroups.push(ranked.map((file) => file.relativePath));
    for (const file of ranked.slice(1)) reject(file, "visual-duplicate", `Visualmente igual a ${ranked[0].relativePath}.`, ranked[0].relativePath);
  }

  // 5) Monta as decisões (aprovadas recebem classificação).
  const decisions: AuditDecision[] = sorted.map((file) => {
    const override = overrides[file.relativePath];
    const classification = classifyBucket(file.hints);
    const bucket = override?.bucket ?? classification.bucket;
    const styleHint = override?.style ?? classifyStyleHint(file.hints);
    const style = styleHint ?? inferStyleFromColor(file.color);
    const styleSource: AuditDecision["styleSource"] = styleHint ? "hint" : file.color ? "color" : "default";
    const meanLuma = file.color?.meanLuma ?? 0.5;
    const busiest = file.color ? Math.max(file.color.zones.top.lumaStd, file.color.zones.bottom.lumaStd) : 0;
    let rejection = rejections.get(file.relativePath);
    if (override?.reject) rejection = { reason: "manual-curation", detail: override.reason || "Rejeitado na curadoria manual." };
    return {
      id: buildBackgroundId(bucket, file.sha256),
      relativePath: file.relativePath,
      status: rejection ? "rejected" : "approved",
      ...(rejection ? { rejection } : {}),
      bucket,
      bucketConfident: override?.bucket ? true : classification.confident,
      category: AUDIT_BUCKET_TO_CATEGORY[bucket],
      style,
      styleSource,
      luminance: meanLuma < 0.22 ? "dark" : "light",
      needsScrim: busiest > opts.busyZoneStd,
      width: file.width,
      height: file.height,
      sha256: file.sha256,
    };
  });

  const approved = decisions.filter((decision) => decision.status === "approved");
  const rejected = decisions.filter((decision) => decision.status === "rejected");
  const byBucket = Object.fromEntries(AUDIT_BUCKETS.map((bucket) => [bucket, 0])) as Record<AuditBucket, number>;
  for (const decision of approved) byBucket[decision.bucket] += 1;
  const rejectedByReason: Partial<Record<RejectionReason, number>> = {};
  for (const decision of rejected) {
    const reason = decision.rejection!.reason;
    rejectedByReason[reason] = (rejectedByReason[reason] ?? 0) + 1;
  }

  return {
    decisions,
    approved,
    rejected,
    exactDuplicateGroups,
    visualDuplicateGroups,
    summary: {
      SOURCE_BACKGROUND_COUNT: facts.length,
      EXACT_DUPLICATES: rejectedByReason["exact-duplicate"] ?? 0,
      VISUAL_DUPLICATES: rejectedByReason["visual-duplicate"] ?? 0,
      CORRUPTED_FILES: (rejectedByReason["corrupted"] ?? 0) + (rejectedByReason["empty-file"] ?? 0),
      VALID_BACKGROUNDS: approved.length,
      REJECTED_BACKGROUNDS: rejected.length,
      byBucket,
      unclassifiedApproved: approved.filter((decision) => !decision.bucketConfident).length,
      rejectedByReason,
    },
  };
}
