import { useState, useMemo, useEffect, useRef } from "react";
import { Layout } from "@/components/layout";
import { ConfirmActionDialog } from "@/components/ConfirmActionDialog";
import { notifyError, notifySuccess, notifyWarning } from "@/lib/notify";
import { PageSkeleton } from "@/components/PageSkeleton";
import {
  AppSettings,
  logout, APP_VERSION, getCurrentUserId, getStored, STORAGE_KEYS
} from "@/lib/mock-data";
import { getCurrentFirebaseUser, getFirebaseIdToken, getFirebaseAuth, measureOperation, logTelemetryEvent } from "@/lib/firebase";
import { useLocation } from "wouter";
import { getApiUrl } from "@/lib/api-config";
import { QRCodeSVG } from "qrcode.react";
import { getStorage, ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { useUserSettings } from "@/providers/UserSettingsProvider";
import {
  Store, CreditCard,
  Download, Save, ChevronRight, Bell, Upload, RefreshCw, Users, Share2, ExternalLink, FileSpreadsheet, QrCode, Copy, Mail, Scale, HelpCircle, ChevronDown, User, KeyRound, LogOut, ArrowLeft, Receipt
} from "lucide-react";

// MOVED OUTSIDE: InputField must be defined OUTSIDE Settings component
// to prevent recreation on every render (which was causing focus loss)
const InputField = ({ label, value, onChange, placeholder = "", type = "text", disabled = false }: any) => (
  <div className="space-y-1.5">
    <label className="text-xs font-semibold text-muted-foreground px-1">{label}</label>
    <input
      type={type}
      disabled={disabled}
      className={`w-full bg-secondary/50 border-none rounded-2xl p-4 text-sm focus:ring-2 focus:ring-primary/20 outline-none transition-all ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
      value={value || ""}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
    />
  </div>
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

  // Local state for form edits (synced with Firestore on save)
  // Initialize with default empty object to avoid undefined
  const [formSettings, setFormSettings] = useState<AppSettings>(() => firestoreSettings || {});

  // Track if we've already initialized formSettings from Firestore
  // This ensures we only sync ONCE on mount, not on every Firestore update
  const hasInitialized = useRef(false);

  // Sync Firestore settings to form ONLY on initial load
  // This prevents re-renders from interrupting user input
  useEffect(() => {
    // Only initialize once, when data finishes loading for the first time
    if (!settingsLoading && firestoreSettings && !hasInitialized.current) {
      setFormSettings(firestoreSettings);
      hasInitialized.current = true;
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
  const [, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");
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

  // Get Firebase Auth UID (real)
  const firebaseUid = useMemo(() => {
    const auth = getFirebaseAuth();
    return auth?.currentUser?.uid || null;
  }, []);

  // Resolve current user email: Firebase Auth (real users) first
  const currentUserEmail = useMemo(() => {
    try {
      const firebaseUser = getCurrentFirebaseUser();
      if (firebaseUser?.email) return firebaseUser.email;
      return null;
    } catch { return null; }
  }, []);

  const handleSave = async () => {
    if (!firebaseUid) {
      setSaveMessage("Erro: usuário não autenticado.");
      notifyError("Sessão expirada. Faça login novamente.");
      return;
    }

    setIsSaving(true);
    setSaveMessage("");

    try {
      const response = await measureOperation("catalog_settings_save", async () => {
        const token = await getFirebaseIdToken();
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (token) headers["Authorization"] = `Bearer ${token}`;

        const catalogSlug = normalizeCatalogSlug(formSettings?.catalogSlug || formSettings?.catalog_slug || formSettings?.storeName || "minha-loja");
        const normalizedSettings = { ...formSettings, catalogSlug, catalog_slug: catalogSlug };
        setFormSettings(normalizedSettings);
        return await fetch(getApiUrl(`/api/user/settings/${firebaseUid}`), {
          method: "POST",
          headers,
          body: JSON.stringify(normalizedSettings)
        });
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const result = await response.json();
      if (result.success) {
        setSaveMessage("Configurações salvas.");
        notifySuccess("Configurações salvas.");
        // Update form with returned settings to ensure sync
        if (result.settings) {
          setFormSettings(result.settings);
        }
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
    await logout();
    setLocation("/login");
  };

  const handleGenerateLink = () => {
    try {
      const storeName = formSettings?.storeName || "minha-loja";
      const slug = normalizeCatalogSlug(formSettings?.catalogSlug || formSettings?.catalog_slug || storeName);
      setFormSettings({ ...formSettings, catalogSlug: slug, catalog_slug: slug });
      const origin = (typeof window !== "undefined" && window.location && window.location.origin) ? window.location.origin : "";
      setGeneratedUrl(origin ? `${origin}/u/${slug}` : `/u/${slug}`);
    } catch {
      setSaveMessage("Erro ao gerar link.");
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
      const storageRef = ref(getStorage(), `users/${firebaseUid}/branding/store-logo.jpg`);
      await uploadBytes(storageRef, blob, { contentType: "image/jpeg" });
      const storeLogo = await getDownloadURL(storageRef);
      const nextSettings = { ...formSettings, storeLogo };
      const token = await getFirebaseIdToken();
      const response = await fetch(getApiUrl(`/api/user/settings/${firebaseUid}`), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(nextSettings),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setFormSettings(nextSettings);
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
  const accountMenu = [
    { title: "Minha Conta", subtitle: "Perfil e dados pessoais", icon: User, color: "bg-primary/10 text-primary", path: "/settings?tab=account" },
    { title: "Minha Loja", subtitle: "Nome, logo e informações", icon: Store, color: "bg-violet-100 text-violet-700", path: "/settings?tab=store" },
    { title: "Chave Pix", subtitle: "Recebimento dos pedidos", icon: KeyRound, color: "bg-green-100 text-green-700", path: "/settings?tab=pix" },
    { title: "Compartilhar Catálogo", subtitle: "Link e QR Code do catálogo", icon: Share2, color: "bg-blue-100 text-blue-700", path: "/settings?tab=catalog" },
    { title: "Clientes", subtitle: "Cadastro, busca e histórico de compras", icon: Users, color: "bg-cyan-100 text-cyan-700", path: "/clients" },
    { title: "Cobranças", subtitle: "Pendentes, vencidas e recebidas", icon: Receipt, color: "bg-emerald-100 text-emerald-700", path: "/billings" },
    { title: "Minha Assinatura", subtitle: "Plano e faturamento", icon: CreditCard, color: "bg-sky-100 text-sky-700", path: "/subscribe" },
    { title: "Preferências", subtitle: "Notificações e ajustes", icon: Bell, color: "bg-slate-100 text-slate-700", path: "/settings?tab=preferences" },
    { title: "Suporte", subtitle: "Ajuda, FAQ e contato", icon: HelpCircle, color: "bg-amber-100 text-amber-700", path: "/settings?tab=support" },
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
          <section className="bg-gradient-to-br from-primary to-primary/80 text-white rounded-[2rem] p-6 lg:p-8 shadow-xl shadow-primary/15 mb-6">
            <div className="flex items-center gap-4">
              <button type="button" onClick={() => logoInputRef.current?.click()} disabled={isUploadingLogo} className="relative w-14 h-14 rounded-2xl bg-white/15 border border-white/20 flex items-center justify-center font-black text-2xl overflow-hidden disabled:opacity-60" aria-label="Alterar logo da loja">
                {formSettings?.storeLogo ? <img src={formSettings.storeLogo} alt="Logo da loja" className="w-full h-full object-cover" loading="lazy" decoding="async" /> : "R"}
                <span className="absolute inset-x-0 bottom-0 bg-black/45 text-[8px] font-bold py-0.5">{isUploadingLogo ? "Enviando" : "Alterar"}</span>
              </button>
              <input ref={logoInputRef} type="file" accept="image/*" className="hidden" onChange={handleLogoChange} />
              <div><p className="text-sm font-medium text-white/75">RevendaSmart</p><h1 className="text-2xl lg:text-3xl font-semibold tracking-tight mt-1">Olá, {displayName}!</h1><p className="text-sm text-white/75 mt-1">Gerencie sua conta e sua loja.</p></div>
            </div>
          </section>
          <div className="bg-white rounded-[2rem] border border-border/60 shadow-sm overflow-hidden divide-y divide-border/50">
            {accountMenu.map(item => <button key={item.title} onClick={() => { const tab = new URL(item.path, window.location.origin).searchParams.get("tab"); if (tab) setActiveTab(tab); setLocation(item.path); }} className="w-full flex items-center gap-4 p-4 sm:p-5 text-left hover:bg-slate-50 active:bg-slate-100 transition-colors">
              <div className={`w-11 h-11 rounded-2xl flex items-center justify-center flex-shrink-0 ${item.color}`}><item.icon className="w-5 h-5" /></div>
              <div className="flex-1 min-w-0"><p className="text-sm sm:text-base font-bold">{item.title}</p><p className="text-xs text-muted-foreground mt-0.5">{item.subtitle}</p></div><ChevronRight className="w-5 h-5 text-muted-foreground/50" />
            </button>)}
            <button onClick={handleLogout} className="w-full flex items-center gap-4 p-4 sm:p-5 text-left hover:bg-red-50 transition-colors">
              <div className="w-11 h-11 rounded-2xl bg-red-100 text-red-600 flex items-center justify-center"><LogOut className="w-5 h-5" /></div><div className="flex-1"><p className="text-sm sm:text-base font-bold text-red-600">Sair</p><p className="text-xs text-red-500/70 mt-0.5">Encerrar sessão</p></div><ChevronRight className="w-5 h-5 text-red-300" />
            </button>
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
              <button data-testid="button-go-to-mp-settings" onClick={() => setLocation("/settings/mercadopago")} className="w-full flex items-center justify-between bg-white border border-border/60 py-4 px-5 rounded-2xl shadow-sm"><div className="flex items-center gap-3"><CreditCard className="w-5 h-5 text-[#009EE3]" /><div className="text-left"><p className="text-sm font-bold">Mercado Pago</p><p className="text-xs text-muted-foreground">Gerenciar conta de recebimento</p></div></div><ChevronRight className="w-5 h-5 text-muted-foreground" /></button>
            </div>
          )}
          {activeTab === 'store' && (
            <div className="space-y-5 animate-in fade-in slide-in-from-right-4">
              <div><p className="text-xs font-black text-violet-700 uppercase tracking-wider">Minha Loja</p><h2 className="text-2xl font-black mt-1">Nome e informações</h2><p className="text-sm text-muted-foreground mt-1">Dados exibidos para seus clientes no catálogo.</p></div>
              <div className="p-4 bg-violet-50 border border-violet-200 rounded-2xl">
                <p className="text-xs font-black text-violet-700 uppercase">Minha Loja</p>
                <p className="text-[10px] text-violet-600 mt-1">Identidade exibida no catálogo público.</p>
              </div>
              <InputField label="Nome da Loja" value={formSettings?.storeName} onChange={(v: string) => setFormSettings({...formSettings, storeName: v})} />
              <InputField label="WhatsApp" value={formSettings?.whatsapp} onChange={(v: string) => setFormSettings({...formSettings, whatsapp: v})} />
            </div>
          )}

          {activeTab === 'pix' && (
            <div className="space-y-5 animate-in fade-in slide-in-from-right-4">
              <div><p className="text-xs font-black text-green-700 uppercase tracking-wider">Chave Pix</p><h2 className="text-2xl font-black mt-1">Recebimento dos pedidos</h2><p className="text-sm text-muted-foreground mt-1">Configure a chave apresentada aos seus clientes.</p></div>
              <div className="p-4 bg-green-50 border border-green-200 rounded-2xl">
                <p className="text-xs font-black text-green-700 uppercase">Chave Pix</p>
                <p className="text-[10px] text-green-600 mt-1">Usada para receber pedidos feitos pelo catálogo.</p>
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
                    <h3 className="text-sm font-black uppercase tracking-widest text-primary">Programa de Indicação</h3>
                    <p className="text-[10px] text-muted-foreground">Convide amigas e ganhe recompensas</p>
                  </div>
                </div>
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
                          <p className="text-[10px] mt-2 opacity-70">Convide amigas usando seu link. Quando elas completarem o onboarding, aparecerão aqui.</p>
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

              {/* REWARD ELIGIBILITY SECTION - Base for future reward system */}
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
                      const eligibleConversions = firestoreSettings?.reward_eligible_conversions || 0;
                      const grantedCount = firestoreSettings?.reward_granted_count || 0;
                      const lastGrantedAt = firestoreSettings?.reward_last_granted_at;

                      const lastGrantedDate = lastGrantedAt ? (() => {
                        try {
                          const date = new Date(lastGrantedAt);
                          return date.toLocaleDateString('pt-BR', {
                            year: 'numeric',
                            month: 'long',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit'
                          });
                        } catch {
                          return lastGrantedAt;
                        }
                      })() : null;

                      return (eligibleConversions === 0 && grantedCount === 0) ? (
                        <div className="text-center py-6 text-amber-900/60">
                          <p className="text-[11px] font-medium">Nenhuma recompensa disponível ainda</p>
                          <p className="text-[9px] mt-2 opacity-75">Suas indicações convertidas gerarão recompensas que aparecerão aqui</p>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {/* Elegíveis Section */}
                          {eligibleConversions > 0 && (
                            <div className="p-4 bg-white/80 rounded-xl border border-amber-200/70 space-y-2">
                              <div className="flex items-center justify-between">
                                <span className="text-[10px] font-bold text-amber-900/70 uppercase tracking-wider">Disponíveis para Concessão</span>
                                <span className="text-2xl font-black text-amber-700" data-testid="value-reward-eligible">{eligibleConversions}</span>
                              </div>
                              <p className="text-[9px] text-amber-900/60">Baseado em suas indicações convertidas</p>
                            </div>
                          )}

                          {/* Concedidas Section */}
                          {grantedCount > 0 && (
                            <div className="p-4 bg-green-50/80 rounded-xl border border-green-200/70 space-y-2">
                              <div className="flex items-center justify-between">
                                <span className="text-[10px] font-bold text-green-900/70 uppercase tracking-wider">Recompensas Concedidas</span>
                                <span className="text-2xl font-black text-green-700" data-testid="value-reward-granted">{grantedCount}</span>
                              </div>
                              {lastGrantedDate && (
                                <p className="text-[9px] text-green-900/60">Última concessão: {lastGrantedDate}</p>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                </div>
              )}

              <div className="space-y-4">
                <div>
                  <label className="text-[10px] font-black text-muted-foreground uppercase px-1 tracking-widest mb-2 block">Seu Link de Referência</label>
                  <div className="flex gap-2">
                    <input
                      readOnly
                      value={`https://revendasmart.vercel.app?referral=${firebaseUid || 'seu-id'}`}
                      className="flex-1 bg-secondary/50 border-none rounded-2xl p-4 text-xs focus:ring-2 focus:ring-primary/20 outline-none"
                    />
                    <button
                      onClick={() => {
                        const link = `https://revendasmart.vercel.app?referral=${firebaseUid || 'seu-id'}`;
                        navigator.clipboard.writeText(link);
                        setSaveMessage("Link copiado!");
                        setTimeout(() => setSaveMessage(""), 3000);
                        logTelemetryEvent("referral_link_copied", { origin: "settings_growth" }).catch(() => {});
                      }}
                      className="bg-primary text-white font-black px-5 rounded-2xl flex items-center gap-2 uppercase text-[10px] active:scale-95 transition-all hover:shadow-md"
                      data-testid="button-copy-referral"
                    >
                      <Save className="w-4 h-4" /> Copiar
                    </button>
                  </div>
                </div>

                <div className="bg-white p-4 rounded-2xl border border-border">
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    <strong>Como funciona:</strong> Compartilhe seu link com amigas consultoras. Quando elas se registrarem usando seu link, você ganha recompensas exclusivas!
                  </p>
                </div>

                <div className="bg-white p-4 rounded-2xl border border-border space-y-2">
                  <p className="text-[10px] font-bold text-foreground uppercase tracking-wider">Compartilhe via:</p>
                  <div className="flex gap-2 flex-wrap">
                    <button
                      onClick={() => {
                        const link = `https://revendasmart.vercel.app?referral=${firebaseUid || 'seu-id'}`;
                        const text = `Confira o RevendaSmart! Gerenciador completo para revendedoras. ${link}`;
                        const canShare = typeof navigator.share === "function";
                        const method = canShare ? "native_share" : "direct_share";
                        logTelemetryEvent("referral_share_initiated", { method, origin: "settings_growth" }).catch(() => {});

                        if (canShare) {
                          navigator.share({ title: "RevendaSmart", text })
                            .then(() => {
                              logTelemetryEvent("referral_share_success", { method: "native_share" }).catch(() => {});
                              setSaveMessage("Compartilhado.");
                              notifySuccess("Catálogo compartilhado.");
                              setTimeout(() => setSaveMessage(""), 3000);
                            })
                            .catch((err) => {
                              notifyWarning("Operação cancelada.");
                              logTelemetryEvent("referral_share_failed", { method: "native_share", reason: err?.message || "unknown" }).catch(() => {});
                            });
                        } else {
                          navigator.clipboard.writeText(text);
                          logTelemetryEvent("referral_share_success", { method: "direct_share" }).catch(() => {});
                          setSaveMessage("Texto copiado.");
                          notifySuccess("Texto copiado.");
                          setTimeout(() => setSaveMessage(""), 3000);
                        }
                      }}
                      className="bg-secondary text-foreground font-bold px-4 py-2 rounded-xl text-[10px] uppercase active:scale-95 transition-all flex items-center gap-2"
                    >
                      <Share2 className="w-3 h-3" /> Compartilhar
                    </button>
                    <button
                      onClick={() => {
                        const link = `https://revendasmart.vercel.app?referral=${firebaseUid || 'seu-id'}`;
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
                    const csv = [headers, ...rows].map(r => r.join(",")).join("\n");
                    const blob = new Blob(["\ufeff" + csv], { type: 'text/csv;charset=utf-8;' });
                    const link = document.createElement("a");
                    link.href = URL.createObjectURL(blob);
                    link.download = `clientes-${new Date().toISOString().split('T')[0]}.csv`;
                    link.click();
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
                    const csv = [headers, ...rows].map(r => r.join(",")).join("\n");
                    const blob = new Blob(["\ufeff" + csv], { type: 'text/csv;charset=utf-8;' });
                    const link = document.createElement("a");
                    link.href = URL.createObjectURL(blob);
                    link.download = `vendas-${new Date().toISOString().split('T')[0]}.csv`;
                    link.click();
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
                    const csv = [headers, ...rows].map(r => r.join(",")).join("\n");
                    const blob = new Blob(["\ufeff" + csv], { type: 'text/csv;charset=utf-8;' });
                    const link = document.createElement("a");
                    link.href = URL.createObjectURL(blob);
                    link.download = `faturamento-${new Date().toISOString().split('T')[0]}.csv`;
                    link.click();
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
                <p className="text-xs text-muted-foreground leading-relaxed">Encontre respostas rápidas e entenda melhor como usar RevendaSmart para vender mais.</p>
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

Dica: Deixe o estoque > 0 para aparecer no catálogo público.`
                },
                {
                  title: '🏪 Como Usar o Catálogo',
                  content: `Seu catálogo é a vitrine dos seus produtos:

1. Vá para "Catálogo" para ver como seus clientes veem
2. Filtro de categoria e gênero (em Roupas) funcionam automaticamente
3. Compartilhe a URL pública do seu catálogo:
   - Link fica em Configurações → Link do Catálogo
   - Copie e compartilhe por WhatsApp, Instagram, etc

Apenas produtos com estoque > 0 aparecem!`
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
                    <h2 className="text-lg font-black text-primary mb-1">RevendaSmart</h2>
                    <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-2">Versão {APP_VERSION.replace('v', '')}</p>
                    <p className="text-xs text-muted-foreground leading-relaxed">Gerenciamento inteligente de estoque e catálogo digital para revendedores de cosméticos e perfumes.</p>
                  </div>
                </div>
              </div>

              {/* Institutional Text */}
              <div className="bg-secondary/40 p-5 rounded-2xl space-y-3">
                <h4 className="text-[10px] font-black text-muted-foreground uppercase tracking-widest">Sobre RevendaSmart</h4>
                <div className="space-y-2 text-[11px] leading-relaxed text-muted-foreground/90">
                  <p>
                    RevendaSmart é uma plataforma desenvolvida para simplificar a vida de revendedoras independentes de cosméticos e perfumes. Oferecemos ferramentas modernas para gerenciar estoque, catálogo digital, vendas e relacionamento com clientes.
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
                  href={getApiUrl("/api/legal/privacy-policy")}
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
                  href={getApiUrl("/api/legal/terms-of-service")}
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

        <div className="fixed bottom-[calc(6rem+env(safe-area-inset-bottom))] left-0 right-0 p-4 max-w-md mx-auto z-40">
          <button onClick={handleSave} className="w-full bg-primary text-white font-black py-4 rounded-[2rem] shadow-xl flex items-center justify-center gap-2 uppercase text-xs">
            <Save className="w-4 h-4" /> Salvar Alterações
          </button>
        </div>
      </div>
    </Layout>
  );
}
