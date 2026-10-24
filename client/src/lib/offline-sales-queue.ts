/**
 * RELEASE-QUALITY-04 §3/§4/§5 — fila de vendas offline. Escopo deliberadamente restrito a vendas
 * "avista" (à vista): venda a prazo já depende de uma segunda chamada (cobrança/parcelamento via
 * Mercado Pago, ver `createSaleCharge` em sell.tsx) que é inerentemente online-only — misturar isso
 * numa fila offline criaria exatamente o risco financeiro que o ticket pede pra evitar.
 *
 * Design: cada venda é confirmada primeiro em um journal próprio do IndexedDB e depois espelhada em
 * `users/{uid}/pendingSales/{saleId}` no Firestore para claim, lease e sincronização. O journal é a
 * cópia durável de recuperação caso o SDK do Firestore use cache em memória. Nenhuma baixa de estoque
 * é decidida aqui — só o servidor (`POST
 * /api/sales/finalize`, `db.runTransaction`) decide e escreve estoque, exatamente como no fluxo online
 * já existente. Replay nunca duplica porque a própria rota já lança `SALE_ALREADY_EXISTS` quando o
 * mesmo `saleId` é reenviado — a fila só precisa tratar esse erro como sucesso.
 */
import { doc, deleteField, getFirestore, runTransaction, type DocumentData, type DocumentReference, type Transaction, type UpdateData } from "firebase/firestore";
import { getApiUrl } from "./api-config";
import { classifyPendingSaleResponse, type PendingSaleResponse } from "./pending-sale-response";
import { getFirebaseProjectId as readFirebaseProjectId, getFirebaseAuth } from "./firebase";
import { onAuthStateChanged } from "firebase/auth";

export type OfflineSaleQueueErrorCode = "OFFLINE_PERSISTENCE_UNAVAILABLE" | "OFFLINE_PERSISTENCE_CONFIRMATION_FAILED";

export class OfflineSaleQueueError extends Error {
  readonly code: OfflineSaleQueueErrorCode;
  readonly originalError?: unknown;

  constructor(code: OfflineSaleQueueErrorCode, message: string, originalError?: unknown) {
    super(message);
    this.name = "OfflineSaleQueueError";
    this.code = code;
    this.originalError = originalError;
  }
}

const LOCAL_PENDING_SALES_DB = "revendasmart-offline-sales";
const LOCAL_PENDING_SALES_DB_VERSION = 1;
const LOCAL_PENDING_SALES_STORE = "pendingSales";

function getFirebaseProjectId(): string {
  const projectId = readFirebaseProjectId();
  if (!projectId) {
    throw new OfflineSaleQueueError("OFFLINE_PERSISTENCE_CONFIRMATION_FAILED", "Firebase project identity is unavailable.");
  }
  return projectId;
}

interface PersistedPendingSale extends PendingSaleDoc {
  projectId: string;
  uid: string;
  saleId: string;
  journalState?: "active" | "cancelled" | "completed";
  revision?: number;
  /**
   * This is a durable fence around a terminal mirror operation.  In particular, `settle` is
   * recorded only after the API gave an explicit result, and before the mirror can be deleted.
   * It is deliberately kept local: the mirror is not an authority on whether a sale exists.
   */
  intent?: PendingSaleIntent;
}

interface PendingSaleIntent {
  id: string;
  kind: "cancel" | "settle";
  owner?: string;
  createdAt: string;
  /** Response observed before the mirror delete. Historical intents may not have it. */
  confirmation?: { saleId: string; outcome: "synced" | "already-exists" };
}

function openLocalPendingSalesDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new OfflineSaleQueueError(
      "OFFLINE_PERSISTENCE_UNAVAILABLE",
      "IndexedDB is unavailable in this browser.",
    ));
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(LOCAL_PENDING_SALES_DB, LOCAL_PENDING_SALES_DB_VERSION);
    let settled = false;
    request.onupgradeneeded = () => {
      const db = request.result;
      const store = db.objectStoreNames.contains(LOCAL_PENDING_SALES_STORE)
        ? request.transaction?.objectStore(LOCAL_PENDING_SALES_STORE)
        : db.createObjectStore(LOCAL_PENDING_SALES_STORE, { keyPath: ["projectId", "uid", "saleId"] });
      if (store && !store.indexNames.contains("byProjectAndUid")) {
        store.createIndex("byProjectAndUid", ["projectId", "uid"], { unique: false });
      }
    };
    request.onerror = () => {
      if (settled) return;
      settled = true;
      reject(request.error ?? new Error("OFFLINE_DB_OPEN_FAILED"));
    };
    request.onblocked = () => {
      if (settled) return;
      settled = true;
      reject(new Error("OFFLINE_DB_OPEN_BLOCKED"));
    };
    request.onsuccess = () => {
      if (settled) {
        request.result.close();
        return;
      }
      settled = true;
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
  });
}

/** Optional last argument keeps existing callers compatible; the hook also fences its generation. */
export type QueueSessionGuard = () => boolean;

interface QueueContext {
  projectId: string;
  uid: string;
  saleId: string;
  check: () => void;
}

let observedAuth: ReturnType<typeof getFirebaseAuth>;
let authGeneration = 0;
let unsubscribeQueueAuth: (() => void) | undefined;

function queueContext(uid: string, saleId: string, isCurrent?: QueueSessionGuard): QueueContext {
  const projectId = getFirebaseProjectId();
  const auth = getFirebaseAuth();
  if (auth !== observedAuth) {
    unsubscribeQueueAuth?.();
    observedAuth = auth;
    authGeneration++;
    if (auth) {
      let first = true;
      const initialUser = auth.currentUser;
      unsubscribeQueueAuth = onAuthStateChanged(auth, (user) => {
        // Firebase sends the initial state asynchronously; it is not a new login.
        if (!first || user !== initialUser) authGeneration++;
        first = false;
      });
    }
  }
  const generation = authGeneration;
  const user = auth?.currentUser;
  const check = () => {
    if (!uid || !saleId || !auth || !user || user.uid !== uid
      || auth !== observedAuth || auth.currentUser !== user || generation !== authGeneration
      || readFirebaseProjectId() !== projectId || (isCurrent && !isCurrent())) {
      throw new OfflineSaleQueueError("OFFLINE_PERSISTENCE_CONFIRMATION_FAILED", "QUEUE_SESSION_CHANGED");
    }
  };
  check();
  return { projectId, uid, saleId, check };
}

async function withSaleLock<T>(context: QueueContext, action: () => Promise<T>): Promise<T> {
  context.check();
  if (typeof navigator === "undefined" || !navigator.locks?.request) {
    throw new OfflineSaleQueueError("OFFLINE_PERSISTENCE_UNAVAILABLE", "Cross-tab queue exclusivity is unavailable.");
  }
  // Same origin only, not a distributed lock. Never acquire this key recursively.
  const key = JSON.stringify(["revendasmart-queue", context.projectId, context.uid, context.saleId]);
  return navigator.locks.request(key, { mode: "exclusive" }, async () => {
    context.check();
    return action();
  });
}

function isActiveJournal(record: PersistedPendingSale | undefined): record is PersistedPendingSale {
  return !!record && (record.journalState ?? "active") === "active" && !record.intent;
}

function isNonEmptyString(value: unknown, maximum = 512): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximum;
}

function isFiniteTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 8_640_000_000_000_000;
}

function isValidIntent(value: unknown, saleId: string): value is PendingSaleIntent {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const intent = value as Partial<PendingSaleIntent>;
  if (!isNonEmptyString(intent.id) || (intent.kind !== "cancel" && intent.kind !== "settle")
    || !isNonEmptyString(intent.createdAt) || !Number.isFinite(Date.parse(intent.createdAt))
    || (intent.owner !== undefined && !isNonEmptyString(intent.owner))) return false;
  if (intent.confirmation === undefined) return true;
  return intent.kind === "settle" && typeof intent.confirmation === "object"
    && intent.confirmation !== null && !Array.isArray(intent.confirmation)
    && intent.confirmation.saleId === saleId
    && (intent.confirmation.outcome === "synced" || intent.confirmation.outcome === "already-exists");
}

function isValidPersistedPendingSale(value: unknown, context: QueueContext): value is PersistedPendingSale {
  if (!isValidPendingSaleDoc(value)) return false;
  const record = value as Partial<PersistedPendingSale>;
  return record.projectId === context.projectId && record.uid === context.uid && record.saleId === context.saleId
    && (record.journalState === undefined || record.journalState === "active" || record.journalState === "cancelled" || record.journalState === "completed")
    && (record.revision === undefined || (Number.isSafeInteger(record.revision) && record.revision >= 1))
    && (record.intent === undefined || isValidIntent(record.intent, context.saleId));
}

async function readJournal(context: QueueContext): Promise<PersistedPendingSale | undefined> {
  context.check();
  const db = await openLocalPendingSalesDatabase();
  try {
    context.check();
    const record = await new Promise<PersistedPendingSale | undefined>((resolve, reject) => {
      const tx = db.transaction(LOCAL_PENDING_SALES_STORE, "readonly");
      const request = tx.objectStore(LOCAL_PENDING_SALES_STORE).get([context.projectId, context.uid, context.saleId]);
      let value: PersistedPendingSale | undefined;
      request.onsuccess = () => { value = request.result; };
      tx.oncomplete = () => resolve(value);
      tx.onerror = tx.onabort = () => reject(tx.error ?? new Error("OFFLINE_DB_READ_FAILED"));
    });
    context.check();
    if (record && !isValidPersistedPendingSale(record, context)) {
      throw new Error("OFFLINE_JOURNAL_IDENTITY_MISMATCH");
    }
    return record;
  } finally { db.close(); }
}

/** Compare-and-set inside ONE IDB transaction. No network awaits inside that transaction. */
async function writeJournal(
  context: QueueContext, expected: PersistedPendingSale | undefined, value: PersistedPendingSale,
): Promise<PersistedPendingSale> {
  context.check();
  const db = await openLocalPendingSalesDatabase();
  const next = { ...value, revision: (expected?.revision ?? 0) + 1 };
  try {
    context.check();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(LOCAL_PENDING_SALES_STORE, "readwrite");
      const store = tx.objectStore(LOCAL_PENDING_SALES_STORE);
      const request = store.get([context.projectId, context.uid, context.saleId]);
      tx.oncomplete = () => resolve();
      tx.onerror = tx.onabort = () => reject(tx.error ?? new Error("OFFLINE_DB_WRITE_ABORTED"));
      request.onsuccess = () => {
        try {
          context.check();
          const actual = request.result as PersistedPendingSale | undefined;
          if (!!actual !== !!expected || (actual?.revision ?? 0) !== (expected?.revision ?? 0)
            || actual?.intent?.id !== expected?.intent?.id
            || (actual?.journalState ?? "active") !== (expected?.journalState ?? "active")) {
            throw new Error("OFFLINE_JOURNAL_REVISION_CHANGED");
          }
          store.put(next);
        } catch (error) {
          tx.abort();
          reject(error);
        }
      };
    });
    context.check();
    return next;
  } catch (error) {
    if (error instanceof OfflineSaleQueueError) throw error;
    throw new OfflineSaleQueueError("OFFLINE_PERSISTENCE_CONFIRMATION_FAILED", "IndexedDB did not confirm the queue transition.", error);
  } finally { db.close(); }
}

function remoteSale(record: PersistedPendingSale): PendingSaleDoc {
  // Local operation metadata must never leak into the Firestore document.
  const sale: PendingSaleDoc & Partial<PersistedPendingSale> = { ...record };
  delete sale.projectId; delete sale.uid; delete sale.saleId; delete sale.journalState;
  delete sale.revision; delete sale.intent; delete sale.localReconciliationRequired;
  return sale;
}

function localReconciliationDocument(record: PersistedPendingSale): PendingSaleDoc {
  const valid = isValidPendingSaleDoc(record);
  return {
    ...(valid ? remoteSale(record) : record as unknown as PendingSaleDoc),
    id: record.saleId || record.id,
    status: "failed",
    localReconciliationRequired: true,
    errorMessage: valid && record.intent
      ? "Recuperando uma operação interrompida. A venda não será reenviada automaticamente."
      : "Os dados locais desta venda precisam de revisão. A venda foi preservada e não será reenviada automaticamente.",
  };
}

export async function listPersistedPendingSales(uid: string): Promise<PendingSaleDoc[]> {
  const projectId = getFirebaseProjectId();
  const db = await openLocalPendingSalesDatabase();
  try {
    return await new Promise<PendingSaleDoc[]>((resolve, reject) => {
      const tx = db.transaction(LOCAL_PENDING_SALES_STORE, "readonly");
      const request = tx.objectStore(LOCAL_PENDING_SALES_STORE).index("byProjectAndUid").getAll([projectId, uid]);
      let records: PendingSaleDoc[] = [];
      request.onsuccess = () => {
        records = (request.result as PersistedPendingSale[])
          .filter(record => record && record.projectId === projectId && record.uid === uid
            && (record.journalState ?? "active") === "active")
          .map(record => record.intent || !isValidPendingSaleDoc(record)
            ? localReconciliationDocument(record)
            : remoteSale(record));
      };
      tx.oncomplete = () => resolve(records);
      tx.onerror = tx.onabort = () => reject(tx.error ?? new Error("OFFLINE_DB_READ_FAILED"));
    });
  } finally { db.close(); }
}

async function assertRevision(context: QueueContext, record: PersistedPendingSale): Promise<void> {
  const current = await readJournal(context);
  if (!current || (current.revision ?? 0) !== (record.revision ?? 0)
    || current.intent?.id !== record.intent?.id || current.journalState !== record.journalState) {
    throw new Error("OFFLINE_JOURNAL_REVISION_CHANGED");
  }
}

/** A remote-only item needs a durable payload before any destructive remote effect. */
async function journalForTerminal(context: QueueContext): Promise<PersistedPendingSale | undefined> {
  const local = await readJournal(context);
  if (local) return local;
  const ref = doc(getFirestore(), "users", context.uid, PENDING_SALES_COLLECTION, context.saleId);
  const remote = await runTransaction(getFirestore(), async tx => {
    context.check();
    const snap = await tx.get(ref);
    context.check();
    return snap.exists() ? snap.data() as PendingSaleDoc : undefined;
  });
  context.check();
  if (!remote) return undefined;
  if (!isValidPendingSaleDoc(remote) || remote.id !== context.saleId) throw new Error("INVALID_REMOTE_PENDING_SALE");
  return writeJournal(context, undefined, {
    ...remote, projectId: context.projectId, uid: context.uid, saleId: context.saleId, journalState: "active",
  });
}

async function beginIntent(
  context: QueueContext, record: PersistedPendingSale, kind: "cancel" | "settle", owner?: string,
  confirmation?: PendingSaleIntent["confirmation"],
) {
  return writeJournal(context, record, {
    ...record,
    intent: {
      id: crypto.randomUUID(), kind, ...(owner ? { owner } : {}), createdAt: new Date().toISOString(),
      ...(confirmation ? { confirmation } : {}),
    },
  });
}

async function finishIntent(context: QueueContext, pending: PersistedPendingSale, state: "active" | "cancelled" | "completed") {
  // Called ONLY after runTransaction resolves. Errors/unknown outcomes keep the intention.
  const next = { ...pending, journalState: state };
  delete next.intent;
  await writeJournal(context, pending, next);
  // No physical deletion / tombstone GC: cleanup failure cannot undo a terminal outcome.
}

export type PendingSaleIntentReconciliation = "not-needed" | "completed" | "cancelled" | "needs-review" | "invalid-journal";

/** The sales collection is server-only; this exact, same-tenant ID is the completion proof. */
function isAuthoritativeFinalizedSale(value: unknown, record: PersistedPendingSale): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const sale = value as { id?: unknown; clientId?: unknown };
  return sale.id === record.saleId && sale.clientId === record.payload.clientId;
}

/**
 * Recovers a journal that was durably fenced before a terminal mirror transition.
 *
 * A missing pendingSales mirror is intentionally NOT proof of settlement.  A settle intent reaches
 * `completed` only after the server-owned sales/{saleId} document is read in the same transaction
 * that conditionally removes the mirror.  Therefore a crash before the delete, after the delete, or
 * after a worker replacement cannot turn an ambiguous HTTP/Firestore outcome into a completed sale.
 */
export async function reconcilePendingSaleIntent(
  uid: string, saleId: string, isCurrent?: QueueSessionGuard,
): Promise<PendingSaleIntentReconciliation> {
  const context = queueContext(uid, saleId, isCurrent);
  return withSaleLock(context, async () => {
    let record: PersistedPendingSale | undefined;
    try {
      record = await readJournal(context);
    } catch (error) {
      if (error instanceof Error && error.message === "OFFLINE_JOURNAL_IDENTITY_MISMATCH") return "invalid-journal";
      throw error;
    }
    if (!record || !record.intent || record.journalState !== "active") return "not-needed";
    const pending = record;
    // `pending` is an object alias, so retain the narrowed value rather than reading its optional
    // property again after asynchronous work begins.
    const intent: PendingSaleIntent = record.intent;
    const mirrorRef = doc(getFirestore(), "users", uid, PENDING_SALES_COLLECTION, saleId);

    if (intent.kind === "cancel") {
      const cancelled = await runTransaction(getFirestore(), async tx => {
        context.check();
        const mirror = await tx.get(mirrorRef);
        await assertRevision(context, pending);
        context.check();
        if (!mirror.exists()) return true;
        const remote = mirror.data();
        if (!isValidPendingSaleDoc(remote) || remote.status === "syncing") return false;
        tx.delete(mirrorRef);
        return true;
      });
      context.check();
      if (!cancelled) return "needs-review";
      await finishIntent(context, pending, "cancelled");
      return "cancelled";
    }

    const saleRef = doc(getFirestore(), "users", uid, "sales", saleId);
    const completed = await runTransaction(getFirestore(), async tx => {
      context.check();
      // Transaction reads are authoritative rather than local cache observations. Both reads happen
      // before the delete, so the worker identity test and sales proof describe the same retry.
      const [saleSnapshot, mirrorSnapshot] = await Promise.all([tx.get(saleRef), tx.get(mirrorRef)]);
      await assertRevision(context, pending);
      context.check();
      if (!saleSnapshot.exists() || !isAuthoritativeFinalizedSale(saleSnapshot.data(), pending)) return false;
      if (!mirrorSnapshot.exists()) return true;
      const mirror = mirrorSnapshot.data();
      // A recovery worker may finish an old durable intent, but it must never delete a mirror claimed
      // by a replacement worker. The persisted intent owner is the compare-and-delete identity.
      if (!isValidPendingSaleDoc(mirror) || mirror.status !== "syncing" || !intent.owner || mirror.syncOwner !== intent.owner) return false;
      tx.delete(mirrorRef);
      return true;
    });
    context.check();
    if (!completed) return "needs-review";
    await finishIntent(context, pending, "completed");
    return "completed";
  });
}

export interface PendingSalePayload {
  saleId: string;
  clientId: string;
  products: { productId: string; quantity: number }[];
  discountType: "percent" | "fixed";
  discountValue: number;
  paymentType: "avista";
  paymentMethod: string | null;
}

/**
 * RELEASE-QUALITY-05 §9: motivos de conflito, restritos aos que a rota `/api/sales/finalize` já
 * distingue por código (`server/routes.ts`) — nenhum estado novo inventado além do que o servidor
 * já sabe dizer com precisão.
 */
export type PendingSaleConflictReason = "INSUFFICIENT_STOCK" | "PRODUCT_NOT_FOUND" | "PRODUCT_CHANGED";

export interface PendingSaleDoc {
  /** Local presentation only; never written to Firestore. */
  localReconciliationRequired?: boolean;
  id: string;
  payload: PendingSalePayload;
  status: "pending" | "syncing" | "failed" | "conflict";
  createdAt: string;
  updatedAt: string;
  errorMessage?: string;
  conflictReason?: PendingSaleConflictReason;
  syncOwner?: string;
  syncStartedAt?: number;
  syncLeaseUntil?: number;
  syncAttempts?: number;
  nextSyncAt?: number;
}

/** Runtime guard for data restored from Firestore after a crash or manual corruption. */
export function isValidPendingSaleDoc(value: unknown): value is PendingSaleDoc {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const doc = value as Partial<PendingSaleDoc>;
  const payload = doc.payload;
  if (!isNonEmptyString(doc.id) || !isNonEmptyString(doc.createdAt) || !isNonEmptyString(doc.updatedAt)
    || !Number.isFinite(Date.parse(doc.createdAt)) || !Number.isFinite(Date.parse(doc.updatedAt))) return false;
  if (!['pending', 'syncing', 'failed', 'conflict'].includes(String(doc.status))) return false;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
  const sale = payload as Partial<PendingSalePayload>;
  const hasLeaseMetadata = doc.syncOwner !== undefined || doc.syncStartedAt !== undefined || doc.syncLeaseUntil !== undefined;
  const hasValidLease = !hasLeaseMetadata || (isNonEmptyString(doc.syncOwner)
    && isFiniteTimestamp(doc.syncStartedAt) && isFiniteTimestamp(doc.syncLeaseUntil)
    && doc.syncLeaseUntil >= doc.syncStartedAt);
  const hasValidAttempts = doc.syncAttempts === undefined
    || (Number.isSafeInteger(doc.syncAttempts) && doc.syncAttempts >= 0 && doc.syncAttempts <= MAX_SYNC_ATTEMPTS);
  const hasValidNextAttempt = doc.nextSyncAt === undefined || isFiniteTimestamp(doc.nextSyncAt);
  return sale.saleId === doc.id
    && isNonEmptyString(sale.clientId)
    && Array.isArray(sale.products) && sale.products.length <= 100
    && sale.products.every((item) => item && isNonEmptyString(item.productId)
      && typeof item.quantity === "number" && Number.isSafeInteger(item.quantity) && item.quantity > 0)
    && (sale.discountType === "percent" || sale.discountType === "fixed")
    && typeof sale.discountValue === "number" && Number.isFinite(sale.discountValue) && sale.discountValue >= 0
    && sale.paymentType === "avista"
    && (sale.paymentMethod === null || (typeof sale.paymentMethod === "string" && sale.paymentMethod.length <= 100))
    && hasValidLease && hasValidAttempts && hasValidNextAttempt;
}

const PENDING_SALES_COLLECTION = "pendingSales";
export const SYNC_LEASE_MS = 120_000;
export const MAX_SYNC_ATTEMPTS = 5;
export const SYNC_REQUEST_TIMEOUT_MS = 30_000;

function quarantineInvalidPendingSale(tx: Transaction, ref: DocumentReference<DocumentData>, now: number): void {
  tx.update(ref, {
    status: "failed",
    errorMessage: "Os dados desta venda são inválidos e foram preservados para revisão.",
    updatedAt: new Date(now).toISOString(),
    syncOwner: deleteField(),
    syncLeaseUntil: deleteField(),
    syncStartedAt: deleteField(),
    nextSyncAt: deleteField(),
  });
}

/** Only an online Firestore transaction can claim a sale, across tabs/devices/restarts. */
export async function claimPendingSale(uid: string, saleId: string, owner: string, clock?: number, isCurrent?: QueueSessionGuard): Promise<PendingSaleDoc | null> {
  const context = queueContext(uid, saleId, isCurrent);
  return withSaleLock(context, async () => {
  const journal = await readJournal(context);
  if (journal && !isActiveJournal(journal)) return null;
  const ref = doc(getFirestore(), "users", uid, PENDING_SALES_COLLECTION, saleId);
  const claimed = await runTransaction(getFirestore(), async (tx) => {
    const snap = await tx.get(ref);
    context.check();
    const now = clock ?? Date.now();
    if (!snap.exists()) return null;
    const sale = snap.data() as PendingSaleDoc;
    if (!isValidPendingSaleDoc(sale)) {
      quarantineInvalidPendingSale(tx, ref, now);
      return null;
    }
    const legacyExpiry = Date.parse(sale.updatedAt) + SYNC_LEASE_MS;
    const expiry = sale.syncLeaseUntil ?? (Number.isFinite(legacyExpiry) ? legacyExpiry : 0);
    if (sale.status !== "pending" && !(sale.status === "syncing" && expiry <= now)) return null;
    if ((sale.nextSyncAt ?? 0) > now) return null;
    const attempts = sale.syncAttempts ?? 0;
    if (attempts >= MAX_SYNC_ATTEMPTS) {
      tx.update(ref, { status: "failed", errorMessage: "Limite de tentativas atingido. Revise a venda antes de tentar novamente.", updatedAt: new Date(now).toISOString(), syncOwner: deleteField(), syncLeaseUntil: deleteField() });
      return null;
    }
    const lease = { status: "syncing" as const, syncOwner: owner, syncStartedAt: now, syncLeaseUntil: now + SYNC_LEASE_MS, syncAttempts: attempts + 1, updatedAt: new Date(now).toISOString() };
    tx.update(ref, lease);
    return { ...sale, ...lease };
  });
  context.check();
  return claimed;
  });
}

export async function renewPendingSaleLease(uid: string, saleId: string, owner: string, clock?: number, isCurrent?: QueueSessionGuard): Promise<boolean> {
  const context = queueContext(uid, saleId, isCurrent);
  return withSaleLock(context, async () => {
  const journal = await readJournal(context);
  if (journal && !isActiveJournal(journal)) return false;
  const ref = doc(getFirestore(), "users", uid, PENDING_SALES_COLLECTION, saleId);
  const renewed = await runTransaction(getFirestore(), async (tx) => {
    const snap = await tx.get(ref);
    context.check();
    const now = clock ?? Date.now();
    const sale = snap.data() as PendingSaleDoc | undefined;
    if (!sale || !isValidPendingSaleDoc(sale) || sale.status !== "syncing" || sale.syncOwner !== owner || (sale.syncLeaseUntil ?? 0) <= now) return false;
    tx.update(ref, { syncLeaseUntil: now + SYNC_LEASE_MS });
    return true;
  });
  context.check();
  return renewed;
  });
}

/** A late worker can never delete/requeue an item now owned by another worker. */
export async function settlePendingSale(
  uid: string, saleId: string, owner: string, result: SyncPendingSaleResult | { outcome: "retry" },
  clock?: number, isCurrent?: QueueSessionGuard,
): Promise<boolean> {
  const context = queueContext(uid, saleId, isCurrent);
  return withSaleLock(context, async () => {
    const completed = result.outcome === "synced" || result.outcome === "already-exists";
    const journal = completed ? await journalForTerminal(context) : await readJournal(context);
    if ((journal && !isActiveJournal(journal)) || (completed && !journal)) return false;
    // Persist the explicit server acknowledgement before the mirror delete. A later restart still
    // requires the server-owned sales document as proof; this confirmation never makes absence of a
    // mirror sufficient evidence on its own.
    const pending = completed && journal ? await beginIntent(context, journal, "settle", owner, {
      saleId,
      outcome: result.outcome,
    }) : undefined;
    const ref = doc(getFirestore(), "users", uid, PENDING_SALES_COLLECTION, saleId);
    // Do not catch/revert on RPC error: it may have committed. The intent fences recovery.
    const settled = await runTransaction(getFirestore(), async (tx) => {
      context.check();
      const snap = await tx.get(ref);
      context.check();
      if (pending) await assertRevision(context, pending);
      context.check();
      const now = clock ?? Date.now();
      if (!snap.exists()) return false;
      const sale = snap.data() as PendingSaleDoc;
      if (!isValidPendingSaleDoc(sale)) return false;
      if (sale.status !== "syncing" || sale.syncOwner !== owner) return false;
      if (result.outcome === "synced" || result.outcome === "already-exists") { tx.delete(ref); return true; }
      const exhausted = (sale.syncAttempts ?? 0) >= MAX_SYNC_ATTEMPTS;
      const status = result.outcome === "conflict" ? "conflict" : result.outcome === "retry" && !exhausted ? "pending" : "failed";
      tx.update(ref, {
        status, updatedAt: new Date(now).toISOString(), syncOwner: deleteField(), syncLeaseUntil: deleteField(),
        nextSyncAt: result.outcome === "retry" && !exhausted ? now + Math.min(15_000 * 2 ** ((sale.syncAttempts ?? 1) - 1), 300_000) : deleteField(),
        errorMessage: result.outcome === "retry" ? (exhausted ? "Limite de tentativas atingido." : deleteField()) : result.message,
        conflictReason: result.outcome === "conflict" ? result.reason : deleteField(),
      });
      return true;
    });
    context.check();
    if (pending) await finishIntent(context, pending, settled ? "completed" : "active");
    return settled;
  });
}

/**
 * A queda de conexão NO MEIO de uma tentativa de venda não chega sempre como `TypeError` (falha crua
 * de `fetch`) — o `getIdToken(true)` que roda antes do fetch já bate na rede do Firebase Auth, e quando
 * ela cai, o SDK lança um `FirebaseError` com `code: "auth/network-request-failed"`, não um `TypeError`.
 * Sem checar isso também, esse erro "cru" do Firebase escapava direto pra tela do vendedor.
 */
export function isNetworkFailure(err: unknown): boolean {
  if (err instanceof TypeError) return true;
  if (err && typeof err === "object" && "code" in err) {
    const code = (err as { code?: unknown }).code;
    return typeof code === "string" && (code.includes("network") || code === "unavailable");
  }
  return false;
}

export async function queuePendingSale(uid: string, payload: PendingSalePayload, isCurrent?: QueueSessionGuard): Promise<void> {
  const context = queueContext(uid, payload.saleId, isCurrent);
  await withSaleLock(context, async () => {
    const existing = await readJournal(context);
    if (existing) {
      if (!isActiveJournal(existing)) {
        throw new OfflineSaleQueueError("OFFLINE_PERSISTENCE_CONFIRMATION_FAILED", "SALE_TERMINAL_OR_RECONCILIATION_REQUIRED");
      }
      const identity = (p: PendingSalePayload) => JSON.stringify([
        p.saleId, p.clientId, p.products.map(item => [item.productId, item.quantity]),
        p.discountType, p.discountValue, p.paymentType, p.paymentMethod,
      ]);
      if (identity(existing.payload) !== identity(payload)) {
        throw new OfflineSaleQueueError("OFFLINE_PERSISTENCE_CONFIRMATION_FAILED", "SALE_ID_PAYLOAD_MISMATCH");
      }
      return; // Do not reset an existing lease, retry budget, or journal revision.
    }
    const now = new Date().toISOString();
    const record: PersistedPendingSale = {
      id: payload.saleId, payload, status: "pending", createdAt: now, updatedAt: now,
      projectId: context.projectId, uid, saleId: payload.saleId, journalState: "active",
    };
    if (!isValidPendingSaleDoc(record)) throw new Error("INVALID_PENDING_SALE");
    await writeJournal(context, undefined, record);
    // Enqueue acknowledges ONLY the durable local commit. The hook restores the mirror.
    // A timed-out/fire-and-forget setDoc could commit AFTER a later cancellation.
  });
}

/** Recreates only missing Firestore queue documents from the durable local journal. */
export async function restorePendingSaleDocument(uid: string, sale: PendingSaleDoc, isCurrent?: QueueSessionGuard): Promise<void> {
  const context = queueContext(uid, sale.id, isCurrent);
  await withSaleLock(context, async () => {
    const record = await readJournal(context);
    if (!isActiveJournal(record) || !isValidPendingSaleDoc(record)) return;
    const reference = doc(getFirestore(), "users", uid, PENDING_SALES_COLLECTION, sale.id);
    await runTransaction(getFirestore(), async (tx) => {
      context.check();
      const snapshot = await tx.get(reference);
      await assertRevision(context, record);
      context.check();
      if (!snapshot.exists()) tx.set(reference, remoteSale(record));
    });
    context.check();
  });
}

/** All manual state changes use the same lock and never create a missing mirror. */
async function updatePendingSale(
  uid: string, saleId: string, patch: UpdateData<PendingSaleDoc>, allowSyncing: boolean, isCurrent?: QueueSessionGuard,
): Promise<void> {
  const context = queueContext(uid, saleId, isCurrent);
  await withSaleLock(context, async () => {
    const record = await readJournal(context);
    if (record && !isActiveJournal(record)) return;
    const ref = doc(getFirestore(), "users", uid, PENDING_SALES_COLLECTION, saleId);
    await runTransaction(getFirestore(), async tx => {
      context.check();
      const snap = await tx.get(ref);
      context.check();
      if (!snap.exists()) return;
      const remote = snap.data();
      // A malformed lease must not make a sale permanently invisible to recovery. Only the safe
      // failure transition is allowed here; retry/cancel still require a valid, unclaimed mirror.
      if (!isValidPendingSaleDoc(remote)) {
        if (patch.status === "failed") quarantineInvalidPendingSale(tx, ref, Date.now());
        return;
      }
      if (!allowSyncing && remote.status === "syncing") return;
      tx.update(ref, patch);
    });
    context.check();
  });
}

export async function markPendingSaleSyncing(uid: string, saleId: string): Promise<void> {
  await updatePendingSale(uid, saleId, { status: "syncing", updatedAt: new Date().toISOString() }, false);
}

/** Manual retry cannot override a lease or a pending terminal operation. */
export async function markPendingSalePending(uid: string, saleId: string, isCurrent?: QueueSessionGuard): Promise<void> {
  await updatePendingSale(uid, saleId, {
    status: "pending", updatedAt: new Date().toISOString(), syncAttempts: 0,
    syncOwner: deleteField(), syncLeaseUntil: deleteField(), nextSyncAt: deleteField(),
    errorMessage: deleteField(), conflictReason: deleteField(),
  }, false, isCurrent);
}

export async function markPendingSaleFailed(uid: string, saleId: string, errorMessage: string, isCurrent?: QueueSessionGuard): Promise<void> {
  await updatePendingSale(uid, saleId, {
    status: "failed", errorMessage, updatedAt: new Date().toISOString(), conflictReason: deleteField(),
  }, false, isCurrent);
}

export async function markPendingSaleConflict(
  uid: string, saleId: string, conflictReason: PendingSaleConflictReason, errorMessage: string,
): Promise<void> {
  await updatePendingSale(uid, saleId, { status: "conflict", conflictReason, errorMessage, updatedAt: new Date().toISOString() }, false);
}

export async function removePendingSale(uid: string, saleId: string, isCurrent?: QueueSessionGuard): Promise<void> {
  const context = queueContext(uid, saleId, isCurrent);
  await withSaleLock(context, async () => {
    const record = await journalForTerminal(context);
    if (!record || record.journalState === "cancelled" || record.journalState === "completed") return;
    if (record.intent) throw new Error("QUEUE_RECONCILIATION_REQUIRED");
    const pending = await beginIntent(context, record, "cancel");
    const ref = doc(getFirestore(), "users", uid, PENDING_SALES_COLLECTION, saleId);
    // Rejection/timeout never implies rollback. Keep intent on unknown remote outcome.
    const removed = await runTransaction(getFirestore(), async tx => {
      context.check();
      const snap = await tx.get(ref);
      await assertRevision(context, pending);
      context.check();
      if (!snap.exists()) return true;
      if (snap.data().status === "syncing") return false;
      tx.delete(ref);
      return true;
    });
    context.check();
    await finishIntent(context, pending, removed ? "cancelled" : "active");
  });
}

export type SyncPendingSaleResult = PendingSaleResponse;

/**
 * Reenvia o MESMO payload para a rota que já existe — nenhuma lógica de negócio nova. `SALE_ALREADY_EXISTS`
 * (a própria rota já lança isso num saleId repetido) conta como sucesso: prova de que a venda já foi
 * processada antes, então a fila local só precisa se limpar, nunca tentar de novo.
 */
export async function syncPendingSaleToServer(token: string, payload: PendingSalePayload, signal?: AbortSignal): Promise<SyncPendingSaleResult> {
  // Erro de rede aqui (ex.: caiu de novo no meio do sync) propaga pro chamador sem tratamento
  // especial — não é falha definitiva, ele decide colocar de volta em "pending" pra tentar de novo.
  const response = await fetch(getApiUrl("/api/sales/finalize"), {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      saleId: payload.saleId,
      clientId: payload.clientId,
      products: payload.products,
      discountType: payload.discountType,
      discountValue: payload.discountValue,
      paymentType: "avista",
      paymentMethod: payload.paymentMethod,
      downPayment: 0,
      downPaymentMethod: null,
      installments: 0,
    }),
  });
  return classifyPendingSaleResponse(response, payload.saleId);
}
