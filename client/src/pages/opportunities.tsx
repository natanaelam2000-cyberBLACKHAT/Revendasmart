import { useCallback, useEffect, useState } from "react";
import { useLocation } from "wouter";
import { collection, getDocs, getFirestore, query, where, documentId } from "firebase/firestore";
import { Sparkles, Lock, History as HistoryIcon } from "lucide-react";
import { Layout } from "@/components/layout";
import { PageSkeleton } from "@/components/PageSkeleton";
import { EmptyState } from "@/components/EmptyState";
import { usePlan } from "@/providers/PlanProvider";
import { fetchOpportunities, fetchOpportunityHistory, markOpportunityAction, markOpportunityOutcome, fetchOpportunityResult, type OpportunityLinkedResult } from "@/lib/opportunities-client";
import { OpportunityCard, TYPE_ICON, TYPE_LABEL } from "@/components/opportunities/OpportunityCard";
import { trackAnalyticsEvent, waitForAuthReady } from "@/lib/firebase";
import { notifyError, notifySuccess } from "@/lib/notify";
import type { PlanType } from "@shared/monetization";
import { opportunityResultState, summarizeOpportunityOutcomes } from "@shared/opportunity-rules";
import type { Opportunity, OpportunityActionRecord, OpportunityActionStatus } from "@shared/opportunity-rules";

/**
 * PLAN-IMPL-07A §34 — rota canônica única desta engine (nenhuma /intelligence ou /tasks paralela).
 * §33 — página dedicada e pesada fica FORA do dashboard (lazy, só carrega quando visitada); o dashboard
 * continua só com o cartão "Prioridades" leve já existente (home-dashboard-view-model.ts, inalterado).
 * §22/§23 — entitlement é sempre revalidado pelo servidor (opportunity-engine.ts); esta página só decide
 * SE chama a API com base em usePlan() (evita uma chamada/403 previsível no caminho comum), nunca
 * computa o resultado real e o esconde depois — quem não tem acesso nunca recebe a lista.
 *
 * PRODUCT-GROWTH-05 — adiciona o lifecycle (marcar feito/dispensar) e a aba Histórico. Mark-acted/Dismiss
 * SÓ acontecem por clique explícito nesses dois botões (§8: nunca automático por abrir a página/clicar no
 * CTA principal) — o CTA principal (§8/§9) continua abrindo a rota real do tipo, sem marcar nada sozinho.
 *
 * PRODUCT-GROWTH-06 — adiciona a ação comercial pronta (WhatsApp/copiar mensagem) para inactive_client/
 * overdue_receivable. §15 — telefone NUNCA vem de /api/opportunities (que continua sem ler/expor phone,
 * §40 da engine, inalterado): esta página faz sua PRÓPRIA leitura client-side, autenticada, tenant-scoped
 * (users/{uid}/clients, já protegida por firestore.rules), em lote (mesmo padrão de
 * billings.tsx's fetchClientsByIds — documentId() "in", até 10 por chamada), só para os clientIds que já
 * aparecem na lista. Abrir WhatsApp/copiar/abrir a rota de domínio NUNCA marca como feito sozinho (§8/§12
 * — inalterado); opcionalmente destaca visualmente "Marcar como feito" depois de qualquer uma dessas
 * ações nesta sessão (nunca persistido, §12 — "não grave uma ação falsa automaticamente").
 */

const CLIENT_PHONE_LOOKUP_BATCH_SIZE = 10;

function formatHistoryDate(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  return new Date(ms).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

/** §15 — telefone resolvido aqui, nunca no payload da API; mesma abordagem de billings.tsx (leitura
 * client-side em lote, tenant-scoped por firestore.rules), aplicada aos clientIds que já apareceram na
 * lista de oportunidades. `Record`, não `Map` — sem nenhuma colisão de nome com métodos de escrita do
 * Firestore a evitar aqui, mas mantém o mesmo estilo simples do resto do módulo. */
async function fetchClientPhonesByIds(uid: string, clientIds: string[]): Promise<Record<string, string | undefined>> {
  if (clientIds.length === 0) return {};
  const db = getFirestore();
  const result: Record<string, string | undefined> = {};
  for (let index = 0; index < clientIds.length; index += CLIENT_PHONE_LOOKUP_BATCH_SIZE) {
    const batch = clientIds.slice(index, index + CLIENT_PHONE_LOOKUP_BATCH_SIZE);
    const snapshot = await getDocs(query(collection(db, "users", uid, "clients"), where(documentId(), "in", batch)));
    snapshot.docs.forEach((docSnap) => {
      const data = docSnap.data() as { phone?: string };
      result[docSnap.id] = data.phone;
    });
  }
  return result;
}

function HistoryItemCard({ item, onUpdated }: { item: OpportunityActionRecord; onUpdated: () => void }) {
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<OpportunityLinkedResult | null>(null);
  const [linkResult, setLinkResult] = useState(false);
  const [referenceId, setReferenceId] = useState("");
  const resultType = item.opportunityType === "overdue_receivable" ? "installment" : item.opportunityType === "idle_schedule" ? "work" : "sale";
  const labels = { awaiting_result: "Feito — aguardando resultado", converted: "Gerou resultado", no_result: "Sem resultado", dismissed: "Dispensada" };
  const save = async (outcome: "converted" | "no_result") => {
    if (pending) return;
    setPending(true);
    try {
      await markOpportunityOutcome(item.fingerprint, outcome, outcome === "converted" && linkResult && referenceId.trim() ? { type: resultType, id: referenceId.trim() } : undefined);
      notifySuccess("Resultado registrado.");
      onUpdated();
    } catch { notifyError("Não foi possível registrar. Confira a referência e tente novamente."); }
    finally { setPending(false); }
  };
  const Icon = TYPE_ICON[item.opportunityType] ?? Sparkles;
  const isActed = item.status === "acted";
  const dateIso = isActed ? item.actedAt : item.dismissedAt;
  return (
    <div className="rounded-2xl border border-border/60 bg-white p-4" data-testid={`card-history-${item.fingerprint}`}>
      <div className="flex items-start gap-3">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${isActed ? "bg-emerald-100 text-emerald-600" : "bg-secondary text-muted-foreground"}`}>
          <Icon className="w-5 h-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">{TYPE_LABEL[item.opportunityType] ?? item.opportunityType}</p>
            <span className={`text-[9px] font-black uppercase tracking-wide px-1.5 py-0.5 rounded-full ${isActed ? "text-emerald-700 bg-emerald-50" : "text-muted-foreground bg-secondary"}`}>
              {labels[opportunityResultState(item)]}
            </span>
          </div>
          <p className="font-bold text-foreground truncate">{item.title}</p>
          {item.reasonSnapshot && <p className="text-xs text-muted-foreground mt-0.5">{item.reasonSnapshot}</p>}
          {dateIso && <p className="text-[10px] text-muted-foreground/70 mt-1">Ação: {formatHistoryDate(dateIso)}</p>}
        </div>
      </div>
      {item.resultReference && <button type="button" disabled={pending} className="mt-3 min-h-11 text-xs font-bold text-primary"
        onClick={async () => { setPending(true); try { setResult((await fetchOpportunityResult(item.fingerprint)).result); }
          catch { notifyError("Registro não disponível. Ele pode ter sido removido."); } finally { setPending(false); } }}>Abrir resultado associado</button>}
      {result && <section aria-label="Resultado associado" className="rounded-xl border p-3 mt-2 text-xs space-y-2 break-words">
        <p className="font-bold">{result.type === "sale" ? "Venda" : result.type === "installment" ? "Parcela" : "Atendimento"} · {result.id}</p>
        {result.date && <p>Data: {formatHistoryDate(result.date)}</p>}
        {result.status && <p>Status: {({ paid: "Pago", pending: "Pendente", partial: "Parcial", completed: "Concluído", cancelled: "Cancelado" } as Record<string, string>)[result.status] ?? result.status}</p>}
        {result.amount !== null && <p>Valor: {result.amount.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</p>}
        <p className="text-muted-foreground">Dados consultados no registro original.</p>
        {result.href && <a className="block min-h-11 text-primary" href={result.href}>Ver atendimento</a>}
        <button type="button" className="min-h-11 font-bold" onClick={() => setResult(null)}>Fechar resultado</button>
      </section>}
      {item.outcomeAt && <p className="text-xs text-muted-foreground mt-2">Resultado: {formatHistoryDate(item.outcomeAt)}</p>}
      {isActed && !item.outcome && (
        <div className="mt-3 space-y-3">
          <label className="flex items-center gap-2 text-xs min-h-11">
            <input type="checkbox" checked={linkResult} disabled={pending} onChange={event => setLinkResult(event.target.checked)} />
            Associar {resultType === "sale" ? "venda" : resultType === "work" ? "atendimento" : "parcela"} existente (opcional)
          </label>
          {linkResult && <label className="block text-xs">Identificador do registro
            <input className="mt-1 w-full min-w-0 rounded-lg border p-3" value={referenceId} maxLength={128} disabled={pending}
              onChange={event => setReferenceId(event.target.value)} placeholder="ID do registro existente" />
          </label>}
          <div className="grid grid-cols-2 gap-2">
            <button type="button" disabled={pending || (linkResult && !referenceId.trim())} onClick={() => save("converted")}
              className="min-h-11 rounded-xl bg-emerald-50 text-emerald-700 text-xs font-bold px-2 disabled:opacity-50">Gerou resultado</button>
            <button type="button" disabled={pending} onClick={() => save("no_result")}
              className="min-h-11 rounded-xl bg-secondary text-xs font-bold px-2 disabled:opacity-50">Não gerou resultado</button>
          </div>
        </div>
      )}
    </div>
  );
}

// PLAN-IMPL-08 §34/§35 — mesmo padrão de reports.tsx's UpgradeTeaser: view uma vez por montagem real.
function PremiumUpsell({ currentPlan }: { currentPlan: PlanType }) {
  const [, setLocation] = useLocation();
  useEffect(() => {
    trackAnalyticsEvent("house_promotion_viewed", { promotion_id: "opportunities_premium_upgrade", placement: "opportunities", current_plan: currentPlan, recommended_plan: "premium" });
  }, []);
  const handleClick = () => {
    trackAnalyticsEvent("house_promotion_clicked", { promotion_id: "opportunities_premium_upgrade", placement: "opportunities", current_plan: currentPlan, recommended_plan: "premium" });
    setLocation("/plans");
  };
  return (
    <EmptyState
      icon={<Lock className="w-10 h-10 text-primary/60" />}
      title="Oportunidades é um recurso Premium"
      // §23/§36 — nunca promete IA/previsão/receita garantida; só o que este runtime de fato entrega.
      description="Encontre automaticamente clientes inativos, produtos parados, parcelas em atraso e horários ociosos na sua agenda no plano Premium."
      action={
        <button
          type="button"
          onClick={handleClick}
          className="w-full rounded-xl bg-primary text-white text-xs font-black py-2.5 active:scale-95 transition-all"
          data-testid="button-opportunities-upgrade"
        >
          Conhecer o Premium
        </button>
      }
    />
  );
}

type ViewTab = "active" | "history";

export default function Opportunities() {
  const { activePlan, hasPremiumAccess, loading: planLoading, planResolved } = usePlan();
  const [tab, setTab] = useState<ViewTab>("active");
  const [opportunities, setOpportunities] = useState<Opportunity[] | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [reloadToken, setReloadToken] = useState(0);
  const [history, setHistory] = useState<OpportunityActionRecord[] | null>(null);
  const [historyError, setHistoryError] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyReloadToken, setHistoryReloadToken] = useState(0);
  // PRODUCT-GROWTH-05 §9 — impede double-submit: um fingerprint em voo desabilita os dois botões daquele
  // card específico, nunca a página inteira (outros cards continuam acionáveis).
  const [pendingFingerprints, setPendingFingerprints] = useState<Set<string>>(new Set());
  // PRODUCT-GROWTH-06 §15 — telefone por clientId, resolvido client-side (nunca via /api/opportunities).
  const [clientPhoneByClientId, setClientPhoneByClientId] = useState<Record<string, string | undefined>>({});
  // §12 — só em memória, nunca persistido: quais fingerprints tiveram uma ação comercial aberta nesta
  // sessão, só para destacar visualmente "Marcar como feito" — nunca para gravar uma ação sozinho.
  const [engagedFingerprints, setEngagedFingerprints] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (planLoading) return;
    if (!hasPremiumAccess) { setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    setError(false);
    fetchOpportunities()
      .then((result) => { if (!cancelled) setOpportunities(result.opportunities); })
      .catch(() => { if (!cancelled) setError(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [planLoading, hasPremiumAccess, reloadToken]);

  useEffect(() => {
    if (planLoading || !hasPremiumAccess) return;
    let cancelled = false;
    setHistoryLoading(true);
    setHistoryError(false);
    fetchOpportunityHistory()
      .then((result) => { if (!cancelled) setHistory(result.items); })
      .catch(() => { if (!cancelled) setHistoryError(true); })
      .finally(() => { if (!cancelled) setHistoryLoading(false); });
    return () => { cancelled = true; };
  }, [planLoading, hasPremiumAccess, historyReloadToken]);

  // PRODUCT-GROWTH-06 §15 — leitura em lote de telefone, só para os clientIds já presentes na lista
  // ativa; falha aqui nunca quebra a página — o card correspondente só cai no fallback de "sem telefone".
  useEffect(() => {
    if (!opportunities || opportunities.length === 0) return;
    const clientIds = Array.from(new Set(
      opportunities.filter((opportunity) => opportunity.entityReference.type === "client").map((opportunity) => opportunity.entityReference.id),
    ));
    if (clientIds.length === 0) return;
    let cancelled = false;
    waitForAuthReady()
      .then((user) => (user ? fetchClientPhonesByIds(user.uid, clientIds) : null))
      .then((phones) => { if (!cancelled && phones) setClientPhoneByClientId((prev) => ({ ...prev, ...phones })); })
      .catch(() => { /* silencioso de propósito — o card cai no fallback sem telefone, nunca quebra a página */ });
    return () => { cancelled = true; };
  }, [opportunities]);

  const handleEngaged = useCallback((fingerprint: string) => {
    setEngagedFingerprints((prev) => (prev.has(fingerprint) ? prev : new Set(prev).add(fingerprint)));
  }, []);

  const handleLifecycleAction = useCallback((opportunity: Opportunity, status: OpportunityActionStatus) => {
    if (pendingFingerprints.has(opportunity.fingerprint)) return;
    setPendingFingerprints((prev) => new Set(prev).add(opportunity.fingerprint));
    markOpportunityAction(opportunity.fingerprint, status, {
      type: opportunity.type,
      reason: opportunity.reason,
      title: opportunity.entityReference.name,
    })
      .then(() => {
        // §9 — atualiza a lista sem recarregar a página inteira; a próxima visita ao Histórico busca de
        // novo do zero (historyReloadToken), nunca reaproveita um cache potencialmente desatualizado.
        setOpportunities((prev) => (prev ? prev.filter((item) => item.fingerprint !== opportunity.fingerprint) : prev));
        setHistoryReloadToken(n => n + 1);
        notifySuccess(status === "acted" ? "Marcado como feito." : "Oportunidade dispensada.");
      })
      .catch((err) => {
        notifyError(err instanceof Error && err.message ? err.message : "Não foi possível concluir. Tente novamente.");
      })
      .finally(() => {
        setPendingFingerprints((prev) => {
          const next = new Set(prev);
          next.delete(opportunity.fingerprint);
          return next;
        });
      });
  }, [pendingFingerprints]);

  const handleAct = useCallback((opportunity: Opportunity) => handleLifecycleAction(opportunity, "acted"), [handleLifecycleAction]);
  const handleDismiss = useCallback((opportunity: Opportunity) => handleLifecycleAction(opportunity, "dismissed"), [handleLifecycleAction]);

  const metrics = history ? summarizeOpportunityOutcomes(history) : null;

  const activeTabButton = (
    <button
      type="button"
      onClick={() => setTab("active")}
      className={`flex-1 py-2.5 rounded-2xl text-xs font-semibold transition-all ${tab === "active" ? "bg-primary text-white shadow-sm" : "bg-secondary text-muted-foreground"}`}
      data-testid="tab-opportunities-active"
    >
      Ativas
    </button>
  );
  const historyTabButton = (
    <button
      type="button"
      onClick={() => setTab("history")}
      className={`flex-1 py-2.5 rounded-2xl text-xs font-semibold transition-all ${tab === "history" ? "bg-primary text-white shadow-sm" : "bg-secondary text-muted-foreground"}`}
      data-testid="tab-opportunities-history"
    >
      Histórico
    </button>
  );

  return (
    <Layout title="Oportunidades">
      <div className="px-4 py-4 space-y-4 max-w-2xl mx-auto" data-testid="page-opportunities">
        {planLoading ? (
          <PageSkeleton variant="list" count={4} />
        ) : !planResolved ? (
          // PLAN-IMPL-08-VERIFY-FINAL §3/§6 — erro real de usePlan() (loading já terminou, mas o plano
          // não pôde ser confirmado): nunca mostra PremiumUpsell (anunciaria upgrade para um pagante real
          // durante uma falha transitória) nem cai no ramo "nenhuma oportunidade encontrada" abaixo (que
          // mentiria — o motivo é falha de rede, não ausência real de oportunidades). Mesmo placeholder
          // neutro do estado de loading — do ponto de vista do usuário, "ainda não sabemos" é a mesma
          // coisa nos dois casos.
          <PageSkeleton variant="list" count={4} />
        ) : !hasPremiumAccess ? (
          <PremiumUpsell currentPlan={activePlan} />
        ) : (
          <>
            {metrics && !historyError && <section aria-label="Métricas de resultados" className="space-y-2">
              <p className="text-xs text-muted-foreground">Resultados dos últimos 500 registros do histórico</p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {Object.entries({ "Ações realizadas": metrics.actions,
                  "Convertidas": metrics.converted,
                  "Sem resultado": metrics.no_result,
                  "Aguardando resultado": metrics.awaiting,
                  "Taxa de conversão": metrics.conversionRate.toFixed(0) + "%" }).map(([label, value]) =>
                  <div key={label} className="rounded-xl border p-3 min-w-0"><p className="text-xs text-muted-foreground">{label}</p><p className="text-xl font-bold">{value}</p></div>)}
              </div>
            </section>}
            <div className="flex gap-2">
              {activeTabButton}
              {historyTabButton}
            </div>
            {tab === "active" ? (
              loading ? (
                <PageSkeleton variant="list" count={4} />
              ) : error ? (
                <EmptyState
                  icon={<Sparkles className="w-10 h-10 text-muted-foreground/40" />}
                  title="Não foi possível carregar agora"
                  description="Tente novamente em instantes."
                  action={
                    <button type="button" onClick={() => setReloadToken((n) => n + 1)} className="w-full rounded-xl bg-primary/10 text-primary text-xs font-black py-2.5 active:scale-95 transition-all" data-testid="button-opportunities-retry">
                      Tentar novamente
                    </button>
                  }
                />
              ) : !opportunities || opportunities.length === 0 ? (
                <EmptyState
                  icon={<Sparkles className="w-10 h-10 text-emerald-500/60" />}
                  title="Nenhuma oportunidade prioritária encontrada agora"
                  description="Assim que uma condição real do seu negócio pedir atenção — cliente sem comprar, produto parado, parcela vencida ou agenda livre — ela aparece aqui."
                />
              ) : (
                <div className="space-y-3">
                  {opportunities.map((opportunity) => (
                    <OpportunityCard
                      key={opportunity.id}
                      opportunity={opportunity}
                      pending={pendingFingerprints.has(opportunity.fingerprint)}
                      engaged={engagedFingerprints.has(opportunity.fingerprint)}
                      clientPhone={opportunity.entityReference.type === "client" ? clientPhoneByClientId[opportunity.entityReference.id] : undefined}
                      onAct={handleAct}
                      onDismiss={handleDismiss}
                      onEngaged={handleEngaged}
                    />
                  ))}
                </div>
              )
            ) : historyLoading ? (
              <PageSkeleton variant="list" count={3} />
            ) : historyError ? (
              <EmptyState
                icon={<HistoryIcon className="w-10 h-10 text-muted-foreground/40" />}
                title="Não foi possível carregar o histórico"
                description="Tente novamente em instantes."
                action={
                  <button type="button" onClick={() => setHistoryReloadToken((n) => n + 1)} className="w-full rounded-xl bg-primary/10 text-primary text-xs font-black py-2.5 active:scale-95 transition-all" data-testid="button-opportunities-history-retry">
                    Tentar novamente
                  </button>
                }
              />
            ) : !history || history.length === 0 ? (
              <EmptyState
                icon={<HistoryIcon className="w-10 h-10 text-muted-foreground/40" />}
                title="Nenhuma ação registrada ainda"
                description="Oportunidades marcadas como feitas ou dispensadas aparecem aqui."
              />
            ) : (
              <div className="space-y-3">
                {history.map((item) => (
                  <HistoryItemCard key={item.fingerprint} item={item} onUpdated={() => setHistoryReloadToken(n => n + 1)} />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </Layout>
  );
}
