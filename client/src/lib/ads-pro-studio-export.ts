/**
 * ADS-PRO-FINAL — baixar e compartilhar o PNG do estúdio reutilizando o mecanismo que o Marketing já tem
 * (`marketing-share.ts`): Android/Capacitor usa o compartilhamento NATIVO e salva em Documentos; a web usa
 * Web Share com arquivo quando o navegador suporta e, senão, baixa o PNG e DIZ que baixou — nunca finge
 * que compartilhou. Cancelar o seletor não é erro.
 */
import {
  MarketingFileOperationError,
  isMarketingShareCancelledError,
  saveMarketingCard,
  shareMarketingCard,
  type MarketingSaveResult,
  type MarketingShareResult,
} from "@/lib/marketing-share";

export type StudioShareOutcome =
  | { readonly status: "shared"; readonly method: MarketingShareResult["method"]; readonly message: string }
  | { readonly status: "downloaded-fallback"; readonly method: MarketingShareResult["method"]; readonly message: string }
  | { readonly status: "cancelled"; readonly message: string }
  | { readonly status: "failed"; readonly message: string };

export type StudioDownloadOutcome =
  | { readonly status: "saved"; readonly message: string; readonly locationLabel: string }
  | { readonly status: "failed"; readonly message: string };

export interface StudioExportDeps {
  readonly share?: typeof shareMarketingCard;
  readonly save?: typeof saveMarketingCard;
}

export async function shareStudioAd(input: { readonly blob: Blob; readonly productName: string; readonly text: string }, deps: StudioExportDeps = {}): Promise<StudioShareOutcome> {
  const share = deps.share ?? shareMarketingCard;
  try {
    const result = await share({ blob: input.blob, productName: input.productName, title: "Anúncio Revenda Smart", text: input.text });
    if (result.method === "web-download-fallback") {
      return {
        status: "downloaded-fallback",
        method: result.method,
        message: "Este aparelho não compartilha arquivos direto. Baixamos o PNG — envie pelo WhatsApp ou Instagram.",
      };
    }
    return { status: "shared", method: result.method, message: "Compartilhamento aberto." };
  } catch (error) {
    if (isMarketingShareCancelledError(error)) return { status: "cancelled", message: "Compartilhamento cancelado." };
    const message = error instanceof MarketingFileOperationError ? error.message : "Não foi possível compartilhar agora. Tente baixar o PNG.";
    return { status: "failed", message };
  }
}

export async function downloadStudioAd(input: { readonly blob: Blob; readonly productName: string }, deps: StudioExportDeps = {}): Promise<StudioDownloadOutcome> {
  const save = deps.save ?? saveMarketingCard;
  try {
    const result: MarketingSaveResult = await save({ blob: input.blob, productName: input.productName });
    return { status: "saved", locationLabel: result.locationLabel, message: `PNG salvo em ${result.locationLabel}.` };
  } catch (error) {
    const message = error instanceof MarketingFileOperationError ? error.message : "Não foi possível salvar o PNG agora.";
    return { status: "failed", message };
  }
}
