/**
 * ADS-PRO-FINAL — geração DETERMINÍSTICA de variações realmente diferentes do anúncio.
 *
 * Cada variação combina um estilo (perfil do vendedor + vizinhos), um arquétipo de composição, um fundo
 * escolhido pelo matcher (Creative DNA / manifest de produção), tipografia, hierarquia, CTA, estilo do preço
 * e decoração próprios — nunca "o mesmo anúncio com outra cor". Os dados do produto (nome, preço, estoque)
 * são idênticos em todas: só a direção de arte muda, e preço inexistente continua inexistente.
 *
 * Mesmo input => mesmas variações, na mesma ordem (sem aleatoriedade, sem relógio, sem I/O): reproduzível
 * para teste. `round` gira de forma determinística as escolhas para "gerar outras opções".
 */
import type { MarketingProStyle } from "../marketing-pro-contract";
import type { MarketingCampaignIntentId } from "../marketing-pro-creative-intelligence";
import { rankAdsProAssets, type AssetMatchResult } from "./asset-matcher";
import type { AssetLibraryManifest } from "./asset-dna";
import { resolveAssetMatchContext } from "./creative-profile";
import { ADS_PRO_PRODUCTION_MANIFEST } from "./production-manifest";
import { MARKETING_PRO_BACKGROUND_LIBRARY, resolveMarketingProBackground, type MarketingProBackgroundAsset } from "../marketing-pro-background-library";
import { backdropColorsOfAsset, toDocumentBackground } from "./ad-backdrop";
import { resolveInkForBackdrop, MIN_TEXT_CONTRAST } from "./ad-contrast";
import { AUDIT_BUCKET_SLUGS, classifyBucket } from "./background-audit";
import {
  createAdsProDocument,
  type AdsProAdDocumentV1,
  type AdsProFormat,
  type AdsProPhotoAdjust,
  type AdsProPhotoState,
} from "./ad-document";
import type { AdsProProductFacts } from "./ad-product-facts";
import {
  ADS_PRO_ADJACENT_STYLES,
  ADS_PRO_ARCHETYPE_LABELS,
  resolveAdsProStyleDirection,
  type AdsProCtaShape,
  type AdsProDecoration,
  type AdsProIntensity,
  type AdsProLayoutArchetype,
  type AdsProPriceStyle,
  type AdsProSpacing,
  type AdsProStyleDirection,
} from "./ad-style-direction";

export const ADS_PRO_ALL_STYLES: readonly MarketingProStyle[] = ["luxury", "editorial", "minimal", "sensory", "modern"];
export const ADS_PRO_MIN_VARIATIONS = 3;
export const ADS_PRO_MAX_VARIATIONS = 5;

export interface GenerateAdsProVariationsInput {
  readonly facts: AdsProProductFacts;
  /** Estilos preferidos do perfil, em ordem de prioridade. Vazio/ausente = sem perfil. */
  readonly preferredStyles?: readonly MarketingProStyle[];
  readonly intent: MarketingCampaignIntentId;
  readonly format: AdsProFormat;
  readonly storeName: string;
  readonly accent?: string;
  readonly photoMode?: AdsProPhotoState["mode"];
  readonly photoAdjust?: AdsProPhotoAdjust;
  readonly intensityOverride?: AdsProIntensity;
  /** Manifest de produção: único insumo do matcher. Padrão: o manifest canônico. */
  readonly manifest?: AssetLibraryManifest;
  /** Biblioteca correspondente ao manifest (para resolver o asset visual). */
  readonly library?: readonly MarketingProBackgroundAsset[];
  readonly count?: number;
  /** 0 = primeiras opções; incrementar gira as escolhas de forma determinística ("gerar outras opções"). */
  readonly round?: number;
}

export interface AdsProVariationRationale {
  readonly style: MarketingProStyle;
  readonly archetype: AdsProLayoutArchetype;
  readonly backgroundId: string;
  readonly categoryAffinity: AssetMatchResult["breakdown"]["categoryAffinity"];
  readonly styleAffinity: AssetMatchResult["breakdown"]["styleAffinity"];
  /** O fundo pertence ao mesmo balde comercial do produto (ex.: doces)? */
  readonly bucketMatch: boolean;
  /** Fonte do estilo: o perfil do vendedor ou a sugestão da categoria. */
  readonly styleFromProfile: boolean;
}

export interface AdsProVariation {
  readonly id: string;
  readonly label: string;
  readonly role: AdsProVariationRole;
  /** Texto curto para a UI: "Fiel ao seu estilo" / "Mais destaque" / "Mais sutil". */
  readonly roleLabel: string;
  readonly doc: AdsProAdDocumentV1;
  readonly rationale: AdsProVariationRationale;
}

const VARIATION_IDS = ["A", "B", "C", "D", "E"] as const;

function uniqueStyles(styles: readonly MarketingProStyle[]): MarketingProStyle[] {
  return styles.filter((style, index) => styles.indexOf(style) === index);
}

/** Plano de estilos: A = perfil; B/C... = demais estilos do perfil, depois vizinhos, depois o resto. */
export function planVariationStyles(primary: MarketingProStyle, profileStyles: readonly MarketingProStyle[], count: number, round: number): MarketingProStyle[] {
  const ordered = uniqueStyles([
    primary,
    ...profileStyles,
    ...ADS_PRO_ADJACENT_STYLES[primary],
    ...ADS_PRO_ALL_STYLES,
  ]);
  const head = ordered[0];
  const tail = ordered.slice(1);
  // round gira só a cauda: o estilo do perfil sempre lidera a primeira variação.
  const rotation = tail.length > 0 ? ((round % tail.length) + tail.length) % tail.length : 0;
  return [head, ...tail.slice(rotation), ...tail.slice(0, rotation)].slice(0, count);
}

function pickDistinct<T>(candidates: readonly T[], used: readonly T[], offset: number): T {
  const free = candidates.filter((candidate) => !used.includes(candidate));
  const pool = free.length > 0 ? free : candidates;
  return pool[((offset % pool.length) + pool.length) % pool.length];
}

function bucketSlugOfFacts(facts: AdsProProductFacts): string {
  return AUDIT_BUCKET_SLUGS[classifyBucket([facts.rawCategory ?? "", facts.name]).bucket];
}

interface RankedBackground {
  /** Patamar do matcher (categoria|objetivo): a rotação de "outras opções" nunca sai do melhor patamar. */
  readonly tier: string;
  readonly result: AssetMatchResult;
  readonly asset: MarketingProBackgroundAsset;
  readonly bucketMatch: boolean;
  readonly legible: boolean;
}

/**
 * Rankeia os fundos do manifest para a variação: matcher (categoria > objetivo > estilo > id) e, DENTRO do
 * mesmo patamar de categoria/objetivo, prefere o fundo do mesmo balde comercial do produto e legível.
 */
function rankBackgrounds(input: GenerateAdsProVariationsInput, manifest: AssetLibraryManifest, library: readonly MarketingProBackgroundAsset[], styleOrder: readonly MarketingProStyle[]): RankedBackground[] {
  const context = resolveAssetMatchContext(
    { entityKind: "product", format: input.format, category: input.facts.category, intent: input.intent },
    { schemaVersion: 1, preferredStyles: uniqueStyles(styleOrder) },
  );
  const productBucket = bucketSlugOfFacts(input.facts);
  const byId = new Map(library.map((asset) => [asset.id, asset] as const));
  const ranked: RankedBackground[] = [];
  for (const result of rankAdsProAssets(manifest, context)) {
    const asset = byId.get(result.asset.id);
    if (!asset) continue; // só vale o que o manifest aprovado E a biblioteca conhecem (nunca um id solto)
    ranked.push({
      tier: `${result.breakdown.categoryAffinity}|${result.breakdown.intentAffinity}`,
      result,
      asset,
      bucketMatch: (asset.tags ?? []).includes(`bucket:${productBucket}`),
      legible: resolveInkForBackdrop(backdropColorsOfAsset(asset)).minContrast >= MIN_TEXT_CONTRAST || asset.sourceType === "STATIC_ASSET",
    });
  }
  const tierOrder: string[] = [];
  for (const item of ranked) if (!tierOrder.includes(item.tier)) tierOrder.push(item.tier);
  return [...ranked].sort((a, b) => {
    const tierDiff = tierOrder.indexOf(a.tier) - tierOrder.indexOf(b.tier);
    if (tierDiff !== 0) return tierDiff;
    if (a.legible !== b.legible) return a.legible ? -1 : 1;
    if (a.bucketMatch !== b.bucketMatch) return a.bucketMatch ? -1 : 1;
    return ranked.indexOf(a) - ranked.indexOf(b); // mantém a ordem do matcher (estilo > id)
  });
}

/**
 * Papéis das variações — o que faz as opções serem de fato diferentes e não "o mesmo anúncio em outra cor":
 *   A "Fiel ao seu estilo"  : a receita do perfil como ela é;
 *   B "Mais destaque"       : mais intensidade, preço e botão em evidência, espaçamento mais apertado;
 *   C "Mais sutil"          : menos intensidade, produto em primeiro lugar, preço e botão discretos, mais respiro.
 * (4ª/5ª opções voltam a ser "fiéis", cada uma à receita de outro estilo vizinho.)
 */
export type AdsProVariationRole = "faithful" | "bold" | "subtle";
const VARIATION_ROLES: readonly AdsProVariationRole[] = ["faithful", "bold", "subtle", "faithful", "faithful"];
export const ADS_PRO_VARIATION_ROLE_LABELS: Readonly<Record<AdsProVariationRole, string>> = Object.freeze({
  faithful: "Fiel ao seu estilo",
  bold: "Mais destaque",
  subtle: "Mais sutil",
});

const PRICE_POOL: Readonly<Record<AdsProVariationRole, readonly AdsProPriceStyle[]>> = {
  faithful: ["plain", "underline", "badge", "stamp"],
  bold: ["stamp", "badge"],
  subtle: ["plain", "underline"],
};
const CTA_POOL: Readonly<Record<AdsProVariationRole, readonly AdsProCtaShape[]>> = {
  faithful: ["outline", "link", "soft", "pill", "bar"],
  bold: ["pill", "bar"],
  subtle: ["soft", "outline", "link"],
};

/** Mantém o valor próprio do papel quando ainda não foi usado; senão escolhe outro do mesmo "volume" (pool do papel). */
function pickUnused<T>(own: T, pool: readonly T[], used: readonly T[]): T {
  const candidate = pool.includes(own) ? own : pool[0];
  if (!used.includes(candidate)) return candidate;
  return pool.find((value) => !used.includes(value)) ?? candidate;
}

const SPACING_ORDER: readonly AdsProSpacing[] = ["airy", "standard", "compact"];

function applyVariationRole(direction: AdsProStyleDirection, role: AdsProVariationRole, hasPrice: boolean, intensityLocked: boolean): AdsProStyleDirection {
  if (role === "faithful") return direction;
  const spacingIndex = SPACING_ORDER.indexOf(direction.spacing);
  if (role === "bold") {
    const loud: readonly AdsProPriceStyle[] = ["badge", "stamp"];
    const priceStyle: AdsProPriceStyle = direction.priceStyle === "badge" ? "stamp" : direction.priceStyle === "stamp" || direction.priceStyle === "burst" ? "badge" : "badge";
    const shape: AdsProCtaShape = direction.cta.shape === "bar" ? "pill" : direction.cta.shape === "pill" ? "bar" : "pill";
    return {
      ...direction,
      intensity: intensityLocked ? direction.intensity : (Math.min(3, direction.intensity + 1) as AdsProIntensity),
      hierarchy: hasPrice ? "price-first" : "name-first",
      spacing: SPACING_ORDER[Math.min(SPACING_ORDER.length - 1, spacingIndex + 1)],
      priceStyle: loud.includes(priceStyle) ? priceStyle : "badge",
      cta: { shape, size: "lg", uppercase: direction.cta.uppercase },
    };
  }
  // subtle
  const shape: AdsProCtaShape = direction.cta.shape === "outline" ? "soft" : direction.cta.shape === "soft" ? "link" : "outline";
  return {
    ...direction,
    intensity: intensityLocked ? direction.intensity : (Math.max(1, direction.intensity - 1) as AdsProIntensity),
    hierarchy: "product-first",
    spacing: SPACING_ORDER[Math.max(0, spacingIndex - 1)],
    priceStyle: direction.priceStyle === "underline" ? "plain" : "underline",
    cta: { shape, size: "sm", uppercase: false },
  };
}

export function generateAdsProVariations(input: GenerateAdsProVariationsInput): readonly AdsProVariation[] {
  const count = Math.min(ADS_PRO_MAX_VARIATIONS, Math.max(ADS_PRO_MIN_VARIATIONS, Math.floor(input.count ?? ADS_PRO_MIN_VARIATIONS)));
  const round = Math.max(0, Math.floor(input.round ?? 0));
  const manifest = input.manifest ?? ADS_PRO_PRODUCTION_MANIFEST;
  const library = input.library ?? MARKETING_PRO_BACKGROUND_LIBRARY;
  const profileStyles = input.preferredStyles ?? [];

  const base = resolveAdsProStyleDirection({ preferredStyles: profileStyles, intent: input.intent, category: input.facts.category, intensityOverride: input.intensityOverride });
  const styles = planVariationStyles(base.primaryStyle, profileStyles, count, round);
  const hasPrice = input.facts.price !== null;

  const usedArchetypes: AdsProLayoutArchetype[] = [];
  const usedDecorations: AdsProDecoration[] = [];
  const usedBackgrounds: string[] = [];
  const usedPriceStyles: AdsProPriceStyle[] = [];
  const usedCtaShapes: AdsProCtaShape[] = [];
  const variations: AdsProVariation[] = [];

  styles.forEach((style, index) => {
    const role = VARIATION_ROLES[index];
    const roleDirection: AdsProStyleDirection = applyVariationRole(
      resolveAdsProStyleDirection({
        preferredStyles: uniqueStyles([style, ...profileStyles]),
        intent: input.intent,
        category: input.facts.category,
        styleOverride: style,
        intensityOverride: input.intensityOverride,
      }),
      role,
      hasPrice,
      input.intensityOverride !== undefined,
    );
    // Preço e botão são os eixos mais visíveis para o vendedor: nunca se repetem entre as opções.
    const priceStyle = pickUnused(roleDirection.priceStyle, PRICE_POOL[role], usedPriceStyles);
    const ctaShape = pickUnused(roleDirection.cta.shape, CTA_POOL[role], usedCtaShapes);
    usedPriceStyles.push(priceStyle);
    usedCtaShapes.push(ctaShape);
    const direction: AdsProStyleDirection = { ...roleDirection, priceStyle, cta: { ...roleDirection.cta, shape: ctaShape } };

    const archetypeCandidates = direction.archetypes.filter((candidate) => hasPrice || candidate !== "price-burst");
    const archetype = pickDistinct(archetypeCandidates, usedArchetypes, round);
    usedArchetypes.push(archetype);
    const decoration = pickDistinct(direction.decorations, usedDecorations, round);
    usedDecorations.push(decoration);

    const ranked = rankBackgrounds(input, manifest, library, [style, ...ADS_PRO_ADJACENT_STYLES[style], ...profileStyles]);
    const free = ranked.filter((candidate) => !usedBackgrounds.includes(candidate.asset.id));
    const pool = free.length > 0 ? free : ranked;
    // round > 0 gira DENTRO do melhor patamar do matcher: outras opções, mesma adequação à categoria.
    const bestTier = pool.filter((candidate) => candidate.tier === pool[0]?.tier);
    const chosen = bestTier.length > 0 ? bestTier[round % bestTier.length] : undefined;
    // Biblioteca/manifest sem nenhum fundo elegível NUNCA derruba o fluxo: usa o fundo embutido de último recurso.
    const chosenAsset = chosen?.asset
      ?? resolveMarketingProBackground({ creativeFamily: style, category: input.facts.category, format: input.format, seed: input.facts.productId, library: [] }).asset;
    usedBackgrounds.push(chosenAsset.id);

    const doc = createAdsProDocument({
      facts: input.facts,
      direction,
      archetype,
      decoration,
      format: input.format,
      background: toDocumentBackground(chosenAsset),
      variationId: VARIATION_IDS[index],
      storeName: input.storeName,
      accent: input.accent,
      photoMode: input.photoMode,
      photoAdjust: input.photoAdjust,
    });
    variations.push({
      id: VARIATION_IDS[index],
      label: `Opção ${VARIATION_IDS[index]}`,
      role,
      roleLabel: ADS_PRO_VARIATION_ROLE_LABELS[role],
      doc,
      rationale: {
        style,
        archetype,
        backgroundId: chosenAsset.id,
        categoryAffinity: chosen?.result.breakdown.categoryAffinity ?? "neutral",
        styleAffinity: chosen?.result.breakdown.styleAffinity ?? "none",
        bucketMatch: chosen?.bucketMatch ?? false,
        styleFromProfile: base.styleSource === "profile" && (index === 0 || profileStyles.includes(style)),
      },
    });
  });
  return variations;
}

export function describeVariationLayout(archetype: AdsProLayoutArchetype): string {
  return ADS_PRO_ARCHETYPE_LABELS[archetype];
}
