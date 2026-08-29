import {
  collection,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  orderBy,
  query,
} from "firebase/firestore";
import {
  assertValidServicePaymentRecord,
  assertValidServiceRefundRecord,
  type ServicePaymentRecord,
  type ServiceRefundRecord,
} from "@shared/services";
import { getCurrentFirebaseUser } from "./firebase";

function requireCurrentUid(): string {
  const uid = getCurrentFirebaseUser()?.uid;
  if (!uid) throw new Error("UNAUTHENTICATED");
  return uid;
}

function paymentsCollection(uid: string, workId: string) {
  return collection(getFirestore(), "users", uid, "serviceWorks", workId, "payments");
}

function refundsCollection(uid: string, workId: string, paymentId: string) {
  return collection(getFirestore(), "users", uid, "serviceWorks", workId, "payments", paymentId, "refunds");
}

function parsePayment(value: unknown): ServicePaymentRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("INVALID_SERVICE_PAYMENT");
  }
  return assertValidServicePaymentRecord(value as ServicePaymentRecord);
}

function parseRefund(value: unknown): ServiceRefundRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("INVALID_SERVICE_REFUND");
  }
  return assertValidServiceRefundRecord(value as ServiceRefundRecord);
}

export async function getServicePayment(workId: string, paymentId: string): Promise<ServicePaymentRecord | null> {
  const uid = requireCurrentUid();
  const snapshot = await getDoc(doc(paymentsCollection(uid, workId), paymentId));
  return snapshot.exists() ? parsePayment(snapshot.data()) : null;
}

export async function listServicePayments(workId: string): Promise<ServicePaymentRecord[]> {
  const uid = requireCurrentUid();
  const snapshot = await getDocs(query(paymentsCollection(uid, workId), orderBy("recordedAt", "desc")));
  return snapshot.docs.map((item) => parsePayment(item.data()));
}

export async function getServiceRefund(workId: string, paymentId: string, refundId: string): Promise<ServiceRefundRecord | null> {
  const uid = requireCurrentUid();
  const snapshot = await getDoc(doc(refundsCollection(uid, workId, paymentId), refundId));
  return snapshot.exists() ? parseRefund(snapshot.data()) : null;
}

export async function listServiceRefunds(workId: string, paymentId: string): Promise<ServiceRefundRecord[]> {
  const uid = requireCurrentUid();
  const snapshot = await getDocs(query(refundsCollection(uid, workId, paymentId), orderBy("refundedAt", "desc")));
  return snapshot.docs.map((item) => parseRefund(item.data()));
}
