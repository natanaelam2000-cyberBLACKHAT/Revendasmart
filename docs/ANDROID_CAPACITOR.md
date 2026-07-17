# Fundação Android oficial com Capacitor

Este documento registra a base Android oficial do Revenda Smart criada na Sprint 28.

## Identidade oficial

- `appId`: `com.revendasmart.app`
- `applicationId`: `com.revendasmart.app`
- `namespace`: `com.revendasmart.app`
- Package da `MainActivity`: `com.revendasmart.app`
- Nome visível: `Revenda Smart`

Esse identificador será o mesmo usado futuramente na Play Store.

## Versões instaladas

As dependências Capacitor foram instaladas no mesmo major estável:

- `@capacitor/core`: `^8.4.2`
- `@capacitor/android`: `^8.4.2`
- `@capacitor/cli`: `^8.4.2`

Não misturar majors, beta, RC ou nightly sem uma sprint própria de upgrade.

## Requisitos de ambiente

A documentação oficial do Capacitor 8 exige Node.js 22 ou superior. O ambiente usado na criação estava com Node 24 e Java 21.

Para build Android local são necessários também:

- Android Studio compatível;
- Android SDK instalado;
- `ANDROID_HOME` ou `ANDROID_SDK_ROOT` configurado;
- plataforma SDK 36;
- build-tools compatível;
- espaço em disco suficiente.

No Cloud Shell desta sprint, `ANDROID_HOME`, `ANDROID_SDK_ROOT`, `adb` e `sdkmanager` não estavam disponíveis. Por isso, esta sprint não gera APK/AAB e o build nativo debug ficou pendente de ambiente Android completo.

## Arquitetura

O app Android empacota a aplicação web gerada pelo Vite dentro da WebView Capacitor.

- Build web real: `dist/public`
- Configuração Capacitor: `capacitor.config.ts`
- Projeto Android nativo: `android/`

Não usar configuração remota de servidor do Capacitor, URL da Vercel, live reload permanente ou hostname externo como conteúdo principal do app Android.

## Scripts

```bash
npm run android:copy
npm run android:sync
npm run android:open
npm run android:doctor
```

Uso recomendado no desenvolvimento:

```bash
npm run android:sync
npm run android:open
```

`android:open` exige Android Studio/SDK instalado no ambiente local.

## Como executar em aparelho físico

1. Instalar Android Studio e SDK.
2. Ativar modo desenvolvedor e depuração USB no aparelho.
3. Conectar o aparelho por USB.
4. Executar `npm run android:sync`.
5. Executar `npm run android:open`.
6. Rodar o app pelo Android Studio em modo debug.

Não gerar release assinada nesta fase.

## Debug por USB

Depois de instalar o app debug em aparelho físico, usar Chrome DevTools em `chrome://inspect` para inspecionar a WebView, console, rede, layout, safe areas e erros de runtime.

## Build debug

Somente executar build debug em ambiente com Android SDK completo e espaço suficiente:

```bash
cd android
./gradlew assembleDebug
```

Não executar nesta sprint:

- `assembleRelease`;
- `bundleRelease`;
- assinatura;
- upload;
- publicação.

## Assets oficiais

A identidade nativa deve usar exclusivamente:

- `client/public/logo-revenda-smart-symbol-official.png` para launcher icon;
- `client/public/logo-revenda-smart-official.png` para splash.

Não redesenhar, aplicar filtro, substituir por versão azul antiga ou usar placeholder.

## Edge-to-edge e safe areas

A fundação Android prepara edge-to-edge:

- status bar transparente;
- navigation bar transparente;
- `WindowCompat.setDecorFitsSystemWindows(window, false)`;
- `windowLayoutInDisplayCutoutMode=shortEdges` em API 28+;
- tema claro com barras do sistema em modo compatível.

A aplicação web já usa `viewport-fit=cover`, safe areas e shell full-bleed. Não adicionar padding nativo duplicado sem teste real em aparelho.

## Service worker

O service worker da PWA web foi preservado. Nenhum service worker extra foi criado para Android. Como o Android empacota assets locais, qualquer mudança futura no cache deve testar PWA e WebView para evitar cache duplicado ou asset obsoleto.

## Permissões

A fundação mantém apenas permissões básicas geradas pelo template, incluindo `android.permission.INTERNET`.

Não adicionar preventivamente:

- câmera;
- microfone;
- localização;
- contatos;
- telefone;
- SMS;
- armazenamento amplo;
- notificações;
- leitura de imagens.

## Arquivos que não devem ser commitados

Não versionar:

- `.gradle/`;
- `build/`;
- `app/build/`;
- `local.properties`;
- `.apk`;
- `.aab`;
- `.jks`;
- `.keystore`;
- credenciais;
- `google-services.json`, salvo sprint futura específica para Firebase nativo.

## Ausência de assinatura de release

Esta sprint não cria keystore, senha de assinatura, APK/AAB de produção nem publicação Play Store.

## Próximos passos para Play Store

Antes da Play Store ainda faltam:

- validar em aparelho físico;
- definir estratégia de signing;
- gerar AAB de release em ambiente controlado;
- revisar Data Safety;
- revisar política de privacidade/exclusão de conta;
- testar login, upload, WhatsApp, catálogo e Mercado Pago em build Android.

## Testes posteriores no Galaxy

Pendências obrigatórias em aparelho físico:

- inicialização;
- login;
- teclado;
- safe areas;
- barra de status;
- navegação inferior;
- botão voltar do Android;
- upload de foto;
- download do card;
- abrir WhatsApp;
- catálogo externo;
- assinatura Mercado Pago;
- recuperação de senha;
- PWA versus app Android;
- rotação;
- retomada após segundo plano.

## Validações estruturais

```bash
npm run skills:validate
npm run check
npm run build
npm run performance:bundle-check
npm run lint
npm run test
npm run test:firebase
npm run test:mercado-pago:sandbox
npm run android:sync
npm run android:doctor
git diff --check
```

## Roteamento de APIs no Android

No APK Capacitor, os arquivos locais são carregados pela WebView em uma origem própria, normalmente semelhante a `https://localhost`. Por isso, chamadas relativas para `/api` não bastam: elas tentariam atingir a origem local da WebView em vez do backend público.

O build Android usa explicitamente:

```text
VITE_API_BASE_URL=https://revendasmart.vercel.app
```

Essa URL pública não é segredo. Ela é injetada pelo script `npm run android:sync`, que executa um build web com a variável definida e valida que o pacote gerado contém o domínio público esperado.

No site hospedado na Vercel, quando `VITE_API_BASE_URL` não está definida, o app usa `window.location.origin`, preservando a mesma origem.

No desenvolvimento web local, o app também usa `window.location.origin`. Para trocar o domínio futuramente, altere o valor padrão em `scripts/android/sync-web.mjs` ou defina `VITE_API_BASE_URL` explicitamente no ambiente antes do sync.

Não usar configuração remota de servidor do Capacitor, live reload permanente ou URL da Vercel como configuração remota do Capacitor de produção. O Android deve empacotar assets locais e chamar APIs por HTTPS.
