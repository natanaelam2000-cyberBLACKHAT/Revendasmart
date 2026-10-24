import assert from "node:assert/strict";
import { requireAdmin } from "../server/admin-auth";
import { createRequireAuth, createRequireOwnership, type FirebaseAdminForRequestAuth } from "../server/auth-authorization-middleware";
import { createGetUserSettingsHandler, type FirebaseAdminForSettingsRead } from "../server/user-settings-read";

type ResponseRecorder = {
  statusCode?: number;
  body?: unknown;
  status(code: number): ResponseRecorder;
  json(body: unknown): ResponseRecorder;
};

function responseRecorder(): ResponseRecorder {
  return {
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function request(authorization?: string, overrides: Record<string, unknown> = {}) {
  return {
    headers: authorization === undefined ? {} : { authorization },
    method: "GET",
    path: "/api/user/settings/synthetic-owner",
    params: { userId: "synthetic-owner" },
    ...overrides,
  } as any;
}

function firebaseMock(options: {
  verify?: () => Promise<{ uid: string }>;
  deletion?: () => Promise<{ exists: boolean }>;
} = {}): FirebaseAdminForRequestAuth {
  return {
    auth: () => ({ verifyIdToken: async (_token, checkRevoked) => {
      assert.equal(checkRevoked, true, "revocation verification must remain enabled");
      return options.verify ? options.verify() : { uid: "synthetic-owner" };
    } }),
    firestore: () => ({ collection: (name) => {
      assert.equal(name, "account_deletion_requests");
      return { doc: () => ({ get: async () => options.deletion ? options.deletion() : { exists: false } }) };
    } }),
  };
}

function settingsAdminMock(get: () => Promise<{ exists: boolean; data(): Record<string, unknown> | undefined }>): FirebaseAdminForSettingsRead {
  return {
    firestore: () => ({ collection: (name) => {
      assert.equal(name, "user_settings");
      return { doc: () => ({ get }) };
    } }),
  };
}

async function invokeAuth(getAdmin: () => FirebaseAdminForRequestAuth, authorization?: string, overrides: Record<string, unknown> = {}) {
  const req = request(authorization, overrides);
  const res = responseRecorder();
  let nextCount = 0;
  await createRequireAuth(getAdmin)(req, res as any, () => { nextCount += 1; });
  return { req, res, nextCount };
}

async function main(): Promise<void> {
  const missing = await invokeAuth(() => firebaseMock());
  assert.equal(missing.res.statusCode, 401);
  assert.equal(missing.nextCount, 0);

  for (const code of ["auth/argument-error", "auth/id-token-expired", "auth/id-token-revoked", "auth/invalid-id-token"]) {
    const result = await invokeAuth(() => firebaseMock({ verify: async () => { throw { code }; } }), "Bearer synthetic-token");
    assert.equal(result.res.statusCode, 401, `${code} must be a credential rejection`);
    assert.equal(result.nextCount, 0);
  }

  for (const code of ["auth/user-disabled", "auth/user-not-found"]) {
    const result = await invokeAuth(() => firebaseMock({ verify: async () => { throw { code }; } }), "Bearer synthetic-token");
    assert.equal(result.res.statusCode, 401, `${code} must remain fail-closed`);
  }

  const unavailable = await invokeAuth(() => { throw new Error("admin unavailable"); }, "Bearer synthetic-token", { firebaseUid: "stale-synthetic-uid" });
  assert.equal(unavailable.res.statusCode, 503);
  assert.equal(unavailable.nextCount, 0);
  assert.equal(unavailable.req.firebaseUid, undefined, "503 must never retain a simulated identity");

  const verifyUnavailable = await invokeAuth(() => firebaseMock({ verify: async () => { throw { code: "auth/internal-error" }; } }), "Bearer synthetic-token");
  assert.equal(verifyUnavailable.res.statusCode, 503);
  assert.equal(verifyUnavailable.req.firebaseUid, undefined);

  const deletionUnavailable = await invokeAuth(() => firebaseMock({ deletion: async () => { throw { code: 14 }; } }), "Bearer synthetic-token");
  assert.equal(deletionUnavailable.res.statusCode, 503);
  assert.equal(deletionUnavailable.req.firebaseUid, undefined);

  const deleting = await invokeAuth(() => firebaseMock({ deletion: async () => ({ exists: true }) }), "Bearer synthetic-token");
  assert.equal(deleting.res.statusCode, 403);
  assert.equal(deleting.nextCount, 0);

  const valid = await invokeAuth(() => firebaseMock(), "Bearer synthetic-token");
  assert.equal(valid.res.statusCode, undefined);
  assert.equal(valid.nextCount, 1);
  assert.equal(valid.req.firebaseUid, "synthetic-owner");

  const missingSettingsResponse = responseRecorder();
  const missingSettingsHandler = createGetUserSettingsHandler({
    getFirebaseAdmin: () => settingsAdminMock(async () => ({ exists: false, data: () => undefined })),
    errorResponse: (res, status, error) => res.status(status).json({ error }),
  });
  await missingSettingsHandler(request(undefined, { params: { userId: "synthetic-owner" } }), missingSettingsResponse as any);
  assert.deepEqual(missingSettingsResponse.body, { onboarding_completed: false, settings: {} });

  const settingsFailureResponse = responseRecorder();
  const settingsFailureHandler = createGetUserSettingsHandler({
    getFirebaseAdmin: () => settingsAdminMock(async () => { throw new Error("synthetic settings dependency failure"); }),
    errorResponse: (res, status, error) => res.status(status).json({ error }),
  });
  await settingsFailureHandler(request(undefined, { params: { userId: "synthetic-owner" } }), settingsFailureResponse as any);
  assert.equal(settingsFailureResponse.statusCode, 500);
  assert.deepEqual(settingsFailureResponse.body, { error: "SETTINGS_LOAD_FAILED" });

  let ownershipNext = 0;
  let mismatchCount = 0;
  const ownership = createRequireOwnership(() => { mismatchCount += 1; });
  const crossTenantResponse = responseRecorder();
  ownership(request(undefined, { firebaseUid: "synthetic-owner", params: { userId: "synthetic-other" } }), crossTenantResponse as any, () => { ownershipNext += 1; });
  assert.equal(crossTenantResponse.statusCode, 403);
  assert.equal(mismatchCount, 1);
  assert.equal(ownershipNext, 0);

  const missingIdentityResponse = responseRecorder();
  ownership(request(), missingIdentityResponse as any, () => { ownershipNext += 1; });
  assert.equal(missingIdentityResponse.statusCode, 401, "ownership cannot proceed without verified identity");

  const sameTenantResponse = responseRecorder();
  ownership(request(undefined, { firebaseUid: "synthetic-owner" }), sameTenantResponse as any, () => { ownershipNext += 1; });
  assert.equal(ownershipNext, 1);

  // Administrative routes remain closed before any Admin lookup when requireAuth did not establish an identity.
  const anonymousAdminResponse = responseRecorder();
  let anonymousAdminNext = 0;
  await requireAdmin(request(), anonymousAdminResponse as any, () => { anonymousAdminNext += 1; });
  assert.equal(anonymousAdminResponse.statusCode, 401);
  assert.equal(anonymousAdminNext, 0);

  console.log("RS-PAR-E-02 auth middleware negative tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
