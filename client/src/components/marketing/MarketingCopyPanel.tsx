import type { ReactNode } from "react";
import { Copy } from "lucide-react";

type Props = {
  generatedText: string;
  copied: boolean;
  onTextChange: (value: string) => void;
  onCopy: () => void;
  extensionSlot?: ReactNode;
};

export function MarketingCopyPanel({ generatedText, copied, onTextChange, onCopy, extensionSlot }: Props) {
  return (
    <section className="rounded-[1.75rem] border border-border/60 bg-white p-4 shadow-sm" data-testid="marketing-copy-panel">
      <p className="text-[10px] font-black uppercase tracking-[.18em] text-primary">5. Texto</p>
      <h2 className="mt-1 text-base font-black">Mensagem para WhatsApp</h2>
      <label htmlFor="marketing-whatsapp-copy" className="mt-3 block text-xs font-bold text-muted-foreground">Edite a mensagem antes de copiar ou compartilhar</label>
      <textarea
        id="marketing-whatsapp-copy"
        value={generatedText}
        onChange={(event) => onTextChange(event.target.value)}
        rows={8}
        className="mt-2 w-full resize-y rounded-xl border border-border bg-secondary/20 p-3 text-xs leading-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
      />
      <button
        type="button"
        onClick={onCopy}
        className={[
          "mt-3 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl px-4 text-xs font-bold text-white transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
          copied ? "bg-green-600" : "bg-primary",
        ].join(" ")}
        data-testid="button-copy-ad-text"
      >
        <Copy className="h-4 w-4" /> {copied ? "Anúncio copiado" : "Copiar anúncio"}
      </button>
      {extensionSlot}
    </section>
  );
}
