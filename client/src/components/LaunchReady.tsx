import { useEffect } from "react";
import { reportAppReady } from "@/lib/motion-bridge";
import { usePlan } from "@/providers/PlanProvider";
import { useUserSettings } from "@/providers/UserSettingsProvider";

/**
 * MOTION-SYSTEM-01 — observa (sem buscar nada) o estado de bootstrap que os providers já mantêm.
 * "Pronto" = settings e plano pararam de carregar — com sucesso OU com erro: ambos os hooks fazem
 * `loading=false` no `finally`, então um erro permanente libera a saída da motion e a tela real de
 * erro/login aparece (a motion nunca esconde falha). Não cria listener de auth nem fetch.
 */
export function LaunchReady() {
  const { loading: settingsLoading } = useUserSettings();
  const { loading: planLoading } = usePlan();
  const ready = !settingsLoading && !planLoading;

  useEffect(() => {
    if (ready) reportAppReady();
  }, [ready]);

  return null;
}
