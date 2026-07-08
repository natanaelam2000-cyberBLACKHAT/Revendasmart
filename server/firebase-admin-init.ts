import admin from "firebase-admin";
import { logError } from "./logger";

let firebaseAdmin: typeof admin | null = null;
let initialized = false;

export function initializeFirebaseAdmin() {
  if (initialized && firebaseAdmin) return firebaseAdmin;

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error("Missing Firebase Admin credentials in environment");
  }

  try {
    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId,
          clientEmail,
          privateKey,
        }),
        projectId,
      });
    }

    firebaseAdmin = admin;
    initialized = true;
    return firebaseAdmin;
  } catch (error) {
    logError("firebase_admin.initialize_failed", error, { module: "firebase-admin-init" });
    throw error;
  }
}

export function getFirebaseAdmin() {
  if (!initialized || !firebaseAdmin) {
    throw new Error("Firebase Admin not initialized");
  }
  return firebaseAdmin;
}
