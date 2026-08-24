import { RemoteConfigProvider } from "@/components/RemoteConfigProvider";
import { GlobalErrorBoundary } from "@/components/GlobalErrorBoundary";
import { ThemeProvider } from "@/components/ThemeProvider";
import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";

import "./index.css";
import { installClientDiagnostics, reportClientDiagnostic } from "./lib/client-diagnostics";
import { APP_VERSION } from "./lib/mock-data";
import { safeLogger } from "./lib/safe-logger";
import { installAndroidBackButtonHandler } from "./lib/android-back-button";
import { installAndroidThemeSync } from "./lib/android-theme";

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

function renderSafeMode() {
  const handleReset = () => {
    const keysToRemove = Object.keys(localStorage).filter((key) =>
      key.startsWith("rs:") || key === "rs:users" || key === "rs:session",
    );
    keysToRemove.forEach((key) => localStorage.removeItem(key));
    localStorage.removeItem("app_version");
    window.location.href = window.location.origin;
  };

  createRoot(document.getElementById("root")!).render(
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6 text-center font-sans">
      <div className="w-20 h-20 bg-destructive/10 rounded-full flex items-center justify-center mb-6" aria-hidden="true">
        <span className="text-4xl">!</span>
      </div>
      <h1 className="text-2xl font-bold mb-2">Modo de Seguranca</h1>
      <p className="text-muted-foreground mb-8 text-sm">Use este modo para recuperar o acesso se o app nao estiver abrindo.</p>
      <div className="flex flex-col gap-4 w-full max-w-xs">
        <button
          onClick={handleReset}
          className="w-full bg-destructive text-white font-bold py-4 rounded-2xl shadow-lg active:scale-95 transition-all"
        >
          Limpar dados e reiniciar
        </button>
        <button
          onClick={() => { window.location.href = "/login"; }}
          className="w-full bg-secondary py-4 rounded-2xl font-bold active:scale-95 transition-all"
        >
          Ir para login
        </button>
      </div>
    </div>,
  );
}

function renderBootFailure() {
  createRoot(document.getElementById("root")!).render(
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6 text-center font-sans">
      <h1 className="text-xl font-bold mb-4">Ocorreu um erro temporario.</h1>
      <p className="text-sm mb-8 text-muted-foreground">Nao foi possivel carregar o Revenda Smart.</p>
      <div className="flex flex-col gap-3 w-full max-w-xs">
        <button onClick={() => window.location.reload()} className="bg-primary text-white px-6 py-3 rounded-2xl font-bold">
          Tentar novamente
        </button>
        <button onClick={() => { window.location.href = "/"; }} className="bg-secondary px-6 py-3 rounded-2xl font-bold">
          Voltar ao inicio
        </button>
      </div>
    </div>,
  );
}

installClientDiagnostics();

const searchParams = new URLSearchParams(window.location.search);
const isSafeMode = searchParams.get("safe") === "1";

if (isSafeMode) {
  renderSafeMode();
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
            <ThemeProvider>
              <RemoteConfigProvider>
                <App />
              </RemoteConfigProvider>
            </ThemeProvider>
          </GlobalErrorBoundary>
        </React.StrictMode>,
      );
      registerPwaServiceWorker();
      void installAndroidBackButtonHandler();
      installAndroidThemeSync();
    }
  } catch (error) {
    safeLogger.error("app_boot_failed", error, { module: "main" });
    void reportClientDiagnostic({ domain: "REACT", event: "app_boot_failed", result: "failure", severity: "fatal", error });
    renderBootFailure();
  }
}
