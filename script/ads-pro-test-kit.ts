/**
 * ADS-PRO-FINAL — utilitários compartilhados pelos testes do estúdio (sem DOM, sem rede).
 */
import { buildAdsProProductFacts, type AdsProProductFacts, type AdsProProductInput } from "../shared/ads-pro/ad-product-facts";
import { generateAdsProVariations, type GenerateAdsProVariationsInput } from "../shared/ads-pro/ad-variations";
import { computeAdLayout, type AdLayout } from "../shared/ads-pro/ad-layout";
import { resolveAdsProBackdrop } from "../shared/ads-pro/ad-backdrop";
import { createEstimateMeasurer } from "../shared/ads-pro/ad-text-fit";
import type { AdsProAdDocumentV1 } from "../shared/ads-pro/ad-document";

export const estimateMeasure = createEstimateMeasurer();

let checks = 0;
export async function check(name: string, run: () => void | Promise<void>): Promise<void> {
  await run();
  checks += 1;
  console.log(`PASS ${name}`);
}
export function checkCount(): number { return checks; }

/** LCG determinístico (sem Math.random) para varreduras reproduzíveis. */
export function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

export const PRODUCT_PERFUME: AdsProProductInput = {
  id: "prod-perfume",
  name: "Perfume Luna Eau de Parfum Intense",
  brand: "Maison Luna",
  category: "Perfumes",
  salePrice: 349.9,
  discountPercent: 15,
  stock: 3,
  description: "Fragrância floral amadeirada de longa duração.",
  extras: { volume: "100 ml" },
};

export const PRODUCT_NO_PRICE: AdsProProductInput = {
  id: "prod-sem-preco",
  name: "Caixa de Som Bluetooth",
  brand: "SonoMax",
  category: "Eletrônicos",
  salePrice: 0,
  stock: 12,
  description: "Som potente para qualquer lugar.",
};

export const PRODUCT_SWEETS: AdsProProductInput = {
  id: "prod-bolo",
  name: "Bolo de Pote de Brigadeiro",
  category: "Doces",
  salePrice: 12.5,
  stock: 40,
};

export const PRODUCT_HOME: AdsProProductInput = {
  id: "prod-vaso",
  name: "Vaso Decorativo Cerâmica",
  category: "Casa e Decoração",
  salePrice: 89.9,
  stock: 8,
};

export function factsOf(input: AdsProProductInput): AdsProProductFacts {
  return buildAdsProProductFacts(input);
}

export function variationsFor(input: AdsProProductInput, overrides: Partial<GenerateAdsProVariationsInput> = {}) {
  return generateAdsProVariations({
    facts: factsOf(input),
    preferredStyles: [],
    intent: "spotlight",
    format: "portrait",
    storeName: "Loja da Ana",
    ...overrides,
  });
}

export function layoutOf(doc: AdsProAdDocumentV1, hasLogo = true): AdLayout {
  const backdrop = resolveAdsProBackdrop(doc.background, doc.format);
  return computeAdLayout({ doc, measure: estimateMeasure, backdrop: { colors: backdrop.colors, forceScrim: backdrop.forceScrim }, hasLogo });
}

export function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value as object)) deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value;
}
