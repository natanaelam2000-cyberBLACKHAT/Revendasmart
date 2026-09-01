/**
 * SERV-PUBLIC-01 — superfície pública mínima do módulo Serviços: identifica o estabelecimento pelo mesmo
 * slug já usado pelo catálogo público (server/public-catalog-ownership.ts), lista só os Services realmente
 * agendáveis, e reaproveita o Booking Core/Availability já aprovados (server/service-booking-commands.ts,
 * server/service-availability-commands.ts) SEM redesenhá-los — nenhuma lógica de concorrência/expediente é
 * reimplementada aqui, só uma camada de resolução de identidade + validação de payload público + tradução
 * de erros para um vocabulário seguro (nunca expõe NOT_FOUND interno, ids de terceiros, ou detalhes do
 * tenant). Nenhuma rota aqui usa requireAuth — cliente público nunca tem conta/login (§ REGRA CRÍTICA).
 */
import crypto from "node:crypto";
import type { Express, NextFunction, Request, Response } from "express";
import type { Firestore } from "firebase-admin/firestore";
import { getFirebaseAdmin } from "./firebase-admin-init";
import { logError, logInfo, logWarn } from "./logger";
import { normalizeCatalogSlug, resolvePublicCatalogSettingsDoc } from "./public-catalog-ownership";
import {
  ServiceAvailabilityCommandError,
  getServiceAvailabilityCommand,
  type ServiceAvailabilityResult,
} from "./service-availability-commands";
import {
  ServiceBookingCommandError,
  cancelServiceBookingCommand,
  createServiceBookingHoldCommand,
  confirmServiceBookingHoldCommand,
  rescheduleServiceBookingCommand,
} from "./service-booking-commands";
import { ServiceBookingsDomainError, resolveBookableServiceDuration } from "../shared/service-bookings";
import type { Service } from "../shared/services";

/** V1 — um único resource resolvido automaticamente (§9), mesmo valor convencional já usado pela Agenda/
 * Configuração de Disponibilidade internas (DEFAULT_RESOURCE_ID em service-agenda.tsx/service-availability-
 * settings.tsx). Nenhuma escolha de profissional nesta rodada. */
const DEFAULT_RESOURCE_ID = "default";

export class ServicePublicBookingError extends Error {
  readonly code:
    | "STORE_NOT_FOUND"
    | "SERVICE_NOT_AVAILABLE"
    | "INVALID_PAYLOAD"
    | "OUTSIDE_WORKING_HOURS"
    | "SLOT_CONFLICT"
    | "HOLD_EXPIRED"
    | "HOLD_NOT_FOUND"
    | "RESOURCE_NOT_AVAILABLE"
    | "BOOKING_NOT_FOUND"
    | "BOOKING_NOT_CANCELABLE"
    | "BOOKING_NOT_RESCHEDULABLE";

  constructor(code: ServicePublicBookingError["code"], message: string) {
    super(message);
    this.name = "ServicePublicBookingError";
    this.code = code;
  }
}

const COMMAND_ERROR_MESSAGES = {
  STORE_NOT_FOUND: "Página de agendamento indisponível.",
  SERVICE_NOT_AVAILABLE: "Este serviço não está disponível para agendamento no momento.",
  INVALID_PAYLOAD: "Confira os dados enviados e tente novamente.",
  OUTSIDE_WORKING_HOURS: "Este horário está fora do expediente configurado.",
  SLOT_CONFLICT: "Esse horário acabou de ser reservado. Escolha outro.",
  HOLD_EXPIRED: "Esse horário não está mais reservado. Escolha outro horário.",
  HOLD_NOT_FOUND: "Esta reserva temporária não foi encontrada.",
  RESOURCE_NOT_AVAILABLE: "Não há horários disponíveis neste dia.",
  // SERV-PUBLIC-02 §11 — a mesma mensagem genérica cobre token inexistente, Booking de outro tenant e
  // Booking não gerenciável: nunca revela QUAL desses três motivos causou a falha (nunca "Booking existe,
  // mas token está errado").
  BOOKING_NOT_FOUND: "Não foi possível localizar este agendamento.",
  BOOKING_NOT_CANCELABLE: "Este agendamento não pode mais ser cancelado.",
  BOOKING_NOT_RESCHEDULABLE: "Este agendamento não pode mais ser reagendado.",
} as const;

function db_(): Firestore {
  return getFirebaseAdmin().firestore();
}

function servicesCollection(db: Firestore, uid: string) {
  return db.collection("users").doc(uid).collection("services");
}

/** Traduz qualquer erro das camadas internas de Booking/Availability para o vocabulário público de §33 —
 * nunca deixa um código/mensagem interno (que poderia revelar detalhes do tenant) escapar para o cliente.
 * `notFoundAs` desambigua o código genérico NOT_FOUND (reaproveitado internamente tanto para "Service
 * inexistente" quanto para "Hold inexistente", conforme o comando chamado) para o vocabulário público certo
 * em cada contexto de chamada. */
type NotFoundTranslation = "SERVICE_NOT_AVAILABLE" | "HOLD_NOT_FOUND" | "BOOKING_NOT_FOUND";

function translateInternalError(error: unknown, notFoundAs: NotFoundTranslation = "HOLD_NOT_FOUND"): ServicePublicBookingError {
  if (error instanceof ServiceBookingCommandError) {
    switch (error.code) {
      case "NOT_FOUND": return new ServicePublicBookingError(notFoundAs, COMMAND_ERROR_MESSAGES[notFoundAs]);
      case "SERVICE_NOT_BOOKABLE": return new ServicePublicBookingError("SERVICE_NOT_AVAILABLE", COMMAND_ERROR_MESSAGES.SERVICE_NOT_AVAILABLE);
      case "SEGMENT_UNAVAILABLE":
      case "LOCK_OWNERSHIP_LOST":
      case "BLOCKED_INTERVAL":
      case "MISALIGNED_SLOT":
      case "MIN_ADVANCE_VIOLATION":
      case "MAX_ADVANCE_VIOLATION":
        return new ServicePublicBookingError("SLOT_CONFLICT", COMMAND_ERROR_MESSAGES.SLOT_CONFLICT);
      case "HOLD_EXPIRED":
      case "HOLD_RELEASED":
      case "HOLD_ALREADY_CONFIRMED":
        return new ServicePublicBookingError("HOLD_EXPIRED", COMMAND_ERROR_MESSAGES.HOLD_EXPIRED);
      case "OUTSIDE_WORKING_HOURS":
        return new ServicePublicBookingError("OUTSIDE_WORKING_HOURS", COMMAND_ERROR_MESSAGES.OUTSIDE_WORKING_HOURS);
      // PLAN-IMPL-02A §6 — a loja atingiu o limite de clientes do plano atual; reaproveita o vocabulário
      // público existente (nunca expõe plano/billing da loja ao visitante anônimo, mesmo espírito do §11
      // de nunca revelar QUAL motivo interno causou a falha).
      case "CLIENT_LIMIT_REACHED":
        return new ServicePublicBookingError("SERVICE_NOT_AVAILABLE", COMMAND_ERROR_MESSAGES.SERVICE_NOT_AVAILABLE);
      // SERV-PUBLIC-02 — o Booking FOI encontrado pelo token (não é ambiguidade de lookup, §11 não se
      // aplica aqui); é uma regra de negócio legítima e distinguível, reaproveitada do Booking Core.
      case "WORK_NOT_CANCELABLE":
        return new ServicePublicBookingError("BOOKING_NOT_CANCELABLE", COMMAND_ERROR_MESSAGES.BOOKING_NOT_CANCELABLE);
      case "BOOKING_NOT_RESCHEDULABLE":
        return new ServicePublicBookingError("BOOKING_NOT_RESCHEDULABLE", COMMAND_ERROR_MESSAGES.BOOKING_NOT_RESCHEDULABLE);
      default:
        return new ServicePublicBookingError("INVALID_PAYLOAD", COMMAND_ERROR_MESSAGES.INVALID_PAYLOAD);
    }
  }
  if (error instanceof ServiceAvailabilityCommandError) {
    if (error.code === "NOT_FOUND") return new ServicePublicBookingError(notFoundAs, COMMAND_ERROR_MESSAGES[notFoundAs]);
    return new ServicePublicBookingError("INVALID_PAYLOAD", COMMAND_ERROR_MESSAGES.INVALID_PAYLOAD);
  }
  if (error instanceof ServiceBookingsDomainError) {
    return new ServicePublicBookingError("INVALID_PAYLOAD", COMMAND_ERROR_MESSAGES.INVALID_PAYLOAD);
  }
  throw error;
}

function validateSlugParam(value: unknown): string {
  const slug = normalizeCatalogSlug(value);
  if (!slug) throw new ServicePublicBookingError("STORE_NOT_FOUND", COMMAND_ERROR_MESSAGES.STORE_NOT_FOUND);
  return slug;
}
function validateEntityId(value: unknown, fieldName: string): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!/^[a-zA-Z0-9_-]{1,120}$/.test(text)) throw new ServicePublicBookingError("INVALID_PAYLOAD", `${fieldName} inválido.`);
  return text;
}
function validateIdempotencyKey(value: unknown): string {
  const key = typeof value === "string" ? value.trim() : "";
  if (!/^[a-zA-Z0-9_-]{6,120}$/.test(key)) throw new ServicePublicBookingError("INVALID_PAYLOAD", "idempotencyKey inválida.");
  return key;
}
function validateStartAt(value: unknown): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text || !Number.isFinite(Date.parse(text))) throw new ServicePublicBookingError("INVALID_PAYLOAD", "Horário inválido.");
  return text;
}
/** Nomes/telefones digitados por qualquer visitante — sanitize simples (trim + limite de tamanho, mesmos
 * limites já aplicados pelas Rules de Client hoje, ver isValidClientCreate em firestore.rules): nenhuma
 * validação de formato de telefone específica de país (fora de escopo, §28 não exige mais que isso). */
function validateCustomerName(value: unknown): string {
  const text = typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, 140) : "";
  if (!text) throw new ServicePublicBookingError("INVALID_PAYLOAD", "Informe seu nome.");
  return text;
}
function validateCustomerPhone(value: unknown): string {
  const text = typeof value === "string" ? value.trim().slice(0, 40) : "";
  if (!text) throw new ServicePublicBookingError("INVALID_PAYLOAD", "Informe seu WhatsApp/telefone.");
  return text;
}
/** §11 — um token malformado é tratado como "não encontrado" (mesma resposta genérica), nunca um erro de
 * validação distinto que revelaria "o formato está certo, mas não bate com nada". */
function validateManageToken(value: unknown): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text || text.length > 200) throw new ServicePublicBookingError("BOOKING_NOT_FOUND", COMMAND_ERROR_MESSAGES.BOOKING_NOT_FOUND);
  return text;
}

// ====================================================================================================
// Token de gerenciamento público — mesmo padrão já aprovado em server/promotional-campaigns.ts
// (hashToken/randomBytes(32).base64url para os links de sorteio): 256 bits de entropia, URL-safe, nunca
// persistido em plaintext (só o sha256 hex vai para o Booking, ver shared/service-bookings.ts).
// ====================================================================================================
function hashManageToken(rawToken: string): string {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}
function generateManageToken(): { rawToken: string; tokenHash: string } {
  const rawToken = crypto.randomBytes(32).toString("base64url");
  return { rawToken, tokenHash: hashManageToken(rawToken) };
}

export type PublicBookingStore = {
  readonly uid: string;
  readonly slug: string;
  readonly name: string;
  readonly description?: string;
  readonly logoUrl?: string;
};

/** Reaproveita a MESMA resolução de slug->tenant já aprovada para o catálogo público (nenhum segundo
 * sistema de identidade pública, §4) e a mesma regra de "catálogo desabilitado = página indisponível" já
 * usada por ele (sem uma flag dedicada de agendamento em V1 — ver relatório final). */
export async function resolvePublicBookingStore(db: Firestore, rawSlug: string): Promise<PublicBookingStore | null> {
  const slug = normalizeCatalogSlug(rawSlug);
  if (!slug) return null;
  const settingsDoc = await resolvePublicCatalogSettingsDoc(db, rawSlug);
  if (!settingsDoc) return null;
  const settings = (settingsDoc.data() ?? {}) as Record<string, unknown>;
  const catalogEnabled = settings.enablePublicCatalog ?? settings.catalogEnabled ?? settings.catalog_enabled ?? true;
  if (catalogEnabled === false || settings.disablePublicCatalog === true) return null;
  const name = typeof settings.storeName === "string" && settings.storeName.trim() ? settings.storeName.trim().slice(0, 120) : "Minha Loja";
  const description = typeof settings.storeDescription === "string" && settings.storeDescription.trim()
    ? settings.storeDescription.trim().slice(0, 600)
    : undefined;
  const logoUrl = typeof settings.storeLogo === "string" && settings.storeLogo.trim()
    ? settings.storeLogo.trim()
    : (typeof settings.storeLogoUrl === "string" && settings.storeLogoUrl.trim() ? settings.storeLogoUrl.trim() : undefined);
  return { uid: settingsDoc.id, slug, name, ...(description ? { description } : {}), ...(logoUrl ? { logoUrl } : {}) };
}

export type PublicBookableService = {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly durationMinutes: number;
  readonly priceCents: number;
};

function toPublicBookableService(service: Service): PublicBookableService | null {
  if (!service.active || !service.published) return null;
  // PLAN-IMPL-02B1 §17 — serviço preservado por downgrade de plano nunca aparece na lista pública de
  // agendamento, mesmo padrão de exclusão (retornar null) já usado acima para active/published. A
  // rejeição do agendamento DIRETO por id (hold/confirm com um serviceId já conhecido) fica em
  // server/service-booking-commands.ts — esta função só cobre a listagem.
  if (service.planAccessState === "preserved") return null;
  if (service.pricing.mode !== "fixed") return null;
  try {
    const durationMinutes = resolveBookableServiceDuration(service);
    return {
      id: service.id,
      name: service.name,
      ...(service.description ? { description: service.description } : {}),
      durationMinutes,
      priceCents: service.pricing.priceCents,
    };
  } catch {
    return null;
  }
}

/** §7 — só os Services realmente agendáveis: active + published + bookingMode agendável + duração/preço
 * fixo já validados (mesma regra de elegibilidade que createHold aplica na hora, nunca reimplementada aqui
 * duas vezes — resolveBookableServiceDuration é a MESMA função usada pelo Booking Core). */
export async function listPublicBookableServicesCommand(db: Firestore, uid: string): Promise<PublicBookableService[]> {
  const snapshot = await servicesCollection(db, uid).where("active", "==", true).where("published", "==", true).get();
  const result: PublicBookableService[] = [];
  for (const doc of snapshot.docs) {
    const projected = toPublicBookableService(doc.data() as Service);
    if (projected) result.push(projected);
  }
  return result.sort((a, b) => a.name.localeCompare(b.name));
}

/** §12 — repassa a mesma leitura de disponibilidade já usada pela Agenda interna (nenhuma reconstrução de
 * weeklyHours no client, nenhuma segunda fonte de verdade): só `{timezone, slotStepMinutes, durationMinutes,
 * candidates: [{startAt, endAt}]}`, nunca quem ocupa cada horário (§26/§32 — já garantido pela função em si,
 * ver server/service-availability-commands.ts). */
export async function getPublicServiceAvailabilityCommand(
  db: Firestore,
  storeUid: string,
  serviceId: string,
  rangeStartAt: string,
  rangeEndAt: string,
): Promise<ServiceAvailabilityResult> {
  try {
    return await getServiceAvailabilityCommand(db, storeUid, serviceId, DEFAULT_RESOURCE_ID, rangeStartAt, rangeEndAt);
  } catch (error) {
    throw translateInternalError(error, "SERVICE_NOT_AVAILABLE");
  }
}

export type PublicCreateHoldResult = { readonly holdId: string; readonly startAt: string; readonly endAt: string; readonly expiresAt: string };

/** §8/§13 — reaproveita createServiceBookingHoldCommand SEM NENHUMA MUDANÇA: o servidor sempre relê o
 * Service real (preço/duração/bookingMode nunca vêm do browser, §3/§8) e revalida expediente/blocks/
 * antecedência antes de conceder qualquer lock, exatamente como o fluxo interno do dono. customerId
 * permanece undefined aqui — o contato do cliente só é coletado/anexado na confirmação (§13, mesma ordem
 * do ticket: slot -> Hold -> coleta de dados -> confirm). */
export async function createPublicServiceBookingHoldCommand(
  db: Firestore,
  storeUid: string,
  serviceId: string,
  startAtInput: string,
  idempotencyKey: string,
): Promise<PublicCreateHoldResult> {
  try {
    const outcome = await createServiceBookingHoldCommand(db, storeUid, serviceId, DEFAULT_RESOURCE_ID, startAtInput, undefined, idempotencyKey);
    if ("conflict" in outcome) throw new ServicePublicBookingError("SLOT_CONFLICT", COMMAND_ERROR_MESSAGES.SLOT_CONFLICT);
    return { holdId: outcome.holdId, startAt: outcome.startAt, endAt: outcome.endAt, expiresAt: outcome.expiresAt };
  } catch (error) {
    if (error instanceof ServicePublicBookingError) throw error;
    throw translateInternalError(error, "SERVICE_NOT_AVAILABLE");
  }
}

export type PublicConfirmResult = {
  readonly confirmed: true;
  readonly startAt: string;
  readonly endAt: string;
  /** SERV-PUBLIC-02 — presente na quase totalidade dos casos (toda confirmação pública gera um). Ausente
   * só no caso extremo em que ESTE hold já havia sido confirmado por uma chamada anterior com uma
   * idempotencyKey DIFERENTE — o token original vive só naquela outra idempotency record (nunca
   * reconstituível de outra forma, nunca "regerado" com um novo hash não-persistido). */
  readonly manageToken?: string;
};

function buildPublicClientId(holdId: string): string {
  return `public-${holdId}`;
}

/** §15-19 — coleta só nome+telefone (V1), cria o Client de contato ATOMICAMENTE com o Booking/Work (dentro
 * de confirmServiceBookingHoldCommand, nunca uma segunda escrita separada) e devolve um payload de sucesso
 * já sanitizado para exibição pública (§21 — nenhum id interno, nenhum campo técnico). SERV-PUBLIC-02:
 * também gera o token de gerenciamento público (só no confirm público, nunca no fluxo interno, §4). */
export async function confirmPublicServiceBookingHoldCommand(
  db: Firestore,
  storeUid: string,
  holdId: string,
  customerName: string,
  customerPhone: string,
  idempotencyKey: string,
): Promise<PublicConfirmResult> {
  try {
    const candidateToken = generateManageToken();
    const result = await confirmServiceBookingHoldCommand(db, storeUid, holdId, idempotencyKey, {
      source: "public",
      publicCustomerContact: { clientId: buildPublicClientId(holdId), name: customerName, phone: customerPhone },
      publicManageToken: candidateToken,
    });
    // MG4 — replay da MESMA key: result.publicManageToken já vem do idempotency record original (o
    // candidateToken gerado NESTA chamada nunca foi persistido em lugar nenhum quando idempotentReplay=true,
    // então NUNCA é usado como fallback nesse caso — só na confirmação genuinamente nova).
    const manageToken = result.publicManageToken ?? (result.idempotentReplay ? undefined : candidateToken.rawToken);
    return { confirmed: true, startAt: result.startAt, endAt: result.endAt, ...(manageToken ? { manageToken } : {}) };
  } catch (error) {
    throw translateInternalError(error);
  }
}

// ====================================================================================================
// Gerenciamento público (SERV-PUBLIC-02) — ler/cancelar/reagendar o PRÓPRIO Booking via token opaco.
// ====================================================================================================
type PublicBookingRecord = {
  readonly id: string;
  readonly serviceId: string;
  readonly resourceId: string;
  readonly workId: string;
  readonly customerId?: string;
  readonly startAt: string;
  readonly endAt: string;
  readonly status: "confirmed" | "cancelled";
  readonly source?: string;
};

/** §9 — lookup eficiente: um único where(publicManageTokenHash==hash).limit(1), já escopado ao tenant certo
 * (a própria coleção users/{storeUid}/bookings), nunca uma listagem completa comparando hashes em memória.
 * §32 — nunca resolve um Booking de OUTRO storeUid: a query em si só enxerga a subcoleção do tenant já
 * resolvido pelo slug, então um token de outro tenant simplesmente não aparece aqui (0 resultados), mesmo
 * que hipoteticamente colidisse (256 bits — nunca acontece na prática). */
async function findBookingByManageToken(db: Firestore, storeUid: string, rawToken: string): Promise<PublicBookingRecord | null> {
  const tokenHash = hashManageToken(rawToken);
  const snapshot = await db.collection("users").doc(storeUid).collection("bookings")
    .where("publicManageTokenHash", "==", tokenHash).limit(1).get();
  if (snapshot.empty) return null;
  const doc = snapshot.docs[0];
  const data = doc.data() as Record<string, unknown>;
  // Defensivo — só Bookings source="public" jamais recebem este campo, então isto nunca deveria falhar,
  // mas nunca confiar implicitamente num campo cujo valor não foi revalidado nesta leitura.
  if (data.source !== "public") return null;
  return {
    id: doc.id,
    serviceId: data.serviceId as string,
    resourceId: data.resourceId as string,
    workId: data.workId as string,
    customerId: typeof data.customerId === "string" ? data.customerId : undefined,
    startAt: data.startAt as string,
    endAt: data.endAt as string,
    status: data.status as "confirmed" | "cancelled",
    source: data.source as string,
  };
}

function firstNameOf(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.split(/\s+/)[0] : undefined;
}

export type PublicManagedBookingProjection = {
  readonly serviceName: string;
  readonly storeName: string;
  readonly startAt: string;
  readonly endAt: string;
  readonly timezone: string;
  readonly status: "confirmed" | "cancelled";
  readonly customerFirstName?: string;
  readonly canCancel: boolean;
  readonly canReschedule: boolean;
};

/** §8 — projeção pública mínima: relê Service/ServiceResourceSchedule/ServiceWork/Client server-side só
 * para extrair os poucos campos exibíveis (nome, timezone, status, primeiro nome) — nunca devolve os
 * documentos inteiros, nunca tenantUid/customerId/workId/resourceId/financialSummary/quoteId/payments (§8). */
export async function getPublicManagedBookingCommand(
  db: Firestore,
  storeUid: string,
  storeName: string,
  rawToken: string,
): Promise<PublicManagedBookingProjection> {
  const record = await findBookingByManageToken(db, storeUid, rawToken);
  if (!record) throw new ServicePublicBookingError("BOOKING_NOT_FOUND", COMMAND_ERROR_MESSAGES.BOOKING_NOT_FOUND);

  const [serviceSnap, scheduleSnap, workSnap, clientSnap] = await Promise.all([
    db.collection("users").doc(storeUid).collection("services").doc(record.serviceId).get(),
    db.collection("users").doc(storeUid).collection("serviceResourceSchedules").doc(record.resourceId).get(),
    db.collection("users").doc(storeUid).collection("serviceWorks").doc(record.workId).get(),
    record.customerId ? db.collection("users").doc(storeUid).collection("clients").doc(record.customerId).get() : Promise.resolve(undefined),
  ]);
  const serviceName = typeof serviceSnap.data()?.name === "string" ? (serviceSnap.data()!.name as string) : "Serviço";
  const timezone = typeof scheduleSnap.data()?.timezone === "string" ? (scheduleSnap.data()!.timezone as string) : "UTC";
  const workStatus = workSnap.data()?.status;
  const canManage = record.status === "confirmed" && workStatus === "planned";
  const customerFirstName = firstNameOf(clientSnap?.data()?.name);

  return {
    serviceName,
    storeName,
    startAt: record.startAt,
    endAt: record.endAt,
    timezone,
    status: record.status,
    ...(customerFirstName ? { customerFirstName } : {}),
    canCancel: canManage,
    canReschedule: canManage,
  };
}

export type PublicCancelResult = { readonly cancelled: true };

/** §12-14 — reaproveita cancelServiceBookingCommand SEM NENHUMA MUDANÇA: mesma regra de elegibilidade
 * (§13), mesma liberação de locks, mesmo cancelamento de Work, e a mesma garantia de NUNCA criar Refund
 * (o comando nunca tocou Payment/Refund, ver server/service-booking-commands.ts §10). */
export async function cancelPublicManagedBookingCommand(
  db: Firestore,
  storeUid: string,
  rawToken: string,
  idempotencyKey: string,
): Promise<PublicCancelResult> {
  const record = await findBookingByManageToken(db, storeUid, rawToken);
  if (!record) throw new ServicePublicBookingError("BOOKING_NOT_FOUND", COMMAND_ERROR_MESSAGES.BOOKING_NOT_FOUND);
  try {
    await cancelServiceBookingCommand(db, storeUid, record.id, idempotencyKey);
    return { cancelled: true };
  } catch (error) {
    throw translateInternalError(error, "BOOKING_NOT_FOUND");
  }
}

/** §17 — availability para reagendamento deriva serviceId/resourceId do PRÓPRIO Booking resolvido pelo
 * token, nunca aceito do client (§15: não altera Service nem Resource). Mesma leitura pública de
 * disponibilidade já usada na criação (getServiceAvailabilityCommand), nenhuma segunda implementação. */
export async function getPublicRescheduleAvailabilityCommand(
  db: Firestore,
  storeUid: string,
  rawToken: string,
  rangeStartAt: string,
  rangeEndAt: string,
): Promise<ServiceAvailabilityResult> {
  const record = await findBookingByManageToken(db, storeUid, rawToken);
  if (!record) throw new ServicePublicBookingError("BOOKING_NOT_FOUND", COMMAND_ERROR_MESSAGES.BOOKING_NOT_FOUND);
  try {
    return await getServiceAvailabilityCommand(db, storeUid, record.serviceId, record.resourceId, rangeStartAt, rangeEndAt);
  } catch (error) {
    throw translateInternalError(error, "BOOKING_NOT_FOUND");
  }
}

export type PublicRescheduleResult = { readonly startAt: string; readonly endAt: string };

/** §16/§18/§21 — reaproveita rescheduleServiceBookingCommand SEM NENHUMA MUDANÇA: mesmo Booking id
 * preservado (nunca cancel+create), mesma transaction all-or-nothing (uma falha nunca perde o horário
 * antigo), e o token continua válido depois (só o hash no Booking, que nunca é tocado por este comando). */
export async function reschedulePublicManagedBookingCommand(
  db: Firestore,
  storeUid: string,
  rawToken: string,
  newStartAt: string,
  idempotencyKey: string,
): Promise<PublicRescheduleResult> {
  const record = await findBookingByManageToken(db, storeUid, rawToken);
  if (!record) throw new ServicePublicBookingError("BOOKING_NOT_FOUND", COMMAND_ERROR_MESSAGES.BOOKING_NOT_FOUND);
  try {
    const outcome = await rescheduleServiceBookingCommand(db, storeUid, record.id, newStartAt, idempotencyKey);
    if ("conflict" in outcome) throw new ServicePublicBookingError("SLOT_CONFLICT", COMMAND_ERROR_MESSAGES.SLOT_CONFLICT);
    return { startAt: outcome.startAt, endAt: outcome.endAt };
  } catch (error) {
    if (error instanceof ServicePublicBookingError) throw error;
    throw translateInternalError(error, "BOOKING_NOT_FOUND");
  }
}

// ====================================================================================================
// Rate limiting — mesmos valores/estratégia de server/routes.ts (publicCatalogRateLimit), duplicados
// deliberadamente aqui (não importados) para não criar uma dependência circular routes.ts <-> este arquivo
// (routes.ts precisa importar registerPublicServiceBookingRoutes daqui). Mesma janela/limites — se um dia
// precisar mudar, mudar os dois juntos.
// ====================================================================================================
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_PER_SLUG = 60;
const RATE_LIMIT_MAX_PER_IP = 240;
const RATE_LIMIT_MAX_KEYS = 10_000;
const slugRateLimitMap = new Map<string, { count: number; resetAt: number }>();
const ipRateLimitMap = new Map<string, { count: number; resetAt: number }>();

export function resetPublicServiceBookingRateLimitsForTests(): void {
  slugRateLimitMap.clear();
  ipRateLimitMap.clear();
  managementIpRateLimitMap.clear();
}

function checkRateLimit(map: Map<string, { count: number; resetAt: number }>, key: string, max: number, now: number): boolean {
  const current = map.get(key);
  if (!current || now >= current.resetAt) {
    if (map.size >= RATE_LIMIT_MAX_KEYS) {
      map.forEach((entry, storedKey) => { if (now >= entry.resetAt) map.delete(storedKey); });
      if (map.size >= RATE_LIMIT_MAX_KEYS) {
        const oldestKey = map.keys().next().value;
        if (oldestKey) map.delete(oldestKey);
      }
    }
    map.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  if (current.count >= max) return false;
  current.count += 1;
  return true;
}

function clientKeyFor(req: Request): string {
  const forwardedFor = req.headers["x-forwarded-for"];
  const forwardedValue = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor;
  return String(forwardedValue?.split(",")[0]?.trim() || req.ip || req.socket.remoteAddress || "unknown").slice(0, 128);
}

function publicServiceBookingRateLimit(req: Request, res: Response, next: NextFunction) {
  const now = Date.now();
  const clientKey = clientKeyFor(req);
  const slug = normalizeCatalogSlug(req.params.storeSlug) || "invalid";
  const ipAllowed = checkRateLimit(ipRateLimitMap, clientKey, RATE_LIMIT_MAX_PER_IP, now);
  const slugAllowed = checkRateLimit(slugRateLimitMap, `${clientKey}:${slug}`, RATE_LIMIT_MAX_PER_SLUG, now);
  if (!ipAllowed || !slugAllowed) {
    res.setHeader("Retry-After", String(Math.ceil(RATE_LIMIT_WINDOW_MS / 1000)));
    res.status(429).json({ code: "RATE_LIMITED", message: "Muitas tentativas. Tente novamente em instantes." });
    return;
  }
  next();
}

// SERV-PUBLIC-02 §23 — endpoints de gerenciamento (leem/mutam por token) recebem um limite mais restrito
// por IP, independente do limite geral por slug acima: defesa em profundidade contra brute-force de token,
// além dos 256 bits de entropia em si já tornarem isso inviável na prática.
const MANAGEMENT_RATE_LIMIT_MAX_PER_IP = 30;
const managementIpRateLimitMap = new Map<string, { count: number; resetAt: number }>();

function publicBookingManagementRateLimit(req: Request, res: Response, next: NextFunction) {
  const now = Date.now();
  const clientKey = clientKeyFor(req);
  const allowed = checkRateLimit(managementIpRateLimitMap, clientKey, MANAGEMENT_RATE_LIMIT_MAX_PER_IP, now);
  if (!allowed) {
    res.setHeader("Retry-After", String(Math.ceil(RATE_LIMIT_WINDOW_MS / 1000)));
    res.status(429).json({ code: "RATE_LIMITED", message: "Muitas tentativas. Tente novamente em instantes." });
    return;
  }
  next();
}

// ====================================================================================================
// Rotas HTTP — todas SEM requireAuth (§5/§26). Payload size já é limitado pelo `express.json()` global
// do app (mesmo limite de qualquer outra rota); nenhum endpoint aqui lê/lista Bookings/Works/Clients/
// Payments existentes — só cria através dos commands já auditados (§26/§27).
// ====================================================================================================
export function registerPublicServiceBookingRoutes(app: Express): void {
  app.get("/api/public/services/:storeSlug", publicServiceBookingRateLimit, async (req, res) => {
    try {
      const store = await resolvePublicBookingStore(db_(), validateSlugParam(req.params.storeSlug));
      if (!store) { res.status(404).json({ code: "STORE_NOT_FOUND", message: COMMAND_ERROR_MESSAGES.STORE_NOT_FOUND }); return; }
      const services = await listPublicBookableServicesCommand(db_(), store.uid);
      res.status(200).json({
        store: { name: store.name, ...(store.description ? { description: store.description } : {}), ...(store.logoUrl ? { logoUrl: store.logoUrl } : {}) },
        services,
      });
    } catch (error) {
      if (error instanceof ServicePublicBookingError) { res.status(error.code === "STORE_NOT_FOUND" ? 404 : 400).json({ code: error.code, message: error.message }); return; }
      logError("service_public_booking.store_lookup_failed", error, { requestId: req.requestId });
      res.status(500).json({ code: "INTERNAL_SERVER_ERROR", message: "Não foi possível carregar a página de agendamento agora." });
    }
  });

  app.get("/api/public/services/:storeSlug/availability", publicServiceBookingRateLimit, async (req, res) => {
    try {
      const store = await resolvePublicBookingStore(db_(), validateSlugParam(req.params.storeSlug));
      if (!store) { res.status(404).json({ code: "STORE_NOT_FOUND", message: COMMAND_ERROR_MESSAGES.STORE_NOT_FOUND }); return; }
      const serviceId = validateEntityId(req.query.serviceId, "serviceId");
      const rangeStartAt = typeof req.query.rangeStartAt === "string" ? req.query.rangeStartAt : "";
      const rangeEndAt = typeof req.query.rangeEndAt === "string" ? req.query.rangeEndAt : "";
      const result = await getPublicServiceAvailabilityCommand(db_(), store.uid, serviceId, rangeStartAt, rangeEndAt);
      res.status(200).json(result);
    } catch (error) {
      if (error instanceof ServicePublicBookingError) { res.status(error.code === "STORE_NOT_FOUND" ? 404 : 400).json({ code: error.code, message: error.message }); return; }
      logError("service_public_booking.availability_failed", error, { requestId: req.requestId });
      res.status(500).json({ code: "INTERNAL_SERVER_ERROR", message: "Não foi possível consultar os horários agora." });
    }
  });

  app.post("/api/public/services/:storeSlug/bookings/holds", publicServiceBookingRateLimit, async (req, res) => {
    try {
      const store = await resolvePublicBookingStore(db_(), validateSlugParam(req.params.storeSlug));
      if (!store) { res.status(404).json({ code: "STORE_NOT_FOUND", message: COMMAND_ERROR_MESSAGES.STORE_NOT_FOUND }); return; }
      const serviceId = validateEntityId(req.body?.serviceId, "serviceId");
      const startAt = validateStartAt(req.body?.startAt);
      const idempotencyKey = validateIdempotencyKey(req.body?.idempotencyKey);
      const result = await createPublicServiceBookingHoldCommand(db_(), store.uid, serviceId, startAt, idempotencyKey);
      logInfo("service_public_booking.hold_created", { requestId: req.requestId, storeSlug: store.slug });
      res.status(200).json(result);
    } catch (error) {
      if (error instanceof ServicePublicBookingError) {
        logWarn("service_public_booking.hold_rejected", { requestId: req.requestId, code: error.code });
        res.status(error.code === "STORE_NOT_FOUND" ? 404 : error.code === "SLOT_CONFLICT" ? 409 : 400).json({ code: error.code, message: error.message });
        return;
      }
      logError("service_public_booking.hold_failed", error, { requestId: req.requestId });
      res.status(500).json({ code: "INTERNAL_SERVER_ERROR", message: "Não foi possível reservar esse horário agora." });
    }
  });

  app.post("/api/public/services/:storeSlug/bookings/holds/:holdId/confirm", publicServiceBookingRateLimit, async (req, res) => {
    try {
      const store = await resolvePublicBookingStore(db_(), validateSlugParam(req.params.storeSlug));
      if (!store) { res.status(404).json({ code: "STORE_NOT_FOUND", message: COMMAND_ERROR_MESSAGES.STORE_NOT_FOUND }); return; }
      const holdId = validateEntityId(req.params.holdId, "holdId");
      const customerName = validateCustomerName(req.body?.customerName);
      const customerPhone = validateCustomerPhone(req.body?.customerPhone);
      const idempotencyKey = validateIdempotencyKey(req.body?.idempotencyKey);
      const result = await confirmPublicServiceBookingHoldCommand(db_(), store.uid, holdId, customerName, customerPhone, idempotencyKey);
      logInfo("service_public_booking.confirmed", { requestId: req.requestId, storeSlug: store.slug });
      res.status(200).json(result);
    } catch (error) {
      if (error instanceof ServicePublicBookingError) {
        logWarn("service_public_booking.confirm_rejected", { requestId: req.requestId, code: error.code });
        res.status(error.code === "STORE_NOT_FOUND" || error.code === "HOLD_NOT_FOUND" ? 404 : error.code === "SLOT_CONFLICT" || error.code === "HOLD_EXPIRED" ? 409 : 400).json({ code: error.code, message: error.message });
        return;
      }
      logError("service_public_booking.confirm_failed", error, { requestId: req.requestId });
      res.status(500).json({ code: "INTERNAL_SERVER_ERROR", message: "Não foi possível confirmar o agendamento agora." });
    }
  });

  // ==================================================================================================
  // SERV-PUBLIC-02 — gerenciamento público por token (nunca por bookingId sozinho, §STOP#3). Todas usam
  // o rate limit mais restrito (§23). Nunca logam o token (§24 — só storeSlug/requestId).
  // ==================================================================================================
  app.get("/api/public/services/:storeSlug/bookings/manage/:token", publicBookingManagementRateLimit, async (req, res) => {
    try {
      const store = await resolvePublicBookingStore(db_(), validateSlugParam(req.params.storeSlug));
      if (!store) { res.status(404).json({ code: "BOOKING_NOT_FOUND", message: COMMAND_ERROR_MESSAGES.BOOKING_NOT_FOUND }); return; }
      const token = validateManageToken(req.params.token);
      const result = await getPublicManagedBookingCommand(db_(), store.uid, store.name, token);
      res.status(200).json(result);
    } catch (error) {
      if (error instanceof ServicePublicBookingError) {
        logWarn("service_public_booking.manage_lookup_rejected", { requestId: req.requestId, code: error.code });
        res.status(error.code === "BOOKING_NOT_FOUND" ? 404 : 400).json({ code: error.code, message: error.message });
        return;
      }
      logError("service_public_booking.manage_lookup_failed", error, { requestId: req.requestId });
      res.status(500).json({ code: "INTERNAL_SERVER_ERROR", message: "Não foi possível carregar este agendamento agora." });
    }
  });

  app.get("/api/public/services/:storeSlug/bookings/manage/:token/availability", publicBookingManagementRateLimit, async (req, res) => {
    try {
      const store = await resolvePublicBookingStore(db_(), validateSlugParam(req.params.storeSlug));
      if (!store) { res.status(404).json({ code: "BOOKING_NOT_FOUND", message: COMMAND_ERROR_MESSAGES.BOOKING_NOT_FOUND }); return; }
      const token = validateManageToken(req.params.token);
      const rangeStartAt = typeof req.query.rangeStartAt === "string" ? req.query.rangeStartAt : "";
      const rangeEndAt = typeof req.query.rangeEndAt === "string" ? req.query.rangeEndAt : "";
      const result = await getPublicRescheduleAvailabilityCommand(db_(), store.uid, token, rangeStartAt, rangeEndAt);
      res.status(200).json(result);
    } catch (error) {
      if (error instanceof ServicePublicBookingError) {
        res.status(error.code === "BOOKING_NOT_FOUND" ? 404 : 400).json({ code: error.code, message: error.message });
        return;
      }
      logError("service_public_booking.manage_availability_failed", error, { requestId: req.requestId });
      res.status(500).json({ code: "INTERNAL_SERVER_ERROR", message: "Não foi possível consultar os horários agora." });
    }
  });

  app.post("/api/public/services/:storeSlug/bookings/manage/:token/cancel", publicBookingManagementRateLimit, async (req, res) => {
    try {
      const store = await resolvePublicBookingStore(db_(), validateSlugParam(req.params.storeSlug));
      if (!store) { res.status(404).json({ code: "BOOKING_NOT_FOUND", message: COMMAND_ERROR_MESSAGES.BOOKING_NOT_FOUND }); return; }
      const token = validateManageToken(req.params.token);
      const idempotencyKey = validateIdempotencyKey(req.body?.idempotencyKey);
      const result = await cancelPublicManagedBookingCommand(db_(), store.uid, token, idempotencyKey);
      logInfo("service_public_booking.manage_cancelled", { requestId: req.requestId, storeSlug: store.slug });
      res.status(200).json(result);
    } catch (error) {
      if (error instanceof ServicePublicBookingError) {
        logWarn("service_public_booking.manage_cancel_rejected", { requestId: req.requestId, code: error.code });
        res.status(error.code === "BOOKING_NOT_FOUND" ? 404 : error.code === "BOOKING_NOT_CANCELABLE" ? 409 : 400).json({ code: error.code, message: error.message });
        return;
      }
      logError("service_public_booking.manage_cancel_failed", error, { requestId: req.requestId });
      res.status(500).json({ code: "INTERNAL_SERVER_ERROR", message: "Não foi possível cancelar este agendamento agora." });
    }
  });

  app.post("/api/public/services/:storeSlug/bookings/manage/:token/reschedule", publicBookingManagementRateLimit, async (req, res) => {
    try {
      const store = await resolvePublicBookingStore(db_(), validateSlugParam(req.params.storeSlug));
      if (!store) { res.status(404).json({ code: "BOOKING_NOT_FOUND", message: COMMAND_ERROR_MESSAGES.BOOKING_NOT_FOUND }); return; }
      const token = validateManageToken(req.params.token);
      const startAt = validateStartAt(req.body?.startAt);
      const idempotencyKey = validateIdempotencyKey(req.body?.idempotencyKey);
      const result = await reschedulePublicManagedBookingCommand(db_(), store.uid, token, startAt, idempotencyKey);
      logInfo("service_public_booking.manage_rescheduled", { requestId: req.requestId, storeSlug: store.slug });
      res.status(200).json(result);
    } catch (error) {
      if (error instanceof ServicePublicBookingError) {
        logWarn("service_public_booking.manage_reschedule_rejected", { requestId: req.requestId, code: error.code });
        res.status(error.code === "BOOKING_NOT_FOUND" ? 404 : error.code === "SLOT_CONFLICT" || error.code === "BOOKING_NOT_RESCHEDULABLE" ? 409 : 400).json({ code: error.code, message: error.message });
        return;
      }
      logError("service_public_booking.manage_reschedule_failed", error, { requestId: req.requestId });
      res.status(500).json({ code: "INTERNAL_SERVER_ERROR", message: "Não foi possível reagendar agora." });
    }
  });
}
