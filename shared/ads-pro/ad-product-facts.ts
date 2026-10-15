/**
 * ADS-PRO-FINAL — fatos REAIS do produto para o anúncio (nome, marca, volume, descrição, preço, estoque).
 *
 * Regra de ouro: NUNCA inventar preço. `buildProductTruthFromProduct` (usado pelo fluxo de conceitos)
 * lança quando o produto não tem preço válido; o estúdio precisa seguir funcionando — então aqui um
 * produto sem preço devolve `price: null` e o layout simplesmente não desenha bloco de preço. Promoção
 * só aparece quando existe `promotionalPrice`/`discountPercent` real no cadastro; o percentual exibido é
 * sempre derivado desses dados, nunca digitado por esta camada.
 *
 * Puro: sem DOM, sem Firebase.
 */
import { InvalidProductPriceError, resolveEffectiveProductPrice } from "../product-pricing";
import { resolveMarketingProCategory, type MarketingProCategory } from "../marketing-pro-contract";

export interface AdsProProductInput {
  readonly id: string;
  readonly name: string;
  readonly brand?: unknown;
  readonly category?: unknown;
  readonly salePrice?: unknown;
  readonly promotionalPrice?: unknown;
  readonly discountPercent?: unknown;
  readonly stock?: unknown;
  readonly description?: unknown;
  readonly extras?: Readonly<Record<string, unknown>>;
}

export interface AdsProPriceFacts {
  /** Preço cheio, em centavos. */
  readonly regularCents: number;
  /** Preço efetivo (com promoção ativa, se houver), em centavos. */
  readonly effectiveCents: number;
  readonly hasPromotion: boolean;
  /** Percentual REAL derivado dos dados do cadastro (arredondado); null sem promoção. */
  readonly discountPercent: number | null;
}

export type AdsProAvailability = "in_stock" | "out_of_stock" | "unknown";

export interface AdsProProductFacts {
  readonly productId: string;
  readonly name: string;
  readonly brand?: string;
  readonly volume?: string;
  readonly description?: string;
  readonly category: MarketingProCategory;
  readonly rawCategory?: string;
  readonly price: AdsProPriceFacts | null;
  readonly stock: number | null;
  readonly availability: AdsProAvailability;
}

/**
 * "Sem marca" é uma OPÇÃO do cadastro (nichos oferecem esse valor), não uma marca: anunciar "SEM MARCA" como se
 * fosse o nome da marca seria um defeito visível. Valores que significam "não há marca" saem do anúncio.
 */
const UNBRANDED_LABELS: readonly string[] = ["sem marca", "semmarca", "generico", "generica", "outros", "outras", "outro", "outra", "nao informado", "nao informada", "n/a", "na", "nenhuma", "nenhum", "desconhecida", "desconhecido", "-"];

export function isUnbrandedLabel(value: string): boolean {
  const key = value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9/ -]/g, " ").replace(/\s+/g, " ").trim();
  return key.length === 0 || UNBRANDED_LABELS.includes(key);
}

export function cleanText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  // eslint-disable-next-line no-control-regex
  const normalized = String(value).replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (!normalized) return undefined;
  return normalized.length > maxLength ? `${normalized.slice(0, Math.max(1, maxLength - 1)).trimEnd()}…` : normalized;
}

/** "R$ 1.299,90" com espaço comum (o NBSP do Intl atrapalha medição de texto e comparação em teste). */
export function formatBrlFromCents(cents: number): string {
  const value = Math.round(cents) / 100;
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }).split(String.fromCharCode(160)).join(" ");
}

function readVolume(extras: Readonly<Record<string, unknown>> | undefined): string | undefined {
  if (!extras) return undefined;
  for (const key of ["volume", "volumeText", "volume_ml", "weight", "size", "unit"]) {
    const value = cleanText(extras[key], 40);
    if (value) return key === "volume_ml" && /^\d+(?:[.,]\d+)?$/.test(value) ? `${value} ml` : value;
  }
  return undefined;
}

export function buildAdsProProductFacts(input: AdsProProductInput): AdsProProductFacts {
  const name = cleanText(input.name, 120) ?? "Produto";
  const rawBrand = cleanText(input.brand, 60);
  const brand = rawBrand && !isUnbrandedLabel(rawBrand) ? rawBrand : undefined;
  const description = cleanText(input.description, 240);
  const rawCategory = cleanText(input.category, 80);

  let price: AdsProPriceFacts | null = null;
  try {
    const resolved = resolveEffectiveProductPrice({
      salePrice: input.salePrice,
      promotionalPrice: input.promotionalPrice,
      discountPercent: input.discountPercent,
    });
    price = {
      regularCents: resolved.regularPriceCents,
      effectiveCents: resolved.effectivePriceCents,
      hasPromotion: resolved.hasActivePromotion,
      discountPercent: resolved.hasActivePromotion
        ? Math.round((1 - resolved.effectivePriceCents / resolved.regularPriceCents) * 100)
        : null,
    };
  } catch (error) {
    if (!(error instanceof InvalidProductPriceError)) throw error;
    price = null; // sem preço válido no cadastro => sem preço no anúncio. Nunca um número fabricado.
  }

  const stock = typeof input.stock === "number" && Number.isFinite(input.stock) ? Math.max(0, Math.floor(input.stock)) : null;
  const volume = readVolume(input.extras);

  return {
    productId: String(input.id),
    name,
    ...(brand ? { brand } : {}),
    ...(volume ? { volume } : {}),
    ...(description ? { description } : {}),
    category: resolveMarketingProCategory(rawCategory),
    ...(rawCategory ? { rawCategory } : {}),
    price,
    stock,
    availability: stock === null ? "unknown" : stock > 0 ? "in_stock" : "out_of_stock",
  };
}

/** Linha de apoio padrão (editável): "Marca · volume"; senão a primeira frase da descrição real. */
export function defaultSubtitle(facts: AdsProProductFacts, maxLength = 64): string {
  const parts = [facts.brand, facts.volume].filter((part): part is string => Boolean(part));
  if (parts.length > 0) return clip(parts.join(" · "), maxLength);
  if (!facts.description) return "";
  const firstSentence = facts.description.split(/(?<=[.!?])\s/)[0] ?? facts.description;
  return clip(firstSentence.replace(/[.!?]+$/, ""), maxLength);
}

function clip(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  const cut = value.slice(0, maxLength - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > maxLength * 0.55 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}
