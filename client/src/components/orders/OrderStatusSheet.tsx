import { useState } from "react";
import { X } from "lucide-react";
import { getAllowedOrderTransitions, ORDER_STATUS_LABELS, type OrderStatus } from "@/lib/orders";
import { useDismissibleOnBack } from "@/hooks/useDismissibleOnBack";

interface OrderStatusSheetProps {
  open: boolean;
  currentStatus: OrderStatus;
  onClose: () => void;
  onSelect: (status: OrderStatus) => Promise<void>;
}

/**
 * Sheet compacto de mudança de status. Só lista as transições que `getAllowedOrderTransitions` permite
 * — nunca todos os status —, e exige um toque deliberado na opção: nenhum status muda por toque
 * acidental no card ou no badge. Quando não há transição possível (pedido entregue ou cancelado), o
 * sheet diz isso em vez de oferecer uma ação vazia.
 */
export function OrderStatusSheet({ open, currentStatus, onClose, onSelect }: OrderStatusSheetProps) {
  const [pendingStatus, setPendingStatus] = useState<OrderStatus | null>(null);
  useDismissibleOnBack(open, onClose);

  if (!open) return null;

  const allowed = getAllowedOrderTransitions(currentStatus);

  const handleSelect = async (status: OrderStatus) => {
    if (pendingStatus) return;
    setPendingStatus(status);
    try {
      await onSelect(status);
    } finally {
      setPendingStatus(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[140] flex items-end justify-center bg-black/60 p-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,calc(env(safe-area-inset-bottom)+1rem))] backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="order-status-title"
      onClick={onClose}
    >
      <div
        className="rs-sheet-enter w-full max-w-md rounded-2xl border border-border/20 bg-white p-5 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-1 flex items-center justify-between">
          <h3 id="order-status-title" className="text-base font-bold tracking-tight">Alterar status</h3>
          <button type="button" onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-full bg-secondary" aria-label="Fechar alterar status"><X className="h-4 w-4" /></button>
        </div>
        <p className="mb-4 text-xs text-muted-foreground">Status atual: <span className="font-semibold text-foreground">{ORDER_STATUS_LABELS[currentStatus]}</span></p>

        {allowed.length === 0 ? (
          <p className="rounded-2xl bg-secondary/40 px-4 py-5 text-center text-xs text-muted-foreground">
            Este pedido está finalizado e não pode mudar de status.
          </p>
        ) : (
          <div className="space-y-2">
            {allowed.map((status) => (
              <button
                key={status}
                type="button"
                data-testid={`button-order-status-${status}`}
                disabled={pendingStatus !== null}
                onClick={() => void handleSelect(status)}
                className={`rs-pressable w-full rounded-2xl px-4 py-3.5 text-sm font-semibold disabled:opacity-50 ${
                  status === "cancelled" ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary"
                }`}
              >
                {pendingStatus === status ? "Salvando..." : `Marcar como ${ORDER_STATUS_LABELS[status]}`}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
