import { useCallback, useEffect, useRef, useState } from "react";
import { collection, onSnapshot, getFirestore } from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import { getFirebaseAuth } from "@/lib/firebase";
import { useOnlineStatus } from "./useOnlineStatus";
import type { PendingSaleDoc } from "@/lib/offline-sales-queue";
import { isPendingSaleReady } from "@/lib/pending-sale-state";

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
  const workerId = useRef(crypto.randomUUID());
  const authGeneration = useRef(0);
  const snapshotUid = useRef<string | null>(null);
  const requestController = useRef<AbortController | null>(null);
  const retryAfter = useRef(0);
  const [clock, setClock] = useState(Date.now());

  // Lease expiration does not emit a Firestore snapshot. Poll only while online,
  // with bounded cadence so recovery and transient failures never busy-loop.
  useEffect(() => {
    if (!isOnline) return;
    const timer = setInterval(() => setClock(Date.now()), 5_000);
    return () => clearInterval(timer);
  }, [isOnline]);

  useEffect(() => {
    const auth = getFirebaseAuth();
    if (!auth) return;
    let unsubscribeSnapshot: (() => void) | undefined;
    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      const generation = ++authGeneration.current;
      snapshotUid.current = null;
      requestController.current?.abort();
      unsubscribeSnapshot?.();
      setDocs([]);
      retryAfter.current = 0;
      if (!user) {
        setDocs([]);
        return;
      }
      unsubscribeSnapshot = onSnapshot(
        collection(getFirestore(), "users", user.uid, "pendingSales"),
        (snapshot) => {
          if (authGeneration.current === generation && auth.currentUser?.uid === user.uid) {
            snapshotUid.current = user.uid;
            setDocs(snapshot.docs.map((d) => d.data() as PendingSaleDoc));
          }
        },
        () => { if (authGeneration.current === generation) setDocs([]); },
      );
    });
    return () => {
      authGeneration.current += 1;
      snapshotUid.current = null;
      requestController.current?.abort();
      unsubscribeSnapshot?.(); unsubscribeAuth();
    };
  }, []);

  useEffect(() => {
    if (!isOnline || syncInFlight.current || Date.now() < retryAfter.current) return;
    const pending = docs.filter((d) => isPendingSaleReady(d));
    if (pending.length === 0) return;

    const auth = getFirebaseAuth();
    const user = auth?.currentUser;
    if (!user || snapshotUid.current !== user.uid) return;
    const generation = authGeneration.current;
    const isCurrent = () => authGeneration.current === generation && auth.currentUser?.uid === user.uid;

    syncInFlight.current = true;
    (async () => {
      try {
        const { claimPendingSale, settlePendingSale, syncPendingSaleToServer } = await import("@/lib/offline-sales-queue");
        for (const item of pending) {
          if (!isCurrent()) break;
          let claimed = false;
          const controller = new AbortController();
          requestController.current = controller;
          const timer = setTimeout(() => controller.abort(), 20_000);
          let abortTokenWait: (() => void) | undefined;
          try {
            const lease = await claimPendingSale(user.uid, item.id, workerId.current,
              () => isCurrent() && !controller.signal.aborted);
            if (!lease) continue;
            claimed = true;
            // Refresh credentials within the bounded attempt; a UI timeout must
            // not leave the persisted item permanently syncing.
            const token = await Promise.race([
              user.getIdToken(true),
              new Promise<never>((_resolve, reject) => {
                abortTokenWait = () => reject(new Error("PENDING_SALE_SYNC_ABORTED"));
                if (controller.signal.aborted) abortTokenWait();
                else controller.signal.addEventListener("abort", abortTokenWait, { once: true });
              }),
            ]);
            if (!isCurrent() || controller.signal.aborted) throw new Error("PENDING_SALE_SYNC_ABORTED");
            const result = await syncPendingSaleToServer(token, lease.payload, controller.signal);
            await settlePendingSale(user.uid, item.id, workerId.current, result, isCurrent);
            if (result.outcome === "retry") { retryAfter.current = Date.now() + 5_000; break; }
          } catch {
            // Release only this worker's claim; failed persistence keeps an
            // expiring lease instead of silently discarding the queued sale.
            retryAfter.current = Date.now() + 5_000;
            if (claimed && isCurrent()) {
              await settlePendingSale(user.uid, item.id, workerId.current, { outcome: "retry" }, isCurrent).catch(() => {
                // Keep the persisted lease: another attempt can recover it after expiry.
              });
            }
            break;
          } finally {
            clearTimeout(timer);
            if (abortTokenWait) controller.signal.removeEventListener("abort", abortTokenWait);
            if (requestController.current === controller) requestController.current = null;
          }
        }
      } catch {
        // A failed chunk load is retryable and must release the local runner.
        retryAfter.current = Date.now() + 5_000;
      } finally {
        syncInFlight.current = false;
      }
    })();
  }, [isOnline, docs, clock]);

  const retryPendingSale = useCallback(async (saleId: string) => {
    const auth = getFirebaseAuth();
    const uid = auth?.currentUser?.uid;
    if (!uid) return;
    const generation = authGeneration.current;
    const { markPendingSalePending } = await import("@/lib/offline-sales-queue");
    if (auth.currentUser?.uid !== uid || authGeneration.current !== generation) return;
    await markPendingSalePending(uid, saleId);
  }, []);

  const cancelPendingSale = useCallback(async (saleId: string) => {
    const auth = getFirebaseAuth();
    const uid = auth?.currentUser?.uid;
    if (!uid) return;
    const generation = authGeneration.current;
    const { removePendingSale } = await import("@/lib/offline-sales-queue");
    if (auth.currentUser?.uid !== uid || authGeneration.current !== generation) return;
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
