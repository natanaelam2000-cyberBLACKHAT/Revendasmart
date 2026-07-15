import { getMarketingAdImageCandidates, resolveMarketingAdTheme, resolveMarketingTemplate, type MarketingAdConfig } from "@/lib/marketing-ad";

export function MarketingAdCanvas({ config, compact = false }: { config: MarketingAdConfig; compact?: boolean }) {
  const theme = resolveMarketingAdTheme(config.themeId, config.primaryColor);
  const template = resolveMarketingTemplate(config.templateId);
  const imageSrc = getMarketingAdImageCandidates(config)[0];
  const isDark = config.backgroundStyle === "dark-premium" || theme.darkMode;
  const logoSrc = config.storeLogoUrl || "";
  const storeInitial = (config.storeName || "R").trim().slice(0, 1).toUpperCase();

  return (
    <article
      data-testid="marketing-ad-canvas"
      className={`ma24${compact ? " ma12" : ""}`}
      style={{ background: theme.background, borderColor: theme.ring, color: theme.foreground }}
      aria-label={`Preview do anúncio ${config.productName}`}
    >
      <div className="ma22 ma7" style={{ backgroundColor: theme.accent }} />
      <div className="ma22 ma0" style={{ backgroundColor: theme.cta }} />
      <div
        className="ma17"
        style={{ backgroundColor: isDark ? "rgba(15,23,42,0.82)" : "rgba(255,255,255,0.88)", borderColor: theme.ring }}
      >
        <header className="ma14">
          <div className="ma6">
            <div className="ma20" style={{ borderColor: theme.ring, color: theme.accent }}>
              {logoSrc ? <img src={logoSrc} alt="Logo da loja" loading="lazy" decoding="async" /> : storeInitial}
            </div>
            <div className="ma3">
              <p className="ma5" style={{ color: theme.foreground }}>{config.storeName}</p>
              <p className="ma10" style={{ color: theme.muted }}>Revenda Smart</p>
            </div>
          </div>
          <span className="ma18" style={{ backgroundColor: theme.accent }}>{template.emoji} Oferta</span>
        </header>
        <div className="ma8" style={{ backgroundColor: theme.dark }}>{config.headline}</div>
        <div className="ma21">
          <div className="ma4" style={{ borderColor: theme.ring }}>
            {imageSrc ? (
              <img src={imageSrc} alt={config.productName} loading="lazy" decoding="async" />
            ) : (
              <div className="ma2" style={{ backgroundColor: theme.soft, color: theme.muted }}>
                <span>📦</span>Produto sem imagem
              </div>
            )}
          </div>
          <div className="ma11">
            <div className="ma16">
              {config.showStockStatus && config.stockStatus && <span style={{ backgroundColor: theme.cta, color: "white" }}>{config.stockStatus}</span>}
              {config.showBrand && config.productBrand && <span style={{ backgroundColor: theme.soft, color: theme.dark }}>{config.productBrand}</span>}
              {config.showVolume && config.productVolume && <span style={{ backgroundColor: theme.soft, color: theme.dark }}>{config.productVolume}</span>}
            </div>
            <h3 className="ma9" style={{ color: theme.foreground }}>{config.productName}</h3>
            {config.note && <p className="ma19" style={{ color: theme.muted }}>{config.note}</p>}
            <div className="ma13">
              <div>
                <p className="ma1" style={{ color: theme.muted }}>Por apenas</p>
                <p className="ma15" style={{ color: theme.accent }}>{config.priceText}</p>
              </div>
              {config.showWhatsAppCta && config.ctaText && <div className="ma23" style={{ backgroundColor: theme.cta }}>{config.ctaText}</div>}
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}
