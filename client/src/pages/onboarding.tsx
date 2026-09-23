import { useEffect, useMemo, useState, type ComponentType } from "react";
import { useLocation } from "wouter";
import { onAuthStateChanged } from "firebase/auth";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Box,
  Check,
  CheckCircle2,
  Clock,
  Cookie,
  GripVertical,
  Image as ImageIcon,
  Package,
  Palette,
  Plus,
  Shirt,
  Sparkles,
  Store,
  Trash2,
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
import { getFirebaseAuth, logError, trackAnalyticsEvent } from "@/lib/firebase";
import { NICHO_CONFIG, NICHO_IDS, ONBOARDING_NICHO_IDS, getProductCategoriesForNicho, type NichoId } from "@/lib/nicho-config";
import { patchUserSettingsOptimistic, invalidateUserSettings } from "@/hooks/useUserSettings";
import { useUserSettings } from "@/providers/UserSettingsProvider";

const NICHO_ICONS: Record<string, ComponentType<{ className?: string }>> = {
  Store,
  Shirt,
  Watch,
  Cookie,
  Box,
};

// PLAN-IMPL-09-FINAL — orientação produtos/serviços/ambos, distinta de businessType/businessTypes
// (nicho de produto). "niche" é o antigo passo "business" renomeado só internamente (nunca persistido
// como string — onboarding_current_step continua um índice numérico) para nunca confundir os dois
// conceitos no código. dashboardTour/productsTour/clientsTour/salesTour/catalogTour foram removidos: são
// TOUR_ONLY (§13/§33/§34 do ticket) — nenhum first-value real depende deles, e a filosofia desta ticket
// é priorizar a criação real sobre passeios guiados.
type OnboardingStepId = "welcome" | "businessMode" | "firstStartDomain" | "niche" | "appearance" | "store" | "categories" | "firstValue" | "finish";
type BusinessMode = "products" | "services" | "both";
type FirstStartDomain = "products" | "services";

type OnboardingStep = {
  id: OnboardingStepId;
  eyebrow: string;
  title: string;
  text: string;
  icon: ComponentType<{ className?: string }>;
  color: string;
};

const BUSINESS_MODE_OPTIONS: { id: BusinessMode; label: string; desc: string; icon: ComponentType<{ className?: string }> }[] = [
  { id: "products", label: "Vendo produtos", desc: "Cadastre seus produtos, organize o estoque e divulgue sua loja.", icon: Package },
  { id: "services", label: "Presto serviços", desc: "Organize seus serviços, horários e receba agendamentos.", icon: Clock },
  { id: "both", label: "Faço os dois", desc: "Gerencie produtos e serviços no mesmo lugar.", icon: Store },
];

const FIRST_START_DOMAIN_OPTIONS: { id: FirstStartDomain; label: string; desc: string; icon: ComponentType<{ className?: string }> }[] = [
  { id: "products", label: "Produtos", desc: "Cadastrar meu primeiro produto agora.", icon: Package },
  { id: "services", label: "Serviços", desc: "Cadastrar meu primeiro serviço agora.", icon: Clock },
];

/** §12 — autoridade única de composição de passos: nunca `if (businessMode)` espalhado pela renderização.
 * Devolve uma lista PARCIAL enquanto uma escolha obrigatória (businessMode, e firstStartDomain quando
 * "both") ainda não foi feita — nextStep()/isLastStep tratam isso via isGatingStepUnresolved, nunca
 * avançando cegamente. */
function resolveOnboardingSteps(businessMode: BusinessMode | null, firstStartDomain: FirstStartDomain | null): OnboardingStepId[] {
  const steps: OnboardingStepId[] = ["welcome", "businessMode"];
  if (businessMode === null) return steps;
  if (businessMode === "both") {
    steps.push("firstStartDomain");
    if (firstStartDomain === null) return steps;
  }
  const isProducts = businessMode === "products" || firstStartDomain === "products";
  if (isProducts) steps.push("niche");
  steps.push("appearance", "store");
  if (isProducts) steps.push("categories");
  steps.push("firstValue", "finish");
  return steps;
}

function normalizeNichoId(type?: string): NichoId | null {
  if (!type) return null;
  if (type === "Alimentos/Doces") return "Doces";
  return NICHO_IDS.includes(type as NichoId) ? type as NichoId : null;
}

function getSafeBusinessTypes(types: string[], fallback?: string): NichoId[] {
  const validTypes = types.map((type) => normalizeNichoId(type)).filter((type): type is NichoId => Boolean(type));
  if (validTypes.length > 0) return Array.from(new Set(validTypes));
  const normalizedFallback = normalizeNichoId(fallback);
  if (normalizedFallback) return [normalizedFallback];
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

  const [uid, setUid] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  // PLAN-IMPL-09-FINAL §4/§7 — nunca inferido de businessType/businessTypes (nicho de produto, conceito
  // distinto). null = ainda não escolhido; nunca um default silencioso, nem aqui nem numa falha de leitura
  // de settings (859c644 continua intocado — error != new user, ver useUserSettings/PlanProvider).
  const [businessMode, setBusinessMode] = useState<BusinessMode | null>(null);
  const [firstStartDomain, setFirstStartDomain] = useState<FirstStartDomain | null>(null);
  const [selectedTypes, setSelectedTypes] = useState<NichoId[]>(["Geral"]);
  const [selectedTheme, setSelectedTheme] = useState<AppThemeId>(resolveAppThemeId(settings.appTheme));
  const [themeCustomization, setThemeCustomization] = useState<Required<AppThemeCustomization>>(() => buildAppThemeCustomization(settings.appTheme, settings.appThemeCustomization as AppThemeCustomization | undefined));
  const [categoryDrafts, setCategoryDrafts] = useState<Record<string, string[]>>(() => createCategoryDrafts(settings));
  const [storeNameDraft, setStoreNameDraft] = useState(settings.storeName || "");
  const [storeLogoDraft, setStoreLogoDraft] = useState(settings.storeLogo || "");
  const [activeCategoryNicho, setActiveCategoryNicho] = useState<NichoId>("Geral");
  const [newCategory, setNewCategory] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const [hydratedFromSettings, setHydratedFromSettings] = useState(false);

  const isProductDomain = businessMode === "products" || (businessMode === "both" && firstStartDomain === "products");
  const isServiceDomain = businessMode === "services" || (businessMode === "both" && firstStartDomain === "services");

  // §40 — copy do finish adapta por modo; §12 — metadados de TODOS os passos possíveis vivem aqui, mas
  // resolveOnboardingSteps() decide quais de fato aparecem (nunca um `if (businessMode)` espalhado pela
  // renderização abaixo).
  const stepIds = useMemo(() => resolveOnboardingSteps(businessMode, firstStartDomain), [businessMode, firstStartDomain]);
  const steps = useMemo<OnboardingStep[]>(() => {
    const finishText = isServiceDomain && !isProductDomain
      ? "Seu serviço está pronto para os próximos passos: configure horários e comece a receber agendamentos."
      : "Você pode continuar ajustando depois pelo checklist do Dashboard. Agora é hora de usar o app.";
    const allSteps: Record<OnboardingStepId, OnboardingStep> = {
      welcome: { id: "welcome", eyebrow: "Comece do jeito certo", title: "Sua loja pronta para vender mais", text: "Poucos passos, direto ao que importa: como você trabalha e seu primeiro cadastro real.", icon: Sparkles, color: "bg-primary/10 text-primary" },
      businessMode: { id: "businessMode", eyebrow: "Personalização real", title: "Como você trabalha hoje?", text: "Isso decide os próximos passos — nada de telas que não fazem sentido para o seu negócio.", icon: Store, color: "bg-blue-100 text-blue-700" },
      firstStartDomain: { id: "firstStartDomain", eyebrow: "Faço os dois", title: "Por onde você quer começar?", text: "Você configura o outro depois, com calma — sem precisar fazer os dois agora.", icon: Store, color: "bg-blue-100 text-blue-700" },
      niche: { id: "niche", eyebrow: "Personalização real", title: "Escolha o nicho da sua revenda", text: "Essa escolha muda categorias, sugestões, campos e a sensação do app. Nada de lista genérica para todo mundo.", icon: Store, color: "bg-blue-100 text-blue-700" },
      appearance: { id: "appearance", eyebrow: "Sua marca no app", title: "Defina a aparência do Revenda Smart", text: "Escolha tema, cor principal, estilo dos cards, sombras, bordas e animações sem pesar a navegação.", icon: Palette, color: "bg-violet-100 text-violet-700" },
      store: { id: "store", eyebrow: "Identidade da loja", title: "Configure nome e logo da sua loja", text: "O app já mostra um preview em tempo real para você sentir que a experiência ficou com a sua cara.", icon: ImageIcon, color: "bg-cyan-100 text-cyan-700" },
      categories: { id: "categories", eyebrow: "Categorias inteligentes", title: "Organize categorias por nicho", text: "Mantenha o padrão, remova o que não usa, renomeie, reordene ou crie categorias próprias.", icon: GripVertical, color: "bg-emerald-100 text-emerald-700" },
      firstValue: isServiceDomain
        ? { id: "firstValue", eyebrow: "Primeiro cadastro", title: "Cadastre seu primeiro serviço com segurança", text: "Defina preço, duração e deixe pronto para configurar horários em seguida.", icon: Clock, color: "bg-orange-100 text-orange-700" }
        : { id: "firstValue", eyebrow: "Primeiro cadastro", title: "Cadastre seu primeiro produto com segurança", text: "O cadastro já abre com categorias e campos coerentes com o nicho escolhido.", icon: Package, color: "bg-orange-100 text-orange-700" },
      finish: { id: "finish", eyebrow: "Tudo pronto", title: "Seu painel está configurado", text: finishText, icon: CheckCircle2, color: "bg-green-100 text-green-700" },
    };
    return stepIds.map((id) => allSteps[id]);
  }, [stepIds, isProductDomain, isServiceDomain]);
  const current = steps[step] || steps[0];
  // §12 — enquanto uma escolha obrigatória (businessMode, e firstStartDomain quando "both") não foi
  // feita, resolveOnboardingSteps() devolve uma lista PARCIAL — nunca trata isso como "último passo".
  const isGatingStepUnresolved = (current.id === "businessMode" && !businessMode) || (current.id === "firstStartDomain" && !firstStartDomain);
  const isLastStep = !isGatingStepUnresolved && step >= steps.length - 1;
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
    setStoreNameDraft(settings.storeName || "");
    setStoreLogoDraft(settings.storeLogo || "");
    // §45 — refresh nunca pode mostrar um passo inválido: businessMode sobrevive (persistido), mas
    // firstStartDomain deliberadamente não (§24 — escolha transitória de UX, não dado permanente) — um
    // "both" retomando um refresh volta a perguntar por onde começar, nunca perde os dados reais já
    // criados. Usa resolveOnboardingSteps com os valores FRESCOS lidos agora (nunca o `steps` do
    // component, que ainda reflete o estado antigo neste mesmo ciclo de render).
    const hydratedBusinessMode: BusinessMode | null = settings.businessMode === "products" || settings.businessMode === "services" || settings.businessMode === "both" ? settings.businessMode : null;
    setBusinessMode(hydratedBusinessMode);
    if (typeof settings.onboarding_current_step === "number" && settings.onboarding_completed !== true) {
      const hydratedStepIds = resolveOnboardingSteps(hydratedBusinessMode, null);
      setStep(Math.min(Math.max(settings.onboarding_current_step, 0), hydratedStepIds.length - 1));
    }
    setHydratedFromSettings(true);
  }, [hydratedFromSettings, settings, settingsLoading]);

  useEffect(() => {
    applyAppTheme({ appTheme: selectedTheme, appThemeCustomization: themeCustomization });
  }, [selectedTheme, themeCustomization]);

  const selectedStoreInitial = (storeNameDraft.trim() || settings.storeName || "R").charAt(0).toLocaleUpperCase("pt-BR");

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

  const saveProgress = async ({ completed, skipped = false, stepOverride = step }: { completed: boolean; skipped?: boolean; stepOverride?: number }) => {
    if (!uid) throw new Error("Not authenticated");
    const auth = getFirebaseAuth();
    if (!auth || !auth.currentUser) throw new Error("Not authenticated");

    const token = await auth.currentUser.getIdToken();
    if (!token) throw new Error("Failed to obtain authentication token");

    const types = getSafeBusinessTypes(selectedTypes, settings.businessType);
    const now = new Date().toISOString();
    const cleanStoreName = storeNameDraft.trim() || settings.storeName || "Minha Revenda";
    const cleanStoreLogo = storeLogoDraft.trim();
    const customCategoriesByNicho = Object.fromEntries(
      types.map((nichoId) => [nichoId, sanitizeCategories(categoryDrafts[nichoId] || NICHO_CONFIG[nichoId].categories)])
    );
    const nextCompleted = completed && !skipped;
    const payload = {
      onboarding_completed: nextCompleted,
      onboarding_current_step: nextCompleted ? steps.length - 1 : stepOverride,
      onboarding_theme_selected: true,
      onboarding_store_configured: Boolean(cleanStoreName && cleanStoreName !== "Minha Revenda") || Boolean(cleanStoreLogo),
      onboarding_categories_configured: Object.keys(customCategoriesByNicho).length > 0,
      appTheme: selectedTheme,
      appThemeCustomization: themeCustomization,
      customCategoriesByNicho,
      storeName: cleanStoreName,
      storeLogo: cleanStoreLogo,
      businessType: types[0],
      businessTypes: types,
      // §6/§7 — só grava quando de fato escolhido; nunca sobrescreve com um default silencioso, e nunca
      // é o sinal de conclusão (onboarding_completed continua a única autoridade disso).
      ...(businessMode ? { businessMode } : {}),
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
      patchUserSettingsOptimistic(payload, uid);
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
      // RELEASE-QUALITY-02 §6: redirecionar aqui escondia o erro (a tela mudava antes do usuário ler o
      // banner) e fingia uma conclusão que não aconteceu. Ficar na mesma etapa preserva as respostas já
      // dadas e deixa o mesmo botão disponível como retry — nenhuma navegação nova é necessária.
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

  const persistStepProgress = (nextStepIndex: number) => {
    if (!uid || settingsLoading) return;
    // §55 — business_mode_selected só depois de PERSISTIR com sucesso (nunca no clique/render do card,
    // §40 do 08); "leavingBusinessModeStep" é decidido ANTES do await (current.id ainda é o passo real de
    // onde se está saindo, nunca o destino) — falha de analytics nunca bloqueia o autosave em si (catch
    // próprio, best-effort).
    const leavingBusinessModeStep = current.id === "businessMode" && businessMode !== null;
    void saveProgress({ completed: false, stepOverride: nextStepIndex }).then(() => {
      if (leavingBusinessModeStep) {
        trackAnalyticsEvent("business_mode_selected", { business_mode: businessMode as BusinessMode, source: "onboarding" });
      }
    }).catch((err) => {
      const msg = err instanceof Error ? err.message : "Erro desconhecido";
      logError("onboarding_step_autosave_failed", msg, { userId: uid });
    });
  };

  const nextStep = () => {
    if (isGatingStepUnresolved) return;
    if (step >= steps.length - 1) return;
    const nextStepIndex = step + 1;
    setStep(nextStepIndex);
    persistStepProgress(nextStepIndex);
  };

  const prevStep = () => {
    if (step <= 0) return;
    const nextStepIndex = step - 1;
    setStep(nextStepIndex);
    persistStepProgress(nextStepIndex);
  };

  // PLAN-IMPL-09-FINAL §10/§11/§86 — single-select (nunca multi-select como o nicho abaixo): escolher só
  // seta o estado, o avanço continua pelo botão "Próximo" já existente (mesmo modelo mental do resto do
  // wizard, nunca um auto-advance especial só para este passo — evita qualquer race entre setState e o
  // saveProgress dispatchado por nextStep/persistStepProgress, que já lê o estado FRESCO na hora do
  // clique separado em "Próximo"). Cada opção já é um <button> com texto+descrição (§86 — nunca só
  // ícone/cor), operável por teclado/foco por padrão.
  const renderBusinessModeStep = () => (
    <div className="w-full space-y-3">
      {BUSINESS_MODE_OPTIONS.map((option) => {
        const Icon = option.icon;
        const isSelected = businessMode === option.id;
        return (
          <button
            key={option.id}
            type="button"
            data-testid={`business-mode-option-${option.id}`}
            onClick={() => setBusinessMode(option.id)}
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
              <p className="text-sm font-black tracking-tight truncate">{option.label}</p>
              <p className="text-[10px] text-muted-foreground font-medium truncate">{option.desc}</p>
            </div>
            <div className={`w-6 h-6 rounded-lg border-2 flex items-center justify-center flex-shrink-0 transition-all ${
              isSelected ? "border-primary bg-primary text-white" : "border-border"
            }`}>
              {isSelected && <Check className="w-4 h-4" />}
            </div>
          </button>
        );
      })}
    </div>
  );

  const renderFirstStartDomainStep = () => (
    <div className="w-full space-y-3">
      {FIRST_START_DOMAIN_OPTIONS.map((option) => {
        const Icon = option.icon;
        const isSelected = firstStartDomain === option.id;
        return (
          <button
            key={option.id}
            type="button"
            data-testid={`first-start-domain-option-${option.id}`}
            onClick={() => setFirstStartDomain(option.id)}
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
              <p className="text-sm font-black tracking-tight truncate">{option.label}</p>
              <p className="text-[10px] text-muted-foreground font-medium truncate">{option.desc}</p>
            </div>
            <div className={`w-6 h-6 rounded-lg border-2 flex items-center justify-center flex-shrink-0 transition-all ${
              isSelected ? "border-primary bg-primary text-white" : "border-border"
            }`}>
              {isSelected && <Check className="w-4 h-4" />}
            </div>
          </button>
        );
      })}
    </div>
  );

  const renderNicheStep = () => (
    <div className="w-full space-y-3">
      {ONBOARDING_NICHO_IDS.map((nichoId) => {
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


  const renderStoreStep = () => (
    <div className="w-full space-y-4">
      <div className="rounded-[2rem] border border-border/60 bg-white p-4 text-left shadow-sm">
        <p className="text-[10px] font-black uppercase tracking-wide text-primary">Preview da sua loja</p>
        <div className="mt-4 flex items-center gap-4 rounded-[1.8rem] bg-gradient-to-br from-primary/10 via-white to-primary/5 p-4">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-[1.5rem] bg-primary text-2xl font-black text-white shadow-sm">
            {storeLogoDraft.trim() ? <img src={storeLogoDraft.trim()} alt="Logo da loja" className="h-full w-full object-cover" /> : selectedStoreInitial}
          </div>
          <div className="min-w-0">
            <p className="truncate text-base font-black text-foreground">{storeNameDraft.trim() || "Minha Revenda"}</p>
            <p className="mt-1 text-[11px] font-semibold text-muted-foreground">Esse nome aparece no Dashboard e no catálogo.</p>
          </div>
        </div>
      </div>
      <div className="space-y-3 text-left">
        <label className="block space-y-2">
          <span className="text-[10px] font-black uppercase tracking-wide text-muted-foreground">Nome da loja</span>
          <input type="text" value={storeNameDraft} onChange={(event) => setStoreNameDraft(event.target.value)} placeholder="Ex: Adriana Perfumes" className="w-full rounded-2xl border border-border bg-white px-4 py-3 text-sm font-bold outline-none focus:ring-2 focus:ring-primary/20" data-testid="input-onboarding-store-name" />
        </label>
        <label className="block space-y-2">
          <span className="text-[10px] font-black uppercase tracking-wide text-muted-foreground">Logo por URL (opcional)</span>
          <input type="url" value={storeLogoDraft} onChange={(event) => setStoreLogoDraft(event.target.value)} placeholder="Cole a URL da logo ou configure depois" className="w-full rounded-2xl border border-border bg-white px-4 py-3 text-sm font-bold outline-none focus:ring-2 focus:ring-primary/20" data-testid="input-onboarding-store-logo" />
        </label>
        <p className="rounded-2xl bg-secondary/60 px-4 py-3 text-[11px] font-semibold leading-relaxed text-muted-foreground">Upload de arquivo continua disponível em Configurações. Aqui mantemos o onboarding leve, sem carregar dependências de Storage antes da hora.</p>
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

  // §15/§17 — nunca duplica o formulário real: só um card informativo + um link para add-product.tsx
  // (a mesma tela que qualquer outro caminho de criação de produto usa). `?from=onboarding` é um marcador
  // fechado (enum de uma opção), nunca uma URL de retorno arbitrária — add-product.tsx decide o que fazer
  // com ele, este componente nunca lê o resultado de volta (§20 — não há "volta para o wizard").
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
      <button type="button" onClick={() => void handleContinueLater("/add-product?from=onboarding")} className="w-full rounded-[2rem] bg-primary px-5 py-4 text-sm font-black text-white shadow-lg shadow-primary/20 rs-pressable">
        Cadastrar primeiro produto
      </button>
    </div>
  );

  // §18/§19 — reusa /servicos/novo (9c6003f) — nenhum formulário de Serviço próprio. Mesmo card
  // informativo do produto acima, só copy/destino diferentes.
  const renderServiceStep = () => (
    <div className="w-full space-y-3">
      <div className="rounded-[2rem] border border-primary/10 bg-white p-5 text-left shadow-sm">
        <p className="text-[10px] font-black uppercase tracking-wide text-primary">Como cadastrar</p>
        <div className="mt-4 grid gap-3">
          {[
            "Nome do serviço e como você cobra (fixo, a partir de ou sob consulta).",
            "Duração em minutos, se fizer sentido para o seu serviço.",
            "Já fica pronto para configurar horários e receber agendamentos.",
          ].map((item, index) => (
            <div key={item} className="flex gap-3 rounded-2xl bg-secondary/40 p-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-[10px] font-black text-white">{index + 1}</span>
              <p className="text-xs font-semibold leading-relaxed text-foreground">{item}</p>
            </div>
          ))}
        </div>
      </div>
      <button type="button" onClick={() => void handleContinueLater("/servicos/novo?from=onboarding")} className="w-full rounded-[2rem] bg-primary px-5 py-4 text-sm font-black text-white shadow-lg shadow-primary/20 rs-pressable">
        Cadastrar primeiro serviço
      </button>
    </div>
  );

  // §40 — checklist adapta por domínio: nicho/categorias só aparecem quando de fato foram passos reais
  // (isProductDomain); "Tour concluído" foi removido (as tours em si saíram do wizard, §13/§33/§34); o
  // item de primeiro produto/serviço continua deliberadamente "done:false, opcional" — mesma filosofia já
  // existente antes desta ticket (concluir o onboarding nunca foi condicionado a já ter criado algo,
  // §14 — nunca um bloqueio rígido).
  const renderFinishStep = () => {
    const items: { label: string; done: boolean; hint?: string }[] = [
      ...(isProductDomain ? [{ label: "Nicho escolhido", done: selectedTypes.length > 0 }] : []),
      { label: "Tema configurado", done: true },
      { label: "Loja identificada", done: Boolean(storeNameDraft.trim()) },
      ...(isProductDomain ? [{ label: "Categorias configuradas", done: selectedTypes.every((type) => sanitizeCategories(categoryDrafts[type] || []).length > 0) }] : []),
      { label: isServiceDomain && !isProductDomain ? "Primeiro serviço" : "Primeiro produto", done: false, hint: "Você pode cadastrar agora ou depois." },
    ];
    return (
      <div className="w-full space-y-3">
        {items.map((item) => (
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
  };

  const renderStepContent = () => {
    switch (current.id) {
      case "businessMode": return renderBusinessModeStep();
      case "firstStartDomain": return renderFirstStartDomainStep();
      case "niche": return renderNicheStep();
      case "appearance": return renderAppearanceStep();
      case "store": return renderStoreStep();
      case "categories": return renderCategoriesStep();
      case "firstValue": return isServiceDomain && !isProductDomain ? renderServiceStep() : renderProductStep();
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
          disabled={isSaving || isGatingStepUnresolved}
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
