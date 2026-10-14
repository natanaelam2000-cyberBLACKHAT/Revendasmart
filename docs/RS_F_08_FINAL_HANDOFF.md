# RS-F-08 — Handoff final e CI remoto

## Status consolidado

| Campo | Resultado |
|---|---|
| Frente | `F_TESTS_CI` |
| Branch | `codex/rs-f-07-ci-coverage` |
| HEAD validado | `a8ef9c292d19fd663dc4435ad4266fcd8338a84c` |
| Estado Git | limpo |
| Testes | `11/11 PASS` |
| Configuração CI | `PASS` |
| CI remoto | `NOT_EXECUTED` |
| Handoff A | `READY` |
| Integração | `CONDITIONAL_GO` |

O handoff substitui a referência anterior `c4de1bb` por `a8ef9c2`. Nenhum push, merge, rebase, cherry-pick, deploy ou publicação foi realizado.

## Commits exclusivos da Frente F

Base comum usada para o inventário: `8a08fe0`.

```text
1b94b4d test: add RS-F-01 contracts and CI gates
df72934 docs: record RS-F-02 validation results
3f5f4a1 docs: finalize RS-F-02 report
ed7c4cd test: harden rate limit regression mock
6c1f2f6 docs: prepare RS-F-04 integration handoff
c4de1bb docs: finalize RS-F-05 integration audit
6c23df0 test: expand pricing regression coverage
a8ef9c2 test: include all regression tests in CI
```

Arquivos acumulados pela Frente F:

- `.github/workflows/rs-f-01-tests-ci.yml`
- `package.json` — somente o script `test:rs-f-01` foi ampliado para os 11 testes.
- `tests/rs-f-01/rate-limit.integration.test.ts`
- `tests/rs-f-01/shared-contracts.test.ts`
- `tests/rs-f-06/product-pricing-regression.test.ts`
- `docs/RS_F_01_TESTS_CI.md` até `docs/RS_F_08_FINAL_HANDOFF.md`

Não houve alteração em `package-lock.json`, código de produção, Firebase, Android, billing, credenciais ou segredos.

## Descoberta e execução dos testes

O script efetivo em `package.json` é:

```text
tsx --test tests/rs-f-01/shared-contracts.test.ts tests/rs-f-01/rate-limit.integration.test.ts tests/rs-f-06/product-pricing-regression.test.ts
```

Ele referencia os três arquivos e os 11 casos: 4 contratos compartilhados, 3 cenários de rate limit e 4 regressões de preço. A execução local já comprovada foi `11 pass`, `0 fail`, sem testes ignorados ou pendentes.

## Configuração e gatilho do CI

O workflow `.github/workflows/rs-f-01-tests-ci.yml` contém os cinco gates obrigatórios, nesta ordem:

```text
npm ci
npm run test:rs-f-01
npm run check
npm run lint
npm run build
```

Também foi confirmado:

- `ubuntu-latest` e Node `20` via `actions/setup-node@v4`;
- cache npm habilitado pelo `setup-node`;
- `actions/checkout@v4`;
- `permissions: contents: read`;
- filtros para `tests/rs-f-01/**` e `tests/rs-f-06/**` em `pull_request` e `push`;
- `push` limitado à branch `main`.

O gatilho apropriado para validar esta entrega é abrir uma PR da branch `codex/rs-f-07-ci-coverage` para `main`, após a publicação autorizada da branch. Alterações nos testes, no script, no workflow, no lockfile ou nas áreas listadas acionam o workflow. Não é correto esperar execução remota apenas por manter a branch local.

## Roteiro autorizado para o CI remoto

Este é um procedimento para a Frente A/integração executar quando houver autorização de publicação:

1. Confirmar que a branch local está em `a8ef9c2` e limpa.
2. Publicar `codex/rs-f-07-ci-coverage` no repositório remoto, com autorização explícita.
3. Abrir PR direcionada a `main`, sem merge automático.
4. Aguardar o workflow `RS-F-01 Tests and CI`.
5. Registrar o run e os logs de cada gate.
6. Só considerar a validação completa aprovada se todos os cinco gates passarem.

## Critérios objetivos

| Gate | PASS | FAIL |
|---|---|---|
| `npm ci` | instala exatamente o lockfile e retorna exit code 0 | erro de resolução, lockfile, rede ou exit code diferente de 0 |
| `npm run test:rs-f-01` | descobre e conclui 11/11 casos, com 0 falhas | qualquer falha, cancelamento, caso ausente ou teste não descoberto |
| `npm run check` | TypeScript retorna exit code 0 | qualquer erro de tipo ou exit code diferente de 0 |
| `npm run lint` | lint retorna exit code 0 | qualquer diagnóstico bloqueante ou exit code diferente de 0 |
| `npm run build` | build termina com exit code 0 | erro de compilação/empacotamento ou exit code diferente de 0 |

Falha em um gate mantém o resultado remoto como `FAIL`, mesmo com os outros gates aprovados. O CI remoto continua `NOT_EXECUTED` nesta rodada porque nenhuma publicação ou PR foi feita.

## Riscos e dependências

- Typecheck, lint e build permanecem sem aprovação local nesta máquina porque as dependências completas não estão disponíveis; não foi executado `npm ci`, conforme a restrição da missão.
- O resultado `11/11 PASS` é local e não equivale a aprovação do GitHub Actions.
- A execução remota depende de acesso ao GitHub, publicação autorizada da branch e abertura de PR contra `main`.
- O risco de sobreposição da Frente F é baixo: o último commit altera somente descoberta de testes, filtros do workflow e documentação.
- Branches e worktrees anteriores foram preservadas, incluindo F-01 em `c4de1bb` e a referência F-06 em `6c23df0`.

## Decisão

`HANDOFF_A=READY`: o pacote está inventariado e pronto para receber integração planejada.

`INTEGRATION_GO_NO_GO=CONDITIONAL_GO`: pode avançar para publicação autorizada e validação por PR, mas a integração final depende dos cinco gates remotos passarem. Sem esse run real, não há aprovação definitiva.
