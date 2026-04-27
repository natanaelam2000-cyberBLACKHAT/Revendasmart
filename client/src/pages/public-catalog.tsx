import { getFirebaseAuth } from "@/lib/firebase";
import { useState, useEffect } from "react";
import { getFirestore, collection, query, where, getDocs } from "firebase/firestore";
import { useParams } from "wouter";
import { 
  getUsers, getStored, STORAGE_KEYS, Product, AppSettings, defaultSettings 
} from "@/lib/mock-data";
import { 
  ShoppingBag, MessageSquare, Package, Info, ChevronRight, Store, ExternalLink
} from "lucide-react";
import { logError } from "@/lib/firebase";

export default function PublicCatalog() {
  const { storeSlug } = useParams();
  
  // Find user by slug - AUDITED: Uses getUsers() from Firestore mock, not direct localStorage read
  // NOTE: In production, this should query Firestore directly for security:
  // const catalogQuery = await db.collection('user_settings').where('catalogSlug', '==', storeSlug).limit(1).get();
 

const db = getFirestore();

const [targetUser, setTargetUser] = useState<any>(null);
const [products, setProducts] = useState<Product[]>([]);
const [settings, setSettings] = useState<AppSettings>(defaultSettings);

useEffect(() => {
    getFirebaseAuth(); // 👈 ESSENCIAL
  async function loadCatalog() {
    try {
      const usersRef = collection(db, "user_settings");
      const q = query(usersRef, where("catalogSlug", "==", storeSlug));
      const snapshot = await getDocs(q);

      if (snapshot.empty) {
  console.warn("[CATALOG] Nenhum usuário encontrado pro slug:", storeSlug);
  setTargetUser(null);
  return;
}

const userDoc = snapshot.docs[0];
const userData = userDoc.data();

if (!userData?.uid) {
  console.error("[CATALOG] UID inválido:", userData);
  setTargetUser(null);
  return;
}
      if (!userData.enablePublicCatalog) {
        setTargetUser(null);
        return;
      }

      setTargetUser(userData);
      setSettings({ ...defaultSettings, ...userData });

      const productsRef = collection(db, "users", userData.uid, "products");
      const productsSnap = await getDocs(productsRef);

      const productsList = productsSnap.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Product[];

      setProducts(productsList);

    } catch (err) {
      console.error("Erro ao carregar catálogo:", err);
    }
  }

  loadCatalog();
}, [storeSlug]);

  // Fail-soft checks
  if (!targetUser || !settings?.enablePublicCatalog || settings?.disablePublicCatalog) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6 text-center">
        <div className="w-20 h-20 bg-secondary rounded-full flex items-center justify-center mb-6">
          <Store className="w-10 h-10 text-muted-foreground" />
        </div>
        <h1 className="text-xl font-bold mb-2">Catálogo Indisponível</h1>
        <p className="text-sm text-muted-foreground">Este catálogo não foi encontrado ou está temporariamente desativado pelo consultor.</p>
      </div>
    );
  }

  const storeDisplayName = settings?.storeName || "Minha Loja";

  return (
    <div className="min-h-screen bg-background pb-24 max-w-md mx-auto relative shadow-2xl flex flex-col">
      <header className="px-6 pt-12 pb-8 bg-white border-b border-border/50 sticky top-0 z-40">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-primary/10 rounded-2xl flex items-center justify-center text-primary font-black text-xl">
            {storeDisplayName.charAt(0).toUpperCase()}
          </div>
          <div>
            <h1 className="text-xl font-black tracking-tight">{storeDisplayName}</h1>
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Catálogo Digital</p>
          </div>
        </div>
      </header>

      <main className="flex-1 p-6 space-y-6">
        <div className="grid grid-cols-1 gap-6">
          {products.length > 0 ? (
            products.map((product: Product) => {
              if (!product) return null;
              return (
                <div key={product.id || Math.random()} className="bg-white rounded-[2.5rem] overflow-hidden border border-border/50 shadow-sm flex flex-col">
                  <div className="aspect-square relative bg-secondary/30">
                    <img 
                      src={product.imageUrl || "https://images.unsplash.com/photo-1556229010-6c3f2c9ca5f8?q=80&w=200&auto=format&fit=crop"} 
                      alt={product.name || "Produto"} 
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        (e.target as HTMLImageElement).src = "https://images.unsplash.com/photo-1556229010-6c3f2c9ca5f8?q=80&w=200&auto=format&fit=crop";
                      }}
                    />
                    {(product.stock !== undefined && product.stock <= 0) && (
                      <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px] flex items-center justify-center">
                        <span className="bg-white text-black text-[10px] font-black px-4 py-2 rounded-full uppercase">Esgotado</span>
                      </div>
                    )}
                  </div>
                  
                  <div className="p-6 space-y-3">
                    <div className="flex justify-between items-start">
                      <div className="flex-1">
                        <p className="text-[10px] font-black text-primary uppercase tracking-widest mb-1">{product.category || "Geral"}</p>
                        <h3 className="text-lg font-bold leading-tight">{product.name || "Produto sem nome"}</h3>
                        {product.brand && <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">{product.brand}</p>}
                      </div>
                      {settings?.showPrice && product.salePrice !== undefined && (
                        <div className="text-right">
                          <p className="text-xl font-black text-foreground">R$ {Number(product.salePrice).toFixed(2)}</p>
                        </div>
                      )}
                    </div>

                    {product.description && (
                      <p className="text-xs text-muted-foreground line-clamp-3 leading-relaxed">
                        {product.description}
                      </p>
                    )}

                    {product.extras && Object.keys(product.extras).length > 0 && (
                      <div className="flex flex-wrap gap-2 pt-2">
                        {Object.entries(product.extras).map(([key, val]) => val && (
                          <span key={key} className="bg-secondary/50 text-[9px] font-bold px-3 py-1.5 rounded-full uppercase text-muted-foreground">
                            {val}
                          </span>
                        ))}
                      </div>
                    )}

                    {settings?.whatsapp && (
                      <button 
                        disabled={product.stock !== undefined && product.stock <= 0}
                        onClick={() => {
                          const msg = `Olá! Vi seu catálogo e tenho interesse no produto: ${product.name || 'este produto'}`;
                          const cleanPhone = settings.whatsapp.replace(/\D/g, '');
                          window.open(`https://wa.me/${cleanPhone}?text=${encodeURIComponent(msg)}`, '_blank');
                        }}
                        className="w-full bg-primary text-white font-black py-4 rounded-2xl flex items-center justify-center gap-2 uppercase tracking-widest text-xs shadow-lg shadow-primary/20 active:scale-95 transition-all mt-4 disabled:opacity-50 disabled:grayscale"
                      >
                        <MessageSquare className="w-4 h-4" /> Comprar no WhatsApp
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          ) : (
            <div className="text-center py-20">
              <Package className="w-12 h-12 text-muted-foreground/20 mx-auto mb-4" />
              <p className="text-sm font-bold text-muted-foreground uppercase">Nenhum produto disponível</p>
            </div>
          )}
        </div>
      </main>

      <footer className="p-8 text-center bg-secondary/20">
        <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.2em]">Criado com RevendaSmart</p>
      </footer>
    </div>
  );
}
