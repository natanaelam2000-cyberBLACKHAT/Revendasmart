import { getApiUrl } from './api-config';
import { getFirebaseAuth, waitForAuthReady } from './firebase';
import { createOnboardingPersistence, OnboardingSaveError } from './onboarding-persistence';
import { normalizeOnboardingError } from './onboarding-error';

import { readOnboardingDraft, writeOnboardingDraft } from './onboarding-draft';
import { safeLogger } from './safe-logger';
export const onboardingPersistence = createOnboardingPersistence({
  authReady: waitForAuthReady,
  currentUid: () => getFirebaseAuth()?.currentUser?.uid ?? null,
  readDraft: readOnboardingDraft,
  writeDraft: writeOnboardingDraft,
  trace: (stage, fields) => safeLogger.warn('onboarding_persistence', { stage, ...fields, online: typeof navigator === 'undefined' ? undefined : navigator.onLine }),
  onSaveFailed: (fields) => safeLogger.warn('onboarding.save_failed', {
    ...fields,
    networkOnline: typeof navigator === 'undefined' ? null : navigator.onLine,
  }),
  request: async (uid, token, payload) => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) throw new OnboardingSaveError('OFFLINE');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch(getApiUrl(`/api/user/settings/${uid}`), {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload), signal: controller.signal,
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        const code = typeof data?.error === 'string' && /^[A-Z_]{3,80}$/.test(data.error) ? data.error : 'HTTP_FAILURE';
        const errorId = typeof data?.errorId === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(data.errorId) ? data.errorId : undefined;
        throw new OnboardingSaveError(code, response.status, errorId);
      }
      return data ?? {};
    } catch (cause) {
      if (cause instanceof OnboardingSaveError) throw cause;
      const normalized = normalizeOnboardingError(cause);
      if (normalized.errorClass === 'TIMEOUT') throw new OnboardingSaveError('TIMEOUT');
      if (normalized.errorClass === 'NETWORK_EXCEPTION') throw new OnboardingSaveError('NETWORK_EXCEPTION');
      throw new OnboardingSaveError('UNKNOWN');
    } finally { clearTimeout(timeout); }
  },
});
