import type { Express, NextFunction, Request, Response } from "express";
import type { Firestore, Transaction } from "firebase-admin/firestore";
import { getFirebaseAdmin } from "./firebase-admin-init";
import { resolveUserEntitlements } from "./admin-grants";
import { ensurePlanLifecycleCurrent } from "./plan-lifecycle";
import { logError, logWarn } from "./logger";
import {
  PLAN_CONFIG,
  PLANS,
  resolveCommercialPlan,
  type PlanData,
  type PlanType,
} from "../shared/monetization";
import { assertValidService, type Service } from "../shared/services";

const PLAN_USAGE_DOC = "summary";
const PRODUCT_CREATE_ACTION = "create_product";
const SERVICE_CREATE_ACTION = "create_service";
const CLIENT_CREATE_ACTION = "create_client";
const CLIENT_CREATE_ALLOWED_FIELDS = new Set(["id", "name", "phone", "whatsapp", "email", "notes", "createdAt", "updatedAt", "lastPurchaseAt", "totalSpent", "purchaseCount"]);
const PRODUCT_CREATE_ALLOWED_FIELDS = new Set([
  "id",
  "name",
  "brand",
  "origin",
  "category",
  "productType",
  "costPrice",
  "salePrice",
  "stock",
  "barcode",
  "description",
  "imageUrl",
  "storagePath",
  "thumbnailUrl",
  "thumbnailStoragePath",
  "imageId",
  "photoUrl",
  "image",
  "photo",
  "gender",
  "lastSoldDate",
  "extras",
  "isFeatured",
  "isOnSale",
  "discountPercent",
  "discount",
  "promotionalPrice",
  "nameNormalized",
  "brandNormalized",
  "categoryNormalized",
  "barcodeNormalized",
  "productTypeNormalized",
  "searchTokens",
  "searchSchemaVersion",
]);

type DomainKind = "product" | "service" | "client";

type UsageSummary = {
  productsCount: number;
  servicesCount: number;
  clientsCount: number;
  initializedAt?: unknown;
  updatedAt?: unknown;
};

type MutationErrorCode =
  | "UNAUTHORIZED"
  | "INVALID_INPUT"
  | "PLAN_LIFECYCLE_UNAVAILABLE"
  | "PLAN_LIMIT_REACHED"
  | "IDEMPOTENCY_CONFLICT"
  | "PRODUCT_NOT_FOUND"
  | "SERVICE_NOT_FOUND";

export class PlanMutationError extends Error {
  readonly code: MutationErrorCode;
  readonly status: number;

  constructor(code: MutationErrorCode, message: string, status = 400) {
    super(message);
    this.name = "PlanMutationError";
    this.code = code;
    this.status = status;
  }
}

function usageRef(db: Firestore, uid: string) {
  return db.collection("users").doc(uid).collection("planUsage").doc(PLAN_USAGE_DOC);
}

function productRef(db: Firestore, uid: string, productId: string) {
  return db.collection("users").doc(uid).collection("products").doc(productId);
}

function serviceRef(db: Firestore, uid: string, serviceId: string) {
  return db.collection("users").doc(uid).collection("services").doc(serviceId);
}
function clientRef(db: Firestore, uid: string, clientId: string) {
  return db.collection("users").doc(uid).collection("clients").doc(clientId);
}

function idempotencyRef(db: Firestore, uid: string, key: string) {
  return db.collection("users").doc(uid).collection("planMutationIdempotency").doc(key);
}

function assertEntityId(value: unknown, fieldName: string): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!/^[a-zA-Z0-9_-]{1,120}$/.test(text)) {
    throw new PlanMutationError("INVALID_INPUT", `${fieldName} inválido.`);
  }
  return text;
}

function assertIdempotencyKey(value: unknown): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!/^[a-zA-Z0-9_-]{6,160}$/.test(text)) {
    throw new PlanMutationError("INVALID_INPUT", "idempotencyKey inválida.");
  }
  return text;
}

function cleanText(value: unknown, maxLength: number, required = false): string {
  const text = typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, maxLength) : "";
  if (required && !text) throw new PlanMutationError("INVALID_INPUT", "Campos obrigatórios ausentes.");
  return text;
}

function cleanOptionalUrl(value: unknown): string {
  const text = cleanText(value, 2000);
  if (!text) return "";
  try {
    const url = new URL(text);
    if (url.protocol === "http:" || url.protocol === "https:") return text;
  } catch {
    // Mantém compatibilidade com contratos legados das Rules para imageUrl/photoUrl/storagePath.
    return text;
  }
  return text;
}

function cleanNonNegativeNumber(value: unknown, fieldName: string, max = 1_000_000): number {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number) || number < 0 || number > max) {
    throw new PlanMutationError("INVALID_INPUT", `${fieldName} inválido.`);
  }
  return number;
}

function cleanPositiveNumber(value: unknown, fieldName: string, max = 1_000_000): number {
  const number = cleanNonNegativeNumber(value, fieldName, max);
  if (number <= 0) throw new PlanMutationError("INVALID_INPUT", `${fieldName} inválido.`);
  return number;
}

function cleanProductPayload(uid: string, productId: string, value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PlanMutationError("INVALID_INPUT", "Produto inválido.");
  }
  const data = value as Record<string, unknown>;
  for (const key of Object.keys(data)) {
    if (!PRODUCT_CREATE_ALLOWED_FIELDS.has(key)) {
      throw new PlanMutationError("INVALID_INPUT", "Campo de produto inválido.");
    }
  }
  const payload: Record<string, unknown> = {
    ...data,
    id: productId,
    name: cleanText(data.name, 180, true),
    salePrice: cleanPositiveNumber(data.salePrice, "salePrice"),
    costPrice: cleanNonNegativeNumber(data.costPrice ?? 0, "costPrice"),
    stock: cleanNonNegativeNumber(data.stock ?? 0, "stock"),
    brand: cleanText(data.brand, 100),
    origin: cleanText(data.origin, 80),
    category: cleanText(data.category, 100),
    productType: cleanText(data.productType, 80),
    barcode: cleanText(data.barcode, 80),
    description: cleanText(data.description, 2000),
    imageUrl: cleanOptionalUrl(data.imageUrl),
    storagePath: cleanText(data.storagePath, 1000),
    imageId: cleanText(data.imageId, 200),
    photoUrl: cleanOptionalUrl(data.photoUrl),
    image: cleanOptionalUrl(data.image),
    photo: cleanOptionalUrl(data.photo),
    gender: cleanText(data.gender || "unisex", 40),
    lastSoldDate: cleanText(data.lastSoldDate, 80),
    extras: data.extras && typeof data.extras === "object" && !Array.isArray(data.extras) ? data.extras : {},
    isFeatured: data.isFeatured === true,
    isOnSale: data.isOnSale === true,
    discountPercent: cleanNonNegativeNumber(data.discountPercent ?? 0, "discountPercent", 100),
    discount: cleanNonNegativeNumber(data.discount ?? 0, "discount"),
    promotionalPrice: cleanNonNegativeNumber(data.promotionalPrice ?? 0, "promotionalPrice"),
  };

  if (typeof data.thumbnailUrl === "string" || typeof data.thumbnailStoragePath === "string") {
    const thumbnailUrl = cleanOptionalUrl(data.thumbnailUrl);
    const thumbnailStoragePath = cleanText(data.thumbnailStoragePath, 500);
    if (!thumbnailUrl || !thumbnailStoragePath) throw new PlanMutationError("INVALID_INPUT", "Thumbnail inválida.");
    const prefix = `users/${uid}/product-thumbnails/${productId}/thumb-v1.`;
    if (!(thumbnailStoragePath === `${prefix}jpg` || thumbnailStoragePath === `${prefix}webp`)) {
      throw new PlanMutationError("INVALID_INPUT", "Thumbnail inválida.");
    }
    payload.thumbnailUrl = thumbnailUrl;
    payload.thumbnailStoragePath = thumbnailStoragePath;
  } else {
    delete payload.thumbnailUrl;
    delete payload.thumbnailStoragePath;
  }

  for (const key of ["nameNormalized", "brandNormalized", "categoryNormalized", "barcodeNormalized", "productTypeNormalized"]) {
    if (data[key] !== undefined) payload[key] = cleanText(data[key], 180);
  }
  if (Array.isArray(data.searchTokens)) payload.searchTokens = data.searchTokens.slice(0, 16).filter((item) => typeof item === "string").map((item) => item.slice(0, 80));
  if (data.searchSchemaVersion !== undefined) payload.searchSchemaVersion = cleanNonNegativeNumber(data.searchSchemaVersion, "searchSchemaVersion", 10);

  return Object.fromEntries(Object.entries(payload).filter(([, item]) => item !== undefined));
}

function cleanServicePayload(uid: string, serviceId: string, value: unknown): Service {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PlanMutationError("INVALID_INPUT", "Serviço inválido.");
  }
  return assertValidService({ ...(value as Record<string, unknown>), id: serviceId, tenantUid: uid } as Service);
}

function cleanClientPayload(clientId: string, value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new PlanMutationError("INVALID_INPUT", "Cliente inválido.");
  const data = value as Record<string, unknown>;
  for (const key of Object.keys(data)) if (!CLIENT_CREATE_ALLOWED_FIELDS.has(key)) throw new PlanMutationError("INVALID_INPUT", "Campo de cliente inválido.");
  return {
    ...data,
    id: clientId,
    name: cleanText(data.name, 140, true),
    phone: cleanText(data.phone, 40),
    whatsapp: cleanText(data.whatsapp, 40),
    email: cleanText(data.email, 180),
    notes: cleanText(data.notes, 2000),
    totalSpent: cleanNonNegativeNumber(data.totalSpent ?? 0, "totalSpent"),
    purchaseCount: cleanNonNegativeNumber(data.purchaseCount ?? 0, "purchaseCount"),
    lastPurchaseAt: cleanText(data.lastPurchaseAt, 80),
  };
}

/** PLAN-IMPL-02B2 — exportada para server/plan-access-selection.ts reusar a MESMA resolução de plano
 * server-side (nunca confiar no plano que o client alega ter) em vez de duplicá-la. */
export async function resolveServerPlan(db: Firestore, uid: string): Promise<PlanType> {
  const { entitlements, planData } = await resolveUserEntitlements(db, uid);
  if (entitlements.hasPremiumAccess) return PLANS.PREMIUM;
  return resolveCommercialPlan(planData as PlanData | null);
}

function usageCountField(resource: DomainKind): "productsCount" | "servicesCount" | "clientsCount" {
  return resource === "product" ? "productsCount" : resource === "service" ? "servicesCount" : "clientsCount";
}

function usageResourceCollectionName(resource: DomainKind): "products" | "services" | "clients" {
  return resource === "product" ? "products" : resource === "service" ? "services" : "clients";
}

// RC-P0-CLIENT-LIMIT-01 §11/§13 — cada contador (products/services/clients) é lido e inicializado de
// forma estritamente resource-specific: uma mutação de um recurso NUNCA agrega/inicializa o contador de
// outro recurso não relacionado (§12 — zero agregação cruzada). Isto também corrige um defeito real: a
// versão anterior sempre gravava os DOIS campos não relacionados como `0` explícito na primeira
// inicialização do doc (mesmo via merge:true, `0` explícito ainda é um valor "presente" no Firestore) —
// isso tornava esses campos permanentemente "presentes" e pulava para sempre a agregação real deles mais
// tarde, subcontando qualquer documento pré-existente desse outro recurso (ex.: 60 Clients legados,
// criados antes deste sistema de cota, ficariam contados como 0 caso o primeiro Product do tenant fosse
// criado antes do primeiro Client). Agora só o campo do recurso realmente mutado é escrito — os outros
// dois permanecem ausentes até sua PRÓPRIA primeira mutação os inicializar com uma agregação real.
async function readOrInitializeUsage(tx: Transaction, db: Firestore, uid: string, resource: DomainKind): Promise<UsageSummary> {
  const ref = usageRef(db, uid);
  const snap = await tx.get(ref);
  const field = usageCountField(resource);

  if (snap.exists) {
    const data = snap.data() as Partial<UsageSummary>;
    const storedValue = data[field];
    const resourceCount = Number.isFinite(storedValue)
      ? Math.max(0, Number(storedValue))
      : (await tx.get(db.collection("users").doc(uid).collection(usageResourceCollectionName(resource)).count())).data().count;
    if (!Number.isFinite(storedValue)) {
      tx.set(ref, { [field]: resourceCount, updatedAt: getFirebaseAdmin().firestore.FieldValue.serverTimestamp() }, { merge: true });
    }
    return {
      productsCount: resource === "product" ? resourceCount : (Number.isFinite(data.productsCount) ? Math.max(0, Number(data.productsCount)) : 0),
      servicesCount: resource === "service" ? resourceCount : (Number.isFinite(data.servicesCount) ? Math.max(0, Number(data.servicesCount)) : 0),
      clientsCount: resource === "client" ? resourceCount : (Number.isFinite(data.clientsCount) ? Math.max(0, Number(data.clientsCount)) : 0),
      initializedAt: data.initializedAt,
      updatedAt: data.updatedAt,
    };
  }

  const countSnap = await tx.get(db.collection("users").doc(uid).collection(usageResourceCollectionName(resource)).count());
  const resourceCount = countSnap.data().count;
  const now = getFirebaseAdmin().firestore.FieldValue.serverTimestamp();
  tx.set(ref, { [field]: resourceCount, initializedAt: now, updatedAt: now }, { merge: true });
  return {
    productsCount: resource === "product" ? resourceCount : 0,
    servicesCount: resource === "service" ? resourceCount : 0,
    clientsCount: resource === "client" ? resourceCount : 0,
    initializedAt: now,
    updatedAt: now,
  };
}

function assertWithinLimit(kind: DomainKind, plan: PlanType, currentCount: number): void {
  const limit = kind === "product" ? PLAN_CONFIG[plan].limits.products : kind === "service" ? PLAN_CONFIG[plan].limits.services : PLAN_CONFIG[plan].limits.clients;
  if (limit !== -1 && currentCount >= limit) {
    throw new PlanMutationError("PLAN_LIMIT_REACHED", kind === "product" ? "Você atingiu o limite de produtos do seu plano." : kind === "service" ? "Você atingiu o limite de serviços do seu plano." : "Você atingiu o limite de clientes do seu plano.", 403);
  }
}

async function ensureLifecycleForPlanSensitiveMutation(db: Firestore, uid: string): Promise<void> {
  try {
    await ensurePlanLifecycleCurrent(db, uid);
  } catch (error) {
    logError("plan_mutation.ensure_plan_lifecycle_failed", error, { uid });
    throw new PlanMutationError(
      "PLAN_LIFECYCLE_UNAVAILABLE",
      "Não foi possível validar seu plano agora. Tente novamente em instantes.",
      503,
    );
  }
}

export async function createProductCommand(db: Firestore, uid: string, input: unknown) {
  const body = input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : {};
  const productId = assertEntityId(body.productId, "productId");
  const idempotencyKey = assertIdempotencyKey(body.idempotencyKey);
  const payload = cleanProductPayload(uid, productId, body.product);
  // PLAN-IMPL-03 §6/§24/F3 — criação é plan-sensitive: se lifecycle/reconciliation não puder ficar
  // atual agora, falha fechado com erro estável em vez de criar contra um estado Premium stale.
  await ensureLifecycleForPlanSensitiveMutation(db, uid);
  const plan = await resolveServerPlan(db, uid);

  return await db.runTransaction(async (tx) => {
    const idem = idempotencyRef(db, uid, idempotencyKey);
    const idemSnap = await tx.get(idem);
    if (idemSnap.exists) {
      const data = idemSnap.data() ?? {};
      if (data.action !== PRODUCT_CREATE_ACTION || data.productId !== productId || data.tenantUid !== uid) {
        throw new PlanMutationError("IDEMPOTENCY_CONFLICT", "idempotencyKey já usada com outros dados.", 409);
      }
      const productSnap = await tx.get(productRef(db, uid, productId));
      if (!productSnap.exists) throw new PlanMutationError("IDEMPOTENCY_CONFLICT", "Replay aponta para produto ausente.", 409);
      return { productId, product: productSnap.data(), idempotentReplay: true };
    }

    const productDoc = productRef(db, uid, productId);
    const existing = await tx.get(productDoc);
    if (existing.exists) {
      throw new PlanMutationError("IDEMPOTENCY_CONFLICT", "Produto já existe para outra operação.", 409);
    }

    const usage = await readOrInitializeUsage(tx, db, uid, "product");
    assertWithinLimit("product", plan, usage.productsCount);
    const now = getFirebaseAdmin().firestore.FieldValue.serverTimestamp();
    tx.set(productDoc, payload);
    tx.set(usageRef(db, uid), { productsCount: usage.productsCount + 1, updatedAt: now }, { merge: true });
    tx.set(idem, { key: idempotencyKey, tenantUid: uid, action: PRODUCT_CREATE_ACTION, productId, createdAt: now });
    // PLAN-IMPL-06 §10 — sinal transacional de "0 -> 1", sem custo extra (usage.productsCount já lido
    // acima para o próprio gate de limite): o client usa isto para disparar first_product_created sem
    // precisar inferir de uma lista em cache local.
    return { productId, product: payload, idempotentReplay: false, isFirstProduct: usage.productsCount === 0 };
  });
}

export async function deleteProductCommand(db: Firestore, uid: string, productIdInput: unknown) {
  const productId = assertEntityId(productIdInput, "productId");
  return await db.runTransaction(async (tx) => {
    const ref = productRef(db, uid, productId);
    const snap = await tx.get(ref);
    if (!snap.exists) throw new PlanMutationError("PRODUCT_NOT_FOUND", "Produto não encontrado.", 404);
    const usage = await readOrInitializeUsage(tx, db, uid, "product");
    tx.delete(ref);
    tx.set(usageRef(db, uid), {
      productsCount: Math.max(0, usage.productsCount - 1),
      updatedAt: getFirebaseAdmin().firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    return { productId, deleted: true };
  });
}

export async function createServiceCommand(db: Firestore, uid: string, input: unknown) {
  const body = input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : {};
  const serviceId = assertEntityId(body.serviceId, "serviceId");
  const idempotencyKey = assertIdempotencyKey(body.idempotencyKey);
  const service = cleanServicePayload(uid, serviceId, body.service);
  // PLAN-IMPL-03 §6/§24/F4 — criação é plan-sensitive: se lifecycle/reconciliation não puder ficar
  // atual agora, falha fechado com erro estável em vez de criar contra um estado Premium stale.
  await ensureLifecycleForPlanSensitiveMutation(db, uid);
  const plan = await resolveServerPlan(db, uid);

  return await db.runTransaction(async (tx) => {
    const idem = idempotencyRef(db, uid, idempotencyKey);
    const idemSnap = await tx.get(idem);
    if (idemSnap.exists) {
      const data = idemSnap.data() ?? {};
      if (data.action !== SERVICE_CREATE_ACTION || data.serviceId !== serviceId || data.tenantUid !== uid) {
        throw new PlanMutationError("IDEMPOTENCY_CONFLICT", "idempotencyKey já usada com outros dados.", 409);
      }
      const serviceSnap = await tx.get(serviceRef(db, uid, serviceId));
      if (!serviceSnap.exists) throw new PlanMutationError("IDEMPOTENCY_CONFLICT", "Replay aponta para serviço ausente.", 409);
      return { serviceId, service: serviceSnap.data(), idempotentReplay: true };
    }

    const docRef = serviceRef(db, uid, serviceId);
    const existing = await tx.get(docRef);
    if (existing.exists) {
      throw new PlanMutationError("IDEMPOTENCY_CONFLICT", "Serviço já existe para outra operação.", 409);
    }

    const usage = await readOrInitializeUsage(tx, db, uid, "service");
    assertWithinLimit("service", plan, usage.servicesCount);
    const now = getFirebaseAdmin().firestore.FieldValue.serverTimestamp();
    tx.set(docRef, service);
    tx.set(usageRef(db, uid), { servicesCount: usage.servicesCount + 1, updatedAt: now }, { merge: true });
    tx.set(idem, { key: idempotencyKey, tenantUid: uid, action: SERVICE_CREATE_ACTION, serviceId, createdAt: now });
    // SERVICES-CREATE-UI-01 — mesmo padrão de isFirstProduct acima: derivado do MESMO usage já lido
    // nesta transação (0 -> 1), zero leitura extra. Idempotent replay (ramo acima) nunca chega aqui.
    return { serviceId, service, idempotentReplay: false, isFirstService: usage.servicesCount === 0 };
  });
}

export async function createClientInTransaction(tx: Transaction, db: Firestore, uid: string, clientId: string, payload: Record<string, unknown>, plan: PlanType): Promise<void> {
  const usage = await readOrInitializeUsage(tx, db, uid, "client");
  assertWithinLimit("client", plan, usage.clientsCount);
  tx.create(clientRef(db, uid, clientId), payload);
  tx.set(usageRef(db, uid), { clientsCount: usage.clientsCount + 1, updatedAt: getFirebaseAdmin().firestore.FieldValue.serverTimestamp() }, { merge: true });
}

export async function createClientCommand(db: Firestore, uid: string, input: unknown) {
  const body = input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : {};
  const clientId = assertEntityId(body.clientId, "clientId");
  const idempotencyKey = assertIdempotencyKey(body.idempotencyKey);
  const payload = cleanClientPayload(clientId, body.client);
  await ensureLifecycleForPlanSensitiveMutation(db, uid);
  const plan = await resolveServerPlan(db, uid);
  return db.runTransaction(async (tx) => {
    const idem = idempotencyRef(db, uid, idempotencyKey);
    const idemSnap = await tx.get(idem);
    if (idemSnap.exists) {
      const data = idemSnap.data() ?? {};
      if (data.action !== CLIENT_CREATE_ACTION || data.clientId !== clientId || data.tenantUid !== uid) throw new PlanMutationError("IDEMPOTENCY_CONFLICT", "idempotencyKey já usada com outros dados.", 409);
      const snap = await tx.get(clientRef(db, uid, clientId));
      if (!snap.exists) throw new PlanMutationError("IDEMPOTENCY_CONFLICT", "Replay aponta para cliente ausente.", 409);
      return { clientId, client: snap.data(), idempotentReplay: true };
    }
    const ref = clientRef(db, uid, clientId);
    if ((await tx.get(ref)).exists) throw new PlanMutationError("IDEMPOTENCY_CONFLICT", "Cliente já existe para outra operação.", 409);
    const now = getFirebaseAdmin().firestore.FieldValue.serverTimestamp();
    await createClientInTransaction(tx, db, uid, clientId, payload, plan);
    tx.set(idem, { key: idempotencyKey, tenantUid: uid, action: CLIENT_CREATE_ACTION, clientId, createdAt: now });
    return { clientId, client: payload, idempotentReplay: false };
  });
}

export async function deleteClientCommand(db: Firestore, uid: string, clientIdInput: unknown) {
  const clientId = assertEntityId(clientIdInput, "clientId");
  return db.runTransaction(async (tx) => {
    const ref = clientRef(db, uid, clientId);
    const snap = await tx.get(ref);
    if (!snap.exists) return { clientId, deleted: false };
    const usage = await readOrInitializeUsage(tx, db, uid, "client");
    tx.delete(ref);
    tx.set(usageRef(db, uid), { clientsCount: Math.max(0, usage.clientsCount - 1), updatedAt: getFirebaseAdmin().firestore.FieldValue.serverTimestamp() }, { merge: true });
    return { clientId, deleted: true };
  });
}

function sendMutationError(res: Response, error: unknown): void {
  if (error instanceof PlanMutationError) {
    res.status(error.status).json({ code: error.code, message: error.message });
    return;
  }
  logWarn("plan_authoritative_mutation.failed", { message: error instanceof Error ? error.message : String(error) });
  res.status(500).json({ code: "MUTATION_FAILED", message: "Não foi possível salvar agora. Tente novamente." });
}

export function registerPlanAuthoritativeMutationRoutes(
  app: Express,
  requireAuth: (req: Request, res: Response, next: NextFunction) => void,
): void {
  app.post("/api/products", requireAuth, async (req: Request, res: Response) => {
    const uid = (req as Request & { firebaseUid?: string }).firebaseUid;
    if (!uid) return res.status(401).json({ code: "UNAUTHORIZED", message: "Sessão inválida. Faça login novamente." });
    try {
      const result = await createProductCommand(getFirebaseAdmin().firestore(), uid, req.body);
      return res.status(result.idempotentReplay ? 200 : 201).json(result);
    } catch (error) {
      return sendMutationError(res, error);
    }
  });

  app.delete("/api/products/:productId", requireAuth, async (req: Request, res: Response) => {
    const uid = (req as Request & { firebaseUid?: string }).firebaseUid;
    if (!uid) return res.status(401).json({ code: "UNAUTHORIZED", message: "Sessão inválida. Faça login novamente." });
    try {
      const result = await deleteProductCommand(getFirebaseAdmin().firestore(), uid, req.params.productId);
      return res.status(200).json(result);
    } catch (error) {
      return sendMutationError(res, error);
    }
  });

  app.post("/api/services", requireAuth, async (req: Request, res: Response) => {
    const uid = (req as Request & { firebaseUid?: string }).firebaseUid;
    if (!uid) return res.status(401).json({ code: "UNAUTHORIZED", message: "Sessão inválida. Faça login novamente." });
    try {
      const result = await createServiceCommand(getFirebaseAdmin().firestore(), uid, req.body);
      return res.status(result.idempotentReplay ? 200 : 201).json(result);
    } catch (error) {
      return sendMutationError(res, error);
    }
  });

  app.post("/api/clients", requireAuth, async (req: Request, res: Response) => {
    const uid = (req as Request & { firebaseUid?: string }).firebaseUid;
    if (!uid) return res.status(401).json({ code: "UNAUTHORIZED", message: "Sessão inválida. Faça login novamente." });
    try {
      const result = await createClientCommand(getFirebaseAdmin().firestore(), uid, req.body);
      return res.status(result.idempotentReplay ? 200 : 201).json(result);
    } catch (error) { return sendMutationError(res, error); }
  });
  app.delete("/api/clients/:clientId", requireAuth, async (req: Request, res: Response) => {
    const uid = (req as Request & { firebaseUid?: string }).firebaseUid;
    if (!uid) return res.status(401).json({ code: "UNAUTHORIZED", message: "Sessão inválida. Faça login novamente." });
    try { return res.status(200).json(await deleteClientCommand(getFirebaseAdmin().firestore(), uid, req.params.clientId)); }
    catch (error) { return sendMutationError(res, error); }
  });
}
