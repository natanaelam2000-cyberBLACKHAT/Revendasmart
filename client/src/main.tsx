import React from "react";
console.log("ENV TEST:", import.meta.env);
console.log("API KEY:", import.meta.env.VITE_FIREBASE_API_KEY);
import { createRoot } from "react-dom/client";
import { PlanProvider } from "@/providers/plan-provider";
import App from "./App";
import * as Sentry from "@sentry/react";
Sentry.init({
  dsn: "https://cb0fe78d7082742f863354a079796fcd@o4511473504354304.ingest.us.sentry.io/4511473992335360",

  integrations: [
    Sentry.browserTracingIntegration(),
    Sentry.replayIntegration(),
  ],

  tracesSampleRate: 0.1,
  replaysSessionSampleRate: 0.05,
  replaysOnErrorSampleRate: 1.0,

  sendDefaultPii: false,
});


class ErrorBoundary extends React.Component<any, any> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: any, info: any) {
    console.error("Erro capturado:", error, info);
  }

  render() {
    if (this.state.hasError) {
      return <div style={{ padding: 20 }}>Erro no app ⚠️</div>;
    }

    return this.props.children;
  }
}
import "./index.css";
import { APP_VERSION } from "./lib/mock-data";


// Announce patch version at startup
console.log(`[SETTINGS PATCH ACTIVE ${APP_VERSION}] useUserSettings.ts with onAuthStateChanged and direct user.getIdToken()`);

// Service Worker disabled temporarily in production
// TODO: Re-enable after fixing cache assets and ensuring offline support stability
// if ('serviceWorker' in navigator) {
//   window.addEventListener('load', () => {
//     navigator.serviceWorker.register('/sw.js').catch(err => {
//       console.log('SW registration failed: ', err);
//     });
//   });
// }

class GlobalErrorBoundary extends React.Component<{children: React.ReactNode}, {hasError: boolean}> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() { return { hasError: true }; }
  componentDidCatch(error: any, errorInfo: any) { console.error("Global Error:", error, errorInfo); }
  
  handleReset = () => {
    // Reset without browser confirm() for better mobile/PWA experience
    const confirmed = window.confirm === undefined ? true : window.confirm('Deseja limpar seus dados para tentar corrigir o erro?');
    if (confirmed !== false) {
      try {
        localStorage.clear();
      } catch (e) {
        console.warn("Failed to clear localStorage:", e);
      }
      window.location.href = window.location.origin;
    }
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6 text-center font-sans">
          <div className="w-20 h-20 bg-destructive/10 rounded-full flex items-center justify-center mb-6">
            <span className="text-4xl">⚠️</span>
          </div>
          <h1 className="text-xl font-bold mb-2">Ops! Algo deu errado.</h1>
          <p className="text-sm mb-8 text-muted-foreground">O aplicativo encontrou um erro e não pôde continuar.</p>
          <div className="flex flex-col gap-3 w-full max-w-xs">
            <button 
              onClick={() => window.location.search = '?safe=1'} 
              className="w-full bg-primary text-white px-6 py-4 rounded-2xl font-bold shadow-lg active:scale-95 transition-all"
            >
              Abrir Modo de Segurança
            </button>
            <button 
              onClick={this.handleReset} 
              className="w-full bg-destructive/10 text-destructive px-6 py-4 rounded-2xl font-bold border border-destructive/20 active:scale-95 transition-all"
            >
              Resetar Meus Dados
            </button>
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
        <GlobalErrorBoundary>
      <PlanProvider>
  <App />
</PlanProvider>
        </GlobalErrorBoundary>
      );
    }
  } catch (e) {
    console.error("Critical error on boot", e);
    createRoot(document.getElementById("root")!).render(
      <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6 text-center font-sans">
        <h1 className="text-xl font-bold mb-4">Erro Crítico</h1>
        <p className="text-sm mb-8 text-muted-foreground">Não foi possível carregar o RevendaSmart.</p>
        <button onClick={() => window.location.search = '?safe=1'} className="bg-primary text-white px-6 py-3 rounded-full font-bold">Abrir Modo de Segurança</button>
      </div>
    );
  }
}
