import { useCallback, useEffect, useRef, useState } from "react";
import { collection, onSnapshot, getFirestore } from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import { getFirebaseAuth } from "@/lib/firebase";
import { useOnlineStatus } from "./useOnlineStatus";
import {
  claimPendingSale,
  settlePendingSale,
  renewPendingSaleLease,
  SYNC_REQUEST_TIMEOUT_MS,
  markPendingSalePending,
  removePendingSale,
  syncPendingSaleToServer,
  isValidPendingSaleDoc,
  markPendingSaleFailed,
  listPersistedPendingSales,
  reconcilePendingSaleIntent,
  restorePendingSaleDocument,
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
  const [durableDocs, setDurableDocs] = useState<PendingSaleDoc[]>([]);
  const syncInFlight = useRef(false);
  const workerId = useRef("");
  const activeUidRef = useRef<string | null>(null);
  const authGenerationRef = useRef(0);
  const activeSyncAbortRef = useRef<AbortController | null>(null);
  if (!workerId.current) workerId.current = typeof crypto.randomUUID === "function"
    ? crypto.randomUUID() : Array.from(crypto.getRandomValues(new Uint32Array(4)), (value) => value.toString(16).padStart(8, "0")).join("");
  const [recoveryTick, setRecoveryTick] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setRecoveryTick((tick) => tick + 1), 5_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const auth = getFirebaseAuth();
    if (!auth) return;
    let unsubscribeSnapshot: (() => void) | undefined;
    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      activeSyncAbortRef.current?.abort(new Error("AUTH_SESSION_CHANGED"));
      activeUidRef.current = user?.uid ?? null;
      authGenerationRef.current += 1;
      unsubscribeSnapshot?.();
      setDocs([]);
      setDurableDocs([]);
      if (!user) {
        setDocs([]);
        return;
      }
      const observedUid = user.uid;
      const observedGeneration = authGenerationRef.current;
      void listPersistedPendingSales(observedUid).then((localSales) => {
        if (activeUidRef.current === observedUid
          && authGenerationRef.current === observedGeneration
          && auth.currentUser?.uid === observedUid) {
          setDurableDocs(localSales);
        }
      }).catch(() => {});
      unsubscribeSnapshot = onSnapshot(
        collection(getFirestore(), "users", user.uid, "pendingSales"),
        (snapshot) => {
          if (activeUidRef.current === user.uid && authGenerationRef.current === observedGeneration && auth.currentUser?.uid === user.uid) {
            setDocs(snapshot.docs.map((d) => ({ id: d.id, ...d.data() }) as PendingSaleDoc));
          }
        },
        () => {
          if (activeUidRef.current === user.uid && authGenerationRef.current === observedGeneration && auth.currentUser?.uid === user.uid) setDocs([]);
        },
      );
    });
    return () => {
      activeSyncAbortRef.current?.abort(new Error("SYNC_HOOK_UNMOUNTED"));
      activeSyncAbortRef.current = null;
      activeUidRef.current = null;
      authGenerationRef.current += 1;
      unsubscribeSnapshot?.();
      unsubscribeAuth();
    };
  }, []);

  useEffect(() => {
    const auth = getFirebaseAuth();
    const user = auth?.currentUser;
    if (!user || activeUidRef.current !== user.uid) return;

    const syncUid = user.uid;
    const syncGeneration = authGenerationRef.current;
    let cancelled = false;
    const isCurrent = () => !cancelled
      && activeUidRef.current === syncUid
      && authGenerationRef.current === syncGeneration
      && auth?.currentUser?.uid === syncUid;

    void listPersistedPendingSales(syncUid).then(async (localSales) => {
      if (!isCurrent()) return;
      setDurableDocs(localSales);
      if (!isOnline) return;

      // Terminal intents are durable fences, not work to resend. Reconcile them before restoring a
      // missing mirror; a `settle` is completed only when the server-owned sales document proves it.
      for (const sale of localSales) {
        if (!isCurrent()) return;
        if (!sale.localReconciliationRequired || typeof sale.id !== "string" || !sale.id) continue;
        await reconcilePendingSaleIntent(syncUid, sale.id, isCurrent).catch(() => {});
      }
      if (!isCurrent()) return;
      const recoveredSales = await listPersistedPendingSales(syncUid).catch(() => localSales);
      if (!isCurrent()) return;
      setDurableDocs(recoveredSales);
      const firestoreIds = new Set(docs.map((sale) => sale.id));
      for (const sale of recoveredSales) {
        if (!isCurrent()) break;
        if (sale.localReconciliationRequired || !isValidPendingSaleDoc(sale) || firestoreIds.has(sale.id)) continue;
        await restorePendingSaleDocument(syncUid, sale, isCurrent).catch(() => {});
      }
    }).catch(() => {});

    return () => { cancelled = true; };
  }, [isOnline, docs, recoveryTick]);

  useEffect(() => {
    if (!isOnline || syncInFlight.current) return;
    const pending = docs.filter((d) => d.status === "pending" || d.status === "syncing");
    if (pending.length === 0) return;

    const auth = getFirebaseAuth();
    const user = auth?.currentUser;
    if (!user) return;

    const syncUid = user.uid;
    const syncGeneration = authGenerationRef.current;
    const isCurrentSync = () => activeUidRef.current === syncUid
      && authGenerationRef.current === syncGeneration
      && auth?.currentUser?.uid === syncUid;

    syncInFlight.current = true;
    (async () => {
      try { for (const item of pending) {
        if (!isCurrentSync()) break;
        // Cast through unknown deliberately: `docs` is typed for the happy path, but Firestore
        // snapshots are untrusted runtime data and may contain malformed documents after a crash.
        if (!isValidPendingSaleDoc(item as unknown)) {
          if (isCurrentSync() && typeof item.id === "string" && item.id) {
            await markPendingSaleFailed(user.uid, item.id, "Não foi possível recuperar esta venda. Revise os dados e tente novamente.", isCurrentSync).catch(() => {});
          }
          if (!isCurrentSync()) break;
          continue;
        }
        let claimed = false;
        let tokenTimer: ReturnType<typeof setTimeout> | undefined;
        try {
          if (!isCurrentSync()) break;
          const lease = await claimPendingSale(user.uid, item.id, workerId.current, undefined, isCurrentSync);
          if (!isCurrentSync()) break;
          if (!lease) continue;
          claimed = true;
          // Força renovação: o token em cache pode ter expirado durante o período offline (mesmo
          // motivo do checkout online em sell.tsx) — um token velho aqui viraria uma falha permanente
          // (§"nunca fica tentando de novo sozinho") por um motivo puramente de sessão, não de negócio.
          const token = await Promise.race([
            user.getIdToken(true),
            new Promise<never>((_, reject) => { tokenTimer = setTimeout(() => reject(new Error("SYNC_TOKEN_TIMEOUT")), SYNC_REQUEST_TIMEOUT_MS); }),
          ]);
          clearTimeout(tokenTimer);
          if (!isCurrentSync()) break;
          const leaseRenewed = await renewPendingSaleLease(user.uid, item.id, workerId.current, undefined, isCurrentSync);
          if (!isCurrentSync()) break;
          if (!leaseRenewed) continue;

          const controller = new AbortController();
          activeSyncAbortRef.current = controller;
          const requestTimer = setTimeout(() => controller.abort(new Error("SYNC_REQUEST_TIMEOUT")), SYNC_REQUEST_TIMEOUT_MS);
          try {
            const result = await syncPendingSaleToServer(token, lease.payload, controller.signal);
            if (!isCurrentSync()) break;
            await settlePendingSale(user.uid, item.id, workerId.current, result, undefined, isCurrentSync);
          } finally {
            clearTimeout(requestTimer);
            if (activeSyncAbortRef.current === controller) activeSyncAbortRef.current = null;
          }
        } catch {
          // Erro de rede no meio do drain — volta pra pending (não fica preso em "syncing") e a
          // próxima transição online tenta de novo.
          if (claimed && isCurrentSync()) await settlePendingSale(user.uid, item.id, workerId.current, { outcome: "retry" }, undefined, isCurrentSync).catch(() => {});
          break;
        } finally {
          clearTimeout(tokenTimer);
        }
      } } finally { syncInFlight.current = false; }
    })();
  }, [isOnline, docs, recoveryTick]);

  const retryPendingSale = useCallback(async (saleId: string) => {
    const auth = getFirebaseAuth();
    const uid = auth?.currentUser?.uid;
    if (!uid || activeUidRef.current !== uid || auth.currentUser?.uid !== uid) return;
    const generation = authGenerationRef.current;
    await markPendingSalePending(uid, saleId, () => activeUidRef.current === uid
      && authGenerationRef.current === generation && auth.currentUser?.uid === uid);
  }, []);

  const cancelPendingSale = useCallback(async (saleId: string) => {
    const auth = getFirebaseAuth();
    const uid = auth?.currentUser?.uid;
    if (!uid || activeUidRef.current !== uid || auth.currentUser?.uid !== uid) return;
    const generation = authGenerationRef.current;
    await removePendingSale(uid, saleId, () => activeUidRef.current === uid
      && authGenerationRef.current === generation && auth.currentUser?.uid === uid);
  }, []);

  const visibleDocs = [
    ...docs.map(remote => durableDocs.find(local => local.id === remote.id && local.localReconciliationRequired) ?? remote),
    ...durableDocs.filter(local => !docs.some(remote => remote.id === local.id)),
  ];
  return {
    pendingCount: visibleDocs.filter((d) => d.status === "pending").length,
    syncingCount: visibleDocs.filter((d) => d.status === "syncing").length,
    failedCount: visibleDocs.filter((d) => d.status === "failed").length,
    conflictCount: visibleDocs.filter((d) => d.status === "conflict").length,
    conflictDocs: visibleDocs.filter((d) => d.status === "conflict"),
    retryPendingSale,
    cancelPendingSale,
  };
}
