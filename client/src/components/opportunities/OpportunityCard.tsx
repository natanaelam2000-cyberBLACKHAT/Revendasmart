import { useState } from "react";
import { useLocation } from "wouter";
import { Users, Package, CalendarClock, Receipt, ArrowRight, Check, X as XIcon, MessageSquare, Copy } from "lucide-react";
import { resolveOpportunityActionRoute } from "@/lib/opportunity-actions";
import { buildOpportunityMessage, buildWhatsAppUrl } from "@/lib/opportunity-messages";
import { normalizeWhatsappPhone } from "@/lib/whatsapp-phone";
import { notifyError, notifySuccess } from "@/lib/notify";
import type { Opportunity, OpportunityType } from "@shared/opportunity-rules";

export const TYPE_ICON: Record<OpportunityType, typeof Users> = {
  inactive_client: Users,
  stalled_product: Package,
  idle_schedule: CalendarClock,
  overdue_receivable: Receipt,
};

export const TYPE_LABEL: Record<OpportunityType, string> = {
  inactive_client: "Cliente inativo",
  stalled_product: "Produto parado",
  idle_schedule: "Agenda ociosa",
  overdue_receivable: "Parcela em atraso",
};

interface OpportunityCardProps {
  compact?: boolean;
  opportunity: Opportunity;
  pending: boolean;
  engaged: boolean;
  clientPhone: string | undefined;
  onAct: (opportunity: Opportunity) => void;
  onDismiss: (opportunity: Opportunity) => void;
  onEngaged: (fingerprint: string) => void;
}

export function OpportunityCard({ compact = false, opportunity, pending, engaged, clientPhone, onAct, onDismiss, onEngaged }: OpportunityCardProps) {
  const [, setLocation] = useLocation();
  const [copied, setCopied] = useState(false);
  const Icon = TYPE_ICON[opportunity.type];
  const isHigh = opportunity.priority === "high";
  const message = buildOpportunityMessage(opportunity);
  const normalizedPhone = clientPhone ? normalizeWhatsappPhone(clientPhone) : null;

  const goToPrimaryRoute = () => {
    onEngaged(opportunity.fingerprint);
    setLocation(resolveOpportunityActionRoute(opportunity.action.type, opportunity.entityReference));
  };

  const openWhatsApp = () => {
    if (!message || !normalizedPhone) return;
    onEngaged(opportunity.fingerprint);
    // §11 — só no clique explícito, nunca automático/em background; texto sempre codificado (mesmo
    // helper de billings.tsx/client-detail.tsx, extraído em opportunity-messages.ts).
    window.open(buildWhatsAppUrl(normalizedPhone, message), "_blank");
  };

  const copyMessage = async () => {
    if (!message) return;
    try {
      // §10 — mesmo padrão de billings.tsx's copyChargeLink: sucesso visível (ícone + toast, 2s),
      // falha nunca mostra o erro bruto do browser.
      await navigator.clipboard.writeText(message);
      setCopied(true);
      onEngaged(opportunity.fingerprint);
      notifySuccess("Mensagem copiada.");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      notifyError("Não foi possível copiar a mensagem.");
    }
  };

  return (
    <div className={`rounded-2xl border border-border/60 bg-white ${compact ? "p-3 space-y-2" : "p-4 space-y-3"}`} data-testid={`card-opportunity-${opportunity.id}`}>
      <div className="flex items-start gap-3">
        {!compact && <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${isHigh ? "bg-red-100 text-red-600" : "bg-amber-100 text-amber-600"}`}>
          <Icon className="w-5 h-5" />
        </div>}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">{TYPE_LABEL[opportunity.type]}</p>
            {(compact || isHigh) && <span className="text-[9px] font-black uppercase tracking-wide text-red-600 bg-red-50 px-1.5 py-0.5 rounded-full">Prioridade {isHigh ? "alta" : opportunity.priority === "medium" ? "média" : "baixa"}</span>}
          </div>
          <p className="font-bold text-foreground truncate">{opportunity.entityReference.name}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{opportunity.reason}</p>
        </div>
      </div>

      {message ? (
        <div className="space-y-2">
          {/* §9 — "Ação sugerida": preview da mensagem, nunca escondida atrás de um clique extra. */}
          {!compact && <div className="rounded-xl bg-secondary/40 p-3" data-testid={`text-opportunity-message-${opportunity.id}`}>
            <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground mb-1">Ação sugerida</p>
            <p className="text-xs text-foreground/80 line-clamp-3">{message}</p>
          </div>}
          <div className="flex gap-2">
            {normalizedPhone ? (
              <button
                type="button"
                onClick={openWhatsApp}
                className="min-h-11 min-w-0 flex-1 flex items-center justify-center gap-1.5 rounded-xl bg-[#25D366] text-white text-xs font-black py-2.5 active:scale-95 transition-all"
                data-testid={`button-opportunity-whatsapp-${opportunity.id}`}
              >
                <MessageSquare className="w-3.5 h-3.5" />
                Abrir WhatsApp
              </button>
            ) : (
              // §3 — telefone ausente/inválido: nunca um link de WhatsApp quebrado — cai no fallback
              // real (abrir cliente/cobrança), nunca um botão morto.
              <button
                type="button"
                onClick={goToPrimaryRoute}
                className="min-h-11 min-w-0 flex-1 flex items-center justify-center gap-1.5 rounded-xl bg-primary/10 text-primary text-xs font-black py-2.5 active:scale-95 transition-all"
                data-testid={`button-opportunity-action-${opportunity.id}`}
              >
                {opportunity.action.label}
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}
            <button
              type="button"
              onClick={copyMessage}
              className={`min-h-11 flex items-center justify-center gap-1.5 rounded-xl px-3 text-xs font-bold transition-all ${copied ? "bg-emerald-500 text-white" : "bg-secondary text-foreground"}`}
              data-testid={`button-opportunity-copy-${opportunity.id}`}
            >
              {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? "Copiado!" : "Copiar"}
            </button>
          </div>
        </div>
      ) : (
        // §5/§6 — stalled_product/idle_schedule: sem mensagem/WhatsApp, ação self-service do vendedor.
        <button
          type="button"
          onClick={goToPrimaryRoute}
          className="min-h-11 w-full flex items-center justify-center gap-1.5 rounded-xl bg-primary/10 text-primary text-xs font-black py-2.5 active:scale-95 transition-all"
          data-testid={`button-opportunity-action-${opportunity.id}`}
        >
          {opportunity.action.label}
          <ArrowRight className="w-3.5 h-3.5" />
        </button>
      )}

      {/* PRODUCT-GROWTH-05 §8 — ações de lifecycle, separadas da ação comercial acima: só disparam por
          clique explícito aqui, nunca como efeito colateral de abrir WhatsApp/copiar/CTA (§12). §12 —
          "Marcar como feito" ganha destaque visual depois de qualquer ação comercial nesta sessão
          (nunca persistido — ver `engaged`, estado só em memória do componente pai). */}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => onAct(opportunity)}
          className={`min-h-11 min-w-0 flex-1 flex items-center justify-center gap-1.5 rounded-xl text-[11px] font-bold py-2 active:scale-95 transition-all disabled:opacity-50 ${engaged ? "bg-emerald-500 text-white" : "bg-emerald-50 text-emerald-700"}`}
          data-testid={`button-opportunity-mark-acted-${opportunity.id}`}
        >
          <Check className="w-3.5 h-3.5" />
          Marcar como feito
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => onDismiss(opportunity)}
          className="min-h-11 min-w-0 flex-1 flex items-center justify-center gap-1.5 rounded-xl bg-secondary text-muted-foreground text-[11px] font-bold py-2 active:scale-95 transition-all disabled:opacity-50"
          data-testid={`button-opportunity-dismiss-${opportunity.id}`}
        >
          <XIcon className="w-3.5 h-3.5" />
          Dispensar
        </button>
      </div>
    </div>
  );
}

