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
  const workerId = useRef("");
  if (!workerId.current) workerId.current = typeof crypto.randomUUID === "function"
    ? crypto.randomUUID() : Array.from(crypto.getRandomValues(new Uint32Array(4)), (value) => value.toString(16).padStart(8, "0")).join("");
  const [recoveryTick, setRecoveryTick] = useState(0);

  useEffect(() => {
    if (!isOnline) return;
    const timer = setInterval(() => setRecoveryTick((tick) => tick + 1), 5_000);
    return () => clearInterval(timer);
  }, [isOnline]);

  useEffect(() => {
    const auth = getFirebaseAuth();
    if (!auth) return;
    let unsubscribeSnapshot: (() => void) | undefined;
    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      unsubscribeSnapshot?.();
      setDocs([]);
      if (!user) {
        setDocs([]);
        return;
      }
      unsubscribeSnapshot = onSnapshot(
        collection(getFirestore(), "users", user.uid, "pendingSales"),
        (snapshot) => {
          if (auth.currentUser?.uid === user.uid) setDocs(snapshot.docs.map((d) => ({ id: d.id, ...d.data() }) as PendingSaleDoc));
        },
        () => setDocs([]),
      );
    });
    return () => { unsubscribeSnapshot?.(); unsubscribeAuth(); };
  }, []);

  useEffect(() => {
    if (!isOnline || syncInFlight.current) return;
    const pending = docs.filter((d) => d.status === "pending" || d.status === "syncing");
    if (pending.length === 0) return;

    const auth = getFirebaseAuth();
    const user = auth?.currentUser;
    if (!user) return;

    syncInFlight.current = true;
    (async () => {
      try { for (const item of pending) {
        // Cast through unknown deliberately: `docs` is typed for the happy path, but Firestore
        // snapshots are untrusted runtime data and may contain malformed documents after a crash.
        if (!isValidPendingSaleDoc(item as unknown)) {
          if (typeof item.id === "string" && item.id) {
            await markPendingSaleFailed(user.uid, item.id, "Não foi possível recuperar esta venda. Revise os dados e tente novamente.").catch(() => {});
          }
          continue;
        }
        let claimed = false;
        let tokenTimer: ReturnType<typeof setTimeout> | undefined;
        try {
          if (auth?.currentUser?.uid !== user.uid) break;
          const lease = await claimPendingSale(user.uid, item.id, workerId.current);
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
          if (auth?.currentUser?.uid !== user.uid) break;
          if (!await renewPendingSaleLease(user.uid, item.id, workerId.current)) continue;
          const result = await syncPendingSaleToServer(token, lease.payload, AbortSignal.timeout(SYNC_REQUEST_TIMEOUT_MS));
          await settlePendingSale(user.uid, item.id, workerId.current, result);
        } catch {
          // Erro de rede no meio do drain — volta pra pending (não fica preso em "syncing") e a
          // próxima transição online tenta de novo.
          if (claimed) await settlePendingSale(user.uid, item.id, workerId.current, { outcome: "retry" }).catch(() => {});
          break;
        } finally {
          clearTimeout(tokenTimer);
        }
      } } finally { syncInFlight.current = false; }
    })();
  }, [isOnline, docs, recoveryTick]);

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
