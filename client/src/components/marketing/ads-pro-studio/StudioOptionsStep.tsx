import { useMemo, useState } from "react";
import { Check, Columns2, RefreshCw } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { AdsProAdDocumentV1 } from "@shared/ads-pro/ad-document";
import { ADS_PRO_ARCHETYPE_LABELS } from "@shared/ads-pro/ad-style-direction";
import type { AdsProVariation, AdsProVariationRationale } from "@shared/ads-pro/ad-variations";
import { resolveStudioBackdrop } from "@/lib/ads-pro-studio-catalog";
import type { AdsProRenderAssets } from "@/lib/ads-pro-studio-render";
import { STUDIO_THUMB_MAX_SIDE } from "@/lib/ads-pro-studio-assets";
import { getAdsProStyleLabel } from "@/lib/ads-pro-style-presentation";
import type { MarketingProStyle } from "@shared/marketing-pro-contract";
import { AdsProStudioCanvas } from "./AdsProStudioCanvas";
import { useStaticBackgroundImage } from "./use-studio-assets";
import { StudioBanner, StudioPrimaryButton } from "./StudioPrimitives";

export type StudioAssetsFactory = (doc: AdsProAdDocumentV1, backgroundImage: CanvasImageSource | null, maxSide: number) => AdsProRenderAssets;

/** `chosenStyle`: estilo que o vendedor escolheu à mão para este anúncio (o texto não pode atribuí-lo ao perfil). */
export function describeVariationRationale(rationale: AdsProVariationRationale, chosenStyle: MarketingProStyle | null = null): string[] {
  const origin = chosenStyle !== null && rationale.style === chosenStyle ? " (escolhido por você)" : rationale.styleFromProfile && chosenStyle === null ? " (do seu perfil)" : "";
  const lines = [
    `Estilo ${getAdsProStyleLabel(rationale.style)}${origin}`,
    `Composição ${ADS_PRO_ARCHETYPE_LABELS[rationale.archetype]}`,
  ];
  if (rationale.bucketMatch) lines.push("Fundo do mesmo tipo do produto");
  else if (rationale.categoryAffinity === "exact") lines.push("Fundo indicado para a categoria");
  return lines;
}

function VariationPreview({
  variation,
  doc,
  assetsFor,
  renderWidth,
  testId,
}: {
  readonly variation: AdsProVariation;
  readonly doc: AdsProAdDocumentV1;
  readonly assetsFor: StudioAssetsFactory;
  readonly renderWidth: number;
  readonly testId: string;
}) {
  const backdrop = useMemo(() => resolveStudioBackdrop(doc.background, doc.format), [doc.background, doc.format]);
  const background = useStaticBackgroundImage(backdrop.asset);
  const assets = useMemo(() => assetsFor(doc, background.image, STUDIO_THUMB_MAX_SIDE), [assetsFor, doc, background.image]);
  return <AdsProStudioCanvas doc={doc} assets={assets} renderWidth={renderWidth} ariaLabel={`${variation.label}: ${variation.roleLabel}`} testId={testId} className="w-full" />;
}

export function StudioOptionsStep({
  variations,
  chosenStyle,
  decorate,
  assetsFor,
  selectedId,
  staleVariations,
  hasPhoto,
  onPick,
  onMore,
  onNext,
}: {
  readonly variations: readonly AdsProVariation[];
  readonly chosenStyle: MarketingProStyle | null;
  /** Aplica a foto/ajustes atuais (e a regra de recorte indisponível) ao documento da opção. */
  readonly decorate: (doc: AdsProAdDocumentV1) => AdsProAdDocumentV1;
  readonly assetsFor: StudioAssetsFactory;
  readonly selectedId: string | null;
  readonly staleVariations: boolean;
  readonly hasPhoto: boolean;
  readonly onPick: (variation: AdsProVariation) => void;
  readonly onMore: () => void;
  readonly onNext: () => void;
}) {
  const [compareOpen, setCompareOpen] = useState(false);
  const decorated = useMemo(() => variations.map((variation) => ({ variation, doc: decorate(variation.doc) })), [variations, decorate]);

  return (
    <div className="space-y-3" data-testid="studio-step-options">
      <p className="text-[11px] leading-snug text-muted-foreground">
        Montamos {variations.length} versões diferentes do mesmo anúncio — com os mesmos dados do produto, só muda a direção de arte. Toque numa delas para usar.
      </p>
      {!hasPhoto && <StudioBanner tone="warning" testId="studio-options-no-photo">Sem foto do produto as opções aparecem sem imagem. Adicione uma foto no cadastro para exportar.</StudioBanner>}
      {staleVariations && (
        <StudioBanner tone="info" testId="studio-options-stale">
          As opções foram atualizadas, mas seu anúncio continua como você deixou. Toque numa opção para aplicar — seus textos e sua foto são mantidos.
        </StudioBanner>
      )}

      <ul className="grid grid-cols-3 gap-2" data-testid="studio-variations" aria-label="Opções do anúncio">
        {decorated.map(({ variation, doc }) => {
          const selected = variation.id === selectedId;
          return (
            <li key={variation.id} className="min-w-0">
              <button
                type="button"
                onClick={() => onPick(variation)}
                aria-pressed={selected}
                aria-label={`Usar ${variation.label}: ${variation.roleLabel}`}
                data-testid={`studio-variation-${variation.id}`}
                data-variation-id={variation.id}
                data-variation-role={variation.role}
                data-variation-style={variation.rationale.style}
                data-variation-archetype={variation.rationale.archetype}
                data-variation-background={variation.rationale.backgroundId}
                data-selected={selected}
                className={`block w-full min-w-0 rounded-xl border-2 p-1 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${selected ? "border-primary bg-primary/5" : "border-border/60 bg-background hover:border-primary/50"}`}
              >
                <VariationPreview variation={variation} doc={doc} assetsFor={assetsFor} renderWidth={240} testId={`studio-variation-canvas-${variation.id}`} />
                <span className="mt-1 block px-0.5">
                  <span className="flex items-center gap-1 truncate text-[11px] font-black text-foreground">
                    {variation.label}
                    {selected && <Check className="h-3 w-3 shrink-0 text-primary" aria-label="em uso" />}
                  </span>
                  <span className="block truncate text-[10px] font-semibold text-muted-foreground">{variation.roleLabel}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <div className="grid grid-cols-2 gap-2">
        <StudioPrimaryButton tone="outline" onClick={() => setCompareOpen(true)} testId="studio-compare-open"><Columns2 className="h-4 w-4" aria-hidden="true" /> Comparar</StudioPrimaryButton>
        <StudioPrimaryButton tone="outline" onClick={onMore} testId="studio-more-options"><RefreshCw className="h-4 w-4" aria-hidden="true" /> Outras opções</StudioPrimaryButton>
      </div>
      <p className="text-[10px] leading-snug text-muted-foreground">Trocar de opção ou pedir outras opções é grátis e não usa créditos.</p>
      <StudioPrimaryButton onClick={onNext} testId="studio-next-options">Continuar para o fundo</StudioPrimaryButton>

      <Dialog open={compareOpen} onOpenChange={setCompareOpen}>
        <DialogContent className="max-w-3xl" data-testid="studio-compare-dialog">
          <DialogHeader>
            <DialogTitle>Comparar opções</DialogTitle>
            <DialogDescription>Veja as versões lado a lado e escolha a que mais combina com a sua loja.</DialogDescription>
          </DialogHeader>
          <ul className="-mx-2 flex snap-x snap-mandatory gap-3 overflow-x-auto px-2 pb-2 sm:grid sm:grid-cols-3 sm:overflow-visible" aria-label="Opções lado a lado">
            {decorated.map(({ variation, doc }) => {
              const selected = variation.id === selectedId;
              return (
                <li key={variation.id} className="w-[64vw] max-w-[280px] shrink-0 snap-center sm:w-auto sm:max-w-none" data-testid={`studio-compare-item-${variation.id}`}>
                  <div className={`rounded-xl border-2 p-1.5 ${selected ? "border-primary" : "border-border/60"}`}>
                    <VariationPreview variation={variation} doc={doc} assetsFor={assetsFor} renderWidth={420} testId={`studio-compare-canvas-${variation.id}`} />
                  </div>
                  <p className="mt-1.5 text-xs font-black text-foreground">{variation.label} · {variation.roleLabel}</p>
                  <ul className="mt-0.5 space-y-0.5 text-[10px] leading-snug text-muted-foreground">
                    {describeVariationRationale(variation.rationale, chosenStyle).map((line) => <li key={line}>{line}</li>)}
                  </ul>
                  <div className="mt-2">
                    <StudioPrimaryButton
                      tone={selected ? "outline" : "primary"}
                      onClick={() => { onPick(variation); setCompareOpen(false); }}
                      testId={`studio-compare-use-${variation.id}`}
                    >
                      {selected ? "Continuar com esta" : "Usar esta opção"}
                    </StudioPrimaryButton>
                  </div>
                </li>
              );
            })}
          </ul>
        </DialogContent>
      </Dialog>
    </div>
  );
}
