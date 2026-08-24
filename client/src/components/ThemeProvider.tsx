/**
 * RELEASE-QUALITY-04 §1 — fino wrapper de `next-themes` (já dependência instalada, só nunca montado;
 * `sonner.tsx` já chama `useTheme()` esperando este provider existir). Não escreve lógica de tema
 * própria: `next-themes` já resolve "system" via `prefers-color-scheme`, persiste no localStorage
 * (imediato, sobrevive a restart) e evita flash de tema errado no primeiro paint.
 */
import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ReactNode } from "react";

export const APPEARANCE_THEME_STORAGE_KEY = "revenda-smart-theme";

export function ThemeProvider({ children }: { children: ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      storageKey={APPEARANCE_THEME_STORAGE_KEY}
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}
