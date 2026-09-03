import { useCallback, useRef, useState } from "react";
import { Eraser, RefreshCw } from "lucide-react";
import { ApiError } from "@/lib/api-client";
import {
  createPhotoroomCutoutGenerationRequestId,
  requestPhotoroomCutout,
} from "@/lib/product-cutout-photoroom";
import type { ApprovedProductCutout } from "@shared/approved-product-cutout";

/**
 * RELEASE V1 §6.7 — "Remover fundo" com PhotoRoom no cadastro/edição de produto, só para Premium/admin
 * (o pai decide isso, este componente só renderiza quando já sabe que pode). A chamada é sempre manual
 * (nunca automática ao trocar de foto, §6.7) e idempotente por tentativa (§6.8: cada clique em "Tentar
 * novamente"/"Gerar novamente" usa um `generationRequestId` novo; um double-click no MESMO clique nunca
 * dispara duas chamadas — `busyRef`). O servidor já persiste o recorte (Firestore + Storage) na mesma
 * resposta — a foto original nunca é sobrescrita, o recorte é um asset derivado à parte.
 */
const PHOTOROOM_ERROR_MESSAGES: Record<string, string> = {
  PHOTOROOM_PLAN_REQUIRED: "Remover fundo com IA é um recurso dos planos Pro e Premium.",
  PHOTOROOM_NOT_CONFIGURED: "O recorte com IA está indisponível no momento. Tente novamente mais tarde.",
  RATE_LIMITED: "Você atingiu o limite de recortes por hoje. Tente novamente amanhã.",
  GENERATION_IN_PROGRESS: "Já existe um recorte em andamento para este produto.",
  // PLAN-IMPL-05 — cota mensal de preparações profissionais (nunca de anúncios/exports/reuso).
  ADS_PRO_PREPARATION_LIMIT_REACHED: "Você usou as preparações profissionais deste mês. Produtos já preparados continuam disponíveis para novos anúncios.",
  ADS_PRO_PREPARATION_IN_PROGRESS: "Já existe uma preparação em andamento para este produto. Tente novamente em instantes.",
  NO_PRODUCT_IMAGE: "Este produto não tem uma foto salva para recortar.",
  ORIGINAL_DECODE_UNAVAILABLE: "Não foi possível processar esta foto para o recorte.",
  PIXEL_GATE_REJECTED: "O recorte não passou na validação de preservação do produto — nada foi alterado.",
  CUTOUT_FAILED: "Não foi possível remover o fundo desta foto.",
};

type PhotoroomToolState =
  | { readonly phase: "idle" }
  | { readonly phase: "generating" }
  | { readonly phase: "ready"; readonly cutout: ApprovedProductCutout }
  | { readonly phase: "error"; readonly message: string };

type PhotoroomCutoutToolProps = {
  productId: string;
  originalImageUrl: string;
  onApplied?: (cutout: ApprovedProductCutout) => void;
};

export function PhotoroomCutoutTool({ productId, originalImageUrl, onApplied }: PhotoroomCutoutToolProps) {
  const [state, setState] = useState<PhotoroomToolState>({ phase: "idle" });
  const [applied, setApplied] = useState(false);
  const busyRef = useRef(false);

  const runGenerate = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setApplied(false);
    setState({ phase: "generating" });
    try {
      const generationRequestId = createPhotoroomCutoutGenerationRequestId();
      const cutout = await requestPhotoroomCutout(productId, generationRequestId);
      setState({ phase: "ready", cutout });
    } catch (error) {
      const code = error instanceof ApiError ? error.code : undefined;
      const message = (code && PHOTOROOM_ERROR_MESSAGES[code]) || "Não foi possível remover o fundo agora. Tente novamente.";
      setState({ phase: "error", message });
    } finally {
      busyRef.current = false;
    }
  }, [productId]);

  const handleUse = useCallback(() => {
    if (state.phase !== "ready") return;
    setApplied(true);
    onApplied?.(state.cutout);
  }, [onApplied, state]);

  return (
    <div className="min-w-0 rounded-2xl border border-primary/20 bg-primary/[0.04] p-3.5" data-testid="photoroom-cutout-tool">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-black text-foreground">Remover fundo com IA</h3>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
            Recorte real do produto (PhotoRoom). A foto original nunca é alterada — o recorte fica salvo à parte.
          </p>
          {/* PLAN-IMPL-05 §32 — a unidade cobrada é a PREPARAÇÃO do produto, nunca os anúncios feitos com
              ele depois: reforçado aqui, no único lugar onde o dono decide "gastar" uma preparação. */}
          <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground/80">
            Conta como 1 preparação profissional do mês. Depois de preparado, reutilize o produto em quantos anúncios quiser sem gastar outra.
          </p>
        </div>
        <span className="rounded-full bg-primary/10 px-2 py-1 text-[9px] font-black uppercase tracking-wide text-primary">Pro</span>
      </div>

      {state.phase === "idle" && (
        <button
          type="button"
          onClick={() => void runGenerate()}
          className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-primary/30 bg-white px-4 text-xs font-black text-primary transition hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          data-testid="button-photoroom-cutout-generate"
        >
          <Eraser className="h-4 w-4" />
          Remover fundo desta foto
        </button>
      )}

      {state.phase === "generating" && (
        <p className="mt-3 rounded-xl border border-border/60 bg-background px-3 py-2 text-xs font-semibold text-muted-foreground" role="status" aria-live="polite" data-testid="text-photoroom-cutout-generating">
          Removendo o fundo...
        </p>
      )}

      {state.phase === "ready" && (
        <div className="mt-3">
          <div className="grid grid-cols-2 gap-2">
            <div className="min-w-0">
              <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Antes</p>
              <div className="aspect-square overflow-hidden rounded-xl border border-border/60 bg-white">
                <img src={originalImageUrl} alt="Foto original do produto" className="h-full w-full object-contain" />
              </div>
            </div>
            <div className="min-w-0">
              <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Depois</p>
              <div
                className="aspect-square overflow-hidden rounded-xl border border-border/60"
                style={{ backgroundImage: "conic-gradient(#e5e7eb 90deg, #fff 90deg 180deg, #e5e7eb 180deg 270deg, #fff 270deg)", backgroundSize: "16px 16px" }}
              >
                <img src={state.cutout.downloadUrl || state.cutout.storagePath} alt="Produto com fundo removido" className="h-full w-full object-contain" data-testid="img-photoroom-cutout-preview" />
              </div>
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => void runGenerate()}
              className="min-h-11 flex-1 rounded-xl border border-border bg-white text-xs font-black text-muted-foreground"
              data-testid="button-photoroom-cutout-retry"
            >
              <span className="inline-flex items-center justify-center gap-1.5"><RefreshCw className="h-4 w-4" /> Gerar novamente</span>
            </button>
            <button
              type="button"
              onClick={handleUse}
              disabled={applied}
              className="min-h-11 flex-1 rounded-xl bg-primary text-xs font-black text-primary-foreground disabled:opacity-60"
              data-testid="button-photoroom-cutout-use"
            >
              {applied ? "Recorte em uso" : "Usar este recorte"}
            </button>
          </div>
          {applied && (
            <p className="mt-2 rounded-xl bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700" role="status">
              Recorte salvo. A foto original continua intacta.
            </p>
          )}
        </div>
      )}

      {state.phase === "error" && (
        <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700" role="alert" data-testid="text-photoroom-cutout-error">
          {state.message}
          <button type="button" onClick={() => void runGenerate()} className="ml-2 underline">Tentar novamente</button>
        </div>
      )}
    </div>
  );
}
