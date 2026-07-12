import { notifyWarning } from "@/lib/notify";

export type Category = string;
/** Brand agora é string livre — suporta marcas pré-definidas e digitadas manualmente */
export type Brand = string;

export interface Product {
  id: string;
  name: string;
  brand: Brand;
  origin?: string;
  category: Category;
  /** Tipo de nicho do produto — usado quando o usuário tem múltiplos tipos de negócio */
  productType?: string;
  costPrice: number;
  salePrice: number;
  stock: number;
  imageUrl?: string;
  storagePath?: string;
  thumbnailUrl?: string;
  thumbnailStoragePath?: string;
  imageId?: string;
  description?: string;
  gender?: string;
  lastSoldDate?: string;
  extras?: Record<string, any>;
  isFeatured?: boolean;
  isOnSale?: boolean;
  discountPercent?: number;
}

// IndexedDB for Images
const DB_NAME = 'RevendaSmartImages';
const DB_VERSION = 1;
const STORE_NAME = 'images';

export const initImageDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

export const saveImage = async (id: string, base64: string): Promise<void> => {
  try {
    const db = await initImageDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.put(base64, id);
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) {
    console.error('Error saving image to IndexedDB', e);
  }
};

export const getImage = async (id: string): Promise<string | null> => {
  try {
    const db = await initImageDB();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(id);
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  } catch (e) {
    console.error('Error getting image from IndexedDB', e);
    return null;
  }
};

export const deleteImage = async (id: string): Promise<void> => {
  try {
    const db = await initImageDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.delete(id);
  } catch (e) {
    console.error('Error deleting image from IndexedDB', e);
  }
};

// Helper para normalizar imagem do produto
export const getProductImage = (product: Product | any): string | null => {
  if (!product) return null;
  const img = product.imageUrl || product.photoUrl || product.image || product.photo || product.thumbnailUrl || '';
  return img && typeof img === 'string' && img.trim() !== '' ? img : null;
};

export interface Client {
  id: string;
  name: string;
  phone: string;
  email?: string;
  notes?: string;
}

export interface Installment {
  id: string;
  saleId: string;
  clientId: string;
  amount: number;
  dueDate: string;
  status: 'pending' | 'paid' | 'partial';
  paidAmount: number;
}

export interface Sale {
  id: string;
  clientId: string;
  clientName?: string;
  products: { productId: string; quantity: number; price: number }[];
  totalPrice: number;
  paymentType: 'cash' | 'installments' | 'avista' | 'prazo';
  legacyPaymentType?: 'cash' | 'installments';
  paymentMethod?: 'pix' | 'dinheiro' | 'credito' | 'debito' | null;
  downPayment?: number;
  downPaymentMethod?: 'pix' | 'dinheiro' | 'credito' | 'debito' | null;
  installments?: number;
  subtotal?: number;
  discountType?: 'fixed' | 'percent';
  discountValue?: number;
  discountAmount?: number;
  total?: number;
  date: string;
}

export interface ScheduledPost {
  id: string;
  productId: string;
  content: string;
  scheduledDate: string;
  platform: 'whatsapp' | 'instagram' | 'facebook';
  status: 'pending' | 'posted';
}

export interface User {
  id: string;
  email: string;
  password: string;
  storeName: string;
  createdAt: string;
}

export interface AppSettings {
  storeName: string;
  sellerName: string;
  phone: string;
  whatsapp: string;
  instagram: string;
  address: string;
  storeLogo: string;
  primaryColor: string;
  watermarkText: string;
  pixKey: string;
  bankName: string;
  paymentLink: string;
  allowInstallments: boolean;
  templateReminder: string;
  templateReceived: string;
  templateThanks: string;
  lowStockThreshold: number;
  monthlyGoal?: number;
  appTheme?: string;
  appThemeCustomization?: {
    primaryColor?: string;
    buttonTone?: string;
    cardTone?: string;
    shadowIntensity?: string;
    radius?: string;
    motion?: string;
  };
  customCategoriesByNicho?: Record<string, string[]>;
  onboarding_theme_selected?: boolean;
  onboarding_categories_configured?: boolean;
  onboarding_current_step?: number;
  onboarding_skipped?: boolean;
  onboarding_skipped_at?: string;
  onboarding_completed_at?: string;
  onboarding_continued_later_at?: string;
  enablePublicCatalog: boolean;
  showPrice: boolean;
  showStock: boolean;
  allowWhatsappOrders: boolean;
  /** Legado: tipo de negócio principal (mantido para backward compat) */
  businessType: string;
  /** Novo: array de tipos de negócio (suporta múltiplos nichos) */
  businessTypes?: string[];
  /** Futuro-proof: nomes de loja específicos por nicho (ex: { "Roupas": "Boutique Bella", "Cosméticos & Perfumes": "Beleza da Adri" }) */
  storeNamesByNicho?: Record<string, string>;
  catalogSlug: string;
  /** Campo legado mantido para leitura de documentos antigos. */
  catalog_slug?: string;
  onboarding_completed?: boolean;
  disablePublicCatalog?: boolean;
  referralMessage?: string;
  referral_conversions?: number;
  last_referral_conversion_at?: string;
  reward_eligible_conversions?: number;
  reward_granted_count?: number;
  reward_last_granted_at?: string;
  notification_settings?: any;
  marketing_settings?: any;
}

// Global Auth Keys
const AUTH_KEYS = {
  USERS: 'rs:users',
  SESSION: 'rs:session'
};

// Storage Helpers
export const getCurrentUserId = () => {
  try {
    return localStorage.getItem('rs:session');
  } catch (e) {
    return null;
  }
};

export const getScopedKey = (key: string) => {
  const userId = getCurrentUserId();
  if (!userId) return null;
  return `rs:${userId}:${key}`;
};

export const getStored = <T>(key: string, initial: T): T => {
  try {
    const scopedKey = getScopedKey(key);
    if (!scopedKey) return initial;
    const stored = localStorage.getItem(scopedKey);
    if (!stored) return initial;
    try {
      const parsed = JSON.parse(stored);
      if (key === STORAGE_KEYS.PRODUCTS && Array.isArray(parsed)) {
        return parsed.filter(p => p && typeof p === 'object' && p.id && p.name) as unknown as T;
      }
      if (key === STORAGE_KEYS.SALES && Array.isArray(parsed)) {
        return parsed.filter(s => s && typeof s === 'object' && s.id) as unknown as T;
      }
      if (key === STORAGE_KEYS.INSTALLMENTS && Array.isArray(parsed)) {
        return parsed.filter(i => i && typeof i === 'object' && i.id) as unknown as T;
      }
      return parsed as T;
    } catch (parseError) {
      console.error("JSON parse error for key:", scopedKey, parseError);
      return initial;
    }
  } catch (e) {
    console.error("Storage read error:", e);
    return initial;
  }
};

export const saveStored = (key: string, data: any) => {
  try {
    const scopedKey = getScopedKey(key);
    if (scopedKey) {
      localStorage.setItem(scopedKey, JSON.stringify(data));
    }
  } catch (e) {
    console.error("Storage write error:", e);
    if (e instanceof DOMException && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED')) {
      notifyWarning("Memória cheia.", "Tente excluir fotos ou dados antigos.");
    }
  }
};

// Auth Functions
// Note: getUsers() is only for backward compatibility and admin pages
// For login auth, use Firebase Auth directly in login.tsx
export const getUsers = (): User[] => {
  try {
    // Try to read legacy rs:users (for backward compat)
    // But don't fail if it's missing - this is NOT the auth source
    const stored = localStorage.getItem(AUTH_KEYS.USERS);
    if (!stored) return [];
    try {
      return JSON.parse(stored) as User[];
    } catch (parseError) {
      console.error("JSON parse error for users:", parseError);
      return [];
    }
  } catch (e) {
    console.error("Error reading users", e);
    return [];
  }
};

export const signup = (user: Omit<User, 'id' | 'createdAt'>) => {
  const users = getUsers();
  if (users.find(u => u.email === user.email)) return { success: false, message: 'Email já cadastrado' };
  
  const newUser: User = {
    ...user,
    id: Math.random().toString(36).substr(2, 9),
    createdAt: new Date().toISOString()
  };
  
  try {
    localStorage.setItem(AUTH_KEYS.USERS, JSON.stringify([...users, newUser]));
    
    // Create initial settings for new user
    const scopedSettingsKey = `rs:${newUser.id}:settings`;
    const settingsWithNoBusiness = { 
      ...defaultSettings, 
      storeName: user.storeName, 
      businessType: '',
      catalogSlug: user.storeName.toLowerCase().replace(/[^a-z0-9]/g, '-') + '-' + Math.random().toString(36).substr(2, 4)
    };
    localStorage.setItem(scopedSettingsKey, JSON.stringify(settingsWithNoBusiness));
    
    return { success: true, user: newUser };
  } catch (e) {
    return { success: false, message: 'Erro ao salvar (armazenamento cheio)' };
  }
};

export const login = (credentials: Pick<User, 'email' | 'password'>) => {
  const users = getUsers();
  const user = users.find(u => u.email === credentials.email && u.password === credentials.password);
  if (!user) return { success: false, message: 'Email ou senha incorretos' };
  
  try {
    localStorage.setItem(AUTH_KEYS.SESSION, user.id);
  } catch (e) {
  console.error(e);
}
  return { success: true, user };
};

// Bootstrap user data after Firebase login
// This creates the scoped localStorage keys that the app needs
export const bootstrapUserData = (userId: string, email?: string) => {
  try {
    // Check if user already has scoped settings
    const settingsKey = `rs:${userId}:settings`;
    const existingSettings = localStorage.getItem(settingsKey);
    
    if (!existingSettings) {
      // Create default settings for new user
      const newSettings = { 
        ...defaultSettings,
        storeName: email?.split('@')[0] || 'Minha Revenda'
      };
      localStorage.setItem(settingsKey, JSON.stringify(newSettings));
    }
    
    // Ensure products key exists (can be empty initially)
    if (!localStorage.getItem(`rs:${userId}:products`)) {
      localStorage.setItem(`rs:${userId}:products`, JSON.stringify([]));
    }
    
    // Ensure other scoped keys exist
    if (!localStorage.getItem(`rs:${userId}:clients`)) {
      localStorage.setItem(`rs:${userId}:clients`, JSON.stringify([]));
    }
    if (!localStorage.getItem(`rs:${userId}:sales`)) {
      localStorage.setItem(`rs:${userId}:sales`, JSON.stringify([]));
    }
    if (!localStorage.getItem(`rs:${userId}:installments`)) {
      localStorage.setItem(`rs:${userId}:installments`, JSON.stringify([]));
    }
    if (!localStorage.getItem(`rs:${userId}:posts`)) {
      localStorage.setItem(`rs:${userId}:posts`, JSON.stringify([]));
    }
    
    return true;
  } catch (e) {
    console.error("Error bootstrapping user data:", e);
    return false;
  }
};

export const loginDemo = () => {
  const demoId = 'demo_' + Math.random().toString(36).substr(2, 9);
  const demoUser: User = {
    id: demoId,
    email: `demo_${demoId}@revendasmart.com`,
    password: 'demo',
    storeName: 'Loja de Demonstração',
    createdAt: new Date().toISOString()
  };
  
  try {
    // Create demo data using bootstrap function
    bootstrapUserData(demoId, demoUser.email);
    
    // Add demo data
    localStorage.setItem(`rs:${demoId}:settings`, JSON.stringify({ ...defaultSettings, storeName: demoUser.storeName }));
    localStorage.setItem(`rs:${demoId}:products`, JSON.stringify(initialProducts));
    localStorage.setItem(`rs:${demoId}:clients`, JSON.stringify(initialClients));
    
    localStorage.setItem(AUTH_KEYS.SESSION, demoId);
    return { success: true, user: demoUser };
  } catch (e) {
    console.error("Demo login error:", e);
    return { success: false, message: 'Erro ao carregar demonstração' };
  }
};

export const logout = async () => {
  // Clean up demo-specific data
  const userId = getCurrentUserId();
  if (userId && userId.startsWith('demo_')) {
    const keysToRemove = Object.keys(localStorage).filter(k => k.startsWith(`rs:${userId}:`));
    keysToRemove.forEach(k => localStorage.removeItem(k));

    const users = getUsers().filter(u => u.id !== userId);
    try {
      localStorage.setItem(AUTH_KEYS.USERS, JSON.stringify(users));
    } catch (e) {
  console.error(e);
}
  }

  // Always clear the local session
  localStorage.removeItem(AUTH_KEYS.SESSION);
};

// Storage Keys (Internal names)
export const STORAGE_KEYS = {
  PRODUCTS: 'products',
  CLIENTS: 'clients',
  SALES: 'sales',
  INSTALLMENTS: 'installments',
  POSTS: 'posts',
  SETTINGS: 'settings'
};

// Initial Data (Fallback/Templates)
export const initialProducts: Product[] = [
  { id: '1', name: 'Essencial Exclusivo Feminino', brand: 'Natura', category: 'Perfume', costPrice: 120.0, salePrice: 189.9, stock: 5, imageUrl: "https://images.unsplash.com/photo-1556229010-6c3f2c9ca5f8?q=80&w=200&auto=format&fit=crop", lastSoldDate: new Date(Date.now() - 30 * 86400000).toISOString() },
  { id: '2', name: 'Lily Eau de Parfum', brand: 'O Boticário', category: 'Perfume', costPrice: 150.0, salePrice: 239.9, stock: 2, imageUrl: "https://images.unsplash.com/photo-1556229010-6c3f2c9ca5f8?q=80&w=200&auto=format&fit=crop", lastSoldDate: new Date().toISOString() },
  { id: '3', name: 'Creme Acetinado Lily', brand: 'O Boticário', category: 'Creme', costPrice: 65.0, salePrice: 109.9, stock: 8, imageUrl: "https://images.unsplash.com/photo-1556229010-6c3f2c9ca5f8?q=80&w=200&auto=format&fit=crop", lastSoldDate: new Date(Date.now() - 15 * 86400000).toISOString() },
  { id: '4', name: 'Batom Matte Faces', brand: 'Natura', category: 'Maquiagem', costPrice: 15.0, salePrice: 25.9, stock: 12, imageUrl: "https://images.unsplash.com/photo-1556229010-6c3f2c9ca5f8?q=80&w=200&auto=format&fit=crop", lastSoldDate: new Date(Date.now() - 45 * 86400000).toISOString() }
];

export const initialClients: Client[] = [
  { id: 'c1', name: 'Maria Silva', phone: '11999999999', notes: 'Prefere perfumes florais' },
  { id: 'c2', name: 'João Santos', phone: '11888888888' }
];

export const defaultSettings: AppSettings = {
  storeName: 'Minha Revenda',
  sellerName: 'Consultora',
  phone: '',
  whatsapp: '',
  instagram: '',
  address: '',
  storeLogo: '',
  primaryColor: '#ec4899',
  watermarkText: 'Minha Loja',
  pixKey: '',
  bankName: '',
  paymentLink: '',
  allowInstallments: true,
  templateReminder: 'Olá {client}! Passando para lembrar da sua parcela de R$ {value} que vence dia {date}. ✨',
  templateReceived: 'Olá {client}! Recebi seu pagamento de R$ {value}. Obrigado! ✅',
  templateThanks: 'Olá {client}! Obrigado pela compra! 💖',
  lowStockThreshold: 3,
  monthlyGoal: 10000,
  appTheme: 'purple',
  appThemeCustomization: {
    primaryColor: '#6d5dfc',
    buttonTone: 'solid',
    cardTone: 'clean',
    shadowIntensity: 'medium',
    radius: 'rounded',
    motion: 'normal'
  },
  customCategoriesByNicho: {},
  onboarding_theme_selected: false,
  enablePublicCatalog: true,
  showPrice: true,
  showStock: true,
  allowWhatsappOrders: true,
  businessType: 'Geral',
  businessTypes: ['Geral'],
  catalogSlug: '',
  notification_settings: {
    enable_billing_reminders: true,
    reminder_days_before_due: 1
  },
  marketing_settings: {}
};

export const APP_VERSION = "v2026-04-02-01";
// DEPRECATED: Frontend no longer uses this list.
// Admin access is validated server-side via Firebase custom claims.
// To set custom claim: firebase auth:set:custom-claims <uid> --custom-claims '{"admin": true}'
export const adminEmails = ["natanaelam2000@gmail.com"];
