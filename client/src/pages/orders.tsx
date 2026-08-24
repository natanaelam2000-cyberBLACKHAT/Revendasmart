import { useMemo, useState } from "react";
import { ClipboardList, Plus, Search } from "lucide-react";
import { Layout } from "@/components/layout";
import { PageSkeleton } from "@/components/PageSkeleton";
import { OrderCard } from "@/components/orders/OrderCard";
import { NewOrderSheet } from "@/components/orders/NewOrderSheet";
import { OrderDetailsSheet } from "@/components/orders/OrderDetailsSheet";
import { OrderStatusSheet } from "@/components/orders/OrderStatusSheet";
import { useOrdersData } from "@/hooks/useOrdersData";
import { useUserSettings } from "@/hooks/useUserSettings";
import { notifyError, notifySuccess } from "@/lib/notify";
import { ORDER_STATUS_IDS, ORDER_STATUS_LABELS, resolveOrdersFeatureLabel, type Order, type OrderStatus } from "@/lib/orders";

const STATUS_FILTERS: { value: "todos" | OrderStatus; label: string }[] = [
  { value: "todos", label: "Todos" },
  ...ORDER_STATUS_IDS.map((status) => ({ value: status, label: ORDER_STATUS_LABELS[status] })),
];

/**
 * Resumo compacto: só os marcos que o lojista acompanha no dia a dia. Os status ready e cancelled
 * continuam existindo como filtro e na lista, mas não ganham destaque próprio no resumo — assim ele
 * não vira um painel de cards. Os rótulos vêm sempre de ORDER_STATUS_LABELS, nunca escritos aqui.
 * Cada contador reusa o mesmo statusFilter dos chips — não existe um segundo estado de filtro paralelo.
 */
const SUMMARY_STATUSES: ("todos" | OrderStatus)[] = ["todos", "new", "in_progress", "delivered"];

export default function Orders() {
  const { orders, loading, error, createOrder, updateOrderStatus, confirmOrderPayment } = useOrdersData();
  const { settings } = useUserSettings();
  const ordersLabel = resolveOrdersFeatureLabel(settings);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"todos" | OrderStatus>("todos");
  const [showNewOrder, setShowNewOrder] = useState(false);
  const [detailOrderId, setDetailOrderId] = useState<string | null>(null);
  const [statusOrderId, setStatusOrderId] = useState<string | null>(null);

  const normalizedSearch = search.trim().toLowerCase();
  // Busca e filtro são independentes e combinam: nenhum dos dois zera o outro, e ambos rodam sobre a
  // lista já carregada pelo listener — trocar de filtro nunca dispara uma nova consulta ao Firestore.
  const filteredOrders = useMemo(() => orders.filter((order) => {
    const matchesStatus = statusFilter === "todos" || order.status === statusFilter;
    const matchesSearch = !normalizedSearch
      || order.clientName.toLowerCase().includes(normalizedSearch)
      || order.id.toLowerCase().includes(normalizedSearch)
      || order.items.some((item) => item.name.toLowerCase().includes(normalizedSearch));
    return matchesStatus && matchesSearch;
  }), [orders, statusFilter, normalizedSearch]);

  const statusCounts = useMemo(() => orders.reduce((counts, order) => {
    counts[order.status] = (counts[order.status] || 0) + 1;
    return counts;
  }, {} as Partial<Record<OrderStatus, number>>), [orders]);

  // Os sheets guardam o id, não o objeto: assim o listener em tempo real atualiza o que está aberto
  // (ex: o status recém-alterado) em vez de exibir um snapshot congelado do pedido.
  const detailOrder = detailOrderId ? orders.find((order) => order.id === detailOrderId) ?? null : null;
  const statusOrder = statusOrderId ? orders.find((order) => order.id === statusOrderId) ?? null : null;

  const handleChangeStatus = async (status: OrderStatus) => {
    if (!statusOrder) return;
    try {
      await updateOrderStatus(statusOrder.id, status);
      notifySuccess(`Pedido marcado como ${ORDER_STATUS_LABELS[status]}.`);
      setStatusOrderId(null);
    } catch (err) {
      notifyError(err instanceof Error && err.message ? err.message : "Não foi possível alterar o status do pedido.");
    }
  };

  const handleCreateOrder = async (input: Parameters<typeof createOrder>[0]): Promise<Order> => {
    try {
      // storeName é anexado SÓ aqui, na criação. Renomear a loja depois não reescreve pedidos antigos:
      // cada pedido guarda o nome que a loja tinha quando foi feito.
      const order = await createOrder({ ...input, storeName: settings?.storeName });
      notifySuccess("Pedido criado.");
      return order;
    } catch (err) {
      notifyError(err instanceof Error && err.message ? err.message : "Não foi possível criar o pedido.");
      throw err;
    }
  };

  const handleConfirmPayment = async (order: Order) => {
    try {
      await confirmOrderPayment(order.id);
      notifySuccess("Pagamento confirmado.");
    } catch (err) {
      notifyError(err instanceof Error && err.message ? err.message : "Não foi possível confirmar o pagamento.");
    }
  };

  if (loading) {
    return <Layout title={ordersLabel}><PageSkeleton variant="list" /></Layout>;
  }

  return (
    <Layout title={ordersLabel}>
      <div className="mx-auto max-w-5xl px-4 py-6 pb-[max(8rem,calc(env(safe-area-inset-bottom)+7rem))] sm:px-6 lg:px-8">
        <div className="mb-5 flex items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-black tracking-tight">{ordersLabel}</h1>
            <p className="text-xs text-muted-foreground">Organize pedidos antes de virarem vendas.</p>
          </div>
          <button
            type="button"
            data-testid="button-new-order"
            onClick={() => setShowNewOrder(true)}
            className="rs-pressable flex shrink-0 items-center gap-1.5 rounded-full bg-primary px-4 py-2.5 text-xs font-bold text-white shadow-lg shadow-primary/20"
          >
            <Plus className="h-4 w-4" /> Novo pedido
          </button>
        </div>

        <div className="mb-4 grid grid-cols-4 gap-2">
          {SUMMARY_STATUSES.map((value) => {
            const count = value === "todos" ? orders.length : statusCounts[value] || 0;
            const isActive = statusFilter === value;
            return (
              <button
                key={value}
                type="button"
                data-testid={`button-order-summary-${value}`}
                onClick={() => setStatusFilter(value)}
                aria-pressed={isActive}
                className={`rounded-2xl border px-2 py-2.5 text-center transition-colors ${
                  isActive ? "border-primary bg-primary/10" : "border-border/50 bg-white"
                }`}
              >
                <p className={`text-base font-black leading-none ${isActive ? "text-primary" : "text-foreground"}`}>{count}</p>
                <p className="mt-1 truncate text-[10px] font-semibold text-muted-foreground">
                  {value === "todos" ? "Todos" : ORDER_STATUS_LABELS[value]}
                </p>
              </button>
            );
          })}
        </div>

        <div className="relative mb-3">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar cliente, produto ou pedido..."
            className="w-full rounded-full border border-border bg-white py-3 pl-11 pr-4 text-sm outline-none focus:ring-2 focus:ring-primary/20"
          />
        </div>

        <div className="mb-5 flex gap-1.5 overflow-x-auto hide-scrollbar">
          {STATUS_FILTERS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setStatusFilter(option.value)}
              aria-pressed={statusFilter === option.value}
              className={`min-h-8 shrink-0 whitespace-nowrap rounded-full border px-3 text-[11px] font-bold transition-colors ${
                statusFilter === option.value ? "border-primary bg-primary/10 text-primary" : "border-border/60 bg-white text-muted-foreground"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>

        {error && (
          <p className="mb-4 rounded-xl bg-destructive/10 px-3 py-2 text-xs font-semibold text-destructive">Ocorreu um erro temporário ao carregar pedidos.</p>
        )}

        {filteredOrders.length === 0 ? (
          <div className="flex flex-col items-center rounded-[2rem] border border-dashed border-border/60 bg-white px-6 py-16 text-center">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10"><ClipboardList className="h-8 w-8 text-primary/45" /></div>
            <p className="font-bold text-foreground">{orders.length === 0 ? "Nenhum pedido ainda" : "Nenhum pedido encontrado"}</p>
            <p className="mt-2 max-w-[280px] text-xs leading-relaxed text-muted-foreground">
              {orders.length === 0 ? "Crie o primeiro pedido para acompanhar encomendas dos seus clientes." : "Tente outro termo ou limpe os filtros."}
            </p>
            {orders.length === 0 ? (
              <button type="button" onClick={() => setShowNewOrder(true)} className="rs-pressable mt-5 rounded-2xl bg-primary px-5 py-3 text-xs font-semibold text-white">Criar pedido</button>
            ) : (
              <button type="button" onClick={() => { setSearch(""); setStatusFilter("todos"); }} className="rs-pressable mt-5 rounded-2xl bg-secondary px-5 py-3 text-xs font-semibold text-foreground">Limpar filtros</button>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {filteredOrders.map((order) => (
              <OrderCard key={order.id} order={order} onClick={() => setDetailOrderId(order.id)} />
            ))}
          </div>
        )}
      </div>

      <NewOrderSheet
        open={showNewOrder}
        onClose={() => setShowNewOrder(false)}
        onSubmit={handleCreateOrder}
      />

      <OrderDetailsSheet
        order={detailOrder}
        onClose={() => setDetailOrderId(null)}
        onChangeStatus={(order) => setStatusOrderId(order.id)}
        onConfirmPayment={handleConfirmPayment}
      />

      {statusOrder && (
        <OrderStatusSheet
          open
          currentStatus={statusOrder.status}
          onClose={() => setStatusOrderId(null)}
          onSelect={handleChangeStatus}
        />
      )}
    </Layout>
  );
}
