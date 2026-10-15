/**
 * ADS-PRO-02 — biblioteca canônica de backgrounds do Anúncios Pro V1 (library-first, IA opcional).
 *
 * Existe UM registry (`MARKETING_PRO_BACKGROUND_LIBRARY`) e UM resolver puro
 * (`resolveMarketingProBackground`) — nenhum componente deve manter seu próprio array local de fundos.
 * Cada asset é cenário puro (gradiente + vinheta + pedestal opcionais): nunca contém produto, pessoa,
 * mão, logo, preço ou texto — só cor/luz, para nunca ser confundido com o item anunciado (§8).
 *
 * Fonte V1: todos os assets são `GENERATED_DETERMINISTIC` (SVG desenhado em código, nunca lido de disco
 * ou rede) — zero peso de imagem binária, zero infraestrutura nova. O tipo já suporta `STATIC_ASSET`
 * (uma imagem curada real, servida como qualquer asset hoje em `client/public/`) para o futuro, sem
 * precisar redesenhar o contrato quando esse dia chegar.
 *
 * `family`/`category`/`format` reaproveitam os enums já existentes (`CreativeFamily`,
 * `MarketingProCategory`, `MarketingProFormat`) — nenhuma taxonomia paralela é criada aqui.
 */
import type { MarketingProCategory, MarketingProFormat } from "./marketing-pro-contract";
import { MARKETING_PRO_FORMAT_DIMENSIONS } from "./marketing-pro-contract";
import type { CreativeFamily } from "./marketing-pro-creative-intelligence";

export type MarketingProBackgroundSourceType = "GENERATED_DETERMINISTIC" | "STATIC_ASSET" | "AI_GENERATED";

export interface MarketingProBackgroundGradientStop {
  readonly offset: number;
  readonly color: string;
}

/** Especificação puramente geométrica/cromática — nunca um bitmap, nunca produto. */
export interface MarketingProBackgroundGeneratedSpec {
  readonly angleDeg: number;
  readonly stops: readonly MarketingProBackgroundGradientStop[];
  readonly vignette?: { readonly color: string; readonly opacity: number };
  readonly pedestal?: { readonly color: string; readonly opacity: number };
}

interface MarketingProBackgroundAssetBase {
  readonly id: string;
  readonly version: number;
  readonly family: CreativeFamily;
  readonly categories: readonly MarketingProCategory[];
  readonly formats: readonly MarketingProFormat[];
  readonly tags?: readonly string[];
  /** Luminância medida do cenário (ADS-PRO-FINAL): decide a cor da tinta do texto. Ausente = derivar das cores. */
  readonly luminance?: "dark" | "light";
}

export interface MarketingProGeneratedBackgroundAsset extends MarketingProBackgroundAssetBase {
  readonly sourceType: "GENERATED_DETERMINISTIC";
  readonly generated: MarketingProBackgroundGeneratedSpec;
}

export interface MarketingProStaticBackgroundAsset extends MarketingProBackgroundAssetBase {
  readonly sourceType: "STATIC_ASSET";
  /** Caminho servido do jeito que já existe hoje (ex.: client/public/...) — nunca uma nova infra. */
  readonly staticUrl: string;
  /** Miniatura leve para a grade de escolha de fundo (ADS-PRO-FINAL). */
  readonly thumbnailUrl?: string;
  /** Zonas de texto movimentadas (medido na auditoria): o compositor aplica scrim atrás do texto. */
  readonly needsScrim?: boolean;
}

export type MarketingProBackgroundAsset = MarketingProGeneratedBackgroundAsset | MarketingProStaticBackgroundAsset;

/**
 * Seed V1 — prova a arquitetura e remove a dependência obrigatória de IA, não cobre todo o catálogo
 * comercial (§6/§22: nada de 2.000 fundos aqui). 4 famílias já existentes (`CreativeFamily`), 3 fundos
 * cada = 12. Categorias cobrem beauty/electronics/fashion/food/home/general sem nenhum `if categoria
 * === "perfume"` — a mesma lista serve qualquer categoria futura por composição de tags.
 */
export const MARKETING_PRO_GENERATED_BACKGROUND_LIBRARY: readonly MarketingProGeneratedBackgroundAsset[] = [
  {
    id: "luxury-onyx-spotlight", version: 1, family: "luxury", categories: ["beauty", "fashion", "general"], formats: ["square", "portrait"],
    tags: ["studio", "spotlight", "dark"], sourceType: "GENERATED_DETERMINISTIC",
    generated: { angleDeg: 150, stops: [{ offset: 0, color: "#07070a" }, { offset: 0.5, color: "#17141d" }, { offset: 1, color: "#050506" }], vignette: { color: "#caa763", opacity: 0.16 }, pedestal: { color: "#000000", opacity: 0.4 } },
  },
  {
    id: "luxury-amber-velvet", version: 1, family: "luxury", categories: ["beauty", "food", "general"], formats: ["square", "portrait"],
    tags: ["warm", "velvet"], sourceType: "GENERATED_DETERMINISTIC",
    generated: { angleDeg: 132, stops: [{ offset: 0, color: "#1c0f0a" }, { offset: 0.55, color: "#4a2417" }, { offset: 1, color: "#0e0704" }], vignette: { color: "#e0a15c", opacity: 0.14 }, pedestal: { color: "#000000", opacity: 0.35 } },
  },
  {
    id: "luxury-midnight-pedestal", version: 1, family: "luxury", categories: ["electronics", "fashion", "general"], formats: ["square", "portrait"],
    tags: ["cool", "pedestal"], sourceType: "GENERATED_DETERMINISTIC",
    generated: { angleDeg: 168, stops: [{ offset: 0, color: "#050810" }, { offset: 0.5, color: "#101a2e" }, { offset: 1, color: "#03050a" }], vignette: { color: "#6f8fd6", opacity: 0.12 }, pedestal: { color: "#000000", opacity: 0.42 } },
  },

  {
    id: "editorial-paper-daylight", version: 1, family: "editorial", categories: ["beauty", "fashion", "food", "general"], formats: ["square", "portrait"],
    tags: ["bright", "paper"], sourceType: "GENERATED_DETERMINISTIC",
    generated: { angleDeg: 128, stops: [{ offset: 0, color: "#fbf5ea" }, { offset: 0.55, color: "#ecdfc9" }, { offset: 1, color: "#cdb99a" }], pedestal: { color: "#3a2c1f", opacity: 0.1 } },
  },
  {
    id: "editorial-studio-grey", version: 1, family: "editorial", categories: ["electronics", "general"], formats: ["square", "portrait"],
    tags: ["neutral", "studio"], sourceType: "GENERATED_DETERMINISTIC",
    generated: { angleDeg: 110, stops: [{ offset: 0, color: "#e9eaec" }, { offset: 0.55, color: "#cfd2d6" }, { offset: 1, color: "#a9adb3" }], pedestal: { color: "#20232a", opacity: 0.12 } },
  },
  {
    id: "editorial-soft-blush", version: 1, family: "editorial", categories: ["beauty", "fashion", "general"], formats: ["square", "portrait"],
    tags: ["blush", "soft"], sourceType: "GENERATED_DETERMINISTIC",
    generated: { angleDeg: 140, stops: [{ offset: 0, color: "#f7e7e6" }, { offset: 0.55, color: "#eccdd0" }, { offset: 1, color: "#d7a9b0" }], pedestal: { color: "#5a2e34", opacity: 0.08 } },
  },

  {
    id: "modern-teal-graphic", version: 1, family: "modern", categories: ["electronics", "general"], formats: ["square", "portrait"],
    tags: ["graphic", "cool"], sourceType: "GENERATED_DETERMINISTIC",
    generated: { angleDeg: 118, stops: [{ offset: 0, color: "#071b20" }, { offset: 0.48, color: "#0b4650" }, { offset: 1, color: "#0f252d" }], vignette: { color: "#38d6c5", opacity: 0.14 }, pedestal: { color: "#020b0e", opacity: 0.3 } },
  },
  {
    id: "modern-violet-tech", version: 1, family: "modern", categories: ["electronics", "general"], formats: ["square", "portrait"],
    tags: ["tech", "vivid"], sourceType: "GENERATED_DETERMINISTIC",
    generated: { angleDeg: 122, stops: [{ offset: 0, color: "#140b26" }, { offset: 0.5, color: "#2f1a52" }, { offset: 1, color: "#0c0716" }], vignette: { color: "#9b7cf0", opacity: 0.16 }, pedestal: { color: "#050308", opacity: 0.32 } },
  },
  {
    id: "modern-slate-grid", version: 1, family: "modern", categories: ["electronics", "home", "general"], formats: ["square", "portrait"],
    tags: ["graphite", "structured"], sourceType: "GENERATED_DETERMINISTIC",
    generated: { angleDeg: 100, stops: [{ offset: 0, color: "#232830" }, { offset: 0.5, color: "#343b46" }, { offset: 1, color: "#181c22" }], pedestal: { color: "#000000", opacity: 0.3 } },
  },

  {
    id: "minimal-cloud-pedestal", version: 1, family: "minimal", categories: ["beauty", "electronics", "fashion", "general"], formats: ["square", "portrait"],
    tags: ["clean", "airy"], sourceType: "GENERATED_DETERMINISTIC",
    generated: { angleDeg: 90, stops: [{ offset: 0, color: "#fbfbfc" }, { offset: 0.6, color: "#eef0f2" }, { offset: 1, color: "#dde1e5" }], pedestal: { color: "#9aa3ab", opacity: 0.14 } },
  },
  {
    id: "minimal-sand-clean", version: 1, family: "minimal", categories: ["beauty", "food", "general"], formats: ["square", "portrait"],
    tags: ["warm", "clean"], sourceType: "GENERATED_DETERMINISTIC",
    generated: { angleDeg: 96, stops: [{ offset: 0, color: "#f7f1e7" }, { offset: 0.6, color: "#ece2d0" }, { offset: 1, color: "#dccdae" }], pedestal: { color: "#8a7757", opacity: 0.12 } },
  },
  {
    id: "minimal-mist-grey", version: 1, family: "minimal", categories: ["electronics", "home", "general"], formats: ["square", "portrait"],
    tags: ["cool", "quiet"], sourceType: "GENERATED_DETERMINISTIC",
    generated: { angleDeg: 84, stops: [{ offset: 0, color: "#f1f3f5" }, { offset: 0.6, color: "#dfe3e7" }, { offset: 1, color: "#c7ccd2" }], pedestal: { color: "#4b525a", opacity: 0.12 } },
  },
];

/**
 * Registry dos fundos GERADOS em código (a biblioteca que a rota de Anúncios sempre carregou).
 *
 * ADS-PRO-FINAL: os fundos ESTÁTICOS aprovados pela auditoria do acervo bruto NÃO entram aqui de propósito —
 * eles somam dezenas de kB de metadados e só o estúdio precisa deles. Vivem em
 * `shared/ads-pro/background-catalog.ts` (gerados + estáticos), que só o chunk lazy do estúdio importa; assim a
 * rota de Anúncios continua dentro do budget de bundle, qualquer que seja o tamanho do acervo aprovado.
 */
export const MARKETING_PRO_BACKGROUND_LIBRARY: readonly MarketingProBackgroundAsset[] = MARKETING_PRO_GENERATED_BACKGROUND_LIBRARY;

/** Família usada quando nem `creativeFamily` resolve nenhum candidato (§10, tier final antes do absoluto). */
const GENERIC_FALLBACK_FAMILY: CreativeFamily = "minimal";

/** Último recurso absoluto — nunca lido do array, nunca depende de `family`/`category`/`format` baterem
 * com nada. Deliberadamente ainda um gradiente premium, nunca um branco cru (§10). Só alcançável se a
 * biblioteca inteira estiver vazia para o formato pedido, o que não acontece hoje (todo asset declara
 * ambos os formatos). */
const ABSOLUTE_FALLBACK_ASSET: MarketingProGeneratedBackgroundAsset = {
  id: "pro-generic-fallback", version: 1, family: "minimal", categories: ["general"], formats: ["square", "portrait", "story"],
  tags: ["fallback"], sourceType: "GENERATED_DETERMINISTIC",
  generated: { angleDeg: 90, stops: [{ offset: 0, color: "#f2f3f5" }, { offset: 1, color: "#d6dade" }], pedestal: { color: "#5b616a", opacity: 0.1 } },
};

export interface MarketingProResolvedBackground {
  readonly backgroundId: string;
  readonly backgroundVersion: number;
  readonly backgroundFamily: CreativeFamily;
  /** Nunca "AI_GENERATED" aqui — o registry só contém assets próprios; a IA tem sua própria identidade
   * (generationId), montada no call site, nunca resolvida por esta função. */
  readonly sourceType: MarketingProBackgroundAsset["sourceType"];
  readonly asset: MarketingProBackgroundAsset;
}

/** djb2 — só precisa ser estável e bem distribuído, nunca criptográfico; sem `Math.random`/`Date.now`. */
function deterministicHash(value: string): number {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 33 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

export interface ResolveMarketingProBackgroundInput {
  readonly creativeFamily: CreativeFamily;
  readonly category?: MarketingProCategory;
  readonly format: MarketingProFormat;
  /** Identidade estável da seleção (tipicamente productId) — nunca aleatório. */
  readonly seed: string;
  /** 0 = primeira escolha determinística; incrementar materializa "Outra opção" (§12/§13), nunca random. */
  readonly variantIndex?: number;
  readonly excludeIds?: readonly string[];
  /** §11 — override explícito: se o id existir, suportar o formato pedido e não estiver excluído, é
   * usado diretamente (sem hash de seed). Se não existir/não suportar o formato, cai para a cadeia normal
   * de fallback abaixo — nunca lança, nunca ignora silenciosamente a falta do id pedido. */
  readonly backgroundId?: string;
  /** Biblioteca a consultar. Padrão: o registry canônico completo. Existe para o resolver poder ser provado
   * sobre o seed gerado em código sem depender de quantos fundos estáticos a auditoria aprovou. */
  readonly library?: readonly MarketingProBackgroundAsset[];
}

/**
 * Puro, determinístico, sem I/O e sem chamar nenhum provider (§11). Cadeia de fallback (§10):
 * id explícito válido -> family+category+format exatos -> relaxa category -> relaxa para a família
 * genérica -> fallback absoluto embutido no código (nunca um array vazio, nunca branco cru).
 */
export function resolveMarketingProBackground(input: ResolveMarketingProBackgroundInput): MarketingProResolvedBackground {
  const library = input.library ?? MARKETING_PRO_BACKGROUND_LIBRARY;
  const exclude = new Set(input.excludeIds ?? []);
  const matchesFormat = (asset: MarketingProBackgroundAsset) => asset.formats.includes(input.format);
  const notExcluded = (asset: MarketingProBackgroundAsset) => !exclude.has(asset.id);

  if (input.backgroundId) {
    const explicit = library.find((asset) => asset.id === input.backgroundId && matchesFormat(asset) && notExcluded(asset));
    if (explicit) return { backgroundId: explicit.id, backgroundVersion: explicit.version, backgroundFamily: explicit.family, sourceType: explicit.sourceType, asset: explicit };
  }

  let candidates = library.filter((asset) =>
    asset.family === input.creativeFamily
    && matchesFormat(asset)
    && notExcluded(asset)
    && (!input.category || asset.categories.includes(input.category)));

  if (candidates.length === 0) {
    candidates = library.filter((asset) => asset.family === input.creativeFamily && matchesFormat(asset) && notExcluded(asset));
  }
  if (candidates.length === 0) {
    candidates = library.filter((asset) => asset.family === GENERIC_FALLBACK_FAMILY && matchesFormat(asset) && notExcluded(asset));
  }
  if (candidates.length === 0) {
    candidates = library.filter((asset) => matchesFormat(asset) && notExcluded(asset));
  }
  if (candidates.length === 0) {
    candidates = [ABSOLUTE_FALLBACK_ASSET];
  }

  const seedKey = `${input.seed}:${input.creativeFamily}:${input.format}`;
  const baseIndex = deterministicHash(seedKey) % candidates.length;
  const variantIndex = Number.isInteger(input.variantIndex) ? (input.variantIndex as number) : 0;
  const asset = candidates[(baseIndex + Math.abs(variantIndex)) % candidates.length];

  return { backgroundId: asset.id, backgroundVersion: asset.version, backgroundFamily: asset.family, sourceType: asset.sourceType, asset };
}

function linearGradientAxis(angleDeg: number, width: number, height: number) {
  const angleRad = (angleDeg * Math.PI) / 180;
  const length = Math.abs(width * Math.sin(angleRad)) + Math.abs(height * Math.cos(angleRad));
  const cx = width / 2;
  const cy = height / 2;
  const half = length / 2;
  return {
    x1: cx - Math.sin(angleRad) * half, y1: cy + Math.cos(angleRad) * half,
    x2: cx + Math.sin(angleRad) * half, y2: cy - Math.cos(angleRad) * half,
  };
}

function buildGeneratedBackgroundSvg(spec: MarketingProBackgroundGeneratedSpec, width: number, height: number): string {
  const axis = linearGradientAxis(spec.angleDeg, width, height);
  const stops = spec.stops.map((stop) => `<stop offset="${stop.offset}" stop-color="${stop.color}"/>`).join("");
  const vignette = spec.vignette
    ? `<radialGradient id="v" cx="50%" cy="42%" r="75%"><stop offset="55%" stop-color="${spec.vignette.color}" stop-opacity="0"/><stop offset="100%" stop-color="${spec.vignette.color}" stop-opacity="${spec.vignette.opacity}"/></radialGradient>`
    : "";
  const pedestal = spec.pedestal
    ? `<ellipse cx="${width / 2}" cy="${height * 0.94}" rx="${width * 0.4}" ry="${height * 0.06}" fill="${spec.pedestal.color}" opacity="${spec.pedestal.opacity}"/>`
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs><linearGradient id="g" x1="${axis.x1}" y1="${axis.y1}" x2="${axis.x2}" y2="${axis.y2}" gradientUnits="userSpaceOnUse">${stops}</linearGradient>${vignette}</defs><rect width="${width}" height="${height}" fill="url(#g)"/>${spec.vignette ? `<rect width="${width}" height="${height}" fill="url(#v)"/>` : ""}${pedestal}</svg>`;
}

/**
 * Produz o `backgroundImageSrc` que o composer canônico já aceita hoje (`string`, `new Image().src`) —
 * nenhuma mudança no renderer é necessária. GENERATED_DETERMINISTIC vira uma data URI SVG (sem rede, sem
 * bitmap); STATIC_ASSET simplesmente devolve a URL já servida pelo mecanismo existente.
 */
export function renderMarketingProBackgroundSource(asset: MarketingProBackgroundAsset, format: MarketingProFormat): string {
  if (asset.sourceType === "STATIC_ASSET") return asset.staticUrl;
  const dimensions = MARKETING_PRO_FORMAT_DIMENSIONS[format];
  const svg = buildGeneratedBackgroundSvg(asset.generated, dimensions.width, dimensions.height);
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
