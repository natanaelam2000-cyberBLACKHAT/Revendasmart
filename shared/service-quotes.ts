import {
  ServicesDomainError,
  assertEntityId,
  assertIsoUtcString,
  assertUid,
  assertValidCommercialItem,
  calculateCommercialTotals,
  type CommercialItem,
  type CommercialTotals,
  type EntityId,
  type IsoUtcString,
  type Uid,
} from "./services";

export type QuoteStatus = "draft" | "sent" | "accepted" | "rejected" | "cancelled";

export type Quote = {
  readonly id: EntityId;
  readonly tenantUid: Uid;
  readonly status: QuoteStatus;
  readonly customerId?: EntityId;
  readonly draftItems: readonly CommercialItem[];
  readonly draftTotals: CommercialTotals;
  readonly draftCustomerMessage?: string;
  readonly draftValidUntil?: IsoUtcString;
  readonly currentVersionId?: EntityId;
  readonly currentVersionNumber?: number;
  readonly acceptedVersionId?: EntityId;
  readonly convertedWorkId?: EntityId;
  readonly createdAt: IsoUtcString;
  readonly updatedAt: IsoUtcString;
  readonly lastSentAt?: IsoUtcString;
  readonly acceptedAt?: IsoUtcString;
  readonly rejectedAt?: IsoUtcString;
  readonly cancelledAt?: IsoUtcString;
};

export type QuoteVersion = {
  readonly id: EntityId;
  readonly tenantUid: Uid;
  readonly quoteId: EntityId;
  readonly versionNumber: number;
  readonly customerId?: EntityId;
  readonly items: readonly CommercialItem[];
  readonly totals: CommercialTotals;
  readonly customerMessage?: string;
  readonly validUntil?: IsoUtcString;
  readonly createdAt: IsoUtcString;
  readonly sentAt: IsoUtcString;
};

function assertQuoteStatus(status: QuoteStatus): QuoteStatus {
  if (!["draft", "sent", "accepted", "rejected", "cancelled"].includes(status)) {
    throw new ServicesDomainError("INVALID_SERVICE_WORK", `quote.status is invalid: ${String(status)}`);
  }
  return status;
}

function assertOptionalEntityId(value: string | undefined, fieldName: string): void {
  if (typeof value !== "undefined") {
    assertEntityId(value, fieldName);
  }
}

function assertOptionalIso(value: string | undefined, fieldName: string): void {
  if (typeof value !== "undefined") {
    assertIsoUtcString(value, fieldName);
  }
}

function assertOptionalShortText(value: string | undefined, fieldName: string, maxLength: number): void {
  if (typeof value !== "undefined" && (typeof value !== "string" || value.length > maxLength)) {
    throw new ServicesDomainError("INVALID_SERVICE_WORK", `${fieldName} must be a string up to ${maxLength} characters.`);
  }
}

function assertQuoteTotals(items: readonly CommercialItem[], totals: CommercialTotals, fieldName: string): void {
  for (const item of items) {
    assertValidCommercialItem(item);
  }
  const calculated = calculateCommercialTotals(items);
  if (
    totals.serviceRevenueCents !== calculated.serviceRevenueCents
    || totals.productRevenueCents !== calculated.productRevenueCents
    || totals.additionalRevenueCents !== calculated.additionalRevenueCents
    || totals.discountTotalCents !== calculated.discountTotalCents
    || totals.contractedTotalCents !== calculated.contractedTotalCents
  ) {
    throw new ServicesDomainError("INCONSISTENT_COMMERCIAL_TOTALS", `${fieldName} must be recalculated from items.`);
  }
}

function assertQuoteVersionNumber(value: number, fieldName: string): number {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 1 || value > 100_000) {
    throw new ServicesDomainError("INVALID_SERVICE_WORK", `${fieldName} must be a positive integer.`);
  }
  return value;
}

export function isQuoteExpired(validUntil: IsoUtcString | undefined, now: IsoUtcString): boolean {
  if (!validUntil) return false;
  return Date.parse(now) > Date.parse(validUntil);
}

export function assertValidQuote(quote: Quote): Quote {
  assertEntityId(quote.id, "quote.id");
  assertUid(quote.tenantUid, "quote.tenantUid");
  assertQuoteStatus(quote.status);
  assertOptionalEntityId(quote.customerId, "quote.customerId");
  if (!Array.isArray(quote.draftItems) || quote.draftItems.length > 100) {
    throw new ServicesDomainError("INVALID_SERVICE_WORK", "quote.draftItems must be an array with up to 100 items.");
  }
  assertQuoteTotals(quote.draftItems, quote.draftTotals, "quote.draftTotals");
  assertOptionalShortText(quote.draftCustomerMessage, "quote.draftCustomerMessage", 4000);
  assertOptionalIso(quote.draftValidUntil, "quote.draftValidUntil");
  assertOptionalEntityId(quote.currentVersionId, "quote.currentVersionId");
  if (typeof quote.currentVersionNumber !== "undefined") {
    assertQuoteVersionNumber(quote.currentVersionNumber, "quote.currentVersionNumber");
  }
  assertOptionalEntityId(quote.acceptedVersionId, "quote.acceptedVersionId");
  assertOptionalEntityId(quote.convertedWorkId, "quote.convertedWorkId");
  assertIsoUtcString(quote.createdAt, "quote.createdAt");
  assertIsoUtcString(quote.updatedAt, "quote.updatedAt");
  assertOptionalIso(quote.lastSentAt, "quote.lastSentAt");
  assertOptionalIso(quote.acceptedAt, "quote.acceptedAt");
  assertOptionalIso(quote.rejectedAt, "quote.rejectedAt");
  assertOptionalIso(quote.cancelledAt, "quote.cancelledAt");

  const hasCurrentVersion = typeof quote.currentVersionId !== "undefined" || typeof quote.currentVersionNumber !== "undefined";
  if (hasCurrentVersion && (!quote.currentVersionId || typeof quote.currentVersionNumber === "undefined")) {
    throw new ServicesDomainError("INVALID_SERVICE_WORK", "quote.currentVersionId and quote.currentVersionNumber must be present together.");
  }
  if (typeof quote.acceptedVersionId !== "undefined" && !quote.currentVersionId) {
    throw new ServicesDomainError("INVALID_SERVICE_WORK", "quote.acceptedVersionId requires quote.currentVersionId.");
  }
  if (typeof quote.convertedWorkId !== "undefined" && typeof quote.acceptedVersionId === "undefined") {
    throw new ServicesDomainError("INVALID_SERVICE_WORK", "quote.convertedWorkId requires quote.acceptedVersionId.");
  }

  if (quote.status === "draft") {
    if (quote.acceptedAt || quote.rejectedAt || quote.cancelledAt || quote.acceptedVersionId || quote.convertedWorkId) {
      throw new ServicesDomainError("INVALID_SERVICE_WORK", "draft quote cannot contain terminal lifecycle fields.");
    }
  } else if (quote.status === "sent") {
    if (!quote.currentVersionId || typeof quote.currentVersionNumber === "undefined" || !quote.lastSentAt) {
      throw new ServicesDomainError("INVALID_SERVICE_WORK", "sent quote must contain currentVersionId/currentVersionNumber/lastSentAt.");
    }
    if (quote.acceptedAt || quote.rejectedAt || quote.cancelledAt || quote.acceptedVersionId || quote.convertedWorkId) {
      throw new ServicesDomainError("INVALID_SERVICE_WORK", "sent quote cannot contain terminal lifecycle fields.");
    }
  } else if (quote.status === "accepted") {
    if (!quote.currentVersionId || typeof quote.currentVersionNumber === "undefined" || !quote.lastSentAt) {
      throw new ServicesDomainError("INVALID_SERVICE_WORK", "accepted quote must preserve the current sent version.");
    }
    if (!quote.acceptedVersionId || !quote.acceptedAt || quote.rejectedAt || quote.cancelledAt) {
      throw new ServicesDomainError("INVALID_SERVICE_WORK", "accepted quote must contain acceptedVersionId/acceptedAt only.");
    }
  } else if (quote.status === "rejected") {
    if (!quote.currentVersionId || typeof quote.currentVersionNumber === "undefined" || !quote.lastSentAt) {
      throw new ServicesDomainError("INVALID_SERVICE_WORK", "rejected quote must preserve the rejected sent version.");
    }
    if (!quote.rejectedAt || quote.acceptedAt || quote.cancelledAt || quote.acceptedVersionId || quote.convertedWorkId) {
      throw new ServicesDomainError("INVALID_SERVICE_WORK", "rejected quote must contain rejectedAt only.");
    }
  } else if (quote.status === "cancelled") {
    if (!quote.cancelledAt || quote.acceptedAt || quote.rejectedAt || quote.acceptedVersionId || quote.convertedWorkId) {
      throw new ServicesDomainError("INVALID_SERVICE_WORK", "cancelled quote must contain cancelledAt only.");
    }
  }

  return quote;
}

export function assertValidQuoteVersion(version: QuoteVersion): QuoteVersion {
  assertEntityId(version.id, "quoteVersion.id");
  assertUid(version.tenantUid, "quoteVersion.tenantUid");
  assertEntityId(version.quoteId, "quoteVersion.quoteId");
  assertQuoteVersionNumber(version.versionNumber, "quoteVersion.versionNumber");
  assertOptionalEntityId(version.customerId, "quoteVersion.customerId");
  if (!Array.isArray(version.items) || version.items.length > 100) {
    throw new ServicesDomainError("INVALID_SERVICE_WORK", "quoteVersion.items must be an array with up to 100 items.");
  }
  assertQuoteTotals(version.items, version.totals, "quoteVersion.totals");
  assertOptionalShortText(version.customerMessage, "quoteVersion.customerMessage", 4000);
  assertOptionalIso(version.validUntil, "quoteVersion.validUntil");
  assertIsoUtcString(version.createdAt, "quoteVersion.createdAt");
  assertIsoUtcString(version.sentAt, "quoteVersion.sentAt");
  return version;
}
