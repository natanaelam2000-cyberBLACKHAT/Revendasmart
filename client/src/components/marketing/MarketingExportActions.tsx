import { Download, MessageSquare } from "lucide-react";

type Props = {
  cardAction: "download" | "share" | null;
  blocked: boolean;
  imageStatus: "idle" | "resolving" | "ready" | "error";
  error: string;
  onShare: () => void;
  onDownload: () => void;
};

export function MarketingExportActions({ cardAction, blocked, imageStatus, error, onShare, onDownload }: Props) {
  const preparingImage = imageStatus === "resolving";
  return (
    <section className="rounded-[1.75rem] border border-border/60 bg-white p-4 shadow-sm" data-testid="marketing-export-actions">
      <p className="text-[10px] font-black uppercase tracking-[.18em] text-primary">6. Exportar</p>
      <h2 className="mt-1 text-base font-black">Baixe ou compartilhe</h2>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">O mesmo PNG é usado no navegador e no aplicativo Android.</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <button type="button" onClick={onShare} disabled={blocked} className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-[#25d366] px-4 text-xs font-bold text-white disabled:cursor-wait disabled:opacity-60" data-testid="button-share-whatsapp-ad">
          <MessageSquare className="h-4 w-4" />
          {cardAction === "share" ? "Preparando..." : preparingImage ? "Preparando foto..." : "Compartilhar"}
        </button>
        <button type="button" onClick={onDownload} disabled={blocked} className="flex min-h-12 items-center justify-center gap-2 rounded-xl border border-primary/20 bg-white px-4 text-xs font-bold text-primary disabled:cursor-wait disabled:opacity-60" data-testid="button-download-ad-image">
          <Download className="h-4 w-4" />
          {cardAction === "download" ? "Salvando..." : preparingImage ? "Preparando foto..." : "Baixar PNG"}
        </button>
      </div>
      {error && <p className="mt-3 rounded-xl bg-red-50 p-3 text-center text-xs font-semibold text-red-700" role="alert">{error}</p>}
    </section>
  );
}
