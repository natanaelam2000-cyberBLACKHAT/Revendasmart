import { useMemo, useState } from "react";
import { ChevronDown, Minus, Plus, Search, Trash2, UserPlus, X } from "lucide-react";
import { ProductImageCard } from "@/components/ProductImageCard";
import { ClientPickerSheet } from "@/components/sell/ClientPickerSheet";
import { useClientPickerData } from "@/hooks/useClientPickerData";
import { useProductPickerData } from "@/hooks/useProductPickerData";
import { useCreateClient } from "@/hooks/useCreateClient";
import { useDismissibleOnBack } from "@/hooks/useDismissibleOnBack";
import { formatCurrency, resolveEffectiveProductPrice } from "@/lib/product-pricing";
import { calculateOrderTotal, type Order, type OrderItem } from "@/lib/orders";
import type { Client } from "@/lib/mock-data";

interface NewOrderSheetProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (input: { clientId: string; clientName: string; items: OrderItem[]; expectedDate?: string; notes?: string; clientPhone?: string }) => Promise<Order>;
}

export function NewOrderSheet({ open, onClose, onSubmit }: NewOrderSheetProps) {
  const { clients, search: clientSearch, setSearch: setClientSearch, hasMore: hasMoreClients, loadingMore: clientsLoadingMore, loadMore: loadMoreClients } = useClientPickerData();
  const { products, search: productSearch, setSearch: setProductSearch } = useProductPickerData();
  const { createClient, isCreating: isCreatingClient, error: newClientError, setError: setNewClientError } = useCreateClient();

  const [selectedClientId, setSelectedClientId] = useState("");
  const [justCreatedClient, setJustCreatedClient] = useState<Client | null>(null);
  const [showClientPicker, setShowClientPicker] = useState(false);
  const [showNewClientModal, setShowNewClientModal] = useState(false);
  const [newClientName, setNewClientName] = useState("");
  const [newClientPhone, setNewClientPhone] = useState("");

  const [items, setItems] = useState<OrderItem[]>([]);
  const [showManualItemForm, setShowManualItemForm] = useState(false);
  const [manualName, setManualName] = useState("");
  const [manualQuantity, setManualQuantity] = useState(1);
  const [manualPrice, setManualPrice] = useState(0);

  const [expectedDate, setExpectedDate] = useState("");
  const [notes, setNotes] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  const clientOptions = useMemo(() => {
    if (!justCreatedClient || clients.some((client) => client.id === justCreatedClient.id)) return clients;
    return [justCreatedClient, ...clients];
  }, [clients, justCreatedClient]);

  const selectedClient = clientOptions.find((client) => client.id === selectedClientId);

  const normalizedProductSearch = productSearch.trim().toLowerCase();
  const matchingProducts = useMemo(() => {
    if (!normalizedProductSearch) return [];
    return products.filter((product) => product.name.toLowerCase().includes(normalizedProductSearch)).slice(0, 8);
  }, [products, normalizedProductSearch]);

  const total = useMemo(() => calculateOrderTotal(items), [items]);

  // §3/P1-01: modal de novo cliente fica no topo da pilha (abre por cima da sheet), então back fecha ele
  // primeiro; só depois fecha a sheet inteira. `showClientPicker` não é registrado aqui — o próprio
  // `ClientPickerSheet` já se registra sozinho.
  useDismissibleOnBack(showNewClientModal, () => setShowNewClientModal(false));
  useDismissibleOnBack(open, onClose);

  if (!open) return null;

  const resetAndClose = () => {
    setSelectedClientId("");
    setJustCreatedClient(null);
    setItems([]);
    setShowManualItemForm(false);
    setManualName("");
    setManualQuantity(1);
    setManualPrice(0);
    setExpectedDate("");
    setNotes("");
    setSaveError("");
    onClose();
  };

  const addProductItem = (product: (typeof products)[number]) => {
    const pricing = resolveEffectiveProductPrice(product);
    setItems((prev) => {
      const existing = prev.find((item) => item.productId === product.id);
      if (existing) {
        return prev.map((item) => item.productId === product.id ? { ...item, quantity: item.quantity + 1 } : item);
      }
      // imageUrl só entra quando o produto realmente tem imagem — o Firestore rejeita undefined em
      // runtime, e um produto sem foto não pode travar a criação do pedido inteiro.
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

  const handleCreateClientSubmit = async () => {
    const created = await createClient({ name: newClientName, phone: newClientPhone });
    if (created) {
      setJustCreatedClient(created);
      setSelectedClientId(created.id);
      setShowNewClientModal(false);
      setNewClientName("");
      setNewClientPhone("");
    }
  };

  const handleSubmit = async () => {
    if (isSaving) return;
    if (!selectedClientId) {
      setSaveError("Selecione um cliente para prosseguir.");
      return;
    }
    if (items.length === 0) {
      setSaveError("Adicione ao menos um item ao pedido.");
      return;
    }
    setIsSaving(true);
    setSaveError("");
    try {
      await onSubmit({
        clientId: selectedClientId,
        clientName: selectedClient?.name || "",
        items,
        expectedDate: expectedDate || undefined,
        notes: notes.trim() || undefined,
        // Telefone sai do cliente JÁ carregado pelo picker — nenhuma leitura extra do Firestore só
        // para montar o snapshot. Normalização e descarte de valor inválido ficam em useOrdersData.
        clientPhone: selectedClient?.phone || undefined,
      });
      resetAndClose();
    } catch (err) {
      setSaveError(err instanceof Error && err.message ? err.message : "Não foi possível criar o pedido. Tente novamente.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <>
      <div
        className="fixed inset-0 z-[80] flex items-end justify-center bg-black/60 p-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,calc(env(safe-area-inset-bottom)+1rem))] backdrop-blur-sm"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-order-title"
        onClick={resetAndClose}
      >
        <div
          className="rs-sheet-enter flex max-h-[calc(100dvh-4rem)] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-border/20 bg-white shadow-2xl"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="flex shrink-0 items-center justify-between border-b border-border/20 px-5 py-4">
            <h2 id="new-order-title" className="text-base font-bold tracking-tight">Novo pedido</h2>
            <button type="button" onClick={resetAndClose} className="flex h-8 w-8 items-center justify-center rounded-full bg-secondary" aria-label="Fechar novo pedido"><X className="h-4 w-4" /></button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-5 space-y-5">
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-muted-foreground">Cliente</label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setShowClientPicker(true)}
                  data-testid="button-order-open-client-picker"
                  className="flex min-w-0 flex-1 items-center justify-between gap-2 rounded-2xl bg-secondary/50 p-4 text-left text-sm outline-none focus:ring-2 focus:ring-primary/20"
                >
                  <span className={`truncate ${selectedClient ? "font-semibold text-foreground" : "text-muted-foreground"}`}>
                    {selectedClient?.name || "Selecionar cliente..."}
                  </span>
                  <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                </button>
                <button
                  type="button"
                  onClick={() => { setNewClientError(""); setShowNewClientModal(true); }}
                  className="rs-pressable flex shrink-0 items-center gap-1.5 rounded-2xl bg-primary/10 px-4 text-xs font-semibold text-primary"
                >
                  <UserPlus className="h-4 w-4" /> Novo
                </button>
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-semibold text-muted-foreground">Produtos</label>
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
                      <button type="button" onClick={() => updateItemQuantity(index, item.quantity - 1)} className="flex h-6 w-6 items-center justify-center rounded-full bg-white"><Minus className="h-3 w-3" /></button>
                      <span className="w-4 text-center text-xs font-semibold">{item.quantity}</span>
                      <button type="button" onClick={() => updateItemQuantity(index, item.quantity + 1)} className="flex h-6 w-6 items-center justify-center rounded-full bg-white"><Plus className="h-3 w-3" /></button>
                    </div>
                    <button type="button" onClick={() => updateItemQuantity(index, 0)} className="shrink-0 text-muted-foreground" aria-label={`Remover ${item.name}`}><Trash2 className="h-4 w-4" /></button>
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
                  <button type="button" onClick={addManualItem} disabled={!manualName.trim()} className="flex-1 rounded-xl bg-primary px-3 py-2.5 text-xs font-semibold text-white disabled:opacity-40">Adicionar</button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                data-testid="button-add-manual-order-item"
                onClick={() => setShowManualItemForm(true)}
                className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-border/60 py-3 text-xs font-semibold text-muted-foreground"
              >
                <Plus className="h-4 w-4" /> Adicionar item manual
              </button>
            )}

            <div>
              <label className="mb-1.5 block text-xs font-semibold text-muted-foreground">Previsão de entrega (opcional)</label>
              <input type="date" value={expectedDate} onChange={(event) => setExpectedDate(event.target.value)} className="w-full rounded-2xl bg-secondary/50 p-3.5 text-sm outline-none focus:ring-2 focus:ring-primary/20" />
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-semibold text-muted-foreground">Observações (opcional)</label>
              <textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Detalhes do pedido..." className="h-20 w-full rounded-2xl bg-secondary/50 p-3.5 text-sm outline-none focus:ring-2 focus:ring-primary/20" />
            </div>
          </div>

          <div className="shrink-0 space-y-2 border-t border-border/20 bg-white px-5 pt-3 pb-5">
            <div className="flex items-center justify-between"><span className="text-xs font-semibold text-muted-foreground">Total estimado</span><span className="text-xl font-semibold">{formatCurrency(total)}</span></div>
            {saveError && <p className="text-[10px] font-medium text-destructive">{saveError}</p>}
            <button
              type="button"
              data-testid="button-submit-new-order"
              onClick={handleSubmit}
              disabled={!selectedClientId || items.length === 0 || isSaving}
              className="rs-pressable w-full rounded-xl border border-primary/20 bg-gradient-to-r from-primary to-primary/90 py-4 text-sm font-semibold text-white shadow-md disabled:cursor-not-allowed disabled:opacity-40"
            >
              {isSaving ? "Criando..." : "Criar pedido"}
            </button>
          </div>
        </div>
      </div>

      <ClientPickerSheet
        open={showClientPicker}
        onClose={() => setShowClientPicker(false)}
        clients={clientOptions}
        selectedClientId={selectedClientId}
        onSelect={setSelectedClientId}
        search={clientSearch}
        onSearchChange={setClientSearch}
        hasMore={hasMoreClients}
        loadingMore={clientsLoadingMore}
        onLoadMore={() => void loadMoreClients()}
        onCreateNew={() => { setShowClientPicker(false); setNewClientError(""); setShowNewClientModal(true); }}
      />

      {showNewClientModal && (
        <div className="fixed inset-0 z-[130] flex items-end justify-center bg-black/60 p-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,calc(env(safe-area-inset-bottom)+1rem))] backdrop-blur-sm">
          <div className="rs-sheet-enter w-full max-w-md rounded-[2rem] bg-white p-6 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold">Novo cliente</h3>
              <button type="button" onClick={() => setShowNewClientModal(false)} className="flex h-9 w-9 items-center justify-center rounded-full bg-secondary" aria-label="Fechar"><X className="h-4 w-4" /></button>
            </div>
            <div className="space-y-3">
              <input
                autoFocus
                type="text"
                placeholder="Nome completo"
                className="w-full bg-secondary/50 border-none rounded-2xl p-4 text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                value={newClientName}
                onChange={(event) => setNewClientName(event.target.value)}
                disabled={isCreatingClient}
              />
              <input
                type="tel"
                inputMode="tel"
                placeholder="Telefone (opcional)"
                className="w-full bg-secondary/50 border-none rounded-2xl p-4 text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                value={newClientPhone}
                onChange={(event) => setNewClientPhone(event.target.value.replace(/[^\d()+\- ]/g, ""))}
                disabled={isCreatingClient}
              />
              {newClientError && <p className="text-xs font-medium text-destructive">{newClientError}</p>}
            </div>
            <div className="mt-5 flex gap-3">
              <button type="button" onClick={() => setShowNewClientModal(false)} disabled={isCreatingClient} className="min-h-12 flex-1 rounded-2xl bg-secondary text-xs font-semibold text-foreground disabled:opacity-60">Cancelar</button>
              <button type="button" onClick={handleCreateClientSubmit} disabled={isCreatingClient} className="min-h-12 flex-1 rounded-2xl bg-primary text-xs font-semibold text-white disabled:opacity-60">{isCreatingClient ? "Salvando..." : "Salvar"}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
