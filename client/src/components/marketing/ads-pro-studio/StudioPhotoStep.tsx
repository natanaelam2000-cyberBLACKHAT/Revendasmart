import { useState } from "react";
import { Eraser, Sparkles } from "lucide-react";
import type { Product } from "@/lib/mock-data";
import {
  NEUTRAL_PHOTO_ADJUST,
  PHOTO_ADJUST_LIMITS,
  PHOTO_FRAMING_LIMITS,
  isNeutralPhotoAdjust,
  type AdsProPhotoState,
} from "@shared/ads-pro/ad-document";
import { analyzePhoto, computeAutoAdjust, isPhotoAlreadyGood } from "@shared/ads-pro/ad-photo-adjust";
import type { StudioAssetsApi } from "./use-studio-assets";
import type { StudioPhotoPatch } from "./studio-shared";
import { StudioBanner, StudioChip, StudioField, StudioPrimaryButton, StudioSlider, studioInputClass } from "./StudioPrimitives";

type Message = { readonly tone: "success" | "warning" | "info"; readonly text: string };

const percent = (value: number) => `${Math.round(value * 100)}%`;
const signedPercent = (value: number) => `${value > 0 ? "+" : ""}${Math.round(value * 100)}%`;

export function StudioPhotoStep({
  products,
  productId,
  onSelectProduct,
  assets,
  photo,
  onPhotoChange,
  showOriginal,
  onToggleShowOriginal,
  onNext,
}: {
  readonly products: readonly Product[];
  readonly productId: string;
  readonly onSelectProduct: (id: string) => void;
  readonly assets: StudioAssetsApi;
  readonly photo: AdsProPhotoState | null;
  readonly onPhotoChange: (patch: StudioPhotoPatch, key?: string) => void;
  readonly showOriginal: boolean;
  readonly onToggleShowOriginal: () => void;
  readonly onNext: () => void;
}) {
  const [enhanceMessage, setEnhanceMessage] = useState<Message | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const ready = assets.photoStatus === "ready" && photo !== null;
  const adjust = photo?.adjust ?? NEUTRAL_PHOTO_ADJUST;
  const cutoutReady = assets.cutout !== null;

  const handleAutoEnhance = () => {
    const pixels = assets.readPixels();
    if (!pixels) {
      setEnhanceMessage({ tone: "warning", text: "Não foi possível analisar esta foto agora." });
      return;
    }
    const suggestion = computeAutoAdjust(analyzePhoto(pixels));
    if (isPhotoAlreadyGood(suggestion)) {
      setEnhanceMessage({ tone: "info", text: "Sua foto já está boa — nada precisou mudar." });
      return;
    }
    onPhotoChange({ adjust: suggestion });
    setEnhanceMessage({ tone: "success", text: "Melhoramos luz, contraste e nitidez. Sua foto original continua intacta — toque em “Ver foto original” para comparar." });
  };

  const handleResetAdjust = () => {
    onPhotoChange({ adjust: NEUTRAL_PHOTO_ADJUST });
    setEnhanceMessage({ tone: "info", text: "Voltamos à foto original, sem ajustes." });
  };

  const handleCutout = async () => {
    if (assets.cutout) {
      onPhotoChange({ mode: "cutout" });
      return;
    }
    const ok = await assets.generateCutout();
    if (ok) onPhotoChange({ mode: "cutout" });
  };

  return (
    <div className="space-y-4" data-testid="studio-step-photo">
      {products.length > 1 && (
        <StudioField label="Produto">
          <select value={productId} onChange={(event) => onSelectProduct(event.target.value)} className={studioInputClass} data-testid="studio-product-select">
            {products.map((product) => (
              <option key={product.id} value={product.id}>{product.name}</option>
            ))}
          </select>
        </StudioField>
      )}

      {assets.photoStatus === "loading" && <StudioBanner tone="info" testId="studio-photo-loading">Carregando a foto do produto...</StudioBanner>}
      {assets.photoStatus === "no-image" && (
        <StudioBanner tone="warning" testId="studio-photo-missing">
          Este produto não tem foto cadastrada. Adicione uma foto no cadastro do produto para montar e exportar o anúncio.
        </StudioBanner>
      )}
      {assets.photoStatus === "load-failed" && (
        <StudioBanner tone="error" testId="studio-photo-failed">Não foi possível carregar a foto deste produto. Tente novamente ou troque a foto no cadastro.</StudioBanner>
      )}

      <section aria-labelledby="studio-enhance-title" className="space-y-2">
        <h3 id="studio-enhance-title" className="text-xs font-black text-foreground">Melhorar foto</h3>
        <p className="text-[11px] leading-snug text-muted-foreground">
          Ajusta luz, contraste, cor e nitidez no seu aparelho — grátis e sem inteligência artificial. A foto original nunca é alterada.
        </p>
        <div className="grid grid-cols-2 gap-2">
          <StudioPrimaryButton onClick={handleAutoEnhance} disabled={!ready} testId="studio-photo-enhance">
            <Sparkles className="h-4 w-4" aria-hidden="true" /> Melhorar automático
          </StudioPrimaryButton>
          <StudioPrimaryButton tone="outline" onClick={handleResetAdjust} disabled={!ready || isNeutralPhotoAdjust(adjust)} testId="studio-photo-reset-adjust">
            Voltar ao original
          </StudioPrimaryButton>
        </div>
        <div className="flex flex-wrap gap-2">
          <StudioChip selected={showOriginal} onClick={onToggleShowOriginal} disabled={!ready} testId="studio-photo-compare-original">Ver foto original</StudioChip>
          <StudioChip selected={manualOpen} onClick={() => setManualOpen((value) => !value)} disabled={!ready} testId="studio-photo-manual-toggle">Ajustar manualmente</StudioChip>
        </div>
        {enhanceMessage && <StudioBanner tone={enhanceMessage.tone === "warning" ? "warning" : enhanceMessage.tone === "success" ? "success" : "info"} testId="studio-photo-enhance-message">{enhanceMessage.text}</StudioBanner>}
        {manualOpen && ready && (
          <div className="space-y-1 rounded-xl border border-border/60 bg-background p-3" data-testid="studio-photo-manual">
            <StudioSlider label="Brilho" value={adjust.brightness} min={PHOTO_ADJUST_LIMITS.brightness.min} max={PHOTO_ADJUST_LIMITS.brightness.max} step={0.01} format={signedPercent} onChange={(value) => onPhotoChange({ adjust: { brightness: value } }, "adj-brightness")} onReset={() => onPhotoChange({ adjust: { brightness: 0 } })} testId="studio-adjust-brightness" />
            <StudioSlider label="Contraste" value={adjust.contrast} min={PHOTO_ADJUST_LIMITS.contrast.min} max={PHOTO_ADJUST_LIMITS.contrast.max} step={0.01} format={percent} onChange={(value) => onPhotoChange({ adjust: { contrast: value } }, "adj-contrast")} onReset={() => onPhotoChange({ adjust: { contrast: 1 } })} testId="studio-adjust-contrast" />
            <StudioSlider label="Cor" value={adjust.saturation} min={PHOTO_ADJUST_LIMITS.saturation.min} max={PHOTO_ADJUST_LIMITS.saturation.max} step={0.01} format={percent} onChange={(value) => onPhotoChange({ adjust: { saturation: value } }, "adj-saturation")} onReset={() => onPhotoChange({ adjust: { saturation: 1 } })} testId="studio-adjust-saturation" />
            <StudioSlider label="Nitidez" value={adjust.sharpness} min={PHOTO_ADJUST_LIMITS.sharpness.min} max={PHOTO_ADJUST_LIMITS.sharpness.max} step={0.01} format={percent} onChange={(value) => onPhotoChange({ adjust: { sharpness: value } }, "adj-sharpness")} onReset={() => onPhotoChange({ adjust: { sharpness: 0 } })} testId="studio-adjust-sharpness" />
          </div>
        )}
      </section>

      <section aria-labelledby="studio-cutout-title" className="space-y-2">
        <h3 id="studio-cutout-title" className="text-xs font-black text-foreground">Remover fundo <span className="font-semibold text-muted-foreground">(opcional)</span></h3>
        <p className="text-[11px] leading-snug text-muted-foreground">
          Separa o produto do cenário da foto, no seu aparelho. Funciona melhor com fundo liso. Se não der certo, o anúncio continua com a foto original.
        </p>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Foto no anúncio">
          <StudioChip selected={photo?.mode !== "cutout"} onClick={() => onPhotoChange({ mode: "original" })} disabled={!ready} testId="studio-photo-mode-original">Foto inteira</StudioChip>
          <StudioChip selected={photo?.mode === "cutout" && cutoutReady} onClick={() => void handleCutout()} disabled={!ready || assets.cutoutBusy} testId="studio-photo-mode-cutout">
            <span className="inline-flex items-center gap-1.5"><Eraser className="h-3.5 w-3.5" aria-hidden="true" />{assets.cutoutBusy ? "Removendo..." : cutoutReady ? "Sem fundo" : "Remover fundo"}</span>
          </StudioChip>
        </div>
        {assets.cutoutSource === "approved" && <StudioBanner tone="info" testId="studio-cutout-approved">Usando o recorte já aprovado deste produto.</StudioBanner>}
        {assets.cutoutFailure && <StudioBanner tone="warning" testId="studio-cutout-failure">{assets.cutoutFailure}</StudioBanner>}
      </section>

      <section aria-labelledby="studio-frame-title" className="space-y-1">
        <h3 id="studio-frame-title" className="text-xs font-black text-foreground">Enquadrar</h3>
        <StudioSlider label="Zoom" value={photo?.zoom ?? 1} min={PHOTO_FRAMING_LIMITS.zoom.min} max={PHOTO_FRAMING_LIMITS.zoom.max} step={0.05} format={(value) => `${value.toFixed(2)}×`} onChange={(value) => onPhotoChange({ zoom: value }, "frame-zoom")} onReset={() => onPhotoChange({ zoom: 1, offsetX: 0, offsetY: 0 })} disabled={!ready} testId="studio-frame-zoom" />
        <StudioSlider label="Posição horizontal" value={photo?.offsetX ?? 0} min={PHOTO_FRAMING_LIMITS.offset.min} max={PHOTO_FRAMING_LIMITS.offset.max} step={0.05} format={signedPercent} onChange={(value) => onPhotoChange({ offsetX: value }, "frame-x")} onReset={() => onPhotoChange({ offsetX: 0 })} disabled={!ready || (photo?.zoom ?? 1) <= 1} testId="studio-frame-x" />
        <StudioSlider label="Posição vertical" value={photo?.offsetY ?? 0} min={PHOTO_FRAMING_LIMITS.offset.min} max={PHOTO_FRAMING_LIMITS.offset.max} step={0.05} format={signedPercent} onChange={(value) => onPhotoChange({ offsetY: value }, "frame-y")} onReset={() => onPhotoChange({ offsetY: 0 })} disabled={!ready || (photo?.zoom ?? 1) <= 1} testId="studio-frame-y" />
      </section>

      <StudioPrimaryButton onClick={onNext} testId="studio-next-photo">Continuar para o estilo</StudioPrimaryButton>
    </div>
  );
}
