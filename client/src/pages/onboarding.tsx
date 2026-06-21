import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { getFirebaseAuth, logError } from "@/lib/firebase";
import { onAuthStateChanged } from "firebase/auth";
import { getApiUrl } from "@/lib/api-config";
import { useFeatureEnabled } from "@/lib/remote-config-context";
import { NICHO_CONFIG, NICHO_IDS } from "@/lib/nicho-config";
import { patchUserSettingsOptimistic, invalidateUserSettings } from "@/hooks/useUserSettings";
import { usePlanData } from "@/hooks/usePlanData";
import { 
  Store, Shirt, Watch, Cookie, Box, Check, Sparkles, Package, Users, ShoppingCart, ArrowRight, ArrowLeft, Lightbulb
} from "lucide-react";

const NICHO_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  Store, Shirt, Watch, Cookie, Box
};

export default function Onboarding() {
  const [, setLocation] = useLocation();
  const [step, setStep] = useState(0);
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  const [uid, setUid] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const enableOnboardingV2 = useFeatureEnabled("onboarding_v2_enabled");

  useEffect(() => {
    const auth = getFirebaseAuth();
    if (!auth) { setUid(null); return; }
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUid(user?.uid || null);
    });
    return () => unsubscribe();
  }, []);
  
  const baseSteps = [
    {
      title: "Bem-vindo ao RevendaSmart",
      text: "Este aplicativo ajuda você a organizar produtos, clientes e vendas. Vamos começar em 3 passos simples.",
      icon: Sparkles,
      color: "bg-primary/10 text-primary"
    },
    {
      title: "Adicione seu primeiro produto",
      text: "Cadastre produtos com foto, preço e estoque. Você consegue em menos de 1 minuto!",
      icon: Package,
      color: "bg-blue-100 text-blue-600"
    },
    {
      title: "Cadastre seus clientes",
      text: "Organize seus clientes e histórico de compras. Mantenha tudo organizado.",
      icon: Users,
      color: "bg-green-100 text-green-600"
    },
    {
      title: "Registre vendas",
      text: "Controle vendas, pagamentos e cobranças. Acompanhe suas vendas em tempo real!",
      icon: ShoppingCart,
      color: "bg-orange-100 text-orange-600"
    }
  ];

  const steps = enableOnboardingV2 ? [
    ...baseSteps.slice(0, 3),
    {
      title: "Dicas de Venda Inteligentes",
      text: "Receba sugestões automáticas sobre seus produtos, estoque e clientes. Cresça mais rápido!",
      icon: Lightbulb,
      color: "bg-yellow-100 text-yellow-600"
    },
    baseSteps[3]
  ] : baseSteps;

  const toggleType = (id: string) => {
    setSelectedTypes(prev => 
      prev.includes(id) ? prev.filter(t => t !== id) : [...prev, id]
    );
  };

  const handleFinish = async (types: string[]) => {
    if (!uid) {
      setError("Erro: Usuário não autenticado. Faça login novamente.");
      return;
    }
    if (types.length === 0) {
      setError("Selecione pelo menos um tipo de negócio.");
      return;
    }

    setIsSaving(true);
    setError("");

    try {
      const auth = getFirebaseAuth();
      if (!auth || !auth.currentUser) throw new Error("Not authenticated");
      const token = await auth.currentUser.getIdToken();
      if (!token) throw new Error("Failed to obtain authentication token");

      const settingsUrl = getApiUrl(`/api/user/settings/${uid}`);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);

      try {
        const response = await fetch(settingsUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`
          },
          body: JSON.stringify({
            onboarding_completed: true,
            businessType: types[0],
            businessTypes: types,
            completedAt: new Date().toISOString()
          }),
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          let errorDetails = `HTTP ${response.status}`;
          try {
            const errorBody = await response.json();
            if (errorBody.error) errorDetails = errorBody.error;
        } catch (e) {
  console.error(e);
}
          throw new Error(errorDetails);
        }

        const responseData = await response.json();
        console.log("[onboarding] Success:", { onboarding_completed: responseData.onboarding_completed });

        // CRITICAL: Patch settings in ALL hook instances BEFORE navigating.
        // App.tsx uses useUserSettings() independently — it will NOT refetch on its own.
        // Without this patch, the guard sees onboarding_completed=false and redirects back.
        patchUserSettingsOptimistic({
          onboarding_completed: true,
          businessType: types[0],
          businessTypes: types,
        });

        // Also trigger a background refetch to confirm fresh data from Firestore
        invalidateUserSettings();

        // Track onboarding completion for referral validation
        const urlParams = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
        const refCode = urlParams.get('ref');
        const refUID = sessionStorage.getItem('referrer_uid')
          || (typeof responseData.settings?.referral_source === 'string'
            ? responseData.settings.referral_source
            : null);
        const currentUser = auth.currentUser;

        if (refUID && uid && currentUser) {
          void (async () => {
            try {
              const referralToken = await currentUser.getIdToken();
              const referralHeaders = {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${referralToken}`,
              };

              const trackResponse = await fetch(getApiUrl('/api/referral/track-event'), {
                method: 'POST',
                headers: referralHeaders,
                body: JSON.stringify({
                  referrerUID: refUID,
                  event: 'onboarding_completed',
                  refCode: refCode || null,
                }),
              });

              if (trackResponse.status === 401 || trackResponse.status === 403) return;
              if (!trackResponse.ok && trackResponse.status !== 409) {
                console.warn('[onboarding] Não foi possível registrar a indicação.');
                return;
              }

              const validateResponse = await fetch(getApiUrl('/api/referral/validate-referral'), {
                method: 'POST',
                headers: referralHeaders,
                body: JSON.stringify({ referrerUID: refUID }),
              });

              if (validateResponse.status === 401 || validateResponse.status === 403) return;
              if (!validateResponse.ok && validateResponse.status !== 409) {
                console.warn('[onboarding] Não foi possível validar a indicação.');
              }
            } catch {
              console.warn('[onboarding] A indicação não pôde ser sincronizada agora.');
            }
          })();
        }

        console.log("[onboarding] Settings patched optimistically — navigating to dashboard");
        setLocation("/?action=first_product");
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro desconhecido";
      let friendlyError = "Erro ao completar onboarding. Tente novamente.";
      if (msg.includes("HTTP")) friendlyError = "Falha na conexão com servidor. Verifique sua internet e tente novamente.";
      else if (msg.includes("Not authenticated")) friendlyError = "Sessão expirou. Faça login novamente.";
      else if (msg.includes("AbortError") || msg.includes("abort")) friendlyError = "Conexão demorou muito. Verifique sua internet e tente novamente.";
      setError(friendlyError);
      logError("onboarding_completion_failed", msg, { userId: uid ?? undefined });
    } finally {
      setIsSaving(false);
    }
  };

  const nextStep = () => {
    if (step < steps.length - 1) {
      setStep(step + 1);
    } else {
      setStep(steps.length);
    }
  };

  const prevStep = () => {
    if (step > 0) setStep(step - 1);
  };

  const current = steps[step] || steps[0];

  // Business type selection screen
  if (step === steps.length) {
    return (
      <div className="min-h-screen bg-background p-6 flex flex-col max-w-md mx-auto">
        <div className="flex-1 flex flex-col justify-center space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
          <div className="space-y-2 text-center">
            <div className="w-16 h-16 bg-primary/10 rounded-3xl flex items-center justify-center mx-auto mb-4">
              <Store className="w-8 h-8 text-primary" />
            </div>
            <h1 className="text-2xl font-black text-foreground tracking-tight">O que você vende?</h1>
            <p className="text-sm text-muted-foreground px-4">
              Selecione um ou mais nichos. Isso personaliza categorias, campos e filtros do seu catálogo.
            </p>
          </div>

          <div className="space-y-3">
            {NICHO_IDS.map((nichoId) => {
              const nicho = NICHO_CONFIG[nichoId];
              const Icon = NICHO_ICONS[nicho.iconName];
              const isSelected = selectedTypes.includes(nichoId);
              return (
                <button
                  key={nichoId}
                  data-testid={`nicho-option-${nichoId}`}
                  onClick={() => toggleType(nichoId)}
                  className={`w-full flex items-center gap-4 p-4 rounded-[2rem] border-2 transition-all text-left ${
                    isSelected
                      ? 'border-primary bg-primary/5 shadow-md scale-[1.01]'
                      : 'border-border bg-white hover:border-primary/30'
                  }`}
                >
                  <div className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-colors flex-shrink-0 ${
                    isSelected ? 'bg-primary text-white' : 'bg-secondary text-muted-foreground'
                  }`}>
                    <Icon className="w-6 h-6" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-black uppercase tracking-wider truncate">{nicho.label}</p>
                    <p className="text-[10px] text-muted-foreground font-medium truncate">{nicho.desc}</p>
                  </div>
                  <div className={`w-6 h-6 rounded-lg border-2 flex items-center justify-center flex-shrink-0 transition-all ${
                    isSelected ? 'border-primary bg-primary text-white' : 'border-border'
                  }`}>
                    {isSelected && <Check className="w-4 h-4" />}
                  </div>
                </button>
              );
            })}
          </div>

          {selectedTypes.length > 0 && (
            <p className="text-center text-xs text-primary font-bold animate-in fade-in">
              {selectedTypes.length === 1
                ? `✓ ${selectedTypes[0]} selecionado`
                : `✓ ${selectedTypes.length} tipos selecionados`}
            </p>
          )}

          {error && (
            <p className="text-center text-xs text-destructive font-medium px-4">{error}</p>
          )}
        </div>

        <div className="pt-6 pb-4 space-y-3">
          <button
            data-testid="button-concluir-onboarding"
            disabled={selectedTypes.length === 0 || isSaving}
            onClick={() => handleFinish(selectedTypes)}
            className="w-full bg-primary text-white font-black py-5 rounded-[2.5rem] shadow-xl shadow-primary/20 flex items-center justify-center gap-2 uppercase tracking-[0.2em] text-xs active:scale-95 transition-all disabled:opacity-50 disabled:grayscale disabled:scale-100"
          >
            {isSaving ? (
              <>
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Salvando...
              </>
            ) : (
              "Concluir Onboarding"
            )}
          </button>
          <button
            onClick={() => setStep(steps.length - 1)}
            className="w-full text-muted-foreground font-black py-2 text-[10px] uppercase tracking-widest active:opacity-60 transition-all flex items-center justify-center gap-2"
          >
            <ArrowLeft className="w-3 h-3" /> Voltar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-6 flex flex-col max-w-md mx-auto">
      <div className="flex-1 flex flex-col justify-center items-center text-center space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
        <div className={`w-24 h-24 ${current.color} rounded-[2.5rem] flex items-center justify-center mb-2 shadow-inner`}>
          <current.icon className="w-12 h-12" />
        </div>
        
        <div className="space-y-4">
          <h1 className="text-3xl font-black text-foreground tracking-tight leading-tight">{current.title}</h1>
          <p className="text-base text-muted-foreground px-6 leading-relaxed">{current.text}</p>
        </div>

        <div className="flex gap-2">
          {steps.map((_, i) => (
            <div key={i} className={`h-1.5 rounded-full transition-all duration-300 ${i === step ? 'w-8 bg-primary' : 'w-2 bg-primary/20'}`} />
          ))}
        </div>
      </div>

      <div className="pt-12 pb-6 space-y-4">
        <button
          onClick={nextStep}
          className="w-full bg-primary text-white font-black py-5 rounded-[2.5rem] shadow-xl shadow-primary/20 flex items-center justify-center gap-2 uppercase tracking-[0.2em] text-xs active:scale-95 transition-all"
        >
          Próximo <ArrowRight className="w-4 h-4" />
        </button>
        
        <div className="flex justify-between items-center px-2">
          <button
            onClick={prevStep}
            className={`text-muted-foreground font-black text-[10px] uppercase tracking-widest active:opacity-60 transition-all ${step === 0 ? 'invisible' : ''}`}
          >
            Voltar
          </button>
          <button
            onClick={() => handleFinish(['Geral'])}
            className="text-muted-foreground font-black text-[10px] uppercase tracking-widest active:opacity-60 transition-all"
          >
            Pular Tutorial
          </button>
        </div>
      </div>
    </div>
  );
}
