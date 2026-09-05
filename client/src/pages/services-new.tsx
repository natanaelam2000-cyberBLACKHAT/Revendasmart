import { useState } from "react";
import { useLocation, useSearch } from "wouter";
import { CheckCircle2, ChevronLeft } from "lucide-react";
import { Layout } from "@/components/layout";
import { PlanLimitPrompt } from "@/components/PlanLimitPrompt";
import { usePlan } from "@/providers/PlanProvider";
import { createService, ServiceLimitError } from "@/lib/services-persistence";
import { getFirebaseAuth, trackAnalyticsEvent } from "@/lib/firebase";
import { getApiUrl } from "@/lib/api-config";
import type { ServicePricing } from "@shared/services";

/**
 * SERVICES-CREATE-UI-01 — a menor UI real e owner-facing de cadastro de Serviço, reutilizando 100% do
 * domínio já existente (createService/checkServiceLimit/ServiceLimitError, mesmo caminho server-
 * authoritative de add-product.tsx). Campos deliberadamente limitados ao que o próprio modelo Service já
 * suporta hoje (§5 do ticket) — nunca staff/comissão/pacotes/recorrência/impostos/variantes. `cost` sempre
 * {kind:"unknown"} (domínio já suporta isto explicitamente — não há campo de custo nesta tela) e
 * `bookingMode` sempre "request" (o mais conservador dos dois modos genuinamente reserváveis — nunca
 * "none", que impediria o próximo passo real de PLAN-IMPL-09, "link de agendamento pronto"): nenhum dos
 * dois é uma decisão que este formulário mínimo expõe ao dono.
 */

type PricingMode = ServicePricing["mode"];

const PRICING_MODE_LABEL: Record<PricingMode, string> = {
  fixed: "Preço fixo",
  starting_at: "A partir de",
  quote: "Sob consulta",
};

export default function ServicesNew() {
  const [, setLocation] = useLocation();
  const { activePlan } = usePlan();
  // PLAN-IMPL-09-FINAL §20 — marcador fechado (nunca URL arbitrária); ao contrário de add-product.tsx, o
  // destino de sucesso NUNCA muda (§20 do ticket já pede o mesmo destino real de sempre — configurar
  // disponibilidade — nunca um retorno ao wizard), só marca onboarding_completed como efeito colateral.
  const isFromOnboarding = new URLSearchParams(useSearch()).get("from") === "onboarding";

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [pricingMode, setPricingMode] = useState<PricingMode>("fixed");
  const [price, setPrice] = useState(0);
  const [durationMinutes, setDurationMinutes] = useState<number | "">("");
  const [active, setActive] = useState(true);
  const [published, setPublished] = useState(true);

  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [showLimitModal, setShowLimitModal] = useState(false);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSaving) return;

    const trimmedName = name.trim();
    if (!trimmedName) { setFormError("Nome do serviço é obrigatório."); return; }
    if (pricingMode !== "quote" && (!Number.isFinite(price) || price <= 0)) {
      setFormError("Preço deve ser maior que 0.");
      return;
    }
    if (durationMinutes !== "" && (!Number.isFinite(durationMinutes) || durationMinutes <= 0)) {
      setFormError("Duração deve ser maior que 0.");
      return;
    }

    const pricing: ServicePricing =
      pricingMode === "fixed" ? { mode: "fixed", priceCents: Math.round(price * 100) }
      : pricingMode === "starting_at" ? { mode: "starting_at", startingAtPriceCents: Math.round(price * 100) }
      : { mode: "quote" };

    setIsSaving(true);
    setFormError("");
    try {
      const created = await createService({
        name: trimmedName,
        description: description.trim() || undefined,
        active,
        published,
        pricing,
        ...(durationMinutes !== "" ? { durationMinutes } : {}),
        cost: { kind: "unknown" },
        bookingMode: "request",
        activePlan,
      });
      // SERVICES-CREATE-UI-01 §24 — mesma disciplina de first_product_created: só dispara quando o
      // servidor confirma isFirstService (0 -> 1 dentro da MESMA transação de criação), nunca inferido.
      if (created.isFirstService) trackAnalyticsEvent("first_service_created");
      setSuccess(true);
      // PLAN-IMPL-09-FINAL §19/§20 — o serviço real já está persistido e o sucesso já foi mostrado acima;
      // marcar onboarding_completed é um passo best-effort separado (mesma disciplina de add-product.tsx,
      // e na mesma ordem — depois de setSuccess, nunca antes) — uma falha OU demora aqui nunca esconde nem
      // atrasa o sucesso real da criação, e nunca muda o destino, que continua sendo a configuração de
      // disponibilidade.
      if (isFromOnboarding) {
        const user = getFirebaseAuth()?.currentUser;
        if (user) {
          fetch(getApiUrl(`/api/user/settings/${user.uid}`), {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${await user.getIdToken().catch(() => "")}` },
            body: JSON.stringify({ onboarding_completed: true }),
          }).catch(() => {});
        }
      }
      setTimeout(() => setLocation("/servicos/disponibilidade"), 1500);
    } catch (err) {
      if (err instanceof ServiceLimitError) {
        setShowLimitModal(true);
        setFormError("Limite de serviços atingido.");
      } else {
        setFormError("Não foi possível salvar o serviço. Tente novamente.");
      }
    } finally {
      setIsSaving(false);
    }
  };

  if (success) {
    return (
      <Layout>
        <div className="flex flex-col items-center justify-center h-full p-6 text-center animate-in fade-in zoom-in duration-300">
          <div className="w-24 h-24 bg-green-100 rounded-full flex items-center justify-center mb-6">
            <CheckCircle2 className="w-12 h-12 text-green-600" />
          </div>
          <h2 className="text-2xl font-bold text-foreground mb-2">Serviço Adicionado!</h2>
          <p className="text-muted-foreground">Agora configure seus horários para começar a receber agendamentos.</p>
        </div>
      </Layout>
    );
  }

  if (showLimitModal) {
    return (
      <Layout title="Limite Atingido">
        <PlanLimitPrompt resource="services" currentPlan={activePlan} onClose={() => setShowLimitModal(false)} />
      </Layout>
    );
  }

  return (
    <Layout title="Novo Serviço">
      <div className="px-4 sm:px-6 pt-6 sm:pt-8 pb-[max(8rem,calc(env(safe-area-inset-bottom)+7rem))] max-w-4xl mx-auto scroll-pt-24">
        <button type="button" onClick={() => setLocation("/servicos/agenda")} className="flex min-h-11 items-center gap-2 text-muted-foreground mb-5 font-medium">
          <ChevronLeft className="w-4 h-4" /> Voltar
        </button>

        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-muted-foreground uppercase px-1">Nome do Serviço</label>
            <input
              required
              type="text"
              enterKeyHint="next"
              autoComplete="off"
              placeholder="Ex: Corte de cabelo"
              className="w-full bg-white border border-border rounded-2xl px-4 py-3 text-sm focus:outline-none"
              value={name}
              onChange={(e) => setName(e.target.value)}
              data-testid="input-service-name"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-muted-foreground uppercase px-1">Como você cobra</label>
            <div className="grid grid-cols-3 gap-2">
              {(Object.keys(PRICING_MODE_LABEL) as PricingMode[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setPricingMode(mode)}
                  data-testid={`button-pricing-mode-${mode}`}
                  className={`min-h-11 px-2 rounded-2xl text-[11px] font-bold transition-all ${
                    pricingMode === mode
                      ? "bg-primary text-white shadow-sm shadow-primary/20"
                      : "bg-white border border-border text-muted-foreground"
                  }`}
                >
                  {PRICING_MODE_LABEL[mode]}
                </button>
              ))}
            </div>
          </div>

          {pricingMode !== "quote" && (
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-muted-foreground uppercase px-1">
                {pricingMode === "fixed" ? "Preço" : "Preço a partir de"}
              </label>
              <input
                required
                type="number"
                inputMode="decimal"
                enterKeyHint="next"
                step="0.01"
                min="0"
                className="w-full bg-white border border-border rounded-2xl px-4 py-3 text-sm"
                value={price}
                onChange={(e) => setPrice(parseFloat(e.target.value) || 0)}
                data-testid="input-service-price"
              />
            </div>
          )}

          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-muted-foreground uppercase px-1">Duração (minutos)</label>
            <input
              type="number"
              inputMode="numeric"
              enterKeyHint="next"
              min="1"
              placeholder="Opcional"
              className="w-full bg-white border border-border rounded-2xl px-4 py-3 text-sm"
              value={durationMinutes}
              onChange={(e) => setDurationMinutes(e.target.value === "" ? "" : parseInt(e.target.value) || 0)}
              data-testid="input-service-duration"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-muted-foreground uppercase px-1">Descrição</label>
            <textarea
              className="w-full bg-white border border-border rounded-2xl px-4 py-3 text-sm h-32 focus:outline-none"
              placeholder="Opcional"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              enterKeyHint="done"
              data-testid="input-service-description"
            />
          </div>

          <div className="p-4 bg-secondary/30 rounded-[2rem] space-y-4">
            <div className="flex items-center justify-between gap-3 p-3 bg-white rounded-2xl border border-border/40">
              <label htmlFor="active" className="text-xs font-bold cursor-pointer flex-1">Serviço ativo</label>
              <input id="active" type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="w-5 h-5 cursor-pointer rounded" data-testid="toggle-active" />
            </div>
            <div className="flex items-center justify-between gap-3 p-3 bg-white rounded-2xl border border-border/40">
              <label htmlFor="published" className="text-xs font-bold cursor-pointer flex-1">Visível no link de agendamento</label>
              <input id="published" type="checkbox" checked={published} onChange={(e) => setPublished(e.target.checked)} className="w-5 h-5 cursor-pointer rounded" data-testid="toggle-published" />
            </div>
          </div>

          {formError && (
            <p className="text-xs text-destructive font-medium text-center px-2">{formError}</p>
          )}

          <button
            type="submit"
            className="rs-pressable min-h-12 w-full bg-primary text-white font-bold rounded-2xl py-4 mt-4 shadow-lg shadow-primary/20 active:scale-95 transition-all"
            data-testid="button-save-service"
          >
            {isSaving ? "Salvando..." : "Salvar Serviço"}
          </button>
        </form>
      </div>
    </Layout>
  );
}
