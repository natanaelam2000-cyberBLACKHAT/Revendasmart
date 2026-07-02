/**
 * Client-side migration utilities for reading legacy data
 * Safely reads from localStorage and IndexedDB without modifying them
 */

/**
 * Read all products from localStorage for current user
 */
export async function readProductsFromStorage(userId: string): Promise<any[]> {
  try {
    const key = `rs:${userId}:products`;
    const stored = localStorage.getItem(key);
    if (!stored) return [];
    
    const products = JSON.parse(stored);
    return Array.isArray(products) ? products : [];
  } catch (e) {
    console.error("[migration-utils] Error reading products:", e);
    return [];
  }
}

/**
 * Read all clients from localStorage for current user
 */
export async function readClientsFromStorage(userId: string): Promise<any[]> {
  try {
    const key = `rs:${userId}:clients`;
    const stored = localStorage.getItem(key);
    if (!stored) return [];
    
    const clients = JSON.parse(stored);
    return Array.isArray(clients) ? clients : [];
  } catch (e) {
    console.error("[migration-utils] Error reading clients:", e);
    return [];
  }
}

/**
 * Read all sales from localStorage for current user
 */
export async function readSalesFromStorage(userId: string): Promise<any[]> {
  try {
    const key = `rs:${userId}:sales`;
    const stored = localStorage.getItem(key);
    if (!stored) return [];
    
    const sales = JSON.parse(stored);
    return Array.isArray(sales) ? sales : [];
  } catch (e) {
    console.error("[migration-utils] Error reading sales:", e);
    return [];
  }
}

/**
 * Read all installments from localStorage for current user
 */
export async function readInstallmentsFromStorage(userId: string): Promise<any[]> {
  try {
    const key = `rs:${userId}:installments`;
    const stored = localStorage.getItem(key);
    if (!stored) return [];
    
    const installments = JSON.parse(stored);
    return Array.isArray(installments) ? installments : [];
  } catch (e) {
    console.error("[migration-utils] Error reading installments:", e);
    return [];
  }
}

/**
 * Read all posts from localStorage for current user
 */
export async function readPostsFromStorage(userId: string): Promise<any[]> {
  try {
    const key = `rs:${userId}:posts`;
    const stored = localStorage.getItem(key);
    if (!stored) return [];
    
    const posts = JSON.parse(stored);
    return Array.isArray(posts) ? posts : [];
  } catch (e) {
    console.error("[migration-utils] Error reading posts:", e);
    return [];
  }
}

/**
 * Read settings from localStorage for current user
 */
export async function readSettingsFromStorage(userId: string): Promise<any> {
  try {
    const key = `rs:${userId}:settings`;
    const stored = localStorage.getItem(key);
    if (!stored) return {};
    
    return JSON.parse(stored);
  } catch (e) {
    console.error("[migration-utils] Error reading settings:", e);
    return {};
  }
}

/**
 * List all image IDs available in IndexedDB
 */
export async function listImagesFromIndexedDB(): Promise<string[]> {
  return new Promise((resolve) => {
    try {
      const request = indexedDB.open("RevendaSmartImages", 1);
      
      request.onerror = () => {
        console.error("[migration-utils] IndexedDB open error");
        resolve([]);
      };
      
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction("images", "readonly");
        const store = tx.objectStore("images");
        const getAllRequest = store.getAllKeys();
        
        getAllRequest.onsuccess = () => {
          const keys = getAllRequest.result as string[];
          resolve(keys);
        };
        
        getAllRequest.onerror = () => {
          console.error("[migration-utils] getAllKeys error");
          resolve([]);
        };
      };
    } catch (e) {
      console.error("[migration-utils] IndexedDB error:", e);
      resolve([]);
    }
  });
}

/**
 * Read a single image from IndexedDB
 */
export async function readImageFromIndexedDB(imageId: string): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      const request = indexedDB.open("RevendaSmartImages", 1);
      
      request.onerror = () => resolve(null);
      
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction("images", "readonly");
        const store = tx.objectStore("images");
        const getRequest = store.get(imageId);
        
        getRequest.onsuccess = () => {
          resolve(getRequest.result || null);
        };
        
        getRequest.onerror = () => resolve(null);
      };
    } catch (e) {
      console.error("[migration-utils] Error reading image:", e);
      resolve(null);
    }
  });
}

/**
 * Get all images from IndexedDB
 */
export async function readAllImagesFromIndexedDB(): Promise<{ [imageId: string]: string }> {
  const imageIds = await listImagesFromIndexedDB();
  const result: { [imageId: string]: string } = {};

  for (const imageId of imageIds) {
    const base64 = await readImageFromIndexedDB(imageId);
    if (base64) {
      result[imageId] = base64;
    }
  }

  return result;
}

/**
 * Calculate total size of all legacy data
 */
export async function estimateLegacyDataSize(userId: string): Promise<{
  localStorage: number;
  indexedDB: number;
  total: number;
}> {
  let localStorageSize = 0;
  let indexedDBSize = 0;

  // Estimate localStorage
  const keys = [
    `rs:${userId}:products`,
    `rs:${userId}:clients`,
    `rs:${userId}:sales`,
    `rs:${userId}:installments`,
    `rs:${userId}:posts`,
    `rs:${userId}:settings`,
  ];

  for (const key of keys) {
    const value = localStorage.getItem(key);
    if (value) {
      localStorageSize += value.length * 2; // UTF-16 encoding
    }
  }

  // Estimate IndexedDB
  const images = await readAllImagesFromIndexedDB();
  for (const base64 of Object.values(images)) {
    indexedDBSize += base64.length * 0.75; // Approximate binary size
  }

  return {
    localStorage: localStorageSize,
    indexedDB: indexedDBSize,
    total: localStorageSize + indexedDBSize,
  };
}

/**
 * Generate a summary of all legacy data
 */
export async function summarizeLegacyData(userId: string): Promise<{
  products: number;
  clients: number;
  sales: number;
  installments: number;
  posts: number;
  images: number;
  dataSize: { localStorage: number; indexedDB: number; total: number };
}> {
  const [products, clients, sales, installments, posts, images, dataSize] = await Promise.all([
    readProductsFromStorage(userId),
    readClientsFromStorage(userId),
    readSalesFromStorage(userId),
    readInstallmentsFromStorage(userId),
    readPostsFromStorage(userId),
    listImagesFromIndexedDB(),
    estimateLegacyDataSize(userId),
  ]);

  return {
    products: products.length,
    clients: clients.length,
    sales: sales.length,
    installments: installments.length,
    posts: posts.length,
    images: images.length,
    dataSize,
  };
}
