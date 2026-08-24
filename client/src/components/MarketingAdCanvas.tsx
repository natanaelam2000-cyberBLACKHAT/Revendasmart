import type { CSSProperties } from "react";
import { buildMarketingAdVisualModel, getMarketingAdImageCandidates, type MarketingAdConfig } from "@/lib/marketing-ad";
import { ART_ELEVATION, ART_FONT_FAMILY, ART_LAYOUT, ART_SIZE, getArtBadgeFontSize, getArtBadgeLabel, getArtCardPadding, getArtColumnGap, getArtColumnWidths, getArtCtaFontSize, getArtHeadlineFontSize, getArtInkColor, getArtPriceFontSize, getArtReadableAccent, getPhotoBoxAspectRatio } from "@/lib/marketing-art-layout";
import { getMarketingProductPreviewGeometry, type PreparedMarketingProductImage } from "@/lib/marketing-product-preservation";

/**
 * Medição do preço no Preview.
 *
 * O Preview é DOM, mas a decisão de tamanho precisa ser a MESMA do PNG — então ele mede pelo mesmo
 * caminho (contexto 2D) e com a mesma família da arte exportada, em vez de inventar uma regra
 * própria por contagem de caracteres. O contexto é criado uma única vez e só serve para medir.
 */
let measurementContext: CanvasRenderingContext2D | null | undefined;
function measureArtText(text: string, fontSizePx: number): number {
  if (measurementContext === undefined) {
    measurementContext = typeof document === "undefined" ? null : document.createElement("canvas").getContext("2d");
  }
  if (!measurementContext) return 0;
  measurementContext.font = `900 ${fontSizePx}px ${ART_FONT_FAMILY}`;
  return measurementContext.measureText(text).width;
}

type MarketingAdCanvasProps = {
  config: MarketingAdConfig;
  compact?: boolean;
  onCtaClick?: () => void;
  preparedProductImage?: PreparedMarketingProductImage | null;
  imageStatus?: "idle" | "resolving" | "ready" | "error";
};

export function MarketingAdCanvas({ config, compact = false, onCtaClick, preparedProductImage = null, imageStatus = "idle" }: MarketingAdCanvasProps) {
  const model = buildMarketingAdVisualModel(config, { resolvedImageSrc: preparedProductImage?.resolvedImage.safeSrc || "" });
  const { theme, logoSrc, storeInitial, features, ctaText, description, badgeText, template } = model;
  const imageCandidates = getMarketingAdImageCandidates(model.config);
  const previewGeometry = preparedProductImage ? getMarketingProductPreviewGeometry(preparedProductImage) : null;
  const hasConfiguredImage = imageCandidates.length > 0;
  const canClickCta = Boolean(onCtaClick && ctaText);
  // As proporcoes vem do MESMO spec que o PNG usa. Antes, o CSS carregava numeros proprios e a caixa
  // da foto ficava com 53% da area do card no Preview contra 38% no PNG — era essa diferenca que
  // fazia o produto "encolher" ao compartilhar.
  const columns = getArtColumnWidths();
  const columnGap = getArtColumnGap();
  const cardPadding = getArtCardPadding();
  // Os corpos de texto saem das MESMAS regras que o PNG usa e são expressos em cqw — fração da
  // largura da arte —, então o Preview reduzido na tela mantém a hierarquia do PNG de 1080.
  const cqw = (artPx: number) => `${((artPx / ART_SIZE) * 100).toFixed(4)}cqw`;
  const badgeLabel = getArtBadgeLabel(badgeText);
  const artVars = {
    // Larguras DECLARADAS, não proporções em fr: o contrato diz quanto cada coluna vale.
    "--art-text-col-w": cqw(columns.text * ART_SIZE),
    "--art-photo-col-w": cqw(columns.photo * ART_SIZE),
    "--art-col-gap": cqw(columnGap * ART_SIZE),
    "--art-card-pad-left": cqw(cardPadding.left * ART_SIZE),
    "--art-card-pad-right": cqw(cardPadding.right * ART_SIZE),
    "--art-photo-aspect": String(getPhotoBoxAspectRatio()),
    "--art-price-size": cqw(getArtPriceFontSize(config.priceText, measureArtText)),
    "--art-headline-size": cqw(getArtHeadlineFontSize(config.headline, measureArtText)),
    "--art-cta-size": cqw(getArtCtaFontSize(ctaText || "", measureArtText)),
    "--art-badge-size": cqw(getArtBadgeFontSize(badgeLabel, measureArtText)),
  } as CSSProperties;
  // A folga interna da caixa da foto também vem do contrato: é ela que define o quanto o produto
  // ocupa, e Preview e PNG precisam usar exatamente a mesma.
  const photoBoxVars = {
    "--art-photo-inset-x": cqw(ART_LAYOUT.photo.insetX * ART_SIZE),
    "--art-photo-inset-y": cqw(ART_LAYOUT.photo.insetY * ART_SIZE),
    // O recuo e o raio do card também saem do contrato, em vez de literais próprios do CSS.
    "--art-card-inset": cqw(ART_LAYOUT.card.inset * ART_SIZE),
    "--art-card-radius": cqw(ART_LAYOUT.card.radius * ART_SIZE),
  } as CSSProperties;
  // Selo e CTA: mesmas cores, mesma tinta por contraste e mesma elevação do PNG. A tinta é calculada
  // a partir do fundo, então o contraste não depende de uma única cor de tema.
  //
  // PRO-04: badgeVariant/frameVariant/priceVariant espelham EXATAMENTE o que marketing-card.ts desenha
  // no PNG — mesma leitura de `template`, mesmos defaults ("solid"/"plain"/"standard" → visual atual,
  // zero mudança para os 10 templates Free) — nunca uma segunda regra de estilo inventada aqui.
  const badgeOutline = template.badgeVariant === "outline";
  const frameAccent = template.frameVariant === "accent-frame";
  const priceHighlight = template.priceVariant === "highlight";
  const emphasisVars = {
    "--art-badge-bg": badgeOutline ? "rgba(255,255,255,.92)" : theme.accent,
    "--art-badge-ink": badgeOutline ? theme.accent : getArtInkColor(theme.accent),
    "--art-badge-border": badgeOutline ? theme.accent : "transparent",
    "--art-badge-border-width": badgeOutline ? cqw(4) : "0",
    "--art-badge-shadow": `0 ${cqw(ART_ELEVATION.badge.offsetY * ART_SIZE)} ${cqw(ART_ELEVATION.badge.blur * ART_SIZE)} ${ART_ELEVATION.badge.color}`,
    "--art-cta-bg": theme.cta,
    "--art-cta-ink": getArtInkColor(theme.cta),
    "--art-cta-shadow": `0 ${cqw(ART_ELEVATION.cta.offsetY * ART_SIZE)} ${cqw(ART_ELEVATION.cta.blur * ART_SIZE)} ${ART_ELEVATION.cta.color}`,
    "--art-cta-height": cqw(ART_LAYOUT.text.cta.height * ART_SIZE),
    "--art-cta-radius": cqw(ART_LAYOUT.text.cta.radius * ART_SIZE),
    "--art-badge-height": cqw(ART_LAYOUT.header.badge.height * ART_SIZE),
    "--art-badge-padding": cqw(ART_LAYOUT.header.badge.paddingX * ART_SIZE),
    // Chamada: acento legível sobre o card claro + o mesmo traço de destaque desenhado no PNG.
    "--art-headline-ink": getArtReadableAccent(theme.accent),
    "--art-headline-bar-w": cqw(ART_LAYOUT.text.headline.accentBar.width * ART_SIZE),
    "--art-headline-bar-h": cqw(ART_LAYOUT.text.headline.accentBar.height * ART_SIZE),
    "--art-headline-bar-gap": cqw((ART_LAYOUT.text.headline.accentBar.offsetY - ART_LAYOUT.text.headline.accentBar.height) * ART_SIZE),
    // Moldura da foto: mesma caixa/posição (photoBoxVars abaixo não muda), só o traço/glow ao redor.
    // "plain" NÃO define a variável — o default do CSS (1px fixo, sem escala) fica intocado, pixel a
    // pixel igual ao visual anterior. Só "accent-frame" (Pro) sobrescreve, na MESMA proporção (5/1080)
    // usada pelo `lineWidth` do PNG — a única forma de garantir a mesma espessura relativa nos dois.
    ...(frameAccent
      ? {
          "--art-frame-border-width": cqw(5),
          "--art-frame-shadow": `0 0 ${cqw(30)} ${theme.accent}55, inset 0 2px 8px hsl(var(--foreground)/.07)`,
        }
      : {}),
    // Preço: pílula suave atrás do valor, dimensionada pelo próprio texto (nunca um tamanho fixo).
    "--art-price-bg": priceHighlight ? `${theme.accent}22` : "transparent",
    "--art-price-pad-x": priceHighlight ? cqw(16) : "0",
    "--art-price-pad-y": priceHighlight ? cqw(10) : "0",
    "--art-price-radius": priceHighlight ? cqw(18) : "0",
  } as CSSProperties;

  return (
    // `ma27` existe só para SER o quadrado da arte: sem padding, sem borda, e é ela que carrega o
    // `container-type`. Enquanto o próprio card era o container de consulta, todo `cqw` resolvia
    // contra o content box dele — o quadrado MENOS o recuo — e o Preview saía menor que o contrato.
    // Pior: um container não pode usar as próprias unidades de consulta para dimensionar a si mesmo,
    // então o recuo em `cqw` caía para a viewport e o desvio variava com o tamanho da tela.
    <div className={`ma27${compact ? " ma12" : ""}`} style={{ ...artVars, ...photoBoxVars, ...emphasisVars }}>
      <article
        data-testid="marketing-ad-canvas"
        className="ma24"
        // `outlineColor` e não `borderColor`: a moldura passou a ser outline justamente para não
        // consumir o content box — uma borda de 1px deslocava as colunas em ~2 unidades da arte.
        style={{ outlineColor: theme.ring, color: theme.foreground }}
        aria-label={`Preview do anúncio ${config.productName}`}
        data-image-status={imageStatus}
      >
      <div className="ma17">
        <header className="ma14">
          <div className="ma6">
            <div className="ma20" style={{ borderColor: theme.ring, color: theme.accent }}>
              {logoSrc ? <img src={logoSrc} alt="Logo da loja" loading="lazy" decoding="async" /> : storeInitial}
            </div>
            <div className="ma3">
              <p className="ma5">{config.storeName}</p>
              <p className="ma10">Loja oficial</p>
            </div>
          </div>
          <span className="ma18">{badgeLabel}</span>
        </header>

        <div className="ma21">
          <section className="ma11">
            <p className="ma8">{config.headline}</p>
            <h3 className="ma9">{config.productName}</h3>
            {description && <p className="ma19">{description}</p>}
            <p className="ma15" style={{ color: theme.foreground }}>{config.priceText}</p>
            {features.length > 0 && (
              <div className="ma16" aria-label="Características do anúncio">
                {features.map((feature) => (
                  <span key={feature.text} className={feature.highlight ? "ma25" : ""}>
                    <b>{feature.icon}</b>{feature.text}
                  </span>
                ))}
              </div>
            )}
            {ctaText && (
              <button
                type="button"
                className="ma23"
                onClick={onCtaClick}
                disabled={!canClickCta}
                aria-label={`${ctaText} sobre ${config.productName}`}
              >
                {ctaText}
              </button>
            )}
          </section>

          <div className="ma4" style={{ borderColor: frameAccent ? theme.accent : theme.ring }}>
            {preparedProductImage && previewGeometry ? (
              <img
                className="ma-product-image"
                src={preparedProductImage.resolvedImage.safeSrc}
                alt={config.productName}
                loading="lazy"
                decoding="async"
                data-product-asset-id={preparedProductImage.asset.assetId}
                style={{
                  left: cqw(previewGeometry.x),
                  top: cqw(previewGeometry.y),
                  width: cqw(previewGeometry.width),
                  height: cqw(previewGeometry.height),
                }}
              />
            ) : hasConfiguredImage && imageStatus === "resolving" ? (
              <div className="ma2" style={{ color: theme.muted }} role="status">Preparando foto...</div>
            ) : hasConfiguredImage ? (
              <div className="ma2 ma2-failed" aria-hidden="true" />
            ) : (
              <div className="ma2" style={{ color: theme.muted }}>
                <span>📦</span>Produto sem imagem
              </div>
            )}
          </div>
        </div>
        <div className="ma26" aria-label="Criado com Revenda Smart">
          <img src="/logo-revenda-smart-symbol.png" alt="" aria-hidden="true" loading="lazy" decoding="async" />
          <span>Criado com Revenda Smart</span>
        </div>
      </div>
      </article>
    </div>
  );
}
