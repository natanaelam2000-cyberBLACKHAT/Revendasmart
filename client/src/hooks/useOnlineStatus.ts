import { useEffect, useState } from "react";

/**
 * RELEASE-QUALITY-04 §7 — status de conectividade real do navegador/WebView. `navigator.onLine` já é
 * suportado pelo WebView do Capacitor (Chromium) sem plugin nenhum — não precisa de `@capacitor/network`
 * pra isso.
 */
export function useOnlineStatus(): boolean {
  const [isOnline, setIsOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  return isOnline;
}
