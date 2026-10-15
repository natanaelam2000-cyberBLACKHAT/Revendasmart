import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

async function main() {
  const root = process.cwd();
  assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, '127.0.0.1:9099');
  assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8080');
  process.env.FIREBASE_PROJECT_ID = 'demo-revendasmart';
  const require = createRequire(root + '/package.json');
  const express = require('express');
  const { initializeApp, deleteApp } = require('firebase/app');
  const { getAuth, connectAuthEmulator, createUserWithEmailAndPassword } = require('firebase/auth');
  const { registerRoutes } = await import(pathToFileURL(root + '/server/routes.ts').href);
  const { getFirebaseAdmin } = await import(pathToFileURL(root + '/server/firebase-admin-init.ts').href);
  const apps: any[] = [];
  const uids: string[] = [];
  let server: any;
  async function start() {
    const app = express(); app.use(express.json());
    server = createServer(app); await registerRoutes(server, app);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    return `http://127.0.0.1:${server.address().port}`;
  }
  let base = await start();
  const db = getFirebaseAdmin().firestore();
  try {
    for (let cycle = 0; cycle < 20; cycle++) {
      const mode = ['products', 'services', 'both'][cycle % 3];
      const app = initializeApp({apiKey: 'demo-api-key', projectId: 'demo-revendasmart'}, `onboarding-${mode}-${Date.now()}`);
      apps.push(app);
      const auth = getAuth(app); connectAuthEmulator(auth, 'http://127.0.0.1:9099', {disableWarnings: true});
      const { user } = await createUserWithEmailAndPassword(auth, `diagnostic-${mode}-${Date.now()}@example.test`, 'LocalTestPassword!123');
      uids.push(user.uid);
      const payload = {
        onboarding_completed: true, onboarding_current_step: 7,
        onboarding_theme_selected: true, onboarding_store_configured: true,
        onboarding_categories_configured: true, appTheme: 'default',
        appThemeCustomization: {primaryColor: '#7C3AED', buttonTone: 'solid', cardTone: 'clean', shadowIntensity: 'medium', radius: 'rounded', motion: 'normal'},
        customCategoriesByNicho: {Geral: ['Outros']}, storeName: 'Loja de teste', storeLogo: '',
        businessType: 'Geral', businessTypes: ['Geral'], businessMode: mode,
        completedAt: new Date().toISOString(), onboarding_completed_at: new Date().toISOString(), onboarding_skipped: false,
      };
      const request = async (method: string, body?: unknown) => fetch(`${base}/api/user/settings/${user.uid}`, {
        method, headers: {'Content-Type': 'application/json', Authorization: `Bearer ${await user.getIdToken()}`},
        ...(body ? {body: JSON.stringify(body)} : {}),
      });
      for (const scenario of ['NEW_USER', 'RETRY', 'EXISTING_USER']) {
        const response = await request('POST', payload);
        const data = await response.json() as any;
        console.log(`MODE=${mode} SCENARIO=${scenario} STATUS=${response.status} ERROR_CODE=${data.error ?? 'NONE'}`);
        assert.equal(response.status, 200);
        assert.equal(data.settings.businessMode, mode);
        assert.equal(data.settings.onboarding_completed, true);
        if (scenario === 'NEW_USER') await db.doc(`user_settings/${user.uid}`).set({unrelatedExistingField: 'preserve'}, {merge: true});
      }
      assert.equal((await db.doc(`user_settings/${user.uid}`).get()).data().unrelatedExistingField, 'preserve');
      await new Promise<void>(resolve => server.close(resolve)); base = await start();
      const read = await request('GET'); const saved = await read.json() as any;
      assert.equal(read.status, 200); assert.equal(saved.settings.businessMode, mode);
      assert.equal(saved.settings.onboarding_completed, true);
      console.log(`CYCLE=${cycle + 1}/20 MODE=${mode} SERVER_RESTART_READ=PASS EXISTING_FIELDS_PRESERVED=YES`);
    }
  } finally {
    if (server) await new Promise<void>(resolve => server.close(resolve));
    for (const uid of uids) { await db.doc(`user_settings/${uid}`).delete(); await getFirebaseAdmin().auth().deleteUser(uid); }
    for (const app of apps) await deleteApp(app);
  }
}
main().then(() => process.exit(0)).catch(error => { console.error(error instanceof Error ? error.message : 'DIAGNOSTIC_FAILED'); process.exit(1); });
