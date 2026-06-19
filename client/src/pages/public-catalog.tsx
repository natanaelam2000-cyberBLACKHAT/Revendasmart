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
import { ProductImageCard } from "@/components/ProductImageCard";

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
        setTargetUser({ uid: data.uid || data.settings?.uid || "public" });
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
  const catalogEnabled = (settings as any)?.enablePublicCatalog ?? (settings as any)?.catalogEnabled ?? true;
  if (!targetUser || catalogEnabled === false || settings?.disablePublicCatalog) {
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

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-5 flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-primary text-white flex items-center justify-center font-black text-xl overflow-hidden">{settings?.storeLogo ? <img src={settings.storeLogo} alt={storeDisplayName} className="w-full h-full object-cover" /> : storeDisplayName.charAt(0).toUpperCase()}</div>
          <div className="min-w-0"><h1 className="text-xl sm:text-2xl font-black truncate">{storeDisplayName}</h1><p className="text-xs text-muted-foreground">Catálogo digital · {filteredProducts.length} produtos</p></div>
        </div>
      </header>
      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <div className="flex gap-2 overflow-x-auto pb-4 hide-scrollbar">
          {["todos","masculino","feminino","unisex"].map(g=><button key={g} onClick={()=>setSelectedGender(g)} className={`px-4 py-2 rounded-full text-xs font-bold whitespace-nowrap border ${selectedGender===g?"bg-primary text-white border-primary":"bg-white text-muted-foreground border-slate-200"}`}>{g==="todos"?"Todos":g.charAt(0).toUpperCase()+g.slice(1)}</button>)}
        </div>
        {filteredProducts.length>0?<div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-5">
          {filteredProducts.map(product=>{const price=Number(product.salePrice||0); return <article key={product.id} className="bg-white rounded-2xl sm:rounded-3xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
            <div className="aspect-[4/5] bg-slate-50"><ProductImageCard product={product} size="full" objectFit="contain" className="!rounded-none !border-0" /></div>
            <div className="p-3 sm:p-4 flex-1 flex flex-col">
              <p className="text-[9px] sm:text-[10px] font-black text-primary uppercase tracking-wider truncate">{product.brand||"Sem marca"}</p>
              <h2 className="text-xs sm:text-sm font-bold leading-tight line-clamp-2 min-h-[2rem] sm:min-h-[2.5rem] mt-1">{product.name||"Produto"}</h2>
              <p className="text-[10px] text-muted-foreground truncate mt-1">{product.category||"Geral"}</p>
              {settings.showStock!==false&&<p className={`text-[10px] font-bold mt-2 ${product.stock>0?"text-green-600":"text-red-500"}`}>{product.stock>0?`Disponível: ${product.stock} ${product.stock===1?"unidade":"unidades"}`:"Produto esgotado"}</p>}
              {settings.showPrice!==false&&<p className="text-base sm:text-xl font-black text-primary mt-auto pt-3">R$ {price.toLocaleString("pt-BR",{minimumFractionDigits:2})}</p>}
            </div>
          </article>})}
        </div>:<div className="bg-white rounded-3xl border border-dashed border-slate-300 py-20 text-center"><Package className="w-12 h-12 text-slate-300 mx-auto mb-3"/><p className="font-bold text-muted-foreground">Nenhum produto disponível</p></div>}
      </main>
      <footer className="py-8 text-center text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">Criado com RevendaSmart</footer>
    </div>
  );
}