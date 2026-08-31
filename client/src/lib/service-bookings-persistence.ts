import { collection, doc, getDoc, getDocs, getFirestore, orderBy, query, where } from "firebase/firestore";
import { assertValidBooking, assertValidBookingHold, type Booking, type BookingHold } from "@shared/service-bookings";
import { getCurrentFirebaseUser } from "./firebase";

/**
 * SERV-BOOK-01 — leitura somente-leitura para BookingHold/Booking, mesmo padrão de
 * client/src/lib/service-payments-persistence.ts: nenhum create/update/delete aqui. ScheduleLock e a
 * coleção de idempotência nunca são expostas ao client (nem para leitura) — ver firestore.rules.
 */
function requireCurrentUid(): string {
  const uid = getCurrentFirebaseUser()?.uid;
  if (!uid) throw new Error("UNAUTHENTICATED");
  return uid;
}

function bookingHoldsCollection(uid: string) {
  return collection(getFirestore(), "users", uid, "bookingHolds");
}
function bookingsCollection(uid: string) {
  return collection(getFirestore(), "users", uid, "bookings");
}

function parseHold(value: unknown): BookingHold {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("INVALID_BOOKING_HOLD");
  return assertValidBookingHold(value as BookingHold);
}
function parseBooking(value: unknown): Booking {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("INVALID_BOOKING");
  return assertValidBooking(value as Booking);
}

export async function getServiceBookingHold(holdId: string): Promise<BookingHold | null> {
  const uid = requireCurrentUid();
  const snapshot = await getDoc(doc(bookingHoldsCollection(uid), holdId));
  return snapshot.exists() ? parseHold(snapshot.data()) : null;
}

export async function listServiceBookingHolds(): Promise<BookingHold[]> {
  const uid = requireCurrentUid();
  const snapshot = await getDocs(query(bookingHoldsCollection(uid), orderBy("createdAt", "desc")));
  return snapshot.docs.map((item) => parseHold(item.data()));
}

export async function getServiceBooking(bookingId: string): Promise<Booking | null> {
  const uid = requireCurrentUid();
  const snapshot = await getDoc(doc(bookingsCollection(uid), bookingId));
  return snapshot.exists() ? parseBooking(snapshot.data()) : null;
}

export async function listServiceBookings(): Promise<Booking[]> {
  const uid = requireCurrentUid();
  const snapshot = await getDocs(query(bookingsCollection(uid), orderBy("createdAt", "desc")));
  return snapshot.docs.map((item) => parseBooking(item.data()));
}

/** SERV-UI-03 — a tela de atendimento recebe só um workId (rota /servicos/atendimentos/:workId) e precisa
 * descobrir se existe um Booking ligado a ele, para decidir se o cancelamento deve passar pelo fluxo de
 * Booking (libera locks corretamente, §9) em vez de cancelar o Work isoladamente. Equality-only em `workId`
 * não exige índice composto novo (Firestore mantém índice single-field automático para esse caso). */
export async function listServiceBookingsForWork(workId: string): Promise<Booking[]> {
  const uid = requireCurrentUid();
  const snapshot = await getDocs(query(bookingsCollection(uid), where("workId", "==", workId)));
  return snapshot.docs.map((item) => parseBooking(item.data()));
}

/** SERV-UI-01 §18/§19 — leitura da Agenda: limitada por resource + range temporal (nunca o histórico
 * inteiro), reaproveitando a mesma coleção/Rules já existentes (nenhum endpoint novo, nenhuma escrita).
 * `startAt` é indexado (firestore.indexes.json: bookings resourceId+startAt) para este range funcionar
 * sem scan da coleção inteira. */
export async function listServiceBookingsForResourceAndRange(
  resourceId: string,
  rangeStartAt: string,
  rangeEndAt: string,
): Promise<Booking[]> {
  const uid = requireCurrentUid();
  const snapshot = await getDocs(query(
    bookingsCollection(uid),
    where("resourceId", "==", resourceId),
    where("startAt", ">=", rangeStartAt),
    where("startAt", "<", rangeEndAt),
  ));
  return snapshot.docs.map((item) => parseBooking(item.data()));
}
