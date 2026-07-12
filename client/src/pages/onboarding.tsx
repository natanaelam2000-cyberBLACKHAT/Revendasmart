import { useEffect, useMemo, useState, type ComponentType } from "react";
import { useLocation } from "wouter";
import { onAuthStateChanged } from "firebase/auth";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  BarChart3,
  BookOpen,
  Box,
  Check,
  CheckCircle2,
  Clock,
  Cookie,
  CreditCard,
  GripVertical,
  Lightbulb,
  Package,
  Palette,
  Plus,
  Shirt,
  ShoppingCart,
  Sparkles,
  Store,
  Trash2,
  Users,
  Watch,
} from "lucide-react";
import { getApiUrl } from "@/lib/api-config";
import {
  APP_THEMES,
  BUTTON_TONES,
  CARD_TONES,
  MOTION_LEVELS,
  RADIUS_LEVELS,
  SHADOW_LEVELS,
  applyAppTheme,
  buildAppThemeCustomization,
  resolveAppThemeId,
  type AppThemeCustomization,
  type AppThemeId,
} from "@/lib/app-themes";
import { getFirebaseAuth, logError } from "@/lib/firebase";
import { useFeatureEnabled } from "@/lib/remote-config-context";
import { NICHO_CONFIG, NICHO_IDS, getProductCategoriesForNicho, type NichoId } from "@/lib/nicho-config";
import { patchUserSettingsOptimistic, invalidateUserSettings } from "@/hooks/useUserSettings";
import { useUserSettings } from "@/providers/UserSettingsProvider";

const NICHO_ICONS: Record<string, ComponentType<{ className?: string }>> = {
  Store,
  Shirt,
  Watch,
  Cookie,
  Box,
};

type OnboardingStepId = "welcome" | "business" | "appearance" | "categories" | "product" | "tour" | "finish";

type OnboardingStep = {
  id: OnboardingStepId;
  eyebrow: string;
  title: string;
  text: string;
  icon: ComponentType<{ className?: string }>;
  color: string;
};

const TOUR_ITEMS = [
  { label: "Produtos", text: "Cadastre itens com foto, preço, categoria e estoque.", icon: Package },
  { label: "Clientes", text: "Organize contatos e veja histórico de compras.", icon: Users },
  { label: "Vendas", text: "Registre venda, desconto, entrada e baixa de estoque.", icon: ShoppingCart },
  { label: "Catálogo", text: "Compartilhe sua loja pública e receba pedidos.", icon: BookOpen },
  { label: "Cobranças", text: "Controle vencimentos, parciais e Mercado Pago.", icon: CreditCard },
  { label: "Relatórios", text: "Acompanhe lucro, ticket médio e produtos campeões.", icon: BarChart3 },
];

function getSafeBusinessTypes(types: string[], fallback?: string): NichoId[] {
  const validTypes = types.filter((type): type is NichoId => NICHO_IDS.includes(type as NichoId));
  if (validTypes.length > 0) return validTypes;
  if (fallback && NICHO_IDS.includes(fallback as NichoId)) return [fallback as NichoId];
  return ["Geral"];
}

function sanitizeCategories(categories: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of categories) {
    const category = raw.trim().replace(/\s+/g, " ");
    const key = category.toLocaleLowerCase("pt-BR");
    if (category.length >= 2 && !seen.has(key)) {
      seen.add(key);
      result.push(category);
    }
  }
  return result.length > 0 ? result : ["Outros"];
}

function createCategoryDrafts(settings: ReturnType<typeof useUserSettings>["settings"]): Record<string, string[]> {
  return Object.fromEntries(
    NICHO_IDS.map((nichoId) => [
      nichoId,
      getProductCategoriesForNicho(settings, nichoId),
    ])
  );
}

export default function Onboarding() {
  const [, setLocation] = useLocation();
  const { settings, loading: settingsLoading } = useUserSettings();
  const enableOnboardingV2 = useFeatureEnabled("onboarding_v2_enabled");

  const [uid, setUid] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const [selectedTypes, setSelectedTypes] = useState<NichoId[]>(["Geral"]);
  const [selectedTheme, setSelectedTheme] = useState<AppThemeId>(resolveAppThemeId(settings.appTheme));
  const [themeCustomization, setThemeCustomization] = useState<Required<AppThemeCustomization>>(() => buildAppThemeCustomization(settings.appTheme, settings.appThemeCustomization as AppThemeCustomization | undefined));
  const [categoryDrafts, setCategoryDrafts] = useState<Record<string, string[]>>(() => createCategoryDrafts(settings));
  const [activeCategoryNicho, setActiveCategoryNicho] = useState<NichoId>("Geral");
  const [newCategory, setNewCategory] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const [hydratedFromSettings, setHydratedFromSettings] = useState(false);

  const steps = useMemo<OnboardingStep[]>(() => {
    const baseSteps: OnboardingStep[] = [
      {
        id: "welcome",
        eyebrow: "Comece do jeito certo",
        title: "Sua loja pronta para vender mais",
        text: "Em poucos passos você define nicho, visual, categorias e aprende os fluxos principais sem travar o uso do app.",
        icon: Sparkles,
        color: "bg-primary/10 text-primary",
      },
      {
        id: "business",
        eyebrow: "Personalização real",
        title: "Escolha o nicho da sua revenda",
        text: "Essa escolha muda categorias, sugestões, campos e a sensação do app. Nada de lista genérica para todo mundo.",
        icon: Store,
        color: "bg-blue-100 text-blue-700",
      },
      {
        id: "appearance",
        eyebrow: "Sua marca no app",
        title: "Defina a aparência do Revenda Smart",
        text: "Escolha tema, cor principal, estilo dos cards, sombras, bordas e animações sem pesar a navegação.",
        icon: Palette,
        color: "bg-violet-100 text-violet-700",
      },
      {
        id: "categories",
        eyebrow: "Categorias inteligentes",
        title: "Organize categorias por nicho",
        text: "Mantenha o padrão, remova o que não usa, renomeie, reordene ou crie categorias próprias.",
        icon: GripVertical,
        color: "bg-emerald-100 text-emerald-700",
      },
      {
        id: "product",
        eyebrow: "Primeiro cadastro",
        title: "Cadastre seu primeiro produto com segurança",
        text: "O cadastro já abre com categorias e campos coerentes com o nicho escolhido.",
        icon: Package,
        color: "bg-orange-100 text-orange-700",
      },
      {
        id: "tour",
        eyebrow: "Tour rápido",
        title: "Conheça os principais módulos",
        text: "Produtos, clientes, vendas, catálogo, cobranças, marketing e relatórios em uma visão simples.",
        icon: Lightbulb,
        color: "bg-yellow-100 text-yellow-700",
      },
      {
        id: "finish",
        eyebrow: "Tudo pronto",
        title: "Seu painel está configurado",
        text: "Você pode continuar ajustando depois pelo checklist do Dashboard. Agora é hora de usar o app.",
        icon: CheckCircle2,
        color: "bg-green-100 text-green-700",
      },
    ];

    if (!enableOnboardingV2) return baseSteps;
    return baseSteps;
  }, [enableOnboardingV2]);

  const current = steps[step] || steps[0];
  const isLastStep = step >= steps.length - 1;
  const currentProgress = Math.round(((step + 1) / steps.length) * 100);

  useEffect(() => {
    const auth = getFirebaseAuth();
    if (!auth) {
      setUid(null);
      return;
    }
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUid(user?.uid || null);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (hydratedFromSettings || settingsLoading) return;
    const types = getSafeBusinessTypes(Array.isArray(settings.businessTypes) ? settings.businessTypes : [], settings.businessType);
    setSelectedTypes(types);
    setActiveCategoryNicho(types[0]);
    setSelectedTheme(resolveAppThemeId(settings.appTheme));
    setThemeCustomization(buildAppThemeCustomization(settings.appTheme, settings.appThemeCustomization as AppThemeCustomization | undefined));
    setCategoryDrafts(createCategoryDrafts(settings));
    if (typeof settings.onboarding_current_step === "number" && settings.onboarding_completed !== true) {
      setStep(Math.min(Math.max(settings.onboarding_current_step, 0), steps.length - 1));
    }
    setHydratedFromSettings(true);
  }, [hydratedFromSettings, settings, settingsLoading, steps.length]);

  useEffect(() => {
    applyAppTheme({ appTheme: selectedTheme, appThemeCustomization: themeCustomization });
  }, [selectedTheme, themeCustomization]);

  const toggleType = (id: NichoId) => {
    setSelectedTypes((prev) => {
      const next = prev.includes(id) ? prev.filter((type) => type !== id) : [...prev, id];
      const safeNext = next.length > 0 ? next : [id];
      if (!safeNext.includes(activeCategoryNicho)) setActiveCategoryNicho(safeNext[0]);
      return safeNext;
    });
  };

  const updateCategory = (nichoId: NichoId, index: number, value: string) => {
    setCategoryDrafts((currentDrafts) => {
      const nextList = [...(currentDrafts[nichoId] || NICHO_CONFIG[nichoId].categories)];
      nextList[index] = value;
      return { ...currentDrafts, [nichoId]: nextList };
    });
  };

  const removeCategory = (nichoId: NichoId, index: number) => {
    setCategoryDrafts((currentDrafts) => {
      const list = currentDrafts[nichoId] || NICHO_CONFIG[nichoId].categories;
      const nextList = list.filter((_, itemIndex) => itemIndex !== index);
      return { ...currentDrafts, [nichoId]: sanitizeCategories(nextList) };
    });
  };

  const moveCategory = (nichoId: NichoId, index: number, direction: -1 | 1) => {
    setCategoryDrafts((currentDrafts) => {
      const list = [...(currentDrafts[nichoId] || NICHO_CONFIG[nichoId].categories)];
      const nextIndex = index + direction;
      if (nextIndex < 0 || nextIndex >= list.length) return currentDrafts;
      [list[index], list[nextIndex]] = [list[nextIndex], list[index]];
      return { ...currentDrafts, [nichoId]: list };
    });
  };

  const addCategory = () => {
    const category = newCategory.trim().replace(/\s+/g, " ");
    if (category.length < 2) return;
    setCategoryDrafts((currentDrafts) => ({
      ...currentDrafts,
      [activeCategoryNicho]: sanitizeCategories([...(currentDrafts[activeCategoryNicho] || []), category]),
    }));
    setNewCategory("");
  };

  const resetActiveCategories = () => {
    setCategoryDrafts((currentDrafts) => ({
      ...currentDrafts,
      [activeCategoryNicho]: NICHO_CONFIG[activeCategoryNicho].categories,
    }));
  };

  const syncReferralCompletion = async (responseData: any) => {
    const auth = getFirebaseAuth();
    const currentUser = auth?.currentUser;
    if (!currentUser || !uid) return;

    const urlParams = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
    const refCode = urlParams.get("ref");
    const refUID = sessionStorage.getItem("referrer_uid")
      || (typeof responseData?.settings?.referral_source === "string" ? responseData.settings.referral_source : null);

    if (!refUID) return;

    try {
      const referralToken = await currentUser.getIdToken();
      const referralHeaders = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${referralToken}`,
      };

      const trackResponse = await fetch(getApiUrl("/api/referral/track-event"), {
        method: "POST",
        headers: referralHeaders,
        body: JSON.stringify({
          referrerUID: refUID,
          event: "onboarding_completed",
          refCode: refCode || null,
        }),
      });

      if (trackResponse.status === 401 || trackResponse.status === 403) return;
      if (!trackResponse.ok && trackResponse.status !== 409) {
        console.warn("[onboarding] Não foi possível registrar a indicação.");
        return;
      }

      const validateResponse = await fetch(getApiUrl("/api/referral/validate-referral"), {
        method: "POST",
        headers: referralHeaders,
        body: JSON.stringify({ referrerUID: refUID }),
      });

      if (validateResponse.status === 401 || validateResponse.status === 403) return;
      if (!validateResponse.ok && validateResponse.status !== 409) {
        console.warn("[onboarding] Não foi possível validar a indicação.");
      }
    } catch {
      console.warn("[onboarding] A indicação não pôde ser sincronizada agora.");
    }
  };

  const saveProgress = async ({ completed, skipped = false }: { completed: boolean; skipped?: boolean }) => {
    if (!uid) throw new Error("Not authenticated");
    const auth = getFirebaseAuth();
    if (!auth || !auth.currentUser) throw new Error("Not authenticated");

    const token = await auth.currentUser.getIdToken();
    if (!token) throw new Error("Failed to obtain authentication token");

    const types = getSafeBusinessTypes(selectedTypes, settings.businessType);
    const now = new Date().toISOString();
    const customCategoriesByNicho = Object.fromEntries(
      types.map((nichoId) => [nichoId, sanitizeCategories(categoryDrafts[nichoId] || NICHO_CONFIG[nichoId].categories)])
    );
    const nextCompleted = completed && !skipped;
    const payload = {
      onboarding_completed: nextCompleted,
      onboarding_current_step: nextCompleted ? steps.length - 1 : step,
      onboarding_theme_selected: true,
      onboarding_categories_configured: Object.keys(customCategoriesByNicho).length > 0,
      appTheme: selectedTheme,
      appThemeCustomization: themeCustomization,
      customCategoriesByNicho,
      businessType: types[0],
      businessTypes: types,
      ...(nextCompleted ? {
        completedAt: now,
        onboarding_completed_at: now,
        onboarding_skipped: false,
      } : {
        onboarding_skipped: skipped,
        ...(skipped ? { onboarding_skipped_at: now } : { onboarding_continued_later_at: now }),
      }),
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    try {
      const response = await fetch(getApiUrl(`/api/user/settings/${uid}`), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const responseData = await response.json();
      patchUserSettingsOptimistic(payload);
      invalidateUserSettings();
      if (nextCompleted) void syncReferralCompletion(responseData);
      return responseData;
    } finally {
      clearTimeout(timeoutId);
    }
  };

  const runSaveAction = async (action: () => Promise<void>) => {
    setIsSaving(true);
    setError("");
    try {
      await action();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro desconhecido";
      let friendlyError = "Não foi possível salvar agora. Você pode continuar usando o app.";
      if (msg.includes("Not authenticated")) friendlyError = "Sessão expirada. Faça login novamente.";
      else if (msg.includes("AbortError") || msg.includes("abort")) friendlyError = "Conexão demorou muito. Verifique sua internet e tente novamente.";
      setError(friendlyError);
      logError("onboarding_progress_save_failed", msg, { userId: uid ?? undefined });
      setLocation("/");
    } finally {
      setIsSaving(false);
    }
  };

  const handleComplete = (destination = "/") => runSaveAction(async () => {
    await saveProgress({ completed: true });
    setLocation(destination);
  });

  const handleSkip = () => runSaveAction(async () => {
    await saveProgress({ completed: false, skipped: true });
    setLocation("/");
  });

  const handleContinueLater = (destination = "/") => runSaveAction(async () => {
    await saveProgress({ completed: false });
    setLocation(destination);
  });

  const nextStep = () => {
    if (step < steps.length - 1) setStep(step + 1);
  };

  const prevStep = () => {
    if (step > 0) setStep(step - 1);
  };

  const renderBusinessStep = () => (
    <div className="w-full space-y-3">
      {NICHO_IDS.map((nichoId) => {
        const nicho = NICHO_CONFIG[nichoId];
        const Icon = NICHO_ICONS[nicho.iconName] || Store;
        const isSelected = selectedTypes.includes(nichoId);
        return (
          <button
            key={nichoId}
            data-testid={`nicho-option-${nichoId}`}
            onClick={() => toggleType(nichoId)}
            className={`w-full flex items-center gap-4 p-4 rounded-[2rem] border-2 transition-all text-left rs-pressable ${
              isSelected ? "border-primary bg-primary/5 shadow-md" : "border-border bg-white hover:border-primary/30"
            }`}
          >
            <div className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-colors flex-shrink-0 ${
              isSelected ? "bg-primary text-white" : "bg-secondary text-muted-foreground"
            }`}>
              <Icon className="w-6 h-6" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-black tracking-tight truncate">{nicho.label}</p>
              <p className="text-[10px] text-muted-foreground font-medium truncate">{nicho.desc}</p>
            </div>
            <div className={`w-6 h-6 rounded-lg border-2 flex items-center justify-center flex-shrink-0 transition-all ${
              isSelected ? "border-primary bg-primary text-white" : "border-border"
            }`}>
              {isSelected && <Check className="w-4 h-4" />}
            </div>
          </button>
        );
      })}
      <p className="text-center text-[11px] font-semibold text-muted-foreground">
        As categorias do produto serão filtradas pelo nicho escolhido.
      </p>
    </div>
  );

  const renderAppearanceStep = () => (
    <div className="w-full space-y-4">
      <div className="grid grid-cols-2 gap-3">
        {APP_THEMES.map((theme) => {
          const isSelected = selectedTheme === theme.id;
          return (
            <button
              key={theme.id}
              type="button"
              onClick={() => {
                setSelectedTheme(theme.id);
                setThemeCustomization(buildAppThemeCustomization(theme.id, { ...themeCustomization, primaryColor: theme.primaryColor }));
              }}
              className={`rounded-[1.6rem] border-2 bg-white p-3 text-left transition-all rs-pressable ${
                isSelected ? "border-primary shadow-lg shadow-primary/10" : "border-border hover:border-primary/30"
              }`}
            >
              <div className={`mb-3 h-12 rounded-2xl bg-gradient-to-br ${theme.swatch}`} />
              <p className="text-xs font-black text-foreground">{theme.label}</p>
              <p className="mt-1 line-clamp-2 text-[10px] font-medium text-muted-foreground">{theme.description}</p>
            </button>
          );
        })}
      </div>

      <div className="rounded-[2rem] border border-border/60 bg-white p-4 text-left shadow-sm space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-black text-foreground">Ajustes finos</p>
            <p className="text-[10px] font-medium text-muted-foreground">Leves, globais e salvos no seu perfil.</p>
          </div>
          <input
            type="color"
            value={themeCustomization.primaryColor}
            onChange={(event) => setThemeCustomization((currentValue) => ({ ...currentValue, primaryColor: event.target.value }))}
            className="h-10 w-12 rounded-xl border border-border bg-white p-1"
            aria-label="Cor principal do app"
          />
        </div>

        {[
          { label: "Botões", key: "buttonTone", options: BUTTON_TONES },
          { label: "Cards", key: "cardTone", options: CARD_TONES },
          { label: "Sombras", key: "shadowIntensity", options: SHADOW_LEVELS },
          { label: "Bordas", key: "radius", options: RADIUS_LEVELS },
          { label: "Animações", key: "motion", options: MOTION_LEVELS },
        ].map((group) => (
          <div key={group.key} className="space-y-2">
            <p className="text-[10px] font-black uppercase tracking-wide text-muted-foreground">{group.label}</p>
            <div className="flex gap-2 overflow-x-auto hide-scrollbar pb-1">
              {group.options.map((option) => {
                const optionId = option.id;
                const selectedValue = themeCustomization[group.key as keyof Required<AppThemeCustomization>];
                return (
                  <button
                    key={optionId}
                    type="button"
                    onClick={() => setThemeCustomization((currentValue) => ({ ...currentValue, [group.key]: optionId }))}
                    className={`shrink-0 rounded-2xl px-3 py-2 text-[10px] font-black transition-all ${
                      selectedValue === optionId ? "bg-primary text-white" : "bg-secondary text-muted-foreground"
                    }`}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  const renderCategoriesStep = () => {
    const activeCategories = categoryDrafts[activeCategoryNicho] || NICHO_CONFIG[activeCategoryNicho].categories;
    return (
      <div className="w-full space-y-4">
        <div className="flex gap-2 overflow-x-auto hide-scrollbar pb-1">
          {selectedTypes.map((nichoId) => (
            <button
              key={nichoId}
              type="button"
              onClick={() => setActiveCategoryNicho(nichoId)}
              className={`shrink-0 rounded-2xl px-4 py-2 text-[11px] font-black ${activeCategoryNicho === nichoId ? "bg-primary text-white" : "bg-white text-muted-foreground border border-border"}`}
            >
              {NICHO_CONFIG[nichoId].label}
            </button>
          ))}
        </div>

        <div className="rounded-[2rem] border border-border/60 bg-white p-4 shadow-sm space-y-3">
          <div className="flex items-center justify-between gap-3 text-left">
            <div>
              <p className="text-sm font-black text-foreground">Categorias de {NICHO_CONFIG[activeCategoryNicho].label}</p>
              <p className="text-[10px] font-medium text-muted-foreground">Aparecerão no cadastro de produto desse nicho.</p>
            </div>
            <button type="button" onClick={resetActiveCategories} className="text-[10px] font-black text-primary uppercase tracking-wide">
              Restaurar
            </button>
          </div>

          <div className="max-h-[42dvh] space-y-2 overflow-y-auto pr-1">
            {activeCategories.map((category, index) => (
              <div key={`${activeCategoryNicho}-${index}`} className="grid grid-cols-[1fr_auto] gap-2 rounded-2xl border border-border/60 bg-secondary/30 p-2">
                <input
                  type="text"
                  value={category}
                  onChange={(event) => updateCategory(activeCategoryNicho, index, event.target.value)}
                  onBlur={() => setCategoryDrafts((currentDrafts) => ({ ...currentDrafts, [activeCategoryNicho]: sanitizeCategories(currentDrafts[activeCategoryNicho] || []) }))}
                  className="min-w-0 rounded-xl bg-white px-3 py-2 text-xs font-bold outline-none focus:ring-2 focus:ring-primary/20"
                  aria-label={`Categoria ${index + 1}`}
                />
                <div className="flex items-center gap-1">
                  <button type="button" onClick={() => moveCategory(activeCategoryNicho, index, -1)} className="rs-icon-press h-8 w-8 rounded-xl bg-white text-muted-foreground" aria-label="Mover para cima"><ArrowUp className="mx-auto h-3.5 w-3.5" /></button>
                  <button type="button" onClick={() => moveCategory(activeCategoryNicho, index, 1)} className="rs-icon-press h-8 w-8 rounded-xl bg-white text-muted-foreground" aria-label="Mover para baixo"><ArrowDown className="mx-auto h-3.5 w-3.5" /></button>
                  <button type="button" onClick={() => removeCategory(activeCategoryNicho, index)} className="rs-icon-press h-8 w-8 rounded-xl bg-red-50 text-red-600" aria-label="Remover categoria"><Trash2 className="mx-auto h-3.5 w-3.5" /></button>
                </div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-[1fr_auto] gap-2 pt-1">
            <input
              type="text"
              value={newCategory}
              onChange={(event) => setNewCategory(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  addCategory();
                }
              }}
              placeholder="Criar categoria personalizada..."
              className="min-w-0 rounded-2xl border border-border bg-white px-4 py-3 text-xs font-semibold outline-none focus:ring-2 focus:ring-primary/20"
            />
            <button type="button" onClick={addCategory} className="rounded-2xl bg-primary px-4 py-3 text-xs font-black text-white">
              <Plus className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    );
  };

  const renderProductStep = () => (
    <div className="w-full space-y-3">
      <div className="rounded-[2rem] border border-primary/10 bg-white p-5 text-left shadow-sm">
        <p className="text-[10px] font-black uppercase tracking-wide text-primary">Como cadastrar</p>
        <div className="mt-4 grid gap-3">
          {[
            "Escolha foto ou câmera e o app otimiza a imagem.",
            "Nome, marca e origem ficam separados para organizar melhor.",
            "Categoria já vem filtrada pelo nicho configurado.",
            "Preço e estoque alimentam vendas, catálogo e relatórios.",
          ].map((item, index) => (
            <div key={item} className="flex gap-3 rounded-2xl bg-secondary/40 p-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-[10px] font-black text-white">{index + 1}</span>
              <p className="text-xs font-semibold leading-relaxed text-foreground">{item}</p>
            </div>
          ))}
        </div>
      </div>
      <button type="button" onClick={() => void handleContinueLater("/add-product")} className="w-full rounded-[2rem] bg-primary px-5 py-4 text-sm font-black text-white shadow-lg shadow-primary/20 rs-pressable">
        Cadastrar primeiro produto
      </button>
    </div>
  );

  const renderTourStep = () => (
    <div className="w-full grid grid-cols-1 gap-2">
      {TOUR_ITEMS.map((item) => {
        const Icon = item.icon;
        return (
          <div key={item.label} className="flex items-center gap-3 rounded-2xl border border-border/60 bg-white p-3 text-left shadow-sm">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary"><Icon className="h-5 w-5" /></div>
            <div className="min-w-0">
              <p className="text-xs font-black text-foreground">{item.label}</p>
              <p className="text-[10px] font-medium text-muted-foreground">{item.text}</p>
            </div>
          </div>
        );
      })}
    </div>
  );

  const renderFinishStep = () => (
    <div className="w-full space-y-3">
      {[
        { label: "Nicho escolhido", done: selectedTypes.length > 0 },
        { label: "Tema configurado", done: true },
        { label: "Categorias configuradas", done: selectedTypes.every((type) => sanitizeCategories(categoryDrafts[type] || []).length > 0) },
        { label: "Primeiro produto", done: false, hint: "Você pode cadastrar agora ou depois." },
      ].map((item) => (
        <div key={item.label} className="flex items-center gap-3 rounded-2xl bg-white p-4 text-left shadow-sm">
          <div className={`flex h-9 w-9 items-center justify-center rounded-2xl ${item.done ? "bg-emerald-50 text-emerald-600" : "bg-secondary text-muted-foreground"}`}>
            {item.done ? <Check className="h-5 w-5" /> : <Clock className="h-5 w-5" />}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-black text-foreground">{item.label}</p>
            {item.hint && <p className="text-[10px] font-medium text-muted-foreground">{item.hint}</p>}
          </div>
        </div>
      ))}
    </div>
  );

  const renderStepContent = () => {
    switch (current.id) {
      case "business": return renderBusinessStep();
      case "appearance": return renderAppearanceStep();
      case "categories": return renderCategoriesStep();
      case "product": return renderProductStep();
      case "tour": return renderTourStep();
      case "finish": return renderFinishStep();
      default:
        return (
          <div className="flex items-center gap-2 rounded-2xl bg-white px-4 py-3 text-xs font-semibold text-muted-foreground shadow-sm">
            <Clock className="h-4 w-4 text-primary" />
            Leva poucos minutos e pode ser retomado depois.
          </div>
        );
    }
  };

  return (
    <div className="min-h-screen bg-background px-5 py-6 flex flex-col max-w-md mx-auto">
      <div className="flex items-center justify-between pb-4">
        <button
          type="button"
          onClick={prevStep}
          className={`rs-icon-press flex h-10 w-10 items-center justify-center rounded-2xl bg-white text-muted-foreground shadow-sm ${step === 0 ? "invisible" : ""}`}
          aria-label="Voltar"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="min-w-0 flex-1 px-4">
          <div className="flex items-center justify-between text-[10px] font-black uppercase tracking-wide text-muted-foreground">
            <span>{current.eyebrow}</span>
            <span>{currentProgress}%</span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-primary/15">
            <div className="h-full rounded-full bg-primary transition-all duration-300" style={{ width: `${currentProgress}%` }} />
          </div>
        </div>
        <button
          type="button"
          onClick={() => void handleSkip()}
          disabled={isSaving}
          className="rounded-2xl bg-white px-3 py-2 text-[10px] font-black uppercase tracking-wider text-muted-foreground shadow-sm disabled:opacity-50"
        >
          Pular
        </button>
      </div>

      <div className="flex-1 flex flex-col justify-center items-center text-center space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
        <div className={`w-20 h-20 ${current.color} rounded-[2.25rem] flex items-center justify-center shadow-inner`}>
          <current.icon className="w-10 h-10" />
        </div>

        <div className="space-y-3">
          <h1 className="text-2xl font-black text-foreground tracking-tight leading-tight">{current.title}</h1>
          <p className="text-sm text-muted-foreground px-4 leading-relaxed">{current.text}</p>
        </div>

        {renderStepContent()}

        {error && <p className="rounded-2xl bg-red-50 px-4 py-3 text-center text-xs font-bold text-red-700">{error}</p>}
      </div>

      <div className="pt-8 pb-[max(1rem,env(safe-area-inset-bottom))] space-y-3">
        <button
          data-testid="button-concluir-onboarding"
          type="button"
          onClick={() => isLastStep ? void handleComplete("/") : nextStep()}
          disabled={isSaving}
          className="w-full bg-primary text-white font-black py-5 rounded-[2.5rem] shadow-xl shadow-primary/20 flex items-center justify-center gap-2 uppercase tracking-[0.2em] text-xs active:scale-95 transition-all disabled:opacity-50 disabled:grayscale disabled:scale-100"
        >
          {isSaving ? (
            <>
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Salvando...
            </>
          ) : isLastStep ? (
            "Ir para meu painel"
          ) : (
            <>Próximo <ArrowRight className="w-4 h-4" /></>
          )}
        </button>
        <button
          type="button"
          onClick={() => void handleContinueLater("/")}
          disabled={isSaving}
          className="w-full text-muted-foreground font-black py-2 text-[10px] uppercase tracking-widest active:opacity-60 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
        >
          Continuar depois
        </button>
      </div>
    </div>
  );
}
