---
name: revendasmart-android-release
description: Procedimento seguro para preparar, validar, instalar e diagnosticar APK debug Android do Revenda Smart sem gerar release, AAB, keystore ou publicação. Use quando a tarefa envolver android:sync, android:doctor, APK debug, ADB, logcat, confirmação de build no aparelho ou troubleshooting de ambiente Android do Revenda Smart.
version: 1.0.0
source: Revenda Smart custom agent skill
sourceCommit: a029ad1573e0
license: Apache-2.0
category: production-readiness
tier: Custom Android
tags:
  - revendasmart
  - android
  - mobile
  - release-readiness
  - production-readiness
riskLevel: medium
defaultMode: REVIEW_ONLY
allowedEnvironments:
  - local
  - emulator
  - staging
prohibitedEnvironments:
  - production
---

# Revenda Smart Android Debug Release

Use esta skill para validar APK debug do Revenda Smart de forma reproduzível. Não fazer commit. Não fazer deploy. Não imprimir segredos. Não testar em produção. Não gerar release, AAB, keystore, assinatura ou publicação na Play Store sem solicitação explícita.

## Workflow

1. Confirmar o repositório `/home/natanaelam2000/Revendasmart-hotfix`, branch, HEAD e `git status --short`.
2. Confirmar Java/JDK, Android SDK, Node e espaço em disco.
3. Instalar dependências com `npm ci` somente se necessário e sem alterar versões arbitrariamente.
4. Executar `npm run check`, `npm run build`, `npm run android:sync` e `npm run android:doctor`.
5. Confirmar que `dist/public/index.html` e `android/app/src/main/assets/public/index.html` existem.
6. Limpar Gradle apenas com comandos seguros do projeto ou do wrapper Gradle; nunca remover arquivos do usuário.
7. Gerar APK debug com `npm run android:build:debug` ou Gradle debug equivalente.
8. Localizar o APK debug, registrar tamanho e calcular SHA-256.
9. Confirmar dispositivo ADB com `adb devices`.
10. Desinstalar APK antigo somente se o usuário pediu teste limpo e o package id for `com.revendasmart.app`.
11. Instalar o APK debug, abrir o app e confirmar o identificador de build em Configurações > Sobre.
12. Coletar `logcat` filtrado para `com.revendasmart.app`, sem imprimir tokens, URLs assinadas, dados de cliente ou payloads completos.

## Critérios de parada

- Parar se a branch, HEAD ou worktree divergirem do escopo.
- Parar se Java, Android SDK ou ADB estiverem ausentes.
- Parar se `android:sync` não copiar assets ou se o build web falhar.
- Parar se o APK não for encontrado.
- Parar se o dispositivo ADB não estiver autorizado.
- Parar diante de segredo, keystore, senha, token ou configuração de produção inesperada.

## Falhas comuns

- Java ausente: instalar/configurar JDK compatível antes de continuar.
- Android SDK ausente: configurar SDK/ANDROID_HOME antes de continuar.
- ADB sem dispositivo: autorizar depuração USB no aparelho.
- Build web falhou: corrigir o erro web antes de mexer no Android.
- Assets Android ausentes: rerodar `npm run android:sync` e verificar `android/app/src/main/assets/public`.
- APK antigo instalado: desinstalar apenas o package id oficial, se autorizado.

## Entregáveis

Relatar branch, HEAD, status, comandos executados, APK gerado, SHA-256, dispositivo usado, confirmação do build no aparelho, erros relevantes e próximos passos. Não fazer commit. Não fazer deploy. Não imprimir segredos.
