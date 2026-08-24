/**
 * UID Consolidation Tool for RevendaSmart
 * 
 * Finds all UIDs related to an email in Firestore and consolidates data.
 * Run with: npx tsx server/uid-consolidation.ts
 */

import { initializeFirebaseAdmin } from "./firebase-admin-init";
import { maskEmail } from "./logger";

// LGPD §11 (REVENDASMART-LGPD-ANPD-REMEDIATION-01): e-mail e nome de exibição mascarados no stdout —
// este script imprime no terminal de quem o roda (scrollback/log de CI), nunca deve conter PII crua.
// UIDs continuam impressos por inteiro de propósito: são o dado que este script existe para produzir
// (o comando de migração sugerido no final precisa deles completos para funcionar).

const TARGET_EMAIL = "natanaelam2000@gmail.com";

interface UidReport {
  uid: string;
  source: string;
  productCount: number;
  saleCount: number;
  clientCount: number;
  hasSettings: boolean;
  settingsData?: any;
  isAdminFlagSet: boolean;
}

async function auditAllUids(): Promise<void> {
  console.log("\n========================================");
  console.log("  REVENDASMART — UID AUDIT TOOL");
  console.log("========================================");
  console.log(`Target email: ${maskEmail(TARGET_EMAIL)}\n`);

  const admin = await initializeFirebaseAdmin();
  const auth = admin.auth();
  const db = admin.firestore();

  // ─── 1. Get canonical UID from Firebase Auth ─────────────────────────────
  console.log("── STEP 1: Firebase Auth lookup ──");
  let authUid: string | null = null;
  try {
    const userRecord = await auth.getUserByEmail(TARGET_EMAIL);
    authUid = userRecord.uid;
    console.log(`  ✓ Firebase Auth UID:       ${authUid}`);
    console.log(`  ✓ Email verified:          ${userRecord.emailVerified}`);
    console.log(`  ✓ Display name set:        ${userRecord.displayName ? "yes" : "no"}`);
    console.log(`  ✓ Created at:              ${userRecord.metadata.creationTime}`);
    console.log(`  ✓ Last sign-in:            ${userRecord.metadata.lastSignInTime}`);
    console.log(`  ✓ Disabled:                ${userRecord.disabled}`);
    console.log(`  ✓ Provider(s):             ${userRecord.providerData.map(p => p.providerId).join(", ")}`);
  } catch (err) {
    console.log(`  ✗ Error looking up email in Auth: ${(err as Error).message}`);
  }

  // ─── 2. Scan all UIDs in "users" top-level collection ───────────────────
  console.log("\n── STEP 2: Scan all docs in 'users' collection ──");
  const reports: UidReport[] = [];

  let usersSnap: any;
  try {
    usersSnap = await db.collection("users").listDocuments();
    console.log(`  Found ${usersSnap.length} UID document(s) in 'users'`);
  } catch (err) {
    console.log(`  ✗ Could not list 'users' collection: ${(err as Error).message}`);
    usersSnap = [];
  }

  for (const userDocRef of usersSnap) {
    const uid = userDocRef.id;
    console.log(`\n  Checking UID: ${uid}`);

    // Count products
    let productCount = 0;
    try {
      const prodSnap = await db.collection("users").doc(uid).collection("products").get();
      productCount = prodSnap.size;
      console.log(`    products: ${productCount}`);
    } catch (err) {
      console.log(`    products: ERROR — ${(err as Error).message}`);
    }

    // Count sales
    let saleCount = 0;
    try {
      const salesSnap = await db.collection("users").doc(uid).collection("sales").get();
      saleCount = salesSnap.size;
      console.log(`    sales: ${saleCount}`);
    } catch (err) {
      console.log(`    sales: ERROR — ${(err as Error).message}`);
    }

    // Count clients
    let clientCount = 0;
    try {
      const clientsSnap = await db.collection("users").doc(uid).collection("clients").get();
      clientCount = clientsSnap.size;
      console.log(`    clients: ${clientCount}`);
    } catch (err) {
      console.log(`    clients: ERROR — ${(err as Error).message}`);
    }

    // Check if this UID has an Auth record (only auth UID will match)
    const isAuthUser = uid === authUid;

    // Check user_settings
    let hasSettings = false;
    let settingsData: any = null;
    try {
      const settingsSnap = await db.collection("user_settings").doc(uid).get();
      hasSettings = settingsSnap.exists;
      settingsData = settingsSnap.exists ? settingsSnap.data() : null;
      console.log(`    user_settings: ${hasSettings ? "EXISTS" : "none"}`);
      if (settingsData) {
        console.log(`      businessName: ${settingsData.businessName || "(none)"}`);
        console.log(`      businessType: ${settingsData.businessType || "(none)"}`);
        console.log(`      onboarding_completed: ${settingsData.onboarding_completed}`);
      }
    } catch (err) {
      console.log(`    user_settings: ERROR — ${(err as Error).message}`);
    }

    // Check admin_users collection
    let isAdminFlagSet = false;
    try {
      const adminSnap = await db.collection("admin_users").doc(uid).get();
      isAdminFlagSet = adminSnap.exists;
      console.log(`    admin_users entry: ${isAdminFlagSet ? "YES" : "none"}`);
    } catch (err) {
      console.log(`    admin_users: ERROR — ${(err as Error).message}`);
    }

    reports.push({
      uid,
      source: isAuthUser ? "Firebase Auth (current)" : "Firestore only (orphan?)",
      productCount,
      saleCount,
      clientCount,
      hasSettings,
      settingsData,
      isAdminFlagSet,
    });
  }

  // ─── 3. Check user_settings for UIDs not in "users" ─────────────────────
  console.log("\n── STEP 3: Scan 'user_settings' for any extra UIDs ──");
  try {
    const settingsDocs = await db.collection("user_settings").listDocuments();
    for (const settingsDocRef of settingsDocs) {
      const uid = settingsDocRef.id;
      const alreadySeen = reports.find(r => r.uid === uid);
      if (!alreadySeen) {
        console.log(`  Found UID in user_settings NOT in users: ${uid}`);
        const snap = await settingsDocRef.get();
        const data = snap.data();
        console.log(`    businessName: ${data?.businessName || "(none)"}`);
        console.log(`    email in settings: ${data?.email ? maskEmail(data.email) : "(none)"}`);
        reports.push({
          uid,
          source: "user_settings only",
          productCount: 0,
          saleCount: 0,
          clientCount: 0,
          hasSettings: true,
          settingsData: data,
          isAdminFlagSet: false,
        });
      }
    }
  } catch (err) {
    console.log(`  ✗ Error listing user_settings: ${(err as Error).message}`);
  }

  // ─── 4. Check admin_users collection ─────────────────────────────────────
  console.log("\n── STEP 4: Scan 'admin_users' collection ──");
  try {
    const adminDocs = await db.collection("admin_users").listDocuments();
    console.log(`  ${adminDocs.length} admin_users entries found`);
    for (const adminDocRef of adminDocs) {
      console.log(`  admin UID: ${adminDocRef.id}`);
    }
  } catch (err) {
    console.log(`  ✗ Error listing admin_users: ${(err as Error).message}`);
  }

  // ─── 5. Summary ──────────────────────────────────────────────────────────
  console.log("\n========================================");
  console.log("  AUDIT SUMMARY");
  console.log("========================================");
  console.log(`Firebase Auth UID (canonical): ${authUid ?? "NOT FOUND"}`);
  console.log(`Total UIDs found in Firestore:  ${reports.length}`);
  console.log("");

  for (const r of reports) {
    const isCanonical = r.uid === authUid;
    console.log(`${isCanonical ? "★ CANONICAL" : "  orphan   "} UID: ${r.uid}`);
    console.log(`           Source:    ${r.source}`);
    console.log(`           Products:  ${r.productCount}`);
    console.log(`           Sales:     ${r.saleCount}`);
    console.log(`           Clients:   ${r.clientCount}`);
    console.log(`           Settings:  ${r.hasSettings}`);
    console.log(`           Admin:     ${r.isAdminFlagSet}`);
    console.log("");
  }

  // ─── 6. Determine if consolidation is needed ─────────────────────────────
  const orphans = reports.filter(r => r.uid !== authUid && (r.productCount > 0 || r.saleCount > 0 || r.clientCount > 0 || r.hasSettings));
  
  if (orphans.length === 0) {
    console.log("✓ NO CONSOLIDATION NEEDED — all data is under the canonical Auth UID.");
    console.log(`  Canonical UID: ${authUid}`);
  } else {
    console.log(`! ${orphans.length} orphan UID(s) have data that needs migration:`);
    for (const o of orphans) {
      console.log(`  - ${o.uid} (${o.productCount} products, ${o.saleCount} sales, ${o.clientCount} clients, settings: ${o.hasSettings})`);
    }
    console.log(`\n  Run consolidation with: SOURCE_UID=<orphan_uid> TARGET_UID=${authUid} npx tsx server/uid-consolidation.ts migrate`);
  }

  console.log("\n========================================\n");
}

async function migrateUid(sourceUid: string, targetUid: string): Promise<void> {
  console.log("\n========================================");
  console.log("  REVENDASMART — UID MIGRATION");
  console.log("========================================");
  console.log(`Source UID:  ${sourceUid}`);
  console.log(`Target UID:  ${targetUid}`);
  console.log("");

  const admin = await initializeFirebaseAdmin();
  const db = admin.firestore();

  const COLLECTIONS = ["products", "sales", "clients", "installments"];
  const migrated: Record<string, number> = {};

  for (const collName of COLLECTIONS) {
    try {
      const srcSnap = await db.collection("users").doc(sourceUid).collection(collName).get();
      if (srcSnap.empty) {
        console.log(`  ${collName}: 0 docs — skip`);
        migrated[collName] = 0;
        continue;
      }

      console.log(`  ${collName}: migrating ${srcSnap.size} doc(s)...`);
      const batch = db.batch();
      let count = 0;

      for (const srcDoc of srcSnap.docs) {
        // Check if doc already exists in target (don't overwrite unless source is richer)
        const targetRef = db.collection("users").doc(targetUid).collection(collName).doc(srcDoc.id);
        const targetSnap = await targetRef.get();

        if (targetSnap.exists) {
          console.log(`    [SKIP] ${collName}/${srcDoc.id} already exists in target — not overwriting`);
          continue;
        }

        batch.set(targetRef, srcDoc.data());
        count++;
      }

      await batch.commit();
      migrated[collName] = count;
      console.log(`  ✓ ${collName}: ${count} new doc(s) copied`);
    } catch (err) {
      console.log(`  ✗ ${collName}: ERROR — ${(err as Error).message}`);
      migrated[collName] = -1;
    }
  }

  // Migrate user_settings
  console.log("\n  Migrating user_settings...");
  try {
    const srcSettings = await db.collection("user_settings").doc(sourceUid).get();
    if (srcSettings.exists) {
      const targetSettings = await db.collection("user_settings").doc(targetUid).get();
      if (targetSettings.exists) {
        // Merge: keep target but fill in any missing fields from source
        const merged = { ...srcSettings.data(), ...targetSettings.data() };
        await db.collection("user_settings").doc(targetUid).set(merged, { merge: true });
        console.log(`  ✓ user_settings: merged source into target`);
      } else {
        await db.collection("user_settings").doc(targetUid).set(srcSettings.data()!);
        console.log(`  ✓ user_settings: copied from source`);
      }
    } else {
      console.log(`  user_settings: source has no settings doc — skip`);
    }
  } catch (err) {
    console.log(`  ✗ user_settings: ERROR — ${(err as Error).message}`);
  }

  // Ensure target is admin
  console.log("\n  Ensuring admin flag on target UID...");
  try {
    const adminRef = db.collection("admin_users").doc(targetUid);
    await adminRef.set({ email: TARGET_EMAIL, uid: targetUid, isAdmin: true, consolidatedAt: new Date().toISOString() }, { merge: true });
    console.log(`  ✓ admin_users/${targetUid} — admin flag set`);
  } catch (err) {
    console.log(`  ✗ admin_users: ERROR — ${(err as Error).message}`);
  }

  // Summary
  console.log("\n========================================");
  console.log("  MIGRATION COMPLETE (source NOT deleted)");
  console.log("========================================");
  console.log(`  Source: ${sourceUid}`);
  console.log(`  Target: ${targetUid}`);
  for (const [coll, count] of Object.entries(migrated)) {
    console.log(`  ${coll}: ${count < 0 ? "ERROR" : `${count} migrated`}`);
  }
  console.log("\n  ⚠ Source data was NOT deleted. Validate target then delete manually.");
  console.log("========================================\n");
}

// ─── Entrypoint ────────────────────────────────────────────────────────────
const mode = process.argv[2] || "audit";

if (mode === "migrate") {
  const sourceUid = process.env.SOURCE_UID;
  const targetUid = process.env.TARGET_UID;

  if (!sourceUid || !targetUid) {
    console.error("ERROR: SOURCE_UID and TARGET_UID env vars required for migration.");
    console.error("Usage: SOURCE_UID=abc TARGET_UID=xyz npx tsx server/uid-consolidation.ts migrate");
    process.exit(1);
  }

  migrateUid(sourceUid, targetUid).catch(err => {
    console.error("Migration failed:", err);
    process.exit(1);
  });
} else {
  auditAllUids().catch(err => {
    console.error("Audit failed:", err);
    process.exit(1);
  });
}
