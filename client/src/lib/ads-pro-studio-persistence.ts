/**
 * ADS-PRO-FINAL — salvar / reabrir projetos do estúdio no MESMO histórico de anúncios já existente
 * (`users/{uid}/marketingHistory`, ONE_MARKETING_HISTORY_SYSTEM), nunca numa coleção paralela.
 *
 * O que é gravado:
 *  - o PNG final, enviado ao endpoint de upload existente (`kind: "marketing-pro-ad"`, caminho fixo por
 *    `entryId` => reenviar SOBRESCREVE em vez de duplicar);
 *  - a identidade do fundo (`proBackground`) e o documento editável (`proDocument`, JSON curto com as
 *    DECISÕES — nunca pixels), que permite reabrir e continuar editando.
 *
 * Idempotência: o `entryId` é decidido UMA vez por projeto. Repetir "Salvar" (retry, duplo toque, edição
 * posterior) nunca cria uma segunda entrada: a primeira vez cria, as seguintes atualizam a mesma.
 * Honestidade: o resultado diz exatamente o que foi salvo (nuvem completa, só a imagem, só neste aparelho).
 */
import type { Product } from "@/lib/mock-data";
import type { MarketingHistoryEntry, NewMarketingEntry } from "@/hooks/useMarketingHistory";
import type { ServerUploadResult } from "@/lib/server-upload";
import { parseAdsProDocument, serializeAdsProDocument, type AdsProAdDocumentV1 } from "@shared/ads-pro/ad-document";

export const ADS_PRO_STUDIO_COMPOSER_VERSION = 2 as const;

export interface StudioBranding {
  readonly storeName: string;
  readonly storeLogoUrl?: string;
  readonly primaryColor?: string;
}

export interface BuildStudioEntryInput {
  readonly doc: AdsProAdDocumentV1;
  readonly product: Pick<Product, "id" | "name" | "brand" | "imageUrl">;
  readonly branding: StudioBranding;
  readonly imageUrl: string;
  readonly includeProject: boolean;
}

export function buildStudioHistoryEntry(input: BuildStudioEntryInput): NewMarketingEntry {
  const { doc, product, branding } = input;
  const backgroundSource = doc.background.source;
  const entry: NewMarketingEntry = {
    action: "generated",
    mode: "pro",
    composerVersion: ADS_PRO_STUDIO_COMPOSER_VERSION,
    creativeFamily: doc.direction.style,
    creativeConceptId: `studio:${doc.variationId}:${doc.direction.archetype}`.slice(0, 80),
    format: doc.format,
    productId: product.id,
    productName: doc.text.headline.trim() || product.name,
    ...(typeof product.brand === "string" && product.brand ? { productBrand: product.brand } : {}),
    ...(typeof product.imageUrl === "string" && product.imageUrl ? { productImageUrl: product.imageUrl } : {}),
    imageUrl: input.imageUrl,
    generatedText: "",
    template: "pro-ad",
    price: doc.show.price ? doc.text.priceText.trim() : "",
    priceText: doc.show.price ? doc.text.priceText.trim() : "",
    headline: doc.text.headline.trim(),
    ctaText: doc.show.cta ? doc.text.ctaText.trim() : "",
    storeName: branding.storeName || "",
    ...(branding.storeLogoUrl ? { storeLogoUrl: branding.storeLogoUrl } : {}),
    primaryColor: branding.primaryColor || "#111827",
    proBackground: {
      sourceType: backgroundSource,
      backgroundId: doc.background.id,
      backgroundVersion: doc.background.version,
      backgroundFamily: doc.background.family.slice(0, 40),
    },
    ...(input.includeProject ? { proDocument: serializeAdsProDocument(doc) } : {}),
  };
  return entry;
}

/** Lê o documento editável de uma entrada do histórico. `null` quando a entrada não é do estúdio ou está corrompida. */
export function readStudioDocumentFromEntry(entry: Pick<MarketingHistoryEntry, "mode" | "proDocument">): AdsProAdDocumentV1 | null {
  if (entry.mode !== "pro" || typeof entry.proDocument !== "string" || entry.proDocument.length === 0) return null;
  const parsed = parseAdsProDocument(entry.proDocument);
  return parsed.ok ? parsed.doc : null;
}

export type StudioSaveStatus =
  /** Imagem + histórico + projeto editável na nuvem. */
  | "saved"
  /** Imagem e histórico na nuvem, mas o projeto editável não pôde ser guardado (não dá para reabrir editando). */
  | "saved-without-project"
  /** Imagem na nuvem; histórico só neste aparelho. */
  | "saved-local"
  | "failed";

export type StudioSaveFailure = "no-auth" | "upload-failed";

export interface StudioSaveResult {
  readonly status: StudioSaveStatus;
  readonly entryId: string;
  readonly imageUrl?: string;
  readonly failure?: StudioSaveFailure;
  /** O documento remoto já existe (próximos salvamentos atualizam em vez de criar). */
  readonly remoteExists: boolean;
}

export interface StudioSaveDeps {
  readonly getToken: () => Promise<string | undefined>;
  readonly upload: (input: { kind: "marketing-pro-ad"; targetId: string; blob: Blob; token: string }) => Promise<ServerUploadResult>;
  readonly recordAction: (entry: NewMarketingEntry, explicitId?: string) => Promise<{ readonly id: string; readonly persisted: boolean }>;
  readonly updateEntry: (id: string, patch: Partial<NewMarketingEntry>) => Promise<boolean>;
}

export interface StudioSaveInput {
  readonly entryId: string;
  readonly doc: AdsProAdDocumentV1;
  readonly png: Blob;
  readonly product: BuildStudioEntryInput["product"];
  readonly branding: StudioBranding;
  /** O registro remoto desta entrada já foi criado antes? */
  readonly remoteExists: boolean;
}

export async function saveStudioProject(input: StudioSaveInput, deps: StudioSaveDeps): Promise<StudioSaveResult> {
  const token = await deps.getToken();
  if (!token) return { status: "failed", entryId: input.entryId, failure: "no-auth", remoteExists: input.remoteExists };

  let upload: ServerUploadResult;
  try {
    upload = await deps.upload({ kind: "marketing-pro-ad", targetId: input.entryId, blob: input.png, token });
  } catch {
    // Sem imagem na nuvem não há o que registrar: nada é gravado no histórico (nenhum registro "fantasma").
    return { status: "failed", entryId: input.entryId, failure: "upload-failed", remoteExists: input.remoteExists };
  }

  const writeOnce = async (includeProject: boolean): Promise<boolean> => {
    const entry = buildStudioHistoryEntry({ doc: input.doc, product: input.product, branding: input.branding, imageUrl: upload.downloadUrl, includeProject });
    if (input.remoteExists) return deps.updateEntry(input.entryId, entry);
    const result = await deps.recordAction(entry, input.entryId);
    return result.persisted;
  };

  if (await writeOnce(true)) return { status: "saved", entryId: input.entryId, imageUrl: upload.downloadUrl, remoteExists: true };
  // Falhou (ex.: regras ainda sem o campo `proDocument`, ou sem rede): tenta registrar ao menos a imagem.
  if (await writeOnce(false)) return { status: "saved-without-project", entryId: input.entryId, imageUrl: upload.downloadUrl, remoteExists: true };
  // Nada chegou ao Firestore. A cópia LOCAL (que o hook mantém) deve ficar com o projeto editável: na criação o
  // hook substitui a entrada otimista a cada chamada, então a última chamada precisa ser a que tem o projeto.
  if (!input.remoteExists) await writeOnce(true);
  return { status: "saved-local", entryId: input.entryId, imageUrl: upload.downloadUrl, remoteExists: input.remoteExists };
}

export const STUDIO_SAVE_MESSAGES: Readonly<Record<StudioSaveStatus, string>> = Object.freeze({
  saved: "Anúncio salvo. Você pode reabrir e continuar editando.",
  "saved-without-project": "Imagem salva no histórico, mas não foi possível guardar a edição deste anúncio agora.",
  "saved-local": "Imagem enviada, mas o histórico só foi salvo neste aparelho. Tente salvar de novo quando estiver online.",
  failed: "Não foi possível salvar agora. Seu anúncio continua aberto — tente novamente.",
});
