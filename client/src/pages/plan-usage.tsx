import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import {
  ArrowLeft, Loader2, Package, Users, Wrench, CheckCircle2, ArchiveRestore, Search, AlertTriangle, CalendarClock,
} from "lucide-react";
import { Layout } from "@/components/layout";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/EmptyState";
import { FilterChips } from "@/components/FilterChips";
import { PageSkeleton } from "@/components/PageSkeleton";
import { ProductImageCard } from "@/components/ProductImageCard";
import { notifyError, notifySuccess } from "@/lib/notify";
import type { Product } from "@/lib/mock-data";
import type { Service } from "@shared/services";
import { PLAN_CONFIG, UNLIMITED, isNearPlanLimit, resolvePlanAccessState, type BookingQuotaSnapshot, type PlanAccessState, type PlanType } from "@shared/monetization";
import { getPlanName } from "@/lib/plan-helpers";
import { buildLimitReachedCopy, buildNearLimitCopy } from "@/lib/plan-paywall-copy";
import { usePlanUsageSnapshot } from "@/hooks/usePlanUsageSnapshot";
import { useProductAccessList } from "@/hooks/useProductAccessList";
import { useServiceAccessList } from "@/hooks/useServiceAccessList";
import { setActiveProductSelection, setActiveServiceSelection } from "@/lib/plan-access-selection";

type PlanAccessView = "hub" | "products" | "services";
const VIEW_QUERY_PARAM = "view";

function readViewFromLocation(): PlanAccessView {
  if (typeof window === "undefined") return "hub";
  const value = new URLSearchParams(window.location.search).get(VIEW_QUERY_PARAM);
  return value === "products" || value === "services" ? value : "hub";
}

function formatBRL(value: number): string {
  return value.toLocaleString("pt-BR", { minimumFractionDigits: 2 });
}

const STATUS_FILTERS = ["Todos", "Ativos", "Preservados"] as const;
type StatusFilter = typeof STATUS_FILTERS[number];

function matchesStatusFilter(state: PlanAccessState, filter: StatusFilter): boolean {
  if (filter === "Ativos") return state === "active";
  if (filter === "Preservados") return state === "preserved";
  return true;
}

/**
 * PLAN-IMPL-02B2 §7-§11/§26 — estado de seleção é 100% local até "Salvar seleção" (um único write,
 * nunca um por checkbox). O servidor é a única autoridade real: esta função só prepara o payload final
 * (§6/§10) e reflete o resultado — nunca decide sozinha se algo É permitido além de um guia de UX rápido
 * (desabilitar novas marcações quando `atLimit`, nunca um bloqueio de segurança).
 */
function useAccessSelection<T extends { id: string }>(
  items: readonly T[],
  getCurrentState: (item: T) => PlanAccessState,
  limit: number,
  save: (selectedIds: string[]) => Promise<unknown>,
) {
  const [pending, setPending] = useState<Set<string> | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  useEffect(() => {
    setPending(new Set(items.filter((item) => getCurrentState(item) === "active").map((item) => item.id)));
  }, [items, getCurrentState]);

  const selectedCount = pending?.size ?? 0;
  const atLimit = limit !== UNLIMITED && selectedCount >= limit;

  const isDirty = useMemo(() => {
    if (!pending) return false;
    return items.some((item) => pending.has(item.id) !== (getCurrentState(item) === "active"));
  }, [pending, items, getCurrentState]);

  const isSelected = useCallback((id: string) => pending?.has(id) ?? false, [pending]);

  const toggle = useCallback((id: string) => {
    setPending((prev) => {
      if (!prev) return prev;
      const alreadySelected = prev.has(id);
      // §6/§10 — nunca deixa marcar além do limite do plano; desmarcar sempre é permitido (é assim que
      // uma troca acontece: desmarcar um, marcar outro, salvar uma vez só).
      if (!alreadySelected && limit !== UNLIMITED && prev.size >= limit) return prev;
      const next = new Set(prev);
      if (alreadySelected) next.delete(id); else next.add(id);
      return next;
    });
  }, [limit]);

  const resetToServerState = useCallback(() => {
    setPending(new Set(items.filter((item) => getCurrentState(item) === "active").map((item) => item.id)));
  }, [items, getCurrentState]);

  const handleSave = useCallback(async (): Promise<boolean> => {
    if (!pending) return false;
    setSaving(true);
    setSaveError("");
    try {
      await save(Array.from(pending));
      return true;
    } catch (err) {
      // §27 — nunca assume sucesso nem mantém o state local como se tivesse persistido; quem chama
      // re-busca o estado real do servidor depois de um erro.
      console.error("[useAccessSelection] save error:", err);
      setSaveError("Não foi possível atualizar seus itens ativos. Tente novamente.");
      return false;
    } finally {
      setSaving(false);
    }
  }, [pending, save]);

  return { selectedCount, atLimit, isDirty, isSelected, toggle, resetToServerState, handleSave, saving, saveError };
}

function ManagerHeader({ title, subtitle, onBack }: { title: string; subtitle: string; onBack: () => void }) {
  return (
    <div className="bg-white border-b border-border/50">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-4 space-y-3">
        <button type="button" onClick={onBack} className="rs-pressable inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground" data-testid="button-plan-usage-back">
          <ArrowLeft className="w-4 h-4" /> Plano e uso
        </button>
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{subtitle}</p>
        </div>
      </div>
    </div>
  );
}

function SelectionFooter({ selectedCount, limit, isDirty, saving, saveError, onSave }: {
  selectedCount: number; limit: number; isDirty: boolean; saving: boolean; saveError: string; onSave: () => void;
}) {
  return (
    <div className="sticky bottom-0 z-10 border-t border-border/60 bg-white/95 backdrop-blur px-4 sm:px-6 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      <div className="max-w-4xl mx-auto space-y-2">
        {saveError && <p className="rounded-xl border border-red-200 bg-red-50 p-2.5 text-center text-xs font-bold text-red-700" data-testid="text-selection-save-error">{saveError}</p>}
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-bold text-muted-foreground" data-testid="text-selection-count">
            {limit === UNLIMITED ? `${selectedCount} selecionados` : `${selectedCount} de ${limit} selecionados`}
          </p>
          <button
            type="button"
            onClick={onSave}
            disabled={!isDirty || saving}
            data-testid="button-save-selection"
            className="rs-pressable min-h-11 rounded-2xl bg-primary px-6 text-xs font-black uppercase tracking-widest text-white shadow-sm disabled:opacity-40 flex items-center gap-2"
          >
            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {saving ? "Salvando..." : "Salvar seleção"}
          </button>
        </div>
      </div>
    </div>
  );
}

function AccessStatusBadge({ state }: { state: PlanAccessState }) {
  return state === "active"
    ? <Badge className="bg-green-100 text-green-700 hover:bg-green-100 gap-1"><CheckCircle2 className="w-3 h-3" /> Ativo</Badge>
    : <Badge variant="secondary" className="gap-1"><ArchiveRestore className="w-3 h-3" /> Preservado</Badge>;
}

const MANAGER_PAGE_SIZE = 40;

function ProductAccessManagerView({ limit, onBack, onSaved }: { limit: number; onBack: () => void; onSaved: () => void }) {
  const { products, loading, error, refresh } = useProductAccessList();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("Todos");
  const [visibleCount, setVisibleCount] = useState(MANAGER_PAGE_SIZE);

  const getState = useCallback((product: Product) => resolvePlanAccessState(product.planAccessState), []);
  const selection = useAccessSelection(products, getState, limit, async (selectedIds) => {
    const result = await setActiveProductSelection(selectedIds);
    await refresh();
    onSaved();
    return result;
  });

  const filtered = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    return products.filter((product) => {
      const matchesSearch = !normalizedSearch || product.name?.toLowerCase().includes(normalizedSearch);
      return matchesSearch && matchesStatusFilter(getState(product), statusFilter);
    });
  }, [products, search, statusFilter, getState]);

  const visible = filtered.slice(0, visibleCount);

  const handleSave = async () => {
    const ok = await selection.handleSave();
    if (ok) notifySuccess("Itens ativos atualizados.");
    else { notifyError("Não foi possível atualizar seus itens ativos."); await refresh(); selection.resetToServerState(); }
  };

  return (
    <>
      <ManagerHeader title="Gerenciar produtos ativos" subtitle="Escolha quais produtos ficam ativos no seu plano atual." onBack={onBack} />
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-4 space-y-3 pb-4">
        <div className="relative">
          <Search className="w-4 h-4 absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground/50" />
          <input type="text" placeholder="Buscar por nome..." className="w-full bg-muted border border-border/60 rounded-xl py-3 pl-11 pr-4 text-sm focus:ring-2 focus:ring-primary/20 outline-none" value={search} onChange={(e) => setSearch(e.target.value)} data-testid="input-product-access-search" />
        </div>
        <FilterChips options={[...STATUS_FILTERS]} selected={statusFilter} onSelect={(value) => setStatusFilter(value as StatusFilter)} className="!mx-0 !px-0 !pb-0" />
      </div>
      <div className="max-w-4xl mx-auto px-4 sm:px-6">
        {loading ? (
          <PageSkeleton variant="products" count={4} />
        ) : error ? (
          <EmptyState icon={<AlertTriangle className="w-12 h-12 text-red-400" />} title="Ocorreu um erro temporário." description={error} />
        ) : filtered.length === 0 ? (
          <EmptyState icon={<Search className="w-12 h-12 text-primary/40" />} title="Nenhum produto encontrado" description="Tente outro termo ou outro filtro de status." />
        ) : (
          <>
            <ul className="space-y-2 pb-4">
              {visible.map((product) => {
                const state = getState(product);
                const checked = selection.isSelected(product.id);
                const disabledToCheck = !checked && selection.atLimit;
                return (
                  <li key={product.id}>
                    <label className={`flex items-center gap-3 rounded-2xl border bg-white p-3 shadow-sm ${disabledToCheck ? "opacity-60" : ""}`} data-testid={`row-product-access-${product.id}`}>
                      <input
                        type="checkbox"
                        className="w-5 h-5 shrink-0 rounded accent-primary"
                        checked={checked}
                        disabled={disabledToCheck}
                        onChange={() => selection.toggle(product.id)}
                        data-testid={`checkbox-product-${product.id}`}
                      />
                      <div className="h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-muted"><ProductImageCard product={product} size="md" objectFit="cover" /></div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold">{product.name}</p>
                        <p className="text-xs text-muted-foreground">R$ {formatBRL(Number(product.salePrice) || 0)} · estoque {Number(product.stock) || 0}</p>
                      </div>
                      <AccessStatusBadge state={state} />
                    </label>
                  </li>
                );
              })}
            </ul>
            {visibleCount < filtered.length && (
              <div className="flex justify-center pb-5">
                <button type="button" onClick={() => setVisibleCount((current) => current + MANAGER_PAGE_SIZE)} className="rs-pressable rounded-2xl bg-white px-5 py-3 text-xs font-semibold text-primary border border-primary/20 shadow-sm" data-testid="button-load-more-products">
                  Carregar mais ({filtered.length - visibleCount} restantes)
                </button>
              </div>
            )}
          </>
        )}
      </div>
      {!loading && !error && (
        <SelectionFooter selectedCount={selection.selectedCount} limit={limit} isDirty={selection.isDirty} saving={selection.saving} saveError={selection.saveError} onSave={handleSave} />
      )}
    </>
  );
}

function formatServicePrice(service: Service): string {
  if (service.pricing.mode === "fixed") return `R$ ${formatBRL(service.pricing.priceCents / 100)}`;
  if (service.pricing.mode === "starting_at") return `A partir de R$ ${formatBRL(service.pricing.startingAtPriceCents / 100)}`;
  return "Sob orçamento";
}

function ServiceAccessManagerView({ limit, onBack, onSaved }: { limit: number; onBack: () => void; onSaved: () => void }) {
  const { services, loading, error, refresh } = useServiceAccessList();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("Todos");

  const getState = useCallback((service: Service) => resolvePlanAccessState(service.planAccessState), []);
  const selection = useAccessSelection(services, getState, limit, async (selectedIds) => {
    const result = await setActiveServiceSelection(selectedIds);
    await refresh();
    onSaved();
    return result;
  });

  const filtered = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    return services.filter((service) => {
      const matchesSearch = !normalizedSearch || service.name?.toLowerCase().includes(normalizedSearch);
      return matchesSearch && matchesStatusFilter(getState(service), statusFilter);
    });
  }, [services, search, statusFilter, getState]);

  const handleSave = async () => {
    const ok = await selection.handleSave();
    if (ok) notifySuccess("Itens ativos atualizados.");
    else { notifyError("Não foi possível atualizar seus itens ativos."); await refresh(); selection.resetToServerState(); }
  };

  return (
    <>
      <ManagerHeader title="Gerenciar serviços ativos" subtitle="Escolha quais serviços ficam ativos no seu plano atual." onBack={onBack} />
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-4 space-y-3 pb-4">
        <div className="relative">
          <Search className="w-4 h-4 absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground/50" />
          <input type="text" placeholder="Buscar por nome..." className="w-full bg-muted border border-border/60 rounded-xl py-3 pl-11 pr-4 text-sm focus:ring-2 focus:ring-primary/20 outline-none" value={search} onChange={(e) => setSearch(e.target.value)} data-testid="input-service-access-search" />
        </div>
        <FilterChips options={[...STATUS_FILTERS]} selected={statusFilter} onSelect={(value) => setStatusFilter(value as StatusFilter)} className="!mx-0 !px-0 !pb-0" />
      </div>
      <div className="max-w-4xl mx-auto px-4 sm:px-6">
        {loading ? (
          <PageSkeleton variant="products" count={4} />
        ) : error ? (
          <EmptyState icon={<AlertTriangle className="w-12 h-12 text-red-400" />} title="Ocorreu um erro temporário." description={error} />
        ) : filtered.length === 0 ? (
          <EmptyState icon={<Search className="w-12 h-12 text-primary/40" />} title="Nenhum serviço encontrado" description="Tente outro termo ou outro filtro de status." />
        ) : (
          <ul className="space-y-2 pb-4">
            {filtered.map((service) => {
              const state = getState(service);
              const checked = selection.isSelected(service.id);
              const disabledToCheck = !checked && selection.atLimit;
              return (
                <li key={service.id}>
                  <label className={`flex items-center gap-3 rounded-2xl border bg-white p-3 shadow-sm ${disabledToCheck ? "opacity-60" : ""}`} data-testid={`row-service-access-${service.id}`}>
                    <input
                      type="checkbox"
                      className="w-5 h-5 shrink-0 rounded accent-primary"
                      checked={checked}
                      disabled={disabledToCheck}
                      onChange={() => selection.toggle(service.id)}
                      data-testid={`checkbox-service-${service.id}`}
                    />
                    <div className="h-11 w-11 shrink-0 rounded-xl bg-primary/10 flex items-center justify-center"><Wrench className="w-5 h-5 text-primary" /></div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{service.name}</p>
                      <p className="text-xs text-muted-foreground">{formatServicePrice(service)}{service.durationMinutes ? ` · ${service.durationMinutes} min` : ""}</p>
                    </div>
                    <AccessStatusBadge state={state} />
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {!loading && !error && (
        <SelectionFooter selectedCount={selection.selectedCount} limit={limit} isDirty={selection.isDirty} saving={selection.saving} saveError={selection.saveError} onSave={handleSave} />
      )}
    </>
  );
}

function UsageDomainCard({ icon: Icon, label, active, preserved, limit, totalLabel, onManage, nearLimitCopy }: {
  icon: typeof Package; label: string; active: number; preserved: number; limit: number; totalLabel: string; onManage?: () => void; nearLimitCopy?: string;
}) {
  // PLAN-IMPL-04A §26/N1-N6 — só faz sentido "perto do limite" enquanto nada foi preservado ainda (sem
  // preserved, o dono ainda está criando ativamente rumo ao teto; com preserved > 0, o card já mostra o
  // aviso de itens preservados abaixo, que é o estado mais relevante nesse momento).
  const showNearLimit = preserved === 0 && nearLimitCopy && isNearPlanLimit(active, limit);
  return (
    <div className="rounded-2xl border border-border/60 bg-white p-4 space-y-3" data-testid={`card-usage-${label.toLowerCase()}`}>
      <div className="flex items-center gap-2">
        <Icon className="w-4 h-4 text-primary" />
        <p className="text-xs font-black uppercase tracking-widest text-muted-foreground">{label}</p>
      </div>
      <div className="flex items-baseline gap-2">
        <p className="text-2xl font-semibold tabular-nums">{active}</p>
        <p className="text-xs text-muted-foreground">{limit === UNLIMITED ? "ativos (sem limite)" : `de ${limit} ativos`}</p>
      </div>
      <p className="text-xs text-muted-foreground">{totalLabel}</p>
      {preserved > 0 && onManage && (
        <button type="button" onClick={onManage} className="rs-pressable w-full rounded-xl bg-primary/10 text-primary py-2.5 text-xs font-bold" data-testid={`button-manage-${label.toLowerCase()}`}>
          Gerenciar ativos ({preserved} preservado{preserved === 1 ? "" : "s"})
        </button>
      )}
      {preserved === 0 && !showNearLimit && (
        <p className="text-[11px] text-green-700 font-semibold">Todos os seus {label.toLowerCase()} estão ativos no plano atual.</p>
      )}
      {showNearLimit && (
        <p className="text-[11px] text-amber-700 font-semibold" data-testid={`text-near-limit-${label.toLowerCase()}`}>{nearLimitCopy}</p>
      )}
    </div>
  );
}

/**
 * PLAN-IMPL-02C §46-48 — Free mostra "N de LIMITE" (e um aviso extra se já estiver acima, §46);
 * Pro/Premium mostra só a contagem real ("37"), nunca "37 / infinito" nem a palavra "ilimitado" — a
 * mensagem comercial é "sem limite comercial baixo no seu plano" (§48: o sentinel UNLIMITED continua só
 * um detalhe interno, nunca exposto tecnicamente ao dono).
 */
function BookingQuotaCard({ bookingsCurrentMonth, activePlan }: { bookingsCurrentMonth: BookingQuotaSnapshot; activePlan: PlanType }) {
  const [, setLocation] = useLocation();
  const isUnlimited = bookingsCurrentMonth.limit === UNLIMITED;
  const isOverLimit = !isUnlimited && bookingsCurrentMonth.used > bookingsCurrentMonth.limit;
  // PLAN-IMPL-04A §26/§29 — perto do limite é só um aviso discreto, nunca um bloqueio; acima do limite
  // (só possível após downgrade — a criação em si já é recusada pelo servidor antes de chegar a 21) usa
  // o mesmo texto padrão de PlanLimitPrompt (usedOverride = já possui mais do que o teto atual permite).
  const isNearLimit = !isUnlimited && !isOverLimit && isNearPlanLimit(bookingsCurrentMonth.used, bookingsCurrentMonth.limit);
  const overLimitCopy = isOverLimit ? buildLimitReachedCopy("bookings", activePlan, bookingsCurrentMonth.used) : null;
  return (
    <div className="rounded-2xl border border-border/60 bg-white p-4 space-y-3" data-testid="card-usage-agendamentos">
      <div className="flex items-center gap-2"><CalendarClock className="w-4 h-4 text-primary" /><p className="text-xs font-black uppercase tracking-widest text-muted-foreground">Agendamentos neste mês</p></div>
      {isUnlimited ? (
        <>
          <p className="text-2xl font-semibold tabular-nums">{bookingsCurrentMonth.used}</p>
          <p className="text-xs text-muted-foreground">Sem limite comercial baixo no seu plano.</p>
        </>
      ) : (
        <>
          <p className="text-2xl font-semibold tabular-nums">{bookingsCurrentMonth.used} de {bookingsCurrentMonth.limit}</p>
          {isNearLimit && (
            <p className="text-[11px] text-amber-700 leading-relaxed" data-testid="text-booking-near-limit">
              {buildNearLimitCopy("bookings", activePlan)}
            </p>
          )}
          {overLimitCopy && (
            <div className="space-y-2" data-testid="text-booking-over-limit">
              <p className="text-[11px] text-amber-700 leading-relaxed">
                Os existentes continuam seguros. Novos agendamentos ficam indisponíveis neste mês.
              </p>
              {overLimitCopy.benefitLine && (
                <p className="text-[11px] text-amber-700 leading-relaxed">{overLimitCopy.benefitLine}</p>
              )}
              {overLimitCopy.recommendedPlan && (
                <button type="button" onClick={() => setLocation("/plans")} className="text-[11px] font-black text-primary" data-testid="button-booking-limit-cta">
                  {overLimitCopy.ctaLabel} →
                </button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function PlanUsageHub({ onManageProducts, onManageServices }: { onManageProducts: () => void; onManageServices: () => void }) {
  const [, setLocation] = useLocation();
  const { snapshot, loading, error, activePlan, basePlan, trial } = usePlanUsageSnapshot();
  const trialActive = trial?.status === "active";
  // PLAN-IMPL-03 §45/§47 — só aparece para quem TEVE um trial de verdade (trialStatus real, nunca para
  // conta legada sem o campo), e nunca bloqueia o resto da página (Free continua totalmente usável logo
  // abaixo, §46).
  const trialJustExpired = trial?.status === "expired";

  return (
    <>
      <ManagerHeader title="Plano e uso" subtitle="Veja quanto do seu plano você já usa e gerencie seus itens ativos." onBack={() => setLocation("/settings")} />
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-5 space-y-5 pb-10">
        <div className="rounded-2xl border border-primary/20 bg-primary/5 p-4">
          <p className="text-[10px] font-black uppercase tracking-widest text-primary">Plano atual</p>
          <p className="text-lg font-semibold mt-0.5" data-testid="text-current-plan-name">
            {trialActive ? "Premium de teste" : getPlanName(activePlan)}
          </p>
          {trialActive && (
            <p className="text-xs text-muted-foreground mt-1" data-testid="text-trial-status">
              Seu plano base é {getPlanName(basePlan)}. Nenhuma cobrança automática ao final do teste.
            </p>
          )}
        </div>

        {trialJustExpired && (
          <div className="rounded-2xl border border-border/60 bg-white p-4 space-y-2" data-testid="card-trial-ended">
            <p className="text-sm font-bold text-foreground">Seu período Premium terminou.</p>
            <p className="text-xs text-muted-foreground leading-relaxed">Seus dados continuam seguros. Você pode continuar no {getPlanName(basePlan)} ou conhecer os planos.</p>
            <button type="button" onClick={() => setLocation("/plans")} className="text-xs font-black text-primary" data-testid="button-trial-ended-see-plans">Ver planos →</button>
          </div>
        )}

        {loading ? (
          <PageSkeleton variant="products" count={3} />
        ) : error || !snapshot ? (
          <EmptyState icon={<AlertTriangle className="w-12 h-12 text-red-400" />} title="Ocorreu um erro temporário." description={error || "Não foi possível carregar seu uso agora."} />
        ) : (
          <>
            {snapshot.selectionRequired && (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 space-y-1">
                <p className="text-sm font-bold text-amber-800">Seus dados continuam seguros.</p>
                <p className="text-xs text-amber-700 leading-relaxed">
                  Seu plano {getPlanName(activePlan)} permite um número limitado de itens ativos. Você tem mais itens cadastrados do que o plano permite manter ativos ao mesmo tempo — escolha quais deseja manter ativos abaixo, ou conheça um plano com mais espaço.
                </p>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <UsageDomainCard
                icon={Package} label="Produtos"
                active={snapshot.products.active} preserved={snapshot.products.preserved} limit={snapshot.products.limit}
                totalLabel={`${snapshot.products.used} produtos cadastrados`}
                onManage={onManageProducts}
                nearLimitCopy={buildNearLimitCopy("products", activePlan)}
              />
              <UsageDomainCard
                icon={Wrench} label="Serviços"
                active={snapshot.services.active} preserved={snapshot.services.preserved} limit={snapshot.services.limit}
                totalLabel={`${snapshot.services.used} serviços cadastrados`}
                onManage={onManageServices}
                nearLimitCopy={buildNearLimitCopy("services", activePlan)}
              />
              <div className="rounded-2xl border border-border/60 bg-white p-4 space-y-3" data-testid="card-usage-clientes">
                <div className="flex items-center gap-2"><Users className="w-4 h-4 text-primary" /><p className="text-xs font-black uppercase tracking-widest text-muted-foreground">Clientes</p></div>
                <p className="text-2xl font-semibold tabular-nums">{snapshot.clients.used}</p>
                <p className="text-xs text-muted-foreground">
                  {snapshot.clients.limit === UNLIMITED ? "cadastrados, sem limite no seu plano" : `cadastrados · seu plano permite até ${snapshot.clients.limit} para novos cadastros`}
                </p>
                <p className="text-[11px] text-muted-foreground">Todos os seus clientes e históricos continuam seguros.</p>
              </div>
              {snapshot.bookingsCurrentMonth && <BookingQuotaCard bookingsCurrentMonth={snapshot.bookingsCurrentMonth} activePlan={activePlan} />}
            </div>

            <div className="flex flex-col sm:flex-row gap-3 pt-2">
              <button type="button" onClick={() => setLocation("/plans")} className="rs-pressable flex-1 rounded-2xl border-2 border-primary bg-white py-3.5 text-xs font-black uppercase tracking-widest text-primary" data-testid="button-know-pro">
                Conhecer Pro/Premium
              </button>
            </div>
          </>
        )}
      </div>
    </>
  );
}

export default function PlanUsage() {
  const [, setLocation] = useLocation();
  const [view, setView] = useState<PlanAccessView>(readViewFromLocation);

  useEffect(() => {
    setView(readViewFromLocation());
  }, []);

  const goTo = useCallback((next: PlanAccessView) => {
    setView(next);
    setLocation(next === "hub" ? "/settings/plano-e-uso" : `/settings/plano-e-uso?view=${next}`, { replace: false });
  }, [setLocation]);

  const [productsLimit, setProductsLimit] = useState<number>(PLAN_CONFIG.free.limits.products);
  const [servicesLimit, setServicesLimit] = useState<number>(PLAN_CONFIG.free.limits.services);
  const { activePlan } = usePlanUsageSnapshot();
  useEffect(() => {
    setProductsLimit(PLAN_CONFIG[activePlan as PlanType].limits.products);
    setServicesLimit(PLAN_CONFIG[activePlan as PlanType].limits.services);
  }, [activePlan]);

  return (
    <Layout hideBottomNav={view !== "hub"}>
      <div className="min-h-full bg-background pb-10">
        {view === "products" ? (
          <ProductAccessManagerView limit={productsLimit} onBack={() => goTo("hub")} onSaved={() => {}} />
        ) : view === "services" ? (
          <ServiceAccessManagerView limit={servicesLimit} onBack={() => goTo("hub")} onSaved={() => {}} />
        ) : (
          <PlanUsageHub onManageProducts={() => goTo("products")} onManageServices={() => goTo("services")} />
        )}
      </div>
    </Layout>
  );
}
