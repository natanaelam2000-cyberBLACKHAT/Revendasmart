---
name: minimal-change-engineering
description: Guia o agente a resolver o pedido com a menor alteração correta, sem cortar segurança, validação ou compatibilidade.
version: 1.0.0
source: Revenda Smart token efficiency skill
sourceCommit: 8afa785f0d675f5303881654d62ea3543f08b1a8
adaptedFrom:
  - https://github.com/DietrichGebert/ponytail
  - https://github.com/JuliusBrussee/caveman
  - https://github.com/rtk-ai/rtk
  - https://github.com/felixsim/bonsai-memory
  - https://github.com/o4f6bgpac3/concise
license: Apache-2.0
category: architecture
tier: Token Efficiency
tags:
  - revendasmart
  - token-efficiency
  - minimal-change
  - architecture
  - safe-fix
riskLevel: low
defaultMode: REVIEW_ONLY
allowedEnvironments:
  - local
  - firebase-emulator
  - authorized-staging
prohibitedEnvironments:
  - production
  - third-party-accounts
  - destructive-data
  - exfiltration
triggers:
  - minimal-change-engineering
  - economia de tokens
  - saída concisa
  - mudança mínima
---
# minimal-change-engineering

## Objetivo

Aplicar engenharia de mudança mínima no Revenda Smart: resolver exatamente o pedido, reutilizar o que já existe e evitar abstrações, dependências ou refatorações fora de escopo.

## Quando usar

Use quando a tarefa pedir hotfix, ajuste localizado, auditoria corretiva, preparação de commit seletivo ou redução de diffs.

## Workflow

1. Confirmar escopo, branch e `git status --short`.
2. Ler os arquivos afetados antes de editar.
3. Preferir APIs, componentes, hooks e helpers existentes.
4. Implementar a menor alteração que preserve contrato, dados legados e UX esperada.
5. Não criar fallback, camada, provider, dependência ou script para um único uso sem necessidade comprovada.
6. Remover código morto criado pela própria alteração.
7. Validar proporcionalmente ao risco: tipagem, testes, smoke e `git diff --check` quando aplicável.

## Critérios de qualidade

- Diferença pequena e rastreável.
- Contratos existentes preservados.
- Nenhuma regra de negócio alterada por conveniência.
- Nenhum campo sensível logado.
- Nenhuma funcionalidade removida para “simplificar”.


## Limites obrigatórios

- Não fazer commit.
- Não fazer deploy.
- Não imprimir segredos.
- Não executar testes em produção.
- Não ocultar falhas, riscos ou validações relevantes para economizar tokens.
- Não reduzir segurança, acessibilidade, tratamento de erro, compatibilidade ou testes necessários.
- Parar se a tarefa exigir alteração financeira, IAM real, produção, dados reais de terceiros, deploy ou ação destrutiva.


## Entregáveis

- Arquivos alterados.
- Motivo de cada mudança.
- Validações executadas.
- Riscos restantes e o que ficou fora de escopo.
