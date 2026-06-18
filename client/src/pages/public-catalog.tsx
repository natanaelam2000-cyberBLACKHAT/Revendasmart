import { useState, useEffect } from "react";
import { useParams } from "wouter";

import {
  ShoppingBag,
  MessageSquare,
  Package,
  Info,
  ChevronRight,
  Store,
  ExternalLink,
} from "lucide-react";

import {
  Product,
  AppSettings,
  defaultSettings,
} from "@/lib/mock-data";
import { getApiUrl } from "@/lib/api-config";

export default function PublicCatalog() {
  const { storeSlug } = useParams();
  
  // Find user by slug - AUDITED: Uses getUsers() from Firestore mock, not direct localStorage read
  // NOTE: In production, this should query Firestore directly for security:
  // const catalogQuery = await db.collection('user_settings').where('catalogSlug', '==', storeSlug).limit(1).get();
 
const [selectedGender, setSelectedGender] = useState("todos");
const [targetUser, setTargetUser] = useState<any>(null);
const [products, setProducts] = useState<Product[]>([]);
const [settings, setSettings] = useState<AppSettings>(defaultSettings);
const [loading, setLoading] = useState(true);
const [loadFailed, setLoadFailed] = useState(false);

useEffect(() => {
  let cancelled = false;
  async function loadCatalog() {
    setLoading(true);
    setLoadFailed(false);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const response = await fetch(getApiUrl(`/api/public/catalog/${encodeURIComponent(storeSlug || "")}`));
        if (response.status === 404) break;
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        if (cancelled) return;
        setTargetUser({ uid: data.uid });
        setSettings({ ...defaultSettings, ...(data.settings || {}) });
        setProducts(Array.isArray(data.products) ? data.products : []);
        setLoading(false);
        return;
      } catch (err) {
        console.warn(`[CATALOG] Tentativa ${attempt + 1} falhou:`, err);
        if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 400 * (attempt + 1)));
      }
    }
    if (!cancelled) {
      setTargetUser(null);
      setLoadFailed(true);
      setLoading(false);
    }
  }
  loadCatalog();
  return () => { cancelled = true; };
}, [storeSlug]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-10 h-10 rounded-full border-4 border-primary/20 border-t-primary animate-spin" />
      </div>
    );
  }
  // Fail-soft checks
  if (!targetUser || !settings?.enablePublicCatalog || settings?.disablePublicCatalog) {
console.log("PRODUTOS:", products);
console.log("GENDER ATUAL:", selectedGender);
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6 text-center">
        <div className="w-20 h-20 bg-secondary rounded-full flex items-center justify-center mb-6">
          <Store className="w-10 h-10 text-muted-foreground" />
        </div>
        <h1 className="text-xl font-bold mb-2">Catálogo Indisponível</h1>
        <p className="text-sm text-muted-foreground">{loadFailed ? "Não foi possível carregar agora. Tente novamente em instantes." : "Este catálogo não foi encontrado ou está desativado pelo consultor."}</p>
      </div>
    );
  }

const storeDisplayName = settings?.storeName || "Minha Loja";

const normalize = (v: any) =>
  String(v || "").trim().toLowerCase();

const filteredProducts = (Array.isArray(products) ? products : []).filter(p => {
  if (!p) return false;

  if (selectedGender === "todos") return true;

  return normalize(p.gender) === normalize(selectedGender);
});
console.log("FILTRADOS:", filteredProducts);

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

  {/* 🔥 FILTRO DE GÊNERO */}
  <div className="flex gap-2 overflow-x-auto pb-2">
    {["todos", "masculino", "feminino", "unisex"].map(g => (
      <button
        key={g}
        onClick={() => setSelectedGender(g)}
        className={`px-4 py-2 rounded-full text-xs font-bold whitespace-nowrap ${
          selectedGender === g
            ? "bg-primary text-white"
            : "bg-white border"
        }`}
      >
        {g}
      </button>
    ))}
  </div>

  <div className="grid grid-cols-1 gap-6">
  {filteredProducts.length > 0 ? (
  (Array.isArray(filteredProducts) ? filteredProducts : []).map((product) => {
    if (!product) return null;

    const image = product?.imageUrl || "/placeholder.png";
    const name = product?.name || "Sem nome";
    const price = Number(product?.salePrice || 0);

    return (
      <div key={product.id || Math.random()} className="bg-white rounded-2xl border p-4">
        <img src={image} className="w-full h-40 object-cover rounded-xl mb-3" />

        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            {product.category || "Geral"}
          </p>

          <h3 className="font-bold">{name}</h3>

          <p className="font-black">
            R$ {price.toFixed(2)}
          </p>
        </div>
      </div>
    );
  })
) : (
  <div className="text-center py-20">
    <Package className="w-12 h-12 text-muted-foreground/20 mx-auto mb-4" />
    <p className="text-sm font-bold text-muted-foreground uppercase">
      Nenhum produto disponível
    </p>
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
