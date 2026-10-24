import { AccountBootstrapError } from "./account-bootstrap";

/** Public feedback must never disclose whether a Firebase account exists. */
export const PASSWORD_RESET_ACCEPTED_MESSAGE =
  "Se houver uma conta elegível, as instruções poderão ser enviadas. Verifique a caixa de entrada e o spam.";

export interface AuthFeedback {
  kind: "credentials" | "invalid-email" | "network" | "rate-limited" | "configuration" | "timeout" | "cancelled" | "unknown";
  message: string;
  accepted?: boolean;
}

const CONFIGURATION_CODES = new Set([
  "auth/invalid-api-key", "auth/app-not-authorized", "auth/operation-not-allowed",
  "auth/unauthorized-domain", "auth/invalid-app-credential", "auth/project-not-found",
  "auth/unauthorized-continue-uri", "auth/invalid-continue-uri", "auth/missing-continue-uri",
  "auth/missing-android-pkg-name", "auth/missing-ios-bundle-id", "auth/invalid-dynamic-link-domain",
]);

function errorCode(error: unknown): string {
  return typeof error === "object" && error !== null && "code" in error
    && typeof error.code === "string" ? error.code : "";
}

function commonFeedback(error: unknown, reset: boolean): AuthFeedback | undefined {
  const code = errorCode(error);
  const kind = error instanceof AccountBootstrapError ? error.kind : undefined;
  if (code === "auth/invalid-email") return { kind: "invalid-email", message: "E-mail inválido." };
  if (code === "auth/network-request-failed" || kind === "network") {
    return { kind: "network", message: reset
      ? "Não foi possível confirmar a solicitação por uma falha de conexão. Verifique a rede e sua caixa de entrada antes de tentar novamente."
      : "Falha de conexão ao entrar. Verifique a rede e tente novamente." };
  }
  if (code === "auth/too-many-requests" || kind === "rate-limited") {
    return { kind: "rate-limited", message: "Muitas tentativas. Aguarde um momento e tente novamente." };
  }
  if (CONFIGURATION_CODES.has(code) || kind === "configuration") {
    return { kind: "configuration", message: reset
      ? "A recuperação de senha está indisponível por uma falha de configuração. Tente novamente mais tarde."
      : "A autenticação está indisponível por uma falha de configuração. Tente novamente mais tarde." };
  }
  if (kind === "timeout") {
    return { kind: "timeout", message: reset
      ? "Não foi possível confirmar a solicitação a tempo. Ela ainda pode ser concluída; verifique a caixa de entrada e o spam antes de tentar novamente."
      : "A autenticação demorou mais que o esperado. Aguarde a conclusão da solicitação anterior antes de tentar novamente." };
  }
  if (kind === "cancelled") return { kind: "cancelled", message: "Solicitação cancelada nesta tela." };
  return undefined;
}

export function getSignInFeedback(error: unknown): AuthFeedback {
  const common = commonFeedback(error, false);
  if (common) return common;
  if (["auth/invalid-credential", "auth/invalid-login-credentials", "auth/wrong-password",
    "auth/user-not-found", "auth/user-disabled"].includes(errorCode(error))) {
    return { kind: "credentials", message: "E-mail ou senha incorretos." };
  }
  return { kind: "unknown", message: "Não foi possível entrar. Tente novamente." };
}

export function getPasswordResetFeedback(error: unknown): AuthFeedback {
  if (["auth/user-not-found", "auth/user-disabled"].includes(errorCode(error))) {
    return { kind: "credentials", message: PASSWORD_RESET_ACCEPTED_MESSAGE, accepted: true };
  }
  return commonFeedback(error, true)
    ?? { kind: "unknown", message: "Não foi possível confirmar a solicitação. Verifique sua caixa de entrada antes de tentar novamente." };
}

/** In-memory only: a UI deadline does not cancel a non-abortable Firebase SDK call. */
export function createAuthSdkGate() {
  let pending = false;
  const listeners = new Set<(pending: boolean) => void>();
  const publish = () => {
    listeners.forEach((listener) => {
      try { listener(pending); } catch { /* A UI subscriber cannot own the SDK reservation. */ }
    });
  };
  return {
    isPending: () => pending,
    subscribe(listener: (pending: boolean) => void): () => void {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    run<T>(operation: () => Promise<T>): Promise<T> {
      if (pending) return Promise.reject(new AccountBootstrapError("cancelled", "auth"));
      pending = true;
      publish();
      let sdk: Promise<T>;
      try { sdk = Promise.resolve(operation()); }
      catch (error: unknown) { pending = false; publish(); return Promise.reject(error); }
      // The reservation is released by this real promise, never a UI timeout/finally.
      return sdk.then(
        (value) => { pending = false; publish(); return value; },
        (error: unknown) => { pending = false; publish(); throw error; },
      );
    },
  };
}
