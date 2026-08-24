import { useState } from "react";
import { Calendar, X } from "lucide-react";
import { formatCurrency } from "@/lib/product-pricing";
import {
  calculateOrderItemSubtotal,
  getAllowedOrderTransitions,
  ORDER_PAYMENT_METHOD_LABELS,
  ORDER_PAYMENT_STATUS_LABELS,
  ORDER_STATUS_LABELS,
  type Order,
} from "@/lib/orders";
import { useDismissibleOnBack } from "@/hooks/useDismissibleOnBack";

const STATUS_TONE: Record<Order["status"], string> = {
  new: "bg-sky-100 text-sky-700",
  in_progress: "bg-amber-100 text-amber-700",
  ready: "bg-violet-100 text-violet-700",
  delivered: "bg-green-100 text-green-700",
  cancelled: "bg-slate-200 text-slate-500",
};

function formatDate(iso?: string): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("pt-BR");
}

interface OrderDetailsSheetProps {
  order: Order | null;
  onClose: () => void;
  onChangeStatus: (order: Order) => void;
  /** Ausente em telas que não confirmam pagamento (ex.: se este sheet for reaproveitado em outro lugar). */
  onConfirmPayment?: (order: Order) => Promise<void>;
}

/**
 * Detalhes do pedido em bottom sheet — não é uma página nova porque não há navegação nem estado
 * próprio a preservar: é a leitura completa de um pedido já carregado pela lista. Preço nunca é
 * recalculado aqui; o subtotal por item vem de calculateOrderItemSubtotal e o total vem do próprio
 * pedido salvo, para que a tela mostre exatamente o valor gravado no momento do pedido.
 */
export function OrderDetailsSheet({ order, onClose, onChangeStatus, onConfirmPayment }: OrderDetailsSheetProps) {
  useDismissibleOnBack(Boolean(order), onClose);
  const [confirmingPayment, setConfirmingPayment] = useState(false);
  if (!order) return null;

  const createdLabel = formatDate(order.createdAt);
  const expectedLabel = formatDate(order.expectedDate);
  const canChangeStatus = getAllowedOrderTransitions(order.status).length > 0;
  const canConfirmPayment = Boolean(onConfirmPayment)
    && (order.paymentStatus === "customer_reported_paid" || order.paymentStatus === "awaiting_customer_payment");

  const handleConfirmClick = async () => {
    if (!onConfirmPayment || confirmingPayment) return;
    setConfirmingPayment(true);
    try {
      await onConfirmPayment(order);
    } finally {
      setConfirmingPayment(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[120] flex items-end justify-center bg-black/60 p-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,calc(env(safe-area-inset-bottom)+1rem))] backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="order-details-title"
      onClick={onClose}
    >
      <div
        className="rs-sheet-enter flex max-h-[calc(100dvh-4rem)] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-border/20 bg-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-border/20 px-5 py-4">
          <div className="min-w-0">
            <h2 id="order-details-title" className="truncate text-base font-bold tracking-tight">Pedido #{order.id.slice(0, 5)}</h2>
            {createdLabel && <p className="text-[11px] text-muted-foreground">Criado em {createdLabel}</p>}
          </div>
          <button type="button" onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-full bg-secondary" aria-label="Fechar detalhes do pedido"><X className="h-4 w-4" /></button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5 space-y-5">
          <div>
            <p className="text-xs font-semibold text-muted-foreground">Cliente</p>
            <p className="mt-0.5 text-sm font-bold">{order.clientName || "Cliente não informado"}</p>
          </div>

          <div>
            <p className="mb-1.5 text-xs font-semibold text-muted-foreground">Status</p>
            <div className="flex items-center gap-2">
              <span className={`rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-wide ${STATUS_TONE[order.status]}`}>
                {ORDER_STATUS_LABELS[order.status]}
              </span>
              {canChangeStatus && (
                <button
                  type="button"
                  data-testid="button-open-order-status"
                  onClick={() => onChangeStatus(order)}
                  className="rs-pressable rounded-full bg-secondary px-3 py-1.5 text-[11px] font-bold text-foreground"
                >
                  Alterar
                </button>
              )}
            </div>
          </div>

          {expectedLabel && (
            <p className="flex items-center gap-1.5 text-xs font-semibold text-primary">
              <Calendar className="h-3.5 w-3.5" /> Previsão de entrega: {expectedLabel}
            </p>
          )}

          {order.paymentMethod && (
            <div>
              <p className="mb-1.5 text-xs font-semibold text-muted-foreground">Pagamento</p>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-secondary px-3 py-1 text-[11px] font-bold">{ORDER_PAYMENT_METHOD_LABELS[order.paymentMethod]}</span>
                {order.paymentStatus && (
                  <span
                    className={`rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-wide ${
                      order.paymentStatus === "paid"
                        ? "bg-green-100 text-green-700"
                        : order.paymentStatus === "customer_reported_paid"
                          ? "bg-emerald-100 text-emerald-700"
                          : order.paymentStatus === "awaiting_customer_payment"
                            ? "bg-amber-100 text-amber-700"
                            : "bg-slate-200 text-slate-500"
                    }`}
                  >
                    {ORDER_PAYMENT_STATUS_LABELS[order.paymentStatus]}
                  </span>
                )}
              </div>
            </div>
          )}

          <div>
            <p className="mb-2 text-xs font-semibold text-muted-foreground">Itens ({order.items.length})</p>
            <div className="space-y-2">
              {order.items.map((item, index) => (
                <div key={`${item.productId || "manual"}-${index}`} className="flex items-start gap-3 rounded-2xl bg-secondary/20 p-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-semibold">{item.name}</p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {item.quantity} × {formatCurrency(item.unitPrice)}
                    </p>
                  </div>
                  <p className="shrink-0 text-xs font-bold">{formatCurrency(calculateOrderItemSubtotal(item))}</p>
                </div>
              ))}
            </div>
          </div>

          {order.notes && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground">Observações</p>
              <p className="mt-1 whitespace-pre-wrap rounded-2xl bg-secondary/20 p-3 text-xs leading-relaxed text-foreground/80">{order.notes}</p>
            </div>
          )}
        </div>

        <div className="shrink-0 space-y-3 border-t border-border/20 bg-white px-5 pt-3 pb-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-muted-foreground">Total do pedido</span>
            <span className="text-xl font-semibold">{formatCurrency(order.total)}</span>
          </div>
          {canConfirmPayment && (
            <button
              type="button"
              data-testid="button-confirm-payment"
              onClick={handleConfirmClick}
              disabled={confirmingPayment}
              className="rs-pressable min-h-11 w-full rounded-2xl bg-slate-950 text-xs font-black text-white disabled:opacity-60"
            >
              {confirmingPayment ? "Confirmando..." : "Confirmar recebimento"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
