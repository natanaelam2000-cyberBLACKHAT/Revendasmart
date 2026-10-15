import { collection, doc, getDoc, getDocs, getFirestore, query, where } from "firebase/firestore";
import {
  assertValidAvailabilityBlock,
  assertValidServiceResourceSchedule,
  type ServiceAvailabilityBlock,
  type ServiceResourceSchedule,
} from "@shared/service-availability";
import { getCurrentFirebaseUser } from "./firebase";

/**
 * SERV-AVAIL-01 — leitura somente-leitura, mesmo padrão de client/src/lib/service-bookings-persistence.ts:
 * nenhum create/update/delete aqui (as mutações passam sempre por service-availability-commands.ts, que
 * chama o servidor). scheduleLocks e a coleção de idempotência nunca são expostos ao client — ver
 * firestore.rules.
 */
function requireCurrentUid(): string {
  const uid = getCurrentFirebaseUser()?.uid;
  if (!uid) throw new Error("UNAUTHENTICATED");
  return uid;
}

function resourceSchedulesCollection(uid: string) {
  return collection(getFirestore(), "users", uid, "serviceResourceSchedules");
}
function availabilityBlocksCollection(uid: string) {
  return collection(getFirestore(), "users", uid, "serviceAvailabilityBlocks");
}

function parseSchedule(value: unknown): ServiceResourceSchedule {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("INVALID_RESOURCE_SCHEDULE");
  return assertValidServiceResourceSchedule(value as ServiceResourceSchedule);
}
function parseBlock(value: unknown): ServiceAvailabilityBlock {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("INVALID_AVAILABILITY_BLOCK");
  return assertValidAvailabilityBlock(value as ServiceAvailabilityBlock);
}

export async function getServiceResourceSchedule(resourceId: string): Promise<ServiceResourceSchedule | null> {
  const uid = requireCurrentUid();
  const snapshot = await getDoc(doc(resourceSchedulesCollection(uid), resourceId));
  return snapshot.exists() ? parseSchedule(snapshot.data()) : null;
}

export async function listServiceAvailabilityBlocksForResource(resourceId: string): Promise<ServiceAvailabilityBlock[]> {
  const uid = requireCurrentUid();
  const snapshot = await getDocs(query(availabilityBlocksCollection(uid), where("resourceId", "==", resourceId)));
  return snapshot.docs.map((item) => parseBlock(item.data()));
}
