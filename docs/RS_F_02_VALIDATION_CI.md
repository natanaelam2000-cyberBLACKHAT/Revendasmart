# MISSÃO RS-F-02 — Validação e CI

Status geral: **PARTIAL**.

## Identidade e isolamento

- Worktree validada: `C:\Users\natan\Documents\Codex\revendasmart-rs-f-01-tests-ci`.
- Branch confirmada: `codex/rs-f-01-tests-ci`.
- HEAD confirmado no início: `1b94b4dc13181fd3a3fa0ed04ec3b8525a03281f` (`test: add RS-F-01 contracts and CI gates`).
- Status Git inicial: limpo.
- Nenhuma outra worktree foi modificada.

## Matriz de validação

| Item | Resultado | Evidência |
|---|---|---|
| Branch/HEAD/isolamento | PASS | `git rev-parse`, `git status`, `git worktree list` |
| Auditoria dos 6 testes | PASS | 4 testes de contrato + 2 testes de integração com mock Firestore revisados |
| `npm run test:rs-f-01` | PASS | 6/6 testes passaram; exit code 0 |
| Workflow CI | PASS | permissões `contents: read`, `checkout@v4`, `setup-node@v4`, Node 20, `npm ci`, sem segredos |
| YAML do workflow | PARTIAL | Conteúdo auditado; parser PyYAML não disponível no host |
| Typecheck | BLOCKED | dependências ausentes na worktree: `@types/node` e `vite/client` |
| Lint | BLOCKED | dependência ausente: `@eslint/js` |
| Build | BLOCKED | dependência ausente: `esbuild` |
| Cobertura | BLOCKED/NOT CONFIGURED | não há instrumentador de cobertura no projeto |

## Ambiente e investigação do EPERM

Versões verificadas:

- Node `v24.15.0`
- npm `11.12.1`
- registry `https://registry.npmjs.org/`
- `package-lock.json`: lockfile version 3
- cache npm: verificado, `0` entradas / `0 bytes`

O primeiro `npm ci --ignore-scripts` deixou uma instalação parcial em `node_modules`. A segunda tentativa, ainda na mesma worktree, terminou com `EPERM` ao remover/criar subdiretórios. Para não limpar destrutivamente nem tocar em outra worktree, o resíduo foi apenas renomeado para `node_modules.partial` e mantido fora do controle de versão.

Também foi tentada uma instalação limpa em `work/rs-f-02-deps`, depois movida para `C:\Users\natan\Documents\Codex\rs-f-02-deps-isolated`. O comando:

```text
npm ci --ignore-scripts --no-audit --no-fund --prefix <diretório-isolado>
```

terminou com `npm error Exit handler never called!`. O cache local estava vazio, então não havia cache íntegro para reaproveitar.

Os seis testes puderam ser executados com `npm run test:rs-f-01` usando o `tsx` já íntegro da cópia canônica apenas via `PATH`; isso não representa uma instalação completa da worktree e não foi usado para declarar typecheck, lint ou build como aprovados.

## Auditoria do workflow

`.github/workflows/rs-f-01-tests-ci.yml` usa somente actions oficiais em versões major estáveis (`checkout@v4`, `setup-node@v4`), Node 20, cache npm provido pelo `setup-node`, `npm ci` baseado no lockfile e permissões mínimas de leitura de conteúdo. O workflow não referencia Firebase, credenciais, secrets, produção, deploy ou serviços pagos.

## Procedimento seguro para o proprietário

Em um checkout novo ou ambiente Windows sem processos segurando arquivos:

```text
npm ci --ignore-scripts --no-audit --no-fund
npm run test:rs-f-01
npm run check
npm run lint
npm run build
```

Se `npm ci` repetir `EPERM`, usar um diretório/checkout descartável novo, sem remover worktrees compartilhadas e sem alterar ACLs. Depois repetir os quatro comandos acima. O workflow do GitHub Actions já fornece o caminho de validação em runner limpo.

## Alterações desta missão

- Apenas este relatório foi adicionado nesta missão.
- Não houve alteração de lógica de negócio, produção, billing, Firebase, assinatura Android, push, merge, deploy ou publicação.
- Commit local do relatório: preencher no commit desta missão; a identificação final também será informada na entrega.
