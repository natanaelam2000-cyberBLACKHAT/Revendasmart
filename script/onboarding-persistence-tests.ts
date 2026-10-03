import assert from 'node:assert/strict';
import { createOnboardingPersistence, type OnboardingPayload, type OnboardingDependencies } from '../client/src/lib/onboarding-persistence';

async function run() {
  let uid: string | null = 'a';
  let fail = false;
  let calls = 0;
  let releaseAuth: () => void = () => {};
  let ready = Promise.resolve();
  const drafts = new Map<string, OnboardingPayload>();
  const docs = new Map<string, OnboardingPayload>();
  const diagnostics: Array<{ stage: string; fields: Record<string, unknown> }> = [];
  const dependencies: OnboardingDependencies = {
    trace: (stage, fields) => { diagnostics.push({ stage, fields }); },
    authReady: async () => { await ready; return uid ? {uid, getIdToken: async () => 'local-test-token'} : null; },
    currentUid: () => uid,
    readDraft: id => drafts.get(id) ?? null,
    writeDraft: (id, payload) => { if (payload) drafts.set(id, payload); else drafts.delete(id); },
    request: async (id, _token, payload) => {
      calls++;
      if (fail) throw new TypeError('Failed to fetch');
      await new Promise(resolve => setTimeout(resolve, payload.onboarding_completed ? 0 : 5));
      docs.set(id, {...docs.get(id), ...payload});
      return {success: true, settings: docs.get(id)};
    },
  };
  const persistence = createOnboardingPersistence(dependencies);
  // Historical structural defect: independent autosave can land AFTER completion.
  let legacyCompleted = false;
  await Promise.all([
    new Promise<void>(resolve => setTimeout(() => {legacyCompleted = false; resolve();}, 10)),
    new Promise<void>(resolve => setTimeout(() => {legacyCompleted = true; resolve();}, 0)),
  ]);
  assert.equal(legacyCompleted, false, 'legacy concurrent autosave overwrites completion');
  await Promise.all([persistence.save('a', {onboarding_completed: false}), persistence.save('a', {onboarding_completed: true})]);
  assert.equal(docs.get('a')?.onboarding_completed, true, 'ordered save fixes delayed autosave regression');
  uid = null;
  ready = new Promise<void>(resolve => {releaseAuth = resolve;});
  const waiting = persistence.save('a', {onboarding_completed: true});
  const before = calls;
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(calls, before, 'no request before auth bootstrap completes');
  uid = 'a'; releaseAuth(); await waiting;
  const duplicateBefore = calls;
  await Promise.all([persistence.save('a', {storeName: 'Same'}), persistence.save('a', {storeName: 'Same'})]);
  assert.equal(calls - duplicateBefore, 1, 'double submit shares a single write');
  fail = true;
  await assert.rejects(persistence.save('a', {businessMode: 'services', onboarding_completed: true}), /Failed to fetch/);
  assert.equal(drafts.get('a')?.businessMode, 'services');
  // Recreate command after document/app restart using the same durable draft.
  fail = false; await createOnboardingPersistence(dependencies).resume('a');
  assert.equal(docs.get('a')?.businessMode, 'services');
  assert.equal(drafts.has('a'), false);
  docs.set('a', {...docs.get('a'), existing: 'keep'});
  for (let cycle = 0; cycle < 20; cycle++) {
    const mode = ['products', 'services', 'both'][cycle % 3];
    await persistence.save('a', {businessMode: mode, optional: undefined, onboarding_completed: true});
    assert.equal(docs.get('a')?.businessMode, mode);
    assert.equal(docs.get('a')?.onboarding_completed, true);
    assert.equal(docs.get('a')?.existing, 'keep');
    assert.equal(Object.hasOwn(docs.get('a')!, 'optional'), false);
  }
  uid = 'b';
  await assert.rejects(persistence.save('a', {onboarding_completed: true}), /AUTH_CHANGED/);
  assert.equal(docs.size, 1, 'wrong tenant cannot create duplicate document');
  for (const stage of ['save_start', 'auth_ready', 'remote_attempt', 'remote_success', 'local_fallback', 'retry', 'save_error', 'duplicate_shared']) {
    assert.ok(diagnostics.some(event => event.stage === stage), `diagnostic stage ${stage}`);
  }
  assert.ok(!JSON.stringify(diagnostics).includes('local-test-token'), 'diagnostics must not contain tokens');
  console.log('PASS onboarding persistence: delayed autosave regression, auth-ready/null/tenant, retry/draft, undefined, three modes, preservation; 20/20 cycles.');
}
void run();
