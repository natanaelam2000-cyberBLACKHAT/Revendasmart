import { safeLogger } from "@/lib/safe-logger";

export type SignupFailureStage =
  | "AUTH_ACCOUNT_CREATION"
  | "AUTH_TOKEN_ACQUISITION"
  | "BACKEND_PROFILE_CREATION"
  | "FIRESTORE_PROFILE_CREATION"
  | "SETTINGS_CREATION"
  | "ONBOARDING_BOOTSTRAP"
  | "NAVIGATION"
  | "UNKNOWN";

export type SignupAuthCode =
  | "auth/email-already-in-use"
  | "auth/invalid-email"
  | "auth/weak-password"
  | "auth/operation-not-allowed"
  | "auth/too-many-requests"
  | "auth/network-request-failed"
  | "auth/internal-error";

const KNOWN_AUTH_CODES = new Set<SignupAuthCode>([
  "auth/email-already-in-use",
  "auth/invalid-email",
  "auth/weak-password",
  "auth/operation-not-allowed",
  "auth/too-many-requests",
  "auth/network-request-failed",
  "auth/internal-error",
]);

export type SignupFailureDiagnostic = {
  stage: SignupFailureStage;
  firebaseAuthCode?: SignupAuthCode;
  httpStatus?: number;
  safeErrorCode: string;
  errorClass: string;
  networkOnline: boolean | null;
  timeout: boolean;
};

function authCodeOf(error: unknown): string {
  if (!error || typeof error !== "object" || !("code" in error)) return "";
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : "";
}

export function classifySignupFailure(
  error: unknown,
  stage: SignupFailureStage,
  networkOnline: boolean | null = typeof navigator === "undefined" ? null : navigator.onLine,
): SignupFailureDiagnostic {
  const code = authCodeOf(error);
  const firebaseAuthCode = KNOWN_AUTH_CODES.has(code as SignupAuthCode) ? code as SignupAuthCode : undefined;
  const timeout = code === "auth/network-request-failed" || code === "TIMEOUT";
  return {
    stage,
    ...(firebaseAuthCode ? { firebaseAuthCode } : {}),
    safeErrorCode: firebaseAuthCode ? firebaseAuthCode.replace("auth/", "").toUpperCase().replaceAll("-", "_") : "UNKNOWN",
    errorClass: firebaseAuthCode ? "FIREBASE_AUTH" : timeout ? "NETWORK_TIMEOUT" : "UNKNOWN",
    networkOnline,
    timeout,
  };
}

export function signupUserMessage(error: unknown): string {
  switch (authCodeOf(error)) {
    case "auth/email-already-in-use": return "Este email já está cadastrado";
    case "auth/invalid-email": return "Email inválido";
    case "auth/weak-password": return "Senha muito fraca. Use pelo menos 6 caracteres.";
    case "auth/operation-not-allowed": return "Cadastro por email indisponível no momento.";
    case "auth/too-many-requests": return "Muitas tentativas. Aguarde alguns instantes e tente novamente.";
    case "auth/network-request-failed": return "Verifique sua conexão e tente novamente.";
    case "auth/internal-error": return "Não foi possível criar a conta agora. Tente novamente em instantes.";
    default: return "Erro ao criar conta. Tente novamente.";
  }
}

export function logSignupFailure(diagnostic: SignupFailureDiagnostic): void {
  // Keep the event object explicit: no raw error, identity, credential, token or request data enters it.
  safeLogger.warn("auth.signup_failed", diagnostic);
}
