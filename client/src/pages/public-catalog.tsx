import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Calendar, Check, ChevronLeft, Clock, Copy, CreditCard, QrCode, Send, ShoppingCart, Store, Trash2, X, Minus, Plus } from "lucide-react";
import { useLocation, useParams } from "wouter";
import { QRCodeSVG } from "qrcode.react";
import { CatalogShowcase } from "@/components/catalog/CatalogShowcase";
import { PageSkeleton } from "@/components/PageSkeleton";
import { ProductImageCard } from "@/components/ProductImageCard";
import { getApiBaseUrl, getApiUrl } from "@/lib/api-config";
import { buildPublicProductNicheMap, toCatalogExperience, toCatalogProduct } from "@/lib/public-catalog-adapter";
import { formatCurrency, resolveEffectiveProductPrice } from "@/lib/product-pricing";
import { normalizeWhatsappPhone } from "@/lib/whatsapp-phone";
import { formatCentsBRL } from "@/lib/service-work-helpers";
import { buildPixEmvPayload } from "@/lib/pix-emv";
import { renderOrderVisualSummary, type OrderVisualSummaryItem } from "@/lib/order-visual-summary";
import { isMarketingShareCancelledError, shareMarketingCard } from "@/lib/marketing-share";
import {
  createPublicCatalogOrder,
  createPublicCatalogOrderMercadoPagoPayment,
  generateClientOrderId,
  getPublicCatalogOrderStatus,
  markPublicCatalogOrderPaidByCustomer,
  type PublicCatalogOrderStatus,
} from "@/lib/public-catalog-orders";
import { ORDER_PAYMENT_METHOD_LABELS, type Order, type OrderPaymentMethod } from "@/lib/orders";
import {
  detectCartStaleness,
  fetchAuthoritativeCatalogSnapshot,
  type CartRevalidationItem,
  type CatalogSnapshotFetcher,
} from "@/lib/public-catalog-cart";
import type { Product } from "@/lib/mock-data";
import type {
  PublicCatalogPageResponse,
  PublicCatalogPresentation,
  PublicCatalogProduct,
  PublicCatalogResponse,
  PublicCatalogStore,
} from "@shared/public-catalog";

interface CartItem {
  product: Product;
  quantity: number;
}

/**
 * Motivos pelos quais o catálogo público pode não abrir. O visitante continua vendo uma mensagem
 * curta e amigável, mas o motivo real vai para o console/diagnóstico — sem isso, um erro de
 * configuração de backend fica indistinguível de "essa loja não existe".
 */
type PublicCatalogFailureReason =
  | "store_not_found"
  | "api_route_missing"
  | "permission_denied"
  | "network"
  | "invalid_response"
  | "unexpected";

type HybridSection = "produtos" | "servicos";

type PublicCatalogServiceSummary = {
  id: string;
  name: string;
  description?: string;
  durationMinutes: number;
  priceCents: number;
};

/**
 * CATÁLOGO-PÚBLICO-POR-MODO — seção Serviços do link HYBRID: nunca estoque/quantidade/carrinho/Esgotado
 * (§ requisito explícito), CTA "Agendar" leva para a página pública de agendamento já existente e
 * comprovada (/agendar/:slug, public-service-booking.tsx) em vez de duplicar o fluxo de hold/confirm
 * aqui — o mesmo serviço nunca fica "reservável" por dois caminhos client diferentes.
 */
function PublicCatalogServicesSection({
  services,
  loading,
  failed,
  searchTerm,
  onSearchTermChange,
  storeSlug,
}: {
  services: PublicCatalogServiceSummary[];
  loading: boolean;
  failed: boolean;
  searchTerm: string;
  onSearchTermChange: (value: string) => void;
  storeSlug: string;
}) {
  const normalizedSearch = searchTerm.trim().toLowerCase();
  const filtered = normalizedSearch ? services.filter((service) => service.name.toLowerCase().includes(normalizedSearch)) : services;
  const bookingHref = `/agendar/${encodeURIComponent(storeSlug)}`;

  return (
    <div className="mx-auto max-w-3xl px-4 py-5" data-testid="section-public-services">
      <div className="relative mb-4">
        <input
          type="text"
          placeholder="Buscar serviço..."
          value={searchTerm}
          onChange={(event) => onSearchTermChange(event.target.value)}
          className="w-full rounded-full border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-primary/20"
          data-testid="input-service-search-public"
        />
      </div>
      {loading ? (
        <div className="space-y-3">{[1, 2, 3].map((key) => <div key={key} className="h-20 animate-pulse rounded-3xl bg-slate-100" />)}</div>
      ) : failed ? (
        <p className="rounded-2xl bg-red-50 p-4 text-center text-sm font-semibold text-red-700">Não foi possível carregar os serviços agora.</p>
      ) : filtered.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
          {services.length === 0 ? "Nenhum serviço disponível no momento." : "Nenhum serviço encontrado."}
        </p>
      ) : (
        <ul className="space-y-3" data-testid="list-public-services-hybrid">
          {filtered.map((service) => (
            <li key={service.id} className="flex items-center gap-3 rounded-3xl border border-slate-200 bg-white p-4">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-black text-slate-900">{service.name}</p>
                {service.description && <p className="truncate text-xs text-slate-500">{service.description}</p>}
                <div className="mt-1 flex items-center gap-3 text-xs text-slate-500">
                  <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> {service.durationMinutes} min</span>
                  <span className="font-black text-primary">{formatCentsBRL(service.priceCents)}</span>
                </div>
              </div>
              <a
                href={bookingHref}
                data-testid={`link-book-service-${service.id}`}
                className="flex shrink-0 items-center gap-1.5 rounded-full bg-slate-950 px-3.5 py-2.5 text-xs font-black text-white"
              >
                <Calendar className="h-3.5 w-3.5" /> Agendar
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function PublicCatalog() {
  const { storeSlug } = useParams();
  const [, setLocation] = useLocation();
  // CATÁLOGO-PÚBLICO-POR-MODO — HYBRID mostra Produtos e Serviços como seções separadas no MESMO link
  // (nunca dados misturados); "produtos" é o default porque preserva o comportamento atual de quem já
  // usava o catálogo antes deste hotfix (zero regressão de UX para o caso mais comum, produtos puro).
  const [activeSection, setActiveSection] = useState<HybridSection>("produtos");
  const [publicServices, setPublicServices] = useState<PublicCatalogServiceSummary[]>([]);
  const [publicServicesLoading, setPublicServicesLoading] = useState(false);
  const [publicServicesError, setPublicServicesError] = useState(false);
  const [serviceSearchTerm, setServiceSearchTerm] = useState("");
  const servicesFetchStartedRef = useRef(false);
  const [selectedGender, setSelectedGender] = useState("todos");
  const [selectedCategory, setSelectedCategory] = useState("todos");
  const [searchTerm, setSearchTerm] = useState("");
  const [store, setStore] = useState<PublicCatalogStore | null>(null);
  const [presentation, setPresentation] = useState<PublicCatalogPresentation | null>(null);
  const [publicProducts, setPublicProducts] = useState<PublicCatalogProduct[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState("");
  const [loadFailed, setLoadFailed] = useState(false);
  // Diagnóstico interno: a tela mostra uma única mensagem amigável, mas o motivo real precisa ser
  // distinguível nos logs. Sem isso, "rota de API inexistente no backend" e "loja não encontrada"
  // ficam indistinguíveis — foi exatamente o que mascarou o 404 de backend errado no Preview.
  const [failureReason, setFailureReason] = useState<PublicCatalogFailureReason | null>(null);
  const [showCart, setShowCart] = useState(false);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [sendingOrder, setSendingOrder] = useState(false);
  const [orderNotice, setOrderNotice] = useState("");
  // Pix ganha uma tela própria (QR/chave/"Já paguei"); WhatsApp e Cartão continuam resolvidos direto
  // no rodapé do carrinho, sem tela extra — nenhum dos dois precisa de mais do que abrir o WhatsApp.
  const [checkoutStep, setCheckoutStep] = useState<"cart" | "pix">("cart");
  const [clientOrderId, setClientOrderId] = useState(() => generateClientOrderId());
  const [activeOrder, setActiveOrder] = useState<Order | null>(null);
  const [placingOrder, setPlacingOrder] = useState<OrderPaymentMethod | null>(null);
  const [markingPaid, setMarkingPaid] = useState(false);
  const [paidReported, setPaidReported] = useState(false);
  const [pixKeyCopied, setPixKeyCopied] = useState(false);
  // LGPD §7: a chave Pix não vem mais na carga inicial do catálogo — só é buscada quando o comprador
  // efetivamente abre esta etapa, via GET /api/public/catalog/:storeSlug/pix-key.
  const [pixKey, setPixKey] = useState<string | null>(null);
  const [pixKeyFetchError, setPixKeyFetchError] = useState(false);
  // §7: estado de retorno do Mercado Pago. `hint` vem da URL (nunca é autoridade — só decide o texto
  // inicial enquanto `status` carrega); a decisão real do que mostrar é sempre `status.paymentStatus`.
  const [paymentReturn, setPaymentReturn] = useState<{
    orderId: string;
    hint: "success" | "pending" | "failure";
    status: PublicCatalogOrderStatus | null;
    loading: boolean;
  } | null>(null);

  // RC-04 P0/P1-01 — o catálogo público é a vitrine da LOJA (marca/identidade configurada pelo
  // vendedor), nunca deve seguir o modo escuro do app autenticado nem o `prefers-color-scheme` do
  // dispositivo do visitante. `ThemeProvider` (next-themes) engloba TODO o app em main.tsx — sem este
  // reset, um comprador anônimo com o celular em modo escuro (ou um vendedor navegando para cá de
  // dentro do próprio app em dark mode, via SPA, sem reload de página) herdaria a classe `.dark` do
  // `<html>` e a extensa correção de "bg-white hardcoded" desta rodada passaria a escurecer a vitrine
  // pública. Remove a classe ao montar e restaura o estado anterior ao desmontar, para não quebrar o
  // app autenticado ao voltar por navegação client-side.
  useEffect(() => {
    const root = document.documentElement;
    const hadDark = root.classList.contains("dark");
    root.classList.remove("dark");
    return () => {
      if (hadDark) root.classList.add("dark");
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let activeController: AbortController | null = null;
    async function loadCatalog() {
      setLoading(true);
      setLoadFailed(false);
      setFailureReason(null);
      let reason: PublicCatalogFailureReason = "unexpected";
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const controller = new AbortController();
        activeController = controller;
        const timeoutId = setTimeout(() => controller.abort(), 15000);
        try {
          const response = await fetch(getApiUrl(`/api/public/catalog/${encodeURIComponent(storeSlug || "")}`), { signal: controller.signal });
          if (response.status === 404) {
            // Um 404 tem DOIS significados muito diferentes: a API respondeu que a loja não existe
            // (JSON), ou a própria rota não existe no backend atingido (HTML "Cannot GET"). O segundo
            // é erro de configuração/deploy, não de dados, e precisa aparecer diferente no log.
            const contentType = response.headers.get("content-type") || "";
            reason = contentType.includes("application/json") ? "store_not_found" : "api_route_missing";
            break;
          }
          if (response.status === 401 || response.status === 403) {
            // O catálogo público nunca deve exigir autenticação: se veio 401/403, é regressão de rota
            // ou de regra, não visitante "sem permissão".
            reason = "permission_denied";
            break;
          }
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const data = await response.json() as PublicCatalogResponse;
          if (!data.store || !data.presentation || !Array.isArray(data.products) || !data.pagination) {
            throw new Error("INVALID_PUBLIC_CATALOG_RESPONSE");
          }
          if (cancelled) return;
          // CATÁLOGO-PÚBLICO-POR-MODO — quem só presta serviço nunca deve ver a vitrine de produtos
          // (hoje mostraria "nenhum produto", sem nenhum caminho para agendar). Links antigos/impressos
          // para /u/:slug continuam funcionando: redireciona para a página pública real de agendamento
          // assim que o servidor confirma o businessMode (nunca decidido no client antes de saber).
          if (data.store.businessMode === "services") {
            setLocation(`/agendar/${encodeURIComponent(storeSlug || "")}`, { replace: true });
            return;
          }
          setStore(data.store);
          setPresentation(data.presentation);
          setPublicProducts(data.products);
          setNextCursor(typeof data.pagination.nextCursor === "string" ? data.pagination.nextCursor : null);
          setHasMore(data.pagination.hasMore === true);
          setLoadMoreError("");
          setLoading(false);
          return;
        } catch (error) {
          const isNetwork = (error instanceof DOMException && error.name === "AbortError") || error instanceof TypeError;
          reason = isNetwork
            ? "network"
            : error instanceof Error && error.message === "INVALID_PUBLIC_CATALOG_RESPONSE" ? "invalid_response" : "unexpected";
          console.warn(`[CATALOG] Tentativa ${attempt + 1} falhou:`, error);
          if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
        } finally {
          clearTimeout(timeoutId);
        }
      }
      if (!cancelled) {
        setStore(null);
        setPresentation(null);
        setPublicProducts([]);
        setNextCursor(null);
        setHasMore(false);
        setLoadFailed(true);
        setLoading(false);
        setFailureReason(reason);
        console.error("[CATALOG] Catálogo público indisponível", {
          slug: storeSlug || "(vazio)",
          reason,
          apiBase: getApiBaseUrl() || "(mesma origem)",
        });
      }
    }
    loadCatalog();
    return () => { cancelled = true; activeController?.abort(); };
  }, [storeSlug]);

  // CATÁLOGO-PÚBLICO-POR-MODO — a seção Serviços do HYBRID reaproveita 100% o mesmo endpoint público já
  // usado por /agendar/:slug (server/service-public-booking.ts) — nenhum endpoint novo, nenhuma segunda
  // fonte de dados de serviço. Busca só quando o visitante realmente abre a aba (nunca no carregamento
  // inicial de uma loja HYBRID que a maioria só visita pela aba Produtos).
  useEffect(() => {
    if (!storeSlug || store?.businessMode !== "both" || activeSection !== "servicos") return;
    // Guarda por ref, não por state: `publicServicesLoading` no array de dependências reexecutaria este
    // efeito assim que a linha abaixo o setasse para true, cancelando (cleanup) a própria busca em voo
    // antes dela responder — o fetch real terminava, mas cancelled=true (do cleanup do 2º disparo)
    // impedia setPublicServices/setPublicServicesLoading(false) de rodar, travando "Serviços" em loading
    // para sempre. Reproduzido ao vivo: o skeleton nunca saía mesmo com a API respondendo em <100ms.
    if (servicesFetchStartedRef.current) return;
    servicesFetchStartedRef.current = true;
    let cancelled = false;
    setPublicServicesLoading(true);
    setPublicServicesError(false);
    fetch(getApiUrl(`/api/public/services/${encodeURIComponent(storeSlug)}`))
      .then((response) => { if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.json(); })
      .then((data: { services?: PublicCatalogServiceSummary[] }) => {
        if (cancelled) return;
        setPublicServices(Array.isArray(data.services) ? data.services : []);
      })
      .catch((error) => {
        if (cancelled) return;
        console.warn("[CATALOG] Falha ao carregar serviços públicos:", error);
        setPublicServicesError(true);
      })
      .finally(() => { if (!cancelled) setPublicServicesLoading(false); });
    return () => { cancelled = true; };
  }, [storeSlug, store?.businessMode, activeSection]);

  // LGPD §7: busca a chave Pix só quando o comprador realmente chega nesta etapa, não na carga inicial
  // do catálogo (ver GET /api/public/catalog/:storeSlug/pix-key em server/routes.ts).
  useEffect(() => {
    if (checkoutStep !== "pix" || !storeSlug || pixKey || pixKeyFetchError) return;
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(getApiUrl(`/api/public/catalog/${encodeURIComponent(storeSlug)}/pix-key`));
        if (cancelled) return;
        if (!response.ok) { setPixKeyFetchError(true); return; }
        const data = await response.json();
        if (!cancelled && typeof data.pixKey === "string") setPixKey(data.pixKey);
      } catch {
        if (!cancelled) setPixKeyFetchError(true);
      }
    })();
    return () => { cancelled = true; };
  }, [checkoutStep, storeSlug, pixKey, pixKeyFetchError]);

  /**
   * §7 — leitura do retorno do Mercado Pago. O `payment=` da URL é só um HINT para o texto inicial
   * ("confirmando..."); o que a tela realmente mostra sempre vem de `getPublicCatalogOrderStatus`
   * (server-side). Faz um polling curto porque o webhook do MP costuma chegar alguns segundos DEPOIS
   * do redirect do navegador — sem isso, um pagamento aprovado apareceria como "pendente" por engano.
   */
  useEffect(() => {
    if (typeof window === "undefined" || !storeSlug) return;
    const params = new URLSearchParams(window.location.search);
    const returnedOrderId = params.get("order");
    const hint = params.get("payment");
    if (!returnedOrderId || (hint !== "success" && hint !== "pending" && hint !== "failure")) return;

    let cancelled = false;
    setPaymentReturn({ orderId: returnedOrderId, hint, status: null, loading: true });

    (async () => {
      for (let attempt = 0; attempt < 5; attempt++) {
        const status = await getPublicCatalogOrderStatus(storeSlug, returnedOrderId);
        if (cancelled) return;
        if (status?.paymentStatus === "paid" || attempt === 4) {
          setPaymentReturn({ orderId: returnedOrderId, hint, status, loading: false });
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    })();

    return () => { cancelled = true; };
  }, [storeSlug]);

  const loadMoreProducts = useCallback(async () => {
    if (!storeSlug || !nextCursor || loadingMore) return;
    setLoadingMore(true);
    setLoadMoreError("");
    try {
      const params = new URLSearchParams({ cursor: nextCursor, limit: "24" });
      if (selectedGender !== "todos") params.set("gender", selectedGender);
      const response = await fetch(getApiUrl(`/api/public/catalog/${encodeURIComponent(storeSlug)}/products?${params.toString()}`));
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json() as PublicCatalogPageResponse;
      const nextProducts = Array.isArray(data.products) ? data.products : [];
      setPublicProducts((current) => {
        const seen = new Set(current.map((product) => product.id));
        return [...current, ...nextProducts.filter((product) => product?.id && !seen.has(product.id))];
      });
      setNextCursor(typeof data.pagination?.nextCursor === "string" ? data.pagination.nextCursor : null);
      setHasMore(data.pagination?.hasMore === true);
    } catch (error) {
      console.warn("[CATALOG] Falha ao carregar mais produtos:", error);
      setLoadMoreError("Não foi possível carregar mais produtos agora. Tente novamente.");
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, nextCursor, selectedGender, storeSlug]);

  const products = useMemo(() => publicProducts.map(toCatalogProduct), [publicProducts]);
  const experience = useMemo(() => presentation ? toCatalogExperience(presentation) : null, [presentation]);
  const productNicheIds = useMemo(
    () => presentation ? buildPublicProductNicheMap(presentation, publicProducts) : new Map<string, string>(),
    [presentation, publicProducts],
  );

  const addToCart = useCallback((product: Product) => {
    const stock = Math.max(0, Number(product.stock || 0));
    if (stock <= 0) return;
    setCart((previous) => {
      const existing = previous.find((item) => item.product.id === product.id);
      if (existing) {
        if (existing.quantity >= stock) return previous;
        return previous.map((item) => item.product.id === product.id ? { ...item, quantity: item.quantity + 1 } : item);
      }
      return [...previous, { product, quantity: 1 }];
    });
  }, []);

  const removeFromCart = useCallback((productId: string) => {
    setCart((previous) => previous.filter((item) => item.product.id !== productId));
  }, []);

  const updateQuantity = useCallback((productId: string, quantity: number) => {
    if (quantity <= 0) {
      removeFromCart(productId);
      return;
    }
    setCart((previous) => {
      const item = previous.find((cartItem) => cartItem.product.id === productId);
      if (!item || quantity > Number(item.product.stock || 0)) return previous;
      return previous.map((cartItem) => cartItem.product.id === productId ? { ...cartItem, quantity } : cartItem);
    });
  }, [removeFromCart]);

  const cartQuantities = useMemo(() => new Map(cart.map((item) => [item.product.id, item.quantity])), [cart]);
  // P0: uma ÚNICA fonte de preço para vitrine, carrinho, subtotal, total e mensagem do WhatsApp —
  // nunca o `salePrice` bruto, que ignora promoção/desconto ativos (o mesmo bug que CatalogProductTile
  // e CatalogProductDetails já evitam usando esta função).
  const cartEffectivePrices = useMemo(
    () => new Map(cart.map((item) => [item.product.id, resolveEffectiveProductPrice(item.product).effectivePrice])),
    [cart],
  );
  const cartTotal = useMemo(
    () => cart.reduce((sum, item) => sum + (cartEffectivePrices.get(item.product.id) ?? 0) * item.quantity, 0),
    [cart, cartEffectivePrices],
  );
  const cartCount = useMemo(() => cart.reduce((sum, item) => sum + item.quantity, 0), [cart]);
  const storeDisplayName = store?.name || "Minha Loja";
  const storeDescription = store?.description || store?.bannerSubtitle || "Escolha seus produtos favoritos e envie seu pedido em poucos cliques.";
  const catalogUrl = typeof window !== "undefined" ? window.location.href : `https://revendasmart.vercel.app/u/${storeSlug || "catalogo"}`;
  const showPrice = store?.showPrice !== false;
  const allowWhatsappOrders = store?.allowWhatsappOrders !== false;

  const handleShareCatalog = () => {
    const message = `Conheça o catálogo da ${storeDisplayName}: ${catalogUrl}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, "_blank");
  };

  const closeCart = useCallback(() => {
    setShowCart(false);
    setCheckoutStep("cart");
    setActiveOrder(null);
    setPaidReported(false);
    setPixKeyCopied(false);
  }, []);

  /** Fetcher real dos dois endpoints públicos já existentes — nenhuma rota nova. */
  const buildSnapshotFetcher = useCallback((): CatalogSnapshotFetcher => ({
    async fetchStoreAndFirstPage(slug) {
      const response = await fetch(getApiUrl(`/api/public/catalog/${encodeURIComponent(slug)}?limit=48`));
      if (!response.ok) return null;
      const data = await response.json() as PublicCatalogResponse;
      if (!data.store || !Array.isArray(data.products) || !data.pagination) return null;
      return { store: data.store, products: data.products, pagination: data.pagination };
    },
    async fetchProductsPage(slug, cursor) {
      const params = new URLSearchParams({ cursor, limit: "48" });
      const response = await fetch(getApiUrl(`/api/public/catalog/${encodeURIComponent(slug)}/products?${params.toString()}`));
      if (!response.ok) return null;
      const data = await response.json() as PublicCatalogPageResponse;
      if (!Array.isArray(data.products) || !data.pagination) return null;
      return { products: data.products, pagination: data.pagination };
    },
  }), []);

  /**
   * §5: revalida o carrinho contra o catálogo authoritative do MESMO slug antes de qualquer forma de
   * fechamento (WhatsApp, Pix, Cartão). Se algo relevante mudou, NUNCA prossegue em silêncio — atualiza
   * o carrinho, avisa, e devolve o controle para o passo "cart" para o cliente revisar.
   */
  const revalidateCart = async (): Promise<{ ok: boolean; whatsappNumber?: string }> => {
    if (!storeSlug) return { ok: false };
    const neededIds = new Set(cart.map((item) => item.product.id));
    const snapshot = await fetchAuthoritativeCatalogSnapshot(storeSlug, neededIds, buildSnapshotFetcher());
    if (!snapshot) {
      setOrderNotice("Não foi possível confirmar seu pedido agora. Tente novamente em instantes.");
      return { ok: false };
    }

    const revalidationItems: CartRevalidationItem[] = cart.map((item) => ({
      productId: item.product.id,
      name: item.product.name,
      quantity: item.quantity,
      effectivePrice: cartEffectivePrices.get(item.product.id) ?? 0,
    }));
    const revalidation = detectCartStaleness(revalidationItems, snapshot.store, snapshot.productsById);

    if (revalidation.stale) {
      setCart((previous) => previous
        .filter((item) => revalidation.updatedQuantities.has(item.product.id))
        .map((item) => {
          const updatedQuantity = revalidation.updatedQuantities.get(item.product.id) ?? item.quantity;
          const authoritative = snapshot.productsById.get(item.product.id);
          return authoritative
            ? { product: toCatalogProduct(authoritative), quantity: updatedQuantity }
            : { ...item, quantity: updatedQuantity };
        }));
      setOrderNotice(
        revalidation.reasons.some((reason) => reason.kind === "orders_disabled")
          ? "Este vendedor desativou pedidos por WhatsApp no momento. Entre em contato por outro canal."
          : "Alguns itens foram atualizados. Revise seu pedido antes de continuar.",
      );
      setCheckoutStep("cart");
      return { ok: false };
    }

    return { ok: true, whatsappNumber: snapshot.store.whatsappNumber };
  };

  const buildOrderMessage = (paymentMethodLabel: string, orderId?: string): string => {
    let message = `🛍️ *Pedido - ${storeDisplayName}*\n\n`;
    for (const item of cart) {
      const unitPrice = cartEffectivePrices.get(item.product.id) ?? 0;
      message += `• ${item.product.name}\n`;
      message += showPrice
        ? `  Qtd: ${item.quantity} | Subtotal: ${formatCurrency(unitPrice * item.quantity)}\n\n`
        : `  Qtd: ${item.quantity}\n\n`;
    }
    if (showPrice) message += `💰 *Total: ${formatCurrency(cartTotal)}*\n\n`;
    message += `Forma de pagamento: ${paymentMethodLabel}\n`;
    if (orderId) message += `Pedido: #${orderId.slice(0, 8)}\n`;
    message += `Catálogo: ${catalogUrl}`;
    return message;
  };

  const openWhatsAppWithOrder = (whatsappNumber: string | undefined, paymentMethodLabel: string, orderId?: string): boolean => {
    const normalizedPhone = normalizeWhatsappPhone(whatsappNumber);
    if (!normalizedPhone) {
      setOrderNotice("Este vendedor ainda não configurou um WhatsApp válido para receber pedidos.");
      return false;
    }
    window.open(`https://wa.me/${normalizedPhone}?text=${encodeURIComponent(buildOrderMessage(paymentMethodLabel, orderId))}`, "_blank");
    return true;
  };

  /**
   * Best-effort: falha na criação do pedido nunca bloqueia o fechamento — só fica sem rastreio no app
   * do lojista. Cada chamada gera seu próprio clientOrderId: reaproveitar o de outra forma de
   * pagamento faria o idempotency guard do servidor devolver o pedido errado (ex.: escolher Pix e
   * depois WhatsApp não pode "reviver" o pedido de Pix com o método trocado).
   */
  const tryCreateOrder = async (paymentMethod: OrderPaymentMethod): Promise<Order | null> => {
    if (!storeSlug) return null;
    const result = await createPublicCatalogOrder(storeSlug, {
      clientOrderId: generateClientOrderId(),
      paymentMethod,
      items: cart.map((item) => ({ productId: item.product.id, quantity: item.quantity })),
    });
    return result.ok ? result.order ?? null : null;
  };

  /**
   * §2/§6 (WHATSAPP-ORDER-VISUAL-01): resumo visual local (miniatura real + nome + qtd + subtotal +
   * total + pagamento + loja), compartilhado junto com o texto via o MESMO mecanismo já usado por
   * Anúncios (Capacitor Share no Android, Web Share API com arquivo no browser, download+texto como
   * último recurso — nunca um segundo pipeline de compartilhamento). Falha ao gerar a imagem NUNCA
   * impede o envio: o chamador volta para o wa.me de texto puro de sempre.
   *
   * §6: usa os valores JÁ PERSISTIDOS no pedido (server-side, autoritativo) quando ele foi criado com
   * sucesso — nunca recalcula a partir do carrinho. Só cai para os valores do carrinho em memória
   * quando a criação do pedido falhou (best-effort: a imagem ainda precisa de algo para mostrar, e o
   * carrinho já reflete os mesmos preços efetivos exibidos ao cliente).
   *
   * Retorna true quando um share sheet real (nativo ou Web Share) tratou o envio — nesse caso o
   * chamador não deve TAMBÉM abrir o wa.me por cima, ou o usuário veria as duas ações se sobrepondo.
   */
  const tryShareVisualOrder = async (message: string, order: Order | null): Promise<boolean> => {
    try {
      const summaryItems: OrderVisualSummaryItem[] = order
        ? order.items.map((item) => ({
          name: item.name,
          quantity: item.quantity,
          subtotalLabel: showPrice ? formatCurrency(item.unitPrice * item.quantity) : undefined,
          imageUrl: item.imageUrl,
        }))
        : cart.map((item) => ({
          name: item.product.name,
          quantity: item.quantity,
          subtotalLabel: showPrice ? formatCurrency((cartEffectivePrices.get(item.product.id) ?? 0) * item.quantity) : undefined,
          imageUrl: item.product.imageUrl,
        }));
      const totalLabel = showPrice ? formatCurrency(order ? order.total : cartTotal) : undefined;
      const blob = await renderOrderVisualSummary({
        storeName: storeDisplayName,
        items: summaryItems,
        totalLabel,
        paymentMethodLabel: ORDER_PAYMENT_METHOD_LABELS.whatsapp,
      });
      const result = await shareMarketingCard({
        blob,
        productName: "pedido",
        text: message,
        title: `Pedido - ${storeDisplayName}`,
        dialogTitle: "Compartilhar pedido",
      });
      return result.method === "native-file" || result.method === "web-file";
    } catch (error) {
      if (isMarketingShareCancelledError(error)) return true; // usuário fechou o sheet de propósito — respeita a escolha, não força wa.me por cima.
      console.warn("[CATALOG] Resumo visual do pedido não pôde ser gerado — seguindo só com o texto:", error);
      return false;
    }
  };

  const handleChooseWhatsApp = async () => {
    if (sendingOrder) return;
    setSendingOrder(true);
    setOrderNotice("");
    try {
      const revalidation = await revalidateCart();
      if (!revalidation.ok) return;
      const order = await tryCreateOrder("whatsapp");
      const message = buildOrderMessage(ORDER_PAYMENT_METHOD_LABELS.whatsapp, order?.id);
      const visualHandled = await tryShareVisualOrder(message, order);
      if (visualHandled) { closeCart(); return; }
      const sent = openWhatsAppWithOrder(revalidation.whatsappNumber, ORDER_PAYMENT_METHOD_LABELS.whatsapp, order?.id);
      if (sent) closeCart();
    } catch (error) {
      console.warn("[CATALOG] Falha ao revalidar/enviar pedido:", error);
      setOrderNotice("Não foi possível confirmar seu pedido agora. Tente novamente em instantes.");
    } finally {
      setSendingOrder(false);
    }
  };

  const handleChoosePix = async () => {
    if (!store?.pixAvailable || placingOrder) return;
    setPlacingOrder("pix");
    setOrderNotice("");
    const freshClientOrderId = generateClientOrderId();
    setClientOrderId(freshClientOrderId);
    setActiveOrder(null);
    setPaidReported(false);
    try {
      const revalidation = await revalidateCart();
      if (!revalidation.ok) return;
      // O QR/chave são montados localmente e nunca dependem do pedido ter sido criado no servidor —
      // uma falha de rede aqui não pode impedir o cliente de ver como pagar (§FALLBACK).
      const result = await createPublicCatalogOrder(storeSlug!, {
        clientOrderId: freshClientOrderId,
        paymentMethod: "pix",
        items: cart.map((item) => ({ productId: item.product.id, quantity: item.quantity })),
      });
      setActiveOrder(result.ok ? result.order ?? null : null);
      setCheckoutStep("pix");
    } catch (error) {
      console.warn("[CATALOG] Falha ao preparar Pix:", error);
      setCheckoutStep("pix");
    } finally {
      setPlacingOrder(null);
    }
  };

  /**
   * RELEASE-CHECKOUT-03 §1/§3: checkout real self-service. Cria o pedido (server-side, preço já
   * autoritativo), pede a cobrança Mercado Pago (vinculada ao MESMO orderId, servidor decide
   * tudo — token/conta/valor) e redireciona para a página hospedada do Mercado Pago. O status
   * final NUNCA é decidido aqui (§4) — só o webhook (ou o lojista) marca "paid"; esta função só
   * chega até "levar o cliente para pagar".
   */
  const handleChooseCard = async () => {
    if (!store?.cardAvailable || placingOrder || !storeSlug) return;
    setPlacingOrder("card");
    setOrderNotice("");
    try {
      const revalidation = await revalidateCart();
      if (!revalidation.ok) return;
      const order = await tryCreateOrder("card");
      if (!order) {
        // §9: pedido não pôde nem ser registrado — fallback preservado, nunca perde o cliente.
        setOrderNotice("Não foi possível iniciar o pagamento por cartão agora. Tente novamente ou escolha Pix/WhatsApp.");
        return;
      }
      const payment = await createPublicCatalogOrderMercadoPagoPayment(storeSlug, order.id);
      if (!payment.ok || !payment.paymentUrl) {
        // §9: pedido PERMANECE criado (paymentStatus continua awaiting_customer_payment) — nunca
        // marca pago, nunca duplica cobrança; cliente pode tentar de novo ou trocar de forma de pagamento.
        setOrderNotice(payment.userMessage || "Não foi possível iniciar o pagamento por cartão agora. Tente novamente ou escolha Pix/WhatsApp.");
        return;
      }
      window.location.href = payment.paymentUrl;
    } catch (error) {
      console.warn("[CATALOG] Falha ao preparar pagamento por cartão:", error);
      setOrderNotice("Não foi possível confirmar seu pedido agora. Tente novamente em instantes.");
    } finally {
      setPlacingOrder(null);
    }
  };

  const handleMarkPaid = async () => {
    if (markingPaid || paidReported) return;
    setMarkingPaid(true);
    try {
      if (activeOrder && storeSlug) {
        const result = await markPublicCatalogOrderPaidByCustomer(storeSlug, activeOrder.id, clientOrderId);
        if (result.ok) {
          setPaidReported(true);
          return;
        }
      }
      // Sem pedido rastreado (falha na criação) — o aviso ainda chega ao vendedor, só que por WhatsApp.
      openWhatsAppWithOrder(store?.whatsappNumber, "Pix (cliente informou que já pagou)");
      setPaidReported(true);
    } finally {
      setMarkingPaid(false);
    }
  };

  const handleCopyPixKey = async () => {
    if (!pixKey) return;
    try {
      await navigator.clipboard.writeText(pixKey);
      setPixKeyCopied(true);
      setTimeout(() => setPixKeyCopied(false), 2000);
    } catch (error) {
      console.warn("[CATALOG] Falha ao copiar chave Pix:", error);
    }
  };

  if (loading) return <PageSkeleton variant="publicCatalog" />;

  if (!store || !experience) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-background p-6 text-center">
        <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-secondary"><Store className="h-10 w-10 text-muted-foreground" /></div>
        <h1 className="mb-2 text-xl font-bold">Catálogo Indisponível</h1>
        {/* Duas mensagens só: "essa loja não existe" é acionável pelo visitante, o resto é problema
            nosso e vira "tente de novo". A causa técnica exata fica no console, não na tela. */}
        <p className="text-sm text-muted-foreground" data-failure-reason={failureReason ?? undefined}>
          {failureReason === "store_not_found"
            ? "Este catálogo não foi encontrado ou está desativado pelo consultor."
            : loadFailed
              ? "Não foi possível carregar agora. Tente novamente em instantes."
              : "Este catálogo não foi encontrado ou está desativado pelo consultor."}
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f8fafc]">
      {paymentReturn && (
        <div
          className={`sticky top-0 z-[80] px-4 py-3 text-center text-sm font-bold text-white ${
            paymentReturn.status?.paymentStatus === "paid"
              ? "bg-emerald-600"
              : paymentReturn.loading || paymentReturn.hint !== "failure"
                ? "bg-amber-500"
                : "bg-rose-600"
          }`}
          role="status"
          data-testid="banner-payment-return"
        >
          {paymentReturn.status?.paymentStatus === "paid"
            ? "✅ Pagamento aprovado! O vendedor já foi notificado."
            : paymentReturn.loading
              ? "Confirmando seu pagamento..."
              : paymentReturn.hint === "failure"
                ? "Pagamento não foi concluído. Você pode tentar novamente ou escolher Pix/WhatsApp."
                : "Pagamento em processamento. O vendedor será notificado assim que for confirmado."}
        </div>
      )}
      {store.businessMode === "both" && (
        <div className="sticky top-0 z-[60] border-b border-slate-200 bg-white px-4 py-2.5" data-testid="hybrid-section-tabs">
          <div className="mx-auto flex max-w-3xl gap-2">
            <button
              type="button"
              onClick={() => setActiveSection("produtos")}
              data-testid="button-hybrid-section-produtos"
              aria-pressed={activeSection === "produtos"}
              className={`flex-1 rounded-full py-2.5 text-xs font-black uppercase tracking-wide transition-colors ${activeSection === "produtos" ? "bg-slate-950 text-white" : "bg-slate-100 text-slate-500"}`}
            >
              Produtos
            </button>
            <button
              type="button"
              onClick={() => setActiveSection("servicos")}
              data-testid="button-hybrid-section-servicos"
              aria-pressed={activeSection === "servicos"}
              className={`flex-1 rounded-full py-2.5 text-xs font-black uppercase tracking-wide transition-colors ${activeSection === "servicos" ? "bg-slate-950 text-white" : "bg-slate-100 text-slate-500"}`}
            >
              Serviços
            </button>
          </div>
        </div>
      )}

      {(store.businessMode !== "both" || activeSection === "produtos") && (
        <CatalogShowcase
          context="public"
          experience={experience}
          products={products}
          store={{
            name: storeDisplayName,
            logoUrl: store.logoUrl,
            bannerUrl: store.bannerUrl,
            bannerTitle: store.bannerTitle,
            description: storeDescription,
            showPrice: store.showPrice,
            showStock: store.showStock,
          }}
          searchTerm={searchTerm}
          selectedCategory={selectedCategory}
          selectedGender={selectedGender}
          cartQuantities={cartQuantities}
          productNicheIds={productNicheIds}
          cartCount={cartCount}
          onSearchTermChange={setSearchTerm}
          onCategoryChange={setSelectedCategory}
          onGenderChange={setSelectedGender}
          onAddToCart={addToCart}
          onUpdateQuantity={updateQuantity}
          onOpenCart={() => setShowCart(true)}
          onShareCatalog={handleShareCatalog}
          hasMore={hasMore}
          loadingMore={loadingMore}
          loadMoreError={loadMoreError}
          onLoadMore={loadMoreProducts}
        />
      )}

      {store.businessMode === "both" && activeSection === "servicos" && (
        <PublicCatalogServicesSection
          services={publicServices}
          loading={publicServicesLoading}
          failed={publicServicesError}
          searchTerm={serviceSearchTerm}
          onSearchTermChange={setServiceSearchTerm}
          storeSlug={storeSlug || ""}
        />
      )}

      {showCart && checkoutStep === "pix" && store?.pixAvailable && (
        <div className="fixed inset-0 z-[70] flex flex-col overflow-hidden bg-white" data-testid="drawer-pix">
          <div className="flex items-center justify-between border-b border-slate-200 px-5 pb-4 pt-[max(1.25rem,env(safe-area-inset-top))]">
            <button onClick={() => setCheckoutStep("cart")} className="flex min-h-11 min-w-11 items-center justify-center rounded-full bg-slate-100 transition-transform active:scale-95" aria-label="Voltar ao carrinho"><ChevronLeft className="h-5 w-5" /></button>
            <h3 className="text-lg font-black">Pagar com Pix</h3>
            <button onClick={closeCart} className="flex min-h-11 min-w-11 items-center justify-center rounded-full bg-slate-100 transition-transform active:scale-95" aria-label="Fechar pedido"><X className="h-5 w-5" /></button>
          </div>
          <div className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
            {!pixKey && !pixKeyFetchError && (
              <p className="text-center text-sm text-slate-500" data-testid="text-pix-key-loading">Carregando chave Pix...</p>
            )}
            {pixKeyFetchError && (
              <p className="rounded-xl bg-red-50 px-3.5 py-2.5 text-xs font-semibold text-red-700" role="alert" data-testid="text-pix-key-error">Não foi possível carregar a chave Pix agora. Volte ao carrinho e tente novamente.</p>
            )}
            {pixKey && (
              <>
                <div className="flex flex-col items-center gap-3 rounded-[1.5rem] border border-slate-200 bg-slate-50 p-5">
                  <QRCodeSVG
                    value={buildPixEmvPayload({ pixKey, merchantName: storeDisplayName, merchantCity: "BRASIL", amount: cartTotal })}
                    size={200}
                    data-testid="image-pix-qr"
                  />
                  <p className="text-center text-xs text-slate-500">Escaneie com o app do seu banco, ou copie a chave abaixo.</p>
                </div>
                <div className="space-y-2">
                  <p className="text-xs font-bold text-slate-500">Chave Pix</p>
                  <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white p-3">
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold" data-testid="text-pix-key">{pixKey}</span>
                    <button onClick={handleCopyPixKey} data-testid="button-copy-pix-key" className="flex min-h-9 items-center gap-1.5 rounded-full bg-primary px-3 text-xs font-black text-white shrink-0">
                      {pixKeyCopied ? <><Check className="h-3.5 w-3.5" /> Copiado</> : <><Copy className="h-3.5 w-3.5" /> Copiar</>}
                    </button>
                  </div>
                </div>
              </>
            )}
            {showPrice && (
              <div className="flex items-center justify-between rounded-2xl bg-slate-50 p-3.5">
                <span className="text-sm font-black text-slate-600">Valor a pagar</span>
                <span className="text-xl font-black text-slate-950">{formatCurrency(cartTotal)}</span>
              </div>
            )}
            <p className="rounded-xl bg-amber-50 px-3.5 py-2.5 text-xs font-semibold text-amber-800">
              Depois de pagar, toque em "Já fiz o pagamento" para avisar o vendedor. A confirmação final é feita por ele.
            </p>
          </div>
          <div className="shrink-0 space-y-2.5 border-t border-slate-200 bg-white px-5 pb-[max(1.25rem,calc(env(safe-area-inset-bottom)+0.75rem))] pt-3 shadow-[0_-10px_30px_rgba(15,23,42,0.06)]">
            <button
              onClick={handleMarkPaid}
              disabled={markingPaid || paidReported}
              data-testid="button-mark-paid"
              className="flex min-h-14 w-full items-center justify-center gap-3 rounded-[1.5rem] bg-slate-950 font-black text-white shadow-xl transition-transform active:scale-[0.99] disabled:opacity-60"
            >
              {paidReported ? <><Check className="h-5 w-5" /> Vendedor avisado</> : markingPaid ? "Avisando..." : "Já fiz o pagamento"}
            </button>
            {allowWhatsappOrders && (
              <button onClick={handleChooseWhatsApp} disabled={sendingOrder} className="min-h-11 w-full rounded-2xl text-xs font-black text-primary">Falar com o vendedor pelo WhatsApp</button>
            )}
          </div>
        </div>
      )}

      {showCart && checkoutStep === "cart" && (
        <div className="fixed inset-0 z-[70] flex flex-col overflow-hidden bg-white" data-testid="drawer-cart">
          <div className="flex items-center justify-between border-b border-slate-200 px-5 pb-4 pt-[max(1.25rem,env(safe-area-inset-top))]">
            <button onClick={closeCart} className="flex min-h-11 min-w-11 items-center justify-center rounded-full bg-slate-100 transition-transform active:scale-95" aria-label="Fechar pedido"><X className="h-5 w-5" /></button>
            <h3 className="text-lg font-black">Meu Pedido</h3>
            <div className="w-11" />
          </div>
          <div className={`${cart.length === 0 ? "min-h-0 flex-1" : "max-h-[52dvh] shrink-0"} space-y-3 overflow-y-auto px-5 pb-2 pt-4`}>
            {cart.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center px-6 text-center" data-testid="text-cart-empty">
                <div className="mb-4 flex h-20 w-20 items-center justify-center rounded-[2rem] bg-primary/10"><ShoppingCart className="h-9 w-9 text-primary/45" /></div>
                <p className="font-black text-slate-900">Seu carrinho está vazio</p>
                <p className="mt-2 max-w-[240px] text-sm leading-relaxed text-muted-foreground">Adicione produtos ao pedido para enviar pelo WhatsApp.</p>
                <button onClick={closeCart} className="mt-5 min-h-12 rounded-2xl bg-primary px-5 text-xs font-black text-white">Continuar comprando</button>
              </div>
            ) : cart.map((item) => (
              <div key={item.product.id} className="flex gap-3 rounded-[1.5rem] border border-slate-200 bg-slate-50 p-3.5" data-testid={`cart-item-${item.product.id}`}>
                <div className="h-14 w-14 shrink-0 overflow-hidden rounded-2xl border border-slate-200 bg-white"><ProductImageCard product={item.product} size="md" objectFit="contain" /></div>
                <div className="min-w-0 flex-1">
                  <h4 className="line-clamp-2 text-sm font-black leading-tight">{item.product.name}</h4>
                  <p className="mt-1 text-[10px] font-black uppercase tracking-[0.12em] text-primary">{item.product.brand || "Sem marca"}</p>
                  {showPrice && (
                    <>
                      <p className="mt-1.5 text-xs text-slate-500" data-testid={`text-cart-unit-price-${item.product.id}`}>Preço unitário: {formatCurrency(cartEffectivePrices.get(item.product.id) ?? 0)}</p>
                      <p className="text-sm font-black text-primary" data-testid={`text-cart-subtotal-${item.product.id}`}>Subtotal: {formatCurrency((cartEffectivePrices.get(item.product.id) ?? 0) * item.quantity)}</p>
                    </>
                  )}
                  <div className="mt-2.5 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <button onClick={() => updateQuantity(item.product.id, item.quantity - 1)} className="flex min-h-8 min-w-8 items-center justify-center rounded-full bg-white shadow-sm" aria-label="Diminuir quantidade"><Minus className="h-3.5 w-3.5" /></button>
                      <span className="text-sm font-black">{item.quantity}</span>
                      <button onClick={() => updateQuantity(item.product.id, item.quantity + 1)} disabled={item.quantity >= Number(item.product.stock || 0)} className="flex min-h-8 min-w-8 items-center justify-center rounded-full bg-white shadow-sm disabled:opacity-40" aria-label="Aumentar quantidade"><Plus className="h-3.5 w-3.5" /></button>
                    </div>
                    <button onClick={() => removeFromCart(item.product.id)} className="flex items-center gap-1 text-[11px] font-black text-red-600"><Trash2 className="h-3.5 w-3.5" /> Remover</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
          {cart.length > 0 && (
            <div className="shrink-0 space-y-2.5 border-t border-slate-200 bg-white px-5 pb-[max(1.25rem,calc(env(safe-area-inset-bottom)+0.75rem))] pt-3 shadow-[0_-10px_30px_rgba(15,23,42,0.06)]">
              <div className="space-y-2 rounded-2xl bg-slate-50 p-3.5">
                <div className="flex items-center justify-between"><span className="text-xs font-bold text-slate-500">Itens</span><span className="text-sm font-black">{cartCount}</span></div>
                {showPrice && (
                  <div className="flex items-center justify-between border-t border-slate-200 pt-2.5"><span className="text-sm font-black text-slate-600">Total</span><span className="text-2xl font-black text-slate-950" data-testid="text-cart-total">{formatCurrency(cartTotal)}</span></div>
                )}
              </div>
              {orderNotice && (
                <p className="rounded-xl bg-amber-50 px-3.5 py-2.5 text-xs font-semibold text-amber-800" role="status" data-testid="text-cart-order-notice">{orderNotice}</p>
              )}
              <button onClick={closeCart} className="min-h-11 w-full rounded-2xl text-xs font-black text-primary">Continuar comprando</button>
              {store?.pixAvailable && (
                <button
                  onClick={handleChoosePix}
                  disabled={placingOrder !== null}
                  data-testid="button-choose-pix"
                  className="flex min-h-14 w-full items-center justify-center gap-3 rounded-[1.5rem] border-2 border-slate-950 font-black text-slate-950 transition-transform active:scale-[0.99] disabled:opacity-60"
                >
                  <QrCode className="h-5 w-5" /> {placingOrder === "pix" ? "Preparando Pix..." : "Pagar com Pix"}
                </button>
              )}
              {store?.cardAvailable && (
                <button
                  onClick={handleChooseCard}
                  disabled={placingOrder !== null}
                  data-testid="button-choose-card"
                  className="flex min-h-14 w-full items-center justify-center gap-3 rounded-[1.5rem] border-2 border-slate-950 font-black text-slate-950 transition-transform active:scale-[0.99] disabled:opacity-60"
                >
                  <CreditCard className="h-5 w-5" /> {placingOrder === "card" ? "Preparando..." : "Pagar com cartão"}
                </button>
              )}
              {allowWhatsappOrders ? (
                <button
                  onClick={handleChooseWhatsApp}
                  disabled={sendingOrder}
                  data-testid="button-send-order-whatsapp"
                  className="flex min-h-14 w-full items-center justify-center gap-3 rounded-[1.5rem] bg-[#25D366] font-black text-white shadow-xl shadow-green-200 transition-transform active:scale-[0.99] disabled:opacity-60"
                >
                  <Send className="h-5 w-5" /> {sendingOrder ? "Confirmando pedido..." : "Enviar pedido no WhatsApp"}
                </button>
              ) : (
                <div className="rounded-[1.5rem] border border-dashed border-slate-300 bg-slate-50 px-4 py-4 text-center text-xs font-bold text-slate-500" data-testid="text-whatsapp-orders-disabled">
                  Este vendedor não está recebendo pedidos por WhatsApp no momento.
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <footer className="py-8 text-center text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">Criado com Revenda Smart</footer>
    </div>
  );
}
