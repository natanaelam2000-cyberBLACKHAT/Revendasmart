import type { PlanAccessState } from "./monetization";

export type EntityId = string;
export type Uid = string;
export type IsoUtcString = string;
export type MoneyCents = number;

export type OptionalCost =
  | { readonly kind: "unknown" }
  | { readonly kind: "known"; readonly amountCents: MoneyCents };

export type ServicePricing =
  | {
      readonly mode: "fixed";
      readonly priceCents: MoneyCents;
    }
  | {
      readonly mode: "starting_at";
      readonly startingAtPriceCents: MoneyCents;
    }
  | {
      readonly mode: "quote";
    };

export type ServiceBookingMode = "none" | "instant" | "request";

export type Service = {
  readonly id: EntityId;
  readonly tenantUid: Uid;
  readonly name: string;
  readonly description?: string;
  readonly imageUrl?: string;
  readonly active: boolean;
  readonly published: boolean;
  readonly pricing: ServicePricing;
  readonly durationMinutes?: number;
  readonly cost: OptionalCost;
  readonly bookingMode: ServiceBookingMode;
  readonly createdAt: IsoUtcString;
  readonly updatedAt: IsoUtcString;
  readonly archivedAt?: IsoUtcString;
  /** PLAN-IMPL-02B1 — ausente ou "active" = opera normalmente; "preserved" = excedente de um downgrade
   * de plano (server/plan-access-reconciliation.ts): preservado/visível ao dono, fora da lista pública de
   * agendamento e indisponível para uma NOVA reserva. Deliberadamente separado de `active`/`published`
   * acima (a alternância manual do dono, reservada para PLAN-IMPL-02B2) — nunca escrito pelo client, só o
   * servidor (Admin SDK) grava este campo (ver firestore.rules, isValidServiceUpdate). */
  readonly planAccessState?: PlanAccessState;
};

export type ServiceSnapshot =
  | {
      readonly sourceId?: EntityId;
      readonly capturedAt: IsoUtcString;
      readonly name: string;
      readonly priceMode: "fixed";
      readonly priceCents: MoneyCents;
      readonly durationMinutes?: number;
    }
  | {
      readonly sourceId?: EntityId;
      readonly capturedAt: IsoUtcString;
      readonly name: string;
      readonly priceMode: "starting_at";
      readonly startingAtPriceCents: MoneyCents;
      readonly durationMinutes?: number;
    }
  | {
      readonly sourceId?: EntityId;
      readonly capturedAt: IsoUtcString;
      readonly name: string;
      readonly priceMode: "quote";
      readonly durationMinutes?: number;
    };

export type ProductSnapshot = {
  readonly sourceId?: EntityId;
  readonly capturedAt: IsoUtcString;
  readonly name: string;
  readonly unitPriceCents: MoneyCents;
};

export type ServiceLineItem = {
  readonly kind: "service";
  readonly id: EntityId;
  readonly sourceId?: EntityId;
  readonly snapshot: ServiceSnapshot;
  readonly quantity: number;
  readonly unitPriceCents: MoneyCents;
  readonly lineTotalCents: MoneyCents;
};

export type ProductLineItem = {
  readonly kind: "product";
  readonly id: EntityId;
  readonly sourceId?: EntityId;
  readonly snapshot: ProductSnapshot;
  readonly quantity: number;
  readonly unitPriceCents: MoneyCents;
  readonly lineTotalCents: MoneyCents;
};

export type AdditionalLineItem = {
  readonly kind: "additional";
  readonly id: EntityId;
  readonly label: string;
  readonly quantity: number;
  readonly unitPriceCents: MoneyCents;
  readonly lineTotalCents: MoneyCents;
};

export type DiscountItem = {
  readonly kind: "discount";
  readonly id: EntityId;
  readonly label: string;
  readonly amountCents: MoneyCents;
};

export type CommercialItem =
  | ServiceLineItem
  | ProductLineItem
  | AdditionalLineItem
  | DiscountItem;

export type CommercialTotals = {
  readonly serviceRevenueCents: MoneyCents;
  readonly productRevenueCents: MoneyCents;
  readonly additionalRevenueCents: MoneyCents;
  readonly discountTotalCents: MoneyCents;
  readonly contractedTotalCents: MoneyCents;
};

export type ServiceWorkStatus = "planned" | "in_progress" | "completed" | "cancelled";
export type ServiceWorkOrigin = "manual" | "booking" | "quote" | "request";

export type ServiceWorkFinancialSummary = {
  readonly grossReceivedCents: MoneyCents;
  readonly refundedTotalCents: MoneyCents;
  readonly netReceivedCents: MoneyCents;
};

export type ServiceWork = {
  readonly id: EntityId;
  readonly tenantUid: Uid;
  readonly status: ServiceWorkStatus;
  readonly origin: ServiceWorkOrigin;
  readonly customerId?: EntityId;
  readonly sourceQuoteId?: EntityId;
  readonly sourceQuoteVersionId?: EntityId;
  /** SERV-QUOTE-LINK-01 — o Quote atualmente relacionado a este Work, independente de como ele chegou lá:
   * para origin="quote" é o mesmo valor de sourceQuoteId (escrito pelo convert), para qualquer outra origem
   * é preenchido só quando um orçamento é criado DEPOIS para um Work já existente (createServiceQuoteForWork).
   * Campo opcional e imutável pelo client (server-authoritative, ver firestore.rules) — um Work legado sem
   * este campo continua válido e legível; nunca é preenchido vazio. V1 suporta no máximo 0..1 Quote por Work. */
  readonly quoteId?: EntityId;
  readonly items: readonly CommercialItem[];
  readonly totals: CommercialTotals;
  readonly financialSummary: ServiceWorkFinancialSummary;
  readonly cost: OptionalCost;
  readonly createdAt: IsoUtcString;
  readonly updatedAt: IsoUtcString;
  readonly startedAt?: IsoUtcString;
  readonly completedAt?: IsoUtcString;
  readonly cancelledAt?: IsoUtcString;
};

export type ServicePaymentMethod = "cash" | "pix" | "card" | "manual" | "provider_charge";

export type ServicePaymentRecord = {
  readonly id: EntityId;
  readonly tenantUid: Uid;
  readonly workId: EntityId;
  readonly amountCents: MoneyCents;
  readonly method: ServicePaymentMethod;
  readonly recordedAt: IsoUtcString;
  readonly refundedTotalCents: MoneyCents;
  readonly externalChargeId?: EntityId;
  readonly idempotencyKey: string;
};

export type ServiceRefundRecord = {
  readonly id: EntityId;
  readonly tenantUid: Uid;
  readonly workId: EntityId;
  readonly paymentId: EntityId;
  readonly amountCents: MoneyCents;
  readonly reason?: string;
  readonly refundedAt: IsoUtcString;
  readonly idempotencyKey: string;
};

export type FinancialStatus = "unpaid" | "partial" | "paid";
export type RefundStatus = "none" | "partial" | "full";

export type DerivedWorkFinancials = {
  readonly contractedTotalCents: MoneyCents;
  readonly grossReceivedCents: MoneyCents;
  readonly refundedTotalCents: MoneyCents;
  readonly netReceivedCents: MoneyCents;
  readonly balanceCents: MoneyCents;
  readonly financialStatus: FinancialStatus;
  readonly refundStatus: RefundStatus;
};

export type EstimatedResult =
  | { readonly kind: "unknown" }
  | {
      readonly kind: "known";
      readonly resultCents: MoneyCents;
      readonly marginRatio: number | null;
    };

export type ServicesDomainErrorCode =
  | "INVALID_ENTITY_ID"
  | "INVALID_UID"
  | "INVALID_ISO_UTC"
  | "INVALID_SERVICE"
  | "INVALID_SERVICE_WORK"
  | "INVALID_SERVICE_PAYMENT"
  | "INVALID_SERVICE_REFUND"
  | "INVALID_MONEY_CENTS"
  | "INVALID_PAYMENT_AMOUNT"
  | "INVALID_REFUND_AMOUNT"
  | "INVALID_PAYMENT_METHOD"
  | "INVALID_QUANTITY"
  | "INVALID_DURATION_MINUTES"
  | "INVALID_SERVICE_PRICING"
  | "INCONSISTENT_LINE_TOTAL"
  | "INCONSISTENT_COMMERCIAL_TOTALS"
  | "INCONSISTENT_WORK_FINANCIAL_SUMMARY"
  | "DISCOUNT_EXCEEDS_SUBTOTAL"
  | "REFUND_EXCEEDS_PAYMENT"
  | "TOTAL_REFUND_EXCEEDS_GROSS_RECEIVED"
  | "OVERPAYMENT_NOT_SUPPORTED"
  | "INVALID_SERVICE_WORK_TRANSITION";

export class ServicesDomainError extends Error {
  readonly code: ServicesDomainErrorCode;

  constructor(code: ServicesDomainErrorCode, message: string) {
    super(message);
    this.name = "ServicesDomainError";
    this.code = code;
  }
}

export function isKnownCost(cost: OptionalCost): cost is Extract<OptionalCost, { kind: "known" }> {
  return cost.kind === "known";
}

export function assertMoneyCents(value: number, fieldName = "value"): MoneyCents {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
    throw new ServicesDomainError(
      "INVALID_MONEY_CENTS",
      `${fieldName} must be a finite non-negative integer number of cents.`,
    );
  }
  return value;
}

function assertPositiveMoneyCents(
  value: number,
  code: Extract<ServicesDomainErrorCode, "INVALID_PAYMENT_AMOUNT" | "INVALID_REFUND_AMOUNT">,
  fieldName: string,
): MoneyCents {
  const safeValue = assertMoneyCents(value, fieldName);
  if (safeValue <= 0) {
    throw new ServicesDomainError(
      code,
      `${fieldName} must be greater than 0.`,
    );
  }
  return safeValue;
}

export function assertQuantity(value: number, fieldName = "quantity"): number {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 1) {
    throw new ServicesDomainError(
      "INVALID_QUANTITY",
      `${fieldName} must be a finite integer greater than or equal to 1.`,
    );
  }
  return value;
}

export function assertDurationMinutes(value: number, fieldName = "durationMinutes"): number {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
    throw new ServicesDomainError(
      "INVALID_DURATION_MINUTES",
      `${fieldName} must be a finite integer greater than 0.`,
    );
  }
  return value;
}

export function assertValidOptionalCost(cost: OptionalCost): OptionalCost {
  if (cost.kind === "known") {
    assertMoneyCents(cost.amountCents, "cost.amountCents");
  }
  return cost;
}

export function assertEntityId(value: string, fieldName = "id"): EntityId {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{1,120}$/.test(value)) {
    throw new ServicesDomainError(
      "INVALID_ENTITY_ID",
      `${fieldName} must be a non-empty string using only letters, numbers, "_" or "-".`,
    );
  }
  return value;
}

export function assertUid(value: string, fieldName = "tenantUid"): Uid {
  if (typeof value !== "string" || !/^[a-zA-Z0-9:_-]{1,160}$/.test(value)) {
    throw new ServicesDomainError(
      "INVALID_UID",
      `${fieldName} must be a non-empty string.`,
    );
  }
  return value;
}

export function assertIsoUtcString(value: string, fieldName: string): IsoUtcString {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) {
    throw new ServicesDomainError(
      "INVALID_ISO_UTC",
      `${fieldName} must be an ISO 8601 UTC string.`,
    );
  }
  if (!Number.isFinite(Date.parse(value))) {
    throw new ServicesDomainError(
      "INVALID_ISO_UTC",
      `${fieldName} must be a valid ISO 8601 UTC string.`,
    );
  }
  return value;
}

export function assertValidServicePricing(pricing: ServicePricing): ServicePricing {
  switch (pricing.mode) {
    case "fixed":
      assertMoneyCents(pricing.priceCents, "pricing.priceCents");
      return pricing;
    case "starting_at":
      assertMoneyCents(pricing.startingAtPriceCents, "pricing.startingAtPriceCents");
      return pricing;
    case "quote":
      return pricing;
    default: {
      const unknownMode = (pricing as { mode?: unknown }).mode;
      throw new ServicesDomainError(
        "INVALID_SERVICE_PRICING",
        `Unsupported service pricing mode: ${String(unknownMode)}`,
      );
    }
  }
}

export function assertValidService(service: Service): Service {
  assertEntityId(service.id, "service.id");
  assertUid(service.tenantUid, "service.tenantUid");
  if (typeof service.name !== "string" || service.name.trim().length === 0 || service.name.length > 180) {
    throw new ServicesDomainError("INVALID_SERVICE", "service.name must be a non-empty string up to 180 characters.");
  }
  if (typeof service.description !== "undefined" && (typeof service.description !== "string" || service.description.length > 2000)) {
    throw new ServicesDomainError("INVALID_SERVICE", "service.description must be a string up to 2000 characters.");
  }
  if (typeof service.imageUrl !== "undefined" && (typeof service.imageUrl !== "string" || service.imageUrl.length > 2000)) {
    throw new ServicesDomainError("INVALID_SERVICE", "service.imageUrl must be a string up to 2000 characters.");
  }
  if (typeof service.active !== "boolean" || typeof service.published !== "boolean") {
    throw new ServicesDomainError("INVALID_SERVICE", "service.active and service.published must be booleans.");
  }
  assertValidServicePricing(service.pricing);
  assertValidOptionalCost(service.cost);
  if (typeof service.durationMinutes !== "undefined") {
    assertDurationMinutes(service.durationMinutes);
  }
  if (!["none", "instant", "request"].includes(service.bookingMode)) {
    throw new ServicesDomainError("INVALID_SERVICE", "service.bookingMode is invalid.");
  }
  assertIsoUtcString(service.createdAt, "service.createdAt");
  assertIsoUtcString(service.updatedAt, "service.updatedAt");
  if (typeof service.archivedAt !== "undefined") {
    assertIsoUtcString(service.archivedAt, "service.archivedAt");
  }
  if (typeof service.planAccessState !== "undefined" && service.planAccessState !== "active" && service.planAccessState !== "preserved") {
    throw new ServicesDomainError("INVALID_SERVICE", "service.planAccessState must be \"active\" or \"preserved\" when present.");
  }
  return service;
}

export function calculateLineTotalCents(quantity: number, unitPriceCents: MoneyCents): MoneyCents {
  const safeQuantity = assertQuantity(quantity);
  const safeUnitPrice = assertMoneyCents(unitPriceCents, "unitPriceCents");
  return safeQuantity * safeUnitPrice;
}

export function assertValidCommercialItem(item: CommercialItem): CommercialItem {
  assertEntityId(item.id, `${item.kind}.id`);
  switch (item.kind) {
    case "service": {
      if (typeof item.snapshot !== "object" || item.snapshot === null) {
        throw new ServicesDomainError("INVALID_SERVICE_WORK", "service.snapshot must be present.");
      }
      if (typeof item.snapshot.sourceId !== "undefined") {
        assertEntityId(item.snapshot.sourceId, "service.snapshot.sourceId");
      }
      assertIsoUtcString(item.snapshot.capturedAt, "service.snapshot.capturedAt");
      if (typeof item.snapshot.name !== "string" || item.snapshot.name.trim().length === 0) {
        throw new ServicesDomainError("INVALID_SERVICE_WORK", "service.snapshot.name must be a non-empty string.");
      }
      if (typeof item.snapshot.durationMinutes !== "undefined") {
        assertDurationMinutes(item.snapshot.durationMinutes, "service.snapshot.durationMinutes");
      }
      if (item.snapshot.priceMode === "fixed") {
        assertMoneyCents(item.snapshot.priceCents, "service.snapshot.priceCents");
      } else if (item.snapshot.priceMode === "starting_at") {
        assertMoneyCents(item.snapshot.startingAtPriceCents, "service.snapshot.startingAtPriceCents");
      } else if (item.snapshot.priceMode !== "quote") {
        throw new ServicesDomainError("INVALID_SERVICE_WORK", "service.snapshot.priceMode is invalid.");
      }
      const expectedLineTotal = calculateLineTotalCents(item.quantity, item.unitPriceCents);
      const actualLineTotal = assertMoneyCents(item.lineTotalCents, `${item.kind}.lineTotalCents`);
      if (actualLineTotal !== expectedLineTotal) {
        throw new ServicesDomainError(
          "INCONSISTENT_LINE_TOTAL",
          `${item.kind}.lineTotalCents must equal quantity * unitPriceCents.`,
        );
      }
      return item;
    }
    case "product": {
      if (typeof item.snapshot !== "object" || item.snapshot === null) {
        throw new ServicesDomainError("INVALID_SERVICE_WORK", "product.snapshot must be present.");
      }
      if (typeof item.snapshot.sourceId !== "undefined") {
        assertEntityId(item.snapshot.sourceId, "product.snapshot.sourceId");
      }
      assertIsoUtcString(item.snapshot.capturedAt, "product.snapshot.capturedAt");
      if (typeof item.snapshot.name !== "string" || item.snapshot.name.trim().length === 0) {
        throw new ServicesDomainError("INVALID_SERVICE_WORK", "product.snapshot.name must be a non-empty string.");
      }
      assertMoneyCents(item.snapshot.unitPriceCents, "product.snapshot.unitPriceCents");
      const expectedLineTotal = calculateLineTotalCents(item.quantity, item.unitPriceCents);
      const actualLineTotal = assertMoneyCents(item.lineTotalCents, `${item.kind}.lineTotalCents`);
      if (actualLineTotal !== expectedLineTotal) {
        throw new ServicesDomainError(
          "INCONSISTENT_LINE_TOTAL",
          `${item.kind}.lineTotalCents must equal quantity * unitPriceCents.`,
        );
      }
      return item;
    }
    case "additional": {
      if (typeof item.label !== "string" || item.label.trim().length === 0 || item.label.length > 200) {
        throw new ServicesDomainError("INVALID_SERVICE_WORK", "additional.label must be a non-empty string up to 200 characters.");
      }
      const expectedLineTotal = calculateLineTotalCents(item.quantity, item.unitPriceCents);
      const actualLineTotal = assertMoneyCents(item.lineTotalCents, `${item.kind}.lineTotalCents`);
      if (actualLineTotal !== expectedLineTotal) {
        throw new ServicesDomainError(
          "INCONSISTENT_LINE_TOTAL",
          `${item.kind}.lineTotalCents must equal quantity * unitPriceCents.`,
        );
      }
      return item;
    }
    case "discount":
      if (typeof item.label !== "string" || item.label.trim().length === 0 || item.label.length > 200) {
        throw new ServicesDomainError("INVALID_SERVICE_WORK", "discount.label must be a non-empty string up to 200 characters.");
      }
      assertMoneyCents(item.amountCents, "discount.amountCents");
      return item;
    default: {
      const unknownKind = (item as { kind?: unknown }).kind;
      throw new ServicesDomainError(
        "INVALID_SERVICE_WORK",
        `Unsupported commercial item kind: ${String(unknownKind)}`,
      );
    }
  }
}

function assertCommercialTotalsEqual(actual: CommercialTotals, expected: CommercialTotals): void {
  if (
    actual.serviceRevenueCents !== expected.serviceRevenueCents
    || actual.productRevenueCents !== expected.productRevenueCents
    || actual.additionalRevenueCents !== expected.additionalRevenueCents
    || actual.discountTotalCents !== expected.discountTotalCents
    || actual.contractedTotalCents !== expected.contractedTotalCents
  ) {
    throw new ServicesDomainError(
      "INCONSISTENT_COMMERCIAL_TOTALS",
      "serviceWork.totals must be recalculated from items.",
    );
  }
}

export function createZeroServiceWorkFinancialSummary(): ServiceWorkFinancialSummary {
  return {
    grossReceivedCents: 0,
    refundedTotalCents: 0,
    netReceivedCents: 0,
  };
}

export function assertValidServiceWorkFinancialSummary(summary: ServiceWorkFinancialSummary): ServiceWorkFinancialSummary {
  const grossReceivedCents = assertMoneyCents(summary.grossReceivedCents, "financialSummary.grossReceivedCents");
  const refundedTotalCents = assertMoneyCents(summary.refundedTotalCents, "financialSummary.refundedTotalCents");
  const netReceivedCents = assertMoneyCents(summary.netReceivedCents, "financialSummary.netReceivedCents");

  if (refundedTotalCents > grossReceivedCents) {
    throw new ServicesDomainError(
      "INCONSISTENT_WORK_FINANCIAL_SUMMARY",
      "financialSummary.refundedTotalCents cannot exceed financialSummary.grossReceivedCents.",
    );
  }
  if (netReceivedCents !== grossReceivedCents - refundedTotalCents) {
    throw new ServicesDomainError(
      "INCONSISTENT_WORK_FINANCIAL_SUMMARY",
      "financialSummary.netReceivedCents must equal grossReceivedCents - refundedTotalCents.",
    );
  }
  return {
    grossReceivedCents,
    refundedTotalCents,
    netReceivedCents,
  };
}

export function assertValidServicePaymentRecord(payment: ServicePaymentRecord): ServicePaymentRecord {
  assertEntityId(payment.id, "payment.id");
  assertUid(payment.tenantUid, "payment.tenantUid");
  assertEntityId(payment.workId, "payment.workId");
  const amountCents = assertPositiveMoneyCents(payment.amountCents, "INVALID_PAYMENT_AMOUNT", "payment.amountCents");
  if (!["cash", "pix", "card", "manual", "provider_charge"].includes(payment.method)) {
    throw new ServicesDomainError("INVALID_PAYMENT_METHOD", "payment.method is invalid.");
  }
  assertIsoUtcString(payment.recordedAt, "payment.recordedAt");
  const refundedTotalCents = assertMoneyCents(payment.refundedTotalCents, "payment.refundedTotalCents");
  if (refundedTotalCents > amountCents) {
    throw new ServicesDomainError(
      "REFUND_EXCEEDS_PAYMENT",
      "payment.refundedTotalCents cannot exceed payment.amountCents.",
    );
  }
  if (typeof payment.externalChargeId !== "undefined") {
    assertEntityId(payment.externalChargeId, "payment.externalChargeId");
  }
  if (typeof payment.idempotencyKey !== "string" || !/^[a-zA-Z0-9_-]{6,120}$/.test(payment.idempotencyKey)) {
    throw new ServicesDomainError("INVALID_SERVICE_PAYMENT", "payment.idempotencyKey is invalid.");
  }
  return payment;
}

export function assertValidServiceRefundRecord(refund: ServiceRefundRecord): ServiceRefundRecord {
  assertEntityId(refund.id, "refund.id");
  assertUid(refund.tenantUid, "refund.tenantUid");
  assertEntityId(refund.workId, "refund.workId");
  assertEntityId(refund.paymentId, "refund.paymentId");
  assertPositiveMoneyCents(refund.amountCents, "INVALID_REFUND_AMOUNT", "refund.amountCents");
  if (typeof refund.reason !== "undefined" && (typeof refund.reason !== "string" || refund.reason.length > 280)) {
    throw new ServicesDomainError("INVALID_SERVICE_REFUND", "refund.reason must be a string up to 280 characters.");
  }
  assertIsoUtcString(refund.refundedAt, "refund.refundedAt");
  if (typeof refund.idempotencyKey !== "string" || !/^[a-zA-Z0-9_-]{6,120}$/.test(refund.idempotencyKey)) {
    throw new ServicesDomainError("INVALID_SERVICE_REFUND", "refund.idempotencyKey is invalid.");
  }
  return refund;
}

export type ServiceWorkDocument = Omit<ServiceWork, "financialSummary"> & {
  readonly financialSummary?: ServiceWorkFinancialSummary;
};

export function normalizeServiceWorkDocument(serviceWork: ServiceWorkDocument): ServiceWork {
  return assertValidServiceWork({
    ...serviceWork,
    financialSummary: serviceWork.financialSummary ?? createZeroServiceWorkFinancialSummary(),
  });
}

export function assertValidServiceWork(serviceWork: ServiceWork): ServiceWork {
  assertEntityId(serviceWork.id, "serviceWork.id");
  assertUid(serviceWork.tenantUid, "serviceWork.tenantUid");
  if (!["planned", "in_progress", "completed", "cancelled"].includes(serviceWork.status)) {
    throw new ServicesDomainError("INVALID_SERVICE_WORK", "serviceWork.status is invalid.");
  }
  if (!["manual", "booking", "quote", "request"].includes(serviceWork.origin)) {
    throw new ServicesDomainError("INVALID_SERVICE_WORK", "serviceWork.origin is invalid.");
  }
  if (typeof serviceWork.customerId !== "undefined") {
    assertEntityId(serviceWork.customerId, "serviceWork.customerId");
  }
  if (typeof serviceWork.sourceQuoteId !== "undefined") {
    assertEntityId(serviceWork.sourceQuoteId, "serviceWork.sourceQuoteId");
  }
  if (typeof serviceWork.sourceQuoteVersionId !== "undefined") {
    assertEntityId(serviceWork.sourceQuoteVersionId, "serviceWork.sourceQuoteVersionId");
  }
  if (typeof serviceWork.quoteId !== "undefined") {
    assertEntityId(serviceWork.quoteId, "serviceWork.quoteId");
  }
  if (!Array.isArray(serviceWork.items) || serviceWork.items.length > 100) {
    throw new ServicesDomainError("INVALID_SERVICE_WORK", "serviceWork.items must be an array with up to 100 items.");
  }
  const derivedTotals = calculateCommercialTotals(serviceWork.items);
  assertCommercialTotalsEqual(serviceWork.totals, derivedTotals);
  const financialSummary = assertValidServiceWorkFinancialSummary(serviceWork.financialSummary);
  if (financialSummary.netReceivedCents > serviceWork.totals.contractedTotalCents) {
    throw new ServicesDomainError(
      "OVERPAYMENT_NOT_SUPPORTED",
      "serviceWork.financialSummary.netReceivedCents cannot exceed contractedTotalCents in Services V1.",
    );
  }
  assertValidOptionalCost(serviceWork.cost);
  assertIsoUtcString(serviceWork.createdAt, "serviceWork.createdAt");
  assertIsoUtcString(serviceWork.updatedAt, "serviceWork.updatedAt");
  if (typeof serviceWork.startedAt !== "undefined") {
    assertIsoUtcString(serviceWork.startedAt, "serviceWork.startedAt");
  }
  if (typeof serviceWork.completedAt !== "undefined") {
    assertIsoUtcString(serviceWork.completedAt, "serviceWork.completedAt");
  }
  if (typeof serviceWork.cancelledAt !== "undefined") {
    assertIsoUtcString(serviceWork.cancelledAt, "serviceWork.cancelledAt");
  }

  if (serviceWork.status === "planned" && (serviceWork.startedAt || serviceWork.completedAt || serviceWork.cancelledAt)) {
    throw new ServicesDomainError("INVALID_SERVICE_WORK", "planned serviceWork cannot contain startedAt/completedAt/cancelledAt.");
  }
  if (serviceWork.status === "in_progress" && (!serviceWork.startedAt || serviceWork.completedAt || serviceWork.cancelledAt)) {
    throw new ServicesDomainError("INVALID_SERVICE_WORK", "in_progress serviceWork must contain only startedAt.");
  }
  if (serviceWork.status === "completed" && (!serviceWork.startedAt || !serviceWork.completedAt || serviceWork.cancelledAt)) {
    throw new ServicesDomainError("INVALID_SERVICE_WORK", "completed serviceWork must contain startedAt and completedAt only.");
  }
  if (serviceWork.status === "cancelled" && (!serviceWork.cancelledAt || serviceWork.completedAt)) {
    throw new ServicesDomainError("INVALID_SERVICE_WORK", "cancelled serviceWork must contain cancelledAt and no completedAt.");
  }
  if (serviceWork.origin === "quote") {
    if (!serviceWork.sourceQuoteId || !serviceWork.sourceQuoteVersionId) {
      throw new ServicesDomainError("INVALID_SERVICE_WORK", "quote-origin serviceWork must contain sourceQuoteId and sourceQuoteVersionId.");
    }
    // SERV-QUOTE-LINK-01 — quando presente (Works criados a partir de agora), quoteId deve concordar com
    // sourceQuoteId; Works de origin="quote" anteriores a este ticket, sem quoteId, continuam válidos (campo
    // opcional, nunca migrado retroativamente em leitura).
    if (typeof serviceWork.quoteId !== "undefined" && serviceWork.quoteId !== serviceWork.sourceQuoteId) {
      throw new ServicesDomainError("INVALID_SERVICE_WORK", "quote-origin serviceWork.quoteId must match sourceQuoteId when present.");
    }
  } else if (serviceWork.sourceQuoteId || serviceWork.sourceQuoteVersionId) {
    throw new ServicesDomainError("INVALID_SERVICE_WORK", "non-quote serviceWork cannot contain sourceQuoteId/sourceQuoteVersionId.");
  }
  return {
    ...serviceWork,
    financialSummary,
  };
}

export function calculateCommercialTotals(items: readonly CommercialItem[]): CommercialTotals {
  let serviceRevenueCents = 0;
  let productRevenueCents = 0;
  let additionalRevenueCents = 0;
  let discountTotalCents = 0;

  for (const item of items) {
    assertValidCommercialItem(item);
    switch (item.kind) {
      case "service":
        serviceRevenueCents += item.lineTotalCents;
        break;
      case "product":
        productRevenueCents += item.lineTotalCents;
        break;
      case "additional":
        additionalRevenueCents += item.lineTotalCents;
        break;
      case "discount":
        discountTotalCents += item.amountCents;
        break;
    }
  }

  const subtotalCents = serviceRevenueCents + productRevenueCents + additionalRevenueCents;
  if (discountTotalCents > subtotalCents) {
    throw new ServicesDomainError(
      "DISCOUNT_EXCEEDS_SUBTOTAL",
      "discountTotalCents cannot exceed subtotalCents.",
    );
  }

  return {
    serviceRevenueCents,
    productRevenueCents,
    additionalRevenueCents,
    discountTotalCents,
    contractedTotalCents: subtotalCents - discountTotalCents,
  };
}

const ALLOWED_SERVICE_WORK_TRANSITIONS: Readonly<Record<ServiceWorkStatus, readonly ServiceWorkStatus[]>> = {
  planned: ["in_progress", "cancelled"],
  in_progress: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
};

export function canTransitionServiceWorkStatus(
  currentStatus: ServiceWorkStatus,
  nextStatus: ServiceWorkStatus,
): boolean {
  return ALLOWED_SERVICE_WORK_TRANSITIONS[currentStatus].includes(nextStatus);
}

export function assertValidServiceWorkTransition(
  currentStatus: ServiceWorkStatus,
  nextStatus: ServiceWorkStatus,
): ServiceWorkStatus {
  if (!canTransitionServiceWorkStatus(currentStatus, nextStatus)) {
    throw new ServicesDomainError(
      "INVALID_SERVICE_WORK_TRANSITION",
      `Invalid ServiceWork transition from ${currentStatus} to ${nextStatus}.`,
    );
  }
  return nextStatus;
}

export function derivePaymentRefundStatus(payment: ServicePaymentRecord): RefundStatus {
  const validPayment = assertValidServicePaymentRecord(payment);
  if (validPayment.refundedTotalCents === 0) return "none";
  if (validPayment.refundedTotalCents === validPayment.amountCents) return "full";
  return "partial";
}

function deriveFinancialsFromSummary(
  contractedTotalCents: MoneyCents,
  summary: ServiceWorkFinancialSummary,
): DerivedWorkFinancials {
  const safeContractedTotalCents = assertMoneyCents(contractedTotalCents, "contractedTotalCents");
  const validSummary = assertValidServiceWorkFinancialSummary(summary);

  if (validSummary.netReceivedCents > safeContractedTotalCents) {
    throw new ServicesDomainError(
      "OVERPAYMENT_NOT_SUPPORTED",
      "netReceivedCents cannot exceed contractedTotalCents in Services V1.",
    );
  }

  const balanceCents = safeContractedTotalCents - validSummary.netReceivedCents;

  const financialStatus: FinancialStatus = balanceCents === 0
    ? "paid"
    : validSummary.netReceivedCents === 0
      ? "unpaid"
      : "partial";

  const refundStatus: RefundStatus = validSummary.refundedTotalCents === 0
    ? "none"
    : validSummary.grossReceivedCents > 0 && validSummary.refundedTotalCents === validSummary.grossReceivedCents
      ? "full"
      : "partial";

  return {
    contractedTotalCents: safeContractedTotalCents,
    grossReceivedCents: validSummary.grossReceivedCents,
    refundedTotalCents: validSummary.refundedTotalCents,
    netReceivedCents: validSummary.netReceivedCents,
    balanceCents,
    financialStatus,
    refundStatus,
  };
}

export function deriveWorkFinancials(
  contractedTotalCents: MoneyCents,
  payments: readonly ServicePaymentRecord[],
): DerivedWorkFinancials {
  let grossReceivedCents = 0;
  let refundedTotalCents = 0;

  for (const payment of payments) {
    const validPayment = assertValidServicePaymentRecord(payment);
    grossReceivedCents += validPayment.amountCents;
    refundedTotalCents += validPayment.refundedTotalCents;
  }
  return deriveFinancialsFromSummary(contractedTotalCents, {
    grossReceivedCents,
    refundedTotalCents,
    netReceivedCents: grossReceivedCents - refundedTotalCents,
  });
}

export function deriveServiceWorkFinancials(serviceWork: ServiceWork): DerivedWorkFinancials {
  return deriveFinancialsFromSummary(
    serviceWork.totals.contractedTotalCents,
    serviceWork.financialSummary,
  );
}

export function assertCanRegisterServicePayment(
  contractedTotalCents: MoneyCents,
  existingPayments: readonly ServicePaymentRecord[],
  newPaymentAmountCents: MoneyCents,
): MoneyCents {
  const safeNewPaymentAmountCents = assertMoneyCents(newPaymentAmountCents, "newPaymentAmountCents");
  const currentFinancials = deriveWorkFinancials(contractedTotalCents, existingPayments);
  if (safeNewPaymentAmountCents > currentFinancials.balanceCents) {
    throw new ServicesDomainError(
      "OVERPAYMENT_NOT_SUPPORTED",
      "newPaymentAmountCents cannot exceed the current balanceCents in Services V1.",
    );
  }
  return safeNewPaymentAmountCents;
}

export function deriveEstimatedResult(
  contractedTotalCents: MoneyCents,
  cost: OptionalCost,
): EstimatedResult {
  const safeContractedTotalCents = assertMoneyCents(contractedTotalCents, "contractedTotalCents");
  assertValidOptionalCost(cost);
  if (!isKnownCost(cost)) {
    return { kind: "unknown" };
  }

  const resultCents = safeContractedTotalCents - cost.amountCents;
  return {
    kind: "known",
    resultCents,
    marginRatio: safeContractedTotalCents === 0 ? null : resultCents / safeContractedTotalCents,
  };
}
