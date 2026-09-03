import {
  collection,
  doc,
  getCountFromServer,
  getDoc,
  getDocs,
  getFirestore,
  orderBy,
  query,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import {
  assertValidService,
  assertValidServiceWork,
  calculateCommercialTotals,
  createZeroServiceWorkFinancialSummary,
  normalizeServiceWorkDocument,
  type OptionalCost,
  type CommercialItem,
  type Service,
  type ServiceBookingMode,
  type ServicePricing,
  type ServiceWork,
} from "@shared/services";
import { getCurrentFirebaseUser } from "./firebase";
import { type PlanType } from "@shared/monetization";
import { checkServiceLimit } from "./plan-helpers";
import { buildLimitReachedCopy } from "./plan-paywall-copy";
import { apiRequest } from "./api-client";

/** PLAN-IMPL-02A §7, mensagem atualizada em PLAN-IMPL-04A — thrown when the tenant's service count is
 * already at/over their plan's limit. createService() ainda não tem um caller real de UI (confirmado
 * também nesta rodada — nenhuma tela de "novo serviço" existe hoje, ver PLAN-IMPL-04A_REPORT
 * `SERVICES_CREATE_UI_GAP`) — mas a mensagem já usa o mesmo texto padrão de `PlanLimitPrompt`
 * (`buildLimitReachedCopy`), então o dia em que uma tela real existir e simplesmente renderizar
 * `<PlanLimitPrompt resource="services" .../>` ao capturar este erro, o texto já bate. */
export class ServiceLimitError extends Error {
  constructor(public readonly plan: PlanType) {
    super(buildLimitReachedCopy("services", plan).title);
    this.name = "ServiceLimitError";
  }
}

type PartialServiceFields = Partial<Pick<
  Service,
  "name" | "active" | "published" | "pricing" | "cost" | "bookingMode" | "description" | "imageUrl" | "durationMinutes" | "archivedAt"
>>;

export type CreateServiceInput = Pick<
  Service,
  "name" | "active" | "published" | "pricing" | "cost" | "bookingMode"
> & Partial<Pick<Service, "description" | "imageUrl" | "durationMinutes">> & {
  /** PLAN-IMPL-02A §7 — createService() cannot call usePlan() itself (it's a plain module function, not
   * a React hook), so the caller (a future "add service" page) resolves the plan the normal way and
   * passes it in here, the same separation checkProductLimit/checkClientLimit already use elsewhere. */
  activePlan: PlanType;
};

export type UpdateServiceInput = PartialServiceFields;

export type CreateManualServiceWorkInput = {
  customerId?: string;
  items: readonly CommercialItem[];
  cost: OptionalCost;
};

export type UpdateServiceWorkCommercialInput = {
  customerId?: string;
  items: readonly CommercialItem[];
  cost: OptionalCost;
};

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

function servicesCollection(uid: string) {
  return collection(getFirestore(), "users", uid, "services");
}

function serviceWorksCollection(uid: string) {
  return collection(getFirestore(), "users", uid, "serviceWorks");
}

function parseService(value: unknown): Service {
  return assertValidService(asRecord(value, "Service") as Service);
}

function parseServiceWork(value: unknown): ServiceWork {
  return normalizeServiceWorkDocument(asRecord(value, "ServiceWork") as ServiceWork);
}

function asRecord(value: unknown, entity: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`INVALID_${entity.toUpperCase()}`);
  }
  return value as Record<string, unknown>;
}

export async function createService(input: CreateServiceInput): Promise<Service> {
  const uid = requireCurrentUid();
  // PLAN-IMPL-02A §7/§8 — mirrors add-product.tsx's pattern exactly: a fresh server-side count
  // (getCountFromServer), never a possibly-partial in-memory list, checked before writing.
  const serviceCountSnapshot = await getCountFromServer(servicesCollection(uid));
  const { allowed } = checkServiceLimit(input.activePlan, serviceCountSnapshot.data().count);
  if (!allowed) {
    throw new ServiceLimitError(input.activePlan);
  }
  const serviceId = generateEntityId("service");
  const timestamp = nowIso();
  const service: Service = assertValidService({
    id: serviceId,
    tenantUid: uid,
    name: input.name,
    description: input.description,
    imageUrl: input.imageUrl,
    active: input.active,
    published: input.published,
    pricing: input.pricing as ServicePricing,
    durationMinutes: input.durationMinutes,
    cost: input.cost,
    bookingMode: input.bookingMode as ServiceBookingMode,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  const result = await apiRequest<{ service: Service; serviceId: string; idempotentReplay: boolean }>("/api/services", {
    method: "POST",
    auth: true,
    body: {
      serviceId,
      service,
      idempotencyKey: `service-create-${serviceId}`,
    },
  });
  return parseService(result.service);
}

export async function getService(serviceId: string): Promise<Service | null> {
  const uid = requireCurrentUid();
  const snapshot = await getDoc(doc(servicesCollection(uid), serviceId));
  return snapshot.exists() ? parseService(snapshot.data()) : null;
}

export async function listServices(): Promise<Service[]> {
  const uid = requireCurrentUid();
  const snapshot = await getDocs(query(servicesCollection(uid), orderBy("updatedAt", "desc")));
  return snapshot.docs.map((item) => parseService(item.data()));
}

export async function updateService(serviceId: string, updates: UpdateServiceInput): Promise<Service> {
  const current = await getService(serviceId);
  if (!current) throw new Error("SERVICE_NOT_FOUND");
  const nextService = assertValidService({
    ...current,
    ...updates,
    updatedAt: nowIso(),
  });
  await updateDoc(doc(servicesCollection(current.tenantUid), serviceId), nextService);
  return nextService;
}

export async function archiveService(serviceId: string): Promise<Service> {
  const timestamp = nowIso();
  return await updateService(serviceId, {
    active: false,
    published: false,
    archivedAt: timestamp,
  });
}

export async function createManualServiceWork(input: CreateManualServiceWorkInput): Promise<ServiceWork> {
  const uid = requireCurrentUid();
  const workId = generateEntityId("work");
  const timestamp = nowIso();
  const work: ServiceWork = assertValidServiceWork({
    id: workId,
    tenantUid: uid,
    status: "planned",
    origin: "manual",
    customerId: input.customerId,
    items: input.items,
    totals: calculateCommercialTotals(input.items),
    financialSummary: createZeroServiceWorkFinancialSummary(),
    cost: input.cost,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  await setDoc(doc(serviceWorksCollection(uid), workId), work);
  return work;
}

export async function getServiceWork(workId: string): Promise<ServiceWork | null> {
  const uid = requireCurrentUid();
  const snapshot = await getDoc(doc(serviceWorksCollection(uid), workId));
  return snapshot.exists() ? parseServiceWork(snapshot.data()) : null;
}

export async function listServiceWorks(): Promise<ServiceWork[]> {
  const uid = requireCurrentUid();
  const snapshot = await getDocs(query(serviceWorksCollection(uid), orderBy("updatedAt", "desc")));
  return snapshot.docs.map((item) => parseServiceWork(item.data()));
}

export async function updateServiceWorkCommercial(
  workId: string,
  input: UpdateServiceWorkCommercialInput,
): Promise<ServiceWork> {
  const current = await getServiceWork(workId);
  if (!current) throw new Error("SERVICE_WORK_NOT_FOUND");
  const nextWork = assertValidServiceWork({
    ...current,
    customerId: input.customerId,
    items: input.items,
    totals: calculateCommercialTotals(input.items),
    cost: input.cost,
    updatedAt: nowIso(),
  });
  await updateDoc(doc(serviceWorksCollection(current.tenantUid), workId), nextWork);
  return nextWork;
}
