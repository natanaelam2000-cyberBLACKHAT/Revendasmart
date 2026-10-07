import {
  GoogleAuthProvider, FacebookAuthProvider, EmailAuthProvider, signInWithPopup,
  linkWithPopup, reauthenticateWithPopup, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, sendEmailVerification, sendPasswordResetEmail,
  linkWithCredential, reauthenticateWithCredential, reload, signOut,
  signInWithCredential,
  type User, type AuthCredential,
} from "firebase/auth";
import { Capacitor, registerPlugin } from "@capacitor/core";
import { AuthController } from "./auth-controller";
import { authFailure, type SocialProvider } from "./auth-policy";
import { getFirebaseAuth, waitForAuthPersistence, waitForAuthReady } from "./firebase";
import { hasRecentAuthentication } from "@shared/auth-security";

function providerFor(provider: SocialProvider) {
  if (provider === "google") {
    const result = new GoogleAuthProvider();
    result.setCustomParameters({ prompt: "select_account" });
    return result;
  }
  const result = new FacebookAuthProvider();
  result.addScope("email");
  return result;
}

function auth() {
  const result = getFirebaseAuth();
  if (!result) throw authFailure("auth/provider-unavailable");
  result.languageCode = "pt-BR";
  return result;
}

const nativeCollisions = new WeakMap<object, AuthCredential>();
const nativeConfiguration = registerPlugin<{ getStatus(): Promise<{ firebaseConfigured: boolean; facebookConfigured: boolean }> }>("AuthConfiguration");
async function nativeCredential(provider: SocialProvider): Promise<AuthCredential> {
  if (!Capacitor.isPluginAvailable("FirebaseAuthentication")) throw authFailure("auth/provider-unavailable");
  const status = await nativeConfiguration.getStatus();
  if (!status.firebaseConfigured || (provider === "facebook" && !status.facebookConfigured)) throw authFailure("auth/provider-unavailable");
  const { FirebaseAuthentication } = await import("@capacitor-firebase/authentication");
  // Firebase JS owns the session on both platforms; native providers only return credentials.
  let result;
  try {
    result = provider === "google"
      ? await FirebaseAuthentication.signInWithGoogle({ skipNativeAuth: true })
      : await FirebaseAuthentication.signInWithFacebook({ skipNativeAuth: true });
  } catch (error) {
    // Normalize the SDK's documented cancellation messages, without showing or logging raw errors.
    const message = error instanceof Error ? error.message : "";
    if (message === "Sign in canceled." || message === "Authorization canceled." || message === "Link canceled.") throw authFailure("auth/canceled");
    throw error;
  }
  const credential = result.credential;
  if (provider === "google" && credential?.idToken) return GoogleAuthProvider.credential(credential.idToken);
  if (provider === "facebook" && credential?.accessToken) return FacebookAuthProvider.credential(credential.accessToken);
  throw authFailure("auth/provider-unavailable");
}

export const authController = new AuthController<User, AuthCredential>({
  currentUser: () => auth().currentUser,
  ready: async () => { await waitForAuthPersistence(); await waitForAuthReady(); },
  emailLogin: async (email, password) => (await signInWithEmailAndPassword(auth(), email, password)).user,
  signup: async (email, password) => (await createUserWithEmailAndPassword(auth(), email, password)).user,
  socialLogin: async (provider) => {
    if (Capacitor.isNativePlatform()) {
      const credential = await nativeCredential(provider);
      try { return (await signInWithCredential(auth(), credential)).user; }
      catch (error) {
        if (error && typeof error === "object") nativeCollisions.set(error, credential);
        throw error;
      }
    }
    return (await signInWithPopup(auth(), providerFor(provider))).user;
  },
  socialLink: async (user, provider) => {
    if (Capacitor.isNativePlatform()) return (await linkWithCredential(user, await nativeCredential(provider))).user;
    return (await linkWithPopup(user, providerFor(provider))).user;
  },
  linkCredential: async (user, credential) => (await linkWithCredential(user, credential)).user,
  collision: (error, provider) => {
    const firebaseError = error as Parameters<typeof GoogleAuthProvider.credentialFromError>[0];
    const credential = nativeCollisions.get(firebaseError) ?? (provider === "google"
      ? GoogleAuthProvider.credentialFromError(firebaseError)
      : FacebookAuthProvider.credentialFromError(firebaseError));
    nativeCollisions.delete(firebaseError);
    const email = firebaseError.customData?.email;
    return credential && typeof email === "string" ? { email, credential } : null;
  },
  verify: (user) => sendEmailVerification(user),
  reload,
  token: (user, force) => user.getIdToken(force),
  recent: async (user) => hasRecentAuthentication((await user.getIdTokenResult()).claims.auth_time),
  reset: (email) => sendPasswordResetEmail(auth(), email),
  reauthenticate: async (user, provider, password) => {
    if (provider === "password") {
      if (!user.email || !password) throw authFailure("auth/invalid-credential");
      await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, password));
    } else {
      if (Capacitor.isNativePlatform()) await reauthenticateWithCredential(user, await nativeCredential(provider));
      else await reauthenticateWithPopup(user, providerFor(provider));
    }
  },
  logout: () => signOut(auth()),
});
