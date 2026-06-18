import { useState, useMemo, useEffect } from "react";
import {
  Plus,
  Edit2,
  Trash2,
  Search,
  Share2,
  AlertTriangle,
  Minus,
  Eye,
  EyeOff,
  TrendingUp
} from "lucide-react";
import { Link } from "wouter";
import { Product, deleteImage } from "@/lib/mock-data";
import { ProductCard } from "@/components/ProductCard";
import { FilterChips } from "@/components/FilterChips";
import { EmptyState } from "@/components/EmptyState";
import { getFirebaseAuth, logTelemetryEvent } from "@/lib/firebase";
import { onAuthStateChanged } from "firebase/auth";
import { getFirestore, collection, onSnapshot, doc, updateDoc, deleteDoc } from "firebase/firestore";
import { useUserSettings } from "@/hooks/useUserSettings";
import { Layout } from "@/components/layout";

export default function Products() {
  const [products, setProducts] = useState<Product[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>("");
  const [selectedCategory, setSelectedCategory] = useState("Todas");
  const [showOutOfStock, setShowOutOfStock] = useState(true);
  const [showLowStock, setShowLowStock] = useState(true);
  const { settings } = useUserSettings();

  useEffect(() => {
    const auth = getFirebaseAuth();
    if (!auth) {
      setLoading(false);
      setError("Firebase não inicializado");
      return;
    }

    let unsubscribeSnapshot: (() => void) | null = null;

    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      if (!user) {
        setLoading(false);
        setError("Usuário não autenticado");
        setProducts([]);
        if (unsubscribeSnapshot) unsubscribeSnapshot();
        return;
      }

      const firestore = getFirestore();
      if (unsubscribeSnapshot) unsubscribeSnapshot();

      unsubscribeSnapshot = onSnapshot(
        collection(firestore, "users", user.uid, "products"),
        (snapshot) => {
          const remoteProducts = snapshot.docs
            .map(d => ({
              ...d.data(),
              id: d.id
            } as Product))
            .filter(p => p && typeof p === 'object' && p.id);
          setProducts(remoteProducts);
          setError("");
          setLoading(false);
        },
        (err) => {
          console.error("[products] firestore snapshot error:", err);
          setError("Erro ao carregar produtos do servidor");
          setProducts([]);
          setLoading(false);
        }
      );
    });

    return () => {
      unsubscribeAuth();
      if (unsubscribeSnapshot) unsubscribeSnapshot();
    };
  }, []);

  const stats = useMemo(() => {
    const totalProfit = products.reduce((acc, p) => acc + ((p.salePrice - p.costPrice) * p.stock), 0);
    const lowStockCount = products.filter(p => p.stock > 0 && p.stock <= 3).length;
    const outOfStockCount = products.filter(p => p.stock === 0).length;
    return { totalProfit, lowStockCount, outOfStockCount };
  }, [products]);

  const categories = useMemo(() => {
    const cats = new Set<string>();
    products.forEach(p => {
      if (p.category) cats.add(p.category);
    });
    return ["Todas", ...Array.from(cats).sort()];
  }, [products]);

  const filteredProducts = useMemo(() => {
    return products.filter(p => {
      const matchSearch =
        !search ||
        p.name?.toLowerCase().includes(search.toLowerCase()) ||
        p.brand?.toLowerCase().includes(search.toLowerCase());

      const matchCategory = selectedCategory === "Todas" || p.category === selectedCategory;

      const isOutOfStock = p.stock === 0;
      const isLowStock = p.stock > 0 && p.stock <= 3;
      
      let matchesStockFilter = true;
      if (!showOutOfStock && isOutOfStock) matchesStockFilter = false;
      if (!showLowStock && isLowStock) matchesStockFilter = false;

      return matchSearch && matchCategory && matchesStockFilter;
    });
  }, [products, selectedCategory, search, showOutOfStock, showLowStock]);

  const handleUpdateStock = async (id: string, newStock: number) => {
    if (newStock < 0) return;
    const auth = getFirebaseAuth();
    if (!auth?.currentUser) return;
    
    try {
      const firestore = getFirestore();
      await updateDoc(doc(firestore, "users", auth.currentUser.uid, "products", id), {
        stock: newStock
      });
    } catch (err) {
      console.error("Erro ao atualizar estoque:", err);
    }
  };

  const handleQuickShare = (product: Product) => {
    const catalogSlug = settings?.catalogSlug || settings?.catalog_slug || "seu-catalogo";
    const catalogUrl = `https://revendasmart.vercel.app/u/${catalogSlug}`;
    const msg = `Olá! Tenho este produto disponível:\n\n*${product.name}*\nValor: R$ ${product.salePrice.toFixed(2)}\n\nEstoque: ${product.stock} unidade(s)\n\nVeja no catálogo:\n${catalogUrl}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, "_blank");
    
    const user = getFirebaseAuth()?.currentUser;
    logTelemetryEvent("product_quick_shared", { productId: product.id }, user?.uid);
  };

  const [deleteConfirm, setDeleteConfirm] = useState<{ show: boolean; productId?: string }>({ show: false });

  const handleDelete = (id: string) => {
    setDeleteConfirm({ show: true, productId: id });
  };

  const handleDeleteConfirm = async (id: string) => {
    if (!id) return;
    setDeleteConfirm({ show: false });
    
    const product = products.find(p => p.id === id);
    const firestore = getFirestore();
    const auth = getFirebaseAuth();
    
    if (!auth?.currentUser) return;

    try {
      if (product?.imageId) deleteImage(product.imageId);
      await deleteDoc(doc(firestore, "users", auth.currentUser.uid, "products", id));
    } catch (err) {
      console.error("Erro ao deletar:", err);
    }
  };

  return (
    <Layout>
      <div className="min-h-full bg-slate-50 pb-28 lg:pb-8">
      <div className="bg-white border-b border-border/50">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-5 lg:py-7 space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div><p className="text-xs font-bold text-primary uppercase tracking-wider">Produtos</p><h1 className="text-2xl lg:text-3xl font-black">Gestão de estoque</h1><p className="text-sm text-muted-foreground mt-1">{products.length} produtos · lucro potencial de R$ {stats.totalProfit.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p></div>
            <Link href="/add-product"><a className="bg-primary text-white px-4 py-3 rounded-xl flex items-center gap-2 shadow-md text-xs font-black whitespace-nowrap"><Plus className="w-4 h-4" /> Novo produto</a></Link>
          </div>
          <div className="flex flex-col lg:flex-row gap-3 lg:items-center">
            <div className="relative flex-1"><Search className="w-4 h-4 absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground/50" /><input type="text" placeholder="Buscar por nome ou marca..." className="w-full bg-slate-50 border border-border/60 rounded-xl py-3 pl-11 pr-4 text-sm focus:ring-2 focus:ring-primary/20 outline-none" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
            <div className="flex gap-2 flex-wrap">
              <button onClick={() => setShowLowStock(!showLowStock)} className={`px-3 py-2 rounded-full text-[10px] font-bold border flex items-center gap-1.5 ${showLowStock?'bg-amber-50 text-amber-700 border-amber-200':'bg-white text-muted-foreground border-border'}`}>{showLowStock?<Eye className="w-3.5 h-3.5"/>:<EyeOff className="w-3.5 h-3.5"/>} Estoque baixo {stats.lowStockCount}</button>
              <button onClick={() => setShowOutOfStock(!showOutOfStock)} className={`px-3 py-2 rounded-full text-[10px] font-bold border flex items-center gap-1.5 ${showOutOfStock?'bg-red-50 text-red-700 border-red-200':'bg-white text-muted-foreground border-border'}`}>{showOutOfStock?<Eye className="w-3.5 h-3.5"/>:<EyeOff className="w-3.5 h-3.5"/>} Sem estoque {stats.outOfStockCount}</button>
            </div>
          </div>
          <FilterChips options={categories} selected={selectedCategory} onSelect={setSelectedCategory} className="!mx-0 !px-0 !pb-0" />
        </div>
      </div>
      {/* Conteúdo Principal */}
      <div className="max-w-6xl mx-auto p-4 sm:p-6 lg:px-8">
        {loading ? (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 sm:gap-4">
            {[1, 2, 3, 4, 5, 6].map(i => (
              <div key={i} className="h-48 bg-white rounded-[1.5rem] animate-pulse border border-border/20" />
            ))}
          </div>
        ) : error ? (
          <EmptyState
            icon={<AlertTriangle className="w-12 h-12 text-red-400" />}
            title="Erro ao carregar"
            description={error}
          />
        ) : filteredProducts.length === 0 ? (
          <EmptyState
            title="Nenhum produto encontrado"
            description={search ? "Tente ajustar sua busca ou filtros" : "Você ainda não possui produtos cadastrados. Cadastre seu primeiro produto para começar a controlar seu estoque."}
            action={
              !search && (
                <Link href="/add-product">
                  <a className="w-full bg-primary text-white font-black py-3 rounded-2xl text-xs uppercase hover:shadow-lg transition-all active:scale-95">
                    Cadastrar Primeiro Produto
                  </a>
                </Link>
              )
            }
          />
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 sm:gap-4">
            {filteredProducts.map((product) => (
              <article key={product.id} className="min-w-0">
                <ProductCard product={product} lowStockThreshold={settings?.lowStockThreshold} />
                <div className="grid grid-cols-3 gap-1.5 mt-2">
                  <button onClick={() => handleQuickShare(product)} className="min-w-0 py-2 px-1 bg-green-50 text-green-700 rounded-xl flex items-center justify-center gap-1 text-[9px] sm:text-[10px] font-bold" title="Compartilhar WhatsApp"><Share2 className="w-3.5 h-3.5 flex-shrink-0" /><span className="hidden sm:inline truncate">WhatsApp</span></button>
                  <Link href={`/edit-product/${product.id}`}><a className="min-w-0 py-2 px-1 bg-primary/10 text-primary rounded-xl flex items-center justify-center gap-1 text-[9px] sm:text-[10px] font-bold"><Edit2 className="w-3.5 h-3.5 flex-shrink-0" /><span className="hidden sm:inline">Editar</span></a></Link>
                  <button onClick={() => handleDelete(product.id)} className="min-w-0 py-2 px-1 bg-red-50 text-red-600 rounded-xl flex items-center justify-center gap-1 text-[9px] sm:text-[10px] font-bold" title="Excluir"><Trash2 className="w-3.5 h-3.5 flex-shrink-0" /><span className="hidden sm:inline">Excluir</span></button>
                </div>
              </article>
            ))}
          </div>        )}
      </div>

      {/* Delete Confirmation Modal */}
      {deleteConfirm.show && deleteConfirm.productId && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-end justify-center z-50 p-4">
          <div className="w-full max-w-md bg-white rounded-[3rem] p-8 space-y-6 animate-in slide-in-from-bottom-full">
            <div className="text-center">
              <div className="w-16 h-16 bg-red-50 rounded-3xl flex items-center justify-center mx-auto mb-4">
                <Trash2 className="w-8 h-8 text-red-500" />
              </div>
              <h2 className="text-xl font-black text-foreground">Excluir Produto?</h2>
              <p className="text-sm text-muted-foreground mt-2">Esta ação é permanente e não pode ser desfeita.</p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setDeleteConfirm({ show: false })}
                className="flex-1 bg-secondary text-foreground font-black py-3 rounded-2xl text-xs uppercase hover:bg-secondary/80 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={() => handleDeleteConfirm(deleteConfirm.productId!)}
                className="flex-1 bg-red-500 text-white font-black py-3 rounded-2xl text-xs uppercase hover:bg-red-600 transition-colors"
              >
                Excluir
              </button>
            </div>
          </div>
        </div>
      )}
      </div>
    </Layout>
  );
}
