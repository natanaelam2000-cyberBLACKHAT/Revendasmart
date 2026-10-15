import assert from 'node:assert/strict';
import { createOnboardingPersistence, type OnboardingDependencies, type OnboardingPayload } from '../client/src/lib/onboarding-persistence';
import { OnboardingSaveError } from '../client/src/lib/onboarding-error';
const input = { businessMode: 'services', onboarding_completed: true };
for (const failure of [
  new OnboardingSaveError('OFFLINE'), new TypeError('Failed to fetch'),
  new DOMException('Request timed out', 'AbortError'),
  ...[400, 401, 403, 404, 409, 422, 429, 500, 502, 503].map(status => new OnboardingSaveError('HTTP_FAILURE', status)),
]) {
  let draft: OnboardingPayload | null = null;
  let fail = true;
  const deps: OnboardingDependencies = {
    authReady: async () => ({ uid: 'a', getIdToken: async () => 'synthetic' }), currentUid: () => 'a',
    readDraft: () => draft, writeDraft: (_uid, value) => { draft = value; },
    request: async (_uid, _token, payload) => { if (fail) throw failure; return { success: true, settings: payload }; },
  };
  const writer = createOnboardingPersistence(deps);
  await assert.rejects(writer.save('a', input));
  assert.deepEqual(draft, input, 'recoverable failure must preserve all choices');
  fail = false;
  await writer.resume('a');
  assert.equal(draft, null, 'a retry must recover after every tested failure');
}
for (const response of [null, {}, { success: false, settings: input }, { success: true },
  { success: true, settings: [] }, { success: true, settings: {} },
  { success: true, settings: { businessMode: 'products', onboarding_completed: true } },
  { success: true, settings: { businessMode: 'services', onboarding_completed: false } },
]) {
  let draft: OnboardingPayload | null = null;
  const writer = createOnboardingPersistence({
    authReady: async () => ({ uid: 'a', getIdToken: async () => 'synthetic' }), currentUid: () => 'a',
    readDraft: () => draft, writeDraft: (_uid, value) => { draft = value; },
    request: async () => response as Awaited<ReturnType<OnboardingDependencies['request']>>,
  });
  await assert.rejects(writer.save('a', input), /PERSISTENCE_NOT_CONFIRMED/);
  assert.deepEqual(draft, input, 'invalid acknowledgement cannot clear the pending draft');
}
let currentUid = 'a';
let releaseToken!: () => void;
const stalled = new Promise<string>(resolve => { releaseToken = () => resolve('synthetic'); });
let posts = 0;
const writer = createOnboardingPersistence({
  authReady: async () => ({ uid: 'a', getIdToken: () => stalled }), currentUid: () => currentUid,
  readDraft: () => null, writeDraft: () => false,
  request: async () => { posts++; return { success: true, settings: input }; },
});
const save = writer.save('a', input);
await new Promise(resolve => setTimeout(resolve, 0));
currentUid = 'b'; releaseToken();
await assert.rejects(save, /AUTH_CHANGED/);
assert.equal(posts, 0, 'account switch during token refresh must never POST the old user payload');
console.log('PASS onboarding matrix: offline/network/timeout, ten HTTP errors with recovery, eight invalid acknowledgements, account switch before POST');
