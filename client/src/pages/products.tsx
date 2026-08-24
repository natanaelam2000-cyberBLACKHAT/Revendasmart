import { useState, useMemo } from "react";
import { PageSkeleton } from "@/components/PageSkeleton";
import {
  Plus,
  Edit2,
  Trash2,
  Search,
  Share2,
  AlertTriangle
} from "lucide-react";
import { Link } from "wouter";
import { Product, deleteImage } from "@/lib/mock-data";
import { ProductCard } from "@/components/ProductCard";
import { ProductImageCard } from "@/components/ProductImageCard";
import { FilterChips } from "@/components/FilterChips";
import { EmptyState } from "@/components/EmptyState";
import { getFirebaseAuth, logTelemetryEvent } from "@/lib/firebase";
import { getFirestore, doc, deleteDoc, getDoc } from "firebase/firestore";
import { useUserSettings } from "@/providers/UserSettingsProvider";
import { Layout } from "@/components/layout";
import { notifyError, notifyInfo, notifySuccess } from "@/lib/notify";
import { usePaginatedProductsData } from "@/hooks/usePaginatedProductsData";
import { normalizeProductCategory } from "@/lib/nicho-config";
import { resolveProductGender } from "@/lib/product-gender";
import { isProductAvailable, resolveProductStock } from "@/lib/product-availability";
import { useDismissibleOnBack } from "@/hooks/useDismissibleOnBack";
import { PRIORITY_QUERY_PARAM } from "@/lib/home-dashboard-view-model";

const GENDER_FILTER_OPTIONS: { value: string; label: string }[] = [
  { value: "todos", label: "Todos" },
  { value: "feminino", label: "Feminino" },
  { value: "masculino", label: "Masculino" },
  { value: "unisex", label: "Unissex" },
];

type ProductPriorityFilter = "out-of-stock" | "low-stock" | "products-without-image";
const PRODUCT_PRIORITY_FILTER_LABEL: Record<ProductPriorityFilter, string> = {
  "out-of-stock": "Sem estoque",
  "low-stock": "Estoque baixo",
  "products-without-image": "Sem imagem",
};

/**
 * RELEASE-26: lê o contexto que o card de Prioridades prometeu ("24 produtos sem estoque") ANTES de
 * cair num /products genérico. Lido uma vez, na montagem — igual ao padrão já usado em
 * marketing-flow.ts (readMarketingLaunchRequest) para deep link/query string.
 */
function readPriorityFilterFromLocation(): ProductPriorityFilter | null {
  if (typeof window === "undefined") return null;
  const value = new URLSearchParams(window.location.search).get(PRIORITY_QUERY_PARAM);
  return value === "out-of-stock" || value === "low-stock" || value === "products-without-image" ? value : null;
}

export default function Products() {
  const { products, loading, loadingMore, error, hasMore, loadMore, refresh, totalCount } = usePaginatedProductsData();
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("Todas");
  const [selectedGender, setSelectedGender] = useState("todos");
  const [showOutOfStock, setShowOutOfStock] = useState(true);
  const [showLowStock, setShowLowStock] = useState(true);
  // Ponto do gate de contexto (RELEASE-26): um card de Prioridades como "sem estoque" precisa isolar
  // SÓ esses produtos aqui — nunca cair na lista inteira sem filtro. `null` = navegação orgânica,
  // sem card de origem, comportamento de sempre. Refresh/deep-link relêem a URL do zero (useState
  // inicializador); back-navigation não depende de estado nenhum aqui, só do histórico do navegador.
  const [priorityFilter, setPriorityFilter] = useState<ProductPriorityFilter | null>(readPriorityFilterFromLocation);
  const [deleteError, setDeleteError] = useState("");
  const [deletingProductId, setDeletingProductId] = useState<string | null>(null);
  const { settings } = useUserSettings();

  const stats = useMemo(() => {
    let totalProfit = 0;
    let lowStockCount = 0;
    let outOfStockCount = 0;

    for (const product of products) {
      const stock = resolveProductStock(product);
      totalProfit += (product.salePrice - product.costPrice) * stock;
      if (!isProductAvailable(product)) outOfStockCount += 1;
      else if (stock <= 3) lowStockCount += 1;
    }

    return { totalProfit, lowStockCount, outOfStockCount };
  }, [products]);

  const categories = useMemo(() => {
    const cats = new Set<string>();
    products.forEach(p => {
      const normalized = normalizeProductCategory(p.category);
      if (normalized) cats.add(normalized);
    });
    return ["Todas", ...Array.from(cats).sort()];
  }, [products]);

  const normalizedSearch = useMemo(() => search.trim().toLowerCase(), [search]);

  // Só faz sentido oferecer o filtro de público quando o lote carregado tem mais de um valor.
  const genderOptionsPresent = useMemo(() => new Set(products.map((p) => resolveProductGender(p))), [products]);
  const showGenderFilter = genderOptionsPresent.size > 1;

  const filteredProducts = useMemo(() => {
    return products.filter(p => {
      const matchSearch =
        !normalizedSearch ||
        p.name?.toLowerCase().includes(normalizedSearch) ||
        p.brand?.toLowerCase().includes(normalizedSearch);

      const matchCategory = selectedCategory === "Todas" || normalizeProductCategory(p.category) === selectedCategory;
      const matchGender = selectedGender === "todos" || resolveProductGender(p) === selectedGender;

      const stock = resolveProductStock(p);
      const isOutOfStock = !isProductAvailable(p);
      const isLowStock = isProductAvailable(p) && stock <= 3;
      const hasNoImage = !p.imageUrl && !p.thumbnailUrl;

      let matchesStockFilter = true;
      if (priorityFilter === "out-of-stock") matchesStockFilter = isOutOfStock;
      else if (priorityFilter === "low-stock") matchesStockFilter = isLowStock;
      else if (priorityFilter === "products-without-image") matchesStockFilter = hasNoImage;
      else {
        if (!showOutOfStock && isOutOfStock) matchesStockFilter = false;
        if (!showLowStock && isLowStock) matchesStockFilter = false;
      }

      return matchSearch && matchCategory && matchGender && matchesStockFilter;
    });
  }, [products, selectedCategory, selectedGender, normalizedSearch, showOutOfStock, showLowStock, priorityFilter]);

  // Nunca trata o lote carregado (paginado) como o total real de produtos da loja.
  const countLabel = useMemo(() => {
    const loadedLabel = totalCount != null
      ? (hasMore ? `${products.length} de ${totalCount} produtos` : `${totalCount} produto${totalCount === 1 ? "" : "s"}`)
      : (hasMore ? `${products.length} produtos carregados` : `${products.length} produto${products.length === 1 ? "" : "s"}`);
    return filteredProducts.length !== products.length
      ? `${filteredProducts.length} exibidos de ${loadedLabel}`
      : loadedLabel;
  }, [products.length, filteredProducts.length, totalCount, hasMore]);

  const handleQuickShare = (product: Product) => {
    const catalogSlug = settings?.catalogSlug || settings?.catalog_slug || "";
    if (!catalogSlug) {
      notifyError("Configure o link do seu catálogo em Configurações antes de compartilhar.");
      return;
    }
    const catalogUrl = `https://revendasmart.vercel.app/u/${catalogSlug}`;
    const msg = `Olá! Tenho este produto disponível:\n\n*${product.name}*\nValor: R$ ${product.salePrice.toFixed(2)}\n\nEstoque: ${product.stock} unidade(s)\n\nVeja no catálogo:\n${catalogUrl}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, "_blank");

    const user = getFirebaseAuth()?.currentUser;
    logTelemetryEvent("product_quick_shared", { productId: product.id }, user?.uid);
    notifyInfo("Compartilhamento aberto no WhatsApp.");
  };

  const [deleteConfirm, setDeleteConfirm] = useState<{ show: boolean; productId?: string }>({ show: false });
  const productToDelete = useMemo(() => products.find(product => product.id === deleteConfirm.productId), [products, deleteConfirm.productId]);
  // P1-01: confirmação de exclusão é um overlay customizado — back físico fecha o modal, nunca navega
  // para longe da tela com a confirmação ainda pendente.
  useDismissibleOnBack(deleteConfirm.show, () => setDeleteConfirm({ show: false }));

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
      <div className="min-h-full bg-background pb-28 lg:pb-8">
      <div className="bg-white border-b border-border/50">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-5 lg:py-7 space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div><p className="text-xs font-semibold text-primary">Produtos</p><h1 className="text-2xl lg:text-3xl font-semibold tracking-tight">Gestão de estoque</h1><p className="text-sm text-muted-foreground mt-1">{countLabel} · lucro potencial de R$ {stats.totalProfit.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p></div>
            <Link href="/add-product"><a className="rs-pressable bg-primary text-white px-4 py-3 rounded-xl flex items-center gap-2 shadow-sm text-xs font-semibold whitespace-nowrap"><Plus className="w-4 h-4" /> Novo produto</a></Link>
          </div>
          <div className="relative"><Search className="w-4 h-4 absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground/50" /><input type="text" placeholder="Buscar por nome ou marca..." className="w-full bg-muted border border-border/60 rounded-xl py-3 pl-11 pr-4 text-sm focus:ring-2 focus:ring-primary/20 outline-none" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
          {priorityFilter && (
            <div className="flex items-center justify-between gap-3 rounded-xl border border-primary/20 bg-primary/5 px-3 py-2.5" data-testid="banner-priority-filter">
              <p className="text-xs font-bold text-primary">Filtro: {PRODUCT_PRIORITY_FILTER_LABEL[priorityFilter]}</p>
              <button type="button" onClick={() => setPriorityFilter(null)} className="rs-pressable rounded-lg px-2 py-1 text-[11px] font-bold text-primary hover:bg-primary/10" data-testid="button-clear-priority-filter">
                Ver todos
              </button>
            </div>
          )}
        </div>
      </div>
      {/* Barra de categorias fixa: nunca some durante a rolagem */}
      <div className="sticky top-0 z-20 bg-white border-b border-border/50 shadow-sm">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-3 space-y-2">
          <FilterChips options={categories} selected={selectedCategory} onSelect={setSelectedCategory} className="!mx-0 !px-0 !pb-0" />
          {showGenderFilter && (
            <div className="flex gap-1.5 overflow-x-auto hide-scrollbar">
              {GENDER_FILTER_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setSelectedGender(option.value)}
                  aria-pressed={selectedGender === option.value}
                  className={`min-h-8 shrink-0 whitespace-nowrap rounded-full border px-3 text-[11px] font-bold transition-colors ${
                    selectedGender === option.value ? "border-primary bg-primary/10 text-primary" : "border-border bg-white text-muted-foreground"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          )}
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
                  onClick={() => { setSearch(""); setSelectedCategory("Todas"); setSelectedGender("todos"); setShowLowStock(true); setShowOutOfStock(true); setPriorityFilter(null); }}
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
        <div className="fixed inset-0 z-[130] flex items-end justify-center bg-black/70 p-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,calc(env(safe-area-inset-bottom)+1rem))] backdrop-blur-sm">
          <div className="rs-sheet-enter flex max-h-[calc(100dvh-2rem)] w-full max-w-md flex-col overflow-hidden rounded-t-[2rem] bg-white shadow-2xl sm:rounded-[2rem]">
            <div className="shrink-0 px-6 pt-6 pb-4 text-center">
              <h2 className="text-xl font-semibold text-foreground">Excluir produto?</h2>
              <p className="mt-1 text-sm text-muted-foreground">Confira os dados antes de confirmar.</p>
            </div>
            <div className="min-h-0 overflow-y-auto overscroll-contain px-6 pb-4 space-y-4">
              {productToDelete && <div className="flex gap-4 rounded-2xl border border-border/50 bg-muted p-4">
                <div className="h-24 w-24 shrink-0 overflow-hidden rounded-2xl bg-white"><ProductImageCard product={productToDelete} size="full" objectFit="contain" /></div>
                <div className="min-w-0 flex-1"><p className="line-clamp-2 text-sm font-semibold">{productToDelete.name}</p><dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2 text-[10px]"><div><dt className="text-muted-foreground">Marca</dt><dd className="truncate font-bold">{typeof productToDelete.brand === "string" && productToDelete.brand ? productToDelete.brand : "Sem marca"}</dd></div><div><dt className="text-muted-foreground">Preço</dt><dd className="font-bold text-primary">R$ {Number(productToDelete.salePrice).toFixed(2)}</dd></div><div className="col-span-2"><dt className="text-muted-foreground">Categoria</dt><dd className="font-bold">{typeof productToDelete.category === "string" && productToDelete.category ? normalizeProductCategory(productToDelete.category) : "Sem categoria"}</dd></div></dl></div>
              </div>}
              <p className="rounded-xl bg-red-50 p-3 text-center text-xs font-bold text-red-700">Ação irreversível.</p>
              {deleteError && <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-center text-xs font-bold text-red-700">{deleteError}</p>}
            </div>
            <div className="shrink-0 border-t border-border/60 bg-white/95 px-6 pt-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] backdrop-blur">
              <div className="flex gap-3">
                <button
                  onClick={() => setDeleteConfirm({ show: false })}
                  className="min-h-12 flex-1 rounded-2xl bg-secondary text-xs font-semibold text-foreground transition-colors hover:bg-secondary/80"
                >
                  Cancelar
                </button>
                <button
                  onClick={() => handleDeleteConfirm(deleteConfirm.productId!)}
                  disabled={deletingProductId === deleteConfirm.productId}
                  className="min-h-12 flex-1 rounded-2xl bg-red-500 text-xs font-semibold text-white transition-colors hover:bg-red-600 disabled:opacity-60"
                >
                  {deletingProductId === deleteConfirm.productId ? "Excluindo..." : "Excluir"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      </div>
    </Layout>
  );
}
