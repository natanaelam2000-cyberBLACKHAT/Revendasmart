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
import fs from "node:fs";
import path from "node:path";
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

export const CUTOUT_PATH = path.join(".tmp", "product-cutout-smoke", "2026-08-17T01-48-05-144Z", "B", "cutout.png");

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
  const cutoutBytes = fs.readFileSync(CUTOUT_PATH);
  const width = cutoutBytes.readUInt32BE(16);
  const height = cutoutBytes.readUInt32BE(20);
  const contentHash = createHash("sha256").update(cutoutBytes).digest("hex");

  const asset = buildApprovedProductCutoutAsset({
    productId: SMOKE_DRAFT.product.id,
    cutoutContentHash: `sha256:${contentHash}`,
    width,
    height,
    assetRef: CUTOUT_PATH,
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
