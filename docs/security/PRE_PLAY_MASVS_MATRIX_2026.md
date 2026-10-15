# Mobile verification matrix

This is evidence coverage, not MASVS certification or a MobSF result.

| Domain | Source reviewed / automated evidence | Remaining validation |
|---|---|---|
| MASVS-STORAGE | Android allowBackup=false already in base; uid-scoped onboarding draft; Firestore pending queue isolation DENIED for other account | Final merged manifest, OEM device-transfer behavior, runtime caches/IndexedDB/Filesystem inspection |
| MASVS-CRYPTO | Existing Mercado Pago encryption regression suite PASS; signing values never read/printed | Final Android crypto/storage and signed artifact review |
| MASVS-AUTH | Firebase Admin verifyIdToken(token,true), ownership middleware; mock/emulator negatives; bounded token refresh | Device reauthentication/linking flows and provider/session lifecycle |
| MASVS-NETWORK | Capacitor https scheme, no configured remote server.url/allowNavigation; synthetic emulator traffic only | Final network-security config, TLS/cleartext runtime capture using fake accounts |
| MASVS-PLATFORM | MainActivity uses Capacitor BridgeActivity; FileProvider exported=false; launcher exported=true; paths reviewed | FileProvider external/cache path scope and URI grants, plugin merged components/deep links/intents |
| MASVS-CODE | Typecheck/lint and targeted tests PASS; zizmor PASS | Semgrep/CodeQL/MobSF execution; complete UI fault matrix |
| MASVS-RESILIENCE | Queue leases/backoff and stable saleId already present; confirmed-response and auth timeout fixes tested | Process kill/restart/reconnection, interrupted UI mutation and native back testing |
| MASVS-PRIVACY | User isolation emulator tests and existing safe logging policy reviewed | Device logs/screenshots/clipboard, Play Data Safety/Console and final storage audit |

Source package com.revendasmart.app, versionName 1.1.3, versionCode 8,
minSdk 24, targetSdk 36. These are source values, not extracted artifact evidence.
No APK/AAB SHA256, signature validity, final debuggable=false or testOnly=false assertion
is available. Play Integrity and Play Console setup remain external/manual.
