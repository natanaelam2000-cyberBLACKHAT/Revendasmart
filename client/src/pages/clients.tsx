import { useState, useMemo } from "react";
import { PageSkeleton } from "@/components/PageSkeleton";
import { Layout } from "@/components/layout";
import { ConfirmActionDialog } from "@/components/ConfirmActionDialog";
import { Installment, defaultSettings } from "@/lib/mock-data";
import { Search, UserPlus, ChevronRight, Download, CheckSquare, Square, Send, AlertCircle, Pencil, Trash2 } from "lucide-react";
import { Link, useLocation } from "wouter";
import { usePaginatedClientsData } from "@/hooks/usePaginatedClientsData";
import { usePlan } from "@/providers/PlanProvider";
import { getFirebaseAuth, logTelemetryEvent, trackAnalyticsEvent, measureOperation } from "@/lib/firebase";
import { notifyError, notifyInfo, notifySuccess } from "@/lib/notify";
import { buildPublicCatalogUrl } from "@/lib/public-url";
import { toCsvRow } from "@/lib/export-security";
import { useSalesData } from "@/hooks/useSalesData";
import { buildLastSaleByClientId, isClientInactive } from "@/lib/client-activity";
import { useDismissibleOnBack } from "@/hooks/useDismissibleOnBack";
import { PRIORITY_QUERY_PARAM } from "@/lib/home-dashboard-view-model";

/**
 * RELEASE-26: lê o contexto do card de Prioridades ("N clientes sem comprar há +60 dias") ANTES de
 * cair num /clients genérico — mesmo padrão de products.tsx (readPriorityFilterFromLocation) e de
 * marketing-flow.ts (readMarketingLaunchRequest): lido uma vez, na montagem, via query string.
 */
function readInactiveFilterFromLocation(): boolean {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get(PRIORITY_QUERY_PARAM) === "inactive-clients";
}

export default function Clients() {
  const { clients, loading, loadingMore, error, hasMore, totalCount, loadMore, addClient, updateClient, deleteClient } = usePaginatedClientsData();
  const { activePlan } = usePlan();
  const [, setLocation] = useLocation();
  const { sales } = useSalesData();
  const [billings] = useState<Installment[]>([]);
  const [settings] = useState(() => defaultSettings);
  const [search, setSearch] = useState("");
  // Ponto do gate de contexto (RELEASE-26): `false` = navegação orgânica, sem card de origem.
  const [inactiveOnly, setInactiveOnly] = useState<boolean>(readInactiveFilterFromLocation);
  const [showAdd, setShowAdd] = useState(false);
  const [showLimitModal, setShowLimitModal] = useState(false);
  const [newClient, setNewClient] = useState({ name: '', phone: '', email: '', notes: '' });
  const [isCreating, setIsCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [createError, setCreateError] = useState("");

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isSelectionMode, setIsSelectionMode] = useState(false);

  // P1-01: modal de cliente (novo/editar) é um overlay customizado (não usa o primitivo Sheet/Dialog) —
  // back físico do Android precisa fechá-lo antes de sair da tela.
  useDismissibleOnBack(showAdd, () => setShowAdd(false));

  // Mesmo critério de client-activity.ts usado no card de Prioridades da Home — o número que o card
  // prometeu ("N clientes sem comprar há +60 dias") precisa bater com o que este filtro mostra aqui.
  const lastSaleByClientId = useMemo(() => buildLastSaleByClientId(sales), [sales]);
  const referenceDate = useMemo(() => new Date(), []);

  const filtered = useMemo(() => {
    return clients.filter(c => {
      const matchesSearch =
        c.name.toLowerCase().includes(search.toLowerCase()) ||
        c.phone.includes(search);
      const matchesInactive = !inactiveOnly || isClientInactive(lastSaleByClientId.get(c.id), referenceDate);
      return matchesSearch && matchesInactive;
    });
  }, [clients, search, inactiveOnly, lastSaleByClientId, referenceDate]);

  const clientById = useMemo(() => new Map(clients.map(client => [client.id, client])), [clients]);

  const toggleSelection = (id: string) => {
    setSelectedIds(prev =>
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const handleBroadcast = () => {
    if (selectedIds.length === 0) return;

    const storeName = settings?.storeName || "minha-loja";
    const slug = settings?.catalogSlug || storeName
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");

    const catalogLink = buildPublicCatalogUrl(slug);

    const message = `Olá! Temos novidades disponíveis. ✨\nVeja no catálogo:\n${catalogLink}`;

    // Send to all selected clients
    selectedIds.forEach((clientId, index) => {
      const client = clientById.get(clientId);
      if (client?.phone) {
        // Small delay between opens to avoid browser blocking
        setTimeout(() => {
          window.open(`https://wa.me/${client.phone}?text=${encodeURIComponent(message)}`, '_blank');
        }, index * 500);
      }
    });

    notifyInfo("Mensagens abertas no WhatsApp.");
    setIsSelectionMode(false);
    setSelectedIds([]);
  };

  const getBalance = (clientId: string) => {
    return billings
      .filter(b => b.clientId === clientId && b.status !== 'paid')
      .reduce((acc, curr) => acc + (curr.amount - curr.paidAmount), 0);
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validate plan limits for new clients
    if ((totalCount ?? clients.length) >= 50 && activePlan === 'free') {
      setShowLimitModal(true);
      setCreateError("Limite de 50 clientes atingido no plano Grátis.");
      return;
    }

    setIsCreating(true);
    setCreateError("");

    const clientId = editingId
      ? (await updateClient(editingId, newClient) ? editingId : null)
      : await measureOperation("client_creation", async () => addClient(newClient));

    if (clientId) {
      // Track client created event (both telemetry and analytics)
      const user = getFirebaseAuth()?.currentUser;
      logTelemetryEvent("client_created", { clientId }, user?.uid);
      trackAnalyticsEvent("client_created", { client_id: clientId });

      notifySuccess(editingId ? "Cliente atualizado." : "Cliente cadastrado.");
      setShowAdd(false);
      setEditingId(null);
      setNewClient({ name: '', phone: '', email: '', notes: '' });
      setCreateError(""); // Clear any previous errors
    } else {
      setCreateError("Erro ao salvar cliente. Verifique os dados e tente novamente.");
      notifyError("Erro ao salvar cliente.");
    }

    setIsCreating(false);
  };

  const openEdit = (client: any) => { setEditingId(client.id); setNewClient({ name: client.name || "", phone: client.phone || "", email: client.email || "", notes: client.notes || "" }); setShowAdd(true); };
  const handleDeleteClient = async (id: string) => {
    const ok = await deleteClient(id);
    if (ok) notifySuccess("Cliente removido.");
    else notifyError("Não foi possível remover o cliente.");
  };

  const exportCSV = () => {
    const headers = toCsvRow(["ID", "Nome", "Telefone", "Email", "Notas"]) + "\n";
    notifyInfo("Exportando clientes carregados.");
    const rows = clients.map(c => toCsvRow([c.id, c.name, c.phone, c.email || '', c.notes || ''])).join("\n");
    const blob = new Blob([`\uFEFF${headers}${rows}`], { type: 'text/csv;charset=utf-8;' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.setAttribute('hidden', '');
    a.setAttribute('href', url);
    a.setAttribute('download', 'clientes.csv');
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  };

  if (loading) {
    return <Layout title="Clientes"><PageSkeleton variant="list" /></Layout>;
  }

  if (error) {
    return (
      <Layout title="Clientes">
        <div className="p-6 text-center">
          <p className="text-destructive font-bold mb-2">Ocorreu um erro temporário.</p>
          <p className="text-muted-foreground text-sm mb-4">Não foi possível carregar seus clientes.</p>
          <button onClick={() => window.location.reload()} className="bg-primary text-white px-5 py-3 rounded-xl text-sm font-bold">Tentar novamente</button>
        </div>
      </Layout>
    );
  }

  // Limit Modal for Free Plan
  if (showLimitModal) {
    return (
      <Layout title="Limite Atingido">
        <div className="px-6 py-8 flex flex-col items-center justify-center min-h-screen gap-6">
          <div className="w-20 h-20 bg-amber-100 rounded-full flex items-center justify-center">
            <AlertCircle className="w-12 h-12 text-amber-600" />
          </div>

          <div className="text-center space-y-3">
            <h2 className="text-2xl font-bold text-foreground">Limite de Clientes Atingido</h2>
            <p className="text-sm text-muted-foreground">
              Você atingiu o limite de <strong>50 clientes</strong> no plano Grátis.
            </p>
            <p className="text-sm text-muted-foreground">
              Upgrade para Premium para adicionar clientes ilimitados!
            </p>
          </div>

          <div className="bg-blue-50 border border-blue-200 rounded-3xl p-4 w-full space-y-2">
            <p className="text-xs text-blue-700 font-bold">Plano Premium inclui:</p>
            <ul className="text-xs text-blue-600 space-y-1 list-disc list-inside">
              <li>Produtos ilimitados</li>
              <li>Clientes ilimitados</li>
              <li>Cobranças via Mercado Pago</li>
              <li>Múltiplos tipos de negócio</li>
            </ul>
          </div>

          <div className="flex gap-3 w-full">
            <button
              onClick={() => setShowLimitModal(false)}
              className="flex-1 bg-secondary text-foreground font-bold py-3 rounded-xl"
              data-testid="button-close-limit-modal"
            >
              Entendi
            </button>
            <button
              onClick={() => setLocation('/subscribe')}
              className="flex-1 bg-primary text-white font-bold py-3 rounded-xl"
              data-testid="button-upgrade-premium"
            >
              Upgrade →
            </button>
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout title="Clientes" hideBottomNav={showAdd}>
      <div className="px-4 sm:px-6 lg:px-8 py-6 pb-[max(8rem,calc(env(safe-area-inset-bottom)+7rem))] max-w-5xl mx-auto">
        {inactiveOnly && (
          <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-primary/20 bg-primary/5 px-3 py-2.5" data-testid="banner-priority-filter">
            <p className="text-xs font-bold text-primary">Filtro: Sem comprar há mais de 60 dias</p>
            <button type="button" onClick={() => setInactiveOnly(false)} className="rs-pressable rounded-lg px-2 py-1 text-[11px] font-bold text-primary hover:bg-primary/10" data-testid="button-clear-priority-filter">
              Ver todos
            </button>
          </div>
        )}
        <div className="flex gap-3 mb-6">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              inputMode="search"
              enterKeyHint="search"
              autoComplete="off"
              placeholder="Buscar cliente..."
              className="w-full bg-white border border-border rounded-full py-3 pl-11 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <button
            onClick={() => {
              setIsSelectionMode(!isSelectionMode);
              setSelectedIds([]);
            }}
            className={`w-12 h-12 rounded-full flex items-center justify-center shadow-sm transition-all ${isSelectionMode ? 'bg-primary text-white' : 'bg-secondary text-foreground'}`}
          >
            <CheckSquare className="w-5 h-5" />
          </button>
          {!isSelectionMode && (
            <>
              <button onClick={exportCSV} className="bg-secondary text-foreground w-12 h-12 rounded-full flex items-center justify-center shadow-sm">
                <Download className="w-5 h-5" />
              </button>
              <button
                onClick={() => setShowAdd(true)}
                className="bg-primary text-white w-12 h-12 rounded-full flex items-center justify-center shadow-lg active:scale-95 transition-all"
              >
                <UserPlus className="w-5 h-5" />
              </button>
            </>
          )}
        </div>

        {isSelectionMode && selectedIds.length > 0 && (
          <div className="mb-6 p-4 bg-primary/10 border border-primary/20 rounded-3xl flex items-center justify-between animate-in fade-in slide-in-from-top-2">
            <p className="text-xs font-bold text-primary">{selectedIds.length} selecionados</p>
            <button
              onClick={handleBroadcast}
              className="bg-primary text-white font-semibold py-2.5 px-5 rounded-xl text-xs flex items-center gap-2 shadow-md active:scale-95 transition-all"
            >
              <Send className="w-3 h-3" /> Enviar Mensagem
            </button>
          </div>
        )}

        {search && hasMore && (
          <p className="mb-4 text-center text-[11px] font-medium text-muted-foreground">
            Carregue mais clientes para ampliar a busca.
          </p>
        )}

        <div className="space-y-4">
          {filtered.length === 0 ? (
            <div className="rounded-[2rem] border border-dashed border-border/60 bg-white px-6 py-16 text-center flex flex-col items-center">
              <div className="mb-4 flex h-20 w-20 items-center justify-center rounded-[2rem] bg-primary/10">
                <UserPlus className="h-9 w-9 text-primary/45" />
              </div>
              <p className="font-semibold text-foreground">{clients.length === 0 ? "Nenhum cliente cadastrado" : "Nenhum cliente encontrado"}</p>
              <p className="mt-2 max-w-[260px] text-xs leading-relaxed text-muted-foreground">{clients.length === 0 ? "Cadastre clientes para acompanhar contatos, histórico e cobranças." : "Tente outro nome ou telefone para localizar o cliente."}</p>
              {clients.length === 0 ? (
                <button onClick={() => setShowAdd(true)} className="rs-pressable mt-5 rounded-2xl bg-primary px-5 py-3 text-xs font-semibold text-white">Cadastrar cliente</button>
              ) : (
                <button onClick={() => { setSearch(""); setInactiveOnly(false); }} className="rs-pressable mt-5 rounded-2xl bg-secondary px-5 py-3 text-xs font-semibold text-foreground">Limpar filtros</button>
              )}
            </div>
          ) : (
            <>
              {filtered.map(client => {
                const balance = getBalance(client.id);
                const isSelected = selectedIds.includes(client.id);

                return (
                  <div key={client.id} className="flex items-center gap-3">
                    {isSelectionMode && (
                      <button onClick={() => toggleSelection(client.id)} className="flex-shrink-0">
                        {isSelected ? <CheckSquare className="w-6 h-6 text-primary" /> : <Square className="w-6 h-6 text-muted-foreground/30" />}
                      </button>
                    )}
                    <Link href={isSelectionMode ? "#" : `/clients/${client.id}`} className="flex-1">
                      <a
                        onClick={(e) => {
                          if (isSelectionMode) {
                            e.preventDefault();
                            toggleSelection(client.id);
                          }
                        }}
                        className={`bg-white p-4 rounded-3xl border border-border/50 flex items-center gap-4 shadow-sm active:bg-secondary/30 transition-colors group w-full ${isSelected ? 'border-primary ring-2 ring-primary/5' : ''}`}
                      >
                        <div className="w-12 h-12 bg-primary/10 rounded-2xl flex items-center justify-center text-primary font-bold group-hover:bg-primary group-hover:text-white transition-colors">
                          {client.name.charAt(0)}
                        </div>
                        <div className="flex-1">
                          <h3 className="font-bold text-sm">{client.name}</h3>
                          <p className="text-xs text-muted-foreground">{client.phone}</p>
                        </div>
                        <div className="text-right">
                          <p className={`text-xs font-bold ${balance > 0 ? 'text-destructive' : 'text-green-600'}`}>
                            {balance > 0 ? `R$ ${balance.toFixed(2)}` : 'Em dia'}
                          </p>
                          <ChevronRight className="w-4 h-4 text-muted-foreground ml-auto mt-1" />
                        </div>
                      </a>
                    </Link>
                    {/* P1-02: min-h-11/min-w-11 = 44px de área de toque real — o ícone continua w-4 h-4
                        visualmente, só a área clicável cresce (era 36px, abaixo do confortável em mobile). */}
                    {!isSelectionMode && <div className="flex flex-col gap-1"><button onClick={() => openEdit(client)} className="min-h-11 min-w-11 rounded-xl bg-primary/10 text-primary flex items-center justify-center" aria-label={`Editar ${client.name}`}><Pencil className="w-4 h-4" /></button><ConfirmActionDialog title="Excluir cliente" description={<><p>Deseja excluir <strong>{client.name}</strong>?</p><p className="mt-2">Essa ação não pode ser desfeita.</p></>} confirmLabel="Excluir" onConfirm={() => handleDeleteClient(client.id)} trigger={<button className="min-h-11 min-w-11 rounded-xl bg-red-50 text-red-600 flex items-center justify-center" aria-label={`Excluir ${client.name}`}><Trash2 className="w-4 h-4" /></button>} /></div>}
                  </div>
                );
              })}
              {hasMore && (
                <div className="flex justify-center pt-2">
                  <button type="button" onClick={loadMore} disabled={loadingMore} className="rs-pressable rounded-2xl bg-white px-5 py-3 text-xs font-semibold text-primary border border-primary/20 shadow-sm disabled:opacity-60">
                    {loadingMore ? "Carregando..." : "Carregar mais"}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {showAdd && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-end animate-in fade-in duration-300">
          <div className="bg-white w-full max-w-md mx-auto rounded-t-[2.5rem] px-6 pt-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] animate-in slide-in-from-bottom-10 duration-300 max-h-[calc(100dvh-1rem)] overflow-y-auto overscroll-contain">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-bold">{editingId ? "Editar Cliente" : "Novo Cliente"}</h2>
              <button onClick={() => setShowAdd(false)} className="text-sm font-medium text-muted-foreground">Fechar</button>
            </div>
            <form onSubmit={handleAdd} className="space-y-4">
              <input required autoFocus enterKeyHint="next" autoComplete="name" placeholder="Nome completo" disabled={isCreating} className="w-full bg-secondary/50 border-none rounded-2xl p-4 text-sm focus:ring-2 focus:ring-primary/20 outline-none disabled:opacity-50" value={newClient.name} onChange={e => setNewClient({...newClient, name: e.target.value})} />
              <input
                required
                type="tel"
                inputMode="tel"
                enterKeyHint="next"
                autoComplete="tel"
                placeholder="WhatsApp (apenas números)"
                disabled={isCreating}
                className="w-full bg-secondary/50 border-none rounded-2xl p-4 text-sm focus:ring-2 focus:ring-primary/20 outline-none disabled:opacity-50"
                value={newClient.phone}
                onChange={e => setNewClient({...newClient, phone: e.target.value.replace(/\D/g, '')})}
                pattern="\d{10,15}"
                title="WhatsApp deve ter de 10 a 15 dígitos"
                data-testid="input-client-phone"
              />
              <input
                type="email" inputMode="email" enterKeyHint="next" autoComplete="email"
                placeholder="E-mail (opcional)"
                disabled={isCreating}
                className="w-full bg-secondary/50 border-none rounded-2xl p-4 text-sm focus:ring-2 focus:ring-primary/20 outline-none disabled:opacity-50"
                value={newClient.email}
                onChange={e => setNewClient({...newClient, email: e.target.value})}
                data-testid="input-client-email"
              />
              <textarea enterKeyHint="done" placeholder="Observações" disabled={isCreating} className="w-full bg-secondary/50 border-none rounded-2xl p-4 text-sm h-24 focus:ring-2 focus:ring-primary/20 outline-none disabled:opacity-50" value={newClient.notes} onChange={e => setNewClient({...newClient, notes: e.target.value})} />
              {createError && <p className="text-sm text-destructive font-bold">{createError}</p>}
              <button type="submit" disabled={isCreating} className="w-full bg-primary text-white font-bold py-4 rounded-full shadow-lg disabled:opacity-50">
                {isCreating ? "Salvando..." : editingId ? "Salvar alterações" : "Cadastrar cliente"}
              </button>
            </form>
          </div>
        </div>
      )}
    </Layout>
  );
}
