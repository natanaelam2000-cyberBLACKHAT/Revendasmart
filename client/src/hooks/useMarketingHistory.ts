import { useCallback, useEffect, useState } from "react";
import { getFirestore, addDoc, collection, deleteDoc, doc, limit, onSnapshot, orderBy, query, serverTimestamp } from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import { getFirebaseAuth } from "@/lib/firebase";

export type MarketingAction = "generated" | "downloaded" | "copied" | "shared";
export interface MarketingHistoryEntry {
  id: string; action: MarketingAction; productId: string; productName: string; productBrand?: string;
  imageUrl?: string; photoUrl?: string; image?: string; imageId?: string; generatedText: string; template: string; price: string; headline: string;
  storeName: string; primaryColor: string; createdAt?: { toDate?: () => Date } | null; createdAtISO: string;
}
export type NewMarketingEntry = Omit<MarketingHistoryEntry, "id" | "createdAt" | "createdAtISO">;
const storageKey = (uid:string) => `rs:marketing-history:${uid}`;
const readLocal = (uid:string):MarketingHistoryEntry[] => { try { return JSON.parse(localStorage.getItem(storageKey(uid)) || "[]"); } catch { return []; } };
const saveLocal = (uid:string, entries:MarketingHistoryEntry[]) => { try { localStorage.setItem(storageKey(uid), JSON.stringify(entries.slice(0,200))); } catch { /* storage unavailable */ } };

export function useMarketingHistory() {
  const [entries, setEntries] = useState<MarketingHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const auth=getFirebaseAuth(); if(!auth){setLoading(false);return;}
    let unsubscribeSnapshot:(()=>void)|undefined;
    const unsubscribeAuth=onAuthStateChanged(auth,user=>{
      unsubscribeSnapshot?.();
      if(!user){setEntries([]);setLoading(false);return;}
      setEntries(readLocal(user.uid));
      const historyQuery=query(collection(getFirestore(),"users",user.uid,"marketingHistory"),orderBy("createdAt","desc"),limit(200));
      unsubscribeSnapshot=onSnapshot(historyQuery,snapshot=>{
        const remote=snapshot.docs.map(item=>({id:item.id,...item.data()} as MarketingHistoryEntry));
        if(remote.length){setEntries(remote);saveLocal(user.uid,remote);} setLoading(false);
      },()=>setLoading(false));
    });
    return()=>{unsubscribeSnapshot?.();unsubscribeAuth();};
  },[]);
  const recordAction=useCallback(async(entry:NewMarketingEntry)=>{
    const user=getFirebaseAuth()?.currentUser;if(!user)return;
    const optimistic:MarketingHistoryEntry={...entry,id:`local-${Date.now()}-${Math.random().toString(36).slice(2)}`,createdAtISO:new Date().toISOString(),createdAt:null};
    setEntries(current=>{const next=[optimistic,...current].slice(0,200);saveLocal(user.uid,next);return next;});
    const cleanEntry=Object.fromEntries(Object.entries(entry).filter(([,value])=>value!==undefined));
    try { await addDoc(collection(getFirestore(),"users",user.uid,"marketingHistory"),{...cleanEntry,createdAt:serverTimestamp(),createdAtISO:optimistic.createdAtISO}); }
    catch { /* Firestore rules may deny this optional history; local history remains available. */ }
  },[]);
  const removeEntry=useCallback(async(id:string)=>{
    const user=getFirebaseAuth()?.currentUser;if(!user||!id)return;
    setEntries(current=>{const next=current.filter(entry=>entry.id!==id);saveLocal(user.uid,next);return next;});
    if(!id.startsWith("local-")){try{await deleteDoc(doc(getFirestore(),"users",user.uid,"marketingHistory",id));}catch{/* local removal remains */}}
  },[]);
  const clearHistory=useCallback(async()=>{
    const user=getFirebaseAuth()?.currentUser;if(!user)return;
    const current=entries;setEntries([]);saveLocal(user.uid,[]);
    await Promise.allSettled(current.filter(entry=>!entry.id.startsWith("local-")).map(entry=>deleteDoc(doc(getFirestore(),"users",user.uid,"marketingHistory",entry.id))));
  },[entries]);
  return {entries,loading,recordAction,removeEntry,clearHistory};
}
