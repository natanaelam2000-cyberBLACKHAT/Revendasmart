# MISSÃO RS-F-03 — Hardening de CI e regressão

Status geral: **PARTIAL**.

## Identidade confirmada

- Worktree: `C:\Users\natan\Documents\Codex\revendasmart-rs-f-01-tests-ci`
- Branch: `codex/rs-f-01-tests-ci`
- HEAD inicial esperado e confirmado: `3f5f4a1c293636523699992bcbeaa2528f1cbcf0`
- Status inicial: limpo
- Nenhuma outra branch/worktree foi alterada.

## Revisão e hardening

Os seis testes da RS-F-01 foram revisados quanto a asserts fortes, casos negativos, mocks e isolamento. Foi encontrada uma lacuna concreta no mock do rate limiter: todos os requests compartilhavam um único documento em memória, portanto o teste poderia passar mesmo se a implementação ignorasse a chave ou a janela.

Alteração feita exclusivamente no teste `tests/rs-f-01/rate-limit.integration.test.ts`:

- mock agora armazena documentos por `doc.id`;
- contador corrompido é semeado no ID correto;
- novo caso confirma que chaves distintas e janelas distintas não compartilham contador;
- nenhuma lógica de produção foi alterada.

## Matriz de validação

| Verificação | Resultado | Evidência |
|---|---|---|
| Branch, HEAD e status | PASS | `git rev-parse`, `git status`, `git worktree list` |
| Suite RS-F-01 | PASS | `npm run test:rs-f-01`, 7/7 testes, exit code 0 |
| Assert/mocks/isolamento | PASS | mock Firestore indexado por documento + casos negativos |
| Sintaxe YAML | PASS | parser YAML executado e job `tests-and-build` encontrado |
| Instalação Linux limpa | NOT EXECUTED | não há runner Linux local; workflow contém `npm ci` |
| Typecheck | BLOCKED | dependências não instaladas na worktree; `@types/node`/`vite/client` ausentes |
| Lint | BLOCKED | dependência `@eslint/js` ausente na worktree |
| Build | BLOCKED | dependência `esbuild` ausente na worktree |
| Cobertura numérica | BLOCKED/NOT CONFIGURED | projeto não possui instrumentador de cobertura |

## Workflow auditado

`.github/workflows/rs-f-01-tests-ci.yml` contém:

1. `actions/checkout@v4`;
2. `actions/setup-node@v4`, Node 20 e cache npm;
3. `npm ci` baseado no `package-lock.json`;
4. `npm run test:rs-f-01`;
5. `npm run check`;
6. `npm run lint`;
7. `npm run build`.

As permissões são `contents: read`. Não há secrets, Firebase, produção, deploy ou serviços pagos. O workflow existente `quality-gates.yml` continua cobrindo a suíte legada `npm run test`, além de gates adicionais; ele não foi duplicado nem alterado nesta missão.

## Ambiente e bloqueio residual

Node `v24.15.0`, npm `11.12.1`, registry oficial e lockfile v3 foram confirmados. O cache npm verificado estava vazio. Não houve nova tentativa de `npm ci` após a falha `EPERM`/`Exit handler never called` registrada na RS-F-02.

O teste pôde ser executado reaproveitando somente o binário `tsx` íntegro da cópia canônica via `PATH`. Isso não é uma instalação completa e, por isso, typecheck, lint e build permanecem honestamente classificados como BLOCKED.

## Procedimento reproduzível em Linux/CI

Em checkout limpo, sem copiar `node_modules` entre sistemas:

```bash
node --version
npm --version
npm ci --ignore-scripts --no-audit --no-fund
npm run test:rs-f-01
npm run check
npm run lint
npm run build
```

No GitHub Actions, executar o workflow `RS-F-01 Tests and CI` em runner `ubuntu-latest`. O resultado remoto só deve ser considerado PASS após o job real concluir com sucesso; esta missão não executou nem alegou CI remoto.

## Riscos residuais

- Typecheck, lint e build ainda não têm evidência local nesta worktree por falta de dependências.
- A suíte RS-F-01 é determinística, mas não substitui os testes legados, Playwright ou emuladores Firebase.
- Não há percentual de cobertura mensurado.
- A etapa Playwright do workflow legado não inicia servidor automaticamente; isso permanece risco documentado da RS-F-02.

## Arquivos e commit

Arquivos alterados nesta missão:

- `tests/rs-f-01/rate-limit.integration.test.ts`
- `docs/RS_F_03_CI_HARDENING.md`

Não houve alteração em `package.json`, `package-lock.json`, funcionalidades do aplicativo, Android, billing, Firebase ou produção. O commit local final será informado após a validação do estado Git.
