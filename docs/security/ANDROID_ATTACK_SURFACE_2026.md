# Android attack surface — 2026-10-10

| Surface | Current evidence | Assessment |
|---|---|---|
| Manifest | `allowBackup=false`; only `INTERNET` and Play Billing permissions; launcher exported | PASS_SOURCE |
| FileProvider | exported=false, URI grants enabled, cache path only after this checkpoint; no external/root path | FIXED_AND_REVIEWED |
| WebView/Capacitor | `BridgeActivity`, local bundled `dist/public`, `androidScheme=https`; no custom JS bridge or remote `server.url` | PASS_SOURCE |
| Navigation/deep links | no custom intent filter beyond MAIN/LAUNCHER; browser links are explicit HTTPS/WhatsApp flows | PASS_SOURCE |
| Signing | release signing requires four environment variables; no debug-key fallback | PASS_SOURCE |
| Storage | localStorage/IndexedDB used for scoped app data and offline Firestore; Firebase SDK owns auth persistence | PASS_SOURCE_TARGETED |
| Logging | safe logger redacts bearer/token patterns; no Android secret logging found | PASS_SOURCE |
| Clipboard | only user-triggered catalog/payment link copying observed; no automatic secret copy | PASS_SOURCE |
| Billing | client sends purchase token to backend; mocked tests exist; no real purchase performed | PARTIAL_MOCKED |
| Native libraries | no current APK/AAB matching checkpoint | NOT_TESTED |

The previous broad `external-path path="."` FileProvider mapping was unnecessarily
wide and was narrowed to the app cache directory. This is a source-level hardening;
merged manifest and packaged provider metadata still require a successful Android build.
