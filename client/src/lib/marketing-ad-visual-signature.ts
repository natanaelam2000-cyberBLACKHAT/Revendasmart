import { buildMarketingAdVisualModel, type MarketingAdInput } from "./marketing-ad";

export function buildMarketingAdVisualSignature(input: MarketingAdInput) {
  const model = buildMarketingAdVisualModel(input), { config, chips, ctaText, theme } = model;
  return {
    texts: [config.storeName, config.headline, config.productName, ...chips.map(chip => chip[0]), config.priceText, ctaText].filter(Boolean),
    flags: { brand: !!(config.showBrand && config.productBrand), volume: !!(config.showVolume && config.productVolume), stock: !!(config.showStockStatus && config.stockStatus), cta: !!ctaText },
    theme: theme.id,
    price: config.priceText,
  };
}
