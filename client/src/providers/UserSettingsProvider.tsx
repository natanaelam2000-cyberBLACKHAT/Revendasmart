import { createContext, useCallback, useContext, type ReactNode } from "react";
import { defaultSettings, type AppSettings } from "@/lib/mock-data";
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

  const refresh = useCallback(() => {
    invalidateUserSettings();
  }, []);

  return (
    <UserSettingsContext.Provider
      value={{
        settings: settings || defaultSettings,
        loading,
        error,
        onboarding_completed,
        refresh,
      }}
    >
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
