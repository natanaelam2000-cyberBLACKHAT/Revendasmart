---
name: concise-technical-output
description: Orienta respostas e relatórios técnicos mais curtos, preservando precisão, comandos, caminhos, erros e riscos.
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
  - communication
  - reporting
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
  - concise-technical-output
  - economia de tokens
  - saída concisa
  - mudança mínima
---
# concise-technical-output

## Objetivo

Reduzir ruído em respostas técnicas do Revenda Smart sem virar telegrama, sem perder gramática e sem esconder contexto importante.

## Quando usar

Use em status, handoff, relatório pós-validação, resumo de falha, instrução de commit seletivo ou resposta operacional.

## Workflow de comunicação

1. Começar pelo resultado: passou, falhou, bloqueou ou ficou pendente.
2. Não repetir o pedido do usuário.
3. Evitar cumprimentos, prefácios longos e narração passo a passo.
4. Mostrar logs completos somente quando ajudam a corrigir a falha.
5. Em validações aprovadas, usar resumo por comando.
6. Em validações com falha, preservar mensagem de erro, arquivo, linha, comando e contexto suficiente.
7. Manter nomes reais de arquivos, comandos, rotas, variáveis e mensagens de usuário.

## Não usar para comprimir

- Arquitetura complexa que exige trade-offs claros.
- Segurança, incidente, migração, banco de dados ou produção quando a concisão criaria ambiguidade.
- Relatório com obrigação explícita de detalhes completos.


## Limites obrigatórios

- Não fazer commit.
- Não fazer deploy.
- Não imprimir segredos.
- Não executar testes em produção.
- Não ocultar falhas, riscos ou validações relevantes para economizar tokens.
- Não reduzir segurança, acessibilidade, tratamento de erro, compatibilidade ou testes necessários.
- Parar se a tarefa exigir alteração financeira, IAM real, produção, dados reais de terceiros, deploy ou ação destrutiva.


## Entregáveis

- Resumo objetivo.
- Falhas e bloqueios primeiro.
- Próximo comando ou decisão quando houver.
