/**
 * Anúncios Pro — contrato mínimo compartilhado entre client e server (PRO-06A).
 *
 * Antes desta extração, `server/marketing-pro.ts` importava diretamente de
 * `client/src/lib/marketing-pro.ts`. O arquivo era puro (sem React/DOM) e por isso funcionava, mas a
 * fronteira estava errada: um backend que vai rodar em Cloud Run não deve depender da árvore
 * `client/`, mesmo que hoje nada ali use browser API — a dependência em si é o problema, porque nada
 * impede um import futuro nesse arquivo de puxar algo browser-specific e quebrar o build do servidor
 * sem aviso.
 *
 * Aqui mora SÓ o que os dois lados genuinamente precisam: os dois enums (formato/estilo), os limites
 * de campo e os type guards que validam entrada. Presets de estilo, art direction, sanitização de
 * texto comercial, safe zones e a composição inteira continuam em
 * `client/src/lib/marketing-pro.ts` — são do fluxo de preparação local (PRO-04/05), sem consumidor
 * no backend.
 */

import type { CreativeFamily, ProductVisualUnderstanding } from "./marketing-pro-creative-intelligence";

export type MarketingProFormat = "portrait" | "square" | "story";
export type MarketingProStyle = "luxury" | "editorial" | "minimal" | "sensory" | "modern";
/** Categoria não é dado comercial — é classificação de produto, segura para atravessar o provider boundary. */
export type MarketingProCategory = "beauty" | "electronics" | "fashion" | "home" | "food" | "general";

export const MARKETING_PRO_FIELD_LIMITS = {
  storeName: 80,
  productId: 80,
  productName: 120,
  category: 80,
  imageUrl: 2048,
  brand: 80,
  volume: 64,
  description: 240,
  benefit: 100,
  ctaLabel: 80,
  color: 16,
} as const;

export function isMarketingProFormat(value: unknown): value is MarketingProFormat {
  return value === "portrait" || value === "square" || value === "story";
}

export function isMarketingProStyle(value: unknown): value is MarketingProStyle {
  return value === "luxury" || value === "editorial" || value === "minimal" || value === "sensory" || value === "modern";
}

/**
 * Retângulo fracionário (0..1) do lado da arte. Geometria pura — sem produto, sem preço, sem texto —
 * por isso é seguro viver aqui e ser consumido tanto pelo compositor local (client) quanto pelo
 * quality gate e pelo benchmark (server/shared).
 */
export interface MarketingProRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface MarketingProProductPlacement {
  readonly rect: MarketingProRect;
  readonly scale: number;
}

/**
 * Dimensões lógicas por formato — fonte única. O client compõe `MARKETING_PRO_FORMATS` (que também
 * carrega safe zones de layout, específicas do compositor) a partir daqui; o quality gate do backend
 * usa isto sozinho, sem precisar do resto do contrato do client.
 */
export const MARKETING_PRO_FORMAT_DIMENSIONS: Record<MarketingProFormat, { readonly width: number; readonly height: number; readonly aspectRatio: number }> = {
  portrait: { width: 1080, height: 1350, aspectRatio: 4 / 5 },
  square: { width: 1080, height: 1080, aspectRatio: 1 },
  story: { width: 1080, height: 1920, aspectRatio: 9 / 16 },
};

/**
 * Área reservada ao produto, por formato — a única safe zone de layout que o provider/benchmark
 * precisam conhecer como número. As demais (nome, preço, benefícios, CTA) só existem como a lista de
 * hints já resolvida caso a caso (`MarketingProProviderSafeZoneHint`), porque o compositor local é
 * quem sabe onde cada uma vai — aqui só a zona do produto, que é a única compartilhada por número.
 */
export const MARKETING_PRO_PRODUCT_ZONE: Record<MarketingProFormat, MarketingProRect> = {
  portrait: { x: 0.08, y: 0.16, width: 0.84, height: 0.46 },
  square: { x: 0.10, y: 0.17, width: 0.80, height: 0.42 },
  story: { x: 0.08, y: 0.13, width: 0.84, height: 0.49 },
};

export const MARKETING_PRO_ORIENTATION_PRODUCT_ZONE: Record<MarketingProFormat, {
  readonly landscape: MarketingProRect;
  readonly portrait: MarketingProRect;
  readonly square: MarketingProRect;
  readonly irregular: MarketingProRect;
}> = {
  portrait: {
    landscape: { x: 0.07, y: 0.32, width: 0.86, height: 0.30 },
    portrait: MARKETING_PRO_PRODUCT_ZONE.portrait,
    square: { x: 0.16, y: 0.18, width: 0.68, height: 0.44 },
    irregular: MARKETING_PRO_PRODUCT_ZONE.portrait,
  },
  square: {
    landscape: { x: 0.07, y: 0.28, width: 0.86, height: 0.34 },
    portrait: { x: 0.24, y: 0.14, width: 0.52, height: 0.55 },
    square: { x: 0.18, y: 0.18, width: 0.64, height: 0.46 },
    irregular: MARKETING_PRO_PRODUCT_ZONE.square,
  },
  story: {
    landscape: { x: 0.07, y: 0.34, width: 0.86, height: 0.25 },
    portrait: MARKETING_PRO_PRODUCT_ZONE.story,
    square: { x: 0.14, y: 0.20, width: 0.72, height: 0.42 },
    irregular: MARKETING_PRO_PRODUCT_ZONE.story,
  },
};

export function resolveMarketingProProductSafeZone(input: {
  readonly format: MarketingProFormat;
  readonly productUnderstanding?: Pick<ProductVisualUnderstanding, "observed">;
}): MarketingProRect {
  return resolveMarketingProProductPlacement(input).rect;
}

function orientationFromAspectRatio(aspectRatio: number | undefined): ProductVisualUnderstanding["observed"]["productOrientation"] | undefined {
  if (!Number.isFinite(aspectRatio)) return undefined;
  if ((aspectRatio as number) >= 1.2) return "landscape";
  if ((aspectRatio as number) <= 0.82) return "portrait";
  return "square";
}

const FAMILY_PLACEMENT_SCALE: Record<CreativeFamily, number> = {
  luxury: 0.98,
  editorial: 1,
  modern: 1.03,
  minimal: 0.96,
  sensory: 0.98,
  "fresh-premium": 1.02,
  "fresh-sport": 1.06,
  "fresh-commercial": 1.04,
};

const HORIZONTAL_FAMILY_PLACEMENT_SCALE: Record<CreativeFamily, number> = {
  luxury: 1.04,
  editorial: 1.06,
  modern: 1.1,
  minimal: 1.02,
  sensory: 1.04,
  "fresh-premium": 1.08,
  "fresh-sport": 1.12,
  "fresh-commercial": 1.1,
};

export function resolveMarketingProProductPlacement(input: {
  readonly format: MarketingProFormat;
  readonly creativeFamily?: CreativeFamily;
  readonly productUnderstanding?: Pick<ProductVisualUnderstanding, "observed">;
  readonly productOrientation?: ProductVisualUnderstanding["observed"]["productOrientation"];
  readonly productAspectRatio?: number;
}): MarketingProProductPlacement {
  const orientation = input.productOrientation
    || input.productUnderstanding?.observed.productOrientation
    || orientationFromAspectRatio(input.productAspectRatio);
  const rect = orientation ? MARKETING_PRO_ORIENTATION_PRODUCT_ZONE[input.format][orientation] : MARKETING_PRO_PRODUCT_ZONE[input.format];
  const scaleMap = orientation === "landscape" ? HORIZONTAL_FAMILY_PLACEMENT_SCALE : FAMILY_PLACEMENT_SCALE;
  return {
    rect,
    scale: input.creativeFamily ? scaleMap[input.creativeFamily] : 1,
  };
}

/**
 * Geometria canônica das 3 regiões de texto do provider, por formato — PRO-06B0.1 (§9). Antes, a rota
 * do backend enviava `requestedSafeZones: []` (nenhum hint) porque só o client conhecia a geometria
 * precisa de cada campo (nome/preço/benefícios/loja/CTA). Aqui é uma versão mais grosseira e
 * deliberada: são HINTS de background (`guarantee: "requested-only"`, nunca garantia), não a caixa
 * exata de tipografia do compositor local — por isso `primaryText`/`secondaryText` são áreas únicas
 * por região, não uma união de todos os campos que aquela região representa (unir campos distantes,
 * como loja no topo e benefícios embaixo, resultaria numa área tão grande que deixaria de ser um hint
 * útil). Valores derivados das zonas reais que `client/src/lib/marketing-pro.ts` já usa por formato.
 */
export const MARKETING_PRO_TEXT_ZONE: Record<MarketingProFormat, {
  readonly primaryText: MarketingProRect;
  readonly secondaryText: MarketingProRect;
  readonly callToAction: MarketingProRect;
}> = {
  portrait: {
    primaryText: { x: 0.08, y: 0.66, width: 0.84, height: 0.18 },
    secondaryText: { x: 0.08, y: 0.04, width: 0.84, height: 0.08 },
    callToAction: { x: 0.58, y: 0.86, width: 0.34, height: 0.06 },
  },
  square: {
    primaryText: { x: 0.08, y: 0.63, width: 0.84, height: 0.19 },
    secondaryText: { x: 0.08, y: 0.05, width: 0.84, height: 0.08 },
    callToAction: { x: 0.58, y: 0.84, width: 0.34, height: 0.08 },
  },
  story: {
    primaryText: { x: 0.08, y: 0.66, width: 0.84, height: 0.18 },
    secondaryText: { x: 0.08, y: 0.03, width: 0.84, height: 0.07 },
    callToAction: { x: 0.58, y: 0.86, width: 0.34, height: 0.06 },
  },
};

/**
 * Região de layout em termos NEUTROS — não "price"/"productName"/"cta". A ideia de "onde fica o
 * preço" já é, em algum grau, intenção comercial; "área reservada para texto secundário" não é.
 * Mantém o provider-safe boundary sem exigir confiança na leitura de um comentário.
 */
export type MarketingProProviderSafeZoneRegion = "product" | "primaryText" | "secondaryText" | "callToAction";

/**
 * Um HINT, não uma garantia. `guarantee` só aceita o literal "requested-only" — não existe forma de
 * construir um valor deste tipo que alegue geometria garantida. Ver PRO-06B0 §10: prompt/instrução
 * estruturada não é o mesmo que máscara/inpainting; nenhum provider atual garante geometria por
 * instrução textual pura (achado do benchmark de providers, sprint anterior).
 */
export interface MarketingProProviderSafeZoneHint {
  readonly region: MarketingProProviderSafeZoneRegion;
  readonly rect: MarketingProRect;
  readonly guarantee: "requested-only";
}

/**
 * IDs fechados de direção visual — PRO-06B0.1 (P1-1). Antes, `lighting`/`surface`/`atmosphere` eram
 * `string` livre: nada impedia um futuro call site de escrever `lighting: product.description` e
 * compilar normalmente, porque a guarda de campo proibido (`AssertNoForbiddenProviderFields`) só
 * bloqueia por NOME de chave, nunca por VALOR. Trocar para union fechada fecha esse caminho indireto —
 * só um destes 5 valores por campo passa no `tsc`. Um adaptador de provider futuro converte o ID para
 * o texto específico de cada fornecedor; nenhum destes IDs é enviado como prompt literal hoje.
 */
export type MarketingProLightingId = "soft" | "dramatic" | "studio" | "cinematic" | "natural";
export type MarketingProSurfaceId = "clean" | "reflective" | "matte" | "textured" | "pedestal";
export type MarketingProAtmosphereId = "refined" | "structured" | "quiet" | "tactile" | "energetic";

export function isMarketingProLightingId(value: unknown): value is MarketingProLightingId {
  return value === "soft" || value === "dramatic" || value === "studio" || value === "cinematic" || value === "natural";
}

export function isMarketingProSurfaceId(value: unknown): value is MarketingProSurfaceId {
  return value === "clean" || value === "reflective" || value === "matte" || value === "textured" || value === "pedestal";
}

export function isMarketingProAtmosphereId(value: unknown): value is MarketingProAtmosphereId {
  return value === "refined" || value === "structured" || value === "quiet" || value === "tactile" || value === "energetic";
}

/**
 * Direção de arte SEGURA para atravessar a fronteira do provider — o subconjunto da direção de arte
 * comercial completa (definida só no client, ver client/src/lib/marketing-pro.ts) que não carrega
 * dado comercial nem a imagem do produto.
 *
 * P0 estrutural: `AssertNoForbiddenProviderFields` abaixo falha a compilação (`npm run check`) se
 * algum campo proibido for adicionado a esta interface — a garantia não depende de ninguém lembrar de
 * revisar um comentário. `lighting`/`surface`/`atmosphere` fecham o caminho indireto por VALOR (ver
 * comentário acima); só `buildMarketingProProviderArtDirection` (shared/marketing-pro-art-direction.ts)
 * constrói um valor real deste tipo — client, server e benchmark usam essa mesma função central.
 */
export interface MarketingProProviderArtDirection {
  readonly category: MarketingProCategory;
  readonly style: MarketingProStyle;
  readonly format: MarketingProFormat;
  readonly palette: readonly string[];
  readonly lighting: MarketingProLightingId;
  readonly surface: MarketingProSurfaceId;
  readonly atmosphere: MarketingProAtmosphereId;
  /** PRO-14A: hints visuais fechados/nao factuais, derivados de observed/inferred; sem marca, preco, imagem ou claim. */
  readonly visualProductHints?: {
    readonly orientation?: "portrait" | "landscape" | "square" | "irregular";
    readonly brightness?: "very_dark" | "dark" | "balanced" | "light" | "very_light";
    readonly contrast?: "soft" | "medium" | "high";
    readonly silhouette?: "wide-horizontal" | "tall-vertical" | "compact-square" | "irregular";
    readonly heroZoneContrast?: "darker-than-product" | "lighter-than-product" | "neutral-separated";
    readonly avoidSimilarHue?: boolean;
  };
  /** PRO-13: direção fechada do conceito escolhido; nunca texto/prompt arbitrário. */
  readonly creativeFamily?: CreativeFamily;
  readonly requestedSafeZones: readonly MarketingProProviderSafeZoneHint[];
}

/**
 * Guarda de compilação: nomes que NUNCA podem aparecer como chave de `MarketingProProviderArtDirection`
 * (ou de qualquer tipo futuro que a estenda). Se `tsc` falhar aqui, algum campo comercial vazou para o
 * contrato do provider — é o `npm run check` da sprint que pega isso, não revisão manual.
 */
type MarketingProForbiddenProviderFieldNames =
  | "productName" | "productId" | "brand" | "volume" | "description" | "benefits"
  | "price" | "currentPrice" | "previousPrice" | "priceText" | "currentPriceText" | "discountPercent"
  | "cta" | "ctaLabel" | "ctaText"
  | "storeName" | "storeLogoUrl" | "primaryColor"
  | "imageUrl" | "sourceImage" | "productImageUrl" | "photoUrl" | "image" | "imageId";
type AssertNoForbiddenProviderFields<T> =
  Extract<keyof T, MarketingProForbiddenProviderFieldNames> extends never
    ? true
    : { readonly FORBIDDEN_FIELD_LEAKED_INTO_PROVIDER_CONTRACT: Extract<keyof T, MarketingProForbiddenProviderFieldNames> };
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- guarda de compilação, não runtime
const marketingProProviderArtDirectionIsSafe: AssertNoForbiddenProviderFields<MarketingProProviderArtDirection> = true;

export const MARKETING_PRO_CATEGORY_VALUES: readonly MarketingProCategory[] = ["beauty", "electronics", "fashion", "home", "food", "general"];

function normalizeMarketingProCategoryKey(value: unknown): string {
  const raw = typeof value === "string" || typeof value === "number" ? String(value) : "";
  return raw
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 100)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/**
 * Categoria server-authoritative — PRO-06B0.1 (§3/§4). Movida de `client/src/lib/marketing-pro.ts`
 * (onde vivia como `resolveMarketingProCategory`) para aqui, para que o backend resolva a categoria a
 * partir do PRÓPRIO documento do produto (`users/{uid}/products/{productId}.category`), sem depender
 * de client/src/ e sem duplicar esta tabela de aliases em dois lugares. O client reexporta esta mesma
 * função — nenhum import existente precisou mudar de caminho.
 *
 * Nota de limpeza: a tabela original no client também listava variantes acentuadas de cada alias
 * (ex.: "cosméticos" além de "cosmeticos"). Como a chave já passa por `normalizeMarketingProCategoryKey`
 * (que remove acentos via NFD antes de comparar), essas variantes acentuadas nunca eram alcançáveis —
 * nem por `aliases[key]` nem por `key.includes(alias)`, já que `key` nunca contém acento. Removidas
 * aqui por serem mortas por construção; nenhum input reconhecido antes deixou de ser reconhecido.
 */
export function resolveMarketingProCategory(value: unknown): MarketingProCategory {
  const key = normalizeMarketingProCategoryKey(value);
  if (!key) return "general";
  const aliases: Record<string, MarketingProCategory> = {
    beleza: "beauty",
    cosmeticos: "beauty",
    perfumes: "beauty",
    maquiagem: "beauty",
    eletronicos: "electronics",
    tecnologia: "electronics",
    acessorios: "fashion",
    roupas: "fashion",
    moda: "fashion",
    casa: "home",
    decoracao: "home",
    utilidades: "home",
    alimentos: "food",
    comida: "food",
    doces: "food",
  };
  if (aliases[key]) return aliases[key];
  for (const [alias, category] of Object.entries(aliases)) {
    if (key.includes(alias)) return category;
  }
  return "general";
}
