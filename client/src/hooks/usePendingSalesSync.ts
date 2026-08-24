import { useCallback, useEffect, useRef, useState } from "react";
import { collection, onSnapshot, getFirestore } from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import { getFirebaseAuth } from "@/lib/firebase";
import { useOnlineStatus } from "./useOnlineStatus";
import {
  markPendingSaleSyncing,
  markPendingSalePending,
  markPendingSaleFailed,
  markPendingSaleConflict,
  removePendingSale,
  syncPendingSaleToServer,
  type PendingSaleDoc,
} from "@/lib/offline-sales-queue";

export interface PendingSalesSyncState {
  pendingCount: number;
  syncingCount: number;
  failedCount: number;
  // RELEASE-QUALITY-05 §9/§10: separado de "failed" — o servidor recusou por um motivo de negócio
  // explicável (estoque/produto mudou), não uma falha genérica. A venda nunca é apagada sozinha.
  conflictCount: number;
  conflictDocs: PendingSaleDoc[];
  /** "Tentar novamente" — volta pra "pending", a próxima janela online tenta de novo. */
  retryPendingSale: (saleId: string) => Promise<void>;
  /** "Cancelar" — só remove a fila local; nunca decrementa estoque (a venda nunca chegou a existir no servidor). */
  cancelPendingSale: (saleId: string) => Promise<void>;
}

/**
 * RELEASE-QUALITY-04 §4/§9 — drena `users/{uid}/pendingSales` sequencialmente (nunca em paralelo, pra
 * nunca correr risco de duas tentativas concorrentes da mesma venda) sempre que a conexão estiver de
 * volta. Montado uma vez em PrivateRouter — sobrevive à navegação entre páginas.
 */
export function usePendingSalesSync(): PendingSalesSyncState {
  const isOnline = useOnlineStatus();
  const [docs, setDocs] = useState<PendingSaleDoc[]>([]);
  const syncInFlight = useRef(false);

  useEffect(() => {
    const auth = getFirebaseAuth();
    if (!auth) return;
    let unsubscribeSnapshot: (() => void) | undefined;
    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      unsubscribeSnapshot?.();
      if (!user) {
        setDocs([]);
        return;
      }
      unsubscribeSnapshot = onSnapshot(
        collection(getFirestore(), "users", user.uid, "pendingSales"),
        (snapshot) => setDocs(snapshot.docs.map((d) => d.data() as PendingSaleDoc)),
        () => setDocs([]),
      );
    });
    return () => { unsubscribeSnapshot?.(); unsubscribeAuth(); };
  }, []);

  useEffect(() => {
    if (!isOnline || syncInFlight.current) return;
    const pending = docs.filter((d) => d.status === "pending");
    if (pending.length === 0) return;

    const auth = getFirebaseAuth();
    const user = auth?.currentUser;
    if (!user) return;

    syncInFlight.current = true;
    (async () => {
      for (const item of pending) {
        try {
          await markPendingSaleSyncing(user.uid, item.id);
          // Força renovação: o token em cache pode ter expirado durante o período offline (mesmo
          // motivo do checkout online em sell.tsx) — um token velho aqui viraria uma falha permanente
          // (§"nunca fica tentando de novo sozinho") por um motivo puramente de sessão, não de negócio.
          const token = await user.getIdToken(true);
          const result = await syncPendingSaleToServer(token, item.payload);
          if (result.outcome === "synced" || result.outcome === "already-exists") {
            await removePendingSale(user.uid, item.id);
          } else if (result.outcome === "conflict") {
            await markPendingSaleConflict(user.uid, item.id, result.reason, result.message);
          } else {
            await markPendingSaleFailed(user.uid, item.id, result.message);
          }
        } catch {
          // Erro de rede no meio do drain — volta pra pending (não fica preso em "syncing") e a
          // próxima transição online tenta de novo.
          await markPendingSalePending(user.uid, item.id).catch(() => {});
          break;
        }
      }
      syncInFlight.current = false;
    })();
  }, [isOnline, docs]);

  const retryPendingSale = useCallback(async (saleId: string) => {
    const uid = getFirebaseAuth()?.currentUser?.uid;
    if (!uid) return;
    await markPendingSalePending(uid, saleId);
  }, []);

  const cancelPendingSale = useCallback(async (saleId: string) => {
    const uid = getFirebaseAuth()?.currentUser?.uid;
    if (!uid) return;
    await removePendingSale(uid, saleId);
  }, []);

  return {
    pendingCount: docs.filter((d) => d.status === "pending").length,
    syncingCount: docs.filter((d) => d.status === "syncing").length,
    failedCount: docs.filter((d) => d.status === "failed").length,
    conflictCount: docs.filter((d) => d.status === "conflict").length,
    conflictDocs: docs.filter((d) => d.status === "conflict"),
    retryPendingSale,
    cancelPendingSale,
  };
}
