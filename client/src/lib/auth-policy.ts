export type SocialProvider = "google" | "facebook";

export function authErrorCode(error: unknown): string {
  return error && typeof error === "object" && "code" in error ? String(error.code) : "";
}

export function authErrorMessage(error: unknown): string {
  switch (authErrorCode(error)) {
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found": return "E-mail ou senha incorretos.";
    case "auth/invalid-email": return "Informe um e-mail válido.";
    case "auth/missing-email": return "Seu provedor não informou um e-mail. Use o acesso vinculado à sua conta.";
    case "auth/weak-password": return "Use uma senha com pelo menos 6 caracteres.";
    case "auth/email-already-in-use": return "Não foi possível criar a conta. Tente entrar ou recuperar sua senha.";
    case "auth/network-request-failed": return "Sem conexão. Verifique sua internet e tente novamente.";
    case "auth/too-many-requests": return "Muitas tentativas. Aguarde um pouco antes de tentar novamente.";
    case "auth/popup-closed-by-user":
    case "auth/cancelled-popup-request":
    case "auth/canceled": return "Entrada cancelada. Você pode tentar novamente.";
    case "auth/popup-blocked": return "Permita a janela de login no navegador e tente novamente.";
    case "auth/account-exists-with-different-credential": return "Entre com o método que você já usa nesta conta. Depois, confirme a vinculação nas configurações da conta.";
    case "auth/credential-already-in-use":
    case "auth/email-mismatch":
    case "auth/user-mismatch": return "Este acesso pertence a outra conta. Seus dados não foram transferidos nem mesclados.";
    case "auth/provider-already-linked": return "Este método já está vinculado à sua conta.";
    case "auth/requires-recent-login":
    case "auth/re-authentication-required": return "Confirme sua identidade novamente para continuar.";
    case "auth/operation-in-progress": return "Aguarde a operação em andamento.";
    case "auth/verification-cooldown": return "Aguarde um minuto antes de reenviar o e-mail.";
    case "auth/operation-not-allowed":
    case "auth/unauthorized-domain":
    case "auth/provider-unavailable": return "Este método de entrada ainda não está disponível. Use e-mail e senha.";
    case "auth/user-disabled": return "Esta conta está desativada. Entre em contato com o suporte.";
    default: return "Não foi possível concluir. Tente novamente.";
  }
}

export function authFailure(code: string): Error & { code: string } {
  return Object.assign(new Error(authErrorMessage({ code })), { code });
}

export const RESET_PASSWORD_MESSAGE = "Se houver uma conta para este e-mail, enviaremos as instruções para redefinir sua senha.";
