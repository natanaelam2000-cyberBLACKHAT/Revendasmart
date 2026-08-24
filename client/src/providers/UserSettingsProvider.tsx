import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from "react";
import { useTheme } from "next-themes";
import { defaultSettings, type AppSettings } from "@/lib/mock-data";
import { applyAppTheme } from "@/lib/app-themes";
import {
  invalidateUserSettings,
  useUserSettings as useUserSettingsSource,
} from "@/hooks/useUserSettings";

interface UserSettingsContextValue {
  settings: AppSettings;
  loading: boolean;
  error?: string;
  onboarding_completed: boolean;
  refresh: () => void;
}

const UserSettingsContext = createContext<UserSettingsContextValue | null>(null);

export function UserSettingsProvider({ children }: { children: ReactNode }) {
  const { settings, loading, error, onboarding_completed } = useUserSettingsSource();
  const resolvedSettings = settings || defaultSettings;
  // RELEASE-QUALITY-04 §1: applyAppTheme decide o que aplicar olhando pra classe .dark no <html> — mas
  // só reage a ELA sozinha se algo disparar o efeito de novo. `resolvedTheme` do next-themes garante
  // que alternar claro/escuro/sistema (sem recarregar nem trocar nenhuma configuração) reaplica o tema
  // de marca corretamente para o modo novo, em vez de deixar valores inline do modo anterior presos.
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    applyAppTheme(resolvedSettings);
  }, [resolvedSettings, resolvedTheme]);

  const refresh = useCallback(() => {
    invalidateUserSettings();
  }, []);

  const value = useMemo<UserSettingsContextValue>(() => ({
    settings: resolvedSettings,
    loading,
    error,
    onboarding_completed,
    refresh,
  }), [error, loading, onboarding_completed, refresh, resolvedSettings]);

  return (
    <UserSettingsContext.Provider value={value}>
      {children}
    </UserSettingsContext.Provider>
  );
}

export function useUserSettings() {
  const context = useContext(UserSettingsContext);
  if (!context) {
    throw new Error("useUserSettings must be used within UserSettingsProvider");
  }
  return context;
}
