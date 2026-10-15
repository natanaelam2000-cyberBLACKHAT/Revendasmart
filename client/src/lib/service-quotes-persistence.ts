import {
  collection,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  orderBy,
  query,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import {
  assertValidQuote,
  assertValidQuoteVersion,
  type Quote,
  type QuoteVersion,
} from "@shared/service-quotes";
import { calculateCommercialTotals, type CommercialItem } from "@shared/services";
import { getCurrentFirebaseUser } from "./firebase";

export type CreateQuoteDraftInput = {
  customerId?: string;
  items: readonly CommercialItem[];
  customerMessage?: string;
  validUntil?: string;
};

export type UpdateQuoteDraftInput = CreateQuoteDraftInput;

function nowIso(): string {
  return new Date().toISOString();
}

function generateEntityId(prefix: string): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return `${prefix}-${globalThis.crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function requireCurrentUid(): string {
  const uid = getCurrentFirebaseUser()?.uid;
  if (!uid) throw new Error("UNAUTHENTICATED");
  return uid;
}

function omitUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, fieldValue]) => typeof fieldValue !== "undefined")) as T;
}

function quotesCollection(uid: string) {
  return collection(getFirestore(), "users", uid, "quotes");
}

function quoteVersionsCollection(uid: string, quoteId: string) {
  return collection(getFirestore(), "users", uid, "quotes", quoteId, "versions");
}

function parseQuote(value: unknown): Quote {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("INVALID_QUOTE");
  }
  return assertValidQuote(value as Quote);
}

function parseQuoteVersion(value: unknown): QuoteVersion {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("INVALID_QUOTE_VERSION");
  }
  return assertValidQuoteVersion(value as QuoteVersion);
}

export async function createQuoteDraft(input: CreateQuoteDraftInput): Promise<Quote> {
  const uid = requireCurrentUid();
  const quoteId = generateEntityId("quote");
  const timestamp = nowIso();
  const quote: Quote = assertValidQuote({
    id: quoteId,
    tenantUid: uid,
    status: "draft",
    customerId: input.customerId,
    draftItems: input.items,
    draftTotals: calculateCommercialTotals(input.items),
    draftCustomerMessage: input.customerMessage,
    draftValidUntil: input.validUntil,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  await setDoc(doc(quotesCollection(uid), quoteId), omitUndefined(quote as unknown as Record<string, unknown>));
  return quote;
}

export async function getQuote(quoteId: string): Promise<Quote | null> {
  const uid = requireCurrentUid();
  const snapshot = await getDoc(doc(quotesCollection(uid), quoteId));
  return snapshot.exists() ? parseQuote(snapshot.data()) : null;
}

export async function listQuotes(): Promise<Quote[]> {
  const uid = requireCurrentUid();
  const snapshot = await getDocs(query(quotesCollection(uid), orderBy("updatedAt", "desc")));
  return snapshot.docs.map((item) => parseQuote(item.data()));
}

export async function updateQuoteDraft(quoteId: string, input: UpdateQuoteDraftInput): Promise<Quote> {
  const current = await getQuote(quoteId);
  if (!current) throw new Error("QUOTE_NOT_FOUND");
  if (current.status !== "draft") throw new Error("QUOTE_NOT_DRAFT");
  const nextQuote: Quote = assertValidQuote({
    ...current,
    customerId: input.customerId,
    draftItems: input.items,
    draftTotals: calculateCommercialTotals(input.items),
    draftCustomerMessage: input.customerMessage,
    draftValidUntil: input.validUntil,
    updatedAt: nowIso(),
  });
  await updateDoc(doc(quotesCollection(current.tenantUid), quoteId), omitUndefined(nextQuote as unknown as Record<string, unknown>) as any);
  return nextQuote;
}

export async function getQuoteVersion(quoteId: string, versionId: string): Promise<QuoteVersion | null> {
  const uid = requireCurrentUid();
  const snapshot = await getDoc(doc(quoteVersionsCollection(uid, quoteId), versionId));
  return snapshot.exists() ? parseQuoteVersion(snapshot.data()) : null;
}

export async function listQuoteVersions(quoteId: string): Promise<QuoteVersion[]> {
  const uid = requireCurrentUid();
  const snapshot = await getDocs(query(quoteVersionsCollection(uid, quoteId), orderBy("versionNumber", "desc")));
  return snapshot.docs.map((item) => parseQuoteVersion(item.data()));
}
