import assert from "node:assert/strict";
import { initializeApp, deleteApp } from "firebase/app";
import {
  getAuth, connectAuthEmulator, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  GoogleAuthProvider, linkWithCredential, signInWithCredential, sendEmailVerification,
  sendPasswordResetEmail, signOut,
} from "firebase/auth";

const host = process.env.FIREBASE_AUTH_EMULATOR_HOST;
if (host !== "127.0.0.1:9099") throw new Error("Auth emulator tests require the isolated local demo environment.");
const project = "demo-revendasmart";
const app = initializeApp({ apiKey: "demo-api-key", projectId: project, authDomain: `${project}.firebaseapp.com` }, `auth-final-${Date.now()}`);
const auth = getAuth(app);
connectAuthEmulator(auth, `http://${host}`, { disableWarnings: true });
const email = `auth-sdk-${Date.now()}@example.test`;
const password = "AuthFinalEmulated!123";
try {
  const created = await createUserWithEmailAndPassword(auth, email, password);
  const uid = created.user.uid;
  assert.equal(created.user.emailVerified, false);
  await assert.rejects(createUserWithEmailAndPassword(auth, email, password), { code: "auth/email-already-in-use" });
  assert.equal(auth.currentUser?.uid, uid);
  console.log("PASS real SDK duplicate signup preserves original UID");
  await assert.rejects(createUserWithEmailAndPassword(auth, `weak-${email}`, "12"), { code: "auth/weak-password" });
  console.log("PASS real SDK rejects weak password");
  await sendEmailVerification(created.user);
  const outbox = await (await fetch(`http://${host}/emulator/v1/projects/${project}/oobCodes`)).json();
  assert.ok(outbox.oobCodes.some((code: { email: string; requestType: string }) => code.email === email && code.requestType === "VERIFY_EMAIL"));
  await sendPasswordResetEmail(auth, email);
  console.log("PASS real SDK verification and password reset generate emulator action codes");
  // The emulator accepts explicitly fake JSON identity claims. No external Google identity is
  // simulated as production-valid, and no real token or OAuth secret is used or logged.
  const google = GoogleAuthProvider.credential(JSON.stringify({ sub: `google-${uid}`, email, email_verified: true }));
  const linked = await linkWithCredential(created.user, google);
  assert.equal(linked.user.uid, uid);
  assert.ok(linked.user.providerData.some(provider => provider.providerId === "google.com"));
  assert.ok(linked.user.providerData.some(provider => provider.providerId === "password"));
  await signOut(auth);
  assert.equal(auth.currentUser, null);
  assert.equal((await signInWithCredential(auth, google)).user.uid, uid);
  console.log("PASS emulated Google linking and sign-in preserve the email/password UID");
  const otherEmail = `other-${email}`;
  const other = await createUserWithEmailAndPassword(auth, otherEmail, password);
  await assert.rejects(linkWithCredential(other.user, google), { code: "auth/credential-already-in-use" });
  assert.equal(auth.currentUser?.uid, other.user.uid);
  assert.notEqual(other.user.uid, uid);
  console.log("PASS real SDK prevents credential transfer between accounts");
  const recovered = await signInWithEmailAndPassword(auth, email, password);
  assert.equal(recovered.user.uid, uid);
  await signOut(auth);
  assert.equal(auth.currentUser, null);
  console.log("PASS original account remains accessible and logout terminates the session");
} finally { await deleteApp(app); }
