import assert from "node:assert/strict";
import {
  ServicesDomainError,
  assertCanRegisterServicePayment,
  assertMoneyCents,
  assertValidServicePaymentRecord,
  assertValidServicePricing,
  assertValidServiceRefundRecord,
  assertValidServiceWork,
  assertValidServiceWorkFinancialSummary,
  assertValidServiceWorkTransition,
  calculateCommercialTotals,
  createZeroServiceWorkFinancialSummary,
  deriveEstimatedResult,
  derivePaymentRefundStatus,
  deriveServiceWorkFinancials,
  deriveWorkFinancials,
  isKnownCost,
  normalizeServiceWorkDocument,
  type CommercialItem,
  type OptionalCost,
  type ServicePaymentRecord,
  type ServicePricing,
  type ServiceRefundRecord,
} from "../shared/services";
import {
  assertValidQuote,
  assertValidQuoteVersion,
  isQuoteExpired,
  type Quote,
  type QuoteVersion,
} from "../shared/service-quotes";

function payment(overrides: Partial<ServicePaymentRecord> = {}): ServicePaymentRecord {
  return {
    id: overrides.id ?? "pay-1",
    tenantUid: overrides.tenantUid ?? "uid-1",
    workId: overrides.workId ?? "work-1",
    amountCents: overrides.amountCents ?? 1_000,
    method: overrides.method ?? "pix",
    recordedAt: overrides.recordedAt ?? "2026-08-27T00:00:00.000Z",
    refundedTotalCents: overrides.refundedTotalCents ?? 0,
    externalChargeId: overrides.externalChargeId,
    idempotencyKey: overrides.idempotencyKey ?? "idem-1",
  };
}

function refund(overrides: Partial<ServiceRefundRecord> = {}): ServiceRefundRecord {
  return {
    id: overrides.id ?? "refund-1",
    tenantUid: overrides.tenantUid ?? "uid-1",
    workId: overrides.workId ?? "work-1",
    paymentId: overrides.paymentId ?? "pay-1",
    amountCents: overrides.amountCents ?? 1_000,
    reason: overrides.reason,
    refundedAt: overrides.refundedAt ?? "2026-08-27T00:00:00.000Z",
    idempotencyKey: overrides.idempotencyKey ?? "refund-idem-1",
  };
}

function items(input: readonly CommercialItem[]): readonly CommercialItem[] {
  return input;
}

const unknownCost: OptionalCost = { kind: "unknown" };
const knownZeroCost: OptionalCost = { kind: "known", amountCents: 0 };

assert.equal(isKnownCost(unknownCost), false);
assert.equal(isKnownCost(knownZeroCost), true);
assert.notDeepEqual(unknownCost, knownZeroCost);

const fixedPricing: ServicePricing = { mode: "fixed", priceCents: 6000 };
const startingAtPricing: ServicePricing = { mode: "starting_at", startingAtPriceCents: 6000 };
const quotePricing: ServicePricing = { mode: "quote" };
assert.equal(assertValidServicePricing(fixedPricing).mode, "fixed");
assert.equal(assertValidServicePricing(startingAtPricing).mode, "starting_at");
assert.equal(assertValidServicePricing(quotePricing).mode, "quote");

const hybridTotals = calculateCommercialTotals(items([
  {
    kind: "service",
    id: "line-service",
    snapshot: {
      sourceId: "service-1",
      capturedAt: "2026-08-27T00:00:00.000Z",
      name: "Corte",
      priceMode: "fixed",
      priceCents: 6000,
    },
    quantity: 1,
    unitPriceCents: 6000,
    lineTotalCents: 6000,
  },
  {
    kind: "product",
    id: "line-product",
    snapshot: {
      sourceId: "product-1",
      capturedAt: "2026-08-27T00:00:00.000Z",
      name: "Pomada",
      unitPriceCents: 4000,
    },
    quantity: 1,
    unitPriceCents: 4000,
    lineTotalCents: 4000,
  },
]));
assert.deepEqual(hybridTotals, {
  serviceRevenueCents: 6000,
  productRevenueCents: 4000,
  additionalRevenueCents: 0,
  discountTotalCents: 0,
  contractedTotalCents: 10000,
});

const discountedTotals = calculateCommercialTotals(items([
  {
    kind: "service",
    id: "line-service",
    snapshot: {
      sourceId: "service-1",
      capturedAt: "2026-08-27T00:00:00.000Z",
      name: "Corte",
      priceMode: "fixed",
      priceCents: 6000,
    },
    quantity: 1,
    unitPriceCents: 6000,
    lineTotalCents: 6000,
  },
  {
    kind: "product",
    id: "line-product",
    snapshot: {
      sourceId: "product-1",
      capturedAt: "2026-08-27T00:00:00.000Z",
      name: "Pomada",
      unitPriceCents: 4000,
    },
    quantity: 1,
    unitPriceCents: 4000,
    lineTotalCents: 4000,
  },
  {
    kind: "discount",
    id: "disc-1",
    label: "Promo",
    amountCents: 1000,
  },
]));

const quoteItems = items([
  {
    kind: "service" as const,
    id: "quote-service-line",
    snapshot: {
      sourceId: "service-1",
      capturedAt: "2026-08-27T00:00:00.000Z",
      name: "Corte",
      priceMode: "fixed" as const,
      priceCents: 6000,
    },
    quantity: 1,
    unitPriceCents: 6000,
    lineTotalCents: 6000,
  },
  {
    kind: "discount" as const,
    id: "quote-discount-line",
    label: "Desconto",
    amountCents: 1000,
  },
]);
const quoteTotals = calculateCommercialTotals(quoteItems);
assert.deepEqual(discountedTotals, {
  serviceRevenueCents: 6000,
  productRevenueCents: 4000,
  additionalRevenueCents: 0,
  discountTotalCents: 1000,
  contractedTotalCents: 9000,
});

assert.throws(
  () =>
    calculateCommercialTotals(items([
      {
        kind: "discount",
        id: "disc-1",
        label: "Grande demais",
        amountCents: 1000,
      },
    ])),
  (error: unknown) => error instanceof ServicesDomainError && error.code === "DISCOUNT_EXCEEDS_SUBTOTAL",
);

assert.throws(
  () => assertMoneyCents(19.5, "price"),
  (error: unknown) => error instanceof ServicesDomainError && error.code === "INVALID_MONEY_CENTS",
);

assert.throws(
  () =>
    calculateCommercialTotals(items([
      {
        kind: "additional",
        id: "extra-1",
        label: "Extra",
        quantity: 0,
        unitPriceCents: 1000,
        lineTotalCents: 0,
      },
    ])),
  (error: unknown) => error instanceof ServicesDomainError && error.code === "INVALID_QUANTITY",
);

assert.equal(assertValidServiceWorkTransition("planned", "in_progress"), "in_progress");
assert.throws(
  () => assertValidServiceWorkTransition("planned", "completed"),
  (error: unknown) => error instanceof ServicesDomainError && error.code === "INVALID_SERVICE_WORK_TRANSITION",
);

assert.deepEqual(createZeroServiceWorkFinancialSummary(), {
  grossReceivedCents: 0,
  refundedTotalCents: 0,
  netReceivedCents: 0,
});
assert.deepEqual(assertValidServiceWorkFinancialSummary(createZeroServiceWorkFinancialSummary()), {
  grossReceivedCents: 0,
  refundedTotalCents: 0,
  netReceivedCents: 0,
});
assert.throws(
  () => assertValidServiceWorkFinancialSummary({
    grossReceivedCents: 1000,
    refundedTotalCents: 1200,
    netReceivedCents: 0,
  }),
  (error: unknown) => error instanceof ServicesDomainError && error.code === "INCONSISTENT_WORK_FINANCIAL_SUMMARY",
);
assert.throws(
  () => assertValidServiceWorkFinancialSummary({
    grossReceivedCents: 1000,
    refundedTotalCents: 200,
    netReceivedCents: 900,
  }),
  (error: unknown) => error instanceof ServicesDomainError && error.code === "INCONSISTENT_WORK_FINANCIAL_SUMMARY",
);

assert.deepEqual(deriveWorkFinancials(10000, []), {
  contractedTotalCents: 10000,
  grossReceivedCents: 0,
  refundedTotalCents: 0,
  netReceivedCents: 0,
  balanceCents: 10000,
  financialStatus: "unpaid",
  refundStatus: "none",
});

assert.deepEqual(deriveWorkFinancials(10000, [payment({ amountCents: 4000 })]), {
  contractedTotalCents: 10000,
  grossReceivedCents: 4000,
  refundedTotalCents: 0,
  netReceivedCents: 4000,
  balanceCents: 6000,
  financialStatus: "partial",
  refundStatus: "none",
});

assert.deepEqual(deriveWorkFinancials(10000, [payment({ amountCents: 10000 })]), {
  contractedTotalCents: 10000,
  grossReceivedCents: 10000,
  refundedTotalCents: 0,
  netReceivedCents: 10000,
  balanceCents: 0,
  financialStatus: "paid",
  refundStatus: "none",
});

assert.deepEqual(deriveWorkFinancials(10000, [payment({ amountCents: 10000, refundedTotalCents: 2000 })]), {
  contractedTotalCents: 10000,
  grossReceivedCents: 10000,
  refundedTotalCents: 2000,
  netReceivedCents: 8000,
  balanceCents: 2000,
  financialStatus: "partial",
  refundStatus: "partial",
});

assert.deepEqual(deriveWorkFinancials(10000, [payment({ amountCents: 10000, refundedTotalCents: 10000 })]), {
  contractedTotalCents: 10000,
  grossReceivedCents: 10000,
  refundedTotalCents: 10000,
  netReceivedCents: 0,
  balanceCents: 10000,
  financialStatus: "unpaid",
  refundStatus: "full",
});

assert.deepEqual(deriveWorkFinancials(0, []), {
  contractedTotalCents: 0,
  grossReceivedCents: 0,
  refundedTotalCents: 0,
  netReceivedCents: 0,
  balanceCents: 0,
  financialStatus: "paid",
  refundStatus: "none",
});

assert.throws(
  () => deriveWorkFinancials(10000, [payment({ amountCents: 12000 })]),
  (error: unknown) => error instanceof ServicesDomainError && error.code === "OVERPAYMENT_NOT_SUPPORTED",
);

assert.deepEqual(
  deriveWorkFinancials(10000, [
    payment({ id: "pay-1", amountCents: 10000, refundedTotalCents: 2000 }),
    payment({ id: "pay-2", amountCents: 2000 }),
  ]),
  {
    contractedTotalCents: 10000,
    grossReceivedCents: 12000,
    refundedTotalCents: 2000,
    netReceivedCents: 10000,
    balanceCents: 0,
    financialStatus: "paid",
    refundStatus: "partial",
  },
);

assert.deepEqual(
  deriveWorkFinancials(10000, [
    payment({ id: "pay-1", amountCents: 10000, refundedTotalCents: 10000 }),
    payment({ id: "pay-2", amountCents: 10000 }),
  ]),
  {
    contractedTotalCents: 10000,
    grossReceivedCents: 20000,
    refundedTotalCents: 10000,
    netReceivedCents: 10000,
    balanceCents: 0,
    financialStatus: "paid",
    refundStatus: "partial",
  },
);

assert.equal(
  assertCanRegisterServicePayment(10000, [payment({ amountCents: 8000 })], 2000),
  2000,
);

assert.throws(
  () => assertCanRegisterServicePayment(10000, [payment({ amountCents: 8000 })], 3000),
  (error: unknown) => error instanceof ServicesDomainError && error.code === "OVERPAYMENT_NOT_SUPPORTED",
);

assert.throws(
  () =>
    assertCanRegisterServicePayment(
      10000,
      [payment({ amountCents: 10000, refundedTotalCents: 2000 })],
      2500,
    ),
  (error: unknown) => error instanceof ServicesDomainError && error.code === "OVERPAYMENT_NOT_SUPPORTED",
);

assert.equal(derivePaymentRefundStatus(payment({ amountCents: 10000 })), "none");
assert.equal(derivePaymentRefundStatus(payment({ amountCents: 10000, refundedTotalCents: 2000 })), "partial");
assert.equal(derivePaymentRefundStatus(payment({ amountCents: 10000, refundedTotalCents: 10000 })), "full");

assert.throws(
  () => derivePaymentRefundStatus(payment({ amountCents: 10000, refundedTotalCents: 12000 })),
  (error: unknown) => error instanceof ServicesDomainError && error.code === "REFUND_EXCEEDS_PAYMENT",
);

assert.equal(assertValidServicePaymentRecord(payment({ amountCents: 1000, refundedTotalCents: 0 })).amountCents, 1000);
assert.throws(
  () => assertValidServicePaymentRecord(payment({ amountCents: 0 })),
  (error: unknown) => error instanceof ServicesDomainError && error.code === "INVALID_PAYMENT_AMOUNT",
);
assert.throws(
  () => assertValidServicePaymentRecord(payment({ amountCents: 1000, refundedTotalCents: 1200 })),
  (error: unknown) => error instanceof ServicesDomainError && error.code === "REFUND_EXCEEDS_PAYMENT",
);

assert.equal(assertValidServiceRefundRecord(refund({ amountCents: 1000 })).amountCents, 1000);
assert.throws(
  () => assertValidServiceRefundRecord(refund({ amountCents: 0 })),
  (error: unknown) => error instanceof ServicesDomainError && error.code === "INVALID_REFUND_AMOUNT",
);

assert.deepEqual(deriveEstimatedResult(10000, { kind: "unknown" }), { kind: "unknown" });
assert.deepEqual(deriveEstimatedResult(10000, { kind: "known", amountCents: 0 }), {
  kind: "known",
  resultCents: 10000,
  marginRatio: 1,
});

const validQuoteDraft: Quote = {
  id: "quote-1",
  tenantUid: "uid-1",
  status: "draft",
  customerId: "client-1",
  draftItems: quoteItems,
  draftTotals: quoteTotals,
  draftCustomerMessage: "Mensagem",
  draftValidUntil: "2026-08-30T00:00:00.000Z",
  createdAt: "2026-08-27T00:00:00.000Z",
  updatedAt: "2026-08-27T00:00:00.000Z",
};
assert.equal(assertValidQuote(validQuoteDraft).status, "draft");

assert.throws(
  () => assertValidQuote({ ...validQuoteDraft, draftTotals: { ...quoteTotals, contractedTotalCents: 9999 } }),
  (error: unknown) => error instanceof ServicesDomainError && error.code === "INCONSISTENT_COMMERCIAL_TOTALS",
);

assert.throws(
  () => assertValidQuote({ ...validQuoteDraft, status: "accepted", acceptedAt: "2026-08-27T00:00:00.000Z" } as Quote),
  (error: unknown) => error instanceof ServicesDomainError && error.code === "INVALID_SERVICE_WORK",
);

const validQuoteVersion: QuoteVersion = {
  id: "version-1",
  tenantUid: "uid-1",
  quoteId: "quote-1",
  versionNumber: 1,
  customerId: "client-1",
  items: quoteItems,
  totals: quoteTotals,
  customerMessage: "Mensagem",
  validUntil: "2026-08-30T00:00:00.000Z",
  createdAt: "2026-08-27T00:00:00.000Z",
  sentAt: "2026-08-27T00:00:00.000Z",
};
assert.equal(assertValidQuoteVersion(validQuoteVersion).versionNumber, 1);

assert.throws(
  () => assertValidQuoteVersion({ ...validQuoteVersion, versionNumber: 0 }),
  (error: unknown) => error instanceof ServicesDomainError && error.code === "INVALID_SERVICE_WORK",
);

assert.throws(
  () => assertValidQuote({ ...validQuoteDraft, draftValidUntil: "not-an-iso-date" }),
  (error: unknown) => error instanceof ServicesDomainError && error.code === "INVALID_ISO_UTC",
);

assert.equal(isQuoteExpired("2026-08-27T00:00:00.000Z", "2026-08-27T00:00:00.001Z"), true);
assert.equal(isQuoteExpired("2026-08-30T00:00:00.000Z", "2026-08-27T00:00:00.001Z"), false);

const normalizedLegacyWork = normalizeServiceWorkDocument({
  id: "legacy-work",
  tenantUid: "uid-1",
  status: "planned",
  origin: "manual",
  items: [],
  totals: {
    serviceRevenueCents: 0,
    productRevenueCents: 0,
    additionalRevenueCents: 0,
    discountTotalCents: 0,
    contractedTotalCents: 0,
  },
  cost: { kind: "unknown" },
  createdAt: "2026-08-27T00:00:00.000Z",
  updatedAt: "2026-08-27T00:00:00.000Z",
});
assert.deepEqual(normalizedLegacyWork.financialSummary, createZeroServiceWorkFinancialSummary());
assert.equal(deriveServiceWorkFinancials(normalizedLegacyWork).financialStatus, "paid");

assert.equal(
  assertValidServiceWork({
    id: "work-quote",
    tenantUid: "uid-1",
    status: "planned",
    origin: "quote",
    customerId: "client-1",
    sourceQuoteId: "quote-1",
    sourceQuoteVersionId: "version-1",
    items: quoteItems,
    totals: quoteTotals,
    financialSummary: createZeroServiceWorkFinancialSummary(),
    cost: { kind: "unknown" },
    createdAt: "2026-08-27T00:00:00.000Z",
    updatedAt: "2026-08-27T00:00:00.000Z",
  }).origin,
  "quote",
);

assert.throws(
  () => assertValidServiceWork({
    id: "work-quote-missing-ref",
    tenantUid: "uid-1",
    status: "planned",
    origin: "quote",
    items: quoteItems,
    totals: quoteTotals,
    financialSummary: createZeroServiceWorkFinancialSummary(),
    cost: { kind: "unknown" },
    createdAt: "2026-08-27T00:00:00.000Z",
    updatedAt: "2026-08-27T00:00:00.000Z",
  } as any),
  (error: unknown) => error instanceof ServicesDomainError && error.code === "INVALID_SERVICE_WORK",
);

assert.throws(
  () => assertValidServiceWork({
    id: "work-manual-with-ref",
    tenantUid: "uid-1",
    status: "planned",
    origin: "manual",
    sourceQuoteId: "quote-1",
    sourceQuoteVersionId: "version-1",
    items: quoteItems,
    totals: quoteTotals,
    financialSummary: createZeroServiceWorkFinancialSummary(),
    cost: { kind: "unknown" },
    createdAt: "2026-08-27T00:00:00.000Z",
    updatedAt: "2026-08-27T00:00:00.000Z",
  } as any),
  (error: unknown) => error instanceof ServicesDomainError && error.code === "INVALID_SERVICE_WORK",
);

console.log("Services domain tests passed.");
