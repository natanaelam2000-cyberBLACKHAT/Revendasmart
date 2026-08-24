/**
 * RELEASE-QUALITY-02 §3 — comportamento consistente do botão físico "voltar" do Android.
 *
 * Núcleo puro (`dismissible stack`) + wiring do plugin `@capacitor/app` (já usado pelo resto do app —
 * `@capacitor/core`/`@capacitor/android` já eram dependências; `@capacitor/app` é o pacote oficial da
 * própria família Capacitor especificamente para este evento, sem equivalente sem ele).
 *
 * Regra (idêntica em todo o app, nunca decidida por tela):
 *   1. Existe um modal/sheet/overlay dismissível aberto?  → fecha ELE, não navega, não sai do app.
 *   2. Não existe overlay aberto e há histórico de navegação? → volta uma tela (`history.back()`).
 *   3. Não existe overlay aberto e NÃO há histórico (já está na raiz)? → comportamento padrão do Android
 *      (minimizar/sair do app) — nunca uma navegação arbitrária inventada por nós.
 *
 * "Dismissível" é qualquer overlay que se registra via `useDismissibleOnBack` com seu próprio estado de
 * aberto/fechado — o registry é uma pilha (LIFO): fechar sempre afeta o overlay aberto por último, o que
 * já é o comportamento certo para overlays empilhados (ex.: um modal de confirmação sobre uma sheet).
 */

export interface DismissibleEntry {
  readonly dismiss: () => void;
}

const dismissibleStack: DismissibleEntry[] = [];

/** Registra um overlay como "voltar deve fechar isto primeiro". Devolve uma função de remoção — chame
 * no cleanup do efeito que controla a abertura do overlay. Puro, sem dependência de Capacitor/DOM, então
 * é testável isoladamente. */
export function pushDismissible(dismiss: () => void): () => void {
  const entry: DismissibleEntry = { dismiss };
  dismissibleStack.push(entry);
  return () => {
    const index = dismissibleStack.lastIndexOf(entry);
    if (index !== -1) dismissibleStack.splice(index, 1);
  };
}

/** Fecha o overlay mais recente, se algum estiver registrado. Devolve `true` se fechou algo (o chamador
 * do backButton deve parar aí — não navegar também). */
export function dismissTopmost(): boolean {
  const entry = dismissibleStack.pop();
  if (!entry) return false;
  entry.dismiss();
  return true;
}

/** Só para testes. */
export function __resetDismissibleStackForTests(): void {
  dismissibleStack.length = 0;
}
export function __getDismissibleStackSizeForTests(): number {
  return dismissibleStack.length;
}

let backButtonHandlerInstalled = false;

/**
 * Instala o listener real do hardware back (`@capacitor/app`). Seguro para chamar em qualquer ambiente:
 * no browser (fallback web/dev), `@capacitor/app` no-opa o listener em vez de lançar — o back físico do
 * Android simplesmente nunca dispara fora de um WebView nativo, então nada muda no navegador comum.
 * Idempotente: chamar mais de uma vez (ex.: hot reload) nunca duplica o listener.
 */
export async function installAndroidBackButtonHandler(): Promise<void> {
  if (backButtonHandlerInstalled) return;
  backButtonHandlerInstalled = true;
  try {
    const { App } = await import("@capacitor/app");
    App.addListener("backButton", ({ canGoBack }) => {
      if (dismissTopmost()) return;
      if (canGoBack) {
        window.history.back();
      } else {
        void App.exitApp();
      }
    });
  } catch {
    // Ambiente sem o plugin nativo disponível (ex.: SSR/teste) — nunca quebra o boot do app por causa
    // de um comportamento que só existe dentro do WebView Android.
    backButtonHandlerInstalled = false;
  }
}
