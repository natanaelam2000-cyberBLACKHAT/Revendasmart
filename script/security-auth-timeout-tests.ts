import assert from 'node:assert/strict';
import { apiRequest, ApiError } from '../client/src/lib/api-client';
import { createOnboardingPersistence } from '../client/src/lib/onboarding-persistence';
import { OnboardingSaveError, onboardingRecoveryMessage } from '../client/src/lib/onboarding-error';
let fetches = 0;
let releaseToken!: (value: string) => void;
const waitingToken = new Promise<string>(resolve => { releaseToken = resolve; });
const pending = apiRequest('/api/test-timeout', {
  auth: true, timeoutMs: 10, getAuthToken: () => waitingToken,
  fetchImpl: async () => { fetches++; return new Response('{}'); },
});
const outcome = await Promise.race([
  pending.then(() => 'resolved', error => error instanceof ApiError ? error.code : 'unexpected'),
  new Promise<string>(resolve => setTimeout(() => resolve('STUCK'), 150)),
]);
assert.equal(outcome, 'TIMEOUT', 'auth token acquisition must respect the API timeout');
releaseToken('synthetic-test');
await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(fetches, 0, 'a late token must not send the timed-out write');
const controller = new AbortController();
controller.abort();
await assert.rejects(apiRequest('/api/test-aborted', {
  auth: true, signal: controller.signal, getAuthToken: () => new Promise(() => {}),
}), (error: unknown) => error instanceof ApiError && error.code === 'REQUEST_ABORTED');
const draft = new Map<string, Record<string, unknown>>();
let stall = true;
const persistence = createOnboardingPersistence({
  authTimeoutMs: 10,
  authReady: async () => ({ uid: 'a', getIdToken: () => stall ? new Promise(() => {}) : Promise.resolve('synthetic') }),
  currentUid: () => 'a', readDraft: uid => draft.get(uid) ?? null,
  writeDraft: (uid, value) => { if (value) draft.set(uid, value); else draft.delete(uid); },
  request: async (_uid, _token, payload) => ({ success: true, settings: payload }),
});
await assert.rejects(persistence.save('a', { businessMode: 'services' }), /AUTH_TIMEOUT/);
assert.equal(draft.get('a')?.businessMode, 'services');
stall = false;
await persistence.resume('a');
assert.equal(draft.size, 0, 'retry after timed-out auth must recover and clear confirmed draft');
console.log('PASS auth deadlines: stalled token, caller abort, no late POST, durable onboarding retry');
assert.match(onboardingRecoveryMessage(new OnboardingSaveError('HTTP_FAILURE', 401)), /sessão expirou/);
assert.match(onboardingRecoveryMessage(new OnboardingSaveError('HTTP_FAILURE', 403)), /permissão/);
assert.match(onboardingRecoveryMessage(new OnboardingSaveError('OFFLINE')), /sem conexão/);
assert.match(onboardingRecoveryMessage(new OnboardingSaveError('AUTH_TIMEOUT')), /demorou/);
assert.match(onboardingRecoveryMessage(new OnboardingSaveError('HTTP_FAILURE', 422)), /Revise/);
assert.match(onboardingRecoveryMessage(new OnboardingSaveError('HTTP_FAILURE', 409)), /conflito/);
assert.match(onboardingRecoveryMessage(new OnboardingSaveError('HTTP_FAILURE', 429)), /Aguarde/);
assert.ok(!onboardingRecoveryMessage(new Error('internal confidential detail')).includes('confidential'));
console.log('PASS onboarding actionable errors: offline, timeout, 401/403/409/422/429, no internal details');
