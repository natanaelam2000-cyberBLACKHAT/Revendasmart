/**
 * Contrato central de Pedidos/Encomendas — status, rótulos e o modelo de dados. Centralizado aqui
 * para não espalhar strings de status/rótulo por vários componentes (ver ORDERS_FEATURE_LABEL) e para
 * deixar pronta uma futura configuração do nome da categoria pelo lojista sem reescrever a UI.
 */

export const ORDER_STATUS_IDS = ["new", "in_progress", "ready", "delivered", "cancelled"] as const;

export type OrderStatus = typeof ORDER_STATUS_IDS[number];

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  new: "Novo",
  in_progress: "Em andamento",
  ready: "Pronto",
  delivered: "Entregue",
  cancelled: "Cancelado",
};

export function resolveOrderStatus(value: unknown): OrderStatus {
  return (ORDER_STATUS_IDS as readonly string[]).includes(value as string) ? (value as OrderStatus) : "new";
}

/**
 * Forma de pagamento escolhida pelo cliente no fechamento do catálogo público. Só existe em pedidos
 * originados do checkout do catálogo — pedidos manuais (Encomendas criadas pelo lojista) não têm
 * pagamento embutido e simplesmente não gravam este campo.
 */
export const ORDER_PAYMENT_METHOD_IDS = ["pix", "card", "whatsapp"] as const;
export type OrderPaymentMethod = typeof ORDER_PAYMENT_METHOD_IDS[number];

export const ORDER_PAYMENT_METHOD_LABELS: Record<OrderPaymentMethod, string> = {
  pix: "Pix",
  card: "Cartão",
  whatsapp: "Combinar pelo WhatsApp",
};

export const ORDER_PAYMENT_PROVIDER_IDS = ["manual_pix", "mercadopago", "manual_whatsapp"] as const;
export type OrderPaymentProvider = typeof ORDER_PAYMENT_PROVIDER_IDS[number];

/**
 * `not_started`: WhatsApp — não há cobrança a rastrear. `awaiting_customer_payment`: Pix/cartão
 * aguardando o cliente. `customer_reported_paid`: cliente clicou "Já paguei" — é uma ALEGAÇÃO, nunca
 * confirmação real (só o lojista, ou um webhook real do Mercado Pago, transiciona para `paid`).
 */
export const ORDER_PAYMENT_STATUS_IDS = [
  "not_started",
  "awaiting_customer_payment",
  "customer_reported_paid",
  "paid",
  "failed",
  "cancelled",
] as const;
export type OrderPaymentStatus = typeof ORDER_PAYMENT_STATUS_IDS[number];

export const ORDER_PAYMENT_STATUS_LABELS: Record<OrderPaymentStatus, string> = {
  not_started: "Sem cobrança",
  awaiting_customer_payment: "Aguardando pagamento",
  customer_reported_paid: "Cliente informou pagamento",
  paid: "Pago",
  failed: "Falhou",
  cancelled: "Cancelado",
};

export function resolveOrderPaymentStatus(value: unknown): OrderPaymentStatus | undefined {
  return (ORDER_PAYMENT_STATUS_IDS as readonly string[]).includes(value as string) ? (value as OrderPaymentStatus) : undefined;
}

export function resolveOrderPaymentMethod(value: unknown): OrderPaymentMethod | undefined {
  return (ORDER_PAYMENT_METHOD_IDS as readonly string[]).includes(value as string) ? (value as OrderPaymentMethod) : undefined;
}

/** Rótulo padrão da funcionalidade, usado sempre que o lojista não escolheu um nome próprio. */
export const ORDERS_FEATURE_LABEL = "Encomendas/Pedidos";

/** Limite de caracteres do nome customizado — cabe no item da Conta e no título sem quebrar o layout. */
export const ORDERS_FEATURE_LABEL_MAX_LENGTH = 40;

/**
 * Resolve o nome exibido da área de pedidos a partir das configurações da loja. Ponto único: nenhuma
 * página deve reimplementar o fallback. Um valor só de espaços (ou ausente, ou de tipo errado, como em
 * documentos antigos do Firestore) volta ao rótulo padrão em vez de exibir um título vazio.
 */
export function resolveOrdersFeatureLabel(settings?: { featureLabels?: { orders?: string } } | null): string {
  const custom = settings?.featureLabels?.orders;
  if (typeof custom !== "string") return ORDERS_FEATURE_LABEL;
  const trimmed = custom.trim();
  return trimmed ? trimmed.slice(0, ORDERS_FEATURE_LABEL_MAX_LENGTH) : ORDERS_FEATURE_LABEL;
}

export interface OrderItem {
  /** Só existe quando o item aponta para um produto real do catálogo. */
  productId?: string;
  name: string;
  quantity: number;
  /** Preço unitário no momento do pedido (real, do catálogo, ou estimado para item manual). */
  unitPrice: number;
  imageUrl?: string;
}

export interface Order {
  id: string;
  clientId: string;
  /** Snapshot mínimo do nome do cliente no momento do pedido, mesmo padrão já usado em Sale.clientName. */
  clientName: string;
  status: OrderStatus;
  items: OrderItem[];
  total: number;
  createdAt: string;
  updatedAt: string;
  expectedDate?: string;
  notes?: string;
  /**
   * Snapshots gravados UMA VEZ, na criação, e nunca atualizados depois — a mesma ideia de clientName.
   * Servem para que um pedido antigo continue reproduzível como foi feito, mesmo que o cliente troque
   * de telefone ou a loja seja renomeada. Opcionais: pedidos criados antes destes campos existirem
   * continuam válidos e não precisam de migração.
   */
  clientPhone?: string;
  storeName?: string;
  /**
   * Presentes só em pedidos originados do checkout do catálogo público (ver `client/src/lib/
   * public-catalog-orders.ts`). Sempre gravados juntos pelo servidor na criação — nunca parcialmente.
   */
  paymentMethod?: OrderPaymentMethod;
  paymentProvider?: OrderPaymentProvider;
  paymentStatus?: OrderPaymentStatus;
  /** Chave usada para o cliente reportar pagamento sem autenticação — ver mark-paid-by-customer. */
  clientOrderId?: string;
}

/**
 * Normaliza um telefone para o formato usado em links (só dígitos, com DDI).
 *
 * A distinção que importa: um número escrito com `+` ou `00` já declara o próprio DDI e é preservado
 * como está — aplicar a regra brasileira nele seria destrutivo (+1 202 555 0100 tem 11 dígitos, o
 * mesmo tamanho de um celular brasileiro com DDD, e viraria um número inexistente com 55 na frente).
 * Sem esse prefixo, o número é tratado como nacional: DDD + 8 ou 9 dígitos ganha o 55.
 *
 * Valor que não se encaixa em nenhum dos formatos aceitos vira undefined em vez de um número
 * inventado — é melhor não ter telefone do que ter um errado gravado no pedido.
 */
export function normalizeOrderPhone(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;

  const trimmed = value.trim();
  if (!trimmed) return undefined;

  let digits = trimmed.replace(/\D/g, "");
  if (!digits) return undefined;

  // `00` é o prefixo internacional discado; equivale a `+` para efeito de "o DDI já está aqui".
  const hadInternationalPrefix = trimmed.startsWith("+") || digits.startsWith("00");
  if (digits.startsWith("00")) digits = digits.slice(2);

  if (digits.length > 15) return undefined;

  if (hadInternationalPrefix) {
    return digits.length >= 8 ? digits : undefined;
  }

  // Já veio com DDI do Brasil: 55 + DDD + 8 (fixo) ou 9 (celular) dígitos.
  if (digits.startsWith("55") && (digits.length === 12 || digits.length === 13)) return digits;

  // Nacional sem DDI: DDD + 8 ou 9 dígitos.
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;

  return undefined;
}

/** unitPrice*quantity em CENTS inteiros — nunca reais float (`19.9 * 3` já não bate com `59.70` em ponto
 * flutuante). Base para calculateOrderItemSubtotal/calculateOrderTotal abaixo; nunca exportada sozinha
 * porque OrderItem/Order continuam em reais em todo o resto do código (server/routes.ts, payments.ts). */
function calculateOrderItemSubtotalCents(item: OrderItem): number {
  const unitPriceCents = Math.round(Math.max(0, Number(item.unitPrice) || 0) * 100);
  const quantity = Math.max(0, Number(item.quantity) || 0);
  return unitPriceCents * quantity;
}

/** Subtotal de um item. Vive aqui (e não na tela) para que card, detalhes e total usem a mesma conta. */
export function calculateOrderItemSubtotal(item: OrderItem): number {
  return calculateOrderItemSubtotalCents(item) / 100;
}

/** Soma em CENTS inteiros antes de converter de volta para reais — nunca soma valores reais já
 * arredondados em ponto flutuante (o que ainda arriscaria um resíduo de soma binária com itens
 * suficientes). `order.total` sai daqui para o servidor como o valor real cobrado (server/routes.ts,
 * depois server/payments.ts `unit_price` na preferência do Mercado Pago) — precisa ser exato em cents. */
export function calculateOrderTotal(items: readonly OrderItem[]): number {
  const totalCents = items.reduce((sumCents, item) => sumCents + calculateOrderItemSubtotalCents(item), 0);
  return totalCents / 100;
}

/**
 * Transições permitidas de status. O fluxo é sempre para frente (ou cancelamento) — nunca de volta:
 * um pedido entregue ou cancelado é terminal. Isso evita que um toque acidental desfaça um pedido já
 * concluído, e mantém a UI incapaz de pedir uma transição que as Firestore Rules aceitariam por serem
 * mais permissivas (a Rule valida o conjunto de status, o fluxo de negócio mora aqui).
 */
export const ORDER_STATUS_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  new: ["in_progress", "cancelled"],
  in_progress: ["ready", "cancelled"],
  ready: ["delivered", "cancelled"],
  delivered: [],
  cancelled: [],
};

export function getAllowedOrderTransitions(status: OrderStatus): readonly OrderStatus[] {
  return ORDER_STATUS_TRANSITIONS[status] ?? [];
}

export function canTransitionOrderStatus(from: OrderStatus, to: OrderStatus): boolean {
  return getAllowedOrderTransitions(from).includes(to);
}

/**
 * Status em que os itens do pedido ainda podem ser editados. De `ready` em diante o pedido já foi
 * preparado, entregue ou encerrado — editar ali desfaria trabalho concluído. Lista fechada.
 */
export const ORDER_EDITABLE_STATUS_IDS: readonly OrderStatus[] = ["new", "in_progress"];

/**
 * Recebe o valor cru de propósito (inclusive direto do documento do Firestore): resolveOrderStatus
 * converte valor desconhecido em "new", fallback certo para exibir e errado para autorizar edição —
 * aqui um status desconhecido nunca é editável.
 */
export function isOrderEditableStatus(status: unknown): boolean {
  return (ORDER_EDITABLE_STATUS_IDS as readonly string[]).includes(status as string);
}

/**
 * Pedido só é editável antes de qualquer processo de pagamento: com cobrança iniciada, o valor já foi
 * apresentado ao cliente e mudar os itens deixaria pedido e cobrança divergentes. Ausente é o pedido
 * manual (Encomenda do lojista), que nunca tem pagamento embutido — ver Order.paymentStatus. Qualquer
 * outro valor, inclusive desconhecido, bloqueia. O servidor deve passar o valor cru do documento, nunca
 * o resultado de resolveOrderPaymentStatus (que transforma valor desconhecido em ausente).
 *
 * Necessário, não suficiente: se já existe cobrança gerada (orderChargeIdempotency) só o servidor sabe,
 * e precisa checar no mesmo lugar em que aplicar a edição.
 */
export function isOrderPaymentEditable(paymentStatus: unknown): boolean {
  return paymentStatus === undefined || paymentStatus === "not_started";
}

/** Mesmo teto de linhas de isValidOrderCreate (firestore.rules: items.size() <= 100). */
export const ORDER_EDIT_MAX_ITEMS = 100;

/**
 * Contrato autoritativo do id de produto: createProductCommand valida com este mesmo padrão
 * (assertEntityId em server/plan-authoritative-mutations.ts), e todo produto real — antes e depois do
 * comando — nasceu com auto-ID do Firestore gerado em add-product.tsx, que cabe nele.
 */
const ORDER_EDIT_PRODUCT_ID_PATTERN = /^[a-zA-Z0-9_-]{1,120}$/;

/**
 * Linha de produto do catálogo na edição. Sem preço e sem nome de propósito: linha que já existia
 * mantém o snapshot gravado (withOrderItemQuantity) e linha nova recebe o preço atual do produto no
 * servidor — preço vindo do cliente nunca vale para produto cadastrado.
 */
export interface OrderEditProductItemInput {
  productId: string;
  quantity: number;
}

/** Item manual (sem productId): nome e preço estimado são do próprio lojista, como no NewOrderSheet. */
export interface OrderEditManualItemInput {
  name: string;
  quantity: number;
  unitPrice: number;
}

/**
 * Uma linha do estado FINAL desejado do pedido. Quantidade zero não existe aqui — remover a linha é não
 * enviá-la (a UI converte zero em remoção). Não há clientId/clientName: o cliente do pedido é imutável na
 * edição. O total do pedido editado continua saindo de calculateOrderTotal sobre as linhas finais, e o
 * teto financeiro não é aplicado nesta camada: fica com o comando de edição no servidor (PEDIDOS EDITÁVEIS
 * Etapa 2), que monta os itens finais e aplica o limite real de Pedidos (hoje, total <= 100000000 em
 * isValidOrderCreate, firestore.rules).
 */
export type OrderEditItemInput = OrderEditProductItemInput | OrderEditManualItemInput;

export type OrderEditItemsErrorCode =
  | "ORDER_EDIT_INVALID_ITEMS"
  | "ORDER_EDIT_EMPTY"
  | "ORDER_EDIT_TOO_MANY_ITEMS"
  | "ORDER_EDIT_INVALID_ITEM"
  | "ORDER_EDIT_INVALID_QUANTITY"
  | "ORDER_EDIT_INVALID_PRODUCT_ID"
  | "ORDER_EDIT_INVALID_ITEM_NAME"
  | "ORDER_EDIT_INVALID_ITEM_PRICE";

export type OrderEditItemsValidation =
  | { ok: true; items: OrderEditItemInput[] }
  | { ok: false; code: OrderEditItemsErrorCode; index?: number };

function isOrderEditQuantity(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/**
 * Valida e normaliza a lista FINAL de itens de uma edição (payload cru, como chega do cliente). Erro
 * determinístico: o primeiro encontrado, varrendo as linhas em ordem, com o índice da linha para a UI
 * apontar onde está o problema. A saída só tem os campos do tipo — name, unitPrice e imageUrl enviados
 * junto de um productId são descartados e nunca viram preço nem snapshot. Linhas repetidas do mesmo
 * produto não são erro: quem compara quantidades agrega por productId (aggregateOrderItemQuantities).
 *
 * Quantidade, nome e preço manual seguem o contrato real de Pedidos, sem teto nesta camada: o NewOrderSheet
 * grava quantidade fracionária, nome sem limite de tamanho e preço sem teto por item, e isValidOrderCreate
 * não valida item a item. Limites de Produto e do fluxo independente de Vendas não se aplicam aqui — um
 * teto novo tornaria pedido legado impossível de editar sem migração.
 */
export function validateOrderEditItems(items: unknown): OrderEditItemsValidation {
  if (!Array.isArray(items)) return { ok: false, code: "ORDER_EDIT_INVALID_ITEMS" };
  if (items.length === 0) return { ok: false, code: "ORDER_EDIT_EMPTY" };
  if (items.length > ORDER_EDIT_MAX_ITEMS) return { ok: false, code: "ORDER_EDIT_TOO_MANY_ITEMS" };

  const normalized: OrderEditItemInput[] = [];
  for (let index = 0; index < items.length; index += 1) {
    const item: unknown = items[index];
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      return { ok: false, code: "ORDER_EDIT_INVALID_ITEM", index };
    }
    const { productId, name, quantity, unitPrice } = item as Record<string, unknown>;
    if (!isOrderEditQuantity(quantity)) return { ok: false, code: "ORDER_EDIT_INVALID_QUANTITY", index };

    if (productId !== undefined) {
      if (typeof productId !== "string" || !ORDER_EDIT_PRODUCT_ID_PATTERN.test(productId)) {
        return { ok: false, code: "ORDER_EDIT_INVALID_PRODUCT_ID", index };
      }
      normalized.push({ productId, quantity });
      continue;
    }

    const trimmedName = typeof name === "string" ? name.trim() : "";
    if (!trimmedName) {
      return { ok: false, code: "ORDER_EDIT_INVALID_ITEM_NAME", index };
    }
    // Zero é válido: no NewOrderSheet o preço do item manual é uma estimativa opcional.
    if (typeof unitPrice !== "number" || !Number.isFinite(unitPrice) || unitPrice < 0) {
      return { ok: false, code: "ORDER_EDIT_INVALID_ITEM_PRICE", index };
    }
    normalized.push({ name: trimmedName, quantity, unitPrice });
  }
  return { ok: true, items: normalized };
}

/**
 * Soma as quantidades por productId. Pedidos antigos do catálogo público podem ter mais de uma linha do
 * mesmo produto (a rota pública não junta linhas repetidas) — comparar linha a linha contaria errado.
 * Item manual (sem productId) fica de fora. A quantidade de cada linha é lida com a mesma regra de
 * calculateOrderItemSubtotalCents (inválida ou negativa conta 0), e produto que soma 0 não entra no
 * resultado: quantidade zero equivale a linha removida.
 *
 * Agregar serve para comparar quantidades, nunca para fundir linhas: se o pedido gravado tiver linhas do
 * mesmo productId com unitPrice diferentes, o comando da Etapa 2 não pode fundi-las em silêncio — preserva
 * as linhas ou rejeita a alteração ambígua. Esse caso não é resolvido nesta camada.
 */
export function aggregateOrderItemQuantities(items: readonly Pick<OrderItem, "productId" | "quantity">[]): Map<string, number> {
  const quantities = new Map<string, number>();
  for (const item of items) {
    const quantity = Math.max(0, Number(item.quantity) || 0);
    if (typeof item.productId !== "string" || !item.productId || quantity === 0) continue;
    quantities.set(item.productId, (quantities.get(item.productId) ?? 0) + quantity);
  }
  return quantities;
}

export type OrderProductQuantityChangeKind = "added" | "removed" | "increased" | "decreased" | "unchanged";

export interface OrderProductQuantityChange {
  productId: string;
  previousQuantity: number;
  nextQuantity: number;
  kind: OrderProductQuantityChangeKind;
}

/**
 * Compara, por produto, as quantidades do pedido gravado com as da edição (os dois lados agregados). É
 * a base das decisões do futuro comando de edição no servidor: só `added` e `increased` pedem produto
 * ainda disponível (produto excluído, arquivado ou preservado pode diminuir ou sair, nunca aumentar) e
 * só `added` recebe o preço atual — `increased` mantém o snapshot da linha existente (snapshots divergentes
 * do mesmo produto: ver aggregateOrderItemQuantities). Ordem estável: produtos do pedido gravado na ordem
 * em que aparecem, depois os novos na ordem da edição.
 */
export function compareOrderProductQuantities(
  previousItems: readonly Pick<OrderItem, "productId" | "quantity">[],
  nextItems: readonly Pick<OrderItem, "productId" | "quantity">[],
): OrderProductQuantityChange[] {
  const previous = aggregateOrderItemQuantities(previousItems);
  const next = aggregateOrderItemQuantities(nextItems);
  const productIds = Array.from(previous.keys()).concat(Array.from(next.keys()).filter((productId) => !previous.has(productId)));
  return productIds.map((productId) => {
    const previousQuantity = previous.get(productId) ?? 0;
    const nextQuantity = next.get(productId) ?? 0;
    const kind: OrderProductQuantityChangeKind = previousQuantity === 0
      ? "added"
      : nextQuantity === 0
        ? "removed"
        : nextQuantity > previousQuantity
          ? "increased"
          : nextQuantity < previousQuantity
            ? "decreased"
            : "unchanged";
    return { productId, previousQuantity, nextQuantity, kind };
  });
}

/**
 * Muda só a quantidade de uma linha já gravada, preservando o snapshot inteiro (unitPrice, name,
 * imageUrl, productId). Não recebe preço de propósito: 10 → 13 continua no preço do dia do pedido, e o
 * preço atual do produto nunca substitui o snapshot automaticamente. A quantidade chega já validada
 * (validateOrderEditItems) — zero nunca chega aqui, é remoção da linha.
 */
export function withOrderItemQuantity(item: OrderItem, quantity: number): OrderItem {
  return { ...item, quantity };
}
