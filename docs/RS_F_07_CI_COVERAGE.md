# RS-F-07 — Cobertura automática no CI

## Resultado executivo

| Campo | Resultado |
|---|---|
| Frente | `F_TESTS_CI` |
| Tarefa | `RS-F-07` |
| Base | `6c23df0` (`codex/rs-f-06-regression-expansion`) |
| Branch de trabalho | `codex/rs-f-07-ci-coverage` |
| Testes descobertos | `11` |
| Testes executados | `11` |
| Resultado dos testes | `PASS` — 11/11, 0 falhas |
| Todos os testes incluídos no CI | `YES` |
| Validação do workflow | `PASS` |
| Typecheck | `BLOCKED` — dependências completas não disponíveis; `npm ci` não foi executado por restrição da missão |
| Lint | `BLOCKED` — dependências completas não disponíveis; `npm ci` não foi executado por restrição da missão |
| Build | `BLOCKED` — dependências completas não disponíveis; `npm ci` não foi executado por restrição da missão |
| CI remoto | `NOT_EXECUTED` |
| Decisão | `CONDITIONAL_GO` |

## Auditoria e lacuna encontrada

A base `6c23df0` estava limpa e preservada. O script `test:rs-f-01` executava apenas os sete testes de `tests/rs-f-01/`, embora os quatro testes de regressão de preços em `tests/rs-f-06/product-pricing-regression.test.ts` já existissem. O workflow também filtrava somente `tests/rs-f-01/**`; alterações exclusivamente em `tests/rs-f-06/**` poderiam não disparar o workflow.

Foram feitas somente duas correções de infraestrutura:

1. Inclusão do arquivo F-06 no comando `test:rs-f-01`, mantendo o nome do script por compatibilidade.
2. Inclusão de `tests/rs-f-06/**` nos filtros `pull_request.paths` e `push.paths`.

Não houve alteração de lógica de produção, dependências, `package-lock.json`, Firebase, Android, billing ou segredos.

## Testes auditados

- `tests/rs-f-01/shared-contracts.test.ts`: 4 contratos de charges, imagens, Marketing Pro e catálogo público.
- `tests/rs-f-01/rate-limit.integration.test.ts`: 3 cenários de incremento/bloqueio, isolamento de chave/janela e comportamento diante de contador corrompido/falha de infraestrutura.
- `tests/rs-f-06/product-pricing-regression.test.ts`: 4 cenários de preço promocional explícito, arredondamento percentual em centavos, dados promocionais inválidos/não benéficos e preços de venda inválidos.

Os testes exercitam implementações reais e usam apenas mocks locais dos limites externos necessários. Não acessam Firebase de produção, credenciais ou serviços pagos. A execução foi determinística nesta validação, sem testes ignorados, pendentes ou concorrência externa.

## Evidências executadas

Comando usado, com o `tsx` já disponível no ambiente canônico, sem reinstalar dependências:

```text
npm run test:rs-f-01
```

Resultado observado: `tests 11`, `pass 11`, `fail 0`, `cancelled 0`, `skipped 0`, exit code `0`.

Validação estática do workflow:

```text
WORKFLOW_STATIC_OK
NODE_VERSION=20
GATES=npm ci|npm run test:rs-f-01|npm run check|npm run lint|npm run build
```

Também foi executado `git diff --check`, sem saída de erro. A validação confirmou `permissions.contents: read`, `actions/checkout@v4`, `actions/setup-node@v4`, `node-version: 20`, cache npm e os filtros F-06 nos dois gatilhos.

`npm ci`, typecheck, lint e build não foram repetidos: a missão proíbe reinstalação e o ambiente Windows continua sem o conjunto completo de dependências, portanto esses gates permanecem bloqueados, não aprovados.

## Integração e riscos

- A branch F-06 permanece apontando para `6c23df0`; a branch F-07 é uma derivação separada na mesma worktree, sem criar diretório ou dependências duplicadas.
- Arquivos modificados pela missão: `package.json`, `.github/workflows/rs-f-01-tests-ci.yml` e este relatório.
- `package-lock.json` não foi modificado.
- Risco de sobreposição funcional: baixo; as mudanças são limitadas à descoberta de testes e aos filtros do CI.
- CI remoto não foi executado. A confirmação final requer um run real do GitHub Actions após publicação/integrção autorizada.

## Próximos passos

1. Em ambiente Linux limpo, executar `npm ci`.
2. Executar `npm run test:rs-f-01`, `npm run check`, `npm run lint` e `npm run build`.
3. Confirmar no GitHub Actions que o workflow dispara para alterações em `tests/rs-f-06/**` e que todos os gates passam.
4. Não tratar o resultado local desta missão como aprovação do CI remoto.
