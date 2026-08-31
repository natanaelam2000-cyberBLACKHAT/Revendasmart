/**
 * PRO-07H — monta o payload de renderização para UM estilo Premium, reaproveitando literalmente o
 * sistema de direção de arte/backgrounds já existente (client/src/lib/marketing-pro.ts,
 * client/src/lib/marketing-pro-compositor.ts) e o adapter de cutout aprovado (PRO-07G) — nenhuma cor,
 * gradiente ou posição é inventada aqui além do que §5 pede explicitamente (grounding).
 *
 * O produto (cutout aprovado) e a direção de arte comercial (fundo/decorações/paleta) são montados
 * separadamente e só se encontram no momento do desenho (browser) — nunca nesta função, que não
 * decodifica nem desenha nada.
 */
import path from "node:path";
import zlib from "node:zlib";
import { createHash } from "node:crypto";
import {
  sanitizeMarketingProInput,
  buildMarketingProComposition,
  type MarketingProStyle,
  MARKETING_PRO_FORMATS,
} from "../../client/src/lib/marketing-pro";
import { buildMarketingProVisualProfile } from "../../client/src/lib/marketing-pro-compositor";
import {
  buildApprovedProductCutoutAsset,
  prepareMarketingProCutoutProductImage,
} from "./marketing-pro-cutout-adapter";

/** Só usado como label de `assetRef`/pelos servidores de harness manual (marketing-pro-creative-server.ts
 * e afins, nunca invocados por `npm test`) — quem precisar de um cutout PhotoRoom real para inspeção
 * visual continua gerando este caminho via `tsx script/product-cutout-smoke/cli.ts --execute`. */
export const CUTOUT_PATH = path.join(".tmp", "product-cutout-smoke", "2026-08-17T01-48-05-144Z", "B", "cutout.png");

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBytes = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(Buffer.concat([typeBytes, data])) >>> 0, 0);
  return Buffer.concat([length, typeBytes, data, crc]);
}

/**
 * TEST-FIX-CUTOUT-SMOKE-01 — o smoke local do composer criativo (Node, nunca browser) só usa largura,
 * altura e um hash de conteúdo deste "cutout" (ver buildApprovedProductCutoutAsset/
 * prepareMarketingProCutoutProductImage — nenhuma decodificação de pixel acontece em nenhum lugar deste
 * caminho; a renderização real só existe no harness manual em browser, servida separadamente pelos
 * servidores dedicados a partir de CUTOUT_PATH). Por isso gera um PNG mínimo porém estruturalmente
 * válido, 100% determinístico (mesmos bytes sempre — nenhuma aleatoriedade, nenhum relógio, nenhum
 * arquivo em disco), em vez de depender de um artefato de `.tmp/` gerado manualmente uma única vez via
 * PhotoRoom (nunca versionado, portanto ausente em qualquer clone/worktree limpo). O conteúdo do pixel é
 * irrelevante aqui (transparente, cor sólida) — só a validade estrutural do PNG e a estabilidade do hash
 * importam para este teste.
 */
function buildDeterministicApprovedCutoutPng(): Buffer {
  const width = 100;
  const height = 100;
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA (transparente, coerente com um cutout de fundo removido)
  ihdr[10] = 0; // compression method
  ihdr[11] = 0; // filter method
  ihdr[12] = 0; // interlace method

  const bytesPerPixel = 4;
  const row = Buffer.alloc(1 + width * bytesPerPixel); // 1 byte de filtro (None) + RGBA por pixel
  for (let x = 0; x < width; x += 1) {
    const offset = 1 + x * bytesPerPixel;
    row[offset] = 109; // R — cor decorativa fixa (roxo da marca), sem significado além de ser estável
    row[offset + 1] = 93; // G
    row[offset + 2] = 252; // B
    row[offset + 3] = 0; // A totalmente transparente
  }
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  const idatData = zlib.deflateSync(raw);

  return Buffer.concat([
    signature,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idatData),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Computado uma única vez por processo — determinístico, então cachear é só uma economia de CPU, nunca
 * uma fonte de estado mutável entre chamadas. */
let cachedApprovedCutoutPng: Buffer | undefined;
function getApprovedCutoutPng(): Buffer {
  if (!cachedApprovedCutoutPng) cachedApprovedCutoutPng = buildDeterministicApprovedCutoutPng();
  return cachedApprovedCutoutPng;
}

/** Dados comerciais fixos do smoke local (Coffee Unique) — os MESMOS para as 3 variações. */
const SMOKE_DRAFT = {
  store: { name: "Loja Exemplo", primaryColor: "#6d5dfc" },
  product: { id: "product-cutout-smoke:coffee-unique", name: "Coffee Unique", category: "perfumes", brand: "O Boticário" },
  offer: { currentPrice: 189.9, availability: "available" as const },
  benefits: ["Fragrância marcante", "Fixação prolongada"],
  cta: { label: "Comprar agora", action: "whatsapp" as const },
  format: "portrait" as const,
};

export interface MarketingProCreativePayload {
  readonly style: MarketingProStyle;
  readonly asset: ReturnType<typeof buildApprovedProductCutoutAsset>;
  readonly transform: ReturnType<typeof prepareMarketingProCutoutProductImage>["transform"];
  readonly safeZones: (typeof MARKETING_PRO_FORMATS)["portrait"]["safeZones"];
  readonly profile: ReturnType<typeof buildMarketingProVisualProfile>;
  readonly overlay: {
    readonly storeName: string;
    readonly productName: string;
    readonly brand?: string;
    readonly priceText: string;
    readonly benefits: readonly string[];
    readonly ctaLabel: string;
  };
}

/**
 * §1: o cutout aprovado é sempre o MESMO arquivo, para qualquer estilo — o hash de conteúdo (usado no
 * assetId) nunca varia com `style`. §2/§3: fundo/decorações vêm de `buildMarketingProVisualProfile`
 * (sistema real já existente); posições de texto vêm de `MARKETING_PRO_FORMATS.portrait.safeZones`
 * (tokens canônicos já existentes) — nada hardcoded aqui além dos dados comerciais fixos do smoke.
 */
export function buildMarketingProCreativePayload(style: MarketingProStyle): MarketingProCreativePayload {
  const cutoutBytes = getApprovedCutoutPng();
  const width = cutoutBytes.readUInt32BE(16);
  const height = cutoutBytes.readUInt32BE(20);
  const contentHash = createHash("sha256").update(cutoutBytes).digest("hex");

  const asset = buildApprovedProductCutoutAsset({
    productId: SMOKE_DRAFT.product.id,
    cutoutContentHash: `sha256:${contentHash}`,
    width,
    height,
    // Nunca CUTOUT_PATH aqui: os bytes vêm de getApprovedCutoutPng() (gerados em memória), não de disco —
    // assetRef precisa continuar honesto sobre a origem real.
    assetRef: "product-cutout-smoke:deterministic-fixture",
  });
  const prepared = prepareMarketingProCutoutProductImage({ asset, format: SMOKE_DRAFT.format });

  const input = sanitizeMarketingProInput({ ...SMOKE_DRAFT, style });
  const composition = buildMarketingProComposition(input);
  const profile = buildMarketingProVisualProfile(input, composition.artDirection);

  return {
    style,
    asset: prepared.asset,
    transform: prepared.transform,
    safeZones: MARKETING_PRO_FORMATS.portrait.safeZones,
    profile,
    overlay: {
      storeName: composition.commercialOverlay.storeName,
      productName: composition.commercialOverlay.productName,
      brand: composition.commercialOverlay.brand,
      priceText: composition.commercialOverlay.currentPriceText,
      benefits: composition.commercialOverlay.benefits,
      ctaLabel: composition.commercialOverlay.cta.label,
    },
  };
}
