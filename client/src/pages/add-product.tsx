import React, { useState, useEffect, useRef, useMemo, useCallback, lazy, Suspense } from "react";
import { Layout } from "@/components/layout";
import { Camera, CheckCircle2, ChevronDown, ScanLine, Sparkles, ChevronLeft, ImagePlus, AlertCircle } from "lucide-react";
import { useLocation, useParams } from "wouter";

const BarcodeScanner = lazy(
  () => import("@/components/barcode-scanner")
);
// RELEASE V1 §6/§7: mesmo padrão do BarcodeScanner acima — lazy, porque só Premium/admin em modo de
// edição chega a ver estas ferramentas (a maioria das visitas a esta tela nunca paga o bundle delas).
const PhotoroomCutoutTool = lazy(
  () => import("@/components/PhotoroomCutoutTool").then((mod) => ({ default: mod.PhotoroomCutoutTool }))
);
const ProductPhotoEnhancementTool = lazy(
  () => import("@/components/ProductPhotoEnhancementTool").then((mod) => ({ default: mod.ProductPhotoEnhancementTool }))
);
import { Product, defaultSettings } from "@/lib/mock-data";
import type { PlanType } from "@shared/monetization";
import { getFirebaseAuth, logTelemetryEvent } from "@/lib/firebase";
import { useAdminAccess } from "@/hooks/useAdminAccess";
import {
  getFirestore,
  doc,
  setDoc,
  getDoc,
  getCountFromServer,
  collection,
  increment
} from "firebase/firestore";
import { uploadImageViaServer, deleteImageViaServer, ServerUploadError } from "@/lib/server-upload";
import { useUserSettings } from "@/providers/UserSettingsProvider";
import { usePlanData } from "@/hooks/usePlanData";
import { notifyError, notifySuccess } from "@/lib/notify";
import { buildProductCreatePayload } from "@/lib/product-payload";
import { createProduct } from "@/lib/product-commands";
import { rememberRecentProductId } from "@/lib/recent-products";
import { checkProductLimit } from "@/lib/plan-helpers";
import {
  getNichoConfig,
  getProductCategoriesForNicho,
  inferNichoFromCategory,
  normalizeProductCategory,
  toBusinessTypesArray,
  type NichoId
} from "@/lib/nicho-config";
import { assessRawProductImage, loadOrientedImageElement } from "@/lib/product-image-metadata";
import { MARKETING_PRODUCT_IMAGE_QUALITY_POLICY_V0, type ProductImageQualityAssessment } from "@shared/product-image-quality";
import { PRODUCT_IMAGE_COORDINATE_SPACE_VERSION, type CanonicalDecodedImage } from "@shared/product-image-coordinate-space";

/**
 * Comprime uma imagem usando Canvas
 * @param file - Arquivo de imagem
 * @param maxWidth - Largura máxima (default 1200px)
 * @param maxHeight - Altura máxima (default 1200px)
 * @param quality - Qualidade JPEG (0-1, default 0.85)
 * @param targetSize - Tamanho alvo em bytes (default 2MB)
 * @returns Promise<CompressedProductImage | null> - Blob comprimido + dimensões finais, ou null se exceder limite
 */
// 🔥 CORRIGIDO COMPLETO

type CompressedProductImage = { blob: Blob; width: number; height: number };

async function compressImage(
  file: File,
  maxWidth = 1200,
  maxHeight = 1200,
  quality = 0.82,
  targetSize = 500 * 1024,
  outputType = "image/webp"
): Promise<CompressedProductImage | null> {
  // PRO-07F.2A: decode unificado com a extração de metadados (product-image-metadata.ts) — antes disto
  // havia uma segunda cópia própria do mesmo mecanismo de decode só aqui.
  const img = await loadOrientedImageElement(file);
  if (!img) return null;

  const scale = Math.min(maxWidth / img.width, maxHeight / img.height, 1);
  const width = Math.max(1, Math.round(img.width * scale));
  const height = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  canvas.width = width;
  canvas.height = height;
  ctx.drawImage(img, 0, 0, width, height);

  return new Promise((resolve) => {
    const tryEncode = (type: string, nextQuality: number, fallback?: () => void) => {
      canvas.toBlob(
        (blob) => {
          if (blob && blob.size <= targetSize) {
            resolve({ blob, width, height });
            return;
          }
          fallback?.();
        },
        type,
        nextQuality
      );
    };

    tryEncode(outputType, quality, () => {
      tryEncode("image/jpeg", Math.min(quality, 0.78), () => {
        tryEncode("image/jpeg", 0.62, () => resolve(null));
      });
    });
  });
}

const imageExtensionForType = (type: string) => type === "image/webp" ? "webp" : "jpg";

const optimizedImageName = (fileName: string, type: string, suffix = "") => {
  const base = fileName.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "produto";
  return `${base}${suffix}.${imageExtensionForType(type)}`;
};


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
    try { localStorage.setItem(brandSuggestionStorageKey(nicho), JSON.stringify(merged)); } catch { /* persistência local é só uma conveniência opcional; falha aqui não afeta o salvamento do produto */ }
  }
  return merged;
}

const FIREBASE_PROJECT_ID = import.meta.env.VITE_FIREBASE_PROJECT_ID || "unknown";

type ProductSaveStage = "auth_check" | "plan_limit_read" | "storage_upload" | "firestore_create" | "firestore_update" | "storage_cleanup" | "unknown";

function getErrorCode(error: unknown): string {
  return typeof error === "object" && error !== null && "code" in error ? String((error as { code?: unknown }).code || "") : "";
}

const productPayloadKeys = (payload?: Record<string, unknown>) => Object.keys(payload || {}).sort();

function getProductSaveErrorMessage(error: unknown, stage: ProductSaveStage): string {
  const code = getErrorCode(error);
  if (typeof navigator !== "undefined" && navigator.onLine === false) return "Sem conexão. Tente novamente.";
  if (code.includes("auth") || stage === "auth_check") return "Sua sessão expirou. Entre novamente para salvar o produto.";
  if (code === "PLAN_LIMIT_REACHED") return "Você atingiu o limite de produtos do seu plano.";
  if (stage === "plan_limit_read") return code === "permission-denied" ? "Não foi possível validar seu plano. Entre novamente." : "Limite de produtos atingido.";
  if (stage === "storage_upload" || code.startsWith("storage/")) return "Falha ao enviar imagem.";
  if (code === "permission-denied") return "Permissão negada ao salvar. Entre novamente e tente de novo.";
  if (code === "unavailable" || code === "deadline-exceeded") return "Serviço indisponível. Tente em instantes.";
  if (stage === "firestore_create" || stage === "firestore_update") return "Falha ao salvar no estoque.";
  return "Não foi possível salvar o produto.";
}

function logProductSaveDiagnostic(event: string, context: Record<string, unknown>) {
  console.warn(event, { module: "add-product", ...context });
  logTelemetryEvent(event as any, context as any).catch(() => {});
}

type UploadedProductAsset = { kind: "product" | "product-thumbnail"; storagePath: string };

/** RELEASE-18: storage.rules nega delete direto do client nestes paths — rollback de upload (Firestore
 * write seguinte falhou) precisa passar pelo endpoint server-side, igual ao upload em si.
 * PRODUCT-THUMBNAIL-01: cada entrada carrega seu próprio `kind` (imagem principal ou miniatura) — os dois
 * paths vivem em namespaces diferentes (`products/` vs `product-thumbnails/`), então o delete precisa
 * saber qual dos dois para resolver o path corretamente no servidor (ver `storagePathFor` em
 * server/uploads.ts). */
async function cleanupUploadedProductImages(productId: string, token: string, assets: UploadedProductAsset[]) {
  if (!assets.length) return;
  await Promise.allSettled(
    assets.map(({ kind, storagePath }) => deleteImageViaServer({ kind, targetId: productId, storagePath, token })),
  );
}

/** PRODUCT-THUMBNAIL-01 — dimensões deliberadamente bem menores que a imagem principal (1200×1200): um
 * card/lista de produto nunca renderiza a miniatura maior que ~160-200px de lado mesmo em telas de alto
 * DPR (2-3x), então 320px de lado já cobre isso com folga sem desperdiçar banda/Storage. targetSize baixo
 * (60KB) porque compressImage já teria um fallback de qualidade decrescente se não coubesse — na prática
 * uma imagem 320×320 em webp/jpeg de qualidade 0.75 fica muito abaixo disso. */
const THUMBNAIL_MAX_DIMENSION = 320;
const THUMBNAIL_QUALITY = 0.75;
const THUMBNAIL_TARGET_BYTES = 60 * 1024;

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
  thumbnailUrl: string;
  thumbnailStoragePath: string;
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
  // RELEASE V1 §4.3/§6/§7: mesma checagem de admin/dev reaproveitada em 3 lugares nesta tela — scanner
  // de câmera (ainda experimental, §4.3), e como parte do gate Premium-ou-admin do recorte PhotoRoom
  // (§6) e da melhoria real de foto (§7). O campo de texto do código de barras continua disponível para
  // todo mundo (digitar manualmente sempre funcionou e não é o recurso incompleto).
  const { isAdmin: isAdminUser } = useAdminAccess();
  const [isCompressingImage, setIsCompressingImage] = useState(false);
  /**
   * PRO-07E.1: avaliação objetiva do arquivo ORIGINAL (antes da compressão). Nome deliberadamente
   * prefixado "source" — uma futura avaliação do derivado comprimido precisará de um campo PRÓPRIO,
   * com outro prefixo, nunca sobrescrevendo este. Só armazenado nesta sprint — ainda não usado para
   * bloquear upload nem para mudar a UX (ver PRO-07E.2) — por isso o valor ainda não é lido em nenhum
   * lugar deste componente nesta sprint.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- lido a partir do PRO-07E.2, ver comentário acima
  const [sourceImageQualityAssessment, setSourceImageQualityAssessment] = useState<ProductImageQualityAssessment | null>(null);
  /**
   * PRO-07F.2A: metadata canônica do DERIVADO comprimido — width/height já orientados por EXIF (mesmo
   * decode do original), sem redecodificar o Blob resultante: os dois já são conhecidos no momento em
   * que o canvas gera o Blob. Ainda não consumida nesta sprint (a Marketing resolve sua própria versão
   * a partir da URL do Storage), mas já expressa no mesmo tipo canônico usado lá em vez de um shape solto.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- consumido em sprint futura, ver comentário acima
  const [derivedProductImageCanonical, setDerivedProductImageCanonical] = useState<CanonicalDecodedImage | null>(null);
  const [formError, setFormError] = useState<string>("");
  const [showLimitModal, setShowLimitModal] = useState(false);

  const { settings: firestoreSettings } = useUserSettings();
  const settings = firestoreSettings || defaultSettings;
  const { activePlan } = usePlanData();

  // Derive effective business types array (supports both singular and array)
  const businessTypes = toBusinessTypesArray(settings?.businessType, settings?.businessTypes);
  const hasMultipleNichos = businessTypes.length > 1;

  const [saveConfirmation, setSaveConfirmation] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [uploadError, setUploadError] = useState<string>("");
  const selectedFileRef = useRef<File | null>(null);

  // Active product nicho: if user has multiple types, user selects manually
  const [activeNicho, setActiveNicho] = useState<NichoId>(
    businessTypes[0] as NichoId || 'Geral'
  );
  const nichoConfig = getNichoConfig(activeNicho);
  // Quando true, a próxima mudança de activeNicho veio do carregamento do produto salvo
  // (edição) e NÃO deve resetar marca/origem/extras — só a troca manual do seletor de nicho deve fazer isso.
  const skipNichoResetRef = useRef(false);
  // RELEASE-QUALITY-05 §8: estoque no momento em que o formulário de EDIÇÃO carregou — usado só para
  // calcular o delta que o vendedor realmente pretendeu aplicar (ver handleSave), nunca a autoridade
  // final. Sem isto, salvar a edição sobrescreveria com um valor absoluto qualquer decremento de venda
  // que tenha acontecido (em qualquer dispositivo) entre abrir o formulário e salvar.
  const originalStockAtLoadRef = useRef<number | null>(null);

  // Categories: ALWAYS from the active nicho only (never mix nichos).
  // If onboarding configured categories for this nicho, use that personalized list.
  const baseCategorySuggestions = useMemo(
    () => getProductCategoriesForNicho(settings, activeNicho),
    [activeNicho, settings]
  );

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
  thumbnailUrl: "",
  thumbnailStoragePath: "",
  extras: {}, // ✅ CORRETO
  isFeatured: false,
  isOnSale: false,
  discountPercent: 0,
  productType: activeNicho as string,
  gender: "unisex"
});

  const categorySuggestions = useMemo<string[]>(() => {
    if (formData.category && !baseCategorySuggestions.includes(formData.category)) {
      return [...baseCategorySuggestions, formData.category];
    }
    return baseCategorySuggestions;
  }, [baseCategorySuggestions, formData.category]);
  // Categoria/marca salva que não existe mais na lista padrão do nicho: preserva o valor (nunca some
  // silenciosamente) e sinaliza para o vendedor revisar conscientemente, em vez de trocar sozinho.
  const isLegacyCategory = Boolean(formData.category) && !baseCategorySuggestions.includes(formData.category);
  const isLegacyBrand = Boolean(formData.brand) && hasPredefinedBrands && !(nichoConfig.predefinedBrands || []).includes(formData.brand);
  const brandSuggestions = useMemo(() => {
    const seen = new Set<string>();
    const merged: string[] = [];
    // Marca salva vem primeiro para nunca ficar invisível no select quando não bate com a lista do nicho
    // (ex: produto legado, marca digitada livremente antes, ou nicho inferido incorretamente).
    for (const brand of [formData.brand, ...(nichoConfig.predefinedBrands || []), ...localBrandSuggestions]) {
      if (!brand) continue;
      const key = brand.toLocaleLowerCase("pt-BR");
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(brand);
      }
    }
    return merged;
  }, [formData.brand, localBrandSuggestions, nichoConfig.predefinedBrands]);


 useEffect(() => {
  return () => {
    if (formData.imageUrl) {
      URL.revokeObjectURL(formData.imageUrl);
    }
  };
}, [formData.imageUrl]);
  // When active nicho changes (user switches type selector), update category, brand, and CLEAN extras.
  // Não roda essa lógica quando a mudança veio do carregamento do produto para edição
  // (nesse caso o próprio efeito de carregar já trouxe os valores reais e corretos).
  useEffect(() => {
    if (skipNichoResetRef.current) {
      skipNichoResetRef.current = false;
      return;
    }
    const newConfig = getNichoConfig(activeNicho);
    const newHasPredefined = !!newConfig.predefinedBrands;
    setLocalBrandSuggestions(loadLocalBrandSuggestions(activeNicho));
    setFormData(prev => {
      const newCategory = prev.category;
      // If current category doesn't belong to new nicho, reset to first category of new nicho
      const nextCategories = getProductCategoriesForNicho(settings, activeNicho);
      const categoryExists = nextCategories.includes(newCategory);
      const validCategory = categoryExists ? newCategory : (nextCategories[0] || "");

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
  }, [activeNicho, settings]);

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
              setActiveNicho((current) => {
                if (current !== inferredNicho) skipNichoResetRef.current = true;
                return inferredNicho;
              });

              const savedNichoConfig = getNichoConfig(inferredNicho);
              const savedHasPredefined = !!savedNichoConfig.predefinedBrands;
              const isCustomBrand = savedHasPredefined &&
                !!product.brand &&
                !savedNichoConfig.predefinedBrands!.includes(product.brand);

              setBrandMode(isCustomBrand ? 'custom' : (savedHasPredefined ? 'predefined' : 'custom'));
              originalStockAtLoadRef.current = Number.isFinite(Number(product.stock)) ? Number(product.stock) : 0;
              setFormData({
                name: product.name,
                brand: product.brand || "",
                origin: product.origin || product.extras?.origin || "",
                category: normalizeProductCategory(product.category || ""),
                costPrice: product.costPrice,
                salePrice: product.salePrice,
                stock: product.stock,
             barcode: "",
                description: product.description || "",
                imageUrl: product.imageUrl || "",
                storagePath: product.storagePath || "",
                thumbnailUrl: product.thumbnailUrl || "",
                thumbnailStoragePath: product.thumbnailStoragePath || "",
                extras: product.extras || {},
                isFeatured: product.isFeatured || false,
                isOnSale: product.isOnSale || false,
                discountPercent: product.discountPercent || 0,
                productType: product.productType || inferredNicho,
                gender: product.gender || "unisex",
              });
            }
          })
          .catch(() => logTelemetryEvent("add_product_load_failed" as any, { stage: "load" }).catch(() => {}));
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
    if (isSaving) return;

    let saveStage: ProductSaveStage = "unknown";
    const uploadedAssets: UploadedProductAsset[] = [];
    let attemptedPayload: Record<string, unknown> | undefined;
    let productPathUid = "";
    setIsSaving(true);

    try {
      setUploadError("");
      setFormError("");
      const auth = getFirebaseAuth();
      const currentUser = auth?.currentUser;
      const uid = currentUser?.uid;
      saveStage = "auth_check";
      if (!uid || !currentUser) {
        const message = "Sua sessão expirou. Entre novamente para salvar o produto.";
        setFormError(message);
        notifyError(message);
        return;
      }
      await currentUser.getIdToken(false);
      productPathUid = uid;

      const firestore = getFirestore();
      const productRef = id ? doc(firestore, "users", uid, "products", id) : doc(collection(firestore, "users", uid, "products"));
      const productId = id || productRef.id;

      const normalizedBrand = normalizeBrandInput(formData.brand);
      const productName = formData.name.trim();
      const category = formData.category.trim();
      const costPrice = Number(formData.costPrice);
      const salePrice = Number(formData.salePrice);
      const stock = Number(formData.stock);

      if (!productName) { setFormError("Nome do produto é obrigatório."); return; }
      if (!Number.isFinite(costPrice) || costPrice < 0) { setFormError("Preço de custo inválido."); return; }
      if (!Number.isFinite(salePrice) || salePrice <= 0) { setFormError("Preço de venda deve ser maior que 0."); return; }
      if (!Number.isFinite(stock) || stock < 0) { setFormError("Estoque inválido."); return; }
      if (!category) { setFormError("Categoria é obrigatória."); return; }

      if (!id) {
        saveStage = "plan_limit_read";
        const productCountSnapshot = await getCountFromServer(collection(firestore, "users", uid, "products"));
        // PLAN-IMPL-01 §8 — P0 fix: this used to pass a hardcoded `true` as checkProductLimit's
        // openAccess argument, which made the Free 30-product limit unenforceable for anyone
        // (plan-helpers.ts short-circuits to allowed:true whenever openAccess is true). There is no
        // live "genuine reason" for a bypass here: a real premium/tester/premium_plus user is already
        // covered by checkProductLimit's own internal `plan === "premium"` check (activePlan already
        // reflects those grants via the server-composed hasPremiumAccess), and the one override that
        // WOULD be legitimate — the admin "global premium open access" promo (GlobalConfig) — is not
        // actually wired into usePlanData() (it hardcodes globalConfig: null), so there is nothing
        // real to pass here today. Preserving activePlan (including "pro") instead of collapsing
        // anything non-premium to "free" so Pro users get the 500-product limit, not Free's 30.
        const safePlan: PlanType = activePlan === "premium" || activePlan === "pro" ? activePlan : "free";
        const { allowed } = checkProductLimit(safePlan, productCountSnapshot.data().count);
        if (!allowed) {
          setShowLimitModal(true);
          setFormError("Limite de produtos atingido.");
          return;
        }
      }

      let imageUrl = formData.imageUrl || "";
      let storagePath = formData.storagePath || "";
      let thumbnailUrl = formData.thumbnailUrl || "";
      let thumbnailStoragePath = formData.thumbnailStoragePath || "";
      const file = selectedFileRef.current;

      if (file) {
        saveStage = "storage_upload";
        try {
          // RELEASE-06: sobe pelo endpoint server-side (magic bytes + dimensões reais + quota
          // validadas no servidor) em vez de uploadBytes() direto ao Storage — mesma foto já
          // comprimida pelo canvas acima, só muda ONDE ela é gravada.
          const token = await auth?.currentUser?.getIdToken();
          if (!token) throw new Error("Not authenticated");
          const result = await uploadImageViaServer({ kind: "product", targetId: productId, blob: file, token });
          storagePath = result.storagePath;
          uploadedAssets.push({ kind: "product", storagePath });
          imageUrl = result.downloadUrl;

          // PRODUCT-THUMBNAIL-01: miniatura é otimização, nunca requisito para salvar o produto — uma
          // falha aqui só decai para thumbnailUrl/thumbnailStoragePath ausentes (§10), nunca bloqueia o
          // fluxo principal nem mostra erro fatal ao vendedor. Nova imagem sempre gera nova miniatura
          // (nunca herda a miniatura antiga junto de uma imagem principal nova, §13).
          const previousThumbnailStoragePath = thumbnailStoragePath;
          try {
            // Nunca o File original: `file` aqui já É o derivado principal (compressão já aplicada em
            // handleFileChange, muito antes deste ponto) — nome explícito para nunca ser confundido com
            // uma segunda compressão do original (ver prova estrutural em script/smoke-tests.ts sobre a
            // ordem entre a avaliação do File cru e a primeira chamada de compressão sobre ele).
            const compressedMainFile = file;
            const thumbCompressed = await compressImage(compressedMainFile, THUMBNAIL_MAX_DIMENSION, THUMBNAIL_MAX_DIMENSION, THUMBNAIL_QUALITY, THUMBNAIL_TARGET_BYTES, "image/webp");
            if (thumbCompressed) {
              const thumbResult = await uploadImageViaServer({ kind: "product-thumbnail", targetId: productId, blob: thumbCompressed.blob, token });
              thumbnailStoragePath = thumbResult.storagePath;
              uploadedAssets.push({ kind: "product-thumbnail", storagePath: thumbnailStoragePath });
              thumbnailUrl = thumbResult.downloadUrl;
              // §14 — troca de formato (thumb-v1.jpg <-> thumb-v1.webp): o novo save já sobrescreveu o
              // path canônico atual; a variante da extensão ANTIGA (se existir e for diferente) fica
              // órfã e precisa ser removida — best-effort, nunca bloqueia o salvamento.
              if (previousThumbnailStoragePath && previousThumbnailStoragePath !== thumbnailStoragePath) {
                deleteImageViaServer({ kind: "product-thumbnail", targetId: productId, storagePath: previousThumbnailStoragePath, token }).catch(() => {});
              }
            } else {
              thumbnailUrl = "";
              thumbnailStoragePath = "";
            }
          } catch (thumbErr) {
            const thumbErrorCode = thumbErr instanceof ServerUploadError ? (thumbErr.reason || thumbErr.code) : getErrorCode(thumbErr);
            logTelemetryEvent("add_product_thumbnail_upload_failed" as any, { stage: "thumbnail_upload", errorCode: thumbErrorCode, productType: activeNicho }).catch(() => {});
            thumbnailUrl = "";
            thumbnailStoragePath = "";
          }
        } catch (uploadErr) {
          const errorCode = uploadErr instanceof ServerUploadError ? (uploadErr.reason || uploadErr.code) : getErrorCode(uploadErr);
          logTelemetryEvent("add_product_image_upload_failed" as any, { stage: "upload", errorCode, hasImage: true, productType: activeNicho }).catch(() => {});
          setUploadError(getProductSaveErrorMessage(uploadErr, "storage_upload"));
          imageUrl = "";
          storagePath = "";
          thumbnailUrl = "";
          thumbnailStoragePath = "";
        }
      }

      if (normalizedBrand && brandMode === "custom") {
        setLocalBrandSuggestions((current) => saveLocalBrandSuggestion(activeNicho, normalizedBrand, current));
      }

      const productData = buildProductCreatePayload({
        formData, productName, normalizedBrand, category, costPrice, salePrice, stock, imageUrl, storagePath, activeNicho,
        ...(thumbnailUrl && thumbnailStoragePath ? { thumbnailUrl, thumbnailStoragePath } : {}),
      });
      attemptedPayload = { ...productData, id: id || productId };
      // RELEASE-QUALITY-05 §8: em EDIÇÃO, nunca grava o estoque como valor absoluto — uma venda (em
      // qualquer dispositivo) pode ter decrementado o estoque real entre o formulário carregar e o
      // vendedor salvar. `increment()` aplica só a DIFERENÇA que o vendedor efetivamente digitou, de
      // forma atômica no servidor do Firestore — não sobrescreve nem é sobrescrita por um decremento de
      // venda concorrente. Criação de produto novo continua com valor absoluto (nada concorrente a
      // proteger: o documento ainda não existe).
      if (id && originalStockAtLoadRef.current !== null) {
        attemptedPayload.stock = increment(stock - originalStockAtLoadRef.current);
      }

      saveStage = id ? "firestore_update" : "firestore_create";
      try {
        if (id) {
          await setDoc(productRef, attemptedPayload, { merge: true });
        } else {
          await createProduct({
            productId,
            product: attemptedPayload,
            idempotencyKey: `product-create-${productId}`,
          });
        }
      } catch (writeErr) {
        if (uploadedAssets.length) {
          saveStage = "storage_cleanup";
          const cleanupToken = await currentUser.getIdToken().catch(() => "");
          if (cleanupToken) await cleanupUploadedProductImages(productId, cleanupToken, uploadedAssets);
          saveStage = id ? "firestore_update" : "firestore_create";
        }
        throw writeErr;
      }

      if (!id) rememberRecentProductId(productId);
      setSuccess(true);
      notifySuccess(id ? "Produto atualizado." : "Produto salvo.");

      setTimeout(() => setLocation("/products"), 1500);
    } catch (err) {
      const message = getProductSaveErrorMessage(err, saveStage);
      const payloadKeys = productPayloadKeys(attemptedPayload);
      setFormError(message);
      notifyError(message);
      logProductSaveDiagnostic("add_product_submit_failed", {
        stage: saveStage,
        errorCode: getErrorCode(err),
        authenticated: Boolean(getFirebaseAuth()?.currentUser),
        uidMatchesPath: Boolean(getFirebaseAuth()?.currentUser?.uid && productPathUid && getFirebaseAuth()?.currentUser?.uid === productPathUid),
        payloadKeyCount: payloadKeys.length,
        payloadKeys,
        firebaseProjectId: FIREBASE_PROJECT_ID,
        hasImage: Boolean(selectedFileRef.current),
        productType: activeNicho,
        isEdit: Boolean(id),
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleBarcodeScan = useCallback((code: string) => {
    setFormData(prev => ({ ...prev, barcode: code }));
  }, []);

  const openScanner = useCallback(() => { if (isAdminUser) setScanning(true); }, [isAdminUser]);
  const closeScanner = useCallback(() => setScanning(false), []);

const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
  const file = e.target.files?.[0];
  if (!file) return;

  setIsCompressingImage(true);
  setFormError("");
  setSourceImageQualityAssessment(null);
  setDerivedProductImageCanonical(null);

  // PRO-07E.1: avalia o arquivo ORIGINAL antes de qualquer compressão — depois de `compressImage` essa
  // informação já não existe mais em lugar nenhum (o original nunca é persistido). Só calcula e guarda
  // localmente; não bloqueia nem muda o fluxo existente abaixo, mesmo em caso de erro na avaliação.
  try {
    const assessment = await assessRawProductImage(file, MARKETING_PRODUCT_IMAGE_QUALITY_POLICY_V0);
    setSourceImageQualityAssessment(assessment);
  } catch (assessmentError) {
    logTelemetryEvent("add_product_image_quality_assessment_failed" as any, { stage: "assessment" }).catch(() => {});
    void assessmentError;
  }

  try {
    const compressed = await compressImage(file, 1200, 1200, 0.82, 500 * 1024, "image/webp");

    if (!compressed) {
      setFormError("Erro ao processar a imagem.");
      notifyError("Erro ao processar a imagem.");
      return;
    }

    const compressedFile = new File([compressed.blob], optimizedImageName(file.name, compressed.blob.type), {
      type: compressed.blob.type || "image/jpeg",
      lastModified: Date.now(),
    });

    setDerivedProductImageCanonical({
      width: compressed.width,
      height: compressed.height,
      orientationNormalized: true,
      decodeMethod: "html-image-element",
      coordinateSpaceVersion: PRODUCT_IMAGE_COORDINATE_SPACE_VERSION,
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

  } catch {
    logTelemetryEvent("add_product_image_compression_failed" as any, { stage: "compression" }).catch(() => {});
    setFormError("Erro ao otimizar a imagem.");
  } finally {
    setIsCompressingImage(false);
  }
};
  // RELEASE V1 §7: o antigo `enhancePhoto()` era um `setTimeout` de 2s que não processava a imagem —
  // substituído por `ProductPhotoEnhancementTool` (chamada real ao servidor, ver render abaixo).

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
      <div className="px-4 sm:px-6 pt-6 sm:pt-8 pb-[max(8rem,calc(env(safe-area-inset-bottom)+7rem))] max-w-4xl mx-auto scroll-pt-24">
        <button onClick={() => setLocation("/products")} className="flex min-h-11 items-center gap-2 text-muted-foreground mb-5 font-medium">
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
          <div className="flex flex-col items-center gap-4 mb-1 rounded-[2rem] bg-white/70 border border-border/40 px-3 py-4 shadow-sm">
            <div className="relative group cursor-pointer">
              <div className="w-40 h-40 bg-secondary rounded-[2.5rem] border-2 border-dashed border-border/60 flex flex-col items-center justify-center text-muted-foreground transition-all overflow-hidden relative">
                {formData.imageUrl && !isCompressingImage ? (
                   <img src={formData.imageUrl} alt="Prévia do produto" className="w-full h-full object-cover" loading="lazy" decoding="async" width={160} height={160} />
                ) : isCompressingImage ? (
                  <div className="absolute inset-0 bg-primary/20 flex flex-col items-center justify-center text-primary">
                    <Sparkles className="w-8 h-8 animate-spin" />
                    <span className="text-[10px] font-bold mt-1 uppercase">Otimizando...</span>
                  </div>
                ) : (
                  <>
                    <Camera className="w-8 h-8 mb-2" />
                    <span className="text-[10px] font-bold uppercase tracking-wider">Adicionar Foto</span>
                  </>
                )}
              </div>
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

          {/* RELEASE V1 §6/§7: PhotoRoom e melhoria de foto exigem um produto JÁ SALVO (a imagem
              original precisa existir no Storage com um productId real) — por isso só aparecem em modo
              de edição, nunca durante o cadastro inicial (a foto ainda é só um blob local até salvar).
              Premium/admin apenas — Free nunca monta estes componentes (zero chamadas ao provider). */}
          {id && formData.imageUrl && (activePlan === "premium" || isAdminUser) && (
            <Suspense fallback={<div className="rounded-2xl border border-border/40 bg-white/70 p-3.5 text-xs font-semibold text-muted-foreground">Carregando ferramentas Premium...</div>}>
              <div className="space-y-3">
                <PhotoroomCutoutTool productId={id} originalImageUrl={formData.imageUrl} />
                <ProductPhotoEnhancementTool productId={id} originalImageUrl={formData.imageUrl} />
              </div>
            </Suspense>
          )}

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
              {isAdminUser && (
                <button
                  type="button"
                  onClick={openScanner}
                  className="bg-secondary text-foreground p-3 rounded-2xl border border-border"
                  data-testid="button-scan-barcode"
                >
                  <ScanLine className="w-5 h-5" />
                </button>
              )}
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
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">

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
                      <option key={b} value={b}>{b}{isLegacyBrand && b === formData.brand ? " (valor existente — revisar)" : ""}</option>
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

            {/* Público */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-muted-foreground uppercase px-1">Público</label>
              <div className="grid grid-cols-3 gap-2">
                {["masculino", "feminino", "unisex"].map(g => (
                  <button
                    key={g}
                    type="button"
                    onClick={() => setFormData({ ...formData, gender: g })}
                    className={`min-h-11 px-2 rounded-2xl text-[11px] font-bold capitalize transition-all ${
                      formData.gender === g
                        ? "bg-primary text-white shadow-sm shadow-primary/20"
                        : "bg-white border border-border text-muted-foreground"
                    }`}
                  >
                    {g}
                  </button>
                ))}
              </div>
            </div>

            {/* CATEGORIA — dinâmica por nicho */}
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
                    <option key={cat} value={cat}>{cat}{isLegacyCategory && cat === formData.category ? " (valor existente — revisar)" : ""}</option>
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
            {isSaving ? 'Salvando...' : (id ? 'Atualizar Produto' : 'Salvar no Estoque')}
          </button>
        </form>
      </div>

   <Suspense fallback={<div>Carregando scanner...</div>}>
  {scanning && isAdminUser && (
    <BarcodeScanner
      onScan={handleBarcodeScan}
      onClose={closeScanner}
    />
  )}
</Suspense>
    </Layout>
  );
}
