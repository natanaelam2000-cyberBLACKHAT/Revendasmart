import { useState } from "react";
import { Minus, Plus, Search, Trash2, X } from "lucide-react";
import { ProductImageCard } from "@/components/ProductImageCard";
import { useProductPickerData } from "@/hooks/useProductPickerData";
import { useDismissibleOnBack } from "@/hooks/useDismissibleOnBack";
import { ApiError } from "@/lib/api-client";
import { formatCurrency, resolveEffectiveProductPrice } from "@/lib/product-pricing";
import { calculateOrderTotal, type Order, type OrderEditItemInput, type OrderItem } from "@/lib/orders";

interface EditOrderSheetProps {
  order: Order;
  onClose: () => void;
  onSubmit: (input: { orderId: string; expectedUpdatedAt: string; items: OrderEditItemInput[] }) => Promise<unknown>;
}

function toEditPayload(items: readonly OrderItem[]): OrderEditItemInput[] {
  // productId manda: nome/preço/imagem são sempre descartados pelo servidor para uma linha de produto
  // (existente ou nova) — só quantidade importa daqui. Item manual segue com o que está na tela (o mesmo
  // snapshot que veio do pedido, se a linha não foi tocada além da quantidade).
  return items.map((item) => (item.productId
    ? { productId: item.productId, quantity: item.quantity }
    : { name: item.name, quantity: item.quantity, unitPrice: item.unitPrice }));
}

/**
 * Edição de itens de um pedido já existente — RS-PEDIDOS-01. Mesma UI de composição de itens do
 * NewOrderSheet (busca de produto, incremento/decremento, item manual), mas sobre a lista JÁ gravada em
 * vez de uma lista vazia, e sem os campos que a edição não altera (cliente, previsão, observações — o
 * comando do servidor nem aceita esses campos no payload). `items`/`expectedUpdatedAt` são capturados uma
 * única vez na montagem (o componente só existe enquanto a sheet está aberta, ver orders.tsx): edições em
 * andamento nunca são sobrescritas por uma atualização em tempo real de outro campo do mesmo pedido.
 */
export function EditOrderSheet({ order, onClose, onSubmit }: EditOrderSheetProps) {
  const { products, search: productSearch, setSearch: setProductSearch } = useProductPickerData();

  const [items, setItems] = useState<OrderItem[]>(order.items);
  const [showManualItemForm, setShowManualItemForm] = useState(false);
  const [manualName, setManualName] = useState("");
  const [manualQuantity, setManualQuantity] = useState(1);
  const [manualPrice, setManualPrice] = useState(0);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [isStale, setIsStale] = useState(false);

  useDismissibleOnBack(true, onClose);

  const normalizedProductSearch = productSearch.trim().toLowerCase();
  const matchingProducts = normalizedProductSearch
    ? products.filter((product) => product.name.toLowerCase().includes(normalizedProductSearch)).slice(0, 8)
    : [];

  const total = calculateOrderTotal(items);

  const addProductItem = (product: (typeof products)[number]) => {
    setItems((prev) => {
      const existing = prev.find((item) => item.productId === product.id);
      if (existing) {
        return prev.map((item) => item.productId === product.id ? { ...item, quantity: item.quantity + 1 } : item);
      }
      const pricing = resolveEffectiveProductPrice(product);
      const newItem: OrderItem = { productId: product.id, name: product.name, quantity: 1, unitPrice: pricing.effectivePrice };
      if (product.imageUrl) newItem.imageUrl = product.imageUrl;
      return [...prev, newItem];
    });
  };

  const updateItemQuantity = (index: number, quantity: number) => {
    if (quantity <= 0) {
      setItems((prev) => prev.filter((_, itemIndex) => itemIndex !== index));
      return;
    }
    setItems((prev) => prev.map((item, itemIndex) => itemIndex === index ? { ...item, quantity } : item));
  };

  const addManualItem = () => {
    const name = manualName.trim();
    if (!name || manualQuantity <= 0) return;
    setItems((prev) => [...prev, { name, quantity: manualQuantity, unitPrice: Math.max(0, manualPrice) }]);
    setManualName("");
    setManualQuantity(1);
    setManualPrice(0);
    setShowManualItemForm(false);
  };

  const handleSubmit = async () => {
    if (isSaving || items.length === 0) return;
    setIsSaving(true);
    setSaveError("");
    try {
      await onSubmit({ orderId: order.id, expectedUpdatedAt: order.updatedAt, items: toEditPayload(items) });
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.code === "STALE_ORDER_VERSION") {
        // O pedido mudou em outro lugar desde que esta edição abriu: nunca reenviar por cima em silêncio.
        // A única saída daqui é fechar — reabrir a edição pega a versão/itens atuais (a listagem já está
        // atualizada em tempo real).
        setIsStale(true);
      }
      setSaveError(err instanceof Error && err.message ? err.message : "Não foi possível salvar o pedido. Tente novamente.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[130] flex items-end justify-center bg-black/60 p-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,calc(env(safe-area-inset-bottom)+1rem))] backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="edit-order-title"
      onClick={onClose}
    >
      <div
        className="rs-sheet-enter flex max-h-[calc(100dvh-4rem)] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-border/20 bg-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-border/20 px-5 py-4">
          <h2 id="edit-order-title" className="text-base font-bold tracking-tight">Editar pedido</h2>
          <button type="button" onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-full bg-secondary" aria-label="Fechar edição do pedido"><X className="h-4 w-4" /></button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5 space-y-5">
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-muted-foreground">Adicionar produto</label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                value={productSearch}
                onChange={(event) => setProductSearch(event.target.value)}
                placeholder="Buscar produto do catálogo..."
                className="w-full rounded-full bg-secondary/50 py-3 pl-11 pr-4 text-sm outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>
            {matchingProducts.length > 0 && (
              <div className="mt-2 space-y-1.5 rounded-2xl border border-border/40 p-1.5">
                {matchingProducts.map((product) => {
                  const pricing = resolveEffectiveProductPrice(product);
                  return (
                    <button
                      type="button"
                      key={product.id}
                      data-testid={`button-edit-order-add-product-${product.id}`}
                      onClick={() => addProductItem(product)}
                      className="flex w-full items-center gap-2 rounded-xl p-1.5 text-left hover:bg-secondary/50"
                    >
                      <div className="h-9 w-9 shrink-0 overflow-hidden rounded-lg bg-secondary/30">
                        <ProductImageCard product={product} size="sm" objectFit="contain" className="!rounded-none !border-0" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-semibold">{product.name}</p>
                        <p className="text-[10px] text-muted-foreground">{formatCurrency(pricing.effectivePrice)}</p>
                      </div>
                      <Plus className="h-4 w-4 shrink-0 text-primary" />
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {items.length > 0 && (
            <div className="space-y-2">
              {items.map((item, index) => (
                <div key={`${item.productId || "manual"}-${index}`} className="flex items-center gap-2 rounded-xl bg-secondary/20 p-2">
                  {item.productId ? (
                    <div className="h-9 w-9 shrink-0 overflow-hidden rounded-lg bg-white">
                      {item.imageUrl && <img src={item.imageUrl} alt={item.name} className="h-full w-full object-contain" />}
                    </div>
                  ) : (
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white text-[9px] font-bold text-muted-foreground">Manual</div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-semibold">{item.name}</p>
                    <p className="text-[10px] text-muted-foreground">{formatCurrency(item.unitPrice)} cada</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button type="button" data-testid={`button-edit-order-decrease-${index}`} onClick={() => updateItemQuantity(index, item.quantity - 1)} className="flex h-6 w-6 items-center justify-center rounded-full bg-white"><Minus className="h-3 w-3" /></button>
                    <span className="w-4 text-center text-xs font-semibold">{item.quantity}</span>
                    <button type="button" data-testid={`button-edit-order-increase-${index}`} onClick={() => updateItemQuantity(index, item.quantity + 1)} className="flex h-6 w-6 items-center justify-center rounded-full bg-white"><Plus className="h-3 w-3" /></button>
                  </div>
                  <button type="button" data-testid={`button-edit-order-remove-${index}`} onClick={() => updateItemQuantity(index, 0)} className="shrink-0 text-muted-foreground" aria-label={`Remover ${item.name}`}><Trash2 className="h-4 w-4" /></button>
                </div>
              ))}
            </div>
          )}

          {showManualItemForm ? (
            <div className="space-y-2 rounded-2xl border border-dashed border-border/60 p-3">
              <input type="text" value={manualName} onChange={(event) => setManualName(event.target.value)} placeholder="Nome do item" className="w-full rounded-xl bg-secondary/40 p-3 text-sm outline-none focus:ring-1 focus:ring-primary" />
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="mb-1 block text-[10px] font-semibold text-muted-foreground">Quantidade</label>
                  <input type="number" inputMode="numeric" min={1} value={manualQuantity} onChange={(event) => setManualQuantity(Math.max(1, Number(event.target.value)))} className="w-full rounded-xl bg-secondary/40 p-2.5 text-sm text-center outline-none focus:ring-1 focus:ring-primary" />
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-semibold text-muted-foreground">Valor estimado (opcional)</label>
                  <input type="number" inputMode="decimal" min={0} step="0.01" value={manualPrice} onChange={(event) => setManualPrice(Math.max(0, Number(event.target.value)))} className="w-full rounded-xl bg-secondary/40 p-2.5 text-sm text-center outline-none focus:ring-1 focus:ring-primary" />
                </div>
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={() => setShowManualItemForm(false)} className="flex-1 rounded-xl bg-secondary px-3 py-2.5 text-xs font-semibold text-foreground">Cancelar</button>
                <button type="button" data-testid="button-edit-order-confirm-manual-item" onClick={addManualItem} disabled={!manualName.trim()} className="flex-1 rounded-xl bg-primary px-3 py-2.5 text-xs font-semibold text-white disabled:opacity-40">Adicionar</button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              data-testid="button-edit-order-add-manual-item"
              onClick={() => setShowManualItemForm(true)}
              className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-border/60 py-3 text-xs font-semibold text-muted-foreground"
            >
              <Plus className="h-4 w-4" /> Adicionar item manual
            </button>
          )}
        </div>

        <div className="shrink-0 space-y-2 border-t border-border/20 bg-white px-5 pt-3 pb-5">
          <div className="flex items-center justify-between"><span className="text-xs font-semibold text-muted-foreground">Novo total (estimado)</span><span className="text-xl font-semibold">{formatCurrency(total)}</span></div>
          {saveError && <p data-testid="text-edit-order-error" className="text-[10px] font-medium text-destructive">{saveError}</p>}
          {isStale ? (
            <button type="button" data-testid="button-edit-order-close-stale" onClick={onClose} className="rs-pressable w-full rounded-xl bg-secondary py-4 text-sm font-semibold text-foreground">
              Fechar e abrir a edição de novo
            </button>
          ) : (
            <button
              type="button"
              data-testid="button-submit-edit-order"
              onClick={handleSubmit}
              disabled={items.length === 0 || isSaving}
              className="rs-pressable w-full rounded-xl border border-primary/20 bg-gradient-to-r from-primary to-primary/90 py-4 text-sm font-semibold text-white shadow-md disabled:cursor-not-allowed disabled:opacity-40"
            >
              {isSaving ? "Salvando..." : "Salvar alterações"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
