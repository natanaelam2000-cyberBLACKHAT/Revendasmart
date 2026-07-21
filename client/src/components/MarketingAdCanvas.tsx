import { useEffect, useState } from "react";
import { buildMarketingAdVisualModel, getMarketingAdImageCandidates, type MarketingAdConfig } from "@/lib/marketing-ad";

type MarketingAdCanvasProps = {
  config: MarketingAdConfig;
  compact?: boolean;
  onCtaClick?: () => void;
  onImageError?: () => void;
  onImageLoad?: () => void;
};

export function MarketingAdCanvas({ config, compact = false, onCtaClick, onImageError, onImageLoad }: MarketingAdCanvasProps) {
  const model = buildMarketingAdVisualModel(config);
  const { theme, logoSrc, storeInitial, features, ctaText, description, badgeText } = model;
  const imageCandidates = getMarketingAdImageCandidates(model.config);
  const imageKey = imageCandidates.join("|");
  const [imageCandidateIndex, setImageCandidateIndex] = useState(0);
  const [imageFailed, setImageFailed] = useState(false);
  const imageSrc = imageFailed ? "" : imageCandidates[imageCandidateIndex] || "";
  const hasConfiguredImage = imageCandidates.length > 0;
  const canClickCta = Boolean(onCtaClick && ctaText);

  useEffect(() => {
    setImageCandidateIndex(0);
    setImageFailed(false);
  }, [imageKey]);

  const handleImageError = () => {
    if (imageCandidateIndex + 1 < imageCandidates.length) {
      setImageCandidateIndex((current) => current + 1);
      return;
    }
    setImageFailed(true);
    onImageError?.();
  };

  const handleImageLoad = () => {
    setImageFailed(false);
    onImageLoad?.();
  };

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
              <img src={imageSrc} alt={config.productName} loading="lazy" decoding="async" onLoad={handleImageLoad} onError={handleImageError} />
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
  );
}
