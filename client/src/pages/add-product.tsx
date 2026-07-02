import React, { useState, useEffect, useRef, useMemo, lazy, Suspense } from "react";
import { Layout } from "@/components/layout";
import { Camera, CheckCircle2, ChevronDown, ScanLine, Wand2, Sparkles, ChevronLeft, ImagePlus, AlertCircle } from "lucide-react";
import { useLocation, useParams } from "wouter";

const BarcodeScanner = lazy(
  () => import("@/components/barcode-scanner")
);
import { Product, defaultSettings } from "@/lib/mock-data";
import type { PlanType } from "@shared/monetization";
import { getFirebaseAuth, getFirebaseIdToken, logTelemetryEvent, trackAnalyticsEvent, measureOperation } from "@/lib/firebase";
import {
  getFirestore,
  doc,
  setDoc,
  getDoc,
  getDocs,
  collection
} from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { getStorage } from "firebase/storage";
import { useUserSettings } from "@/hooks/useUserSettings";
import { usePlanData } from "@/hooks/usePlanData";
import { notifyError, notifySuccess } from "@/lib/notify";
import { checkProductLimit } from "@/lib/plan-helpers";
import {
  getNichoConfig,
  inferNichoFromCategory,
  toBusinessTypesArray,
  type NichoId
} from "@/lib/nicho-config";

/**
 * Comprime uma imagem usando Canvas
 * @param file - Arquivo de imagem
 * @param maxWidth - Largura máxima (default 1200px)
 * @param maxHeight - Altura máxima (default 1200px)
 * @param quality - Qualidade JPEG (0-1, default 0.85)
 * @param targetSize - Tamanho alvo em bytes (default 2MB)
 * @returns Promise<Blob | null> - Blob comprimido ou null se exceder limite
 */
// 🔥 CORRIGIDO COMPLETO

async function compressImage(
  file: File,
  maxWidth = 1200,
  maxHeight = 1200,
  quality = 0.85,
  targetSize = 2 * 1024 * 1024
): Promise<Blob | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      const img = new Image();

      img.onload = () => {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");

        if (!ctx) return resolve(null);

        canvas.width = img.width;
        canvas.height = img.height;

        ctx.drawImage(img, 0, 0);

        canvas.toBlob(
          (blob) => resolve(blob || null),
          "image/jpeg",
          quality
        );
      };

      img.onerror = () => resolve(null);
      img.src = e.target?.result as string;
    };

    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}


const normalizeBrandInput = (value: string) => value
  .trim()
  .replace(/\s+/g, " ")
  .toLocaleLowerCase("pt-BR")
  .replace(/(^|\s|[-'])[a-záàâãéèêíïóôõöúçñ]/g, (match) => match.toLocaleUpperCase("pt-BR"));

const brandSuggestionStorageKey = (nicho: string) => `rs:brand-suggestions:${nicho}`;

function loadLocalBrandSuggestions(nicho: string): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(brandSuggestionStorageKey(nicho));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function saveLocalBrandSuggestion(nicho: string, value: string, existing: string[]): string[] {
  const normalized = normalizeBrandInput(value);
  if (!normalized) return existing;
  const merged = [normalized, ...existing.filter((item) => item.toLocaleLowerCase("pt-BR") !== normalized.toLocaleLowerCase("pt-BR"))].slice(0, 20);
  if (typeof window !== "undefined") {
    try { localStorage.setItem(brandSuggestionStorageKey(nicho), JSON.stringify(merged)); } catch {}
  }
  return merged;
}

interface ProductFormData {
  name: string;
  brand: string;
  origin: string;
  category: string;
  costPrice: number;
  salePrice: number;
  stock: number;
  barcode: string;
  description: string;
  imageUrl: string;
  storagePath: string;
  extras: Record<string, string>;
  isFeatured: boolean;
  isOnSale: boolean;
  discountPercent: number;
  productType: string;
  gender: string;
}

export default function AddProduct() {


const [, setLocation] = useLocation();
  const { id } = useParams();
  const [success, setSuccess] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [isEnhancing, setIsEnhancing] = useState(false);
  const [isCompressingImage, setIsCompressingImage] = useState(false);
  const [formError, setFormError] = useState<string>("");
  const [showLimitModal, setShowLimitModal] = useState(false);

  const { settings: firestoreSettings } = useUserSettings();
  const settings = firestoreSettings || defaultSettings;
  const { activePlan } = usePlanData();

  // Derive effective business types array (supports both singular and array)
  const businessTypes = toBusinessTypesArray(settings?.businessType, settings?.businessTypes);
  const hasMultipleNichos = businessTypes.length > 1;

  const [saveConfirmation, setSaveConfirmation] = useState(false);
  const [uploadError, setUploadError] = useState<string>("");
  const [debugStatus, setDebugStatus] = useState({
    uid: "",
    saveAttempted: false,
    saveError: ""
  });
  const selectedFileRef = useRef<File | null>(null);

  // Active product nicho: if user has multiple types, user selects manually
  const [activeNicho, setActiveNicho] = useState<NichoId>(
    businessTypes[0] as NichoId || 'Geral'
  );
  const nichoConfig = getNichoConfig(activeNicho);

  // Categories: ALWAYS from the active nicho only (never mix nichos)
  // Even with multiple business types, show only categories of the currently selected type
  const baseCategorySuggestions = nichoConfig.categories;

  // For brand: track if user is typing custom brand
  const [brandMode, setBrandMode] = useState<'predefined' | 'custom'>('predefined');
  const [localBrandSuggestions, setLocalBrandSuggestions] = useState<string[]>(() => loadLocalBrandSuggestions(activeNicho));
  const hasPredefinedBrands = !!nichoConfig.predefinedBrands;

 const [formData, setFormData] = useState<ProductFormData>({
  name: "",
  brand: hasPredefinedBrands ? (nichoConfig.predefinedBrands![0] || "") : "",
  origin: nichoConfig.originOptions[0] || "",
  category: baseCategorySuggestions[0] || "",
  costPrice: 0,
  salePrice: 0,
  stock: 0,
  barcode: "",
  description: "",
  imageUrl: "",
  storagePath: "",
  extras: {}, // ✅ CORRETO
  isFeatured: false,
  isOnSale: false,
  discountPercent: 0,
  productType: activeNicho as string,
  gender: "unisex"
});

  const categorySuggestions = useMemo<string[]>(() => {
    if (formData.category && !nichoConfig.categories.includes(formData.category)) {
      return [...nichoConfig.categories, formData.category];
    }
    return nichoConfig.categories;
  }, [formData.category, nichoConfig.categories]);
  const brandSuggestions = useMemo(() => {
    const seen = new Set<string>();
    const merged: string[] = [];
    for (const brand of [...(nichoConfig.predefinedBrands || []), ...localBrandSuggestions]) {
      const key = brand.toLocaleLowerCase("pt-BR");
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(brand);
      }
    }
    return merged;
  }, [localBrandSuggestions, nichoConfig.predefinedBrands]);


 useEffect(() => {
  return () => {
    if (formData.imageUrl) {
      URL.revokeObjectURL(formData.imageUrl);
    }
  };
}, [formData.imageUrl]);
  // When active nicho changes (user switches type selector), update category, brand, and CLEAN extras
  useEffect(() => {
    const newConfig = getNichoConfig(activeNicho);
    const newHasPredefined = !!newConfig.predefinedBrands;
    setLocalBrandSuggestions(loadLocalBrandSuggestions(activeNicho));
    setFormData(prev => {
      const newCategory = prev.category;
      // If current category doesn't belong to new nicho, reset to first category of new nicho
      const categoryExists = newConfig.categories.includes(newCategory);
      const validCategory = categoryExists ? newCategory : (newConfig.categories[0] || "");

      return {
        ...prev,
        category: validCategory,
        brand: newHasPredefined ? (newConfig.predefinedBrands![0] || "") : "",
        origin: newConfig.originOptions[0] || "",
        productType: activeNicho,
        // CRITICAL: Clean extras to prevent spillover from previous nicho
        extras: {},
      };
    });
    setBrandMode(newHasPredefined ? 'predefined' : 'custom');
  }, [activeNicho]);

  // Load existing product for edit
  useEffect(() => {
    if (id) {
      const auth = getFirebaseAuth();
      if (auth?.currentUser) {
        const firestore = getFirestore();
        getDoc(doc(firestore, "users", auth.currentUser.uid, "products", id))
          .then(docSnap => {
            if (docSnap.exists()) {
              const product = docSnap.data() as Product;
              const inferredNicho = (product.productType as NichoId) ||
                inferNichoFromCategory(product.category || "");
              setActiveNicho(inferredNicho);

              const savedNichoConfig = getNichoConfig(inferredNicho);
              const savedHasPredefined = !!savedNichoConfig.predefinedBrands;
              const isCustomBrand = savedHasPredefined &&
                !!product.brand &&
                !savedNichoConfig.predefinedBrands!.includes(product.brand);

              setBrandMode(isCustomBrand ? 'custom' : (savedHasPredefined ? 'predefined' : 'custom'));
              setFormData({
                name: product.name,
                brand: product.brand || "",
                origin: product.origin || product.extras?.origin || "",
                category: product.category || "",
                costPrice: product.costPrice,
                salePrice: product.salePrice,
                stock: product.stock,
             barcode: "",
                description: product.description || "",
                imageUrl: product.imageUrl || "",
                storagePath: product.storagePath || "",
                extras: product.extras || {},
                isFeatured: product.isFeatured || false,
                isOnSale: product.isOnSale || false,
                discountPercent: product.discountPercent || 0,
                productType: product.productType || inferredNicho,
                gender: product.gender || "unisex",
              });
            }
          })
          .catch(err => console.error("Erro ao carregar produto:", err));
      }
    }
  }, [id]);

  const updateExtra = (key: string, value: string) => {
    setFormData(prev => ({
      ...prev,
      extras: { ...prev.extras, [key]: value }
    }));
  };

  /** Renderiza campo extra (text, date, number, ou select) */
  const renderExtraField = (field: any) => {
    const commonClass = "w-full bg-white border border-border rounded-2xl px-4 py-3 text-sm focus:outline-none";

    if (field.type === 'select' && field.options) {
      return (
        <select
          className={`${commonClass} appearance-none`}
          value={formData.extras[field.key] || ''}
          onChange={e => updateExtra(field.key, e.target.value)}
          data-testid={`input-extra-${field.key}`}
        >
          <option value="">{field.placeholder}</option>
          {field.options.map((opt: string) => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
      );
    }

    return (
      <input
        type={field.type === 'select' ? 'text' : field.type}
        placeholder={field.placeholder}
        className={commonClass}
        value={formData.extras[field.key] || ''}
        onChange={e => updateExtra(field.key, e.target.value)}
        data-testid={`input-extra-${field.key}`}
      />
    );
  };

  /** Renderiza campos extras baseados no nicho ativo — sem mistura entre nichos */
  const renderExtraFields = () => {
    const { extraFields } = getNichoConfig(activeNicho);
    if (!extraFields || extraFields.length === 0) return null;

    const rows: React.ReactElement[] = [];
    let i = 0;
    while (i < extraFields.length) {
      const field = extraFields[i];
      const nextField = extraFields[i + 1];

      if (field.halfWidth && nextField?.halfWidth && nextField.type !== 'select') {
        // Pair two halfWidth fields side by side (only if neither is select)
        rows.push(
          <div key={`row-${i}`} className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-muted-foreground uppercase px-1">{field.label}</label>
              {renderExtraField(field)}
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-muted-foreground uppercase px-1">{nextField.label}</label>
              {renderExtraField(nextField)}
            </div>
          </div>
        );
        i += 2;
      } else {
        // Single field (fullWidth or select)
        rows.push(
          <div key={`row-${i}`} className="space-y-1.5">
            <label className="text-[10px] font-bold text-muted-foreground uppercase px-1">{field.label}</label>
            {renderExtraField(field)}
          </div>
        );
        i += 1;
      }
    }
    return <>{rows}</>;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      setUploadError("");
      setFormError("");
      setDebugStatus({ uid: "", saveAttempted: true, saveError: "" });
      const auth = getFirebaseAuth();
      const uid = auth?.currentUser?.uid;

      if (!uid) {
        setDebugStatus({ uid: "", saveAttempted: true, saveError: "UID null" });
        setFormError("Erro: usuário não autenticado. Faça login novamente.");
        return;
      }

      setDebugStatus({ uid: uid, saveAttempted: true, saveError: "" });
let imageUrl = formData.imageUrl || "";      let storagePath = formData.storagePath || "";
      const file = selectedFileRef.current;
      const firestore = getFirestore();
const productRef = doc(collection(firestore, "users", uid, "products"));
const productId = id || productRef.id;


      if (file) {
        try {
          const safeName = file.name.replace(/\s+/g, "_");
          storagePath = `users/${uid}/products/${productId}/${safeName}`;
          const storage = getStorage();
          const storageRef = ref(storage, storagePath);
        await uploadBytes(storageRef, file);
          imageUrl = await getDownloadURL(storageRef);
        } catch (uploadErr) {
          console.warn("[add-product] image upload failed, saving without image:", uploadErr);
          setUploadError("Falha no upload da imagem. O produto será salvo sem foto.");
          imageUrl = "";
          storagePath = "";
        }
      }

      const normalizedBrand = normalizeBrandInput(formData.brand);
      if (normalizedBrand && brandMode === "custom") {
        setLocalBrandSuggestions((current) => saveLocalBrandSuggestion(activeNicho, normalizedBrand, current));
      }

     const productData = {
  ...formData,
  brand: normalizedBrand,
  gender: formData.gender || "unisex",
  imageUrl,
  storagePath,
  productType: activeNicho,
};

      // VALIDATION: Ensure required fields exist and are valid
      if (!productData.name || productData.name.trim().length === 0) {
        setFormError("Nome do produto é obrigatório.");
        return;
      }
     if (!Number.isFinite(productData.costPrice) || productData.costPrice < 0) {
  setFormError("Preço de custo inválido.");
  return;
}
 if (!Number.isFinite(productData.salePrice) || productData.salePrice <= 0) {
  setFormError("Preço de venda deve ser maior que 0.");
  return;
}
      if (!productData.category || productData.category.trim().length === 0) {
        setFormError("Categoria é obrigatória.");
        return;
      }


      if (id) {
        try {
     await setDoc(
  doc(firestore, "users", uid, "products", id),
  { ...productData, id },
  { merge: true }
);
        } catch (writeErr) {
          const errorMsg = (writeErr as Error)?.message || "unknown error";
          console.error("[add-product] Update failed:", errorMsg);
          setDebugStatus({ uid: uid, saveAttempted: true, saveError: `EDIT failed: ${errorMsg}` });
          setFormError(`Erro ao atualizar: ${errorMsg}`);
          throw writeErr;
        }
      } else {
        // Validate plan limits for new products.
if (!uid) {
  setFormError("Usuário não autenticado.");
  notifyError("Sessão expirada. Faça login novamente.");
  return;
}

const productDocs = await getDocs(
  collection(firestore, "users", uid, "products")
);

const productCount = productDocs.size;

const safePlan: PlanType = activePlan === "premium" ? "premium" : "free";
const { allowed } = checkProductLimit(safePlan, productCount, true);

if (!allowed) {
  setShowLimitModal(true);
  setFormError("Limite de produtos atingido no plano.");
  return;
}

        const newProduct: Product = { ...productData, id: productId };
        try {
          await measureOperation("product_creation", async () => {
  await setDoc(
    doc(firestore, "users", uid, "products", productId),
    newProduct
  );

  const docRef = doc(firestore, "users", uid, "products", productId);
  const docSnap = await getDoc(docRef);

  if (!docSnap.exists()) {
    console.error("[add-product] Verification failed");
    setFormError("Erro ao salvar no servidor.");
    throw new Error("Verification failed");
  }

});
        } catch (writeErr) {
          const errorMsg = (writeErr as Error)?.message || "unknown error";
          console.error("[add-product] Create failed:", errorMsg);
          setDebugStatus({ uid: uid, saveAttempted: true, saveError: `CREATE failed: ${errorMsg}` });
          setFormError("Erro ao salvar produto.");
          notifyError("Erro ao salvar produto.");
          throw writeErr;
        }
      }

      setSuccess(true);
      notifySuccess(id ? "Produto atualizado." : "Produto salvo.");

      const userId = auth?.currentUser?.uid;
      if (userId && !id) {
     logTelemetryEvent("product_created", {
  productId,
  category: formData.category,
  price: formData.salePrice,
  nicho: activeNicho,
  hasImage: !!imageUrl,
  extrasCount: Object.keys(formData.extras).length
}, userId);
        trackAnalyticsEvent("view_item", {
          items: [{ item_id: productId, item_name: formData.name, price: formData.salePrice }],
        });
      }

      setTimeout(() => setLocation("/products"), 1500);
    } catch (err) {
      notifyError("Erro ao salvar produto.");
      console.error("[add-product] handleSubmit failed:", err);
    }
  };

  const handleBarcodeScan = (code: string) => {
    setFormData(prev => ({ ...prev, barcode: code }));
  };

const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
  const file = e.target.files?.[0];
  if (!file) return;

  setIsCompressingImage(true);
  setFormError("");

  try {
    const compressedBlob = await compressImage(file);

    if (!compressedBlob) {
      setFormError("Erro ao processar a imagem.");
      notifyError("Erro ao processar a imagem.");
      return;
    }

    const compressedFile = new File([compressedBlob], file.name, {
      type: "image/jpeg",
      lastModified: Date.now(),
    });

    selectedFileRef.current = compressedFile;

    setFormData(prev => {
      if (prev.imageUrl) {
        URL.revokeObjectURL(prev.imageUrl);
      }
      return {
        ...prev,
        imageUrl: URL.createObjectURL(compressedFile),
      };
    });

  } catch (err) {
    console.error("[add-product] Compression error:", err);
    setFormError("Erro ao otimizar a imagem.");
  } finally {
    setIsCompressingImage(false);
  }
};
  const enhancePhoto = () => {
    if (!formData.imageUrl) return;
    setIsEnhancing(true);
    setTimeout(() => { setIsEnhancing(false); setSuccess(true); }, 2000);
  };

  if (success) {
    return (
      <Layout>
        <div className="flex flex-col items-center justify-center h-full p-6 text-center animate-in fade-in zoom-in duration-300">
          <div className="w-24 h-24 bg-green-100 rounded-full flex items-center justify-center mb-6">
            <CheckCircle2 className="w-12 h-12 text-green-600" />
          </div>
          <h2 className="text-2xl font-bold text-foreground mb-2">Produto {id ? 'Atualizado' : 'Adicionado'}!</h2>
          <p className="text-muted-foreground">O produto foi salvo no seu estoque com sucesso.</p>
        </div>
      </Layout>
    );
  }

  // Limit Modal for Free Plan
  if (showLimitModal) {
    return (
      <Layout title="Limite Atingido">
        <div className="px-6 py-8 flex flex-col items-center justify-center min-h-screen gap-6">
          <div className="w-20 h-20 bg-amber-100 rounded-full flex items-center justify-center">
            <AlertCircle className="w-12 h-12 text-amber-600" />
          </div>

          <div className="text-center space-y-3">
            <h2 className="text-2xl font-bold text-foreground">Limite de Produtos Atingido</h2>
            <p className="text-sm text-muted-foreground">
              Você atingiu o limite de <strong>30 produtos</strong> no plano Grátis.
            </p>
            <p className="text-sm text-muted-foreground">
              Upgrade para Premium para adicionar produtos ilimitados!
            </p>
          </div>

          <div className="bg-blue-50 border border-blue-200 rounded-3xl p-4 w-full space-y-2">
            <p className="text-xs text-blue-700 font-bold">Plano Premium inclui:</p>
            <ul className="text-xs text-blue-600 space-y-1 list-disc list-inside">
              <li>Produtos ilimitados</li>
              <li>Clientes ilimitados</li>
              <li>Cobranças via Mercado Pago</li>
              <li>Múltiplos tipos de negócio</li>
            </ul>
          </div>

          <div className="flex gap-3 w-full">
            <button
              onClick={() => setShowLimitModal(false)}
              className="flex-1 bg-secondary text-foreground font-bold py-3 rounded-xl"
              data-testid="button-close-limit-modal"
            >
              Entendi
            </button>
            <button
              onClick={() => setLocation('/subscribe')}
              className="flex-1 bg-primary text-white font-bold py-3 rounded-xl"
              data-testid="button-upgrade-premium"
            >
              Upgrade →
            </button>
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout title={id ? "Editar Produto" : "Novo Produto"}>
      <div className="px-4 sm:px-6 py-4 pb-[max(8rem,calc(env(safe-area-inset-bottom)+7rem))] max-w-4xl mx-auto">
        <button onClick={() => setLocation("/products")} className="flex items-center gap-2 text-muted-foreground mb-6 font-medium">
          <ChevronLeft className="w-4 h-4" /> Voltar
        </button>

        <form onSubmit={handleSubmit} className="flex flex-col gap-5">

          {/* === SELETOR DE NICHO (só aparece se usuário tiver múltiplos tipos) === */}
          {hasMultipleNichos && (
            <div className="p-4 bg-secondary/30 rounded-[2rem] space-y-3">
              <h3 className="text-[10px] font-black text-primary uppercase tracking-widest px-1">
                Tipo deste produto
              </h3>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {businessTypes.map((nichoId) => {
                  const cfg = getNichoConfig(nichoId);
                  const isActive = activeNicho === nichoId;
                  return (
                    <button
                      key={nichoId}
                      type="button"
                      data-testid={`nicho-selector-${nichoId}`}
                      onClick={() => setActiveNicho(nichoId as NichoId)}
                      className={`flex flex-col items-center gap-1.5 py-3 px-2 rounded-2xl border-2 transition-all text-center ${
                        isActive
                          ? 'border-primary bg-primary/5 text-primary'
                          : 'border-border bg-white text-muted-foreground hover:border-primary/30'
                      }`}
                    >
                      <span className="text-[10px] font-black uppercase tracking-wide leading-tight">{cfg.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Photo area */}
          <div className="flex flex-col items-center gap-4 mb-2">
            <div className="relative group cursor-pointer">
              <div className="w-40 h-40 bg-secondary rounded-[2.5rem] border-2 border-dashed border-border/60 flex flex-col items-center justify-center text-muted-foreground transition-all overflow-hidden relative">
                {formData.imageUrl && !isEnhancing && !isCompressingImage ? (
                   <img src={formData.imageUrl} alt="Prévia do produto" className="w-full h-full object-cover" loading="lazy" decoding="async" />
                ) : isCompressingImage ? (
                  <div className="absolute inset-0 bg-primary/20 flex flex-col items-center justify-center text-primary">
                    <Sparkles className="w-8 h-8 animate-spin" />
                    <span className="text-[10px] font-bold mt-1 uppercase">Otimizando...</span>
                  </div>
                ) : isEnhancing ? (
                  <div className="absolute inset-0 bg-primary/20 flex flex-col items-center justify-center text-primary">
                    <Sparkles className="w-8 h-8 animate-bounce" />
                    <span className="text-[10px] font-bold mt-1 uppercase">Melhorando...</span>
                  </div>
                ) : (
                  <>
                    <Camera className="w-8 h-8 mb-2" />
                    <span className="text-[10px] font-bold uppercase tracking-wider">Adicionar Foto</span>
                  </>
                )}
              </div>
              <button
                type="button"
                onClick={enhancePhoto}
                disabled={isCompressingImage || isEnhancing}
                className="absolute -bottom-2 -right-2 bg-primary text-white p-3 rounded-2xl shadow-lg active:scale-90 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Wand2 className="w-4 h-4" />
              </button>
            </div>

            <div className="flex flex-col w-full gap-2 px-4">
              <div className="relative">
                <input type="file" accept="image/*" onChange={handleFileChange} className="hidden" id="gallery-upload" />
                <label htmlFor="gallery-upload" className="flex items-center justify-center gap-2 w-full bg-secondary text-foreground font-bold py-3 rounded-2xl border border-border cursor-pointer active:scale-95 transition-all text-xs uppercase tracking-widest">
                  <ImagePlus className="w-4 h-4" /> Escolher da Galeria
                </label>
              </div>
              <div className="relative">
                <input type="file" accept="image/*" capture="environment" onChange={handleFileChange} className="hidden" id="camera-upload" />
                <label htmlFor="camera-upload" className="flex items-center justify-center gap-2 w-full bg-secondary text-foreground font-bold py-3 rounded-2xl border border-border cursor-pointer active:scale-95 transition-all text-xs uppercase tracking-widest">
                  <Camera className="w-4 h-4" /> Tirar Foto
                </label>
              </div>
            </div>

            <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-widest flex items-center gap-1">
              <Sparkles className="w-3 h-3 text-primary" /> Compressão Automática Ativa
            </p>
            <p className="text-[9px] text-muted-foreground/70 text-center leading-tight px-4">
              Fotos grandes são otimizadas automaticamente para upload rápido.
            </p>
            {uploadError && <p className="text-xs text-destructive font-medium text-center">{uploadError}</p>}
          </div>

          {/* Código de barras */}
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-muted-foreground uppercase px-1">Código de Barras</label>
            <div className="flex gap-2">
              <input
                type="text"
                inputMode="numeric"
                enterKeyHint="next"
                autoComplete="off"
                placeholder="Escaneie ou digite..."
                className="flex-1 bg-white border border-border rounded-2xl px-4 py-3 text-sm focus:outline-none"
                value={formData.barcode}
                onChange={e => setFormData({ ...formData, barcode: e.target.value })}
                data-testid="input-barcode"
              />
              <button
                type="button"
                onClick={() => setScanning(true)}
                className="bg-secondary text-foreground p-3 rounded-2xl border border-border"
                data-testid="button-scan-barcode"
              >
                <ScanLine className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Nome */}
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-muted-foreground uppercase px-1">Nome do Produto</label>
            <input
              required
              type="text"
              enterKeyHint="next"
              autoComplete="off"
              placeholder={nichoConfig.productNamePlaceholder}
              className="w-full bg-white border border-border rounded-2xl px-4 py-3 text-sm focus:outline-none"
              value={formData.name}
              onChange={e => setFormData({ ...formData, name: e.target.value })}
              data-testid="input-product-name"
            />
          </div>

          {/* === MARCA e CATEGORIA em grid === */}
          <div className="grid grid-cols-2 gap-4">

            {/* MARCA — Lógica Híbrida */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between px-1">
                <label className="text-[10px] font-bold text-muted-foreground uppercase">{nichoConfig.brandLabel}</label>
                {hasPredefinedBrands && (
                  <button
                    type="button"
                    onClick={() => {
                      const next = brandMode === 'predefined' ? 'custom' : 'predefined';
                      setBrandMode(next);
                      if (next === 'predefined') {
                        setFormData(prev => ({ ...prev, brand: nichoConfig.predefinedBrands![0] || "" }));
                      } else {
                        setFormData(prev => ({ ...prev, brand: "" }));
                      }
                    }}
                    className="text-[9px] font-black text-primary/70 uppercase tracking-wider active:opacity-60"
                    data-testid="button-toggle-brand-mode"
                  >
                    {brandMode === 'predefined' ? '+ Outra' : '← Lista'}
                  </button>
                )}
              </div>

              {hasPredefinedBrands && brandMode === 'predefined' ? (
                // Modo predefinido: select com lista de marcas do nicho
                <div className="relative">
                  <select
                    className="w-full bg-white border border-border rounded-2xl px-4 py-3 text-sm appearance-none focus:outline-none"
                    value={formData.brand}
                    onChange={e => setFormData({ ...formData, brand: e.target.value })}
                    data-testid="select-brand"
                  >
                    {brandSuggestions.map(b => (
                      <option key={b} value={b}>{b}</option>
                    ))}
                  </select>
                  <ChevronDown className="w-4 h-4 absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                </div>
              ) : (
                // Modo livre: input de texto (com datalist como sugestão opcional para Cosméticos)
                <div className="relative">
                  <input
                    type="text"
                    list="brand-suggestions"
                    enterKeyHint="next"
                    autoComplete="off"
                    className="w-full bg-white border border-border rounded-2xl px-4 py-3 text-sm focus:outline-none"
                    value={formData.brand}
                    onChange={e => setFormData({ ...formData, brand: e.target.value })}
                    onBlur={e => setFormData({ ...formData, brand: normalizeBrandInput(e.target.value) })}
                    placeholder={nichoConfig.brandPlaceholder}
                    data-testid="input-brand-custom"
                  />
                  <datalist id="brand-suggestions">
                    {brandSuggestions.map(b => (
                      <option key={b} value={b} />
                    ))}
                  </datalist>
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-muted-foreground uppercase px-1">Origem</label>
              <div className="relative">
                <select
                  className="w-full bg-white border border-border rounded-2xl px-4 py-3 text-sm appearance-none focus:outline-none"
                  value={formData.origin}
                  onChange={e => setFormData({ ...formData, origin: e.target.value })}
                  data-testid="select-origin"
                >
                  <option value="">Selecione a origem...</option>
                  {nichoConfig.originOptions.map(origin => (
                    <option key={origin} value={origin}>{origin}</option>
                  ))}
                </select>
                <ChevronDown className="w-4 h-4 absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              </div>
              <p className="text-[9px] text-muted-foreground px-1">Marca e origem ficam separadas para organizar melhor o catálogo.</p>
            </div>

            {/* CATEGORIA — dinâmica por nicho */}
{/* Público */}
<div className="space-y-1.5 mt-4">
  <label className="text-[10px] font-bold text-muted-foreground uppercase px-1">
    Público
  </label>

  <div className="flex gap-2">
    {["masculino", "feminino", "unisex"].map(g => (
      <button
        key={g}
        type="button"
        onClick={() => setFormData({ ...formData, gender: g })}
        className={`px-4 py-2 rounded-full text-xs font-bold ${
          formData.gender === g
            ? "bg-primary text-white"
            : "bg-white border text-muted-foreground"
        }`}
      >
        {g}
      </button>
    ))}
  </div>
</div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-muted-foreground uppercase px-1 flex justify-between">
                Categoria
                {saveConfirmation && <span className="text-primary animate-pulse italic">✓</span>}
              </label>
              <div className="relative">
                <select
                  className="w-full bg-white border border-border rounded-2xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all appearance-none"
                  value={formData.category}
                  onChange={e => {
                    setFormData({ ...formData, category: e.target.value });
                    setSaveConfirmation(true);
                    setTimeout(() => setSaveConfirmation(false), 2000);
                  }}
                  data-testid="input-category"
                >
                  <option value="">Selecione uma categoria...</option>
                  {categorySuggestions.map(cat => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
                <ChevronDown className="w-4 h-4 absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              </div>
            </div>
          </div>

          {/* Preços e Estoque */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-muted-foreground uppercase px-1">Preço Custo</label>
              <input required type="number" inputMode="decimal" enterKeyHint="next" step="0.01" min="0" className="w-full bg-white border border-border rounded-2xl px-4 py-3 text-sm" value={formData.costPrice} onChange={e => setFormData({ ...formData, costPrice: parseFloat(e.target.value) || 0 })} data-testid="input-cost-price" />
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-muted-foreground uppercase px-1">Preço Venda</label>
              <input required type="number" inputMode="decimal" enterKeyHint="next" step="0.01" min="0" className="w-full bg-white border border-border rounded-2xl px-4 py-3 text-sm" value={formData.salePrice} onChange={e => setFormData({ ...formData, salePrice: parseFloat(e.target.value) || 0 })} data-testid="input-sale-price" />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-muted-foreground uppercase px-1">Quantidade em Estoque</label>
            <input required type="number" inputMode="numeric" enterKeyHint="next" min="0" className="w-full bg-white border border-border rounded-2xl px-4 py-3 text-sm" value={formData.stock} onChange={e => setFormData({ ...formData, stock: parseInt(e.target.value) || 0 })} data-testid="input-stock" />
          </div>

          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-muted-foreground uppercase px-1">Descrição</label>
            <textarea className="w-full bg-white border border-border rounded-2xl px-4 py-3 text-sm h-32 focus:outline-none" placeholder={nichoConfig.descriptionPlaceholder} value={formData.description} onChange={e => setFormData({ ...formData, description: e.target.value })} enterKeyHint="done" data-testid="input-description" />
          </div>

          {/* === CAMPOS EXTRAS — isolados por nicho === */}
          <div className="p-4 bg-secondary/30 rounded-[2rem] space-y-4">
            <h3 className="text-[10px] font-black text-primary uppercase tracking-widest px-1">
              Informações {nichoConfig.label}
            </h3>
            {renderExtraFields()}
          </div>

          {/* Destaques do Catálogo */}
          <div className="p-4 bg-pink-50/60 border border-pink-200/40 rounded-[2rem] space-y-4">
            <h3 className="text-[10px] font-black text-primary uppercase tracking-widest px-1">✨ Destaques do Catálogo</h3>

            <div className="flex items-center justify-between gap-3 p-3 bg-white rounded-2xl border border-border/40">
              <label htmlFor="isFeatured" className="text-xs font-bold cursor-pointer flex-1">Produto Destaque</label>
              <input id="isFeatured" type="checkbox" checked={formData.isFeatured} onChange={e => setFormData({ ...formData, isFeatured: e.target.checked })} className="w-5 h-5 cursor-pointer rounded" data-testid="toggle-featured" />
            </div>

            <div className="flex items-center justify-between gap-3 p-3 bg-white rounded-2xl border border-border/40">
              <label htmlFor="isOnSale" className="text-xs font-bold cursor-pointer flex-1">Em Promoção</label>
              <input id="isOnSale" type="checkbox" checked={formData.isOnSale} onChange={e => setFormData({ ...formData, isOnSale: e.target.checked })} className="w-5 h-5 cursor-pointer rounded" data-testid="toggle-on-sale" />
            </div>

            {formData.isOnSale && (
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-muted-foreground uppercase px-1">% de Desconto</label>
                <input type="number" inputMode="numeric" enterKeyHint="done" min="0" max="100" className="w-full bg-white border border-border rounded-2xl px-4 py-3 text-sm" placeholder="Ex: 10, 20, 30..." value={formData.discountPercent} onChange={e => setFormData({ ...formData, discountPercent: parseInt(e.target.value) || 0 })} data-testid="input-discount-percent" />
              </div>
            )}
          </div>

          {formError && (
            <p className="text-xs text-destructive font-medium text-center px-2">{formError}</p>
          )}

          <button
            type="submit"
            className="rs-pressable min-h-12 w-full bg-primary text-white font-bold rounded-2xl py-4 mt-4 shadow-lg shadow-primary/20 active:scale-95 transition-all"
            data-testid="button-save-product"
          >
            {id ? 'Atualizar Produto' : 'Salvar no Estoque'}
          </button>
        </form>
      </div>

   <Suspense fallback={<div>Carregando scanner...</div>}>
  {scanning && (
    <BarcodeScanner
      onScan={handleBarcodeScan}
      onClose={() => setScanning(false)}
    />
  )}
</Suspense>
    </Layout>
  );
}
