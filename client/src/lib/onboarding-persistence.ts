import { normalizeOnboardingError, OnboardingSaveError, type OnboardingFailureDiagnostics } from './onboarding-error';
import { abortable } from './abortable';
export { OnboardingSaveError } from './onboarding-error';
export type OnboardingPayload = Record<string, unknown>;
export interface OnboardingIdentity { uid: string; getIdToken(): Promise<string> }
export interface OnboardingDependencies {
  authTimeoutMs?: number;
  authReady(): Promise<OnboardingIdentity | null>;
  currentUid(): string | null;
  request(uid: string, token: string, payload: OnboardingPayload): Promise<{ success?: boolean; settings?: OnboardingPayload }>;
  readDraft(uid: string): OnboardingPayload | null;
  writeDraft(uid: string, payload: OnboardingPayload | null): void | boolean;
  trace?(stage: string, fields: Record<string, unknown>): void;
  onSaveFailed?(fields: OnboardingFailureDiagnostics): void;
}
export function sanitizeOnboardingPayload(value: OnboardingPayload): OnboardingPayload {
  return JSON.parse(JSON.stringify(value)) as OnboardingPayload;
}
/** One ordered writer per authenticated tenant. A failed write never poisons the next retry. */
export function createOnboardingPersistence(deps: OnboardingDependencies) {
  async function authStep<T>(operation: Promise<T>): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new OnboardingSaveError('AUTH_TIMEOUT')), deps.authTimeoutMs ?? 30000);
    try { return await abortable(operation, controller.signal); }
    finally { clearTimeout(timer); }
  }
  const queues = new Map<string, Promise<unknown>>();
  const revisions = new Map<string, number>();
  const intents = new Map<string, { fingerprint: string; promise: Promise<{ success?: boolean; settings?: OnboardingPayload }> }>();
  function save(uid: string, input: OnboardingPayload) {
    const payload = sanitizeOnboardingPayload(input);
    const trace = (stage: string, fields: Record<string, unknown> = {}) => deps.trace?.(stage, {
      uidPresent: Boolean(uid), mode: ['products', 'services', 'both'].includes(String(payload.businessMode)) ? payload.businessMode : 'unselected', ...fields,
    });
    trace('save_start');
    const fingerprint = JSON.stringify(payload);
    const existing = intents.get(uid);
    if (existing?.fingerprint === fingerprint) { trace('duplicate_shared'); return existing.promise; }
    const revision = (revisions.get(uid) ?? 0) + 1;
    revisions.set(uid, revision);
    const stored = deps.writeDraft(uid, payload);
    trace('local_fallback', { stored: stored === true });
    const operation = (queues.get(uid) ?? Promise.resolve()).catch(() => {}).then(async () => {
      const user = await authStep(deps.authReady());
      trace('auth_ready', { authenticated: Boolean(user) });
      if (!user || user.uid !== uid || deps.currentUid() !== uid) throw new OnboardingSaveError('AUTH_CHANGED');
      const token = await authStep(user.getIdToken());
      if (deps.currentUid() !== uid) throw new OnboardingSaveError('AUTH_CHANGED');
      trace('remote_attempt');
      const result = await deps.request(uid, token, payload);
      if (deps.currentUid() !== uid) throw new OnboardingSaveError('AUTH_CHANGED');
      if (!result || result.success !== true || !result.settings || Array.isArray(result.settings) || typeof result.settings !== 'object' ||
          (payload.businessMode !== undefined && result.settings.businessMode !== payload.businessMode) ||
          (payload.onboarding_completed === true && result.settings.onboarding_completed !== true)) {
        throw new OnboardingSaveError('PERSISTENCE_NOT_CONFIRMED');
      }
      if (revisions.get(uid) === revision) deps.writeDraft(uid, null);
      trace('remote_success');
      return result;
    });
    queues.set(uid, operation);
    intents.set(uid, { fingerprint, promise: operation });
    void operation.catch((cause: unknown) => {
      const diagnostics = normalizeOnboardingError(cause);
      deps.onSaveFailed?.(diagnostics);
      trace('save_error', { ...diagnostics });
    });
    void operation.finally(() => {
      if (queues.get(uid) === operation) queues.delete(uid);
      if (intents.get(uid)?.promise === operation) intents.delete(uid);
    }).catch(() => {});
    return operation;
  }
  return { save, draft: deps.readDraft, resume: (uid: string) => {
    const draft = deps.readDraft(uid);
    if (draft) deps.trace?.('retry', { uidPresent: Boolean(uid) });
    return draft ? save(uid, draft) : Promise.resolve(null);
  } };
}
