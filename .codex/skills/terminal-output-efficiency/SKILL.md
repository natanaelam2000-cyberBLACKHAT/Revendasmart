---
name: terminal-output-efficiency
description: Reduz ruído de terminal usando comandos nativos e saídas direcionadas, sem instalar RTK ou hooks globais.
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
  - terminal
  - diagnostics
  - architecture
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
  - terminal-output-efficiency
  - economia de tokens
  - saída concisa
  - mudança mínima
---
# terminal-output-efficiency

## Objetivo

Diminuir tokens gastos em saídas de terminal mantendo diagnóstico suficiente. Esta skill adapta princípios de higiene de saída sem instalar RTK, sem hooks globais e sem reescrever comandos automaticamente.

## Quando usar

Use em auditorias, validações, busca de arquivos, inspeção Git, testes longos e comparação antes/depois.

## Preferências de comando

- `git status --short` para estado compacto.
- `git status -sb` quando a branch também importa.
- `git log -1 --oneline` ou `git log --oneline -5` em vez de logs longos.
- `git diff --stat` antes de abrir diff completo.
- `git diff --check` para whitespace.
- `rg` com padrões específicos e paths delimitados.
- `head`, `tail`, `sed -n` ou filtros por erro para reduzir logs grandes.
- Em teste aprovado, registrar comando e status; em falha, preservar trecho relevante.

## Regras contra ruído perigoso

- Não truncar erro antes da primeira mensagem útil.
- Não esconder stack local quando ela é necessária para corrigir teste, desde que não contenha segredo.
- Não repetir a mesma validação sem mudança de código ou hipótese nova.
- Não imprimir arquivos inteiros se um intervalo resolve.
- Não instalar RTK, não executar instaladores remotos, não modificar PATH e não criar aliases globais.


## Limites obrigatórios

- Não fazer commit.
- Não fazer deploy.
- Não imprimir segredos.
- Não executar testes em produção.
- Não ocultar falhas, riscos ou validações relevantes para economizar tokens.
- Não reduzir segurança, acessibilidade, tratamento de erro, compatibilidade ou testes necessários.
- Parar se a tarefa exigir alteração financeira, IAM real, produção, dados reais de terceiros, deploy ou ação destrutiva.


## Entregáveis

- Comandos usados.
- Resumo da saída.
- Trecho completo apenas para falhas relevantes.
