/**
 * Firebase Storage migration helpers
 * Prepares image migration to Firebase Storage without executing automatically
 */

import { getFirebaseAdmin } from "./firebase-admin-init";

interface UploadResult {
  success: boolean;
  imageId: string;
  productId: string;
  downloadUrl?: string;
  error?: string;
}

interface MigrationPrepResult {
  ready: boolean;
  storageBucket?: string;
  samplePath: string;
  estimatedSize?: number;
  errors: string[];
}

/**
 * Check if Firebase Storage is ready for uploads
 * This is a DRY RUN - doesn't actually upload anything
 */
export async function checkStorageReadiness(): Promise<MigrationPrepResult> {
  const errors: string[] = [];
  let ready = true;
  let storageBucket: string | undefined;

  try {
    const admin = getFirebaseAdmin();
    if (!admin) {
      errors.push("Firebase Admin SDK not initialized");
      ready = false;
      return { ready, errors };
    }

    // Get storage bucket from Firebase project
    const app = admin.app();
    const options = app.options;
    storageBucket = (options as any).storageBucket || `${(options as any).projectId}.appspot.com`;

    console.log("[firebase-storage] Storage bucket ready:", storageBucket);

    return {
      ready,
      storageBucket,
      samplePath: `users/{userId}/products/{productId}.jpg`,
      errors,
    };
  } catch (e) {
    console.error("[firebase-storage] Error checking readiness:", e);
    errors.push(`Storage check failed: ${(e as any)?.message}`);
    return { ready: false, errors, samplePath: "" };
  }
}

/**
 * Prepare image upload to Firebase Storage
 * Returns metadata without uploading (DRY RUN)
 */
export async function prepareImageUpload(
  userId: string,
  productId: string,
  base64Data: string
): Promise<UploadResult> {
  try {
    // Validate inputs
    if (!userId || !productId || !base64Data) {
      return {
        success: false,
        imageId: "",
        productId,
        error: "Missing required fields (userId, productId, base64Data)",
      };
    }

    // Check base64 size (Firebase Storage has limits)
    const sizeInBytes = base64Data.length * 0.75; // Approximate
    const sizeInMB = sizeInBytes / (1024 * 1024);

    if (sizeInMB > 10) {
      return {
        success: false,
        imageId: productId,
        productId,
        error: `Image too large: ${sizeInMB.toFixed(2)}MB (max 10MB)`,
      };
    }

    // Prepare metadata (dry run - no actual upload)
    const storagePath = `users/${userId}/products/${productId}.jpg`;

    console.log("[firebase-storage] Image prepared for upload:", {
      path: storagePath,
      size: `${sizeInMB.toFixed(2)}MB`,
      productId,
    });

    return {
      success: true,
      imageId: productId,
      productId,
      // downloadUrl would be generated during actual upload
    };
  } catch (e) {
    console.error("[firebase-storage] Error preparing upload:", e);
    return {
      success: false,
      imageId: productId,
      productId,
      error: `Preparation failed: ${(e as any)?.message}`,
    };
  }
}

/**
 * Generate Firebase Storage download URL structure
 * Used for reference before actual migration
 */
export function generateExpectedDownloadUrl(
  projectId: string,
  userId: string,
  productId: string
): string {
  const bucket = `${projectId}.appspot.com`;
  const encodedPath = encodeURIComponent(`users/${userId}/products/${productId}.jpg`);
  return `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodedPath}?alt=media`;
}

/**
 * Validate Firebase Storage integration
 * Checks without making actual calls
 */
export async function validateFirebaseStorageSetup(): Promise<{
  valid: boolean;
  projectId?: string;
  bucket?: string;
  errors: string[];
}> {
  const errors: string[] = [];
  let valid = true;
  let projectId: string | undefined;
  let bucket: string | undefined;

  try {
    const admin = getFirebaseAdmin();
    if (!admin) {
      errors.push("Firebase Admin SDK not initialized");
      valid = false;
      return { valid, errors };
    }

    const app = admin.app();
    const options = app.options;
    projectId = (options as any).projectId;
    bucket = (options as any).storageBucket || `${projectId}.appspot.com`;

    if (!projectId) {
      errors.push("Firebase project ID not found");
      valid = false;
    }

    if (!bucket) {
      errors.push("Firebase storage bucket not found");
      valid = false;
    }

    console.log("[firebase-storage] Setup validation:", {
      projectId,
      bucket,
      valid,
    });

    return { valid, projectId, bucket, errors };
  } catch (e) {
    console.error("[firebase-storage] Validation error:", e);
    errors.push(`Setup validation failed: ${(e as any)?.message}`);
    return { valid: false, errors };
  }
}
