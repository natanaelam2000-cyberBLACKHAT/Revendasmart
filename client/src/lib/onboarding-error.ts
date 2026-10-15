export class OnboardingSaveError extends Error {
  constructor(public code: string, public status?: number, public errorId?: string) {
    super(`Onboarding save failed: ${code}${status ? ` (HTTP ${status})` : ''}`);
    this.name = 'OnboardingSaveError';
  }
}

export type OnboardingFailureClass =
  | 'OFFLINE' | 'TIMEOUT' | 'HTTP_400_422' | 'HTTP_401' | 'HTTP_403' | 'HTTP_404'
  | 'HTTP_409' | 'HTTP_429' | 'HTTP_5XX' | 'PERSISTENCE_NOT_CONFIRMED'
  | 'NETWORK_EXCEPTION' | 'UNKNOWN';

export interface OnboardingFailureDiagnostics {
  step: string | null;
  endpoint: '/api/user/settings/:uid';
  httpStatus: number | null;
  safeErrorCode: string | null;
  errorClass: OnboardingFailureClass;
  timeout: boolean;
  persistenceConfirmed: boolean | null;
  queueAttempt: boolean;
}

const SAFE_CODE = /^[A-Z0-9_]{3,80}$/;

export function normalizeOnboardingError(error: unknown): OnboardingFailureDiagnostics {
  const saveError = error instanceof OnboardingSaveError ? error : null;
  const code = saveError && SAFE_CODE.test(saveError.code) ? saveError.code : null;
  const status = saveError?.status && saveError.status >= 100 && saveError.status <= 599 ? saveError.status : null;
  const timeout = code === 'AUTH_TIMEOUT' || code === 'TIMEOUT' || (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError'));
  let errorClass: OnboardingFailureClass = 'UNKNOWN';
  if (code === 'OFFLINE') errorClass = 'OFFLINE';
  else if (timeout) errorClass = 'TIMEOUT';
  else if (status === 401 || code === 'AUTH_CHANGED') errorClass = 'HTTP_401';
  else if (status === 403) errorClass = 'HTTP_403';
  else if (status === 404) errorClass = 'HTTP_404';
  else if (status === 409) errorClass = 'HTTP_409';
  else if (status === 429) errorClass = 'HTTP_429';
  else if (status === 400 || status === 422) errorClass = 'HTTP_400_422';
  else if (status !== null && status >= 500) errorClass = 'HTTP_5XX';
  else if (code === 'PERSISTENCE_NOT_CONFIRMED') errorClass = 'PERSISTENCE_NOT_CONFIRMED';
  else if (code === 'NETWORK_EXCEPTION' || (error instanceof TypeError && /fetch|network/i.test(error.message))) errorClass = 'NETWORK_EXCEPTION';
  return {
    step: null,
    endpoint: '/api/user/settings/:uid',
    httpStatus: status,
    safeErrorCode: code,
    errorClass,
    timeout,
    persistenceConfirmed: errorClass === 'PERSISTENCE_NOT_CONFIRMED' ? false : null,
    queueAttempt: true,
  };
}

export function onboardingRecoveryMessage(error: unknown): string {
  const code = error instanceof OnboardingSaveError ? error.code : '';
  const status = error instanceof OnboardingSaveError ? error.status : undefined;
  if (status === 401 || code === 'AUTH_CHANGED' || (error instanceof Error && error.message === 'Not authenticated')) {
    return 'Sua sessão expirou. Entre novamente. Suas escolhas foram mantidas.';
  }
  if (status === 403) return 'Você não tem permissão para salvar nesta conta. Verifique sua conta. Suas escolhas foram mantidas.';
  if (code === 'OFFLINE') return 'Você está sem conexão. Tente novamente quando a internet voltar. Suas escolhas foram mantidas.';
  if (code === 'AUTH_TIMEOUT' || (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError'))) {
    return 'A operação demorou mais que o esperado. Verifique sua conexão e tente novamente. Suas escolhas foram mantidas.';
  }
  if (code === 'TIMEOUT') return 'A operação demorou mais que o esperado. Tente novamente em instantes. Suas escolhas foram mantidas.';
  if (status === 404) return 'Não foi possível encontrar o serviço de salvamento. Tente novamente em instantes. Suas escolhas foram mantidas.';
  if (status === 409) return 'Não foi possível salvar devido a um conflito. Revise suas escolhas e tente novamente.';
  if (status === 400 || status === 422) return 'Revise os dados preenchidos e tente salvar novamente. Suas escolhas foram mantidas.';
  if (status === 429) return 'Muitas tentativas em pouco tempo. Aguarde um momento e tente novamente. Suas escolhas foram mantidas.';
  if (status !== undefined && status >= 500) return 'Não foi possível confirmar o salvamento agora. Tente novamente em instantes. Suas escolhas foram mantidas.';
  return 'Não foi possível confirmar o salvamento. Suas escolhas foram mantidas. Tente novamente em instantes.';
}
