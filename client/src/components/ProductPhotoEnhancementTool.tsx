import { useCallback, useRef, useState } from "react";
import { RefreshCw, Wand2 } from "lucide-react";
import { ApiError } from "@/lib/api-client";
import {
  createPhotoEnhancementGenerationRequestId,
  requestPhotoEnhancement,
  type EnhancePhotoResponse,
} from "@/lib/product-photo-enhancement";

/**
 * RELEASE V1 §7.6 — "Melhorar foto" real, só Premium/admin. Nunca substitui o original sozinho:
 * `improved=false` mostra a explicação de fail-safe (§7.4); `improved=true` mostra preview antes/depois
 * e só persiste em uso quando o usuário confirma explicitamente. Chamada sempre manual, idempotente por
 * `generationRequestId`, double-click bloqueado por `busyRef` — mesmo padrão de `PhotoroomCutoutTool`.
 */
const ENHANCEMENT_ERROR_MESSAGES: Record<string, string> = {
  PHOTO_ENHANCEMENT_PREMIUM_REQUIRED: "Melhorar foto com IA é um recurso Premium.",
  RATE_LIMITED: "Você atingiu o limite de melhorias por hoje. Tente novamente amanhã.",
  GENERATION_IN_PROGRESS: "Já existe uma melhoria em andamento para esta foto.",
  NO_PRODUCT_IMAGE: "Este produto não tem uma foto salva para melhorar.",
  ENHANCEMENT_FAILED: "Não foi possível melhorar esta foto agora.",
};

const NOT_IMPROVED_MESSAGES: Record<string, string> = {
  "no-measurable-gain": "Esta foto já está com boa qualidade — não encontramos uma melhora segura para aplicar.",
  "regression-detected": "Não foi possível melhorar esta foto com segurança sem piorar outro aspecto.",
  "increased-clipping": "O ajuste automático estourou mais detalhes do que melhorou — mantivemos a foto original.",
};

type EnhancementToolState =
  | { readonly phase: "idle" }
  | { readonly phase: "generating" }
  | { readonly phase: "result"; readonly response: EnhancePhotoResponse }
  | { readonly phase: "error"; readonly message: string };

type ProductPhotoEnhancementToolProps = {
  productId: string;
  originalImageUrl: string;
  onApplied?: (result: Extract<EnhancePhotoResponse, { improved: true }>["result"]) => void;
};

export function ProductPhotoEnhancementTool({ productId, originalImageUrl, onApplied }: ProductPhotoEnhancementToolProps) {
  const [state, setState] = useState<EnhancementToolState>({ phase: "idle" });
  const [applied, setApplied] = useState(false);
  const busyRef = useRef(false);

  const runEnhance = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setApplied(false);
    setState({ phase: "generating" });
    try {
      const generationRequestId = createPhotoEnhancementGenerationRequestId();
      const response = await requestPhotoEnhancement(productId, generationRequestId);
      setState({ phase: "result", response });
    } catch (error) {
      const code = error instanceof ApiError ? error.code : undefined;
      const message = (code && ENHANCEMENT_ERROR_MESSAGES[code]) || "Não foi possível melhorar a foto agora. Tente novamente.";
      setState({ phase: "error", message });
    } finally {
      busyRef.current = false;
    }
  }, [productId]);

  const handleUse = useCallback(() => {
    if (state.phase !== "result" || !state.response.improved) return;
    setApplied(true);
    onApplied?.(state.response.result);
  }, [onApplied, state]);

  return (
    <div className="min-w-0 rounded-2xl border border-primary/20 bg-primary/[0.04] p-3.5" data-testid="product-photo-enhancement-tool">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-black text-foreground">Melhorar foto com IA</h3>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
            Ajusta exposição, contraste e nitidez da foto original. Só aplica se houver melhora real e mensurável.
          </p>
        </div>
        <span className="rounded-full bg-primary/10 px-2 py-1 text-[9px] font-black uppercase tracking-wide text-primary">Premium</span>
      </div>

      {state.phase === "idle" && (
        <button
          type="button"
          onClick={() => void runEnhance()}
          className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-primary/30 bg-white px-4 text-xs font-black text-primary transition hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          data-testid="button-photo-enhancement-generate"
        >
          <Wand2 className="h-4 w-4" />
          Melhorar esta foto
        </button>
      )}

      {state.phase === "generating" && (
        <p className="mt-3 rounded-xl border border-border/60 bg-background px-3 py-2 text-xs font-semibold text-muted-foreground" role="status" aria-live="polite" data-testid="text-photo-enhancement-generating">
          Analisando e melhorando a foto...
        </p>
      )}

      {state.phase === "result" && !state.response.improved && (
        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800" role="status" data-testid="text-photo-enhancement-not-improved">
          {NOT_IMPROVED_MESSAGES[state.response.reason] || "Não encontramos uma melhora segura para aplicar — a foto original foi mantida."}
        </div>
      )}

      {state.phase === "result" && state.response.improved && (
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
              <div className="aspect-square overflow-hidden rounded-xl border border-border/60 bg-white">
                <img src={state.response.result.downloadUrl || state.response.result.storagePath} alt="Foto melhorada do produto" className="h-full w-full object-contain" data-testid="img-photo-enhancement-preview" />
              </div>
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => void runEnhance()}
              className="min-h-11 flex-1 rounded-xl border border-border bg-white text-xs font-black text-muted-foreground"
              data-testid="button-photo-enhancement-retry"
            >
              <span className="inline-flex items-center justify-center gap-1.5"><RefreshCw className="h-4 w-4" /> Tentar de novo</span>
            </button>
            <button
              type="button"
              onClick={handleUse}
              disabled={applied}
              className="min-h-11 flex-1 rounded-xl bg-primary text-xs font-black text-primary-foreground disabled:opacity-60"
              data-testid="button-photo-enhancement-use"
            >
              {applied ? "Resultado em uso" : "Usar este resultado"}
            </button>
          </div>
          {applied && (
            <p className="mt-2 rounded-xl bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700" role="status">
              Foto melhorada salva. A foto original continua intacta e recuperável.
            </p>
          )}
        </div>
      )}

      {state.phase === "error" && (
        <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700" role="alert" data-testid="text-photo-enhancement-error">
          {state.message}
          <button type="button" onClick={() => void runEnhance()} className="ml-2 underline">Tentar novamente</button>
        </div>
      )}
    </div>
  );
}
