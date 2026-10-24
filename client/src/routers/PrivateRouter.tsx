import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Route, Switch, useLocation } from "wouter";
import { onAuthStateChanged } from "firebase/auth";
import { UserFeedbackHost } from "@/components/UserFeedbackHost";
import { getApiUrl } from "@/lib/api-config";
import { getFirebaseAuth, logTelemetryEvent } from "@/lib/firebase";
import { isReferralCodeFormat } from "@shared/referral-code";
import { PlanProvider } from "@/providers/PlanProvider";
import { UserSettingsProvider } from "@/providers/UserSettingsProvider";
import { useUserSettings } from "@/providers/UserSettingsProvider";
import { resolveBusinessRouteGate } from "@/lib/business-route-gate";
import { PageSkeleton } from "@/components/PageSkeleton";
import { ACCOUNT_BOOTSTRAP_TIMEOUT_MS } from "@/lib/account-bootstrap";

const MaintenanceBanner = lazy(() => import("@/components/MaintenanceBanner").then((m) => ({ default: m.MaintenanceBanner })));
const ConnectivityIndicator = lazy(() => import("@/components/ConnectivityIndicator").then((m) => ({ default: m.ConnectivityIndicator })));

const Dashboard = lazy(() => import("@/pages/dashboard"));
const AddProduct = lazy(() => import("@/pages/add-product"));
const Products = lazy(() => import("@/pages/products"));
const Sell = lazy(() => import("@/pages/sell"));
const Catalog = lazy(() => import("@/pages/catalog"));
const Clients = lazy(() => import("@/pages/clients"));
const Orders = lazy(() => import("@/pages/orders"));
const ClientDetail = lazy(() => import("@/pages/client-detail"));
const Billings = lazy(() => import("@/pages/billings"));
const BillingCalendar = lazy(() => import("@/pages/billing-calendar"));
const Marketing = lazy(() => import("@/pages/marketing"));
const MonthlySales = lazy(() => import("@/pages/monthly-sales"));
const ProductsSold = lazy(() => import("@/pages/products-sold"));
const Onboarding = lazy(() => import("@/pages/onboarding"));
const Reports = lazy(() => import("@/pages/reports"));
const Settings = lazy(() => import("@/pages/settings"));
const SettingsMercadoPago = lazy(() => import("@/pages/settings-mercadopago"));
const PlanUsage = lazy(() => import("@/pages/plan-usage"));
const Plans = lazy(() => import("@/pages/plans"));
const Opportunities = lazy(() => import("@/pages/opportunities"));
const Admin = lazy(() => import("@/pages/admin"));
const SorteiosAdmin = lazy(() => import("@/pages/sorteios-admin"));
const Subscribe = lazy(() => import("@/pages/subscribe"));
const ServiceAgenda = lazy(() => import("@/pages/service-agenda"));
const ServicesList = lazy(() => import("@/pages/services-list"));
const ServicesNew = lazy(() => import("@/pages/services-new"));
const ServiceAvailabilitySettings = lazy(() => import("@/pages/service-availability-settings"));
const ServiceWorksList = lazy(() => import("@/pages/service-works-list"));
const ServiceWorkDetail = lazy(() => import("@/pages/service-work-detail"));
const NotFound = lazy(() => import("@/pages/not-found"));

function LegacyMarketingRedirect() {
  const [, setLocation] = useLocation();

  useEffect(() => {
    setLocation("/marketing?source=legacy-social", { replace: true });
  }, [setLocation]);

  return null;
}

function BootstrapFailure({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <section className="w-full max-w-sm rounded-2xl border bg-background p-6 text-center" role="alert">
        <h1 className="text-lg font-semibold">Não foi possível concluir o carregamento</h1>
        <p className="mt-3 text-sm text-muted-foreground">{message}</p>
        <button type="button" onClick={onRetry} className="mt-5 rounded-xl bg-primary px-5 py-3 font-semibold text-primary-foreground">
          Tentar novamente
        </button>
      </section>
    </main>
  );
}

function PrivateRoutes() {
  const [, setLocation] = useLocation();
  const [location] = useLocation();
  const { businessModeResolution, loading: settingsLoading, error: settingsError, refresh } = useUserSettings();
  const [authState, setAuthState] = useState<{ uid: string | null; loading: boolean; error?: string }>({ uid: null, loading: true });
  const [authAttempt, setAuthAttempt] = useState(0);
  const authRef = useRef<ReturnType<typeof getFirebaseAuth>>(null);
  const routeGate = resolveBusinessRouteGate(location, businessModeResolution);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const referralParam = (params.get("referral") ?? params.get("ref"))?.trim();
    if (!referralParam) return;

    logTelemetryEvent("referral_link_opened", { stage: "app_open" }).catch(() => {});
    // Tira o parâmetro da URL assim que lido, antes mesmo de a resolução (assíncrona, para código)
    // terminar — nunca deixa o UID/código sentado na barra de endereço, histórico ou referrer headers
    // por mais tempo que o necessário.
    const newUrl = window.location.pathname + window.location.hash;
    window.history.replaceState({ path: newUrl }, "", newUrl);

    const persistReferralSource = (referralCode: string) => {
      try {
        localStorage.setItem("rs:referral_source", referralCode);
        logTelemetryEvent("referral_captured", { stage: "app_open", result: "success", via: "code" }).catch(() => {});
      } catch (error) {
        console.warn("Failed to save referral to localStorage:", error);
      }
    };

    // RELEASE-28: só o código público fica no client até o backend autenticado resolver ownership.
    // Links legados com UID bruto deixam de ser aceitos aqui porque não existe forma segura de
    // distinguir "link antigo legítimo" de "UID arbitrário forjado pelo cliente".
    if (isReferralCodeFormat(referralParam)) {
      persistReferralSource(referralParam);
      return;
    }
    logTelemetryEvent("referral_captured", { stage: "app_open", result: "invalid" }).catch(() => {});
  }, []);

  useEffect(() => {
    const auth = getFirebaseAuth();
    authRef.current = auth;
    if (!auth) {
      setAuthState({ uid: null, loading: false });
      return;
    }

    let active = true;
    setAuthState({ uid: null, loading: true });
    const failAuth = () => {
      if (active) setAuthState({ uid: null, loading: false, error: "Não foi possível confirmar sua sessão. Tente novamente." });
    };
    const timeout = setTimeout(failAuth, ACCOUNT_BOOTSTRAP_TIMEOUT_MS);
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!active) return;
      clearTimeout(timeout);
      setAuthState({ uid: user?.uid || null, loading: false });

      if (user?.uid) {
        try {
          const token = await user.getIdToken();
          if (!active || auth.currentUser?.uid !== user.uid) return;
          await fetch(getApiUrl(`/api/plan/initialize/${user.uid}`), {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
          }).catch(() => undefined);
        } catch {
          // Plano inicial é revalidado pelo provider; falha aqui não bloqueia navegação.
        }
      }
    }, () => {
      clearTimeout(timeout);
      failAuth();
    });

    return () => {
      active = false;
      clearTimeout(timeout);
      unsubscribe();
    };
  }, [authAttempt]);

  useEffect(() => {
    if (authState.loading || authState.error) return;

    if (!authState.uid) {
      setLocation("/login");
    }
  }, [authState.error, authState.loading, authState.uid, setLocation]);

  useEffect(() => {
    if (authState.loading || authState.error || !authState.uid || authRef.current?.currentUser?.uid !== authState.uid || routeGate.kind !== "redirect") return;
    setLocation(routeGate.to, { replace: true });
  }, [authState.error, authState.loading, authState.uid, routeGate.kind, setLocation]);

  const retryAuthentication = () => {
    setAuthState({ uid: null, loading: true });
    setAuthAttempt(c => c + 1);
    refresh();
  };
  if (authState.error) {
    return <BootstrapFailure message={authState.error} onRetry={retryAuthentication} />;
  }
  if (authState.loading) {
    return <PageSkeleton variant="dashboard" />;
  }
  // Navigation effects are asynchronous: never mount a private page while redirecting a logout.
  if (!authState.uid) return null;
  if (authRef.current?.currentUser?.uid !== authState.uid) {
    return <BootstrapFailure message="Sua sessão mudou. Confirme-a novamente para continuar." onRetry={retryAuthentication} />;
  }
  if (settingsError || businessModeResolution.status === "error") {
    return <BootstrapFailure message={settingsError || "Não foi possível carregar as configurações da sua conta."} onRetry={refresh} />;
  }
  if (settingsLoading || businessModeResolution.status === "loading" || routeGate.kind === "redirect") {
    return <PageSkeleton variant="dashboard" />;
  }
  if (routeGate.kind === "unresolved") {
    return <BootstrapFailure message="Não foi possível confirmar as configurações da sua conta. Tente novamente." onRetry={refresh} />;
  }

  return (
    <>
      <Suspense fallback={null}>
        <MaintenanceBanner />
      </Suspense>
      <UserFeedbackHost />
      <Suspense fallback={null}>
        <ConnectivityIndicator />
      </Suspense>
      <Switch>
        <Route path="/onboarding" component={Onboarding} />
        <Route path="/" component={Dashboard} />
        <Route path="/products" component={Products} />
        <Route path="/add" component={AddProduct} />
        <Route path="/add-product" component={AddProduct} />
        <Route path="/edit-product/:id" component={AddProduct} />
        <Route path="/sale" component={Sell} />
        <Route path="/sell" component={Sell} />
        <Route path="/catalog" component={Catalog} />
        <Route path="/clients" component={Clients} />
        <Route path="/clients/:id" component={ClientDetail} />
        <Route path="/orders" component={Orders} />
        <Route path="/billings" component={Billings} />
        <Route path="/billing-calendar" component={BillingCalendar} />
        <Route path="/marketing" component={Marketing} />
        <Route path="/monthly-sales" component={MonthlySales} />
        <Route path="/products-sold" component={ProductsSold} />
        <Route path="/social" component={LegacyMarketingRedirect} />
        <Route path="/reports" component={Reports} />
        <Route path="/settings" component={Settings} />
        <Route path="/settings/mercadopago" component={SettingsMercadoPago} />
        <Route path="/settings/plano-e-uso" component={PlanUsage} />
        <Route path="/plans" component={Plans} />
        <Route path="/opportunities" component={Opportunities} />
        <Route path="/subscribe" component={Subscribe} />
        <Route path="/servicos" component={ServicesList} />
        <Route path="/servicos/agenda" component={ServiceAgenda} />
        <Route path="/servicos/novo" component={ServicesNew} />
        <Route path="/servicos/disponibilidade" component={ServiceAvailabilitySettings} />
        <Route path="/servicos/atendimentos" component={ServiceWorksList} />
        <Route path="/servicos/atendimentos/:workId" component={ServiceWorkDetail} />
        <Route path="/admin" component={Admin} />
        <Route path="/sorteios" component={SorteiosAdmin} />
        <Route path="/sorteios/:campaignId" component={SorteiosAdmin} />
        <Route component={NotFound} />
      </Switch>
    </>
  );
}

export default function PrivateRouter() {
  return (
    <UserSettingsProvider>
      <PlanProvider>
        <PrivateRoutes />
      </PlanProvider>
    </UserSettingsProvider>
  );
}
