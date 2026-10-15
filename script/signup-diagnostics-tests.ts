import assert from "node:assert/strict";
import { classifySignupFailure, signupUserMessage } from "../client/src/lib/signup-diagnostics";

const known = classifySignupFailure({ code: "auth/email-already-in-use" }, "AUTH_ACCOUNT_CREATION", true);
assert.equal(known.firebaseAuthCode, "auth/email-already-in-use");
assert.equal(known.safeErrorCode, "EMAIL_ALREADY_IN_USE");
assert.equal(known.errorClass, "FIREBASE_AUTH");

for (const code of [
  "auth/invalid-email",
  "auth/weak-password",
  "auth/operation-not-allowed",
  "auth/too-many-requests",
  "auth/network-request-failed",
  "auth/internal-error",
]) {
  const diagnostic = classifySignupFailure({ code }, "AUTH_ACCOUNT_CREATION", false);
  assert.equal(diagnostic.firebaseAuthCode, code);
  assert.notEqual(diagnostic.safeErrorCode, "UNKNOWN");
}

const unknown = classifySignupFailure(new Error("private details"), "UNKNOWN", null);
assert.equal(unknown.safeErrorCode, "UNKNOWN");
assert.equal(unknown.firebaseAuthCode, undefined);
assert.equal(signupUserMessage({ code: "auth/invalid-email" }), "Email inválido");
assert.equal(signupUserMessage({ code: "auth/operation-not-allowed" }), "Cadastro por email indisponível no momento.");
assert.equal(signupUserMessage({ code: "auth/unexpected" }), "Erro ao criar conta. Tente novamente.");

const diagnosticKeys = Object.keys(known).join(" ").toLowerCase();
for (const forbidden of ["email", "password", "uid", "token", "authorization", "payload", "response"]) {
  assert.equal(diagnosticKeys.includes(forbidden), false, `diagnostic leaked ${forbidden}`);
}

console.log("signup diagnostics tests passed");
