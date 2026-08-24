import { Calendar, ChevronRight } from "lucide-react";
import { formatCurrency } from "@/lib/product-pricing";
import { ORDER_PAYMENT_STATUS_LABELS, ORDER_STATUS_LABELS, type Order } from "@/lib/orders";

const STATUS_TONE: Record<Order["status"], string> = {
  new: "bg-sky-100 text-sky-700",
  in_progress: "bg-amber-100 text-amber-700",
  ready: "bg-violet-100 text-violet-700",
  delivered: "bg-green-100 text-green-700",
  cancelled: "bg-slate-200 text-slate-500",
};

/**
 * Só os dois status que pedem atenção do lojista ganham destaque aqui — os demais (not_started,
 * paid, failed, cancelled) já são óbvios pelo resto do card ou não exigem ação nenhuma. Essa é a
 * "notificação" in-app do doc §6: sem infra de push, o destaque no card já é o suficiente para o
 * lojista notar um pedido novo com pagamento pendente/reportado sem precisar abrir cada um.
 */
const ATTENTION_PAYMENT_STATUSES = new Set<Order["paymentStatus"]>(["customer_reported_paid", "awaiting_customer_payment"]);

function formatShortDate(iso?: string): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}

function formatFullDate(iso?: string): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("pt-BR");
}

/** Prévia dos itens: só os 2 primeiros nomes; o resto vira "+X". Nada é inventado quando a lista é curta. */
const ITEM_PREVIEW_LIMIT = 2;

interface OrderCardProps {
  order: Order;
  onClick?: (order: Order) => void;
}

export function OrderCard({ order, onClick }: OrderCardProps) {
  const itemCount = order.items.reduce((sum, item) => sum + Math.max(0, item.quantity), 0);
  const expectedLabel = formatShortDate(order.expectedDate);
  const createdLabel = formatFullDate(order.createdAt);
  const previewItems = order.items.slice(0, ITEM_PREVIEW_LIMIT);
  const remainingItems = order.items.length - previewItems.length;

  return (
    <button
      type="button"
      onClick={() => onClick?.(order)}
      data-testid={`order-card-${order.id}`}
      className="rs-card-interactive flex w-full items-center gap-3 rounded-3xl border border-border/40 bg-white p-4 text-left shadow-sm"
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="text-[10px] font-black uppercase tracking-wide text-muted-foreground">Pedido #{order.id.slice(0, 5)}</p>
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide ${STATUS_TONE[order.status]}`}>
            {ORDER_STATUS_LABELS[order.status]}
          </span>
          {order.paymentStatus && ATTENTION_PAYMENT_STATUSES.has(order.paymentStatus) && (
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide ${
                order.paymentStatus === "customer_reported_paid" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
              }`}
              data-testid={`order-payment-status-${order.id}`}
            >
              {ORDER_PAYMENT_STATUS_LABELS[order.paymentStatus]}
            </span>
          )}
        </div>
        <h3 className="mt-0.5 truncate text-sm font-bold text-foreground">{order.clientName || "Cliente não informado"}</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          {createdLabel && <>{createdLabel} · </>}{itemCount} {itemCount === 1 ? "item" : "itens"}
        </p>
        {previewItems.length > 0 && (
          <div className="mt-1.5 space-y-0.5">
            {previewItems.map((item, index) => (
              <p key={`${item.productId || "manual"}-${index}`} className="truncate text-[11px] text-foreground/70">{item.name}</p>
            ))}
            {remainingItems > 0 && (
              <p className="text-[11px] font-semibold text-muted-foreground">
                +{remainingItems} {remainingItems === 1 ? "item" : "itens"}
              </p>
            )}
          </div>
        )}
        <p className="mt-1.5 text-sm font-bold text-foreground">{formatCurrency(order.total)}</p>
        {expectedLabel && (
          <p className="mt-1 flex items-center gap-1 text-[10px] font-semibold text-primary">
            <Calendar className="h-3 w-3" /> Entrega: {expectedLabel}
          </p>
        )}
      </div>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/50" />
    </button>
  );
}
