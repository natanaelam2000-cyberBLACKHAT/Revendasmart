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
    const catalogUrl = `https://revendasmart.vercel.app/u/${settings?.catalog_slug || "seu-catalogo"}`;
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
    <div className="min-h-full bg-gradient-to-b from-primary/5 to-background pb-32">
      {/* Header */}
      <div className="sticky top-0 z-40 bg-white border-b border-border/40 shadow-sm">
        <div className="p-6 space-y-4">
          {/* Título e Botão */}
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-black text-foreground">Gestão de Estoque</h1>
            <Link href="/add">
              <a className="bg-primary text-white px-5 py-2.5 rounded-2xl flex items-center gap-2 shadow-lg shadow-primary/20 text-xs font-black uppercase tracking-widest hover:shadow-xl transition-all active:scale-95">
                <Plus className="w-4 h-4" /> Novo
              </a>
            </Link>
          </div>

          {/* Lucro Potencial - Card Executivo */}
          <div className="bg-gradient-to-br from-primary/10 to-primary/5 p-5 rounded-[2rem] border border-primary/20">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center">
                <TrendingUp className="w-4 h-4 text-primary" />
              </div>
              <span className="text-[9px] font-black text-primary uppercase tracking-widest">Lucro Potencial</span>
            </div>
            <p className="text-3xl font-black text-primary leading-none mb-1">
              R$ {stats.totalProfit.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
            </p>
            <p className="text-[10px] text-muted-foreground">Estimativa baseada no estoque atual</p>
          </div>

          {/* Busca */}
          <div className="relative">
            <Search className="w-5 h-5 absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground/40" />
            <input
              type="text"
              placeholder="Buscar por nome ou marca..."
              className="w-full bg-secondary/30 border border-border/40 rounded-2xl py-3 pl-12 pr-4 text-sm focus:ring-2 focus:ring-primary/20 focus:border-transparent transition-all"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          {/* Filtros por Categoria */}
          <div className="space-y-2">
            <p className="text-[9px] font-black text-muted-foreground uppercase tracking-widest">Categorias</p>
            <FilterChips 
              options={categories} 
              selected={selectedCategory} 
              onSelect={setSelectedCategory}
            />
          </div>

          {/* Filtros de Estoque */}
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setShowOutOfStock(!showOutOfStock)}
              className={`px-4 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all border flex items-center justify-center gap-2 ${
                showOutOfStock 
                  ? 'bg-red-100 text-red-700 border-red-200 shadow-sm' 
                  : 'bg-white text-muted-foreground border-border/40'
              }`}
            >
              {showOutOfStock ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
              Sem Estoque ({stats.outOfStockCount})
            </button>
            <button
              onClick={() => setShowLowStock(!showLowStock)}
              className={`px-4 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all border flex items-center justify-center gap-2 ${
                showLowStock 
                  ? 'bg-yellow-100 text-yellow-700 border-yellow-200 shadow-sm' 
                  : 'bg-white text-muted-foreground border-border/40'
              }`}
            >
              {showLowStock ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
              Estoque Baixo ({stats.lowStockCount})
            </button>
          </div>
        </div>
      </div>

      {/* Conteúdo Principal */}
      <div className="p-4">
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3, 4, 5, 6].map(i => (
              <div key={i} className="h-72 bg-white rounded-[1.5rem] animate-pulse border border-border/20" />
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
                <Link href="/add">
                  <a className="w-full bg-primary text-white font-black py-3 rounded-2xl text-xs uppercase hover:shadow-lg transition-all active:scale-95">
                    Cadastrar Primeiro Produto
                  </a>
                </Link>
              )
            }
          />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredProducts.map((product) => (
              <div key={product.id} className="relative group">
                <ProductCard 
                  product={product} 
                  lowStockThreshold={settings?.lowStockThreshold}
                  onClick={() => {}}
                />

                {/* Action Buttons Overlay - Mobile */}
                <div className="absolute top-3 left-3 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity sm:opacity-100">
                  <button
                    onClick={() => handleQuickShare(product)}
                    className="p-2 bg-white rounded-lg text-green-600 hover:bg-green-50 transition-colors shadow-md"
                    title="Compartilhar WhatsApp"
                  >
                    <Share2 className="w-4 h-4" />
                  </button>
                  <Link href={`/edit-product/${product.id}`}>
                    <a className="p-2 bg-white rounded-lg text-primary hover:bg-primary/10 transition-colors shadow-md">
                      <Edit2 className="w-4 h-4" />
                    </a>
                  </Link>
                  <button
                    onClick={() => handleDelete(product.id)}
                    className="p-2 bg-white rounded-lg text-red-500 hover:bg-red-50 transition-colors shadow-md"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>

                {/* Stock Adjustment - Bottom */}
                <div className="absolute bottom-4 left-4 right-4 flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity sm:opacity-100">
                  <div className="flex items-center gap-1 bg-white p-1.5 rounded-lg shadow-md border border-border/20 flex-1">
                    <button 
                      onClick={() => handleUpdateStock(product.id, product.stock - 1)}
                      className="w-7 h-7 rounded-lg bg-secondary flex items-center justify-center hover:bg-secondary/80 transition-colors"
                    >
                      <Minus className="w-3.5 h-3.5" />
                    </button>
                    <div className="px-2 text-center flex-1">
                      <p className="text-xs font-black leading-none text-foreground">{product.stock}</p>
                    </div>
                    <button 
                      onClick={() => handleUpdateStock(product.id, product.stock + 1)}
                      className="w-7 h-7 rounded-lg bg-primary text-white flex items-center justify-center hover:bg-primary/90 transition-colors"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
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
  );
}
