import assert from 'node:assert/strict';
import { OnboardingSaveError, normalizeOnboardingError, onboardingRecoveryMessage } from '../client/src/lib/onboarding-error';
import { createOnboardingPersistence, type OnboardingDependencies } from '../client/src/lib/onboarding-persistence';

const cases: Array<[string, unknown, string]> = [
  ['offline', new OnboardingSaveError('OFFLINE'), 'OFFLINE'],
  ['timeout', new OnboardingSaveError('TIMEOUT'), 'TIMEOUT'],
  ['400', new OnboardingSaveError('VALIDATION', 400), 'HTTP_400_422'],
  ['422', new OnboardingSaveError('VALIDATION', 422), 'HTTP_400_422'],
  ['401', new OnboardingSaveError('AUTH', 401), 'HTTP_401'],
  ['403', new OnboardingSaveError('FORBIDDEN', 403), 'HTTP_403'],
  ['404', new OnboardingSaveError('NOT_FOUND', 404), 'HTTP_404'],
  ['409', new OnboardingSaveError('CONFLICT', 409), 'HTTP_409'],
  ['429', new OnboardingSaveError('RATE_LIMIT', 429), 'HTTP_429'],
  ['500', new OnboardingSaveError('SERVER', 500), 'HTTP_5XX'],
  ['503', new OnboardingSaveError('SERVER', 503), 'HTTP_5XX'],
  ['persistence', new OnboardingSaveError('PERSISTENCE_NOT_CONFIRMED'), 'PERSISTENCE_NOT_CONFIRMED'],
  ['network', new TypeError('Failed to fetch'), 'NETWORK_EXCEPTION'],
  ['unknown', new Error('backend exception'), 'UNKNOWN'],
];

for (const [label, error, expected] of cases) {
  assert.equal(normalizeOnboardingError(error).errorClass, expected, `${label} classification`);
}
assert.match(onboardingRecoveryMessage(new OnboardingSaveError('SERVER', 500)), /em instantes/);
assert.doesNotMatch(onboardingRecoveryMessage(new OnboardingSaveError('SERVER', 500)), /quando a conexão voltar/);
assert.match(onboardingRecoveryMessage(new OnboardingSaveError('OFFLINE')), /quando a internet voltar/);

const diagnostics: Record<string, unknown>[] = [];
const deps: OnboardingDependencies = {
  authReady: async () => ({ uid: 'uid-that-must-not-log', getIdToken: async () => 'Bearer secret-token' }),
  currentUid: () => 'uid-that-must-not-log',
  readDraft: () => null,
  writeDraft: () => true,
  request: async () => { throw new Error('Firestore response contains email@example.com and phone 5511999999999'); },
  onSaveFailed: fields => diagnostics.push(fields),
};
await assert.rejects(createOnboardingPersistence(deps).save('uid-that-must-not-log', { storeName: 'Private Store', phone: '5511999999999' }));
assert.equal(diagnostics.length, 1, 'one structured failure event');
const serialized = JSON.stringify(diagnostics[0]);
for (const forbidden of ['uid-that-must-not-log', 'secret-token', 'email@example.com', '5511999999999', 'Private Store', 'Firestore response']) {
  assert.equal(serialized.includes(forbidden), false, `diagnostic excludes ${forbidden}`);
}
for (const key of ['step', 'endpoint', 'httpStatus', 'safeErrorCode', 'errorClass', 'timeout', 'persistenceConfirmed', 'queueAttempt']) {
  assert.equal(Object.hasOwn(diagnostics[0], key), true, `diagnostic field ${key}`);
}
console.log('PASS onboarding diagnostics: classifications, neutral fallback, offline wording, sanitized structured failure event.');
