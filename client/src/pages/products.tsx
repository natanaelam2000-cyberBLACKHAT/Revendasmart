import { Layout } from "@/components/layout";
import { useState, useMemo, useEffect } from "react";
import {
  Plus,
  Edit2,
  Trash2,
  Search,
  Share2,
  DollarSign,
  AlertTriangle,
  Minus,
  Eye,
  EyeOff
} from "lucide-react";
import { Link } from "wouter";
import { Product, deleteImage } from "@/lib/mock-data";
import { ProductImageCard } from "@/components/ProductImageCard";
import { getFirebaseAuth, logTelemetryEvent } from "@/lib/firebase";
import { onAuthStateChanged } from "firebase/auth";
import { getFirestore, collection, onSnapshot, doc, updateDoc, deleteDoc } from "firebase/firestore";
import { useUserSettings } from "@/hooks/useUserSettings";

export default function Products() {
  const [genderFilter, setGenderFilter] = useState("todos");
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

      const gender = p.gender || "unisex";
      const matchGender = genderFilter === "todos" || gender === genderFilter;
      const matchCategory = selectedCategory === "Todas" || p.category === selectedCategory;

      const isOutOfStock = p.stock === 0;
      const isLowStock = p.stock > 0 && p.stock <= 3;
      
      let matchesStockFilter = true;
      if (!showOutOfStock && isOutOfStock) matchesStockFilter = false;
      if (!showLowStock && isLowStock) matchesStockFilter = false;

      return matchSearch && matchGender && matchCategory && matchesStockFilter;
    });
  }, [products, selectedCategory, genderFilter, search, showOutOfStock, showLowStock]);

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

  const getStockColor = (stock: number) => {
    if (stock === 0) return { bg: "bg-red-50", border: "border-red-200", text: "text-red-600", badge: "bg-red-100 text-red-700" };
    if (stock <= 3) return { bg: "bg-yellow-50", border: "border-yellow-200", text: "text-yellow-600", badge: "bg-yellow-100 text-yellow-700" };
    if (stock <= 10) return { bg: "bg-blue-50", border: "border-blue-200", text: "text-blue-600", badge: "bg-blue-100 text-blue-700" };
    return { bg: "bg-green-50", border: "border-green-200", text: "text-green-600", badge: "bg-green-100 text-green-700" };
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
    <Layout title="GESTÃO DE ESTOQUE">
      <div className="bg-[#F8F9FA] min-h-full pb-32">
        {/* Header */}
        <div className="p-6 bg-white border-b border-border/40">
          {/* Lucro Potencial */}
          <div className="mb-6 p-4 rounded-[2rem] border border-primary/10 bg-primary/5">
            <div className="flex items-center gap-2 mb-1">
              <DollarSign className="w-4 h-4 text-primary" />
              <span className="text-[9px] font-black text-primary uppercase tracking-widest">Lucro Potencial</span>
            </div>
            <p className="text-2xl font-black text-foreground">R$ {stats.totalProfit.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
          </div>

          <div className="flex items-center justify-between mb-4">
            <h1 className="text-2xl font-black text-foreground">Produtos</h1>
            <Link href="/add">
              <a className="bg-primary text-white px-5 py-2.5 rounded-2xl flex items-center gap-2 shadow-lg shadow-primary/20 text-xs font-black uppercase tracking-widest">
                <Plus className="w-4 h-4" /> Novo
              </a>
            </Link>
          </div>

          <div className="relative mb-4">
            <Search className="w-5 h-5 absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground/40" />
            <input
              type="text"
              placeholder="Buscar produto..."
              className="w-full bg-secondary/30 border-none rounded-2xl py-3 pl-12 pr-4 text-sm focus:ring-2 focus:ring-primary/20"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div className="space-y-3 mb-4">
            <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
              {categories.map(cat => (
                <button
                  key={cat}
                  onClick={() => setSelectedCategory(cat)}
                  className={`px-4 py-2 rounded-xl text-[10px] font-bold whitespace-nowrap transition-all border ${
                    selectedCategory === cat 
                      ? 'bg-primary text-white border-primary' 
                      : 'bg-white text-muted-foreground border-border/40'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => setShowOutOfStock(!showOutOfStock)}
                className={`flex-1 px-4 py-2.5 rounded-xl text-[10px] font-bold transition-all border flex items-center justify-center gap-2 ${
                  showOutOfStock 
                    ? 'bg-red-100 text-red-700 border-red-200' 
                    : 'bg-white text-muted-foreground border-border/40'
                }`}
              >
                {showOutOfStock ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                Sem Estoque ({stats.outOfStockCount})
              </button>
              <button
                onClick={() => setShowLowStock(!showLowStock)}
                className={`flex-1 px-4 py-2.5 rounded-xl text-[10px] font-bold transition-all border flex items-center justify-center gap-2 ${
                  showLowStock 
                    ? 'bg-yellow-100 text-yellow-700 border-yellow-200' 
                    : 'bg-white text-muted-foreground border-border/40'
                }`}
              >
                {showLowStock ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                Estoque Baixo ({stats.lowStockCount})
              </button>
            </div>
          </div>
        </div>

        {/* Products List */}
        <div className="p-4 space-y-3">
          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3].map(i => (
                <div key={i} className="h-20 bg-white rounded-[2rem] animate-pulse border border-border/20" />
              ))}
            </div>
          ) : error ? (
            <div className="text-center py-16 bg-white rounded-[2.5rem] border border-red-100">
              <AlertTriangle className="w-12 h-12 mx-auto mb-3 text-red-400" />
              <p className="text-sm font-bold text-red-600">{error}</p>
            </div>
          ) : filteredProducts.length === 0 ? (
            <div className="text-center py-16 bg-white rounded-[2.5rem] border border-dashed border-border/60">
              <AlertTriangle className="w-12 h-12 mx-auto mb-3 opacity-20" />
              <p className="text-sm font-bold text-muted-foreground">Nenhum produto encontrado</p>
            </div>
          ) : (
            filteredProducts.map((product) => {
              const profit = product.salePrice - product.costPrice;
              const stockColor = getStockColor(product.stock);

              return (
                <div
                  key={product.id}
                  className={`p-3 rounded-[2rem] border flex items-center gap-3 transition-all ${stockColor.bg} ${stockColor.border} border`}
                >
                  {/* Imagem */}
                  <ProductImageCard product={product} size="md" objectFit="contain" className="!rounded-[1.5rem]" />

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-start gap-2 mb-1">
                      <div className="min-w-0">
                        <p className="text-[8px] font-black text-primary/50 uppercase tracking-widest mb-0.5 truncate">
                          {product.brand || "Geral"}
                        </p>
                        <h3 className="font-bold text-xs text-foreground truncate">
                          {product.name}
                        </h3>
                      </div>
                      <div className="flex gap-1 flex-shrink-0">
                        <button
                          onClick={() => handleQuickShare(product)}
                          className="p-1.5 bg-white rounded-lg text-green-600 hover:bg-green-50 transition-colors shadow-sm"
                          title="Compartilhar WhatsApp"
                        >
                          <Share2 className="w-3.5 h-3.5" />
                        </button>
                        <Link href={`/edit-product/${product.id}`}>
                          <a className="p-1.5 bg-white rounded-lg text-muted-foreground hover:text-primary transition-colors shadow-sm">
                            <Edit2 className="w-3.5 h-3.5" />
                          </a>
                        </Link>
                        <button
                          onClick={() => handleDelete(product.id)}
                          className="p-1.5 bg-white rounded-lg text-muted-foreground hover:text-red-500 transition-colors shadow-sm"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Preço e Lucro */}
                    <div className="flex items-center gap-2 mb-2 text-xs">
                      <span className="font-black text-foreground">R$ {product.salePrice.toFixed(2)}</span>
                      <span className="font-bold text-green-600">+R$ {profit.toFixed(2)}</span>
                    </div>

                    {/* Estoque */}
                    <div className="flex items-center gap-2">
                      <div className="flex items-center gap-1 bg-white p-1 rounded-lg shadow-sm border border-border/20">
                        <button 
                          onClick={() => handleUpdateStock(product.id, product.stock - 1)}
                          className="w-6 h-6 rounded-lg bg-secondary flex items-center justify-center hover:bg-secondary/80 transition-colors"
                        >
                          <Minus className="w-3 h-3" />
                        </button>
                        <div className="px-1.5 text-center min-w-[32px]">
                          <p className={`text-xs font-black leading-none ${stockColor.text}`}>{product.stock}</p>
                        </div>
                        <button 
                          onClick={() => handleUpdateStock(product.id, product.stock + 1)}
                          className="w-6 h-6 rounded-lg bg-primary text-white flex items-center justify-center hover:bg-primary/90 transition-colors"
                        >
                          <Plus className="w-3 h-3" />
                        </button>
                      </div>
                      <span className={`px-2 py-1 rounded-lg font-black text-[8px] whitespace-nowrap ${stockColor.badge}`}>
                        {product.stock === 0 ? "Sem Estoque" : product.stock <= 3 ? "Baixo" : "OK"}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Delete Confirmation */}
      {deleteConfirm.show && deleteConfirm.productId && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-end justify-center z-50 p-4">
          <div className="w-full max-w-md bg-white rounded-[3rem] p-8 space-y-6 animate-in slide-in-from-bottom-full">
            <div className="text-center">
              <div className="w-16 h-16 bg-red-50 rounded-3xl flex items-center justify-center mx-auto mb-4">
                <Trash2 className="w-8 h-8 text-red-500" />
              </div>
              <h2 className="text-xl font-black text-foreground">Excluir Produto?</h2>
              <p className="text-sm text-muted-foreground mt-2">Esta ação é permanente.</p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setDeleteConfirm({ show: false })}
                className="flex-1 bg-secondary text-foreground font-black py-3 rounded-2xl text-xs uppercase"
              >
                Cancelar
              </button>
              <button
                onClick={() => handleDeleteConfirm(deleteConfirm.productId!)}
                className="flex-1 bg-red-500 text-white font-black py-3 rounded-2xl text-xs uppercase"
              >
                Excluir
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
