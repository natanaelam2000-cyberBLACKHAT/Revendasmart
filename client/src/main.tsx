import { RemoteConfigProvider } from "@/components/RemoteConfigProvider";
import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
// import * as Sentry from "@sentry/react";

// Sentry temporariamente desativado para diagnóstico


import "./index.css";
import { APP_VERSION } from "./lib/mock-data";
import { safeLogger } from "./lib/safe-logger";

function registerPwaServiceWorker() {
  if (!("serviceWorker" in navigator) || !import.meta.env.PROD) return;

  const register = () => {
    window.setTimeout(() => {
      navigator.serviceWorker
        .register("/sw.js")
        .catch((error) => safeLogger.warn("service_worker_registration_failed", { module: "pwa", error }));
    }, 0);
  };

  if (document.readyState === "complete") {
    register();
  } else {
    window.addEventListener("load", register, { once: true });
  }
}


class GlobalErrorBoundary extends React.Component<{children: React.ReactNode}, {hasError: boolean}> {
  constructor(props: {children: React.ReactNode}) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() { return { hasError: true }; }
  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    safeLogger.error("global_error_boundary", error, { module: "main", componentStack: errorInfo.componentStack });
  }
  
  handleRetry = () => window.location.reload();

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6 text-center font-sans">
          <div className="w-20 h-20 bg-destructive/10 rounded-full flex items-center justify-center mb-6">
            <span className="text-4xl">⚠️</span>
          </div>
          <h1 className="text-xl font-bold mb-2">Ocorreu um erro temporário.</h1>
          <p className="text-sm mb-8 text-muted-foreground">Não foi possível concluir esta ação. Tente novamente em instantes.</p>
          <div className="flex flex-col gap-3 w-full max-w-xs">
            <button onClick={this.handleRetry} className="w-full bg-primary text-white px-6 py-4 rounded-2xl font-bold shadow-lg active:scale-95 transition-all">Tentar novamente</button>
            <button onClick={() => window.location.href = '/'} className="w-full bg-secondary text-foreground px-6 py-4 rounded-2xl font-bold active:scale-95 transition-all">Voltar ao início</button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const searchParams = new URLSearchParams(window.location.search);
const isSafeMode = searchParams.get('safe') === '1';

if (isSafeMode) {
  const handleReset = () => {
    const keysToRemove = Object.keys(localStorage).filter(k => 
      k.startsWith('rs:') || k === 'rs:users' || k === 'rs:session'
    );
    keysToRemove.forEach(k => localStorage.removeItem(k));
    localStorage.removeItem('app_version');
    window.location.href = window.location.origin;
  };

  createRoot(document.getElementById("root")!).render(
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6 text-center font-sans">
      <div className="w-20 h-20 bg-destructive/10 rounded-full flex items-center justify-center mb-6">
        <span className="text-4xl">🛡️</span>
      </div>
      <h1 className="text-2xl font-bold mb-2">Modo de Segurança</h1>
      <p className="text-muted-foreground mb-8 text-sm">Use este modo para recuperar o acesso se o app não estiver abrindo.</p>
      <div className="flex flex-col gap-4 w-full max-w-xs">
        <button 
          onClick={handleReset}
          className="w-full bg-destructive text-white font-bold py-4 rounded-2xl shadow-lg active:scale-95 transition-all"
        >
          Limpar Dados e Reiniciar
        </button>
        <button 
          onClick={() => window.location.href = '/login'}
          className="w-full bg-secondary py-4 rounded-2xl font-bold active:scale-95 transition-all"
        >
          Ir para Login
        </button>
      </div>
    </div>
  );
} else {
  try {
    const storedVersion = localStorage.getItem("app_version");
    if (storedVersion && storedVersion !== APP_VERSION) {
      localStorage.clear();
      localStorage.setItem("app_version", APP_VERSION);
      location.reload();
    } else {
      if (!storedVersion) localStorage.setItem("app_version", APP_VERSION);
 createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <GlobalErrorBoundary>
      <RemoteConfigProvider>
        <App />
      </RemoteConfigProvider>
    </GlobalErrorBoundary>
  </React.StrictMode>
);
registerPwaServiceWorker();
    }
  } catch (e) {
    safeLogger.error("app_boot_failed", e, { module: "main" });
    createRoot(document.getElementById("root")!).render(
      <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6 text-center font-sans">
        <h1 className="text-xl font-bold mb-4">Ocorreu um erro temporário.</h1>
        <p className="text-sm mb-8 text-muted-foreground">Não foi possível carregar o Revenda Smart.</p>
        <div className="flex flex-col gap-3 w-full max-w-xs"><button onClick={() => window.location.reload()} className="bg-primary text-white px-6 py-3 rounded-2xl font-bold">Tentar novamente</button><button onClick={() => window.location.href = '/'} className="bg-secondary px-6 py-3 rounded-2xl font-bold">Voltar ao início</button></div>
      </div>
    );
  }
}
