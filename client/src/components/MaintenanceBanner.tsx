/**
 * MAINTENANCE BANNER
 * Controlled by Remote Config flag: maintenance_mode_enabled
 * Shows banner when maintenance mode is active
 * REACTIVE: Updates automatically when flag changes
 */

import { AlertCircle } from "lucide-react";
import { useMaintenanceInfo } from "@/lib/remote-config-context";

export function MaintenanceBanner() {
  const { enabled, message } = useMaintenanceInfo();

  if (!enabled) return null;

  return (
    <div 
      className="bg-yellow-100 border-l-4 border-yellow-500 p-4 mb-4"
      data-testid="banner-maintenance"
    >
      <div className="flex items-start gap-3">
        <AlertCircle className="w-5 h-5 text-yellow-700 flex-shrink-0 mt-0.5" />
        <div>
          <p className="font-semibold text-yellow-800">Modo de manutenção</p>
          {message && (
            <p className="text-sm text-yellow-700 mt-1">{message}</p>
          )}
        </div>
      </div>
    </div>
  );
}
