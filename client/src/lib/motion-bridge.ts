/**
 * MOTION-SYSTEM-01 — ponte tipada entre o React e o Motion System (client/public/motion/*.js).
 *
 * O motor vive fora do bundle (ver docs/REVENDASMART-MOTION-SYSTEM.md) e é só apresentação: aqui o
 * React apenas (a) avisa que o estado de bootstrap JÁ EXISTENTE terminou e (b) pede a motion de
 * conclusão do onboarding. Nada aqui decide auth, settings, plano, tenant ou rota. Se o motor não
 * carregou (web comum, rota pública, falha de rede), as chamadas são no-ops.
 */
export type MotionBusinessMode = "products" | "services" | "both";

interface RsMotionHost {
  ready(): void;
  play(scene: "launch" | "complete", variant?: MotionBusinessMode): unknown;
}

declare global {
  interface Window {
    rsMotion?: RsMotionHost;
  }
}

/** Libera a SAÍDA da motion de launch. Latch no motor: idempotente, nunca "des-pronto". */
export function reportAppReady(): void {
  window.rsMotion?.ready();
}

/** Motion de conclusão do onboarding. Fire-and-forget: a navegação NÃO espera por ela. */
export function playOnboardingCompletionMotion(mode: MotionBusinessMode = "products"): void {
  window.rsMotion?.play("complete", mode);
}
