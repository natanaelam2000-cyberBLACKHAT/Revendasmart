/**
 * RELEASE-QUALITY-04 §1.6 — alinha status bar/navigation bar do Android com o tema resolvido
 * (claro/escuro). `@capacitor/status-bar` é a única peça que faltava (confirmado ausente antes desta
 * tarefa) — nada aqui roda fora de `Capacitor.isNativePlatform()`, então o build web/PWA não é afetado.
 */
const DARK_STATUS_BAR_COLOR = "#0F1419";
const LIGHT_STATUS_BAR_COLOR = "#FAF5F5";

let installed = false;

export async function applyAndroidStatusBarTheme(resolvedTheme: "light" | "dark"): Promise<void> {
  const { Capacitor } = await import("@capacitor/core");
  if (!Capacitor.isNativePlatform()) return;

  try {
    const { StatusBar, Style } = await import("@capacitor/status-bar");
    await StatusBar.setStyle({ style: resolvedTheme === "dark" ? Style.Dark : Style.Light });
    await StatusBar.setBackgroundColor({ color: resolvedTheme === "dark" ? DARK_STATUS_BAR_COLOR : LIGHT_STATUS_BAR_COLOR });
  } catch {
    // Dispositivo/plugin indisponível não pode derrubar o app — a UI web já reflete o tema certo
    // independente da status bar nativa conseguir acompanhar ou não.
  }
}

/** Instala UMA vez um listener que resolve o tema atual (via a classe `.dark` já aplicada pelo
 * next-themes no `<html>`) e reaplica sempre que ela mudar — sem depender de importar `useTheme` aqui
 * (mantém este módulo isolado de React, reaproveitável de qualquer lugar). */
export function installAndroidThemeSync(): void {
  if (installed || typeof document === "undefined") return;
  installed = true;

  const resolve = (): "light" | "dark" => (document.documentElement.classList.contains("dark") ? "dark" : "light");
  void applyAndroidStatusBarTheme(resolve());

  const observer = new MutationObserver(() => { void applyAndroidStatusBarTheme(resolve()); });
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
}
