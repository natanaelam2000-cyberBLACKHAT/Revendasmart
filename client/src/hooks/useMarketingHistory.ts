import { useCallback, useEffect, useRef, useState } from "react";
import { getFirestore, collection, deleteDoc, doc, limit, onSnapshot, orderBy, query, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import { getFirebaseAuth } from "@/lib/firebase";
import { sanitizeMarketingHistoryPayload, type MarketingAdThemeId, type MarketingBackgroundStyle, type MarketingTemplateId } from "@/lib/marketing-ad";
import { createMarketingEntryId, isLocalOnlyMarketingEntryId, mergeMarketingHistory } from "@/lib/marketing-history";
// Mesmo primitivo de geracao usado no hardening de Products — uma unica implementacao de "resposta stale".
import { createGenerationController, type GenerationController } from "@/lib/product-availability";
import type { ProductAssetSnapshot } from "../../../shared/product-image-preservation";

export { createMarketingEntryId, isLocalOnlyMarketingEntryId } from "@/lib/marketing-history";
export type MarketingAction = "generated" | "downloaded" | "copied" | "shared" | "edited" | "duplicated";
export interface MarketingHistoryEntry {
  id: string;
  action: MarketingAction;
  productId: string;
  productName: string;
  productBrand?: string;
  productImageUrl?: string;
  productVolume?: string;
  stockStatus?: string;
  imageUrl?: string;
  photoUrl?: string;
  image?: string;
  imageId?: string;
  productAssetSnapshot?: ProductAssetSnapshot;
  generatedText: string;
  template: string;
  templateId?: MarketingTemplateId;
  themeId?: MarketingAdThemeId;
  price: string;
  priceText?: string;
  headline: string;
  note?: string;
  ctaText?: string;
  storeName: string;
  storeLogoUrl?: string;
  primaryColor: string;
  showBrand?: boolean;
  showVolume?: boolean;
  showStockStatus?: boolean;
  showWhatsAppCta?: boolean;
  backgroundStyle?: MarketingBackgroundStyle;
  catalogUrl?: string;
  createdAt?: { toDate?: () => Date } | null;
  createdAtISO: string;
  updatedAt?: { toDate?: () => Date } | null;
  updatedAtISO?: string;
}
export type NewMarketingEntry = Omit<MarketingHistoryEntry, "id" | "createdAt" | "createdAtISO" | "updatedAt">;
const storageKey = (uid: string) => `rs:marketing-history:${uid}`;
const deletedStorageKey = (uid: string) => `rs:marketing-history-deleted:${uid}`;
const cleanEntry = <T extends Record<string, unknown>>(entry: T) => sanitizeMarketingHistoryPayload(entry);
const readLocal = (uid: string): MarketingHistoryEntry[] => { try { const entries = JSON.parse(localStorage.getItem(storageKey(uid)) || "[]"); return Array.isArray(entries) ? entries.map(entry => cleanEntry(entry as Record<string, unknown>) as unknown as MarketingHistoryEntry) : []; } catch { return []; } };
const saveLocal = (uid: string, entries: MarketingHistoryEntry[]) => { try { localStorage.setItem(storageKey(uid), JSON.stringify(entries.slice(0, 200).map(entry => cleanEntry(entry as unknown as Record<string, unknown>)))); } catch { /* storage unavailable */ } };
const readDeletedIds = (uid: string): Record<string, string> => { try { const value = JSON.parse(localStorage.getItem(deletedStorageKey(uid)) || "{}"); return value && typeof value === "object" && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).filter(([id, deletedAt]) => typeof id === "string" && typeof deletedAt === "string")) as Record<string, string> : {}; } catch { return {}; } };
const saveDeletedIds = (uid: string, deletedIds: Record<string, string>) => { try { localStorage.setItem(deletedStorageKey(uid), JSON.stringify(deletedIds)); } catch { /* storage unavailable */ } };

export function useMarketingHistory() {
  const [entries, setEntries] = useState<MarketingHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  /** Desmontagem: nenhum callback atrasado pode gravar estado depois que o hook morreu. */
  const mountedRef = useRef(true);
  /** Geração do listener: invalidada a cada troca de sessão, para descartar callbacks de listeners antigos. */
  const listenerGenerationRef = useRef<GenerationController>(createGenerationController());
  /** Uid que o listener corrente espera — um callback de outra conta nunca pode escrever aqui. */
  const listenerUidRef = useRef<string | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    const auth = getFirebaseAuth(); if (!auth) { setLoading(false); return; }
    let unsubscribeSnapshot: (() => void) | undefined;
    const unsubscribeAuth = onAuthStateChanged(auth, user => {
      unsubscribeSnapshot?.();
      // Toda troca de sessão invalida a geração: respostas em voo do listener anterior viram stale.
      listenerGenerationRef.current.invalidate();
      const generation = listenerGenerationRef.current.current();
      listenerUidRef.current = user?.uid ?? null;

      if (!user) { setEntries([]); setLoading(false); return; }
      const expectedUid = user.uid;
      /**
       * Um callback só pode escrever se: o hook ainda está montado, a geração continua sendo a atual
       * e o uid do listener é o mesmo que ele carregava. Sem os três, um snapshot atrasado da conta
       * anterior sobrescrevia a lista da conta nova (e ainda gravava no localStorage do uid errado).
       */
      const isCurrentCallback = () =>
        mountedRef.current
        && listenerGenerationRef.current.isCurrent(generation)
        && listenerUidRef.current === expectedUid;

      setEntries(readLocal(expectedUid));
      const historyQuery = query(collection(getFirestore(), "users", expectedUid, "marketingHistory"), orderBy("createdAt", "desc"), limit(200));
      unsubscribeSnapshot = onSnapshot(historyQuery, snapshot => {
        if (!isCurrentCallback()) return;
        const remote = snapshot.docs.map(item => ({ id: item.id, ...cleanEntry(item.data() as Record<string, unknown>) } as MarketingHistoryEntry));
        const merged = mergeMarketingHistory(readLocal(expectedUid), remote, readDeletedIds(expectedUid));
        setEntries(merged); saveLocal(expectedUid, merged); setLoading(false);
      }, () => {
        // O callback de erro também precisa da guarda: um erro do listener antigo não pode derrubar
        // o loading da sessão nova nem apagar o que ela já carregou.
        if (!isCurrentCallback()) return;
        setLoading(false);
      });
    });
    return () => {
      mountedRef.current = false;
      listenerGenerationRef.current.invalidate();
      listenerUidRef.current = null;
      unsubscribeSnapshot?.();
      unsubscribeAuth();
    };
  }, []);
  const recordAction = useCallback(async (entry: NewMarketingEntry) => {
    const user = getFirebaseAuth()?.currentUser; if (!user) return;
    const cleaned = cleanEntry(entry as unknown as Record<string, unknown>) as NewMarketingEntry;
    // UMA ação = UMA entrada. O id é decidido AQUI, antes de qualquer persistência, e é o mesmo no
    // estado otimista, no localStorage e no documento do Firestore. Com addDoc o servidor gerava um
    // id diferente do `local-*` otimista e o merge — que casa por id — enxergava dois registros para
    // a mesma ação, duplicando o histórico a cada geração/compartilhamento.
    const entryId = createMarketingEntryId();
    const createdAtISO = new Date().toISOString();
    const optimistic: MarketingHistoryEntry = { ...cleaned, id: entryId, createdAtISO, createdAt: null };
    setEntries(current => { const next = [optimistic, ...current].slice(0, 200); saveLocal(user.uid, next); return next; });
    try { await setDoc(doc(getFirestore(), "users", user.uid, "marketingHistory", entryId), { ...cleaned, createdAt: serverTimestamp(), createdAtISO }); }
    catch { /* Firestore rules may deny this optional history; local history remains available. */ }
  }, []);
  const updateEntry = useCallback(async (id: string, patch: Partial<NewMarketingEntry>) => {
    const user = getFirebaseAuth()?.currentUser; if (!user || !id) return;
    const updatedAtISO = new Date().toISOString();
    const cleaned = cleanEntry({ ...patch, updatedAtISO } as Record<string, unknown>) as Partial<MarketingHistoryEntry>;
    setEntries(current => { const next = current.map(entry => entry.id === id ? { ...entry, ...cleaned } : entry); saveLocal(user.uid, next); return next; });
    if (!isLocalOnlyMarketingEntryId(id)) {
      try { await updateDoc(doc(getFirestore(), "users", user.uid, "marketingHistory", id), { ...cleaned, updatedAt: serverTimestamp(), updatedAtISO }); }
      catch { /* local update remains available */ }
    }
  }, []);
  const removeEntry = useCallback(async (id: string) => {
    const user = getFirebaseAuth()?.currentUser; if (!user || !id) return;
    const deletedIds = { ...readDeletedIds(user.uid), [id]: new Date().toISOString() }; saveDeletedIds(user.uid, deletedIds);
    setEntries(current => { const next = current.filter(entry => entry.id !== id); saveLocal(user.uid, next); return next; });
    if (!isLocalOnlyMarketingEntryId(id)) { try { await deleteDoc(doc(getFirestore(), "users", user.uid, "marketingHistory", id)); } catch { /* local removal remains */ } }
  }, []);
  const clearHistory = useCallback(async () => {
    const user = getFirebaseAuth()?.currentUser; if (!user) return;
    const current = entries; const deletedIds = { ...readDeletedIds(user.uid) }; for (const entry of current) deletedIds[entry.id] = new Date().toISOString(); saveDeletedIds(user.uid, deletedIds); setEntries([]); saveLocal(user.uid, []);
    await Promise.allSettled(current.filter(entry => !isLocalOnlyMarketingEntryId(entry.id)).map(entry => deleteDoc(doc(getFirestore(), "users", user.uid, "marketingHistory", entry.id))));
  }, [entries]);
  return { entries, loading, recordAction, updateEntry, removeEntry, clearHistory };
}
