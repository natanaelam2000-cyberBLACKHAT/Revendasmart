# Sprint de Qualidade 1

Infraestrutura mínima e conservadora para prevenir regressões sem remover código automaticamente.

## Playwright

Scripts: `test:e2e`, `test:e2e:ui`, `test:e2e:install`.

O fluxo E2E só executa mutações quando existem `E2E_ALLOW_MUTATIONS=1`, `E2E_BASE_URL`, `E2E_TEST_EMAIL` e `E2E_TEST_PASSWORD` em ambiente seguro de teste/emulator. Sem isso, fica skipped. Não usar credenciais pessoais nem produção real.

## Gitleaks

`.gitleaks.toml` define regras do Revenda Smart. `security:gitleaks` usa o binário real quando disponível; sem binário, roda guardrail local redigido. CI usa `gitleaks/gitleaks-action` oficial.

## Knip

`quality:knip` roda em modo relatório com `--no-exit-code`. Nenhuma remoção automática é permitida nesta sprint.

## Dependabot

Configuração semanal, sem automerge, com majors separados e limite conservador de PRs.
