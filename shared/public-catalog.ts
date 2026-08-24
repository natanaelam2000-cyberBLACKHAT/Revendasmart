export type PublicCatalogMode = "general" | "focused" | "segmented" | "hub";

export type PublicCatalogHeroReason =
  | "manual_featured"
  | "active_promotion"
  | "top_seller"
  | "has_image"
  | "available";

export type PublicCatalogCollectionId =
  | "offers"
  | "featured"
  | "best_sellers"
  | "kits"
  | "ready_to_deliver"
  | "low_stock";

export type PublicCatalogEmptyReason =
  | "no_products"
  | "no_products_and_no_niches"
  | "all_out_of_stock";

export interface PublicCatalogStore {
  slug: string;
  name: string;
  description?: string;
  logoUrl?: string;
  bannerUrl?: string;
  bannerTitle?: string;
  bannerSubtitle?: string;
  primaryColor?: string;
  whatsappNumber?: string;
  showPrice: boolean;
  showStock: boolean;
  allowWhatsappOrders: boolean;
  /**
   * true quando o lojista cadastrou uma chave Pix — habilita a opção "Pix" no fechamento do pedido.
   * LGPD §7 (REVENDASMART-LGPD-ANPD-REMEDIATION-01): o VALOR da chave não vai mais nesta carga inicial
   * (que qualquer visitante recebe só de abrir a URL, com cache de CDN) — só este booleano. O valor real
   * é buscado sob demanda em GET /api/public/catalog/:storeSlug/pix-key quando o comprador abre a etapa
   * de pagamento por Pix.
   */
  pixAvailable: boolean;
  /** true quando o lojista tem uma conexão Mercado Pago ativa — nunca expõe detalhes da conexão em si. */
  cardAvailable: boolean;
}

export interface PublicCatalogProduct {
  id: string;
  name: string;
  description?: string;
  category?: string;
  brand?: string;
  productType?: string;
  nicheId?: string;
  gender?: string;
  salePrice: number;
  promotionalPrice?: number;
  discountPercent?: number;
  isOnSale?: boolean;
  isFeatured?: boolean;
  imageUrl?: string;
  available: boolean;
  availableQuantity: number;
  publicAttributes?: Record<string, unknown>;
}

export interface PublicCatalogCategorySummary {
  id: string;
  label: string;
  productCount: number;
  availableProductCount: number;
}

export interface PublicCatalogHero {
  product: PublicCatalogProduct;
  reason: PublicCatalogHeroReason;
}

export interface PublicCatalogCollection {
  id: PublicCatalogCollectionId;
  products: PublicCatalogProduct[];
}

export interface PublicCatalogNiche {
  id: string;
  label: string;
  isPrimary: boolean;
  productCount: number;
  categories: string[];
  usedCategories: PublicCatalogCategorySummary[];
  availableProductCount: number;
  outOfStockProductCount: number;
  lowStockProductCount: number;
  hero?: PublicCatalogHero;
  quickCollections: PublicCatalogCollection[];
}

export interface PublicCatalogInventorySummary {
  totalProducts: number;
  availableProducts: number;
  outOfStockProducts: number;
  activeNiches: number;
}

export interface PublicCatalogPresentation {
  mode: PublicCatalogMode;
  activeNicheId?: string;
  niches: PublicCatalogNiche[];
  hero?: PublicCatalogHero;
  topCategories: PublicCatalogCategorySummary[];
  quickCollections: PublicCatalogCollection[];
  inventorySummary: PublicCatalogInventorySummary;
  emptyReason?: PublicCatalogEmptyReason;
}

export interface PublicCatalogPagination {
  nextCursor: string | null;
  hasMore: boolean;
  limit: number;
}

export interface PublicCatalogResponse {
  store: PublicCatalogStore;
  presentation: PublicCatalogPresentation;
  products: PublicCatalogProduct[];
  pagination: PublicCatalogPagination;
}

export interface PublicCatalogPageResponse {
  products: PublicCatalogProduct[];
  pagination: PublicCatalogPagination;
}
