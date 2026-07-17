# Firebase Emulator Suite — testes locais

Este fluxo testa Firebase Authentication, Firestore Rules e Storage Rules do Revenda Smart sem tocar produção.

## Emuladores configurados

- Auth: `127.0.0.1:9099`
- Firestore: `127.0.0.1:8080`
- Storage: `127.0.0.1:9199`
- Emulator UI: `127.0.0.1:4000`

O projeto local usado nos scripts é sempre `demo-revendasmart`.

## Rodar o app contra emuladores

Use a flag explícita apenas em ambiente local:

```bash
VITE_USE_FIREBASE_EMULATORS=true npm run dev:client
```

A aplicação conecta Auth, Firestore e Storage aos emuladores somente quando `VITE_USE_FIREBASE_EMULATORS=true`. Builds de produção falham se essa flag estiver ativa.

## Iniciar emuladores manualmente

```bash
npm run emulators:start
```

O script usa `firebase-tools@15.24.0` pinado via `npx` e cache em `/tmp/revendasmart-npm-cache`. Isso evita depender de uma instalação global e reduz pressão sobre o filesystem persistente do Cloud Shell.

## Executar testes de integração

```bash
npm run test:firebase
```

O comando sobe Auth, Firestore e Storage via `firebase emulators:exec` e executa `script/firebase-emulator-tests.ts`.

Os testes usam dados sintéticos e validam:

- usuários autenticados no Auth Emulator;
- bloqueio de acesso anônimo;
- isolamento entre usuários em produtos, clientes, vendas, cobranças e conexões Mercado Pago;
- coleções backend-only como `charges`, `mercadopago_connections` e `user_settings`;
- validação de campos permitidos em produtos;
- Storage com imagem permitida, SVG bloqueado e isolamento por UID.

## Segurança operacional

- Nunca execute esses testes contra produção.
- Nunca use dados reais.
- Nunca use o projeto `revenda-smart` com `test:firebase`.
- Não faça deploy de rules a partir deste fluxo.
- Não salve credenciais ou service accounts para esses testes.

## Limpeza

Os dados ficam dentro dos emuladores e são descartáveis. Para limpar cache transitório do Firebase CLI:

```bash
rm -rf /tmp/revendasmart-npm-cache
```

Não use `git clean` ou `git reset --hard` para resolver problema de ambiente.

## Problemas comuns

- `ENOSPC` no Cloud Shell: limpe cache transitório em `/tmp`; não instale `firebase-tools` no `node_modules` local se o disco persistente estiver cheio.
- Porta ocupada: pare processos usando 9099, 8080, 9199 ou 4000.
- Build falhando por flag: remova `VITE_USE_FIREBASE_EMULATORS=true` antes de `npm run build`.
