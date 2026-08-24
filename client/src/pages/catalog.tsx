import { useEffect, useMemo, useRef, useState } from "react";
import { CatalogShowcase } from "@/components/catalog/CatalogShowcase";
import { ShareCatalogSheet } from "@/components/catalog/ShareCatalogSheet";
import { PageSkeleton } from "@/components/PageSkeleton";
import { Layout } from "@/components/layout";
import { useProductsData } from "@/hooks/useProductsData";
import { useSalesData } from "@/hooks/useSalesData";
import { resolveCatalogExperience } from "@/lib/catalog-experience";
import { getFirebaseAuth, logTelemetryEvent, trackAnalyticsEvent } from "@/lib/firebase";
import type { AppSettings } from "@/lib/mock-data";
import { notifyInfo, notifyWarning } from "@/lib/notify";
import { buildPublicCatalogUrl } from "@/lib/public-url";
import { useUserSettings } from "@/providers/UserSettingsProvider";

type CatalogStoreSettings = AppSettings & {
  storeBannerUrl?: string;
  storeBannerTitle?: string;
  storeBannerSubtitle?: string;
  storeDescription?: string;
};

// Catálogo do revendedor é só visualização/divulgação — não tem carrinho de cliente.
// Passamos valores inertes para os props de carrinho (compartilhados com o catálogo público
// via CatalogShowcase) em vez de alterar o contrato do componente, que o catálogo público
// ainda usa de verdade.
const NO_CART_QUANTITIES = new Map<string, number>();
const noop = () => {};

export default function Catalog() {
  const { products, loading, error: productsError } = useProductsData();
  const { sales, loading: salesLoading, error: salesError } = useSalesData();
  const dataError = productsError || salesError;
  const { settings } = useUserSettings();
  const [search, setSearch] = useState("");
  const [genderFilter, setGenderFilter] = useState("todos");
  const [categoryFilter, setCategoryFilter] = useState("todos");
  const [showShareModal, setShowShareModal] = useState(false);
  const [copied, setCopied] = useState(false);
  const copyResetTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const experienceNowRef = useRef(new Date());

  useEffect(() => () => {
    if (copyResetTimeoutRef.current) clearTimeout(copyResetTimeoutRef.current);
  }, []);

  const experience = useMemo(() => resolveCatalogExperience({
    businessType: settings?.businessType,
    businessTypes: settings?.businessTypes,
    customCategoriesByNicho: settings?.customCategoriesByNicho,
    products,
    sales,
    lowStockThreshold: settings?.lowStockThreshold ?? 3,
    now: experienceNowRef.current,
  }), [products, sales, settings?.businessType, settings?.businessTypes, settings?.customCategoriesByNicho, settings?.lowStockThreshold]);

  const catalogSettings = settings as CatalogStoreSettings | undefined;
  const hasCatalogSlug = Boolean(settings?.catalogSlug || settings?.catalog_slug);
  const catalogSlug = settings?.catalogSlug || settings?.catalog_slug || "seu-catalogo";
  const catalogUrl = buildPublicCatalogUrl(catalogSlug);

  const handleCopyLink = async () => {
    if (!hasCatalogSlug) {
      notifyWarning("Configure o link do seu catálogo em Configurações antes de compartilhar.");
      return;
    }
    try {
      await navigator.clipboard.writeText(catalogUrl);
      setCopied(true);
      if (copyResetTimeoutRef.current) clearTimeout(copyResetTimeoutRef.current);
      copyResetTimeoutRef.current = setTimeout(() => setCopied(false), 2000);
      const user = getFirebaseAuth()?.currentUser;
      logTelemetryEvent("catalog_link_shared", { catalogSlug }, user?.uid);
      trackAnalyticsEvent("catalog_shared", { method: "copy" });
    } catch {
      setCopied(false);
    }
  };

  const handleShareWhatsApp = () => {
    if (!hasCatalogSlug) {
      notifyWarning("Configure o link do seu catálogo em Configurações antes de compartilhar.");
      return;
    }
    const message = `Confira meu catálogo de produtos! ${catalogUrl}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, "_blank");
    setShowShareModal(false);
    const user = getFirebaseAuth()?.currentUser;
    logTelemetryEvent("catalog_link_shared", { catalogSlug }, user?.uid);
    trackAnalyticsEvent("catalog_shared", { method: "whatsapp" });
  };

  const handleShareInstagram = async () => {
    if (!hasCatalogSlug) {
      notifyWarning("Configure o link do seu catálogo em Configurações antes de compartilhar.");
      return;
    }
    const user = getFirebaseAuth()?.currentUser;
    const text = `Confira meu catálogo de produtos! ${catalogUrl}`;
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title: "Meu catálogo", text, url: catalogUrl });
        logTelemetryEvent("catalog_link_shared", { catalogSlug }, user?.uid);
        trackAnalyticsEvent("catalog_shared", { method: "instagram" });
      } catch {
        // Usuário cancelou o share sheet nativo — nenhuma ação necessária.
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(catalogUrl);
      notifyInfo("Link copiado. Cole no Instagram.");
      logTelemetryEvent("catalog_link_shared", { catalogSlug }, user?.uid);
      trackAnalyticsEvent("catalog_shared", { method: "instagram" });
    } catch {
      notifyWarning("Não foi possível copiar o link.");
    }
  };

  if (loading || salesLoading) {
    return <Layout title="Catálogo"><PageSkeleton variant="cards" /></Layout>;
  }

  // P1-03: antes, uma falha de leitura (rede/Firestore) caía direto no render normal com arrays vazios —
  // indistinguível de "catálogo sem produtos ainda". Mesmo padrão de erro+retry já usado em dashboard.tsx.
  if (dataError) {
    return (
      <Layout title="Catálogo">
        <div className="mx-auto max-w-3xl px-4 py-8 text-center">
          <p className="mb-2 font-bold text-destructive">Ocorreu um erro temporário.</p>
          <p className="mb-4 text-sm text-muted-foreground">Não foi possível carregar seu catálogo.</p>
          <button type="button" onClick={() => window.location.reload()} className="rounded-xl bg-primary px-5 py-3 text-sm font-bold text-white">Tentar novamente</button>
        </div>
      </Layout>
    );
  }

  return (
    <Layout title="Catálogo">
      <CatalogShowcase
        context="seller"
        experience={experience}
        products={products}
        store={{
          name: settings?.storeName || "Minha Loja",
          logoUrl: settings?.storeLogo,
          bannerUrl: catalogSettings?.storeBannerUrl || settings?.storeIdentity?.heroImageUrl,
          bannerTitle: catalogSettings?.storeBannerTitle,
          description: catalogSettings?.storeDescription || catalogSettings?.storeBannerSubtitle,
          showPrice: true,
          showStock: true,
        }}
        searchTerm={search}
        selectedCategory={categoryFilter}
        selectedGender={genderFilter}
        cartQuantities={NO_CART_QUANTITIES}
        cartCount={0}
        onSearchTermChange={setSearch}
        onCategoryChange={setCategoryFilter}
        onGenderChange={setGenderFilter}
        onAddToCart={noop}
        onUpdateQuantity={noop}
        onOpenCart={noop}
        onShareCatalog={() => setShowShareModal(true)}
        onCreateProduct={() => { window.location.href = "/add-product"; }}
      />

      <ShareCatalogSheet
        open={showShareModal}
        onClose={() => setShowShareModal(false)}
        catalogUrl={catalogUrl}
        hasCatalogSlug={hasCatalogSlug}
        copied={copied}
        onCopyLink={handleCopyLink}
        onShareWhatsApp={handleShareWhatsApp}
        onShareInstagram={handleShareInstagram}
      />
    </Layout>
  );
}
