import { RemoteConfigProvider } from "@/components/RemoteConfigProvider";
import { Switch, Route, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
// import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useEffect, useState, lazy, Suspense } from "react";
import { getFirebaseAuth, logTelemetryEvent } from "@/lib/firebase";
import { onAuthStateChanged } from "firebase/auth";
import { useUserSettings } from "@/hooks/useUserSettings";
import { getApiUrl } from "@/lib/api-config";

const Dashboard = lazy(() => import("@/pages/dashboard"));
const AddProduct = lazy(() => import("@/pages/add-product"));
const Products = lazy(() => import("@/pages/products"));
const Sell = lazy(() => import("@/pages/sell"));
const Catalog = lazy(() => import("@/pages/catalog"));
const Clients = lazy(() => import("@/pages/clients"));
const ClientDetail = lazy(() => import("@/pages/client-detail"));
const Billings = lazy(() => import("@/pages/billings"));
const BillingCalendar = lazy(() => import("@/pages/billing-calendar"));
const Marketing = lazy(() => import("@/pages/marketing"));
const MonthlySales = lazy(() => import("@/pages/monthly-sales"));
const ProductsSold = lazy(() => import("@/pages/products-sold"));
import Onboarding from "@/pages/onboarding";
import PublicCatalog from "@/pages/public-catalog";
const Reports = lazy(() => import("@/pages/reports"));
const Settings = lazy(() => import("@/pages/settings"));
const SettingsMercadoPago = lazy(() => import("@/pages/settings-mercadopago"));
const Admin = lazy(() => import("@/pages/admin"));
const Subscribe = lazy(() => import("@/pages/subscribe"));
import Login from "@/pages/login";
import Signup from "@/pages/signup";
import NotFound from "@/pages/not-found";
import { MaintenanceBanner } from "@/components/MaintenanceBanner";
import { RemoteConfigProvider } from "@/components/RemoteConfigProvider";

function Router() {
  const [location, setLocation] = useLocation();
  const [authState, setAuthState] = useState<{ uid: string | null; loading: boolean }>({ uid: null, loading: true });
  const { settings, loading: settingsLoading } = useUserSettings();

  // Capture referral param on app initialization
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const referralUid = params.get('referral');
      
      if (referralUid && referralUid.trim()) {
        // Log that referral link was opened
        logTelemetryEvent("referral_link_opened", { referralUid, stage: "app_open" }).catch(() => {});
        
        // Validate and persist referral to localStorage
        const isValidUid = /^[a-zA-Z0-9_-]{10,}$/.test(referralUid); // Basic UUID-like validation
        if (isValidUid) {
          try {
            localStorage.setItem("rs:referral_source", referralUid);
            logTelemetryEvent("referral_captured", { referralUid, stage: "app_open", result: "success" }).catch(() => {});
          } catch (e) {
            console.warn("Failed to save referral to localStorage:", e);
          }
        } else {
          // Invalid referral format
          logTelemetryEvent("referral_captured", { referralUid, stage: "app_open", result: "invalid" }).catch(() => {});
        }
        
        // Consume the param from URL to prevent re-processing
        const newUrl = window.location.pathname + window.location.hash;
        window.history.replaceState({ path: newUrl }, '', newUrl);
      }
    }
  }, []); // Run once on mount

  // Monitor Firebase Auth state
  useEffect(() => {
    const auth = getFirebaseAuth();
    if (!auth) {
      setAuthState({ uid: null, loading: false });
      return;
    }

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setAuthState({ uid: user?.uid || null, loading: false });
      
      // Initialize plan data on first login
      if (user?.uid) {
        try {
          const token = await user.getIdToken();
          await fetch(getApiUrl(`/api/plan/initialize/${user.uid}`), {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`
            },
          }).catch(err => console.log('[App] Plan init fetch error (expected if already exists):', err.message));
        } catch (err) {
          console.log('[App] Plan initialization error:', err);
        }
      }
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (authState.loading || settingsLoading) return;

    const isPublicRoute =
      location === "/login" ||
      location === "/signup" ||
      location.startsWith("/u/");

    // Redirect unauthenticated users to login
    if (!authState.uid && !isPublicRoute) {
      setLocation("/login");
      return;
    }

    // Guard: authenticated users who haven't completed onboarding
    // must go through /onboarding before accessing any other route
    if (authState.uid && !isPublicRoute && location !== "/onboarding") {
      if (settings?.onboarding_completed !== true) {
        setLocation("/onboarding");
      }
    }
  }, [authState, settings, location, setLocation, settingsLoading]);

  return (
    <>
      <MaintenanceBanner />
      <Switch>
        <Route path="/login" component={Login} />
        <Route path="/signup" component={Signup} />
        <Route path="/onboarding" component={Onboarding} />
        <Route path="/u/:storeSlug" component={PublicCatalog} />

        <Route path="/" component={Dashboard} />
      <Route path="/products" component={Products} />
      <Route path="/add" component={AddProduct} />
      <Route path="/edit-product/:id" component={AddProduct} />
      <Route path="/sale" component={Sell} />
      <Route path="/catalog" component={Catalog} />
      <Route path="/clients" component={Clients} />
      <Route path="/clients/:id" component={ClientDetail} />
      <Route path="/billings" component={Billings} />
      <Route path="/billing-calendar" component={BillingCalendar} />
      <Route path="/marketing" component={Marketing} />
      <Route path="/monthly-sales" component={MonthlySales} />
      <Route path="/products-sold" component={ProductsSold} />
      <Route path="/social" component={Marketing} />
      <Route path="/reports" component={Reports} />
      <Route path="/settings" component={Settings} />
      <Route path="/settings/mercadopago" component={SettingsMercadoPago} />
      <Route path="/subscribe" component={Subscribe} />
      <Route path="/admin" component={Admin} />

      <Route component={NotFound} />
    </Switch>
    </>
  );
}function App() {
  return (
    <QueryClientProvider client={queryClient}>
    <>
        <TooltipProvider>
          {/* <Toaster /> -- Disabled: causes insertBefore DOM error on initial render */}
         <Suspense fallback={<div>Carregando...</div>}>
  <Router />
</Suspense>
        </TooltipProvider>
     </>
    </QueryClientProvider>
  );
}

export default App;

