/**
 * RELEASE-CHECKOUT-03 §11-F — reserva atômica de UMA cobrança Mercado Pago por pedido, mesmo padrão
 * de `public-catalog-order-idempotency.ts` (Firestore transaction: só uma requisição concorrente
 * consegue reservar). Chave é o `orderId` (não o clientOrderId) — o pedido já existe e é único; o que
 * precisa de proteção agora é "nunca duas cobranças para o mesmo pedido".
 *
 * PEDIDOS EDITÁVEIS Etapa 2B — a reserva também é o ponto de serialização com a edição de itens
 * (order-edit-command.ts). A MESMA transação que cria a reserva lê o pedido e congela nela o valor
 * (`amount`) e a versão (`orderUpdatedAt`) lidos ali; o provedor só recebe esse valor congelado. A edição
 * lê a reserva e a cobrança lê o pedido, então cada uma trava o que a outra precisa gravar: se a edição
 * commita primeiro, a reserva é refeita e congela o total novo; se a reserva commita primeiro, a edição é
 * refeita, encontra a reserva e para em ORDER_PAYMENT_STARTED. Não existe estado em que as duas vençam —
 * nem cobrança com o total T1 enquanto o pedido termina com T2.
 *
 * PEDIDOS EDITÁVEIS Etapa 2C — a reserva é também o registro recuperável da chamada ao provedor. O Mercado
 * Pago NÃO documenta idempotência em POST /checkout/preferences (só em /v1/payments), então a segurança
 * não pode depender dele deduplicar. Estados:
 *   pending          — reservada; o provedor comprovadamente ainda NÃO foi chamado (pode ser assumida);
 *   provider_started — marcada por transação imediatamente antes do POST: daqui em diante o provedor pode ter
 *                      criado a preferência, então a reserva nunca é apagada por resultado ambíguo;
 *   ready            — cobrança gravada em charges/{chargeId} e devolvida ao cliente.
 * Uma intenção chama o provedor NO MÁXIMO uma vez. Retry com cobrança local só finaliza; sem ela, só a
 * reconciliação (busca por external_reference, que nunca cria nada) pode adotar a preferência. Sem prova, a
 * resposta é ORDER_CHARGE_RECONCILIATION_REQUIRED e a reserva fica — e com ela a edição do pedido segue
 * bloqueada, porque o total não pode mudar enquanto existe cobrança real ou incerta.
 */
import type { Firestore } from "firebase-admin/firestore";
import type { Order } from "../client/src/lib/orders";
import type { Charge } from "../shared/charges";
import { logWarn } from "./logger";
import type {
  CreateOrderMercadoPagoChargeParams,
  CreateOrderMercadoPagoChargeResult,
  FindOrderMercadoPagoChargeParams,
} from "./payments";

export type OrderChargeReservationErrorCode = "ORDER_NOT_FOUND" | "ORDER_ALREADY_PAID" | "ORDER_NOT_PAYABLE";

/** Pedido inexistente ou em estado que não aceita cobrança — decidido DENTRO da transação da reserva. */
export class OrderChargeReservationError extends Error {
  readonly code: OrderChargeReservationErrorCode;

  constructor(code: OrderChargeReservationErrorCode) {
    super(code);
    this.name = "OrderChargeReservationError";
    this.code = code;
  }
}

/** Outra tentativa já assumiu (ou encerrou) esta reserva: quem perde nunca chama o provedor. */
export class OrderChargeClaimLostError extends Error {
  constructor() {
    super("ORDER_CHARGE_CLAIM_LOST");
    this.name = "OrderChargeClaimLostError";
  }
}

export type OrderChargeReservationStatus = "pending" | "provider_started" | "ready";

export type OrderChargeReservation =
  | {
    alreadyExisted: true;
    status: OrderChargeReservationStatus;
    chargeId: string;
    /** Valor congelado quando a reserva nasceu (ausente em reservas criadas antes da Etapa 2B). */
    amount?: number;
    orderUpdatedAt?: string | null;
    /** Etapa 2C — ausente em reservas anteriores, que não provam que o provedor ainda não foi chamado. */
    providerIdempotencyKey?: string;
    providerStartedAt?: string;
    providerOutcome?: "unknown";
    createdAt?: string;
    /** O pedido lido nessa mesma transação (só para o título da cobrança). */
    order: Order;
  }
  | {
    alreadyExisted: false;
    status: "pending";
    chargeId: string;
    /** order.total lido NA transação que criou a reserva — o único valor que pode ir para o provedor. */
    amount: number;
    /** order.updatedAt dessa mesma leitura: a versão do pedido que a cobrança representa. */
    orderUpdatedAt: string | null;
    /** Chave externa estável da intenção (o próprio chargeId): a mesma em qualquer retry desta reserva. */
    providerIdempotencyKey: string;
    /** O pedido lido nessa mesma transação (só para o título da cobrança). */
    order: Order;
  };

/** Pontos de pausa usados SÓ pelos testes de corrida para forçar interleavings — nunca passados em produção. */
export interface OrderChargeReservationHooks {
  /** Dentro da transação, depois de ler reserva e pedido e antes de decidir/gravar; recebe o número da tentativa. */
  afterReads?: (attempt: number) => Promise<void>;
}

function reservationRef(db: Firestore, uid: string, orderId: string) {
  return db.collection("users").doc(uid).collection("orderChargeIdempotency").doc(orderId);
}

/** Status desconhecido nunca é tratado como "provedor não chamado". */
function readReservationStatus(value: unknown): OrderChargeReservationStatus {
  if (value === "ready" || value === "pending") return value;
  return "provider_started";
}

export async function reserveOrderCharge(
  db: Firestore,
  uid: string,
  orderId: string,
  hooks: OrderChargeReservationHooks = {},
): Promise<OrderChargeReservation> {
  const idempotencyRef = reservationRef(db, uid, orderId);
  const orderRef = db.collection("users").doc(uid).collection("orders").doc(orderId);
  const chargeRef = db.collection("users").doc(uid).collection("charges").doc();
  const nowIso = new Date().toISOString();
  let attempt = 0;

  return db.runTransaction(async (tx): Promise<OrderChargeReservation> => {
    attempt += 1;
    const [snap, orderSnap] = await tx.getAll(idempotencyRef, orderRef);
    await hooks.afterReads?.(attempt);
    // Mesma precedência de quando a rota lia o pedido antes da reserva: estado do pedido primeiro.
    if (!orderSnap.exists) throw new OrderChargeReservationError("ORDER_NOT_FOUND");
    const order = orderSnap.data() as Order;
    if (order.paymentStatus === "paid") throw new OrderChargeReservationError("ORDER_ALREADY_PAID");
    if (order.paymentStatus === "cancelled" || order.paymentStatus === "failed") throw new OrderChargeReservationError("ORDER_NOT_PAYABLE");
    if (snap.exists) {
      const data = snap.data() ?? {};
      return {
        alreadyExisted: true,
        status: readReservationStatus(data.status),
        chargeId: String(data.chargeId),
        ...(typeof data.amount === "number" ? { amount: data.amount } : {}),
        ...(typeof data.orderUpdatedAt === "string" ? { orderUpdatedAt: data.orderUpdatedAt } : {}),
        ...(typeof data.providerIdempotencyKey === "string" ? { providerIdempotencyKey: data.providerIdempotencyKey } : {}),
        ...(typeof data.providerStartedAt === "string" ? { providerStartedAt: data.providerStartedAt } : {}),
        ...(data.providerOutcome === "unknown" ? { providerOutcome: "unknown" as const } : {}),
        ...(typeof data.createdAt === "string" ? { createdAt: data.createdAt } : {}),
        order,
      };
    }
    // Sem total numérico finito não há valor que possa ser congelado nem cobrado.
    if (typeof order.total !== "number" || !Number.isFinite(order.total)) throw new OrderChargeReservationError("ORDER_NOT_PAYABLE");
    const amount = order.total;
    const orderUpdatedAt = typeof order.updatedAt === "string" ? order.updatedAt : null;
    const providerIdempotencyKey = chargeRef.id;
    tx.create(idempotencyRef, { status: "pending", orderId, chargeId: chargeRef.id, createdAt: nowIso, amount, orderUpdatedAt, providerIdempotencyKey });
    return { alreadyExisted: false, status: "pending", chargeId: chargeRef.id, amount, orderUpdatedAt, providerIdempotencyKey, order };
  });
}

/**
 * pending → provider_started, só para a MESMA reserva (chargeId) e só a partir de pending de 2C: no máximo UMA
 * tentativa chama o provedor por intenção. Quem perde a disputa recebe OrderChargeClaimLostError.
 */
export async function claimOrderChargeProviderCall(db: Firestore, uid: string, orderId: string, chargeId: string): Promise<void> {
  const ref = reservationRef(db, uid, orderId);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.data();
    if (!snap.exists || data?.chargeId !== chargeId || data?.status !== "pending" || typeof data?.providerIdempotencyKey !== "string") {
      throw new OrderChargeClaimLostError();
    }
    tx.update(ref, { status: "provider_started", providerStartedAt: new Date().toISOString() });
  });
}

export type OrderChargeReleaseReason = "before_provider" | "provider_rejected";

/**
 * Apaga a reserva SÓ quando o provedor comprovadamente não criou nada: antes da chamada (ainda `pending`) ou
 * depois de uma recusa definitiva dele (`provider_started` + recusa explícita). Nunca depois de resultado
 * ambíguo, e nunca a reserva de outra intenção (chargeId diferente). Devolve se apagou.
 */
export async function releaseOrderChargeReservation(
  db: Firestore,
  uid: string,
  orderId: string,
  chargeId: string,
  reason: OrderChargeReleaseReason,
): Promise<boolean> {
  const ref = reservationRef(db, uid, orderId);
  const expectedStatus = reason === "before_provider" ? "pending" : "provider_started";
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.data();
    if (!snap.exists || data?.chargeId !== chargeId || data?.status !== expectedStatus) return false;
    tx.delete(ref);
    return true;
  });
}

/** Resultado da chamada ficou incerto: registra para o retry ir direto à reconciliação. Nunca apaga nada. */
export async function markOrderChargeProviderOutcomeUnknown(db: Firestore, uid: string, orderId: string, chargeId: string): Promise<void> {
  const ref = reservationRef(db, uid, orderId);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.data();
    if (!snap.exists || data?.chargeId !== chargeId || data?.status !== "provider_started") return;
    tx.update(ref, { providerOutcome: "unknown", providerOutcomeAt: new Date().toISOString() });
  });
}

/** Marca `ready` só a reserva desta mesma intenção (nunca sobrescreve a de outro chargeId). */
export async function finalizeOrderChargeReservation(db: Firestore, uid: string, orderId: string, chargeId: string): Promise<boolean> {
  const ref = reservationRef(db, uid, orderId);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists || snap.data()?.chargeId !== chargeId) return false;
    tx.update(ref, { status: "ready", updatedAt: new Date().toISOString() });
    return true;
  });
}

export type OrderChargeProviderResult = Pick<CreateOrderMercadoPagoChargeResult, "chargeId" | "paymentUrl" | "preferenceId">;
export type CreateOrderChargeFn = (params: CreateOrderMercadoPagoChargeParams) => Promise<OrderChargeProviderResult>;
export type FindOrderChargeFn = (params: FindOrderMercadoPagoChargeParams) => Promise<OrderChargeProviderResult | null>;

export interface OrderChargeProvider {
  /** Cria a cobrança. DEVE aguardar `params.markProviderCallStarted()` imediatamente antes de chamar o provedor. */
  createCharge: CreateOrderChargeFn;
  /** Reconciliação: procura no provedor a cobrança desta MESMA intenção e a grava localmente — nunca cria. */
  findCharge?: FindOrderChargeFn;
}

export interface StartOrderChargeInput {
  uid: string;
  orderId: string;
  storeName: string;
  storeSlug: string;
}

/** De onde veio a cobrança devolvida num retry. */
export type OrderChargeReuseSource = "ready" | "local_charge" | "provider_lookup";

export type StartOrderChargeResult =
  | { outcome: "created"; chargeId: string; paymentUrl: string; preferenceId: string }
  | { outcome: "reused"; chargeId: string; paymentUrl: string; preferenceId: string; via: OrderChargeReuseSource }
  | { outcome: "in_progress" }
  | { outcome: "inconsistent" }
  | { outcome: "reconciliation_required" };

/** Pontos de pausa usados SÓ pelos testes de corrida/recuperação — nunca passados em produção. */
export interface StartOrderChargeHooks {
  /** Antes da transação de reserva — onde o protocolo antigo já tinha lido o total fora de transação. */
  beforeReservation?: () => Promise<void>;
  /** Repassado a reserveOrderCharge (dentro da transação, depois das leituras). */
  afterReservationReads?: (attempt: number) => Promise<void>;
  /** Depois do commit da reserva e antes de chamar o provedor. */
  afterReservation?: () => Promise<void>;
  /** Depois do sucesso do provedor (cobrança já gravada) e antes de finalizar a reserva. */
  beforeFinalize?: () => Promise<void>;
}

/**
 * Janela em que uma reserva `provider_started` sem resultado ainda pode estar com a chamada em andamento: o POST
 * tem uma tentativa só com timeout de 10 s (payments.ts); 60 s cobre isso com folga. Depois dela a tentativa é
 * tratada como abandonada — só reconciliação, nunca uma nova chamada. Tempo NUNCA apaga reserva.
 */
export const ORDER_CHARGE_PROVIDER_CALL_WINDOW_MS = 60_000;

interface OrderChargeIntent {
  chargeId: string;
  amount: number;
  providerIdempotencyKey: string;
  order: Order;
}

function orderChargeTitle(order: Order, storeName: string): string {
  const itemsSummary = order.items.length === 1 ? order.items[0].name : `${order.items.length} itens`;
  return `Pedido ${itemsSummary} - ${storeName}`.slice(0, 250);
}

/** Fase declarada pelo provedor na falha (MercadoPagoOrderChargeError.providerCall); sem declaração = ambígua. */
function providerFailurePhase(error: unknown): "not_started" | "rejected" | "ambiguous" {
  const phase = typeof error === "object" && error !== null ? (error as { providerCall?: unknown }).providerCall : undefined;
  return phase === "not_started" || phase === "rejected" ? phase : "ambiguous";
}

function reusedFrom(charge: Charge, via: OrderChargeReuseSource): StartOrderChargeResult {
  return { outcome: "reused", chargeId: charge.id, paymentUrl: charge.paymentUrl, preferenceId: charge.preferenceId ?? "", via };
}

/** A cobrança local só prova esta intenção se for do mesmo pedido, com o valor congelado na reserva e com URL. */
function isCoherentLocalCharge(charge: Charge, orderId: string, amount: number | undefined): boolean {
  return charge.orderId === orderId
    && (amount === undefined || charge.amount === amount)
    && typeof charge.paymentUrl === "string" && charge.paymentUrl.length > 0;
}

/**
 * Início da cobrança de cartão de um pedido do catálogo: reserva transacional (2B) → marca provider_started →
 * provedor → finaliza. O valor enviado ao provedor é SEMPRE o `amount` congelado na reserva. Reserva existente
 * nunca leva a uma segunda chamada da mesma intenção: `ready` devolve a cobrança; cobrança local existente e coerente
 * é finalizada (incoerente fica fechada); `pending` de 2C (provedor comprovadamente não chamado) pode ser assumida; o
 * resto só reconcilia.
 */
export async function startOrderMercadoPagoCharge(
  db: Firestore,
  input: StartOrderChargeInput,
  provider: OrderChargeProvider,
  hooks: StartOrderChargeHooks = {},
): Promise<StartOrderChargeResult> {
  const { uid, orderId } = input;
  await hooks.beforeReservation?.();
  const reservation = await reserveOrderCharge(db, uid, orderId, { afterReads: hooks.afterReservationReads });
  if (reservation.alreadyExisted) {
    const recovered = await recoverExistingOrderCharge(db, input, provider, reservation);
    if (recovered) return recovered;
  }
  if (typeof reservation.amount !== "number" || typeof reservation.providerIdempotencyKey !== "string") {
    return { outcome: "reconciliation_required" };
  }

  await hooks.afterReservation?.();
  const intent: OrderChargeIntent = {
    chargeId: reservation.chargeId,
    amount: reservation.amount,
    providerIdempotencyKey: reservation.providerIdempotencyKey,
    order: reservation.order,
  };
  return await callOrderChargeProvider(db, input, provider, intent, hooks);
}

/** Reserva que já existia: devolve o desfecho, ou `null` quando é um `pending` de 2C que esta tentativa pode assumir. */
async function recoverExistingOrderCharge(
  db: Firestore,
  input: StartOrderChargeInput,
  provider: OrderChargeProvider,
  existing: Extract<OrderChargeReservation, { alreadyExisted: true }>,
): Promise<StartOrderChargeResult | null> {
  const { uid, orderId } = input;
  const localSnap = await db.collection("users").doc(uid).collection("charges").doc(existing.chargeId).get();
  const localCharge = localSnap.exists ? (localSnap.data() as Charge) : undefined;
  if (localCharge && !isCoherentLocalCharge(localCharge, orderId, existing.amount)) {
    // Há algo em charges/{chargeId} que não bate com esta intenção: nunca devolver, finalizar nem chamar o provedor.
    logWarn("order_charge.local_charge_incoherent", { orderId, chargeId: existing.chargeId });
    return { outcome: "inconsistent" };
  }
  if (existing.status === "ready") {
    return localCharge ? reusedFrom(localCharge, "ready") : { outcome: "inconsistent" };
  }
  if (localCharge) {
    // O provedor respondeu e a cobrança foi gravada; faltou só finalizar (falha ou queda depois do sucesso).
    await finalizeOrderChargeReservation(db, uid, orderId, existing.chargeId);
    return reusedFrom(localCharge, "local_charge");
  }
  if (existing.status === "pending" && typeof existing.providerIdempotencyKey === "string" && typeof existing.amount === "number") {
    return null;
  }

  // provider_started sem cobrança local (ou reserva anterior à 2C, sem prova de que o provedor não foi chamado):
  // nunca chamar de novo. Dentro da janela, a chamada pode estar em andamento.
  const startedAt = Date.parse(existing.providerStartedAt ?? existing.createdAt ?? "");
  const maybeInFlight = existing.providerOutcome !== "unknown" && Number.isFinite(startedAt) && Date.now() - startedAt < ORDER_CHARGE_PROVIDER_CALL_WINDOW_MS;
  if (maybeInFlight) return { outcome: "in_progress" };
  if (provider.findCharge && typeof existing.amount === "number") {
    try {
      const found = await provider.findCharge({
        uid,
        chargeId: existing.chargeId,
        orderId,
        amount: existing.amount,
        title: orderChargeTitle(existing.order, input.storeName),
      });
      if (found) {
        await finalizeOrderChargeReservation(db, uid, orderId, existing.chargeId);
        return { outcome: "reused", chargeId: found.chargeId, paymentUrl: found.paymentUrl, preferenceId: found.preferenceId, via: "provider_lookup" };
      }
    } catch (error) {
      logWarn("order_charge.reconciliation_lookup_failed", { orderId, chargeId: existing.chargeId, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { outcome: "reconciliation_required" };
}

async function callOrderChargeProvider(
  db: Firestore,
  input: StartOrderChargeInput,
  provider: OrderChargeProvider,
  intent: OrderChargeIntent,
  hooks: StartOrderChargeHooks,
): Promise<StartOrderChargeResult> {
  const { uid, orderId } = input;
  let providerCallStarted = false;
  let result: OrderChargeProviderResult;
  try {
    result = await provider.createCharge({
      uid,
      chargeId: intent.chargeId,
      orderId,
      amount: intent.amount,
      title: orderChargeTitle(intent.order, input.storeName),
      storeSlug: input.storeSlug,
      idempotencyKey: intent.providerIdempotencyKey,
      markProviderCallStarted: async () => {
        await claimOrderChargeProviderCall(db, uid, orderId, intent.chargeId);
        providerCallStarted = true;
      },
    });
  } catch (error) {
    if (error instanceof OrderChargeClaimLostError) return { outcome: "in_progress" };
    const phase = !providerCallStarted ? "not_started" : providerFailurePhase(error) === "rejected" ? "rejected" : "ambiguous";
    if (phase === "ambiguous") {
      // O provedor pode ter criado a preferência: a reserva fica (e a edição do pedido segue bloqueada).
      await markOrderChargeProviderOutcomeUnknown(db, uid, orderId, intent.chargeId).catch(() => {});
      logWarn("order_charge.provider_outcome_unknown", { orderId, chargeId: intent.chargeId, error: error instanceof Error ? error.message : String(error) });
      return { outcome: "reconciliation_required" };
    }
    // §9: nada foi criado no provedor (antes da chamada, ou recusa definitiva dele): libera a reserva, e o
    // cliente pode tentar de novo ou escolher Pix/WhatsApp.
    await releaseOrderChargeReservation(db, uid, orderId, intent.chargeId, phase === "not_started" ? "before_provider" : "provider_rejected").catch(() => false);
    throw error;
  }

  try {
    await hooks.beforeFinalize?.();
    await finalizeOrderChargeReservation(db, uid, orderId, intent.chargeId);
  } catch (error) {
    // A cobrança já existe no provedor e em charges/{chargeId}: nada é liberado. O próximo retry só finaliza a
    // reserva a partir da cobrança local — nunca chama o provedor de novo.
    logWarn("order_charge.finalize_failed", { orderId, chargeId: intent.chargeId, error: error instanceof Error ? error.message : String(error) });
  }
  return { outcome: "created", chargeId: result.chargeId, paymentUrl: result.paymentUrl, preferenceId: result.preferenceId };
}
