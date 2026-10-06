import { Redo2, Undo2 } from "lucide-react";
import {
  ADS_PRO_TEXT_LIMITS,
  type AdsProAdDocumentV1,
  type AdsProAdText,
  type AdsProAdVisibility,
} from "@shared/ads-pro/ad-document";
import type { AdsProProductFacts } from "@shared/ads-pro/ad-product-facts";
import {
  ADS_PRO_ARCHETYPE_LABELS,
  ADS_PRO_CTA_SHAPES,
  ADS_PRO_DECORATIONS,
  ADS_PRO_LAYOUT_ARCHETYPES,
  ADS_PRO_PRICE_STYLES,
} from "@shared/ads-pro/ad-style-direction";
import { CTA_SHAPE_LABELS, DECORATION_LABELS, PRICE_STYLE_LABELS } from "./studio-shared";
import type { StudioCanvasReport } from "./AdsProStudioCanvas";
import { StudioBanner, StudioChip, StudioField, StudioPrimaryButton, studioInputClass } from "./StudioPrimitives";

function TextRow({
  label,
  value,
  limit,
  visible,
  onChange,
  onToggle,
  testId,
  placeholder,
}: {
  readonly label: string;
  readonly value: string;
  readonly limit: number;
  readonly visible?: boolean;
  readonly onChange: (value: string) => void;
  readonly onToggle?: () => void;
  readonly testId: string;
  readonly placeholder?: string;
}) {
  return (
    <div className="space-y-1.5">
      <StudioField label={label} hint={`${value.length}/${limit}`}>
        <input
          type="text"
          value={value}
          maxLength={limit}
          placeholder={placeholder}
          disabled={visible === false}
          onChange={(event) => onChange(event.target.value)}
          className={`${studioInputClass} disabled:opacity-50`}
          data-testid={testId}
        />
      </StudioField>
      {onToggle && (
        <StudioChip selected={visible !== false} onClick={onToggle} testId={`${testId}-toggle`}>{visible === false ? "Mostrar" : "Mostrando"}</StudioChip>
      )}
    </div>
  );
}

export function StudioEditStep({
  doc,
  facts,
  hasLogo,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onText,
  onVisibility,
  onRestoreText,
  onArchetype,
  onDirection,
  report,
  onNext,
}: {
  readonly doc: AdsProAdDocumentV1;
  readonly facts: AdsProProductFacts | null;
  readonly hasLogo: boolean;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly onUndo: () => void;
  readonly onRedo: () => void;
  readonly onText: (patch: Partial<AdsProAdText>, key: string) => void;
  readonly onVisibility: (patch: Partial<AdsProAdVisibility>) => void;
  readonly onRestoreText: () => void;
  readonly onArchetype: (archetype: AdsProAdDocumentV1["direction"]["archetype"]) => void;
  readonly onDirection: (patch: Partial<Pick<AdsProAdDocumentV1["direction"], "priceStyle" | "ctaShape" | "decoration">>) => void;
  readonly report: StudioCanvasReport | null;
  readonly onNext: () => void;
}) {
  const hasPrice = facts?.price != null;
  const truncated = report?.issues.some((issue) => issue.code === "TEXT_OVERFLOW") ?? false;
  const critical = report?.criticalIssues ?? 0;
  return (
    <div className="space-y-4" data-testid="studio-step-edit">
      <div className="grid grid-cols-2 gap-2">
        <StudioPrimaryButton tone="outline" onClick={onUndo} disabled={!canUndo} testId="studio-undo"><Undo2 className="h-4 w-4" aria-hidden="true" /> Desfazer</StudioPrimaryButton>
        <StudioPrimaryButton tone="outline" onClick={onRedo} disabled={!canRedo} testId="studio-redo"><Redo2 className="h-4 w-4" aria-hidden="true" /> Refazer</StudioPrimaryButton>
      </div>

      {critical > 0 && <StudioBanner tone="warning" testId="studio-layout-warning">Este layout ficou apertado. Encurte algum texto ou troque a composição abaixo.</StudioBanner>}
      {truncated && <StudioBanner tone="info" testId="studio-text-truncated">Algum texto foi encurtado com “…” para caber. Reduza o texto para ele aparecer inteiro.</StudioBanner>}

      <section className="space-y-3" aria-labelledby="studio-texts-title">
        <h3 id="studio-texts-title" className="text-xs font-black text-foreground">Textos</h3>
        <TextRow label="Título" value={doc.text.headline} limit={ADS_PRO_TEXT_LIMITS.headline} onChange={(value) => onText({ headline: value }, "text-headline")} testId="studio-text-headline" />
        <TextRow label="Subtítulo" value={doc.text.subtitle} limit={ADS_PRO_TEXT_LIMITS.subtitle} visible={doc.show.subtitle} onToggle={() => onVisibility({ subtitle: !doc.show.subtitle })} onChange={(value) => onText({ subtitle: value }, "text-subtitle")} testId="studio-text-subtitle" />
        <TextRow label="Chamada (acima do título)" value={doc.text.kicker} limit={ADS_PRO_TEXT_LIMITS.kicker} visible={doc.show.kicker} onToggle={() => onVisibility({ kicker: !doc.show.kicker })} onChange={(value) => onText({ kicker: value }, "text-kicker")} testId="studio-text-kicker" />
        <TextRow label="Botão" value={doc.text.ctaText} limit={ADS_PRO_TEXT_LIMITS.ctaText} visible={doc.show.cta} onToggle={() => onVisibility({ cta: !doc.show.cta })} onChange={(value) => onText({ ctaText: value }, "text-cta")} testId="studio-text-cta" />
        <StudioPrimaryButton tone="outline" onClick={onRestoreText} testId="studio-restore-text">Restaurar textos do produto</StudioPrimaryButton>
      </section>

      <section className="space-y-2" aria-labelledby="studio-price-title">
        <h3 id="studio-price-title" className="text-xs font-black text-foreground">Preço</h3>
        {hasPrice ? (
          <>
            <p className="rounded-xl border border-border/60 bg-background px-3 py-2 text-sm font-black text-foreground" data-testid="studio-price-readonly">
              {doc.text.priceText || "—"}
              {doc.text.oldPriceText && <span className="ml-2 text-xs font-semibold text-muted-foreground line-through">{doc.text.oldPriceText.replace(/^de\s+/i, "")}</span>}
            </p>
            <p className="text-[10px] leading-snug text-muted-foreground">O preço vem do cadastro do produto e não é editado aqui — assim o anúncio nunca diverge do catálogo.</p>
            <div className="flex flex-wrap gap-2">
              <StudioChip selected={doc.show.price} onClick={() => onVisibility({ price: !doc.show.price })} testId="studio-show-price">{doc.show.price ? "Preço visível" : "Preço escondido"}</StudioChip>
              {doc.text.badgeText && (
                <StudioChip selected={doc.show.badge} onClick={() => onVisibility({ badge: !doc.show.badge })} disabled={!doc.show.price} testId="studio-show-badge">{doc.show.badge ? `Selo ${doc.text.badgeText}` : "Selo escondido"}</StudioChip>
              )}
            </div>
          </>
        ) : (
          <StudioBanner tone="info" testId="studio-price-missing">Este produto não tem preço cadastrado — o anúncio sai sem preço. Cadastre o preço no produto se quiser exibi-lo.</StudioBanner>
        )}
        {hasLogo && (
          <StudioChip selected={doc.show.logo} onClick={() => onVisibility({ logo: !doc.show.logo })} testId="studio-show-logo">{doc.show.logo ? "Logo visível" : "Logo escondido"}</StudioChip>
        )}
      </section>

      <section className="space-y-2" aria-labelledby="studio-layout-title">
        <h3 id="studio-layout-title" className="text-xs font-black text-foreground">Composição</h3>
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 hide-scrollbar" role="group" aria-label="Composição do anúncio">
          {ADS_PRO_LAYOUT_ARCHETYPES.map((archetype) => (
            <StudioChip key={archetype} selected={doc.direction.archetype === archetype} onClick={() => onArchetype(archetype)} disabled={archetype === "price-burst" && !hasPrice} title={archetype === "price-burst" && !hasPrice ? "Precisa de preço cadastrado" : undefined} testId={`studio-archetype-${archetype}`}>{ADS_PRO_ARCHETYPE_LABELS[archetype]}</StudioChip>
          ))}
        </div>
        {hasPrice && doc.show.price && (
          <>
            <p className="text-[11px] font-bold text-foreground">Estilo do preço</p>
            <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 hide-scrollbar" role="group" aria-label="Estilo do preço">
              {ADS_PRO_PRICE_STYLES.map((style) => (
                <StudioChip key={style} selected={doc.direction.priceStyle === style} onClick={() => onDirection({ priceStyle: style })} testId={`studio-price-style-${style}`}>{PRICE_STYLE_LABELS[style]}</StudioChip>
              ))}
            </div>
          </>
        )}
        {doc.show.cta && (
          <>
            <p className="text-[11px] font-bold text-foreground">Formato do botão</p>
            <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 hide-scrollbar" role="group" aria-label="Formato do botão">
              {ADS_PRO_CTA_SHAPES.map((shape) => (
                <StudioChip key={shape} selected={doc.direction.ctaShape === shape} onClick={() => onDirection({ ctaShape: shape })} testId={`studio-cta-shape-${shape}`}>{CTA_SHAPE_LABELS[shape]}</StudioChip>
              ))}
            </div>
          </>
        )}
        <p className="text-[11px] font-bold text-foreground">Detalhe decorativo</p>
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 hide-scrollbar" role="group" aria-label="Detalhe decorativo">
          {ADS_PRO_DECORATIONS.map((decoration) => (
            <StudioChip key={decoration} selected={doc.direction.decoration === decoration} onClick={() => onDirection({ decoration })} testId={`studio-decoration-${decoration}`}>{DECORATION_LABELS[decoration]}</StudioChip>
          ))}
        </div>
      </section>

      <StudioPrimaryButton onClick={onNext} testId="studio-next-edit">Continuar para salvar</StudioPrimaryButton>
    </div>
  );
}
