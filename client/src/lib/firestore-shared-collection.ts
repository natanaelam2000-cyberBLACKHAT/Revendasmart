/**
 * RELEASE-QUALITY-02 §1 — wrapper fino de `subscribeShared` (shared-subscription.ts) para
 * `users/{uid}/{collectionName}`. Cada chamada com o MESMO `uid`+`collectionName` reutiliza o mesmo
 * `onSnapshot` real por baixo — múltiplos hooks (ex.: dashboard + catalog + reports lendo "products" ao
 * mesmo tempo) passam a abrir 1 listener em vez de 1 por consumer.
 */
import { collection, getFirestore, onSnapshot } from "firebase/firestore";
import { subscribeShared } from "./shared-subscription";

export interface SharedCollectionSnapshot<T> {
  readonly data: T[];
  readonly error?: string;
}

export function subscribeSharedUserCollection<T>(
  collectionName: string,
  uid: string,
  mapDoc: (id: string, data: Record<string, unknown>) => T,
  onUpdate: (snapshot: SharedCollectionSnapshot<T>) => void,
): () => void {
  const key = `users/${uid}/${collectionName}`;
  return subscribeShared<SharedCollectionSnapshot<T>>(
    key,
    (onData) =>
      onSnapshot(
        collection(getFirestore(), "users", uid, collectionName),
        (snapshot) => {
          const data = snapshot.docs.map((docSnapshot) => mapDoc(docSnapshot.id, docSnapshot.data()));
          onData({ data });
        },
        (err) => {
          console.error(`[sharedCollection:${collectionName}] error:`, err);
          onData({ data: [], error: `Failed to load ${collectionName}` });
        },
      ),
    onUpdate,
  );
}
