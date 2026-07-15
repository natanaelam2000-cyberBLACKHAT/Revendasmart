import { useCallback, useEffect, useState } from "react";
import { getFirestore, addDoc, collection, deleteDoc, doc, limit, onSnapshot, orderBy, query, serverTimestamp, updateDoc } from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import { getFirebaseAuth } from "@/lib/firebase";
import { sanitizeMarketingHistoryPayload, type MarketingAdThemeId, type MarketingBackgroundStyle, type MarketingTemplateId } from "@/lib/marketing-ad";

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
const cleanEntry = <T extends Record<string, unknown>>(entry: T) => sanitizeMarketingHistoryPayload(entry);
const readLocal = (uid: string): MarketingHistoryEntry[] => { try { const entries = JSON.parse(localStorage.getItem(storageKey(uid)) || "[]"); return Array.isArray(entries) ? entries.map(entry => cleanEntry(entry as Record<string, unknown>) as unknown as MarketingHistoryEntry) : []; } catch { return []; } };
const saveLocal = (uid: string, entries: MarketingHistoryEntry[]) => { try { localStorage.setItem(storageKey(uid), JSON.stringify(entries.slice(0, 200).map(entry => cleanEntry(entry as unknown as Record<string, unknown>)))); } catch { /* storage unavailable */ } };

export function useMarketingHistory() {
  const [entries, setEntries] = useState<MarketingHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const auth = getFirebaseAuth(); if (!auth) { setLoading(false); return; }
    let unsubscribeSnapshot: (() => void) | undefined;
    const unsubscribeAuth = onAuthStateChanged(auth, user => {
      unsubscribeSnapshot?.();
      if (!user) { setEntries([]); setLoading(false); return; }
      setEntries(readLocal(user.uid));
      const historyQuery = query(collection(getFirestore(), "users", user.uid, "marketingHistory"), orderBy("createdAt", "desc"), limit(200));
      unsubscribeSnapshot = onSnapshot(historyQuery, snapshot => {
        const remote = snapshot.docs.map(item => ({ id: item.id, ...cleanEntry(item.data() as Record<string, unknown>) } as MarketingHistoryEntry));
        if (remote.length) { setEntries(remote); saveLocal(user.uid, remote); } setLoading(false);
      }, () => setLoading(false));
    });
    return () => { unsubscribeSnapshot?.(); unsubscribeAuth(); };
  }, []);
  const recordAction = useCallback(async (entry: NewMarketingEntry) => {
    const user = getFirebaseAuth()?.currentUser; if (!user) return;
    const cleaned = cleanEntry(entry as unknown as Record<string, unknown>) as NewMarketingEntry;
    const optimistic: MarketingHistoryEntry = { ...cleaned, id: `local-${Date.now()}-${Math.random().toString(36).slice(2)}`, createdAtISO: new Date().toISOString(), createdAt: null };
    setEntries(current => { const next = [optimistic, ...current].slice(0, 200); saveLocal(user.uid, next); return next; });
    try { await addDoc(collection(getFirestore(), "users", user.uid, "marketingHistory"), { ...cleaned, createdAt: serverTimestamp(), createdAtISO: optimistic.createdAtISO }); }
    catch { /* Firestore rules may deny this optional history; local history remains available. */ }
  }, []);
  const updateEntry = useCallback(async (id: string, patch: Partial<NewMarketingEntry>) => {
    const user = getFirebaseAuth()?.currentUser; if (!user || !id) return;
    const updatedAtISO = new Date().toISOString();
    const cleaned = cleanEntry({ ...patch, updatedAtISO } as Record<string, unknown>) as Partial<MarketingHistoryEntry>;
    setEntries(current => { const next = current.map(entry => entry.id === id ? { ...entry, ...cleaned } : entry); saveLocal(user.uid, next); return next; });
    if (!id.startsWith("local-")) {
      try { await updateDoc(doc(getFirestore(), "users", user.uid, "marketingHistory", id), { ...cleaned, updatedAt: serverTimestamp(), updatedAtISO }); }
      catch { /* local update remains available */ }
    }
  }, []);
  const removeEntry = useCallback(async (id: string) => {
    const user = getFirebaseAuth()?.currentUser; if (!user || !id) return;
    setEntries(current => { const next = current.filter(entry => entry.id !== id); saveLocal(user.uid, next); return next; });
    if (!id.startsWith("local-")) { try { await deleteDoc(doc(getFirestore(), "users", user.uid, "marketingHistory", id)); } catch { /* local removal remains */ } }
  }, []);
  const clearHistory = useCallback(async () => {
    const user = getFirebaseAuth()?.currentUser; if (!user) return;
    const current = entries; setEntries([]); saveLocal(user.uid, []);
    await Promise.allSettled(current.filter(entry => !entry.id.startsWith("local-")).map(entry => deleteDoc(doc(getFirestore(), "users", user.uid, "marketingHistory", entry.id))));
  }, [entries]);
  return { entries, loading, recordAction, updateEntry, removeEntry, clearHistory };
}
