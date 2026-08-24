import type { MarketingCampaignIntentId } from "@shared/marketing-pro-creative-intelligence";

/**
 * Faixa comercial do template. É METADADO do catálogo: nesta etapa não controla acesso, não é lido
 * por nenhum componente e não altera um pixel da arte. Existe para que a decisão de Free × Pro parta
 * da definição canônica, e nunca de listas paralelas de ids espalhadas pelo código.
 */
export type MarketingTemplateTier = "free" | "pro";
/**
 * PRO-04: eixos declarativos de composição visual do template — lidos pelos DOIS renderizadores
 * (MarketingAdCanvas.tsx no Preview, marketing-card.ts no PNG), nunca por um CSS/desenho ad hoc
 * específico de um template. Não movem nem redimensionam a caixa da foto (geometria aprovada em
 * marketing-art-layout.ts, preservação do produto intocada) — só mudam moldura/selo/realce do preço
 * ao redor dela, dentro do que a seção 0 desta tarefa permite (moldura, glow, gradiente, badge).
 *
 * `badgeVariant`: "solid" (selo preenchido, visual atual) | "outline" (selo com contorno, sem fundo).
 * `frameVariant`: "plain" (moldura atual) | "accent-frame" (moldura na cor de destaque + glow externo).
 * `priceVariant`: "standard" (visual atual) | "highlight" (pílula suave atrás do preço).
 *
 * Os 10 templates Free mantêm os três em seus valores atuais (`solid`/`plain`/`standard`) — zero
 * mudança visual para quem já usa o editor gratuito.
 */
export type MarketingTemplateBadgeVariant = "solid" | "outline";
export type MarketingTemplateFrameVariant = "plain" | "accent-frame";
export type MarketingTemplatePriceVariant = "standard" | "highlight";
/** Forma de cada entrada do catálogo, sem o id (que é a própria chave). */
type MarketingTemplateShape = {
  label: string;
  emoji: string;
  headline: string;
  tier: MarketingTemplateTier;
  badgeVariant: MarketingTemplateBadgeVariant;
  frameVariant: MarketingTemplateFrameVariant;
  priceVariant: MarketingTemplatePriceVariant;
};
export const MARKETING_TEMPLATES = {
  spotlight: { label: "Produto em destaque", emoji: "⭐", headline: "DESTAQUE DA LOJA!", tier: "free", badgeVariant: "solid", frameVariant: "plain", priceVariant: "standard" },
  promo: { label: "Oferta especial", emoji: "🏷️", headline: "OFERTA IMPERDÍVEL!", tier: "free", badgeVariant: "solid", frameVariant: "plain", priceVariant: "standard" },
  last: { label: "Últimas unidades", emoji: "🚨", headline: "CORRE QUE ESTÁ ACABANDO!", tier: "free", badgeVariant: "solid", frameVariant: "plain", priceVariant: "standard" },
  new: { label: "Lançamento", emoji: "✨", headline: "NOVIDADE CHEGANDO!", tier: "free", badgeVariant: "solid", frameVariant: "plain", priceVariant: "standard" },
  bestseller: { label: "Mais vendido", emoji: "🏆", headline: "O QUERIDINHO DAS CLIENTES!", tier: "free", badgeVariant: "solid", frameVariant: "plain", priceVariant: "standard" },
  kit: { label: "Kit promocional", emoji: "🎁", headline: "MONTE SEU KIT ESPECIAL!", tier: "free", badgeVariant: "solid", frameVariant: "plain", priceVariant: "standard" },
  catalog: { label: "Compre pelo catálogo", emoji: "🛒", headline: "PEÇA PELO CATÁLOGO ONLINE!", tier: "free", badgeVariant: "solid", frameVariant: "plain", priceVariant: "standard" },
  whatsapp: { label: "Chame no WhatsApp", emoji: "💬", headline: "ME CHAMA NO WHATSAPP!", tier: "free", badgeVariant: "solid", frameVariant: "plain", priceVariant: "standard" },
  delivery: { label: "Frete/entrega", emoji: "🚚", headline: "ENTREGA COMBINADA!", tier: "free", badgeVariant: "solid", frameVariant: "plain", priceVariant: "standard" },
  preorder: { label: "Encomendas abertas", emoji: "📦", headline: "ENCOMENDAS ABERTAS!", tier: "free", badgeVariant: "solid", frameVariant: "plain", priceVariant: "standard" },
  // --- PRO-04: templates Pro reais. Cada um combina os três eixos de forma única (nenhuma combinação
  // repete a de outro Pro, e nenhuma repete solid/plain/standard — o visual dos 10 Free acima) — a
  // diferenciação exigida pela tarefa vem da COMPOSIÇÃO declarativa, não de um desenho paralelo.
  premium_spotlight: { label: "Destaque Premium", emoji: "👑", headline: "DESTAQUE DO DIA", tier: "pro", badgeVariant: "outline", frameVariant: "accent-frame", priceVariant: "highlight" },
  elegant_offer: { label: "Oferta Elegante", emoji: "💎", headline: "UMA OFERTA ESPECIAL", tier: "pro", badgeVariant: "outline", frameVariant: "plain", priceVariant: "highlight" },
  luxury: { label: "Luxo", emoji: "🖤", headline: "SELEÇÃO ESPECIAL", tier: "pro", badgeVariant: "solid", frameVariant: "accent-frame", priceVariant: "highlight" },
  minimal_pro: { label: "Minimalista Pro", emoji: "◇", headline: "SIMPLES. DIRETO. ELEGANTE.", tier: "pro", badgeVariant: "outline", frameVariant: "plain", priceVariant: "standard" },
  promo_impact: { label: "Promo Impacto", emoji: "🔥", headline: "OFERTA IMPERDÍVEL", tier: "pro", badgeVariant: "solid", frameVariant: "accent-frame", priceVariant: "standard" },
} as const satisfies Record<MarketingCampaignIntentId, MarketingTemplateShape>;
export type MarketingTemplateId = MarketingCampaignIntentId;
/**
 * Definição canônica de um template. `resolveMarketingTemplate` já é o lookup único do projeto e
 * passa a devolver exatamente esta forma — por isso NÃO foi criado um segundo helper de busca.
 */
export interface MarketingTemplateDefinition extends MarketingTemplateShape { id: MarketingTemplateId }
export const MARKETING_AD_THEMES = { brand: { label: "Marca da loja", accent: "#ec4899" }, purple: { label: "Roxo premium", accent: "#6d5dfc" }, blue: { label: "Azul catálogo", accent: "#2563eb" }, green: { label: "Verde vendas", accent: "#16a34a" }, rose: { label: "Rosa venda", accent: "#ec4899" }, orange: { label: "Laranja energia", accent: "#f97316" }, black: { label: "Escuro premium", accent: "#a78bfa" } } as const;
export type MarketingAdThemeId = keyof typeof MARKETING_AD_THEMES;
export const MARKETING_AD_THEME_IDS = Object.keys(MARKETING_AD_THEMES) as MarketingAdThemeId[];
export type MarketingBackgroundStyle = "soft-gradient" | "clean-card" | "dark-premium";
export interface MarketingAdTheme { id: MarketingAdThemeId; label: string; accent: string; dark: string; soft: string; surface: string; foreground: string; muted: string; ring: string; cta: string; background: string; darkMode: boolean; }
export interface MarketingAdConfig { productId: string; productName: string; productBrand?: string; productImageUrl?: string; imageUrl?: string; photoUrl?: string; image?: string; imageId?: string; productVolume?: string; stockStatus?: string; price: string | number; priceText: string; headline: string; note?: string; ctaText?: string; storeName: string; storeLogoUrl?: string; primaryColor: string; templateId: MarketingTemplateId; template?: MarketingTemplateId; themeId: MarketingAdThemeId; showBrand: boolean; showVolume: boolean; showStockStatus: boolean; showWhatsAppCta: boolean; backgroundStyle: MarketingBackgroundStyle; catalogUrl?: string; }
export type MarketingAdInput = Omit<Partial<MarketingAdConfig>, "template" | "templateId" | "themeId"> & { template?: string; templateId?: string; themeId?: string; brand?: string; salePrice?: string | number; productStock?: number; productExtras?: Record<string, unknown>; };
const MONEY_FORMATTER = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const legacyMarketingPattern = (parts: string[], flags = "i") => new RegExp(parts.join(""), flags);
const LEGACY_MARKETING_TEXT_REPLACEMENTS = [
  [legacyMarketingPattern(["Pe", "ça pelo WhatsApp"], "gi"), "Chamar no WhatsApp"],
  [legacyMarketingPattern(["Pedir", " no WhatsApp"], "gi"), "Chamar no WhatsApp"],
] as const;
const LEGACY_MARKETING_LINES = [
  // PRO-04: a barra nunca teve efeito (dentro de uma string JS comum, "\." já vale só "."; o regex
  // final sempre casou "um caractere qualquer, opcional" no fim da frase). Só removida por ser
  // no-useless-escape do ESLint — o padrão compilado é byte a byte o mesmo de antes.
  legacyMarketingPattern(["Produto ", "selecionado para você ", "pedir direto pelo WhatsApp.?"]),
  legacyMarketingPattern(["Imagem ", "omitida; ", "arte gerada sem ela.?"]),
];
/**
 * PRO-04: substitui os dois regex de faixa de controle que batiam no no-control-regex do ESLint
 * (as faixas de codigo de controle) e a variante que preservava tab/LF/CR em texto gerado. Mesmo
 * comportamento, char a char: preserve e o conjunto de codigos que NAO viram espaco (so usado por
 * texto multilinha, que precisa manter as quebras de linha ate o split por linha mais adiante).
 */
function replaceControlChars(text: string, preserve?: ReadonlySet<number>): string {
  let out = "";
  for (const character of text) {
    const code = character.charCodeAt(0);
    const isControl = (code <= 0x1f || code === 0x7f) && !preserve?.has(code);
    out += isControl ? " " : character;
  }
  return out;
}
const GENERATED_TEXT_PRESERVED_CODES = new Set([0x09, 0x0a, 0x0d]);
export function sanitizeMarketingText(value: unknown, fallback = "", maxLength = 120) { const text = typeof value === "string" || typeof value === "number" ? String(value) : fallback; return replaceControlChars(text).replace(/\s+/g, " ").trim().slice(0, maxLength) || fallback; }
export function normalizeMarketingCtaText(value: unknown, fallback = "Chamar no WhatsApp") { let text = sanitizeMarketingText(value, fallback, 80); for (const [pattern, replacement] of LEGACY_MARKETING_TEXT_REPLACEMENTS) text = text.replace(pattern, replacement); return text.trim() || fallback; }
export function normalizeMarketingNote(value: unknown) { let text = sanitizeMarketingText(value, "", 110); for (const [pattern, replacement] of LEGACY_MARKETING_TEXT_REPLACEMENTS) text = text.replace(pattern, replacement); for (const pattern of LEGACY_MARKETING_LINES) text = text.replace(pattern, " "); return text.replace(/\s+/g, " ").trim(); }
export function normalizeMarketingGeneratedText(value: unknown) { let text = typeof value === "string" || typeof value === "number" ? String(value) : ""; text = replaceControlChars(text, GENERATED_TEXT_PRESERVED_CODES).slice(0, 4000); if (!text.trim()) return ""; for (const [pattern, replacement] of LEGACY_MARKETING_TEXT_REPLACEMENTS) text = text.replace(pattern, replacement); const lines = text.split(/\r?\n/).map((line) => line.replace(/\s+/g, " ").trim()).filter((line) => line && !LEGACY_MARKETING_LINES.some((pattern) => pattern.test(line))); return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim(); }
export function parseMarketingPriceNumber(value: unknown) { if (typeof value === "number") return Number.isFinite(value) ? value : 0; const raw = sanitizeMarketingText(value, "0", 40).replace(/R\$|\s/g, ""), normalized = raw.includes(",") ? raw.replace(/\./g, "").replace(",", ".") : raw, numeric = Number.parseFloat(normalized.replace(/[^0-9.-]/g, "")); return Number.isFinite(numeric) ? numeric : 0; }
export function formatMarketingPrice(value: unknown) { return MONEY_FORMATTER.format(parseMarketingPriceNumber(value)).replace(/\u00a0/g, " "); }
export function resolveMarketingTemplate(value: unknown): MarketingTemplateDefinition { const key = sanitizeMarketingText(value, "promo", 40) as MarketingTemplateId; return MARKETING_TEMPLATES[key] ? { id: key, ...MARKETING_TEMPLATES[key] } : { id: "promo" as const, ...MARKETING_TEMPLATES.promo }; }
/**
 * PRO-03/PRO-04: contrato de acesso por plano para o catálogo de templates. Conectado em
 * `pages/marketing.tsx` (único lugar da árvore que lê o plano ativo para isso) nos três pontos que
 * aplicam um templateId vindo de fonte não confiável quanto ao plano: o valor inicial vindo de
 * `readMarketingLaunchRequest` (deep link/query string), a seleção manual no
 * `MarketingTemplateSelector` (que recebe só `allowedTiers`, um dado puro, nunca o plano em si), e a
 * reabertura de um item do histórico (`applyEntryToEditor`) — sempre os três juntos, nunca só um, para
 * não abrir um desvio pelos outros dois.
 *
 * `PlanType` (shared/monetization.ts) só tem `free`/`premium` hoje — não existe faixa comercial "pro".
 * Por isso premium libera free+pro (superconjunto do catálogo), e free libera só free.
 */
export function getMarketingTemplateAllowedTiers(plan: PlanType): MarketingTemplateTier[] {
  return plan === "premium" ? ["free", "pro"] : ["free"];
}
export function isMarketingTemplateAllowedForPlan(tier: MarketingTemplateTier, plan: PlanType): boolean {
  return getMarketingTemplateAllowedTiers(plan).includes(tier);
}
export function resolveMarketingTemplateForPlan(value: unknown, plan: PlanType): MarketingTemplateDefinition {
  const template = resolveMarketingTemplate(value);
  return isMarketingTemplateAllowedForPlan(template.tier, plan) ? template : resolveMarketingTemplate("promo");
}
export function resolveMarketingAdTheme(value: unknown, fallbackColor?: string): MarketingAdTheme { const key = sanitizeMarketingText(value, "brand", 40) as MarketingAdThemeId, id = MARKETING_AD_THEMES[key] ? key : "brand", accent = id === "brand" ? fallbackColor || MARKETING_AD_THEMES.brand.accent : MARKETING_AD_THEMES[id].accent, darkMode = id === "black"; return { id, label: MARKETING_AD_THEMES[id].label, accent, dark: darkMode ? "#020617" : accent, soft: darkMode ? "#111827" : "#f8fafc", surface: darkMode ? "#0f172a" : "#ffffff", foreground: darkMode ? "#f8fafc" : "#111827", muted: darkMode ? "#cbd5e1" : "#64748b", ring: `${accent}38`, cta: "#2563eb", background: darkMode ? "linear-gradient(135deg,#020617,#111827 52%,#312e81)" : `linear-gradient(135deg,#fff 0%,${accent}10 52%,#eef6ff 100%)`, darkMode }; }
export function buildMarketingVolumeText(extras?: Record<string, unknown>) { if (!extras) return ""; for (const [key, label] of [["volume_ml", "Volume"], ["weight", "Peso"], ["size", "Tamanho"], ["quantity_pack", "Qtd."], ["flavor", "Sabor"], ["scent_family", "Fragrância"], ["model", "Modelo"], ["material", "Material"], ["color", "Cor"]]) { const value = sanitizeMarketingText(extras[key], "", 48); if (value) return `${label}: ${value}`; } return ""; }
export function buildMarketingStockLabel(stock?: number) { return typeof stock === "number" && Number.isFinite(stock) && stock <= 0 ? "Consulte disponibilidade" : "Pronta entrega"; }
export function buildMarketingAdConfig(input: MarketingAdInput): MarketingAdConfig { const template = resolveMarketingTemplate(input.templateId || input.template), primaryColor = sanitizeMarketingText(input.primaryColor, "#ec4899", 32), theme = resolveMarketingAdTheme(input.themeId, primaryColor), price = input.price ?? input.salePrice ?? 0, productVolume = sanitizeMarketingText(input.productVolume, "", 64) || buildMarketingVolumeText(input.productExtras); return { productId: sanitizeMarketingText(input.productId, "", 80), productName: sanitizeMarketingText(input.productName, "Produto", 120), productBrand: sanitizeMarketingText(input.productBrand || input.brand, "", 80), productImageUrl: sanitizeMarketingText(input.productImageUrl, "", 2048), imageUrl: sanitizeMarketingText(input.imageUrl, "", 2048), photoUrl: sanitizeMarketingText(input.photoUrl, "", 2048), image: sanitizeMarketingText(input.image, "", 2048), imageId: sanitizeMarketingText(input.imageId, "", 120), productVolume, stockStatus: sanitizeMarketingText(input.stockStatus, "", 60) || buildMarketingStockLabel(input.productStock), price, priceText: formatMarketingPrice(price), headline: sanitizeMarketingText(input.headline, template.headline, 80), note: normalizeMarketingNote(input.note), ctaText: normalizeMarketingCtaText(input.ctaText, template.id === "catalog" ? "Confira nosso catálogo" : "Chamar no WhatsApp"), storeName: sanitizeMarketingText(input.storeName, "Minha loja", 80), storeLogoUrl: sanitizeMarketingText(input.storeLogoUrl, "", 2048), primaryColor, templateId: template.id, template: template.id, themeId: theme.id, showBrand: input.showBrand !== false, showVolume: input.showVolume !== false, showStockStatus: input.showStockStatus !== false, showWhatsAppCta: input.showWhatsAppCta !== false, backgroundStyle: input.backgroundStyle || (theme.darkMode ? "dark-premium" : "clean-card"), catalogUrl: sanitizeMarketingText(input.catalogUrl, "", 2048) }; }
export function normalizeMarketingAdConfig(input: MarketingAdInput): MarketingAdConfig { return buildMarketingAdConfig(input); }
export function getMarketingAdImageCandidates(config: Pick<MarketingAdConfig, "productImageUrl" | "imageUrl" | "photoUrl" | "image">) { return Array.from(new Set([config.productImageUrl, config.imageUrl, config.photoUrl, config.image].filter((value): value is string => typeof value === "string" && value.trim().length > 0))); }
export function buildMarketingFeatureRows(config: MarketingAdConfig) {
  return [
    config.showStockStatus && config.stockStatus ? { icon: "✓", text: config.stockStatus, highlight: true } : null,
    config.showBrand && config.productBrand ? { icon: "◇", text: config.productBrand, highlight: false } : null,
    config.showVolume && config.productVolume ? { icon: "•", text: config.productVolume, highlight: false } : null,
  ].filter((item): item is { icon: string; text: string; highlight: boolean } => Boolean(item)).slice(0, 3);
}
export function buildMarketingAdVisualModel(input: MarketingAdInput, options: { resolvedImageSrc?: string | null } = {}) {
  const config = normalizeMarketingAdConfig(input), theme = resolveMarketingAdTheme(config.themeId, config.primaryColor), template = resolveMarketingTemplate(config.templateId);
  const features = buildMarketingFeatureRows(config);
  const chips = features.map((feature) => [feature.text, feature.highlight] as const);
  const imageSrc = Object.prototype.hasOwnProperty.call(options, "resolvedImageSrc")
    ? options.resolvedImageSrc || ""
    : getMarketingAdImageCandidates(config)[0] || "";
  const ctaText = config.showWhatsAppCta ? config.ctaText || "Chamar no WhatsApp" : "";
  const description = config.note || "";
  const badgeText = template.id === "new" ? "Lançamento" : template.label;
  return { config, theme, template, chips, features, imageSrc, ctaText, description, badgeText, logoSrc: config.storeLogoUrl || "", storeInitial: (config.storeName || "R").trim().slice(0, 1).toUpperCase() };
}
export function normalizeMarketingWhatsappNumber(value: unknown) { return sanitizeMarketingText(value, "", 32).replace(/\D/g, "").slice(0, 15); }
export function buildMarketingWhatsappUrl(input: { phone?: string; message: string }) { const phone = normalizeMarketingWhatsappNumber(input.phone); return phone ? `https://wa.me/${phone}?text=${encodeURIComponent(input.message)}` : ""; }
export function hasBase64ImageValue(value: unknown) { return typeof value === "string" && /^data:image\//i.test(value.trim()); }
const PRODUCT_ASSET_SNAPSHOT_LIMITS = { productId: 128, assetId: 256, assetRef: 512, sourceUrl: 2048, mimeType: 80 } as const;
const INLINE_ASSET_REFERENCE_RE = /^data:/i;
function hasSnapshotControlChars(value: string) {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });
}
function snapshotString(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength || hasSnapshotControlChars(normalized)) return null;
  return normalized;
}
export function sanitizeProductAssetSnapshot(value: unknown): ProductAssetSnapshot | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const productId = snapshotString(raw.productId, PRODUCT_ASSET_SNAPSHOT_LIMITS.productId);
  const assetId = snapshotString(raw.assetId, PRODUCT_ASSET_SNAPSHOT_LIMITS.assetId);
  const assetRef = snapshotString(raw.assetRef, PRODUCT_ASSET_SNAPSHOT_LIMITS.assetRef);
  const width = raw.width;
  const height = raw.height;
  if (!productId || !assetId || !assetRef || INLINE_ASSET_REFERENCE_RE.test(assetRef)) return undefined;
  if (typeof width !== "number" || !Number.isInteger(width) || width <= 0 || width > 100_000) return undefined;
  if (typeof height !== "number" || !Number.isInteger(height) || height <= 0 || height > 100_000) return undefined;

  let sourceUrl: string | undefined;
  if (raw.sourceUrl !== undefined) {
    sourceUrl = snapshotString(raw.sourceUrl, PRODUCT_ASSET_SNAPSHOT_LIMITS.sourceUrl) || undefined;
    if (!sourceUrl || INLINE_ASSET_REFERENCE_RE.test(sourceUrl)) return undefined;
  }
  let mimeType: string | undefined;
  if (raw.mimeType !== undefined) {
    mimeType = snapshotString(raw.mimeType, PRODUCT_ASSET_SNAPSHOT_LIMITS.mimeType) || undefined;
    if (!mimeType || !/^image\/[a-z0-9.+-]+$/i.test(mimeType)) return undefined;
  }
  return { productId, assetId, assetRef, width, height, ...(sourceUrl ? { sourceUrl } : {}), ...(mimeType ? { mimeType } : {}) };
}
export function sanitizeMarketingHistoryPayload<T extends Record<string, unknown>>(entry: T): Partial<T> {
  const imageFields = new Set(["productImageUrl", "imageUrl", "photoUrl", "image", "storeLogoUrl"]);
  const sanitized = Object.fromEntries(Object.entries(entry).filter(([key, value]) =>
    key !== "productAssetSnapshot" && value !== undefined && !(imageFields.has(key) && hasBase64ImageValue(value)))) as Record<string, unknown>;
  const productAssetSnapshot = sanitizeProductAssetSnapshot(entry.productAssetSnapshot);
  if (productAssetSnapshot) sanitized.productAssetSnapshot = productAssetSnapshot;
  return sanitized as Partial<T>;
}
export function buildMarketingAdMessage(config: MarketingAdConfig, payment?: { includePayment?: boolean; pixKey?: string; paymentLink?: string }) { const template = resolveMarketingTemplate(config.templateId), lines = [`${template.emoji} *${config.headline || template.headline}*`, "", `🛍️ *${config.productName}*`]; if (config.showBrand && config.productBrand) lines.push(`✨ Marca: ${config.productBrand}`); if (config.showVolume && config.productVolume) lines.push(`🔹 ${config.productVolume}`); lines.push(`💰 *Por apenas ${config.priceText}*`); if (config.showStockStatus && config.stockStatus) lines.push(`✅ ${config.stockStatus}`); if (config.note) lines.push(`📝 ${config.note}`); if (config.showWhatsAppCta && config.ctaText) lines.push("", `💬 ${config.ctaText}`); if (config.catalogUrl) lines.push("", `🛒 Catálogo: ${config.catalogUrl}`); if (payment?.includePayment) { if (payment.pixKey) lines.push("", `🔑 PIX: ${payment.pixKey}`); if (payment.paymentLink) lines.push(`💳 Link de Pagamento: ${payment.paymentLink}`); } return lines.join("\n"); }
import type { ProductAssetSnapshot } from "../../../shared/product-image-preservation";
import type { PlanType } from "../../../shared/monetization";
