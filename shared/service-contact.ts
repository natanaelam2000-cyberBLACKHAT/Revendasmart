/** Contact declared at booking time; not verified identity. Never inferred for legacy records. */
export type BookingContactSnapshot = {
  readonly name: string;
  readonly phone: string;
};

export function assertValidBookingContactSnapshot(value: unknown): BookingContactSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("INVALID_BOOKING_CONTACT_SNAPSHOT");
  const contact = value as Record<string, unknown>;
  if (Object.keys(contact).some((key) => key !== "name" && key !== "phone") ||
      typeof contact.name !== "string" || !contact.name.trim() || contact.name.length > 140 ||
      typeof contact.phone !== "string" || !contact.phone.trim() || contact.phone.length > 40) {
    throw new Error("INVALID_BOOKING_CONTACT_SNAPSHOT");
  }
  return value as BookingContactSnapshot;
}

/** Legacy fallback is the current CRM name, never an internal customer identifier. */
export function bookingContactName(
  record: { readonly customerId?: string; readonly customerContactSnapshot?: BookingContactSnapshot },
  clientNames: ReadonlyMap<string, string>,
): string {
  return record.customerContactSnapshot?.name ||
    (record.customerId ? clientNames.get(record.customerId) : undefined) ||
    "Contato não disponível nesta reserva";
}
