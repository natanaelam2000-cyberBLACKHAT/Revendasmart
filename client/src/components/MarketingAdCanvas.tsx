import { buildMarketingAdVisualModel, type MarketingAdConfig } from "@/lib/marketing-ad";

export function MarketingAdCanvas({ config, compact = false, onCtaClick }: { config: MarketingAdConfig; compact?: boolean; onCtaClick?: () => void }) {
  const model = buildMarketingAdVisualModel(config);
  const { theme, imageSrc, logoSrc, storeInitial, features, ctaText, description, badgeText } = model;
  const canClickCta = Boolean(onCtaClick && ctaText);

  return (
    <article
      data-testid="marketing-ad-canvas"
      className={`ma24${compact ? " ma12" : ""}`}
      style={{ borderColor: theme.ring, color: theme.foreground }}
      aria-label={`Preview do anúncio ${config.productName}`}
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
          <span className="ma18" style={{ backgroundColor: theme.accent }}>{badgeText}</span>
        </header>

        <div className="ma21">
          <section className="ma11">
            <p className="ma8" style={{ color: theme.accent }}>{config.headline}</p>
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

          <div className="ma4" style={{ borderColor: theme.ring }}>
            {imageSrc ? (
              <img src={imageSrc} alt={config.productName} loading="lazy" decoding="async" />
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
  );
}
