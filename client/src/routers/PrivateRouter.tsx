import { lazy, useEffect, useState } from "react";
import { Route, Switch, useLocation } from "wouter";
import { onAuthStateChanged } from "firebase/auth";
import { MaintenanceBanner } from "@/components/MaintenanceBanner";
import { UserFeedbackHost } from "@/components/UserFeedbackHost";
import { getApiUrl } from "@/lib/api-config";
import { getFirebaseAuth, logTelemetryEvent } from "@/lib/firebase";
import { PlanProvider } from "@/providers/PlanProvider";
import { useUserSettings, UserSettingsProvider } from "@/providers/UserSettingsProvider";

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
const Onboarding = lazy(() => import("@/pages/onboarding"));
const Reports = lazy(() => import("@/pages/reports"));
const Settings = lazy(() => import("@/pages/settings"));
const SettingsMercadoPago = lazy(() => import("@/pages/settings-mercadopago"));
const Admin = lazy(() => import("@/pages/admin"));
const Subscribe = lazy(() => import("@/pages/subscribe"));
const NotFound = lazy(() => import("@/pages/not-found"));

function PrivateRoutes() {
  const [location, setLocation] = useLocation();
  const [authState, setAuthState] = useState<{ uid: string | null; loading: boolean }>({ uid: null, loading: true });
  const { settings, loading: settingsLoading } = useUserSettings();

  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const referralUid = params.get("referral");

      if (referralUid && referralUid.trim()) {
        logTelemetryEvent("referral_link_opened", { referralUid, stage: "app_open" }).catch(() => {});

        const isValidUid = /^[a-zA-Z0-9_-]{10,}$/.test(referralUid);
        if (isValidUid) {
          try {
            localStorage.setItem("rs:referral_source", referralUid);
            logTelemetryEvent("referral_captured", { referralUid, stage: "app_open", result: "success" }).catch(() => {});
          } catch (error) {
            console.warn("Failed to save referral to localStorage:", error);
          }
        } else {
          logTelemetryEvent("referral_captured", { referralUid, stage: "app_open", result: "invalid" }).catch(() => {});
        }

        const newUrl = window.location.pathname + window.location.hash;
        window.history.replaceState({ path: newUrl }, "", newUrl);
      }
    }
  }, []);

  useEffect(() => {
    const auth = getFirebaseAuth();
    if (!auth) {
      setAuthState({ uid: null, loading: false });
      return;
    }

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setAuthState({ uid: user?.uid || null, loading: false });

      if (user?.uid) {
        try {
          const token = await user.getIdToken();
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
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (authState.loading) return;

    if (!authState.uid) {
      setLocation("/login");
      return;
    }

    if (settingsLoading || location === "/onboarding") return;
    if (settings?.onboarding_completed !== true) {
      setLocation("/onboarding");
    }
  }, [authState, settings, location, setLocation, settingsLoading]);

  return (
    <>
      <MaintenanceBanner />
      <UserFeedbackHost />
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
