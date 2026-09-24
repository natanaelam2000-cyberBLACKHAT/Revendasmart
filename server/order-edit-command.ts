/**
 * PEDIDOS EDITÁVEIS — Etapa 2A: comando autoritativo de edição dos itens de um pedido.
 *
 * O cliente manda só a intenção: orderId (rota) e, no corpo, expectedUpdatedAt, idempotencyKey e a lista
 * FINAL de itens (contrato da Etapa 1B em client/src/lib/orders.ts). Tudo que tem autoridade é decidido
 * aqui, dentro de UMA transação do Firestore: dono (uid do token — o pedido só é procurado em
 * users/{uid}/orders), status, pagamento/cobrança, versão (CAS por updatedAt), preço de produto novo,
 * snapshot das linhas existentes, total e a gravação junto do registro de idempotência. Mesmo padrão dos
 * comandos de serviço (service-quote-commands.ts, service-availability-commands.ts): erro com `code`
 * estável, registro em users/{uid}/orderEditIdempotency/{key} criado na MESMA transação da mutação e
 * payloadHash para separar retry legítimo de reuso indevido da chave. A coleção nova fica coberta pelo
 * default-deny da raiz das Rules (`match /{document=**}`): só o Admin SDK lê e grava.
 *
 * Não toca estoque: pedido não reserva nem baixa estoque na criação, então a edição também não grava
 * nenhum documento de produto — só lê existência, planAccessState e preço do produto que entra ou cresce.
 */
import { createHash } from "node:crypto";
import type { Express, NextFunction, Request, Response } from "express";
import type { DocumentData, Firestore } from "firebase-admin/firestore";
import { getFirebaseAdmin } from "./firebase-admin-init";
import { logError, logInfo, logWarn } from "./logger";
import { InvalidProductPriceError, resolveEffectiveProductPrice } from "../shared/product-pricing";
import {
  calculateOrderItemSubtotal,
  calculateOrderTotal,
  compareOrderProductQuantities,
  isOrderEditableStatus,
  isOrderPaymentEditable,
  ORDER_EDIT_MAX_ITEMS,
  validateOrderEditItems,
  withOrderItemQuantity,
  type OrderEditItemInput,
  type OrderEditItemsErrorCode,
  type OrderItem,
} from "../client/src/lib/orders";

/** Teto financeiro real de Pedidos: o mesmo `data.total <= 100000000` de isValidOrderCreate (firestore.rules). */
export const ORDER_TOTAL_MAX = 100000000;

const ORDER_EDIT_ACTION = "edit_order_items";
/** Mesmo charset/tamanho de validateEntityId dos comandos de serviço — cobre auto-IDs e os ids do app. */
const ORDER_ID_PATTERN = /^[a-zA-Z0-9_-]{1,120}$/;
/** Mesmo formato de validateIdempotencyKey dos comandos de serviço. */
const IDEMPOTENCY_KEY_PATTERN = /^[a-zA-Z0-9_-]{6,120}$/;
/** Mesmo teto de updatedAt de isValidOrderUpdate (firestore.rules: updatedAt.size() <= 40). */
const ORDER_UPDATED_AT_MAX_LENGTH = 40;
/** Único conteúdo aceito no corpo — ver parseOrderEditRequest. */
const ORDER_EDIT_BODY_FIELDS = new Set(["expectedUpdatedAt", "idempotencyKey", "items"]);

export type OrderEditCommandErrorCode =
  | "UNAUTHENTICATED"
  | "INVALID_PAYLOAD"
  | OrderEditItemsErrorCode
  | "ORDER_NOT_FOUND"
  | "ORDER_NOT_EDITABLE"
  | "ORDER_PAYMENT_STARTED"
  | "STALE_ORDER_VERSION"
  | "ORDER_PRODUCT_NOT_FOUND"
  | "ORDER_PRODUCT_UNAVAILABLE"
  | "ORDER_PRODUCT_NOT_INCREASABLE"
  | "ORDER_AMBIGUOUS_PRODUCT_SNAPSHOT"
  | "ORDER_TOTAL_INVALID"
  | "ORDER_TOTAL_LIMIT_EXCEEDED"
  | "IDEMPOTENCY_CONFLICT";

const ORDER_EDIT_ERROR_MESSAGES: Record<OrderEditCommandErrorCode, string> = {
  UNAUTHENTICATED: "Sessão inválida. Faça login novamente.",
  INVALID_PAYLOAD: "Confira os dados enviados e tente novamente.",
  ORDER_EDIT_INVALID_ITEMS: "Os itens do pedido são inválidos.",
  ORDER_EDIT_EMPTY: "O pedido precisa ter pelo menos um item.",
  ORDER_EDIT_TOO_MANY_ITEMS: `O pedido pode ter no máximo ${ORDER_EDIT_MAX_ITEMS} itens.`,
  ORDER_EDIT_INVALID_ITEM: "Um item do pedido é inválido.",
  ORDER_EDIT_INVALID_QUANTITY: "A quantidade de cada item precisa ser maior que zero.",
  ORDER_EDIT_INVALID_PRODUCT_ID: "Um produto do pedido é inválido.",
  ORDER_EDIT_INVALID_ITEM_NAME: "Informe o nome do item manual.",
  ORDER_EDIT_INVALID_ITEM_PRICE: "O preço de um item manual é inválido.",
  ORDER_NOT_FOUND: "Pedido não encontrado.",
  ORDER_NOT_EDITABLE: "Este pedido não pode mais ser editado.",
  ORDER_PAYMENT_STARTED: "Este pedido já tem pagamento ou cobrança em andamento e não pode ser editado.",
  STALE_ORDER_VERSION: "O pedido foi alterado em outro lugar. Atualize e tente de novo.",
  ORDER_PRODUCT_NOT_FOUND: "Um produto adicionado não existe mais.",
  ORDER_PRODUCT_UNAVAILABLE: "Um produto adicionado não está disponível.",
  ORDER_PRODUCT_NOT_INCREASABLE: "Um produto que não está mais disponível só pode ter a quantidade reduzida ou ser removido.",
  ORDER_AMBIGUOUS_PRODUCT_SNAPSHOT: "Este produto está no pedido com preços diferentes. Para mudar a quantidade, remova o item e adicione de novo.",
  ORDER_TOTAL_INVALID: "O total do pedido ficou inválido.",
  ORDER_TOTAL_LIMIT_EXCEEDED: "O total do pedido passa do limite permitido.",
  IDEMPOTENCY_CONFLICT: "A mesma chave não pode ser reutilizada em outra operação.",
};

const CONFLICT_CODES: ReadonlySet<OrderEditCommandErrorCode> = new Set<OrderEditCommandErrorCode>([
  "ORDER_NOT_EDITABLE",
  "ORDER_PAYMENT_STARTED",
  "STALE_ORDER_VERSION",
  "ORDER_PRODUCT_NOT_FOUND",
  "ORDER_PRODUCT_UNAVAILABLE",
  "ORDER_PRODUCT_NOT_INCREASABLE",
  "ORDER_AMBIGUOUS_PRODUCT_SNAPSHOT",
  "IDEMPOTENCY_CONFLICT",
]);

export interface OrderEditCommandErrorDetails {
  /** Linha do payload (validação da Etapa 1B). */
  index?: number;
  productId?: string;
  /** Campo do corpo rejeitado. */
  field?: string;
}

export class OrderEditCommandError extends Error {
  readonly code: OrderEditCommandErrorCode;
  readonly details: OrderEditCommandErrorDetails;

  constructor(code: OrderEditCommandErrorCode, details: OrderEditCommandErrorDetails = {}) {
    super(ORDER_EDIT_ERROR_MESSAGES[code]);
    this.name = "OrderEditCommandError";
    this.code = code;
    this.details = details;
  }
}

export function statusForOrderEditError(code: OrderEditCommandErrorCode): number {
  if (code === "UNAUTHENTICATED") return 401;
  if (code === "ORDER_NOT_FOUND") return 404;
  if (CONFLICT_CODES.has(code)) return 409;
  return 400;
}

export interface OrderEditCommandInput {
  orderId: string;
  expectedUpdatedAt: string;
  idempotencyKey: string;
  items: OrderEditItemInput[];
}

export interface OrderEditCommandResult {
  orderId: string;
  updatedAt: string;
  total: number;
  itemCount: number;
  idempotentReplay: boolean;
}

interface OrderEditIdempotencyRecord {
  key: string;
  tenantUid: string;
  action: typeof ORDER_EDIT_ACTION;
  orderId: string;
  payloadHash: string;
  createdAt: string;
  updatedAt: string;
  total: number;
  itemCount: number;
}

/** Produto relido na transação; `null` quando o documento não existe (a exclusão de produto é física). */
export type OrderEditProductSnapshot = DocumentData | null;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Lê só o que o comando aceita. Qualquer outro campo no corpo (uid, ownerId, clientId, total,
 * paymentStatus, status, createdAt, chargeId, saleId…) é REJEITADO em vez de ignorado: nada disso tem
 * autoridade aqui, e aceitar em silêncio esconderia um cliente tentando impor valores. Os itens passam
 * pela validação da Etapa 1B, que descarta preço/nome/imagem enviados junto de um productId.
 */
export function parseOrderEditRequest(orderIdParam: unknown, body: unknown): OrderEditCommandInput {
  if (!isPlainObject(body)) throw new OrderEditCommandError("INVALID_PAYLOAD");
  const unexpectedField = Object.keys(body).find((field) => !ORDER_EDIT_BODY_FIELDS.has(field));
  if (unexpectedField !== undefined) throw new OrderEditCommandError("INVALID_PAYLOAD", { field: unexpectedField });

  const orderId = typeof orderIdParam === "string" ? orderIdParam.trim() : "";
  if (!ORDER_ID_PATTERN.test(orderId)) throw new OrderEditCommandError("INVALID_PAYLOAD", { field: "orderId" });

  // Comparado byte a byte com o updatedAt gravado — sem trim nem reformatação.
  const { expectedUpdatedAt } = body;
  if (typeof expectedUpdatedAt !== "string" || !expectedUpdatedAt || expectedUpdatedAt.length > ORDER_UPDATED_AT_MAX_LENGTH) {
    throw new OrderEditCommandError("INVALID_PAYLOAD", { field: "expectedUpdatedAt" });
  }

  const idempotencyKey = typeof body.idempotencyKey === "string" ? body.idempotencyKey.trim() : "";
  if (!IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) throw new OrderEditCommandError("INVALID_PAYLOAD", { field: "idempotencyKey" });

  const validation = validateOrderEditItems(body.items);
  if (!validation.ok) {
    throw new OrderEditCommandError(validation.code, validation.index === undefined ? {} : { index: validation.index });
  }
  return { orderId, expectedUpdatedAt, idempotencyKey, items: validation.items };
}

/** SHA-256 da forma normalizada do comando: mesma intenção → mesmo hash, independente de campos descartados. */
export function hashOrderEditPayload(input: OrderEditCommandInput): string {
  const canonical = JSON.stringify({
    orderId: input.orderId,
    expectedUpdatedAt: input.expectedUpdatedAt,
    items: input.items.map((item) => ("productId" in item
      ? { productId: item.productId, quantity: item.quantity }
      : { name: item.name, quantity: item.quantity, unitPrice: item.unitPrice })),
  });
  return createHash("sha256").update(canonical).digest("hex");
}

/** Produtos que precisam ser relidos: só os que entram (`added`) ou crescem (`increased`). */
export function listOrderEditProductLookups(storedItems: readonly OrderItem[], editItems: readonly OrderEditItemInput[]): string[] {
  return compareOrderProductQuantities(storedItems, editItems)
    .filter((change) => change.kind === "added" || change.kind === "increased")
    .map((change) => change.productId);
}

/** Disponível para entrar ou crescer: existe e não foi preservado por downgrade de plano — a mesma regra
 * autoritativa de finalizeSaleTransaction (PRODUCT_NOT_AVAILABLE) e do catálogo público. */
function isOrderableProduct(product: OrderEditProductSnapshot): product is DocumentData {
  return product !== null && product.planAccessState !== "preserved";
}

function buildAddedProductLine(productId: string, quantity: number, product: OrderEditProductSnapshot): OrderItem {
  if (product === null) throw new OrderEditCommandError("ORDER_PRODUCT_NOT_FOUND", { productId });
  if (!isOrderableProduct(product)) throw new OrderEditCommandError("ORDER_PRODUCT_UNAVAILABLE", { productId });
  const name = typeof product.name === "string" ? product.name.trim() : "";
  if (!name) throw new OrderEditCommandError("ORDER_PRODUCT_UNAVAILABLE", { productId });

  let unitPrice: number;
  try {
    // Preço atual do produto relido aqui dentro — nunca o que o cliente mandou (a validação já o descartou).
    unitPrice = resolveEffectiveProductPrice({
      salePrice: product.salePrice,
      promotionalPrice: product.promotionalPrice,
      discountPercent: product.discountPercent,
    }).effectivePrice;
  } catch (error) {
    if (error instanceof InvalidProductPriceError) throw new OrderEditCommandError("ORDER_PRODUCT_UNAVAILABLE", { productId });
    throw error;
  }
  const imageUrl = typeof product.imageUrl === "string" ? product.imageUrl.trim() : "";
  return { productId, name, quantity, unitPrice, ...(imageUrl ? { imageUrl } : {}) };
}

/**
 * Snapshot único de um produto que muda de quantidade. Linhas históricas do mesmo productId com
 * unitPrice diferentes NÃO são fundidas: mudar a quantidade seria escolher um dos preços em silêncio,
 * então a alteração é rejeitada (a linha pode ser mantida como está ou removida). Com o mesmo preço, as
 * linhas repetidas viram uma só — o total não muda por isso.
 */
function resolveSingleSnapshot(productId: string, storedLines: readonly OrderItem[]): OrderItem {
  const unitPrices = new Set(storedLines.map((line) => calculateOrderItemSubtotal(withOrderItemQuantity(line, 1))));
  if (unitPrices.size !== 1) throw new OrderEditCommandError("ORDER_AMBIGUOUS_PRODUCT_SNAPSHOT", { productId });
  return storedLines[0];
}

function groupStoredLinesByProduct(storedItems: readonly OrderItem[]): Map<string, OrderItem[]> {
  const groups = new Map<string, OrderItem[]>();
  for (const line of storedItems) {
    if (typeof line.productId !== "string" || !line.productId) continue;
    const group = groups.get(line.productId);
    if (group) group.push(line);
    else groups.set(line.productId, [line]);
  }
  return groups;
}

/**
 * Monta as linhas finais, na ordem do payload (produto repetido no payload entra na primeira ocorrência):
 * - item manual: exatamente o que o lojista mandou (nome, quantidade e preço estimado são dele);
 * - produto `unchanged`: linhas gravadas intactas, inclusive linhas repetidas com preços diferentes;
 * - produto `decreased`: snapshot gravado com a nova quantidade — vale até para produto excluído ou
 *   preservado, porque não pede nada do catálogo;
 * - produto `increased`: snapshot gravado (nunca repreçado), só se o produto ainda estiver disponível;
 * - produto `added`: linha nova com nome, imagem e preço atuais do produto relido;
 * - produto `removed` (fora do payload): some.
 */
export function composeOrderEditItems(
  storedItems: readonly OrderItem[],
  editItems: readonly OrderEditItemInput[],
  products: ReadonlyMap<string, OrderEditProductSnapshot>,
): OrderItem[] {
  const changes = new Map(compareOrderProductQuantities(storedItems, editItems).map((change) => [change.productId, change]));
  const storedLinesByProduct = groupStoredLinesByProduct(storedItems);
  const emittedProducts = new Set<string>();
  const items: OrderItem[] = [];

  for (const line of editItems) {
    if (!("productId" in line)) {
      items.push({ name: line.name, quantity: line.quantity, unitPrice: line.unitPrice });
      continue;
    }
    const { productId } = line;
    if (emittedProducts.has(productId)) continue;
    emittedProducts.add(productId);

    const change = changes.get(productId);
    if (!change) throw new Error(`order-edit: produto ${productId} sem comparação de quantidade`);
    const storedLines = storedLinesByProduct.get(productId) ?? [];
    if ((change.kind === "added" || change.kind === "increased") && !products.has(productId)) {
      throw new Error(`order-edit: produto ${productId} não foi relido na transação`);
    }

    if (change.kind === "unchanged") {
      items.push(...storedLines);
    } else if (change.kind === "added") {
      items.push(buildAddedProductLine(productId, change.nextQuantity, products.get(productId) ?? null));
    } else if (change.kind === "increased") {
      if (!isOrderableProduct(products.get(productId) ?? null)) {
        throw new OrderEditCommandError("ORDER_PRODUCT_NOT_INCREASABLE", { productId });
      }
      items.push(withOrderItemQuantity(resolveSingleSnapshot(productId, storedLines), change.nextQuantity));
    } else if (change.kind === "decreased") {
      items.push(withOrderItemQuantity(resolveSingleSnapshot(productId, storedLines), change.nextQuantity));
    }
  }

  if (items.length === 0) throw new OrderEditCommandError("ORDER_EDIT_EMPTY");
  if (items.length > ORDER_EDIT_MAX_ITEMS) throw new OrderEditCommandError("ORDER_EDIT_TOO_MANY_ITEMS");
  return items;
}

/** Total oficial (calculateOrderTotal) das linhas finais, finito e dentro do teto real de Pedidos. */
export function resolveOrderEditTotal(items: readonly OrderItem[]): number {
  const total = calculateOrderTotal(items);
  if (!Number.isFinite(total)) throw new OrderEditCommandError("ORDER_TOTAL_INVALID");
  if (total > ORDER_TOTAL_MAX) throw new OrderEditCommandError("ORDER_TOTAL_LIMIT_EXCEEDED");
  return total;
}

/** Itens como vieram do Firestore (os helpers de domínio já leem cada campo de forma defensiva); entrada
 * que nem é objeto não é item — não tem como ser preservada nem comparada — e fica de fora. */
function readStoredOrderItems(value: unknown): OrderItem[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is OrderItem => isPlainObject(entry));
}

/** O novo updatedAt precisa ser diferente do anterior para o próximo CAS enxergar a mudança. */
function nextOrderUpdatedAt(now: Date, previous: unknown): string {
  const candidate = now.toISOString();
  return candidate === previous ? new Date(now.getTime() + 1).toISOString() : candidate;
}

function replayOrderEdit(existing: DocumentData | undefined, uid: string, orderId: string, payloadHash: string): OrderEditCommandResult {
  if (
    !existing
    || existing.action !== ORDER_EDIT_ACTION
    || existing.tenantUid !== uid
    || existing.orderId !== orderId
    || existing.payloadHash !== payloadHash
    || typeof existing.updatedAt !== "string"
    || typeof existing.total !== "number"
    || typeof existing.itemCount !== "number"
  ) {
    throw new OrderEditCommandError("IDEMPOTENCY_CONFLICT");
  }
  return { orderId, updatedAt: existing.updatedAt, total: existing.total, itemCount: existing.itemCount, idempotentReplay: true };
}

/**
 * Tudo numa transação só — nenhuma decisão fica numa leitura feita fora dela:
 * 1. idempotência primeiro: a mesma chave com o mesmo payload devolve o resultado gravado (mesmo que o
 *    pedido já tenha mudado depois); com payload, pedido ou ação diferentes → IDEMPOTENCY_CONFLICT;
 * 2. pedido em users/{uid}/orders — pedido de outro tenant simplesmente não existe neste caminho;
 * 3. status editável, pagamento não iniciado, sem reserva de cobrança (orderChargeIdempotency) e sem
 *    cobrança já gravada para o pedido em charges (cobre a cobrança cuja reserva foi apagada);
 * 4. CAS: updatedAt gravado === expectedUpdatedAt, senão STALE_ORDER_VERSION (nunca last-write-wins);
 * 5. produtos que entram ou crescem relidos, linhas finais montadas, total oficial validado;
 * 6. update só de items/total/updatedAt + criação do registro de idempotência, no mesmo commit.
 */
/** Ponto de pausa usado SÓ pelos testes de corrida edição × cobrança — nunca passado em produção. */
export interface OrderEditCommandHooks {
  /** Dentro da transação, depois de ler pedido, reserva de cobrança e cobranças; recebe o número da tentativa. */
  afterReads?: (attempt: number) => Promise<void>;
}

export async function editOrderItemsCommand(
  db: Firestore,
  uid: string,
  input: OrderEditCommandInput,
  now: () => Date = () => new Date(),
  hooks: OrderEditCommandHooks = {},
): Promise<OrderEditCommandResult> {
  if (typeof uid !== "string" || !uid) throw new OrderEditCommandError("UNAUTHENTICATED");
  const payloadHash = hashOrderEditPayload(input);
  const tenantRef = db.collection("users").doc(uid);
  const orderRef = tenantRef.collection("orders").doc(input.orderId);
  const idempotencyRef = tenantRef.collection("orderEditIdempotency").doc(input.idempotencyKey);
  const chargeReservationRef = tenantRef.collection("orderChargeIdempotency").doc(input.orderId);
  const orderChargesQuery = tenantRef.collection("charges").where("orderId", "==", input.orderId).limit(1);
  let attempt = 0;

  return await db.runTransaction(async (tx) => {
    attempt += 1;
    const idempotencySnapshot = await tx.get(idempotencyRef);
    if (idempotencySnapshot.exists) {
      return replayOrderEdit(idempotencySnapshot.data(), uid, input.orderId, payloadHash);
    }

    const [orderSnapshot, chargeReservationSnapshot] = await tx.getAll(orderRef, chargeReservationRef);
    const orderChargesSnapshot = await tx.get(orderChargesQuery);
    await hooks.afterReads?.(attempt);
    if (!orderSnapshot.exists) throw new OrderEditCommandError("ORDER_NOT_FOUND");
    const order = orderSnapshot.data() ?? {};

    if (!isOrderEditableStatus(order.status)) throw new OrderEditCommandError("ORDER_NOT_EDITABLE");
    if (!isOrderPaymentEditable(order.paymentStatus) || chargeReservationSnapshot.exists || !orderChargesSnapshot.empty) {
      throw new OrderEditCommandError("ORDER_PAYMENT_STARTED");
    }
    if (order.updatedAt !== input.expectedUpdatedAt) throw new OrderEditCommandError("STALE_ORDER_VERSION");

    const storedItems = readStoredOrderItems(order.items);
    const lookupIds = listOrderEditProductLookups(storedItems, input.items);
    const productSnapshots = lookupIds.length > 0
      ? await tx.getAll(...lookupIds.map((productId) => tenantRef.collection("products").doc(productId)))
      : [];
    const products = new Map<string, OrderEditProductSnapshot>(
      lookupIds.map((productId, index) => [productId, productSnapshots[index].exists ? productSnapshots[index].data() ?? {} : null]),
    );

    const items = composeOrderEditItems(storedItems, input.items, products);
    const total = resolveOrderEditTotal(items);
    const updatedAt = nextOrderUpdatedAt(now(), order.updatedAt);
    const result: OrderEditCommandResult = { orderId: input.orderId, updatedAt, total, itemCount: items.length, idempotentReplay: false };

    tx.update(orderRef, { items, total, updatedAt });
    tx.create(idempotencyRef, {
      key: input.idempotencyKey,
      tenantUid: uid,
      action: ORDER_EDIT_ACTION,
      orderId: input.orderId,
      payloadHash,
      createdAt: updatedAt,
      updatedAt,
      total,
      itemCount: items.length,
    } satisfies OrderEditIdempotencyRecord);
    return result;
  });
}

function sendOrderEditError(res: Response, error: OrderEditCommandError): void {
  res.status(statusForOrderEditError(error.code)).json({ code: error.code, message: error.message, ...error.details });
}

/** O uid vem SÓ do requireAuth (token verificado); o corpo nunca informa dono, cliente nem valores. */
export async function handleOrderEditRequest(req: Request, res: Response, db?: Firestore): Promise<void> {
  const uid = (req as Request & { firebaseUid?: unknown }).firebaseUid;
  if (typeof uid !== "string" || !uid) {
    sendOrderEditError(res, new OrderEditCommandError("UNAUTHENTICATED"));
    return;
  }

  let orderId: string | undefined;
  try {
    const input = parseOrderEditRequest(req.params.orderId, req.body);
    orderId = input.orderId;
    const result = await editOrderItemsCommand(db ?? getFirebaseAdmin().firestore(), uid, input);
    logInfo("order_edit.applied", { requestId: req.requestId, orderId, itemCount: result.itemCount, idempotent: result.idempotentReplay });
    res.status(200).json(result);
  } catch (error) {
    if (error instanceof OrderEditCommandError) {
      logWarn("order_edit.rejected", { requestId: req.requestId, orderId, code: error.code });
      sendOrderEditError(res, error);
      return;
    }
    logError("order_edit.failed", error, { requestId: req.requestId, orderId });
    res.status(500).json({ code: "INTERNAL_SERVER_ERROR", message: "Não foi possível editar o pedido agora." });
  }
}

export function registerOrderEditRoutes(
  app: Express,
  requireAuth: (req: Request, res: Response, next: NextFunction) => void,
): void {
  app.post("/api/orders/:orderId/edit", requireAuth, async (req: Request, res: Response) => {
    await handleOrderEditRequest(req, res);
  });
}
