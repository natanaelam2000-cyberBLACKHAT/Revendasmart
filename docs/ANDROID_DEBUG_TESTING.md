# Android debug reproduzível e teste físico

Este documento registra a Sprint 29 do Revenda Smart: build Android debug reproduzível e preparação para teste físico no Galaxy.

## Identidade e versões nativas

- Package/appId/applicationId/namespace: `com.revendasmart.app`
- Nome visível: `Revenda Smart`
- Capacitor: `8.4.2`
- Android Gradle Plugin: `8.13.0`
- Gradle Wrapper: `8.14.3`
- `compileSdkVersion`: `36`
- `targetSdkVersion`: `36`
- `minSdkVersion`: `24`
- Java validado no Cloud Shell: `21.0.11`

## Requisitos para build debug

- Node.js 22 ou superior;
- Java/JDK compatível;
- Android Studio estável;
- Android SDK instalado;
- `ANDROID_HOME` ou `ANDROID_SDK_ROOT` configurado;
- SDK Platform 36;
- Android build-tools compatível;
- espaço em disco suficiente.

No Cloud Shell desta sprint, `ANDROID_HOME`, `ANDROID_SDK_ROOT`, `adb` e `sdkmanager` não estavam disponíveis e o filesystem `/home` tinha menos de 1 GB livre. Por isso, `assembleDebug` ficou pendente de ambiente.

## Comandos disponíveis

```bash
npm run android:sync
npm run android:doctor
npm run android:build:debug
npm run android:install:debug
npm run android:logcat
```

`android:build:debug` valida SDK/espaço, executa build web, sincroniza Capacitor e roda somente `assembleDebug`.

`android:install:debug` exige `adb`, aparelho autorizado e APK debug existente. Se houver mais de um aparelho, exige `ANDROID_SERIAL`.

`android:logcat` filtra logs pelo package `com.revendasmart.app` ou por termos relacionados, evitando logcat sem filtro.

## Localização do APK debug

Após build bem-sucedido:

```text
android/app/build/outputs/apk/debug/app-debug.apk
```

Comandos de conferência:

```bash
test -f android/app/build/outputs/apk/debug/app-debug.apk
du -h android/app/build/outputs/apk/debug/app-debug.apk
sha256sum android/app/build/outputs/apk/debug/app-debug.apk
```

## Procedimento Windows + Android Studio

1. Instalar Android Studio estável.
2. Instalar SDK Platform 36 e build-tools compatível pelo SDK Manager.
3. Confirmar Java/JDK compatível no Android Studio.
4. Clonar ou atualizar o repositório.
5. Executar `npm install`.
6. Executar `npm run android:sync`.
7. Abrir a pasta `android` no Android Studio.
8. Aguardar Gradle Sync.
9. No Galaxy, ativar Opções de desenvolvedor.
10. Ativar Depuração USB.
11. Conectar o Galaxy por USB.
12. Autorizar o computador no aparelho.
13. Rodar a variante debug pelo Android Studio ou executar `npm run android:build:debug`.
14. Instalar pelo Android Studio ou executar `npm run android:install:debug`.
15. Coletar logs com `npm run android:logcat` ou Chrome DevTools em `chrome://inspect`.

## Instalação via ADB

```bash
npm run android:build:debug
npm run android:install:debug
```

Se o aparelho não aparecer autorizado, rodar:

```bash
adb devices
```

e confirmar a autorização no Galaxy.

## Edge-to-edge: checklist visual

Validar em aparelho físico:

- conteúdo não fica atrás da câmera/notch;
- header permanece legível;
- navegação inferior fica acima da barra do Android;
- teclado não esconde botões importantes;
- nenhuma safe area duplicada;
- fundo ocupa toda a tela;
- status bar transparente não reduz contraste;
- navigation bar transparente não cobre CTAs.

## Checklist funcional no Galaxy

Não declarar aprovado sem teste físico:

- instalação;
- primeira abertura;
- splash;
- ícone;
- login;
- logout;
- teclado;
- botão Voltar do Android;
- navegação interna;
- upload de imagem;
- seletor de arquivos;
- download do card;
- CTA do WhatsApp;
- links externos;
- catálogo público;
- assinatura Mercado Pago;
- recuperação de senha;
- rotação;
- segundo plano e retomada;
- modo offline;
- barra de status;
- barra inferior;
- edge-to-edge;
- atualização após novo `cap sync`.

## Diferenças: PWA, APK debug e futura release

- PWA: usa instalação do navegador e atualização via Vercel/service worker.
- APK debug: empacota `dist/public` local na WebView Capacitor; usado para testes físicos.
- Release futura: exigirá assinatura, AAB, políticas Play Store, Data Safety e validação final. Não é criada nesta sprint.

## Segurança e versionamento

Não versionar:

- `android/local.properties`;
- `android/.gradle/`;
- `android/**/build/`;
- `.apk`;
- `.aab`;
- `.jks`;
- `.keystore`;
- `google-services.json`;
- credenciais;
- caminhos absolutos de SDK.

Não usar nesta sprint:

- configuração remota de servidor do Capacitor;
- live reload permanente;
- URLs locais de desenvolvimento como conteúdo principal;
- cleartext global habilitado;
- cleartext global;
- plugins nativos extras.

## Limitações do Cloud Shell

O Cloud Shell validou estrutura, build web, sync e doctor, mas não gerou APK porque faltam Android SDK/ADB e há pouco espaço em `/home`.

## Roteamento de APIs no APK debug

O APK debug não deve chamar `/api` relativo à origem local da WebView. O script `npm run android:sync` define `VITE_API_BASE_URL=https://revendasmart.vercel.app` de forma multiplataforma via Node antes de copiar os assets para Android.

Validações do script:

- URL não pode estar vazia;
- URL precisa usar HTTPS;
- URL não pode apontar para localhost;
- build precisa conter `https://revendasmart.vercel.app`;
- build não pode conter URLs locais de desenvolvimento nem live reload.

Para desenvolvimento local web, continue usando a origem atual do navegador. Para Android, use sempre `npm run android:sync` ou `npm run android:build:debug`, nunca um build manual sem a variável de API.
