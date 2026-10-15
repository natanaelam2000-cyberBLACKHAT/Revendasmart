/**
 * HOTFIX-P0-D — fonte central de capacidades por businessMode. Antes deste hotfix, businessMode era
 * um campo real e testado (persistido no onboarding, lido em 2 checagens pontuais do dashboard), mas
 * cada tela que precisasse dele teria que reimplementar sua própria versão de "isServicesMode" — o
 * requisito estrutural #5 do ticket ("evitar condicionais espalhadas e contraditórias") pede
 * exatamente uma única fonte, usada por toda tela que precisa adaptar navegação/dashboard/catálogo.
 */
export type BusinessMode = "products" | "services" | "both";
export type BusinessModeResolutionStatus = "loading" | "known" | "legacy-missing" | "error";

export interface BusinessModeResolution {
  readonly status: BusinessModeResolutionStatus;
  readonly mode: BusinessMode | null;
  readonly resolved: boolean;
}

export function isBusinessMode(value: unknown): value is BusinessMode {
  return value === "products" || value === "services" || value === "both";
}

/**
 * PRE-PUBLICATION-F1 — resolver de bootstrap: separa "ainda não carregou" de "legado carregado sem
 * businessMode". `resolveBusinessMode()` continua existindo para consumidores legados/servidor, mas UI
 * que decide navegação durante bootstrap deve usar esta API para nunca transformar loading/erro em Products.
 */
export function resolveBusinessModeBootstrap(input: {
  readonly businessMode: unknown;
  readonly loading?: boolean;
  readonly error?: unknown;
  readonly loaded?: boolean;
}): BusinessModeResolution {
  if (input.error) return { status: "error", mode: null, resolved: false };
  if (input.loading || !input.loaded) return { status: "loading", mode: null, resolved: false };
  if (isBusinessMode(input.businessMode)) return { status: "known", mode: input.businessMode, resolved: true };
  return { status: "legacy-missing", mode: "products", resolved: true };
}

/**
 * Requisito estrutural #3 — um valor ausente (conta nova/pré-onboarding, ver defaultSettings em
 * client/src/lib/mock-data.ts, que deliberadamente omite businessMode) ou um valor legado/corrompido
 * nunca pode quebrar a UI. Trata-se sempre como "products": o modo mais antigo e completo do app, e
 * exatamente o comportamento que toda conta já tinha antes deste campo existir — nunca uma migração
 * silenciosa para um modo que o dono nunca escolheu.
 */
export function resolveBusinessMode(value: unknown): BusinessMode {
  return value === "services" || value === "both" ? value : "products";
}

export interface BusinessModeCapabilities {
  readonly mode: BusinessMode;
  readonly showProducts: boolean;
  readonly showServices: boolean;
  /** Vendas de produto (estoque, /sale, /products). */
  readonly showProductSales: boolean;
  /** Agenda/atendimentos de serviço (/servicos/*). */
  readonly showServiceAgenda: boolean;
  /** SERVICES pede "negócio"/"empresa" em vez de "loja"/"revenda" (CORREÇÕES DE TEXTO E UX). */
  readonly businessNoun: string;
  /**
   * HOTFIX-P0-D (rodada 2) — Clientes e Atendimentos (/clients, /servicos/atendimentos) viram destinos de
   * navegação de primeiro nível para quem presta serviço (mesmo requisito do ticket: "clientes" e
   * "orçamentos/ordens/atendimentos" na nav de SERVICES). PRODUCTS continua exatamente como antes (nenhum
   * destino novo, zero regressão) — quem só vende produto já tinha zero desses dois como item de nav.
   */
  readonly showClientsNav: boolean;
  readonly showServiceWorksNav: boolean;
}

const CAPABILITIES: Record<BusinessMode, BusinessModeCapabilities> = {
  products: { mode: "products", showProducts: true, showServices: false, showProductSales: true, showServiceAgenda: false, businessNoun: "loja", showClientsNav: false, showServiceWorksNav: false },
  services: { mode: "services", showProducts: false, showServices: true, showProductSales: false, showServiceAgenda: true, businessNoun: "negócio", showClientsNav: true, showServiceWorksNav: true },
  both: { mode: "both", showProducts: true, showServices: true, showProductSales: true, showServiceAgenda: true, businessNoun: "negócio", showClientsNav: true, showServiceWorksNav: true },
};

export function getBusinessModeCapabilities(value: unknown): BusinessModeCapabilities {
  return CAPABILITIES[resolveBusinessMode(value)];
}
