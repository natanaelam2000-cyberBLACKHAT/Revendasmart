import { QueryClientProvider } from "@tanstack/react-query";
import { lazy, Suspense } from "react";
import { Route, Switch, useLocation } from "wouter";
import { PageSkeleton } from "@/components/PageSkeleton";
import { TooltipProvider } from "@/components/ui/tooltip";
import { queryClient } from "./lib/queryClient";

const Login = lazy(() => import("@/pages/login"));
const Signup = lazy(() => import("@/pages/signup"));
const PublicCatalog = lazy(() => import("@/pages/public-catalog"));
const AccountDeletion = lazy(() => import("@/pages/account-deletion"));
const SorteioPublico = lazy(() => import("@/pages/sorteio-publico"));
const PublicServiceBooking = lazy(() => import("@/pages/public-service-booking"));
const NotFound = lazy(() => import("@/pages/not-found"));
const PrivateRouter = lazy(() => import("@/routers/PrivateRouter"));

function isPublicPath(path: string) {
  return path === "/login" || path === "/signup" || path === "/account-deletion" || path.startsWith("/u/") || path.startsWith("/sorteio/") || path.startsWith("/agendar/");
}

function PublicRouter() {
  return (
    <Switch>
      <Route path="/login" component={Login} />
      <Route path="/signup" component={Signup} />
      <Route path="/u/:storeSlug" component={PublicCatalog} />
      <Route path="/sorteio/:campaignSlug" component={SorteioPublico} />
      {/* SERV-PUBLIC-01 — mesmo padrão de /u/:storeSlug: público, sem login, lazy, fora do PrivateRouter. */}
      <Route path="/agendar/:storeSlug" component={PublicServiceBooking} />
      <Route path="/account-deletion" component={AccountDeletion} />
      <Route component={NotFound} />
    </Switch>
  );
}

function AppRouter() {
  const [location] = useLocation();
  return isPublicPath(location) ? <PublicRouter /> : <PrivateRouter />;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        {/* <Toaster /> -- Disabled: causes insertBefore DOM error on initial render */}
        <Suspense fallback={<PageSkeleton variant="dashboard" />}>
          <AppRouter />
        </Suspense>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
