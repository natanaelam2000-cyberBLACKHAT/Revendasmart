
console.log("TESTE ALTERAÇÃO");
import { Layout } from "@/components/layout";
import { useState, useMemo, useEffect } from "react";
import { Plus, Edit2, Trash2, ChevronRight, Filter, Package } from "lucide-react";
import { Link } from "wouter";
import { Product, deleteImage } from "@/lib/mock-data";
import { ProductImageCard } from "@/components/ProductImageCard";
import { getFirebaseAuth } from "@/lib/firebase";
import { onAuthStateChanged } from "firebase/auth";
import { getFirestore, collection, onSnapshot } from "firebase/firestore";

export default function Products() {
const [genderFilter, setGenderFilter] = useState("todos");
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>("");
  const [selectedCategory, setSelectedCategory] = useState("Todas");
  const [debugInfo, setDebugInfo] = useState({
    uid: "",
    email: "",
    origin: "",
    docCount: 0
  });

  useEffect(() => {
    const auth = getFirebaseAuth();
    console.log("[products] projectId:", import.meta.env.VITE_FIREBASE_PROJECT_ID);
    console.log("[products] auth instance:", !!auth);

    if (!auth) {
      setLoading(false);
      setError("Firebase não inicializado");
      setDebugInfo({ uid: "", email: "", origin: "error", docCount: 0 });
      return;
    }

    let unsubscribeSnapshot: (() => void) | null = null;

    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      console.log("[products] auth state uid:", user?.uid || null);
      
      if (!user) {
        setLoading(false);
        setError("Usuário não autenticado");
        setProducts([]);
        setDebugInfo({ uid: "", email: "", origin: "no-auth", docCount: 0 });
        // Cleanup snapshot listener if exists
        if (unsubscribeSnapshot) unsubscribeSnapshot();
        return;
      }

      // Usar onSnapshot para leitura em tempo real
      const firestore = getFirestore();
   const readPath = `users/${user.uid}/products`;
      console.log("[products] firestore read path:", readPath);

      // Cleanup previous snapshot listener if exists
      if (unsubscribeSnapshot) unsubscribeSnapshot();

    unsubscribeSnapshot = onSnapshot(
  collection(firestore, "users", user.uid, "products"),
        (snapshot) => {
          console.log("[products] firestore docs count:", snapshot.size);
          console.log("[products] firestore doc ids:", snapshot.docs.map(d => d.id));
          const remoteProducts = snapshot.docs
            .map(d => ({
              ...d.data(),
              id: d.id
            } as Product))
            .filter(p => p && typeof p === 'object' && p.id);
          setProducts(remoteProducts);
          setError("");
          setLoading(false);
          setDebugInfo({
            uid: user.uid || "",
            email: user.email || "",
            origin: "firestore-realtime",
            docCount: snapshot.size
          });
        },
        (err) => {
          console.error("[products] firestore snapshot error:", err);
          setError("Erro ao carregar produtos do servidor");
          setProducts([]);
          setLoading(false);
          setDebugInfo({
            uid: user.uid || "",
            email: user.email || "",
            origin: "error",
            docCount: 0
          });
        }
      );
    });

    return () => {
      unsubscribeAuth();
      if (unsubscribeSnapshot) unsubscribeSnapshot();
    };
  }, []);

  const categories = useMemo(() => {
    const cats = new Set<string>();
    products.forEach(p => {
      if (p.category) cats.add(p.category);
    });
    return ["Todas", ...Array.from(cats).sort()];
  }, [products]);

  const filteredProducts = useMemo(() => {
  return products.filter(p => {
    const gender = p.gender || "unisex";

    const matchGender =
      genderFilter === "todos" || gender === genderFilter;

    const matchCategory =
      selectedCategory === "Todas" || p.category === selectedCategory;

    return matchGender && matchCategory;
  });
}, [products, selectedCategory, genderFilter]);

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
    
    if (!auth?.currentUser) {
      setError("Erro: usuário não autenticado");
      return;
    }

    try {
      // Delete image if exists
      if (product?.imageId) {
        deleteImage(product.imageId);
      }

      // Delete product from Firestore
      const { deleteDoc, doc } = await import('firebase/firestore');
      await deleteDoc(doc(firestore, "users", auth.currentUser.uid, "products", id));
      
      // onSnapshot will automatically update products list
      setError(""); // Clear any previous errors
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro desconhecido";
      setError(`Erro ao deletar: ${msg}`);
      console.error("[products] Delete error:", err);
    }
  };
  return (
    <Layout title="ESTOQUE">
      <div className="p-6 pb-32">
        <div className="flex gap-3 mb-6">
          <Link href="/add">
            <a className="flex-1 bg-primary text-white font-bold py-4 rounded-[2rem] shadow-lg flex items-center justify-center gap-2 active:scale-95 transition-all text-sm">
              <Plus className="w-5 h-5" /> Novo Produto
            </a>
          </Link>
        </div>

        <div className="mb-8">
          <label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-4 mb-2 block flex items-center gap-2">
            <Filter className="w-3 h-3" /> Filtrar por categoria
<div className="flex gap-2 mb-3">
  {["todos", "masculino", "feminino", "unisex"].map(g => (
    <button
      key={g}
      onClick={() => setGenderFilter(g)}
      className={`px-3 py-1 rounded-full text-xs ${
        genderFilter === g
          ? "bg-primary text-white"
          : "bg-white border"
      }`}
    >
      {g}
    </button>
  ))}
</div>
          </label>
          <div className="flex gap-2 overflow-x-auto pb-2 no-scrollbar px-1">
            {categories.map(cat => (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className={`px-5 py-2.5 rounded-full text-xs font-bold whitespace-nowrap transition-all border ${
                  selectedCategory === cat 
                    ? 'bg-primary text-white border-primary shadow-md' 
                    : 'bg-white text-muted-foreground border-border/50 hover:bg-secondary/50'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>
        <div className="space-y-4">
          {error ? (
            <div className="text-center py-20 bg-red-50 rounded-[2.5rem] border border-red-200">
              <Package className="w-12 h-12 mx-auto mb-4 text-red-400" />
              <p className="text-sm font-bold text-red-600 mb-2">{error}</p>
              <p className="text-xs text-red-500">Verifique sua conexão e autenticação.</p>
            </div>
          ) : loading ? (
            <div className="text-center py-20 bg-white rounded-[2.5rem] border border-dashed border-border/60">
              <Package className="w-12 h-12 mx-auto mb-4 opacity-20" />
              <p className="text-sm font-medium text-muted-foreground">Carregando produtos...</p>
            </div>
          ) : filteredProducts.length > 0 ? (
            filteredProducts.map((product) => {
  if (!product) return null;

  return (
 <div
        key={product.id}
        className="bg-white p-5 rounded-[2rem] border border-border/50 shadow-sm flex items-center gap-4 group active:bg-secondary/30 transition-colors"
      >
        <ProductImageCard product={product} size="sm" />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <h3 className="font-bold text-sm truncate">
              {product.name || "Produto sem nome"}
            </h3>
          </div>

         
<div className="flex items-center gap-2">
  <span className="text-[9px] font-black text-muted-foreground uppercase tracking-widest bg-secondary px-2 py-0.5 rounded-full">
    {product.brand || "Geral"}
  </span>

  <span className="text-[10px] font-bold text-primary">
    R$ {(product.salePrice || 0).toFixed(2)}
  </span>
</div>

{/* 👇 COLOCA AQUI */}
<div className="flex flex-wrap gap-x-3 gap-y-1 mt-1">
  <p className={`text-[10px] font-bold ${product.stock <= 3 ? 'text-destructive' : 'text-green-600'}`}>
    Estoque: {product.stock || 0} un
  </p>

  {product.costPrice > 0 ? (
    <>
      <p className="text-[10px] text-muted-foreground">
        Lucro: R$ {((product.salePrice || 0) - (product.costPrice || 0)).toFixed(2)}
      </p>
      <p className="text-[10px] text-muted-foreground">
        Margem: {(((product.salePrice - product.costPrice) / (product.salePrice || 1)) * 100).toFixed(0)}%
      </p>
    </>
  ) : (
    <>
      <p className="text-[10px] text-muted-foreground">Lucro: -</p>
      <p className="text-[10px] text-muted-foreground">Margem: -</p>
    </>
  )}
</div>

{/* 👇 BOTÕES */}
<div className="flex gap-1 mt-2">
  <Link href={`/edit-product/${product.id}`}>
    <a className="p-2 text-muted-foreground hover:text-primary">
      <Edit2 className="w-4 h-4" />
    </a>
  </Link>

  <button
    onClick={() => handleDelete(product.id)}
    className="p-2 text-muted-foreground hover:text-destructive"
  >
    <Trash2 className="w-4 h-4" />
  </button>
</div>
        </div>
      </div>
    );
  })) : (
  <div className="text-center py-20 bg-white rounded-[2.5rem] border border-dashed border-border/60">
    <Package className="w-12 h-12 mx-auto mb-4 opacity-20" />
    <p className="text-sm font-medium text-muted-foreground">
      Nenhum produto encontrado.
    </p>
    <Link href="/add">
      <a className="text-primary text-xs font-bold uppercase tracking-widest mt-4 inline-block">
        Cadastrar Novo
      </a>
    </Link>
  </div>
)}  // 🔥 ESSA CHAVE ESTAVA FALTANDO

        {/* Delete Confirmation Modal */}
        {deleteConfirm.show && deleteConfirm.productId && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center sm:items-end z-50 animate-in fade-in p-4 sm:p-0">
            <div className="w-full sm:w-full bg-white rounded-2xl sm:rounded-t-[2rem] p-4 sm:p-6 space-y-4 animate-in slide-in-from-bottom-4 max-h-[90vh] sm:max-h-none overflow-y-auto">
              <div>
                <h2 className="text-lg font-bold text-foreground">Excluir produto?</h2>
                <p className="text-sm text-muted-foreground mt-1">Esta ação não pode ser desfeita.</p>
              </div>
              
              <div className="flex flex-col-reverse sm:flex-row gap-3 pt-2">
                <button
                  onClick={() => setDeleteConfirm({ show: false })}
                  className="flex-1 bg-secondary text-foreground font-bold py-3 rounded-xl text-sm active:scale-95 transition-all"
                  data-testid="button-cancel-delete"
                >
                  Cancelar
                </button>
                <button
                  onClick={() => handleDeleteConfirm(deleteConfirm.productId!)}
                  className="flex-1 bg-destructive text-white font-bold py-3 rounded-xl text-sm active:scale-95 transition-all"
                  data-testid="button-confirm-delete"
                >
                  Excluir
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Removed debug info from production UI */}
      </div>
    </Layout>
  );
}
