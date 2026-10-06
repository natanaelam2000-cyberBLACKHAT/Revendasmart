import { ADS_PRO_FORMAT_LABELS, ADS_PRO_FORMATS, type AdsProFormat } from "@shared/ads-pro/ad-document";
import type { AdsProProductFacts } from "@shared/ads-pro/ad-product-facts";
import { ADS_PRO_INTENSITY_LABELS, type AdsProIntensity } from "@shared/ads-pro/ad-style-direction";
import type { MarketingCampaignIntentId } from "@shared/marketing-pro-creative-intelligence";
import type { MarketingProStyle } from "@shared/marketing-pro-contract";
import { getAdsProStyleDescription, getAdsProStyleLabel } from "@/lib/ads-pro-style-presentation";
import { ADS_PRO_LOW_STOCK_THRESHOLD } from "@shared/ads-pro/ad-document";
import { STUDIO_INTENTS, STUDIO_STYLES, type StudioStyleChoice } from "./studio-shared";
import { StudioBanner, StudioChip, StudioPrimaryButton } from "./StudioPrimitives";

export type StudioStyleOrigin = "chosen" | "profile" | "category-default";

function intentHint(intent: MarketingCampaignIntentId, facts: AdsProProductFacts | null): string | null {
  if (!facts) return null;
  if (intent === "promo" && !facts.price?.hasPromotion) {
    return "Este produto não tem preço promocional cadastrado — o anúncio não mostra selo de desconto.";
  }
  if (intent === "last" && !(facts.stock !== null && facts.stock > 0 && facts.stock <= ADS_PRO_LOW_STOCK_THRESHOLD)) {
    return "Só escrevemos “Últimas unidades” quando o estoque cadastrado é baixo.";
  }
  return null;
}

export function StudioStyleStep({
  styleChoice,
  onStyleChoice,
  resolvedStyle,
  origin,
  intent,
  onIntent,
  intensity,
  onIntensity,
  format,
  onFormat,
  facts,
  onNext,
}: {
  readonly styleChoice: StudioStyleChoice;
  readonly onStyleChoice: (choice: StudioStyleChoice) => void;
  readonly resolvedStyle: MarketingProStyle | null;
  readonly origin: StudioStyleOrigin;
  readonly intent: MarketingCampaignIntentId;
  readonly onIntent: (intent: MarketingCampaignIntentId) => void;
  readonly intensity: AdsProIntensity | undefined;
  readonly onIntensity: (intensity: AdsProIntensity | undefined) => void;
  readonly format: AdsProFormat;
  readonly onFormat: (format: AdsProFormat) => void;
  readonly facts: AdsProProductFacts | null;
  readonly onNext: () => void;
}) {
  const hint = intentHint(intent, facts);
  const originText = origin === "chosen"
    ? "Escolhido por você para este anúncio."
    : origin === "profile"
      ? "Baseado no seu perfil criativo."
      : "Sugestão para a categoria do produto. Faça o teste de estilo acima para personalizar.";
  return (
    <div className="space-y-4" data-testid="studio-step-style">
      <section aria-labelledby="studio-style-title" className="space-y-2">
        <h3 id="studio-style-title" className="text-xs font-black text-foreground">Estilo deste anúncio</h3>
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 hide-scrollbar" role="group" aria-label="Estilo do anúncio">
          <StudioChip selected={styleChoice === "profile"} onClick={() => onStyleChoice("profile")} testId="studio-style-profile">Do meu perfil</StudioChip>
          {STUDIO_STYLES.map((style) => (
            <StudioChip key={style} selected={styleChoice === style} onClick={() => onStyleChoice(style)} testId={`studio-style-${style}`}>{getAdsProStyleLabel(style)}</StudioChip>
          ))}
        </div>
        {resolvedStyle && (
          <p className="text-[11px] leading-snug text-muted-foreground" data-testid="studio-style-summary" data-style-origin={origin} data-resolved-style={resolvedStyle}>
            <strong className="font-bold text-foreground">{getAdsProStyleLabel(resolvedStyle)}.</strong> {getAdsProStyleDescription(resolvedStyle)} {originText}
          </p>
        )}
      </section>

      <section aria-labelledby="studio-intent-title" className="space-y-2">
        <h3 id="studio-intent-title" className="text-xs font-black text-foreground">Objetivo</h3>
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 hide-scrollbar" role="group" aria-label="Objetivo do anúncio">
          {STUDIO_INTENTS.map((item) => (
            <StudioChip key={item.id} selected={intent === item.id} onClick={() => onIntent(item.id)} testId={`studio-intent-${item.id}`}>{item.label}</StudioChip>
          ))}
        </div>
        {hint && <StudioBanner tone="info" testId="studio-intent-hint">{hint}</StudioBanner>}
      </section>

      <section aria-labelledby="studio-intensity-title" className="space-y-2">
        <h3 id="studio-intensity-title" className="text-xs font-black text-foreground">Intensidade do visual</h3>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Intensidade do visual">
          <StudioChip selected={intensity === undefined} onClick={() => onIntensity(undefined)} testId="studio-intensity-auto">Automática</StudioChip>
          {([1, 2, 3] as const).map((level) => (
            <StudioChip key={level} selected={intensity === level} onClick={() => onIntensity(level)} testId={`studio-intensity-${level}`}>{ADS_PRO_INTENSITY_LABELS[level]}</StudioChip>
          ))}
        </div>
      </section>

      <section aria-labelledby="studio-format-title" className="space-y-2">
        <h3 id="studio-format-title" className="text-xs font-black text-foreground">Formato</h3>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Formato do anúncio">
          {ADS_PRO_FORMATS.map((item) => (
            <StudioChip key={item} selected={format === item} onClick={() => onFormat(item)} testId={`studio-format-${item}`}>{ADS_PRO_FORMAT_LABELS[item]}</StudioChip>
          ))}
        </div>
      </section>

      <StudioPrimaryButton onClick={onNext} testId="studio-next-style">Ver as opções</StudioPrimaryButton>
    </div>
  );
}
