# Android release signing — RevendaSmart

RELEASE-08. Como assinar e gerar o Android App Bundle (`.aab`) de produção, sem versionar nenhum
segredo. `PLAY_CONSOLE_PENDING` no fim deste documento lista o que só pode ser feito depois que a
conta Google Play Developer existir.

## Modelo de signing

O `release` buildType (`android/app/build.gradle`) só assina quando as 4 variáveis de ambiente abaixo
estão presentes. Se faltar qualquer uma, o Gradle **falha explicitamente** antes de gerar qualquer
artefato — nunca cai silenciosamente no keystore de debug, nunca produz um `.aab`/`.apk` não assinado
sem avisar.

| Variável                        | Significado                                    |
| -------------------------------- | ----------------------------------------------- |
| `REVENDASMART_KEYSTORE_PATH`     | Caminho absoluto do arquivo `.keystore`/`.jks`  |
| `REVENDASMART_KEYSTORE_PASSWORD` | Senha do keystore                               |
| `REVENDASMART_KEY_ALIAS`         | Alias da chave dentro do keystore               |
| `REVENDASMART_KEY_PASSWORD`      | Senha da chave (pode ser igual à do keystore)   |

Nenhuma dessas variáveis deve ir para `.env`, `gradle.properties`, ou qualquer arquivo versionado —
só para o ambiente do shell local (nunca commitado) ou para secrets do CI (ver seção CI abaixo).

## Play App Signing readiness

Duas chaves distintas, papéis diferentes:

- **Upload key** — a chave que o desenvolvedor mantém (localmente e/ou em secrets de CI). Assina o
  `.aab` que é enviado ao Play Console. Se vazar ou for perdida, dá para pedir ao Google para
  resetá-la (com Play App Signing ativado) — não é catastrófico.
- **App signing key** — a chave que assina de verdade o APK que chega no dispositivo do usuário final.
  Com **Play App Signing** (obrigatório para apps novos no Play Console hoje), o **Google** gera e
  guarda essa chave; o desenvolvedor nunca precisa vê-la. O Play re-assina o `.aab` enviado (assinado
  com a upload key) usando a app signing key antes de distribuir.

Consequência prática para este projeto: a chave gerada localmente (via `REVENDASMART_KEYSTORE_*`,
hoje um keystore de teste) só precisa ser tratada com o rigor de uma **upload key** — perdê-la depois
de Play App Signing ativado é recuperável pelo suporte do Google. Ainda assim, ela deve ser gerada com
`keytool` (RSA 2048+, validade longa), guardada fora do repositório, e nunca compartilhada por canais
inseguros.

Nada disso pode ser configurado agora — Play App Signing é uma opção que só existe depois que o app
tiver sido criado no Play Console (ver `PLAY_CONSOLE_PENDING`).

## Keystore de teste (prova de pipeline, sem produção)

Para provar que o pipeline de assinatura funciona sem criar uma chave de produção prematuramente, use
um keystore **TEST_ONLY_DO_NOT_USE_FOR_PRODUCTION**, gerado fora do repositório:

```bash
keytool -genkeypair -v \
  -keystore /caminho/fora/do/repo/TEST_ONLY_DO_NOT_USE_FOR_PRODUCTION.keystore \
  -alias revendasmart-test-only \
  -keyalg RSA -keysize 2048 -validity 3650 \
  -dname "CN=TEST_ONLY_DO_NOT_USE_FOR_PRODUCTION, OU=RevendaSmart, O=RevendaSmart, L=Unknown, ST=Unknown, C=BR"
```

`keytool` pede a senha interativamente (ou aceite `-storepass`/`-keypass` só em um shell não
persistido/histórico). Nunca commitar o arquivo gerado, nunca reutilizar essa chave em produção. A
chave de produção definitiva fica como `PRODUCTION_SIGNING_PENDING`.

## versionCode / versionName

Fonte única: [`android/version.properties`](../android/version.properties). `android/app/build.gradle`
lê esse arquivo — nunca editar o número em mais de um lugar. `androidVersionCode` precisa ser um
inteiro sempre crescente (o Play rejeita um upload com `versionCode` igual ou menor que o já
publicado); `androidVersionName` é a string livre exibida ao usuário.

## Pipeline local

```bash
# Debug (já existia, RELEASE-07B):
npm run android:build:debug

# Release, com as 4 variáveis de signing já exportadas no shell:
npm run android:build:release
```

`android:build:release` roda `android:sync` → `gradlew clean bundleRelease assembleRelease` → verifica
o AAB gerado (`npm run android:verify:release`, chamado automaticamente ao final). Gera dois artefatos
com a MESMA configuração de assinatura: `app-release.aab` (o que vai para o Play) e `app-release.apk`
("irmão", usado só para inspecionar package/versionCode/versionName/debuggable com `aapt` — o manifest
dentro do `.aab` é protobuf binário, que o `aapt` clássico não lê sem o `bundletool` da Google, não
instalado neste ambiente).

## CI futuro (documentado, não configurado nesta sprint)

Estágios propostos para um workflow futuro (`.github/workflows/android-release.yml`, ainda não criado
— alterar CI nesta sprint poderia colidir com os workflows existentes em `.github/workflows/`):

```
checkout
  → npm ci
  → npm run check
  → npm test
  → npm run build
  → npx cap sync android   (ou: npm run android:sync)
  → Gradle bundleRelease (assinada com secrets do CI)
  → npm run android:verify:release
  → upload do .aab como artifact do workflow
```

As 4 variáveis de signing viriam de **GitHub Actions secrets** (`secrets.REVENDASMART_KEYSTORE_PATH`
não funciona diretamente para um arquivo — o padrão é um secret com o keystore em base64, decodificado
para um arquivo temporário no runner, com `REVENDASMART_KEYSTORE_PATH` apontando para esse arquivo
temporário; as outras 3 variáveis viriam de secrets normais). Nenhum secret real foi criado nesta
tarefa.

## PLAY_CONSOLE_PENDING

Só possível depois que a conta Google Play Developer existir:

- criar conta Google Play Developer;
- criar o app no Play Console com o package `com.revendasmart.app`;
- ativar Play App Signing;
- registrar a upload key definitiva (`PRODUCTION_SIGNING_PENDING` até lá);
- registrar o certificado de upload;
- criar as subscriptions/base plans do Google Play Billing (`revendasmart_premium_monthly`/`_yearly`,
  base plans `premium-monthly-autorenew`/`premium-yearly-autorenew` — nomes já convencionados em
  `shared/play-billing-contract.ts`, RELEASE-07/07B);
- configurar a Google Play Developer API + service account + permissões;
- configurar RTDN/Pub/Sub;
- adicionar license testers;
- configurar Internal Testing;
- upload do primeiro `.aab` real;
- pre-launch report;
- Data Safety;
- URLs de privacidade/exclusão de conta;
- store listing (descrição, screenshots, ícone);
- content rating;
- production rollout.

## PRODUCTION_SIGNING_PENDING

Nenhuma chave de produção foi gerada nesta tarefa. Quando for a hora: gerar com `keytool` (RSA 2048+,
validade de pelo menos 25 anos — recomendação do Google, já que o Play exige upload com a mesma chave
por toda a vida do app até a migração para Play App Signing), guardar fora do repositório com backup
seguro (perder a chave ANTES de ativar Play App Signing é irrecuperável), e configurar as 4 variáveis
de ambiente em CI via secrets — nunca no repositório.
