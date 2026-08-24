const IMAGE_DB_NAME = "RevendaSmartImages";
const IMAGE_STORE_NAME = "images";

type LocalProduct = { imageId?: unknown };

async function deleteOwnedImageRecords(imageIds: string[]): Promise<void> {
  if (typeof indexedDB === "undefined" || imageIds.length === 0) return;
  await new Promise<void>((resolve) => {
    const open = indexedDB.open(IMAGE_DB_NAME, 1);
    open.onerror = () => resolve();
    open.onupgradeneeded = () => {
      if (!open.result.objectStoreNames.contains(IMAGE_STORE_NAME)) open.result.createObjectStore(IMAGE_STORE_NAME);
    };
    open.onsuccess = () => {
      const db = open.result;
      const transaction = db.transaction(IMAGE_STORE_NAME, "readwrite");
      const store = transaction.objectStore(IMAGE_STORE_NAME);
      imageIds.forEach((id) => store.delete(id));
      transaction.oncomplete = () => { db.close(); resolve(); };
      transaction.onerror = () => { db.close(); resolve(); };
    };
  });
}

/** Clears only data attributable to this account; never clears shared browser storage. */
export async function clearScopedAccountLocalData(uid: string): Promise<void> {
  if (typeof window === "undefined") return;
  const prefix = `rs:${uid}:`;
  const imageIds: string[] = [];
  try {
    const products = JSON.parse(window.localStorage.getItem(`${prefix}products`) ?? "[]") as LocalProduct[];
    for (const product of Array.isArray(products) ? products : []) {
      if (typeof product.imageId === "string" && product.imageId) imageIds.push(product.imageId);
    }
  } catch {
    // A corrupt cache must not prevent removal of the remaining scoped data.
  }

  await deleteOwnedImageRecords(Array.from(new Set(imageIds)));
  for (const key of Object.keys(window.localStorage)) {
    if (key.startsWith(prefix)) window.localStorage.removeItem(key);
  }
}

/** Backward-compatible alias for account deletion callers. */
export async function clearDeletedAccountLocalData(uid: string): Promise<void> {
  await clearScopedAccountLocalData(uid);
}
