import { useState, useMemo } from "react";
import { PageSkeleton } from "@/components/PageSkeleton";
import {
  Plus,
  Edit2,
  Trash2,
  Search,
  Share2,
  AlertTriangle,
  Eye,
  EyeOff
} from "lucide-react";
import { Link } from "wouter";
import { Product, deleteImage } from "@/lib/mock-data";
import { ProductCard } from "@/components/ProductCard";
import { ProductImageCard } from "@/components/ProductImageCard";
import { FilterChips } from "@/components/FilterChips";
import { EmptyState } from "@/components/EmptyState";
import { getFirebaseAuth, logTelemetryEvent } from "@/lib/firebase";
import { getFirestore, doc, deleteDoc, getDoc } from "firebase/firestore";
import { useUserSettings } from "@/hooks/useUserSettings";
import { Layout } from "@/components/layout";
import { notifyError, notifyInfo, notifySuccess } from "@/lib/notify";
import { usePaginatedProductsData } from "@/hooks/usePaginatedProductsData";

export default function Products() {
  const { products, loading, loadingMore, error, hasMore, loadMore, refresh } = usePaginatedProductsData();
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("Todas");
  const [showOutOfStock, setShowOutOfStock] = useState(true);
  const [showLowStock, setShowLowStock] = useState(true);
  const [deleteError, setDeleteError] = useState("");
  const [deletingProductId, setDeletingProductId] = useState<string | null>(null);
  const { settings } = useUserSettings();

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

  const handleQuickShare = (product: Product) => {
    const catalogSlug = settings?.catalogSlug || settings?.catalog_slug || "seu-catalogo";
    const catalogUrl = `https://revendasmart.vercel.app/u/${catalogSlug}`;
    const msg = `Olá! Tenho este produto disponível:\n\n*${product.name}*\nValor: R$ ${product.salePrice.toFixed(2)}\n\nEstoque: ${product.stock} unidade(s)\n\nVeja no catálogo:\n${catalogUrl}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, "_blank");
    
    const user = getFirebaseAuth()?.currentUser;
    logTelemetryEvent("product_quick_shared", { productId: product.id }, user?.uid);
    notifyInfo("Compartilhamento aberto no WhatsApp.");
  };

  const [deleteConfirm, setDeleteConfirm] = useState<{ show: boolean; productId?: string }>({ show: false });
  const productToDelete = useMemo(() => products.find(product => product.id === deleteConfirm.productId), [products, deleteConfirm.productId]);

  const handleDelete = (id: string) => {
    if (!id || !products.some(product => product.id === id)) {
      console.error("[products/delete] Invalid product id", { hasId: Boolean(id) });
      setDeleteError("Não foi possível identificar este produto.");
      notifyError("Não foi possível identificar este produto.");
      return;
    }
    setDeleteError("");
    setDeleteConfirm({ show: true, productId: id });
  };

  const handleDeleteConfirm = async (id: string) => {
    const auth = getFirebaseAuth();
    const uid = auth?.currentUser?.uid;
    const product = products.find(item => item.id === id);
    if (!id || !uid || !product) {
      console.error("[products/delete] Missing deletion context", { hasProductId: Boolean(id), hasUid: Boolean(uid), productFound: Boolean(product) });
      setDeleteError("Não foi possível excluir este produto agora.");
      return;
    }
    setDeletingProductId(id);
    setDeleteError("");
    try {
      const productRef = doc(getFirestore(), "users", uid, "products", id);
      await deleteDoc(productRef);
      const deletedSnapshot = await getDoc(productRef);
      if (deletedSnapshot.exists()) throw new Error("Produto ainda existe após deleteDoc");
      if (product.imageId) await deleteImage(product.imageId);
      setDeleteConfirm({ show: false });
      refresh();
      notifySuccess("Produto removido.");
    } catch (error: any) {
      console.error("[products/delete] Firestore deletion failed", {
        productId: id,
        path: `users/${uid}/products/${id}`,
        code: error?.code || "unknown",
        message: error instanceof Error ? error.message : String(error),
      });
      setDeleteError("Não foi possível excluir o produto. Verifique sua conexão e tente novamente.");
      notifyError("Não foi possível excluir o produto.", "Verifique sua conexão e tente novamente.");
    } finally {
      setDeletingProductId(null);
    }
  };

  return (
    <Layout>
      <div className="min-h-full bg-slate-50 pb-28 lg:pb-8">
      <div className="bg-white border-b border-border/50">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-5 lg:py-7 space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div><p className="text-xs font-semibold text-primary">Produtos</p><h1 className="text-2xl lg:text-3xl font-semibold tracking-tight">Gestão de estoque</h1><p className="text-sm text-muted-foreground mt-1">{products.length} produtos · lucro potencial de R$ {stats.totalProfit.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p></div>
            <Link href="/add-product"><a className="rs-pressable bg-primary text-white px-4 py-3 rounded-xl flex items-center gap-2 shadow-sm text-xs font-semibold whitespace-nowrap"><Plus className="w-4 h-4" /> Novo produto</a></Link>
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
          <PageSkeleton variant="products" count={6} />
        ) : error ? (
          <EmptyState
            icon={<AlertTriangle className="w-12 h-12 text-red-400" />}
            title="Ocorreu um erro temporário."
            description="Não foi possível carregar seus produtos. Tente novamente."
          />
        ) : filteredProducts.length === 0 ? (
          <EmptyState
            icon={<Search className="w-12 h-12 text-primary/40" />}
            title={products.length === 0 ? "Nenhum produto cadastrado" : "Nenhum produto encontrado"}
            description={products.length === 0 ? "Cadastre seu primeiro produto para começar a controlar estoque, lucro e catálogo." : "Tente outro termo ou limpe os filtros para ver todos os produtos."}
            action={
              products.length === 0 ? (
                <Link href="/add-product">
                  <a className="rs-pressable w-full bg-primary text-white font-semibold py-3 rounded-2xl text-xs hover:shadow-lg">
                    Cadastrar produto
                  </a>
                </Link>
              ) : (
                <button
                  type="button"
                  onClick={() => { setSearch(""); setSelectedCategory("Todas"); setShowLowStock(true); setShowOutOfStock(true); }}
                  className="rs-pressable w-full rounded-2xl bg-secondary py-3 text-xs font-semibold text-foreground hover:bg-secondary/80"
                >
                  Limpar filtros
                </button>
              )
            }
          />
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 sm:gap-4">
              {filteredProducts.map((product) => (
                <article key={product.id} className="rs-card-interactive min-w-0 overflow-hidden rounded-2xl border border-border/60 bg-white shadow-sm flex flex-col">
                  <ProductCard product={product} lowStockThreshold={settings?.lowStockThreshold} />
                  <div className="grid grid-cols-3 gap-1.5 border-t border-border/40 p-2 mt-auto">
                    <button onClick={() => handleQuickShare(product)} className="min-w-0 py-2 px-1 bg-green-50 text-green-700 rounded-xl flex items-center justify-center gap-1 text-[10px] font-semibold" title="Compartilhar WhatsApp"><Share2 className="w-3.5 h-3.5 flex-shrink-0" /><span className="truncate">Compartilhar</span></button>
                    <Link href={`/edit-product/${product.id}`}><a className="min-w-0 py-2 px-1 bg-primary/10 text-primary rounded-xl flex items-center justify-center gap-1 text-[10px] font-semibold"><Edit2 className="w-3.5 h-3.5 flex-shrink-0" /><span>Editar</span></a></Link>
                    <button onClick={() => handleDelete(product.id)} className="min-w-0 py-2 px-1 bg-red-50 text-red-600 rounded-xl flex items-center justify-center gap-1 text-[10px] font-semibold" title="Excluir"><Trash2 className="w-3.5 h-3.5 flex-shrink-0" /><span>Excluir</span></button>
                  </div>
                </article>
              ))}
            </div>
            {hasMore && (
              <div className="flex justify-center pt-5">
                <button type="button" onClick={loadMore} disabled={loadingMore} className="rs-pressable rounded-2xl bg-white px-5 py-3 text-xs font-semibold text-primary border border-primary/20 shadow-sm disabled:opacity-60">
                  {loadingMore ? "Carregando..." : "Carregar mais"}
                </button>
              </div>
            )}
          </>        )}
      </div>

      {/* Delete Confirmation Modal */}
      {deleteConfirm.show && deleteConfirm.productId && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-end justify-center z-50 p-4">
          <div className="rs-sheet-enter w-full max-w-md bg-white rounded-t-[2rem] sm:rounded-[3rem] px-6 pt-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] space-y-6 max-h-[calc(100dvh-1rem)] overflow-y-auto overscroll-contain">
            <div className="text-center">
              <h2 className="text-xl font-semibold text-foreground">Excluir produto?</h2>
              <p className="text-sm text-muted-foreground mt-1">Confira os dados antes de confirmar.</p>
            </div>
            {productToDelete && <div className="flex gap-4 rounded-2xl border border-border/50 bg-slate-50 p-4">
              <div className="h-24 w-24 shrink-0 overflow-hidden rounded-2xl bg-white"><ProductImageCard product={productToDelete} size="full" objectFit="contain" /></div>
              <div className="min-w-0 flex-1"><p className="line-clamp-2 text-sm font-semibold">{productToDelete.name}</p><dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2 text-[10px]"><div><dt className="text-muted-foreground">Marca</dt><dd className="truncate font-bold">{typeof productToDelete.brand === "string" && productToDelete.brand ? productToDelete.brand : "Sem marca"}</dd></div><div><dt className="text-muted-foreground">Preço</dt><dd className="font-bold text-primary">R$ {Number(productToDelete.salePrice).toFixed(2)}</dd></div><div className="col-span-2"><dt className="text-muted-foreground">Categoria</dt><dd className="font-bold">{typeof productToDelete.category === "string" && productToDelete.category ? productToDelete.category : "Sem categoria"}</dd></div></dl></div>
            </div>}
            <p className="rounded-xl bg-red-50 p-3 text-center text-xs font-bold text-red-700">Ação irreversível.</p>
            {deleteError && <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-center text-xs font-bold text-red-700">{deleteError}</p>}
            <div className="flex gap-3">
              <button
                onClick={() => setDeleteConfirm({ show: false })}
                className="flex-1 bg-secondary text-foreground font-semibold py-3 rounded-2xl text-xs hover:bg-secondary/80 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={() => handleDeleteConfirm(deleteConfirm.productId!)}
                disabled={deletingProductId === deleteConfirm.productId}
                className="flex-1 bg-red-500 disabled:opacity-60 text-white font-semibold py-3 rounded-2xl text-xs hover:bg-red-600 transition-colors"
              >
                {deletingProductId === deleteConfirm.productId ? "Excluindo..." : "Excluir"}
              </button>
            </div>
          </div>
        </div>
      )}
      </div>
    </Layout>
  );
}
