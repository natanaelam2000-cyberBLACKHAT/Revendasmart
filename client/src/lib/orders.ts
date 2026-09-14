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
