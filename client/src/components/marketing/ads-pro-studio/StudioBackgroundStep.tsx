import { useMemo, useState } from "react";
import type { AdsProFormat } from "@shared/ads-pro/ad-document";
import type { AdsProBackgroundSuggestion } from "@shared/ads-pro/ad-variations";
import type { MarketingProBackgroundAsset } from "@shared/marketing-pro-background-library";
import { getAdsProStyleLabel } from "@/lib/ads-pro-style-presentation";
import type { MarketingProStyle } from "@shared/marketing-pro-contract";
import { StudioBackgroundSwatch } from "./AdsProStudioCanvas";
import { useStaticBackgroundImage } from "./use-studio-assets";
import { StudioBanner, StudioChip, StudioPrimaryButton } from "./StudioPrimitives";

type Filter = "recommended" | "all" | "colors" | "scenes";

const PAGE_SIZE = 24;
const MIN_RECOMMENDED = 6;

export function labelBackgrounds(suggestions: readonly AdsProBackgroundSuggestion[]): ReadonlyMap<string, string> {
  const counters = new Map<string, number>();
  const labels = new Map<string, string>();
  suggestions.forEach((item) => {
    const family = String(item.asset.family);
    const next = (counters.get(family) ?? 0) + 1;
    counters.set(family, next);
    labels.set(item.asset.id, `${getAdsProStyleLabel(family as MarketingProStyle)} ${next}`);
  });
  return labels;
}

function BackgroundOption({
  asset,
  label,
  selected,
  recommended,
  format,
  onPick,
}: {
  readonly asset: MarketingProBackgroundAsset;
  readonly label: string;
  readonly selected: boolean;
  readonly recommended: boolean;
  readonly format: AdsProFormat;
  readonly onPick: (asset: MarketingProBackgroundAsset) => void;
}) {
  const thumb = useStaticBackgroundImage(asset, "thumbnail");
  return (
    <li className="min-w-0">
      <button
        type="button"
        onClick={() => onPick(asset)}
        aria-pressed={selected}
        aria-label={`Fundo ${label}${recommended ? " (recomendado)" : ""}`}
        data-testid={`studio-background-${asset.id}`}
        data-background-id={asset.id}
        data-background-source={asset.sourceType}
        data-selected={selected}
        className={`block min-h-11 w-full min-w-0 rounded-xl border-2 p-1 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${selected ? "border-primary bg-primary/5" : "border-border/60 bg-background hover:border-primary/50"}`}
      >
        <StudioBackgroundSwatch asset={asset} format={format} image={thumb.image} width={180} />
        <span className="mt-1 block truncate px-0.5 text-[10px] font-bold text-foreground">{label}</span>
        {recommended && <span className="block px-0.5 text-[9px] font-semibold text-primary">Recomendado</span>}
      </button>
    </li>
  );
}

export function StudioBackgroundStep({
  suggestions,
  currentId,
  format,
  backgroundMissing,
  staticStatus,
  onPick,
  onNext,
}: {
  readonly suggestions: readonly AdsProBackgroundSuggestion[];
  readonly currentId: string;
  readonly format: AdsProFormat;
  readonly backgroundMissing: boolean;
  readonly staticStatus: "none" | "loading" | "ready" | "failed";
  readonly onPick: (asset: MarketingProBackgroundAsset) => void;
  readonly onNext: () => void;
}) {
  const [filter, setFilter] = useState<Filter>("recommended");
  const [visible, setVisible] = useState(PAGE_SIZE);
  const labels = useMemo(() => labelBackgrounds(suggestions), [suggestions]);
  const hasScenes = suggestions.some((item) => item.asset.sourceType === "STATIC_ASSET");
  const hasColors = suggestions.some((item) => item.asset.sourceType === "GENERATED_DETERMINISTIC");

  const filtered = useMemo(() => {
    const recommendedIds = new Set(suggestions.filter((item, index) => item.tierIndex === 0 || index < MIN_RECOMMENDED).map((item) => item.asset.id));
    const isRecommended = (item: AdsProBackgroundSuggestion) => recommendedIds.has(item.asset.id);
    const list = suggestions.filter((item) => {
      if (filter === "recommended") return isRecommended(item);
      if (filter === "colors") return item.asset.sourceType === "GENERATED_DETERMINISTIC";
      if (filter === "scenes") return item.asset.sourceType === "STATIC_ASSET";
      return true;
    });
    return list.map((item) => ({ item, recommended: isRecommended(item) }));
  }, [filter, suggestions]);

  const shown = filtered.slice(0, visible);
  const changeFilter = (next: Filter) => {
    setFilter(next);
    setVisible(PAGE_SIZE);
  };

  return (
    <div className="space-y-3" data-testid="studio-step-background">
      <p className="text-[11px] leading-snug text-muted-foreground">
        Cada opção já veio com um fundo que combina com o produto. Aqui você troca só o fundo, sem perder o resto — é grátis e não usa créditos.
      </p>
      {backgroundMissing && <StudioBanner tone="warning" testId="studio-background-missing">O fundo salvo neste anúncio não está mais disponível — usamos um equivalente. Escolha outro abaixo, se preferir.</StudioBanner>}
      {staticStatus === "failed" && <StudioBanner tone="warning" testId="studio-background-load-failed">Este fundo não carregou — mostramos um fundo neutro no lugar. Tente outro ou toque de novo mais tarde.</StudioBanner>}

      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 hide-scrollbar" role="group" aria-label="Filtrar fundos">
        <StudioChip selected={filter === "recommended"} onClick={() => changeFilter("recommended")} testId="studio-bg-filter-recommended">Recomendados</StudioChip>
        <StudioChip selected={filter === "all"} onClick={() => changeFilter("all")} testId="studio-bg-filter-all">Todos ({suggestions.length})</StudioChip>
        {hasColors && hasScenes && <StudioChip selected={filter === "colors"} onClick={() => changeFilter("colors")} testId="studio-bg-filter-colors">Cores</StudioChip>}
        {hasColors && hasScenes && <StudioChip selected={filter === "scenes"} onClick={() => changeFilter("scenes")} testId="studio-bg-filter-scenes">Cenários</StudioChip>}
      </div>

      {shown.length === 0 ? (
        <StudioBanner tone="info" testId="studio-background-empty">Nenhum fundo neste filtro.</StudioBanner>
      ) : (
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4" data-testid="studio-background-grid" aria-label="Fundos disponíveis">
          {shown.map(({ item, recommended }) => (
            <BackgroundOption
              key={item.asset.id}
              asset={item.asset}
              label={labels.get(item.asset.id) ?? item.asset.id}
              selected={item.asset.id === currentId}
              recommended={recommended}
              format={format}
              onPick={onPick}
            />
          ))}
        </ul>
      )}
      {filtered.length > visible && (
        <StudioPrimaryButton tone="outline" onClick={() => setVisible((value) => value + PAGE_SIZE)} testId="studio-bg-more">Ver mais fundos</StudioPrimaryButton>
      )}
      <StudioPrimaryButton onClick={onNext} testId="studio-next-background">Continuar para editar</StudioPrimaryButton>
    </div>
  );
}
