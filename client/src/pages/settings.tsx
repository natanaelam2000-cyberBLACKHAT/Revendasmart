import { useState, useMemo, useEffect, useRef } from "react";
import { Layout } from "@/components/layout";
import { 
  AppSettings, 
  logout, APP_VERSION
} from "@/lib/mock-data";
import { getCurrentFirebaseUser, getFirebaseIdToken, getFirebaseAuth, measureOperation, logTelemetryEvent } from "@/lib/firebase";
import { useLocation } from "wouter";
import { getApiUrl } from "@/lib/api-config";
import { QRCodeSVG } from "qrcode.react";
import { useUserSettings } from "@/hooks/useUserSettings";
import { 
  Store, Palette, CreditCard, MessageSquare, Package, BookOpen, 
  Download, Save, ChevronRight, Bell, Upload, Trash2, ShieldAlert, RefreshCw, Activity, CheckCircle, XCircle, Users, Share2, ExternalLink, FileSpreadsheet, QrCode, Copy, Info, Mail, Globe, Check, Scale, HelpCircle, ChevronDown
} from "lucide-react";
import { NICHO_IDS, getNichoConfig, toBusinessTypesArray } from "@/lib/nicho-config";

// MOVED OUTSIDE: InputField must be defined OUTSIDE Settings component
// to prevent recreation on every render (which was causing focus loss)
const InputField = ({ label, value, onChange, placeholder = "", type = "text", disabled = false }: any) => (
  <div className="space-y-1.5">
    <label className="text-[10px] font-black text-muted-foreground uppercase px-1 tracking-widest">{label}</label>
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

export default function Settings() {
  // Get settings from Firestore via hook
  const { settings: firestoreSettings, loading: settingsLoading, error: settingsError } = useUserSettings();
  
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
      return params.get('tab') || 'profile';
    }
    return 'profile';
  });
  
  const [, setLocation] = useLocation();
  const [generatedUrl, setGeneratedUrl] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");
  const [openHelpIndex, setOpenHelpIndex] = useState<number | null>(null);

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
    } catch (e) { return null; }
  }, []);

  // Resolve userId (use firebaseUid)
  const userId = firebaseUid;

  const handleSave = async () => {
    if (!firebaseUid) {
      setSaveMessage("Erro: usuário não autenticado.");
      return;
    }

    setIsSaving(true);
    setSaveMessage("");

    try {
      const response = await measureOperation("catalog_settings_save", async () => {
        const token = await getFirebaseIdToken();
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (token) headers["Authorization"] = `Bearer ${token}`;

        return await fetch(getApiUrl(`/api/user/settings/${firebaseUid}`), {
          method: "POST",
          headers,
          body: JSON.stringify(formSettings)
        });
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const result = await response.json();
      if (result.success) {
        setSaveMessage("Configurações salvas com sucesso! ✨");
        // Update form with returned settings to ensure sync
        if (result.settings) {
          setFormSettings(result.settings);
        }
        setTimeout(() => setSaveMessage(""), 3000);
      } else {
        throw new Error(result.error || "Erro ao salvar");
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Erro desconhecido";
      setSaveMessage(`Erro ao salvar: ${errorMsg}`);
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
      const slug = formSettings?.catalogSlug || storeName
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "");
      
      const origin = (typeof window !== "undefined" && window.location && window.location.origin) ? window.location.origin : "";
      setGeneratedUrl(origin ? `${origin}/u/${slug}` : `/u/${slug}`);
    } catch (e) {
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


  return (
    <Layout title="Ajustes">
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

        <div className="flex overflow-x-auto p-4 gap-2 bg-white border-b border-border/50 hide-scrollbar">
          {[
            { id: 'profile', icon: Store, label: 'Perfil' },
            { id: 'catalog_config', icon: BookOpen, label: 'Link' },
            { id: 'notifications', icon: Bell, label: 'Avisos' },
            { id: 'growth', icon: Share2, label: 'Crescimento' },
            { id: 'backup', icon: Download, label: 'Backup' },
            { id: 'export_csv', icon: FileSpreadsheet, label: 'Planilhas' },
            { id: 'help', icon: HelpCircle, label: 'Ajuda' },
            { id: 'about_and_legal', icon: Info, label: 'Sobre e Legal' },
          ].map(tab => (
            <button 
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-full whitespace-nowrap text-[10px] font-black uppercase transition-all ${activeTab === tab.id ? 'bg-primary text-white shadow-md' : 'bg-secondary text-muted-foreground'}`}
            >
              <tab.icon className="w-3.5 h-3.5" /> {tab.label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-6 pb-32 space-y-6">
          {activeTab === 'profile' && (
            <div className="space-y-4 animate-in fade-in slide-in-from-right-4">
              <div className="space-y-2">
                <label className="text-[10px] font-black text-muted-foreground uppercase px-1 tracking-widest">
                  Tipos de Negócio
                  {(() => {
                    const types = toBusinessTypesArray(formSettings?.businessType, formSettings?.businessTypes);
                    return types.length > 1 ? <span className="ml-2 text-primary font-black">({types.length})</span> : null;
                  })()}
                </label>
                <p className="text-[10px] text-muted-foreground px-1">Selecione um ou mais nichos</p>
                <div className="space-y-2">
                  {NICHO_IDS.map(nichoId => {
                    const cfg = getNichoConfig(nichoId);
                    const currentTypes = toBusinessTypesArray(formSettings?.businessType, formSettings?.businessTypes);
                    const isSelected = currentTypes.includes(nichoId);
                    return (
                      <button
                        key={nichoId}
                        type="button"
                        data-testid={`settings-nicho-${nichoId}`}
                        onClick={() => {
                          const current = toBusinessTypesArray(formSettings?.businessType, formSettings?.businessTypes);
                          const next = current.includes(nichoId)
                            ? current.filter(t => t !== nichoId)
                            : [...current, nichoId];
                          const primary = next[0] || 'Geral';
                          setFormSettings({
                            ...formSettings,
                            businessType: primary,
                            businessTypes: next.length > 0 ? next : ['Geral']
                          } as any);
                        }}
                        className={`w-full flex items-center gap-3 p-3 rounded-2xl border-2 transition-all text-left ${
                          isSelected
                            ? 'border-primary bg-primary/5'
                            : 'border-border bg-secondary/20 hover:border-primary/30'
                        }`}
                      >
                        <div className={`w-6 h-6 rounded-lg border-2 flex items-center justify-center flex-shrink-0 transition-all ${
                          isSelected ? 'border-primary bg-primary text-white' : 'border-border'
                        }`}>
                          {isSelected && <Check className="w-3.5 h-3.5" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-black uppercase tracking-wide">{cfg.label}</p>
                          <p className="text-[9px] text-muted-foreground">{cfg.desc}</p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
              <InputField label="Nome da Loja" value={formSettings?.storeName} onChange={(v: string) => setFormSettings({...formSettings, storeName: v})} />
              <InputField label="WhatsApp" value={formSettings?.whatsapp} onChange={(v: string) => setFormSettings({...formSettings, whatsapp: v})} />
              
              {/* Account Section (integrated into Profile) */}
              <div className="pt-4 border-t border-border/30 space-y-4">
                <h3 className="text-[11px] font-black text-muted-foreground uppercase tracking-widest">Conta</h3>
                <InputField label="E-mail" value={currentUserEmail || ""} disabled={true} />

                {/* Mercado Pago connection */}
                <button
                  data-testid="button-go-to-mp-settings"
                  onClick={() => setLocation("/settings/mercadopago")}
                  className="w-full flex items-center justify-between bg-white border border-border/60 py-4 px-5 rounded-2xl shadow-sm"
                >
                  <div className="flex items-center gap-3">
                    <CreditCard className="w-4 h-4 text-[#009EE3]" />
                    <div className="text-left">
                      <p className="text-xs font-black uppercase tracking-wide">Mercado Pago</p>
                      <p className="text-[10px] text-muted-foreground">Conecte sua conta para receber pagamentos</p>
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground" />
                </button>

                <button onClick={handleLogout} className="w-full bg-destructive/10 text-destructive font-black py-4 rounded-2xl uppercase text-xs">
                  Sair da Conta
                </button>
              </div>
            </div>
          )}

          {activeTab === 'catalog_config' && (
            <div className="space-y-6 animate-in fade-in slide-in-from-right-4">
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

          {activeTab === 'notifications' && (
            <div className="space-y-6 animate-in fade-in slide-in-from-right-4">
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
                  type="number"
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
                try {
                  logTelemetryEvent("growth_tab_viewed", { origin: "settings_nav" }).catch(() => {});
                } catch (e) {}
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
                    <h3 className="text-xs font-black uppercase tracking-widest text-foreground mb-4">Suas Indicações Convertidas</h3>
                    
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
                              <p className="text-[9px] text-muted-foreground mt-0.5">Amigas que completaram o cadastro</p>
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
                        const method = navigator.share ? "native_share" : "direct_share";
                        logTelemetryEvent("referral_share_initiated", { method, origin: "settings_growth" }).catch(() => {});
                        
                        if (navigator.share) {
                          navigator.share({ title: "RevendaSmart", text })
                            .then(() => {
                              logTelemetryEvent("referral_share_success", { method: "native_share" }).catch(() => {});
                              setSaveMessage("Compartilhado com sucesso!");
                              setTimeout(() => setSaveMessage(""), 3000);
                            })
                            .catch((err) => {
                              logTelemetryEvent("referral_share_failed", { method: "native_share", reason: err?.message || "unknown" }).catch(() => {});
                            });
                        } else {
                          navigator.clipboard.writeText(text);
                          logTelemetryEvent("referral_share_success", { method: "direct_share" }).catch(() => {});
                          setSaveMessage("Texto copiado para compartilhar!");
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
                      setSaveMessage("Backup exportado com sucesso! ✨");
                      setTimeout(() => setSaveMessage(""), 3000);
                    } catch (e) { setSaveMessage("Erro ao exportar."); }
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
                      if (!file) return;
                      setSaveMessage("⚠️ Isso substituirá seus dados atuais!");
                      const confirmed = confirm('Isso substituirá seus dados atuais. Continuar?');
                      if (!confirmed) {
                        setSaveMessage("");
                        return;
                      }
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
                          setSaveMessage('Backup restaurado com sucesso! ✨');
                          setTimeout(() => window.location.reload(), 1500);
                        } catch (err) { 
                          setSaveMessage('Erro ao importar: arquivo inválido.');
                        }
                      };
                      reader.readAsText(file);
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

          {activeTab === 'help' && (
            <div className="space-y-4 animate-in fade-in slide-in-from-right-4 pb-20">
              {/* Header Info */}
              <div className="bg-gradient-to-br from-primary/10 to-primary/5 p-6 rounded-3xl border border-primary/20 space-y-3">
                <h2 className="text-lg font-black text-primary">Central de Ajuda</h2>
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

        <div className="fixed bottom-24 left-0 right-0 p-4 max-w-md mx-auto z-40">
          <button onClick={handleSave} className="w-full bg-primary text-white font-black py-4 rounded-[2rem] shadow-xl flex items-center justify-center gap-2 uppercase text-xs">
            <Save className="w-4 h-4" /> Salvar Alterações
          </button>
        </div>
      </div>
    </Layout>
  );
}
