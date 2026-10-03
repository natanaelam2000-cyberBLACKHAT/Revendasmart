import { getApiUrl } from './api-config';
import { getFirebaseAuth, waitForAuthReady, logError } from './firebase';
import { createOnboardingPersistence, OnboardingSaveError } from './onboarding-persistence';

import { readOnboardingDraft, writeOnboardingDraft } from './onboarding-draft';
import { safeLogger } from './safe-logger';
export const onboardingPersistence = createOnboardingPersistence({
  authReady: waitForAuthReady,
  currentUid: () => getFirebaseAuth()?.currentUser?.uid ?? null,
  readDraft: readOnboardingDraft,
  writeDraft: writeOnboardingDraft,
  trace: (stage, fields) => safeLogger.warn('onboarding_persistence', { stage, ...fields, online: typeof navigator === 'undefined' ? undefined : navigator.onLine }),
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
      logError('onboarding_persistence_rejected', cause instanceof Error ? cause.message : 'Unknown error', {
        error: cause instanceof Error ? cause : undefined,
        context: { payloadKeys: Object.keys(payload), documentPath: 'user_settings/{uid}', uidPresent: Boolean(uid), online: navigator.onLine, name: cause instanceof Error ? cause.name : 'UnknownError', code: cause instanceof OnboardingSaveError ? cause.code : 'UNKNOWN' },
      });
      throw cause;
    } finally { clearTimeout(timeout); }
  },
});
