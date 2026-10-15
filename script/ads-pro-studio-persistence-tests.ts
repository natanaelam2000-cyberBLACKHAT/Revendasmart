/**
 * ADS-PRO-FINAL — salvar/reabrir/exportar/compartilhar do estúdio com dependências falsas (sem rede/Firebase):
 * retry idempotente, honestidade do resultado, projeto editável que sobrevive ao ciclo salvar -> reabrir.
 */
import assert from "node:assert/strict";
import { MarketingFileOperationError, MarketingShareCancelledError } from "../client/src/lib/marketing-share";
import {
  ADS_PRO_STUDIO_COMPOSER_VERSION,
  STUDIO_SAVE_MESSAGES,
  buildStudioHistoryEntry,
  readStudioDocumentFromEntry,
  saveStudioProject,
  type StudioSaveDeps,
} from "../client/src/lib/ads-pro-studio-persistence";
import { downloadStudioAd, shareStudioAd } from "../client/src/lib/ads-pro-studio-export";
import type { MarketingHistoryEntry, NewMarketingEntry } from "../client/src/hooks/useMarketingHistory";
import { ADS_PRO_DOCUMENT_MAX_SERIALIZED_LENGTH, withText } from "../shared/ads-pro/ad-document";
import { PRODUCT_PERFUME, check, checkCount, variationsFor } from "./ads-pro-test-kit";

const product = { id: PRODUCT_PERFUME.id, name: PRODUCT_PERFUME.name, brand: "Maison Luna", imageUrl: "https://exemplo.test/foto.jpg" };
const branding = { storeName: "Loja da Ana", primaryColor: "#EC4899" };
const png = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: "image/png" });

interface FakeBackend {
  readonly deps: StudioSaveDeps;
  readonly remote: Map<string, NewMarketingEntry>;
  readonly local: Map<string, NewMarketingEntry>;
  readonly uploads: { targetId: string; kind: string }[];
  readonly calls: string[];
  options: { online: boolean; rulesKnowProDocument: boolean; uploadOk: boolean; token: string | undefined };
}

/** Backend falso fiel ao comportamento real: upsert por id no local; regras recusam campo desconhecido. */
function createBackend(initial: Partial<FakeBackend["options"]> = {}): FakeBackend {
  const remote = new Map<string, NewMarketingEntry>();
  const local = new Map<string, NewMarketingEntry>();
  const uploads: { targetId: string; kind: string }[] = [];
  const calls: string[] = [];
  const options = { online: true, rulesKnowProDocument: true, uploadOk: true, token: "token-ok" as string | undefined, ...initial };
  const accepted = (entry: Partial<NewMarketingEntry>) => options.online && (options.rulesKnowProDocument || !("proDocument" in entry));
  const deps: StudioSaveDeps = {
    getToken: async () => options.token,
    upload: async ({ kind, targetId }) => {
      calls.push(`upload:${targetId}`);
      uploads.push({ kind, targetId });
      if (!options.uploadOk) throw new Error("upload recusado");
      return { storagePath: `users/u/marketing-pro-ads/${targetId}/ad.png`, downloadUrl: `https://storage.test/${targetId}/ad.png`, width: 1080, height: 1350, deduplicated: false };
    },
    recordAction: async (entry, explicitId) => {
      const id = explicitId ?? "gerado";
      calls.push(`record:${id}`);
      local.set(id, entry); // o hook substitui a entrada otimista de mesmo id (sem duplicar)
      if (!accepted(entry)) return { id, persisted: false };
      remote.set(id, entry);
      return { id, persisted: true };
    },
    updateEntry: async (id, patch) => {
      calls.push(`update:${id}`);
      local.set(id, { ...(local.get(id) as NewMarketingEntry), ...patch });
      if (!accepted(patch)) return false;
      if (!remote.has(id)) return false;
      remote.set(id, { ...(remote.get(id) as NewMarketingEntry), ...patch });
      return true;
    },
  };
  return { deps, remote, local, uploads, calls, options };
}

function sampleDoc() {
  return variationsFor(PRODUCT_PERFUME, { preferredStyles: ["luxury"], intent: "promo" })[0].doc;
}

async function main(): Promise<void> {
  await check("S1 a entrada do histórico é Pro/composer 2, leva identidade do fundo e o projeto — e nunca pixels", () => {
    const doc = sampleDoc();
    const entry = buildStudioHistoryEntry({ doc, product, branding, imageUrl: "https://storage.test/x/ad.png", includeProject: true });
    assert.equal(entry.mode, "pro");
    assert.equal(entry.composerVersion, ADS_PRO_STUDIO_COMPOSER_VERSION);
    assert.equal(entry.template, "pro-ad");
    assert.equal(entry.format, "portrait");
    assert.equal(entry.creativeFamily, "luxury");
    assert.ok((entry.creativeConceptId ?? "").startsWith("studio:A:"));
    assert.deepEqual(entry.proBackground, { sourceType: doc.background.source, backgroundId: doc.background.id, backgroundVersion: doc.background.version, backgroundFamily: doc.background.family });
    assert.equal(entry.priceText, "R$ 297,42");
    assert.equal(entry.imageUrl, "https://storage.test/x/ad.png");
    assert.ok((entry.proDocument ?? "").length > 0 && (entry.proDocument ?? "").length <= ADS_PRO_DOCUMENT_MAX_SERIALIZED_LENGTH);
    assert.ok(!/data:|base64|blob:/i.test(JSON.stringify(entry)), "entrada do histórico nunca carrega pixels");
    const light = buildStudioHistoryEntry({ doc, product, branding, imageUrl: "https://storage.test/x/ad.png", includeProject: false });
    assert.ok(!("proDocument" in light));
  });

  await check("S2 ciclo salvar -> reabrir devolve o MESMO documento; entradas clássicas/corrompidas não viram projeto", () => {
    const doc = withText(sampleDoc(), { headline: "Edição do vendedor", ctaText: "Chame no zap" });
    const entry = buildStudioHistoryEntry({ doc, product, branding, imageUrl: "https://s/a.png", includeProject: true });
    assert.deepEqual(readStudioDocumentFromEntry(entry as MarketingHistoryEntry), doc);
    assert.equal(readStudioDocumentFromEntry({ mode: "classic", proDocument: entry.proDocument }), null);
    assert.equal(readStudioDocumentFromEntry({ mode: "pro", proDocument: "{ quebrado" }), null);
    assert.equal(readStudioDocumentFromEntry({ mode: "pro" }), null);
    assert.equal(readStudioDocumentFromEntry({ mode: "pro", proDocument: JSON.stringify({ v: 1 }) }), null);
  });

  await check("S3 salvar: 1 upload (caminho fixo por entrada), 1 registro com id explícito, status 'saved'", async () => {
    const backend = createBackend();
    const result = await saveStudioProject({ entryId: "entry-1", doc: sampleDoc(), png, product, branding, remoteExists: false }, backend.deps);
    assert.equal(result.status, "saved");
    assert.equal(result.remoteExists, true);
    assert.deepEqual(backend.uploads, [{ kind: "marketing-pro-ad", targetId: "entry-1" }]);
    assert.deepEqual(backend.calls, ["upload:entry-1", "record:entry-1"]);
    assert.equal(backend.remote.size, 1);
    assert.ok((backend.remote.get("entry-1")?.proDocument ?? "").length > 0);
  });

  await check("S4 RETRY IDEMPOTENTE: repetir salvar nunca cria 2ª entrada nem 2º arquivo; edição posterior ATUALIZA a mesma", async () => {
    const backend = createBackend({ online: false });
    const input = { entryId: "entry-retry", doc: sampleDoc(), png, product, branding, remoteExists: false };
    const offline = await saveStudioProject(input, backend.deps);
    assert.equal(offline.status, "saved-local");
    assert.equal(offline.remoteExists, false, "nada chegou à nuvem: o próximo salvar ainda é uma criação");
    assert.equal(backend.remote.size, 0);
    backend.options.online = true;
    const retried = await saveStudioProject(input, backend.deps);
    assert.equal(retried.status, "saved");
    assert.equal(backend.remote.size, 1);
    assert.equal(backend.local.size, 1, "mesma id => a cópia local foi substituída, não duplicada");
    assert.ok(backend.uploads.every((upload) => upload.targetId === "entry-retry"), "sempre o mesmo caminho de arquivo");
    // duplo toque / segundo "Salvar" depois de editar: atualiza, não cria
    const edited = withText(input.doc, { headline: "Título novo" });
    const again = await saveStudioProject({ ...input, doc: edited, remoteExists: retried.remoteExists }, backend.deps);
    assert.equal(again.status, "saved");
    assert.equal(backend.remote.size, 1);
    assert.ok(backend.calls.includes("update:entry-retry"));
    assert.equal(readStudioDocumentFromEntry(backend.remote.get("entry-retry") as MarketingHistoryEntry)?.text.headline, "Título novo");
    assert.equal(backend.remote.get("entry-retry")?.headline, "Título novo");
  });

  await check("S5 sem login ou com upload recusado: NADA é gravado no histórico (nenhum registro fantasma) e o resultado é 'failed'", async () => {
    const noAuth = createBackend({ token: undefined });
    const a = await saveStudioProject({ entryId: "e", doc: sampleDoc(), png, product, branding, remoteExists: false }, noAuth.deps);
    assert.deepEqual([a.status, a.failure], ["failed", "no-auth"]);
    assert.deepEqual(noAuth.calls, []);
    const badUpload = createBackend({ uploadOk: false });
    const b = await saveStudioProject({ entryId: "e", doc: sampleDoc(), png, product, branding, remoteExists: false }, badUpload.deps);
    assert.deepEqual([b.status, b.failure], ["failed", "upload-failed"]);
    assert.equal(badUpload.remote.size + badUpload.local.size, 0);
    assert.ok(STUDIO_SAVE_MESSAGES.failed.includes("continua aberto"));
  });

  await check("S6 regras ainda sem `proDocument`: a imagem é salva no histórico e o resultado admite que o projeto NÃO foi guardado", async () => {
    const backend = createBackend({ rulesKnowProDocument: false });
    const first = await saveStudioProject({ entryId: "entry-rules", doc: sampleDoc(), png, product, branding, remoteExists: false }, backend.deps);
    assert.equal(first.status, "saved-without-project");
    assert.equal(first.remoteExists, true);
    assert.ok(!("proDocument" in (backend.remote.get("entry-rules") as NewMarketingEntry)));
    const second = await saveStudioProject({ entryId: "entry-rules", doc: withText(sampleDoc(), { headline: "Outro" }), png, product, branding, remoteExists: true }, backend.deps);
    assert.equal(second.status, "saved-without-project");
    assert.equal(backend.remote.size, 1);
    assert.ok(STUDIO_SAVE_MESSAGES["saved-without-project"].includes("não foi possível guardar a edição"));
  });

  await check("S7 offline total: a cópia LOCAL guarda o projeto editável (reabre neste aparelho) e o aviso é honesto", async () => {
    const backend = createBackend({ online: false });
    const result = await saveStudioProject({ entryId: "entry-offline", doc: sampleDoc(), png, product, branding, remoteExists: false }, backend.deps);
    assert.equal(result.status, "saved-local");
    assert.ok(STUDIO_SAVE_MESSAGES["saved-local"].includes("só foi salvo neste aparelho"));
    const localEntry = backend.local.get("entry-offline") as MarketingHistoryEntry;
    assert.ok(readStudioDocumentFromEntry(localEntry), "o projeto precisa sobreviver na cópia local");
  });

  await check("S8 compartilhar: nativo/Web Share => shared; sem Web Share => baixou e DIZ isso; cancelar não é erro; falha é falha", async () => {
    const make = (result: unknown) => ({ share: (async () => { if (result instanceof Error) throw result; return result; }) as never });
    const native = await shareStudioAd({ blob: png, productName: "Perfume", text: "t" }, make({ method: "native-file", fileName: "a.png" }));
    assert.equal(native.status, "shared");
    const web = await shareStudioAd({ blob: png, productName: "Perfume", text: "t" }, make({ method: "web-file", fileName: "a.png" }));
    assert.equal(web.status, "shared");
    const fallback = await shareStudioAd({ blob: png, productName: "Perfume", text: "t" }, make({ method: "web-download-fallback", fileName: "a.png" }));
    assert.equal(fallback.status, "downloaded-fallback");
    assert.ok(fallback.message.includes("Baixamos o PNG"), "nunca finge compartilhamento");
    const cancelled = await shareStudioAd({ blob: png, productName: "Perfume", text: "t" }, make(new MarketingShareCancelledError()));
    assert.equal(cancelled.status, "cancelled");
    const domCancel = await shareStudioAd({ blob: png, productName: "Perfume", text: "t" }, make(Object.assign(new Error("Share canceled"), { name: "AbortError" })));
    assert.equal(domCancel.status, "cancelled");
    const fileError = await shareStudioAd({ blob: png, productName: "Perfume", text: "t" }, make(new MarketingFileOperationError("native-share")));
    assert.equal(fileError.status, "failed");
    assert.ok(fileError.message.includes("compartilhamento do aparelho"));
    const generic = await shareStudioAd({ blob: png, productName: "Perfume", text: "t" }, make(new Error("boom interno")));
    assert.equal(generic.status, "failed");
    assert.ok(!generic.message.includes("boom"), "detalhes internos não vazam para o usuário");
    assert.ok(generic.message.includes("baixar o PNG"), "oferece a alternativa");
  });

  await check("S9 baixar PNG: sucesso informa o destino; falha informa o erro", async () => {
    const ok = await downloadStudioAd({ blob: png, productName: "Perfume" }, { save: (async () => ({ fileName: "a.png", method: "native-documents", locationLabel: "Documentos/Revenda Smart" })) as never });
    assert.deepEqual([ok.status, ok.status === "saved" ? ok.locationLabel : ""], ["saved", "Documentos/Revenda Smart"]);
    assert.equal(ok.message, "PNG salvo em Documentos/Revenda Smart.");
    const failed = await downloadStudioAd({ blob: png, productName: "Perfume" }, { save: (async () => { throw new MarketingFileOperationError("documents-write"); }) as never });
    assert.equal(failed.status, "failed");
    assert.ok(failed.message.includes("não pôde ser salvo"));
  });

  console.log(`ADS-PRO studio persistence tests passed: ${checkCount()} checks.`);
}

void main().catch((error) => { console.error(error); process.exit(1); });
