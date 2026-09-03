import { useState, useMemo, useEffect, useRef, lazy, Suspense } from "react";
import { useAdminAccess } from "@/hooks/useAdminAccess";

const AdminGrantsPanel = lazy(() => import("@/components/admin/AdminGrantsPanel").then((m) => ({ default: m.AdminGrantsPanel })));
import { Layout } from "@/components/layout";
import { ConfirmActionDialog } from "@/components/ConfirmActionDialog";
import { AccountHero } from "@/components/account/AccountHero";
import { AccountMenuItem } from "@/components/account/AccountMenuItem";
import { clearScopedAccountLocalData } from "@/lib/account-deletion-local";
import { notifyError, notifySuccess, notifyWarning } from "@/lib/notify";
import { PageSkeleton } from "@/components/PageSkeleton";
import {
  AppSettings,
  logout, getCurrentUserId, getStored, STORAGE_KEYS
} from "@/lib/mock-data";
import { clearTelemetryUserId, clearUserContext, getFirebaseIdToken, getFirebaseAuth, measureOperation, logTelemetryEvent, clearFirestoreOfflineCache } from "@/lib/firebase";
import { onAuthStateChanged, signOut, type User as FirebaseAuthUser } from "firebase/auth";
import { useLocation } from "wouter";
import { getApiUrl } from "@/lib/api-config";
import { buildPublicAppUrl } from "@/lib/public-url";
import { APP_BUILD_ID, APP_VERSION, formatAppBuildId } from "@/lib/build-info";
import { toCsvRow } from "@/lib/export-security";
import { QRCodeSVG } from "qrcode.react";
import { uploadImageViaServer } from "@/lib/server-upload";
import { useUserSettings } from "@/providers/UserSettingsProvider";
import { usePlan } from "@/providers/PlanProvider";
import { REFERRAL_REWARD_LIMIT } from "@shared/monetization";

// RC-04 P1-04 — só para texto de UI; o servidor (server/routes.ts /api/referral/validate-referral)
// é quem de fato concede os 30 dias (hardcoded lá, sem constante compartilhada até esta rodada).
// Manter os dois números em sincronia se o período de recompensa mudar no futuro.
const REFERRAL_REWARD_DAYS = 30;
import { patchUserSettingsOptimistic } from "@/hooks/useUserSettings";
import { useMPConnections } from "@/hooks/useMPConnections";
import { queryClient } from "@/lib/queryClient";
import { NICHO_CONFIG, ONBOARDING_NICHO_IDS, type NichoId } from "@/lib/nicho-config";
import { APP_THEMES, BUTTON_TONES, CARD_TONES, MOTION_LEVELS, RADIUS_LEVELS, SHADOW_LEVELS, buildAppThemeCustomization, resolveAppThemeId, type AppThemeCustomization } from "@/lib/app-themes";
import { ORDERS_FEATURE_LABEL, ORDERS_FEATURE_LABEL_MAX_LENGTH, resolveOrdersFeatureLabel } from "@/lib/orders";
import { useTheme } from "next-themes";
import { APPEARANCE_THEME_STORAGE_KEY } from "@/components/ThemeProvider";
import {
  Store, CreditCard, ClipboardList, Loader2, CalendarClock,
  Download, Save, ChevronRight, Bell, Upload, RefreshCw, Users, Share2, ExternalLink, FileSpreadsheet, QrCode, Copy, Mail, Scale, HelpCircle, ChevronDown, User, KeyRound, LogOut, ArrowLeft, Receipt, Trash2, Monitor, Sun, Moon, Gift, ShieldCheck, Ticket, Gauge, Sparkles,
  type LucideIcon
} from "lucide-react";

type AccountMenuEntry = {
  title: string;
  subtitle: string;
  icon: LucideIcon;
  color: string;
  path: string;
  disabled?: boolean;
  badge?: string;
};

// MOVED OUTSIDE: InputField must be defined OUTSIDE Settings component
// to prevent recreation on every render (which was causing focus loss)
const InputField = ({ label, value, onChange, placeholder = "", type = "text", disabled = false, maxLength, hint }: any) => (
  <div className="space-y-1.5">
    <label className="text-xs font-semibold text-muted-foreground px-1">{label}</label>
    <input
      type={type}
      disabled={disabled}
      maxLength={maxLength}
      className={`w-full bg-secondary/50 border-none rounded-2xl p-4 text-sm focus:ring-2 focus:ring-primary/20 outline-none transition-all ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
      value={value || ""}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
    />
    {hint && <p className="px-1 text-[11px] leading-relaxed text-muted-foreground">{hint}</p>}
  </div>
);

// Botão outlined "Salvar Alterações" reutilizado em Minha Conta, Minha Loja e no floating save.
const SaveChangesButton = ({ onClick, disabled, isSaving, testId, floating = false }: {
  onClick: () => void; disabled: boolean; isSaving: boolean; testId: string; floating?: boolean;
}) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    data-testid={testId}
    className={`w-full flex items-center justify-center gap-2 rounded-[2rem] border-2 border-primary bg-white py-4 text-xs font-black uppercase tracking-widest text-primary disabled:opacity-40 ${floating ? "shadow-xl" : ""}`}
  >
    {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Salvar Alterações
  </button>
);

const normalizeCatalogSlug = (value: string) => value.trim().toLowerCase().normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

const VALID_SETTINGS_TABS = new Set([
  "menu", "account", "store", "pix", "catalog", "preferences",
  "growth", "backup", "export_csv", "support", "about_and_legal",
]);
const normalizeSettingsTab = (value: string | null) =>
  value && VALID_SETTINGS_TABS.has(value) ? value : "menu";


async function compressLogo(file: File, maxSize = 512, quality = 0.82): Promise<Blob | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      const image = new Image();
      image.onload = () => {
        const scale = Math.min(1, maxSize / Math.max(image.width, image.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        const context = canvas.getContext("2d");
        if (!context) return resolve(null);
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(resolve, "image/jpeg", quality);
      };
      image.onerror = () => resolve(null);
      image.src = String(reader.result || "");
    };
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}
export default function Settings() {
  // Get settings from Firestore via hook
  const { settings: firestoreSettings, loading: settingsLoading } = useUserSettings();
  const { planData, activePlan, referralCount, referralCode } = usePlan();
  // OWNER-ACCESS-02 §9 — a seção "Administração" só existe no menu/rotas quando o servidor confirma
  // admin (GET /api/admin/status, via useAdminAccess). Esconder no client é só UX; a autoridade real
  // continua sendo `requireAdmin` em cada rota de server/admin-grants.ts.
  const { isAdmin } = useAdminAccess();
  // RELEASE-28: o link público de indicação usa o CÓDIGO, nunca o UID bruto do Firebase — o código não
  // é reversível sem a resolução server-owned (GET /api/referral/resolve-code), então compartilhar
  // este link não expõe o UID em URL/histórico/referrer headers como o link antigo (?referral=<uid>)
  // expunha. `referralCode` já vem pronto de usePlan(); nada é gerado aqui.
  const referralShareLink = referralCode ? `https://revendasmart.vercel.app?referral=${referralCode}` : null;

  // Local state for form edits (synced with Firestore on save)
  // Initialize with default empty object to avoid undefined
  const [formSettings, setFormSettings] = useState<AppSettings>(() => firestoreSettings || {});

  // Track if we've already initialized formSettings from Firestore
  // This ensures we only sync ONCE on mount, not on every Firestore update
  const hasInitialized = useRef(false);

  const selectedThemeId = resolveAppThemeId(formSettings?.appTheme);
  const selectedTheme = useMemo(() => APP_THEMES.find((theme) => theme.id === selectedThemeId) || APP_THEMES[0], [selectedThemeId]);
  const themeCustomization = useMemo(
    () => buildAppThemeCustomization(selectedThemeId, formSettings?.appThemeCustomization as AppThemeCustomization | undefined),
    [formSettings?.appThemeCustomization, selectedThemeId]
  );
  const selectedPrimaryNicho = (formSettings?.businessType && NICHO_CONFIG[formSettings.businessType as NichoId]) ? formSettings.businessType : "Geral";
  const selectedBusinessTypes = useMemo(() => {
    const rawTypes = Array.isArray(formSettings?.businessTypes) ? formSettings.businessTypes : [];
    const validTypes = rawTypes.filter((item): item is NichoId => item in NICHO_CONFIG);
    const withPrimary = selectedPrimaryNicho in NICHO_CONFIG ? [selectedPrimaryNicho as NichoId, ...validTypes] : validTypes;
    const unique = Array.from(new Set(withPrimary));
    return unique.length > 0 ? unique : ["Geral" as NichoId];
  }, [formSettings?.businessTypes, selectedPrimaryNicho]);

  const updateThemeCustomization = (patch: Partial<AppThemeCustomization>) => {
    setFormSettings((prev) => {
      const baseThemeId = resolveAppThemeId(prev?.appTheme);
      const nextCustomization = buildAppThemeCustomization(baseThemeId, { ...(prev?.appThemeCustomization as AppThemeCustomization | undefined), ...patch });
      return { ...prev, appThemeCustomization: nextCustomization, primaryColor: nextCustomization.primaryColor };
    });
  };

  const updateStoreTheme = (themeId: string) => {
    const nextTheme = APP_THEMES.find((item) => item.id === themeId) || APP_THEMES[0];
    const nextCustomization = buildAppThemeCustomization(nextTheme.id, { ...themeCustomization, primaryColor: nextTheme.primaryColor });
    setFormSettings((prev) => ({ ...prev, appTheme: nextTheme.id, primaryColor: nextCustomization.primaryColor, appThemeCustomization: nextCustomization }));
  };

  // RELEASE-QUALITY-04 §1: claro/escuro/sistema — independente do `appTheme` (paleta de cor de marca)
  // acima. `setTheme` troca IMEDIATAMENTE (next-themes já persiste em localStorage e reage a
  // prefers-color-scheme sozinho); a escrita em formSettings.appearanceMode só serve para o campo
  // acompanhar o usuário entre aparelhos quando ele salvar a página, nunca é a fonte da troca instantânea.
  const { theme: appearanceTheme, setTheme: setAppearanceTheme } = useTheme();
  const handleSelectAppearanceMode = (mode: "system" | "light" | "dark") => {
    setAppearanceTheme(mode);
    setFormSettings((prev) => ({ ...prev, appearanceMode: mode }));
  };

  const updatePrimaryNicho = (nicho: string) => {
    const safeNicho = (nicho in NICHO_CONFIG ? nicho : "Geral") as NichoId;
    setFormSettings((prev) => {
      const current = Array.isArray(prev?.businessTypes) ? prev.businessTypes.filter((item): item is NichoId => item in NICHO_CONFIG) : [];
      return { ...prev, businessType: safeNicho, businessTypes: [safeNicho, ...current.filter((item) => item !== safeNicho)] };
    });
  };

  const toggleBusinessType = (nicho: NichoId) => {
    setFormSettings((prev) => {
      const current = Array.isArray(prev?.businessTypes) ? prev.businessTypes.filter((item): item is NichoId => item in NICHO_CONFIG) : [];
      const exists = current.includes(nicho);
      const nextTypes = exists ? current.filter((item) => item !== nicho) : [...current, nicho];
      const normalizedTypes = nextTypes.length > 0 ? nextTypes : [selectedPrimaryNicho as NichoId];
      const nextPrimary = normalizedTypes.includes(prev?.businessType as NichoId) ? prev?.businessType : normalizedTypes[0];
      return { ...prev, businessType: nextPrimary, businessTypes: normalizedTypes };
    });
  };

  // Sync Firestore settings to form ONLY on initial load
  // This prevents re-renders from interrupting user input
  useEffect(() => {
    // Only initialize once, when data finishes loading for the first time
    if (!settingsLoading && firestoreSettings && !hasInitialized.current) {
      setFormSettings(firestoreSettings);
      hasInitialized.current = true;
      // Continuidade entre aparelhos: só aplica a aparência salva no Firestore se este navegador
      // AINDA NÃO tem uma escolha local própria — a escolha feita neste aparelho sempre vence, o
      // Firestore é só para o primeiro acesso de um aparelho novo.
      if (firestoreSettings.appearanceMode && typeof window !== "undefined" && !window.localStorage.getItem(APPEARANCE_THEME_STORAGE_KEY)) {
        setAppearanceTheme(firestoreSettings.appearanceMode);
      }
    }
  }, [settingsLoading]); // Only depend on loading state, not firestoreSettings


  const [activeTab, setActiveTab] = useState(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      return normalizeSettingsTab(params.get('tab'));
    }
    return 'menu';
  });

  const [location, setLocation] = useLocation();
  const [generatedUrl, setGeneratedUrl] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");
  const copyReferralValue = (value: string | null, message: string) => {
    if (!value) return;
    navigator.clipboard.writeText(value);
    setSaveMessage(message);
    setTimeout(() => setSaveMessage(""), 3000);
    logTelemetryEvent("referral_link_copied", { origin: "settings_growth" }).catch(() => {});
  };
  const { activeConnections: mpActiveConnections } = useMPConnections();
  const isMercadoPagoConnected = mpActiveConnections.length > 0;
  const hasPendingChanges = useMemo(
    () => JSON.stringify(formSettings ?? {}) !== JSON.stringify(firestoreSettings ?? {}),
    [formSettings, firestoreSettings]
  );
  const [openHelpIndex, setOpenHelpIndex] = useState<number | null>(null);
  const [isUploadingLogo, setIsUploadingLogo] = useState(false);
  const [pendingBackupFile, setPendingBackupFile] = useState<File | null>(null);
  const [showBackupRestoreConfirm, setShowBackupRestoreConfirm] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const syncTab = () => {
      const params = new URLSearchParams(window.location.search);
      const requestedTab = params.get("tab");
      const normalizedTab = normalizeSettingsTab(requestedTab);
      setActiveTab(normalizedTab);
      if (requestedTab && normalizedTab === "menu") {
        window.history.replaceState({}, "", "/settings");
      }
    };
    syncTab();
    window.addEventListener("popstate", syncTab);
    return () => window.removeEventListener("popstate", syncTab);
  }, [location]);

  // Acompanha o usuário autenticado de forma reativa (mesmo padrão de useUserSettings.ts):
  // se o Firebase ainda estiver restaurando a sessão no primeiro render, authReady começa
  // false e firebaseUid/currentUserEmail só ficam disponíveis quando a sessão realmente resolve
  // — nunca ficam congelados em null como no useMemo(..., []) anterior.
  const [authUser, setAuthUser] = useState<FirebaseAuthUser | null>(null);
  const [authReady, setAuthReady] = useState(false);

  useEffect(() => {
    const auth = getFirebaseAuth();
    if (!auth) {
      setAuthReady(true);
      setAuthUser(null);
      return;
    }
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setAuthUser(user ?? null);
      setAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  const firebaseUid = authUser?.uid ?? null;
  const currentUserEmail = authUser?.email ?? null;

  const handleSave = async () => {
    if (!authReady) {
      // Sessão ainda restaurando — não é uma sessão expirada de verdade, só aguarde.
      notifyWarning("Aguarde a sessão terminar de carregar e tente novamente.");
      return;
    }
    if (!firebaseUid) {
      setSaveMessage("Erro: usuário não autenticado.");
      notifyError("Sessão expirada. Faça login novamente.");
      return;
    }

    setIsSaving(true);
    setSaveMessage("");

    try {
      const rawStoreName = String(formSettings?.storeName || "").replace(/\s+/g, " ").trim();
      const normalizedStoreName = rawStoreName || "Minha loja";
      const catalogSlug = normalizeCatalogSlug(formSettings?.catalogSlug || formSettings?.catalog_slug || "");
      // Rótulo da área de pedidos: espaços colapsados e aparados. Se sobrar vazio (ou só espaços), o
      // campo é REMOVIDO do documento em vez de gravado como "" — assim o resolver cai no rótulo padrão
      // e nenhuma conta antiga precisa de migração.
      const rawOrdersLabel = String(formSettings?.featureLabels?.orders || "").replace(/\s+/g, " ").trim().slice(0, ORDERS_FEATURE_LABEL_MAX_LENGTH);
      const { orders: _discardedOrdersLabel, ...otherFeatureLabels } = formSettings?.featureLabels ?? {};
      const normalizedFeatureLabels = rawOrdersLabel ? { ...otherFeatureLabels, orders: rawOrdersLabel } : otherFeatureLabels;
      const normalizedSettings = {
        ...formSettings,
        storeName: normalizedStoreName,
        catalogSlug,
        catalog_slug: catalogSlug,
        featureLabels: normalizedFeatureLabels,
      };
      setFormSettings(normalizedSettings);
      const settingsPayload: Record<string, unknown> = { ...normalizedSettings };
      if (!catalogSlug) {
        delete settingsPayload.catalogSlug;
        delete settingsPayload.catalog_slug;
      }

      const response = await measureOperation("catalog_settings_save", async () => {
        const token = await getFirebaseIdToken();
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (token) headers["Authorization"] = `Bearer ${token}`;

        return await fetch(getApiUrl(`/api/user/settings/${firebaseUid}`), {
          method: "POST",
          headers,
          body: JSON.stringify(settingsPayload)
        });
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const result = await response.json();
      if (result.success) {
        const returnedSettings = result.settings && typeof result.settings === "object" ? result.settings : {};
        const confirmedSettings = {
          ...normalizedSettings,
          ...returnedSettings,
          storeName: normalizedSettings.storeName,
        };
        setSaveMessage("Configurações salvas.");
        notifySuccess("Configurações salvas.");
        setFormSettings(confirmedSettings);
        patchUserSettingsOptimistic(confirmedSettings);
        setTimeout(() => setSaveMessage(""), 3000);
      } else {
        throw new Error(result.error || "Erro ao salvar");
      }
    } catch (err) {
      setSaveMessage("Erro ao salvar.");
      notifyError("Erro ao salvar.");
      console.error("[settings] Save error:", err);
    } finally {
      setIsSaving(false);
    }
  };

  const handleLogout = async () => {
    const auth = getFirebaseAuth();
    const uid = auth?.currentUser?.uid ?? getCurrentUserId();

    try {
      if (auth) {
        await signOut(auth);
      }
    } catch (error) {
      console.error("[settings] Logout failed:", error);
      notifyError("Não foi possível encerrar sua sessão agora.");
      return;
    }

    if (uid) {
      await clearScopedAccountLocalData(uid);
    }
    // §8: apaga o cache offline do Firestore (IndexedDB) — isolamento por tenant além do path uid.
    await clearFirestoreOfflineCache();

    queryClient.clear();
    clearUserContext();
    clearTelemetryUserId();
    await logout();
    setLocation("/login");
  };

  const handleGenerateLink = async () => {
    if (!firebaseUid) {
      notifyError("Sessão expirada. Faça login novamente.");
      return;
    }
    try {
      const token = await getFirebaseIdToken();
      if (!token) throw new Error("Authentication token is empty");
      const response = await fetch(getApiUrl(`/api/public-catalog/ensure/${firebaseUid}`), {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const result = await response.json() as { slug?: string };
      const slug = normalizeCatalogSlug(result.slug || "");
      if (!slug) throw new Error();
      const confirmedSettings = {
        ...formSettings,
        catalogSlug: slug,
        catalog_slug: slug,
        enablePublicCatalog: true,
      };
      setFormSettings(confirmedSettings);
      patchUserSettingsOptimistic(confirmedSettings);
      setGeneratedUrl(buildPublicAppUrl(`/u/${encodeURIComponent(slug)}`));
    } catch {
      notifyError("Erro ao gerar link.");
    }
  };

  const handleDownloadQR = () => {
    const svg = document.getElementById('qr-code-svg');
    if (!svg) return;
    const svgData = new XMLSerializer().serializeToString(svg);
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const img = new Image();
    img.onload = () => {
      canvas.width = img.width;
      canvas.height = img.height;
      ctx?.drawImage(img, 0, 0);
      const pngFile = canvas.toDataURL('image/png');
      const downloadLink = document.createElement('a');
      downloadLink.download = 'qrcode-catalogo.png';
      downloadLink.href = pngFile;
      downloadLink.click();
    };
    img.src = 'data:image/svg+xml;base64,' + btoa(svgData);
  };


  const goToAccountMenu = () => {
    setActiveTab("menu");
    window.history.pushState({}, "", "/settings");
    window.dispatchEvent(new PopStateEvent("popstate"));
  };

  const handleLogoChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !firebaseUid) return;
    setIsUploadingLogo(true);
    setSaveMessage("");
    try {
      const blob = await compressLogo(file);
      if (!blob) throw new Error("Não foi possível processar a imagem.");
      const token = await getFirebaseIdToken();
      if (!token) throw new Error("Não autenticado.");
      // RELEASE-06: sobe pelo endpoint server-side (magic bytes + dimensões reais + quota validadas
      // no servidor) em vez de uploadBytes() direto ao Storage.
      const uploadResult = await uploadImageViaServer({ kind: "logo", blob, token });
      const storeLogo = uploadResult.downloadUrl;
      const nextSettings = { ...formSettings, storeLogo };
      const response = await fetch(getApiUrl(`/api/user/settings/${firebaseUid}`), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(nextSettings),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setFormSettings(nextSettings);
      patchUserSettingsOptimistic(nextSettings);
      setSaveMessage("Logo atualizado.");
      notifySuccess("Logo atualizado.");
    } catch (error) {
      console.error("[settings] Logo upload failed:", error);
      setSaveMessage("Erro ao salvar logo.");
      notifyError("Erro ao salvar logo.");
    } finally {
      setIsUploadingLogo(false);
    }
  };

  const restoreBackupFromFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const id = getCurrentUserId();
        if (!id) {
          setSaveMessage("Erro: usuário não identificado.");
          return;
        }
        const backup = JSON.parse(event.target?.result as string);
        const prefix = `rs:${id}:`;
        Object.keys(backup).forEach(key => {
          if (key.startsWith(prefix)) {
            localStorage.setItem(key, backup[key]);
          }
        });
        setSaveMessage('Backup restaurado.');
        notifySuccess("Backup restaurado.");
        setTimeout(() => window.location.reload(), 1500);
      } catch {
        setSaveMessage('Arquivo inválido.');
        notifyError("Arquivo de backup inválido.");
      }
    };
    reader.readAsText(file);
  };

  const confirmBackupRestore = () => {
    const file = pendingBackupFile;
    setPendingBackupFile(null);
    setShowBackupRestoreConfirm(false);
    if (file) restoreBackupFromFile(file);
  };

  const displayName = formSettings?.sellerName || currentUserEmail?.split("@")[0] || "Usuário";
  const accountMenu: AccountMenuEntry[] = [
    { title: "Minha Conta", subtitle: "Perfil e dados pessoais", icon: User, color: "bg-primary/10 text-primary", path: "/settings?tab=account" },
    { title: "Minha Loja", subtitle: "Nome, logo e informações", icon: Store, color: "bg-violet-100 text-violet-700", path: "/settings?tab=store" },
    { title: "Chave Pix", subtitle: "Recebimento dos pedidos", icon: KeyRound, color: "bg-green-100 text-green-700", path: "/settings?tab=pix" },
    { title: "Compartilhar Catálogo", subtitle: "Link e QR Code do catálogo", icon: Share2, color: "bg-blue-100 text-blue-700", path: "/settings?tab=catalog" },
    { title: "Indique e ganhe", subtitle: `A cada ${REFERRAL_REWARD_LIMIT} indicações, 30 dias de Premium`, icon: Gift, color: "bg-amber-100 text-amber-700", path: "/settings?tab=growth" },
    { title: "Clientes", subtitle: "Cadastro, busca e histórico de compras", icon: Users, color: "bg-cyan-100 text-cyan-700", path: "/clients" },
    { title: "Cobranças", subtitle: "Pendentes, vencidas e recebidas", icon: Receipt, color: "bg-emerald-100 text-emerald-700", path: "/billings" },
    // SERV-E2E-01 §3/§19 — único ponto de entrada navegável para o módulo Serviços (Agenda, de onde o
    // dono também alcança Configurar horários e cada Atendimento) — antes só existia digitando a URL.
    { title: "Serviços", subtitle: "Agenda, horários de atendimento e agendamentos", icon: CalendarClock, color: "bg-indigo-100 text-indigo-700", path: "/servicos/agenda" },
    { title: "Minha Assinatura", subtitle: "Plano e faturamento", icon: CreditCard, color: "bg-sky-100 text-sky-700", path: "/subscribe" },
    // PLAN-IMPL-04A §34 — entrada nova, conceitualmente separada das outras duas: "Minha Assinatura" é
    // gestão de cobrança, "Plano e uso" é capacidade/limites atuais, "Planos" é comparação/upgrade.
    { title: "Planos", subtitle: "Compare Free, Pro e Premium", icon: Sparkles, color: "bg-amber-100 text-amber-700", path: "/plans" },
    { title: "Plano e uso", subtitle: "Produtos, serviços e clientes ativos no seu plano", icon: Gauge, color: "bg-cyan-100 text-cyan-700", path: "/settings/plano-e-uso" },
    { title: resolveOrdersFeatureLabel(firestoreSettings), subtitle: "Pedidos e encomendas da loja", icon: ClipboardList, color: "bg-purple-100 text-purple-700", path: "/orders" },
    { title: "Preferências", subtitle: "Notificações e ajustes", icon: Bell, color: "bg-slate-100 text-slate-700", path: "/settings?tab=preferences" },
    { title: "Suporte", subtitle: "Ajuda, FAQ e contato", icon: HelpCircle, color: "bg-amber-100 text-amber-700", path: "/settings?tab=support" },
    // OWNER-ACCESS-02 §9 — só entra no array (e portanto só aparece no menu Conta) quando isAdmin=true.
    ...(isAdmin ? [{ title: "Administração", subtitle: "Tester, Premium+ e contas internas", icon: ShieldCheck, color: "bg-rose-100 text-rose-700", path: "/settings?tab=admin" }] : []),
  ];

  if (settingsLoading && !hasInitialized.current) {
    return (
      <Layout>
        <PageSkeleton variant="settings" />
      </Layout>
    );
  }

  if (activeTab === "menu") {
    return (
      <Layout>
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-6 lg:py-10">
          <AccountHero displayName={displayName} logoUrl={formSettings?.storeLogo} />
          <div className="bg-white rounded-[2rem] border border-border/60 shadow-sm overflow-hidden divide-y divide-border/50">
            {accountMenu.map(item => (
              <AccountMenuItem
                key={item.title}
                icon={item.icon}
                iconClassName={item.color}
                title={item.title}
                subtitle={item.subtitle}
                disabled={item.disabled}
                badge={item.badge}
                onClick={item.disabled ? undefined : () => {
                  const tab = new URL(item.path, window.location.origin).searchParams.get("tab");
                  if (tab) setActiveTab(tab);
                  setLocation(item.path);
                }}
              />
            ))}
            <AccountMenuItem
              icon={LogOut}
              iconClassName="bg-red-100 text-red-600"
              title="Sair"
              subtitle="Encerrar sessão"
              tone="danger"
              onClick={handleLogout}
            />
          </div>
          <div className="mt-5 text-center text-muted-foreground" aria-label="Versão instalada do aplicativo">
            <p className="text-[11px] font-semibold" data-testid="account-app-version">Revenda Smart v{APP_VERSION}</p>
            <p className="mt-1 text-[10px]" data-testid="account-build-id">Build {formatAppBuildId(APP_BUILD_ID)}</p>
          </div>
        </div>
      </Layout>
    );
  }
  return (
    <Layout>
      <ConfirmActionDialog
        open={showBackupRestoreConfirm}
        onOpenChange={(open) => {
          setShowBackupRestoreConfirm(open);
          if (!open && pendingBackupFile) {
            setPendingBackupFile(null);
            setSaveMessage("");
          }
        }}
        title="Restaurar backup"
        description="Isso substituirá seus dados atuais neste dispositivo. Essa ação não pode ser desfeita."
        confirmLabel="Restaurar"
        onConfirm={confirmBackupRestore}
      />
      <div className="flex flex-col h-full bg-background">
        <div className="p-3 px-6 bg-primary/5 border-b border-primary/10 flex justify-between items-center min-h-[2.5rem]">
          <p className="text-[8px] font-black text-primary uppercase tracking-[0.2em]">
            {settingsLoading ? "⏳ Carregando..." : "✓ Sincronizado"}
          </p>
          {saveMessage && (
            <div className={`text-[9px] font-black uppercase tracking-widest px-3 py-1.5 rounded-lg ${
              saveMessage.includes("Erro")
                ? "bg-red-100 text-red-700 border border-red-200"
                : "bg-green-100 text-green-700 border border-green-200"
            }`}>
              {saveMessage.includes("Erro") ? "⚠️ " : "✓ "}
              {saveMessage}
            </div>
          )}
        </div>

        <div className="px-4 sm:px-6 lg:px-8 pt-4 max-w-4xl mx-auto w-full">
          <button onClick={goToAccountMenu} className="inline-flex items-center gap-2 text-sm font-bold text-muted-foreground hover:text-primary"><ArrowLeft className="w-4 h-4" /> Voltar para Conta</button>
        </div>

        <div className="flex-1 w-full max-w-4xl mx-auto p-4 sm:p-6 lg:p-8 pb-32 space-y-6">
          {activeTab === 'account' && (
            <div className="space-y-5 animate-in fade-in slide-in-from-right-4">
              <div><p className="text-xs font-semibold text-primary">Minha Conta</p><h2 className="text-2xl font-semibold tracking-tight mt-1">Perfil e dados pessoais</h2><p className="text-sm text-muted-foreground mt-1">Atualize seus dados de contato e identificação.</p></div>
              <div className="bg-white border border-border/60 rounded-3xl p-5 space-y-4 shadow-sm">
                <InputField label="Nome" value={formSettings?.sellerName} onChange={(v: string) => setFormSettings({...formSettings, sellerName: v})} />
                <InputField label="E-mail" value={currentUserEmail || ""} disabled={true} />
                <InputField label="WhatsApp" value={formSettings?.whatsapp} onChange={(v: string) => setFormSettings({...formSettings, whatsapp: v})} />
              </div>
              <button data-testid="button-go-to-mp-settings" onClick={() => setLocation("/settings/mercadopago")} className="w-full flex items-center justify-between bg-white border border-border/60 py-4 px-5 rounded-2xl shadow-sm">
                <div className="flex items-center gap-3">
                  <CreditCard className="w-5 h-5 text-[#009EE3]" />
                  <div className="text-left">
                    <p className="text-sm font-bold">Mercado Pago</p>
                    <p className="text-xs text-muted-foreground">Gerencie sua conta de recebimento</p>
                    <p className={`mt-1 text-[10px] font-bold uppercase tracking-wide ${isMercadoPagoConnected ? "text-green-600" : "text-muted-foreground"}`} data-testid="text-mercadopago-status">
                      {isMercadoPagoConnected ? "✓ Conectado" : "Não conectado"}
                    </p>
                  </div>
                </div>
                <ChevronRight className="w-5 h-5 text-muted-foreground" />
              </button>

              <SaveChangesButton onClick={handleSave} disabled={!hasPendingChanges || isSaving} isSaving={isSaving} testId="button-save-account" />

              {/* RELEASE-03B — ponto de entrada in-app para a exclusão de conta.
                  Sem dark pattern: a ação é visível, rotulada exatamente pelo que faz e explica a
                  consequência antes do toque. Toda a lógica (confirmação, DELETE /api/account,
                  logout, limpeza local) continua morando só em /account-deletion — aqui é apenas
                  navegação, nunca uma segunda implementação da exclusão. */}
              <section aria-labelledby="settings-danger-zone-title" className="pt-2 bg-white border border-red-200 rounded-2xl overflow-hidden shadow-sm">
                <h3 id="settings-danger-zone-title" className="text-[10px] font-black text-muted-foreground uppercase tracking-widest px-5 pb-1">
                  Zona de perigo
                </h3>
                {/* Reaproveita o item de menu da própria tela de Conta (variante `danger`) em vez de
                    remarcar o mesmo layout à mão — consistência visual e sem custo extra de bundle. */}
                <AccountMenuItem
                  icon={Trash2}
                  iconClassName="bg-red-100 text-red-600"
                  title="Excluir minha conta"
                  subtitle="Remove permanentemente sua conta e seus dados. Ação irreversível."
                  tone="danger"
                  testId="button-delete-account"
                  onClick={() => setLocation("/account-deletion")}
                />
              </section>
            </div>
          )}
          {activeTab === 'store' && (
            <div className="space-y-5 animate-in fade-in slide-in-from-right-4">
              <div><p className="text-xs font-black text-violet-700 uppercase tracking-wider">Minha Loja</p><h2 className="text-2xl font-black mt-1">Nome, tema e nicho</h2><p className="text-sm text-muted-foreground mt-1">Ajuste a identidade da loja.</p></div>

              {/* Logo compacto: mesma função de sempre (alterar logo da loja), só que como uma linha
                  única em vez do card grande — a referência desta rodada não reserva espaço pra ele. */}
              <div className="flex items-center gap-3">
                <button type="button" onClick={() => logoInputRef.current?.click()} disabled={isUploadingLogo} className="relative w-11 h-11 shrink-0 rounded-xl bg-primary/10 border border-primary/15 flex items-center justify-center font-black text-sm text-primary overflow-hidden disabled:opacity-60" aria-label="Alterar logo da loja">
                  {formSettings?.storeLogo ? <img src={formSettings.storeLogo} alt="Logo da loja" className="w-full h-full object-cover" loading="lazy" decoding="async" width={44} height={44} /> : (formSettings?.storeName || "R").charAt(0).toLocaleUpperCase("pt-BR")}
                </button>
                <input ref={logoInputRef} type="file" accept="image/*" className="hidden" onChange={handleLogoChange} />
                <button type="button" onClick={() => logoInputRef.current?.click()} disabled={isUploadingLogo} className="text-xs font-semibold text-muted-foreground disabled:opacity-60">
                  {isUploadingLogo ? "Enviando logo..." : "Logo da loja · toque para alterar"}
                </button>
              </div>

              <InputField label="Nome da Loja" value={formSettings?.storeName} onChange={(v: string) => setFormSettings({...formSettings, storeName: v})} />
              <InputField label="WhatsApp" value={formSettings?.whatsapp} onChange={(v: string) => setFormSettings({...formSettings, whatsapp: v})} />
              {/* Só o rótulo visual da área de pedidos: rota /orders, coleção e status internos não mudam. */}
              <InputField
                label="Nome da área de pedidos"
                value={formSettings?.featureLabels?.orders}
                placeholder={ORDERS_FEATURE_LABEL}
                maxLength={ORDERS_FEATURE_LABEL_MAX_LENGTH}
                hint="Esse nome aparecerá no menu e na área de pedidos."
                onChange={(v: string) => setFormSettings({ ...formSettings, featureLabels: { ...formSettings?.featureLabels, orders: v } })}
              />

              <div className="rs-store-card rs-store-premium-panel">
                <div className="rs-store-panel-head">
                  <div>
                    <h3>Aparência do app</h3>
                    <p>Escolha entre claro, escuro, ou acompanhar o sistema do aparelho.</p>
                  </div>
                </div>
                <div className="rs-store-choice-row">
                  <div>
                    {([
                      { id: "system" as const, label: "Sistema", icon: Monitor },
                      { id: "light" as const, label: "Claro", icon: Sun },
                      { id: "dark" as const, label: "Escuro", icon: Moon },
                    ]).map((option) => (
                      <button
                        key={option.id}
                        type="button"
                        data-testid={`button-appearance-${option.id}`}
                        onClick={() => handleSelectAppearanceMode(option.id)}
                        className={(appearanceTheme ?? "system") === option.id ? "is-selected" : ""}
                      >
                        <option.icon className="h-3.5 w-3.5" aria-hidden="true" /> {option.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="rs-store-card rs-store-premium-panel">
                <div className="rs-store-panel-head">
                  <div>
                    <p className="rs-store-help">Tema atual: {selectedTheme.label}</p>
                    <h3>Personalização visual da loja</h3>
                    <p>Ajuste cores, botões, cards e sensação do app sem recriar sua conta.</p>
                  </div>
                  <div className="rs-store-mini-preview" style={{ background: `linear-gradient(135deg, ${themeCustomization.primaryColor}, ${selectedTheme.primaryColor})` }}>
                    <span>{(formSettings?.storeName || "R").charAt(0).toLocaleUpperCase("pt-BR")}</span>
                    <small>{selectedTheme.label.replace("Tema ", "")}</small>
                  </div>
                </div>

                <div className="rs-store-theme-grid" aria-label="Trocar tema">
                  {APP_THEMES.map((theme) => (
                    <button key={theme.id} type="button" onClick={() => updateStoreTheme(theme.id)} title={theme.description} className={`rs-store-theme-option ${selectedThemeId === theme.id ? "is-selected" : ""}`}>
                      <span className={`rs-store-theme-swatch bg-gradient-to-br ${theme.swatch}`} />
                      <strong>{theme.label}</strong>
                    </button>
                  ))}
                </div>

                <div className="rs-store-fine-tune">
                  <label className="rs-store-color-control">
                    <span>Cor principal</span>
                    <input type="color" aria-label="Cor principal da loja" value={themeCustomization.primaryColor} onChange={(event) => updateThemeCustomization({ primaryColor: event.target.value })} />
                  </label>
                  {[
                    { label: "Botões", key: "buttonTone", options: BUTTON_TONES },
                    { label: "Cards", key: "cardTone", options: CARD_TONES },
                    { label: "Sombras", key: "shadowIntensity", options: SHADOW_LEVELS },
                    { label: "Bordas", key: "radius", options: RADIUS_LEVELS },
                    { label: "Animações", key: "motion", options: MOTION_LEVELS },
                  ].map((group) => (
                    <div key={group.key} className="rs-store-choice-row">
                      <p>{group.label}</p>
                      <div>
                        {group.options.map((option) => {
                          const selectedValue = themeCustomization[group.key as keyof typeof themeCustomization];
                          return (
                            <button key={option.id} type="button" onClick={() => updateThemeCustomization({ [group.key]: option.id } as Partial<AppThemeCustomization>)} className={selectedValue === option.id ? "is-selected" : ""}>
                              {option.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rs-store-card rs-store-premium-panel">
                <div className="rs-store-panel-head">
                  <div>
                    <p className="rs-store-help">Nicho principal: {NICHO_CONFIG[selectedPrimaryNicho as NichoId]?.label || selectedPrimaryNicho}</p>
                    <h3>Organização por nicho</h3>
                    <p>Altere o foco da loja e mantenha nichos adicionais ativos sem apagar produtos, clientes ou histórico.</p>
                  </div>
                </div>
                <label htmlFor="store-nicho-select" className="rs-store-action">Alterar nicho principal</label>
                <select id="store-nicho-select" aria-label="Alterar nicho" value={selectedPrimaryNicho} onChange={(event) => updatePrimaryNicho(event.target.value)} className="rs-store-control">
                  {ONBOARDING_NICHO_IDS.map((nicho) => <option key={nicho} value={nicho}>{NICHO_CONFIG[nicho as NichoId]?.label || nicho}</option>)}
                </select>
                <div className="rs-store-nicho-grid" aria-label="Nichos adicionais">
                  {ONBOARDING_NICHO_IDS.map((nicho) => {
                    const config = NICHO_CONFIG[nicho as NichoId];
                    const isSelected = selectedBusinessTypes.includes(nicho as NichoId);
                    return (
                      <button key={nicho} type="button" onClick={() => toggleBusinessType(nicho as NichoId)} title={config?.desc || undefined} className={isSelected ? "is-selected" : ""}>
                        {config?.label || nicho}
                      </button>
                    );
                  })}
                </div>
              </div>

              <SaveChangesButton onClick={handleSave} disabled={!hasPendingChanges || isSaving} isSaving={isSaving} testId="button-save-store" />
            </div>
          )}

          {activeTab === 'pix' && (
            <div className="space-y-5 animate-in fade-in slide-in-from-right-4">
              <div><p className="text-xs font-black text-green-700 uppercase tracking-wider">Chave Pix</p><h2 className="text-2xl font-black mt-1">Recebimento dos pedidos</h2><p className="text-sm text-muted-foreground mt-1">Configure a chave apresentada aos seus clientes.</p></div>
              <div className="p-4 bg-green-50 border border-green-200 rounded-2xl">
                <p className="text-xs font-black text-green-700 uppercase">Chave Pix</p>
                <p className="text-[10px] text-green-600 mt-1">Usada para receber pedidos feitos pelo catálogo.</p>
              </div>
              <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl" data-testid="warning-pix-key-public">
                <p className="text-xs font-black text-amber-700 uppercase">Atenção: fica visível publicamente</p>
                <p className="text-[10px] text-amber-700 mt-1">A chave cadastrada aqui aparece para qualquer pessoa que abrir seu catálogo público, para que ela possa pagar por Pix. Se sua chave for um CPF, telefone ou e-mail, essa informação pessoal ficará visível a qualquer visitante. Se preferir, cadastre uma chave aleatória em vez de CPF, telefone ou e-mail.</p>
              </div>
              <InputField label="Chave Pix" value={formSettings?.pixKey} onChange={(v: string) => setFormSettings({...formSettings, pixKey: v})} placeholder="CPF, e-mail, telefone ou chave aleatória" />
            </div>
          )}
          {activeTab === 'catalog' && (
            <div className="space-y-6 animate-in fade-in slide-in-from-right-4">
              <div><p className="text-xs font-black text-blue-700 uppercase tracking-wider">Compartilhar Catálogo</p><h2 className="text-2xl font-black mt-1">Link e QR Code</h2><p className="text-sm text-muted-foreground mt-1">Compartilhe sua vitrine pública com seus clientes.</p></div>
              <div className="flex items-center justify-between p-4 bg-secondary/30 rounded-2xl">
                <div className="flex items-center gap-2">
                  <Store className="w-4 h-4 text-primary" />
                  <span className="text-[10px] font-black text-muted-foreground uppercase">Catálogo Ativo</span>
                </div>
                <input
                  type="checkbox"
                  checked={!!formSettings?.enablePublicCatalog}
                  onChange={e => setFormSettings({...formSettings, enablePublicCatalog: e.target.checked})}
                  className="w-5 h-5 accent-primary"
                />
              </div>

                  {formSettings?.enablePublicCatalog && (
                    <div className="space-y-4">
                      <button type="button" onClick={handleGenerateLink} className="w-full bg-primary/10 text-primary font-black py-4 rounded-2xl flex items-center justify-center gap-2 uppercase text-xs">
                        <RefreshCw className="w-4 h-4" /> Gerar Link
                      </button>
                      {generatedUrl && (
                        <div className="space-y-4 animate-in fade-in zoom-in-95">
                          <div className="space-y-2">
                            <label className="text-[10px] font-black text-muted-foreground uppercase px-1 tracking-widest">Seu Link</label>
                            <div className="bg-secondary/50 rounded-2xl p-4 text-xs font-mono break-all border border-primary/20">
                              {generatedUrl.split('://')[1] || generatedUrl}
                            </div>
                            <div className="grid grid-cols-2 gap-2"><button type="button" onClick={() => navigator.clipboard.writeText(generatedUrl)} className="py-3 rounded-xl bg-secondary text-xs font-bold flex items-center justify-center gap-2"><Copy className="w-4 h-4" /> Copiar</button><button type="button" onClick={() => window.open(generatedUrl, "_blank", "noopener,noreferrer")} className="py-3 rounded-xl bg-primary text-white text-xs font-bold flex items-center justify-center gap-2"><ExternalLink className="w-4 h-4" /> Abrir catálogo</button></div>
                          </div>

                          <div className="bg-white p-6 rounded-3xl border border-border/50 flex flex-col items-center gap-4">
                            <p className="text-[10px] font-black text-muted-foreground uppercase tracking-widest">QR Code do Catálogo</p>
                            <div className="p-4 bg-white border-4 border-secondary rounded-2xl">
                              <QRCodeSVG
                                id="qr-code-svg"
                                value={generatedUrl}
                                size={160}
                                level="H"
                                includeMargin={false}
                              />
                            </div>
                            <button
                              onClick={handleDownloadQR}
                              className="flex items-center gap-2 text-[10px] font-black text-primary uppercase hover:opacity-70 transition-opacity"
                            >
                              <QrCode className="w-4 h-4" /> Baixar QR Code
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
            </div>
          )}

          {activeTab === 'preferences' && (
            <div className="space-y-6 animate-in fade-in slide-in-from-right-4">
              <div><p className="text-xs font-black text-slate-700 uppercase tracking-wider">Preferências</p><h2 className="text-2xl font-black mt-1">Notificações e ajustes</h2><p className="text-sm text-muted-foreground mt-1">Personalize lembretes e o comportamento do aplicativo.</p></div>
              <div className="flex items-center justify-between p-4 bg-secondary/30 rounded-2xl">
                <div className="flex items-center gap-2">
                  <Bell className="w-4 h-4 text-primary" />
                  <span className="text-[10px] font-black text-muted-foreground uppercase">Lembretes de Cobrança</span>
                </div>
                <input
                  type="checkbox"
                  checked={!!formSettings?.notification_settings?.enable_billing_reminders}
                  onChange={e => setFormSettings({
                    ...formSettings,
                    notification_settings: {
                      ...(formSettings?.notification_settings || {}),
                      enable_billing_reminders: e.target.checked
                    }
                  })}
                  className="w-5 h-5 accent-primary"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-muted-foreground uppercase px-1 tracking-widest">Avisar quantos dias antes?</label>
                <input
                  type="number" inputMode="numeric" enterKeyHint="next"
                  className="w-full bg-secondary/50 border-none rounded-2xl p-4 text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                  value={formSettings?.notification_settings?.reminder_days_before_due || 1}
                  onChange={e => setFormSettings({
                    ...formSettings,
                    notification_settings: {
                      ...(formSettings?.notification_settings || {}),
                      reminder_days_before_due: parseInt(e.target.value) || 0
                    }
                  })}
                />
              </div>
            </div>
          )}

          {activeTab === 'growth' && (
            <div className="space-y-6 animate-in fade-in slide-in-from-right-4"
              onLoad={() => {
                logTelemetryEvent("growth_tab_viewed", { origin: "settings_nav" }).catch(() => {});
              }}
            >
              <div className="p-6 bg-primary/5 rounded-[2rem] border border-primary/10 space-y-4">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 bg-primary/10 rounded-2xl flex items-center justify-center">
                    <Share2 className="w-6 h-6 text-primary" />
                  </div>
                  <div>
                    <h3 className="text-sm font-black uppercase tracking-widest text-primary">Indique e ganhe</h3>
                    <p className="text-[10px] text-muted-foreground">Indique {REFERRAL_REWARD_LIMIT} pessoas que começarem a usar o RevendaSmart e ganhe {REFERRAL_REWARD_DAYS} dias de Premium.</p>
                  </div>
                </div>
                {/* RC-04 P1-04 §12/§13 — progresso visual (○ ○ ○ → ● ● ●) + explicação do critério real de
                    validação, com base exatamente na regra do servidor (server/routes.ts
                    /api/referral/validate-referral): a indicação só conta quando o convidado cria a conta
                    E conclui a configuração inicial (onboarding_completed) — nunca só o cadastro. */}
                <div className="mt-4 flex items-center justify-center gap-2" aria-label={`${referralCount} de ${REFERRAL_REWARD_LIMIT} indicações validadas`} data-testid="referral-progress-dots">
                  {Array.from({ length: REFERRAL_REWARD_LIMIT }).map((_, index) => (
                    <span
                      key={index}
                      className={`h-3 w-3 rounded-full transition-colors ${index < referralCount ? "bg-primary" : "bg-primary/15"}`}
                      aria-hidden="true"
                    />
                  ))}
                </div>
                <p className="mt-2 text-center text-xs font-bold text-foreground" data-testid="text-referral-progress-label">
                  {referralCount >= REFERRAL_REWARD_LIMIT
                    ? "Recompensa conquistada — 30 dias Premium adicionados à sua conta."
                    : referralCount === 0
                      ? `0 de ${REFERRAL_REWARD_LIMIT} indicações validadas`
                      : `${referralCount} de ${REFERRAL_REWARD_LIMIT} indicações validadas · falta ${REFERRAL_REWARD_LIMIT - referralCount} para ganhar ${REFERRAL_REWARD_DAYS} dias de Premium`}
                </p>
                <p className="mt-2 text-center text-[10px] text-muted-foreground">
                  A indicação é validada quando a pessoa convidada cria a conta e conclui a configuração inicial (onboarding).
                </p>
              </div>

              {/* GROWTH METRICS SECTION - Real data from Firestore */}
              {settingsLoading ? (
                <div className="p-6 bg-white rounded-2xl border border-border animate-pulse space-y-3">
                  <div className="h-6 bg-secondary rounded-lg"></div>
                  <div className="h-8 bg-secondary rounded-lg"></div>
                  <div className="h-6 bg-secondary rounded-lg"></div>
                </div>
              ) : (
                <div className="p-6 bg-white rounded-2xl border border-border space-y-5">
                  <div>
                    <h3 className="text-xs font-semiboldst text-foreground mb-4">Suas Indicações Convertidas</h3>

                    {(() => {
                      const conversions = firestoreSettings?.referral_conversions || 0;
                      const lastConversionAt = firestoreSettings?.last_referral_conversion_at;

                      const lastConversionDate = lastConversionAt ? (() => {
                        try {
                          const date = new Date(lastConversionAt);
                          return date.toLocaleDateString('pt-BR', {
                            year: 'numeric',
                            month: 'long',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit'
                          });
                        } catch {
                          return lastConversionAt;
                        }
                      })() : null;

                      return conversions === 0 ? (
                        <div className="text-center py-6 text-muted-foreground" data-testid="text-empty-conversions">
                          <Users className="w-12 h-12 mx-auto mb-3 opacity-20" />
                          <p className="text-sm font-medium">Nenhuma indicação convertida ainda</p>
                          <p className="text-[10px] mt-2 opacity-70">Convide amigas usando seu link. Quando elas se cadastrarem por ele, aparecerão aqui.</p>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          <div className="flex items-center gap-4 p-4 bg-primary/8 rounded-xl border border-primary/20">
                            <div className="flex-shrink-0">
                              <span className="text-2xl font-black text-primary">{conversions}</span>
                            </div>
                            <div className="flex-1">
                              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Indicações Convertidas</p>
                              <p className="text-[10px] text-muted-foreground mt-0.5">Amigas que completaram o cadastro</p>
                            </div>
                          </div>
                          {lastConversionDate && (
                            <div className="text-[10px] text-muted-foreground bg-secondary/30 rounded-lg p-3 text-center">
                              <p className="font-medium">Última conversão: <span className="font-bold text-foreground">{lastConversionDate}</span></p>
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                </div>
              )}

              {/*
                RELEASE-27: esta seção mostrava `user_settings.reward_eligible_conversions` /
                `reward_granted_count` — contadores incrementados no MOMENTO do cadastro da indicada
                (server/routes.ts, rota /api/user/settings), sem exigir onboarding completo nem a idade
                mínima de conta antiabuso. A recompensa REAL (Premium via `premiumSource:
                "referral_reward"`) só é concedida pelo caminho separado /api/referral/validate-referral,
                que exige onboarding_completed + conta com idade mínima + evento validado, e usa
                `planData.referralCount`. Os dois números podiam divergir — a tela prometia uma
                recompensa que o back-end nunca de fato concedia por aquele caminho. Trocado para mostrar
                o MESMO dado que decide a recompensa de verdade (usePlan().referralCount), nunca um
                contador paralelo.
              */}
              {settingsLoading ? (
                <div className="p-6 bg-gradient-to-r from-amber-50 to-yellow-50 rounded-2xl border border-amber-100 animate-pulse space-y-3">
                  <div className="h-6 bg-amber-200 rounded-lg"></div>
                  <div className="h-8 bg-amber-200 rounded-lg"></div>
                  <div className="h-6 bg-amber-200 rounded-lg"></div>
                </div>
              ) : (
                <div className="p-6 bg-gradient-to-r from-amber-50 to-yellow-50 rounded-2xl border border-amber-100 space-y-5">
                  <div>
                    <h3 className="text-xs font-black uppercase tracking-widest text-amber-900 mb-4">Seu Saldo de Recompensas</h3>

                    {(() => {
                      const referralRewardActive = activePlan === "premium" && planData?.premiumSource === "referral_reward";
                      const expiresAtLabel = referralRewardActive && planData?.premiumExpiresAt ? (() => {
                        try {
                          return new Date(planData.premiumExpiresAt as string).toLocaleDateString('pt-BR', { year: 'numeric', month: 'long', day: 'numeric' });
                        } catch {
                          return null;
                        }
                      })() : null;

                      return (
                        <div className="space-y-3">
                          <div className="p-4 bg-white/80 rounded-xl border border-amber-200/70 space-y-2">
                            <div className="flex items-center justify-between">
                              <span className="text-[10px] font-bold text-amber-900/70 uppercase tracking-wider">Indicações validadas</span>
                              <span className="text-2xl font-black text-amber-700" data-testid="value-reward-eligible">{referralCount}/{REFERRAL_REWARD_LIMIT}</span>
                            </div>
                            <p className="text-[9px] text-amber-900/60">
                              A cada {REFERRAL_REWARD_LIMIT} indicações que completarem o cadastro, você ganha 30 dias de Premium.
                            </p>
                          </div>

                          {referralRewardActive && (
                            <div className="p-4 bg-green-50/80 rounded-xl border border-green-200/70 space-y-2" data-testid="value-reward-granted">
                              <span className="text-[10px] font-bold text-green-900/70 uppercase tracking-wider">Premium por indicação ativo</span>
                              {expiresAtLabel && <p className="text-[9px] text-green-900/60">Válido até {expiresAtLabel}</p>}
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                </div>
              )}

              <div className="space-y-4">
                {/* RC-04 P1-04 §11: código isolado do link (era só embutido no link antes). Helper único
                   (copyReferralValue, definido acima do JSX de retorno) evita duplicar clipboard/mensagem/
                   telemetria nos dois botões. */}
                <div>
                  <label className="text-[10px] font-black text-muted-foreground uppercase px-1 tracking-widest mb-2 block">Seu Código</label>
                  <div className="flex gap-2">
                    <input readOnly value={referralCode || 'Carregando...'} className="flex-1 bg-secondary/50 border-none rounded-2xl p-4 text-sm font-black tracking-widest outline-none" data-testid="text-referral-code" />
                    <button onClick={() => copyReferralValue(referralCode, "Código copiado!")} className="bg-secondary text-foreground font-bold px-5 rounded-2xl flex items-center gap-2 uppercase text-[10px] active:scale-95 transition-all" data-testid="button-copy-referral-code">
                      <Copy className="w-4 h-4" /> Copiar
                    </button>
                  </div>
                </div>

                <div>
                  <label className="text-[10px] font-black text-muted-foreground uppercase px-1 tracking-widest mb-2 block">Compartilhar Link</label>
                  <div className="flex gap-2">
                    <input readOnly value={referralShareLink || 'Carregando seu link...'} className="flex-1 bg-secondary/50 border-none rounded-2xl p-4 text-xs focus:ring-2 focus:ring-primary/20 outline-none" />
                    <button onClick={() => copyReferralValue(referralShareLink, "Link copiado!")} className="bg-primary text-white font-black px-5 rounded-2xl flex items-center gap-2 uppercase text-[10px] active:scale-95 transition-all hover:shadow-md" data-testid="button-copy-referral">
                      <Save className="w-4 h-4" /> Copiar
                    </button>
                  </div>
                </div>

                <div className="bg-white p-4 rounded-2xl border border-border">
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    <strong>Como funciona:</strong> Compartilhe seu código ou link com amigas consultoras. A indicação é validada quando a pessoa convidada cria a conta e conclui a configuração inicial. A cada {REFERRAL_REWARD_LIMIT} indicações validadas, você ganha {REFERRAL_REWARD_DAYS} dias de Premium grátis.
                  </p>
                </div>

                <div className="bg-white p-4 rounded-2xl border border-border space-y-2">
                  <p className="text-[10px] font-bold text-foreground uppercase tracking-wider">Compartilhe via:</p>
                  <div className="flex gap-2 flex-wrap">
                    <button
                      onClick={async () => {
                        const link = referralShareLink;
                        if (!link) return;
                        const text = `Estou usando o RevendaSmart para organizar minhas vendas, estoque e catálogo. Use meu código de indicação: ${referralCode || ""} ou entre direto por aqui: ${link}`;

                        // RC-04 P1-04 §14 — no Android (WebView), `navigator.share` normalmente não existe;
                        // o mecanismo real já usado pelo app para compartilhamento nativo é o plugin
                        // @capacitor/share (mesmo padrão de client/src/lib/marketing-share.ts), nunca chamado
                        // aqui antes desta correção — o botão silenciosamente só copiava o texto no Android.
                        const { Capacitor } = await import("@capacitor/core");
                        const isNative = Capacitor.isNativePlatform();
                        const method: "native_share" | "direct_share" = isNative ? "native_share" : "direct_share";
                        logTelemetryEvent("referral_share_initiated", { method, origin: "settings_growth" }).catch(() => {});

                        try {
                          if (isNative) {
                            const { Share } = await import("@capacitor/share");
                            await Share.share({ title: "Revenda Smart", text });
                          } else if (typeof navigator.share === "function") {
                            await navigator.share({ title: "Revenda Smart", text });
                          } else {
                            await navigator.clipboard.writeText(text);
                            setSaveMessage("Texto copiado.");
                            notifySuccess("Texto copiado.");
                            setTimeout(() => setSaveMessage(""), 3000);
                          }
                          logTelemetryEvent("referral_share_success", { method }).catch(() => {});
                        } catch (err) {
                          notifyWarning("Operação cancelada.");
                          logTelemetryEvent("referral_share_failed", { method, reason: (err as Error)?.message || "unknown" }).catch(() => {});
                        }
                      }}
                      className="bg-secondary text-foreground font-bold px-4 py-2 rounded-xl text-[10px] uppercase active:scale-95 transition-all flex items-center gap-2"
                    >
                      <Share2 className="w-3 h-3" /> Compartilhar
                    </button>
                    <button
                      onClick={() => {
                        const link = referralShareLink;
                        if (!link) return;
                        navigator.clipboard.writeText(link);
                        setSaveMessage("Link copiado para compartilhar!");
                        setTimeout(() => setSaveMessage(""), 3000);
                        logTelemetryEvent("referral_link_copied", { origin: "settings_growth" }).catch(() => {});
                      }}
                      className="bg-secondary text-foreground font-bold px-4 py-2 rounded-xl text-[10px] uppercase active:scale-95 transition-all flex items-center gap-2"
                    >
                      <Copy className="w-3 h-3" /> Copiar para Compartilhar
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* OWNER-ACCESS-02 §9/§12 — dupla checagem: além de só entrar no menu quando isAdmin (acima),
              o próprio conteúdo só renderiza com isAdmin=true, mesmo que alguém force `?tab=admin` na URL.
              Cada mutação real ainda passa por requireAdmin no servidor de qualquer forma. */}
          {activeTab === 'admin' && isAdmin && (
            <div className="space-y-4">
              {/* PROMOTIONAL-CAMPAIGNS-01 §4 — ponto de entrada dentro de Administração, nunca na bottom
                  nav principal. Mesma dupla checagem acima (isAdmin no menu + isAdmin no render). */}
              <button
                type="button"
                onClick={() => setLocation("/sorteios")}
                className="w-full flex items-center gap-3 rounded-2xl border border-border/60 bg-white p-4 text-left shadow-sm"
                data-testid="link-sorteios-promocionais"
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-rose-100 text-rose-700">
                  <Ticket className="h-5 w-5" />
                </span>
                <span className="flex-1">
                  <span className="block text-sm font-black text-foreground">Sorteios Promocionais</span>
                  <span className="block text-xs text-muted-foreground">Campanhas de sorteio para clientes com compras qualificadas</span>
                </span>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </button>
              <Suspense fallback={<PageSkeleton variant="cards" />}>
                <AdminGrantsPanel />
              </Suspense>
            </div>
          )}

          {activeTab === 'backup' && (
            <div className="space-y-6 animate-in fade-in slide-in-from-right-4">
              <div className="p-4 bg-primary/5 rounded-2xl border border-primary/10 space-y-3">
                <h3 className="text-xs font-black uppercase tracking-widest text-primary">Exportar Backup (JSON)</h3>
                <p className="text-[10px] text-muted-foreground leading-relaxed">
                  Baixe todos os seus dados deste dispositivo.
                </p>
                <button
                  onClick={() => {
                    try {
                      const id = getCurrentUserId();
                      if (!id) return;
                      const backup: Record<string, string> = {};
                      const prefix = `rs:${id}:`;
                      for (let i = 0; i < localStorage.length; i++) {
                        const key = localStorage.key(i);
                        if (key && key.startsWith(prefix)) {
                          backup[key] = localStorage.getItem(key) || "";
                        }
                      }
                      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
                      const url = window.URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      const date = new Date().toISOString().split('T')[0];
                      a.download = `revendasmart-backup-${date}.json`;
                      a.click();
                      window.URL.revokeObjectURL(url);
                      setSaveMessage("Backup exportado.");
                      notifySuccess("Backup exportado.");
                      setTimeout(() => setSaveMessage(""), 3000);
                    } catch { setSaveMessage("Erro ao exportar."); notifyError("Erro ao exportar backup."); }
                  }}
                  className="w-full bg-primary text-white font-black py-3 rounded-xl text-[10px] uppercase tracking-widest flex items-center justify-center gap-2"
                >
                  <Download className="w-3 h-3" /> Exportar Agora
                </button>
              </div>

              <div className="p-4 bg-secondary/30 rounded-2xl border border-border space-y-3">
                <h3 className="text-xs font-black uppercase tracking-widest text-muted-foreground">Importar Backup (JSON)</h3>
                <p className="text-[10px] text-muted-foreground leading-relaxed">
                  Restaure seus dados de um arquivo anterior. <span className="text-destructive font-bold">Isso substituirá seus dados atuais!</span>
                </p>
                <label className="w-full bg-white border border-dashed border-border rounded-xl p-4 flex flex-col items-center justify-center gap-2 cursor-pointer active:bg-secondary/50 transition-colors">
                  <Upload className="w-4 h-4 text-muted-foreground" />
                  <span className="text-[10px] font-bold uppercase text-muted-foreground">Selecionar Arquivo .json</span>
                  <input
                    type="file"
                    className="hidden"
                    accept=".json"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = "";
                      if (!file) return;
                      setSaveMessage("Aguardando confirmação.");
                      notifyWarning("Confirme para restaurar o backup.");
                      setPendingBackupFile(file);
                      setShowBackupRestoreConfirm(true);
                    }}
                  />
                </label>
              </div>
            </div>
          )}

          {activeTab === 'export_csv' && (
            <div className="space-y-4 animate-in fade-in slide-in-from-right-4">
              <div className="p-4 bg-secondary/30 rounded-2xl border border-border space-y-4">
                <h3 className="text-xs font-black uppercase tracking-widest text-muted-foreground">Exportar Planilhas (CSV)</h3>

                <button
                  onClick={() => {
                    const data = getStored(STORAGE_KEYS.CLIENTS, []);
                    const headers = ["ID", "Nome", "Telefone", "Email", "Notas"];
                    const rows = data.map((c: any) => [c.id, c.name, c.phone, c.email || "", c.notes || ""]);
                    const csv = [headers, ...rows].map(r => toCsvRow(r)).join("\n");
                    const blob = new Blob(["\ufeff" + csv], { type: 'text/csv;charset=utf-8;' });
                    const link = document.createElement("a");
                    const url = URL.createObjectURL(blob);
                    link.href = url;
                    link.download = `clientes-${new Date().toISOString().split('T')[0]}.csv`;
                    link.click();
                    URL.revokeObjectURL(url);
                  }}
                  className="w-full bg-white border border-border text-foreground font-bold py-4 rounded-xl text-xs uppercase flex items-center justify-center gap-2 active:scale-95 transition-all shadow-sm"
                >
                  <FileSpreadsheet className="w-4 h-4 text-green-600" /> Exportar Clientes (CSV)
                </button>

                <button
                  onClick={() => {
                    const data = getStored(STORAGE_KEYS.SALES, []);
                    const headers = ["ID", "Cliente ID", "Total", "Pagamento", "Data"];
                    const rows = data.map((s: any) => [s.id, s.clientId, s.totalPrice, s.paymentType, s.date]);
                    const csv = [headers, ...rows].map(r => toCsvRow(r)).join("\n");
                    const blob = new Blob(["\ufeff" + csv], { type: 'text/csv;charset=utf-8;' });
                    const link = document.createElement("a");
                    const url = URL.createObjectURL(blob);
                    link.href = url;
                    link.download = `vendas-${new Date().toISOString().split('T')[0]}.csv`;
                    link.click();
                    URL.revokeObjectURL(url);
                  }}
                  className="w-full bg-white border border-border text-foreground font-bold py-4 rounded-xl text-xs uppercase flex items-center justify-center gap-2 active:scale-95 transition-all shadow-sm"
                >
                  <FileSpreadsheet className="w-4 h-4 text-green-600" /> Exportar Vendas (CSV)
                </button>

                <button
                  onClick={() => {
                    const data = getStored(STORAGE_KEYS.INSTALLMENTS, []);
                    const headers = ["ID", "Venda ID", "Cliente ID", "Valor", "Vencimento", "Status"];
                    const rows = data.map((i: any) => [i.id, i.saleId, i.clientId, i.amount, i.dueDate, i.status]);
                    const csv = [headers, ...rows].map(r => toCsvRow(r)).join("\n");
                    const blob = new Blob(["\ufeff" + csv], { type: 'text/csv;charset=utf-8;' });
                    const link = document.createElement("a");
                    const url = URL.createObjectURL(blob);
                    link.href = url;
                    link.download = `faturamento-${new Date().toISOString().split('T')[0]}.csv`;
                    link.click();
                    URL.revokeObjectURL(url);
                  }}
                  className="w-full bg-white border border-border text-foreground font-bold py-4 rounded-xl text-xs uppercase flex items-center justify-center gap-2 active:scale-95 transition-all shadow-sm"
                >
                  <FileSpreadsheet className="w-4 h-4 text-green-600" /> Exportar Faturamento (CSV)
                </button>
              </div>
            </div>
          )}

          {activeTab === 'support' && (
            <div className="space-y-4 animate-in fade-in slide-in-from-right-4 pb-20">
              <div><p className="text-xs font-black text-amber-700 uppercase tracking-wider">Suporte</p><h2 className="text-2xl font-black mt-1">Ajuda, FAQ e contato</h2><p className="text-sm text-muted-foreground mt-1">Encontre respostas ou fale com o suporte.</p></div>
              {/* Header Info */}
              <div className="bg-gradient-to-br from-primary/10 to-primary/5 p-6 rounded-3xl border border-primary/20 space-y-3">
                <h2 className="text-lg font-semibold text-primary">Central de Ajuda</h2>
                <p className="text-xs text-muted-foreground leading-relaxed">Encontre respostas rápidas e entenda melhor como usar o Revenda Smart para vender mais.</p>
              </div>

              {/* Help Items - Accordion */}
              {[
                {
                  title: '🚀 Primeiros Passos',
                  content: `1. Crie sua conta com e-mail e senha
2. Configure seu perfil e escolha seus tipos de negócio
3. Adicione seus primeiros produtos
4. Compartilhe seu catálogo com clientes
5. Comece a registrar vendas e crescer!`
                },
                {
                  title: '📦 Como Cadastrar Produto',
                  content: `1. Vá para "Meus Produtos"
2. Clique em "+"
3. Selecione o tipo de negócio (Cosméticos, Roupas, etc)
4. Preencha Nome, Marca, Categoria, Preço de custo e venda
5. Adicione imagem e campos específicos (tamanho, cor, etc)
6. Defina o estoque
7. Clique em Salvar

Dica: produtos sem estoque podem continuar visíveis no catálogo, mas ficam indisponíveis para pedido.`
                },
                {
                  title: '🏪 Como Usar o Catálogo',
                  content: `Seu catálogo é a vitrine dos seus produtos:

1. Vá para "Catálogo" para ver como seus clientes veem
2. Filtro de categoria e gênero (em Roupas) funcionam automaticamente
3. Compartilhe a URL pública do seu catálogo:
   - Link fica em Configurações → Link do Catálogo
   - Copie e compartilhe por WhatsApp, Instagram, etc

Produtos sem estoque podem continuar visíveis no catálogo, mas ficam indisponíveis para pedido.`
                },
                {
                  title: '📢 Como Gerar Anúncio / Marketing',
                  content: `1. Vá para "Marketing"
2. Selecione um produto da sua lista
3. Escolha uma descrição e emoji
4. Clique em "Copiar"
5. Cole em WhatsApp Status, Stories do Instagram, etc

Texto curto, direto e com emoji = mais atenção dos clientes.`
                },
                {
                  title: '💰 Como Registrar Venda',
                  content: `1. Vá para "Vender"
2. Selecione o cliente (ou crie novo)
3. Adicione produtos ao carrinho
4. Defina quantidade e preço (se diferente)
5. Escolha forma de pagamento (Dinheiro, Débito, Crédito, Pix, etc)
6. Clique em "Registrar Venda"

Suas vendas ficarão registradas em "Dashboard" para análise depois.`
                },
                {
                  title: '🔗 Como Usar Cobranças / Links de Pagamento',
                  content: `1. Vá para "Cobranças"
2. Clique em "Gerar Link"
3. Selecione os produtos e quantidade
4. Defina o valor (ou deixe automático)
5. Gere o link
6. Copie e envie para o cliente por WhatsApp

Cliente clica no link, escolhe a forma de pagamento e você recebe a confirmação em tempo real.

Obs: Precisa da conta MercadoPago conectada em Configurações → Mercado Pago.`
                },
                {
                  title: '⚙️ Como Configurar Tipo de Negócio',
                  content: `1. Vá para Configurações → Aba "Perfil"
2. Em "Tipos de Negócio", marque quantos nichos precisar:
   - Cosméticos & Perfumes
   - Roupas
   - Acessórios
   - Alimentos/Doces
   - Geral

3. Clique em Salvar
4. Depois em "Adicionar Produto", escolha qual nicho está adicionando

Cada nicho tem categorias e campos diferentes automáticos!`
                },
                {
                  title: '❓ Dúvidas Frequentes',
                  content: `P: Posso ter mais de um tipo de negócio?
R: Sim! Marque quantos precisar em Configurações → Perfil

P: Meu catálogo é público?
R: Sim! A URL é pública e qualquer pessoa com o link acessa.

P: Perdi minha senha, como faço?
R: Na tela de login, clique "Esqueci a senha"

P: Como deleto minha conta?
R: Configurações → Segurança → Limpar Todos os Dados (permanente)

P: Consigo exportar meus dados?
R: Sim! Configurações → Planilhas. Você baixa CSV com produtos, clientes e vendas.`
                },
                {
                  title: '📧 Contato de Suporte',
                  content: `Precisa de ajuda que não encontrou aqui?

E-mail: revendasmart.suporte@gmail.com

Responderemos em até 24h com a solução para sua dúvida.

Dica: Descreva seu problema e se possível anexe uma screenshot do erro.`
                },
              ].map((item, index) => (
                <button
                  key={index}
                  onClick={() => setOpenHelpIndex(openHelpIndex === index ? null : index)}
                  className="w-full"
                  data-testid={`help-item-${index}`}
                >
                  <div className="w-full bg-white border border-border/60 p-4 rounded-2xl shadow-sm hover:bg-primary/5 transition-colors flex items-center justify-between">
                    <div className="flex-1 text-left">
                      <p className="text-xs font-black uppercase tracking-wide text-primary">{item.title}</p>
                    </div>
                    <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${openHelpIndex === index ? 'rotate-180' : ''}`} />
                  </div>

                  {/* Expanded Content */}
                  {openHelpIndex === index && (
                    <div className="mt-2 bg-primary/5 border border-primary/20 p-4 rounded-2xl animate-in fade-in slide-in-from-top-2">
                      <p className="text-xs text-muted-foreground leading-relaxed whitespace-pre-wrap">{item.content}</p>
                    </div>
                  )}
                </button>
              ))}

              {/* Support CTA */}
              <div className="mt-6 bg-gradient-to-br from-primary/15 to-primary/5 p-6 rounded-3xl border border-primary/20 space-y-3">
                <p className="text-xs font-bold text-primary uppercase">Continua com dúvidas?</p>
                <p className="text-xs text-muted-foreground leading-relaxed">Nossa equipe está aqui para ajudar! Entre em contato:</p>
                <a
                  href="mailto:revendasmart.suporte@gmail.com"
                  className="inline-flex items-center gap-2 bg-primary text-white font-black text-xs px-4 py-3 rounded-xl hover:bg-primary/90 transition-colors uppercase"
                  data-testid="button-support-email"
                >
                  <Mail className="w-4 h-4" />
                  Enviar E-mail
                </a>
              </div>
            </div>
          )}

          {activeTab === 'about_and_legal' && (
            <div className="space-y-6 animate-in fade-in slide-in-from-right-4 pb-20">
              {/* App Info Card */}
              <div className="bg-gradient-to-br from-primary/10 to-primary/5 p-6 rounded-3xl border border-primary/20 space-y-4">
                <div className="flex items-start gap-4">
                  <div className="w-16 h-16 bg-primary/20 rounded-2xl flex items-center justify-center flex-shrink-0">
                    <span className="text-3xl">📦</span>
                  </div>
                  <div className="flex-1">
                    <h2 className="text-lg font-black text-primary mb-1">Revenda Smart</h2>
                    <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-1">Versão {APP_VERSION}</p>
                    <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-2" data-testid="app-build-id">Build {formatAppBuildId(APP_BUILD_ID)}</p>
                    <p className="text-xs text-muted-foreground leading-relaxed">Gerenciamento inteligente de estoque e catálogo digital para revendedores de cosméticos e perfumes.</p>
                  </div>
                </div>
              </div>

              {/* Institutional Text */}
              <div className="bg-secondary/40 p-5 rounded-2xl space-y-3">
                <h4 className="text-[10px] font-black text-muted-foreground uppercase tracking-widest">Sobre Revenda Smart</h4>
                <div className="space-y-2 text-[11px] leading-relaxed text-muted-foreground/90">
                  <p>
                    Revenda Smart é uma plataforma desenvolvida para simplificar a vida de quem vende. Oferecemos ferramentas modernas para gerenciar estoque, catálogo digital, vendas e relacionamento com clientes.
                  </p>
                  <p>
                    Nosso compromisso é com a segurança dos seus dados, privacidade e transparência em como usamos as informações. Todos os dados são protegidos por padrões de segurança da indústria.
                  </p>
                </div>
              </div>

              {/* Legal Documents & Privacy */}
              <div className="space-y-3">
                <h3 className="text-[10px] font-black text-muted-foreground uppercase tracking-widest px-1">Documentos Legais</h3>

                {/* Privacy Policy */}
                <a
                  href={buildPublicAppUrl("/privacy-policy")}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full flex items-center justify-between bg-white border border-border/60 p-4 rounded-2xl shadow-sm hover:bg-primary/5 transition-colors"
                  data-testid="link-privacy-policy"
                >
                  <div className="flex items-center gap-3">
                    <Scale className="w-4 h-4 text-primary" />
                    <div className="text-left">
                      <p className="text-xs font-black uppercase tracking-wide">Política de Privacidade</p>
                      <p className="text-[9px] text-muted-foreground">Proteção e uso de seus dados</p>
                    </div>
                  </div>
                  <ExternalLink className="w-4 h-4 text-muted-foreground" />
                </a>

                {/* Terms of Service */}
                <a
                  href={buildPublicAppUrl("/terms-of-service")}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full flex items-center justify-between bg-white border border-border/60 p-4 rounded-2xl shadow-sm hover:bg-primary/5 transition-colors"
                  data-testid="link-terms-of-service"
                >
                  <div className="flex items-center gap-3">
                    <Scale className="w-4 h-4 text-primary" />
                    <div className="text-left">
                      <p className="text-xs font-black uppercase tracking-wide">Termos de Serviço</p>
                      <p className="text-[9px] text-muted-foreground">Direitos e condições de uso</p>
                    </div>
                  </div>
                  <ExternalLink className="w-4 h-4 text-muted-foreground" />
                </a>
              </div>

              {/* Compliance Notes */}
              <div className="space-y-3">
                <h3 className="text-[10px] font-black text-muted-foreground uppercase tracking-widest px-1">Conformidade Legal</h3>
                <div className="bg-white border border-border/60 p-4 rounded-2xl space-y-2">
                  <p className="text-xs font-bold text-primary">LGPD (Brasil)</p>
                  <p className="text-[9px] text-muted-foreground">Você tem direito a acessar, corrigir, deletar e portar seus dados pessoais. Contate revendasmart.suporte@gmail.com para solicitar qualquer desses direitos.</p>
                </div>
                <div className="bg-white border border-border/60 p-4 rounded-2xl space-y-2">
                  <p className="text-xs font-bold text-primary">Contato</p>
                  <p className="text-[9px] text-muted-foreground">E-mail: <span className="font-mono">revendasmart.suporte@gmail.com</span></p>
                  <p className="text-[9px] text-muted-foreground mt-2">Para qualquer questão sobre privacidade, segurança ou conformidade legal, entre em contato conosco.</p>
                </div>
              </div>

              {/* Support & Contact */}
              <div className="space-y-3">
                <h3 className="text-[10px] font-black text-muted-foreground uppercase tracking-widest px-1">Suporte</h3>

                <a
                  href="mailto:revendasmart.suporte@gmail.com"
                  className="w-full flex items-center justify-between bg-white border border-border/60 p-4 rounded-2xl shadow-sm hover:bg-primary/5 transition-colors"
                  data-testid="link-support-email"
                >
                  <div className="flex items-center gap-3">
                    <Mail className="w-4 h-4 text-primary" />
                    <div className="text-left">
                      <p className="text-xs font-black uppercase tracking-wide">E-mail de Suporte</p>
                      <p className="text-[9px] text-muted-foreground">revendasmart.suporte@gmail.com</p>
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground" />
                </a>
              </div>
            </div>
          )}
        </div>

        {(activeTab === 'pix' || activeTab === 'catalog' || activeTab === 'preferences') && (
          <div className="fixed bottom-[calc(6rem+env(safe-area-inset-bottom))] left-0 right-0 p-4 max-w-md mx-auto z-40">
            <SaveChangesButton onClick={handleSave} disabled={!hasPendingChanges || isSaving} isSaving={isSaving} testId="button-save-floating" floating />
          </div>
        )}
      </div>
    </Layout>
  );
}
