# MISSÃO RS-F-01 — Engenharia de testes e CI

Status desta frente: **PARTIAL**.

## Base e isolamento

- Base estável: `main` em `8a08fe0` (`feat: adiciona apresentação animada ao sorteio`).
- Branch local: `codex/rs-f-01-tests-ci`.
- Worktree isolado: `C:\Users\natan\Documents\Codex\revendasmart-rs-f-01-tests-ci`.
- A branch e o worktree foram criados com nome solicitado; não houve colisão.
- Nenhum worktree existente foi alterado.

## Reconhecimento

O projeto já possuía scripts TypeScript de smoke/regressão e vários cenários Playwright em `tests/e2e`, além de três workflows: `quality-gates.yml`, `performance-skills-validation.yml` e `security-skills-validation.yml`. Não havia README no checkout de `main`, nem uma suíte curta de testes unitários/contratuais integrada a um script dedicado.

O workflow `quality-gates.yml` já executava `check`, lint, build, testes legados e Playwright, mas a etapa Playwright não inicia servidor por conta própria. Isso permanece documentado como limitação pré-existente; esta frente não alterou lógica de aplicação nem o harness E2E das outras frentes.

## Entregas

- `tests/rs-f-01/shared-contracts.test.ts`
  - mapeamento de status/ambiente e round-trip de referências de cobrança;
  - validação de magic bytes/dimensões de imagem;
  - identificadores fechados do contrato Marketing Pro;
  - contrato público do catálogo, incluindo sanitização e não exposição do valor Pix.
- `tests/rs-f-01/rate-limit.integration.test.ts`
  - integração determinística com mock de Firestore;
  - incremento, limite máximo, contador corrompido fail-closed e indisponibilidade fail-open.
- `package.json`: script local `npm run test:rs-f-01`.
- `.github/workflows/rs-f-01-tests-ci.yml`: pipeline gratuito do GitHub Actions com `npm ci`, testes novos, typecheck, lint e build.

## Validação

| Verificação | Resultado |
|---|---|
| Testes RS-F-01 | PASS — 6/6 testes passaram via `tsx --test` |
| Typecheck | BLOCKED — `npm ci` deixou instalação parcial e o runner não encontrou `@types/node`/`vite/client` |
| Lint | BLOCKED — mesma falha de dependências; `@eslint/js` não foi resolvido |
| Build | BLOCKED — mesma falha de dependências; `esbuild` não foi resolvido |
| Cobertura mensurada | Não disponível: o projeto não tinha instrumentador configurado e esta frente não adicionou dependência apenas para métrica |

O comando `npm ci --ignore-scripts --no-audit --no-fund` foi tentado duas vezes. A segunda tentativa terminou com `EPERM` ao limpar/criar diretórios residuais de `node_modules` no Windows. A falha é ambiental e não ocorreu nos seis testes da frente. Em checkout limpo do GitHub Actions, o workflow novo executa `npm ci` antes dos gates.

## Limites respeitados

Não foram alteradas regras de negócio, credenciais, configurações de produção, assinatura Android ou release. Não houve push, merge, deploy ou publicação.

## Commit local

Commit local: `5284224` — `test: add RS-F-01 contracts and CI gates`.
