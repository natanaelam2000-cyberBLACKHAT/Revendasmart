import { useEffect, useRef, useState } from "react";
import { CloudOff, RefreshCw, CloudCheck, AlertTriangle, ChevronDown, ChevronUp } from "lucide-react";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { usePendingSalesSync } from "@/hooks/usePendingSalesSync";
import type { PendingSaleConflictReason } from "@/lib/offline-sales-queue";

/**
 * RELEASE-QUALITY-04 §7 — indicador discreto de conectividade. Nunca bloqueia a tela, nunca usa texto
 * técnico de erro do Firebase, nunca aparece como popup — só um badge pequeno que só existe quando há
 * algo relevante a dizer (offline, sincronizando, pendência, conflito ou falha). "Tudo sincronizado"
 * aparece por alguns segundos só na transição de "havia pendência" para "não há mais nenhuma", depois
 * some.
 */

// RELEASE-QUALITY-05 §7/§10: um texto fixo e amigável por motivo — nunca a mensagem crua que o
// servidor devolveu (que pode incluir nome de produto ou linguagem técnica de validação).
const CONFLICT_REASON_TEXT: Record<PendingSaleConflictReason, string> = {
  INSUFFICIENT_STOCK: "Estoque insuficiente para sincronizar esta venda.",
  PRODUCT_NOT_FOUND: "Um produto desta venda não existe mais.",
  PRODUCT_CHANGED: "O preço de um produto desta venda mudou.",
};

export function ConnectivityIndicator() {
  const isOnline = useOnlineStatus();
  const { pendingCount, syncingCount, failedCount, conflictCount, conflictDocs, retryPendingSale, cancelPendingSale } = usePendingSalesSync();
  const [showSyncedBanner, setShowSyncedBanner] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const hadPendingRef = useRef(false);

  useEffect(() => {
    const hasActivity = pendingCount > 0 || syncingCount > 0;
    if (hasActivity) {
      hadPendingRef.current = true;
      setShowSyncedBanner(false);
      return;
    }
    if (hadPendingRef.current && isOnline && failedCount === 0 && conflictCount === 0) {
      hadPendingRef.current = false;
      setShowSyncedBanner(true);
      const timeout = window.setTimeout(() => setShowSyncedBanner(false), 4000);
      return () => window.clearTimeout(timeout);
    }
  }, [pendingCount, syncingCount, failedCount, conflictCount, isOnline]);

  if (!isOnline) {
    return (
      <div className="rs-connectivity-badge rs-connectivity-badge--offline" role="status" data-testid="connectivity-offline">
        <CloudOff className="h-3.5 w-3.5" aria-hidden="true" /> Offline
      </div>
    );
  }

  if (syncingCount > 0) {
    return (
      <div className="rs-connectivity-badge rs-connectivity-badge--syncing" role="status" data-testid="connectivity-syncing">
        <RefreshCw className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Sincronizando...
      </div>
    );
  }

  if (conflictCount > 0) {
    return (
      <div className="rs-connectivity-conflict-wrap">
        <button
          type="button"
          className="rs-connectivity-badge rs-connectivity-badge--conflict"
          role="status"
          data-testid="connectivity-conflict"
          onClick={() => setExpanded((current) => !current)}
        >
          <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
          {conflictCount === 1 ? "1 venda não sincronizada" : `${conflictCount} vendas não sincronizadas`}
          {expanded ? <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" /> : <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />}
        </button>
        {expanded && (
          <div className="rs-connectivity-conflict-panel" data-testid="connectivity-conflict-panel">
            {conflictDocs.map((item) => (
              <div key={item.id} className="rs-connectivity-conflict-item" data-testid={`conflict-item-${item.id}`}>
                <p className="rs-connectivity-conflict-message">
                  {item.conflictReason ? CONFLICT_REASON_TEXT[item.conflictReason] : "Esta venda não pôde ser sincronizada porque algo mudou desde que foi feita."}
                </p>
                <div className="rs-connectivity-conflict-actions">
                  <button type="button" onClick={() => retryPendingSale(item.id)} data-testid={`button-retry-conflict-${item.id}`}>
                    Tentar novamente
                  </button>
                  <button type="button" onClick={() => cancelPendingSale(item.id)} data-testid={`button-cancel-conflict-${item.id}`}>
                    Cancelar
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  if (failedCount > 0) {
    return (
      <div className="rs-connectivity-badge rs-connectivity-badge--failed" role="status" data-testid="connectivity-failed">
        <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" /> Falha ao sincronizar
      </div>
    );
  }

  if (pendingCount > 0) {
    return (
      <div className="rs-connectivity-badge rs-connectivity-badge--pending" role="status" data-testid="connectivity-pending">
        {pendingCount} {pendingCount === 1 ? "alteração pendente" : "alterações pendentes"}
      </div>
    );
  }

  if (showSyncedBanner) {
    return (
      <div className="rs-connectivity-badge rs-connectivity-badge--synced" role="status" data-testid="connectivity-synced">
        <CloudCheck className="h-3.5 w-3.5" aria-hidden="true" /> Tudo sincronizado
      </div>
    );
  }

  return null;
}
