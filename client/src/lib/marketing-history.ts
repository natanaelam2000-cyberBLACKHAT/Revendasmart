import type { MarketingHistoryEntry } from "@/hooks/useMarketingHistory";

/**
 * Id de uma entrada de historico, gerado no cliente ANTES de persistir para que o registro otimista e
 * o documento remoto sejam o mesmo. O prefixo `ad-` distingue os ids novos dos legados sem lhes dar
 * tratamento especial: entradas antigas (`local-*` ou id automatico do Firestore) continuam validas,
 * legiveis e removiveis exatamente como antes.
 */
export function createMarketingEntryId(): string {
  return `ad-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Entradas `local-*` nunca chegaram ao Firestore: so elas ficam fora de update/delete remoto. */
export const isLocalOnlyMarketingEntryId = (id: string): boolean => id.startsWith("local-");
const getEntryTime = (entry: MarketingHistoryEntry) => {  const value = entry.updatedAtISO || entry.createdAtISO || entry.updatedAt?.toDate?.()?.toISOString() || entry.createdAt?.toDate?.()?.toISOString() || "";  const time = Date.parse(value);  return Number.isFinite(time) ? time : 0;};const chooseMarketingHistoryEntry = (localEntry: MarketingHistoryEntry | undefined, remoteEntry: MarketingHistoryEntry) => {  if (!localEntry) return remoteEntry;  const localUpdated = Boolean(localEntry.updatedAtISO || localEntry.updatedAt);  const remoteUpdated = Boolean(remoteEntry.updatedAtISO || remoteEntry.updatedAt);  if (localUpdated || remoteUpdated) return getEntryTime(remoteEntry) > getEntryTime(localEntry) ? remoteEntry : localEntry;  return localEntry;};export function mergeMarketingHistory(localItems: MarketingHistoryEntry[], remoteItems: MarketingHistoryEntry[], deletedIds: Record<string, string> = {}) {  const merged = new Map<string, MarketingHistoryEntry>();  for (const item of localItems) if (item?.id && !deletedIds[item.id]) merged.set(item.id, item);  for (const item of remoteItems) if (item?.id && !deletedIds[item.id]) merged.set(item.id, chooseMarketingHistoryEntry(merged.get(item.id), item));  return Array.from(merged.values()).sort((a, b) => getEntryTime(b) - getEntryTime(a)).slice(0, 200);}