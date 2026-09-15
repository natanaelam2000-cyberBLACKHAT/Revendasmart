import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { OpportunityCard } from "./OpportunityCard";
import { fetchOpportunities, markOpportunityAction } from "@/lib/opportunities-client";
import { notifyError, notifySuccess } from "@/lib/notify";
import type { Opportunity, OpportunityActionStatus } from "@shared/opportunity-rules";

/** The API already owns ranking and active lifecycle filtering. No local re-scoring or detector. */
export default function TodayPriorities({ clients }: { clients: readonly { id: string; phone?: string }[] }) {
  const [items, setItems] = useState<Opportunity[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [reload, setReload] = useState(0);
  const [pending, setPending] = useState<Set<string>>(new Set());
  const inFlight = useRef(new Set<string>());
  const pendingRead = useRef<ReturnType<typeof fetchOpportunities> | null>(null);
  const [engaged, setEngaged] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    const request = pendingRead.current ??= fetchOpportunities();
    request.then(result => { if (!cancelled) setItems(result.opportunities); })
      .catch(() => { if (!cancelled) setFailed(true); })
      .finally(() => { if (pendingRead.current === request) pendingRead.current = null; });
    return () => { cancelled = true; };
  }, [reload]);

  const act = async (opportunity: Opportunity, status: OpportunityActionStatus) => {
    const fingerprint = opportunity.fingerprint;
    if (inFlight.current.has(fingerprint)) return;
    inFlight.current.add(fingerprint);
    setPending(new Set(inFlight.current));
    try {
      await markOpportunityAction(fingerprint, status, {
        type: opportunity.type, title: opportunity.entityReference.name, reason: opportunity.reason,
      });
      setItems(previous => previous?.filter(item => item.fingerprint !== fingerprint) ?? null);
      notifySuccess(status === "acted" ? "Feito — aguardando resultado no Histórico." : "Oportunidade dispensada.");
    } catch {
      notifyError("Não foi possível registrar a ação. Tente novamente.");
    } finally {
      inFlight.current.delete(fingerprint);
      setPending(new Set(inFlight.current));
    }
  };

  return (
    <section aria-labelledby="today-priorities-title" data-testid="today-priorities" className="rounded-3xl border border-primary/20 bg-primary/[0.03] p-3 sm:p-4">
      <h2 id="today-priorities-title" className="text-base font-black">Prioridades de hoje</h2>
      <p className="mt-1 mb-3 text-xs text-muted-foreground">O que vale a pena fazer hoje?</p>
      {failed ? <div className="text-sm">
        <p>Não foi possível carregar suas prioridades agora.</p>
        <button type="button" className="min-h-11 text-primary font-bold" onClick={() => setReload(value => value + 1)}>Tentar novamente</button>
      </div> : items === null ? <p role="status" className="py-4 text-sm text-muted-foreground">Carregando prioridades…</p> : items.length === 0 ? (
        <p data-testid="today-priorities-empty" className="rounded-xl bg-white p-4 text-sm">Nenhuma prioridade urgente agora.</p>
      ) : (
        <div className="grid gap-2 md:grid-cols-3">
          {items.slice(0, 3).map(opportunity => <OpportunityCard key={opportunity.fingerprint} compact
            opportunity={opportunity} pending={pending.has(opportunity.fingerprint)} engaged={engaged.has(opportunity.fingerprint)}
            clientPhone={opportunity.entityReference.type === "client" ? clients.find(client => client.id === opportunity.entityReference.id)?.phone : undefined}
            onEngaged={fingerprint => setEngaged(previous => new Set(previous).add(fingerprint))}
            onAct={opportunity => void act(opportunity, "acted")} onDismiss={opportunity => void act(opportunity, "dismissed")} />)}
        </div>
      )}
      <Link href="/opportunities" className="mt-2 flex min-h-11 items-center text-xs font-bold text-primary">Ver todas as oportunidades</Link>
    </section>
  );
}
