# MISSÃO RS-F-06 — Expansão de testes de regressão

## Resultado

```text
FRONT=F_TESTS_CI
TASK_ID=RS-F-06
BRANCH=codex/rs-f-06-regression-expansion
HEAD_INITIAL=c4de1bb
HEAD_FINAL=<commit local desta branch; informado na entrega>
NEW_TESTS=4
TESTS=PASS
PRODUCTION_CHANGED=NO
OVERLAP_RISK=LOW
TYPECHECK=BLOCKED
LINT=BLOCKED
BUILD=BLOCKED
GO_NO_GO=CONDITIONAL_GO
```

## Isolamento

- Origem confirmada: `codex/rs-f-01-tests-ci` em `c4de1bb`.
- Nova worktree: `C:\Users\natan\Documents\Codex\revendasmart-rs-f-06-regression-expansion`.
- Branch nova: `codex/rs-f-06-regression-expansion`.
- A worktree original permaneceu limpa e em `c4de1bb`.
- Não houve alteração em outras branches, push, merge, cherry-pick, deploy ou publicação.

## Lacuna selecionada

A suíte anterior cobria cobranças, catálogo, imagens, contrato Marketing Pro e rate limit, mas não cobria diretamente o módulo puro `shared/product-pricing.ts`. Essa é uma fronteira de alto risco porque decide preço efetivo, arredondamento financeiro e rejeição de dados corrompidos.

Não foram selecionados fluxos Firebase, Android, billing externo ou áreas com dependência provável de outras frentes, pois exigiriam emulador/serviço ou poderiam criar sobreposição funcional. A responsabilidade de F ficou limitada à regressão determinística do contrato puro já usado pela aplicação.

## Testes adicionados

Arquivo: `tests/rs-f-06/product-pricing-regression.test.ts`

1. preço promocional explícito vence percentual e ignora `isOnSale` legado;
2. percentual arredonda o preço final em centavos (`199,90 - 15% = 169,92`);
3. promoção maior que o preço normal ou de 100% não cria preço inválido;
4. preço zero, negativo, não finito ou string numérica falha com `InvalidProductPriceError`.

Os testes exercitam `resolveEffectiveProductPrice` e `InvalidProductPriceError` reais, sem mockar o módulo sob teste.

## Evidências

Com o runtime `tsx` já disponível na máquina, sem `npm ci`:

```text
node .../tsx/dist/cli.mjs --test \
  tests/rs-f-01/shared-contracts.test.ts \
  tests/rs-f-01/rate-limit.integration.test.ts \
  tests/rs-f-06/product-pricing-regression.test.ts
```

Resultado: **11/11 PASS** — 7 testes anteriores + 4 novos.

O comando existente `npm run test:rs-f-01` não foi alterado, conforme a restrição de não modificar `package.json`, workflows ou lockfile. Portanto, os quatro testes novos devem ser incorporados explicitamente ao script/workflow pela integração central antes de serem considerados gate automático.

Typecheck, lint e build: **BLOCKED**, sem dependências completas na worktree e sem insistir em `npm ci`. Nenhuma aprovação foi inferida desses gates.

## Risco de sobreposição

Classificação: **LOW**.

- somente arquivo novo em `tests/rs-f-06/` e este relatório;
- nenhum código funcional alterado;
- nenhum arquivo de outras frentes alterado;
- não houve alteração de `package.json`, `package-lock.json` ou workflows.

## Próximos passos da integração

- [ ] revisar os quatro testes no branch central;
- [ ] adicionar o arquivo ao comando de testes central, preservando `package.json` conforme a estratégia de integração;
- [ ] executar os 11 testes em Linux/CI limpo com dependências instaladas pelo lockfile;
- [ ] executar typecheck, lint e build no mesmo ambiente;
- [ ] manter a decisão como `CONDITIONAL_GO` até esses gates passarem.
