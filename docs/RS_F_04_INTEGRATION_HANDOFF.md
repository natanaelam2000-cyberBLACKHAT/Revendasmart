# MISSÃO RS-F-04 — Integration Readiness

## Resultado formal

```text
FRONT=F_TESTS_CI
TASK_ID=RS-F-04
HEAD_INITIAL=ed7c4cd
HEAD_FINAL=<commit deste relatório; informado na entrega>
TESTS=PASS
TYPECHECK=BLOCKED
LINT=BLOCKED
BUILD=BLOCKED
CI_REMOTE=NOT_EXECUTED
INTEGRATION_HANDOFF=READY_WITH_BLOCKED_GATES
GO_NO_GO=NO_GO
```

## Identidade e isolamento

- Worktree: `C:\Users\natan\Documents\Codex\revendasmart-rs-f-01-tests-ci`
- Branch: `codex/rs-f-01-tests-ci`
- HEAD inicial confirmado: `ed7c4cd81ffb8b465283224806aca21fceb0f10a`
- Status inicial e final: limpo
- Nenhuma operação de push, merge, rebase, cherry-pick, deploy ou publicação foi executada.

## Inventário dos commits exclusivos da Frente F

Contra `main`, a branch contém quatro commits:

| Commit | Conteúdo |
|---|---|
| `1b94b4d` | testes de contrato/integração, script `test:rs-f-01` e workflow inicial |
| `df72934` | relatório RS-F-02 |
| `3f5f4a1` | finalização do relatório RS-F-02 |
| `ed7c4cd` | hardening do mock do rate limiter e relatório RS-F-03 |

## Arquivos para integração

```text
.github/workflows/rs-f-01-tests-ci.yml
docs/RS_F_01_TESTS_CI.md
docs/RS_F_02_VALIDATION_CI.md
docs/RS_F_03_CI_HARDENING.md
docs/RS_F_04_INTEGRATION_HANDOFF.md
package.json
tests/rs-f-01/rate-limit.integration.test.ts
tests/rs-f-01/shared-contracts.test.ts
```

`package-lock.json` não foi alterado. Não há alterações em funcionalidades do aplicativo, Firebase, Android, billing, produção ou credenciais.

## Scripts efetivos

O workflow executa, nesta ordem:

```text
npm ci
npm run test:rs-f-01
npm run check
npm run lint
npm run build
```

O script de testes aponta explicitamente para os dois arquivos da Frente F. O workflow legado `quality-gates.yml` continua responsável pela suíte ampla `npm run test`, Playwright, performance, secrets e demais gates existentes.

## Evidências locais

- `npm run test:rs-f-01`: **PASS**, 7/7 testes.
- Validação estática do YAML: **PASS**, parser encontrou o job e todos os cinco comandos esperados.
- Permissões do workflow: `contents: read`.
- Actions: `actions/checkout@v4` e `actions/setup-node@v4`.
- Node do workflow: 20, com cache npm.
- Dependências de produção/serviços pagos: não usadas pelos testes.
- Imports dos testes: módulos compartilhados e funções de catálogo/rate-limit; nenhuma credencial ou acesso a Firebase de produção.

## Linux/WSL2

WSL2 não ficou disponível com segurança neste host: `wsl.exe --status` e `wsl.exe -l -q` retornaram `Wsl/E_ACCESSDENIED`. Não foi instalado nem alterado nenhum componente global.

Roteiro reproduzível em Linux/WSL2, em diretório isolado:

```bash
git clone <repository-url> revendasmart-rs-f-04-validation
cd revendasmart-rs-f-04-validation
git checkout codex/rs-f-01-tests-ci
node --version
npm --version
npm ci --ignore-scripts --no-audit --no-fund
npm run test:rs-f-01
npm run check
npm run lint
npm run build
```

O roteiro deve ser executado em checkout próprio. Não copiar `node_modules` do Windows, não alterar ACLs e não remover dependências de outras worktrees. O resultado Linux/CI permanece **NOT_TESTED** nesta missão.

## Conflitos prováveis e requisitos de integração

- `package.json`: possível conflito se outra frente também tiver adicionado scripts recentemente; preservar `test:rs-f-01`.
- `.github/workflows/rs-f-01-tests-ci.yml`: possível conflito caso a integração central consolide workflows; preservar os cinco gates e `contents: read`.
- `tests/rs-f-01/**` e `docs/RS_F_0*.md`: arquivos exclusivos da Frente F, sem sobreposição funcional conhecida.

Antes de integrar, a frente central deve executar os quatro comandos no Linux/runner limpo e resolver qualquer conflito de `package.json`/workflow sem remover o gate de testes.

## Riscos residuais

- Typecheck, lint e build não foram aprovados localmente porque o Windows não conseguiu instalar dependências (`EPERM`/npm) e o cache estava vazio.
- CI remoto não foi executado nesta missão.
- Não há percentual de cobertura instrumentada.
- Os 7 testes determinísticos não substituem a suíte legada, Playwright ou Firebase Emulator.
- `quality-gates.yml` possui uma etapa Playwright que não inicializa servidor automaticamente; risco já registrado nas missões anteriores.

## Decisão

O handoff de arquivos e procedimento está **READY_WITH_BLOCKED_GATES**. A decisão operacional é **NO_GO** até uma execução Linux/CI real aprovar typecheck, lint e build. Não classificar o estado atual como CI aprovado.
